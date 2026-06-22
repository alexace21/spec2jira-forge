#!/usr/bin/env node
/**
 * Version-lockstep guard (Phase-2 piece 1 — docs/MONITORING-CICD-STRATEGY.md §8).
 *
 * ASSERTS that the app's TWO in-repo version strings stay equal and FAILS the merge (non-zero) on drift:
 *   - root `package.json` "version"
 *   - `src/diagnostics.js` `DIAG_APP_VERSION`
 * This kills the silent-drift class that bit once (commit 67a6ea1: DIAG_APP_VERSION stale at 3.0.0 while
 * package.json was 6.x). It is an ASSERT, NOT an auto-sync — the partner consciously bumps BOTH at a release,
 * and that conscious bump is where the partner-chosen Marketplace number enters. (Chosen over release-please
 * by a 5/5 persona vote: strictly stronger at the §11 goal — catches drift from ANY source, incl. a silently
 * skipped updater — at ~5% of the surface, zero deps/secrets/rituals.)
 *
 * ⚠ The repo version is in-product support-trace BOOKKEEPING ONLY — it does NOT equal the LIVE Marketplace
 * version (forge-auto-assigned by `forge deploy -e production`; absent from manifest.yml). A green check proves
 * the two REPO strings match, NOT that they match the deployed Marketplace number — keep them aligned to the
 * intended number AT deploy (see the CLAUDE.md production-rollout note).
 *
 * Does NOT touch static/hello-world/package.json (the CRA UI-bundle version 0.1.x — independent of the
 * app/support label, intentionally NOT synced). Auth-free, zero-dep, CRLF/LF-tolerant, line-agnostic (no
 * line-number anchoring). Mirrors the check-syntax.mjs / scope-diff-guard.mjs idiom; run from `npm run check`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

// Tolerant + line-AGNOSTIC capture (CRLF/LF-safe — matches on content, no line/whitespace anchor).
const m = diagSource.match(/DIAG_APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
const diagVersion = m ? m[1] : null;

if (!pkgVersion || typeof pkgVersion !== 'string') {
  console.error('version-drift-guard: package.json has no string "version".');
  process.exit(1);
}
if (!diagVersion) {
  // Missing/renamed/reformatted declaration → FAIL LOUD (not a silent skip).
  console.error('version-drift-guard: could not find DIAG_APP_VERSION in src/diagnostics.js (declaration renamed/reformatted?).');
  process.exit(1);
}

if (pkgVersion !== diagVersion) {
  console.error(
    `version-drift-guard: VERSION DRIFT — package.json "${pkgVersion}" !== src/diagnostics.js DIAG_APP_VERSION "${diagVersion}". ` +
      'Bump BOTH to the same number (the version you intend the next prod deploy to stamp).',
  );
  process.exit(1);
}

console.log(`version-drift-guard: package.json + DIAG_APP_VERSION both at ${pkgVersion} — OK (lockstep).`);
process.exit(0);
