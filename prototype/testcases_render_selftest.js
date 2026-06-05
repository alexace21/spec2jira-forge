#!/usr/bin/env node
/**
 * Spec2Tickets — OFFLINE unit tests for the P2 pure render lib (src/testcases.js).
 * No API key, no network. Proves renderGherkin + renderManualTable/CSV + computeCoverage
 * across the edge cases the §13 design called out: Background detection, pipe-escape,
 * no-acs banner, inferred, multi-AC trace, when/then length-mismatch, CSV formula-injection
 * + quoting, negative-number preservation, and the "never emit Octane @TID/@REV" rule.
 *
 *   node prototype/testcases_render_selftest.js
 */
import { renderGherkin, renderManualTable, computeCoverage, normAC, TABLE_COLUMNS } from '../src/testcases.js';

const checks = [];
const check = (desc, pass) => checks.push([desc, !!pass]);
const has = (s, sub) => String(s).includes(sub);
const countOccurrences = (s, sub) => String(s).split(sub).length - 1;

// ── Fixture 1: 2 cases sharing identical given[] (→ Background), full fields, a pipe in a step ──
const story1 = { name: 'Borrow a book', acceptance_criteria: ['AC1: limit 5.', 'AC2: prints a receipt.'] };
const result1 = {
  story_name: 'Borrow a book',
  no_acs: false,
  test_cases: [
    {
      title: 'Borrow under limit', type: 'happy-path', priority: 'High',
      given: ['Signed in', 'Has 2 books'],
      when: ['Scan and confirm'],
      then: ['Loan recorded', 'Receipt printed'],   // 2 then, 1 when → length mismatch
      expected_result: 'A receipt with a due date is printed.',
      test_data: ['2 books'],
      ac_trace: [{ kind: 'story-ac', ac_text: 'AC2: prints a receipt.' }],
      concern: '[ASSUMPTION|low] assumed welcome path',
    },
    {
      title: 'Borrow 6th at limit', type: 'edge', priority: 'High',
      given: ['Signed in', 'Has 2 books'],         // identical → Background
      when: ['Scan 6th | confirm'],                // pipe must be escaped in Gherkin
      then: ['Refused'],
      expected_result: 'The 6th is refused.',
      ac_trace: [{ kind: 'story-ac', ac_text: 'AC1: limit 5.' }],
    },
  ],
};

const g1 = renderGherkin(result1, story1);
check('gherkin: Feature header', has(g1, 'Feature: Borrow a book'));
check('gherkin: Background emitted for shared given', has(g1, '  Background:'));
check('gherkin: shared Given appears ONCE (in Background, not per-scenario)', countOccurrences(g1, 'Given Signed in') === 1);
check('gherkin: @type + @priority tags', has(g1, '@happy-path @priority-high') && has(g1, '@edge @priority-high'));
check('gherkin: # Covers with verbatim AC text', has(g1, '# Covers: [story-ac] AC2: prints a receipt.'));
check('gherkin: # Test data line', has(g1, '# Test data: 2 books'));
check('gherkin: expected_result is a Then/And STEP (not a comment)', has(g1, 'And A receipt with a due date is printed.') && !has(g1, '# Expected:'));
check('gherkin: # Note (concern emitted as-is)', has(g1, '# Note: [ASSUMPTION|low] assumed welcome path'));
check('gherkin: pipe PRESERVED (not escaped) in step', has(g1, 'Scan 6th | confirm') && !has(g1, '\\|'));
check('gherkin: NEVER emits Octane @TID', !has(g1, '@TID'));
check('gherkin: NEVER emits Octane @REV', !has(g1, '@REV'));

// ── Fixture 2: differing given[] → NO Background, per-scenario Given ──
const result2 = {
  story_name: 'Two paths', no_acs: false,
  test_cases: [
    { title: 'A', type: 'happy-path', given: ['Precondition A'], when: ['do'], then: ['ok'], expected_result: 'ok', ac_trace: [{ kind: 'inferred' }] },
    { title: 'B', type: 'edge', given: ['Precondition B'], when: ['do'], then: ['ok'], expected_result: 'ok', ac_trace: [{ kind: 'inferred' }] },
  ],
};
const g2 = renderGherkin(result2, { name: 'Two paths' });
check('gherkin: NO Background when given[] differ', !has(g2, 'Background:'));
check('gherkin: per-scenario Given A', has(g2, 'Given Precondition A'));
check('gherkin: per-scenario Given B', has(g2, 'Given Precondition B'));

// ── Fixture 3: no_acs (inferred-only) ──
const story3 = { name: 'Export', acceptance_criteria: [] };
const result3 = {
  story_name: 'Export', no_acs: true,
  test_cases: [{ title: 'Reject unauthorized export', type: 'negative', given: [], when: ['request export'], then: ['refused'], expected_result: 'Rejected with a message.', ac_trace: [{ kind: 'inferred' }], concern: '[ASSUMPTION|low] inferred' }],
};
const g3 = renderGherkin(result3, story3);
check('gherkin: no_acs banner', has(g3, '# NOTE: this Story had NO acceptance criteria'));
check('gherkin: inferred # Covers', has(g3, '# Covers: [inferred'));

// ── renderManualTable: rows + structure (uses result1) ──
const t1 = renderManualTable(result1, story1, { storyRef: 'SDTY-1' });
check('table: columns shape', JSON.stringify(t1.columns) === JSON.stringify(TABLE_COLUMNS));
check('table: row count = steps + a verify row per case (3 + 2)', t1.rows.length === 5);
check('table: case-level fields on row 1 only', t1.rows[0].Title === 'Borrow under limit' && t1.rows[1].Title === '');
check('table: Suite = Story name on row 1', t1.rows[0].Suite === 'Borrow a book');
check('table: Test Category carries the design lens (not the tool Type field)', t1.rows[0]['Test Category'] === 'happy-path');
check('table: Preconditions join with " | "', t1.rows[0].Preconditions === 'Signed in | Has 2 books');
check('table: Priority on row 1', t1.rows[0].Priority === 'High');
check('table: continuation Step # increments', t1.rows[1]['Step #'] === 2);
check('table: expected_result on its OWN final verify row', t1.rows[2].Action === 'Verify the expected result' && has(t1.rows[2]['Expected Result'], 'A receipt with a due date is printed.'));
check('table: References carry storyRef + ac_trace', has(t1.rows[0].References, 'SDTY-1') && has(t1.rows[0].References, '[story-ac]'));
check('table: Notes carry the concern on row 1', has(t1.rows[0].Notes, '[ASSUMPTION|low]'));
check('table: case 2 starts a fresh Title row', t1.rows[3].Title === 'Borrow 6th at limit' && t1.rows[3]['Step #'] === 1);

// ── renderManualTable: no_acs sentinel row ──
const t3 = renderManualTable(result3, story3);
check('table: no_acs sentinel row (ASCII, no emoji)', has(t3.rows[0].Title, '[NO ACCEPTANCE CRITERIA]') && !has(t3.rows[0].Title, '⚠'));

// ── renderManualTable: CSV hardening (formula-injection + quoting + negative-number preservation) ──
const resultInj = {
  no_acs: false,
  test_cases: [{
    title: '=cmd()', type: 'happy-path', given: [],
    when: ['a,b', 'x"y'], then: ['ok'], expected_result: 'z',
    test_data: ['-5000', '=danger'], ac_trace: [{ kind: 'inferred' }],
  }],
};
const csv = renderManualTable(resultInj, { name: 'inj' }).csv;
check('csv: header row present', has(csv, '"Title"') && has(csv, '"Expected Result"'));
check('csv: leading = neutralized in title', has(csv, `"'=cmd()"`));
check('csv: comma value stays inside one quoted cell', has(csv, '"a,b"'));
check('csv: embedded double-quote escaped (RFC4180)', has(csv, '"x""y"'));
check('csv: leading = neutralized in test_data', has(csv, `"'=danger"`));
check('csv: negative NUMBER preserved (not mangled)', has(csv, '"-5000"') && !has(csv, `"'-5000"`));

// ── computeCoverage parity (the strip ported into the prod lib) ──
const cov = computeCoverage(story1, result1);
check('coverage: 2/2 ACs covered (100%)', cov.covered_acs === 2 && cov.total_acs === 2 && cov.coverage_pct === 100);
const covNo = computeCoverage(story3, result3);
check('coverage: no-acs → coverage_pct null (never vacuous 100%)', covNo.coverage_pct === null && covNo.no_acs === true);
const covStale = computeCoverage({ acceptance_criteria: ['AC1: live.'] }, { test_cases: [{ ac_trace: [{ kind: 'story-ac', ac_text: 'AC9: deleted.' }] }] });
check('coverage: stale ref detected, not counted', covStale.stale_refs.length === 1 && covStale.covered_acs === 0);
check('coverage: normAC folds curly quotes + NBSP', normAC('It’s  5') === "it's 5");

// ── Report ──
// ── §13 deep-audit hardening (2026-06-06): robustness + coverage-gaps + new features ──

// Robustness: malformed input must NOT crash (defense-in-depth; P5 may call on partial data)
let crashed = false;
try { renderGherkin({ test_cases: [null, {}] }, null, null); renderManualTable({ test_cases: [null, {}] }, null, null); } catch (e) { crashed = true; }
check('robust: null case-element + null story + null opts → no crash', !crashed);

// Empty test_cases
const gEmpty = renderGherkin({ test_cases: [], no_acs: false }, { name: 'Empty' });
check('gherkin: empty test_cases → Feature only (no Scenario/Background)', has(gEmpty, 'Feature: Empty') && !has(gEmpty, 'Scenario') && !has(gEmpty, 'Background'));
check('table: empty test_cases → zero rows', renderManualTable({ test_cases: [], no_acs: false }, { name: 'E' }).rows.length === 0);

// Single-case story → NO Background (guards the cases.length>1 condition)
const gSingle = renderGherkin({ test_cases: [{ title: 'S', type: 'happy-path', given: ['Pre'], when: ['act'], then: ['ok'], expected_result: 'd', ac_trace: [{ kind: 'inferred' }] }] }, { name: 'Single' });
check('gherkin: single-case story → no Background, Given inline', !has(gSingle, 'Background:') && has(gSingle, 'Given Pre'));

// given:[] across cases → no Background, no Given line
const gNoGiven = renderGherkin({ test_cases: [
  { title: 'A', type: 'edge', given: [], when: ['act'], then: ['ok'], expected_result: 'd', ac_trace: [{ kind: 'inferred' }] },
  { title: 'B', type: 'edge', given: [], when: ['act'], then: ['ok'], expected_result: 'd', ac_trace: [{ kind: 'inferred' }] },
] }, { name: 'NoPreconditions' });
check('gherkin: given:[] → no Background, no Given line', !has(gNoGiven, 'Background:') && !has(gNoGiven, 'Given'));

// Empty/null given entries → NO bare "Given " (an empty step is invalid Gherkin)
const gEmptyStep = renderGherkin({ test_cases: [
  { title: 'A', type: 'edge', given: ['', null], when: ['act'], then: ['ok'], expected_result: 'd', ac_trace: [{ kind: 'inferred' }] },
  { title: 'B', type: 'edge', given: ['', null], when: ['act'], then: ['ok'], expected_result: 'd', ac_trace: [{ kind: 'inferred' }] },
] }, { name: 'ES' });
check('gherkin: empty given entries skipped (no invalid empty step)', !has(gEmptyStep, 'Given'));

// includeConfidence → # Confidence line; NaN guarded
const gConf = renderGherkin({ test_cases: [{ title: 'C', type: 'happy-path', given: [], when: ['act'], then: ['ok'], expected_result: 'd', ac_trace: [{ kind: 'inferred' }], confidence_indicator: '✓', confidence_score: 95 }] }, { name: 'Conf' }, { includeConfidence: true });
check('gherkin: includeConfidence → "# Confidence: ✓ (95)"', has(gConf, '# Confidence: ✓ (95)'));
const gNaN = renderGherkin({ test_cases: [{ title: 'C', type: 'happy-path', given: [], when: ['act'], then: ['ok'], expected_result: 'd', ac_trace: [{ kind: 'inferred' }], confidence_indicator: '✓', confidence_score: NaN }] }, { name: 'N' }, { includeConfidence: true });
check('gherkin: NaN confidence_score → no "(NaN)" garbage', !has(gNaN, 'NaN'));

// expected_result step renders on a real And/Then LINE (not a # comment that happens to contain it)
check('gherkin: expected_result is on an actual step line (starts with And/Then, not #)', /\n\s+(And|Then) A receipt with a due date is printed\./.test(g1));

// Degenerate: stepCount===0 + expected_result → exactly 1 table row carrying the assertion
const tDegen = renderManualTable({ no_acs: false, test_cases: [{ title: 'D', type: 'negative', given: [], when: [], then: [], expected_result: 'Must reject.', ac_trace: [{ kind: 'inferred' }] }] }, { name: 'D' });
check('table: stepCount===0 + expected_result → 1 row with the assertion', tDegen.rows.length === 1 && has(tDegen.rows[0]['Expected Result'], 'Must reject.'));

// shared-ac trace → Gherkin # Covers + computeCoverage shared_ac_refs
const storyShared = { name: 'Shared', acceptance_criteria: ['AC1: own.'] };
const resultShared = { no_acs: false, test_cases: [{ title: 'S', type: 'happy-path', given: [], when: ['act'], then: ['ok'], expected_result: 'd', ac_trace: [{ kind: 'story-ac', ac_text: 'AC1: own.' }, { kind: 'shared-ac', ac_text: 'REQ-22: global.' }] }] };
check('gherkin: shared-ac → "# Covers: [shared-ac]" line', has(renderGherkin(resultShared, storyShared), '# Covers: [shared-ac] REQ-22: global.'));
const covShared = computeCoverage(storyShared, resultShared);
check('coverage: shared-ac counted in shared_ac_refs (not covered_acs)', covShared.shared_ac_refs === 1 && covShared.covered_acs === 1);

// computeCoverage: duplicate trace counts once; inferred_cases; the new `complete` flag
const covDup = computeCoverage({ acceptance_criteria: ['AC1: d.'] }, { test_cases: [{ ac_trace: [{ kind: 'story-ac', ac_text: 'AC1: d.' }, { kind: 'story-ac', ac_text: 'AC1: d.' }] }] });
check('coverage: duplicate ac_trace counts the AC ONCE (Set dedup)', covDup.covered_acs === 1 && covDup.total_acs === 1);
const covInf = computeCoverage({ acceptance_criteria: [] }, { test_cases: [{ ac_trace: [{ kind: 'inferred' }] }, { ac_trace: [{ kind: 'inferred' }] }] });
check('coverage: inferred_cases counted (2)', covInf.inferred_cases === 2);
check('coverage: complete=true when all ACs covered', computeCoverage(story1, result1).complete === true);
check('coverage: complete=true when no-acs (nothing to sub-chunk)', computeCoverage({ acceptance_criteria: [] }, { test_cases: [{ ac_trace: [{ kind: 'inferred' }] }] }).complete === true);
check('coverage: complete=false when an AC is uncovered (P3 sub-chunk fires)', computeCoverage({ acceptance_criteria: ['AC1: a.', 'AC2: b.'] }, { test_cases: [{ ac_trace: [{ kind: 'story-ac', ac_text: 'AC1: a.' }] }] }).complete === false);

// CSV: + / @ injection + the \t-then-formula bypass; options
const csvInj2 = renderManualTable({ no_acs: false, test_cases: [{ title: '+formula', type: 'edge', given: [], when: ['@mention', '\t=tabcmd'], then: ['ok'], expected_result: 'x', ac_trace: [{ kind: 'inferred' }] }] }, { name: 'i' }).csv;
check('csv: leading + neutralized', has(csvInj2, `"'+formula"`));
check('csv: leading @ neutralized', has(csvInj2, `"'@mention"`));
check('csv: tab-then-formula (\\t=cmd) neutralized after tab-strip', has(csvInj2, `"' =tabcmd"`));
check('csv: opts.headerRow:false omits the header', !has(renderManualTable(result1, story1, { headerRow: false }).csv, '"Title"'));
check('csv: opts.delimiter → TSV header has tab-separated columns', renderManualTable(result1, story1, { delimiter: '\t' }).csv.split('\n')[0].split('\t').length === TABLE_COLUMNS.length);
check('table: opts.suite overrides story.name', renderManualTable(result1, story1, { suite: 'CustomSuite' }).rows[0].Suite === 'CustomSuite');

let ok = true;
console.log('─'.repeat(64));
console.log('  P2 RENDER SELFTEST — src/testcases.js (offline, no API)');
console.log('─'.repeat(64));
checks.forEach(([d, p]) => { console.log(`  ${p ? '✓' : '✗ FAIL'}  ${d}`); if (!p) ok = false; });
console.log(`\n${ok ? `✅ ALL ${checks.length} CHECKS PASSED` : '❌ SELFTEST FAILED'}`);
if (!ok) {
  console.log('\n--- Gherkin (fixture 1) ---\n' + g1);
  console.log('\n--- CSV (injection fixture) ---\n' + csv);
}
process.exit(ok ? 0 : 1);
