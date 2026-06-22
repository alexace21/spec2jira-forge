#!/usr/bin/env node
/**
 * Cross-platform offline test runner (Phase-0 CI plumbing — see docs/MONITORING-CICD-STRATEGY.md §8).
 *
 * Why a Node runner and not `node --test` or a Bash loop:
 *  - The prototype/test_*.{js,mjs} suites SELF-RUN at import and call process.exit(0/1). `node --test`
 *    would double-run them and the self-exit would abort the runner mid-suite. So we spawn each suite
 *    in its own child `node` process and read its exit code.
 *  - The dev box is Windows, CI is Linux — a Bash loop is not portable. Node is.
 *
 * What it runs: every prototype/test_*.{js,mjs}, EXCLUDING live-network harnesses:
 *  - test_prototype.js makes REAL Anthropic API calls (needs ANTHROPIC_API_KEY) → never in CI.
 *  - any *_live.{js,mjs} (convention) is likewise excluded.
 * (The other live harnesses — analyze_live.js, distill_revalidate.js, etc. — do not match test_* so
 *  they are already outside this glob.)
 *
 * Collects ALL results (does not abort on first failure) and exits non-zero if any suite failed.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const protoDir = join(root, 'prototype');

const EXCLUDE = new Set(['test_prototype.js']); // live Anthropic harness — must never run in CI
// Convention: name any live/network harness test_<name>_live.{js,mjs} so it is auto-excluded.
// (case-INsensitive — catches _live/_LIVE; the hard EXCLUDE set above is the guard for the current live harness.)

const files = readdirSync(protoDir)
  .filter((f) => /^test_.*\.(js|mjs)$/.test(f))
  .filter((f) => !EXCLUDE.has(f) && !/_live\.(js|mjs)$/i.test(f))
  .sort();

if (files.length === 0) {
  console.error('run-tests: no offline test_*.{js,mjs} suites found in prototype/ — wiring is broken.');
  process.exit(1);
}

let failed = 0;
const failedNames = [];
for (const f of files) {
  process.stdout.write(`\n=== ${f} ===\n`);
  // 120s per-suite timeout: a hung suite (e.g. a future test that awaits with no key) would otherwise
  // block CI up to GitHub's 360-min job default. A killed child yields status:null + a signal → counted
  // as failed below (the ci.yml job also sets timeout-minutes as a defence-in-depth backstop).
  const r = spawnSync(process.execPath, [join(protoDir, f)], { stdio: 'inherit', timeout: 120000 });
  if (r.status !== 0) {
    failed++;
    failedNames.push(r.signal ? `${f} (killed: ${r.signal})` : `${f} (exit ${r.status})`);
  }
}

console.log(`\n──────────────────────────────────────────`);
console.log(`offline suites: ${files.length - failed}/${files.length} passed`);
if (failed > 0) {
  console.error(`FAILED: ${failedNames.join(', ')}`);
  process.exit(1);
}
process.exit(0);
