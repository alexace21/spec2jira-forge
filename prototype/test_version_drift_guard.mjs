#!/usr/bin/env node
/**
 * Offline tests for tools/version-drift-guard.mjs (the §11 version-lockstep backstop).
 *
 * The HEADLINE cases (#3/#4) are the post-ship-army regression (2026-06-22): a stale
 * `DIAG_APP_VERSION = '...'` in a COMMENT before the real export must NOT be matched-first and silently
 * pass a real drift. With the OLD unanchored `/DIAG_APP_VERSION\s*=\s*['"]…['"]/` (first match), #3 fails
 * (silent-miss) and #4 fails (false-positive); the anchored statement-only regex passes both.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractDiagVersion, driftError } from '../tools/version-drift-guard.mjs';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name}`); }
}

const EXPORT = (v) => `export const DIAG_APP_VERSION = '${v}';`;

// 1. clean lockstep → null
check('lockstep → null', driftError('6.1.0', EXPORT('6.1.0')) === null);

// 2. real drift → message
check('real drift → VERSION DRIFT', /VERSION DRIFT/.test(driftError('6.1.0', EXPORT('9.9.9')) || ''));

// 3. ⭐ stale comment BEFORE export; pkg matches the COMMENT but not the active export →
//    must catch the real 9.9.9 drift, NOT silently pass on the comment's 6.1.0 (the §11 hole).
const staleMasksDrift = `// old: export const DIAG_APP_VERSION = '6.1.0'\n${EXPORT('9.9.9')}`;
check('stale comment does NOT mask a real drift', /VERSION DRIFT/.test(driftError('6.1.0', staleMasksDrift) || ''));

// 4. ⭐ stale comment BEFORE export; active export correct → reads the EXPORT, null (no false-positive).
const staleButOk = `// historic DIAG_APP_VERSION = '3.0.0'\n${EXPORT('6.1.0')}`;
check('stale comment → reads the active export (no false drift)', driftError('6.1.0', staleButOk) === null);
check('stale comment → extracts the active version', extractDiagVersion(staleButOk) === '6.1.0');

// 5. mismatched quotes on the active line → not a valid statement → fail-loud
check('mismatched quotes → not found', /could not find/.test(driftError('6.1.0', `export const DIAG_APP_VERSION = "6.1.0';`) || ''));

// 6. renamed declaration → fail-loud
check('renamed declaration → not found', /could not find/.test(driftError('6.1.0', `export const DIAG_VERSION = '6.1.0';`) || ''));

// 7. CRLF line endings tolerated
check('CRLF tolerated', driftError('6.1.0', `${EXPORT('6.1.0')}\r\n`) === null);
check('CRLF extract', extractDiagVersion(`${EXPORT('6.1.0')}\r\n`) === '6.1.0');

// 8. indented export still matches
check('indented export matches', extractDiagVersion(`  ${EXPORT('6.1.0')}`) === '6.1.0');

// 9. double quotes match (backreference)
check('double quotes match', extractDiagVersion(`export const DIAG_APP_VERSION = "6.1.0";`) === '6.1.0');

// 10. package.json with no version → fail-loud
check('no pkg version → message', /no string "version"/.test(driftError(undefined, EXPORT('6.1.0')) || ''));

// 11. real artifacts: the actual repo files must be in lockstep (proves the regex matches the real form).
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const realPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const realDiag = readFileSync(join(root, 'src', 'diagnostics.js'), 'utf8');
check('real src/diagnostics.js export is extracted', extractDiagVersion(realDiag) === realPkg);
check('real repo files are in lockstep', driftError(realPkg, realDiag) === null);

console.log(`\nversion-drift-guard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
