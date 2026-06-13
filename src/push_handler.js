/**
 * Spec2Tickets v3.0.1 — synchronous JIRA push library.
 *
 * v2.x routed push through customer backend с service-account credentials.
 * v3.0.0 used Forge native `api.asUser().requestJira(...)` — closes
 * Atlassian's earlier security review service-account concern AND uses
 * customer-context permissions automatically.
 *
 * ⚠ ARCHITECTURE CHANGE (2026-05-30): push moved от async event consumer
 * BACK to synchronous resolver execution. Root cause: `asUser()` is NOT
 * available in async event handlers (Forge runtime threw
 * `401 - AUTH_TYPE_UNAVAILABLE`). asUser() works ONLY in resolver context
 * (user-invoked from Custom UI). Confirmed via Atlassian docs + community.
 *
 * ⚠ CHUNKED PATTERN (2026-05-30 update): JIRA bulk create е slow (measured
 * ~0.85 sec/issue → 10 stories = 8.5 sec). A single synchronous push of 200
 * items exceeds the 25-sec resolver timeout. asUser() е unavailable in async
 * consumers, so we CHUNK across multiple resolver calls:
 *   - startPushSession(breakdown, projectKey, customFields): project lookup +
 *     Epic create + persist а session in KVS. Returns sessionId.
 *   - pushSessionStep(sessionId): does ONE bounded chunk (≤ STORY/SUBTASK/LINK
 *     CHUNK issues) then returns progress. The UI loops это until { done: true }.
 * Each step stays well under 25 sec. Phases: stories → subtasks → links → done.
 * When no subtask type exists, tasks are embedded as checklists in Story
 * descriptions and the subtasks phase е skipped.
 *
 * Bulk API: max 50 issues per call per Atlassian REST API v3 docs (we chunk
 * smaller — 15 — for timeout safety). Issue links have no bulk variant;
 * parallel-batched calls (LINK_CONCURRENCY) within each link chunk.
 */

import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { renderTestCasesAdf, normAC } from './testcases.js';

const BULK_MAX = 50;
// Concurrency cap для parallel issueLink creation. 6 concurrent stays well
// below JIRA's rate limits while collapsing 30 sequential ~400ms calls (~12s)
// into ~5 batches (~2s). Tune down ako 429s appear on dense dependency graphs.
const LINK_CONCURRENCY = 6;

// Chunked-push session storage. Each pushSessionStep does ONE bounded chunk
// (≤ CHUNK issues per JIRA bulk call) so each resolver invocation stays well
// under the 25-sec Forge resolver timeout. The UI loops pushStep until done.
// Empirical: JIRA bulk create measured ~0.85 sec/issue → 15/chunk ≈ ~13 sec
// + cold-start margin, safely under 25 sec.
const PUSH_SESSION_PREFIX = 'push_session:';
const STORY_CHUNK = 15;
const SUBTASK_CHUNK = 15;
const LINK_CHUNK = 18; // links are individual but parallel-batched → faster

function newSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── ADF (Atlassian Document Format) builders ───────────────

function plainADF(text) {
  return {
    type: 'doc',
    version: 1,
    content: text
      ? [{ type: 'paragraph', content: [{ type: 'text', text: String(text) }] }]
      : [],
  };
}

function richADF({ userStory, description, acceptanceCriteria, sourceHeading, embeddedTasks, tcEntry = null }) {
  const content = [];

  if (userStory) {
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: userStory, marks: [{ type: 'em' }] }],
    });
  }

  if (description && description.trim()) {
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: description.trim() }],
    });
  }

  if (Array.isArray(acceptanceCriteria) && acceptanceCriteria.length > 0) {
    content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Acceptance Criteria' }],
    });
    content.push({
      type: 'bulletList',
      content: acceptanceCriteria.map((text) => ({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: String(text) }],
          },
        ],
      })),
    });
  }

  // Embedded task checklist — used когато the project has NO subtask issue type
  // (graceful fallback so the task breakdown isn't lost). Rendered as а plain
  // bulletList (same proven-safe ADF structure as the AC list above) с а ☐
  // prefix for checklist feel. NOT а taskList node — taskList е stricter to
  // validate, and ако rejected it would fail EVERY Story create (each carries
  // one); bulletList е bulletproof.
  const cleanTasks = Array.isArray(embeddedTasks)
    ? embeddedTasks.filter((t) => t && (t.summary || '').trim())
    : [];
  if (cleanTasks.length > 0) {
    content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Tasks' }],
    });
    content.push({
      type: 'bulletList',
      content: cleanTasks.map((task) => ({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text:
                  '☐ ' +
                  (task.type ? `${task.type}: ` : '') +
                  String(task.summary).trim(),
              },
            ],
          },
        ],
      })),
    });
    content.push({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text:
            'Note: this Jira project has no Subtask issue type, so the task breakdown is listed above as a checklist. To create these as separate Subtask issues, enable the Subtask type in project settings — or contact support@spec2jira.com for help.',
          marks: [{ type: 'em' }],
        },
      ],
    });
  }

  if (sourceHeading) {
    content.push({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Source: ', marks: [{ type: 'strong' }] },
        { type: 'text', text: String(sourceHeading) },
      ],
    });
  }

  // Embed compact test-case summary when available (P4). Passes coverage so the
  // summary paragraph shows "{covered}/{total} ACs covered". Wrapped in try/catch:
  // a render failure must never block the Story create (a test-case embed is bonus
  // content, not a required field — gotcha #11). renderTestCasesAdf returns [] when
  // absent, so the spread is always safe. ONLY safe ADF node types used (gotcha #11).
  if (
    tcEntry &&
    !tcEntry.error &&
    tcEntry.result &&
    Array.isArray(tcEntry.result.test_cases) &&
    tcEntry.result.test_cases.length > 0
  ) {
    try {
      content.push(...renderTestCasesAdf(tcEntry.result, tcEntry.coverage));
    } catch (e) {
      console.warn('[push] tc embed render failed (non-fatal, skipping):', String(e?.message || e));
    }
  }

  return { type: 'doc', version: 1, content };
}

// ── Breakdown flattening ───────────────────────────────────

/**
 * Flatten edited breakdown к work items за push.
 * Accepts both legacy-shaped (capabilities[].features[]) and v3 native shape.
 *
 * Returns: { epic, features, links }
 *   epic: {summary, description} | null
 *   features: [{ name, user_story, description, source_heading,
 *                acceptance_criteria, dependencies, tasks }]
 *   links: [{ source: <featureName>, target: <featureName> }]
 */
export function flattenBreakdown(breakdown) {
  if (!breakdown) return { epic: null, features: [], links: [] };

  const epic =
    breakdown.epic && (breakdown.epic.summary || breakdown.epic.description)
      ? {
          summary: breakdown.epic.summary || 'Spec Breakdown',
          description: breakdown.epic.description || '',
        }
      : null;

  // Features may live в capabilities[].features[] (legacy adapted) or directly
  // в features[] (v3 native, e.g., when reading от _v3_original).
  let features;
  if (Array.isArray(breakdown.capabilities)) {
    features = breakdown.capabilities.flatMap((c) => c.features || []);
  } else if (Array.isArray(breakdown.features)) {
    features = breakdown.features;
  } else {
    features = [];
  }

  // Build dependency edges. feature.dependencies[] contains names of features
  // that THIS feature depends на. JIRA semantics: outwardIssue blocks
  // inwardIssue. So if B depends on A: outwardIssue=A, inwardIssue=B.
  const links = [];
  for (const f of features) {
    const deps = f.dependencies || [];
    for (const depTarget of deps) {
      links.push({ source: depTarget, target: f.name });
    }
  }

  return { epic, features, links };
}

// ── JIRA REST helpers ──────────────────────────────────────

/**
 * Look up project by key. Verifies project exists + user has access; also
 * resolves the subtask issue type dynamically (naming-independent).
 * Returns { ok, project, subtaskTypeId, subtaskTypeName, issueTypesAvailable }
 * OR { ok: false, error, detail }. Fail fast before any creates.
 * Exported (diag Phase 5): runHealthCheck's 'jira_project' probe REUSES this
 * exact push preflight (project access + subtask type + SP/priority fields).
 */
export async function lookupProject(projectKey) {
  let response;
  try {
    // expand=issueTypes guarantees the issueTypes array е present (needed to
    // resolve the subtask type dynamically — see below).
    response = await api
      .asUser()
      .requestJira(route`/rest/api/3/project/${projectKey}?expand=issueTypes`);
  } catch (e) {
    return { ok: false, error: 'jira_fetch_failed', detail: String(e?.message || e) };
  }
  if (response.status === 404) {
    return {
      ok: false,
      error: 'project_not_found',
      detail: `Jira project "${projectKey}" does not exist OR you don't have access. Verify the project key in Settings.`,
    };
  }
  if (response.status === 403) {
    return {
      ok: false,
      error: 'permission_denied',
      detail: `You lack permission to view project "${projectKey}". Ask your Jira admin for project access.`,
    };
  }
  if (!response.ok) {
    const text = await response.text();
    console.error(`[push] project lookup HTTP ${response.status}: ${text.substring(0, 300)}`);
    return {
      ok: false,
      error: `jira_${response.status}`,
      detail: 'Jira returned an error. Check your project settings, or contact support@spec2jira.com.',
    };
  }
  const project = await response.json();

  // Resolve the subtask issue type DYNAMICALLY. Team-managed (next-gen)
  // projects name it "Subtask" (no hyphen); company-managed use "Sub-task";
  // localized instances use translated names. Match by the naming-independent
  // `subtask: true` flag instead of а hardcoded name (which caused 39/39
  // subtask failures on team-managed SCRUM-DEV 2026-05-30).
  // The Jira `Get project` endpoint returns `issueTypes` by default.
  const issueTypes = Array.isArray(project.issueTypes) ? project.issueTypes : [];
  const subtaskType = issueTypes.find((t) => t.subtask === true);

  // Resolve the Story Points custom field id DYNAMICALLY (gotcha #7 lesson —
  // never hardcode customfield ids; they vary per instance, and team-managed
  // projects name it "Story point estimate" vs company-managed "Story Points").
  // Graceful: if not found, SP simply isn't pushed.
  let storyPointsFieldId = null;
  try {
    const fr = await api.asUser().requestJira(route`/rest/api/3/field`);
    if (fr.ok) {
      const list = await fr.json();
      const all = Array.isArray(list) ? list : [];
      const sp =
        all.find((f) => f.custom && /^story points$/i.test(f.name || '')) ||
        all.find((f) => f.custom && /story point/i.test(f.name || ''));
      storyPointsFieldId = sp?.id || null;
    }
  } catch (_) {
    /* SP just won't be pushed — graceful */
  }

  // Resolve valid priority names so we only set a priority the project's scheme
  // accepts (an unknown name fails the create — we omit instead). Null = couldn't
  // resolve → best-effort (High/Medium/Low are near-universal).
  let validPriorities = null;
  try {
    const pr = await api.asUser().requestJira(route`/rest/api/3/priority`);
    if (pr.ok) {
      const prs = await pr.json();
      validPriorities = (Array.isArray(prs) ? prs : []).map((p) => p.name).filter(Boolean);
    }
  } catch (_) {
    /* priority best-effort — graceful */
  }

  return {
    ok: true,
    project,
    subtaskTypeId: subtaskType?.id || null,
    subtaskTypeName: subtaskType?.name || null,
    issueTypesAvailable: issueTypes.map((t) => `${t.name}${t.subtask ? '(sub)' : ''}`),
    storyPointsFieldId,
    validPriorities,
  };
}

/**
 * Create single issue (used for Epic). Returns { ok, issue } or { ok: false, error, detail }.
 */
async function createSingleIssue(payload) {
  let response;
  try {
    response = await api.asUser().requestJira(route`/rest/api/3/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, error: 'jira_fetch_failed', detail: String(e?.message || e) };
  }
  if (!response.ok) {
    const text = await response.text();
    console.error(`[push] single create HTTP ${response.status}: ${text.substring(0, 500)}`);
    return {
      ok: false,
      error: `jira_${response.status}`,
      detail: jiraErrorMessage(response.status, text),
    };
  }
  const issue = await response.json();
  return { ok: true, issue };
}

/**
 * Build a CLEAN, customer-facing message from a Jira error response body. Jira
 * returns { errorMessages: [...], errors: { fieldId: "reason", ... } }; we join
 * the general messages and the per-field reasons into one sentence and append a
 * hint about the most common cause (a project-required custom field). The raw
 * body is logged separately (console.error) — it never reaches the user.
 * Parses defensively: any malformed body falls back to a generic HTTP-status line.
 */
function jiraErrorMessage(status, rawText) {
  try {
    const body = JSON.parse(rawText);
    const reasons = [];
    if (Array.isArray(body?.errorMessages)) {
      for (const m of body.errorMessages) {
        const clean = String(m || '').trim();
        if (clean) reasons.push(clean);
      }
    }
    if (body?.errors && typeof body.errors === 'object') {
      for (const [field, msg] of Object.entries(body.errors)) {
        const clean = String(msg || '').trim();
        if (clean) reasons.push(`${field}: ${clean}`);
      }
    }
    if (reasons.length > 0) {
      return `Jira rejected this item: ${reasons.join('; ')}. If a required field is missing, add it under Advanced → Required custom fields in Settings (or set a default in Jira), then retry.`;
    }
  } catch (_) {
    /* not JSON — fall through to the generic line */
  }
  return `Jira rejected this item (HTTP ${status}).`;
}

/**
 * Bulk create issues. issuesArray е the array passed as "issueUpdates" body.
 * JIRA returns parallel "issues" and "errors" arrays — errors carry
 * failedElementNumber index pointing back к input position.
 *
 * Returns { issues: [{key, id} | null], errors: [...] }.
 * The issues array е guaranteed same length as input (null для failed elements).
 */
async function bulkCreateIssues(issuesArray) {
  if (issuesArray.length === 0) {
    return { issues: [], errors: [] };
  }

  let response;
  try {
    response = await api.asUser().requestJira(route`/rest/api/3/issue/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueUpdates: issuesArray }),
    });
  } catch (e) {
    // Total failure — treat all as failed. Log the raw cause; show a clean line.
    console.error(`[push] bulk create fetch threw: ${String(e?.message || e)}`);
    return {
      issues: new Array(issuesArray.length).fill(null),
      errors: [{ message: 'Could not reach Jira to create these items. Please try again in a moment; if it persists, contact support@spec2jira.com.' }],
    };
  }

  if (!response.ok) {
    const text = await response.text();
    // Log the raw Jira body (technical detail stays in the logs); surface a clean,
    // parsed customer message (raw HTTP bodies must never reach the success screen).
    // `status` is additive (diag Phase 2): the whole-call HTTP status would
    // otherwise be invisible to the ledger; the UI reads only `.message`.
    console.error(`[push] bulk create HTTP ${response.status}: ${text.substring(0, 300)}`);
    return {
      issues: new Array(issuesArray.length).fill(null),
      errors: [{ status: response.status, message: jiraErrorMessage(response.status, text) }],
    };
  }

  const data = await response.json();
  // Build output array of fixed length с null for any failed index
  const out = new Array(issuesArray.length).fill(null);
  const errors = [];

  // JIRA REST v3 returns successes in `issues` and failures в `errors` (с failedElementNumber).
  const failedIdx = new Set();
  for (const err of data.errors || []) {
    failedIdx.add(err.failedElementNumber);
    const elErr = err.elementErrors || {};
    errors.push({
      index: err.failedElementNumber,
      ...elErr,
      // Clean, customer-facing reason for the success screen (this 200-OK
      // per-element path is the common partial-failure case; raw body never shown).
      message: jiraErrorMessage(elErr.status || response.status, JSON.stringify(elErr)),
    });
  }
  // Order: successful results come в order skipping failed indices
  let successIdx = 0;
  for (let i = 0; i < issuesArray.length; i++) {
    if (failedIdx.has(i)) continue;
    const created = (data.issues || [])[successIdx];
    if (created) {
      out[i] = { key: created.key, id: created.id, self: created.self };
    }
    successIdx++;
  }

  return { issues: out, errors };
}

/**
 * Create issue link (Blocks). outwardKey blocks inwardKey.
 * Returns { ok } or { ok: false, error, detail }.
 */
async function createIssueLink(outwardKey, inwardKey) {
  let response;
  try {
    response = await api.asUser().requestJira(route`/rest/api/3/issueLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: { name: 'Blocks' },
        inwardIssue: { key: inwardKey },
        outwardIssue: { key: outwardKey },
      }),
    });
  } catch (e) {
    return { ok: false, error: 'fetch_failed', detail: String(e?.message || e) };
  }
  if (!response.ok && response.status !== 201) {
    const text = await response.text();
    console.error(`[push] issue link HTTP ${response.status}: ${text.substring(0, 300)}`);
    return {
      ok: false,
      error: `jira_${response.status}`,
      detail: 'Jira returned an error. Check your project settings, or contact support@spec2jira.com.',
    };
  }
  return { ok: true };
}

// ── Issue payload builders ─────────────────────────────────

// Merge optional admin-configured required custom fields into а payload's
// fields object. customFields е а plain object like { customfield_10042: {...} }.
// Applied LAST so it can satisfy project-required fields без overriding our
// core fields unless the admin deliberately keys the same field.
function applyCustomFields(fields, customFields) {
  if (customFields && typeof customFields === 'object') {
    Object.assign(fields, customFields);
  }
  return fields;
}

function buildEpicPayload(projectKey, epic, customFields) {
  const fields = {
    project: { key: projectKey },
    issuetype: { name: 'Epic' },
    summary: (epic.summary || 'Spec Breakdown').substring(0, 255),
    description: plainADF(epic.description || ''),
  };
  if (Array.isArray(epic.labels) && epic.labels.length > 0) {
    fields.labels = epic.labels;
  }
  return { fields: applyCustomFields(fields, customFields) };
}

// Map a model-suggested priority (High/Medium/Low) to a name the project's
// priority scheme accepts. validPriorities null = couldn't resolve → best-effort
// (return as-is; High/Medium/Low are near-universal). No match → null (omit, so a
// non-standard scheme never fails the create — the gotcha #7 discipline).
function matchPriority(suggested, validPriorities) {
  if (!suggested) return null;
  if (!Array.isArray(validPriorities)) return suggested;
  return validPriorities.find((p) => p.toLowerCase() === String(suggested).toLowerCase()) || null;
}

function buildStoryPayload(projectKey, feature, parentEpicKey, opts = {}) {
  const {
    embedTasks = false,
    customFields = null,
    storyPointsFieldId = null,
    validPriorities = null,
    tcEntry = null,
  } = opts;
  const fields = {
    project: { key: projectKey },
    issuetype: { name: 'Story' },
    summary: (feature.name || 'Story').substring(0, 255),
    description: richADF({
      userStory: feature.user_story,
      description: feature.description,
      acceptanceCriteria: feature.acceptance_criteria,
      sourceHeading: feature.source_heading,
      // Embed task checklist directly into the Story когато no subtask type.
      embeddedTasks: embedTasks ? feature.tasks || [] : null,
      tcEntry,
    }),
  };
  if (parentEpicKey) {
    fields.parent = { key: parentEpicKey };
  }
  // Suggested delivery priority → only set a name the project's scheme accepts.
  const priorityName = matchPriority(feature.priority, validPriorities);
  if (priorityName) {
    fields.priority = { name: priorityName };
  }
  // Suggested story points → the dynamically-resolved custom field (if found).
  if (storyPointsFieldId && typeof feature.story_points === 'number') {
    fields[storyPointsFieldId] = feature.story_points;
  }
  // Category label for JIRA filtering (v3.0.0 — single Epic + Story per category groups).
  // Category names с spaces → kebab-case labels (JIRA labels не allow spaces).
  // Labels = auto category label (single-dash kebab) + any reviewer-added labels.
  const labels = [];
  if (feature.category && feature.category.trim()) {
    const catLabel = feature.category
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (catLabel) labels.push(catLabel);
  }
  if (Array.isArray(feature.labels)) {
    for (const l of feature.labels) {
      const clean = String(l || '').trim();
      if (clean && !labels.includes(clean)) labels.push(clean);
    }
  }
  if (labels.length > 0) {
    fields.labels = labels;
  }
  return { fields: applyCustomFields(fields, customFields) };
}

function buildSubtaskPayload(projectKey, task, parentStoryKey, subtaskTypeId, customFields) {
  // Prefer the dynamically-resolved subtask type ID (naming-independent).
  // Fall back to name 'Sub-task' only ako lookup didn't surface а subtask type.
  const issuetype = subtaskTypeId ? { id: subtaskTypeId } : { name: 'Sub-task' };
  const fields = {
    project: { key: projectKey },
    issuetype,
    summary: (task.summary || 'Subtask').substring(0, 255),
    parent: { key: parentStoryKey },
  };
  // Push the task's generated description as an ADF document via the SAME
  // plainADF builder the Epic + the Story's description paragraph use (a single
  // text paragraph). The description ADDS implementation detail beyond the
  // summary (it is NOT a restatement — see SYSTEM_PROMPT rule 8). We prefix the
  // task type (API/UI/DB/etc.) so the Subtask still shows its category at a glance
  // in JIRA (subtasks have no native type field; this keeps the prior
  // categorisation while the body is now real detail, not a summary echo).
  // Surface-failures discipline: when the description is empty/whitespace/missing,
  // OMIT the field entirely rather than send an empty ADF or echo the summary.
  const description = (task.description || '').trim();
  if (description) {
    const typeLabel = task.type ? `${task.type}: ` : '';
    fields.description = plainADF(`${typeLabel}${description}`);
  }
  return { fields: applyCustomFields(fields, customFields) };
}

// ── Chunked push orchestrator (asUser; UI loops pushStep under 25-sec limit) ──

/**
 * Start a push session: validate, look up the project (resolving the subtask
 * type), create the Epic, persist a session in KVS. The UI then loops
 * pushSessionStep until done. asUser() works because this runs in a resolver
 * context (NOT an async event consumer — see AUTH_TYPE_UNAVAILABLE 2026-05-30).
 *
 * @param {object} breakdown
 * @param {string} projectKey
 * @param {object|null} customFields
 * @returns {Promise<{ok, sessionId?, phase?, epicKey?, totals?, error?, detail?}>}
 */
export async function startPushSession(breakdown, projectKey, customFields = null, jobId = null) {
  if (!breakdown) return { ok: false, error: 'no_breakdown', detail: 'No breakdown provided.' };
  if (!projectKey) return { ok: false, error: 'no_project_key', detail: 'No Jira project key.' };

  console.log(`[push] startPushSession project=${projectKey}`);

  const projectResult = await lookupProject(projectKey);
  if (!projectResult.ok) {
    console.warn(`[push] project lookup FAILED: ${projectResult.error} - ${projectResult.detail}`);
    return { ok: false, error: projectResult.error, detail: projectResult.detail };
  }
  const subtaskTypeId = projectResult.subtaskTypeId;
  const hasSubtasks = !!subtaskTypeId;
  console.log(
    `[push] project resolved: ${projectResult.project.name} (${projectResult.project.id}) | subtaskType=${projectResult.subtaskTypeName || 'NOT FOUND'} (id=${subtaskTypeId || 'none'}) | types=[${(projectResult.issueTypesAvailable || []).join(', ')}]`,
  );
  if (!hasSubtasks) {
    console.warn(`[push] No subtask type in ${projectKey} - tasks embedded as checklists.`);
  }
  console.log(
    `[push] story-points field=${projectResult.storyPointsFieldId || 'NOT FOUND'} | priorities=[${(projectResult.validPriorities || []).join(', ') || 'unresolved'}]`,
  );

  const { epic, features, links } = flattenBreakdown(breakdown);

  // Read the test-case job record (fail-open: a missing/failed tcjob → no embed,
  // which is the pre-P4 behaviour; never block push on a test-case absence).
  // Build a compact hash map (C2 audit): {[storyIdx]: acSetHash} instead of the
  // full stampedStories array (~40 KB). The map's presence gates the embed.
  let tcHashToIdx = null;
  let tcTotal = 0;
  if (jobId) {
    try {
      const tcJob = await kvs.get(`tcjob:${jobId}`);
      if (tcJob && tcJob.status === 'completed' && Array.isArray(tcJob.stampedStories)) {
        // ⭐ Key by AC-content HASH → the generation storyIdx, so the push MATCHES each pushed
        // feature to its test cases by CONTENT, not by position. The push order (flattenBreakdown
        // — capability-grouped from the edited breakdown) differs from the generation order
        // (job.breakdown.features, flat); position-keying embedded only the coincidentally-first
        // story (live-smoke bug 2026-06-06). The hash lookup is ALSO the staleness check.
        // Collision guard (deep-audit 2026-06-06): two stories with the SAME AC set — including
        // MULTIPLE no-AC stories, which all hash the empty set — would otherwise collapse to one
        // idx (last writer wins) → the WRONG story's cases embed on a Jira Story (silent
        // mis-attribution, the exact failure this feature prevents). A genuinely ambiguous hash is
        // DROPPED → those features get no embed (counted as tc_skipped — honest) instead of a wrong
        // embed. A SINGLE no-AC story has a unique (empty-set) hash → still embeds correctly (no
        // regression). The real long-term fix is a stable story_uid minted at generation.
        tcHashToIdx = {};
        const tcHashSeen = new Set();
        const tcHashCollided = new Set();
        for (const st of tcJob.stampedStories) {
          if (st && typeof st.idx === 'number') {
            const h = acSetHash(st.acceptance_criteria);
            if (tcHashSeen.has(h)) tcHashCollided.add(h);
            else tcHashSeen.add(h);
            tcHashToIdx[h] = st.idx;
          }
        }
        for (const h of tcHashCollided) delete tcHashToIdx[h];
        tcTotal = typeof tcJob.total === 'number' ? tcJob.total : tcJob.stampedStories.length;
      }
    } catch (e) {
      console.warn(`[push] tcjob read failed (non-fatal, no embed): ${String(e?.message || e)}`);
    }
  }

  // Create the Epic (one fast call) up front.
  let epicKey = null;
  // Site base URL for browse deep-links on the success screen. NOT derivable
  // from a create-response `self` (that is the api.atlassian.com/ex/jira proxy
  // host, which 404s in a browser); serverInfo.baseUrl is the real site URL.
  let browseBase = null;
  try {
    const si = await api.asUser().requestJira(route`/rest/api/3/serverInfo`);
    if (si.ok) browseBase = (await si.json()).baseUrl || null;
  } catch (_) {
    /* deep-links fall back to a site-relative path in the UI */
  }
  if (epic) {
    const r = await createSingleIssue(buildEpicPayload(projectKey, epic, customFields));
    if (!r.ok) {
      console.warn(`[push] Epic create FAILED: ${r.error}`);
      return { ok: false, error: r.error, detail: `Failed to create Epic "${epic.summary}": ${r.detail}` };
    }
    epicKey = r.issue.key;
    console.log(`[push] Epic created: ${epicKey}`);
  }

  let totalTasks = 0;
  for (const f of features) {
    totalTasks += (f.tasks || []).filter((t) => t && (t.summary || '').trim()).length;
  }

  const sessionId = newSessionId();
  const session = {
    sessionId,
    projectKey,
    projectName: projectResult.project.name,
    customFields,
    subtaskTypeId,
    hasSubtasks,
    storyPointsFieldId: projectResult.storyPointsFieldId || null,
    validPriorities: projectResult.validPriorities || null,
    epicKey,
    browseBase,
    features,
    links,
    storyKeyMap: {},
    createdStories: [],
    phase: features.length > 0 ? 'stories' : links.length > 0 ? 'links' : 'done',
    cursor: 0,
    counts: {
      stories_created: 0, story_failures: 0,
      subtasks_created: 0, subtask_failures: 0,
      subtasks_orphaned: 0, // parent Story failed → its subtasks skipped (recomputed in buildFlatTasks)
      links_created: 0, link_failures: 0,
      tasks_embedded: 0,
      tc_embedded: 0, tc_skipped: 0,
    },
    totals: { stories: features.length, tasks: totalTasks, links: links.length },
    failureDetails: { stories: [], subtasks: [], links: [] },
    // Diagnostic accumulation (ledger Phase 2) — identifiers/counts only; the
    // pushStep resolver turns result.diag into the ONE coalesced ledger record.
    diag: newPushDiag(),
    // Test-case embed metadata (P4). jobId null → no embed; tcHashToIdx null → no embed.
    // tcHashToIdx maps AC-content hash → generation storyIdx, so each pushed feature finds its
    // cases by CONTENT (the push order differs from the generation order); presence gates the embed.
    jobId: jobId || null,
    tcHashToIdx,
    tcTotal,
  };
  await kvs.set(PUSH_SESSION_PREFIX + sessionId, session);

  return {
    ok: true,
    sessionId,
    phase: session.phase,
    epicKey,
    totals: session.totals,
    progress: 0,
  };
}

/**
 * Advance a push session by ONE bounded chunk. The UI calls this repeatedly
 * until { done: true }. Each call does at most one JIRA bulk batch (≤ CHUNK
 * issues) so it stays under the 25-sec resolver timeout.
 */
export async function pushSessionStep(sessionId) {
  if (!sessionId) return { ok: false, error: 'no_session', detail: 'No session id.' };
  const key = PUSH_SESSION_PREFIX + sessionId;
  const s = await kvs.get(key);
  if (!s) {
    return { ok: false, error: 'session_not_found', detail: 'Push session expired or not found. Restart the push.' };
  }

  if (s.phase === 'done') {
    const r = buildFinalResult(s);
    try { await kvs.delete(key); } catch (_) {}
    // job_id rides every session-loaded return (diag Phase 2, additive) so the
    // pushStep resolver can stamp the ledger record's ref without re-reading
    // the session — which is already deleted by the time `done` returns.
    return { ok: true, done: true, phase: 'done', progress: 1, job_id: s.jobId || null, ...r };
  }

  try {
    if (s.phase === 'stories') await stepStories(s);
    else if (s.phase === 'subtasks') await stepSubtasks(s);
    else if (s.phase === 'links') await stepLinks(s);
  } catch (e) {
    console.error(`[push] step exception (phase=${s.phase}): ${String(e?.message || e)} ref=${s.jobId || '-'}`);
    return { ok: false, error: 'step_exception', detail: String(e?.message || e), job_id: s.jobId || null };
  }

  if (s.phase === 'done') {
    const r = buildFinalResult(s);
    try { await kvs.delete(key); } catch (_) {}
    // job_id rides every session-loaded return (diag Phase 2, additive) so the
    // pushStep resolver can stamp the ledger record's ref without re-reading
    // the session — which is already deleted by the time `done` returns.
    return { ok: true, done: true, phase: 'done', progress: 1, job_id: s.jobId || null, ...r };
  }

  await kvs.set(key, s);
  return {
    ok: true,
    done: false,
    phase: s.phase,
    progress: computeProgress(s),
    counts: s.counts,
  };
}

// ── AC-set hash (P4 audit C2) ─────────────────────────────────────────────────
// Replaces the full tcStampedStories array (up to ~40 KB of raw AC text) with a
// compact hash map. Zero external dependencies — the Forge sandbox has no crypto.
// djb2 over the sorted, normalised AC set is collision-resistant enough for a
// staleness fingerprint (same as normAC, order-insensitive).

/**
 * Compute a compact djb2 hash of an AC set. Normalises via normAC, sorts
 * (order-insensitive), joins with '|', then hashes. Returns a base-36 string.
 * @param {string[]} acs acceptance_criteria array (may be null/undefined)
 * @returns {string}
 */
function acSetHash(acs) {
  const s = (Array.isArray(acs) ? acs : []).map(normAC).sort().join('|');
  let h = 5381;
  for (const ch of s) h = ((((h << 5) + h) ^ ch.charCodeAt(0)) >>> 0); // djb2-xor: (h*33) ^ c
  return h.toString(36);
}

// ── Diagnostic accumulation (ledger Phase 2) ──────────────────────────────────
// Plain-DATA accumulators on the push session. NO recordDiagnostic here —
// push_handler has no resolver context; the index.js resolvers own the ledger
// writes and consume result.diag (SOLID split, design §2.9/§4). Everything
// below is identifiers/counts only — names/messages stay in failureDetails
// (the UI/zone-2 surface), never in this struct.

function newPushDiag() {
  return {
    jira: [], // [{status, field_names}] from bulk per-element errors — deduped, cap 5
    failedStoryIdxs: [], // GLOBAL feature indices of failed Stories, cap 20
    failedSubtaskFeatureIdxs: [], // parent feature idx per failed subtask — deduped, cap 20
    failedKeys: [], // Jira issue keys connected to failures — key-shape only, deduped, cap 20
    links_unresolved_story_failed: 0, // preflight: endpoint is a real feature whose Story failed
    links_unresolved_name_unknown: 0, // preflight: endpoint name matches NO feature (model paraphrase)
    links_api_failed: 0, // link-create API failures — distinct from preflight-unresolved
  };
}

// An in-flight session written by a PRE-deploy startPushSession has no s.diag —
// default it lazily so a deploy mid-push can never crash a step.
function ensureDiag(s) {
  if (!s.diag) s.diag = newPushDiag();
  return s.diag;
}

// Jira issue-key shape (the ledger validates the same way; pre-filter here so
// only durable, key-shaped handles accumulate — never a name).
const ISSUE_KEY_SHAPE = /^[A-Z][A-Z0-9_]*-\d+$/;

function diagAddFailedKey(s, key) {
  const diag = ensureDiag(s);
  if (typeof key !== 'string' || !ISSUE_KEY_SHAPE.test(key)) return;
  if (diag.failedKeys.includes(key) || diag.failedKeys.length >= 20) return;
  diag.failedKeys.push(key);
}

// Accumulate content-free Jira failure signatures from bulk per-element errors:
// HTTP status + rejected field KEYS only (the same Object.keys(...errors) safe
// pattern as the subtask-failure console.warn below) — NEVER message text
// (ledger §1 privacy wall). Covers both element shapes: the nested
// {elementErrors:{errors,status}} that console.warn reads AND the spread shape
// bulkCreateIssues actually builds ({...elementErrors} lifts errors/status to
// the top level). Deduped by (status + sorted field names) — one push usually
// fails for ONE repeated cause — cap 5.
function diagAddJiraErrors(s, batchErrors) {
  const diag = ensureDiag(s);
  if (!Array.isArray(batchErrors)) return;
  const sigOf = (status, names) => `${status}|${names.slice().sort().join(',')}`;
  for (const be of batchErrors) {
    if (!be || typeof be !== 'object') continue;
    const fieldNames = Object.keys(be?.elementErrors?.errors || be?.errors || {}).slice(0, 20);
    const rawStatus = be?.status ?? be?.elementErrors?.status;
    const status = Number.isInteger(rawStatus) ? rawStatus : null;
    if (status === null && fieldNames.length === 0) continue; // nothing diagnostic to keep
    const sig = sigOf(status, fieldNames);
    if (diag.jira.some((e) => sigOf(Number.isInteger(e.status) ? e.status : null, e.field_names || []) === sig)) continue;
    const entry = {};
    if (status !== null) entry.status = status;
    if (fieldNames.length > 0) entry.field_names = fieldNames;
    if (diag.jira.length < 5) {
      diag.jira.push(entry);
    } else {
      // (deep-audit P2 #4) cap eviction policy: first-5-wins used to DROP a later
      // UNSEEN status — e.g. a mid-push 401 (auth revoked, the decisive evidence)
      // after five 400-variants. When full and the incoming STATUS is new, replace
      // the LAST entry whose status is already represented more than once; else
      // the last entry. A new shape of an already-seen status still drops (the
      // status signal is what support routes on).
      const seenStatus = new Set(diag.jira.map((e) => e.status));
      if (status !== null && !seenStatus.has(status)) {
        let victim = diag.jira.length - 1;
        const statusCounts = {};
        for (const e of diag.jira) statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;
        for (let i = diag.jira.length - 1; i >= 0; i--) {
          if (statusCounts[diag.jira[i].status] > 1) { victim = i; break; }
        }
        diag.jira[victim] = entry;
      }
    }
  }
}

async function stepStories(s) {
  const start = s.cursor;
  const end = Math.min(start + STORY_CHUNK, s.features.length);
  const slice = s.features.slice(start, end);

  // Fetch per-story test-case entries in parallel when the tc hash map is present.
  // Each entry lives at testcases:<jobId>:<globalIdx> (global index = start + j).
  // Fail-open: a KVS read error → null → no embed for that story (never blocks push).
  // ⭐ Match each pushed feature to its test cases by AC-CONTENT, not position. The push order
  // (flattenBreakdown — capability-grouped from the edited breakdown) differs from the generation
  // order (job.breakdown.features, flat), so position-keying mis-aligned all but the first story.
  // Look up the generation storyIdx by the feature's AC-hash; the lookup IS the staleness check
  // (a feature whose ACs match no generated story → no idx → no embed). Fail-open on KVS error.
  let tcEntries = null;
  if (s.jobId && s.tcHashToIdx) {
    try {
      tcEntries = await Promise.all(
        slice.map((f) => {
          const idx = s.tcHashToIdx[acSetHash(f && f.acceptance_criteria)];
          return idx != null ? kvs.get(`testcases:${s.jobId}:${idx}`).catch(() => null) : Promise.resolve(null);
        }),
      );
    } catch (e) {
      console.warn(`[push] tc entries fetch failed (non-fatal, no embed): ${String(e?.message || e)}`);
      tcEntries = null;
    }
  }

  const tcEmbeddedIdx = new Set(); // slice idxs whose payload carries a tc embed (counted on SUCCESS below)
  const payloads = slice.map((f, j) => {
    // The content-match above bound the right entry (or null when the feature's ACs match no
    // generated story → edited/new → correctly no embed). tc_skipped is computed at the end
    // (tcTotal − tc_embedded) so it reflects generated stories that did not land an embed.
    let tcEntry = null;
    const tcCand = tcEntries && tcEntries[j];
    // Embed only when the entry actually has cases — a valid-but-empty entry would
    // embed nothing. The tc_embedded COUNT moves to the bulk SUCCESS branch below
    // (deep-audit P2 #3): counting at payload-BUILD measured INTENT, not OUTCOME —
    // a story whose create then failed kept its increment, so the partial_push
    // record + PushedScreen over-reported embeds exactly when stories failed.
    if (tcCand && !tcCand.error && tcCand.result && Array.isArray(tcCand.result.test_cases) && tcCand.result.test_cases.length > 0) {
      tcEntry = tcCand;
      tcEmbeddedIdx.add(j);
    }
    return buildStoryPayload(s.projectKey, f, s.epicKey, {
      embedTasks: !s.hasSubtasks,
      customFields: s.customFields,
      storyPointsFieldId: s.storyPointsFieldId,
      validPriorities: s.validPriorities,
      tcEntry,
    });
  });
  const bulk = await bulkCreateIssues(payloads);
  for (let j = 0; j < bulk.issues.length; j++) {
    if (bulk.issues[j]) {
      s.storyKeyMap[slice[j].name] = bulk.issues[j].key;
      // Append-only list (preserves duplicate-named stories, unlike the
      // name-keyed storyKeyMap) so the success screen can deep-link every
      // created Story, not just the last one per name.
      s.createdStories.push({ name: slice[j].name, key: bulk.issues[j].key });
      s.counts.stories_created++;
      // tc_embedded counts OUTCOME (the embed actually landed in a created
      // Story), not intent — see the payload-build note above.
      if (tcEmbeddedIdx.has(j)) s.counts.tc_embedded++;
    } else {
      s.counts.story_failures++;
      // (diag Phase 2) capture the GLOBAL feature index at the source — the
      // failureDetails struct carries names only, which the ledger bans (§1).
      const diag = ensureDiag(s);
      if (diag.failedStoryIdxs.length < 20) diag.failedStoryIdxs.push(start + j);
      if (s.failureDetails.stories.length < 10) {
        // (deep-audit P2 #7) pair THIS story with ITS per-element error where one
        // exists — batchError used to carry the whole chunk's array, so story #2's
        // zone-2 line showed story #1's verbatim reason in multi-cause chunks.
        const own = Array.isArray(bulk.errors) ? bulk.errors.find((e) => e && e.index === j) : null;
        s.failureDetails.stories.push({ name: slice[j].name, batchError: own ? [own] : bulk.errors });
      }
    }
  }
  if (Array.isArray(bulk.errors) && bulk.errors.length > 0) diagAddJiraErrors(s, bulk.errors);
  s.cursor = end;
  console.log(`[push] stories chunk ${start}-${end}/${s.features.length}: ${s.counts.stories_created} ok, ${s.counts.story_failures} failed`);

  if (s.cursor >= s.features.length) {
    s.cursor = 0;
    if (s.hasSubtasks && buildFlatTasks(s).length > 0) {
      s.phase = 'subtasks';
    } else {
      if (!s.hasSubtasks) {
        for (const f of s.features) {
          if (s.storyKeyMap[f.name]) {
            s.counts.tasks_embedded += (f.tasks || []).filter((t) => t && (t.summary || '').trim()).length;
          }
        }
      }
      s.phase = s.links.length > 0 ? 'links' : 'done';
    }
  }
}

function buildFlatTasks(s) {
  const flat = [];
  let orphaned = 0;
  for (let fi = 0; fi < s.features.length; fi++) {
    const f = s.features[fi];
    const parentKey = s.storyKeyMap[f.name];
    if (!parentKey) {
      // (diag Phase 2) the parent Story failed to create → its subtasks are
      // skipped here. Previously a silent drop with zero trace (§2.3 worst
      // offender #4). Orphans only exist when a Story failed, so `partial` is
      // already true in every orphan scenario — counting changes NO behaviour.
      orphaned += (f.tasks || []).filter((t) => t && (t.summary || '').trim()).length;
      continue;
    }
    for (const task of f.tasks || []) {
      if (!task || !(task.summary || '').trim()) continue;
      // featureIdx threads the parent feature's GLOBAL index to the failure
      // branch (the ledger speaks idxs/keys, never names).
      flat.push({ task, parentKey, featureName: f.name, featureIdx: fi });
    }
  }
  // SET, never += — buildFlatTasks is recomputed fresh on EVERY subtasks step
  // (and at the stories→subtasks transition), so incrementing would multiply
  // the count across steps. storyKeyMap is frozen once the stories phase ends,
  // so the recomputed value is stable → the set is idempotent.
  s.counts.subtasks_orphaned = orphaned;
  return flat;
}

async function stepSubtasks(s) {
  const flat = buildFlatTasks(s);
  const start = s.cursor;
  const end = Math.min(start + SUBTASK_CHUNK, flat.length);
  const slice = flat.slice(start, end);
  const payloads = slice.map((x) =>
    buildSubtaskPayload(s.projectKey, x.task, x.parentKey, s.subtaskTypeId, s.customFields),
  );
  const bulk = await bulkCreateIssues(payloads);
  for (let j = 0; j < bulk.issues.length; j++) {
    if (bulk.issues[j]) s.counts.subtasks_created++;
    else {
      s.counts.subtask_failures++;
      // (diag Phase 2) durable handles at the source: the parent feature's
      // global idx (threaded via buildFlatTasks) + the parent Story's Jira key
      // (survives purge — design §4 capture corrections).
      const diag = ensureDiag(s);
      const fi = slice[j].featureIdx;
      if (
        Number.isInteger(fi) &&
        diag.failedSubtaskFeatureIdxs.length < 20 &&
        !diag.failedSubtaskFeatureIdxs.includes(fi)
      ) {
        diag.failedSubtaskFeatureIdxs.push(fi);
      }
      diagAddFailedKey(s, slice[j].parentKey);
      if (s.failureDetails.subtasks.length < 10) {
        // (deep-audit P2 #7) same per-element pairing as the stories capture.
        const own = Array.isArray(bulk.errors) ? bulk.errors.find((e) => e && e.index === j) : null;
        s.failureDetails.subtasks.push({
          parentFeature: slice[j].featureName,
          taskSummary: slice[j].task.summary,
          batchError: own ? [own] : bulk.errors,
        });
      }
    }
  }
  if (Array.isArray(bulk.errors) && bulk.errors.length > 0) diagAddJiraErrors(s, bulk.errors);
  s.cursor = end;
  console.log(`[push] subtasks chunk ${start}-${end}/${flat.length}: ${s.counts.subtasks_created} ok, ${s.counts.subtask_failures} failed`);
  if (s.counts.subtask_failures > 0 && s.failureDetails.subtasks[0]) {
    const je = s.failureDetails.subtasks[0]?.batchError?.[0];
    const fields = Object.keys(je?.elementErrors?.errors || {});
    console.warn(`[push] subtask failure — Jira status ${je?.status ?? 'unknown'}; messages: ${JSON.stringify(je?.elementErrors?.errorMessages || []).substring(0, 200)}; fields: ${fields.join(',')}`);
  }
  if (s.cursor >= flat.length) {
    s.cursor = 0;
    s.phase = s.links.length > 0 ? 'links' : 'done';
  }
}

function buildResolvableLinks(s) {
  const resolvable = [];
  const unresolved = [];
  for (const { source, target } of s.links) {
    const sourceKey = s.storyKeyMap[source];
    const targetKey = s.storyKeyMap[target];
    if (!sourceKey || !targetKey) {
      unresolved.push({
        source, target,
        reason: !sourceKey ? `source "${source}" not created` : `target "${target}" not created`,
      });
      continue;
    }
    resolvable.push({ source, target, sourceKey, targetKey });
  }
  return { resolvable, unresolved };
}

async function stepLinks(s) {
  const { resolvable, unresolved } = buildResolvableLinks(s);
  const diag = ensureDiag(s);
  // Account unresolved links once, at the start of the link phase.
  if (s.cursor === 0 && unresolved.length > 0) {
    s.counts.link_failures += unresolved.length;
    // (diag Phase 2) deterministic cause-split. A missing endpoint whose name
    // IS a real feature → that Story failed to create (cascade); a name that
    // matches NO feature → the model paraphrased the dependency (the S1 class
    // behind the misleading "not created" reason). SET (=), not += — a
    // step_exception retry re-enters with cursor 0 and must not double-count.
    const featureNames = new Set(s.features.map((f) => f && f.name));
    let storyFailed = 0;
    let nameUnknown = 0;
    for (const u of unresolved) {
      const missing = [u.source, u.target].filter((n) => !s.storyKeyMap[n]);
      if (missing.some((n) => !featureNames.has(n))) nameUnknown++;
      else storyFailed++;
      // The endpoint that DID create is a durable support anchor (key-shaped only).
      if (s.storyKeyMap[u.source]) diagAddFailedKey(s, s.storyKeyMap[u.source]);
      if (s.storyKeyMap[u.target]) diagAddFailedKey(s, s.storyKeyMap[u.target]);
      if (s.failureDetails.links.length < 10) s.failureDetails.links.push(u);
    }
    diag.links_unresolved_story_failed = storyFailed;
    diag.links_unresolved_name_unknown = nameUnknown;
    // (A2 fix, half 1) preflight unresolved are logged ONCE here — they are not
    // chunk API outcomes, so they no longer inflate the chunk log below.
    console.log(`[push] links preflight: ${unresolved.length} unresolved (story_failed=${storyFailed}, name_unknown=${nameUnknown}) ref=${s.jobId || '-'}`);
  }
  const start = s.cursor;
  const end = Math.min(start + LINK_CHUNK, resolvable.length);
  const slice = resolvable.slice(start, end);
  for (let i = 0; i < slice.length; i += LINK_CONCURRENCY) {
    const batch = slice.slice(i, i + LINK_CONCURRENCY);
    const results = await Promise.all(batch.map((l) => createIssueLink(l.sourceKey, l.targetKey)));
    for (let j = 0; j < results.length; j++) {
      if (results[j].ok) s.counts.links_created++;
      else {
        s.counts.link_failures++;
        // (diag Phase 2 + A2) chunk-level API failure — tracked separately from
        // the preflight unresolved so the chunk log reconciles. link_failures
        // (the UI total) keeps its semantics: preflight + API combined.
        diag.links_api_failed++;
        diagAddFailedKey(s, batch[j].sourceKey);
        diagAddFailedKey(s, batch[j].targetKey);
        if (s.failureDetails.links.length < 10) {
          s.failureDetails.links.push({
            source: batch[j].source, target: batch[j].target,
            error: results[j].error, detail: results[j].detail,
          });
        }
      }
    }
  }
  s.cursor = end;
  // (A2 fix, half 2) count only chunk-level API failures against the resolvable
  // denominator — link_failures was pre-inflated by preflight unresolved, so
  // "ok + failed" never reconciled with the chunk size (the one debug log lied).
  console.log(`[push] links chunk ${start}-${end}/${resolvable.length}: ${s.counts.links_created} ok, ${diag.links_api_failed} failed`);
  if (s.cursor >= resolvable.length) {
    s.phase = 'done';
  }
}

function computeProgress(s) {
  const t = s.totals || {};
  const totalWork = (t.stories || 0) + (s.hasSubtasks ? t.tasks || 0 : 0) + (t.links || 0);
  if (totalWork === 0) return 1;
  const c = s.counts;
  const done =
    c.stories_created + c.story_failures +
    c.subtasks_created + c.subtask_failures +
    c.links_created + c.link_failures;
  return Math.max(0, Math.min(0.99, done / totalWork));
}

function buildFinalResult(s) {
  const c = s.counts;
  const diag = ensureDiag(s);
  const allSuccess = c.story_failures === 0 && c.subtask_failures === 0 && c.link_failures === 0;
  // tc_skipped = generated stories that did not land an embed (ACs edited since generation, or a
  // story dropped from the push). Computed from the total (content-match makes a per-story skip
  // count ambiguous). 0 on a clean push where every generated story was pushed unchanged.
  const tcSkipped = Math.max(0, (s.tcTotal || 0) - c.tc_embedded);
  console.log(`[push] DONE session=${s.sessionId} - stories=${c.stories_created} subtasks=${c.subtasks_created} links=${c.links_created} embedded=${c.tasks_embedded} tc_embedded=${c.tc_embedded} tc_skipped=${tcSkipped} (partial=${!allSuccess}) ref=${s.jobId || '-'}`);
  return {
    partial: !allSuccess,
    result: {
      project_key: s.projectKey,
      project_name: s.projectName,
      total_epics: s.epicKey ? 1 : 0,
      total_stories: c.stories_created,
      total_subtasks: c.subtasks_created,
      total_items: (s.epicKey ? 1 : 0) + c.stories_created + c.subtasks_created,
      dependency_links_created: c.links_created,
      subtasks_embedded: !s.hasSubtasks,
      tasks_embedded: c.tasks_embedded,
      tc_embedded: c.tc_embedded,
      tc_skipped: tcSkipped,
      epic_key: s.epicKey,
      browse_base: s.browseBase || null,
      created_issues: s.createdStories || [],
      failures: {
        stories: c.story_failures,
        subtasks: c.subtask_failures,
        links: c.link_failures,
        details: s.failureDetails,
      },
      // (diag Phase 2) plain diagnostic material for the ledger — the pushStep
      // resolver (which owns `context`) turns this into the ONE coalesced
      // recordDiagnostic per push (design §4). ADDITIVE: every pre-existing
      // field above is unchanged — the UI reads them verbatim.
      diag: {
        jira: diag.jira,
        failedStoryIdxs: diag.failedStoryIdxs,
        failedSubtaskFeatureIdxs: diag.failedSubtaskFeatureIdxs,
        failedKeys: diag.failedKeys,
        links_unresolved_story_failed: diag.links_unresolved_story_failed || 0,
        links_unresolved_name_unknown: diag.links_unresolved_name_unknown || 0,
        links_api_failed: diag.links_api_failed || 0,
        subtasks_orphaned: c.subtasks_orphaned || 0,
      },
    },
  };
}
