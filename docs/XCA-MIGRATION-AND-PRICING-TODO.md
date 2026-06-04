# XCA Migration + Paid-via-Atlassian Pricing — DONE + forward TODO

> ## ✅ STATUS: XCA migration DONE — **v5.3.0 resubmitted to Marketplace 2026-06-04, awaiting review.**
>
> The Paid-via-Atlassian "more than one parent software" blocker is **RESOLVED via the vendor-portal
> Compatibility tab** (app → [version] details → Compatibility → remove Jira → Confluence = sole billing
> parent) — **NOT via the manifest** (removing `compatibility.jira` / `jira.required:false` did NOT work;
> that hypothesis is RETIRED). The Jira push DOES still need the Jira install (gotcha #10 holds; Jira =
> an optional installed *connection*, reached via `write:jira-work` + `asUser().requestJira`). Licensed
> (PvA) apps install via **Marketplace only** — no `forge install` on production.
>
> **Pricing LIVE:** BYOK Pro (= the **Standard** edition) shipped as a **single edition** at
> **"100% of Confluence price" = $6.70/user** ($57 ≤10 flat, declining curve kept, 1.5× multi, USD).
> **No in-app Free tier** (removed 2026-06-03) — evaluation = the 30-day Atlassian trial.
>
> Full record: `memory/marketplace-launch-state.md` + `memory/monetization-strategy.md` + the CLAUDE.md
> handover. **Everything below the "Forward TODO" section is the historical planning record** (kept for
> the hard-won facts; obsolete decisions are marked superseded).

---

## ▶ Forward TODO — editions Phase 2 (Managed Pro) + the open follow-ups

These are the **still-pending** items (the XCA migration + BYOK-Pro resubmit are DONE):

**1. Editions Phase 2 — add Managed Pro (the "Advanced" edition) — POST-PUBLISH only.**
Editions are a Marketplace capability that appears **only after the app is Paid-via-Atlassian AND live on
Marketplace** (empirically confirmed 2026-06-04: the portal Editions tab is unlocked but says *"…must be
Paid via Atlassian and live on Marketplace before you can create app editions"*). So Managed Pro can be
added only **after** the v5.3.0 resubmit is approved + published. The work then:
- [ ] Define the **Advanced** edition + set its price — **TBD ~$10-13/user** (~1.5-2× BYOK), via the
  3-phase editions process (Plan → Build → Publish-editions) with its **own separate Marketplace review**.
  (Existing BYOK customers stay on Standard; "existing pricing → Standard" is automatic.)
- [ ] Set the encrypted Managed key in BOTH envs: `forge variables set --encrypt MANAGED_ANTHROPIC_KEY <our-key>`.
- [ ] **Managed compliance** (required for the Advanced edition — content runs under OUR Anthropic key):
  legal-review + publish the customer **DPA**; reconcile the Atlassian privacy questionnaire to the Managed
  truth (**≤29-day** Anthropic/Batches retention, SCCs auto-incorporated, Anthropic = sub-processor);
  publish the sub-processor list; add the privacy-policy "Managed" sections. (Drafts under `docs/compliance/`.)
  ℹ️ ZDR is NOT pursued (we disclose the 29-day Batches retention) → **no Anthropic ZDR request needed**;
  reselling needs **no special approval** (Commercial Terms §A.1).
- [ ] Dev-test the two editions: `forge install -e development --license Standard` / `--license Advanced`
  (`--license` is DEV-ONLY). Confirm a Managed (Advanced) user at the fair-use cap is routed to BYOK.

**2. Open follow-ups (next session, while the review is pending):**
- [ ] Update the marketing site pricing — `spec2jira.com/docs` still shows stale figures; set it to
  **$6.70 / 100%-of-Confluence** and drop the dead "Free 3/mo". (The site is a **separate GitHub Pages
  repo**: `…\AI-delivery\ai-delivery-platform\MVP-roll-out\spec2jira-site\spec2jira-site` — edit the
  docs/privacy HTML there → `git push` → GitHub Pages auto-deploys.)
- [ ] After approval → **publish** (partner controls the "Let me control when app is published" gate).
- [ ] **POST-APPROVAL:** wire `PRO_UPGRADE_URL` + `MARKETPLACE_REVIEW_URL` (Forge prod variables) →
  the live Marketplace subscription/review URLs (the `LimitReachedScreen` / Account-panel CTAs are
  info-only until then).

**Already DONE in code (dev → resubmit; for reference)** — the manifest carries `app.compatibility`
(Confluence required) + `app.licensing.enabled` + `app.licensing.editionsEnabled`; `src/usage.js` has the
tier model (`byokPro`=Standard / `managedPro`=Advanced, `capabilitySet` resolution defaulting undefined →
BYOK Pro, `MANAGED_USER_CAP`=10 per-user metered `usage:YYYY-MM:u:<accountId>`); `src/index.js` has the
Managed key path (`MANAGED_ANTHROPIC_KEY`, `keySource` stamped on the job) + a defensive `license_required`
backstop; the frontend has edition-aware onboarding + in-app Settings + the at-cap → BYOK routing. The
in-app Free tier / `unlicensedAccess` / push-gate / guest-guard were all **removed 2026-06-03** (trial → paid).

---

## Hard-won XCA / Forge facts (still useful — keep)

These survived the migration and are NOT obviously duplicated elsewhere:

1. **The PvA single-parent fix is a PORTAL action, not a manifest one.** "More than one parent software is
   not supported for paid via Atlassian apps" is fixed in the vendor portal → app → [version] details →
   **Compatibility tab → remove Jira** (Confluence = sole billing parent). Editing `manifest.yml`
   (`jira.required:false` OR removing the `compatibility.jira` block) did **NOT** fix it — both forms still
   showed Jira Cloud [REQUIRED] on the publish screen (driven by the `write:jira-work` SCOPE, not the
   compatibility block). The Compatibility tab is the listing's billing-parent declaration, independent of the manifest.
2. **A licensed (PvA) app installs via Marketplace ONLY** — `forge install` on production fails
   (`LICENSED_APP_INSTALL_NOT_PERMITTED`); `forge install --upgrade` / `--license` are **dev-only**.
   `forge deploy -e production` **auto-creates** the Marketplace version (no manual portal "Create version").
   The old runbook "forge install on prod" step is WRONG for a licensed app.
3. **Editions are POST-PUBLISH** — they appear only after the app is Paid-via-Atlassian AND live on
   Marketplace, NOT from `editionsEnabled: true` alone. So a two-edition app ships its FIRST edition at
   publish and adds the second via the editions phases after approval.
4. **`editionsEnabled: true`** is kept in the manifest even for the single-edition launch (the publish
   wizard accepted it alongside one price). `resolveTier` safely defaults an undefined `capabilitySet` →
   BYOK Pro, so the single-edition launch resolves correctly (`src/usage.js`).
5. **In-place upgrade from a non-XCA/non-licensed version to an XCA+licensed version FAILS** (Atlassian
   backend 500) — the transition needs a FRESH install; real customers install the new version fresh
   post-approval.
6. **The Jira push needs the Jira install** (gotcha #10 holds) — `asUser().requestJira` on a Confluence-only
   install 403s ("lack permission to view <project>"); with `forge install -p jira` the push works. Jira is
   an optional installed *connection*, NOT a billing parent.
7. **`@forge/api ≥ 5.1.1`** + latest CLI are required for XCA (we have `^7.2.1`).
8. **The XCA *manifest* migration's "uninstall Jira first" gotcha** (only relevant for the in-place
   compatibility-deploy path, which is now moot since prod installs via Marketplace): the first XCA-compatibility
   `forge deploy` is BLOCKED while the app has an install in the non-required app (Jira) —
   *"Unable to deploy an app to an environment with an existing installation in an Atlassian app that is not
   the required Atlassian app."* The order was `forge uninstall -p jira` → deploy → reconnect Jira.

---

---

> ⚠ **HISTORICAL PLANNING RECORD BELOW (2026-06-02/03)** — superseded by the STATUS + Forward-TODO
> sections above. Kept for the reviewer's-verdict context and the hard-won learnings already extracted
> above. **Obsolete decisions** (the full-hybrid-in-resubmit plan, €4.90/€9.90 + €3.90/€6.90 prices, the
> step-by-step manifest/install migration, the "remove `compatibility.jira`" fix hypothesis) **are marked
> superseded inline.** Do NOT act on the steps below — use the Forward TODO.

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

## Part A — XCA manifest migration (code) — ✅ EXECUTED (with corrections)

> ⚠ **SUPERSEDED as a plan — see the Forward TODO + "Hard-won facts" above.** The `compatibility` +
> `licensing.enabled` + `editionsEnabled` manifest changes below DID ship. BUT two things here proved
> WRONG against the live platform: ① the manifest `compatibility.jira` block did **NOT** resolve the
> Paid-via-Atlassian "more than one parent" error — the **vendor-portal Compatibility tab** did
> (remove Jira there); ② the **install steps for PRODUCTION are WRONG for a licensed app** — a licensed
> (PvA) app installs via **Marketplace only**, NOT `forge install` (`forge deploy -e production`
> auto-creates the version). The "uninstall Jira first" gotcha applies only to the in-place
> compatibility-*deploy* path (now moot). Read this section as history.

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

> ⚠ **SUPERSEDED — kept for history only.** Only the high-level conclusion survives: **Paid via Atlassian
> is per-user** (no flat fee). EVERYTHING ELSE in this section is RETIRED:
> - **All the prices below are dead** (€3.90–5/user, €39/€69 floors, and the later €4.90/€9.90). The LIVE
>   price is **BYOK Pro / Standard = $6.70/user** ("100% of Confluence", $57 ≤10, declining, 1.5× multi, USD);
>   Managed Pro / Advanced = editions Phase 2, TBD ~$10-13. See the Forward TODO + `memory/monetization-strategy.md`.
> - **"Free = in-app 3/mo PERPETUAL via `unlicensedAccess`" is RETIRED** (2026-06-03) — there is NO in-app
>   Free tier; evaluation is the 30-day Atlassian trial; unlicensed users are blocked natively (no `unlicensedAccess`).
> - The **"metering rethink (free ≤10 users?)"** question is moot — there is no free tier to meter.
> - The **`LICENSE_OVERRIDE` dev-test trick is superseded** by `forge install --license Standard|Advanced` (dev-only).

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

## Part C — Resubmit — ✅ DONE

> ✅ **EXECUTED:** resubmitted as **v5.3.0 on 2026-06-04** (Paid via Atlassian; Confluence sole billing
> parent via the portal Compatibility tab; BYOK Pro single edition at $6.70). Awaiting Atlassian review.
> (The "verify the latest version (4.x)" note below is stale — prod is now v5.x.) Original plan:

1. Reconfigure the listing's payment model → **Paid via Atlassian**.
2. Verify the latest version picks up the XCA-enabled build.
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

С усмивка ✨ — XCA + Paid-via-Atlassian = DONE (v5.3.0 resubmitted, awaiting review). Остава само editions Phase 2 (Managed Pro) след одобрение — вж. Forward TODO най-горе.
