#!/usr/bin/env node
/**
 * A3 validation — does feeding §7 (the SOURCE SPECIFICATION block) make per-Story test-gen assert
 * concrete thresholds + decision-matrix cells, with ZERO regression?
 *
 * A/B: each target Story is generated WITHOUT the source (today's behaviour) and WITH it, using the
 * REAL production prompt builders (single source of truth) + the REAL FlexiCash breakdown + page.
 * Sync per-Story calls (quality is transport-independent; production uses the async Batches API with
 * the same prompt + the same SHARED cached SOURCE SPECIFICATION block). Sonnet, max_tokens 16000.
 *
 * Metrics (heuristic signals; full outputs saved for human verification):
 *   - matrix cells: distinct (band × affordability) pairs asserted across a Story's cases (max 15)
 *   - eligibility literals: which of {18,70,75,1200,1000,50000,12,84} appear in case text / test_data
 *   - regression markers: per-Story known-good boundary values that MUST survive WITH the source
 *
 * Usage: ANTHROPIC_API_KEY=sk-... node validate_spec_source.js [--runs 2] [--save out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { TEST_CASE_SCHEMA, TEST_CASE_SYSTEM_PROMPT, buildTestCaseUserPrompt, buildSpecSourceSystemText } from '../src/prompts.js';
import { MODEL_PRIMARY } from './anthropic_client.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const BENCH = 'C:/Software Engineer/Success/Spec2Tickets/benchmarks/FlexiCash-breakdown.json';
const PAGE = 'C:/Software Engineer/Success/Spec2Tickets/pages/Page6_Consumer_Loan_Origination.md';

const breakdown = JSON.parse(readFileSync(BENCH, 'utf8'));
const page = readFileSync(PAGE, 'utf8');
const features = breakdown.features || [];
const allNames = features.map((f) => f.name);
const sharedACs = breakdown.shared_acceptance_criteria || [];
const specSummary = (breakdown.metadata && breakdown.metadata.spec_summary) || '';

function feature(name) {
  const f = features.find((x) => x.name === name);
  if (!f) throw new Error(`fixture story not found: ${name}`);
  return f;
}

async function gen({ story, withSource, maxTokens = 24000 }) {
  const system = [{ type: 'text', text: TEST_CASE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
  const hasSpecSource = !!withSource;
  if (hasSpecSource) {
    system.push({ type: 'text', text: buildSpecSourceSystemText(page.slice(0, 80000)), cache_control: { type: 'ephemeral' } });
  }
  const body = {
    model: MODEL_PRIMARY,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: buildTestCaseUserPrompt({ story, siblingNames: allNames, sharedAcceptanceCriteria: sharedACs, specSummary, category: story.category, hasSpecSource }) }],
    output_config: { format: { type: 'json_schema', schema: TEST_CASE_SCHEMA } },
  };
  const start = Date.now();
  let res;
  try {
    res = await fetch(ANTHROPIC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'anthropic-version': ANTHROPIC_VERSION, 'X-Api-Key': process.env.ANTHROPIC_API_KEY }, body: JSON.stringify(body) });
  } catch (e) {
    return { error: 'network', detail: String(e?.message || e) };
  }
  const elapsedMs = Date.now() - start;
  if (!res.ok) return { error: `http_${res.status}`, detail: (await res.text()).slice(0, 400), elapsedMs };
  const data = await res.json();
  const raw = data.content?.[0]?.text ?? '';
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { error: 'parse', detail: raw.slice(0, 300), stop: data.stop_reason, elapsedMs }; }
  return { result: parsed, usage: data.usage, elapsedMs, truncated: data.stop_reason === 'max_tokens', cacheRead: data.usage?.cache_read_input_tokens || 0, cacheWrite: data.usage?.cache_creation_input_tokens || 0 };
}

const caseText = (tc) => [tc.title, ...(tc.given || []), ...(tc.when || []), ...(tc.then || []), tc.expected_result, ...(tc.test_data || [])].join(' | ');

// distinct (band × affordability) pairs asserted across the Story's cases
function matrixCells(cases) {
  const cells = new Set();
  for (const tc of cases) {
    const t = caseText(tc);
    const bands = new Set();
    let m;
    const reBand = /band[- ]?([A-E])\b/gi; while ((m = reBand.exec(t))) bands.add(m[1].toUpperCase());
    const affs = new Set();
    for (const a of ['PASS', 'MARGINAL', 'FAIL']) if (new RegExp(`\\b${a}\\b`).test(t)) affs.add(a);
    for (const b of bands) for (const a of affs) cells.add(`${b}/${a}`);
  }
  return [...cells].sort();
}

function eligibilityLiterals(cases) {
  const blob = cases.map(caseText).join(' || ');
  const checks = { '18': /\b18\b/, '70': /\b70\b/, '75': /\b75\b/, '1200': /1[.,]?200/, '1000': /1[.,]?000/, '50000': /50[.,]?000/, '12mo': /\b12\b/, '84': /\b84\b/ };
  const found = [];
  for (const [k, re] of Object.entries(checks)) if (re.test(blob)) found.push(k);
  return found;
}

function markers(cases, list) {
  const blob = cases.map(caseText).join(' || ');
  return list.filter((mk) => blob.includes(mk));
}

// ceiling-20 re-validation (2026-06-06): WITH-only (§7 already confirmed). Decisioning = the matrix
// completeness check; Data Lifecycle (3 ACs, no decision table) = the NO-PAD check (must stay at its
// natural count ~9, not balloon to 20); Affordability/Pricing = regression.
const TARGETS = [
  { name: 'Automated Credit Decisioning', ab: false, regress: [] },
  { name: 'Eligibility Pre-Screening', ab: false, regress: [] },
  { name: 'Data Lifecycle Management', ab: false, regress: [] },
  { name: 'Affordability Assessment', ab: false, regress: ['40%', '50%', '200', '3.0%'] },
  { name: 'Risk-Based Pricing', ab: false, regress: ['4.90%', '24.90%', '6.90%'] },
];

function summarize(label, out, regress) {
  if (out.error) { console.log(`    ${label}: ❌ ${out.error} ${out.detail || ''}`); return null; }
  const cases = out.result.test_cases || [];
  const cells = matrixCells(cases);
  const lits = eligibilityLiterals(cases);
  const reg = regress && regress.length ? markers(cases, regress) : null;
  console.log(`    ${label}: ${String(cases.length).padStart(2)} cases · ${(out.elapsedMs / 1000).toFixed(1)}s${out.truncated ? ' ⚠TRUNC' : ''} · cache r/w ${out.cacheRead}/${out.cacheWrite}`);
  console.log(`        matrix cells (${cells.length}): ${cells.join(' ') || '—'}`);
  console.log(`        eligibility literals (${lits.length}/8): ${lits.join(' ') || '—'}`);
  if (reg) console.log(`        regression markers (${reg.length}/${regress.length}): ${reg.join(' ') || '—'}  ${reg.length === regress.length ? '✓' : '⚠ MISSING'}`);
  return { cases: cases.length, cells, lits, reg, truncated: out.truncated };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1); }
  const argv = process.argv.slice(2);
  let runs = 2, save = null;
  for (let i = 0; i < argv.length; i++) { if (argv[i] === '--runs') runs = parseInt(argv[++i], 10) || 2; else if (argv[i] === '--save') save = argv[++i]; }

  console.log(`A3 §7-feed validation — ${MODEL_PRIMARY} · max_tokens 16000 · ${runs} run(s)\n${'='.repeat(72)}`);
  const saved = [];
  for (const tgt of TARGETS) {
    const story = feature(tgt.name);
    console.log(`\n■ ${tgt.name}  [${(story.acceptance_criteria || []).length} ACs]`);
    for (let r = 1; r <= runs; r++) {
      console.log(`  run ${r}:`);
      if (tgt.ab) {
        const woOut = await gen({ story, withSource: false });
        summarize('WITHOUT §7', woOut, tgt.regress);
        if (save) saved.push({ story: tgt.name, run: r, mode: 'without', out: woOut });
      }
      const wOut = await gen({ story, withSource: true });
      summarize('WITH §7   ', wOut, tgt.regress);
      if (save) saved.push({ story: tgt.name, run: r, mode: 'with', out: wOut });
    }
  }
  if (save) { writeFileSync(save, JSON.stringify(saved, null, 2), 'utf8'); console.log(`\n✅ saved → ${save}`); }
  console.log(`\n${'='.repeat(72)}\nDone.`);
}

main().catch((e) => { console.error('Unhandled:', e); process.exit(99); });
