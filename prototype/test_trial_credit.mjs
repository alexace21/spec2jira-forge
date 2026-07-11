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
import { computeCreditStatus, TRIAL_GRANT_USD, TRIAL_HARD_CEILING_USD } from '../src/trialCredit.js';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
