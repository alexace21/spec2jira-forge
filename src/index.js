/**
 * Spec2Tickets v3.0.0 — Forge resolver entry point.
 *
 * Architecture (post-pivot 2026-05-28):
 *   - BYOK: customer's Anthropic API key stored in Forge KVS secret storage
 *   - Direct asUser() to Confluence (page content fetch) — no backend roundtrip
 *   - Anthropic Message Batches API for generation (startGeneration submits,
 *     pollJobStatus polls) — async event consumers retired (55s timeout)
 *   - Chunked asUser() JIRA push (startPush + UI-looped pushStep) — SHIPPED
 *
 * v2.x → v3.0.0 resolver changes:
 *   PRESERVED (Forge-native, no backend dependency):
 *     - searchPages, getRecentPages, getLastSelectedPage, recordPageSelection
 *     - setPendingDeepLink, consumePendingDeepLink
 *
 *   REWRITTEN:
 *     - getSettings, saveSettings, resetSettings (BYOK API key model)
 *     - testConnection (calls Anthropic /v1/messages with minimal payload)
 *     - fetchPage (direct asUser() to Confluence; no backend roundtrip)
 *     - startGeneration (enqueues async event, returns jobId)
 *     - pollJobStatus, getResults (read KVS by jobId)
 *
 *   REMOVED:
 *     - startPreview (v3.0.0 single Anthropic call IS the breakdown)
 *     - healthCheck (no backend к probe)
 *
 *   JIRA push (Step 8 — chunked asUser() resolver; 2026-05-30):
 *     - startPush (lookup + Epic + KVS session) → pushStep, looped by the UI,
 *       one bounded chunk per call (stays under the 25s resolver timeout).
 *       No executePush/pushToJira; no queue (asUser() unavailable in consumers).
 */

import Resolver from '@forge/resolver';
import { kvs } from '@forge/kvs';
import api, { route } from '@forge/api';

import {
  setStoredApiKey,
  clearStoredApiKey,
  getStoredApiKey,
  testConnection as anthropicTestConnection,
  submitBreakdownBatch,
  pollBatchStatus,
  fetchBatchResults,
  estimateCost,
  resolveDependencyCycle,
  distillCategory,
  trimToBudget,
  DISTILL_CATEGORIES,
  DISTILL_MAX_INPUT_CHARS,
  MODEL_PRIMARY,
  MODEL_FALLBACK,
  submitTestCaseBatch,
  pollTestCaseBatch,
  fetchTestCaseResults,
} from './anthropic_client.js';
import { startPushSession, pushSessionStep, flattenBreakdown } from './push_handler.js';
import { detectCycles } from './graph.js';
import { renderGherkin, renderManualTable, parseTestCaseResult, normAC } from './testcases.js';
import {
  TIERS,
  checkQuota,
  consumeQuota,
  recordFirstSeen,
  formatResetDate,
  pricingTable,
  getActiveTier,
} from './usage.js';

// ── Managed-vs-BYOK Anthropic key resolution (hybrid tiers, 2026-06-03) ──
// Managed Pro (Advanced edition) ⇒ WE call Anthropic with OUR key, stored as an
// ENCRYPTED Forge env var (`forge variables set --encrypt MANAGED_ANTHROPIC_KEY ...`).
// BYOK Pro ⇒ the customer's own stored key. An Anthropic batch is bound to
// the key that created it, so the SOURCE ('managed'|'byok') is recorded on the job
// at submit and reused at poll — never re-resolved from a license that may have
// changed (e.g. a trial expiring) mid-batch.
async function anthropicKeyForSource(source) {
  if (source === 'managed') return process.env.MANAGED_ANTHROPIC_KEY || null;
  return getStoredApiKey();
}

/**
 * Resolve { apiKey, keySource, tier } for THIS invocation from the license.
 * keySource is purely tier-driven: Advanced edition (Managed Pro) ⇒ our key,
 * everything else ⇒ the customer's BYOK key. The license is backend-trusted, and
 * every accessing user is now licensed (the in-app Free / guest-access path was
 * removed 2026-06-03), so the old best-effort guest-guard on the spoofable
 * client-supplied accountType is gone — Managed exposure is bounded by the
 * backend-trusted per-user accountId cap (MANAGED_USER_CAP) in checkQuota.
 */
async function resolveAnthropicKey(context) {
  const tier = getActiveTier(context);
  const keySource = tier.edition === 'advanced' ? 'managed' : 'byok';
  const apiKey = await anthropicKeyForSource(keySource);
  return { apiKey, keySource, tier };
}

/**
 * Managed-Pro fair-use cap payload. The cap is fair-use (we pay compute), so the
 * user is routed to BYOK (unlimited with their own key) or to higher-volume
 * Managed access — NOT "subscribe to a higher tier". This is the ONLY
 * quota_exceeded case now (the in-app Free 3/mo tier was removed 2026-06-03;
 * BYOK is unlimited and never hits this; Unlicensed is handled by license_required).
 */
function buildQuotaExceeded(quota) {
  return {
    error: 'quota_exceeded',
    tier: quota.tier,
    tierLabel: quota.tierLabel,
    used: quota.used,
    limit: quota.limit,
    resetsAt: quota.resetsAt,
    resetsAtLabel: quota.resetsAtLabel,
    pricing: pricingTable(),
    fairUse: true,
    detail: `You've used all ${quota.limit} breakdowns included this month on ${quota.tierLabel} — they reset ${quota.resetsAtLabel}. Need more this month? Contact us at support@spec2jira.com about higher-volume Managed access, or switch to BYOK Pro (use your own Anthropic key) for unlimited right away.`,
  };
}

/**
 * Defensive license_required payload (tier === 'unlicensed' — no subscription and
 * no active trial). A Paid-via-Atlassian app is licensed-only by default, so this
 * is a backstop that turns the no-license case into a clean "subscribe or start a
 * trial" prompt rather than a raw error. Carries the pricing table so the UI can
 * present the two editions.
 */
function buildLicenseRequired() {
  return {
    error: 'license_required',
    detail:
      'This app requires an active subscription or trial. Subscribe to BYOK Pro or Managed Pro.',
    pricing: pricingTable(),
  };
}

const resolver = new Resolver();

// ── Constants ──────────────────────────────────────────────

const SETTINGS_KEY = 'spec2jira_settings';

// Max length of the optional admin-configured Project Context (house style /
// glossary / conventions) injected into every generation (P1). Bounded so it stays
// a concise standing context, not an unbounded document (POLICY §12), and never
// drifts into a growing keyword/cue list (POLICY §5 — keep it ONE bounded field).
// The UI mirrors this for fail-fast feedback; this server check is authoritative.
// 12000: the 6-call decomposed distill produces a COMPLETE multi-category profile, and a
// genuinely rich regulated domain (the bilingual 3-site sepsis CDS) merges to ~7.5K chars
// of pure signal — 8000 left almost no headroom and risked silently trimming the LAST
// category (Conventions: the counterintuitive rules + lineage carve-out). 20000 (raised from
// 12000 2026-06-06) lets a DENSE, high-signal real context pass through RAW rather than be
// condensed: a real FlexiCash lending context (19,775 chars) was distilled and the distill
// INTERPRETED — it fabricated/drifted 2 normative "standing rules" that contradicted the spec
// and dropped high-signal conventions (anti-templating, JIRA structure, team composition).
// For a context that fits 20000, faithful raw text beats a lossy+interpretive condense.
// "Distill with Claude" remains for contexts that genuinely exceed 20000 (and is being
// hardened to extract-not-interpret). Aggregate store size is still guarded in saveSettings.
const PROJECT_CONTEXT_MAX_CHARS = 20000;

// "Distill with Claude" is a 6-call CHUNKED pipeline (startDistillSession → distillStep ×6,
// looped by the UI — mirrors the chunked JIRA push). Each call extracts ONE category from
// the SAME full input with its own generous per-category token budget (DISTILL_CATEGORIES in
// anthropic_client.js), so no category is starved by another — the fix for the single call's
// depth-first category drops (validated 8/8 vs 5/8 in a 2026-06-02 Haiku bake-off). Each call
// is small (~3-13s), well under the 25-sec resolver limit (gotcha #4). The 6 sections are
// accumulated in KVS and merged at the last step, then bounded to PROJECT_CONTEXT_MAX_CHARS
// (PROJECT_CONTEXT_MAX_CHARS, so the user can still hand-edit the draft).
const DISTILL_SESSION_PREFIX = 'distill_session:';

// Named Project Context profiles. A workspace can hold specs from multiple projects,
// so a SINGLE global context would misapply across them (project A's glossary on a
// project B spec = wrong output). Profiles let the user pick the right context per
// generation. Per-profile + count caps bound each entry; the AGGREGATE serialized
// size is guarded in saveSettings — 20 × 20000 chars (plus non-ASCII at 2-4 UTF-8
// bytes/char) can approach the ~240KB KVS value cap, so the write is size-checked.
const MAX_CONTEXT_PROFILES = 20;
const CONTEXT_PROFILE_NAME_MAX = 60;
// Aggregate settings-object byte ceiling (well under the ~240KB KVS value cap, leaving
// headroom for the non-context fields). Checked in saveSettings before the write.
const SETTINGS_MAX_BYTES = 200000;

// KVS prefix for generation job state (Anthropic batch lifecycle).
const JOB_KEY_PREFIX = 'job:';

// Index: page id → latest generation jobId. Lets a reopened page reconnect to an
// in-flight batch (getGenerationStatus) instead of showing Ready + spawning a
// duplicate batch. Written by startGeneration; read by getGenerationStatus.
const PAGE_JOB_PREFIX = 'pageJob:';

// Per-page memory of the last-chosen Project Context profile, so re-generating the
// same page pre-selects the same profile (the "easy" half of dynamic context).
// Written by startGeneration (fail-soft); read by getContextProfiles.
const PAGE_CONTEXT_PREFIX = 'pageCtx:';

// NOTE: generation uses the Anthropic Message Batches API (polled via
// pollJobStatus); push is a CHUNKED resolver (startPush + UI-looped pushStep,
// one bounded JIRA batch per call). Neither uses @forge/events queues anymore —
// asUser() is unavailable in async consumers (AUTH_TYPE_UNAVAILABLE 2026-05-30).

// ── Test-case generation KVS key prefixes ─────────────────────
// tcjob:<jobId>               — control record (batch lifecycle + stampedStories)
// testcases:<jobId>:<idx>     — per-story result (result + coverage, or error sentinel)
// tcregenjob:<jobId>:<idx>    — per-story single-regen control (mirrors tcjob)
// KVS sizes: tcjob holds control + lean stampedStories {idx,name,acceptance_criteria};
//   ~1-2KB/story → ~40-80KB at 39 stories, well under 240KB (#10).
//             per-story ~2-4KB, well within 240KB. No TTL (matches breakdown job —
//             test cases must survive reconnect as long as the breakdown does).
const TC_JOB_KEY_PREFIX = 'tcjob:';
const TC_STORY_KEY_PREFIX = 'testcases:';
const TC_REGEN_KEY_PREFIX = 'tcregenjob:';
const PAGE_SNAP_PREFIX = 'pagesnap:'; // §8 fix (2026-06-06): source-page snapshot for test-gen, in a sibling key (keeps the job record lean)

// Load the source-page snapshot for test-case generation (§8 fix). Returns the raw page text when a
// COHERENT snapshot exists (its page version matches the breakdown's, so the rules the tests mine are
// the SAME ones the stamped ACs were authored against), else '' (→ submitTestCaseBatch falls back to
// today's no-source behaviour). Fail-soft — a miss/throw never blocks test-gen.
async function resolveSpecSourceText(jobId, job) {
  try {
    const snap = await kvs.get(`${PAGE_SNAP_PREFIX}${jobId}`);
    if (!snap || !snap.content) {
      // Diagnostic (NOT silent): a breakdown generated BEFORE the §7 fix was deployed has no
      // snapshot, so test-gen falls back to no-source. Re-running test-gen alone on an old
      // breakdown won't enable §7 — the snapshot is written at GENERATION, so REGENERATE the
      // breakdown after deploying the fix. This log makes a Live-E2E run diagnosable.
      console.log(`[tcgen] NO source-page snapshot for job ${jobId} → test-gen runs WITHOUT §7 rules (regenerate the breakdown after deploying the §7 fix to enable concrete-value + decision-table coverage)`);
      return '';
    }
    if (job && typeof job.pageVersion === 'number' && typeof snap.pageVersion === 'number' && snap.pageVersion !== job.pageVersion) {
      console.warn(`[tcgen] page snapshot version ${snap.pageVersion} != job ${job.pageVersion} — skipping source (fallback to no-source)`);
      return '';
    }
    console.log(`[tcgen] source-page snapshot loaded for job ${jobId} (${String(snap.content).length} chars) → §7 rules fed to test-gen`);
    return String(snap.content || '');
  } catch (e) {
    console.warn(`[tcgen] spec-source load failed (non-fatal): ${String(e?.message || e)}`);
    return '';
  }
}


// ── Settings helpers ────────────────────────────────────────

async function loadSettings() {
  const s = await kvs.get(SETTINGS_KEY);
  return s || {};
}

async function getProjectKey(payloadKey) {
  if (payloadKey) return payloadKey;
  const s = await loadSettings();
  return s.defaultProjectKey || null;
}

/**
 * Normalize stored settings into a clean Project Context profiles array.
 * Migrates a legacy P1 single `projectContext` string (read-time, non-destructive)
 * into one "Default" profile so existing installs keep their context seamlessly.
 * @returns {Array<{id:string,name:string,context:string}>}
 */
function normalizeContextProfiles(settings) {
  const s = settings || {};
  if (Array.isArray(s.contextProfiles)) {
    return s.contextProfiles
      .filter((p) => p && typeof p === 'object')
      .map((p) => ({
        id: String(p.id || ''),
        name: String(p.name || ''),
        context: String(p.context || ''),
      }))
      .filter((p) => p.id && (p.name || p.context));
  }
  const legacy = String(s.projectContext || '').trim();
  if (legacy) return [{ id: 'default', name: 'Default', context: legacy }];
  return [];
}

/**
 * Validate the contextProfiles array from the Settings UI (server-authoritative).
 * Returns { ok, value } where value is the cleaned array, or undefined when the
 * field was not provided at all (leave existing profiles untouched). { ok:false,
 * error } on a bad profile. Drops fully-empty rows; assigns/dedupes stable ids.
 */
function validateContextProfiles(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (!Array.isArray(raw)) return { ok: false, error: 'Project Context profiles must be a list.' };
  if (raw.length > MAX_CONTEXT_PROFILES) {
    return { ok: false, error: `Too many Project Context profiles (max ${MAX_CONTEXT_PROFILES}).` };
  }
  const out = [];
  const seenIds = new Set();
  for (const p of raw) {
    const name = String(p?.name || '').trim();
    const context = String(p?.context || '').trim();
    if (!name && !context) continue; // drop blank rows (e.g. an unfilled "add")
    if (!name) return { ok: false, error: 'Each Project Context profile needs a name.' };
    if (name.length > CONTEXT_PROFILE_NAME_MAX) {
      return { ok: false, error: `Profile name too long (max ${CONTEXT_PROFILE_NAME_MAX} characters).` };
    }
    if (context.length > PROJECT_CONTEXT_MAX_CHARS) {
      return {
        ok: false,
        error: `Profile "${name}" context is too long (${context.length}/${PROJECT_CONTEXT_MAX_CHARS}). Use "Distill with Claude" to condense it.`,
      };
    }
    let id = String(p?.id || '').trim();
    if (!id || seenIds.has(id)) id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    seenIds.add(id);
    out.push({ id, name, context });
  }
  return { ok: true, value: out };
}

// ════════════════════════════════════════════════════════════
// SETTINGS RESOLVERS — BYOK Anthropic API key + JIRA project key
// ════════════════════════════════════════════════════════════

/**
 * Load settings for the Settings UI.
 * Returns project key + boolean indicating whether API key е stored.
 * Does NOT return the actual API key value (Forge KVS secrets are
 * resolver-only and we don't echo them back к the UI for security).
 */
resolver.define('getSettings', async () => {
  const s = await loadSettings();
  const storedKey = await getStoredApiKey();
  return {
    defaultProjectKey: s.defaultProjectKey || '',
    apiKeyConfigured: !!storedKey,
    apiKeyLastSetAt: s.apiKeyLastSetAt || null,
    // Named Project Context profiles (full, with text) for the admin editor. Legacy
    // single-field installs are migrated read-time into one "Default" profile.
    contextProfiles: normalizeContextProfiles(s),
    // Optional advanced config — required custom fields JSON (raw string for
    // round-trip editing). Empty когато the project doesn't require custom fields.
    requiredCustomFieldsJson: s.requiredCustomFieldsJson || '',
  };
});

/**
 * Parse the admin-configured required-custom-fields JSON string into an object.
 * Returns { ok, value } or { ok: false, error }. Empty/blank → ok with null.
 */
function parseRequiredCustomFields(raw) {
  const text = (raw || '').trim();
  if (!text) return { ok: true, value: null };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'Custom fields must be valid JSON (e.g. {"customfield_10042": {"value": "Team A"}}).' };
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
    return { ok: false, error: 'Custom fields must be a JSON object mapping field IDs to values.' };
  }
  return { ok: true, value: parsed };
}

/**
 * Save settings от Settings UI.
 *
 * Payload: { anthropicApiKey?: string, defaultProjectKey: string }
 *
 * If anthropicApiKey provided + non-empty, stores it via Forge secret KVS.
 * If omitted/empty, existing key (if any) е preserved.
 * defaultProjectKey е always validated + saved.
 */
resolver.define('saveSettings', async ({ payload }) => {
  const { anthropicApiKey, defaultProjectKey, requiredCustomFieldsJson, contextProfiles } = payload || {};

  // Validate project key
  const cleanProjectKey = (defaultProjectKey || '').trim().toUpperCase();
  if (!cleanProjectKey) {
    return { error: 'Jira Project Key is required' };
  }
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(cleanProjectKey)) {
    return {
      error:
        'Jira Project Key must be 2–10 characters, start with a letter, only uppercase letters and digits (e.g., PROJ, SCRUM2)',
    };
  }

  // Validate optional custom-fields JSON (fail fast so the admin fixes it now,
  // не discovers it as а push failure later).
  const cfRaw = (requiredCustomFieldsJson || '').trim();
  const cfParse = parseRequiredCustomFields(cfRaw);
  if (!cfParse.ok) {
    return { error: cfParse.error };
  }

  // Validate Project Context profiles (server-authoritative; the UI mirrors the caps).
  const cpParse = validateContextProfiles(contextProfiles);
  if (!cpParse.ok) {
    return { error: cpParse.error };
  }

  // Conditionally update API key
  let apiKeyUpdated = false;
  const incomingKey = (anthropicApiKey || '').trim();
  if (incomingKey) {
    const result = await setStoredApiKey(incomingKey);
    if (!result.success) {
      return { error: result.error };
    }
    apiKeyUpdated = true;
  }

  // Update non-secret settings (project key + custom fields + metadata)
  const current = await loadSettings();
  const next = {
    ...current,
    defaultProjectKey: cleanProjectKey,
    requiredCustomFieldsJson: cfRaw, // store raw string for UI round-trip
  };
  // Persist profiles only when the UI sent them (undefined = not provided → leave
  // as-is). Drop the legacy single-field once migrated forward into profiles.
  if (cpParse.value !== undefined) {
    next.contextProfiles = cpParse.value;
    delete next.projectContext;
  }
  if (apiKeyUpdated) {
    next.apiKeyLastSetAt = new Date().toISOString();
  }

  // Guard the AGGREGATE serialized size before writing: per-profile caps don't bound
  // the total, and non-ASCII (e.g. Cyrillic/CJK in a multilingual context) is 2-4 UTF-8
  // bytes/char, so a maxed config could exceed the ~240KB KVS value cap. Reject with a
  // clear message rather than letting kvs.set throw and silently lose the edits (§11).
  const sizeBytes = new TextEncoder().encode(JSON.stringify(next)).length;
  if (sizeBytes > SETTINGS_MAX_BYTES) {
    return {
      error: `These settings are too large to store (${Math.round(sizeBytes / 1024)} KB; limit ~${Math.round(SETTINGS_MAX_BYTES / 1024)} KB). Shorten or remove some Project Context profiles and try again.`,
    };
  }
  try {
    await kvs.set(SETTINGS_KEY, next);
  } catch (e) {
    console.error(`[saveSettings] kvs.set failed: ${String(e?.message || e)}`);
    return { error: 'Could not save settings (storage error). Try shortening your Project Context profiles, then save again.' };
  }

  return { success: true, apiKeyUpdated };
});

/**
 * Clear Anthropic API key only (preserves project key).
 * Useful когато admin wants к rotate keys или disconnect Spec2Tickets.
 */
resolver.define('clearAnthropicApiKey', async () => {
  const result = await clearStoredApiKey();
  if (result.success) {
    // Remove timestamp от settings
    const current = await loadSettings();
    if (current.apiKeyLastSetAt) {
      delete current.apiKeyLastSetAt;
      await kvs.set(SETTINGS_KEY, current);
    }
  }
  return result;
});

/**
 * Reset all settings (clears API key AND project key + KVS metadata).
 * Confirmation prompt should be shown in UI BEFORE calling this.
 */
resolver.define('resetSettings', async () => {
  await clearStoredApiKey();
  await kvs.delete(SETTINGS_KEY);
  return { success: true };
});

/**
 * Test the customer's stored Anthropic API key (or override from UI).
 * Returns { status: 'ok', model } on success or { status: 'error', code, detail }.
 * Compatible с existing AdminSettings.jsx error code mapping.
 */
resolver.define('testConnection', async ({ payload }) => {
  // payload may include { anthropicApiKey } when testing a key BEFORE save
  const candidateKey = (payload?.anthropicApiKey || '').trim() || null;
  const result = await anthropicTestConnection(candidateKey);

  if (result.ok) {
    return {
      status: 'ok',
      message: `Connected to Anthropic API (${result.model})`,
    };
  }

  // Map к error codes (some preserved от v2.x format)
  const codeMap = {
    not_configured: 'NOT_CONFIGURED',
    network_failure: 'BACKEND_UNREACHABLE',
    auth_rejected: 'BACKEND_AUTH_FAILED',
    insufficient_credits: 'INSUFFICIENT_CREDITS',
    rate_limited: 'RATE_LIMITED',
  };
  return {
    status: 'error',
    code: codeMap[result.error] || 'UNEXPECTED',
    detail: result.detail,
  };
});

// ── "Distill with Claude" — 6-call CHUNKED pipeline ─────────────────────────────
// Mirrors the chunked JIRA push (startPushSession/pushSessionStep): startDistillSession
// validates + persists a KVS session; distillStep runs ONE focused category call per
// invocation (the UI loops it 6×). One call per category gives each its own generous
// token budget, so no category is starved by another — the fix for the single call's
// depth-first category drops (8/8 vs 5/8, 2026-06-02 Haiku bake-off). Each call is small
// (~3-13s), well under the 25-sec resolver limit. Consumes NO breakdown quota. The content
// is NEVER logged (keeps "Log End-User Data: No" true).

// Map a distillCategory backend error code → the UI's friendly ERROR_MESSAGES code.
// Shared by both distill resolvers (same shape the old single-call resolver used).
function mapDistillError(result) {
  const codeMap = {
    not_configured: 'NOT_CONFIGURED',
    network_failure: 'BACKEND_UNREACHABLE',
    auth_rejected: 'BACKEND_AUTH_FAILED',
    insufficient_credits: 'INSUFFICIENT_CREDITS',
    rate_limited: 'RATE_LIMITED',
  };
  return { error: result.error, code: codeMap[result.error] || 'UNEXPECTED', detail: result.detail };
}

/**
 * startDistillSession — begin a 6-step distill. Validates + clips the input, persists a
 * KVS session, and returns the session id + the category labels so the UI can show
 * progress. The UI then loops distillStep(step=0..5) until { done: true }.
 *
 * Returns { sessionId, totalSteps, categories } OR { error, code, detail }.
 */
resolver.define('startDistillSession', async ({ payload, context }) => {
  const text = (payload?.text || '').trim();
  if (!text) return { error: 'empty', code: 'UNEXPECTED', detail: 'Nothing to distill.' };

  // Distill (Project Context) is an Anthropic call too — resolve the key by tier
  // so Managed installs (no BYOK key) distill with OUR key, BYOK with theirs.
  const { apiKey, keySource } = await resolveAnthropicKey(context);
  if (!apiKey) {
    if (keySource === 'managed') {
      console.error('[distill] managed key unavailable (MANAGED_ANTHROPIC_KEY not configured)');
      return { error: 'managed_unavailable', code: 'NOT_CONFIGURED', detail: 'The Managed service is temporarily unavailable. Please contact support@spec2jira.com, or switch to your own Anthropic API key in Settings.' };
    }
    return { error: 'not_configured', code: 'NOT_CONFIGURED', detail: 'Anthropic API key not configured. Save your key first.' };
  }

  // §13 security-review fix: Managed distill spends OUR key but has no breakdown
  // counter of its own → gate it on the per-USER fair-use cap (MANAGED_USER_CAP) so
  // it cannot run on our key once this user is over their monthly cap. BYOK
  // distill on the customer's own key → no gate. Fail-OPEN on a check glitch (never
  // block a payer). NOTE (accepted 2026-06-03, partner decision): distill UNDER the
  // cap is gated-but-not-consumed — a low-risk residual (cheap Haiku, requires a
  // paid seat); add a dedicated distill cap only if abuse is ever observed.
  if (keySource === 'managed') {
    try {
      const q = await checkQuota(context);
      if (!q.allowed) {
        return { error: 'managed_unavailable', code: 'NOT_CONFIGURED', detail: `You've used this month's Managed breakdowns — summarizing is paused until ${q.resetsAtLabel}. For unlimited, switch to BYOK Pro (your own key).` };
      }
    } catch (e) {
      console.error(`[distill] managed pool check failed (allowing): ${String(e?.message || e)}`);
    }
  }

  // Clip once, at session start, so every per-category call sees the SAME bounded input
  // (the focused calls re-clip defensively too, but clipping here keeps the KVS session
  // small and the input stable across steps).
  const clipped = text.length > DISTILL_MAX_INPUT_CHARS;
  const input = clipped ? text.slice(0, DISTILL_MAX_INPUT_CHARS) : text;

  // newSessionId pattern mirrors push_handler.newSessionId (crypto.randomUUID with a
  // Date.now()+random fallback — the resolver runtime allows timestamps; push sessions
  // use them).
  const sessionId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const session = { input, clipped, sections: {}, createdAt: Date.now() };
  await kvs.set(DISTILL_SESSION_PREFIX + sessionId, session);

  console.log(`[distill] session ${sessionId} started (${input.length} chars${clipped ? ', input clipped' : ''}, ${DISTILL_CATEGORIES.length} steps)`);

  return {
    sessionId,
    totalSteps: DISTILL_CATEGORIES.length,
    categories: DISTILL_CATEGORIES.map((c) => c.label),
  };
});

/**
 * distillStep — run ONE category of a distill session. The UI loops this with
 * step = 0..5. On the LAST step, merges all 6 sections (in category order) into one
 * profile, bounds it to PROJECT_CONTEXT_MAX_CHARS via trimToBudget (so the user can still
 * hand-edit the draft), deletes the session, and returns the profile.
 *
 * Returns one of:
 *   - mid-pipeline: { done:false, step, totalSteps, label, nextLabel }
 *   - final:        { done:true,  step, totalSteps, label, profile, truncated }
 *   - per-step err: { error, code, detail, step, label }  (session kept so the UI can retry)
 */
resolver.define('distillStep', async ({ payload, context }) => {
  const sessionId = payload?.sessionId;
  const step = Number(payload?.step);
  if (!sessionId) return { error: 'no_session', code: 'UNEXPECTED', detail: 'No distill session id.' };
  if (!Number.isInteger(step) || step < 0 || step >= DISTILL_CATEGORIES.length) {
    return { error: 'bad_step', code: 'UNEXPECTED', detail: `Invalid distill step ${payload?.step}.` };
  }

  const key = DISTILL_SESSION_PREFIX + sessionId;
  const s = await kvs.get(key);
  if (!s) {
    return { error: 'session_not_found', code: 'UNEXPECTED', detail: 'Distill session expired or not found. Start over.' };
  }

  const { apiKey, keySource } = await resolveAnthropicKey(context);
  if (!apiKey) {
    if (keySource === 'managed') {
      console.error('[distill] managed key unavailable (MANAGED_ANTHROPIC_KEY not configured)');
      return { error: 'managed_unavailable', code: 'NOT_CONFIGURED', detail: 'The Managed service is temporarily unavailable. Please contact support@spec2jira.com, or switch to your own Anthropic API key in Settings.', step, label: DISTILL_CATEGORIES[step].label };
    }
    return { error: 'not_configured', code: 'NOT_CONFIGURED', detail: 'Anthropic API key not configured. Save your key first.', step, label: DISTILL_CATEGORIES[step].label };
  }

  const category = DISTILL_CATEGORIES[step];

  let result;
  try {
    result = await distillCategory({ text: s.input, category, apiKey });
  } catch (e) {
    console.error(`[distill] step ${step} (${category.key}) threw: ${String(e?.message || e)}`);
    return { error: 'distill_exception', code: 'UNEXPECTED', detail: String(e?.message || e), step, label: category.label };
  }
  if (result.error) {
    // Keep the session so the UI can retry THIS step with the same sessionId.
    return { ...mapDistillError(result), step, label: category.label };
  }

  // Persist this section. Track per-section truncation so the UI can nudge "expand".
  s.sections[category.key] = { text: result.section, truncated: !!result.truncated };
  await kvs.set(key, s);

  const isLast = step === DISTILL_CATEGORIES.length - 1;
  if (!isLast) {
    return {
      done: false,
      step,
      totalSteps: DISTILL_CATEGORIES.length,
      label: category.label,
      nextLabel: DISTILL_CATEGORIES[step + 1].label,
    };
  }

  // Last step → merge all sections in category order, bound to the store limit, clean up.
  const ordered = DISTILL_CATEGORIES.map((c) => s.sections[c.key]).filter((x) => x && x.text);
  let profile = ordered.map((x) => x.text).join('\n');
  const anyTruncated = ordered.some((x) => x.truncated);
  let trimmed = false;
  if (profile.length > PROJECT_CONTEXT_MAX_CHARS) {
    profile = trimToBudget(profile, PROJECT_CONTEXT_MAX_CHARS);
    trimmed = true;
  }
  try { await kvs.delete(key); } catch (_) {}

  // Length only — NEVER the content (privacy; keeps "Log End-User Data: No" true).
  console.log(`[distill] session ${sessionId} merged ${ordered.length}/${DISTILL_CATEGORIES.length} sections → ${profile.length} chars${trimmed ? ', trimmed to fit' : ''}${anyTruncated ? ', a section hit its token cap' : ''}`);

  return {
    done: true,
    step,
    totalSteps: DISTILL_CATEGORIES.length,
    label: category.label,
    profile,
    truncated: anyTruncated,    // a section hit its per-call token cap (slightly short, but complete-ish)
    overflowTrimmed: trimmed,   // the MERGED profile exceeded the store bound → its TAIL was cut (honest, not "concise")
  };
});

/**
 * List Project Context profiles for the generation-flow selector (lean: id + name
 * only — the context text stays server-side). Page-aware: returns the remembered
 * selection for this page so a re-run pre-selects it. A remembered profile that was
 * since deleted falls back to null (→ "None"); an explicit prior "none" is kept.
 * Returns { profiles: [{id, name}], selectedProfileId: string|null }.
 */
resolver.define('getContextProfiles', async ({ payload }) => {
  const s = await loadSettings();
  const profiles = normalizeContextProfiles(s).map((p) => ({ id: p.id, name: p.name }));

  let selectedProfileId = null;
  const pageId = payload?.pageId;
  if (pageId) {
    try {
      const remembered = await kvs.get(`${PAGE_CONTEXT_PREFIX}${String(pageId)}`);
      const rid = remembered?.profileId;
      if (rid === 'none') selectedProfileId = 'none';
      else if (rid && profiles.some((p) => p.id === rid)) selectedProfileId = rid;
    } catch (_) {
      /* best-effort — selector just defaults to None */
    }
  }
  return { profiles, selectedProfileId };
});

// ════════════════════════════════════════════════════════════
// CONFLUENCE PAGE PICKER — preserved от v2.x (Forge-native)
// ════════════════════════════════════════════════════════════

const RECENT_PAGES_KEY = 'spec2jira_recent_pages';
const LAST_SELECTED_KEY = 'spec2jira_last_selected_page';
const MAX_RECENT_PAGES = 10;
const PENDING_DEEP_LINK_KEY = 'spec2jira_pending_deep_link';
const PENDING_DEEP_LINK_MAX_AGE_MS = 5 * 60 * 1000;
const SEARCH_MIN_QUERY_LEN = 2;
const SEARCH_RESULT_LIMIT = 20;

resolver.define('searchPages', async ({ payload }) => {
  const query = (payload?.query || '').trim();
  if (query.length < SEARCH_MIN_QUERY_LEN) {
    return { results: [] };
  }

  const safeQuery = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const cql = `type=page AND title ~ "${safeQuery}"`;

  // v1 /wiki/rest/api/content/search → 410 Gone (deprecated 2026-05);
  // /wiki/rest/api/search (no /content/ prefix) е the dedicated CQL search
  // endpoint, still supported. Different response envelope — results
  // wrap each match в {content: {...}} object.
  let response;
  try {
    response = await api
      .asUser()
      .requestConfluence(
        route`/wiki/rest/api/search?cql=${cql}&limit=${SEARCH_RESULT_LIMIT}`,
      );
  } catch (e) {
    console.error(`[searchPages] threw: ${String(e?.message || e)}`);
    return { error: 'Search failed', detail: 'Couldn\'t search Confluence right now. Try again in a moment; if it persists, contact support@spec2jira.com.' };
  }

  if (response.headers.get('forge-proxy-error') === 'BLOCKED_EGRESS') {
    return {
      error: 'FORGE_FETCH_BLOCKED',
      detail: 'Egress blocked. Verify scopes + reinstall the app.',
    };
  }
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 403) {
      console.error(`[searchPages] Confluence 403 (scope mismatch?): ${text.substring(0, 200)}`);
      return {
        error: 'Confluence 403 — scope mismatch?',
        detail: 'Couldn\'t search Confluence (permission error). Ask your Confluence admin to re-authorize Spec2Tickets, or contact support@spec2jira.com.',
      };
    }
    console.error(`[searchPages] Confluence HTTP ${response.status}: ${text.substring(0, 300)}`);
    return {
      error: `Confluence ${response.status}`,
      detail: 'Couldn\'t read this Confluence page (Confluence returned an error). Try reopening the page; if it persists, contact support@spec2jira.com.',
    };
  }

  try {
    const data = await response.json();
    const results = (data.results || []).map((r) => {
      const c = r.content || {};
      return {
        id: String(c.id || ''),
        title: c.title || r.title || '(untitled)',
        spaceKey: c.space?.key || r.resultGlobalContainer?.key || '',
        spaceName: c.space?.name || r.resultGlobalContainer?.title || '',
      };
    }).filter((r) => r.id);
    return { results };
  } catch (e) {
    console.error(`[searchPages] parse failed: ${String(e?.message || e)}`);
    return { error: 'Parse failed', detail: 'Couldn\'t search Confluence right now. Try again in a moment; if it persists, contact support@spec2jira.com.' };
  }
});

resolver.define('getRecentPages', async () => {
  const list = await kvs.get(RECENT_PAGES_KEY);
  return { recent: Array.isArray(list) ? list : [] };
});

resolver.define('getLastSelectedPage', async () => {
  const last = await kvs.get(LAST_SELECTED_KEY);
  return { lastSelected: last || null };
});

resolver.define('recordPageSelection', async ({ payload }) => {
  const { id, title, spaceKey, spaceName } = payload || {};
  if (!id || !title) return { error: 'Missing page id or title' };
  const stringId = String(id);
  const entry = {
    id: stringId,
    title,
    spaceKey: spaceKey || '',
    spaceName: spaceName || '',
    lastSelectedAt: new Date().toISOString(),
  };
  const current = await kvs.get(RECENT_PAGES_KEY);
  const list = Array.isArray(current) ? current : [];
  const filtered = list.filter((p) => p.id !== stringId);
  const next = [entry, ...filtered].slice(0, MAX_RECENT_PAGES);
  await kvs.set(RECENT_PAGES_KEY, next);
  await kvs.set(LAST_SELECTED_KEY, entry);
  return { success: true, recent: next };
});

resolver.define('setPendingDeepLink', async ({ payload }) => {
  const { pageId, title, spaceKey, spaceName } = payload || {};
  if (!pageId) return { error: 'Missing pageId' };
  await kvs.set(PENDING_DEEP_LINK_KEY, {
    pageId: String(pageId),
    title: title || '',
    spaceKey: spaceKey || '',
    spaceName: spaceName || '',
    setAt: Date.now(),
  });
  return { success: true };
});

resolver.define('consumePendingDeepLink', async () => {
  const pending = await kvs.get(PENDING_DEEP_LINK_KEY);
  if (!pending || !pending.pageId) return { pending: null };
  await kvs.delete(PENDING_DEEP_LINK_KEY);
  const ageMs = Date.now() - (pending.setAt || 0);
  if (ageMs > PENDING_DEEP_LINK_MAX_AGE_MS) return { pending: null };
  return {
    pending: {
      pageId: pending.pageId,
      title: pending.title || '',
      spaceKey: pending.spaceKey || '',
      spaceName: pending.spaceName || '',
    },
  };
});

// ════════════════════════════════════════════════════════════
// CONFLUENCE PAGE METADATA + CONTENT — direct asUser()
// (v2.x routed via customer backend; v3.0.0 calls Confluence directly)
// ════════════════════════════════════════════════════════════

/**
 * Fetch Confluence page metadata + body content via asUser().
 * Returns:
 *   { pageId, title, spaceKey, spaceName, version, body, bodyLength }
 *   OR { error, detail }
 *
 * v2 Confluence API (2026-05-29 migration — v1 /wiki/rest/api/content/{id}
 * returned 410 Gone). v2 endpoint е /wiki/api/v2/pages/{id}; response shape
 * differs (spaceId instead of nested space object — space key/name require
 * separate lookup; omitted here for simplicity since they're display-only).
 */
resolver.define('fetchPage', async ({ payload }) => {
  const pageId = payload?.pageId;
  if (!pageId) return { error: 'No page ID' };

  let response;
  try {
    response = await api
      .asUser()
      .requestConfluence(
        route`/wiki/api/v2/pages/${pageId}?body-format=storage`,
      );
  } catch (e) {
    return { error: 'Fetch failed', detail: String(e?.message || e) };
  }

  if (response.status === 404) {
    return { error: 'page_not_found', detail: `Page ${pageId} does not exist or you don't have access` };
  }
  if (response.status === 403) {
    return { error: 'permission_denied', detail: 'You do not have permission to view this page' };
  }
  if (!response.ok) {
    const text = await response.text();
    console.error(`[fetchPage] Confluence HTTP ${response.status}: ${text.substring(0, 300)}`);
    return { error: `confluence_${response.status}`, detail: 'Couldn\'t read this Confluence page (Confluence returned an error). Try reopening the page; if it persists, contact support@spec2jira.com.' };
  }

  const data = await response.json();
  const bodyStorage = data.body?.storage?.value || '';

  // snake_case field names — matches App.js UI expectations (preserved
  // от v2.x backend response shape). Frontend reads pageData.page_id,
  // pageData.space_name, pageData.body_length etc.
  return {
    page_id: String(data.id),
    title: data.title,
    space_key: '',  // v2 API returns spaceId only; separate /spaces/{spaceId} call needed за key/name
    space_name: '',
    version: data.version?.number || 1,
    body: bodyStorage,
    body_length: bodyStorage.length,
  };
});

// ════════════════════════════════════════════════════════════
// GENERATION — Anthropic Message Batches API pattern
//
// Why batches: Forge async events have а 55-sec hard timeout per invocation.
// Sync generateBreakdown runs 60-150 sec. Batches submit instantly + Anthropic
// processes async (typically 2-10 min). UI polls pollJobStatus which polls
// Anthropic batch status. 50% cheaper than sync calls. Bonus.
//
// Job lifecycle в KVS:
//   pending (just created) → batched (submitted к Anthropic) →
//   completed (results fetched + breakdown stored)
//   OR failed (any error along the way)
// ════════════════════════════════════════════════════════════

function newJobId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Bound the per-cycle resolution calls — each is a sync LLM call and pollJobStatus
// runs under the 25-sec resolver limit. Real breakdowns have 0-2 cycles; this is a
// runaway guard, not an expected ceiling. Cycles beyond it (or that the model
// can't confidently resolve) are surfaced as spec_concerns rather than left silent.
const MAX_CYCLE_RESOLVES = 3;

/**
 * Verify the cross-feature dependency graph is acyclic; auto-resolve each cycle by
 * cutting the softest edge (a tiny LLM call), and surface anything unresolved as a
 * spec_concern. Mutates `breakdown.features[].dependencies` + `breakdown.spec_concerns`
 * in place. Fail-safe — the caller wraps it so generation never fails on repair.
 */
async function verifyAndRepairCycles(breakdown, apiKey, model) {
  const features = breakdown?.features;
  if (!Array.isArray(features) || features.length === 0) return;

  let cycles = detectCycles(features); // pure, deterministic, exhaustive
  if (cycles.length === 0) return;
  console.log(`[cycle] detected ${cycles.length} dependency cycle(s)`);

  const byName = new Map(features.map((f) => [f.name, f]));
  const concerns = [];
  const cutEdges = new Set();     // "from→to" already cut — never cut a reverse (would over-cut a mutual pair)
  const unresolvable = new Set(); // node-set signatures already surfaced as NOT auto-resolved (loop guard)
  const sigOf = (p) => [...p].sort().join('|');
  let resolves = 0;

  // Process ONE live cycle at a time, RE-DETECTING after each cut. detectCycles returns every cycle of
  // the CURRENT graph (deduped by node-set), but a single cut can break SEVERAL overlapping cycles (a
  // mutual A↔B pair, or a 3-node knot seen from different entry nodes). Re-detecting after each cut means
  // we only ever cut a STILL-LIVE cycle, and the cutEdges guard refuses to cut a reverse edge — together
  // preventing the over-cutting + contradictory concerns the old stale-list `for` loop produced
  // (deep-audit 2026-06-07: a mutual RBP↔ACD pair had BOTH directions cut and emitted 3 mutually-
  // contradictory [RISK|low] concerns for what was ~1 real resolution — an incoherent audit trail).
  while (resolves < MAX_CYCLE_RESOLVES) {
    const path = cycles.find((c) => !unresolvable.has(sigOf(c)));
    if (!path) break; // no live cycle left that we haven't already judged unresolvable
    const label = `${path.join(' → ')} → ${path[0]}`;

    let cut = null;
    if (apiKey) {
      const involved = path.map((n) => byName.get(n)).filter(Boolean);
      try {
        const r = await resolveDependencyCycle({ cyclePath: path, features: involved, apiKey, model });
        if (r && !r.error && !r.uncertain && r.cut_from && r.cut_to) cut = r;
      } catch (e) {
        console.error(`[cycle] resolve threw: ${String(e?.message || e)}`);
      }
    }

    const f = cut && byName.get(cut.cut_from);
    const edgeLive = f && Array.isArray(f.dependencies) && f.dependencies.includes(cut.cut_to);
    const reverseAlreadyCut = cut && cutEdges.has(`${cut.cut_to}→${cut.cut_from}`);

    if (edgeLive && !reverseAlreadyCut) {
      f.dependencies = f.dependencies.filter((d) => d !== cut.cut_to);
      cutEdges.add(`${cut.cut_from}→${cut.cut_to}`);
      resolves++;
      console.log('[cycle] auto-resolved a dependency cycle (cut the softer edge)');
      // Surface WHAT was cut (deterministic) + hand the JUDGEMENT to the BA. We intentionally do NOT
      // print the LLM's `cut.reason` prose: the edge CHOICE is meaning-reading (legitimately the LLM's),
      // but its free-text rationale can make a checkably-wrong factual claim about a business rule, which
      // an expert BA/PO catches and which then taints trust in the whole breakdown (deep-audit 2026-06-07).
      concerns.push(
        `[RISK|low] Circular dependency auto-resolved: dropped the "${cut.cut_from}" → "${cut.cut_to}" blocker to break a dependency cycle. Review whether this is the right edge to remove.`,
      );
      cycles = detectCycles(features); // the cut may have broken other listed cycles — re-detect
      continue;
    }

    // Couldn't safely auto-resolve THIS cycle (no key / uncertain / invalid edge / cutting it would
    // remove both directions of a mutual pair). Surface it once + mark it so the loop never repeats it.
    concerns.push(
      `[RISK|medium] Circular dependency detected but NOT auto-resolved: ${label}. Break it manually before relying on blocks-links for sprint sequencing.`,
    );
    unresolvable.add(sigOf(path));
  }

  // Budget exhausted (or no apiKey) with cycles still live → surface the remainder honestly (deduped).
  for (const c of cycles) {
    if (!unresolvable.has(sigOf(c))) {
      concerns.push(
        `[RISK|medium] Circular dependency detected but NOT auto-resolved: ${c.join(' → ')} → ${c[0]}. Break it manually before relying on blocks-links for sprint sequencing.`,
      );
      unresolvable.add(sigOf(c));
    }
  }

  if (concerns.length) {
    breakdown.spec_concerns = [...(breakdown.spec_concerns || []), ...concerns];
  }
}

/**
 * Remove shared acceptance criteria that already appear (verbatim, normalized) in
 * a feature's ACs. Such an entry is not a "shared/unassigned" cross-cutting rule —
 * it is a duplicate that shows up redundantly in the Shared-AC assignment panel.
 * Pure + deterministic (exact normalized string match — structure, not meaning);
 * the prompt (rule 12) is the primary defense, this is the safety net. In place.
 */
function dedupeSharedAcceptanceCriteria(breakdown) {
  const shared = breakdown?.shared_acceptance_criteria;
  if (!Array.isArray(shared) || shared.length === 0) return;
  const norm = (s) =>
    String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.;]+$/, '');
  const featureACs = new Set();
  for (const f of breakdown.features || []) {
    for (const ac of f.acceptance_criteria || []) featureACs.add(norm(ac));
  }
  const before = shared.length;
  breakdown.shared_acceptance_criteria = shared.filter((s) => !featureACs.has(norm(s)));
  const removed = before - breakdown.shared_acceptance_criteria.length;
  if (removed > 0) {
    console.log(`[dedupe] removed ${removed} shared AC(s) already present in a feature`);
  }
}

/**
 * Start a breakdown generation job using Anthropic Message Batches API.
 * Returns immediately с jobId after submitting batch (~1-2 sec total).
 * Forge UI polls pollJobStatus за batch lifecycle progress + results.
 *
 * Payload: { pageId, modelMode? }
 *   modelMode: 'primary' (Sonnet 4.6, default) | 'fallback' (Haiku 4.5)
 */
resolver.define('startGeneration', async ({ payload, context }) => {
  const { pageId, modelMode, contextProfileId } = payload || {};
  if (!pageId) return { error: 'No page ID' };

  // Defensive license gate (NEW 2026-06-03). A Paid-via-Atlassian app admits only
  // licensed users by default, so this should never fire in practice — but if a
  // truly-unlicensed invocation reaches the backend (no subscription, no trial),
  // return a clean license_required prompt instead of a misleading not_configured
  // ("no BYOK key" — wrong; the real issue is no license). Fail-open: a license-read
  // glitch must not block a paying user (the key check + Atlassian's platform gate
  // are the backstops).
  try {
    if (getActiveTier(context).key === 'unlicensed') {
      return buildLicenseRequired();
    }
  } catch (e) {
    console.error(`[startGeneration] license check failed (failing open): ${String(e?.message || e)}`);
  }

  // Resolve the Anthropic key by tier (Managed/Advanced ⇒ our key; else the
  // customer's BYOK key). Done BEFORE the content fetch (fail fast) AND before the
  // quota gate, so a Managed user — who has no BYOK key by design — is never
  // wrongly told to "configure a key". keySource is stored on the job below so
  // the poll leg reuses the SAME key the batch was created with.
  const { apiKey, keySource } = await resolveAnthropicKey(context);
  if (!apiKey) {
    if (keySource === 'managed') {
      console.error('[startGeneration] managed key unavailable (MANAGED_ANTHROPIC_KEY not configured)');
      return {
        error: 'managed_unavailable',
        detail:
          'The Managed service is temporarily unavailable. Please contact support@spec2jira.com, or switch to your own Anthropic API key in Settings.',
      };
    }
    return {
      error: 'not_configured',
      detail:
        'Anthropic API key not configured. Ask your Confluence admin to open Settings → Spec2Tickets and provide an Anthropic API key.',
    };
  }

  // Record install provenance (grandfathering signal — see usage.js
  // recordFirstSeen). A second durable capture point besides getUsage: it
  // survives any future UI refactor that drops the usage badge. Idempotent
  // (earliest wins) and fail-open — never block a generation over a metering glitch.
  try {
    const seen = await recordFirstSeen();
    if (seen?.created) {
      console.log(`[install] first seen at ${seen.firstSeenAt} (grandfathering signal recorded via startGeneration)`);
    }
  } catch (e) {
    console.error(`[startGeneration] firstSeen record failed (non-fatal): ${String(e?.message || e)}`);
  }

  // Tier/usage gate (P3a). Fail OPEN — a metering glitch must never block a user.
  // BYOK Pro → unlimited; Managed Pro → per-user fair-use cap (quota_exceeded when
  // over, governed by ENFORCEMENT_MODE — 'meter' never blocks). Unlicensed is
  // already short-circuited above (license_required), so a !allowed here is the
  // Managed cap. The counter is consumed AFTER a successful batch submit below, so
  // a failed submit never burns quota.
  let quota = null;
  try {
    quota = await checkQuota(context);
    if (!quota.allowed) {
      return buildQuotaExceeded(quota);
    }
  } catch (e) {
    console.error(`[startGeneration] quota check failed (failing open): ${String(e?.message || e)}`);
  }

  // Fetch page content (asUser so customer permissions apply).
  let pageFetch;
  try {
    pageFetch = await api
      .asUser()
      .requestConfluence(
        route`/wiki/api/v2/pages/${pageId}?body-format=storage`,
      );
  } catch (e) {
    return { error: 'fetch_threw', detail: String(e?.message || e) };
  }
  if (!pageFetch.ok) {
    const text = await pageFetch.text();
    console.error(`[startGeneration] Confluence HTTP ${pageFetch.status}: ${text.substring(0, 300)}`);
    return {
      error: `confluence_${pageFetch.status}`,
      detail: 'Couldn\'t read this Confluence page (Confluence returned an error). Try reopening the page; if it persists, contact support@spec2jira.com.',
    };
  }
  const pageData = await pageFetch.json();
  const pageContent = pageData.body?.storage?.value || '';
  // Capture the Confluence page version at generation time (v2 returns
  // version: { number }). Threaded onto the job record → getResults so the UI can
  // detect a breakdown generated against an older page version and offer Regenerate
  // (stale-page banner). Number only — never content (keeps "Log End-User Data: No").
  // Fail-soft: an absent/unparseable version yields undefined → the UI shows NO
  // false "edited" banner on missing data (never breaks generation).
  const pageVersion =
    typeof pageData.version?.number === 'number' ? pageData.version.number : undefined;
  if (pageContent.length < 50) {
    return {
      error: 'page_too_small',
      detail: `Page content is too short to extract a meaningful breakdown (${pageContent.length} chars)`,
    };
  }

  const jobId = newJobId();
  const pageTitle = pageData.title || 'Untitled';
  const model = modelMode === 'fallback' ? MODEL_FALLBACK : MODEL_PRIMARY;

  // Persist initial job state
  await kvs.set(`${JOB_KEY_PREFIX}${jobId}`, {
    jobId,
    pageId: String(pageId),
    pageTitle,
    pageVersion,
    status: 'pending',
    model,
    createdAt: new Date().toISOString(),
  });
  // Index page → this job so reopening mid-generation reconnects (not a new batch).
  await kvs.set(`${PAGE_JOB_PREFIX}${String(pageId)}`, { jobId });

  // §8 fix (2026-06-06): snapshot the source page into a SIBLING key so per-Story test-case
  // generation can feed the spec's business-rule tables + decision matrices + concrete thresholds
  // (the values the ACs reference by ID). A sibling key (not the job record) keeps the job lean —
  // the job is read on every poll/reconnect; this snapshot is read once, only at test-gen. Captured
  // in THIS execution from the SAME page object → coherent with the breakdown's stamped ACs (no
  // staleness). Byte-capped under the ~240KB KVS limit. Fail-soft: a snapshot failure must never
  // block generation (test-gen then falls back to today's no-source behaviour).
  try {
    // Cap by BYTES, not chars (§13 gate fix 2026-06-06): KVS limits the serialized value to ~240KB,
    // and a char cap overflows on multi-byte scripts — Cyrillic ~2B, CJK ~3B/char, so 120K chars ≈
    // 240-360KB → kvs.set throws → silent fallback to no-source on exactly the dense/non-ASCII specs
    // this fix targets. 80K chars aligns with the feed cap (TC_SPEC_SOURCE_MAX_CHARS — storing more is
    // unused); the ~180KB byte budget (headroom under 240KB for the wrapper) is the hard guard.
    const TC_SNAP_MAX_CHARS = 80000;
    const TC_SNAP_MAX_BYTES = 180000;
    const enc = new TextEncoder();
    const full = String(pageContent || '');
    let snapContent = full.slice(0, TC_SNAP_MAX_CHARS);
    if (enc.encode(snapContent).length > TC_SNAP_MAX_BYTES) {
      // Binary-search the largest char-prefix whose UTF-8 byte length fits the budget.
      let lo = 0, hi = snapContent.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (enc.encode(snapContent.slice(0, mid)).length <= TC_SNAP_MAX_BYTES) lo = mid; else hi = mid - 1;
      }
      snapContent = snapContent.slice(0, lo);
    }
    await kvs.set(`${PAGE_SNAP_PREFIX}${jobId}`, {
      jobId,
      pageId: String(pageId),
      pageVersion,
      capturedAt: new Date().toISOString(),
      content: snapContent,
      truncatedSnapshot: full.length > snapContent.length,
    });
    console.log(`[startGeneration] page snapshot written for job ${jobId} (${snapContent.length} chars${full.length > snapContent.length ? ', byte-trimmed' : ''}) → enables §7-aware test generation`);
  } catch (e) {
    console.warn(`[startGeneration] page snapshot failed (non-fatal; test-gen falls back to no-source): ${String(e?.message || e)}`);
  }

  // Resolve the SELECTED Project Context profile to enrich the generation. A
  // workspace may span multiple projects, so the user picks which context applies —
  // we never apply one silently (a wrong-project context is worse than none).
  // Fail-soft: a settings/profile glitch must never block a BYOK generation; we just
  // generate from the spec alone.
  let projectContext = '';
  try {
    const settings = await loadSettings();
    const profiles = normalizeContextProfiles(settings);
    if (contextProfileId && contextProfileId !== 'none') {
      const match = profiles.find((p) => p.id === contextProfileId);
      if (match) projectContext = match.context || '';
    }
    // Remember the choice for this page so a re-run pre-selects it (the "easy" half).
    if (contextProfileId) {
      await kvs.set(`${PAGE_CONTEXT_PREFIX}${String(pageId)}`, { profileId: contextProfileId });
    }
  } catch (e) {
    console.warn(`[startGeneration] context profile resolve failed (non-fatal): ${String(e?.message || e)}`);
  }

  // Submit batch к Anthropic (returns batch_id immediately)
  const submitResult = await submitBreakdownBatch({
    pageTitle,
    pageContent,
    customId: jobId,
    model,
    useCaching: true,
    projectContext,
    apiKeyOverride: apiKey, // Managed ⇒ our key; BYOK ⇒ customer's (see resolveAnthropicKey)
  });

  if (submitResult.error) {
    console.error(
      `[startGeneration] batch submit failed: ${submitResult.error} | ${submitResult.detail}`,
    );
    await kvs.set(`${JOB_KEY_PREFIX}${jobId}`, {
      jobId,
      pageId: String(pageId),
      pageTitle,
      status: 'failed',
      createdAt: new Date().toISOString(),
      error: submitResult.error,
      detail: submitResult.detail,
    });
    return {
      error: submitResult.error,
      detail: submitResult.detail,
    };
  }

  // Successfully submitted — store batchId с job state
  await kvs.set(`${JOB_KEY_PREFIX}${jobId}`, {
    jobId,
    pageId: String(pageId),
    pageTitle,
    pageVersion,
    status: 'batched',
    model,
    batchId: submitResult.batchId,
    batchStatus: submitResult.status, // 'in_progress'
    createdAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    expiresAt: submitResult.expiresAt,
    keySource, // 'managed'|'byok' — the poll/fetch/cycle-repair legs MUST reuse
    //            the SAME key the batch was created with (Anthropic batches are
    //            scoped to the creating key). See pollJobStatus.
  });

  // Consume one unit of quota — only now that the batch submitted successfully
  // (a failed submit above returned early and never reaches here). Throw-safe:
  // the generation already succeeded, so a metering write failure must not break
  // the user's response — log it loudly instead (POLICY §11: never silent).
  let usageInfo = null;
  if (quota) {
    try {
      const used = await consumeQuota(quota.usageKey);
      usageInfo = {
        tier: quota.tier,
        used,
        limit: quota.limit,
        remaining: quota.limit === null ? null : Math.max(0, quota.limit - used),
        resetsAt: quota.resetsAt,
      };
    } catch (e) {
      console.error(`[startGeneration] quota consume failed (generation still OK): ${String(e?.message || e)}`);
    }
  }

  console.log(
    `[startGeneration] jobId=${jobId} batchId=${submitResult.batchId} status=submitted${usageInfo ? ` usage=${usageInfo.used}/${usageInfo.limit}(${usageInfo.tier})` : ''}`,
  );
  return {
    jobId,
    job_id: jobId,
    status: 'batched',
    batchId: submitResult.batchId,
  };
});

/**
 * Poll the status of an active generation job.
 * Returns the current job state stored в KVS.
 * Use after startGeneration; UI polls every 3-5 seconds.
 */
resolver.define('pollJobStatus', async ({ payload }) => {
  const jobId = payload?.jobId;
  if (!jobId) return { error: 'No job ID' };
  const job = await kvs.get(`${JOB_KEY_PREFIX}${jobId}`);
  if (!job) {
    return { error: 'not_found', detail: `Job ${jobId} not found (may have been purged)` };
  }

  // Reuse the SAME key the batch was created with (Anthropic batches are scoped
  // to their creating key): Managed jobs poll/fetch/repair with OUR key, BYOK
  // with the customer's. job.keySource is stamped at submit; jobs created before
  // this change carry no keySource → default to 'byok' (back-compatible).
  const jobApiKey = await anthropicKeyForSource(job.keySource || 'byok');

  // Terminal states return immediately
  if (job.status === 'completed' || job.status === 'failed') {
    return job;
  }

  // Active batch states — poll Anthropic for current status
  if (job.status === 'batched' && job.batchId) {
    // §13 review fix: a Managed job whose server key vanished mid-flight
    // (rotated/unset) must NOT fall through to the customer's BYOK key —
    // anthropicKeyForSource('managed') → null, and pollBatchStatus/fetchBatchResults
    // do `apiKeyOverride || getStoredApiKey()`. Soft-fail (stay 'batched', show a
    // message, retry next cycle → self-heals when the key is restored) instead of a
    // silent wrong-key poll. POLICY §11: never a silent wrong-key path.
    if (job.keySource === 'managed' && !jobApiKey) {
      console.error(`[pollJobStatus] jobId=${jobId} managed key unset mid-flight (MANAGED_ANTHROPIC_KEY) — soft-failing, will retry`);
      return {
        ...job,
        phase: 'Managed service temporarily unavailable — retrying. If this persists, please contact support@spec2jira.com.',
      };
    }

    const pollResult = await pollBatchStatus(job.batchId, jobApiKey);

    if (pollResult.error) {
      console.error(
        `[pollJobStatus] jobId=${jobId} batchId=${job.batchId} poll failed: ${pollResult.error}`,
      );
      // Soft fail — return current job state; next poll cycle will retry.
      return {
        ...job,
        phase: `Batch poll error: ${pollResult.error}`,
      };
    }

    const counts = pollResult.requestCounts || {};
    const totalRequests =
      (counts.processing || 0) +
      (counts.succeeded || 0) +
      (counts.errored || 0) +
      (counts.canceled || 0) +
      (counts.expired || 0);

    // Batch still processing — return progress info
    if (pollResult.status === 'in_progress' || pollResult.status === 'canceling') {
      return {
        ...job,
        batchStatus: pollResult.status,
        phase: 'Anthropic processing batch...',
        progress: totalRequests > 0 ? (counts.succeeded || 0) / totalRequests : 0,
        request_counts: counts,
      };
    }

    // Batch ended — fetch + parse results
    if (pollResult.status === 'ended') {
      if (!pollResult.resultsUrl) {
        const failed = {
          ...job,
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: 'no_results_url',
          detail: 'Batch ended but Anthropic returned no results_url.',
        };
        await kvs.set(`${JOB_KEY_PREFIX}${jobId}`, failed);
        return failed;
      }

      const fetchResult = await fetchBatchResults(
        pollResult.resultsUrl,
        jobId, // custom_id ≡ jobId
        jobApiKey, // Managed ⇒ our key (same as submit); BYOK ⇒ customer's
      );

      if (fetchResult.error) {
        const failed = {
          ...job,
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: fetchResult.error,
          detail: fetchResult.detail,
          usage: fetchResult.usage || null,
        };
        await kvs.set(`${JOB_KEY_PREFIX}${jobId}`, failed);
        return failed;
      }

      // Success — compute cost + persist completed state
      const costEstimate = estimateCost(fetchResult.usage, fetchResult.model);
      const elapsedMs =
        Date.now() - new Date(job.submittedAt || job.createdAt).getTime();

      // Synthesize Epic от Confluence page title + spec summary.
      // v3 schema doesn't emit а top-level `epic` field; Option A push pattern
      // (1 Epic + N Stories) requires we manufacture it here. push_handler.js
      // reads `breakdown.epic.{summary, description}` directly.
      const breakdown = fetchResult.breakdown || {};
      const specSummary = breakdown?.metadata?.spec_summary || '';
      if (!breakdown.epic) {
        breakdown.epic = {
          summary: job.pageTitle || 'Spec Breakdown',
          description: specSummary,
        };
      }

      // Verify/repair the dependency graph BEFORE persisting: detect cycles
      // (pure) + cut the softest edge per cycle (tiny LLM, bounded) + surface
      // unresolved ones as spec_concerns. A silent cycle breaks downstream sprint
      // sequencing and creates false confidence (§11). Fail-safe — non-fatal.
      try {
        // Cycle-repair LLM call reuses the job's key (Managed ⇒ our key, same as submit).
        await verifyAndRepairCycles(breakdown, jobApiKey, fetchResult.model);
      } catch (e) {
        console.error(`[pollJobStatus] cycle repair failed (non-fatal): ${String(e?.message || e)}`);
      }

      // Drop shared ACs that duplicate a feature's AC (redundant in the assign
      // panel — rule 12). Pure dedupe; non-fatal.
      try {
        dedupeSharedAcceptanceCriteria(breakdown);
      } catch (e) {
        console.error(`[pollJobStatus] shared-AC dedupe failed (non-fatal): ${String(e?.message || e)}`);
      }

      const completed = {
        ...job,
        status: 'completed',
        completedAt: new Date().toISOString(),
        breakdown,
        usage: fetchResult.usage,
        model: fetchResult.model,
        elapsedMs,
        stop_reason: fetchResult.stop_reason,
        // Partial-recovery flag когато output hit max_tokens but features salvaged.
        ...(fetchResult.truncated
          ? { truncated: true, truncation_note: fetchResult.truncation_note }
          : {}),
      };
      await kvs.set(`${JOB_KEY_PREFIX}${jobId}`, completed);

      console.log(
        `[pollJobStatus] jobId=${jobId} batchId=${job.batchId} COMPLETED features=${(breakdown.features || []).length} elapsed=${elapsedMs}ms cost=$${costEstimate.total_usd.toFixed(4)}${fetchResult.truncated ? ' [TRUNCATED-PARTIAL]' : ''}`,
      );
      return completed;
    }

    // Unknown batch status
    return {
      ...job,
      batchStatus: pollResult.status,
      phase: `Unknown batch status: ${pollResult.status}`,
    };
  }

  // pending / unknown state — just return as-is
  return job;
});

/**
 * Fetch the completed breakdown result for a job.
 * Returns the breakdown object directly, OR error if job not complete.
 */
resolver.define('getResults', async ({ payload }) => {
  const jobId = payload?.jobId;
  if (!jobId) return { error: 'No job ID' };
  const job = await kvs.get(`${JOB_KEY_PREFIX}${jobId}`);
  if (!job) return { error: 'not_found' };
  if (job.status === 'failed') {
    return { error: job.error || 'failed', detail: job.detail || 'Job failed' };
  }
  if (job.status !== 'completed') {
    return { error: 'not_ready', detail: `Job status: ${job.status}` };
  }
  // tcStatus: lets the reconnecting frontend know test cases exist without a 2nd round-trip.
  const tcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`).catch(() => null);
  return {
    breakdown: job.breakdown,
    usage: job.usage,
    model: job.model,
    // The Confluence page version this breakdown was generated against (captured by
    // startGeneration). The UI compares it to the page's CURRENT version on reconnect
    // to surface a stale-page banner + Regenerate. undefined for breakdowns created
    // before this was added → the UI treats unknown as "not stale" (no false banner).
    pageVersion: job.pageVersion,
    // Forward the partial-recovery signal so the UI can warn the user that the
    // breakdown is incomplete (output hit the cap and was salvaged). Both are
    // undefined on a normal complete run.
    truncated: job.truncated,
    truncation_note: job.truncation_note,
    // tcStatus: 'none' | 'pending' | 'batched' | 'completed' | 'failed'
    tcStatus: tcJob ? tcJob.status : 'none',
  };
});

/**
 * Get the current/most-recent generation job state for a page.
 * Used by Dashboard к see whether page has been processed recently.
 *
 * NOTE: v3.0.0 does NOT maintain a global page→jobId index by default.
 * For now this returns 'idle' status. Future enhancement: index latest
 * jobId per page-id в KVS.
 */
resolver.define('getGenerationStatus', async ({ payload }) => {
  // Reconnect support: map page → its latest job (PAGE_JOB_PREFIX index, written
  // by startGeneration) and report its status so reopening a page resumes the
  // right screen instead of offering a fresh Generate (which spawned a duplicate
  // batch — bug 2026-05-30):
  //   - pending/batched → UI reconnects to the generating screen + resumes poll
  //   - completed       → UI reopens the result (BreakdownEditor + Dashboard signals)
  //   - failed/unknown  → 'idle' → fresh Ready screen
  const pageId = payload?.pageId ? String(payload.pageId) : null;
  if (!pageId) return { status: 'idle' };

  const ref = await kvs.get(`${PAGE_JOB_PREFIX}${pageId}`);
  if (!ref || !ref.jobId) return { status: 'idle' };

  const job = await kvs.get(`${JOB_KEY_PREFIX}${ref.jobId}`);
  if (!job) return { status: 'idle' };

  if (job.status === 'completed') {
    // tcStatus: lets the reconnecting frontend know test cases exist without a 2nd round-trip.
    const tcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${ref.jobId}`).catch(() => null);
    return { status: 'completed', job_id: job.jobId, tcStatus: tcJob ? tcJob.status : 'none' };
  }
  if (job.status === 'pending' || job.status === 'batched') {
    const startedAt = job.submittedAt || job.createdAt;
    const elapsed_seconds = startedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
      : 0;
    return { status: job.status, job_id: job.jobId, elapsed_seconds };
  }
  return { status: 'idle' };
});

/**
 * getUsage — current month's breakdown usage + tier, for the UI badge / upgrade
 * nudge. Read-only (does not consume). Throw-safe: a metering glitch returns a
 * benign null so the UI can simply hide the badge rather than error.
 */
resolver.define('getUsage', async ({ context }) => {
  // Capture the install's first-seen timestamp (grandfathering signal — see
  // usage.js recordFirstSeen). Independent try/catch so a glitch in one never
  // suppresses the other; getUsage runs on app open, the broadest capture point.
  let firstSeenAt = null;
  try {
    const seen = await recordFirstSeen();
    firstSeenAt = seen?.firstSeenAt || null;
    if (seen?.created) {
      console.log(`[install] first seen at ${seen.firstSeenAt} (grandfathering signal recorded via getUsage)`);
    }
  } catch (e) {
    console.error(`[getUsage] firstSeen record failed (non-fatal): ${String(e?.message || e)}`);
  }
  try {
    const quota = await checkQuota(context);
    return {
      ...quota,
      pricing: pricingTable(),
      // Install provenance for the customer-facing Account panel (the
      // grandfathering signal, surfaced). null until the first capture.
      memberSince: firstSeenAt,
      memberSinceLabel: firstSeenAt ? formatResetDate(firstSeenAt) : null,
    };
  } catch (e) {
    console.error(`[getUsage] failed: ${String(e?.message || e)}`);
    return { error: 'usage_unavailable' };
  }
});

/**
 * purgeJob — data minimization: delete a generation job's stored page content +
 * breakdown (and its page→job index) once it is no longer needed (after the user
 * pushes to JIRA). Best-effort, non-fatal. Backs the privacy policy claim that
 * page content is removed after processing rather than retained indefinitely.
 */
resolver.define('purgeJob', async ({ payload }) => {
  const jobId = payload?.jobId;
  if (!jobId) return { ok: false };
  try {
    const job = await kvs.get(`${JOB_KEY_PREFIX}${jobId}`);
    if (job && job.pageId) {
      await kvs.delete(`${PAGE_JOB_PREFIX}${String(job.pageId)}`);
    }
    await kvs.delete(`${JOB_KEY_PREFIX}${jobId}`);
    // Delete the source-page snapshot (the §8 test-gen feed stores a full page-content copy in
    // pagesnap:<jobId>). It IS the privacy-critical item this purge exists to remove — without
    // this it would linger ~180KB/job indefinitely, falsifying the "page content removed after
    // processing" privacy claim (deep-audit 2026-06-06). Fail-open like the rest.
    await kvs.delete(`${PAGE_SNAP_PREFIX}${jobId}`);

    // P4 audit B/Finding-6: also purge test-case KVS entries so generated cases
    // don't linger after the user's content has been pushed. Fail-open: a purge
    // failure must never error the push completion (the page content is the
    // privacy-critical item; test cases are derived data, bounded by the same
    // instance's KVS). tcregenjob has no wildcard key pattern — leave a TODO.
    try {
      const tcJob = await kvs.get(`tcjob:${jobId}`);
      if (tcJob && typeof tcJob.total === 'number' && tcJob.total > 0) {
        const perStoryKeys = Array.from({ length: tcJob.total }, (_, i) => `testcases:${jobId}:${i}`);
        await Promise.all(perStoryKeys.map((k) => kvs.delete(k).catch(() => {})));
      }
      await kvs.delete(`tcjob:${jobId}`);
      // TODO: tcregenjob:<jobId>:<storyIdx> entries have no wildcard — each
      // regen job is keyed per-story and short-lived; leave cleanup for a
      // future housekeeping trigger if KVS usage becomes a concern.
    } catch (tcErr) {
      console.warn(`[purgeJob] tc KVS purge failed (non-fatal): ${String(tcErr?.message || tcErr)}`);
    }

    console.log(`[purgeJob] removed job ${jobId} (page content + breakdown + test cases) post-push`);
    return { ok: true };
  } catch (e) {
    console.error(`[purgeJob] failed (non-fatal): ${String(e?.message || e)}`);
    return { ok: false };
  }
});

// ════════════════════════════════════════════════════════════
// JIRA PUSH — chunked asUser() resolver (startPush + looped pushStep); 2026-05-30
// ════════════════════════════════════════════════════════════

/**
 * startPush — begin a chunked JIRA push session.
 *
 * ⚠ 2026-05-30: chunked-resolver pattern. JIRA bulk create е slow (~0.85
 * sec/issue); a single synchronous push of 200 items exceeds the 25-sec
 * resolver timeout. asUser() е unavailable in async consumers, so we chunk:
 * startPush does project lookup + Epic create + stores а session; the UI then
 * loops pushStep until done, each step doing one bounded JIRA batch.
 *
 * Returns { ok, sessionId, phase, totals } OR { error, detail }.
 */
resolver.define('startPush', async ({ payload }) => {
  const { breakdown, projectKey: payloadProjectKey, jobId } = payload || {};
  if (!breakdown) {
    return { error: 'no_breakdown', detail: 'No breakdown payload provided' };
  }

  // No license gate here: every accessing user is licensed (the in-app Free /
  // unlicensed-access path was removed 2026-06-03 — evaluation is the 30-day
  // Atlassian trial, which reads as an active license). The JIRA push uses
  // asUser().requestJira (gotcha #3); a truly-unlicensed user can't reach this
  // surface at all (Atlassian's platform gate), and startGeneration already
  // returns license_required defensively upstream.
  const projectKey = await getProjectKey(payloadProjectKey);
  if (!projectKey) {
    return {
      error: 'no_project_key',
      detail:
        'No Jira project key configured. Open Settings → Spec2Tickets and set Default Jira Project Key.',
    };
  }

  // Optional admin-configured required custom fields (advanced).
  const settings = await loadSettings();
  const cfParse = parseRequiredCustomFields(settings.requiredCustomFieldsJson);
  const customFields = cfParse.ok ? cfParse.value : null;

  let outcome;
  try {
    outcome = await startPushSession(breakdown, projectKey, customFields, jobId || null);
  } catch (e) {
    console.error(`[startPush] threw: ${String(e?.message || e)}`);
    return { error: 'push_exception', detail: String(e?.message || e) };
  }
  if (!outcome.ok) {
    return { error: outcome.error, detail: outcome.detail };
  }
  return {
    session_id: outcome.sessionId,
    phase: outcome.phase,
    totals: outcome.totals,
    epic_key: outcome.epicKey,
    progress: 0,
  };
});

/**
 * pushStep — advance a push session by one bounded chunk. UI loops this until
 * { done: true }. Each call stays under the 25-sec resolver timeout.
 * Returns { done, phase, progress, counts } OR { done:true, result, partial }
 * OR { error, detail }.
 */
resolver.define('pushStep', async ({ payload }) => {
  // A pushStep session exists ONLY if startPush created it in KVS, and the app is
  // licensed-only (Paid-via-Atlassian default) so every caller here is a licensed
  // user. A forged sessionId returns session_not_found, and asUser() is the ultimate
  // 401 backstop. Preserve this session-only-from-startPush invariant if a second
  // session creator is ever added (§13 review note).
  const sessionId = payload?.sessionId;
  if (!sessionId) return { error: 'no_session', detail: 'No session id provided.' };

  let outcome;
  try {
    outcome = await pushSessionStep(sessionId);
  } catch (e) {
    console.error(`[pushStep] threw: ${String(e?.message || e)}`);
    return { error: 'push_exception', detail: String(e?.message || e) };
  }
  if (!outcome.ok) {
    return { error: outcome.error, detail: outcome.detail };
  }
  if (outcome.done) {
    return {
      done: true,
      status: 'completed',
      result: outcome.result,
      partial: outcome.partial || false,
    };
  }
  return {
    done: false,
    phase: outcome.phase,
    progress: outcome.progress,
    counts: outcome.counts,
  };
});

// ════════════════════════════════════════════════════════════════
// TEST-CASE GENERATION — Sonnet 4.6 + Anthropic Batches API (P3)
//
// Architecture mirrors the breakdown batch lifecycle exactly (startGeneration →
// pollJobStatus → getResults). Cloned per TESTCASE-GENERATION-DESIGN.md §3.
// All 12 §5 mitigations are wired — see inline comments marked #1-#12.
// ════════════════════════════════════════════════════════════════

/**
 * startTestCaseGeneration — submit a test-case batch for all Stories in a job.
 *
 * Payload: { jobId, breakdown? }
 *   jobId: the completed breakdown job whose features[] we generate test cases for.
 *   breakdown: the BA's Review-EDITED breakdown (legacy capabilities shape, as the push
 *     receives it). #1 fix — reverse-adapted via flattenBreakdown and persisted into
 *     job.breakdown so test-gen + per-Story regenerate + reconnect + the push AC-hash embed
 *     all read ONE consistent EDITED list. Absent (old client) → falls back to the stored breakdown.
 *
 * Mitigations wired:
 *   #2 (idempotency): if tcjob already exists in batched/completed state, return it.
 *   #5 (keySource stamp): records keySource on tcjob; poll leg reuses the same key.
 *   #7 (story stamp): records stampedStories {idx,name,acceptance_criteria} (lean coverage inputs) at submit time.
 *   #8 (BYOK quota): consume-on-success; BYOK always allowed; Managed = Phase 2.
 */
resolver.define('startTestCaseGeneration', async ({ payload, context }) => {
  const { jobId } = payload || {};
  if (!jobId) return { error: 'no_job_id', detail: 'jobId is required.' };

  // Defensive license gate (mirrors startGeneration)
  try {
    if (getActiveTier(context).key === 'unlicensed') return buildLicenseRequired();
  } catch (e) {
    console.error(`[startTCGen] license check failed (failing open): ${String(e?.message || e)}`);
  }

  // Resolve the Anthropic key by tier (#5: keySource-stamp enables same-key reuse at poll)
  const { apiKey, keySource } = await resolveAnthropicKey(context);
  if (!apiKey) {
    if (keySource === 'managed') {
      console.error('[startTCGen] managed key unavailable (MANAGED_ANTHROPIC_KEY not configured)');
      return { error: 'managed_unavailable', detail: 'The Managed service is temporarily unavailable. Please contact support@spec2jira.com, or switch to your own Anthropic API key in Settings.' };
    }
    return { error: 'not_configured', detail: 'Anthropic API key not configured. Ask your Confluence admin to open Settings → Spec2Tickets and provide an Anthropic API key.' };
  }

  // Quota gate (mirrors startGeneration; BYOK = unlimited; Managed = per-user cap)
  let quota = null;
  try {
    quota = await checkQuota(context);
    if (!quota.allowed) return buildQuotaExceeded(quota);
  } catch (e) {
    console.error(`[startTCGen] quota check failed (failing open): ${String(e?.message || e)}`);
  }

  // Load the completed breakdown job
  const job = await kvs.get(`${JOB_KEY_PREFIX}${jobId}`);
  if (!job) return { error: 'not_found', detail: `Breakdown job ${jobId} not found.` };
  if (job.status !== 'completed') {
    return { error: 'breakdown_not_ready', detail: `Breakdown job is in status '${job.status}'; it must be 'completed' before generating test cases.` };
  }

  // ⭐ #1 fix (edited-state) — consume the BA's Review-EDITED breakdown, not the pristine one.
  // The edits arrive in payload.breakdown (the SAME edited, legacy-shaped breakdown the push
  // receives). flattenBreakdown reverse-adapts it to v3-native features[] (the exact function +
  // input the push uses → identical ACs → the push AC-hash embed is guaranteed to match). We
  // persist the edited features back into the canonical job.breakdown so EVERY downstream reader —
  // this resolver, per-Story regenerate (~line 2220), getResults/reconnect, and the push embed —
  // reads ONE consistent edited list (single source of truth). All other job + breakdown fields
  // (metadata, shared_acceptance_criteria — NOT editable via the breakdown JSON — pageVersion,
  // usage, model, truncated, …) are preserved. Fail-SOFT: a missing/empty/malformed edited list
  // never overwrites a good breakdown (POLICY §11 — never silently destroy data); keep the stored one.
  if (payload && payload.breakdown) {
    try {
      const { features: editedFeatures } = flattenBreakdown(payload.breakdown);
      if (Array.isArray(editedFeatures) && editedFeatures.length > 0) {
        job.breakdown = { ...job.breakdown, features: editedFeatures };
        await kvs.set(`${JOB_KEY_PREFIX}${jobId}`, { ...job });
      } else {
        console.warn(`[startTCGen] edited breakdown flattened to 0 features — keeping stored breakdown for ${jobId}`);
      }
    } catch (e) {
      console.warn(`[startTCGen] persist edited breakdown failed (keeping stored): ${String(e?.message || e)}`);
    }
  }

  const stories = (job.breakdown && Array.isArray(job.breakdown.features)) ? job.breakdown.features : [];
  if (stories.length === 0) {
    return { error: 'no_stories', detail: 'The breakdown has no features/stories to generate test cases for.' };
  }

  // #2 — IDEMPOTENCY: if a tcjob already exists and is batched or completed, return it
  // immediately without re-submitting (avoids 2× cost on double-click or UI re-mount).
  const existingTcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`);
  if (existingTcJob && (existingTcJob.status === 'batched' || existingTcJob.status === 'completed')) {
    // Idempotent return ONLY when the breakdown is UNCHANGED since these cases were generated (a
    // double-click / re-mount → avoid 2× cost). If the BA EDITED the breakdown (ACs differ from the
    // stamped set), the existing cases are STALE → fall through and RE-GENERATE: this is the working
    // refresh behind the #1 "edited since generation" warning (user-triggered — the BA clicks Regenerate;
    // never auto). The normAC AC-signature matches the push's embed decision, so a trivial reword the
    // push would still embed does NOT force a costly re-generate. `stories` = the just-persisted EDITED list.
    const acSig = (storyList) => (Array.isArray(storyList) ? storyList : [])
      .flatMap((s) => (Array.isArray(s && s.acceptance_criteria) ? s.acceptance_criteria : []))
      .map(normAC).sort().join('|');
    if (acSig(existingTcJob.stampedStories) === acSig(stories)) {
      console.log(`[startTCGen] idempotent return — tcjob ${jobId} already ${existingTcJob.status} (breakdown unchanged)`);
      return { jobId, status: existingTcJob.status, total: existingTcJob.total };
    }
    console.log(`[startTCGen] breakdown edited since generation — re-generating tcjob ${jobId}`);
    // fall through → re-stamp the edited ACs + submit a fresh batch
  }

  const total = stories.length;
  const createdAt = new Date().toISOString();

  // #7 — stamp the story list (idx + name + acceptance_criteria) at submit time. These ACs come
  // from the EDITED breakdown persisted just above (#1 fix), so coverage is computed against the
  // BA's edited ACs — and the push AC-hash embed (which hashes tcjob.stampedStories) matches the
  // pushed (edited) features. P5 reconciles added/deleted stories.
  // LEAN: only {idx, name, acceptance_criteria} — the only fields computeCoverage uses.
  const stampedStories = stories.map((s, i) => ({
    idx: i,
    name: s && (s.name || `Story ${i}`),
    acceptance_criteria: Array.isArray(s && s.acceptance_criteria) ? s.acceptance_criteria : [],
  }));

  // Write initial tcjob record (status 'pending' → updated to 'batched' on success).
  // pageVersion is stamped here so getTestCases can read it without a separate job lookup.
  const pageVersion = job.pageVersion;
  await kvs.set(`${TC_JOB_KEY_PREFIX}${jobId}`, {
    jobId,
    status: 'pending',
    total,
    keySource,
    stampedStories,
    pageVersion,
    createdAt,
  });

  const sharedACs = (job.breakdown && Array.isArray(job.breakdown.shared_acceptance_criteria))
    ? job.breakdown.shared_acceptance_criteria
    : [];
  const specSummary = (job.breakdown && job.breakdown.metadata && job.breakdown.metadata.spec_summary) || '';

  // §8 fix: feed the source-page snapshot (the business rules the ACs reference by ID) to test-gen.
  const specSourceText = await resolveSpecSourceText(jobId, job);

  // Submit the N-request batch to Anthropic
  const specConcerns = (job.breakdown && Array.isArray(job.breakdown.spec_concerns)) ? job.breakdown.spec_concerns : [];
  const submitResult = await submitTestCaseBatch({ stories, sharedAcceptanceCriteria: sharedACs, specConcerns, specSummary, specSourceText, apiKey });
  if (submitResult.error) {
    console.error(`[startTCGen] batch submit failed: ${submitResult.error} | ${submitResult.detail}`);
    await kvs.set(`${TC_JOB_KEY_PREFIX}${jobId}`, {
      jobId, status: 'failed', total, keySource, stampedStories, createdAt,
      error: submitResult.error, detail: submitResult.detail,
    });
    return { error: submitResult.error, detail: submitResult.detail };
  }

  // #8 — consume quota on success. BYOK (launch) = no-op (unlimited).
  // Managed Phase 2 MUST decide test-case metering (separate cap vs counts-as-a-unit)
  // — NOT settled; consuming on success here is the loss-safe default.
  if (quota) {
    try {
      await consumeQuota(quota.usageKey);
    } catch (e) {
      console.error(`[startTCGen] quota consume failed (generation still OK): ${String(e?.message || e)}`);
    }
  }

  // #5 — persist keySource + #7 persist stampedStories + batchId + pageVersion
  await kvs.set(`${TC_JOB_KEY_PREFIX}${jobId}`, {
    jobId,
    status: 'batched',
    total,
    keySource,
    stampedStories,
    pageVersion,
    batchId: submitResult.batchId,
    batchStatus: submitResult.status,
    createdAt,
    submittedAt: new Date().toISOString(),
    expiresAt: submitResult.expiresAt,
  });

  console.log(`[startTCGen] jobId=${jobId} batchId=${submitResult.batchId} stories=${total}`);
  return { jobId, status: 'batched', total };
});

/**
 * pollTestCaseStatus — poll the Anthropic batch for a test-case generation job.
 * When the batch ends, fetches the JSONL, writes per-story KVS keys via Promise.all,
 * and marks the tcjob completed. Terminal states return immediately.
 *
 * Mitigations wired:
 *   #3 (partial-failure sentinel): non-succeeded rows store an explicit {error} key.
 *   #4 (Promise.all writes): never a sequential loop — all N KVS writes in parallel.
 *   #5 (managed key guard): soft-fail if the managed key vanished mid-flight.
 *   #10 (240KB guard): per-story payloads go to testcases:<jobId>:<idx>, never merged into tcjob.
 */
resolver.define('pollTestCaseStatus', async ({ payload }) => {
  const { jobId } = payload || {};
  if (!jobId) return { error: 'no_job_id', detail: 'jobId is required.' };

  const tcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`);
  if (!tcJob) return { error: 'not_found', detail: `tcjob ${jobId} not found.` };

  // Terminal states — return immediately (avoid redundant Anthropic polls)
  if (tcJob.status === 'completed' || tcJob.status === 'failed') return tcJob;

  // Re-resolve the key via the STAMPED keySource (same key the batch was created with —
  // #5: Anthropic batches are scoped to their creating key; never re-derive from the
  // current license which may have changed since submit, e.g. trial expiring).
  const jobApiKey = await anthropicKeyForSource(tcJob.keySource || 'byok');

  // #5 — Key-vanish guard (generalized for any source): soft-fail so the UI retries on
  // the next poll cycle; self-heals when the key is restored. Managed = admin restores
  // MANAGED_ANTHROPIC_KEY; BYOK = user re-adds their key in Settings. Never hard-fail on
  // a transient absence — the batch is still in-flight at Anthropic.
  if (!jobApiKey) {
    const msg = (tcJob.keySource === 'managed')
      ? 'Managed service temporarily unavailable — retrying. If this persists, please contact support@spec2jira.com.'
      : 'Your Anthropic API key is unavailable — re-add it in Settings; generation will resume.';
    console.error(`[pollTCStatus] jobId=${jobId} keySource=${tcJob.keySource} key unavailable — soft-failing`);
    return { ...tcJob, phase: msg };
  }

  if (tcJob.status !== 'batched' || !tcJob.batchId) return tcJob; // pending or unknown

  const pollResult = await pollTestCaseBatch(tcJob.batchId, jobApiKey);
  if (pollResult.error) {
    console.error(`[pollTCStatus] jobId=${jobId} batchId=${tcJob.batchId} poll failed: ${pollResult.error}`);
    // Soft-fail — return current state; next poll cycle will retry
    return { ...tcJob, phase: `Batch poll error: ${pollResult.error}` };
  }

  const counts = pollResult.requestCounts || {};
  const totalRequests =
    (counts.processing || 0) + (counts.succeeded || 0) + (counts.errored || 0) +
    (counts.canceled || 0) + (counts.expired || 0);

  // Still processing — return progress
  if (pollResult.status === 'in_progress' || pollResult.status === 'canceling') {
    return {
      ...tcJob,
      batchStatus: pollResult.status,
      phase: 'Anthropic processing test cases...',
      progress: totalRequests > 0 ? ((counts.succeeded || 0) + (counts.errored || 0)) / totalRequests : 0,
      request_counts: counts,
    };
  }

  // Batch ended — fetch JSONL + parse all N results
  if (pollResult.status === 'ended') {
    if (!pollResult.resultsUrl) {
      const failed = { ...tcJob, status: 'failed', completedAt: new Date().toISOString(), error: 'no_results_url', detail: 'Batch ended but Anthropic returned no results_url.' };
      await kvs.set(`${TC_JOB_KEY_PREFIX}${jobId}`, failed);
      return failed;
    }

    const fetchResult = await fetchTestCaseResults(pollResult.resultsUrl, tcJob.stampedStories, jobApiKey);
    if (fetchResult.error) {
      const failed = { ...tcJob, status: 'failed', completedAt: new Date().toISOString(), error: fetchResult.error, detail: fetchResult.detail };
      await kvs.set(`${TC_JOB_KEY_PREFIX}${jobId}`, failed);
      return failed;
    }

    const { perStory } = fetchResult;

    // #4 — Promise.all: write all N per-story KVS keys in parallel (never sequential —
    // 25s resolver limit; N ≤ ~50 stories is safe; chunk if spec ever exceeds ~100).
    // #3 — explicit sentinel for error rows: the KVS entry ALWAYS exists (success or error),
    // so the P5 screen can detect "failed — regenerate" rather than rendering blank.
    // #10 — payloads go to testcases:<jobId>:<idx>, never merged into tcjob.
    await Promise.all(
      perStory.map((entry) => {
        const stamped = (tcJob.stampedStories || []).find((s) => s && s.idx === entry.storyIdx);
        const storyName = (stamped && stamped.name) || '';
        const kvsValue = entry.error
          ? { storyIdx: entry.storyIdx, storyName, error: entry.error, detail: entry.detail }
          : { storyIdx: entry.storyIdx, storyName, result: entry.result, coverage: entry.coverage };
        return kvs.set(`${TC_STORY_KEY_PREFIX}${jobId}:${entry.storyIdx}`, kvsValue);
      }),
    );

    const completedAt = new Date().toISOString();
    const failedCount = perStory.filter((e) => e.error).length;
    const completed = {
      ...tcJob,
      status: 'completed',
      completedAt,
      batchStatus: 'ended',
      failedCount,
    };
    // #10 — do NOT merge perStory payloads into tcjob (240KB KVS value-size guard)
    await kvs.set(`${TC_JOB_KEY_PREFIX}${jobId}`, completed);

    console.log(`[pollTCStatus] jobId=${jobId} COMPLETED stories=${perStory.length} failed=${failedCount}`);
    return completed;
  }

  // Unknown batch status
  return { ...tcJob, batchStatus: pollResult.status, phase: `Unknown batch status: ${pollResult.status}` };
});

/**
 * getTestCases — fetch the completed test-case results for a job. Standalone read —
 * reconnect-safe (#1: the caller can invoke this at any time after completion without
 * a live poll, so test cases survive page reloads and navigation).
 *
 * Returns { perStory, total, completedAt, breakdownPageVersion, failedStories, failedCount }
 *   perStory[]: each entry is { storyIdx, storyName, story:{name,acceptance_criteria}, result?, coverage?, error?, detail? }
 *   breakdownPageVersion: from tcJob.pageVersion (stamped at submit; no extra job KVS read)
 *   failedStories: names of stories that errored in the batch (#3 transparency signal)
 *   failedCount: number of errored stories (P5 all-failed check, mitigation #11)
 *
 * Mitigations wired:
 *   #1 (reconnect safety): standalone read from KVS; no live poll dependency.
 *   #4 (Promise.all): all N per-story reads in parallel.
 */
resolver.define('getTestCases', async ({ payload }) => {
  const { jobId } = payload || {};
  if (!jobId) return { error: 'no_job_id', detail: 'jobId is required.' };

  const tcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`);
  if (!tcJob) return { error: 'not_found', detail: `tcjob ${jobId} not found.` };
  if (tcJob.status !== 'completed') {
    return { error: 'not_ready', status: tcJob.status, detail: `Test case generation is in status '${tcJob.status}'.` };
  }

  const total = tcJob.total || 0;

  // #4 — Promise.all: read all N per-story keys in parallel
  const entries = await Promise.all(
    Array.from({ length: total }, (_, i) => kvs.get(`${TC_STORY_KEY_PREFIX}${jobId}:${i}`)),
  );

  const perStory = entries.map((entry, i) => {
    // Build the story reference from the lean stampedStories (no extra job lookup needed).
    // P4's renderGherkin/renderManualTable call needs story.name + acceptance_criteria.
    const stamped = (tcJob.stampedStories || []).find((s) => s && s.idx === i);
    const story = stamped
      ? { name: stamped.name || '', acceptance_criteria: stamped.acceptance_criteria || [] }
      : { name: '', acceptance_criteria: [] };

    if (!entry) {
      // KVS key missing — should not happen (pollTestCaseStatus writes all N keys),
      // but treat as an error sentinel for robustness (#3 defence-in-depth)
      return { storyIdx: i, storyName: story.name, story, error: 'key_missing', detail: 'Per-story KVS entry missing — regenerate this story.' };
    }
    return { ...entry, story };
  });

  // breakdownPageVersion is stamped on tcjob at submit — no extra KVS job read required.
  const breakdownPageVersion = tcJob.pageVersion;

  const failedStories = perStory
    .filter((e) => e && e.error)
    .map((e) => e.storyName || `Story ${e.storyIdx}`);

  const failedCount = perStory.filter((e) => e && e.error).length;

  return {
    perStory,
    total,
    completedAt: tcJob.completedAt,
    breakdownPageVersion,
    failedStories,
    failedCount,
  };
});

/**
 * saveTestCases — persist a BA's hand-edits to ONE story's test cases.
 *
 * WHY a backend write (not in-memory like the breakdown editor): unlike the breakdown
 * (which travels in the push payload), test cases are RE-READ from KVS by BOTH the
 * dual-format export (getTestCaseExports) AND the Jira push embed (push_handler reads
 * testcases:<jobId>:<idx>). So an edit only reaches export/push if it is written back to
 * that per-story key, with coverage recomputed. This resolver is that single safe write.
 *
 * SAFETY (design-army verdict, 2026-06-06):
 *   - Re-sanitize the user-edited result through parseTestCaseResult — user input is LESS
 *     trusted than model JSON; the parser owns every bound (drop empty when/then, repair
 *     ac_trace→inferred, priority whitelist, test_data cap, cap-20 AC-covering partition,
 *     computeCoverage). One source of truth for bounds (POLICY §4).
 *   - Recompute coverage against the STAMPED ACs (tcjob.stampedStories) — the SAME ACs the
 *     push-embed AC-hash binds on and the original generation used. Never the live breakdown.
 *   - Write EXACTLY one key; tcjob (stamped ACs = embed key + coverage oracle) stays IMMUTABLE.
 *   - Editing CASES never changes the story's ACs → the AC-hash is unchanged → the push embed
 *     reads the edited entry for free (no push_handler change needed).
 *   - Reject an empty result (would silently erase this story's export + embed) + a regen
 *     in flight (last-writer race). Every failure FAILS LOUD; the frontend keeps the buffer.
 */
resolver.define('saveTestCases', async ({ payload, context }) => {
  const { jobId, storyIdx, result } = payload || {};
  if (!jobId) return { error: 'no_job_id', detail: 'jobId is required.' };
  if (typeof storyIdx !== 'number' || !Number.isInteger(storyIdx) || storyIdx < 0) {
    return { error: 'bad_story_idx', detail: 'storyIdx must be a non-negative integer.' };
  }
  if (!result || typeof result !== 'object') {
    return { error: 'invalid_result', detail: 'A test-case result object is required.' };
  }

  // Defensive license gate — editing is a licensed action (mirror regenerateTestCase).
  try {
    if (getActiveTier(context).key === 'unlicensed') return buildLicenseRequired();
  } catch (e) {
    console.error(`[saveTC] license check failed (failing open): ${String(e?.message || e)}`);
  }

  const tcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`);
  if (!tcJob) return { error: 'not_found', detail: `Test-case set ${jobId} not found — it may have expired. Regenerate test cases.` };
  if (tcJob.status !== 'completed') {
    return { error: 'not_ready', status: tcJob.status, detail: 'Test cases are still generating — wait for completion before editing.' };
  }

  const total = tcJob.total || 0;
  const stamped = (tcJob.stampedStories || []).find((s) => s && s.idx === storyIdx);
  if (storyIdx >= total || !stamped) {
    return { error: 'story_out_of_range', detail: `No story at index ${storyIdx} in this test-case set (total ${total}).` };
  }

  // Regen-in-flight backstop: never overwrite a story mid-regenerate (last-writer race).
  try {
    const regen = await kvs.get(`${TC_REGEN_KEY_PREFIX}${jobId}:${storyIdx}`);
    if (regen && (regen.status === 'batched' || regen.status === 'pending')) {
      return { error: 'regen_in_progress', detail: 'This story is regenerating — wait for it to finish, then edit.' };
    }
  } catch (_) { /* non-fatal: the backstop is best-effort; the frontend also mutually-excludes */ }

  // Authoritative story = the STAMPED ACs (coverage oracle + the embed-hash basis). Immutable.
  const story = {
    name: stamped.name || '',
    acceptance_criteria: Array.isArray(stamped.acceptance_criteria) ? stamped.acceptance_criteria : [],
  };

  // Re-sanitize the edited result through the canonical parser (bounds + coverage recompute).
  const parsed = parseTestCaseResult(result, story);
  if (parsed.error) {
    return { error: 'invalid_result', detail: parsed.detail || 'The edited test cases could not be saved (invalid format).' };
  }
  // Never silently persist an empty set — it would erase this story's export + push embed.
  if (!Array.isArray(parsed.result.test_cases) || parsed.result.test_cases.length === 0) {
    return { error: 'empty_result', detail: 'A saved story must keep at least one test case (each with a When and a Then). Add a case, or use Regenerate.' };
  }

  // Overwrite the ONE per-story key — byte-identical shape to the bulk/regen success entry,
  // so getTestCases / export / push consume it unchanged.
  const entry = { storyIdx, storyName: story.name, result: parsed.result, coverage: parsed.coverage };
  try {
    await kvs.set(`${TC_STORY_KEY_PREFIX}${jobId}:${storyIdx}`, entry);
  } catch (e) {
    console.error(`[saveTC] KVS write failed jobId=${jobId} storyIdx=${storyIdx}: ${String(e?.message || e)}`);
    return { error: 'save_failed', detail: 'Could not save your edits (storage error). Your changes are still on screen — try Save again.' };
  }

  console.log(`[saveTC] jobId=${jobId} storyIdx=${storyIdx} cases=${parsed.result.test_cases.length} coverage_pct=${parsed.coverage && parsed.coverage.coverage_pct}`);
  return { ok: true, storyIdx, result: parsed.result, coverage: parsed.coverage };
});

/**
 * regenerateTestCase — submit a 1-request Sonnet batch for a single Story and
 * poll until done.
 *
 * DESIGN DECISION (flagged for the conductor per spec): a single-story regenerate
 * cannot reuse the bulk tcjob because writing to tcjob:<jobId> would clobber the
 * bulk batch's batchId/status. Instead, a SEPARATE control record
 * tcregenjob:<jobId>:<storyIdx> mirrors the tcjob shape. The per-story result key
 * testcases:<jobId>:<storyIdx> IS shared with the bulk path — on completion the
 * regenerate OVERWRITES the existing entry (the most recent generation wins, which
 * is always the intended behaviour: the user clicked Regenerate explicitly).
 *
 * This resolver SUBMITS only; the frontend polls via pollRegenerateTestCase
 * (defined next) using { jobId, storyIdx }. Both are required because the single-
 * story batch is async (Sonnet) — the same 2-10 min window as the bulk batch.
 *
 * Mitigations wired:
 *   #5 (keySource stamp): re-resolves key by source at submit.
 *   #7 (story stamp): stamps the single story on the regen control key.
 *   #9 (1-request Sonnet batch): quality-consistent with the bulk; ~2 min UX.
 */
resolver.define('regenerateTestCase', async ({ payload, context }) => {
  const { jobId, storyIdx } = payload || {};
  if (!jobId) return { error: 'no_job_id', detail: 'jobId is required.' };
  if (typeof storyIdx !== 'number' || !Number.isInteger(storyIdx) || storyIdx < 0) {
    return { error: 'bad_story_idx', detail: 'storyIdx must be a non-negative integer.' };
  }

  // Defensive license gate
  try {
    if (getActiveTier(context).key === 'unlicensed') return buildLicenseRequired();
  } catch (e) {
    console.error(`[regenTC] license check failed (failing open): ${String(e?.message || e)}`);
  }

  // Resolve the key (#5: regen key must match the bulk batch's keySource for cost/auth consistency)
  const tcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`);
  // Use the bulk tcjob's keySource when available (same billing source as the original batch);
  // fall back to resolveAnthropicKey for the first-ever regen on a job with no bulk tcjob.
  let apiKey, keySource;
  if (tcJob && tcJob.keySource) {
    keySource = tcJob.keySource;
    apiKey = await anthropicKeyForSource(keySource);
  } else {
    const resolved = await resolveAnthropicKey(context);
    apiKey = resolved.apiKey;
    keySource = resolved.keySource;
  }
  if (!apiKey) {
    if (keySource === 'managed') return { error: 'managed_unavailable', detail: 'The Managed service is temporarily unavailable. Please contact support@spec2jira.com.' };
    return { error: 'not_configured', detail: 'Anthropic API key not configured.' };
  }

  // Load the full story from the breakdown job
  const job = await kvs.get(`${JOB_KEY_PREFIX}${jobId}`);
  if (!job || job.status !== 'completed') {
    return { error: 'breakdown_not_ready', detail: 'Breakdown job must be completed before regenerating test cases.' };
  }
  const stories = (job.breakdown && Array.isArray(job.breakdown.features)) ? job.breakdown.features : [];
  const story = stories[storyIdx];
  if (!story) {
    return { error: 'story_not_found', detail: `No story at index ${storyIdx}.` };
  }

  const sharedACs = (job.breakdown && Array.isArray(job.breakdown.shared_acceptance_criteria))
    ? job.breakdown.shared_acceptance_criteria : [];
  const specSummary = (job.breakdown && job.breakdown.metadata && job.breakdown.metadata.spec_summary) || '';

  const createdAt = new Date().toISOString();

  // Write the regen control key (separate from the bulk tcjob). NOTE: stampedStories uses
  // idx:0 — the batch-LOCAL index matching the 1-request custom_id "0"; the real breakdown
  // position is the payload storyIdx (the KVS key suffix + the testcases:<jobId>:<storyIdx> write).
  await kvs.set(`${TC_REGEN_KEY_PREFIX}${jobId}:${storyIdx}`, {
    jobId, storyIdx, status: 'pending', keySource,
    stampedStories: [{ idx: 0, name: story.name || '', acceptance_criteria: Array.isArray(story.acceptance_criteria) ? story.acceptance_criteria : [] }],
    createdAt,
  });

  // Submit a 1-request batch (all siblings passed as context — scope fence is important
  // for a correct regenerate; quality-consistent with the bulk Sonnet call #9)
  // §8 fix: feed the source-page snapshot so a single-story regen mines the same business rules.
  const specSourceText = await resolveSpecSourceText(jobId, job);
  const submitResult = await submitTestCaseBatch({
    stories: [story],
    allStories: stories, // §8 (#2): resolve dependency peers from the FULL feature list, not the 1-element regen batch
    siblingNames: stories.map((s) => s && (s.name || '')),
    sharedAcceptanceCriteria: sharedACs,
    specConcerns: (job.breakdown && Array.isArray(job.breakdown.spec_concerns)) ? job.breakdown.spec_concerns : [],
    specSummary,
    specSourceText,
    apiKey,
  });

  if (submitResult.error) {
    console.error(`[regenTC] submit failed: ${submitResult.error} | ${submitResult.detail}`);
    await kvs.set(`${TC_REGEN_KEY_PREFIX}${jobId}:${storyIdx}`, {
      jobId, storyIdx, status: 'failed', keySource,
      stampedStories: [{ idx: 0, name: story.name || '', acceptance_criteria: Array.isArray(story.acceptance_criteria) ? story.acceptance_criteria : [] }],
      createdAt, error: submitResult.error, detail: submitResult.detail,
    });
    return { error: submitResult.error, detail: submitResult.detail };
  }

  await kvs.set(`${TC_REGEN_KEY_PREFIX}${jobId}:${storyIdx}`, {
    jobId, storyIdx, status: 'batched', keySource,
    stampedStories: [{ idx: 0, name: story.name || '', acceptance_criteria: Array.isArray(story.acceptance_criteria) ? story.acceptance_criteria : [] }],
    batchId: submitResult.batchId,
    batchStatus: submitResult.status,
    createdAt, submittedAt: new Date().toISOString(), expiresAt: submitResult.expiresAt,
  });

  console.log(`[regenTC] jobId=${jobId} storyIdx=${storyIdx} batchId=${submitResult.batchId}`);
  return { jobId, storyIdx, status: 'batched', batchId: submitResult.batchId };
});

/**
 * pollRegenerateTestCase — poll a single-story regen batch until done.
 * On completion, overwrites testcases:<jobId>:<storyIdx> with the new result.
 * The frontend polls this (same pattern as pollTestCaseStatus for the bulk job).
 *
 * Mitigations wired:
 *   #3 (explicit sentinel): error rows write an explicit error entry, never blank.
 *   #5 (managed key guard): soft-fail if managed key vanished.
 */
resolver.define('pollRegenerateTestCase', async ({ payload }) => {
  const { jobId, storyIdx } = payload || {};
  if (!jobId || typeof storyIdx !== 'number') {
    return { error: 'bad_args', detail: 'jobId and numeric storyIdx are required.' };
  }

  const regenKey = `${TC_REGEN_KEY_PREFIX}${jobId}:${storyIdx}`;
  const regenJob = await kvs.get(regenKey);
  if (!regenJob) return { error: 'not_found', detail: `Regen job ${jobId}:${storyIdx} not found.` };

  // Terminal states
  if (regenJob.status === 'completed' || regenJob.status === 'failed') return regenJob;
  if (regenJob.status !== 'batched' || !regenJob.batchId) return regenJob;

  // #5 — Key-vanish guard (generalized, same as pollTestCaseStatus)
  const jobApiKey = await anthropicKeyForSource(regenJob.keySource || 'byok');
  if (!jobApiKey) {
    const msg = (regenJob.keySource === 'managed')
      ? 'Managed service temporarily unavailable — retrying. If this persists, please contact support@spec2jira.com.'
      : 'Your Anthropic API key is unavailable — re-add it in Settings; generation will resume.';
    console.error(`[pollRegenTC] jobId=${jobId}:${storyIdx} keySource=${regenJob.keySource} key unavailable — soft-failing`);
    return { ...regenJob, phase: msg };
  }

  const pollResult = await pollTestCaseBatch(regenJob.batchId, jobApiKey);
  if (pollResult.error) {
    console.error(`[pollRegenTC] poll failed: ${pollResult.error}`);
    return { ...regenJob, phase: `Batch poll error: ${pollResult.error}` };
  }

  const counts = pollResult.requestCounts || {};
  const totalRequests = (counts.processing || 0) + (counts.succeeded || 0) + (counts.errored || 0) + (counts.canceled || 0) + (counts.expired || 0);

  if (pollResult.status === 'in_progress' || pollResult.status === 'canceling') {
    return { ...regenJob, batchStatus: pollResult.status, phase: 'Regenerating test cases...', progress: totalRequests > 0 ? ((counts.succeeded || 0) + (counts.errored || 0)) / totalRequests : 0 };
  }

  if (pollResult.status === 'ended') {
    if (!pollResult.resultsUrl) {
      const failed = { ...regenJob, status: 'failed', completedAt: new Date().toISOString(), error: 'no_results_url', detail: 'Batch ended but Anthropic returned no results_url.' };
      await kvs.set(regenKey, failed);
      return failed;
    }

    const fetchResult = await fetchTestCaseResults(pollResult.resultsUrl, regenJob.stampedStories, jobApiKey);
    if (fetchResult.error) {
      const failed = { ...regenJob, status: 'failed', completedAt: new Date().toISOString(), error: fetchResult.error, detail: fetchResult.detail };
      await kvs.set(regenKey, failed);
      return failed;
    }

    const entry = fetchResult.perStory[0];
    const storyName = regenJob.stampedStories[0] && regenJob.stampedStories[0].name || '';

    // Overwrite the shared per-story KVS key (intentional: user clicked Regenerate)
    // #3 — explicit sentinel even for regen errors
    const storyKvsValue = entry && !entry.error
      ? { storyIdx, storyName, result: entry.result, coverage: entry.coverage }
      : { storyIdx, storyName, error: (entry && entry.error) || 'regen_failed', detail: (entry && entry.detail) || 'Regen parse failed.' };
    await kvs.set(`${TC_STORY_KEY_PREFIX}${jobId}:${storyIdx}`, storyKvsValue);

    const completed = { ...regenJob, status: 'completed', completedAt: new Date().toISOString(), batchStatus: 'ended' };
    await kvs.set(regenKey, completed);

    console.log(`[pollRegenTC] jobId=${jobId} storyIdx=${storyIdx} COMPLETED error=${entry && !!entry.error}`);
    return { ...completed, result: storyKvsValue.result, coverage: storyKvsValue.coverage, error: storyKvsValue.error };
  }

  return { ...regenJob, batchStatus: pollResult.status, phase: `Unknown batch status: ${pollResult.status}` };
});

/**
 * getTestCaseExports — deterministic pure-render resolver (NO LLM, NO KVS writes).
 * Returns Gherkin and/or CSV for one story (storyIdx = number) or all stories
 * (storyIdx = null / omitted). Reads the same testcases:<jobId>:<idx> entries
 * that getTestCases reads; fails gracefully on missing/error entries.
 *
 * Payload: { jobId, storyIdx?, format? }
 *   jobId     — required; the completed breakdown job id
 *   storyIdx  — number → single story; null/omitted → all stories (concat)
 *   format    — 'gherkin' | 'csv' | 'both' (default 'both')
 *
 * Returns: { gherkin?, csv? } or { error, detail }
 *   confidence is NEVER exported (opts { includeConfidence: false }).
 */
resolver.define('getTestCaseExports', async ({ payload }) => {
  const { jobId, storyIdx, format = 'both' } = payload || {};
  if (!jobId) return { error: 'no_job_id', detail: 'jobId is required.' };

  const tcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`).catch(() => null);
  if (!tcJob) return { error: 'not_found', detail: `tcjob ${jobId} not found.` };
  if (tcJob.status !== 'completed') {
    return { error: 'not_ready', status: tcJob.status, detail: `Test case generation is in status '${tcJob.status}'.` };
  }

  const total = tcJob.total || 0;
  const stampedStories = tcJob.stampedStories || [];

  // Determine which indices to render
  const indices = (typeof storyIdx === 'number' && Number.isInteger(storyIdx) && storyIdx >= 0)
    ? [storyIdx]
    : Array.from({ length: total }, (_, i) => i);

  // Read all required per-story entries in parallel (pure read, no writes)
  const entries = await Promise.all(
    indices.map((idx) => kvs.get(`${TC_STORY_KEY_PREFIX}${jobId}:${idx}`).catch(() => null)),
  );

  const renderOpts = { includeConfidence: false };
  const gherkinParts = [];
  // CSV: first valid story gets headerRow:true (includes column header); subsequent
  // stories get headerRow:false so there is exactly ONE header row in the combined CSV.
  const csvParts = [];
  let csvHeaderEmitted = false;

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const entry = entries[i];
    if (!entry || entry.error) continue; // skip error/missing entries gracefully

    const stamped = stampedStories.find((s) => s && s.idx === idx);
    const story = stamped
      ? { name: stamped.name || '', acceptance_criteria: stamped.acceptance_criteria || [] }
      : { name: entry.storyName || '', acceptance_criteria: [] };

    const result = entry.result;
    if (!result) continue;

    if (format === 'gherkin' || format === 'both') {
      const g = renderGherkin(result, story, renderOpts);
      if (g) gherkinParts.push(g);
    }
    if (format === 'csv' || format === 'both') {
      const { csv } = renderManualTable(result, story, { ...renderOpts, headerRow: !csvHeaderEmitted });
      if (csv) {
        csvParts.push(csv);
        csvHeaderEmitted = true;
      }
    }
  }

  const out = {};

  if (format === 'gherkin' || format === 'both') {
    out.gherkin = gherkinParts.join('\n\n');
  }
  if (format === 'csv' || format === 'both') {
    out.csv = csvParts.join('\n');
  }

  return out;
});

// ── Export handler bound к manifest function key "resolver" ──

export const handler = resolver.getDefinitions();
