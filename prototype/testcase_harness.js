#!/usr/bin/env node
/**
 * Spec2Tickets — TEST-CASE prompt validation harness (T2).
 *
 * Standalone local validator for the per-Story TEST_CASE_SCHEMA +
 * TEST_CASE_SYSTEM_PROMPT in ../src/prompts.js — the make-or-break quality core.
 * Imports the REAL production prompt/schema/user-builder (single source of truth),
 * calls Sonnet 4.6 structured outputs directly, and prints a rule-by-rule analysis
 * so the prompt can be validated multi-run, multi-domain BEFORE any Forge build
 * (POLICY §9 stepwise-empirical + the multi-run-prompt-validation memory).
 *
 * It ALSO carries the PURE coverage-strip function (computeCoverage) that is the
 * implementation contract for the Forge side (v3Schema.js) — AC-trace by verbatim
 * text, normalized + matched against the LIVE ACs → covered / uncovered / stale,
 * inferred counted separately, coverage_pct null (never vacuous 100%) when no ACs.
 *
 * Usage (real runs need a key; the offline machinery does not):
 *   node testcase_harness.js --selftest                 # offline: prove computeCoverage + analysis (NO key)
 *   ANTHROPIC_API_KEY=sk-ant-... node testcase_harness.js                 # all fixtures, 1 run each
 *   ANTHROPIC_API_KEY=sk-... node testcase_harness.js --runs 3            # 3 runs each (variance per the memory)
 *   ANTHROPIC_API_KEY=sk-... node testcase_harness.js --story rich-recurring-payments --runs 3
 *   ANTHROPIC_API_KEY=sk-... node testcase_harness.js --sonnet            # Sonnet quality comparator (blows the 25s Forge limit — reference only; Haiku is the default + production model)
 *   ANTHROPIC_API_KEY=sk-... node testcase_harness.js --save out_tc.json  # persist all outputs
 *
 * Requires Node 18+ (native fetch). Run from prototype/.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEST_CASE_SCHEMA, TEST_CASE_SYSTEM_PROMPT, buildTestCaseUserPrompt } from '../src/prompts.js';
import { estimateCost, MODEL_PRIMARY, MODEL_FALLBACK } from './anthropic_client.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const HERE = dirname(fileURLToPath(import.meta.url));

// ── The Anthropic call (clone of generateBreakdown's mechanics, TEST_CASE_SCHEMA) ──

async function generateTestCases({ apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary, category, coverageType, model = MODEL_FALLBACK, maxTokens = 2400, useCaching = true }) {
  const system = useCaching
    ? [{ type: 'text', text: TEST_CASE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]
    : TEST_CASE_SYSTEM_PROMPT;

  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: buildTestCaseUserPrompt({ story, siblingNames, sharedAcceptanceCriteria, specSummary, category, coverageType }) }],
    output_config: { format: { type: 'json_schema', schema: TEST_CASE_SCHEMA } },
  };

  const start = Date.now();
  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'anthropic-version': ANTHROPIC_VERSION, 'X-Api-Key': apiKey },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { error: 'network_failure', detail: String(e?.message || e) };
  }
  const elapsedMs = Date.now() - start;

  if (!res.ok) {
    const text = await res.text();
    return { error: `anthropic_${res.status}`, detail: text.substring(0, 800), elapsedMs };
  }
  const data = await res.json();
  if (data.stop_reason === 'refusal') return { error: 'refused', detail: 'safety filter', usage: data.usage, elapsedMs };

  let parsed, truncated = false;
  const raw = data.content?.[0]?.text ?? '';
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // Defensive salvage on truncation (the 25s/max_tokens path the Forge side will also have)
    if (data.stop_reason === 'max_tokens') {
      const salv = salvageTruncatedTestCases(raw);
      if (salv) { parsed = salv; truncated = true; }
    }
    if (!parsed) return { error: 'parse_failed', detail: raw.substring(0, 400), usage: data.usage, stop_reason: data.stop_reason, elapsedMs };
  }
  if (data.stop_reason === 'max_tokens') truncated = true;

  return { result: parsed, usage: data.usage, model: data.model, elapsedMs, stop_reason: data.stop_reason, truncated };
}

// Recover whole test_cases from a JSON truncated mid-array (mirror of the breakdown salvage path).
function salvageTruncatedTestCases(raw) {
  const key = '"test_cases"';
  const k = raw.indexOf(key);
  if (k === -1) return null;
  const arrStart = raw.indexOf('[', k);
  if (arrStart === -1) return null;
  const objs = [];
  let depth = 0, inStr = false, esc = false, objStart = -1;
  for (let i = arrStart + 1; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) objStart = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && objStart !== -1) { try { objs.push(JSON.parse(raw.slice(objStart, i + 1))); } catch {} objStart = -1; } }
    else if (c === ']' && depth === 0) break;
  }
  if (!objs.length) return null;
  return { story_name: '(salvaged)', no_acs: false, test_cases: objs };
}

// ── PURE coverage strip — the implementation contract for v3Schema.js ──

function normAC(s) {
  return String(s == null ? '' : s)
    .replace(/[‘’‛′]/g, "'")   // curly / prime single quotes → '
    .replace(/[“”‟″]/g, '"')   // curly double quotes → "
    .replace(/ /g, ' ')                         // NBSP → space
    .replace(/\s+/g, ' ')                            // collapse whitespace
    .trim()
    .toLowerCase();
  // Deliberately does NOT strip semantic punctuation or fold digits↔words, so a
  // meaningfully reworded AC reads STALE (→ re-generate) instead of fuzzy-matching
  // and silently mis-attributing coverage (audit must-fix #5).
}

function computeCoverage(story, result) {
  const liveACs = Array.isArray(story.acceptance_criteria) ? story.acceptance_criteria : [];
  const liveNorm = liveACs.map(normAC);
  const liveSet = new Set(liveNorm);
  const cases = result && Array.isArray(result.test_cases) ? result.test_cases : [];

  const coveredSet = new Set();
  const staleRefs = [];
  let inferred = 0, sharedRefs = 0;

  for (const tc of cases) {
    const trace = Array.isArray(tc.ac_trace) ? tc.ac_trace : [];
    for (const t of trace) {
      if (!t || typeof t !== 'object') continue;
      if (t.kind === 'inferred') { inferred++; continue; }
      if (t.kind === 'shared-ac') { sharedRefs++; continue; }      // not in THIS story's AC list — counted, not coverage
      const n = normAC(t.ac_text);
      if (!n) { staleRefs.push('(grounded entry with empty ac_text)'); continue; } // honest: reads as uncovered, never false-green
      if (liveSet.has(n)) coveredSet.add(n);
      else staleRefs.push(t.ac_text);                               // matches no live AC → AC edited/deleted since gen
    }
  }

  const total = liveACs.length;
  const covered = liveNorm.filter((n) => coveredSet.has(n)).length;
  const uncovered = liveACs.filter((_, i) => !coveredSet.has(liveNorm[i]));
  return {
    no_acs: total === 0,
    total_acs: total,
    covered_acs: covered,
    uncovered_acs: uncovered,
    coverage_pct: total ? Math.round((covered / total) * 100) : null, // null (NOT 100) when no ACs — never vacuous
    inferred_cases: inferred,
    shared_ac_refs: sharedRefs,
    stale_refs: staleRefs,
  };
}

// ── Auto-analysis (heuristic signals; the human judges quality) ──

const VAGUE = /\b(works?\s+(correctly|fine|as\s+(expected|intended))|behaves?\s+as\s+expected|as\s+expected|is\s+handled|handled\s+(properly|correctly|gracefully|appropriately)|functions?\s+correctly)\b/i;

function analyze(story, result) {
  const cases = Array.isArray(result.test_cases) ? result.test_cases : [];
  const types = { 'happy-path': 0, edge: 0, negative: 0 };
  const flags = [];
  cases.forEach((tc, i) => {
    if (types[tc.type] !== undefined) types[tc.type]++;
    const er = String(tc.expected_result || '');
    if (!er.trim()) flags.push(`case ${i + 1}: empty expected_result`);
    else if (VAGUE.test(er)) flags.push(`case ${i + 1}: vague expected_result -> "${er}"`);
    if (!Array.isArray(tc.when) || !tc.when.length) flags.push(`case ${i + 1}: empty when[]`);
    if (!Array.isArray(tc.then) || !tc.then.length) flags.push(`case ${i + 1}: empty then[]`);
    if (!Array.isArray(tc.ac_trace) || !tc.ac_trace.length) flags.push(`case ${i + 1}: empty ac_trace[]`);
    // inferred entry must carry a concern (honest-degradation rule)
    const hasInferred = (tc.ac_trace || []).some((t) => t && t.kind === 'inferred');
    if (hasInferred && !tc.concern) flags.push(`case ${i + 1}: inferred trace WITHOUT a paired concern`);
  });

  const acCount = (story.acceptance_criteria || []).length;
  const expectNoAcs = acCount === 0;
  if (!!result.no_acs !== expectNoAcs) flags.push(`no_acs=${result.no_acs} but the story has ${acCount} ACs`);
  // happy-path-only on a non-trivial story is the bug-shipping failure mode
  if (acCount >= 2 && types.edge === 0 && types.negative === 0) flags.push('happy-path-ONLY on a multi-AC story (no edge, no negative)');

  return { types, flags, coverage: computeCoverage(story, result) };
}

// ── Pretty print ──

const bar = (n = 64) => '─'.repeat(n);

function printBody(story, result) {
  const a = analyze(story, result);
  const cov = a.coverage;
  console.log(`         coverage: ${cov.no_acs ? 'NO ACs (inferred-only)' : `${cov.covered_acs}/${cov.total_acs} ACs (${cov.coverage_pct}%)`}` +
    `${cov.uncovered_acs.length && !cov.no_acs ? `  UNCOVERED: ${cov.uncovered_acs.length}` : ''}` +
    `${cov.inferred_cases ? `  inferred:${cov.inferred_cases}` : ''}${cov.shared_ac_refs ? `  shared:${cov.shared_ac_refs}` : ''}${cov.stale_refs.length ? `  STALE:${cov.stale_refs.length}` : ''}`);
  (result.test_cases || []).forEach((tc, i) => {
    const conf = tc.confidence_indicator ? ` ${tc.confidence_indicator}${tc.confidence_score != null ? tc.confidence_score : ''}` : '';
    const prio = tc.priority ? ` {${tc.priority}}` : '';
    console.log(`           ${i + 1}. [${tc.type}]${prio}${conf} ${tc.title}`);
    console.log(`              ⇒ ${tc.expected_result}`);
    if (Array.isArray(tc.test_data) && tc.test_data.length) console.log(`              ⊞ data: ${tc.test_data.join(' · ')}`);
    if (tc.concern) console.log(`              ⚑ ${tc.concern}`);
  });
  if (a.flags.length) { console.log('         ⚠ FLAGS:'); a.flags.forEach((f) => console.log(`            - ${f}`)); }
  else console.log('         ✓ no heuristic flags');
  return a;
}

function printRun(story, run, out) {
  if (out.error) { console.log(`  run ${run}: ❌ ${out.error} — ${out.detail || ''}`); return null; }
  const cs = (out.usage && estimateCost(out.usage, out.model)) || { total_usd: 0 };
  const n = (out.result.test_cases || []).length;
  const t = { 'happy-path': 0, edge: 0, negative: 0 };
  (out.result.test_cases || []).forEach((tc) => { if (t[tc.type] !== undefined) t[tc.type]++; });
  console.log(`  run ${run} [single call]: ${n} cases  [happy ${t['happy-path']} · edge ${t.edge} · neg ${t.negative}]  ${(out.elapsedMs / 1000).toFixed(1)}s  $${cs.total_usd.toFixed(4)}${out.truncated ? '  ⚠TRUNCATED' : ''}` + (out.elapsedMs > 25000 ? '  ⛔ >25s — would time out a Forge resolver' : ''));
  const a = printBody(story, out.result);
  return { n, cov: a.coverage, types: a.types, flags: a.flags, truncated: out.truncated, elapsedMs: out.elapsedMs, costUsd: cs.total_usd };
}

// Per-type chunking: 3 calls (one coverage lens each) → each a separate Forge resolver
// step, so the binding number vs the 25s limit is the MAX single step, not the sum.
async function runStoryPerType(apiKey, fx, opt, run) {
  const TYPES = ['happy-path', 'edge', 'negative'];
  let merged = [];
  const steps = [];
  for (const ct of TYPES) {
    const out = await generateTestCases({ apiKey, story: fx.story, siblingNames: fx.siblingNames, sharedAcceptanceCriteria: fx.sharedAcceptanceCriteria, specSummary: fx.specSummary, category: fx.story.category, coverageType: ct, model: opt.model, maxTokens: opt.maxTokens, useCaching: opt.useCaching });
    if (out.error) { console.log(`  run ${run} · ${ct}: ❌ ${out.error} — ${out.detail || ''}`); steps.push({ ct, err: out.error }); continue; }
    const cases = out.result.test_cases || [];
    const cs = (out.usage && estimateCost(out.usage, out.model)) || { total_usd: 0 };
    console.log(`  run ${run} · ${ct.padEnd(11)}: ${String(cases.length).padStart(2)} cases  ${(out.elapsedMs / 1000).toFixed(1).padStart(5)}s  $${cs.total_usd.toFixed(4)}${out.truncated ? '  ⚠TRUNC' : ''}${out.elapsedMs > 25000 ? '  ⛔ >25s' : ''}`);
    merged = merged.concat(cases);
    steps.push({ ct, n: cases.length, elapsedMs: out.elapsedMs, costUsd: cs.total_usd, truncated: out.truncated });
  }
  const mergedResult = { story_name: fx.story.name, no_acs: (fx.story.acceptance_criteria || []).length === 0, test_cases: merged };
  const a = printBody(fx.story, mergedResult);
  const times = steps.filter((s) => s.elapsedMs).map((s) => s.elapsedMs);
  const maxStep = times.length ? Math.max(...times) : 0;
  const totalCost = steps.reduce((s, x) => s + (x.costUsd || 0), 0);
  console.log(`         ⏱ per-type: MAX step ${(maxStep / 1000).toFixed(1)}s ${maxStep > 25000 ? '⛔ OVER 25s' : '✓ under 25s'} (the binding number) · ${merged.length} merged cases · $${totalCost.toFixed(4)} total`);
  return { n: merged.length, cov: a.coverage, types: a.types, flags: a.flags, maxStep, totalCost };
}

// ── Offline self-test (no key): prove computeCoverage + analysis incl. the stale-AC path ──

function selftest() {
  console.log(bar()); console.log('  SELFTEST — pure coverage strip + analysis (offline, no API)'); console.log(bar());
  const story = { name: 'X', acceptance_criteria: ['AC1: a limit of 5.', 'AC2: prints a receipt.', 'AC3: logs the actor.'] };
  const result = {
    story_name: 'X', no_acs: false,
    test_cases: [
      { title: 'happy', type: 'happy-path', when: ['do'], then: ['ok'], expected_result: 'a receipt is printed', ac_trace: [{ kind: 'story-ac', ac_text: 'AC2: prints a receipt.' }] },
      { title: 'edge', type: 'edge', when: ['do'], then: ['blocked'], expected_result: 'the 6th is refused', ac_trace: [{ kind: 'story-ac', ac_text: 'AC1: a limit of 5.' }], concern: '[ASSUMPTION|medium] x' },
      { title: 'curly-quote match', type: 'happy-path', when: ['do'], then: ['ok'], expected_result: 'value is 5', ac_trace: [{ kind: 'story-ac', ac_text: 'AC1: a limit of 5.' }] },
      { title: 'stale ref', type: 'edge', when: ['do'], then: ['ok'], expected_result: 'old behaviour', ac_trace: [{ kind: 'story-ac', ac_text: 'AC9: this AC was deleted since generation.' }] },
      { title: 'inferred neg', type: 'negative', when: ['do'], then: ['refused'], expected_result: 'rejected with a message', ac_trace: [{ kind: 'inferred' }], concern: '[ASSUMPTION|low] y' },
      { title: 'inferred missing concern', type: 'negative', when: ['do'], then: ['refused'], expected_result: 'works correctly', ac_trace: [{ kind: 'inferred' }] },
    ],
  };
  const a = analyze(story, result);
  const cov = a.coverage;
  console.log('coverage:', JSON.stringify(cov, null, 2));
  const checks = [
    ['AC2 + AC1 covered (2/3)', cov.covered_acs === 2 && cov.total_acs === 3],
    ['AC3 uncovered surfaced', cov.uncovered_acs.length === 1 && /AC3/.test(cov.uncovered_acs[0])],
    ['stale ref (AC9) detected, not counted as coverage', cov.stale_refs.length === 1],
    ['inferred cases counted (2)', cov.inferred_cases === 2],
    ['coverage_pct numeric (67)', cov.coverage_pct === 67],
    ['flag: vague expected_result ("works correctly")', a.flags.some((f) => /vague/.test(f))],
    ['flag: inferred WITHOUT concern', a.flags.some((f) => /inferred trace WITHOUT/.test(f))],
  ];
  console.log('\nchecks:');
  let ok = true;
  checks.forEach(([d, p]) => { console.log(`  ${p ? '✓' : '✗ FAIL'}  ${d}`); if (!p) ok = false; });
  // no-ACs must never read as vacuous 100%
  const noAcsCov = computeCoverage({ acceptance_criteria: [] }, { test_cases: [{ ac_trace: [{ kind: 'inferred' }] }] });
  const p = noAcsCov.coverage_pct === null && noAcsCov.no_acs === true;
  console.log(`  ${p ? '✓' : '✗ FAIL'}  no-ACs story → coverage_pct null (never vacuous 100%)`); if (!p) ok = false;
  console.log(`\n${ok ? '✅ SELFTEST PASSED' : '❌ SELFTEST FAILED'}`);
  process.exit(ok ? 0 : 1);
}

// ── Main ──

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();

  const opt = { runs: 1, model: MODEL_FALLBACK, story: null, save: null, maxTokens: 2400, useCaching: true, perType: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') opt.runs = parseInt(argv[++i], 10) || 1;
    else if (a === '--model') opt.model = argv[++i];
    else if (a === '--haiku') opt.model = MODEL_FALLBACK; // redundant (Haiku is the default now) — kept for explicitness
    else if (a === '--sonnet') opt.model = MODEL_PRIMARY; // bake-off comparator: Sonnet ~54s single-call BLOWS the 25s Forge limit — quality reference only
    else if (a === '--story') opt.story = argv[++i];
    else if (a === '--save') opt.save = argv[++i];
    else if (a === '--max-tokens') opt.maxTokens = parseInt(argv[++i], 10) || 2400;
    else if (a === '--no-cache') opt.useCaching = false;
    else if (a === '--per-type') opt.perType = true; // 3 calls/story (one coverage lens each) → each a separate <25s resolver step
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('Missing ANTHROPIC_API_KEY. (Use --selftest to validate the offline machinery without a key.)'); process.exit(1); }

  const fixtures = JSON.parse(readFileSync(join(HERE, 'fixtures', 'testcase_stories.json'), 'utf8'));
  let stories = fixtures.stories;
  if (opt.story) stories = stories.filter((s) => s.id === opt.story);
  if (!stories.length) { console.error(`No fixture matched --story ${opt.story}`); process.exit(1); }

  console.log(bar()); console.log(`  TEST-CASE prompt validation — ${opt.model}  ·  ${opt.perType ? 'PER-TYPE (3 calls/story)' : 'single call/story'}  ·  ${stories.length} stor${stories.length === 1 ? 'y' : 'ies'} × ${opt.runs} run(s)`); console.log(bar());

  const saved = [];
  for (const fx of stories) {
    console.log(`\n■ ${fx.id}  (${fx.domain} · probe: ${fx.probe})  — "${fx.story.name}"  [${(fx.story.acceptance_criteria || []).length} ACs]`);
    const runs = [];
    for (let r = 1; r <= opt.runs; r++) {
      let summary;
      if (opt.perType) {
        summary = await runStoryPerType(apiKey, fx, opt, r);
      } else {
        const out = await generateTestCases({ apiKey, story: fx.story, siblingNames: fx.siblingNames, sharedAcceptanceCriteria: fx.sharedAcceptanceCriteria, specSummary: fx.specSummary, category: fx.story.category, model: opt.model, maxTokens: opt.maxTokens, useCaching: opt.useCaching });
        summary = printRun(fx.story, r, out);
        if (opt.save) saved.push({ id: fx.id, run: r, out });
      }
      if (summary) runs.push(summary);
    }
    if (runs.length > 1) {
      const vols = runs.map((x) => x.n);
      const covs = runs.map((x) => (x.cov.coverage_pct == null ? 'n/a' : x.cov.coverage_pct));
      const stepInfo = opt.perType ? ` · max-step ${(Math.max(...runs.map((x) => x.maxStep || 0)) / 1000).toFixed(1)}s` : '';
      console.log(`  ↳ across ${runs.length} runs: volume ${Math.min(...vols)}–${Math.max(...vols)} cases · coverage% [${covs.join(', ')}] · flagged runs ${runs.filter((x) => x.flags.length).length}/${runs.length}${stepInfo}`);
    }
  }

  if (opt.save) { writeFileSync(resolve(opt.save), JSON.stringify(saved, null, 2), 'utf8'); console.log(`\n✅ saved ${saved.length} outputs → ${opt.save}`); }
  console.log('\n' + bar()); console.log('  Done. С усмивка ✨'); console.log(bar());
}

main().catch((e) => { console.error('Unhandled:', e); process.exit(99); });
