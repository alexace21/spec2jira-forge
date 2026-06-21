#!/usr/bin/env node
/**
 * Offline test for isOrphanStale (src/sweep_util.js) — Task #13 never-pushed-orphan sweep.
 *
 * The make-or-break decision: the daily scheduled sweep deletes a job ONLY when its lean
 * jobmeta is past the inactivity window. The fail-safe side is the load-bearing one — an
 * actively-used or unknown-age job must NEVER be swept (a wrong delete = silent loss of the
 * user's deliverable). Pure function → runs under plain node.
 *
 * Usage: node prototype/test_orphan_sweep.js
 */
import { isOrphanStale } from '../src/sweep_util.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}  — ${detail}`); failures++; }
}

const DAY = 24 * 60 * 60 * 1000;
const INACT = 7 * DAY; // the production window (7 calendar days)
const now = 1_700_000_000_000; // fixed epoch
const iso = (ms) => new Date(ms).toISOString();

console.log('Task #13 isOrphanStale — inactivity-based sweep decision\n' + '='.repeat(64));

console.log('\n■ lastAccessedAt (ms number) — the renewed timer');
check('fresh (1 day ago) → KEEP', isOrphanStale({ lastAccessedAt: now - DAY }, now, INACT) === false, 'should keep');
check('stale (8 days ago) → SWEEP', isOrphanStale({ lastAccessedAt: now - 8 * DAY }, now, INACT) === true, 'should sweep');
check('exactly at the window → KEEP (> not >=)', isOrphanStale({ lastAccessedAt: now - INACT }, now, INACT) === false, 'boundary keep');
check('1 ms past the window → SWEEP', isOrphanStale({ lastAccessedAt: now - INACT - 1 }, now, INACT) === true, 'boundary sweep');

console.log('\n■ startedAt (ISO string) fallback — pre-Task-#13 metas with no lastAccessedAt');
check('no lastAccessedAt, fresh startedAt → KEEP', isOrphanStale({ startedAt: iso(now - DAY) }, now, INACT) === false, 'keep');
check('no lastAccessedAt, stale startedAt → SWEEP', isOrphanStale({ startedAt: iso(now - 8 * DAY) }, now, INACT) === true, 'sweep');

console.log('\n■ lastAccessedAt PREFERRED over startedAt');
check('fresh lastAccessedAt beats stale startedAt → KEEP', isOrphanStale({ lastAccessedAt: now - DAY, startedAt: iso(now - 30 * DAY) }, now, INACT) === false, 'renewed timer wins');
check('stale lastAccessedAt despite fresh startedAt → SWEEP', isOrphanStale({ lastAccessedAt: now - 8 * DAY, startedAt: iso(now - DAY) }, now, INACT) === true, 'renewed timer wins');

console.log('\n■ FAIL-SAFE — never sweep on missing/garbage data');
check('no timestamps at all → KEEP', isOrphanStale({ status: 'completed', pageTitle: 'x' }, now, INACT) === false, 'fail-safe keep');
check('null meta → KEEP', isOrphanStale(null, now, INACT) === false, 'fail-safe keep');
check('non-object meta → KEEP', isOrphanStale('nope', now, INACT) === false, 'fail-safe keep');
check('unparseable startedAt → KEEP', isOrphanStale({ startedAt: 'not-a-date' }, now, INACT) === false, 'fail-safe keep');
check('NaN lastAccessedAt → falls back / KEEP', isOrphanStale({ lastAccessedAt: NaN }, now, INACT) === false, 'fail-safe keep');

console.log('\n■ defensive — ISO-string lastAccessedAt is still parsed');
check('ISO-string lastAccessedAt, stale → SWEEP', isOrphanStale({ lastAccessedAt: iso(now - 8 * DAY) }, now, INACT) === true, 'parsed');

console.log('\n' + '='.repeat(64));
if (failures === 0) console.log('✅ ALL PASS');
else { console.log(`❌ ${failures} FAILED`); process.exit(1); }
