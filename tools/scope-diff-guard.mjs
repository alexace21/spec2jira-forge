#!/usr/bin/env node
/**
 * Manifest scope/egress diff guard (Phase-1 CI — docs/MONITORING-CICD-STRATEGY.md §3.3).
 *
 * Compares the `permissions:` block of manifest.yml between a base git ref and the working tree.
 * A scope or external.fetch change ⇒ a Forge MAJOR version ⇒ every customer admin must RE-CONSENT
 * in Manage Apps before the new/changed capability works (un-automatable for a licensed app). This
 * guard makes that VISIBLE so a routine PR never SILENTLY becomes a major/re-consent release.
 *
 * LOUD WARNING, non-blocking by default (exit 0) — set SCOPE_GUARD_BLOCK=1 to make it a hard failure.
 * Auth-free + deterministic: parses the `permissions:` block of OUR OWN manifest (structural detection,
 * pure-function-appropriate per POLICY §4); needs no Forge token. Comparison ignores ALL comments
 * (full-line AND inline) + blank lines, so a comment edit never reads as a scope change.
 *
 * ⚠ KNOWN LIMITATION: on a pull_request event the base passed in is github.event.pull_request.base.sha,
 * captured at PR-open; if the base branch later advances with its OWN permissions change, this guard can
 * attribute that change to the PR — a benign false-positive warning (advisory / exit 0; never blocks).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'); // repo root — cwd-independent (like the sibling tools)
const base = process.argv[2];
const EXIT_NONZERO = process.env.SCOPE_GUARD_BLOCK === '1';

/** Extract the top-level `permissions:` block, comparing ONLY capability-bearing lines: comment-only and
 * blank lines are dropped, and a trailing INLINE comment on a scope line is stripped (a scope string never
 * legitimately contains '#'). Order is preserved deliberately — a reorder is rare and the no-false-negative
 * guarantee matters more than reorder-noise (we do NOT flatten to a set; see strategy review policy#1). */
function permissionsBlock(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    if (/^permissions:\s*$/.test(line)) { inBlock = true; out.push('permissions:'); continue; }
    if (inBlock) {
      if (/^\S/.test(line)) break; // a non-indented line = the next top-level key → block ends
      const stripped = line.replace(/\s+#.*$/, '').replace(/\s+$/, ''); // drop trailing inline comment + trailing ws
      const trimmed = stripped.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue; // comment-only / blank line — not capability-bearing
      out.push(stripped);
    }
  }
  return out.join('\n').trim();
}

if (!base || /^0+$/.test(base)) {
  console.log('scope-diff-guard: no usable base ref — skipping (nothing to diff against).');
  process.exit(0);
}

const show = spawnSync('git', ['show', `${base}:manifest.yml`], { encoding: 'utf8', cwd: root });
if (show.status !== 0) {
  console.log(`scope-diff-guard: could not read manifest.yml at ${base} (${(show.stderr || '').trim()}) — skipping.`);
  process.exit(0);
}

let headManifest;
try {
  headManifest = readFileSync(join(root, 'manifest.yml'), 'utf8'); // root-relative, not cwd-relative → safe from any cwd
} catch (e) {
  console.log(`scope-diff-guard: could not read the working manifest.yml (${String(e?.message || e)}) — skipping.`);
  process.exit(0);
}

const basePerms = permissionsBlock(show.stdout);
const headPerms = permissionsBlock(headManifest);

if (basePerms === headPerms) {
  console.log('scope-diff-guard: manifest permissions block unchanged vs base — OK (no re-consent).');
  process.exit(0);
}

const msg =
  'manifest.yml permissions (scopes/egress) CHANGED vs base → this is a Forge MAJOR version. ' +
  'Every customer admin must RE-CONSENT in Manage Apps before the new/changed capability works ' +
  '(un-automatable for a licensed app). Ship release notes + rehearse the install on staging. Review the diff below.';
console.log(`::warning title=Manifest scope/egress change (MAJOR version → customer re-consent)::${msg}`);
console.log('\n=== permissions block (base) ===\n' + basePerms);
console.log('\n=== permissions block (HEAD) ===\n' + headPerms);
process.exit(EXIT_NONZERO ? 1 : 0);
