/**
 * Offline test for the Admin Settings verdict state machine
 * (static/hello-world/src/lib/settingsView.js).
 *
 * Plain-Node ESM, self-contained. Run:
 *   node prototype/test_settings_view.mjs
 *
 * Guards the load-bearing correctness of the Claude-Design Admin Settings redesign (screen 5):
 *   - the TWO ORTHOGONAL signals never interleave (license gate independent of config verdict);
 *   - each of the 13 mockup states maps to the right {level, key, project, verified};
 *   - optionals (context/custom-fields) tiles stay NEUTRAL (never an amber gap);
 *   - probe classification: field-fixable -> error + fixField (deep-link); not-field-fixable
 *     (billing/permission/network/storage) -> warning + honest hint + fixField null (no wrong jump);
 *   - the getUsage-failed path is 'unknown' and never claims 'licensed'.
 */
import {
  computeLicenseGate,
  computeConfigVerdict,
  computeReady,
  computeTiles,
  classifyProbe,
  probeLabel,
  COST_ANCHOR,
} from '../static/hello-world/src/lib/settingsView.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fail++; console.error('  FAIL  ' + msg); }
}
function eq(a, b, msg) {
  ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

const health = (ok_, probes) => ({ ok: ok_, probes: probes || [] });
const P = (name, okp, code) => ({ name, ok: okp, code });
const ALL_OK = [P('anthropic_key', true), P('confluence_read', true), P('jira_project', true), P('kvs_rw', true)];

// ── 1. License gate (3 states) ────────────────────────────────────────────────
eq(computeLicenseGate({ allowed: true }).state, 'licensed', 'allowed:true -> licensed');
eq(computeLicenseGate({ allowed: false, limit: 0 }).state, 'blocked', 'allowed:false -> blocked (Not licensed)');
eq(computeLicenseGate({ error: 'usage_unavailable' }).state, 'unknown', 'getUsage error -> unknown');
eq(computeLicenseGate(null).state, 'unknown', 'null account -> unknown');
// a trial reads as an ACTIVE paid tier (allowed true) -> licensed, NOT blocked
eq(computeLicenseGate({ allowed: true, tier: 'byokPro', unlimited: true }).state, 'licensed', 'trial/paid -> licensed (not blocked)');

// ── 2. Config verdict — the 13-state coverage ─────────────────────────────────
// S1 configured & verified (green)
let v = computeConfigVerdict({ keyConfigured: true, projectKey: 'SDTY', keyStorageFault: false, health: health(true, ALL_OK) });
eq(v.level, 'ok', 'S1 configured+verified -> level ok');
eq(v.verified, 'verified', 'S1 verified');
ok(v.configComplete === true, 'S1 configComplete');
eq(v.requiredDone, 2, 'S1 2 of 2 required done');

// S2/S6/S7 verify failed (any probe not ok) -> error verdict
v = computeConfigVerdict({ keyConfigured: true, projectKey: 'SDTY', health: health(false, [P('anthropic_key', false, 'insufficient_credits'), P('confluence_read', true), P('jira_project', true), P('kvs_rw', true)]) });
eq(v.level, 'error', 'S2 verify-failed -> level error');
eq(v.verified, 'failed', 'S2 verified=failed');
ok(v.configComplete === true, 'S2 config still complete (only the live check failed)');

// S3 configured & verified is the same verdict as S1 (auto-verify note is a FE-only overlay)
v = computeConfigVerdict({ keyConfigured: true, projectKey: 'SDTY', health: health(true, ALL_OK) });
eq(v.level, 'ok', 'S3 auto-verifying settles to ok');

// S4 key set, project missing
v = computeConfigVerdict({ keyConfigured: true, projectKey: '', health: null });
eq(v.level, 'warning', 'S4 key set, project missing -> warning');
eq(v.project, 'not_set', 'S4 project not_set');
eq(v.verified, 'not_run', 'S4 not verified yet');
eq(v.requiredDone, 1, 'S4 1 of 2 required done');
ok(v.configComplete === false, 'S4 not complete');

// S5 first-time (empty)
v = computeConfigVerdict({ keyConfigured: false, projectKey: '', health: null });
eq(v.level, 'error', 'S5 first-time empty -> error (no key = hard blocker)');
eq(v.key, 'not_set', 'S5 key not_set');
eq(v.requiredDone, 0, 'S5 0 of 2 required done');

// S8 API key storage fault (distinct from not_set)
v = computeConfigVerdict({ keyConfigured: true, projectKey: 'SDTY', keyStorageFault: true, health: health(false, [P('anthropic_key', false, 'key_storage_failed'), P('confluence_read', true), P('jira_project', true), P('kvs_rw', true)]) });
eq(v.level, 'error', 'S8 storage fault -> error');
eq(v.key, 'storage_fault', 'S8 key=storage_fault (NOT not_set)');

// complete-but-unverified -> neutral (run the check)
v = computeConfigVerdict({ keyConfigured: true, projectKey: 'SDTY', health: null });
eq(v.level, 'neutral', 'complete-but-unverified -> neutral');
eq(v.verified, 'not_run', 'neutral verified=not_run');
ok(v.configComplete === true, 'neutral is config-complete (drives auto-verify eligibility)');

// ── 3. ORTHOGONALITY — config verdict is independent of the license/account ───
// The verdict function takes NO account arg; state #10 (getUsage failed) keeps the config verdict green.
v = computeConfigVerdict({ keyConfigured: true, projectKey: 'SDTY', health: health(true, ALL_OK) });
eq(v.level, 'ok', 'S10 getUsage-failed does NOT change the config verdict (stays ok/green)');
eq(computeLicenseGate({ error: 'x' }).state, 'unknown', 'S10 license gate is unknown while config verdict is green');

// ── 4. Tiles — optionals stay neutral; verified failCount ─────────────────────
let tiles = computeTiles({
  verdict: { ...computeConfigVerdict({ keyConfigured: true, projectKey: 'SDTY', health: health(true, ALL_OK) }), projectKey: 'SDTY' },
  apiKeyLastSetAt: '2026-06-26T00:00:00Z',
  health: health(true, ALL_OK),
  profilesCount: 2,
  hasCustomFields: false,
});
const byId = Object.fromEntries(tiles.map((t) => [t.id, t]));
eq(byId.apiKey.status, 'ok', 'tile API KEY ok');
eq(byId.project.status, 'ok', 'tile PROJECT ok');
eq(byId.context.status, 'neutral', 'tile CONTEXT neutral (optional, never amber)');
eq(byId.customFields.status, 'neutral', 'tile CUSTOM FIELDS neutral (optional, never amber)');
eq(byId.context.value, '2 profiles', 'tile CONTEXT value plural');
eq(byId.verified.status, 'ok', 'tile VERIFIED ok');

// first-time tiles: key error, project warn, optionals still neutral
tiles = computeTiles({
  verdict: computeConfigVerdict({ keyConfigured: false, projectKey: '', health: null }),
  profilesCount: 0, hasCustomFields: false, health: null,
});
const b2 = Object.fromEntries(tiles.map((t) => [t.id, t]));
eq(b2.apiKey.status, 'error', 'first-time API KEY error (hard blocker)');
eq(b2.project.status, 'warn', 'first-time PROJECT warn (required)');
eq(b2.context.status, 'neutral', 'first-time CONTEXT still neutral');
eq(b2.context.value, 'None', 'first-time CONTEXT None');
eq(b2.verified.status, 'neutral', 'first-time VERIFIED neutral');

// verify-failed tiles: VERIFIED shows failCount
tiles = computeTiles({
  verdict: computeConfigVerdict({ keyConfigured: true, projectKey: 'SDTY', health: health(false, [P('jira_project', false, 'project_not_found'), P('anthropic_key', true), P('confluence_read', true), P('kvs_rw', true)]) }),
  health: health(false, [P('jira_project', false, 'project_not_found'), P('anthropic_key', true), P('confluence_read', true), P('kvs_rw', true)]),
  profilesCount: 2,
});
const b3 = Object.fromEntries(tiles.map((t) => [t.id, t]));
eq(b3.verified.status, 'error', 'verify-failed VERIFIED error');
eq(b3.verified.value, '1 failed', 'verify-failed VERIFIED 1 failed');

// singular profile label
tiles = computeTiles({ verdict: computeConfigVerdict({ keyConfigured: true, projectKey: 'SDTY', health: null }), profilesCount: 1 });
eq(Object.fromEntries(tiles.map((t) => [t.id, t])).context.value, '1 profile', 'CONTEXT singular');

// ── 4b. health.failed / could-not-run -> 'unavailable' (finding A3, NOT a counted failure) ──
v = computeConfigVerdict({ keyConfigured: true, projectKey: 'SDTY', health: { ok: false, probes: [], failed: true } });
eq(v.verified, 'unavailable', 'A3 health.failed -> verified=unavailable (not failed)');
eq(v.level, 'warning', 'A3 unavailable -> level warning (not error)');
v = computeConfigVerdict({ keyConfigured: true, projectKey: 'SDTY', health: { ok: false, probes: [] } });
eq(v.verified, 'unavailable', 'A3 empty probes -> unavailable');
// the unavailable VERIFIED tile reads "Could not run", not "1 failed"
let ut = Object.fromEntries(computeTiles({ verdict: computeConfigVerdict({ keyConfigured: true, projectKey: 'SDTY', health: { ok: false, probes: [], failed: true } }), health: { ok: false, probes: [], failed: true } }).map((t) => [t.id, t]));
eq(ut.verified.status, 'warn', 'A3 unavailable VERIFIED tile warn');
eq(ut.verified.value, 'Could not run', 'A3 unavailable VERIFIED tile "Could not run" (not "1 failed")');

// ── 4c. computeReady — a function of BOTH signals (finding A1) ────────────────
const licVerdict = computeConfigVerdict({ keyConfigured: true, projectKey: 'SDTY', health: health(true, ALL_OK) });
ok(computeReady({ licenseGate: { state: 'licensed' }, verdict: licVerdict }) === true, 'A1 licensed + verified + complete -> ready');
ok(computeReady({ licenseGate: { state: 'blocked' }, verdict: licVerdict }) === false, 'A1 blocked instance is NEVER ready (even when config-verified)');
ok(computeReady({ licenseGate: { state: 'unknown' }, verdict: licVerdict }) === true, 'A1 license-unknown + verified -> ready (do not assert blocked)');
ok(computeReady({ licenseGate: { state: 'licensed' }, verdict: computeConfigVerdict({ keyConfigured: true, projectKey: '', health: null }) }) === false, 'A1 not-complete -> not ready');
ok(computeReady({ licenseGate: { state: 'licensed' }, verdict: computeConfigVerdict({ keyConfigured: true, projectKey: 'SDTY', health: null }) }) === false, 'A1 complete-but-unverified -> not ready');

// ── 4d. licenseBlocked forces VERIFIED tile neutral (§5.9, finding A1) ────────
let bt = Object.fromEntries(computeTiles({ verdict: licVerdict, health: health(true, ALL_OK), licenseBlocked: true }).map((t) => [t.id, t]));
eq(bt.verified.status, 'neutral', 'A1 blocked -> VERIFIED tile neutral (not green), even when config-verified');
eq(bt.verified.sub, 'plan inactive', 'A1 blocked VERIFIED tile sub "plan inactive"');

// ── 5. Probe classification — field-fixable vs honest-hint ────────────────────
let c = classifyProbe(P('jira_project', false, 'project_not_found'));
eq(c.severity, 'error', 'project_not_found -> error');
eq(c.fixField, 'projectKey', 'project_not_found -> deep-link projectKey');

c = classifyProbe(P('anthropic_key', false, 'key_storage_failed'));
eq(c.severity, 'error', 'key_storage_failed -> error');
eq(c.fixField, 'apiKey', 'key_storage_failed -> deep-link apiKey');

c = classifyProbe(P('anthropic_key', false, 'insufficient_credits'));
eq(c.severity, 'warning', 'insufficient_credits -> warning (billing, not a config error)');
eq(c.fixField, null, 'insufficient_credits -> NO field jump (honest hint)');

c = classifyProbe(P('confluence_read', false, 'permission_denied'));
eq(c.severity, 'warning', 'permission_denied -> warning');
eq(c.fixField, null, 'permission_denied -> NO field jump (fixing a field here would be wrong)');

c = classifyProbe(P('jira_project', false, 'jira_500'));
eq(c.severity, 'warning', 'jira_500 folds to jira_http -> warning');
eq(c.fixField, null, 'jira_http -> no field jump');

c = classifyProbe(P('kvs_rw', false, 'kvs_failed'));
eq(c.severity, 'warning', 'kvs_failed -> warning');

c = classifyProbe(P('x', false, 'some_unmapped_code'));
eq(c.severity, 'warning', 'unknown code -> default warning');
eq(c.fixField, null, 'unknown code -> no field jump');

// ── 6. Probe label + cost anchor ──────────────────────────────────────────────
eq(probeLabel('anthropic_key'), 'Anthropic API key', 'probeLabel anthropic_key');
eq(probeLabel('confluence_read'), 'Confluence access', 'probeLabel confluence_read');
eq(probeLabel('jira_project'), 'Jira project', 'probeLabel jira_project');
eq(probeLabel('kvs_rw'), 'App storage', 'probeLabel kvs_rw');
eq(probeLabel('weird_probe'), 'weird_probe', 'probeLabel fallback = raw name');
eq(COST_ANCHOR.typical, '~$0.12', 'COST_ANCHOR typical');
eq(COST_ANCHOR.max, '~$0.24', 'COST_ANCHOR max');

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
