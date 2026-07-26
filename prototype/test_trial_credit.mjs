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
import {
  computeCreditStatus,
  managedRunBlocker,
  TRIAL_GRANT_USD,
  TRIAL_HARD_CEILING_USD,
  DISTILL_STEP_EST_USD,
  distillRunEstimateUsd,
} from '../src/trialCredit.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`  XX  ${name}`); }
}
const approx = (a, b) => Math.abs(a - b) < 1e-9;

console.log('trial-credit ledger math:');

// The module defaults (env unset in a plain node run).
check('default grant is $5', TRIAL_GRANT_USD === 5);
// ⭐ 2026-07-12 (partner call): the hard ceiling default is now 1.2× the grant (~$6), NOT 2×/$10 — our
// managed exposure per install must never materially exceed the $5 welcome credit.
check('default hard ceiling is $6 (1.2× grant, not 2×)', approx(TRIAL_HARD_CEILING_USD, 6));

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

// 4. overshoot past grant ($5) but below the ceiling ($6) — exhausted but NOT over the hard ceiling
const overshoot = computeCreditStatus(5.5);
check('overshoot: exhausted', overshoot.exhausted === true);
check('overshoot: availableUsd stays 0 (clamped, never negative)', approx(overshoot.availableUsd, 0));
check('overshoot $5.5 (past $5 grant, below $6 ceiling): NOT overCeiling', overshoot.overCeiling === false);

// 5. at/above the hard ceiling ($6) — overCeiling (the absolute backstop)
check('at ceiling ($6): overCeiling', computeCreditStatus(6).overCeiling === true);
check('above ceiling ($8): overCeiling', computeCreditStatus(8).overCeiling === true);

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

// ── 12. DISTILL PER-STEP admission (money leak closed 2026-07-25) ─────────────────────────────────
// THE LEAK: distillStep reuses the session-stamped keySource, so it never calls resolveAnthropicKey and
// had NO admission control at all — its only gate was the ONE whole-pipeline DISTILL_EST_USD check at
// startDistillSession. Open one session, then loop distillStep: every call a real billed Anthropic
// request on OUR managed key, recorded by the ledger but never blocked. Each step is now gated with
// DISTILL_STEP_EST_USD before it spends. These cases pin the shape of that gate.
console.log('\ndistill per-step admission (leak regression):');
check('distill: a per-step estimate exists and is a positive finite number', Number.isFinite(DISTILL_STEP_EST_USD) && DISTILL_STEP_EST_USD > 0);
// ⭐ THE REGRESSION GUARD — an EXHAUSTED ledger must block a distill STEP. Before the fix this call ran
// and billed our key; the ledger merely recorded the overspend.
const dExhausted = managedRunBlocker({ keySource: 'managed', availableUsd: 0, spentUsd: TRIAL_GRANT_USD, estimateUsd: DISTILL_STEP_EST_USD });
check('distill: exhausted grant → step BLOCKED (was: unbounded billed steps)', !!dExhausted && dExhausted.reason === 'insufficient');
// Less than one step of credit left → block (the "grant + one more call" overrun, per step).
const dThin = managedRunBlocker({ keySource: 'managed', availableUsd: DISTILL_STEP_EST_USD / 2, spentUsd: 4.99, estimateUsd: DISTILL_STEP_EST_USD });
check('distill: less than one step of credit left → step BLOCKED', !!dThin && dThin.reason === 'insufficient');
check('distill: block reports the honest per-step numbers', !!dThin && approx(dThin.estimateUsd, DISTILL_STEP_EST_USD) && approx(dThin.availableUsd, DISTILL_STEP_EST_USD / 2));
// Enough credit for THIS step → proceed, even when the WHOLE remaining pipeline would not fit.
// (Expressed in units of the per-step figure so it survives a re-derivation of that constant: more than
// one step's worth left, less than the 6 steps a whole run needs.)
check('distill: one step fits (mid-pipeline, whole run would not) → proceed', managedRunBlocker({ keySource: 'managed', availableUsd: DISTILL_STEP_EST_USD * 2, spentUsd: 1, estimateUsd: DISTILL_STEP_EST_USD }) === null);
// FAIL CLOSED on a KVS read glitch — creditStatus reports availableUsd 0, so the step blocks.
const dGlitch = computeCreditStatus(0, false);
check('distill: ledger read glitch → step BLOCKED (fail closed, never a free managed call)', managedRunBlocker({ keySource: 'managed', availableUsd: dGlitch.availableUsd, spentUsd: dGlitch.spentUsd, estimateUsd: DISTILL_STEP_EST_USD })?.reason === 'insufficient');
// The absolute hard ceiling still backstops a step admitted under the grant.
const dCeil = managedRunBlocker({ keySource: 'managed', availableUsd: 5, spentUsd: TRIAL_HARD_CEILING_USD, estimateUsd: DISTILL_STEP_EST_USD });
check('distill: at the hard ceiling → step BLOCKED (ceiling backstop)', !!dCeil && dCeil.reason === 'ceiling');
// ⭐ BYOK is NEVER gated — a customer on their own key distills unlimited, credit state irrelevant.
check('distill: BYOK step → never gated, even with 0 credit', managedRunBlocker({ keySource: 'byok', availableUsd: 0, spentUsd: 99, estimateUsd: DISTILL_STEP_EST_USD }) === null);

// ── 13. ⭐ ADMISSION MUST GUARANTEE COMPLETION (audit HIGH, 2026-07-25) ───────────────────────────
// THE BUG: the session gate ($0.10, an INDEPENDENT constant) and the per-step gate ($0.02 × 6 = $0.12)
// disagreed, so a user admitted at session start could be BLOCKED at step 5 or 6 — after we had already
// paid for steps 1-4 and after they had waited — and get nothing usable. Admission that does not
// guarantee completion is worse than no admission: it spends OUR money AND wastes the user's time.
// THE FIX: the session figure is DERIVED (stepCount × per-step), so the two can never disagree again.
console.log('\ndistill admission-guarantees-completion (the HIGH):');
const STEPS = 6; // DISTILL_CATEGORIES.length in production; the helper is parameterised, so assert on n
const RUN_EST = distillRunEstimateUsd(STEPS);
check('run estimate === stepCount × per-step estimate (derived, not an independent constant)', approx(RUN_EST, STEPS * DISTILL_STEP_EST_USD));
check('run estimate carries no float dust (0.14×6 renders as 0.84, not 0.8400000000000001)', RUN_EST === 0.84);
check('run estimate is monotonic in stepCount', distillRunEstimateUsd(7) > RUN_EST && distillRunEstimateUsd(1) < RUN_EST);
// The old constant, pinned as a regression: $0.10 admitted a run that needed $0.12.
check('REGRESSION: the retired independent $0.10 figure was SHORT of the real pipeline cost', 0.1 < STEPS * DISTILL_STEP_EST_USD);
// ⭐ THE INVARIANT, walked end-to-end. Admit with EXACTLY the run estimate available, then run every
// step charging the TRUE per-step worst case ($0.134 — at or below the $0.14 admission figure by design).
// No step may be blocked. (Under the old numbers, starting from $0.10 this walk blocked at step 6.)
// ⚠ $0.134 is the WORST CASE from the DISTILL_STEP_EST_USD derivation, not a typical cost: the 40,000-char
// clip bounded as UTF-8 bytes (≤120K tokens) + ~10K tokens of fixed prompt + 800 output tokens, priced at
// sync (un-batched) Haiku $1/$5 per MTok. The retired $0.016 assumed 4 chars/token — an English-prose
// average, not a bound — so it sat BELOW real Cyrillic/CJK/dense-technical steps and the walk below
// "passed" while the live invariant did not hold. Keep this at or under DISTILL_STEP_EST_USD.
const TRUE_STEP_COST = 0.134; // the grounded worst case from the DISTILL_STEP_EST_USD derivation
check('the modelled worst-case step cost is genuinely covered by the admission figure', TRUE_STEP_COST <= DISTILL_STEP_EST_USD);
// Amounts are rounded to 6 dp after each step so the MODEL asserts the intended arithmetic rather than
// IEEE-754 accumulation dust (0.12 − 6×0.02 drifts to −1.7e-17 and would fake a block on the last step).
const r6 = (n) => Math.round(n * 1e6) / 1e6;
function walkRun(startAvailable, startSpent, stepCost, steps, externalDrainPerStep = 0) {
  let available = startAvailable;
  let spent = startSpent;
  for (let i = 0; i < steps; i++) {
    const b = managedRunBlocker({ keySource: 'managed', availableUsd: available, spentUsd: spent, estimateUsd: DISTILL_STEP_EST_USD });
    if (b) return { blockedAt: i, reason: b.reason };
    available = r6(available - stepCost - externalDrainPerStep);
    spent = r6(spent + stepCost + externalDrainPerStep);
  }
  return { blockedAt: null, reason: null };
}
check('⭐ a run admitted on the DERIVED figure completes all 6 steps un-blocked', walkRun(RUN_EST, TRIAL_GRANT_USD - RUN_EST, TRUE_STEP_COST, STEPS).blockedAt === null);
// The STRONGER form of the guarantee: it holds even when every step costs its full admission estimate
// (the worst a step may cost without the gate having mis-priced it). This is the invariant that makes
// the per-step gate a backstop rather than a second admission test.
check('⭐ …and still completes when every step costs its FULL estimate (the worst admissible run)', walkRun(RUN_EST, TRIAL_GRANT_USD - RUN_EST, DISTILL_STEP_EST_USD, STEPS).blockedAt === null);
// ⚠ THE BUG CLASS, pinned structurally rather than by the retired literal: ANY whole-run admission figure
// short of `stepCount × the per-step figure` blocks mid-pipeline. Expressed as "one step short" so it keeps
// testing the same thing whatever either constant is re-derived to. Both cases the guarantee is defined
// over — steps at their full estimate, and steps at the grounded worst case — must block on the LAST step:
// the exact "we paid for steps 1-5, the user gets nothing" failure.
const SHORT_ADMISSION = r6((STEPS - 1) * DISTILL_STEP_EST_USD); // one step short of the derived figure
const shortAtEstimate = walkRun(SHORT_ADMISSION, TRIAL_GRANT_USD - SHORT_ADMISSION, DISTILL_STEP_EST_USD, STEPS);
check('REGRESSION: an admission one step SHORT blocks on the last step when steps cost their estimate', shortAtEstimate.blockedAt === STEPS - 1 && shortAtEstimate.reason === 'insufficient');
const shortAtWorstCase = walkRun(SHORT_ADMISSION, TRIAL_GRANT_USD - SHORT_ADMISSION, TRUE_STEP_COST, STEPS);
check('REGRESSION: …and also blocks on the last step at the grounded worst-case step cost', shortAtWorstCase.blockedAt === STEPS - 1 && shortAtWorstCase.reason === 'insufficient');
// The retired $0.10 whole-run constant, measured against the CORRECTED per-step figure: it cannot fund even
// ONE step now — the clearest statement of how far the old chars/4 grounding was from a real upper bound.
const retiredAtNewFigure = walkRun(0.1, TRIAL_GRANT_USD - 0.1, TRUE_STEP_COST, STEPS);
check('REGRESSION: the retired $0.10 admission cannot fund even ONE step at the corrected per-step figure', retiredAtNewFigure.blockedAt === 0 && retiredAtNewFigure.reason === 'insufficient');
const marginAfter = (start, cost) => start - STEPS * cost; // credit left once all 6 steps have run
// ⭐ The completion guarantee restated as margin: admitted at the derived figure, a run paying the WORST
// CASE every step still ends with credit to spare — where a one-step-short admission ends in deficit.
check('⭐ the derived figure survives 6 worst-case steps with margin to spare', marginAfter(RUN_EST, TRUE_STEP_COST) >= 0);
check('⭐ …and a one-step-short admission does not', marginAfter(SHORT_ADMISSION, TRUE_STEP_COST) < marginAfter(RUN_EST, TRUE_STEP_COST) && marginAfter(SHORT_ADMISSION, TRUE_STEP_COST) < 0);
// The per-step gate is a BACKSTOP, not a second admission test: it fires only when ANOTHER surface
// consumed credit concurrently mid-run.
const drained = walkRun(RUN_EST, TRIAL_GRANT_USD - RUN_EST, TRUE_STEP_COST, STEPS, 0.02);
check('backstop: concurrent consumption by another surface DOES block mid-pipeline (what the backstop is for)', drained.blockedAt !== null && drained.reason === 'insufficient');
// Ceiling coherence: a run admitted under the hard ceiling never trips the ceiling on its own steps.
const nearCeiling = TRIAL_HARD_CEILING_USD - RUN_EST; // admitted with exactly the run's worth of ceiling headroom
check('ceiling coherence: session admission leaves ceiling headroom for every one of its own steps', walkRun(RUN_EST, nearCeiling, TRUE_STEP_COST, STEPS).blockedAt === null);
// Degenerate inputs must never produce a 0/negative estimate (managedRunBlocker reads that as
// "cannot price this run" and blocks outright — a code bug would dead-end a legitimate user).
check('run estimate: 0 steps → falls back to one step (never 0 → never an outright block)', distillRunEstimateUsd(0) === DISTILL_STEP_EST_USD);
check('run estimate: NaN/absent/negative/non-integer steps → one step', distillRunEstimateUsd(NaN) === DISTILL_STEP_EST_USD && distillRunEstimateUsd() === DISTILL_STEP_EST_USD && distillRunEstimateUsd(-3) === DISTILL_STEP_EST_USD && distillRunEstimateUsd(2.5) === DISTILL_STEP_EST_USD);
check('run estimate: a bigger pipeline is admitted for MORE, so growth cannot re-open the gap', approx(distillRunEstimateUsd(9), 9 * DISTILL_STEP_EST_USD));

// ── 14. SYNC-SURFACE HOLD/SETTLE (the check-vs-charge + unrecorded-spend fixes, 2026-07-25) ───────
// distillStep now HOLDS a conservative estimate BEFORE the Anthropic call and SETTLES to the echoed
// actual after (settleManagedHold). Model of that arithmetic: hold charges est; settle charges
// (actual − held); a non-finite actual leaves the hold standing; actual 0 releases it in full.
console.log('\ndistill sync hold/settle:');
function holdThenSettle(startSpent, held, actual) {
  let spent = Math.max(0, startSpent + held);            // HOLD (before the call)
  if (!(Number.isFinite(actual) && actual >= 0)) return spent; // no usable actual → hold stands
  return Math.max(0, spent + (actual - held));           // SETTLE (after the call)
}
check('settle: converges to the ACTUAL when the call succeeds ($0.14 held, $0.012 actual)', approx(holdThenSettle(0, DISTILL_STEP_EST_USD, 0.012), 0.012));
check('settle: an actual ABOVE the hold tops up (never under-counts a costly step)', approx(holdThenSettle(0, DISTILL_STEP_EST_USD, DISTILL_STEP_EST_USD + 0.05), DISTILL_STEP_EST_USD + 0.05));
check('settle: release (actual 0) refunds the whole hold — for classes that provably billed nothing', approx(holdThenSettle(0, DISTILL_STEP_EST_USD, 0), 0));
// ⭐ THE UNRECORDED-SPEND FIX: a billed call whose section write (or usage echo) fails must still leave
// the ledger charged. Under the OLD charge-after-the-write ordering it left ZERO.
check('⭐ no usable actual (missing usage echo / lost output) → the HOLD still stands, spend is never lost', approx(holdThenSettle(0, DISTILL_STEP_EST_USD, null), DISTILL_STEP_EST_USD));
// The retired ordering, pinned: it charged ONLY after the section write, so a write fault returned
// early and a real, billed Anthropic call left NOTHING on the ledger the gate depends on.
function chargeAfterWrite(startSpent, actual, writeOk) {
  if (!writeOk) return startSpent; // old code returned before ever reaching the charge
  return Math.max(0, startSpent + (Number.isFinite(actual) ? actual : 0));
}
check('REGRESSION: charge-AFTER-the-write recorded $0 for a billed call whose section write failed', approx(chargeAfterWrite(0, 0.012, false), 0));
check('⭐ hold-then-settle records that same billed call ($0.012) even though the write failed', approx(holdThenSettle(0, DISTILL_STEP_EST_USD, 0.012), 0.012));
check('REGRESSION: charge-AFTER-the-write also recorded $0 when the 200 echoed no usage', approx(chargeAfterWrite(0, null, true), 0));
check('settle: hold GLITCH (held 0) still lands the full actual on the ledger', approx(holdThenSettle(0, 0, 0.012), 0.012));
// A 6-step run settles to the sum of its actuals — the ledger converges, it does not accumulate estimates.
let ledger = 0;
for (let i = 0; i < STEPS; i++) ledger = holdThenSettle(ledger, DISTILL_STEP_EST_USD, TRUE_STEP_COST);
check('settle: a full 6-step run converges to Σ actuals (no estimate residue)', approx(ledger, STEPS * TRUE_STEP_COST));
check('settle: that total stays well inside the grant', ledger < TRIAL_GRANT_USD);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
