# XCA Migration + Paid-via-Atlassian Pricing — Implementation TODO

> **Pick this up in a DEDICATED dev session** (the admin/rollout session is kept separate).
> Created 2026-06-02. This is the ONLY remaining Marketplace blocker — the FIT/security
> issue is already RESOLVED (no-backend v3 architecture; see `memory/marketplace-launch-state.md`).

---

## ⭐ VERIFIED + IMPLEMENTED 2026-06-03 (read FIRST — supersedes stale notes below)

A dev session verified the platform facts against LIVE Atlassian/Anthropic docs (3 research agents)
and IMPLEMENTED the code. **Scope grew per partner decision: the resubmit ships the FULL hybrid**
(BYOK Pro + Managed Pro), so it **WAITS on the Managed compliance docs**.

**Locked design**
- **Two editions (platform cap = exactly 2):** `Standard` = **BYOK Pro €4.90/user** (unlimited,
  customer's key) · `Advanced` = **Managed Pro €9.90/user** (we call Anthropic with OUR key; capped).
  Floors €49/€99 (price × the fixed 1-10 band). Runtime tells them apart via
  `context.license.capabilitySet` (`capabilityStandard`/`capabilityAdvanced`) read via `getAppContext()`.
- **Free = in-app 3/mo, PERPETUAL** (NOT a €0 edition — those can't coexist with paid editions).
  Served to unlicensed installs via the manifest `unlicensedAccess: [unlicensed]` property.
- **Push gated behind a license:** `asUser()` is FORBIDDEN for unlicensed users → Free = Generate +
  Review only; the JIRA push needs an active license/trial.
- **Managed retention:** the Batches API is NOT ZDR-eligible → **disclose ≤29-day retention** (+ no-
  training default + auto-incorporated SCCs + a customer DPA). Reselling is permitted (Commercial Terms
  §A.1) — **no special approval needed** (the old "reselling approval" premise was wrong).

**DONE in code (dev, `feature/product-improvements`)**
- ✅ `manifest.yml`: `app.compatibility` (Confluence req / Jira opt) + `app.licensing.enabled` +
  **`app.licensing.editionsEnabled`** + `unlicensedAccess` on the 3 Confluence modules.
- ✅ `src/usage.js`: hybrid tiers (free / byokPro=Standard / managedPro=Advanced); `capabilitySet`
  resolution; `getActiveTier`; `MANAGED_USER_CAP` = 10 breakdowns per USER/mo (metered per-user
  `usage:YYYY-MM:u:<accountId>`, not pooled — the License object exposes no runtime seat count).
- ✅ `src/index.js`: Managed key path (our key from `MANAGED_ANTHROPIC_KEY` env var when Advanced;
  `keySource` stamped on the job + reused at poll/fetch/cycle-repair); tier-aware quota messaging;
  push-gating in `startPush`; distill Managed-key support.
- ⏳ Frontend (hybrid onboarding + push-gate UI + Managed settings) + compliance docs (`docs/compliance/`): in progress.

**CORRECTIONS to the original plan below (verified)**
1. **Do NOT uninstall Jira before deploying.** That uninstall-optional-first rule is for TEARDOWN only;
   Confluence installs + data are preserved automatically by the compatibility migration.
2. **`editionsEnabled: true` is REQUIRED** (Part A only had `licensing.enabled`) — else you get ONE
   price, not two editions.
3. **`@forge/api ≥ 5.1.1`** + latest CLI required for XCA — we have `^7.2.1` ✅.
4. **Part B "Free for ≤10 users" is SUPERSEDED** (fixed in Part B below). Free = in-app 3/mo; the 1-10
   band is the PAID floor (€49 BYOK / €99 Managed), not free.
5. **Managed seat-scaled (10×seats) cap is unenforceable at runtime** — the License object exposes NO
   seat count. So Managed meters **PER USER**: `MANAGED_USER_CAP` = 10 breakdowns per USER/mo
   (`usage:YYYY-MM:u:<accountId>`, env-tunable), NOT pooled per instance — per-user needs no seat count
   and is loss-proof per seat regardless of instance size.

**PARTNER EXECUTION CHECKLIST (external — Claude can't do these)**
- [ ] Set the Managed key (encrypted) in BOTH envs: `forge variables set --encrypt MANAGED_ANTHROPIC_KEY <our-key>`.
- [ ] DEV: `forge deploy -e development --no-verify` → `forge install --upgrade -e development` (Confluence + Jira; expect licensing re-consent). Test editions: `forge install -e development --license Standard` / `--license Advanced`; verify Free (no license) = Generate+Review with push BLOCKED.
- [ ] Vendor portal pricing: Cloud → two editions — Standard €4.90/user, Advanced €9.90/user; confirm the €49/€99 floors fall out of the 1-10 band.
- [ ] Compliance: legal-review + publish the customer DPA; reconcile the Atlassian privacy questionnaire to the Managed truth (≤29-day retention, SCCs, Anthropic sub-processor); publish the sub-processor list. (Drafts under `docs/compliance/`.)
- [ ] PROD: `forge deploy -e production --no-verify` → `forge install --upgrade -e production` (Confluence + Jira) → smoke-test → set prod `MANAGED_ANTHROPIC_KEY`.
- [ ] Resubmit → new ECOHELP ticket.
- ℹ️ ZDR is NOT pursued (we disclose 29-day Batches retention) → **no Anthropic ZDR request needed**.

---

---

## Why this exists (the reviewer's verdict)

After the v3 FIT/security fix was resubmitted as **v4.2.0**, Atlassian rejected it again —
but for a DIFFERENT, narrower reason. Reviewer **Raghava Babu Bhogavalli** confirmed (verbatim):

> "App was rejected under Other (legal/malicious/etc.) **only due to the XCA + Paid-via-Atlassian
> requirement.** Please make the necessary changes and re-submit."

- The app declares compatibility with **both Confluence + Jira** → Atlassian requires it to be a
  **Cross-Context App (XCA)** = "multiple-app compatibility".
- **XCA apps MUST use payment model "Paid via Atlassian"** — Free listings are NOT eligible for XCA.
- "Other (legal/malicious/etc.)" was just the BOT's generic dropdown label for this rejection —
  **NOT a separate trademark/legal finding** (reviewer confirmed). The partner's timeline forensic
  (human reviewer 6:16 = real reason; bot 6:21 = generic boilerplate) was correct.

Two pieces of work: **(A) XCA manifest migration** (code) + **(B) Paid-via-Atlassian pricing** (config + a metering rethink).

---

## Part A — XCA manifest migration (code)

### The change (small)
Add an `app.compatibility` block to `manifest.yml`. **Modules + scopes stay unchanged.**

```yaml
app:
  id: ari:cloud:ecosystem::app/e804f31f-1cbf-4f09-86c1-11e36f387fe7
  compatibility:
    confluence:
      required: true     # UI lives in Confluence (globalPage) — the primary install context
    jira:
      required: false    # used via write:jira-work scope for the push — optional product
  licensing:
    enabled: true        # REQUIRED to make the app "Paid via Atlassian" (XCA mandates paid — see Part B)
  runtime:
    name: nodejs24.x
    memoryMB: 512
    architecture: arm64
```

> Both `compatibility` (XCA) and `licensing.enabled` (Paid-via-Atlassian) are manifest changes →
> they ship in the SAME new version. Do them together.

### ⚠️ Prerequisite (the gotcha — verified in the migration tutorial)
*"The app must not have any existing installations in **non-required** Atlassian apps."*
Jira is the non-required (optional) product → you must **uninstall the app from Jira FIRST**, on
every site we control, before deploying the compatibility manifest. The Confluence (required)
installs + their DATA are **preserved** ("all existing installations in the original app remain…
data as before"). No reinstall of Confluence needed.

### Current installs (from `forge install list`, 2026-06-02)
| Env | Site | Products | Action |
|---|---|---|---|
| production | alexacenov.atlassian.net | Confluence + **Jira** | uninstall Jira, later reconnect |
| production | vs-overlord22.atlassian.net | Confluence only | **Atlassian reviewer's site — DON'T touch** (no Jira → doesn't block) |
| development | spec2jira-dev.atlassian.net | Confluence + **Jira** | uninstall Jira, later reconnect |

### Steps (test on DEV first — POLICY §9 stepwise)
1. Edit `manifest.yml` → add the `compatibility` block above.
2. **DEV:** `forge uninstall -e development -p Jira -s spec2jira-dev.atlassian.net`
   → `forge deploy -e development --no-verify`
   → `forge install -e development -p Jira -s spec2jira-dev.atlassian.net` (reconnect optional product)
   → verify cross-product Generate→Push works.
3. **PROD (only after DEV verified):** `forge uninstall -e production -p Jira -s alexacenov.atlassian.net`
   → `forge deploy -e production --no-verify`
   → `forge install -e production -p Jira -s alexacenov.atlassian.net`
   → smoke-test.
4. Run `forge install --upgrade` for Confluence (required) if a scope/consent prompt appears.

### Constraints / gotchas
- XCA is in **Preview**; supports Confluence/Jira/Compass only; only Jira/Confluence can be `required`.
- *"You cannot change the required Atlassian app once installations exist"* → pick Confluence=required correctly NOW.
- Install model: customer installs in the REQUIRED app (Confluence) FIRST, then connects the optional (Jira). This formalizes the old gotcha #10 ("2 installs is normal").
- Uninstall order (future): uninstall from optional apps (Jira) BEFORE the required (Confluence).
- ⚠️ The working tree may also carry the in-flight **Project Context / Distill** feature added 2026-06-02 — it deploys together with the manifest change; no new scopes/egress, so it doesn't affect XCA, but be aware it ships in the same redeploy.

---

## Part B — Paid-via-Atlassian pricing (config + metering rethink)

XCA **forces "Paid via Atlassian"** → which in Atlassian cloud is **per-user** (the app license
matches the host product's user tier). **Flat €39 is NOT available** under this model.

### Recommended pricing (aligns with `memory/monetization-strategy.md`)
- **~€3.90–5 / user / month** above the free tier. (The €39 value-anchor ÷ a 10-user team =
  €3.90/user — so €3.90/user reproduces the €39 anchor for a 10-seat team; the memory's
  "per-seat ~€5/user above 10" is the same range.)
- **Free = in-app 3 breakdowns/month, PERPETUAL** (⚠ SUPERSEDES the earlier "free ≤10 users" — that
  was wrong; confirmed by commit b02e41c + monetization memory). Delivered via the manifest
  `unlicensedAccess` property to unlicensed installs, NOT a €0 Atlassian edition (a free edition cannot
  coexist with paid ones). The 1-10 user band is the PAID floor (€39 BYOK / €69 Managed), not free.
  Monetisation is per-USER on the paid editions; the in-app 3/mo gates the free trial.
- This is a **forced platform change**, NOT a re-litigation of the €39-flat decision — the flat
  model is simply unavailable for XCA.

### ⚠️ Metering rethink (follow-up — NOT a resubmit blocker)
The in-app **"3 breakdowns/month" `ENFORCEMENT_MODE`** (`src/usage.js`) was designed for the FLAT
model (free = 3/mo, Pro = unlimited). Under per-user (free ≤10 users):
- The free/paid split now happens by **user count** (Atlassian licensing), not breakdown count.
  `resolveTier()` already reads `context.license.active`.
- Decide: do free (≤10-user) installs get unlimited breakdowns, or keep a usage cap? This changes
  the meaning of the free tier — rework `usage.js` accordingly.
- For the RESUBMIT: configure the per-user pricing FIRST; refine the in-app metering AFTER.

### Where to configure (and WHY "Paid via Atlassian" was missing — RESOLVED 2026-06-02)
**It is NOT approval-gated** (our earlier assumption was wrong). Atlassian **blocks changing an
existing app from Free → Paid-via-Atlassian in-place.** To unlock it for a Forge app you must:
1. **Enable licensing in the manifest** — add `app.licensing.enabled: true` (shown in Part A). This
   is what makes the app sellable; without it the app is permanently "Free" and the option never appears.
2. **Deploy + release a new version** carrying that change.
3. **THEN set the price:** marketplace.atlassian.com → profile menu → **Manage vendor account** →
   [app name] → **Pricing** tab → **Cloud** → **Edit** → choose **Paid via Atlassian** + editions →
   **Submit pricing**. (App-level; the version-level "Payment model" that showed locked to "Free" is
   derived from this.)
- The app code **already** reads `context.license` (`usage.js` `resolveTier` → `license.active` ⇒ Pro),
  so the entitlement check is mostly in place — only the manifest flag + new version + pricing config remain.
- **Test licensing in dev** without buying: `forge variables set -e development LICENSE_OVERRIDE active`
  (or `inactive`) before deploying.

---

## Part C — Resubmit
After A (manifest migrated + deployed) and B (Paid-via-Atlassian configured):
1. Reconfigure the listing's payment model → **Paid via Atlassian**.
2. Verify the latest version (4.x) picks up the XCA-enabled build.
3. **Resubmit** → new ECOHELP ticket → review.

---

## Parked risk (NOT acting now — future-watch)
`spec2jira.com` (domain) + **"Spec2JIRA"** (vendor name) are an **objective brand-guideline
violation** (*"Atlassian or our apps should never be used in your domain"*). Reviewer confirmed it
is NOT the issue this round (XCA-only), but it MAY surface on a later review. If it does → rebrand
the **domain** (→ e.g. `spec2tickets.com`) + **vendor name** (→ "Spec2Tickets", unifying with the
app name) + emails + listing URLs + the in-app "Spec2JIRA Settings" text. The APP name
("Spec2Tickets for Confluence and Jira") uses the ALLOWED "X for Jira" pattern → fine.

## References
- App compatibility (XCA): https://developer.atlassian.com/platform/forge/app-compatibility/
- Migration tutorial: https://developer.atlassian.com/platform/forge/migrating-a-forge-app-to-support-multiple-atlassian-apps/
- Brand guidelines: https://developer.atlassian.com/platform/marketplace/atlassian-brand-guidelines-for-marketplace-partners/
- Pricing & billing: https://developer.atlassian.com/platform/marketplace/pricing-payment-and-billing/
- Project memory: `memory/marketplace-launch-state.md`, `memory/monetization-strategy.md`

---

С усмивка ✨ — security премина; остава „XCA + per-user pricing" (rename-free config + малка manifest промяна, не архитектура).
