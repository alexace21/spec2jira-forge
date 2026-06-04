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
 * THE MODEL — trial → paid, two Paid-via-Atlassian editions (simplified
 * 2026-06-03: the in-app perpetual Free 3/mo tier was REMOVED). Evaluation is
 * covered by the 30-day Atlassian trial that Paid-via-Atlassian apps get for free
 * (a trial reads as an ACTIVE license at runtime → resolves to a paid tier), so a
 * separate in-app free path — and the unverified/spoofable unlicensed-access
 * surface it rode on — is obsolete:
 *   - BYOK Pro:    "Standard" edition, $6.70/user/mo → UNLIMITED. The customer's
 *                  own Anthropic key pays compute, so unlimited is no cost
 *                  liability for us; the subscription is pure app-value.
 *   - Managed Pro: "Advanced" edition, $13/user/mo (editions Phase 2 — not yet a
 *                  published edition) → CAPPED (we call Anthropic with OUR key, so usage = our
 *                  cost). Fair-use 10 breakdowns/user/mo (MANAGED_USER_CAP),
 *                  metered PER USER, NOT pooled (no runtime seat count) —
 *                  loss-proof per seat. See below.
 *   - Unlicensed:  a minimal DEFENSIVE tier (limit 0, blocked) for the
 *                  no-active-license case. Not a product offering — by default
 *                  Atlassian blocks non-licensed users from a Paid-via-Atlassian
 *                  app surface, so this is a backstop the resolvers turn into a
 *                  clean "subscribe or start a trial" prompt, never a raw error.
 *
 *   Edition discrimination is by license.capabilitySet (capabilityStandard /
 *   capabilityAdvanced) — see resolveTier. An active license with no recognised
 *   set ⇒ BYOK Pro (the SAFE default: unlimited, customer-key, never bills us).
 *
 *   ⚠ "Unlimited" is safe ONLY for BYOK (customer pays compute). Managed is
 *   capped precisely because WE pay — never give Managed an unlimited tier.
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

// ── Managed Pro per-user fair-use cap ────────────────────────────────
// Managed Pro meters PER USER per month (each seat its own allowance), NOT pooled
// per instance — the Forge License object exposes NO seat count at runtime
// (verified @forge/api runtime.d.ts 2026-06-03), so 10×seats is uncomputable, and
// per-user is the loss-bounded shape that needs no seat count: 10 × worst-case
// ~$0.50 = ~$5 < $13/seat revenue → ≥60% margin at the cap, any instance size;
// and abuse is self-funding (each extra seat is paid revenue). Market research
// (2026-06-03) confirmed 10 is GENEROUS — typical use 1-3/mo, power 5-8/mo — so it
// rarely binds; heavy users → BYOK or a future Managed-Plus. Env-tunable for
// signal-driven adaptation: `forge variables set ... MANAGED_USER_CAP <n>`.
export const MANAGED_USER_CAP =
  Number.parseInt(process.env.MANAGED_USER_CAP, 10) > 0
    ? Number.parseInt(process.env.MANAGED_USER_CAP, 10)
    : 10;

// ── Tier model — single source of truth ─────────────────────────────
// `limit`: breakdowns per calendar month. `null` = unlimited, `0` = blocked.
// `edition`: the Paid-via-Atlassian edition that maps to this tier — 'standard'
//   = BYOK Pro, 'advanced' = Managed Pro, null = Unlicensed (no edition).
// `price`: the Marketplace SUBSCRIPTION price shown in the UI (NOT API cost —
//          under BYOK the customer pays Anthropic; the subscription buys the app).
export const TIERS = {
  byokPro: {
    key: 'byokPro',
    label: 'BYOK Pro',
    limit: null, // unlimited — customer's own key pays compute
    price: '$6.70/user/mo', // matches the live Marketplace portal (USD; ≤10 users = $57/mo flat)
    edition: 'standard',
  },
  managedPro: {
    key: 'managedPro',
    label: 'Managed Pro',
    limit: MANAGED_USER_CAP, // we pay compute → per-USER fair-use cap (see above)
    price: null, // null until Phase 2 launches — so the app never advertises a not-yet-buyable "Subscribe to Managed" CTA. Planned at $13/user/mo; the public site shows that as "coming soon".
    edition: 'advanced',
  },
  // Defensive backstop for the no-active-license case (no trial, no subscription).
  // Not a product offering — the resolvers turn this into a clean "subscribe or
  // start a trial" prompt (license_required) rather than a raw 401 / silent fail.
  unlicensed: {
    key: 'unlicensed',
    label: 'Unlicensed',
    limit: 0, // blocked — no breakdowns without an active license/trial
    price: null,
    edition: null,
  },
};

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
function resolveLicense(context) {
  try {
    const appCtx = getAppContext();
    if (appCtx && appCtx.license) return appCtx.license;
  } catch (e) {
    // Not in an invocation context (e.g. a unit test) — fall back below.
  }
  return (context && context.license) || null;
}

/**
 * Resolve the active tier from a Forge license object. PURE (the async caller
 * obtains the license and passes it) so it is unit-testable in isolation.
 *
 *   capabilityAdvanced   ⇒ Managed Pro (we pay Anthropic; per-user cap)
 *   capabilityStandard   ⇒ BYOK Pro    (customer's key; unlimited)
 *   active, unknown set  ⇒ BYOK Pro    (SAFE default — never bill us by accident)
 *   no active license    ⇒ Unlicensed  (blocked — no trial, no subscription)
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
  if (cap === 'capabilityadvanced') return TIERS.managedPro;
  return TIERS.byokPro;
}

/**
 * Convenience: the active tier for THIS invocation, license-resolved. Used by the
 * resolvers for the Anthropic key source (Managed/Advanced ⇒ our key, else BYOK)
 * and for the defensive license_required gate (unlicensed ⇒ no trial/subscription).
 * Sync-license read; fail-open via resolveLicense.
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
  if (tier && tier.key === 'managedPro') {
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
    edition: tier.edition, // 'standard'|'advanced'|null — for tier-aware messaging
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
    // Managed's cap is FAIR-USE (we pay compute), NOT a free-trial limit — an
    // over-limit Managed user is routed to BYOK (unlimited), not "subscribe".
    fairUse: tier.key === 'managedPro',
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
  return [TIERS.byokPro, TIERS.managedPro].map((t) => ({
    key: t.key,
    label: t.label,
    limit: t.limit, // null = unlimited
    price: t.price,
    edition: t.edition,
  }));
}
