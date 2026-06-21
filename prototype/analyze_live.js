#!/usr/bin/env node
// Analyze a live test-cases-FlexiCash.json (production output) for the §7-feed acceptance metrics.
import fs from 'node:fs';
const path = process.argv[2] || 'C:/Software Engineer/Success/Spec2Tickets/benchmarks/test-cases-FlexiCash.json';
const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
const entries = Array.isArray(raw) ? raw : (raw.perStory || []);

const txt = (tc) => [tc.title, ...(tc.given || []), ...(tc.when || []), ...(tc.then || []), tc.expected_result, ...(tc.test_data || [])].join(' | ');

function matrixCells(cases) {
  const cells = new Set();
  for (const tc of cases) {
    const t = txt(tc);
    const bands = new Set(); let m;
    const re = /band[- ]?([A-E])\b/gi; while ((m = re.exec(t))) bands.add(m[1].toUpperCase());
    const affs = new Set(); for (const a of ['PASS', 'MARGINAL', 'FAIL']) if (new RegExp(`\\b${a}\\b`).test(t)) affs.add(a);
    for (const b of bands) for (const a of affs) cells.add(`${b}/${a}`);
  }
  return [...cells].sort();
}
function elig(cases) {
  const blob = cases.map(txt).join(' || ');
  const checks = { '18': /\b18\b/, '70': /\b70\b/, '75': /\b75\b/, '1200': /1[.,]?200/, '1000': /1[.,]?000/, '50000': /50[.,]?000/, '12mo': /\b12\b/, '84': /\b84\b/ };
  return Object.entries(checks).filter(([, re]) => re.test(blob)).map(([k]) => k);
}
const PRICING = ['4.90', '24.90', '6.90', '1.50', '0.50'];
const AFFORD = ['40%', '50%', '200', '3.0'];
const markers = (cases, list) => list.filter((mk) => cases.map(txt).join(' || ').includes(mk));

let totalCases = 0, totalInferred = 0;
console.log(`stories: ${entries.length}`);
for (const e of entries) {
  const r = e.result || e;
  const name = r.story_name || e.storyName || '(?)';
  const cases = Array.isArray(r.test_cases) ? r.test_cases : [];
  totalCases += cases.length;
  const cov = e.coverage || {};
  const inferred = cases.filter((tc) => (tc.ac_trace || []).some((t) => t && t.kind === 'inferred')).length;
  totalInferred += inferred;
  const cells = matrixCells(cases);
  const lits = elig(cases);
  console.log(`\n■ ${name}  [${cases.length} cases · cov ${cov.coverage_pct == null ? 'n/a' : cov.coverage_pct + '%'} (${cov.covered_acs}/${cov.total_acs}) · inferred ${inferred}${cov.stale_refs && cov.stale_refs.length ? ' · STALE ' + cov.stale_refs.length : ''}]`);
  if (cells.length) console.log(`   matrix cells (${cells.length}): ${cells.join(' ')}`);
  if (lits.length) console.log(`   eligibility literals (${lits.length}/8): ${lits.join(' ')}`);
  if (/pricing/i.test(name)) console.log(`   pricing markers: ${markers(cases, PRICING).join(' ') || '—'}`);
  if (/affordab/i.test(name)) console.log(`   affordability markers: ${markers(cases, AFFORD).join(' ') || '—'}`);
}
console.log(`\nTOTAL: ${totalCases} cases · ${totalInferred} inferred across ${entries.length} stories`);
