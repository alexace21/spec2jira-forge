#!/usr/bin/env node
/**
 * Spec2Tickets — STRATEGY BAKE-OFF harness.
 *
 * Empirically compares per-Story test-case GENERATION STRATEGIES on REAL specs to
 * decide whether single-call max_tokens=2400 is top-quality or whether decomposition
 * (S2) wins. Two-phase design so the slow Sonnet breakdowns run ONCE (Phase A) and
 * the fast strategy comparison re-runs cheaply (Phase B, default).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * PHASE A  --breakdown  (Sonnet, slow, one-time)
 *   For each selected page: read markdown → sync structured-output Sonnet call →
 *   extract features[] with ≥3 ACs → save to prototype/bakeoff_stories.json.
 *   Print story count + AC counts.
 *
 * PHASE B  (default, Haiku/Sonnet, fast/batch)
 *   Load bakeoff_stories.json. For each story run selected strategies × --runs N times:
 *     S1  — single call, max_tokens 2400 (baseline, Haiku).
 *     S1b — single call, max_tokens 2800 (cheap richness lever, Haiku).
 *     S2  — proactive decomposition (B1 coverage pass 1400t + B2 depth pass 1200t, Haiku),
 *             only for stories with ≥6 ACs (skipped for <6 ACs).
 *     S3  — Haiku REACTIVE: main 2400t call, then one targeted completion call (1500t)
 *             only for uncovered ACs, merged + deduped. MAX single-call time is the Forge gate.
 *     S4  — Sonnet SINGLE: 6000t, BATCH-ONLY in production (no 25s limit). Run sync here
 *             for quality/coverage measurement; timing is informational (exceeds 25s = expected).
 *   Use --strategies S1,S3,S4 to run a focused subset (default = all).
 *   Print per-story comparison + summary table segmented by AC band (3-5 / 6-7 / 8+).
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Usage:
 *   node bakeoff_harness.js --selftest                          # offline; no key
 *   # Phase A — generate breakdowns from real pages (Sonnet):
 *   ANTHROPIC_API_KEY=sk-ant-... node bakeoff_harness.js --breakdown
 *   ANTHROPIC_API_KEY=sk-ant-... node bakeoff_harness.js --breakdown --pages Page1,Page2
 *   # Phase B — strategy comparison on saved stories:
 *   ANTHROPIC_API_KEY=sk-ant-... node bakeoff_harness.js                              # all strategies
 *   ANTHROPIC_API_KEY=sk-ant-... node bakeoff_harness.js --strategies S1,S3,S4       # focused comparison
 *   ANTHROPIC_API_KEY=sk-ant-... node bakeoff_harness.js --runs 3
 *   ANTHROPIC_API_KEY=sk-ant-... node bakeoff_harness.js --max-stories 5 --strategies S1,S3,S4 --runs 2
 *   ANTHROPIC_API_KEY=sk-ant-... node bakeoff_harness.js --save bakeoff_out.json
 *   ANTHROPIC_API_KEY=sk-ant-... node bakeoff_harness.js --save bakeoff_out.json --force
 *
 * Requires Node 18+ (native fetch). Run from prototype/.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BREAKDOWN_SCHEMA, SYSTEM_PROMPT,
  TEST_CASE_SCHEMA, TEST_CASE_SYSTEM_PROMPT, buildTestCaseUserPrompt,
} from '../src/prompts.js';
import { estimateCost, MODEL_PRIMARY, MODEL_FALLBACK } from './anthropic_client.js';
import { computeCoverage } from '../src/testcases.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const HERE = dirname(fileURLToPath(import.meta.url));

// Real pages live here — plain markdown, basename = page title.
// (AI-delivery-platform is a SIBLING of Spec2Tickets under Success\ → 3 levels up from prototype/.)
const PAGES_DIR = resolve(HERE, '../../../AI-delivery/ai-delivery-platform/pages');

// Saved breakdown stories (Phase A output / Phase B input).
const STORIES_FILE = join(HERE, 'bakeoff_stories.json');

// Cost guard — abort Phase B if running USD total exceeds this.
const COST_GUARD_USD = 3.00;

// Strategy definitions ──────────────────────────────────────────────────────
const STRATEGIES = [
  { id: 'S1',  label: 'Single call (2400t baseline)',     maxTokens: 2400, kind: 'single' },
  { id: 'S1b', label: 'Single call (2800t rich lever)',   maxTokens: 2800, kind: 'single' },
  { id: 'S2',  label: 'Decomposed B1+B2 (≥6 ACs only)',  maxTokens: null, kind: 'decomposed', minAcs: 6 },
  {
    id: 'S3',
    label: 'Haiku Reactive (2400t+completion)',
    maxTokens: 2400,
    kind: 'reactive',
    // Completion call budget — a focused targeted call for missed ACs only; no 3rd call ever.
    completionMaxTokens: 1500,
  },
  {
    id: 'S4',
    label: 'Sonnet Single (6000t batch-only)',
    maxTokens: 6000,
    kind: 'sonnet-single',
    // In PRODUCTION this runs via the async Batches API (no 25s resolver limit).
    // Here we run it SYNC to measure quality/coverage; elapsedMs is informational only.
    isBatch: true,
  },
];

// AC bands for summary segmentation
function acBand(acCount) {
  if (acCount <= 5) return '3-5';
  if (acCount <= 7) return '6-7';
  return '8+';
}

// ── Anthropic calls ──────────────────────────────────────────────────────────

/**
 * Make a SYNC structured-output call to Anthropic.
 * Returns { result, usage, model, elapsedMs, stop_reason, truncated } or { error, detail, ... }.
 */
async function callAnthropic({ apiKey, system, userPrompt, schema, model, maxTokens }) {
  const sysBlock = Array.isArray(system) ? system : [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
  const body = {
    model,
    max_tokens: maxTokens,
    system: sysBlock,
    messages: [{ role: 'user', content: userPrompt }],
    output_config: { format: { type: 'json_schema', schema } },
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
    const txt = await res.text();
    return { error: `anthropic_${res.status}`, detail: txt.substring(0, 800), elapsedMs };
  }
  const data = await res.json();
  if (data.stop_reason === 'refusal') return { error: 'refused', detail: 'safety filter', usage: data.usage, elapsedMs };
  const raw = data.content?.[0]?.text ?? '';
  let parsed;
  let truncated = data.stop_reason === 'max_tokens';
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (truncated) {
      const salv = salvageTruncatedTestCases(raw);
      if (salv) { parsed = salv; }
    }
    if (!parsed) return { error: 'parse_failed', detail: raw.substring(0, 400), usage: data.usage, stop_reason: data.stop_reason, elapsedMs };
  }
  if (data.stop_reason === 'max_tokens') truncated = true;
  return { result: parsed, usage: data.usage, model: data.model, elapsedMs, stop_reason: data.stop_reason, truncated };
}

/**
 * Generate a structured BREAKDOWN from a spec page (Phase A — Sonnet).
 */
async function generateBreakdown({ apiKey, pageTitle, pageContent }) {
  const userPrompt = buildBreakdownUserPrompt(pageTitle, pageContent);
  const system = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
  return callAnthropic({
    apiKey,
    system,
    userPrompt,
    schema: BREAKDOWN_SCHEMA,
    model: MODEL_PRIMARY,
    maxTokens: 16000,
  });
}

/**
 * Generate test cases for one story (Phase B).
 * `model` defaults to MODEL_FALLBACK (Haiku) when not supplied — callers that want
 * Sonnet (S4) pass MODEL_PRIMARY explicitly.
 */
async function generateTestCases({ apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary, category, coverageType, maxTokens, model }) {
  const system = [{ type: 'text', text: TEST_CASE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
  const userPrompt = buildTestCaseUserPrompt({ story, siblingNames, sharedAcceptanceCriteria, specSummary, category, coverageType });
  return callAnthropic({
    apiKey,
    system,
    userPrompt,
    schema: TEST_CASE_SCHEMA,
    model: model || MODEL_FALLBACK,
    maxTokens,
  });
}

// Breakdown user-prompt builder (mirrors prototype/anthropic_client.js, kept local to avoid
// an import cycle — the prototype anthropic_client.js also exports buildUserPrompt but that
// creates a circular read here since bakeoff_harness imports from both src/prompts.js and
// prototype/anthropic_client.js; simpler to keep it self-contained).
function buildBreakdownUserPrompt(pageTitle, pageContent) {
  return `Extract a JIRA-ready breakdown from the following specification page.

# Source page: "${pageTitle}"

# Source content:

${pageContent}

# Output

Return the breakdown strictly conforming to the provided JSON schema.`;
}

// Salvage whole test_cases from a JSON truncated mid-array.
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

// ── PURE rubric helpers ──────────────────────────────────────────────────────

const VAGUE = /\b(works?\s+(correctly|fine|as\s+(expected|intended))|behaves?\s+as\s+expected|as\s+expected|is\s+handled|handled\s+(properly|correctly|gracefully|appropriately)|functions?\s+correctly)\b/i;

/**
 * Compute per-case richness metrics from a parsed test-case result.
 * Returns a RichnessMetrics object — purely deterministic.
 *
 * @param {object} result   parsed test-case result (test_cases[], usage?)
 * @param {number} outputTokens   total output tokens for this call (from usage.output_tokens)
 * @returns {RichnessMetrics}
 */
function computeRichness(result, outputTokens) {
  const cases = Array.isArray(result && result.test_cases) ? result.test_cases : [];
  const n = cases.length;
  if (n === 0) return { caseCount: 0, avgOutputTokensPerCase: 0, avgWhenSteps: 0, avgThenSteps: 0, testDataPresencePct: 0, avgExpectedResultChars: 0, givenGe2Pct: 0 };

  let totalWhen = 0, totalThen = 0, tdCount = 0, totalExpChars = 0, givenGe2 = 0;
  for (const tc of cases) {
    totalWhen += Array.isArray(tc.when) ? tc.when.length : 0;
    totalThen += Array.isArray(tc.then) ? tc.then.length : 0;
    if (Array.isArray(tc.test_data) && tc.test_data.length > 0) tdCount++;
    totalExpChars += typeof tc.expected_result === 'string' ? tc.expected_result.length : 0;
    if (Array.isArray(tc.given) && tc.given.length >= 2) givenGe2++;
  }
  return {
    caseCount: n,
    avgOutputTokensPerCase: outputTokens > 0 ? +(outputTokens / n).toFixed(1) : 0,
    avgWhenSteps: +(totalWhen / n).toFixed(2),
    avgThenSteps: +(totalThen / n).toFixed(2),
    testDataPresencePct: Math.round((tdCount / n) * 100),
    avgExpectedResultChars: +(totalExpChars / n).toFixed(1),
    givenGe2Pct: Math.round((givenGe2 / n) * 100),
  };
}

/**
 * Count vague expected_result flags across all cases.
 * @param {object} result
 * @returns {number}
 */
function countVagueFlags(result) {
  const cases = Array.isArray(result && result.test_cases) ? result.test_cases : [];
  return cases.filter((tc) => VAGUE.test(String(tc.expected_result || ''))).length;
}

/**
 * Merge two test_case arrays (B1 + B2), dedup by normalized title, cap at 12.
 * Pure function — deterministic.
 *
 * @param {object[]} b1Cases  cases from the B1 coverage pass
 * @param {object[]} b2Cases  cases from the B2 depth pass
 * @returns {object[]}  merged, deduped, capped at 12
 */
function mergeAndDedup(b1Cases, b2Cases) {
  const normTitle = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const seen = new Set();
  const result = [];
  for (const tc of [...b1Cases, ...b2Cases]) {
    const key = normTitle(tc.title);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tc);
    if (result.length >= 12) break;
  }
  return result;
}

/**
 * Segment an array of {acCount, ...} objects into the three AC bands.
 * @param {Array<{acBand: string}>} items
 * @returns {{ '3-5': Array, '6-7': Array, '8+': Array }}
 */
function segmentByBand(items) {
  return {
    '3-5': items.filter((x) => x.acBand === '3-5'),
    '6-7': items.filter((x) => x.acBand === '6-7'),
    '8+':  items.filter((x) => x.acBand === '8+'),
  };
}

// ── Display helpers ──────────────────────────────────────────────────────────

const bar = (n = 72) => '─'.repeat(n);

function pad(s, n) { return String(s ?? '').padEnd(n); }
function rpad(s, n) { return String(s ?? '').padStart(n); }

function printRichnessRow(label, r, timing, costUsd) {
  const timingStr = timing != null ? `${(timing / 1000).toFixed(1).padStart(5)}s` : '     ?';
  const forgeFlag = timing > 25000 ? ' ⛔>25s' : timing > 0 ? '' : '';
  console.log(
    `    ${pad(label, 20)}` +
    ` cov=${r.coverage != null ? String(r.coverage.coverage_pct ?? 'noAC').padStart(5) + '%' : '     ?'}` +
    ` n=${String(r.richness.caseCount).padStart(2)}` +
    ` tok/case=${String(r.richness.avgOutputTokensPerCase).padStart(6)}` +
    ` when=${String(r.richness.avgWhenSteps).padStart(4)} then=${String(r.richness.avgThenSteps).padStart(4)}` +
    ` td%=${String(r.richness.testDataPresencePct).padStart(3)}` +
    ` exp=${String(r.richness.avgExpectedResultChars).padStart(5)}ch` +
    ` given≥2%=${String(r.richness.givenGe2Pct).padStart(3)}` +
    ` vague=${r.vagueFlags}` +
    `  ${timingStr}${forgeFlag}` +
    `  $${costUsd.toFixed(4)}`
  );
}

// ── Phase A — breakdown generation ──────────────────────────────────────────

async function runPhaseA({ apiKey, pagesFilter, saveFile }) {
  console.log(bar());
  console.log('  PHASE A — real spec → stories (Sonnet, one-time)');
  console.log(bar());

  // Discover pages
  let pageFiles;
  try {
    pageFiles = readdirSync(PAGES_DIR).filter((f) => f.endsWith('.md'));
  } catch {
    console.error(`Cannot read pages directory: ${PAGES_DIR}`);
    process.exit(1);
  }

  if (pagesFilter.length) {
    pageFiles = pageFiles.filter((f) => pagesFilter.some((p) => f.toLowerCase().includes(p.toLowerCase())));
    if (!pageFiles.length) {
      console.error(`No pages matched filter: ${pagesFilter.join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`\nPages: ${pageFiles.length} file(s) from ${PAGES_DIR}\n`);

  const pages = [];
  for (const filename of pageFiles) {
    const pageTitle = basename(filename, '.md').replace(/_/g, ' ');
    const pageContent = readFileSync(join(PAGES_DIR, filename), 'utf8');
    console.log(`\n■ "${pageTitle}" (${pageContent.length} chars)`);

    const out = await generateBreakdown({ apiKey, pageTitle, pageContent });
    if (out.error) {
      console.log(`  ❌ ${out.error} — ${out.detail || ''} (${(out.elapsedMs / 1000).toFixed(1)}s)`);
      continue;
    }
    const cs = estimateCost(out.usage, out.model);
    console.log(`  Sonnet call: ${(out.elapsedMs / 1000).toFixed(1)}s  $${cs.total_usd.toFixed(4)}  (${out.usage?.output_tokens ?? '?'} out tok)`);

    const bd = out.result;
    const allFeatures = Array.isArray(bd.features) ? bd.features : [];
    const richFeatures = allFeatures.filter((f) => (f.acceptance_criteria || []).length >= 3);
    console.log(`  ${allFeatures.length} features total → ${richFeatures.length} with ≥3 ACs`);
    richFeatures.forEach((f) => {
      const acCount = (f.acceptance_criteria || []).length;
      console.log(`    · "${f.name}"  [${acCount} ACs]  category="${f.category || ''}"  band=${acBand(acCount)}`);
    });

    const specSummary = bd.metadata?.spec_summary || '';
    const sharedACs = Array.isArray(bd.shared_acceptance_criteria) ? bd.shared_acceptance_criteria : [];
    const siblingNames = richFeatures.map((f) => f.name);

    pages.push({
      pageTitle,
      specSummary,
      sharedAcceptanceCriteria: sharedACs,
      stories: richFeatures.map((f) => ({
        ...f,
        _siblingNames: siblingNames.filter((n) => n !== f.name),
      })),
    });
  }

  const out = { generatedAt: new Date().toISOString(), pages };
  writeFileSync(saveFile, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n✅ Saved ${pages.reduce((s, p) => s + p.stories.length, 0)} stories → ${saveFile}`);
  console.log(bar());
}

// ── Phase B — strategy comparison ───────────────────────────────────────────

/**
 * Run selected strategies for one story across `runs` repetitions.
 * @param {string[]} activeStrategyIds  which strategy IDs to run (all if empty/null)
 * Returns { storyName, acCount, acBand, stratResults: Map<stratId, RunSummary[]> }
 * where RunSummary = { richness, coverage, vagueFlags, maxElapsedMs, totalCostUsd, truncated, error?,
 *                      totalCalls? (S3: 1 or 2), isBatch? (S4: always true) }
 */
async function runStrategyForStory({ apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary, runs, costAccumulator, force, activeStrategyIds }) {
  const acCount = (story.acceptance_criteria || []).length;
  const band = acBand(acCount);
  const storyName = story.name;

  // Filter to requested strategies (null/empty = all)
  const activeIds = activeStrategyIds && activeStrategyIds.length ? new Set(activeStrategyIds) : null;
  const activeStrats = STRATEGIES.filter((s) => !activeIds || activeIds.has(s.id));

  console.log(`\n■ "${storyName}"  [${acCount} ACs · band ${band}]`);

  const stratResults = {};
  // Initialize all strategies as null (= skipped / not selected)
  for (const strat of STRATEGIES) stratResults[strat.id] = null;

  for (const strat of activeStrats) {
    if (strat.minAcs && acCount < strat.minAcs) {
      console.log(`  ${strat.id} (${strat.label}) — SKIPPED (story has ${acCount} ACs < required ${strat.minAcs})`);
      continue;
    }

    console.log(`  ${strat.id} (${strat.label})`);
    const runs_ = [];
    for (let r = 1; r <= runs; r++) {
      // Cost guard check before each API call (except force)
      if (!force && costAccumulator.total >= COST_GUARD_USD) {
        console.log(`    ⛔ Cost guard: $${costAccumulator.total.toFixed(4)} >= $${COST_GUARD_USD}. Aborting. Use --force to override.`);
        process.exit(1);
      }

      let runResult;
      if (strat.kind === 'single') {
        runResult = await runSingleStrategy({ apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary, maxTokens: strat.maxTokens });
      } else if (strat.kind === 'decomposed') {
        runResult = await runDecomposedStrategy({ apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary });
      } else if (strat.kind === 'reactive') {
        runResult = await runReactiveStrategy({ apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary, strat });
      } else if (strat.kind === 'sonnet-single') {
        runResult = await runSonnetSingleStrategy({ apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary, maxTokens: strat.maxTokens });
      } else {
        runResult = await runSingleStrategy({ apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary, maxTokens: strat.maxTokens || 2400 });
      }

      costAccumulator.total += runResult.totalCostUsd;
      runs_.push(runResult);

      const covStr = runResult.coverage.coverage_pct != null ? `${runResult.coverage.coverage_pct}%` : 'noAC';
      const truncFlag = runResult.truncated ? ' ⚠TRUNC' : '';
      // S4 is batch-only — >25s is EXPECTED, not a Forge violation; show "batch" annotation instead
      const forgeFlag = runResult.isBatch
        ? ' [batch]'
        : (runResult.maxElapsedMs > 25000 ? ' ⛔>25s' : '');
      // S3: show totalCalls
      const callsStr = runResult.totalCalls != null ? ` calls=${runResult.totalCalls}` : '';
      console.log(
        `    run ${r}: n=${runResult.richness.caseCount}` +
        ` cov=${covStr}` +
        ` maxCall=${(runResult.maxElapsedMs / 1000).toFixed(1)}s` +
        `${callsStr}` +
        ` $${runResult.totalCostUsd.toFixed(4)}` +
        `${truncFlag}${forgeFlag}` +
        (runResult.error ? ` ERROR: ${runResult.error}` : '')
      );
    }
    stratResults[strat.id] = runs_;
    console.log(`    Running cost: $${costAccumulator.total.toFixed(4)}`);
  }

  return { storyName, acCount, acBand: band, stratResults };
}

async function runSingleStrategy({ apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary, maxTokens }) {
  const out = await generateTestCases({
    apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary,
    category: story.category,
    maxTokens,
  });
  if (out.error) {
    return {
      richness: { caseCount: 0, avgOutputTokensPerCase: 0, avgWhenSteps: 0, avgThenSteps: 0, testDataPresencePct: 0, avgExpectedResultChars: 0, givenGe2Pct: 0 },
      coverage: computeCoverage(story, { test_cases: [] }),
      vagueFlags: 0,
      maxElapsedMs: out.elapsedMs || 0,
      totalCostUsd: (out.usage ? estimateCost(out.usage, MODEL_FALLBACK).total_usd : 0),
      truncated: false,
      error: out.error,
    };
  }
  const outputTokens = out.usage?.output_tokens ?? 0;
  const richness = computeRichness(out.result, outputTokens);
  const coverage = computeCoverage(story, out.result);
  const vagueFlags = countVagueFlags(out.result);
  const costUsd = (out.usage ? estimateCost(out.usage, out.model || MODEL_FALLBACK).total_usd : 0);
  return {
    richness,
    coverage,
    vagueFlags,
    maxElapsedMs: out.elapsedMs || 0,
    totalCostUsd: costUsd,
    truncated: out.truncated || false,
    raw: out.result,
  };
}

async function runDecomposedStrategy({ apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary }) {
  // B1 — coverage pass (breadth-first, tighter budget)
  const b1 = await generateTestCases({
    apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary,
    category: story.category,
    maxTokens: 1400,
  });

  // B2 — depth pass (edge+negative depth; restrict to those types via coverageType)
  // We re-use the coverageType='edge' mechanism to get additional edge/negative cases.
  // A single depth call asking for 'edge' pulls both edge and negative via the system prompt.
  const b2 = await generateTestCases({
    apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary,
    category: story.category,
    coverageType: 'edge',
    maxTokens: 1200,
  });

  const b1Cases = (!b1.error && b1.result?.test_cases) ? b1.result.test_cases : [];
  const b2Cases = (!b2.error && b2.result?.test_cases) ? b2.result.test_cases : [];
  const merged = mergeAndDedup(b1Cases, b2Cases);

  const mergedResult = {
    story_name: story.name,
    no_acs: (story.acceptance_criteria || []).length === 0,
    test_cases: merged,
  };

  const b1Tokens = b1.usage?.output_tokens ?? 0;
  const b2Tokens = b2.usage?.output_tokens ?? 0;
  const totalOutputTokens = b1Tokens + b2Tokens;
  const richness = computeRichness(mergedResult, totalOutputTokens);
  const coverage = computeCoverage(story, mergedResult);
  const vagueFlags = countVagueFlags(mergedResult);

  const b1Cost = b1.usage ? estimateCost(b1.usage, b1.model || MODEL_FALLBACK).total_usd : 0;
  const b2Cost = b2.usage ? estimateCost(b2.usage, b2.model || MODEL_FALLBACK).total_usd : 0;
  const totalCostUsd = b1Cost + b2Cost;
  const maxElapsedMs = Math.max(b1.elapsedMs || 0, b2.elapsedMs || 0);
  const truncated = (b1.truncated || false) || (b2.truncated || false);

  return {
    richness,
    coverage,
    vagueFlags,
    maxElapsedMs,
    totalCostUsd,
    truncated,
    raw: mergedResult,
    b1Stats: { n: b1Cases.length, elapsedMs: b1.elapsedMs, costUsd: b1Cost, truncated: b1.truncated },
    b2Stats: { n: b2Cases.length, elapsedMs: b2.elapsedMs, costUsd: b2Cost, truncated: b2.truncated },
  };
}

/**
 * S3 — Haiku REACTIVE: main call (2400t) + ONE targeted completion call when ACs remain uncovered.
 *
 * Flow:
 *   1. Main call: Haiku, max_tokens = strat.maxTokens (2400).
 *   2. computeCoverage on main result.
 *   3. IF !cov.complete && cov.uncovered_acs.length > 0:
 *        completion call — Haiku, max_tokens = strat.completionMaxTokens (1500),
 *        STORY VARIANT whose acceptance_criteria = cov.uncovered_acs only.
 *   4. mergeAndDedup(mainCases, completionCases, cap=12).
 *   5. Recompute coverage on the merged set.
 *
 * Timing gate: the MAX of the two single-call elapsedMs must each be <25s.
 * The completion call is a LEAF — never triggers a 3rd call.
 */
async function runReactiveStrategy({ apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary, strat }) {
  // ── 1. Main call ──
  const mainOut = await generateTestCases({
    apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary,
    category: story.category,
    maxTokens: strat.maxTokens,
    // model implicitly MODEL_FALLBACK (Haiku)
  });

  const emptyRichness = { caseCount: 0, avgOutputTokensPerCase: 0, avgWhenSteps: 0, avgThenSteps: 0, testDataPresencePct: 0, avgExpectedResultChars: 0, givenGe2Pct: 0 };

  if (mainOut.error) {
    return {
      richness: emptyRichness,
      coverage: computeCoverage(story, { test_cases: [] }),
      vagueFlags: 0,
      maxElapsedMs: mainOut.elapsedMs || 0,
      totalCostUsd: mainOut.usage ? estimateCost(mainOut.usage, MODEL_FALLBACK).total_usd : 0,
      totalCalls: 1,
      truncated: false,
      error: mainOut.error,
    };
  }

  const mainCases = mainOut.result?.test_cases ?? [];
  const mainOutputTokens = mainOut.usage?.output_tokens ?? 0;
  const mainCost = mainOut.usage ? estimateCost(mainOut.usage, mainOut.model || MODEL_FALLBACK).total_usd : 0;
  const mainElapsed = mainOut.elapsedMs || 0;

  // ── 2. Coverage check ──
  const mainCov = computeCoverage(story, mainOut.result);

  let completionCases = [];
  let completionOutputTokens = 0;
  let completionCost = 0;
  let completionElapsed = 0;
  let completionTruncated = false;
  let totalCalls = 1;

  // ── 3. Completion call — only when uncovered ACs exist ──
  if (!mainCov.complete && mainCov.uncovered_acs.length > 0) {
    totalCalls = 2;
    // Build a story variant whose acceptance_criteria = ONLY the uncovered ACs.
    // This focuses the model's token budget exactly on the missed coverage.
    const storyVariant = { ...story, acceptance_criteria: mainCov.uncovered_acs };
    const completionOut = await generateTestCases({
      apiKey,
      story: storyVariant,
      siblingNames,
      sharedAcceptanceCriteria,
      specSummary,
      category: story.category,
      maxTokens: strat.completionMaxTokens,
      // model implicitly MODEL_FALLBACK (Haiku)
    });

    if (!completionOut.error) {
      completionCases = completionOut.result?.test_cases ?? [];
      completionOutputTokens = completionOut.usage?.output_tokens ?? 0;
      completionCost = completionOut.usage ? estimateCost(completionOut.usage, completionOut.model || MODEL_FALLBACK).total_usd : 0;
      completionElapsed = completionOut.elapsedMs || 0;
      completionTruncated = completionOut.truncated || false;
    }
    // If the completion call errors, we continue with mainCases only — non-fatal.
  }

  // ── 4. Merge + dedup (cap at 12, same as S2) ──
  const merged = mergeAndDedup(mainCases, completionCases);

  const mergedResult = {
    story_name: story.name,
    no_acs: (story.acceptance_criteria || []).length === 0,
    test_cases: merged,
  };

  // ── 5. Recompute coverage on the merged set ──
  const finalCoverage = computeCoverage(story, mergedResult);

  const totalOutputTokens = mainOutputTokens + completionOutputTokens;
  const richness = computeRichness(mergedResult, totalOutputTokens);
  const vagueFlags = countVagueFlags(mergedResult);

  // Timing gate: the MAX of the two single-call elapsedMs (each must be <25s in Forge)
  const maxSingleCallElapsedMs = Math.max(mainElapsed, completionElapsed);
  const totalCostUsd = mainCost + completionCost;
  const truncated = (mainOut.truncated || false) || completionTruncated;

  return {
    richness,
    coverage: finalCoverage,
    vagueFlags,
    // maxElapsedMs = MAX of the two individual calls — this is the Forge timing gate
    maxElapsedMs: maxSingleCallElapsedMs,
    totalCostUsd,
    totalCalls,
    truncated,
    raw: mergedResult,
    mainStats: { n: mainCases.length, elapsedMs: mainElapsed, costUsd: mainCost, truncated: mainOut.truncated || false },
    completionStats: completionCases.length > 0
      ? { n: completionCases.length, elapsedMs: completionElapsed, costUsd: completionCost, truncated: completionTruncated }
      : null,
  };
}

/**
 * S4 — Sonnet SINGLE: one call, Sonnet 4.6, max_tokens 6000.
 *
 * In PRODUCTION this runs via the async Batches API — there is NO 25s resolver limit
 * for batch calls. Here we run it SYNC to measure quality + coverage.
 * elapsedMs is INFORMATIONAL only — it WILL exceed 25s and that is expected + fine.
 * The summary table annotates S4 as "[batch]" rather than flagging it as a Forge violation.
 */
async function runSonnetSingleStrategy({ apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary, maxTokens }) {
  const out = await generateTestCases({
    apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary,
    category: story.category,
    maxTokens,
    model: MODEL_PRIMARY,  // Sonnet 4.6
  });

  if (out.error) {
    return {
      richness: { caseCount: 0, avgOutputTokensPerCase: 0, avgWhenSteps: 0, avgThenSteps: 0, testDataPresencePct: 0, avgExpectedResultChars: 0, givenGe2Pct: 0 },
      coverage: computeCoverage(story, { test_cases: [] }),
      vagueFlags: 0,
      maxElapsedMs: out.elapsedMs || 0,
      totalCostUsd: out.usage ? estimateCost(out.usage, MODEL_PRIMARY).total_usd : 0,
      isBatch: true,
      truncated: false,
      error: out.error,
    };
  }

  const outputTokens = out.usage?.output_tokens ?? 0;
  const richness = computeRichness(out.result, outputTokens);
  const coverage = computeCoverage(story, out.result);
  const vagueFlags = countVagueFlags(out.result);
  // Sonnet is ~4-5× Haiku per token — note the cost
  const costUsd = out.usage ? estimateCost(out.usage, out.model || MODEL_PRIMARY).total_usd : 0;

  return {
    richness,
    coverage,
    vagueFlags,
    // elapsedMs is informational (batch-only in prod — >25s is expected)
    maxElapsedMs: out.elapsedMs || 0,
    totalCostUsd: costUsd,
    isBatch: true,   // flag for display: don't show ⛔>25s, show "[batch]" instead
    truncated: out.truncated || false,
    raw: out.result,
  };
}

/**
 * Average a numeric field across an array of run summaries (skipping null/undefined).
 */
function avg(arr, field) {
  const vals = arr.filter((x) => x && x[field] != null).map((x) => x[field]);
  if (!vals.length) return null;
  return +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2);
}

/**
 * Aggregate multiple runs into summary statistics for one strategy on one story.
 * Returns null if runs = null (strategy was skipped).
 *
 * Extra fields for S3 (reactive): avgTotalCalls, dualCallRate (% of runs that needed 2 calls)
 * Extra field  for S4 (batch):    isBatch=true — suppresses the Forge-violation flag in display
 */
function aggregateRuns(runs) {
  if (!runs || !runs.length) return null;
  const validRuns = runs.filter((r) => !r.error);
  if (!validRuns.length) return { error: 'all_runs_failed' };

  const covPcts = validRuns.map((r) => r.coverage.coverage_pct).filter((x) => x != null);
  const completePcts = validRuns.filter((r) => r.coverage.complete).length / validRuns.length;
  const truncatedRuns = validRuns.filter((r) => r.truncated).length;

  // S3: track how many calls were needed per run
  const hasTotalCalls = validRuns.some((r) => r.totalCalls != null);
  const avgTotalCalls = hasTotalCalls
    ? +(validRuns.filter((r) => r.totalCalls != null).reduce((s, r) => s + r.totalCalls, 0) / validRuns.filter((r) => r.totalCalls != null).length).toFixed(2)
    : null;
  const dualCallRate = hasTotalCalls
    ? +(validRuns.filter((r) => r.totalCalls === 2).length / validRuns.length * 100).toFixed(1)
    : null;

  // S4: batch-only flag (any run marked isBatch → the strategy is batch-only)
  const isBatch = validRuns.some((r) => r.isBatch === true);

  return {
    runs: runs.length,
    validRuns: validRuns.length,
    truncatedRuns,
    // coverage
    avgCoveragePct: covPcts.length ? +(covPcts.reduce((s, v) => s + v, 0) / covPcts.length).toFixed(1) : null,
    completeRate: +(completePcts * 100).toFixed(1),
    // volume
    minCases: Math.min(...validRuns.map((r) => r.richness.caseCount)),
    maxCases: Math.max(...validRuns.map((r) => r.richness.caseCount)),
    avgCases: avg(validRuns, (r) => r.richness.caseCount),
    // richness
    avgTokPerCase: avg(validRuns.map((r) => r.richness), 'avgOutputTokensPerCase'),
    avgWhenSteps: avg(validRuns.map((r) => r.richness), 'avgWhenSteps'),
    avgThenSteps: avg(validRuns.map((r) => r.richness), 'avgThenSteps'),
    testDataPct: avg(validRuns.map((r) => r.richness), 'testDataPresencePct'),
    avgExpResultChars: avg(validRuns.map((r) => r.richness), 'avgExpectedResultChars'),
    givenGe2Pct: avg(validRuns.map((r) => r.richness), 'givenGe2Pct'),
    // quality signals
    avgVagueFlags: avg(validRuns, (r) => r.vagueFlags),
    // timing — the MAX single sub-call is the binding Forge wall for S3/S2
    avgMaxElapsedMs: avg(validRuns, (r) => r.maxElapsedMs),
    maxMaxElapsedMs: Math.max(...validRuns.map((r) => r.maxElapsedMs)),
    // Forge violations: isBatch strategies are exempt (>25s is expected for batch calls)
    forgeViolations: isBatch ? 0 : validRuns.filter((r) => r.maxElapsedMs > 25000).length,
    // cost
    avgCostUsd: avg(validRuns, (r) => r.totalCostUsd),
    totalCostUsd: validRuns.reduce((s, r) => s + r.totalCostUsd, 0),
    // S3-specific
    avgTotalCalls,
    dualCallRate,
    // S4-specific
    isBatch,
  };
}

/**
 * Print the final summary table for one AC band.
 * S3 column: MaxCallMs (timing gate = max of the two per-call elapsed) + Calls (avg 1-2)
 * S4 column: timing is annotated "[batch]" — not a Forge violation
 */
function printBandSummary(bandLabel, storyAggs) {
  if (!storyAggs.length) return;
  console.log(`\n  Band ${bandLabel} (${storyAggs.length} stor${storyAggs.length === 1 ? 'y' : 'ies'}):`);

  const header = `  ${'Strategy'.padEnd(28)} ${'Cov%'.padStart(6)} ${'Comp%'.padStart(6)} ${'Cases'.padStart(7)} ${'Tok/c'.padStart(6)} ${'When'.padStart(5)} ${'Then'.padStart(5)} ${'TD%'.padStart(4)} ${'Exp'.padStart(6)} ${'≥2g%'.padStart(5)} ${'Vague'.padStart(6)} ${'MaxCall'.padStart(8)} ${'Forge'.padStart(8)} ${'$/call'.padStart(8)}`;
  console.log(header);
  console.log('  ' + '·'.repeat(header.length - 2));

  for (const strat of STRATEGIES) {
    const rows = storyAggs.map((sa) => sa.stratAgg[strat.id]).filter((x) => x && !x.error);
    if (!rows.length) { console.log(`  ${pad(strat.id + ' (not run)', 28)}`); continue; }

    const mean = (field) => {
      const vals = rows.map((r) => r[field]).filter((v) => v != null);
      if (!vals.length) return null;
      return +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1);
    };

    const covPct = mean('avgCoveragePct');
    const compRate = mean('completeRate');
    const avgCases = mean('maxCases'); // show max across runs for volume signal
    const tokPerCase = mean('avgTokPerCase');
    const whenS = mean('avgWhenSteps');
    const thenS = mean('avgThenSteps');
    const tdPct = mean('testDataPct');
    const expC = mean('avgExpResultChars');
    const g2pct = mean('givenGe2Pct');
    const vague = mean('avgVagueFlags');
    const maxMs = mean('avgMaxElapsedMs');
    const forgeV = rows.reduce((s, r) => s + r.forgeViolations, 0);
    const costPerCall = mean('avgCostUsd');

    // S3: show avg calls (1.x means sometimes needed a 2nd call)
    const avgCalls = mean('avgTotalCalls');
    const callsExtra = avgCalls != null ? ` calls=${avgCalls}` : '';

    // S4: batch-only — annotate instead of flagging
    const isBatchStrat = rows.some((r) => r.isBatch);
    const forgeStr = isBatchStrat
      ? '[batch]'
      : (forgeV > 0 ? '⛔' + forgeV : '✓');

    console.log(
      `  ${pad(strat.label + callsExtra, 28)}` +
      ` ${rpad(covPct != null ? covPct + '%' : 'n/a', 6)}` +
      ` ${rpad(compRate != null ? compRate + '%' : 'n/a', 6)}` +
      ` ${rpad(avgCases != null ? avgCases : 'n/a', 7)}` +
      ` ${rpad(tokPerCase != null ? tokPerCase : 'n/a', 6)}` +
      ` ${rpad(whenS != null ? whenS : 'n/a', 5)}` +
      ` ${rpad(thenS != null ? thenS : 'n/a', 5)}` +
      ` ${rpad(tdPct != null ? tdPct + '%' : 'n/a', 4)}` +
      ` ${rpad(expC != null ? expC + 'c' : 'n/a', 6)}` +
      ` ${rpad(g2pct != null ? g2pct + '%' : 'n/a', 5)}` +
      ` ${rpad(vague != null ? vague : 'n/a', 6)}` +
      ` ${rpad(maxMs != null ? (maxMs / 1000).toFixed(1) + 's' : 'n/a', 8)}` +
      ` ${rpad(forgeStr, 8)}` +
      ` ${rpad(costPerCall != null ? '$' + costPerCall.toFixed(4) : 'n/a', 8)}`
    );
  }
}

async function runPhaseB({ apiKey, storiesFile, runs, saveFile, force, maxStories, strategiesFilter }) {
  // Validate + resolve --strategies filter
  const ALL_IDS = STRATEGIES.map((s) => s.id);
  let activeStrategyIds = null; // null = all
  if (strategiesFilter && strategiesFilter.length) {
    const bad = strategiesFilter.filter((id) => !ALL_IDS.includes(id));
    if (bad.length) {
      console.error(`Unknown strategy IDs: ${bad.join(', ')}. Valid: ${ALL_IDS.join(', ')}`);
      process.exit(1);
    }
    activeStrategyIds = strategiesFilter;
  }

  const activeLabel = activeStrategyIds ? activeStrategyIds.join(',') : 'all';
  console.log(bar());
  console.log(`  PHASE B — strategy comparison  ·  strategies=${activeLabel}  ·  ${runs} run(s) per strategy`);
  console.log(bar());

  if (!existsSync(storiesFile)) {
    console.error(`bakeoff_stories.json not found: ${storiesFile}`);
    console.error('Run --breakdown first to generate it.');
    process.exit(1);
  }

  const db = JSON.parse(readFileSync(storiesFile, 'utf8'));
  const allPageData = db.pages || [];
  const allStories = allPageData.flatMap((p) =>
    (p.stories || []).map((s) => ({
      story: s,
      siblingNames: s._siblingNames || [],
      sharedAcceptanceCriteria: p.sharedAcceptanceCriteria || [],
      specSummary: p.specSummary || '',
      pageTitle: p.pageTitle,
    }))
  );

  if (!allStories.length) {
    console.error('No stories in bakeoff_stories.json. Re-run --breakdown.');
    process.exit(1);
  }

  // --max-stories: keep the richest N (sort by AC count desc) to bound cost — the rich
  // stories are where the single-call-vs-decompose question actually bites.
  if (maxStories > 0 && allStories.length > maxStories) {
    allStories.sort((a, b) => (b.story.acceptance_criteria?.length || 0) - (a.story.acceptance_criteria?.length || 0));
    allStories.length = maxStories;
    console.log(`(--max-stories ${maxStories}: kept the ${maxStories} richest stories by AC count)`);
  }

  console.log(`\nLoaded ${allStories.length} stor${allStories.length === 1 ? 'y' : 'ies'} from ${allStories.length > 0 ? allPageData.length : 0} page(s)`);
  console.log(`Cost guard: $${COST_GUARD_USD}${force ? ' (--force: guard disabled)' : ''}\n`);

  const costAccumulator = { total: 0 };
  const storyAggregates = [];
  const rawOutputs = [];

  for (const { story, siblingNames, sharedAcceptanceCriteria, specSummary, pageTitle } of allStories) {
    const storyData = await runStrategyForStory({
      apiKey, story, siblingNames, sharedAcceptanceCriteria, specSummary, runs, costAccumulator, force,
      activeStrategyIds,
    });

    // Aggregate per strategy
    const stratAgg = {};
    for (const strat of STRATEGIES) {
      stratAgg[strat.id] = aggregateRuns(storyData.stratResults[strat.id]);
    }

    // Per-strategy per-story richness summary
    console.log(`\n  Summary for "${storyData.storyName}" [${storyData.acCount} ACs · ${storyData.acBand}]:`);
    for (const strat of STRATEGIES) {
      const agg = stratAgg[strat.id];
      if (!agg) { console.log(`    ${strat.id}: not run`); continue; }
      if (agg.error) { console.log(`    ${strat.id}: all runs failed`); continue; }
      const covStr = agg.avgCoveragePct != null ? `${agg.avgCoveragePct}%` : 'noAC';
      const truncStr = agg.truncatedRuns > 0 ? ` ⚠trunc:${agg.truncatedRuns}/${agg.runs}` : '';
      // S4: batch-only → timing is informational, not a Forge violation
      const forgeStr = agg.isBatch
        ? ' [batch-timing]'
        : (agg.forgeViolations > 0 ? ` ⛔forge:${agg.forgeViolations}` : '');
      // S3: show avg calls + dual-call rate
      const callsStr = agg.avgTotalCalls != null
        ? ` calls=${agg.avgTotalCalls}(2-call:${agg.dualCallRate}%)`
        : '';
      console.log(
        `    ${pad(strat.id, 4)} cov=${covStr.padStart(6)} complete=${String(agg.completeRate + '%').padStart(5)}` +
        ` cases=${String(agg.minCases + '-' + agg.maxCases).padStart(5)}` +
        ` tok/c=${String(agg.avgTokPerCase ?? '?').padStart(6)}` +
        ` maxCall=${(agg.avgMaxElapsedMs / 1000).toFixed(1).padStart(5)}s` +
        ` $${(agg.avgCostUsd || 0).toFixed(4)}` +
        `${callsStr}${truncStr}${forgeStr}`
      );
    }

    storyAggregates.push({ ...storyData, stratAgg, pageTitle });
    if (saveFile) rawOutputs.push({ storyData, stratAgg, pageTitle });
  }

  // ── Summary table by AC band ──
  console.log('\n' + bar());
  console.log('  FINAL SUMMARY TABLE (averaged across stories × runs)');
  console.log(bar());
  const bands = segmentByBand(storyAggregates);
  for (const bandLabel of ['3-5', '6-7', '8+']) {
    printBandSummary(bandLabel, bands[bandLabel]);
  }

  // Grand total
  console.log(`\n  Total API spend this run: $${costAccumulator.total.toFixed(4)}`);
  console.log(`  Stories: ${storyAggregates.length}`);

  if (saveFile) {
    writeFileSync(resolve(saveFile), JSON.stringify(rawOutputs, null, 2), 'utf8');
    console.log(`\n✅ Raw output saved → ${saveFile}`);
  }
  console.log('\n' + bar());
  console.log('  Done. С усмивка ✨');
  console.log(bar());
}

// ── Offline selftest ─────────────────────────────────────────────────────────

function selftest() {
  console.log(bar());
  console.log('  SELFTEST — offline pure-machinery checks (no API)');
  console.log(bar());

  let ok = true;
  const check = (desc, pass) => { console.log(`  ${pass ? '✓' : '✗ FAIL'}  ${desc}`); if (!pass) ok = false; };

  // ── 1. computeRichness on a hand-built result ──
  console.log('\n1. computeRichness()');
  const fakeResult = {
    story_name: 'S', no_acs: false,
    test_cases: [
      { title: 'T1', type: 'happy-path', given: ['a', 'b'], when: ['do X'], then: ['Y happens', 'Z visible'], expected_result: 'The widget saves correctly.', test_data: ['val1'], ac_trace: [] },
      { title: 'T2', type: 'edge',        given: ['a'],       when: ['do Y', 'do Z'], then: ['error shown'], expected_result: 'A warning is displayed.', test_data: [], ac_trace: [] },
      { title: 'T3', type: 'negative',    given: [],          when: ['do W'],        then: ['rejected'],    expected_result: 'works correctly', test_data: [], ac_trace: [] },
    ],
  };
  const r = computeRichness(fakeResult, 300);
  check('caseCount=3', r.caseCount === 3);
  check('avgOutputTokensPerCase=100', r.avgOutputTokensPerCase === 100);
  check('avgWhenSteps=(1+2+1)/3=1.33', r.avgWhenSteps === 1.33);
  check('avgThenSteps=(2+1+1)/3=1.33', r.avgThenSteps === 1.33);
  check('testDataPresencePct=33 (1/3)', r.testDataPresencePct === 33);
  check('avgExpectedResultChars>0', r.avgExpectedResultChars > 0);
  check('givenGe2Pct=33 (1/3 cases have ≥2 given)', r.givenGe2Pct === 33);

  // ── 2. countVagueFlags ──
  console.log('\n2. countVagueFlags()');
  const vf = countVagueFlags(fakeResult);
  check('1 vague flag (T3: "works correctly")', vf === 1);
  const noVague = countVagueFlags({ test_cases: [
    { expected_result: 'The record is saved to the database.' },
    { expected_result: 'A 404 status code is returned.' },
  ]});
  check('0 vague flags on concrete expected_results', noVague === 0);

  // ── 3. mergeAndDedup ──
  console.log('\n3. mergeAndDedup()');
  const b1 = [
    { title: 'Happy path A', type: 'happy-path', ac_trace: [] },
    { title: 'Edge case B',   type: 'edge',        ac_trace: [] },
    { title: 'Negative C',    type: 'negative',    ac_trace: [] },
  ];
  const b2 = [
    { title: 'Edge case B',   type: 'edge',    ac_trace: [] },  // exact dup of b1[1]
    { title: 'EDGE CASE B ',  type: 'edge',    ac_trace: [] },  // dup with different case + trailing space
    { title: 'New depth D',   type: 'edge',    ac_trace: [] },
    { title: 'New depth E',   type: 'negative',ac_trace: [] },
  ];
  const merged = mergeAndDedup(b1, b2);
  check('b1+b2 deduplicated to 5 unique (not 7)', merged.length === 5);
  check('all b1 cases preserved', ['Happy path A', 'Edge case B', 'Negative C'].every((t) => merged.some((m) => m.title === t)));
  check('New depth D and E added from b2', merged.some((m) => m.title === 'New depth D') && merged.some((m) => m.title === 'New depth E'));
  check('"EDGE CASE B " deduped against "Edge case B"', merged.filter((m) => m.title.toLowerCase().trim() === 'edge case b').length === 1);

  // ── 4. mergeAndDedup cap at 12 ──
  console.log('\n4. mergeAndDedup cap at 12');
  const big = Array.from({ length: 20 }, (_, i) => ({ title: `Case ${i + 1}`, type: 'happy-path', ac_trace: [] }));
  const capped = mergeAndDedup(big.slice(0, 10), big.slice(10));
  check('merged 20 unique cases capped to 12', capped.length === 12);

  // ── 5. acBand segmentation ──
  console.log('\n5. segmentByBand()');
  const items = [
    { acBand: '3-5', name: 'a' }, { acBand: '3-5', name: 'b' },
    { acBand: '6-7', name: 'c' },
    { acBand: '8+',  name: 'd' }, { acBand: '8+', name: 'e' },
  ];
  const seg = segmentByBand(items);
  check('3-5 band has 2 items', seg['3-5'].length === 2);
  check('6-7 band has 1 item',  seg['6-7'].length === 1);
  check('8+ band has 2 items',  seg['8+'].length === 2);
  check('acBand(3)=3-5',  acBand(3) === '3-5');
  check('acBand(5)=3-5',  acBand(5) === '3-5');
  check('acBand(6)=6-7',  acBand(6) === '6-7');
  check('acBand(7)=6-7',  acBand(7) === '6-7');
  check('acBand(8)=8+',   acBand(8) === '8+');
  check('acBand(12)=8+',  acBand(12) === '8+');

  // ── 6. computeCoverage integration (via imported src/testcases.js) ──
  console.log('\n6. computeCoverage() via src/testcases.js');
  const story6 = { acceptance_criteria: ['AC1: limit 5.', 'AC2: prints receipt.', 'AC3: logs actor.'] };
  const res6 = {
    test_cases: [
      { ac_trace: [{ kind: 'story-ac', ac_text: 'AC1: limit 5.' }] },
      { ac_trace: [{ kind: 'story-ac', ac_text: 'AC2: prints receipt.' }] },
      { ac_trace: [{ kind: 'inferred' }] },
    ],
  };
  const cov6 = computeCoverage(story6, res6);
  check('computeCoverage: 2/3 ACs covered (AC3 uncovered)', cov6.covered_acs === 2 && cov6.total_acs === 3);
  check('computeCoverage: uncovered_acs includes AC3', cov6.uncovered_acs.some((ac) => /AC3/.test(ac)));
  check('computeCoverage: coverage_pct=67', cov6.coverage_pct === 67);
  check('computeCoverage: complete=false (AC3 missing)', cov6.complete === false);
  check('computeCoverage: inferred_cases=1', cov6.inferred_cases === 1);

  // no-ACs — must never be vacuous 100%
  const covNoAC = computeCoverage({ acceptance_criteria: [] }, { test_cases: [{ ac_trace: [{ kind: 'inferred' }] }] });
  check('no-ACs story: coverage_pct=null (never vacuous 100%)', covNoAC.coverage_pct === null);
  check('no-ACs story: complete=true (nothing to miss)', covNoAC.complete === true);

  // ── 7. aggregateRuns on canned data ──
  console.log('\n7. aggregateRuns()');
  const fakeRuns = [
    { richness: { caseCount: 9, avgOutputTokensPerCase: 80, avgWhenSteps: 1.5, avgThenSteps: 1.2, testDataPresencePct: 44, avgExpectedResultChars: 60, givenGe2Pct: 66 }, coverage: { coverage_pct: 100, complete: true }, vagueFlags: 0, maxElapsedMs: 14000, totalCostUsd: 0.002, truncated: false },
    { richness: { caseCount: 10, avgOutputTokensPerCase: 85, avgWhenSteps: 1.6, avgThenSteps: 1.3, testDataPresencePct: 50, avgExpectedResultChars: 65, givenGe2Pct: 70 }, coverage: { coverage_pct: 100, complete: true }, vagueFlags: 0, maxElapsedMs: 15000, totalCostUsd: 0.0022, truncated: false },
    { richness: { caseCount: 9, avgOutputTokensPerCase: 78, avgWhenSteps: 1.4, avgThenSteps: 1.1, testDataPresencePct: 44, avgExpectedResultChars: 58, givenGe2Pct: 55 }, coverage: { coverage_pct: 100, complete: true }, vagueFlags: 1, maxElapsedMs: 13500, totalCostUsd: 0.0019, truncated: false },
  ];
  const agg = aggregateRuns(fakeRuns);
  check('aggregateRuns: validRuns=3', agg.validRuns === 3);
  check('aggregateRuns: avgCoveragePct=100', agg.avgCoveragePct === 100);
  check('aggregateRuns: completeRate=100', agg.completeRate === 100);
  check('aggregateRuns: minCases=9, maxCases=10', agg.minCases === 9 && agg.maxCases === 10);
  check('aggregateRuns: forgeViolations=0 (all <25s)', agg.forgeViolations === 0);

  // ── 8. S3 Reactive merge path (offline simulation) ──
  // Simulates: main call returns 3 cases covering 2/4 ACs → completion call covers the 2 missed
  // ACs → merged result reaches full coverage.
  console.log('\n8. S3 reactive merge path (simulate main+completion+coverage)');
  const s3Story = {
    name: 'S3 test story',
    acceptance_criteria: ['AC1: user can log in.', 'AC2: session expires.', 'AC3: error shown on bad password.', 'AC4: rate-limit after 5 attempts.'],
  };
  // Main result covers AC1 + AC2 only
  const s3MainResult = {
    story_name: 'S3 test story', no_acs: false,
    test_cases: [
      { title: 'Login success',   type: 'happy-path', given: [], when: ['enter valid credentials'], then: ['user logged in'], expected_result: 'Dashboard shown.', test_data: [], ac_trace: [{ kind: 'story-ac', ac_text: 'AC1: user can log in.' }] },
      { title: 'Session expires', type: 'edge',       given: [], when: ['wait past session timeout'], then: ['redirected to login'], expected_result: 'Login page shown.', test_data: [], ac_trace: [{ kind: 'story-ac', ac_text: 'AC2: session expires.' }] },
      { title: 'Inferred extra',  type: 'negative',   given: [], when: ['enter empty form'],      then: ['form blocked'],   expected_result: 'Submit disabled.',  test_data: [], ac_trace: [{ kind: 'inferred' }] },
    ],
  };
  const s3MainCov = computeCoverage(s3Story, s3MainResult);
  check('S3 main call: 2/4 ACs covered (AC3+AC4 uncovered)', s3MainCov.covered_acs === 2 && s3MainCov.uncovered_acs.length === 2);
  check('S3 main call: complete=false', s3MainCov.complete === false);
  check('S3 uncovered_acs includes AC3', s3MainCov.uncovered_acs.some((ac) => /AC3/.test(ac)));
  check('S3 uncovered_acs includes AC4', s3MainCov.uncovered_acs.some((ac) => /AC4/.test(ac)));

  // Completion call (targeted at uncovered ACs) adds two more cases
  const s3CompletionResult = {
    story_name: 'S3 test story', no_acs: false,
    test_cases: [
      { title: 'Bad password error', type: 'negative', given: [], when: ['enter wrong password'], then: ['error displayed'], expected_result: 'Error message shown.', test_data: [], ac_trace: [{ kind: 'story-ac', ac_text: 'AC3: error shown on bad password.' }] },
      { title: 'Rate limit',         type: 'edge',     given: [], when: ['fail login 5 times'],  then: ['account locked'],  expected_result: 'Rate-limit notice shown.', test_data: [], ac_trace: [{ kind: 'story-ac', ac_text: 'AC4: rate-limit after 5 attempts.' }] },
    ],
  };

  // mergeAndDedup the two sets
  const s3Merged = mergeAndDedup(s3MainResult.test_cases, s3CompletionResult.test_cases);
  const s3MergedResult = { story_name: 'S3 test story', no_acs: false, test_cases: s3Merged };
  const s3FinalCov = computeCoverage(s3Story, s3MergedResult);
  check('S3 merged: 5 unique cases (3 main + 2 completion, none duped)', s3Merged.length === 5);
  check('S3 merged: 4/4 ACs covered → complete=true', s3FinalCov.covered_acs === 4 && s3FinalCov.complete === true);
  check('S3 merged: coverage_pct=100', s3FinalCov.coverage_pct === 100);

  // If the completion cases were instead a duplicate of a main case, dedup removes it
  const s3DupCompletion = [
    { title: 'Login success',  type: 'happy-path', given: [], when: [], then: [], expected_result: '', test_data: [], ac_trace: [] }, // exact dup of main[0]
    { title: 'Rate limit',     type: 'edge',       given: [], when: [], then: [], expected_result: '', test_data: [], ac_trace: [] },
  ];
  const s3MergedWithDup = mergeAndDedup(s3MainResult.test_cases, s3DupCompletion);
  check('S3 dup completion case is deduped (main=3 + completion=2 but 1 dup → 4 total)', s3MergedWithDup.length === 4);

  // ── 9. --strategies filter parsing + validation ──
  console.log('\n9. --strategies filter: parseStrategiesFilter()');
  // Simulate the CLI logic inline (same code path)
  const ALL_IDS_FOR_TEST = STRATEGIES.map((s) => s.id); // ['S1','S1b','S2','S3','S4']
  check('ALL strategy IDs include S1,S1b,S2,S3,S4', ALL_IDS_FOR_TEST.includes('S1') && ALL_IDS_FOR_TEST.includes('S3') && ALL_IDS_FOR_TEST.includes('S4'));

  // Valid filter: S1,S3,S4
  const filterInput = 'S1,S3,S4'.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const badIds = filterInput.filter((id) => !ALL_IDS_FOR_TEST.includes(id));
  check('S1,S3,S4 all valid (no bad IDs)', badIds.length === 0);
  check('filter parsed to 3 IDs', filterInput.length === 3 && filterInput[0] === 'S1' && filterInput[2] === 'S4');

  // Unknown ID → bad
  const unknownFilter = ['S1', 'S99'].filter((id) => !ALL_IDS_FOR_TEST.includes(id));
  check('S99 detected as unknown strategy ID', unknownFilter.length === 1 && unknownFilter[0] === 'S99');

  // Empty filter → all strategies active (null/activeIds not set)
  const emptyFilter = ''.split(',').map((s) => s.trim()).filter(Boolean);
  check('empty --strategies value → empty array (all run)', emptyFilter.length === 0);

  // S3 activeStrategyIds set → S4 is null (not run) in stratResults
  // Simulate: runStrategyForStory initialises all to null, then only runs active ones
  const simActive = new Set(['S1', 'S3']);
  const simResults = {};
  for (const strat of STRATEGIES) simResults[strat.id] = null;
  for (const strat of STRATEGIES) {
    if (simActive.has(strat.id)) simResults[strat.id] = [{ runResult: 'ok' }];
  }
  check('S1 has runs when in filter', simResults['S1'] !== null);
  check('S3 has runs when in filter', simResults['S3'] !== null);
  check('S4 is null (not run) when not in filter', simResults['S4'] === null);
  check('S1b is null (not run) when not in filter', simResults['S1b'] === null);

  // aggregateRuns(null) returns null (skipped/not-run, safe in summary)
  const aggNull = aggregateRuns(null);
  check('aggregateRuns(null) returns null', aggNull === null);

  // ── Done ──
  console.log(`\n${ok ? '✅ SELFTEST PASSED' : '❌ SELFTEST FAILED'}`);
  process.exit(ok ? 0 : 1);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();

  const opt = {
    phase: 'B',
    runs: 3,
    pagesFilter: [],
    save: null,
    storiesFile: STORIES_FILE,
    force: false,
    maxStories: 0,
    strategiesFilter: [],  // --strategies S1,S3,S4  (empty = all)
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--breakdown')    { opt.phase = 'A'; }
    else if (a === '--runs')    { opt.runs = parseInt(argv[++i], 10) || 3; }
    else if (a === '--pages')   { opt.pagesFilter = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean); }
    else if (a === '--save')    { opt.save = argv[++i]; }
    else if (a === '--force')   { opt.force = true; }
    else if (a === '--max-stories') { opt.maxStories = parseInt(argv[++i], 10) || 0; }
    else if (a === '--strategies') {
      // Comma-separated list of strategy IDs, e.g. S1,S3,S4
      opt.strategiesFilter = (argv[++i] || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Missing ANTHROPIC_API_KEY. Use --selftest to validate the offline machinery without a key.');
    process.exit(1);
  }

  if (opt.phase === 'A') {
    await runPhaseA({ apiKey, pagesFilter: opt.pagesFilter, saveFile: opt.save || STORIES_FILE });
  } else {
    await runPhaseB({
      apiKey,
      storiesFile: opt.storiesFile,
      runs: opt.runs,
      saveFile: opt.save,
      force: opt.force,
      maxStories: opt.maxStories,
      strategiesFilter: opt.strategiesFilter,
    });
  }
}

main().catch((e) => { console.error('Unhandled:', e); process.exit(99); });
