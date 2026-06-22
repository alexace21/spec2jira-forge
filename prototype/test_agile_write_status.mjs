// Offline unit tests for classifyAgileWriteStatus — the pure 207/HTTP-status→outcome decision extracted
// from src/push_handler.js (the recurring 207-partial bug area, 5fef67e/d8c86a6; strategy §5.1). Pure
// function → runs under plain node (importing push_handler.js loads @forge/api but never calls it).
import { classifyAgileWriteStatus } from '../src/push_handler.js';

let failures = 0;
function check(name, cond) { if (cond) { console.log(`  ok  ${name}`); } else { console.error(`  FAIL ${name}`); failures++; } }
function eq(name, got, exp) { check(`${name} → ${JSON.stringify(got)}`, JSON.stringify(got) === JSON.stringify(exp)); }

console.log('=== classifyAgileWriteStatus ===');

// Full success — 200 / 204
eq('200 → success(full)', classifyAgileWriteStatus(200, 5), { outcome: 'success', count: 5, partial: false, failedCount: 0 });
eq('204 → success(full)', classifyAgileWriteStatus(204, 5), { outcome: 'success', count: 5, partial: false, failedCount: 0 });

// 207 ALWAYS partial — known body (failedCount parsed from entries)
eq('207 w/ 2 failures → partial, count=total−failed', classifyAgileWriteStatus(207, 5, { failedCount: 2 }), { outcome: 'partial', count: 3, partial: true, failedCount: 2 });

// 207 ALWAYS partial — UNKNOWN body (failedCount 0): THE load-bearing §11 invariant (never a clean full success)
eq('207 unknown body (0 failures) → STILL partial, count=total', classifyAgileWriteStatus(207, 5), { outcome: 'partial', count: 5, partial: true, failedCount: 0 });
check('207 is partial even when failedCount===0 (§11 invariant — the 5fef67e/d8c86a6 fix)',
  classifyAgileWriteStatus(207, 5).partial === true && classifyAgileWriteStatus(207, 5).outcome === 'partial');

// 207 with more failures than total → count clamps to 0 (never negative)
eq('207 failedCount>total → count clamps 0', classifyAgileWriteStatus(207, 2, { failedCount: 5 }), { outcome: 'partial', count: 0, partial: true, failedCount: 5 });

// sprint-move path: any 2xx via okFlag = success; but 207 STILL wins (checked before okFlag)
eq('201 + okFlag → success (sprint-move any-2xx)', classifyAgileWriteStatus(201, 4, { okFlag: true }), { outcome: 'success', count: 4, partial: false, failedCount: 0 });
eq('207 + okFlag → STILL partial (207 before okFlag)', classifyAgileWriteStatus(207, 4, { okFlag: true }), { outcome: 'partial', count: 4, partial: true, failedCount: 0 });

// rank path: NO okFlag → a non-200/204 2xx is NOT success → 'other'
eq('201 WITHOUT okFlag → other (rank: only 200/204 succeed)', classifyAgileWriteStatus(201, 4), { outcome: 'other' });

// error statuses → 'other' (caller owns the 403 / generic-HTTP branch, which needs the body)
eq('403 → other', classifyAgileWriteStatus(403, 4), { outcome: 'other' });
eq('500 → other', classifyAgileWriteStatus(500, 4), { outcome: 'other' });
eq('400 → other', classifyAgileWriteStatus(400, 4), { outcome: 'other' });

// defensive coercions
eq('non-finite total → 0', classifyAgileWriteStatus(200, undefined), { outcome: 'success', count: 0, partial: false, failedCount: 0 });
eq('negative failedCount coerced to 0', classifyAgileWriteStatus(207, 5, { failedCount: -3 }), { outcome: 'partial', count: 5, partial: true, failedCount: 0 });

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: classifyAgileWriteStatus — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
