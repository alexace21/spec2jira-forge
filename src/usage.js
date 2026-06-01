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
 * THE MODEL (BYOK MVP launch — partner decision 2026-05-30; price revised 2026-06-01)
 *   - Free: 3 breakdowns / month, resets the 1st of each month (UTC). A trial.
 *   - Pro:  €39 / month flat ("Early Access") → UNLIMITED breakdowns.
 *   Two tiers, one flat paid price for launch. Rationale: pricing is value-based,
 *   not cost-based — under BYOK the customer pays Anthropic for compute, so the
 *   subscription is pure app-value (a breakdown saves ~1-3 h of BA/PO time). €20
 *   under-captured (~2-10% of value) + under-signalled; €39 is the early-access
 *   floor. NEXT iteration: per-seat above 10 users (~€5/user) — Atlassian-native
 *   model, captures big-team value. Frame introductory + grandfather early adopters.
 *
 *   ⚠ "Unlimited" is safe ONLY while BYOK. When the future "vendor-pays" model
 *   lands (we pay the API, pending Anthropic reselling approval), unlimited
 *   becomes an unbounded-cost liability and MUST revert to a usage cap / metered
 *   pricing. Do not carry flat-unlimited into the vendor-pays era unchanged.
 *
 * ENFORCEMENT MODE
 *   'block' = hard-block when a free site reaches its monthly limit, returning a
 *             quota_exceeded payload (LimitReachedScreen shows reset date + Pro).
 *   'meter' = track only, never block.
 *
 *   PER-ENVIRONMENT (see ENFORCEMENT_MODE below): production = 'block' (default),
 *   dev = 'meter' (test freely) via `forge variables set`. The €39 Marketplace
 *   listing goes live WITH the production release, so block has a working upgrade
 *   path in production — dev simply has no listing (normal). resolveTier() reads
 *   context.license.active → paying sites auto-resolve to Pro (unlimited).
 *
 * SCOPE — per-site, not per-user
 *   The Anthropic key and all KVS state are site-wide (one install = one shared
 *   key), so the free trial counter is per-site. Per-seat billing (the planned
 *   next pricing iteration, above 10 users) lives at the Atlassian subscription
 *   layer, above this counter — resolveTier() only needs license.active either way.
 */

import { kvs } from '@forge/kvs';

// ── Tier model — single source of truth ─────────────────────────────
// `limit`: breakdowns per calendar month, per site. `null` = unlimited.
// `price`: the Marketplace SUBSCRIPTION price (NOT API cost — under BYOK the
//          customer pays Anthropic directly; the subscription buys the app).
// The Free limit (3) is the single tunable threshold that bites in 'block' mode.
export const TIERS = {
  free: { key: 'free', label: 'Free', limit: 3, price: null },
  pro: { key: 'pro', label: 'Pro', limit: null, price: '€39/month' },
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
  // FUTURE (migration-protections #2): when the €20-flat-unlimited → tiers+caps
  // migration lands, grandfather early adopters here — an install whose
  // firstSeenAt (getInstallMeta) predates the early-access cutoff should resolve
  // to an unlimited grandfathered tier instead of Free. Deferred until the cutoff
  // date exists (a launch-time decision, never a hardcode); the firstSeenAt
  // signal is already captured today (recordFirstSeen). The async caller
  // (checkQuota) would read the meta and pass it in, keeping this resolver pure.
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
