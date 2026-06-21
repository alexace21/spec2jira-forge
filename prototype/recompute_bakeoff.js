#!/usr/bin/env node
/**
 * Offline proof (no API): re-score the bake-off's saved cases with the FIXED coverage
 * strip (normAC now strips model-added "AC1:" labels + backslash artifacts). Shows the
 * OLD coverage_pct (computed at run time, buggy strip) vs the FIXED coverage_pct.
 *   node prototype/recompute_bakeoff.js
 */
import { computeCoverage } from '../src/testcases.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const out = JSON.parse(readFileSync(join(HERE, '..', 'bakeoff_out.json'), 'utf8'));
const db = JSON.parse(readFileSync(join(HERE, 'bakeoff_stories.json'), 'utf8'));

const liveByName = {};
for (const p of (db.pages || [])) for (const s of (p.stories || [])) liveByName[s.name] = s;

const bands = {};
console.log('Story-by-story (OLD coverage_pct → FIXED, per run):\n');
for (const entry of out) {
  const sd = entry.storyData;
  const live = liveByName[sd.storyName];
  if (!live) { console.log(`(no live story for "${sd.storyName}")`); continue; }
  console.log(`■ ${sd.storyName} [${sd.acCount} ACs · ${sd.acBand}]`);
  for (const strat of ['S1', 'S1b', 'S2']) {
    const runs = sd.stratResults?.[strat] || [];
    const pairs = [];
    for (const r of runs) {
      if (!r || !r.raw) continue;
      const oldCov = r.coverage?.coverage_pct ?? null;
      const fixed = computeCoverage(live, r.raw);
      pairs.push(`${oldCov}%→${fixed.coverage_pct}%${fixed.uncovered_acs.length ? `(${fixed.uncovered_acs.length}genuine)` : ''}`);
      const b = (bands[sd.acBand] = bands[sd.acBand] || {});
      const a = (b[strat] = b[strat] || { oldSum: 0, newSum: 0, n: 0 });
      if (oldCov != null) a.oldSum += oldCov;
      if (fixed.coverage_pct != null) a.newSum += fixed.coverage_pct;
      a.n++;
    }
    if (pairs.length) console.log(`   ${strat.padEnd(3)} ${pairs.join('   ')}`);
  }
  console.log('');
}

console.log('─'.repeat(60));
console.log('AVERAGES by band  (OLD → FIXED coverage):');
for (const band of Object.keys(bands).sort()) {
  for (const strat of ['S1', 'S1b', 'S2']) {
    const a = bands[band]?.[strat];
    if (!a || !a.n) continue;
    const oldAvg = (a.oldSum / a.n).toFixed(1);
    const newAvg = (a.newSum / a.n).toFixed(1);
    console.log(`  ${band.padEnd(4)} ${strat.padEnd(3)}  ${String(oldAvg + '%').padStart(6)} → ${String(newAvg + '%').padStart(6)}   (n=${a.n})`);
  }
}
