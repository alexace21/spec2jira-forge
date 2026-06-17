#!/usr/bin/env node
/**
 * Offline unit tests for the diagnostics module (src/diagnostics.js — Phase 1).
 *
 * Runs under plain `node` with NO network and NO Forge runtime: the module's
 * pure core (validateRecord / mergeIntoRing / serializeForExport) is
 * import-free, and the IO shell's guard paths return BEFORE the lazy
 * @forge/kvs import — both facts are asserted here.
 *
 * What this proves (the §1/§2 contract, docs/DIAGNOSTICS-LEDGER-DESIGN.md):
 *   1. The MUST-NOT privacy wall — free-text fields dropped under ANY name.
 *   2. Unknown op/error_class normalize to sentinels, never the raw string.
 *   3. Per-kind structural subject validation.
 *   4. jira[] shape: single-object wrap, caps, garbage dropped.
 *   5. Dedupe-in-place: (ref, op, error_class) → occurrences/level/surfaced.
 *   6. Info-first ring eviction (breadcrumbs can never evict an error).
 *   7. subject_idxs / subject_keys caps and filters.
 *   8. serializeForExport re-validates (the second wall) + envelope whitelist.
 *   9. recordDiagnostic skips entirely (before any kvs import) w/o accountId.
 *  10. IO-shell guard paths are offline-safe (skip/empty before Forge touch).
 *
 * Usage: node prototype/test_diagnostics.js
 */
import {
  DIAG_OPS,
  DIAG_CLASSES,
  DIAG_CAP,
  DETAIL_CAP_CHARS,
  DETAIL_TTL_MS,
  DIAG_BUCKET_PREFIX,
  DIAG_AGG_KEY,
  DIAG_DETAIL_PREFIX,
  DIAG_APP_VERSION,
  DIAG_ALL_BUCKETS_CAP,
  diagBucketKey,
  diagDetailKey,
  validateRecord,
  mergeIntoRing,
  serializeForExport,
  classifyDiagGenerationError,
  recordDiagnostic,
  writeDiagnosticDetail,
  readDiagnostics,
  readAllDiagnostics,
  readDiagnosticDetail,
  readAggregate,
  clearDiagnostics,
} from '../src/diagnostics.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    console.log(`  ✗ ${name}  — ${detail}`);
    failures++;
  }
}

console.log('Diagnostics module tests (offline, no Forge / no network)\n' + '='.repeat(60));

// ── 1. MUST-NOT wall: free-text fields dropped under ANY name ─────────────
{
  console.log('\n■ 1. Privacy wall — banned/unknown fields dropped');
  const BANNED = [
    'detail',
    'message',
    'reason',
    'name',
    'pageTitle',
    'summary',
    'errorMessages',
    'phase',
    'source',
    'target',
    'taskSummary',
    'displayName',
    'email',
    'browseBase',
  ];
  const raw = {
    op: 'push.final',
    error_class: 'partial_push',
    ref: 'job-abc',
    ts: 1000,
    // every banned key carries a sentinel that must NOT survive
    detail: 'SECRET_DETAIL',
    message: 'SECRET_MESSAGE',
    reason: 'SECRET_REASON',
    name: 'SECRET_NAME',
    pageTitle: 'SECRET_TITLE',
    summary: 'SECRET_SUMMARY',
    errorMessages: ['SECRET_ERR'],
    phase: 'stories',
    source: 'Feature A',
    target: 'Feature B',
    taskSummary: 'SECRET_TASK',
    displayName: 'Alex',
    email: 'a@b.c',
    browseBase: 'https://site.atlassian.net',
  };
  const { record } = validateRecord(raw);
  const keys = Object.keys(record);
  const leaked = BANNED.filter((k) => keys.includes(k));
  check('no banned key survives', leaked.length === 0, `leaked: ${leaked.join(',')}`);
  const json = JSON.stringify(record);
  check('no banned VALUE survives anywhere', !/SECRET_|Feature A|Alex|a@b\.c|atlassian\.net/.test(json), json);
  check('schema fields kept', record.op === 'push.final' && record.error_class === 'partial_push' && record.ref === 'job-abc', json);
  const ALLOWED = ['v', 'ts', 'ref', 'session_ref', 'op', 'error_class', 'level', 'subject', 'subject_idxs', 'subject_keys', 'jira', 'counts', 'occurrences', 'surfaced'];
  check('only whitelisted keys present', keys.every((k) => ALLOWED.includes(k)), keys.join(','));
}

// ── 2. Unknown op / error_class → sentinels, never the raw string ─────────
{
  console.log('\n■ 2. Unknown op / error_class normalized');
  const { record } = validateRecord({ op: 'push.bogus_thing', error_class: 'weird_made_up_class', ts: 1 });
  check("unknown op → 'unknown_op'", record.op === 'unknown_op', record.op);
  check("unknown class → 'unknown_error'", record.error_class === 'unknown_error', record.error_class);
  const json = JSON.stringify(record);
  check('raw strings absent from the record', !json.includes('bogus') && !json.includes('weird_made_up'), json);
  const ok = validateRecord({ op: 'generation.poll', error_class: 'anthropic_http', ts: 1 }).record;
  check('registry members pass through', ok.op === 'generation.poll' && ok.error_class === 'anthropic_http', JSON.stringify(ok));
}

// ── 3. Subject shape validation per kind ──────────────────────────────────
{
  console.log('\n■ 3. Subject per-kind structural checks');
  const base = { op: 'push.final', error_class: 'partial_push', ts: 1 };
  const v = (subject) => validateRecord({ ...base, subject }).record.subject;
  check('issue: good key passes', JSON.stringify(v({ kind: 'issue', id: 'SDTY-42' })) === '{"kind":"issue","id":"SDTY-42"}', JSON.stringify(v({ kind: 'issue', id: 'SDTY-42' })));
  check("issue: 'My Story Name' dropped", v({ kind: 'issue', id: 'My Story Name' }) === undefined, JSON.stringify(v({ kind: 'issue', id: 'My Story Name' })));
  check('issue: lowercase dropped', v({ kind: 'issue', id: 'sdty-42' }) === undefined, 'kept');
  check('page: digits string passes', v({ kind: 'page', id: '123456' }) !== undefined, 'dropped');
  check('page: number passes', v({ kind: 'page', id: 98765 }) !== undefined, 'dropped');
  check('page: non-digits dropped', v({ kind: 'page', id: '12a45' }) === undefined, 'kept');
  check('idx: integer passes', v({ kind: 'idx', id: 4 }) !== undefined, 'dropped');
  check('idx: non-integer dropped', v({ kind: 'idx', id: 3.5 }) === undefined, 'kept');
  check('idx: negative dropped', v({ kind: 'idx', id: -1 }) === undefined, 'kept');
  // story_uid must match the MINTED shape (v3Schema newStoryUid → `s_…`; §13-gate fix) —
  // a non-minted "uid-ish" string is treated as a possible name fragment and dropped.
  check('story_uid: minted shape passes', v({ kind: 'story_uid', id: 's_1a2b3c' }) !== undefined, 'dropped');
  check('story_uid: non-minted shape dropped', v({ kind: 'story_uid', id: 'uid-1a2b3c' }) === undefined, 'kept');
  check('story_uid: whitespace (prose) dropped', v({ kind: 'story_uid', id: 'My Story Name' }) === undefined, 'kept');
  check('story_uid: >64 chars dropped', v({ kind: 'story_uid', id: 's_' + 'x'.repeat(63) }) === undefined, 'kept');
  check('unknown kind dropped', v({ kind: 'user', id: 'abc' }) === undefined, 'kept');
  check('record survives a dropped subject', validateRecord({ ...base, subject: { kind: 'issue', id: 'bad name' } }).record.op === 'push.final', 'record broken');
}

// ── 4. jira[]: single-object wrap, caps, garbage dropped ─────────────────
{
  console.log('\n■ 4. jira field shape');
  const base = { op: 'push.step', error_class: 'jira_http', ts: 1 };
  const manyNames = Array.from({ length: 25 }, (_, i) => (i === 0 ? 'f'.repeat(150) : `field_${i}`));
  const single = validateRecord({ ...base, jira: { status: 400, field_names: manyNames } }).record.jira;
  check('single object wrapped into array', Array.isArray(single) && single.length === 1, JSON.stringify(single));
  check('field_names capped at 20', single[0].field_names.length === 20, String(single[0].field_names.length));
  check('each field name capped at 100 chars', single[0].field_names.every((n) => n.length <= 100), 'over-long survived');
  check('status integer kept', single[0].status === 400, String(single[0].status));

  const seven = Array.from({ length: 7 }, (_, i) => ({ status: 400 + i }));
  const capped = validateRecord({ ...base, jira: seven }).record.jira;
  check('entries capped at 5', capped.length === 5, String(capped.length));

  const mixed = validateRecord({
    ...base,
    jira: ['garbage', 42, null, { status: '404' }, { nonsense: true }, { field_names: ['customfield_10016'] }],
  }).record.jira;
  check('garbage entries dropped, valid kept', mixed.length === 2, JSON.stringify(mixed));
  check("digit-string status coerced to int", mixed[0].status === 404, JSON.stringify(mixed[0]));
  check('field_names-only entry kept', JSON.stringify(mixed[1].field_names) === '["customfield_10016"]', JSON.stringify(mixed[1]));
  check('all-garbage jira → field absent', validateRecord({ ...base, jira: [{}, 'x'] }).record.jira === undefined, 'kept');
}

// ── 5. Dedupe: same (ref, op, error_class) merges in place ───────────────
{
  console.log('\n■ 5. Dedupe-in-place');
  const r1 = validateRecord({ ref: 'job-x', op: 'push.final', error_class: 'partial_push', level: 'warn', ts: 111, counts: { stories_failed: 2 } }).record;
  const r2 = validateRecord({ ref: 'job-x', op: 'push.final', error_class: 'partial_push', level: 'error', ts: 222, counts: { stories_failed: 5 }, surfaced: true }).record;
  let ring = mergeIntoRing([], r1);
  ring = mergeIntoRing(ring, r2);
  check('one entry, not two', ring.length === 1, String(ring.length));
  check('occurrences.count = 2', ring[0].occurrences && ring[0].occurrences.count === 2, JSON.stringify(ring[0].occurrences));
  check('firstTs = min', ring[0].occurrences.firstTs === 111, String(ring[0].occurrences.firstTs));
  check('lastTs updated to newer ts', ring[0].occurrences.lastTs === 222, String(ring[0].occurrences.lastTs));
  check('level upgraded warn→error', ring[0].level === 'error', ring[0].level);
  check('surfaced ||= true', ring[0].surfaced === true, String(ring[0].surfaced));
  check('counts replaced by newer', ring[0].counts.stories_failed === 5, JSON.stringify(ring[0].counts));

  // severity never downgraded; counts kept when the repeat carries none
  const e1 = validateRecord({ ref: 'job-y', op: 'generation.poll', error_class: 'anthropic_http', level: 'error', ts: 10, counts: { http_status: 529 } }).record;
  const e2 = validateRecord({ ref: 'job-y', op: 'generation.poll', error_class: 'anthropic_http', level: 'info', ts: 20 }).record;
  const ring2 = mergeIntoRing(mergeIntoRing([], e1), e2);
  check('level NOT downgraded by a later info', ring2[0].level === 'error', ring2[0].level);
  check('counts kept when repeat has none', ring2[0].counts && ring2[0].counts.http_status === 529, JSON.stringify(ring2[0].counts));

  // different class with same ref/op → separate entry, newest prepended
  const e3 = validateRecord({ ref: 'job-y', op: 'generation.poll', error_class: 'rate_limited', ts: 30 }).record;
  const ring3 = mergeIntoRing(ring2, e3);
  check('different error_class → new entry prepended', ring3.length === 2 && ring3[0].error_class === 'rate_limited', JSON.stringify(ring3.map((e) => e.error_class)));

  // merged entry keeps its position (in place, not re-prepended)
  const a = validateRecord({ ref: 'A', op: 'push.final', error_class: 'partial_push', ts: 1 }).record;
  const b = validateRecord({ ref: 'B', op: 'push.final', error_class: 'partial_push', ts: 2 }).record;
  const aAgain = validateRecord({ ref: 'A', op: 'push.final', error_class: 'partial_push', ts: 3 }).record;
  const ring4 = mergeIntoRing(mergeIntoRing(mergeIntoRing([], a), b), aAgain);
  check('merge keeps position (B still front)', ring4[0].ref === 'B' && ring4[1].ref === 'A' && ring4[1].occurrences.count === 2, JSON.stringify(ring4.map((e) => e.ref)));

  // purity: inputs not mutated
  const frozenRing = [validateRecord({ ref: 'F', op: 'purge', error_class: 'purge_incomplete', ts: 5 }).record];
  const snapshot = JSON.stringify(frozenRing);
  mergeIntoRing(frozenRing, validateRecord({ ref: 'F', op: 'purge', error_class: 'purge_incomplete', ts: 9 }).record);
  check('input ring not mutated', JSON.stringify(frozenRing) === snapshot, 'mutated');
}

// ── 6. Info-first eviction at DIAG_CAP ────────────────────────────────────
{
  console.log('\n■ 6. Info-first eviction');
  // Mixed ring: 50 entries, alternating error/info, ascending ts (i=0 oldest).
  let ring = [];
  for (let i = 0; i < DIAG_CAP; i++) {
    const rec = validateRecord({
      ref: `job-${i}`,
      op: 'generation.poll',
      error_class: i % 2 === 0 ? 'anthropic_http' : 'generation_completed',
      level: i % 2 === 0 ? 'error' : 'info',
      ts: 1000 + i,
    }).record;
    ring = mergeIntoRing(ring, rec);
  }
  check(`ring filled to cap (${DIAG_CAP})`, ring.length === DIAG_CAP, String(ring.length));
  const errorsBefore = ring.filter((e) => e.level === 'error').length;

  const newErr = validateRecord({ ref: 'job-new', op: 'push.final', error_class: 'partial_push', level: 'error', ts: 9999 }).record;
  ring = mergeIntoRing(ring, newErr);
  check('cap held after add', ring.length === DIAG_CAP, String(ring.length));
  check('OLDEST info evicted (job-1, ts=1001)', !ring.some((e) => e.ref === 'job-1'), 'job-1 still present');
  check('oldest ERROR survived (job-0, ts=1000)', ring.some((e) => e.ref === 'job-0'), 'job-0 evicted');
  const errorsAfter = ring.filter((e) => e.level === 'error').length;
  check('all errors retained (+1 new)', errorsAfter === errorsBefore + 1, `${errorsBefore} → ${errorsAfter}`);
  check('new record at front', ring[0].ref === 'job-new', ring[0].ref);

  // All-error ring: no info present → oldest overall evicted.
  let ring2 = [];
  for (let i = 0; i < DIAG_CAP; i++) {
    ring2 = mergeIntoRing(
      ring2,
      validateRecord({ ref: `e-${i}`, op: 'push.step', error_class: 'jira_http', level: 'error', ts: 2000 + i }).record,
    );
  }
  ring2 = mergeIntoRing(ring2, validateRecord({ ref: 'e-new', op: 'push.step', error_class: 'step_exception', level: 'error', ts: 9999 }).record);
  check('no info → oldest overall evicted (e-0)', ring2.length === DIAG_CAP && !ring2.some((e) => e.ref === 'e-0'), 'e-0 still present');
  check('second-oldest error survived (e-1)', ring2.some((e) => e.ref === 'e-1'), 'e-1 evicted');
}

// ── 7. subject_idxs / subject_keys caps & filters ─────────────────────────
{
  console.log('\n■ 7. subject_idxs / subject_keys caps');
  const base = { op: 'push.final', error_class: 'partial_push', ts: 1 };
  const idxs = validateRecord({ ...base, subject_idxs: Array.from({ length: 25 }, (_, i) => i) }).record.subject_idxs;
  check('subject_idxs capped at 20', idxs.length === 20, String(idxs.length));
  const filtered = validateRecord({ ...base, subject_idxs: [1, 2.5, 'x', 3, -4, NaN, 0] }).record.subject_idxs;
  check('non-integers/negatives filtered', JSON.stringify(filtered) === '[1,3,0]', JSON.stringify(filtered));
  check('empty-after-filter → field absent', validateRecord({ ...base, subject_idxs: ['a', 'b'] }).record.subject_idxs === undefined, 'kept');

  const keys = validateRecord({
    ...base,
    subject_keys: ['SDTY-1', 'not a key', 'SDTY-2', 'sdty-3', 'PROJ_X-44', ...Array.from({ length: 30 }, (_, i) => `BIG-${i + 1}`)],
  }).record.subject_keys;
  check('only issue-key shapes kept', keys.every((k) => /^[A-Z][A-Z0-9_]*-\d+$/.test(k)), JSON.stringify(keys));
  check("prose ('not a key') dropped", !keys.includes('not a key'), 'kept');
  check('subject_keys capped at 20', keys.length === 20, String(keys.length));
}

// ── 8. serializeForExport — the second wall ───────────────────────────────
{
  console.log('\n■ 8. Export re-validation (second wall) + envelope whitelist');
  const good = validateRecord({ ref: 'job-z', op: 'generation.complete', error_class: 'kvs_persist_failed', ts: 1234, counts: { approx_bytes: 250000 } }).record;
  // Simulate a tampered/legacy KVS entry: smuggle free text + unknown class.
  const tampered = { ...good, detail: 'SMUGGLED page content here', error_class: 'made_up_later_class' };
  const out = serializeForExport([tampered, null, 'junk'], {
    app_version: '5.3.0',
    tier: 'byokPro',
    secret_extra: 'MUST_NOT_EXPORT',
  });
  const parsed = JSON.parse(out);
  check('smuggled free-text field re-dropped', parsed.records[0].detail === undefined, JSON.stringify(parsed.records[0]));
  check('no smuggled VALUE in output', !out.includes('SMUGGLED'), 'leaked');
  check('unknown class re-normalized', parsed.records[0].error_class === 'unknown_error', parsed.records[0].error_class);
  check('valid fields survive re-validation', parsed.records[0].ref === 'job-z' && parsed.records[0].counts.approx_bytes === 250000, JSON.stringify(parsed.records[0]));
  check('non-object ring entries filtered', parsed.records.length === 1, String(parsed.records.length));
  check('envelope whitelisted (no extra key)', parsed.envelope.secret_extra === undefined && !out.includes('MUST_NOT_EXPORT'), JSON.stringify(parsed.envelope));
  check('envelope carries app_version/tier', parsed.envelope.app_version === '5.3.0' && parsed.envelope.tier === 'byokPro', JSON.stringify(parsed.envelope));
  check('exported_at stamped when absent', typeof parsed.envelope.exported_at === 'string' && parsed.envelope.exported_at.length > 0, String(parsed.envelope.exported_at));
  check('pretty-printed (2-space)', out.includes('\n  "envelope"'), out.slice(0, 40));
  check('ts preserved through re-validation (not re-stamped)', parsed.records[0].ts === 1234, String(parsed.records[0].ts));
}

// ── 9. recordDiagnostic skip path (offline-safe: BEFORE any kvs import) ──
{
  console.log('\n■ 9. recordDiagnostic without accountId → skip, never throws');
  const rec = { op: 'push.final', error_class: 'partial_push', ref: 'job-q' };
  const r1 = await recordDiagnostic({ context: {}, owner: null, record: rec });
  check('empty context + no owner → {skipped:true}', r1 && r1.skipped === true, JSON.stringify(r1));
  const r2 = await recordDiagnostic({ record: rec });
  check('no context at all → {skipped:true}', r2 && r2.skipped === true, JSON.stringify(r2));
  const r3 = await recordDiagnostic({ context: { accountId: '' }, record: rec });
  check('empty-string accountId → {skipped:true}', r3 && r3.skipped === true, JSON.stringify(r3));
  const r4 = await recordDiagnostic({ context: { accountId: 42 }, owner: { bad: true }, record: rec });
  check('non-string accountId/owner → {skipped:true}', r4 && r4.skipped === true, JSON.stringify(r4));
  const r5 = await recordDiagnostic();
  check('no args at all → {skipped:true}', r5 && r5.skipped === true, JSON.stringify(r5));
  // {skipped:true} (not {ok:false}) PROVES the skip branch ran before the
  // kvs import — a failed import would have landed in the outer catch.
}

// ── 10. IO-shell guard paths (offline-safe, before Forge touch) ───────────
{
  console.log('\n■ 10. IO guard paths offline');
  const w1 = await writeDiagnosticDetail({ ref: null, text: 'something' });
  check('detail: no ref → skipped', w1 && w1.skipped === true, JSON.stringify(w1));
  const w2 = await writeDiagnosticDetail({ ref: 'job-ok', text: '' });
  check('detail: empty text → skipped', w2 && w2.skipped === true, JSON.stringify(w2));
  const w3 = await writeDiagnosticDetail({ ref: 'has spaces — not a key-safe ref', text: 'x' });
  check('detail: non-key-safe ref → skipped', w3 && w3.skipped === true, JSON.stringify(w3));
  const d1 = await readDiagnostics({});
  check('readDiagnostics no accountId → []', Array.isArray(d1) && d1.length === 0, JSON.stringify(d1));
  const d2 = await readDiagnosticDetail({});
  check('readDiagnosticDetail no ref → null', d2 === null, JSON.stringify(d2));
  const c1 = await clearDiagnostics({});
  check('clearDiagnostics no accountId → skipped', c1 && c1.skipped === true, JSON.stringify(c1));
}

// ── 11. Misc validation: refs, counts, defaults, occurrences ─────────────
{
  console.log('\n■ 11. Refs / counts / defaults');
  const base = { op: 'settings.key', error_class: 'auth_rejected' };
  // Deep-audit semantics change: an over-long ref is DROPPED, not truncated —
  // truncation would still retain 80 chars of whatever was smuggled; no minted
  // ref exceeds 80 (UUID = 36), so a longer value is never a legit id.
  const longRef = validateRecord({ ...base, ref: 'r'.repeat(100), ts: 1 }).record.ref;
  check('over-long ref dropped (not truncated)', longRef === null, String(longRef));
  check('whitespace ref (prose) → null', validateRecord({ ...base, ref: 'failed on page Secret Plan', ts: 1 }).record.ref === null, 'kept');
  check('non-string ref → null', validateRecord({ ...base, ref: 42, ts: 1 }).record.ref === null, 'kept');
  check('invalid session_ref dropped', validateRecord({ ...base, session_ref: 12, ts: 1 }).record.session_ref === undefined, 'kept');
  check('valid session_ref kept', validateRecord({ ...base, session_ref: 'abc-123', ts: 1 }).record.session_ref === 'abc-123', 'dropped');

  const counts = validateRecord({
    ...base,
    ts: 1,
    counts: { ok_key: 5, 'bad key with spaces': 3, nan_val: 'abc', num_str: '7', ['k'.repeat(50)]: 1 },
  }).record.counts;
  check('code-shaped counts keys kept, values coerced', counts.ok_key === 5 && counts.num_str === 7, JSON.stringify(counts));
  check('prose-shaped counts key dropped (wall)', counts['bad key with spaces'] === undefined, JSON.stringify(counts));
  check('non-numeric count dropped', counts.nan_val === undefined, JSON.stringify(counts));
  check('over-long counts key dropped', Object.keys(counts).length === 2, JSON.stringify(Object.keys(counts)));
  const manyCounts = {};
  for (let i = 0; i < 30; i++) manyCounts[`k_${i}`] = i;
  check('counts capped at 20 keys', Object.keys(validateRecord({ ...base, ts: 1, counts: manyCounts }).record.counts).length === 20, 'over 20');

  const defaults = validateRecord({ op: 'health.check', error_class: 'health_ok' }).record;
  check('v stamped 1', defaults.v === 1, String(defaults.v));
  check('ts stamped when absent', Number.isFinite(defaults.ts) && defaults.ts > 0, String(defaults.ts));
  check("level defaults to 'error'", defaults.level === 'error', defaults.level);
  check('surfaced defaults to false', defaults.surfaced === false, String(defaults.surfaced));
  check('level whitelist enforced', validateRecord({ ...base, ts: 1, level: 'critical' }).record.level === 'error', 'bad level kept');
  check("level 'info' accepted", validateRecord({ ...base, ts: 1, level: 'info' }).record.level === 'info', 'rejected');

  const occ = validateRecord({ ...base, ts: 1, occurrences: { count: 3, firstTs: 5, lastTs: 9 } }).record.occurrences;
  check('valid occurrences preserved', occ && occ.count === 3 && occ.firstTs === 5 && occ.lastTs === 9, JSON.stringify(occ));
  check('garbage occurrences dropped', validateRecord({ ...base, ts: 1, occurrences: { count: 'x' } }).record.occurrences === undefined, 'kept');
  check('never throws on garbage input', (() => { try { validateRecord(null); validateRecord('x'); validateRecord([1]); validateRecord(undefined); return true; } catch (e) { return false; } })(), 'threw');
}

// ── 12. Registry & constants sanity ───────────────────────────────────────
{
  console.log('\n■ 12. Registries & constants');
  check('DIAG_CAP = 50', DIAG_CAP === 50, String(DIAG_CAP));
  check('DETAIL_CAP_CHARS = 4096', DETAIL_CAP_CHARS === 4096, String(DETAIL_CAP_CHARS));
  check('DETAIL_TTL_MS = 30 days', DETAIL_TTL_MS === 30 * 24 * 3600 * 1000, String(DETAIL_TTL_MS));
  check('bucket key shape', diagBucketKey('557058:abc') === 'spec2jira_diag:u:557058:abc' && DIAG_BUCKET_PREFIX === 'spec2jira_diag:u:', diagBucketKey('557058:abc'));
  check('agg key', DIAG_AGG_KEY === 'spec2jira_diag:agg', DIAG_AGG_KEY);
  check('detail key shape', diagDetailKey('job-1') === 'spec2jira_diagdetail:job-1' && DIAG_DETAIL_PREFIX === 'spec2jira_diagdetail:', diagDetailKey('job-1'));
  check('ops registry has sentinels + core ops', ['unknown_op', 'generation.start', 'push.step', 'testgen.export', 'invoke.failed', 'health.check', 'purge'].every((o) => DIAG_OPS.includes(o)), DIAG_OPS.join(','));
  check('classes registry has sentinels + breadcrumbs', ['unknown_error', 'kvs_persist_failed', 'partial_push', 'generation_completed', 'push_completed', 'health_ok', 'invoke_timeout'].every((c) => DIAG_CLASSES.includes(c)), 'missing');
  check('Phase 2 push classes registered', ['project_not_found', 'permission_denied', 'no_project_key', 'no_breakdown', 'push_exception'].every((c) => DIAG_CLASSES.includes(c)), 'missing');
  check('Phase 4 testgen/distill classes + op registered', ['partial_testgen', 'testgen_completed', 'distill_category_dropped'].every((c) => DIAG_CLASSES.includes(c)) && DIAG_OPS.includes('testgen.save'), 'missing');
  check('no duplicate ops', new Set(DIAG_OPS).size === DIAG_OPS.length, 'dups');
  check('no duplicate classes', new Set(DIAG_CLASSES).size === DIAG_CLASSES.length, 'dups');
  check('registries frozen', Object.isFrozen(DIAG_OPS) && Object.isFrozen(DIAG_CLASSES), 'mutable');
  check('all class names code-shaped (no spaces)', DIAG_CLASSES.every((c) => /^[a-z0-9_.]+$/.test(c)), DIAG_CLASSES.filter((c) => !/^[a-z0-9_.]+$/.test(c)).join(','));
}

// ── 13. §13-gate fixes (field_names wall · story_uid shape · merge freshness · null-ref dedupe · breadcrumb eviction) ──
{
  console.log('\n■ 13. Gate-fix regressions');
  const base = { op: 'push.final', error_class: 'partial_push', level: 'error', ref: 'r-1', surfaced: true };

  // field_names is the ONE array-of-strings on the record → must be token-shaped, never prose.
  const j = validateRecord({
    ...base, ts: 1,
    jira: { status: 400, field_names: ['customfield_10042', 'priority', 'Sprint is required and was not set', 'has space'] },
  }).record.jira;
  check('field_names: code-shaped ids kept', !!j && j[0].field_names.includes('customfield_10042') && j[0].field_names.includes('priority'), JSON.stringify(j));
  check('field_names: prose/whitespace DROPPED (wall)', !!j && j[0].field_names.length === 2, JSON.stringify(j));
  const jAllProse = validateRecord({ ...base, ts: 1, jira: { status: 400, field_names: ['this is a sentence'] } }).record.jira;
  check('field_names: all-prose → status-only entry survives', !!jAllProse && jAllProse[0].status === 400 && jAllProse[0].field_names === undefined, JSON.stringify(jAllProse));

  // story_uid must match the minted shape (v3Schema newStoryUid → `s_…`); a bare word is a NAME, not a uid.
  const okUid = validateRecord({ ...base, ts: 1, subject: { kind: 'story_uid', id: 's_m4abc12-x9' } }).record.subject;
  check('story_uid: minted shape passes', !!okUid && okUid.id === 's_m4abc12-x9', JSON.stringify(okUid));
  check('story_uid: bare word dropped', validateRecord({ ...base, ts: 1, subject: { kind: 'story_uid', id: 'Checkout' } }).record.subject === undefined, 'kept');

  // merge freshness (chimera fix): subject evidence + session_ref refresh like counts/jira.
  {
    const p1 = validateRecord({ op: 'push.final', error_class: 'partial_push', level: 'error', ref: 'job-x', session_ref: 'sess-1', ts: 100, subject_idxs: [3, 5], surfaced: true }).record;
    const p2 = validateRecord({ op: 'push.final', error_class: 'partial_push', level: 'error', ref: 'job-x', session_ref: 'sess-2', ts: 200, subject_idxs: [7], surfaced: true }).record;
    const r = mergeIntoRing([p1], p2);
    check('merge: newer subject_idxs replace older (no chimera)', r.length === 1 && JSON.stringify(r[0].subject_idxs) === '[7]', JSON.stringify(r[0].subject_idxs));
    check('merge: newer session_ref replaces older', r[0].session_ref === 'sess-2', r[0].session_ref);
  }

  // merge freshness: a repeat carrying NEW jira evidence replaces the older evidence.
  const v1 = validateRecord({ ...base, ts: 1, jira: { status: 429 } }).record;
  const v2 = validateRecord({ ...base, ts: 2, jira: { status: 400, field_names: ['customfield_1'] } }).record;
  const ring = mergeIntoRing(mergeIntoRing([], v1), v2);
  check('merge: newer jira evidence replaces older', ring.length === 1 && ring[0].jira[0].status === 400, JSON.stringify(ring[0].jira));
  check('merge: jira absence keeps prior evidence', (() => {
    const v3 = validateRecord({ ...base, ts: 3 }).record;
    const r2 = mergeIntoRing(ring, v3);
    return r2.length === 1 && r2[0].jira && r2[0].jira[0].status === 400;
  })(), 'prior jira lost');
  check('merge: occurrences counted across repeats', ring[0].occurrences && ring[0].occurrences.count === 2, JSON.stringify(ring[0].occurrences));

  // null-ref dedupe (implemented semantics — flood absorption per §2.5): same (op, class), both ref:null → ONE entry.
  const n1 = validateRecord({ op: 'settings.save', error_class: 'kvs_write_failed', level: 'warn', ts: 1 }).record;
  const n2 = validateRecord({ op: 'settings.save', error_class: 'kvs_write_failed', level: 'warn', ts: 2 }).record;
  const nring = mergeIntoRing(mergeIntoRing([], n1), n2);
  check('null-ref dedupe merges (flood absorption)', nring.length === 1 && nring[0].occurrences && nring[0].occurrences.count === 2, String(nring.length));

  // info-first eviction beats AGE: a NEWER info breadcrumb entering a full all-error ring is itself the victim.
  let full = [];
  for (let i = 0; i < 50; i++) {
    full = mergeIntoRing(full, validateRecord({ op: 'push.final', error_class: 'partial_push', level: 'error', ref: 'e-' + i, ts: 100 + i }).record);
  }
  const bc = validateRecord({ op: 'push.final', error_class: 'push_completed', level: 'info', ref: 'bc-1', ts: 9999 }).record;
  const after = mergeIntoRing(full, bc);
  check('info into full all-error ring: the info itself is evicted (never an error)', after.length === 50 && !after.some((r) => r.ref === 'bc-1'), 'breadcrumb survived / error evicted');
}

// ── 14. Phase 5 additions: app-version const + readAllDiagnostics fail-open ──
{
  console.log('\n■ 14. Phase 5 — DIAG_APP_VERSION + readAllDiagnostics fail-open');
  check(
    'DIAG_APP_VERSION is a semver-ish string (mirrors package.json)',
    typeof DIAG_APP_VERSION === 'string' && /^\d+\.\d+\.\d+/.test(DIAG_APP_VERSION),
    String(DIAG_APP_VERSION),
  );
  check('DIAG_ALL_BUCKETS_CAP bounds the admin enumeration', Number.isInteger(DIAG_ALL_BUCKETS_CAP) && DIAG_ALL_BUCKETS_CAP > 0, String(DIAG_ALL_BUCKETS_CAP));
  // Offline there is no Forge storage runtime: the kvs query path throws inside
  // the function and the outer catch must absorb it → [] (fail-open, NEVER a
  // throw — getDiagnostics' admin view depends on this contract).
  const all = await readAllDiagnostics();
  check('readAllDiagnostics offline → [] (fail-open, never throws)', Array.isArray(all) && all.length === 0, JSON.stringify(all));
}

// ── 15. Deep-audit fixes (null-args · ref shape wall · merge re-validation · proto keys · jira dedupe) ──
{
  console.log('\n■ 15. Deep-audit regressions');

  // (1) "never throws" must include an explicit NULL arg — the old destructuring
  // signatures threw during parameter binding, BEFORE the try/catch, leaking an
  // unhandledRejection on a fire-and-forget call.
  const nullSafe = async (name, p) => {
    try {
      await p;
      check(`${name}(null) resolves (never rejects)`, true, '');
    } catch (e) {
      check(`${name}(null) resolves (never rejects)`, false, String(e && e.message));
    }
  };
  await nullSafe('recordDiagnostic', recordDiagnostic(null));
  await nullSafe('writeDiagnosticDetail', writeDiagnosticDetail(null));
  await nullSafe('readDiagnostics', readDiagnostics(null));
  await nullSafe('readDiagnosticDetail', readDiagnosticDetail(null));
  await nullSafe('clearDiagnostics', clearDiagnostics(null));
  check('recordDiagnostic(null) → skipped (no accountId)', JSON.stringify(await recordDiagnostic(null)) === '{"skipped":true}', JSON.stringify(await recordDiagnostic(null)));
  // readAggregate had ZERO coverage — offline it must fail open to {}.
  const agg = await readAggregate();
  check('readAggregate offline → {} (fail-open, never throws)', agg && typeof agg === 'object' && Object.keys(agg).length === 0, JSON.stringify(agg));

  // (2) ref/session_ref are SHAPE-checked now (not just "no whitespace"): minted
  // shapes pass; zero-width-joined prose, Cyrillic names, and <script> payloads drop.
  const base = { op: 'push.final', error_class: 'partial_push', ts: 1, surfaced: true };
  const refOf = (ref) => validateRecord({ ...base, ref }).record.ref;
  check('ref: UUID shape passes', refOf('5f0c3b2a-1d2e-4f5a-8b9c-0d1e2f3a4b5c') === '5f0c3b2a-1d2e-4f5a-8b9c-0d1e2f3a4b5c', 'dropped');
  check('ref: <ts>-<base36> shape passes', refOf('1765540000000-k3j9x') === '1765540000000-k3j9x', 'dropped');
  check('ref: zero-width-joined prose dropped', refOf('Secret​Project​Plan') === null, 'kept');
  check('ref: Cyrillic single-token dropped', refOf('ТайнаСтраница') === null, 'kept');
  check('ref: <script> payload dropped', refOf('<script>alert(1)</script>') === null, 'kept');
  check('session_ref: same wall', validateRecord({ ...base, session_ref: 'Тайна​x' }).record.session_ref === undefined, 'kept');

  // (3) merge re-validates the STORED entry: a tampered prev's smuggled fields
  // must NOT ride `...prev` into the merged (re-persisted) entry.
  const tamperedPrev = { v: 1, ts: 100, ref: 'job-1', op: 'push.final', error_class: 'partial_push', level: 'error', surfaced: true, detail: 'SMUGGLED CONTENT', pageTitle: 'Secret Plan' };
  const fresh = validateRecord({ ...base, ref: 'job-1', ts: 200 }).record;
  const mergedRing = mergeIntoRing([tamperedPrev], fresh);
  check('merge strips smuggled fields from the stored entry', mergedRing.length === 1 && mergedRing[0].detail === undefined && mergedRing[0].pageTitle === undefined, JSON.stringify(Object.keys(mergedRing[0])));
  check('merge still counts occurrences across the re-validation', mergedRing[0].occurrences && mergedRing[0].occurrences.count === 2, JSON.stringify(mergedRing[0].occurrences));

  // (4) __proto__/constructor count keys: no pollution, no phantom kept-slot.
  const protoCounts = validateRecord({ ...base, ts: 1, counts: JSON.parse('{"__proto__": 5, "real_key": 7}') }).record.counts;
  check('counts: real key survives alongside a __proto__ key', !!protoCounts && protoCounts.real_key === 7, JSON.stringify(protoCounts));
  check('counts: no prototype pollution', ({}).polluted === undefined && Object.getPrototypeOf({}) === Object.prototype, 'polluted');

  // (5) cleanJira dedupes identical entries (§1 "deduped array").
  const dupJira = validateRecord({ ...base, ts: 1, jira: [{ status: 400, field_names: ['customfield_1'] }, { status: 400, field_names: ['customfield_1'] }, { status: 429 }] }).record.jira;
  check('jira: identical entries deduped in the module', !!dupJira && dupJira.length === 2, JSON.stringify(dupJira));
}

// ── 16. Classifier table — classifyDiagGenerationError (the single code→class authority) ──
// The Phase-1 audit's named test gap: the mapper was unexported in index.js — a drifted
// mapping silently degraded to unknown_error with no test able to see it. It now lives in
// src/diagnostics.js (single owner of class semantics, §2.9) and THIS table pins it both
// ways: every code PRODUCIBLE at a classifier call site maps to its expected class, and
// everything else (incl. the deliberately-never-fed codes) degrades to unknown_error.
{
  console.log('\n■ 16. Classifier table (code → class, both-ways diff)');

  // Producible set — every code that can REACH a classifier call site in src/index.js:
  //   gen submit (startGeneration)        → submitBreakdownBatch codes minus the
  //                                         input_too_small/page_too_small guard
  //   gen poll terminal (pollJobStatus)   → fetchBatchResults codes
  //   TC submit / regen submit            → submitTestCaseBatch codes (not_configured /
  //                                         no_stories guarded out before the submit)
  //   TC/regen poll terminal              → 'no_results_url' literal + fetchTestCaseResults
  //                                         top-level codes
  //   regen per-story sentinel            → row_missing / batch_request_* / no_message /
  //                                         refused / truncated / parse_failed / regen_failed
  const PRODUCIBLE = [
    // Anthropic HTTP gates (submit + results fetch)
    ['auth_rejected', 'auth_rejected'],
    ['insufficient_credits', 'insufficient_credits'],
    ['rate_limited', 'rate_limited'],
    ['network_failure', 'network_failure'],
    ['anthropic_500', 'anthropic_http', { http_status: 500 }],
    ['anthropic_529', 'anthropic_http', { http_status: 529 }],
    ['results_fetch_500', 'anthropic_http', { http_status: 500 }],
    ['results_fetch_404', 'anthropic_http', { http_status: 404 }],
    // Response-shape anomalies
    ['no_batch_id', 'anthropic_http'],
    ['no_message', 'anthropic_http'],
    ['no_results_url', 'no_results_url'], // TC/regen poll feed it THROUGH the mapper
    ['result_row_missing', 'result_row_missing'],
    ['row_missing', 'result_row_missing'], // TC per-story spelling
    ['regen_failed', 'result_row_missing'], // regen perStory[0] absent
    // Key vanished between poll and results fetch (BYOK delete race) — the registry
    // has an honest class; unknown_error would misdiagnose the A4 family.
    ['not_configured', 'not_configured'],
    // Model / output outcomes
    ['refused', 'refused'],
    ['truncated', 'truncated'],
    ['parse_failed', 'parse_failed'],
    // Batch per-request result types (batch_request_<type>)
    ['batch_request_expired', 'batch_expired'],
    ['batch_request_errored', 'anthropic_http'],
    ['batch_request_canceled', 'anthropic_http'],
    ['batch_request_unknown', 'anthropic_http'],
  ];
  for (const [code, expected, counts] of PRODUCIBLE) {
    const got = classifyDiagGenerationError(code);
    check(`'${code}' → ${expected}`, got.error_class === expected, got.error_class);
    if (counts) {
      check(
        `'${code}' carries counts ${JSON.stringify(counts)}`,
        JSON.stringify(got.counts) === JSON.stringify(counts),
        JSON.stringify(got.counts),
      );
    }
  }

  // Direction 1 guard: every class the mapper can emit is REGISTERED — an
  // unregistered class would be re-normalized to unknown_error by validateRecord
  // at write time (the silent degradation this table exists to prevent).
  const emitted = [...new Set(PRODUCIBLE.map(([, cls]) => cls))];
  check(
    'every mapped class is in DIAG_CLASSES',
    emitted.every((c) => DIAG_CLASSES.includes(c)),
    emitted.filter((c) => !DIAG_CLASSES.includes(c)).join(','),
  );
  // …and the round-trip holds: the mapper's output survives the privacy wall
  // unchanged (record-shape spread exactly as the call sites do it).
  const roundTripOk = PRODUCIBLE.every(([code, expected]) => {
    const cls = classifyDiagGenerationError(code);
    const { record } = validateRecord({
      op: 'generation.poll',
      error_class: cls.error_class,
      level: 'error',
      ref: 'job-1',
      ...(cls.counts ? { counts: cls.counts } : {}),
      surfaced: true,
    });
    return record.error_class === expected;
  });
  check('mapper output survives validateRecord (round-trip, no degradation)', roundTripOk, 'a class degraded');

  // Direction 2: NOT-producible-at-a-call-site codes degrade to unknown_error —
  // batch_not_found is the named §7 residual (poll soft-fail path, never terminal,
  // never fed); no_custom_id / no_stories / input_too_small / page_too_small are
  // guarded out BEFORE the mapper; the rest are malformed-family / garbage probes.
  // If a wiring change ever feeds one of these, this section is the tripwire to
  // either map it or re-guard it.
  const UNKNOWNS = [
    'batch_not_found',
    'no_custom_id',
    'no_stories',
    'input_too_small',
    'page_too_small',
    'bad_cycle', // cycle-resolve codes are caught inside verifyAndRepairCycles, never fed
    'http_500', //  (same — resolveDependencyCycle's family)
    'anthropic_', //     malformed family: no digits
    'anthropic_5xx', //  malformed family: non-numeric status
    'results_fetch_', // malformed family: no digits
    'batch_request_', // malformed family: empty type
    'totally_new_code',
    '',
    null,
    undefined,
  ];
  for (const code of UNKNOWNS) {
    const got = classifyDiagGenerationError(code);
    check(`'${String(code)}' → unknown_error`, got.error_class === 'unknown_error', got.error_class);
  }
  // The mapper never throws and never emits a raw input string as a class.
  check(
    'never throws on garbage',
    (() => {
      try {
        classifyDiagGenerationError({});
        classifyDiagGenerationError(42);
        classifyDiagGenerationError(['x']);
        return true;
      } catch (e) {
        return false;
      }
    })(),
    'threw',
  );
}

// ── 17. Cross-file seam tripwires (seams-audit J7) ─────────────────────────
// The two cross-file invariants that had only review-time checks:
// (a) the FE humanize map must cover every registry member (sync was a NAMED
//     review check — now a tripwire); (b) every op/error_class literal at a
//     recordDiagnostic call site must be a registry member — the privacy wall
//     deliberately MASKS a typo into unknown_op/unknown_error at runtime, so a
//     drifted literal records forever with zero runtime signal.
{
  console.log('\n■ 17. Cross-file seam tripwires');

  // (a) FE map sync — diagnosticsView is pure (no JSX/imports) → plain import works.
  const view = await import('../static/hello-world/src/lib/diagnosticsView.js');
  const fallbackTitle = view.classText('__definitely_not_a_class__').title;
  const unmapped = DIAG_CLASSES.filter(
    (c) => c !== 'unknown_error' && view.classText(c).title === fallbackTitle,
  );
  check('FE map covers every registry class (no fallback render)', unmapped.length === 0, unmapped.join(','));
  const fallbackOp = view.opLabel('__nope__');
  const unmappedOps = DIAG_OPS.filter((o) => o !== 'unknown_op' && view.opLabel(o) === fallbackOp);
  check('FE map covers every registry op', unmappedOps.length === 0, unmappedOps.join(','));

  // (b) call-site literal scanner — text-level, no Forge imports needed.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const srcText =
    readFileSync(join(here, '..', 'src', 'index.js'), 'utf8') +
    readFileSync(join(here, '..', 'src', 'push_handler.js'), 'utf8');
  const opLits = [...srcText.matchAll(/op:\s*'([a-z_.]+)'/g)].map((m) => m[1]);
  const classLits = [...srcText.matchAll(/error_class:\s*'([a-z_.]+)'/g)].map((m) => m[1]);
  const badOps = [...new Set(opLits)].filter((o) => !DIAG_OPS.includes(o));
  const badClasses = [...new Set(classLits)].filter((c) => !DIAG_CLASSES.includes(c));
  check(`call-site op literals all registered (${new Set(opLits).size} distinct)`, badOps.length === 0, badOps.join(','));
  check(`call-site class literals all registered (${new Set(classLits).size} distinct)`, badClasses.length === 0, badClasses.join(','));
}

console.log('\n' + '='.repeat(60));
console.log(failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
