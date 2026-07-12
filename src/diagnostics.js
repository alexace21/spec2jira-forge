/**
 * Spec2Tickets — client-side diagnostic ledger (Phase 1 module).
 *
 * SINGLE OWNER of: the closed op/error_class registries, record validation
 * (the privacy wall), ring-merge/dedupe/eviction, the aggregate sidecar,
 * the rich-detail sibling, and serialization for export.
 * Contract: docs/DIAGNOSTICS-LEDGER-DESIGN.md §1/§2/§2b (v2.2, partner GO).
 *
 * ARCHITECTURE (SOLID, POLICY §3.5 — pure core / thin IO shell):
 *   - PURE CORE — `validateRecord`, `mergeIntoRing`, `serializeForExport`.
 *     Import-free, deterministic, fully offline-testable
 *     (prototype/test_diagnostics.js runs them under plain `node`).
 *   - THIN IO SHELL — `recordDiagnostic`, `writeDiagnosticDetail`,
 *     `readDiagnostics`, `readDiagnosticDetail`, `readAggregate`,
 *     `clearDiagnostics`. Each lazy-imports `@forge/kvs` INSIDE the function
 *     body, so requiring this module never touches the Forge runtime. All
 *     guard paths (skip / empty-result) run BEFORE the import.
 *
 * THE PRIVACY WALL (design §1 MUST-NOT — structural, not disciplinary):
 *   `validateRecord` whitelist-CONSTRUCTS the record — only schema fields
 *   survive; `detail`/`message`/`reason`/`name`/`pageTitle`/anything else is
 *   dropped by construction, never copied. No free-text field survives under
 *   ANY name: enums come from closed registries (unknown → 'unknown_op' /
 *   'unknown_error', NEVER the raw string), ids are shape-checked (whitespace
 *   kills prose smuggling), counts keys must be code-shaped identifiers.
 *   `serializeForExport` re-runs every record through `validateRecord` —
 *   the second wall: a tampered/legacy KVS value cannot leak via export.
 *   Verbatim error text lives ONLY in the zone-2 detail sibling (§2b):
 *   separate key, 4 KB cap, ~30-day TTL, exported only behind explicit
 *   user consent (Phase 5 surface).
 *
 * WHY NO TTL ON THE LEDGER ITSELF: KVS TTL is sliding-on-WRITE — a
 * rarely-written diagnostics bucket would silently expire (the hard-won
 * job:-TTL lesson). The ring cap (50) bounds size instead. The §2b detail
 * sibling IS TTL'd — transient, write-once, never the deliverable: exactly
 * what the TTL lesson permits.
 */

// ════════════════════════════════════════════════════════════════════════
// Keys & limits (frozen public API — Phase 0/5 build against these)
// ════════════════════════════════════════════════════════════════════════

export const DIAG_BUCKET_PREFIX = 'spec2jira_diag:u:';
export const DIAG_AGG_KEY = 'spec2jira_diag:agg';
export const DIAG_DETAIL_PREFIX = 'spec2jira_diagdetail:';

export const DIAG_CAP = 50;
export const DETAIL_CAP_CHARS = 4096;
export const DETAIL_TTL_MS = 30 * 24 * 3600 * 1000; // ~30 days
const DETAIL_TTL_DAYS = 30; // native @forge/kvs TTL ({ value, unit: 'DAYS' })

// App version stamped into the export envelope ({app_version, exported_at, tier} —
// design §2.8). MUST equal package.json "version" — CI's tools/version-drift-guard.mjs FAILS the merge on
// drift (the §11 backstop; bump BOTH at release). Still a support LABEL, never logic — and NOTE it is repo
// BOOKKEEPING only: it does NOT equal the live Marketplace version (forge-auto-assigned at deploy).
export const DIAG_APP_VERSION = '7.1.0';

// Defensive ceiling for the admin "All users" enumeration (§2.10): a runaway
// key-space can never melt the resolver — buckets beyond the cap are simply not
// served (the per-user runbook fallback still covers any truncated user).
export const DIAG_ALL_BUCKETS_CAP = 200;
const DIAG_QUERY_PAGE_LIMIT = 20; // platform-safe page size; cursor-paginated to exhaustion

/** Per-user ring-buffer bucket key. accountId may contain ':' (Atlassian shape) — KVS-safe, same pattern as usage:…:u:<id>. */
export function diagBucketKey(accountId) {
  return `${DIAG_BUCKET_PREFIX}${accountId}`;
}

/** Zone-2 rich-detail sibling key (§2b). */
export function diagDetailKey(ref) {
  return `${DIAG_DETAIL_PREFIX}${ref}`;
}

// ════════════════════════════════════════════════════════════════════════
// Closed registries
// ════════════════════════════════════════════════════════════════════════

/**
 * Operation registry (closed). The op names the FLOW STEP that recorded the
 * event — coarse on purpose (design §4: one record per failed flow-step).
 */
export const DIAG_OPS = Object.freeze([
  'generation.start',
  'generation.poll',
  'generation.complete',
  'push.final',
  'push.step',
  'push.resume', // Task C — a RESUME of a partial push (distinct op so support tells resume from a fresh push); its START-failure records carry this op
  'push.resume.final', // Spec C.2 - the TERMINAL record of a RESUME (clean or still-partial), distinct from a fresh push's push.final so support can tell resume from fresh
  'testgen.batch',
  'testgen.poll', // [seams-audit J5] the TC poll leg — partitions the 7-site testgen.batch/kvs_write_failed junk-drawer tuple into flow legs (mirror of generation.start/.poll)
  'testgen.regen',
  'testgen.save', //  [diag Phase 4] saveTestCases flow — WIRED (Phase-5 gate fix): a KVS-failed save records kvs_write_failed here alongside its fail-loud save_failed return
  'testgen.export',
  'settings.key',
  'settings.save',
  'distill.step',
  'confluence.fetch',
  'confluence.search',
  'dashboard.read',
  'invoke.failed', // client-side fallback (resolver never returned)
  'health.check',
  'purge',
  'unknown_op', // sentinel — anything outside the registry normalizes here
]);

/**
 * Error-class registry (closed). Derived from the →L rows of
 * docs/DIAGNOSTICS-FAILURE-SURFACE.md §2 (each →L row maps to a class here;
 * by-design count-only rows ride the `counts` field of a parent record).
 * Interpolated families (confluence_<status> etc.) normalize to the family
 * class + `jira[].status` / counts — NEVER a raw interpolated string.
 */
export const DIAG_CLASSES = Object.freeze([
  // ── KVS / persistence ────────────────────────────────────────────────
  'kvs_write_failed', //      generic KVS write threw (job:/pageJob:/consumeQuota/firstSeen/settings/stamp-sync)
  'kvs_read_failed', //       generic KVS read threw (dashboard top-list, unwrapped reads)        [§2.4:889,…]
  'kvs_persist_failed', //    completed-state write lost (~240KB value-size class)                [§2.1:1605-1619]
  'edited_persist_failed', // edited breakdown failed to persist → pristine-ACs risk              [§2.2:1998]
  'pagesnap_write_failed', // source-page snapshot write failed                                   [§2.1:1312]
  'pagesnap_missing', //      snapshot absent at test-gen → §7-starved quality                    [§2.2:248-269]
  'key_storage_failed', //    API-key storage fault (A4: distinct from not_configured)            [§2.4 ac:76]
  'purge_incomplete', //      purge fail-open left content behind / leaked keys                   [§2.4:1795; §2.2 tcregenjob]
  // ── Push to Jira ─────────────────────────────────────────────────────
  'partial_push', //          some issues failed in a bulk create (counts cause-split)            [§2.3:413-462]
  'orphaned_subtasks', //     parent story failed → subtasks skipped — NOT emitted as a class: rides as counts.subtasks_orphaned on the push.final record (Phase 2) [§2.3:918-920]
  'link_unresolved', //       dependency endpoint unresolved at preflight — NOT emitted as a class: rides as the counts.links_unresolved_* cause-split on the push.final record (Phase 2) [§2.3:964-979]
  'links_api_failed', //      Jira link-create API failure — NOT emitted as a class: rides as counts.links_api_failed on the push.final record (Phase 2) [§2.3:484,997]
  'step_exception', //        pushStep threw mid-chunk (session kept, retry risk)                 [§2.3:792]
  'session_not_found', //     push session / job record missing or expired                        [§2.3:776; §2.1:1444]
  'subtask_type_unresolved', // no subtask:true issue type → checklist-embed fallback (gotcha #7) — NOT emitted as a class: inferable as counts.tasks_embedded > 0 on BOTH push.final records (F2 proxy) [§2.3:286,642]
  'duplicate_work', //        same work ran twice (25s-retry dup issues; double cycle-repair bill) — registered, NOT YET emitted: detection halves are Layer-1 (A6 push idempotency / poll race) [§2.3:774; §2.1:1520]
  'project_not_found', //     push project lookup 404 — key wrong or no browse access             [§2.3:255]
  'permission_denied', //     push project lookup 403                                             [§2.3:262]
  'no_project_key', //        push attempted with no configured Jira project key                  [index:2011]
  'no_breakdown', //          push attempted with no breakdown payload (a frontend bug)           [index:2000]
  'push_exception', //        startPush threw outside the structured paths                        [index:2027]
  // ── Anthropic / batch lifecycle ──────────────────────────────────────
  'auth_rejected', //         401 — key invalid/revoked
  'insufficient_credits', //  402 — account out of credits
  'rate_limited', //          429
  'anthropic_http', //        other Anthropic HTTP failure / response anomaly (status in counts)
  'batch_expired', //         batch results expired (24h window)                                  [ac:827-845]
  'batch_stuck', //           batch wedged in canceling/in_progress beyond threshold              [§2.2:2169]
  'batch_unknown_status', //  batch status outside the known set → would poll forever             [§2.1:1632]
  'no_results_url', //        ended batch carries no results_url                                  [ac:505-555]
  'result_row_missing', //    expected per-story/job result row absent                            [ac:505-555]
  'refused', //               model refusal (whole call or per-story)
  'parse_failed', //          response JSON/schema parse failure (incl. schema-invalid breakdown) [ac:560,599]
  'truncated', //             output hit the token cap (incl. A5 silent TC truncation)            [ac:557; ac:859]
  'truncation_salvaged', //   truncated output partially recovered by the salvage path
  // ── Product HTTP / network ───────────────────────────────────────────
  'confluence_http', //       Confluence API non-OK (status in jira[].status-style counts)
  'jira_http', //             Jira API non-OK (status + field_names in jira[])
  'network_failure', //       fetch threw (no HTTP status)
  'egress_blocked', //        Forge BLOCKED_EGRESS (manifest egress config)                       [§2.4:972-997]
  // ── Config / licensing / quota gates ─────────────────────────────────
  'not_configured', //        required setting absent (e.g. no BYOK key) — honest "never set"
  'managed_unavailable', //   MANAGED_ANTHROPIC_KEY unset/vanished (our ops, Managed edition)
  'quota_exceeded', //        Managed per-user cap reached (intended block, for the timeline)
  'license_required', //      defensive unlicensed backstop fired
  'gate_fail_open', //        license/quota/distill-cap check THREW and failed open               [§2.1:1177,1228; §2.4:591]
  'config_invalid', //        stored config unparseable (e.g. required-custom-fields JSON)        [§2.3:1863]
  'context_profile_failed', // project-context profile resolve failed → empty context             [§2.1:1330-1344]
  'distill_category_dropped', // [diag Phase 4] a distill category absent/empty at the FINAL merge — §8 starvation marker [§2.4:686]
  // ── Generation post-processing ───────────────────────────────────────
  'cycle_repair_failed', //   cycle-resolution LLM call or whole verify pass failed               [§2.1:1082,1590]
  // ── Test-gen / export ────────────────────────────────────────────────
  'partial_testgen', //       [diag Phase 4] some stories failed in a TC batch — ONE coalesced record, counts cause-split [§2.2:2201]
  'story_removed', //         regen target story no longer in the breakdown
  'regen_overwrote_good', //  failed regen destroyed prior-good cases                             [§2.2:2607]
  'export_partial', //        export skipped stories (A7 — file looked complete)                  [§2.2:2702]
  'export_failed', //         whole export render failed                                          [§2.2:2712]
  // ── Tracking / dashboard ─────────────────────────────────────────────
  'tracking_degraded', //     job fired but tracked-jobs/batched bookkeeping failed               [§2.1:1377,1399]
  // ── Client-side fallback (recordClientDiagnostic) ────────────────────
  'invoke_rejected', //       resolver invoke rejected client-side
  'invoke_timeout', //        resolver never returned (25s kill — no backend write possible)
  // ── Health & success breadcrumbs (info-level; never evict errors) ────
  'health_ok',
  'health_degraded',
  'generation_completed',
  'push_completed',
  'testgen_completed', //     [diag Phase 4] TC batch completed clean (info breadcrumb, counts only)
  // ── Sentinel ─────────────────────────────────────────────────────────
  'unknown_error', //         anything outside the registry normalizes here
]);

const DIAG_OPS_SET = new Set(DIAG_OPS);
const DIAG_CLASSES_SET = new Set(DIAG_CLASSES);

// ════════════════════════════════════════════════════════════════════════
// Pure core — structured-error-code → class mapping (Anthropic batch flows)
// ════════════════════════════════════════════════════════════════════════

/**
 * PURE. Map a structured error CODE produced by the Anthropic batch pipeline
 * (anthropic_client.js submitBreakdownBatch / pollBatchStatus /
 * fetchBatchResults / fetchTestCaseResults + the index.js per-story regen
 * sentinels) onto the CLOSED error-class registry (+ numeric evidence in
 * counts). 1:1 with the EXISTING codes (design §1): interpolated families
 * (anthropic_<NNN> / results_fetch_<NNN> / batch_request_<type>) normalize to
 * the family class with the status as DATA — never a raw interpolated string;
 * anything outside the table → 'unknown_error'.
 *
 * LIVES HERE, not in index.js (moved at the Phase-3 contract audit,
 * 2026-06-12): the single owner of class semantics (§2.9) also owns the
 * code→class mapping, and the offline table-test
 * (prototype/test_diagnostics.js §16) pins every producible code to its
 * expected class — unexported in index.js, a drifted mapping silently
 * degraded to unknown_error with no test able to see it.
 *
 * Serves the startGeneration submit-failure site, the pollJobStatus terminal
 * sites, and the test-gen batch/regen submit + poll-terminal + per-story
 * sites (single mapping authority — no duplicate tables).
 */
export function classifyDiagGenerationError(code) {
  const c = String(code || '');
  switch (c) {
    case 'auth_rejected':
      return { error_class: 'auth_rejected' };
    case 'insufficient_credits':
      return { error_class: 'insufficient_credits' };
    case 'rate_limited':
      return { error_class: 'rate_limited' };
    case 'network_failure':
      return { error_class: 'network_failure' };
    case 'not_configured': // results-fetch with the BYOK key deleted mid-tick (key-vanish
      //                      race) — an honest config class exists in the registry;
      //                      unknown_error would misdiagnose the A4 family (audit 2026-06-12)
      return { error_class: 'not_configured' };
    case 'no_batch_id': // submit returned no batch id — Anthropic response anomaly
    case 'no_message': //  result row missing its message field — same family
      return { error_class: 'anthropic_http' };
    case 'no_results_url':
      return { error_class: 'no_results_url' };
    case 'result_row_missing':
    case 'row_missing': // the TC per-story sentinel spells it short — same class
    case 'regen_failed': // regen perStory[0] missing — same row-absent family (deep-audit F2)
      return { error_class: 'result_row_missing' };
    case 'refused':
      return { error_class: 'refused' };
    case 'truncated': // salvage-FAILED truncation (a salvaged run completes + records truncation_salvaged)
      return { error_class: 'truncated' };
    case 'parse_failed':
      return { error_class: 'parse_failed' };
    default: {
      let m = /^anthropic_(\d+)$/.exec(c);
      if (m) return { error_class: 'anthropic_http', counts: { http_status: parseInt(m[1], 10) } };
      m = /^results_fetch_(\d+)$/.exec(c);
      if (m) return { error_class: 'anthropic_http', counts: { http_status: parseInt(m[1], 10) } };
      m = /^batch_request_(.+)$/.exec(c);
      if (m) return { error_class: m[1] === 'expired' ? 'batch_expired' : 'anthropic_http' };
      return { error_class: 'unknown_error' };
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// Pure core — validation (the privacy wall)
// ════════════════════════════════════════════════════════════════════════

const SEVERITY_RANK = { info: 0, warn: 1, error: 2 };
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
const PAGE_ID_RE = /^\d{1,20}$/;
// counts keys must be code-shaped identifiers — a prose key would be a
// free-text field "under another name" (§1 MUST-NOT), so shape-reject it.
const COUNT_KEY_RE = /^[A-Za-z0-9_.:-]{1,40}$/;
// detail-sibling KVS key suffix: KVS-key-safe charset (jobIds are UUID or
// `<ts>-<base36>` — both pass; anything stranger is refused, not stored).
const DETAIL_REF_RE = /^[A-Za-z0-9:_.-]{1,80}$/;
// Jira field ids from Object.keys(errors) are code-shaped (customfield_10042,
// priority). Prose/whitespace — e.g. a jiraErrorMessage string poured in by a
// wiring mistake — must be DROPPED, not truncated: field_names is the one
// array of strings on the record and must never become a free-text channel
// (§13-gate mandatory fix — the wall is structural, not discipline).
const FIELD_NAME_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
// Minted-uid shape only (v3Schema newStoryUid always mints `s_…`) — a bare
// word (a story-NAME fragment) must not pass as a uid (§13-gate fix).
const STORY_UID_RE = /^s_[A-Za-z0-9-]{1,62}$/;

/** ref/session_ref: opaque correlation ids (UUID / ts-base36 / s_uid). SHAPE-
 *  checked with the same KVS-key-safe ASCII charset as the detail sibling
 *  (deep-audit fix: the old "no whitespace, cap 80" let zero-width-joined
 *  prose, Cyrillic names, and <script> payloads through — \s does NOT match
 *  U+200B/C/D, and spaceless single-token content is still content). Every
 *  minted ref (crypto.randomUUID, `<ts>-<base36>`, distill session ids)
 *  passes; anything outside the charset is dropped, not truncated. */
function cleanRef(v) {
  if (typeof v !== 'string' || !DETAIL_REF_RE.test(v)) return null;
  return v;
}

function cleanSubject(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const { kind, id } = s;
  if (kind === 'issue') {
    if (typeof id === 'string' && id.length <= 64 && ISSUE_KEY_RE.test(id)) {
      return { kind, id };
    }
    return null;
  }
  if (kind === 'page') {
    if (typeof id === 'number' && Number.isInteger(id) && id >= 0) return { kind, id };
    if (typeof id === 'string' && PAGE_ID_RE.test(id)) return { kind, id };
    return null;
  }
  if (kind === 'idx') {
    if (typeof id === 'number' && Number.isInteger(id) && id >= 0) return { kind, id };
    return null;
  }
  if (kind === 'story_uid') {
    if (typeof id === 'string' && STORY_UID_RE.test(id)) return { kind, id };
    return null;
  }
  return null; // unknown kind → drop the whole subject
}

function cleanIdxs(a) {
  if (!Array.isArray(a)) return null;
  const out = a.filter((n) => Number.isInteger(n) && n >= 0).slice(0, 20);
  return out.length ? out : null;
}

function cleanIssueKeys(a) {
  if (!Array.isArray(a)) return null;
  const out = a
    .filter((k) => typeof k === 'string' && k.length <= 64 && ISSUE_KEY_RE.test(k))
    .slice(0, 20);
  return out.length ? out : null;
}

function cleanJiraEntryStatus(v) {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^\d{1,5}$/.test(v)) return parseInt(v, 10);
  return null;
}

function cleanJira(j) {
  const arr = Array.isArray(j) ? j : j && typeof j === 'object' ? [j] : null;
  if (!arr) return null;
  const out = [];
  const seen = new Set(); // §1 says "deduped array" — enforce it HERE, not only
  //                         in the push producer (a future caller could store 5
  //                         identical entries otherwise; deep-audit D2).
  for (const e of arr) {
    if (out.length >= 5) break;
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const entry = {};
    const status = cleanJiraEntryStatus(e.status);
    if (status !== null) entry.status = status;
    if (Array.isArray(e.field_names)) {
      const names = e.field_names
        .filter((n) => typeof n === 'string' && FIELD_NAME_RE.test(n))
        .slice(0, 20);
      if (names.length) entry.field_names = names;
    }
    if (!('status' in entry) && !('field_names' in entry)) continue;
    const sig = `${entry.status ?? ''}|${(entry.field_names || []).slice().sort().join(',')}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(entry);
  }
  return out.length ? out : null;
}

function cleanCounts(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
  // Object.create(null): a `__proto__` input key used to pass COUNT_KEY_RE,
  // bump `kept` toward the cap, yet store nothing (the inherited setter is a
  // no-op) — a legit later key could be silently dropped (deep-audit NIT).
  // A null-prototype object stores it as a plain own key instead.
  const out = Object.create(null);
  let kept = 0;
  for (const key of Object.keys(c)) {
    if (kept >= 20) break;
    if (!COUNT_KEY_RE.test(key)) continue; // prose-shaped key → dropped (wall)
    const v = Number(c[key]);
    if (!Number.isFinite(v)) continue;
    out[key] = v;
    kept++;
  }
  return kept ? { ...out } : null; // re-literal so consumers get a normal object
}

function cleanOccurrences(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const count = Number(o.count);
  const firstTs = Number(o.firstTs);
  const lastTs = Number(o.lastTs);
  if (!Number.isFinite(count) || count < 1) return null;
  if (!Number.isFinite(firstTs) || !Number.isFinite(lastTs)) return null;
  return { count: Math.trunc(count), firstTs, lastTs };
}

/**
 * PURE. Whitelist-serialize a raw record into the §1 schema — the privacy
 * wall. Never throws; always returns a usable record.
 *
 * - ONLY schema fields survive (v, ts, ref, session_ref, op, error_class,
 *   level, subject, subject_idxs, subject_keys, jira, counts, occurrences,
 *   surfaced). Anything else — detail/message/reason/name/pageTitle/… — is
 *   dropped by construction (the record is BUILT, the input never spread).
 * - op/error_class outside the closed registries → 'unknown_op' /
 *   'unknown_error' (never the raw string).
 * - Bad optional fields are dropped, the record still stands.
 *
 * @param {object} raw
 * @returns {{ record: object }}
 */
export function validateRecord(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const record = {};

  record.v = 1;
  record.ts = Number.isFinite(src.ts) ? src.ts : Date.now();
  record.ref = cleanRef(src.ref); // string|null — null is the legit "no correlation id" case
  const sessionRef = cleanRef(src.session_ref);
  if (sessionRef) record.session_ref = sessionRef;

  record.op = DIAG_OPS_SET.has(src.op) ? src.op : 'unknown_op';
  record.error_class = DIAG_CLASSES_SET.has(src.error_class) ? src.error_class : 'unknown_error';
  record.level = src.level === 'warn' || src.level === 'info' ? src.level : 'error';

  const subject = cleanSubject(src.subject);
  if (subject) record.subject = subject;
  const subjectIdxs = cleanIdxs(src.subject_idxs);
  if (subjectIdxs) record.subject_idxs = subjectIdxs;
  const subjectKeys = cleanIssueKeys(src.subject_keys);
  if (subjectKeys) record.subject_keys = subjectKeys;
  const jira = cleanJira(src.jira);
  if (jira) record.jira = jira;
  const counts = cleanCounts(src.counts);
  if (counts) record.counts = counts;
  const occurrences = cleanOccurrences(src.occurrences);
  if (occurrences) record.occurrences = occurrences;

  record.surfaced = Boolean(src.surfaced);

  return { record };
}

// ════════════════════════════════════════════════════════════════════════
// Pure core — ring merge (dedupe-in-place + info-first eviction)
// ════════════════════════════════════════════════════════════════════════

function moreSevere(a, b) {
  const ra = SEVERITY_RANK[a] !== undefined ? SEVERITY_RANK[a] : SEVERITY_RANK.error;
  const rb = SEVERITY_RANK[b] !== undefined ? SEVERITY_RANK[b] : SEVERITY_RANK.error;
  return ra >= rb ? (SEVERITY_RANK[a] !== undefined ? a : 'error') : b;
}

function entryTs(e) {
  return e && Number.isFinite(e.ts) ? e.ts : 0; // malformed → treated oldest
}

/**
 * PURE. Merge a validated record into the ring (newest-first array).
 *
 * - Dedupe: same (ref, op, error_class) as an existing entry → that entry is
 *   updated IN PLACE (keeps its position): occurrences {count+1, firstTs:min,
 *   lastTs:record.ts}, level upgraded to the more severe, surfaced ||=,
 *   counts replaced by the newer record's counts when it carries any
 *   (absence keeps the existing counts — freshness, not deletion).
 * - No match → prepend.
 * - Cap DIAG_CAP with INFO-FIRST eviction: drop the oldest (smallest ts)
 *   'info' entry first; if no info present, the oldest overall — a success-
 *   breadcrumb stream can never evict an error record.
 *
 * Does not mutate the input ring or its entries.
 *
 * @param {object[]} ring
 * @param {object} record - a validateRecord-produced record
 * @returns {object[]} newRing
 */
export function mergeIntoRing(ring, record) {
  const base = Array.isArray(ring) ? ring : [];
  if (!record || typeof record !== 'object') return base.slice();

  const refOf = (e) => (e && e.ref !== undefined && e.ref !== null ? e.ref : null);
  const idx = base.findIndex(
    (e) =>
      e &&
      typeof e === 'object' &&
      refOf(e) === refOf(record) &&
      e.op === record.op &&
      e.error_class === record.error_class,
  );

  let out;
  if (idx >= 0) {
    // (deep-audit fix) re-validate the STORED entry before merging: `...prev`
    // used to carry a tampered/legacy entry's smuggled fields forward across
    // every re-write — the design distrusts stored KVS values at export; the
    // merge must distrust them too (the wall is structural at every hop, not
    // export-only). validateRecord whitelist-RECONSTRUCTS, so smuggled keys die
    // here; occurrences/ts are read from the RAW prev (validate preserves them).
    const prevRaw = base[idx];
    const { record: prev } = validateRecord(prevRaw);
    const prevOcc = prevRaw.occurrences && typeof prevRaw.occurrences === 'object' ? prevRaw.occurrences : null;
    const prevCount = prevOcc && Number.isFinite(prevOcc.count) ? prevOcc.count : 1;
    const prevFirst =
      prevOcc && Number.isFinite(prevOcc.firstTs) ? prevOcc.firstTs : entryTs(prevRaw) || record.ts;
    const merged = {
      ...prev,
      level: moreSevere(prev.level, record.level),
      surfaced: Boolean(prev.surfaced) || Boolean(record.surfaced),
      occurrences: {
        count: prevCount + 1,
        firstTs: Math.min(prevFirst, record.ts),
        lastTs: record.ts,
      },
    };
    if (record.counts) merged.counts = record.counts;
    // Same freshness rule for jira evidence: a repeat carrying NEW evidence
    // (e.g. 429 then 400 + field_names) keeps the newer; absence keeps prev.
    if (record.jira) merged.jira = record.jira;
    // (deep-audit P2 — the chimera fix) the SAME freshness rule for the other
    // evidence fields: a merged record used to keep push #1's subject_idxs/
    // keys/session_ref under push #2's counts — two pushes presented as one
    // incoherent incident. Newer evidence wins; absence keeps prev.
    if (record.subject) merged.subject = record.subject;
    if (record.subject_idxs) merged.subject_idxs = record.subject_idxs;
    if (record.subject_keys) merged.subject_keys = record.subject_keys;
    if (record.session_ref) merged.session_ref = record.session_ref;
    out = base.slice();
    out[idx] = merged;
  } else {
    out = [record, ...base];
  }

  while (out.length > DIAG_CAP) {
    let victim = -1;
    let victimTs = Infinity;
    for (let i = 0; i < out.length; i++) {
      const e = out[i];
      if (e && e.level === 'info' && entryTs(e) < victimTs) {
        victimTs = entryTs(e);
        victim = i;
      }
    }
    if (victim === -1) {
      for (let i = 0; i < out.length; i++) {
        if (entryTs(out[i]) < victimTs) {
          victimTs = entryTs(out[i]);
          victim = i;
        }
      }
    }
    if (victim === -1) victim = out.length - 1; // defensive; unreachable
    out.splice(victim, 1);
  }

  return out;
}

// ════════════════════════════════════════════════════════════════════════
// Pure core — export serialization (the second wall)
// ════════════════════════════════════════════════════════════════════════

/**
 * PURE. Serialize the ring for the user-carried support export.
 * EVERY record is re-passed through validateRecord — a smuggled/legacy
 * free-text field in a stored entry cannot reach the export. The envelope
 * is whitelist-built the same way ({app_version, exported_at, tier} only).
 *
 * @param {object[]} ring
 * @param {{app_version?: string, exported_at?: string|number, tier?: string}} envelope
 * @returns {string} pretty-printed (2-space) JSON
 */
export function serializeForExport(ring, envelope) {
  const env = envelope && typeof envelope === 'object' && !Array.isArray(envelope) ? envelope : {};
  const cleanEnvelope = {
    app_version: typeof env.app_version === 'string' ? env.app_version.slice(0, 40) : null,
    exported_at:
      typeof env.exported_at === 'string'
        ? env.exported_at.slice(0, 40)
        : Number.isFinite(env.exported_at)
          ? env.exported_at
          : new Date().toISOString(),
    tier: typeof env.tier === 'string' ? env.tier.slice(0, 40) : null,
    // [deep-audit P5 MED-1] the SERVED scope, whitelist-enum'd — a silently-degraded
    // admin export ('all' requested, non-admin → 'mine') was indistinguishable from
    // an install-wide one in the mailed artifact; support could misread one user's
    // ring as the whole install. Content-free.
    scope: env.scope === 'all' ? 'all' : env.scope === 'mine' ? 'mine' : null,
  };
  const list = Array.isArray(ring) ? ring : [];
  const records = list
    .filter((r) => r && typeof r === 'object' && !Array.isArray(r))
    .map((r) => validateRecord(r).record);
  return JSON.stringify({ envelope: cleanEnvelope, records }, null, 2);
}

// ════════════════════════════════════════════════════════════════════════
// Thin IO shell — lazy @forge/kvs (same package/named-export shape as
// src/index.js `import { kvs } from '@forge/kvs'`, loaded on first use)
// ════════════════════════════════════════════════════════════════════════

let kvsPromise = null;
function loadKvs() {
  // Bundling note (§13-gate verified): webpack (the @forge/cli bundler) folds
  // this dynamic import into the SINGLE output chunk because src/index.js
  // statically imports `{ kvs } from '@forge/kvs'` in the same entry graph —
  // keep that static import alive or re-verify the bundle shape.
  if (!kvsPromise) {
    // Reset on rejection (deep-audit fix): a cached REJECTED promise would
    // permanently disable diagnostics for the isolate — one transient import
    // failure must not outlive itself; the next call retries.
    kvsPromise = import('@forge/kvs')
      .then((m) => m.kvs)
      .catch((e) => {
        kvsPromise = null;
        throw e;
      });
  }
  return kvsPromise;
}

// Whole-module loader for the named exports beyond `kvs` (WhereConditions for the
// §2.10 cross-bucket query). Same lazy/bundling contract as loadKvs above; the
// ESM module cache makes the two promises share one underlying instance.
let kvsModulePromise = null;
function loadKvsModule() {
  if (!kvsModulePromise) {
    kvsModulePromise = import('@forge/kvs').catch((e) => {
      kvsModulePromise = null; // same reset-on-rejection rule as loadKvs
      throw e;
    });
  }
  return kvsModulePromise;
}

/**
 * Record one diagnostic event into the owner's per-user ring + the aggregate
 * sidecar. NEVER throws (outer try/catch → console.warn '[diag] write
 * failed' + ref — codes only, no content).
 *
 * Bucket accountId = `owner` (job-owner stamping, design §2.4) falling back
 * to `context.accountId` (server-trusted, never payload). Falsy → SKIP the
 * write entirely — no shared 'unknown' bucket (it would leak jobIds
 * cross-user). The skip happens BEFORE any kvs import, so the call is safe
 * offline as well.
 *
 * @param {{context?: object, owner?: string, record?: object}} args
 * @returns {Promise<{skipped: true}|{ok: boolean}>}
 */
export async function recordDiagnostic(args) {
  let ref = null;
  try {
    // (deep-audit fix) NO destructuring in the signature: `fn(null)` would throw
    // during parameter binding — BEFORE this try — rejecting the promise and
    // leaking an unhandledRejection on a fire-and-forget call. Same pattern on
    // every IO function below; "never throws" must include `null`.
    const { context, owner, record } = args && typeof args === 'object' ? args : {};
    const accountId =
      typeof owner === 'string' && owner
        ? owner
        : context && typeof context.accountId === 'string' && context.accountId
          ? context.accountId
          : null;
    if (!accountId) return { skipped: true }; // before ANY kvs touch

    const { record: rec } = validateRecord(record);
    ref = rec.ref;

    const kvs = await loadKvs();
    const bucketKey = diagBucketKey(accountId);
    const ring = await kvs.get(bucketKey);
    const merged = mergeIntoRing(Array.isArray(ring) ? ring : [], rec);
    await kvs.set(bucketKey, merged);

    // Aggregate sidecar — best-effort, its own try/catch (a sidecar failure
    // must never lose the ring write that already succeeded).
    try {
      const aggRaw = await kvs.get(DIAG_AGG_KEY);
      const agg = aggRaw && typeof aggRaw === 'object' && !Array.isArray(aggRaw) ? aggRaw : {};
      const prev =
        agg[rec.error_class] && typeof agg[rec.error_class] === 'object'
          ? agg[rec.error_class]
          : {};
      const prevCount = Number.isFinite(prev.count) ? prev.count : 0;
      agg[rec.error_class] = { count: prevCount + 1, lastTs: rec.ts };
      await kvs.set(DIAG_AGG_KEY, agg);
    } catch (aggErr) {
      console.warn(`[diag] aggregate update failed ref=${ref || 'none'}`);
    }

    return { ok: true };
  } catch (err) {
    try {
      console.warn(`[diag] write failed ref=${ref || 'none'}`);
    } catch (logErr) {
      /* never throw */
    }
    return { ok: false };
  }
}

/**
 * Zone-2 rich-detail sibling (§2b): store the verbatim failure detail under
 * its own key, capped at DETAIL_CAP_CHARS, with a ~30-day lifecycle. NEVER
 * throws. Skips on missing/garbage ref (the ref becomes a KVS key suffix —
 * shape-checked) or empty text.
 *
 * TTL: the installed @forge/kvs (1.6.4) exposes a native TTL —
 * `set(key, value, { ttl: { value, unit } })` (SetOptions.ttl, verified in
 * node_modules/@forge/kvs/out/interfaces/types.d.ts). Used here; if the
 * platform rejects the option at runtime we fall back to a plain set —
 * `expiresAt` in the value + lazy expiry on read covers it either way.
 *
 * @param {{ref?: string, text?: string}} args
 * @returns {Promise<{skipped: true}|{ok: boolean}>}
 */
export async function writeDiagnosticDetail(args) {
  let ref = null;
  try {
    let text;
    ({ ref, text } = args && typeof args === 'object' ? args : {});
    if (typeof ref !== 'string' || !DETAIL_REF_RE.test(ref)) return { skipped: true };
    const body = (typeof text === 'string' ? text : text == null ? '' : String(text)).slice(
      0,
      DETAIL_CAP_CHARS,
    );
    if (!body) return { skipped: true };

    const ts = Date.now();
    const value = { ref, text: body, ts, expiresAt: ts + DETAIL_TTL_MS };
    const kvs = await loadKvs();
    try {
      await kvs.set(diagDetailKey(ref), value, {
        ttl: { value: DETAIL_TTL_DAYS, unit: 'DAYS' },
      });
    } catch (ttlErr) {
      await kvs.set(diagDetailKey(ref), value); // lazy expiry still bounds it
    }
    return { ok: true };
  } catch (err) {
    try {
      console.warn(
        `[diag] detail write failed ref=${typeof ref === 'string' ? ref.slice(0, 80) : 'none'}`,
      );
    } catch (logErr) {
      /* never throw */
    }
    return { ok: false };
  }
}

/**
 * Read one user's diagnostic ring. [] on ANY error (pure read, no repair).
 * @param {{accountId?: string}} args
 * @returns {Promise<object[]>}
 */
export async function readDiagnostics(args) {
  try {
    const { accountId } = args && typeof args === 'object' ? args : {};
    if (typeof accountId !== 'string' || !accountId) return [];
    const kvs = await loadKvs();
    const ring = await kvs.get(diagBucketKey(accountId));
    return Array.isArray(ring) ? ring : [];
  } catch (err) {
    return [];
  }
}

/**
 * Enumerate EVERY per-user diagnostics bucket (`spec2jira_diag:u:*`) — the
 * §2.10 enterprise-admin "All users" read. The caller (getDiagnostics) gates
 * admin-ness; this just enumerates.
 *
 * SHIPPED PATH: the NATIVE @forge/kvs query API — verified empirically against
 * the installed package (@forge/kvs 1.6.4): out/kvs.d.ts exposes
 * `query(): QueryBuilder`, out/query.d.ts exposes
 * `.where('key', WhereClause)`/`.cursor()`/`.limit()`/`.getMany() →
 * {results: [{key, value}], nextCursor?}`, and out/conditions.d.ts exports
 * `WhereConditions.beginsWith`. Because the native query exists, the design's
 * documented FALLBACK (`spec2jira_diag:index` maintained by recordDiagnostic)
 * is NOT implemented — no extra write amplification on the hot record path.
 *
 * Cursor-paginates to exhaustion, defensively capped at DIAG_ALL_BUCKETS_CAP
 * buckets. [] on ANY error (fail-open read — a diagnostics surface must never
 * itself fail; the per-user runbook fallback always works).
 *
 * @returns {Promise<Array<{accountId: string, records: object[]}>>}
 */
export async function readAllDiagnostics() {
  try {
    const { kvs, WhereConditions } = await loadKvsModule();
    const buckets = [];
    let cursor;
    const maxPages = Math.ceil(DIAG_ALL_BUCKETS_CAP / DIAG_QUERY_PAGE_LIMIT) + 1; // hard loop bound
    for (let page = 0; page < maxPages && buckets.length < DIAG_ALL_BUCKETS_CAP; page++) {
      let q = kvs
        .query()
        .where('key', WhereConditions.beginsWith(DIAG_BUCKET_PREFIX))
        .limit(DIAG_QUERY_PAGE_LIMIT);
      if (cursor) q = q.cursor(cursor);
      const res = await q.getMany();
      const results = res && Array.isArray(res.results) ? res.results : [];
      for (const r of results) {
        if (buckets.length >= DIAG_ALL_BUCKETS_CAP) break;
        if (!r || typeof r.key !== 'string' || !r.key.startsWith(DIAG_BUCKET_PREFIX)) continue;
        const accountId = r.key.slice(DIAG_BUCKET_PREFIX.length);
        if (!accountId) continue;
        buckets.push({ accountId, records: Array.isArray(r.value) ? r.value : [] });
      }
      cursor = res ? res.nextCursor : undefined;
      if (!cursor || results.length === 0) break;
    }
    return buckets;
  } catch (err) {
    try {
      console.warn('[diag] readAllDiagnostics failed');
    } catch (logErr) {
      /* never throw */
    }
    return [];
  }
}

/**
 * Read the zone-2 detail text for a ref. null if absent OR lazily expired
 * (expiresAt < now → best-effort delete, then null).
 * @param {{ref?: string}} args
 * @returns {Promise<string|null>}
 */
export async function readDiagnosticDetail(args) {
  try {
    const { ref } = args && typeof args === 'object' ? args : {};
    if (typeof ref !== 'string' || !DETAIL_REF_RE.test(ref)) return null;
    const kvs = await loadKvs();
    const value = await kvs.get(diagDetailKey(ref));
    if (!value || typeof value !== 'object' || typeof value.text !== 'string') return null;
    if (Number.isFinite(value.expiresAt) && value.expiresAt < Date.now()) {
      try {
        await kvs.delete(diagDetailKey(ref));
      } catch (delErr) {
        /* best-effort */
      }
      return null;
    }
    return value.text;
  } catch (err) {
    return null;
  }
}

/**
 * Read the install-wide aggregate sidecar ({[error_class]: {count, lastTs}}).
 * {} on error.
 * @returns {Promise<object>}
 */
export async function readAggregate() {
  try {
    const kvs = await loadKvs();
    const agg = await kvs.get(DIAG_AGG_KEY);
    return agg && typeof agg === 'object' && !Array.isArray(agg) ? agg : {};
  } catch (err) {
    return {};
  }
}

/**
 * Delete one user's own bucket (GDPR-erasure self-service). Never throws.
 * The aggregate sidecar is install-wide and content-free — not touched.
 * @param {{accountId?: string}} args
 * @returns {Promise<{skipped: true}|{ok: boolean}>}
 */
export async function clearDiagnostics(args) {
  try {
    const { accountId } = args && typeof args === 'object' ? args : {};
    if (typeof accountId !== 'string' || !accountId) return { skipped: true };
    const kvs = await loadKvs();
    await kvs.delete(diagBucketKey(accountId));
    return { ok: true };
  } catch (err) {
    try {
      console.warn('[diag] clear failed');
    } catch (logErr) {
      /* never throw */
    }
    return { ok: false };
  }
}
