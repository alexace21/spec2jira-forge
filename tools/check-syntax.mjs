#!/usr/bin/env node
/**
 * Per-file ESM syntax gate over src/*.js (Phase-1 CI plumbing — docs/MONITORING-CICD-STRATEGY.md §5.2/§8).
 *
 * ⚠ TWO load-bearing subtleties (both found the hard way):
 *  1. `node --check` validates only ONE file arg, so a glob (`node --check src/*.js`) checks the FIRST file
 *     and silently ignores the rest → we invoke it ONCE PER FILE.
 *  2. src/*.js are ES modules (import/export) but the ROOT package.json has no "type":"module", so
 *     `node --check <file.js>` resolves the COMMONJS goal and SILENTLY SWALLOWS an ESM syntax error
 *     (exit 0 — a FALSE-GREEN wall; verified on Node 24). The fix: feed the source to
 *     `node --check --input-type=module` via STDIN, which forces the ESM goal and actually catches the error.
 *     (`--input-type=module` is REJECTED with a file argument on Node 24, but ALLOWED with STDIN.)
 *     We deliberately do NOT add "type":"module" to the root package.json — that would change what the
 *     Forge bundler sees for a LIVE app and can't be verified offline; the STDIN approach is self-contained.
 *
 * Parse-only (never resolves imports or executes) → needs no node_modules, no network. This is the only
 * automatic touch of the otherwise-untested resolver/IO layer (src/index.js): it catches a parse error that
 * would 500 every resolver, before deploy.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');

const files = readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort();

if (files.length === 0) {
  console.error('check-syntax: no src/*.js files found — wiring is broken.');
  process.exit(1);
}

let failed = 0;
for (const f of files) {
  const code = readFileSync(join(srcDir, f), 'utf8');
  // ESM-goal check via STDIN (see header subtlety #2). stderr passes through so the [stdin]:<line> error shows.
  const r = spawnSync(process.execPath, ['--check', '--input-type=module'], {
    input: code,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (r.status !== 0) {
    failed++;
    console.error(`SYNTAX FAIL: src/${f}`);
  } else {
    process.stdout.write(`ok  src/${f}\n`);
  }
}

console.log(`\nnode --check (ESM): ${files.length - failed}/${files.length} files OK`);
process.exit(failed === 0 ? 0 : 1);
