/**
 * Spec2Tickets — usage metering & tier enforcement (P3a, 2026-05-30).
 *
 * WHAT THIS IS
 *   A small, deterministic layer that meters "breakdowns" (= successful
 *   generations) per calendar month and resolves the active subscription tier.
 *   Pure orchestration over Forge KVS — NO LLM call (POLICY §4 dispatch rule:
 *   counting + threshold compare is *structure*, not meaning-reading → a pure
 *   function, never a model call).
 *
 * THE MODEL — trial → paid, two Paid-via-Atlassian editions on a VALUE axis
 * (v6 value-split, 2026-06-17: editions pivoted from KEY-SOURCE to VALUE; BOTH are
 * now BYOK). Evaluation is the 30-day Atlassian trial (a trial reads as an ACTIVE
 * license at runtime → resolves to a paid tier; the in-app Free 3/mo tier was removed
 * 2026-06-03):
 *   - Standard:   "Standard" edition, BYOK → UNLIMITED. Core breakdown + push +
 *                 Project Context. The customer's own Anthropic key pays compute,
 *                 so unlimited is no cost liability for us. The subscription price is
 *                 the GRADUATED Marketplace band table (see PRICING COPY below) — the
 *                 app cannot know which band an install sits in, so it never states a rate.
 *   - Advanced:   "Advanced" edition, BYOK → UNLIMITED + TEST-CASE
 *                 GENERATION (the SINGLE headline anchor TODAY; custom prompts + the
 *                 Capacity-Sheet vision are FUTURE — do NOT advertise them until built).
 *                 Still BYOK → still $0 compute cost to us, so still no cap. The ONLY
 *                 differentiator vs Standard is the feature set (test-cases today).
 *   - Unlicensed: a minimal DEFENSIVE tier (limit 0, blocked) for the no-active-license
 *                 case. Not a product offering — the resolvers turn it into a clean
 *                 "subscribe or start a trial" prompt, never a raw error.
 *
 *   THREE concerns are now DECOUPLED (they used to be conflated on edition==='advanced'):
 *   edition (label) · keySource (byok|managed) · hasTestCases (feature). Edition
 *   discrimination is by license.capabilitySet (capabilityStandard/capabilityAdvanced)
 *   — see resolveTier. An active license with no recognised set ⇒ Standard (the SAFE
 *   default: BYOK, unlimited, no test-cases, never bills us).
 *
 *   The "Managed Pro" (we-pay-with-OUR-key, capped) model is DROPPED as a Marketplace
 *   edition — it survives only as a DORMANT off-Marketplace fallback (TIERS.managedPro,
 *   not reachable from any capabilitySet). MANAGED_ANTHROPIC_KEY + the per-user cap +
 *   the metering exist solely for that dormant path + legacy in-flight jobs (see below).
 *
 *   ⚠ "Unlimited" is safe because BOTH editions are BYOK (the customer pays compute).
 *   The cap below applies ONLY to the dormant Managed (we-pay) path.
 *
 * ENFORCEMENT MODE — governs the MANAGED per-user fair-use cap
 *   'block' = hard-block when a Managed user reaches the per-user monthly cap,
 *             returning a quota_exceeded payload (LimitReachedScreen).
 *   'meter' = track only, never block.
 *   PER-ENVIRONMENT: production = 'block' (default when unset), dev = 'meter'
 *   via `forge variables set`. Editions are tested in dev via
 *   `forge install --license Standard|Advanced` (no env override needed).
 *
 * SCOPE — per-USER Managed counter; per-USER billing is above this layer
 *   The Anthropic key + all KVS state are site-wide (one install = one shared
 *   key), so the BYOK tier is unlimited (counted only for analytics). MANAGED
 *   meters PER USER (accountId), because the license object exposes NO seat count
 *   at runtime (verified @forge/api runtime.d.ts) → 10×seats is uncomputable, so
 *   per-user is the loss-bounded shape (10/seat is loss-proof regardless of
 *   instance size).
 */

import { kvs } from '@forge/kvs';
import { getAppContext } from '@forge/api';

// ── Managed per-user fair-use cap (DORMANT under v6) ─────────────────
// ⭐ v6 value-split: BOTH live Marketplace editions are now BYOK (no cap — the customer
// pays compute). This cap applies ONLY to the dormant off-Marketplace Managed (we-pay)
// fallback + any legacy pre-v6 job stamped keySource:'managed'. It is no longer reached
// by any capabilitySet-resolved edition. The historical margin math below is retained for
// the day Managed is ever re-enabled off-Marketplace.
//
// Managed meters PER USER per calendar month (each seat its own allowance),
// NOT pooled per instance — the Forge License object exposes NO seat count at
// runtime (verified @forge/api runtime.d.ts 2026-06-03), so N×seats is
// uncomputable; per-user is the loss-bounded shape that needs no seat count.
//
// CAP = 25 (raised from 10, 2026-06-16). v5.4.0 Managed ships BREAKDOWN-ONLY
// (test-case generation is a v5.5.0 feature, NOT in this build), and a breakdown
// costs only ~$0.118 avg / $0.24 max on our key → 25 × $0.24 = $6.00 worst-case
// vs the RETIRED $13/seat Managed Pro price ⇒ ~54% margin FLOOR (cap × max cost;
// typical use stays well under the cap → ~90%+ margin). ⚠ That $13/seat is a
// HISTORICAL figure kept only so the margin math stays readable — Managed is
// dormant and carries price: null today, and it is NOT the live Standard model
// (which is graduated per-user bands — see PRICING COPY below). The cap is pure
// cost-protection / abuse circuit-breaker, NOT a value gate, so it is set
// GENEROUS: a real BA (typ. 1-3 specs/mo, power 5-8, PLUS each regeneration
// consuming one) effectively never reaches 25, so Managed feels "unlimited" — its
// value prop (no key to manage). Raising a cap is customer-friendly, lowering is
// hostile, so 25 is committable: we will NOT lower it for breakdown-only. Abuse is
// self-funding (each seat is paid revenue). Env-tunable for signal-driven
// adaptation: `forge variables set ... MANAGED_USER_CAP <n>`.
//
// ⭐ v5.5.0 forward note: test-case generation costs $1-3.67 (8.6× a breakdown),
// which would blow this cap's margin if folded in. The fix is NOT to lower this
// cap — it is to give test-cases their OWN separate budget/meter (a surgical
// compute-budget on the expensive driver), so breakdowns stay generously
// count-capped at 25. Test cases must justify their price as a premium feature.
export const MANAGED_USER_CAP =
  Number.parseInt(process.env.MANAGED_USER_CAP, 10) > 0
    ? Number.parseInt(process.env.MANAGED_USER_CAP, 10)
    : 25;

// ── Tier model — single source of truth (v6 value-split) ────────────
// THREE concerns are now EXPLICIT, decoupled fields. They USED to be inferred from
// `edition==='advanced'` (which conflated edition + key-source + cap into one flag);
// the v6 value-split split them so editions are a VALUE axis, key-source a SEPARATE axis:
//   `edition`     : Marketplace edition LABEL only — 'standard' | 'advanced' |
//                   'managed' (dormant) | null. NEVER infer key-source/features from it.
//   `keySource`   : 'byok' (customer's Anthropic key) | 'managed' (our MANAGED_ANTHROPIC_KEY).
//                   BOTH live Marketplace editions are 'byok'; 'managed' is the DORMANT
//                   off-Marketplace fallback only — NOT reachable from resolveTier (see there).
//   `hasTestCases`: feature capability. Test-case generation is an Advanced-edition feature
//                   (the v6 headline value anchor) — gate features on THIS, never on `edition`.
//   `limit`       : breakdowns / calendar month. null = unlimited, 0 = blocked. A cap is
//                   needed ONLY when WE pay (keySource 'managed'); BYOK is always unlimited.
//   `price`       : the SHORT subscription-price line shown in the UI (NOT API cost — under
//                   BYOK the customer pays Anthropic; the subscription buys the app).
//                   ⭐ It states a SHAPE and defers the figure — it must NEVER assert a
//                   per-user rate as "your price" (see PRICING COPY below for why).
//                   ⚠ Keep it SHORT (≲25 chars): LimitReachedScreen's EditionRow renders it
//                   in a `shrink-0` flex cell, so a full sentence there overflows the card.
//                   null ⇒ the whole subscription CTA card is hidden (EditionRow returns null
//                   on a falsy price), which is why the live tiers must keep a non-null string.
//   `priceNote`   : the LONGER shape sentence, rendered where there IS room (the Settings
//                   Account panel + the LimitReached subscription card). This is what carries
//                   the whole-instance qualifier — see PRICING COPY. null = render nothing.
// Object.freeze: the resolved tier is shared BY REFERENCE across the resolver and spread
// into getUsage — a mutating consumer would corrupt the singleton for later callers.
//
// ── PRICING COPY — why these strings state a SHAPE and never a rate ──
// VERIFIED against the Atlassian vendor portal 2026-07-24. Paid via Atlassian, per user per
// month, GRADUATED like tax brackets — each rate applies ONLY to the users inside its own
// band. NEVER multiply one rate by the whole headcount.
//   single instance : up to 10  FREE ($0, flat)    ·  1-100     $6.70 (band max $670)
//                     101-250   $5.10 ($1,435)     ·  251-1000  $3.80 ($4,285)
//                     1001-2500 $3.50 ($9,535)     ·  2501-7500 $3.25 · 7501-10000 $2.85
//                     ... declining to $1.15 at 45001+
//   multi-instance  : 1.5x the single-instance rate ($10.05 / $7.65 / $5.70 ...)
//   bracket proof   : $670 + 150x$5.10 = $1,435 ; $1,435 + 750x$3.80 = $4,285 ;
//                     $4,285 + 1500x$3.50 = $9,535 — all match the portal's "max total"
//                     column, i.e. the bands really are cumulative, not one flat rate.
//
// ⚠ THE QUALIFIER THAT MUST TRAVEL WITH EVERY "FREE" MENTION: Paid via Atlassian licenses the
// WHOLE Confluence instance. "Free up to 10 users" means the ENTIRE Confluence site has 10 or
// fewer users — NOT "a small team inside a big company". A 4-person team on a 900-user site is
// NOT free. Copy that says "free" without that qualifier is a false promise.
//
// ⭐ WHY THE STRINGS DEFER TO THE MARKETPLACE: the app CANNOT know which band an install is in.
// The Forge License object exposes NO seat count, NO user count and NO price band (probe-verified
// on dev 2026-07-25 — the raw shape is recorded above resolveLicense). Asserting one band as
// "your price" is therefore wrong for every customer in a different band, so the UI states the
// SHAPE and sends them to the Marketplace listing, which shows each customer their real price.
// The retired '$6.70/user/mo' + "≤10 users = $57/mo flat" strings were BOTH stale (the ≤10 band
// is FREE now and there is no $57 floor) AND unknowable from inside the app.
//
// ⛔ Do NOT put the $5 welcome credit or a "start without an API key" angle into PRICING copy —
// decided, but not shipped as a public offer.
export const TIERS = Object.freeze({
  byokPro: Object.freeze({
    key: 'byokPro', // KEY kept 'byokPro' (not renamed) so every findPrice/tier-literal site is churn-free
    label: 'Standard', // v6: relabeled BYOK Pro → "Standard" (value framing)
    limit: null, // unlimited — customer's own key pays compute
    // SHAPE, not a rate (see PRICING COPY above): the runtime exposes no seat count or band, so
    // the app cannot know this install's price — the Marketplace listing shows the customer theirs.
    price: 'See Marketplace pricing',
    priceNote:
      'Free while the whole Confluence site has 10 or fewer users — the site, not just your team. ' +
      'Above that it is priced per user across the site, on a rate that declines as the site grows. ' +
      'The Marketplace listing shows the exact price for your site.',
    edition: 'standard',
    keySource: 'byok',
    // ⭐ 2026-07-11 STANDARD-ONLY PIVOT: Standard now includes EVERYTHING. Editions collapsed to a
    // single offer (Advanced retired) per the first-customer marketing analysis. Flipping these two
    // flags true is the load-bearing change — every FE upsell (!hasTestCases/!hasPlanner) and every
    // backend edition gate (buildUpgradeRequired) becomes "entitled" for all licensed/trial users.
    // BOTH remain $0 compute to us under BYOK (the customer's key pays); the $5 managed trial credit
    // (src/trialCredit.js) is the ONLY case where WE pay, and it is bounded per-install.
    hasTestCases: true,
    hasPlanner: true,
  }),
  // v6 NEW: Advanced = BYOK + test-case generation (the value-split headline). BYOK →
  // unlimited (the customer pays compute), so NO cap and $0 compute cost to us.
  byokAdvanced: Object.freeze({
    key: 'byokAdvanced',
    label: 'Advanced',
    limit: null, // unlimited — BYOK, customer's key pays compute
    // Retired as an OFFER (2026-07-11 Standard-only pivot) but still RESOLVABLE for an existing or
    // pending subscriber — so it needs honest copy, not a stale rate. Deliberately makes NO free-band
    // claim: only the live Standard offer's bands are portal-verified.
    price: 'See Marketplace pricing',
    priceNote:
      'Priced per user across the whole Confluence site, on a rate that declines as the site grows. ' +
      'The Marketplace listing shows the exact price for your site.',
    edition: 'advanced',
    keySource: 'byok',
    hasTestCases: true,
    hasPlanner: true, // v6.1: Advanced bundles the Capacity-Sheet Planner with test-cases (strengthens the Advanced value)
  }),
  // DORMANT — the off-Marketplace Managed fallback. NOT reachable from any capabilitySet
  // (resolveTier maps capabilityAdvanced → byokAdvanced, never here). Kept alive ONLY so a
  // legacy in-flight job stamped keySource:'managed' (pre-v6) still resolves OUR key at its
  // poll/fetch legs. edition is 'managed' (NOT 'advanced') so no stray `edition==='advanced'`
  // read can ever re-bind the managed key. limit kept for the (re-enabled) we-pay case.
  managedPro: Object.freeze({
    key: 'managedPro',
    label: 'Managed Pro',
    limit: MANAGED_USER_CAP, // we pay compute → per-USER fair-use cap (see above)
    price: null, // dormant — never advertised
    priceNote: null, // no price rendered ⇒ no note either
    edition: 'managed', // v6: was 'advanced' — decoupled so it can't re-couple to the edition flag
    keySource: 'managed',
    hasTestCases: true, // if ever re-enabled, Managed Advanced would include test-cases on their OWN budget
    hasPlanner: true, // dormant — mirrors hasTestCases (Managed Advanced is the same value tier)
  }),
  // Defensive backstop for the no-active-license case (no trial, no subscription).
  // Not a product offering — the resolvers turn this into a clean "subscribe or
  // start a trial" prompt (license_required) rather than a raw 401 / silent fail.
  unlicensed: Object.freeze({
    key: 'unlicensed',
    label: 'Unlicensed',
    limit: 0, // blocked — no breakdowns without an active license/trial
    price: null,
    priceNote: null,
    edition: null,
    keySource: 'byok', // never our key, even defensively
    hasTestCases: false,
    hasPlanner: false,
  }),
});

export const DEFAULT_TIER = 'unlicensed';

// Per Forge environment so dev tests freely while production enforces:
//   forge variables set --environment development ENFORCEMENT_MODE meter
// Unset → 'block' (production-safe default). See the ENFORCEMENT MODE note above.
export const ENFORCEMENT_MODE =
  process.env.ENFORCEMENT_MODE === 'meter' ? 'meter' : 'block';

// KVS key: `usage:YYYY-MM` — one record per month, per site installation.
const USAGE_KEY_PREFIX = 'usage:';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ── Period helpers ───────────────────────────────────────────────────
// UTC so the reset boundary is unambiguous across the customer's timezone.

/** Current billing period as `YYYY-MM` (UTC). */
export function currentPeriod(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** ISO timestamp of the first instant of NEXT month (UTC) — when quota resets. */
export function periodResetsAt(date = new Date()) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  ).toISOString();
}

/**
 * Human-readable reset date for user-facing copy, e.g. "June 1, 2026".
 * Manual formatting (no locale/ICU dependency) so it is deterministic across
 * runtimes. The reset day is always the 1st of the month.
 */
export function formatResetDate(iso) {
  const d = new Date(iso);
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// ── License + tier resolution ────────────────────────────────────────

/**
 * Obtain the authoritative Forge license. getAppContext() (@forge/api) is the
 * reliable runtime source for capabilitySet — the resolver `context.license` has
 * historically exposed only a thin active flag on some code paths. Sync call,
 * valid only inside an invocation, so wrapped fail-open with a fallback to the
 * passed context.license, then null (⇒ unlicensed). It also reflects the dev
 * `forge install --license Standard|Advanced` override, which is how we test.
 */
export function resolveLicense(context) {
  try {
    const appCtx = getAppContext();
    if (appCtx && appCtx.license) return appCtx.license;
  } catch (e) {
    // Not in an invocation context (e.g. a unit test) — fall back below.
  }
  return (context && context.license) || null;
}

// ⚠⚠ TEMPORARY DEV DIAGNOSTIC — 2026-07-24. DELETE BEFORE ANY PRODUCTION DEPLOY. ⚠⚠
// WHY: the welcome-credit design (docs/IMPL-SPEC-PER-USER-WELCOME-CREDIT.md §3) asks a question the
// docs cannot answer — does the Forge License object let us tell a FREE-band install (≤10 users, $0)
// from a PAID one? The declared fields carry no seat count and no price band. So we log the RAW shape
// and read it back with `forge logs` under each `forge install --license …` variant.
//
// ⚠ v2 FIX: v1 gated on `process.env.FORGE_ENVIRONMENT === 'development'` — that variable DOES NOT
// EXIST in the Forge runtime (an unverified assumption), so the probe never fired. The real signal is
// `getAppContext().environmentType` (declared `string` in @forge/api runtime.d.ts:139). Its exact
// casing is itself unverified, so we do NOT gate on a guessed value: we log unless the environment
// reads PRODUCTION (case-insensitive) — safe by default, and it logs environmentType so we learn it.
//
// SAFE TO LOG: entitlement metadata (flags, dates, opaque ids) — NOT end-user content and NOT personal
// data, so the "Log End-User Data: No" listing answer still holds. Temporary: REVERT once §3.4 is answered.
// ⭐ WHAT THE PROBE FOUND (dev, 2026-07-25 — kept as the durable record; the probe itself is removed):
//   --license active : {active, billingPeriod:"MONTHLY", state:"active", supportEntitlementNumber:null,
//                       type:"commercial", isActive:true}
//   --license trial  : the same PLUS state:"trial" and trialEndDate:"<+30d>"
//   appContext keys  : appAri, appVersion, environmentAri, environmentType, installationAri, invocationId,
//                      invocationRemainingTimeInMillis, moduleKey, license, installation, permissions
// ⇒ There is NO seat count, NO user count and NO price band anywhere — so the app CANNOT tell a free-band
//   install (≤10 users, $0) from a paid one. `state` separates trial from active but is NOT in the declared
//   @forge/api License type (runtime.d.ts:44-56) — the declared type is a LOWER BOUND on what the runtime
//   returns. `type` was "commercial" in BOTH, so it does not discriminate trial-vs-paid; whether a real
//   free-band install reports something else is UNVERIFIABLE on dev (`--license` cannot simulate it).
//   The welcome-credit design deliberately does not depend on that answer — see
//   docs/IMPL-SPEC-PER-USER-WELCOME-CREDIT.md §3.

/**
 * Is this license in the 30-day Atlassian evaluation trial? (2026-07-11 — gates the $5 managed
 * trial credit; only a TRIAL user is offered our key, a paid subscriber is always BYOK.)
 *
 * `isEvaluation` is the primary signal (typed `isEvaluation?:boolean` in @forge/api runtime.d.ts).
 * `trialEndDate` is a belt-and-suspenders guard: if `isEvaluation` were stale (true past the trial
 * end on some code path), a `trialEndDate` in the PAST closes the door — we never grant free managed
 * credit after the trial actually ended. Ambiguity (no signals) → false (default to NO free credit,
 * the SAFE money polarity). A trial that reads active but has no end date is honoured.
 *
 * @param {object|null} license - a Forge License object (see resolveLicense).
 */
export function isTrialLicense(license) {
  if (!license) return false;
  const endT = license.trialEndDate ? Date.parse(license.trialEndDate) : NaN;
  const endInFuture = Number.isFinite(endT) && endT > Date.now();
  const endInPast = Number.isFinite(endT) && endT < Date.now();
  // (1) The canonical Marketplace flag. A trialEndDate in the PAST = a stale isEvaluation past the trial end
  //     → NOT a trial (never keep granting free managed credit after the trial actually ended).
  if (license.isEvaluation === true) return !endInPast;
  // (2) EXPLICITLY paid/non-eval (isEvaluation === false) → NEVER a trial, regardless of any lingering
  //     trialEndDate. THE margin-leak guard: a paid customer must never draw the free managed credit.
  if (license.isEvaluation === false) return false;
  // (3) isEvaluation UNDEFINED → fall back to a FUTURE trialEndDate as the trial signal. ⭐ Verified on dev
  //     2026-07-11: `forge install --license trial` sets trialEndDate (≈30 days out) but leaves isEvaluation
  //     UNDEFINED — so the strict isEvaluation-only check made the whole $5-trial path untestable on dev AND
  //     would miss any prod license shape that omits isEvaluation. A future end = an active trial; an
  //     absent/past end = not a trial. Safe polarity: ambiguity (no signal) → not a trial (no free credit).
  return endInFuture;
}

/**
 * Resolve the active tier from a Forge license object. PURE (the async caller
 * obtains the license and passes it) so it is unit-testable in isolation.
 *
 *   capabilityAdvanced   ⇒ Advanced (BYOK + test-cases; unlimited — customer's key)
 *   capabilityStandard   ⇒ Standard (BYOK, core; unlimited — customer's key)
 *   active, unknown set  ⇒ Standard (SAFE default — BYOK, no test-cases; never our key)
 *   no active license    ⇒ Unlicensed  (blocked — no trial, no subscription)
 *
 * v6 value-split: BOTH live editions are BYOK (keySource 'byok'); the Managed (we-pay)
 * tier is DORMANT and is NOT reachable here. Only an EXACT 'capabilityadvanced' grants
 * the Advanced feature set (hasTestCases) — an unknown set falls through to Standard, so
 * the premium feature is never granted by accident (safe-default polarity preserved).
 *
 * A 30-day Atlassian trial reads as an ACTIVE license, so a trialling user
 * resolves to BYOK/Managed Pro normally; only a truly unlicensed install (no
 * subscription AND no trial) falls through to the blocked Unlicensed tier.
 *
 * capabilitySet is typed 'capabilityStandard'|'capabilityAdvanced' by @forge/api,
 * but compared case-INSENSITIVELY to defend against documented casing drift.
 *
 * FUTURE (migration-protections #2): grandfather early adopters here — an install
 * whose firstSeenAt (getInstallMeta) predates the early-access cutoff resolves to
 * an unlimited grandfathered tier. Deferred until the cutoff date exists (a
 * launch-time decision, never a hardcode); firstSeenAt is captured today
 * (recordFirstSeen). The async caller would read the meta and pass it in.
 *
 * @param {object|null} license - a Forge License object (see resolveLicense).
 */
export function resolveTier(license) {
  const active = !!(
    license && (license.active === true || license.isActive === true)
  );
  if (!active) return TIERS[DEFAULT_TIER];
  const cap = String(license.capabilitySet || '').toLowerCase();
  if (cap === 'capabilityadvanced') return TIERS.byokAdvanced; // v6: Advanced = BYOK + test-cases (was managedPro)
  return TIERS.byokPro;
}

/**
 * Convenience: the active tier for THIS invocation, license-resolved. Used by the
 * resolvers for the Anthropic key source (tier.keySource — both live editions BYOK),
 * the feature gate (tier.hasTestCases ⇒ test-case generation), and the defensive
 * license_required gate (unlicensed ⇒ no trial/subscription). Sync-license read;
 * fail-open via resolveLicense.
 */
export function getActiveTier(context) {
  return resolveTier(resolveLicense(context));
}

// ── Counter primitives ───────────────────────────────────────────────

/**
 * The KVS key a tier meters against for the period. Managed Pro (we pay compute)
 * meters PER USER (`:u:<accountId>`) — each seat its own allowance (MANAGED_USER_CAP).
 * Every other tier meters against the PER-SITE key (BYOK is unlimited, counted
 * only for analytics; Unlicensed never consumes — it is blocked first). accountId
 * is server-trusted (backend-prioritised in the resolver context, never the
 * client payload).
 */
function usageKeyFor(tier, context, period) {
  // v6: meter per-user ONLY when WE pay compute (keySource 'managed'), not on the edition
  // flag — the per-user cap is a cost-protection, so it follows key-source, not the label.
  // Both live (BYOK) editions meter per-site (analytics only, never blocks).
  if (tier && tier.keySource === 'managed') {
    const acct = (context && context.accountId) || 'unknown';
    return `${USAGE_KEY_PREFIX}${period}:u:${acct}`;
  }
  return `${USAGE_KEY_PREFIX}${period}`;
}

async function readCountByKey(key) {
  const rec = await kvs.get(key);
  return rec && typeof rec.count === 'number' ? rec.count : 0;
}

/**
 * Read-only quota snapshot — does NOT consume. Drives both the pre-submit gate
 * and the getUsage resolver (UI badge / upgrade nudge).
 *
 *   - BYOK Pro (unlimited, limit === null)  → always allowed.
 *   - Managed Pro (per-user cap)            → allowed while used < cap, governed
 *                                             by ENFORCEMENT_MODE ('meter' = track
 *                                             only, never block).
 *   - Unlicensed (limit 0)                  → never allowed (defensive backstop;
 *                                             not affected by ENFORCEMENT_MODE,
 *                                             which governs only the Managed cap).
 *
 * Callers wrap in try/catch and fail OPEN (see startGeneration) — a metering
 * glitch must never block a BYOK user who pays their own Anthropic bill.
 */
export async function checkQuota(context) {
  const now = new Date();
  const tier = resolveTier(resolveLicense(context));
  const period = currentPeriod(now);
  const resetsAt = periodResetsAt(now);
  const usageKey = usageKeyFor(tier, context, period);
  const used = await readCountByKey(usageKey);
  const unlimited = tier.limit === null;
  const blocked = tier.limit === 0; // Unlicensed — defensive, always disallowed
  const remaining = unlimited ? null : Math.max(0, tier.limit - used);
  const overLimit = unlimited ? false : used >= tier.limit;
  // ENFORCEMENT_MODE governs ONLY the Managed per-user cap. The Unlicensed backstop
  // (limit 0) is always disallowed — a dev 'meter' env must not admit an unlicensed
  // user. Unlimited (BYOK) is always allowed.
  const allowed = unlimited
    ? true
    : blocked
      ? false
      : ENFORCEMENT_MODE !== 'block' || used < tier.limit;
  return {
    tier: tier.key,
    tierLabel: tier.label,
    // The ACTIVE tier's OWN subscription price — the Account panel shows THIS (the user's real plan
    // price), independent of pricingTable (which now lists only Standard for the upgrade CTA). Without
    // it, a grandfathered Advanced subscriber's tier isn't in pricingTable → their price rendered blank.
    price: tier.price,
    priceNote: tier.priceNote, // the shape sentence (whole-instance qualifier) for the Account panel
    edition: tier.edition, // 'standard'|'advanced'|'managed'(dormant)|null — LABEL only, for messaging
    keySource: tier.keySource, // v6 decouple: 'byok'|'managed' — explicit, never inferred from edition
    hasTestCases: tier.hasTestCases, // 2026-07-11 Standard-only: INCLUDED in Standard (always true for a live tier) — kept in the payload so the FE reads "entitled" (removing it would re-paywall via default-FALSE logic)
    hasPlanner: tier.hasPlanner, // 2026-07-11 Standard-only: the Capacity-Sheet Planner is INCLUDED in Standard too (always true for a live tier) — kept for the same FE back-compat reason
    limit: tier.limit, // null = unlimited
    unlimited,
    used,
    remaining,
    period,
    usageKey, // KVS key this tier meters against (per-user for Managed) → consumeQuota
    resetsAt,
    resetsAtLabel: formatResetDate(resetsAt),
    overLimit,
    allowed,
    enforcementMode: ENFORCEMENT_MODE,
    // The cap is FAIR-USE (it exists only when WE pay compute), NOT a free-trial limit
    // — an over-limit user is routed to BYOK (unlimited), not "subscribe". v6: keyed on
    // keySource 'managed' (dormant for live editions), not the edition flag.
    fairUse: tier.keySource === 'managed',
  };
}

/**
 * Increment the month counter (read-modify-write). Called once per successful
 * generation, tier-agnostic (Pro usage is tracked too, for analytics; Pro just
 * never blocks on it).
 *
 * Concurrency: Forge KVS has no atomic increment, so two near-simultaneous
 * submits can both read N and write N+1 (one breakdown slips free). Accepted:
 * the off-by-one is always in the customer's favour, the race window is one
 * Anthropic submit (~hundreds of ms), and under BYOK an extra free breakdown
 * costs us nothing. If 'block' ever needs hard correctness, swap to a
 * transactional / custom-entity counter.
 *
 * @param {string} usageKey - the KVS key to increment (from checkQuota().usageKey;
 *   per-user for Managed, per-site otherwise). Falls back to the per-site key.
 * @returns {Promise<number>} the new count.
 */
export async function consumeQuota(usageKey) {
  const key = usageKey || `${USAGE_KEY_PREFIX}${currentPeriod()}`;
  const rec = await kvs.get(key);
  const count = (rec && typeof rec.count === 'number' ? rec.count : 0) + 1;
  await kvs.set(key, { count, updatedAt: new Date().toISOString() });
  return count;
}

// ── Install provenance — grandfathering signal ───────────────────────
// A write-once record of when this install was FIRST actively seen.
//
// WHY this exists NOW, before the Marketplace listing: when the eventual
// €20-flat-unlimited → tiers+caps migration happens, we promised to grandfather
// early adopters (memory/migration-protections.md #2 — reframes the migration as
// "early adopters earned a perk", not "we took unlimited away"). That promise can
// only be honoured if we captured WHO WAS EARLY from day one — firstSeenAt cannot
// be reconstructed retroactively. So we capture the irreplaceable SIGNAL now and
// DEFER the reversible DECISION (the cutoff date + the resolveTier nuance) to
// launch / migration time, when the cutoff is actually known. Hardcoding a cutoff
// today would be premature; losing the signal today is unrecoverable.
//
// Pure structure (a timestamp), no LLM (POLICY §4 dispatch rule).
const INSTALL_META_KEY = 'install:meta';

/**
 * Record the install's first-seen timestamp, exactly once (earliest wins).
 *
 * Idempotent get-or-set: safe to call from multiple entry points (app open +
 * generate). A second call is a no-op that preserves the original timestamp, so
 * the stored value is always the EARLIEST observation.
 *
 * Concurrency: like consumeQuota, KVS has no atomic compare-and-set, so two
 * near-simultaneous first calls could both read empty and both write. Harmless —
 * the timestamps differ by milliseconds and grandfathering compares against a
 * cutoff months away, so a few-ms skew never changes the outcome.
 *
 * Callers wrap in try/catch and fail OPEN — a metering-storage glitch must never
 * break the resolver that happens to host the capture.
 *
 * @returns {Promise<{firstSeenAt: string, created: boolean}>} the install meta;
 *   `created` is true only on the call that first wrote it (for one-time logging).
 */
export async function recordFirstSeen(date = new Date()) {
  const existing = await kvs.get(INSTALL_META_KEY);
  if (existing && existing.firstSeenAt) return { ...existing, created: false };
  const meta = { firstSeenAt: date.toISOString() };
  await kvs.set(INSTALL_META_KEY, meta);
  return { ...meta, created: true };
}

/**
 * Read the install meta ({ firstSeenAt } or null). The reader for the FUTURE
 * grandfather-aware resolveTier nuance (migration-protections #2): at the
 * flat→tiers migration, an install whose firstSeenAt predates the early-access
 * cutoff resolves to the grandfathered (unlimited) tier. Unused until then —
 * intentionally, so the cutoff stays a launch-time decision, not a hardcode.
 */
export async function getInstallMeta() {
  return (await kvs.get(INSTALL_META_KEY)) || null;
}

/**
 * Pricing table for the UI upgrade CTA — the two paid editions only (Unlicensed
 * is a defensive backstop, not a product offering). English (user-facing copy
 * per POLICY).
 */
export function pricingTable() {
  // ⭐ 2026-07-11 STANDARD-ONLY: a SINGLE offer — Standard includes everything. Advanced is retired
  // (byokAdvanced is kept in TIERS as a full-featured internal alias so a pending/existing Advanced
  // subscriber never loses access — see resolveTier — but it is NOT advertised). managedPro stays
  // dormant. The FE upgrade CTA now shows one edition.
  return [TIERS.byokPro].map((t) => ({
    key: t.key,
    label: t.label,
    limit: t.limit, // null = unlimited
    price: t.price, // SHORT shape line — never a per-user rate (see PRICING COPY)
    priceNote: t.priceNote, // the qualified shape sentence, for surfaces with room
    edition: t.edition,
    hasTestCases: t.hasTestCases, // v6: drives the value-framing "+ test cases" copy from the capability (so marketing can't drift from code)
    hasPlanner: t.hasPlanner, // v6.1: same — drives the "+ capacity planner" value-framing from the capability
  }));
}
