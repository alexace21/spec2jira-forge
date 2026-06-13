#!/usr/bin/env node
/**
 * Offline regression test for parseJiraErrorDetail (src/push_handler.js).
 *
 * WHY THIS EXISTS: a Live-E2E S2 run (all stories rejected for a missing required
 * field) revealed the OLD jiraErrorMessage assumed Jira's error body was always a
 * flat `{ errors: { fieldId: "string" } }` map. The WHOLE-BULK 400 response is
 * instead INDEXED — `{ errors: { "0": <detail-obj>, "1": <detail-obj> } }` — so
 * `String(<detail-obj>)` produced "[object Object]" in the user message AND the
 * field names were never captured into the diagnostic record. The shape-agnostic
 * parser fixes both; this pins all three Jira shapes so the bug can't silently
 * return. Pure function (no Forge runtime) → runs under plain `node`.
 *
 * Usage: node prototype/test_jira_error_parse.js
 */
import { parseJiraErrorDetail } from '../src/push_handler.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}  — ${detail}`); failures++; }
}

console.log('parseJiraErrorDetail — Jira error-shape coverage\n' + '='.repeat(60));

// ── Shape (a): flat field map (the common per-field partial failure) ──────
{
  console.log('\n■ (a) flat field map');
  const r = parseJiraErrorDetail({ errorMessages: [], errors: { customfield_10070: 'Sprint is required.' } });
  check('field id captured', r.fieldNames.includes('customfield_10070'), JSON.stringify(r.fieldNames));
  check('reason carries field + value', r.reasons.some((x) => x.includes('customfield_10070') && x.includes('Sprint is required')), JSON.stringify(r.reasons));
}

// ── Shape (b): INDEXED whole-bulk 400 — the LIVE-E2E bug shape ─────────────
{
  console.log('\n■ (b) indexed whole-bulk 400 (the regression)');
  const r = parseJiraErrorDetail({
    errorMessages: [],
    errors: {
      0: { elementErrors: { errors: { customfield_10070: 'X is required' }, errorMessages: [] }, status: 400 },
      1: { elementErrors: { errors: { priority: 'Priority is required' }, errorMessages: [] }, status: 400 },
    },
  });
  check('NO "[object Object]" anywhere in reasons', !r.reasons.some((x) => x.includes('[object Object]')), JSON.stringify(r.reasons));
  check('numeric element-index keys are NOT field names', !r.fieldNames.includes('0') && !r.fieldNames.includes('1'), JSON.stringify(r.fieldNames));
  check('real field ids extracted from the nested detail', r.fieldNames.includes('customfield_10070') && r.fieldNames.includes('priority'), JSON.stringify(r.fieldNames));
  check('reasons carry the human strings', r.reasons.some((x) => x.includes('X is required')) && r.reasons.some((x) => x.includes('Priority is required')), JSON.stringify(r.reasons));
}

// ── Shape (b'): indexed WITHOUT the elementErrors wrapper (errors-direct) ──
{
  console.log("\n■ (b') indexed, errors-direct");
  const r = parseJiraErrorDetail({ errors: { 0: { errors: { summary: 'must be set' } } } });
  check('field id from a direct nested errors map', r.fieldNames.includes('summary'), JSON.stringify(r.fieldNames));
  check("index '0' still excluded", !r.fieldNames.includes('0'), JSON.stringify(r.fieldNames));
}

// ── Shape (d): the DOCUMENTED top-level errors ARRAY (/issue/bulk contract) ─
{
  console.log('\n■ (d) documented top-level errors ARRAY');
  const r = parseJiraErrorDetail({
    errors: [
      { status: 400, elementErrors: { errors: { customfield_10070: 'Sprint is required.' }, errorMessages: [] }, failedElementNumber: 0 },
      { status: 400, elementErrors: { errors: { priority: 'Priority is required.' }, errorMessages: ['Bad request'] }, failedElementNumber: 1 },
    ],
  });
  check('array shape: field ids extracted', r.fieldNames.includes('customfield_10070') && r.fieldNames.includes('priority'), JSON.stringify(r.fieldNames));
  check('array shape: reasons captured', r.reasons.some((x) => x.includes('Sprint is required')) && r.reasons.includes('Bad request'), JSON.stringify(r.reasons));
  check('array shape: failedElementNumber not a field name', !r.fieldNames.includes('0') && !r.fieldNames.includes('1'), JSON.stringify(r.fieldNames));
}

// ── errorMessages with a non-string member must not become [object Object] ──
{
  console.log('\n■ (e) hostile errorMessages member');
  const r = parseJiraErrorDetail({ errorMessages: ['real message', { nested: 'obj' }, 42] });
  check('object/non-string members skipped (no [object Object])', !r.reasons.some((x) => x.includes('[object Object]')) && r.reasons.includes('real message'), JSON.stringify(r.reasons));
}

// ── Shape (c): nested per-element ─────────────────────────────────────────
{
  console.log('\n■ (c) nested per-element');
  const r = parseJiraErrorDetail({ elementErrors: { errors: { summary: 'must be set' }, errorMessages: ['General problem'] } });
  check('field id', r.fieldNames.includes('summary'), JSON.stringify(r.fieldNames));
  check('errorMessages captured', r.reasons.includes('General problem'), JSON.stringify(r.reasons));
}

// ── Guards: never throw, no value leaks into fieldNames, dedupe, caps ──────
{
  console.log('\n■ guards');
  check('empty body → {reasons:[],fieldNames:[]}', JSON.stringify(parseJiraErrorDetail({})) === '{"reasons":[],"fieldNames":[]}', 'x');
  check('null → no throw', (() => { try { parseJiraErrorDetail(null); parseJiraErrorDetail('x'); parseJiraErrorDetail(undefined); parseJiraErrorDetail([1, 2]); return true; } catch (e) { return false; } })(), 'threw');

  // a field VALUE (which can echo submitted content) must NEVER become a fieldName
  const leak = parseJiraErrorDetail({ errors: { customfield_X: 'Secret Customer Value 12345' } });
  check('field VALUE never enters fieldNames (only the key)', leak.fieldNames.length === 1 && leak.fieldNames[0] === 'customfield_X', JSON.stringify(leak.fieldNames));

  // true dedupe: two truly-identical messages collapse
  const dup = parseJiraErrorDetail({ errorMessages: ['same problem', 'same problem'] });
  check('identical reasons deduped', dup.reasons.filter((x) => x === 'same problem').length === 1, JSON.stringify(dup.reasons));

  // caps: 30 fields → capped at 20
  const many = { errors: {} };
  for (let i = 0; i < 30; i++) many.errors[`customfield_${i}`] = `r${i}`;
  check('fieldNames capped at 20', parseJiraErrorDetail(many).fieldNames.length === 20, 'over');

  // depth guard: a deeply self-similar nest must terminate
  let deep = { errors: {} };
  let cur = deep;
  for (let i = 0; i < 50; i++) { cur.errors = { 0: { elementErrors: {} } }; cur = cur.errors[0].elementErrors; }
  check('deep nesting terminates (no stack blow)', (() => { try { parseJiraErrorDetail(deep); return true; } catch (e) { return false; } })(), 'threw/looped');
}

console.log('\n' + '='.repeat(60));
console.log(failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
