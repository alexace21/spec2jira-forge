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
import { isOrphanStale, isDistillSessionStale } from '../src/sweep_util.js';

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

// ── isDistillSessionStale — the distill-session retention sweep (privacy fix 2026-07-25) ──────────
// `distill_session:` records hold up to DISTILL_MAX_INPUT_CHARS of the customer's PASTED TEXT and were
// deleted ONLY by a run that reached its final step, so every abandoned session (closed tab, failed step
// never retried, mid-pipeline credit block) retained customer content INDEFINITELY. The daily sweep now
// enumerates the prefix. A distill session is a minutes-long scratch buffer, so the window is 24h.
const SESSION_MAX_AGE = DAY; // DISTILL_SESSION_MAX_AGE_MS in production
console.log('\n■ isDistillSessionStale — abandoned-session retention');
check('in-flight (2 min old) → KEEP', isDistillSessionStale({ createdAt: now - 2 * 60 * 1000 }, now, SESSION_MAX_AGE) === false, 'a live pipeline must never be swept mid-run');
check('abandoned (2 days old) → SWEEP', isDistillSessionStale({ createdAt: now - 2 * DAY }, now, SESSION_MAX_AGE) === true, 'the leak this closes');
check('exactly at the window → KEEP (> not >=, matching isOrphanStale)', isDistillSessionStale({ createdAt: now - SESSION_MAX_AGE }, now, SESSION_MAX_AGE) === false, 'boundary keep');
check('1 ms past the window → SWEEP', isDistillSessionStale({ createdAt: now - SESSION_MAX_AGE - 1 }, now, SESSION_MAX_AGE) === true, 'boundary sweep');
check('a session carrying sections/input is judged on age alone', isDistillSessionStale({ createdAt: now - 3 * DAY, input: 'customer text', sections: { domain: { text: 'x' } } }, now, SESSION_MAX_AGE) === true, 'partial progress does not exempt content from retention');

console.log('\n■ isDistillSessionStale — ⭐ the polarity is DELIBERATELY INVERTED vs isOrphanStale');
// A jobmeta with no usable timestamp is KEPT (a breakdown is the user's deliverable). A distill session
// is transient customer CONTENT, so an unreadable record — the kind that would otherwise sit in storage
// forever — is swept. Asserting both directions keeps a future "consistency" refactor from silently
// re-opening the retention hole.
check('no createdAt → SWEEP (content, not a deliverable)', isDistillSessionStale({ input: 'x', sections: {} }, now, SESSION_MAX_AGE) === true, 'delete when in doubt');
check('unparseable createdAt → SWEEP', isDistillSessionStale({ createdAt: 'not-a-date' }, now, SESSION_MAX_AGE) === true, 'delete when in doubt');
check('NaN createdAt → SWEEP', isDistillSessionStale({ createdAt: NaN }, now, SESSION_MAX_AGE) === true, 'delete when in doubt');
check('null session value → SWEEP', isDistillSessionStale(null, now, SESSION_MAX_AGE) === true, 'delete when in doubt');
check('non-object session value → SWEEP', isDistillSessionStale('nope', now, SESSION_MAX_AGE) === true, 'delete when in doubt');
check('the SAME shapes are KEPT by isOrphanStale (polarities stay opposite on purpose)', isOrphanStale({ input: 'x' }, now, INACT) === false && isOrphanStale(null, now, INACT) === false, 'jobmeta stays fail-safe-keep');
check('ISO-string createdAt is still parsed (defensive)', isDistillSessionStale({ createdAt: iso(now - 2 * DAY) }, now, SESSION_MAX_AGE) === true, 'parsed');

console.log('\n' + '='.repeat(64));
if (failures === 0) console.log('✅ ALL PASS');
else { console.log(`❌ ${failures} FAILED`); process.exit(1); }
