#!/usr/bin/env node
/**
 * Offline test for the v6 cost-transparency primitives (src/anthropic_client.js):
 * estimateCost batch flag, sumUsage, projectTestCaseCost (cache amortization is the
 * load-bearing math — a naive per-story full-price input would over-state ~10x).
 *
 * Pure functions → runs under plain node. Usage: node prototype/test_v6_cost.mjs
 */
import { estimateCost, sumUsage, projectTestCaseCost, TC_SPEC_SOURCE_MAX_CHARS } from '../src/anthropic_client.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`  XX  ${name}`); }
}
const approx = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

console.log('v6 cost-transparency:');

// ── estimateCost batch flag ──────────────────────────────────────────
const u = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const sync = estimateCost(u, 'claude-sonnet-4-6');
const batch = estimateCost(u, 'claude-sonnet-4-6', { batch: true });
check('sync Sonnet 1M in + 1M out = $3 + $15 = $18', approx(sync.total_usd, 18));
check('batch = exactly half of sync', approx(batch.total_usd, sync.total_usd / 2));
check('batch 1M in + 1M out = $9', approx(batch.total_usd, 9));
check('default (no opts) === sync (zero churn for existing callers)', approx(estimateCost(u).total_usd, 18));
check('cache_read priced at 0.1x base (sync $0.30/MTok)', approx(estimateCost({ cache_read_input_tokens: 1_000_000 }, 'claude-sonnet-4-6').total_usd, 0.3));
check('cache_write priced at 1.25x base (sync $3.75/MTok)', approx(estimateCost({ cache_creation_input_tokens: 1_000_000 }, 'claude-sonnet-4-6').total_usd, 3.75));

// ── sumUsage ─────────────────────────────────────────────────────────
const s = sumUsage([
  { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 5, cache_read_input_tokens: 3 },
  { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 7 },
  null, // null-safe
  { input_tokens: 4 }, // missing fields default 0
]);
check('sumUsage input', s.input_tokens === 15);
check('sumUsage output', s.output_tokens === 22);
check('sumUsage cache_creation', s.cache_creation_input_tokens === 5);
check('sumUsage cache_read', s.cache_read_input_tokens === 10);
check('sumUsage([]) = zeros', sumUsage([]).input_tokens === 0 && sumUsage().output_tokens === 0);

// ── projectTestCaseCost ──────────────────────────────────────────────
const empty = projectTestCaseCost({ storyACcounts: [] });
check('0 stories → $0', empty.expected_usd === 0 && empty.upper_usd === 0 && empty.story_count === 0);

const p = projectTestCaseCost({ storyACcounts: [3, 5, 4], specSourceChars: 40000, model: 'claude-sonnet-4-6' });
check('story_count = 3', p.story_count === 3);
check('ac_total = 12', p.ac_total === 12);
check('expected_usd > 0', p.expected_usd > 0);
check('upper_usd > expected_usd (the variance bound)', p.upper_usd > p.expected_usd);
check('expected_usd is a sane small number (< $5 for 3 stories)', p.expected_usd < 5);

// ⭐ CACHE AMORTIZATION (the load-bearing math): the shared system+source block must be priced as
// 1 cache-write + (N-1) cache-reads — NOT N full-price inputs. Verify a bigger spec-source raises
// cost only modestly (cache-read at 0.1x), not linearly with N.
const noSrc = projectTestCaseCost({ storyACcounts: [3, 3, 3, 3, 3], specSourceChars: 0 });
const bigSrc = projectTestCaseCost({ storyACcounts: [3, 3, 3, 3, 3], specSourceChars: 80000 });
const delta = bigSrc.expected_usd - noSrc.expected_usd;
// 80000 chars ≈ 20000 tokens shared. If billed N=5 times at full input ($3/MTok batch=$1.5):
//   naive = 20000/1e6 * 1.5 * 5 = $0.15. Amortized = write(1.25x once) + read(0.1x * 4):
//   (20000/1e6)*(3*0.5*1.25) + (20000*4/1e6)*(3*0.5*0.1) = 0.0375 + 0.012 = ~$0.0495.
check('cache-amortized source delta is small (~$0.05, NOT the ~$0.15 naive)', delta > 0.02 && delta < 0.09);
check('5 cheap stories total stays well under $1 (no ceiling/full-price blowup)', bigSrc.expected_usd < 1);

// Output heuristic must NOT quote the 24K ceiling as expected: a 0-AC story is cheap, not capped.
const tiny = projectTestCaseCost({ storyACcounts: [0], specSourceChars: 0, model: 'claude-sonnet-4-6' });
const huge = projectTestCaseCost({ storyACcounts: [50], specSourceChars: 0, model: 'claude-sonnet-4-6' });
check('0-AC story is very cheap (not the 24K ceiling)', tiny.expected_usd < 0.02);
check('high-AC story costs more than a tiny one (scales with ACs)', huge.expected_usd > tiny.expected_usd);

// Batch pricing is applied (projection must be HALF of a sync-priced equivalent shape).
const projBatch = projectTestCaseCost({ storyACcounts: [10, 10], specSourceChars: 20000 });
check('projection uses batch rates (sanity: a 2-story run is a few cents to <$1, not dollars)', projBatch.expected_usd < 1.5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
