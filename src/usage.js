/**
 * Spec2Tickets — usage metering & tier enforcement (P3a, 2026-05-30).
 *
 * WHAT THIS IS
 *   A small, deterministic layer that meters "breakdowns" (= successful
 *   generations) per calendar month, per site installation, and resolves the
 *   active subscription tier. Pure orchestration over Forge KVS — NO LLM call
 *   (POLICY §4 dispatch rule: counting + threshold compare is *structure*, not
 *   meaning-reading → a pure function, never a model call).
 *
 * THE MODEL (BYOK MVP launch — partner decision 2026-05-30)
 *   - Free: 3 breakdowns / month, resets the 1st of each month (UTC). A trial.
 *   - Pro:  €20 / month → UNLIMITED breakdowns.
 *   Two tiers, one flat paid price. Rationale: under BYOK the customer brings
 *   their own Anthropic key and pays Anthropic for compute, so "unlimited"
 *   costs us nothing and is a genuinely strong, simple value prop. €20 is a
 *   deliberate floor — below it the product reads as a hobby, not a tool.
 *
 *   ⚠ "Unlimited" is safe ONLY while BYOK. When the future "vendor-pays" model
 *   lands (we pay the API, pending Anthropic reselling approval), unlimited
 *   becomes an unbounded-cost liability and MUST revert to a usage cap / metered
 *   pricing. Do not carry €20-unlimited into the vendor-pays era unchanged.
 *
 * ENFORCEMENT MODE
 *   'block' = hard-block when a free site reaches its monthly limit, returning a
 *             quota_exceeded payload (LimitReachedScreen shows reset date + Pro).
 *   'meter' = track only, never block.
 *
 *   PER-ENVIRONMENT (see ENFORCEMENT_MODE below): production = 'block' (default),
 *   dev = 'meter' (test freely) via `forge variables set`. The €20 Marketplace
 *   listing goes live WITH the production release, so block has a working upgrade
 *   path in production — dev simply has no listing (normal). resolveTier() reads
 *   context.license.active → paying sites auto-resolve to Pro (unlimited).
 *
 * SCOPE — per-site, not per-user
 *   The Anthropic key and all KVS state are site-wide (one install = one shared
 *   key), so the free trial counter is per-site. Per-seat billing (if chosen for
 *   the €20 listing) lives at the Atlassian subscription layer, above this
 *   counter — resolveTier() only needs the binary license.active either way.
 */

import { kvs } from '@forge/kvs';

// ── Tier model — single source of truth ─────────────────────────────
// `limit`: breakdowns per calendar month, per site. `null` = unlimited.
// `price`: the Marketplace SUBSCRIPTION price (NOT API cost — under BYOK the
//          customer pays Anthropic directly; the subscription buys the app).
// The Free limit (3) is the single tunable threshold that bites in 'block' mode.
export const TIERS = {
  free: { key: 'free', label: 'Free', limit: 3, price: null },
  pro: { key: 'pro', label: 'Pro', limit: null, price: '€20/month' },
};

export const DEFAULT_TIER = 'free';

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

// ── Tier resolution ──────────────────────────────────────────────────

/**
 * Resolve the active tier from the resolver `context`.
 * A live Atlassian license → Pro (unlimited); otherwise Free. When the app is
 * not yet paid-listed, context.license is absent → Free (the safe default), so
 * this is correct both before and after the paid listing goes live.
 *
 * @param {object} context - Forge resolver context (may carry `.license`).
 */
export function resolveTier(context) {
  const lic = context && context.license;
  if (lic && lic.active === true) return TIERS.pro;
  return TIERS[DEFAULT_TIER];
}

// ── Counter primitives ───────────────────────────────────────────────

async function readCount(period) {
  const rec = await kvs.get(`${USAGE_KEY_PREFIX}${period}`);
  return rec && typeof rec.count === 'number' ? rec.count : 0;
}

/**
 * Read-only quota snapshot — does NOT consume. Drives both the pre-submit gate
 * and the getUsage resolver (UI badge / upgrade nudge).
 *
 * Unlimited tiers (limit === null) are never over-limit and always allowed.
 * Callers wrap in try/catch and fail OPEN (see startGeneration) — a metering
 * glitch must never block a BYOK user who pays their own Anthropic bill.
 */
export async function checkQuota(context) {
  const now = new Date();
  const tier = resolveTier(context);
  const period = currentPeriod(now);
  const resetsAt = periodResetsAt(now);
  const used = await readCount(period);
  const unlimited = tier.limit === null;
  const remaining = unlimited ? null : Math.max(0, tier.limit - used);
  const overLimit = unlimited ? false : used >= tier.limit;
  return {
    tier: tier.key,
    tierLabel: tier.label,
    limit: tier.limit, // null = unlimited
    unlimited,
    used,
    remaining,
    period,
    resetsAt,
    resetsAtLabel: formatResetDate(resetsAt),
    overLimit,
    allowed: unlimited || ENFORCEMENT_MODE !== 'block' || used < tier.limit,
    enforcementMode: ENFORCEMENT_MODE,
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
 * @param {string} period - billing period (defaults to the current month).
 * @returns {Promise<number>} the new count.
 */
export async function consumeQuota(period = currentPeriod()) {
  const key = `${USAGE_KEY_PREFIX}${period}`;
  const rec = await kvs.get(key);
  const count = (rec && typeof rec.count === 'number' ? rec.count : 0) + 1;
  await kvs.set(key, { count, updatedAt: new Date().toISOString() });
  return count;
}

/**
 * Pricing table for the UI upgrade CTA. English (user-facing copy per POLICY).
 */
export function pricingTable() {
  return [TIERS.free, TIERS.pro].map((t) => ({
    key: t.key,
    label: t.label,
    limit: t.limit, // null = unlimited
    price: t.price,
  }));
}
