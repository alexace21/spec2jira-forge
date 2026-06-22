#!/usr/bin/env node
/**
 * Version-lockstep guard (Phase-2 piece 1 — docs/MONITORING-CICD-STRATEGY.md §8).
 *
 * ASSERTS that the app's TWO in-repo version strings stay equal and FAILS the merge (non-zero) on drift:
 *   - root `package.json` "version"
 *   - `src/diagnostics.js` `DIAG_APP_VERSION`
 * Kills the silent-drift class that bit once (commit 67a6ea1: DIAG_APP_VERSION stale at 3.0.0 while
 * package.json was 6.x). An ASSERT, NOT an auto-sync — the partner consciously bumps BOTH at a release,
 * and that conscious bump is where the partner-chosen Marketplace number enters. (Chosen over release-please
 * by a 5/5 persona vote: strictly stronger at the §11 goal — catches drift from ANY source — at ~5% of the
 * surface, zero deps/secrets/rituals.)
 *
 * §11 robustness (post-ship army, 2026-06-22): the version is read ONLY from a real `export const
 * DIAG_APP_VERSION = '<x>'` STATEMENT. The capture is anchored to line-start (m flag + `[ \t]*` indent only,
 * never a newline) so a stale `// DIAG_APP_VERSION = '3.0.0'` COMMENT — or a string literal — BEFORE the real
 * export can no longer be matched-first and SILENTLY pass a real drift (the exact §11 hole the army caught;
 * the per-change gate only ever tested the no-comment happy path). The (['"])…\1 backreference also rejects a
 * mismatched-quote line. Regression-tested in prototype/test_version_drift_guard.mjs.
 *
 * ⚠ The repo version is in-product support-trace BOOKKEEPING ONLY — it does NOT equal the LIVE Marketplace
 * version (forge-auto-assigned by `forge deploy -e production`; absent from manifest.yml). A green check proves
 * the two REPO strings match, NOT that they match the deployed Marketplace number — keep them aligned to the
 * intended number AT deploy (see the CLAUDE.md production-rollout note).
 *
 * Does NOT touch static/hello-world/package.json (the CRA UI-bundle version 0.1.x — independent of the
 * app/support label, intentionally NOT synced). Auth-free, zero-dep, CRLF/LF-tolerant, line-agnostic.
 * The pure extract/compare are exported for the test; main() runs only when invoked directly. Mirrors the
 * check-syntax.mjs / scope-diff-guard.mjs idiom; run from `npm run check`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// Anchored to a real `export const DIAG_APP_VERSION = '<x>'` STATEMENT: ^ (m flag) is line-start, `[ \t]*`
// consumes only indentation (never a newline), so a `//`-commented or string-embedded occurrence — which is
// NOT a statement at line-start — is skipped. Backreference \1 enforces matching quote types. CRLF-safe (the
// \r belongs to the PRIOR line's end, not this line's start).
const DIAG_RE = /^[ \t]*export[ \t]+const[ \t]+DIAG_APP_VERSION\s*=\s*(['"])([^'"]+)\1/m;

/** Pure: the active DIAG_APP_VERSION from src/diagnostics.js source, or null when no real export statement. */
export function extractDiagVersion(diagSource) {
  const m = String(diagSource).match(DIAG_RE);
  return m ? m[2] : null;
}

/** Pure: null when the two versions are in lockstep, else a human error message. No IO → unit-testable. */
export function driftError(pkgVersion, diagSource) {
  if (!pkgVersion || typeof pkgVersion !== 'string') {
    return 'package.json has no string "version".';
  }
  const diagVersion = extractDiagVersion(diagSource);
  if (!diagVersion) {
    // Missing/renamed/reformatted declaration → FAIL LOUD (not a silent skip).
    return 'could not find an `export const DIAG_APP_VERSION = "<x>"` statement in src/diagnostics.js (declaration renamed/reformatted?).';
  }
  if (pkgVersion !== diagVersion) {
    return `VERSION DRIFT — package.json "${pkgVersion}" !== src/diagnostics.js DIAG_APP_VERSION "${diagVersion}". ` +
      'Bump BOTH to the same number (the version you intend the next prod deploy to stamp).';
  }
  return null;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');

  let pkgVersion;
  try {
    pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version; // JSON.parse, never regex, for JSON
  } catch (e) {
    console.error(`version-drift-guard: could not read package.json (${String(e?.message || e)})`);
    process.exit(1);
  }

  let diagSource;
  try {
    diagSource = readFileSync(join(root, 'src', 'diagnostics.js'), 'utf8');
  } catch (e) {
    console.error(`version-drift-guard: could not read src/diagnostics.js (${String(e?.message || e)})`);
    process.exit(1);
  }

  const err = driftError(pkgVersion, diagSource);
  if (err) {
    console.error(`version-drift-guard: ${err}`);
    process.exit(1);
  }

  console.log(`version-drift-guard: package.json + DIAG_APP_VERSION both at ${pkgVersion} — OK (lockstep).`);
  process.exit(0);
}

// Run only when invoked directly (not when imported by the test) — compare resolved absolute paths.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
