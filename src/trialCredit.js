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
 * of the grant and of ENFORCEMENT_MODE. ⭐ 2026-07-12 (partner call): Default = 1.2× the grant (a MODEST
 * buffer over the $5 grant → ~$6, NOT the old 2×/$10). The welcome credit is $5; our managed exposure per
 * install must never materially exceed it — $10 was twice the welcome, too generous. Enforced at ADMISSION
 * per surface (overCeiling); the ONE surface whose actual can massively exceed its estimate (test-gen) has
 * an ADDITIONAL upper-vs-ceiling admission gate (startTestCaseGeneration): a run whose WORST case wouldn't
 * fit under this ceiling routes to BYOK instead of drawing our key — the correct posture for a $5 welcome
 * (we don't fund a >$6-worst-case single run on the free credit). Net: an install's managed spend is
 * bounded at ~$6 — not a hard mid-run clamp, so a CHEAP surface admitted while under-ceiling can still
 * reconcile a tiny estimate→actual tail past it (breakdown ≤$0.24 / plan / regen / distill / cycle-repair;
 * these charge ≤ their estimate so the tail is cents). Override with MANAGED_HARD_CEILING_USD on prod
 * (recommended: set it explicitly to 6 — or 5 for the tightest cap — so a grant typo can't scale it).
 */
export const TRIAL_HARD_CEILING_USD =
  Number.parseFloat(process.env.MANAGED_HARD_CEILING_USD) > 0
    ? Number.parseFloat(process.env.MANAGED_HARD_CEILING_USD)
    : TRIAL_GRANT_USD * 1.2;

// Conservative per-run SUBMIT estimates (reconciled to the echoed actual at finalize). These
// only need to be in the right ballpark — the finalize reconcile corrects them to the truth.
// Grounded in the measured cost reality (memory/monetization-strategy): breakdown avg $0.118 /
// max $0.24; a plan is a single ranking call (cheaper). Test-gen has a real pre-flight projector
// (anthropic_client.projectTestCaseCost) so it does NOT use a flat constant.
export const BREAKDOWN_EST_USD = 0.24;
export const PLAN_EST_USD = 0.1;
export const REGEN_EST_USD = 0.1;
/**
 * ⭐ PER-STEP distill estimate — the admission figure for ONE distillStep call, and (via
 * `distillRunEstimateUsd` below) the ONLY input to the whole-run admission figure too.
 *
 * WHY IT EXISTS (money leak closed 2026-07-25). Distill is the one spend surface with no batch:
 * `distillStep` reuses the session-STAMPED keySource and therefore never calls resolveAnthropicKey
 * (the one place the managed-vs-byok credit decision is made). The only admission check used to be
 * ONE whole-pipeline gate at startDistillSession, so a caller could open a single session and then
 * loop `distillStep` indefinitely: every call a real billed Anthropic request on OUR managed key,
 * faithfully recorded by the ledger and never blocked. Each step is now gated with THIS figure,
 * before it spends.
 *
 * ⚠ IT MUST BE A TRUE UPPER BOUND, NOT A TYPICAL COST (audit MEDIUM, 2026-07-25). Everything below —
 * "admission guarantees completion", the per-step gate being a mere backstop — holds ONLY while a step's
 * REAL cost stays at or below this figure. The retired $0.02 was derived by reading the 40,000-char clip
 * as ~10K tokens, i.e. an assumed 4 chars/token — an ENGLISH-PROSE average, not a bound. Dense technical
 * text runs ~2-3 chars/token and non-Latin scripts far denser (Bulgarian/Cyrillic content is explicitly
 * in scope for this product), which alone put a real step at ~$0.031 — above the figure that admitted it.
 * So the number below is derived from a WORST-CASE TOKEN BOUND instead.
 *
 * DERIVATION (re-checkable from first principles; re-run it if any input changes):
 *   1. Input is clipped to DISTILL_MAX_INPUT_CHARS = 40000 (anthropic_client.js) via String.slice —
 *      so 40,000 UTF-16 code units, NOT 40,000 tokens and NOT 40,000 bytes.
 *   2. TOKENS ≤ UTF-8 BYTES. Claude's tokenizer is a byte-level BPE: all 256 single bytes are in the
 *      vocabulary and merges only ever JOIN bytes into longer tokens, so no input can ever tokenize to
 *      more tokens than it has bytes. This is the property that makes the bound tokenizer-version-proof —
 *      unlike a chars/token ratio, it cannot be falsified by a script, a domain, or a model update.
 *   3. BYTES ≤ 3 × CODE UNITS. UTF-8 costs 1 byte for ASCII, 2 for U+0080-U+07FF (Cyrillic, Greek,
 *      Hebrew, Arabic), 3 for U+0800-U+FFFF (CJK, Thai, Devanagari), and 4 for astral code points —
 *      but astral chars are surrogate PAIRS, i.e. 2 code units, so they cost only 2 bytes per unit.
 *      The maximum is therefore 3 bytes per code unit → the clip is ≤ 120,000 bytes ≤ 120,000 tokens.
 *   4. Fixed prompt overhead: DISTILL_SHARED_PREAMBLE (1,614 chars) + the longest category
 *      instruction+userAsk (3,908 — `glossary`) + the "Text:\n---\n…\n---" wrapper ≈ 5.6K ASCII bytes.
 *      Allow 10,000 tokens (~2× headroom, so editing the prompts cannot silently break the bound).
 *   5. Price it as the code does — estimateCost(usage, MODEL_FALLBACK, { batch: false }): distill is a
 *      SYNC Haiku 4.5 call, NOT batched, so no 50% batch discount. Haiku sync = $1.00/MTok in, $5.00/MTok out.
 *      Input ≤ 130,000 tok → $0.130.  Output ≤ 800 tok (the largest DISTILL_CATEGORIES.maxTokens, a hard
 *      `max_tokens` cap) → $0.004.  WORST CASE ≤ $0.134  →  rounded UP to $0.14.
 *
 * The reserve this asks of a $5 grant is ~$0.84 for a 6-category run (see distillRunEstimateUsd) while a
 * typical English run really costs ~$0.10 — deliberate: over-estimating only routes a nearly-spent trial
 * user to BYOK slightly early (graceful, and the endgame anyway), while under-estimating breaks the
 * completion invariant and spends past the grant. The hold is reconciled to the echoed ACTUAL at settle,
 * so a conservative figure gates admission WITHOUT over-charging anyone. ⭐ THE LEVER if that reserve ever
 * proves too tight: clip by UTF-8 BYTES rather than UTF-16 code units (Buffer.byteLength) — that alone
 * collapses step 3 to ≤ 40,000 tokens and the bound to ~$0.05/step. It is a product call (non-Latin users
 * would get less text distilled per run), so it is NOT taken here.
 */
export const DISTILL_STEP_EST_USD = 0.14;

/**
 * ⭐ WHOLE-RUN distill estimate — the SESSION admission figure, DERIVED from the per-step figure.
 *
 * ⚠ THE INVARIANT THIS EXISTS TO ENFORCE (audit HIGH, 2026-07-25): **admission must guarantee
 * completion.** The session gate and the per-step gate used to be two INDEPENDENT numbers ($0.10 for
 * the whole run, $0.02 per step) — and 6 × $0.02 = $0.12 > $0.10, so a user admitted at session start
 * could be BLOCKED at step 5 or 6, after we had already paid for steps 1-4 and after they had waited,
 * and get nothing usable. Admission that does not guarantee completion is worse than no admission: it
 * spends OUR money AND wastes the user's time. So the whole-run figure is now `stepCount × the
 * per-step figure` BY CONSTRUCTION — the two can never disagree again, whatever either number becomes
 * and however many categories the pipeline grows.
 *
 * CONSEQUENCE — the per-step gate becomes a genuine BACKSTOP rather than a second, stricter admission
 * test. Admitted with `available ≥ n × stepEst`, and with the per-step WORST CASE ($0.134, derived
 * above) at or below `stepEst` ($0.14), the credit left before step k is `available − Σ(actual so far)`
 * ≥ `n×0.14 − (k−1)×0.134` ≥ `0.14` for every k ≤ n=6 — so a run that is admitted can always finish on
 * its own. ⚠ That chain is only as good as `stepEst ≥ the real per-step cost`: if the per-step figure is
 * ever lowered below its worst-case derivation, THIS guarantee is what breaks first (silently — the
 * symptom is a user blocked mid-pipeline after we already paid for the earlier steps). The per-step gate
 * can then only fire when ANOTHER surface consumed credit concurrently mid-run, which is exactly what a
 * backstop is for (and distillStep reports that case honestly and KEEPS the session).
 *
 * @param {number} stepCount how many category calls this pipeline will make (DISTILL_CATEGORIES.length)
 * @returns {number} the conservative whole-run estimate in USD
 */
export function distillRunEstimateUsd(stepCount) {
  // A non-integer/absent count means the caller is broken; fall back to ONE step rather than 0 — the
  // per-step gate still guards every subsequent call, and a 0 estimate would be read as "cannot price
  // this run" and block outright (managedRunBlocker), dead-ending a legitimate user on a code bug.
  const n = Number.isInteger(stepCount) && stepCount > 0 ? stepCount : 1;
  return Math.round(DISTILL_STEP_EST_USD * n * 1e6) / 1e6; // kill float dust (0.14×6 = 0.8400000000000001)
}

/**
 * PRE-FLIGHT STOPPER (pure) — must a managed run be BLOCKED before it spends, because it can't fit the
 * remaining trial credit? Returns a blocker `{ reason, estimateUsd, availableUsd }` (the numbers to show
 * the user) or null (proceed). ⭐ 2026-07-12: this closes the overrun a partner caught in live testing —
 * a breakdown admitted with only $0.01 left then spent a full ~$0.24 PAST the grant, because admission
 * only checked `exhausted` (spent >= grant), never "does THIS run's estimate fit what's left". Every
 * managed-spend surface now runs this BEFORE holding/spending, so the grant is a real cap (not grant + one
 * run). Only applies to the managed key (keySource === 'managed'); a BYOK run is unlimited and never gated.
 *
 *   Stopper 1 — the run's estimate must fit the remaining grant (est > available → block).
 *   Stopper 2 — the worst case must not breach the absolute hard ceiling (spent + upper > ceiling → block);
 *               `upperUsd` defaults to the estimate (the surfaces whose actual ≈ estimate); test-gen passes
 *               its projected upper (its actual can massively exceed the expected).
 *
 * NaN/absent inputs collapse to the SAFE polarity (block), so a bad snapshot never grants free managed
 * spend: a bad AVAILABLE reads as 0 (est > 0 → block) AND a bad ESTIMATE (non-finite / non-positive — we
 * cannot price the run) blocks directly. PURE — the caller reads the ledger snapshot and does the route.
 */
export function managedRunBlocker({ keySource, availableUsd, spentUsd, estimateUsd, upperUsd = null, hardCeilingUsd = TRIAL_HARD_CEILING_USD } = {}) {
  if (keySource !== 'managed') return null; // BYOK / paid — never gated on trial credit
  const avail = Number.isFinite(availableUsd) && availableUsd > 0 ? availableUsd : 0;
  // A non-finite / non-positive estimate means we cannot reason about this run's cost → BLOCK (no managed
  // surface has a legitimately free run; a bad estimate must never PROCEED ungated — safe money polarity).
  if (!(Number.isFinite(estimateUsd) && estimateUsd > 0)) {
    return { reason: 'insufficient', estimateUsd: 0, availableUsd: avail };
  }
  const est = estimateUsd;
  if (est > avail) return { reason: 'insufficient', estimateUsd: est, availableUsd: avail };
  const worst = Number.isFinite(upperUsd) && upperUsd > 0 ? upperUsd : est;
  const spent = Number.isFinite(spentUsd) && spentUsd > 0 ? spentUsd : 0;
  const ceiling = Number.isFinite(hardCeilingUsd) && hardCeilingUsd > 0 ? hardCeilingUsd : TRIAL_HARD_CEILING_USD;
  if (spent + worst > ceiling) return { reason: 'ceiling', estimateUsd: worst, availableUsd: Math.max(0, ceiling - spent) };
  return null;
}

/**
 * PURE status computation from a known spend (node-testable — no KVS). `readOk:false` forces the
 * DECISION fields (exhausted/overCeiling) true so a glitch never grants free managed spend (SAFE money
 * polarity). Separated from creditStatus so the gate math is unit-tested without the KVS dependency.
 */
export function computeCreditStatus(spentUsd, readOk = true, grantUsd = TRIAL_GRANT_USD, hardCeilingUsd = TRIAL_HARD_CEILING_USD) {
  const spent = Number.isFinite(spentUsd) && spentUsd > 0 ? spentUsd : 0;
  // ⭐ 2026-07-12: on a read GLITCH availableUsd is UNKNOWN → report 0 (SAFE money polarity). The pre-flight
  // stopper (managedRunBlocker) gates on availableUsd, so reporting the full grant here would let a glitch
  // SPEND the managed key (the old exhausted/overCeiling-only gate blocked it; the new estimate-vs-available
  // gate would not). Zeroing available keeps the glitch path blocked everywhere the blocker is used.
  const availableUsd = readOk ? Math.max(0, grantUsd - spent) : 0;
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
