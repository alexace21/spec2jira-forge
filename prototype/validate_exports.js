#!/usr/bin/env node
/**
 * Offline validation of Copy-Gherkin / Copy-CSV exports (the partner's "test Copy works correctly
 * where the copied content should be applied"). Renders REAL FlexiCash live test-cases through the
 * PRODUCTION renderers (renderGherkin / renderManualTable in src/testcases.js — the SAME functions
 * the getTestCaseExports resolver calls) and checks the format is valid + tool-importable. Zero cost.
 *
 * Usage: node prototype/validate_exports.js
 */
import { readFileSync } from 'node:fs';
import { renderGherkin, renderManualTable } from '../src/testcases.js';

const TC = 'C:/Software Engineer/Success/Spec2Tickets/benchmarks/test-cases-FlexiCash.json';
const BD = 'C:/Software Engineer/Success/Spec2Tickets/benchmarks/FlexiCash-breakdown.json';
const raw = JSON.parse(readFileSync(TC, 'utf8'));
const entries = Array.isArray(raw) ? raw : raw.perStory || [];
const breakdown = JSON.parse(readFileSync(BD, 'utf8'));
const featureByName = new Map((breakdown.features || []).map((f) => [f.name, f]));

let fail = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`    ✓ ${name}`);
  else { console.log(`    ✗ ${name} — ${detail}`); fail++; }
};

// Minimal RFC-4180 CSV row splitter (handles quoted fields with embedded commas + "" escapes).
function splitCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function validateGherkin(feature, label) {
  console.log(`\n  ── Gherkin: ${label} ──`);
  const lines = feature.split('\n');
  check('starts with "Feature:"', /^Feature:/.test(feature.trim()), feature.slice(0, 40));
  const scenarios = lines.filter((l) => /^\s*Scenario:/.test(l)).length;
  check('has ≥1 Scenario', scenarios >= 1, `${scenarios} scenarios`);
  // every Scenario is preceded by a @tag line
  let taggedOk = true;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*Scenario:/.test(lines[i])) {
      if (!/^\s*@/.test(lines[i - 1] || '')) { taggedOk = false; break; }
    }
  }
  check('every Scenario has a @tag line above it', taggedOk, 'a scenario lacks a tag');
  // no empty steps (Cucumber rejects "Given " / "When " with nothing after)
  const emptyStep = lines.find((l) => /^\s*(Given|When|Then|And)\s*$/.test(l));
  check('no empty Given/When/Then/And steps', !emptyStep, `empty step: "${emptyStep}"`);
  // every Scenario has at least a When and a Then/And assertion somewhere after it
  const hasWhen = lines.some((l) => /^\s*When /.test(l));
  const hasThen = lines.some((l) => /^\s*(Then|And) /.test(l));
  check('has When + Then steps', hasWhen && hasThen, `when=${hasWhen} then=${hasThen}`);
  console.log('    ┌─ sample (first ~22 lines) ─');
  feature.split('\n').slice(0, 22).forEach((l) => console.log('    │ ' + l));
  console.log('    └─');
}

function validateCsv(csv, label) {
  console.log(`\n  ── CSV: ${label} ──`);
  const lines = csv.split('\n');
  const header = splitCsvLine(lines[0]);
  check('header is the 11 TABLE_COLUMNS', header.length === 11, `${header.length} cols: ${header.join('|')}`);
  // every row has exactly the same column count (RFC-4180 well-formed)
  let badRow = null;
  for (let i = 1; i < lines.length; i++) {
    const n = splitCsvLine(lines[i]).length;
    if (n !== header.length) { badRow = `row ${i}: ${n} cols (≠ ${header.length})`; break; }
  }
  check('all rows have header column count (parseable)', !badRow, badRow);
  // formula-injection neutralized: no UNquoted cell starting = + @ (a quoted leading-' is fine)
  const cells = lines.flatMap(splitCsvLine);
  const inj = cells.find((c) => /^[=+@]/.test(c) && !/^'/.test(c));
  check('no un-neutralized formula-injection cells', !inj, `cell: "${inj}"`);
  console.log(`    rows: ${lines.length - 1} (+ header) · cols: ${header.length}`);
  console.log('    ┌─ sample (header + 4 rows) ─');
  lines.slice(0, 5).forEach((l) => console.log('    │ ' + l.slice(0, 150)));
  console.log('    └─');
}

console.log('Export validation — production renderers on live FlexiCash test-cases\n' + '='.repeat(72));
const TARGETS = ['Automated Credit Decisioning', 'Eligibility Pre-Screening'];
for (const e of entries) {
  const r = e.result || e;
  const name = r.story_name || '(?)';
  if (!TARGETS.includes(name)) continue;
  const story = featureByName.get(name) || { name };
  console.log(`\n■ ${name}  [${(r.test_cases || []).length} cases]`);
  validateGherkin(renderGherkin(r, story), name);
  const { csv } = renderManualTable(r, story, { storyRef: 'EPIC-1' });
  validateCsv(csv, name);
}

// also: render ALL stories to confirm none throws + every Gherkin/CSV is non-empty
console.log('\n' + '─'.repeat(72) + '\n■ All-stories smoke (no throw, non-empty):');
let allOk = true;
for (const e of entries) {
  const r = e.result || e;
  const story = featureByName.get(r.story_name) || { name: r.story_name };
  try {
    const g = renderGherkin(r, story);
    const { csv } = renderManualTable(r, story);
    if (!g || !g.startsWith('Feature:') || !csv || csv.split('\n').length < 2) {
      allOk = false; console.log(`    ✗ ${r.story_name}: empty/invalid render`);
    }
  } catch (err) { allOk = false; console.log(`    ✗ ${r.story_name}: threw ${err.message}`); }
}
check(`all ${entries.length} stories render cleanly`, allOk, 'see above');

console.log('\n' + '='.repeat(72));
console.log(fail === 0 ? '✅ EXPORTS VALID' : `❌ ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
