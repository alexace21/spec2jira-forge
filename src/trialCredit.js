/**
 * Spec2Tickets — $5 managed trial-credit ledger (2026-07-11).
 *
 * WHAT THIS IS
 *   A per-installation dollar ledger for the managed-key onboarding credit. A NEW
 *   customer in the 30-day Atlassian trial can run on OUR MANAGED_ANTHROPIC_KEY until
 *   a small real-dollar grant (default $5) is spent — no BYOK setup required to see
 *   value. Once the grant is exhausted (or the trial converts to paid), the app
 *   routes them to BYOK (their own key, unlimited). Pure orchestration over Forge KVS —
 *   NO LLM call (POLICY §4 dispatch rule: money accounting is structure, not meaning).
 *
 * WHY A DOLLAR LEDGER (not a count cap)
 *   The dormant per-user COUNT cap (usage.js MANAGED_USER_CAP) can't bound cost when a
 *   single test-case run varies 16× ($0.22–3.67). The trial credit meters the REAL
 *   dollars Anthropic charges (estimateCost over the echoed usage), so a mix of cheap
 *   breakdowns and one expensive test-gen all draw from the same honest $5.
 *
 * SCOPE = PER INSTALL (site), LIFETIME (partner decision 2026-07-11)
 *   One $5 budget per Confluence site, NOT per user and NOT per month. Bounds our
 *   worst-case managed spend to ~$5/customer regardless of seat count — the loss-bounded
 *   shape for an onboarding credit. (A per-USER $5 on a 500-seat instance would be a
 *   $2500 margin bomb.) The KVS key is a single per-install record (no accountId, no period).
 *
 * RESERVATION MODEL (the adversarial-audit fix — charge-at-finalize alone is unsafe)
 *   Anthropic bills at batch EXECUTION, not at our poll. If the user closes the tab or the
 *   completed-persist fails, a "charge only at finalize" leaks (never debited → farming
 *   vector: fire cheap runs, never finalize) or double-charges (persistFailed re-poll loop).
 *   So we use a scalar reconciliation model:
 *     - SUBMIT (managed only): chargeSpend(estimate) immediately + stamp the estimate on the
 *       job record. In-flight spend is now visible to the next gate (closes the check-vs-charge
 *       race) and an abandoned run stays charged (caps our spend — SAFE polarity for free credit).
 *     - FINALIZE (managed only, once — guarded by job.creditReconciled): chargeSpend(actual − estimate)
 *       reconciles the estimate to the echoed truth (negative delta = refund the over-estimate).
 *   spentUsd is a single scalar (no holds map) → fewer KVS race surfaces. The non-atomic
 *   read-modify-write race is bounded (one run), documented (same class as usage.js consumeQuota),
 *   and backstopped by the HARD CEILING below.
 *
 * ⚠ ALWAYS-ON — decoupled from ENFORCEMENT_MODE
 *   This is REAL money. Unlike the dormant count cap (which ENFORCEMENT_MODE='meter' can skip
 *   harmlessly because the customer pays BYOK compute), the trial-credit gate + hard ceiling are
 *   ALWAYS enforced. A mis-set ENFORCEMENT_MODE must never turn MANAGED_ANTHROPIC_KEY into
 *   unbounded liability. Dev tests exhaustion by setting a small MANAGED_TRIAL_CREDIT_USD + a
 *   low-budget managed key — never by disabling the gate.
 */

import { kvs } from '@forge/kvs';

// Single per-install ledger record.
const LEDGER_KEY = 'trial:managed-credit';

/** The trial grant in USD (env-tunable; raising it is customer-friendly). Default $5. */
export const TRIAL_GRANT_USD =
  Number.parseFloat(process.env.MANAGED_TRIAL_CREDIT_USD) > 0
    ? Number.parseFloat(process.env.MANAGED_TRIAL_CREDIT_USD)
    : 5;

/**
 * Per-install kill-ceiling on managed dollars — the backstop that bounds worst-case spend. Independent
 * of the grant and of ENFORCEMENT_MODE. Default = 2× the grant. Enforced at ADMISSION per surface
 * (overCeiling); the ONE surface whose actual can massively exceed its estimate (test-gen) has an
 * ADDITIONAL upper-vs-ceiling admission gate (startTestCaseGeneration) so it can't single-handedly blow
 * past the ceiling. Net: an install's managed spend is materially bounded at ~$10 — not a hard mid-run
 * clamp, so a CHEAP surface admitted while under-ceiling can still reconcile a small estimate→actual tail
 * past it (breakdown ≤$0.24 / plan / regen / a distill step / a cycle-repair call), which is negligible.
 */
export const TRIAL_HARD_CEILING_USD =
  Number.parseFloat(process.env.MANAGED_HARD_CEILING_USD) > 0
    ? Number.parseFloat(process.env.MANAGED_HARD_CEILING_USD)
    : TRIAL_GRANT_USD * 2;

// Conservative per-run SUBMIT estimates (reconciled to the echoed actual at finalize). These
// only need to be in the right ballpark — the finalize reconcile corrects them to the truth.
// Grounded in the measured cost reality (memory/monetization-strategy): breakdown avg $0.118 /
// max $0.24; a plan is a single ranking call (cheaper). Test-gen has a real pre-flight projector
// (anthropic_client.projectTestCaseCost) so it does NOT use a flat constant.
export const BREAKDOWN_EST_USD = 0.24;
export const PLAN_EST_USD = 0.1;
export const REGEN_EST_USD = 0.1;

/**
 * PURE status computation from a known spend (node-testable — no KVS). `readOk:false` forces the
 * DECISION fields (exhausted/overCeiling) true so a glitch never grants free managed spend (SAFE money
 * polarity). Separated from creditStatus so the gate math is unit-tested without the KVS dependency.
 */
export function computeCreditStatus(spentUsd, readOk = true, grantUsd = TRIAL_GRANT_USD, hardCeilingUsd = TRIAL_HARD_CEILING_USD) {
  const spent = Number.isFinite(spentUsd) && spentUsd > 0 ? spentUsd : 0;
  const availableUsd = Math.max(0, grantUsd - spent);
  return {
    readOk,
    grantUsd,
    spentUsd: spent,
    availableUsd,
    // A failed read reads as exhausted FOR THE DECISION so a glitch never grants free spend.
    exhausted: !readOk || spent >= grantUsd,
    hardCeilingUsd,
    overCeiling: !readOk || spent >= hardCeilingUsd,
  };
}

/**
 * Read-only status snapshot. Drives BOTH the managed-vs-byok decision (resolveAnthropicKey) and
 * the getUsage credit badge. `readOk:false` on a KVS glitch → treated as `exhausted:true` for the
 * DECISION (SAFE money polarity: never hand out free managed spend on a read glitch — a transient
 * glitch degrades a trial user to the BYOK prompt, it does not block a paying BYOK user). The
 * getUsage caller checks `readOk` to hide the badge rather than error the account panel.
 */
export async function creditStatus() {
  let spentUsd = 0;
  let readOk = true;
  try {
    const rec = await kvs.get(LEDGER_KEY);
    spentUsd =
      rec && typeof rec.spentUsd === 'number' && rec.spentUsd > 0 ? rec.spentUsd : 0;
  } catch (e) {
    readOk = false;
  }
  return computeCreditStatus(spentUsd, readOk);
}

/**
 * Add `deltaUsd` to spentUsd (delta may be NEGATIVE = refund an over-estimate at reconcile).
 * Read-modify-write; the non-atomic KVS race is bounded (one run), documented, and hard-ceiling
 * backstopped. Never lowers spentUsd below 0. Throwing propagates to the caller, which wraps this
 * fail-safe (a charge failure must never break the generation itself — the spend already happened).
 *
 * @returns {Promise<number>} the new spentUsd.
 */
export async function chargeSpend(deltaUsd) {
  const d = Number.isFinite(deltaUsd) ? deltaUsd : 0;
  if (d === 0) {
    const rec = await kvs.get(LEDGER_KEY);
    return rec && typeof rec.spentUsd === 'number' ? rec.spentUsd : 0;
  }
  const rec = await kvs.get(LEDGER_KEY);
  const prev = rec && typeof rec.spentUsd === 'number' ? rec.spentUsd : 0;
  const next = Math.max(0, prev + d);
  await kvs.set(LEDGER_KEY, { spentUsd: next, updatedAt: new Date().toISOString() });
  return next;
}
