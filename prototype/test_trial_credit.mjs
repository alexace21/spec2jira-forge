#!/usr/bin/env node
/**
 * Offline test for the $5 managed trial-credit ledger math (src/trialCredit.js).
 *
 * The KVS read/write (creditStatus/chargeSpend) is thin orchestration and not node-testable, so this
 * exercises the PURE gate computation (computeCreditStatus) + the reservation-convergence invariant
 * (a finalized managed run's ledger equals the ACTUAL, regardless of the submit estimate) by simulating
 * chargeSpend's `spent = max(0, spent + delta)` arithmetic locally.
 *
 * The make-or-break invariants (a wrong one leaks OUR money or dead-ends a trial user):
 *   - available = max(0, grant − spent); exhausted when spent ≥ grant; overCeiling when spent ≥ ceiling.
 *   - a KVS read glitch (readOk:false) ⇒ exhausted AND overCeiling true (SAFE polarity: never grant free spend).
 *   - RESERVATION CONVERGENCE: after hold(estimate) then reconcile(actual − estimate), spent === actual —
 *     for BOTH an over-estimate (refund) and an under-estimate (top-up), and on a hold GLITCH (estimate 0).
 *   - the hard ceiling bounds worst-case spend regardless of the grant.
 *
 * Usage: node prototype/test_trial_credit.mjs
 */
import { computeCreditStatus, managedRunBlocker, TRIAL_GRANT_USD, TRIAL_HARD_CEILING_USD } from '../src/trialCredit.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`  XX  ${name}`); }
}
const approx = (a, b) => Math.abs(a - b) < 1e-9;

console.log('trial-credit ledger math:');

// The module defaults (env unset in a plain node run).
check('default grant is $5', TRIAL_GRANT_USD === 5);
check('default hard ceiling is $10 (2× grant)', TRIAL_HARD_CEILING_USD === 10);

// 1. fresh install — full credit available, not exhausted, not over ceiling
const fresh = computeCreditStatus(0);
check('fresh: availableUsd === grant', approx(fresh.availableUsd, 5));
check('fresh: not exhausted', fresh.exhausted === false);
check('fresh: not overCeiling', fresh.overCeiling === false);

// 2. partial spend — proportional available, still usable
const partial = computeCreditStatus(1.8);
check('partial: availableUsd === grant − spent', approx(partial.availableUsd, 3.2));
check('partial: not exhausted while spent < grant', partial.exhausted === false);

// 3. exactly at grant — exhausted (>= boundary), available clamped to 0
const atGrant = computeCreditStatus(5);
check('at grant: exhausted (>= boundary)', atGrant.exhausted === true);
check('at grant: availableUsd clamped to 0', approx(atGrant.availableUsd, 0));

// 4. overshoot past grant but below ceiling — exhausted but NOT over the hard ceiling
const overshoot = computeCreditStatus(6.5);
check('overshoot: exhausted', overshoot.exhausted === true);
check('overshoot: availableUsd stays 0 (clamped, never negative)', approx(overshoot.availableUsd, 0));
check('overshoot below ceiling: NOT overCeiling', overshoot.overCeiling === false);

// 5. at/above the hard ceiling — overCeiling (the absolute backstop)
check('at ceiling ($10): overCeiling', computeCreditStatus(10).overCeiling === true);
check('above ceiling ($12): overCeiling', computeCreditStatus(12).overCeiling === true);

// 6. read glitch (readOk:false) ⇒ exhausted AND overCeiling regardless of spent (SAFE money polarity)
const glitch = computeCreditStatus(0, false);
check('glitch: exhausted true even with 0 spent (never grant free spend on a glitch)', glitch.exhausted === true);
check('glitch: overCeiling true (decision refuses managed)', glitch.overCeiling === true);
check('glitch: readOk false surfaced', glitch.readOk === false);
// ⭐ 2026-07-12 money-safety: availableUsd is 0 on a glitch (NOT the full grant) so the pre-flight stopper,
// which gates on availableUsd, blocks a managed run on a read glitch (regressed once — the audit caught it).
check('glitch: availableUsd === 0 (SAFE — never report the full grant when the read failed)', approx(glitch.availableUsd, 0));

// 7. malformed spent (NaN / negative) treated as 0 — never fabricate a debit
check('NaN spent ⇒ treated as 0 spent', approx(computeCreditStatus(NaN).spentUsd, 0));
check('negative spent ⇒ treated as 0 spent', approx(computeCreditStatus(-3).spentUsd, 0));

// 8. custom grant/ceiling (env-tunable) honoured
const small = computeCreditStatus(0.5, true, 1, 2);
check('custom grant: available === 0.5', approx(small.availableUsd, 0.5));
check('custom grant: not exhausted below $1', small.exhausted === false);
check('custom grant: $1 spent ⇒ exhausted', computeCreditStatus(1, true, 1, 2).exhausted === true);

// 9. RESERVATION CONVERGENCE — simulate chargeSpend's `spent = max(0, spent + delta)`.
// A finalized managed run must leave the ledger at the ACTUAL cost, regardless of the submit estimate.
function simulateRun(startSpent, estimate, actual, holdGlitched = false) {
  let spent = startSpent;
  // SUBMIT hold: holdManagedCredit charges the estimate and returns what it actually charged
  // (0 if the charge glitched → the reconcile then charges the full actual). We stamp that as creditEstimateUsd.
  const stampedEstimate = holdGlitched ? 0 : estimate;
  spent = Math.max(0, spent + (holdGlitched ? 0 : estimate));
  // FINALIZE reconcile: chargeSpend(actual − stampedEstimate)
  spent = Math.max(0, spent + (actual - stampedEstimate));
  return spent;
}
check('convergence: over-estimate refunds to actual ($0.24 est, $0.10 actual)', approx(simulateRun(0, 0.24, 0.10), 0.10));
check('convergence: under-estimate tops up to actual ($0.10 est, $0.24 actual)', approx(simulateRun(0, 0.10, 0.24), 0.24));
check('convergence: exact estimate stays at actual', approx(simulateRun(0, 0.15, 0.15), 0.15));
check('convergence: hold GLITCH (estimate stamped 0) still lands at actual', approx(simulateRun(0, 0.24, 0.24, true), 0.24));
check('convergence: accumulates across runs ($1 already spent + a $0.20 run = $1.20)', approx(simulateRun(1.0, 0.24, 0.20), 1.20));

// 10. idempotency intent — a reconcile that already ran must NOT re-charge. Modeled: the marker guard
// means the SECOND finalize contributes 0 delta. Assert the single-charge total is unaffected by a replay.
function finalizeOnce(spent, estimate, actual, alreadyReconciled) {
  if (alreadyReconciled) return spent; // marker present ⇒ no-op
  return Math.max(0, spent + (actual - estimate));
}
let s = Math.max(0, 0 + 0.24);            // submit hold
s = finalizeOnce(s, 0.24, 0.30, false);   // first finalize
const afterFirst = s;
s = finalizeOnce(s, 0.24, 0.30, true);    // replay (marker present) → no-op
check('idempotency: replay finalize does not re-charge', approx(s, afterFirst) && approx(s, 0.30));

// ── 11. managedRunBlocker — the PRE-FLIGHT STOPPER (2026-07-12) ───────────────────────────────────
// Closes the overrun a partner caught in live testing: a managed run admitted with only $0.01 left then
// spent a full ~$0.24 PAST the grant, because admission only checked `exhausted`. Now every managed surface
// blocks BEFORE spending when this run's estimate won't fit the remaining credit. BYOK is never gated.
console.log('\nmanagedRunBlocker (pre-flight stopper):');
check('blocker: BYOK keySource → null (unlimited, never gated)', managedRunBlocker({ keySource: 'byok', availableUsd: 0, estimateUsd: 0.24 }) === null);
check('blocker: managed, est $0.10 ≤ avail $0.30 → null (proceed)', managedRunBlocker({ keySource: 'managed', availableUsd: 0.30, spentUsd: 0.20, estimateUsd: 0.10 }) === null);
// ⭐ THE PARTNER'S CASE — $0.01 left, a $0.24 breakdown → BLOCK (was admitted → overran the grant)
const b1 = managedRunBlocker({ keySource: 'managed', availableUsd: 0.01, spentUsd: 0.49, estimateUsd: 0.24 });
check('blocker: $0.01 left + $0.24 breakdown → BLOCK (the overrun fix)', !!b1 && b1.reason === 'insufficient');
check('blocker: reports the honest numbers (est 0.24 / avail 0.01)', !!b1 && approx(b1.estimateUsd, 0.24) && approx(b1.availableUsd, 0.01));
check('blocker: est EXACTLY === avail → null (spend up to the grant, no overrun)', managedRunBlocker({ keySource: 'managed', availableUsd: 0.24, spentUsd: 0.26, estimateUsd: 0.24 }) === null);
const bex = managedRunBlocker({ keySource: 'managed', availableUsd: 0, spentUsd: 5, estimateUsd: 0.10 });
check('blocker: exhausted (avail 0) → block (subsumes the old exhausted gate)', !!bex && bex.reason === 'insufficient');
const bnan = managedRunBlocker({ keySource: 'managed', availableUsd: NaN, estimateUsd: 0.10 });
check('blocker: NaN available → SAFE polarity (treated as 0 → block)', !!bnan && bnan.reason === 'insufficient');
const babsent = managedRunBlocker({ keySource: 'managed', estimateUsd: 0.10 });
check('blocker: absent available → block (never grant free spend on a bad snapshot)', !!babsent && babsent.reason === 'insufficient');
// hard-ceiling stopper — estimate fits available but the WORST case (upper) breaches the ceiling (test-gen path)
const b2 = managedRunBlocker({ keySource: 'managed', availableUsd: 5, spentUsd: 9.5, estimateUsd: 0.4, upperUsd: 2, hardCeilingUsd: 10 });
check('blocker: est fits avail but spent+upper > ceiling → ceiling block', !!b2 && b2.reason === 'ceiling');
check('blocker: ceiling block reports headroom (upper 2 / ceiling−spent 0.5)', !!b2 && approx(b2.estimateUsd, 2) && approx(b2.availableUsd, 0.5));
check('blocker: no upper → worst defaults to estimate (spent+est ≤ ceiling → proceed)', managedRunBlocker({ keySource: 'managed', availableUsd: 5, spentUsd: 3, estimateUsd: 0.24, hardCeilingUsd: 10 }) === null);
// ⭐ INTEGRATION — a KVS read glitch must BLOCK a managed run (the audit-caught leak): creditStatus's
// availableUsd is 0 on a glitch → the blocker sees est > 0 → block, matching the old exhausted/overCeiling gate.
const glitchCs = computeCreditStatus(0, false);
const bglitch = managedRunBlocker({ keySource: 'managed', availableUsd: glitchCs.availableUsd, spentUsd: glitchCs.spentUsd, estimateUsd: 0.1 });
check('blocker: read glitch (available 0) → BLOCK managed spend (money-safety regression guard)', !!bglitch && bglitch.reason === 'insufficient');
// non-finite / non-positive ESTIMATE → BLOCK too (we cannot price the run — the SAFE polarity must hold for
// estimate, not only available; audit-caught asymmetry where a NaN estimate PROCEEDED ungated).
check('blocker: NaN estimate → BLOCK (cannot price the run → safe polarity)', managedRunBlocker({ keySource: 'managed', availableUsd: 5, estimateUsd: NaN })?.reason === 'insufficient');
check('blocker: 0 estimate → BLOCK (no managed run is legitimately free)', managedRunBlocker({ keySource: 'managed', availableUsd: 5, estimateUsd: 0 })?.reason === 'insufficient');
check('blocker: absent estimate → BLOCK', managedRunBlocker({ keySource: 'managed', availableUsd: 5 })?.reason === 'insufficient');
check('blocker: BYOK + NaN estimate → null (BYOK still never gated)', managedRunBlocker({ keySource: 'byok', availableUsd: 5, estimateUsd: NaN }) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
