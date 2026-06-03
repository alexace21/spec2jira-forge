# Dev Verification Runbook — XCA + Hybrid Pricing Resubmit

> **Purpose.** A single-session, checkbox-by-checkbox runbook to confirm **absolutely everything**
> on the **dev site** before the Marketplace resubmission of the XCA (Cross-Context App) migration +
> hybrid pricing (BYOK Pro / Managed Pro). One solo developer (the product owner)
> follows this top-to-bottom in one sitting. Nothing here touches production until the final gate.
>
> **Model note (2026-06-03 — the in-app Free tier was REMOVED).** There is NO in-app Free 3/mo tier,
> NO `unlicensedAccess`, NO guest-guard (`accountType`), and NO push-gate (`push_requires_license`) —
> all removed. The app is **licensed-only**: Paid-via-Atlassian admits only licensed users by default,
> and the free **evaluation** is the standard **30-day Atlassian trial** (which reads as an active
> license at runtime → resolves to a paid tier). A truly unlicensed user is simply blocked by Atlassian
> (with a defensive `license_required` backstop in the resolvers). Model = **trial → paid**.
>
> **What is being verified (the release under test):**
> - **XCA manifest**: `app.compatibility` (Confluence required / Jira optional) + `app.licensing.enabled` +
>   `app.licensing.editionsEnabled`. **No `unlicensedAccess`** on any module (licensed-only). `@forge/api ^7.2.1`.
> - **Two paid editions**: `Standard` = **BYOK Pro €4.90/seat, UNLIMITED** (customer's own Anthropic key) ·
>   `Advanced` = **Managed Pro €9.90/seat, cap 10 breakdowns/USER/month** (OUR key from `MANAGED_ANTHROPIC_KEY`).
>   Evaluation = the **30-day Atlassian trial** (no in-app Free tier). Floors ≤10 users: **€49 / €99** (portal-set).
> - **Tier resolution** by `context.license.capabilitySet` (`capabilityStandard`→BYOK Pro,
>   `capabilityAdvanced`→Managed Pro, active-but-unknown→BYOK Pro safe default, no active license→Unlicensed
>   blocked) via `getAppContext()` (`src/usage.js` `resolveTier`).
> - **Per-user metering**: Managed counter `usage:YYYY-MM:u:<accountId>`; BYOK `usage:YYYY-MM`.
>
> **Environment under test**
> - Dev site: **`spec2jira-dev.atlassian.net`** (Confluence + Jira) · Jira project key: **`SDTY`** (SCRUM-DEV).
> - App id: `ari:cloud:ecosystem::app/e804f31f-1cbf-4f09-86c1-11e36f387fe7`.
> - Repo: `C:\Software Engineer\Success\Spec2Tickets\spec2jira-forge` · branch `feature/product-improvements`.
> - All `forge` commands target `-e development`. **Never** add `-e production` until Section 12.
>
> **Prerequisites (have these ready before you start)**
> - Logged into the Forge CLI (`forge whoami`) as the app owner.
> - Local **Node 24.x** (must match the `nodejs24.x` runtime; gotcha #2) and `@forge/cli@latest`.
> - **Two** Atlassian accounts you can log into `spec2jira-dev.atlassian.net` with: your **admin** account
>   and **one more licensed user** (needed for the per-user Managed metering test, Section 7). (No
>   guest/unlicensed identity is needed anymore — the Free/guest path was removed.)
> - **Two Anthropic API keys**: (a) a **BYOK** key to paste into Settings, and (b) **our Managed key**
>   for `MANAGED_ANTHROPIC_KEY`. (They can be the same key for dev testing, but using two makes the
>   "whose key was spent" question unambiguous in the Anthropic console.)
> - A Confluence **spec page** in the dev site with ≥ ~50 chars of real content to generate from.
>
> **How to read each step:** `[ ] action` → **Expected:** observable result → **Why it matters:** one line.
> Steps tagged **⭐ CRITICAL EMPIRICAL** resolve open uncertainties that *cannot* be known except by
> running them on a live install — **do not skip or assume these.**
>
> **The 2 ⭐CRITICAL items you must not skip:** §6 `accountId` non-null on the Custom-UI bridge ·
> §7 per-user Managed metering (two users). (The former §4 Free-tier reachability and §5 guest-guard
> `accountType` items are REMOVED — moot after the Free-tier drop; the unlicensed path no longer exists.)

---

## Section 0 — Prerequisites & deploy

- [ ] **0.1** Confirm CLI identity and Node version.
  `forge whoami` and `node --version`.
  **Expected:** logged in as the app owner; Node prints `v24.x`.
  **Why it matters:** a Node-version mismatch caused subtle deploy issues (gotcha #2); wrong account deploys nothing useful.

- [ ] **0.2** Confirm `@forge/api ≥ 5.1.1` (XCA requirement).
  `node -p "require('./package.json').dependencies['@forge/api']"`.
  **Expected:** `^7.2.1` (≥ 5.1.1). Also confirm `@forge/events` is **pinned to `^1.0.3`** if present, never 2.x.
  **Why it matters:** XCA needs `@forge/api ≥ 5.1.1`; `@forge/events` 2.x `Queue.push()` is broken (gotcha #1).

- [ ] **0.3** Build the Custom UI.
  `cd "C:\Software Engineer\Success\Spec2Tickets\spec2jira-forge\static\hello-world"; npm run build`.
  **Expected:** build succeeds; `static/hello-world/build` is freshly written (it is gitignored, so always rebuild).
  **Why it matters:** `forge deploy` ships whatever is in `build/`; a stale bundle ships stale UI / hides JSX errors.

- [ ] **0.4** Deploy code to dev — **uninstall Jira FIRST** (XCA-compatibility migration gotcha).
  ⚠ **EMPIRICALLY CONFIRMED 2026-06-03:** the FIRST compatibility deploy is BLOCKED while the app has an install
  in a NON-required app (Jira). Atlassian errors: *"Unable to deploy an app to an environment with an existing
  installation in an Atlassian app that is not the required Atlassian app."* So the corrected per-env sequence is:
  `cd "C:\Software Engineer\Success\Spec2Tickets\spec2jira-forge"` →
  `forge uninstall -e development -p Jira -s spec2jira-dev.atlassian.net` →
  `forge deploy -e development --no-verify`.
  (Confluence — the required app — install + data ARE preserved; you reconnect Jira in §0.7.)
  **Expected:** the Jira uninstall succeeds, then "Deployed … to the development environment." No fatal errors.
  **Why it matters:** without the Jira uninstall first the compatibility deploy hard-fails (verified live). `--no-verify` is required because the linter false-positives `resolver:` on `globalPage` (gotcha #13); Section 1 still runs `forge lint` separately to confirm the *real* errors are clean.

- [ ] **0.5** Set the Managed key (encrypted) in dev.
  `forge variables set --encrypt -e development MANAGED_ANTHROPIC_KEY <our-anthropic-key>`.
  **Expected:** "Set variable MANAGED_ANTHROPIC_KEY". Confirm with `forge variables list -e development` (value shown as `[encrypted]`/hidden).
  **Why it matters:** Managed Pro generation calls Anthropic with THIS key; unset ⇒ `managed_unavailable` (Section 8).

- [ ] **0.6** Set dev enforcement to `meter` for free-running tests, *then* be ready to flip to `block`.
  `forge variables set -e development ENFORCEMENT_MODE meter`.
  **Expected:** set. `forge variables list -e development` shows `ENFORCEMENT_MODE = meter`.
  **Why it matters:** `ENFORCEMENT_MODE` now governs only the **Managed per-user fair-use cap** (10/USER/mo); `meter` lets a Managed user exceed it without dead-ending while you exercise flows. You will deliberately switch to `block` in Section 7 to test the cap. (Unset ⇒ `block` per `usage.js`.)

- [ ] **0.7** Install the app on the dev site for **BOTH** products (Confluence upgrade + Jira reconnect).
  Confluence (the required app, preserved through the deploy) — upgrade for the new licensing consent:
  `forge install --upgrade -e development -p Confluence -s spec2jira-dev.atlassian.net`.
  Jira (uninstalled in §0.4) — reconnect the optional product:
  `forge install -e development -p Jira -s spec2jira-dev.atlassian.net`.
  **Expected:** both succeed; a **licensing/scope re-consent prompt** is expected on the licensing-enabled manifest — accept it.
  **Why it matters:** the UI is a Confluence globalPage but push uses `requestJira` — both installs are mandatory (gotcha #10); the manifest now also carries `licensing.enabled` so consent changes. (Jira is a fresh install because the XCA-migration deploy required uninstalling it first, §0.4.)

- [ ] **0.8** List installs and note the current deployed version.
  `forge install list` and `forge deployments list -e development` (or check the Developer Console).
  **Expected:** `spec2jira-dev.atlassian.net` shows **Confluence AND Jira**; the dev environment shows the just-deployed version.
  **Why it matters:** establishes the known-good baseline you are verifying against; confirms 2 product entries (normal for XCA, §1).

---

## Section 1 — XCA / manifest integrity

- [ ] **1.1** Run the linter and read the output carefully.
  `forge lint`.
  **Expected:** **no errors** — no compatibility/licensing schema errors. The only acceptable noise is the known false-positive about `resolver:` on `globalPage` (gotcha #13), which is why deploy uses `--no-verify`.
  **Why it matters:** a clean lint is part of the resubmit gate. (The app declares **no `unlicensedAccess`** on any module — see §1.3 — so the old "`unlicensedAccess` not supported on `globalSettings`" hard error cannot occur.)

- [ ] **1.2** Confirm the compatibility + licensing block in the deployed manifest.
  Open `manifest.yml` and confirm `app.compatibility.confluence.required: true`, `app.compatibility.jira.required: false`, `app.licensing.enabled: true`, `app.licensing.editionsEnabled: true`.
  **Expected:** all four present exactly as above.
  **Why it matters:** `editionsEnabled` is what yields **two** editions (not one price); Confluence-required is **immutable once installs exist** — it must be correct now.

- [ ] **1.3** Confirm there is **no `unlicensedAccess`** anywhere in the manifest.
  In `manifest.yml`, confirm **no** module (`confluence:globalPage`, `confluence:contentAction`, `confluence:globalSettings`) declares `unlicensedAccess`.
  **Expected:** the property is absent everywhere — the app is licensed-only.
  **Why it matters:** the in-app Free tier was removed 2026-06-03, so there is no unlicensed surface; Atlassian admits only licensed users (or trial users) to a Paid-via-Atlassian app by default. (This also makes the §1.1 globalSettings lint error structurally impossible.)

- [ ] **1.4** Confirm there is **no remote host** (FIT/security regression guard).
  Confirm `manifest.yml` has **no `remotes:`** block and `permissions.external.fetch` egresses only to `https://api.anthropic.com`.
  **Expected:** no `remotes:`; only the `api.anthropic.com` egress.
  **Why it matters:** the v4.2.0 FIT rejection was about a remote host validating the invocation token — there is no remote host now, and this must stay true through the resubmit.

- [ ] **1.5** Confirm 2 entries in Manage Apps is the live reality.
  On `spec2jira-dev.atlassian.net` → **Apps → Manage apps**, find Spec2Tickets.
  **Expected:** the app appears under both Confluence and Jira contexts (2 entries) — normal for a cross-product app.
  **Why it matters:** reviewers expect this for XCA; confirming it now avoids a "why two?" surprise at submission.

---

## Section 2 — Edition / tier resolution

> Edition testing in dev uses the license override on (re)install. After each install with a different
> `--license`, **fully reload the app page** (the license is read at invocation via `getAppContext()`).

- [ ] **2.1** Install with the **Standard** (BYOK Pro) license override.
  `forge install --upgrade -e development -p Confluence -s spec2jira-dev.atlassian.net --license Standard`.
  Open the app → **Account / Plan** panel (in Settings or the Ready screen badge).
  **Expected:** plan reads **"BYOK Pro"** (unlimited; no monthly cap shown).
  **Why it matters:** proves `capabilityStandard` → `byokPro` in `resolveTier`, and that `getAppContext()` reflects the dev override.

- [ ] **2.2** Install with the **Advanced** (Managed Pro) license override.
  `forge install --upgrade -e development -p Confluence -s spec2jira-dev.atlassian.net --license Advanced`.
  Reload the app → Account panel.
  **Expected:** plan reads **"Managed Pro"** with a **fair-use allowance** wording (e.g. "10 breakdowns this month (fair-use allowance)").
  **Why it matters:** proves `capabilityAdvanced` → `managedPro`, and that the UI distinguishes the fair-use cap from a free-trial cap.

- [ ] **2.3** Install with **no** license (unlicensed — the defensive backstop, not a product offering).
  `forge install --upgrade -e development -p Confluence -s spec2jira-dev.atlassian.net` (omit `--license`).
  Reload the app.
  **Expected:** the app does **not** render its normal flow — Atlassian shows its native subscribe/trial prompt for the Paid-via-Atlassian app, and any resolver call returns the defensive `license_required` (a clean "subscribe or start a trial" prompt, never a raw 401).
  **Why it matters:** proves no-active-license → the blocked `unlicensed` tier (`resolveTier` default) — there is NO in-app Free path. A real evaluator uses the 30-day Atlassian trial instead, which reads as an active license (test that via the `--license` overrides in §2.1/§2.2).

- [ ] **2.4** (Sanity) Confirm an *unknown* capability resolves to BYOK Pro, not Managed.
  Trust the code path if you cannot synthesize an unknown set: `resolveTier` returns `byokPro` for any active license whose `capabilitySet` is neither standard nor advanced (the safe default — never bills us).
  **Expected:** documented behavior confirmed by reading `resolveTier` in `src/usage.js` (active + unknown `capabilitySet` ⇒ `byokPro`).
  **Why it matters:** a casing/naming drift in the capability set must never accidentally hand out our Managed key.

---

## Section 3 — Pricing display (data-driven, no hardcode)

- [ ] **3.1** Verify the Account panel shows both edition prices from the data, not literals.
  On any install, open the Account panel where the upgrade nudge appears (e.g. when remaining = 0, or the standing plan card).
  **Expected:** **BYOK Pro €4.90/user/mo** and **Managed Pro €9.90/user/mo** are shown, sourced via `findPrice(usage, "byokPro"/"managedPro")` from the `pricing[]` array (`getUsage` → `pricingTable()`).
  **Why it matters:** prices must trace to `TIERS` in `usage.js` (single source of truth), so a price change is one edit — not a UI hunt.

- [ ] **3.2** Verify the **LimitReached / upgrade** screen shows both edition rows with correct prices.
  Trigger it by driving a **Managed** user to the per-user fair-use cap in `block` mode (§7.5), and read the two `EditionRow`s.
  **Expected:** two rows: **BYOK Pro €4.90** (unlimited, own key) and **Managed Pro €9.90** (we run it). Prices match `pricingTable()`. (A Managed-at-cap user is routed to BYOK Pro for unlimited — `fairUse: true`.)
  **Why it matters:** this is the conversion surface; wrong/hardcoded prices here mis-sell the editions.

- [ ] **3.3** Confirm the prices in code equal the portal prices you will set.
  Read `src/usage.js` `TIERS`: `byokPro.price === '€4.90/user/mo'`, `managedPro.price === '€9.90/user/mo'`.
  **Expected:** exact match to the €4.90 / €9.90 you will configure in the vendor portal (§12), floors €49/€99 ≤10 users.
  **Why it matters:** the in-app copy and the Atlassian-billed price must agree or customers see a contradiction.

---

## Section 4 — REMOVED (moot after the Free-tier drop)

> **Was:** "⭐ CRITICAL EMPIRICAL — Free-tier reachability under XCA". **REMOVED 2026-06-03.**
> The in-app Free 3/mo tier and the `unlicensedAccess` surface it rode on no longer exist — the app is
> licensed-only (evaluation = the 30-day Atlassian trial). There is no unlicensed-user path to reach, so
> nothing here to verify. The "is an unlicensed user blocked?" question is now covered by §2.3 (Atlassian
> blocks them natively; the resolver returns the defensive `license_required`).

---

## Section 5 — REMOVED (moot after the Free-tier drop)

> **Was:** "⭐ CRITICAL EMPIRICAL — Guest-guard (`accountType`)". **REMOVED 2026-06-03.**
> The guest-guard (downgrade-to-BYOK on a non-`'licensed'` `accountType`) was deleted along with the
> Free/guest path — every accessing user is now licensed, so there is no guest to guard against. Managed
> exposure is bounded purely by the backend-trusted per-user `accountId` cap (`MANAGED_USER_CAP`), verified
> in §6 (the counter key) and §7 (the two-user cap). `accountType` is no longer read anywhere.

---

## Section 6 — ⭐ CRITICAL EMPIRICAL — `accountId` on the Custom-UI bridge

> **Open uncertainty this resolves:** the Managed per-user counter keys on `context.accountId`
> (`usage:YYYY-MM:u:<accountId>`). If `accountId` is null/absent in the Custom-UI resolver context,
> the key collapses to `:u:unknown` and **all Managed users share one counter** — the per-user cap is
> fictional. Must be confirmed live.

- [ ] **6.1** ⭐ On the **Advanced** install, open the app as a licensed user and read the `getUsage` payload.
  The cleanest signal is already returned: `getUsage` includes `usageKey`. Inspect it via the browser devtools Network tab (the `getUsage` invoke response) on the Spec2Tickets iframe.
  **Expected:** `usageKey` = `usage:YYYY-MM:u:<a-real-accountId>` — a non-empty Atlassian accountId, **not** `:u:unknown`.
  **Why it matters:** this is the direct, no-code-change proof that the per-user counter is real for Managed.

- [ ] **6.2** ⭐ Cross-check via logs.
  After a Managed generation, `forge logs -e development --since 10m` and find the usage activity.
  **Expected:** the accountId in the key matches the logged-in user; consistent across calls within the session.
  **Why it matters:** confirms `accountId` is stable and server-trusted, not a per-call random or client value.

- [ ] **6.3** ⭐ Confirm BYOK does **not** key per-user.
  On a **Standard** (BYOK Pro) install, inspect `getUsage().usageKey`.
  **Expected:** `usage:YYYY-MM` (no `:u:` suffix).
  **Why it matters:** BYOK is per-site by design (one shared key, unlimited); a stray per-user key there would mis-meter the site-wide analytics counter. Only Managed (we pay) keys per-user.

---

## Section 7 — Metering behavior (BYOK unlimited, Managed per-user 10)

- [ ] **7.1** Flip dev enforcement to **block** for this section.
  `forge variables set -e development ENFORCEMENT_MODE block`.
  **Expected:** set. (Remember to flip back to `meter` after, or leave `block` if you are done testing — it is the prod default anyway.)
  **Why it matters:** the Managed per-user cap only hard-blocks in `block` mode; `meter` would let the 11th through.

- [ ] **7.3** **BYOK Pro is unlimited.** On the **Standard** install, run more than 3 generations.
  **Expected:** no `quota_exceeded`; `getUsage` shows `unlimited: true`, `limit: null`; usage is counted only for analytics.
  **Why it matters:** unlimited is the BYOK value prop and is safe (customer pays compute).

- [ ] **7.4** ⭐ **Managed per-user 10 — TWO users, each their own 10.** On the **Advanced** install:
  (a) as **User A**, generate a few times; (b) as **User B**, generate.
  Inspect `getUsage().usageKey`/`used` for each (Network tab) — and/or `forge logs`.
  **Expected:** User A and User B have **distinct** keys (`…:u:<A>` vs `…:u:<B>`) and **independent** counts — User B starts at 0 regardless of User A's usage.
  **Why it matters:** confirms the per-user (not pooled, not per-site) Managed allowance — the loss-bound that makes €9.90/seat safe.

- [ ] **7.5** ⭐ **Managed at cap → fair-use message (contact us / BYOK).** Drive one Managed user to `MANAGED_USER_CAP` (10), or temporarily lower it: `forge variables set -e development MANAGED_USER_CAP 2`, redeploy, hit the cap, then **restore to 10**.
  **Expected:** at cap, `quota_exceeded` with **`fairUse: true`** and copy that says *contact us about higher-volume Managed access, or switch to BYOK Pro for unlimited* — **not** "subscribe to a higher tier".
  **Why it matters:** Managed over-cap must route to BYOK/contact (we pay compute) — `fairUse: true`, distinct from a "subscribe to a higher tier" upsell.

- [ ] **7.6** Confirm the KVS key shapes in logs.
  `forge logs -e development --since 30m` after the above.
  **Expected:** Managed activity references `usage:YYYY-MM:u:<accountId>`; BYOK references `usage:YYYY-MM`. (Restore `MANAGED_USER_CAP`/`ENFORCEMENT_MODE` if you changed them.)
  **Why it matters:** the key shape is the metering contract; a wrong shape silently breaks billing fairness.

---

## Section 8 — Managed key path (our key is actually used)

- [ ] **8.1** **Managed breakdown succeeds with NO customer BYOK key.** On the **Advanced** install, **clear** any stored BYOK key (Settings → clear key), then Generate.
  **Expected:** generation **succeeds** — proving it used `MANAGED_ANTHROPIC_KEY`, not a customer key. Optionally confirm the spend appears on **our** Anthropic account, not the customer's.
  **Why it matters:** this is the core Managed promise — the customer needs no key of their own.

- [ ] **8.2** **Poll / fetch / cycle-repair complete on the Managed key.** Let the same job run to completion (batch ended → Review).
  **Expected:** `pollJobStatus` and `fetchBatchResults` complete; if a dependency cycle exists, cycle-repair also runs — all on the job's stamped `keySource: 'managed'` (the batch is bound to the key that created it).
  **Why it matters:** the batch is key-bound; if poll/fetch re-resolved to BYOK they'd 401/return nothing (gotcha — key reuse at `index.js:1182`).

- [ ] **8.3** **Distill (Project Context) uses the Managed key + is gated by the per-user cap.** On the Advanced install with no BYOK key, run **Distill with Claude** on some source text.
  **Expected:** the 6-step distill completes using the Managed key; if the user is at their per-user cap, distill returns `managed_unavailable` with a fair-use "switch to BYOK" message (`index.js:509`).
  **Why it matters:** distill is an LLM call too — it must also draw on our key for Managed and respect the same cap, or it leaks free Managed compute.

- [ ] **8.4** **`MANAGED_ANTHROPIC_KEY` unset → graceful `managed_unavailable`.** Temporarily unset it: `forge variables unset -e development MANAGED_ANTHROPIC_KEY`, redeploy, attempt a Managed Generate, then **re-set it** (§0.5) and redeploy.
  **Expected:** `startGeneration` returns **`managed_unavailable`** ("temporarily unavailable… contact support or switch to BYOK"), **not** a crash or a silent fall-through to the customer's key. A mid-flight job whose key vanished stays `batched` with a retry message (`index.js:1197`).
  **Why it matters:** a missing server key must degrade gracefully and never silently spend the wrong key (POLICY §11).

---

## Section 9 — Push to Jira (licensed tiers)

> **Note (2026-06-03):** the explicit in-app **push-gate** (`push_requires_license`) was REMOVED along
> with the Free tier — there is no unlicensed user to gate, because Atlassian admits only licensed/trial
> users to a Paid-via-Atlassian app. Push is reachable by every (licensed) user; this section now just
> confirms the cross-product write works on the paid tiers. (The former §9.1 "Free → push blocked" test
> is moot and removed.)

- [ ] **9.2** **Licensed → push creates issues in Jira.** On a **Standard** (or Advanced) install, Generate → Review → Push.
  **Expected:** the chunked push runs (progress bar) and creates **1 Epic + N Stories + Subtasks + dependency links + category labels** in project **`SDTY`**; success screen deep-links open the Epic + Stories.
  **Why it matters:** confirms the cross-product `asUser().requestJira` write works end to end for a licensed user.

- [ ] **9.3** Confirm push works regardless of the Anthropic key (auth is `asUser`, not key-based).
  The Advanced (Managed) push in 9.2 should work even with **no BYOK key** stored.
  **Expected:** push succeeds on Managed without a customer key (push auth is `asUser`, independent of the Anthropic key).
  **Why it matters:** separates the two auth concerns — Anthropic key (generation) vs Jira `asUser` (push); a Managed user must be able to push.

---

## Section 10 — Full E2E per tier (incl. Project Context)

- [ ] **10.1** **BYOK Pro full E2E.** Standard install + BYOK key: pick page → Generate → Review (edit a feature) → Push → verify in Jira.
  **Expected:** clean run; issues created in `SDTY`; usage shows unlimited.
  **Why it matters:** the paid BYOK happy path is the primary revenue flow.

- [ ] **10.2** **Managed Pro full E2E.** Advanced install, no BYOK key: Generate (our key) → Review → Push → verify in Jira.
  **Expected:** clean run on the Managed key; issues created; per-user count incremented by 1.
  **Why it matters:** the paid Managed happy path — the differentiated "we run it" offer.

- [ ] **10.3** **Project Context distill → inject (BYOK).** Standard install: create/save a context profile via **Distill with Claude**, select it on the Ready screen, Generate.
  **Expected:** distill produces a multi-category profile; the generation reflects the injected vocabulary **without** changing scope/authored ACs (the decisive boundary).
  **Why it matters:** P1 Project Context is a shipped differentiator; verify it works under the BYOK key path.

- [ ] **10.4** **Project Context distill → inject (Managed).** Advanced install, no BYOK key: distill + generate with a profile selected.
  **Expected:** distill + generation both run on the Managed key; profile applied.
  **Why it matters:** confirms the context feature is fully available to Managed users on our key (and cap-gated, §8.3).

---

## Section 11 — Regression (the prior shipped v3 flow)

- [ ] **11.1** **Generation quality fields present.** On any breakdown, confirm each feature carries `complexity_score (1-5)`, `priority`, `story_points`, and `confidence_indicator`/`confidence_score`.
  **Expected:** all present and editable; sizing varies (not uniform).
  **Why it matters:** these were a milestone fix; an XCA/pricing change must not regress generation output.

- [ ] **11.2** **Dependency cycle repair.** Generate from a spec known to induce a cycle (or trust the prior Stripe↔Subscription validation) and confirm the cycle is auto-cut or surfaced as a `spec_concern`.
  **Expected:** no circular blocks-link reaches Jira; resolution logged.
  **Why it matters:** the graph repair (`src/graph.js`) is load-bearing for valid Jira links.

- [ ] **11.3** **Chunked push + labels + dynamic subtask type.** On a larger breakdown, confirm push proceeds in bounded chunks (≤15/issue batch), category labels land, and subtasks use the project's resolved subtask type id.
  **Expected:** progress bar advances in chunks; no 25-sec timeout; subtasks created (not 39/39 failures); labels on Epic + Stories.
  **Why it matters:** the chunked-resolver + dynamic-subtask-type are the hard-won Forge fixes (gotchas #4, #7) — confirm intact.

- [ ] **11.4** **Stale-page banner + Regenerate.** Edit the Confluence page after a breakdown, reopen the app.
  **Expected:** a "page edited since this breakdown" banner; Regenerate works.
  **Why it matters:** the regenerate UX shipped recently; confirm the version-threading still works through the licensing changes.

- [ ] **11.5** **Truncation salvage / large spec.** (If time) generate from a large spec (~10K+ words).
  **Expected:** completes within the 64K/48K output cap or salvages complete features with a truncation banner; no silent partial.
  **Why it matters:** reliability for real-world specs; the salvage path must still fire.

---

## Section 12 — Pre-resubmit gate + production rollout

**Gate A — dev verification complete (do not proceed until every box below is checked):**

- [ ] **12.1** `forge lint` is clean (no compatibility/licensing errors; no `unlicensedAccess` anywhere) — §1.1.
- [ ] **12.2** Both remaining **⭐CRITICAL** sections recorded with a definite outcome: §6 `accountId` non-null (key not `:u:unknown`) · §7 two-user per-user 10 confirmed. (Former §4/§5 are removed — moot after the Free-tier drop.)
- [ ] **12.3** Edition resolution verified: Standard→BYOK Pro, Advanced→Managed Pro, no-license→Unlicensed-blocked (§2); prices €4.90/€9.90 shown from `pricing[]` (§3).
- [ ] **12.4** Managed key path proven (succeeds with no BYOK key; unset → `managed_unavailable`) (§8); licensed push creates issues in Jira (§9).
- [ ] **12.5** Full E2E green on **both** paid tiers incl. Project Context (§10); v3 regression green (§11).
- [ ] **12.6** Any temporary debug logs **removed** and redeployed; `MANAGED_USER_CAP`/`ENFORCEMENT_MODE` restored to intended values.

**Gate B — vendor portal + compliance (external, before resubmit):**

- [ ] **12.7** In marketplace.atlassian.com → Manage vendor account → Spec2Tickets → **Pricing → Cloud → Edit**: payment model **Paid via Atlassian**, **two editions** — Standard **€4.90/user**, Advanced **€9.90/user**; confirm the **≤10-user floors fall out as €49 / €99**. Submit pricing.
  **Why it matters:** XCA mandates Paid-via-Atlassian; without the two editions configured, the listing can't sell the hybrid model.
- [ ] **12.8** Compliance docs **published**: customer DPA (legal-reviewed), Atlassian privacy questionnaire reconciled to the **Managed truth** (≤29-day Batches retention, no-training default, SCCs, Anthropic as sub-processor), sub-processor list published.
  **Why it matters:** Managed Pro processes content under OUR key — the compliance surface must match reality or the review fails on privacy.

**Gate C — production rollout (only after Gates A + B; uninstall Jira FIRST):**

- [ ] **12.9** Fresh build + **uninstall Jira** + deploy to prod.
  `cd "C:\Software Engineer\Success\Spec2Tickets\spec2jira-forge\static\hello-world"; npm run build` → `cd ..` →
  `forge uninstall -e production -p Jira -s alexacenov.atlassian.net` → `forge deploy -e production --no-verify`.
  **Expected:** the Jira uninstall succeeds, then prod shows the new XCA/hybrid version.
  **Why it matters:** prod is a separate environment; dev deploys never touched it. ⚠ **EMPIRICALLY CONFIRMED 2026-06-03:** the first XCA-compatibility deploy is BLOCKED while the app is installed in the NON-required app (Jira) — *"Unable to deploy an app to an environment with an existing installation in an Atlassian app that is not the required Atlassian app."* So you MUST uninstall Jira first (same as dev §0.4). Confluence (required) install + data ARE preserved. (Do NOT touch `vs-overlord22.atlassian.net` — the Atlassian reviewer's site, Confluence-only, doesn't block.)
- [ ] **12.10** Reconnect installs on prod for **both** products.
  `forge install --upgrade -e production -p Confluence` (preserved through the deploy) and
  `forge install -e production -p Jira -s alexacenov.atlassian.net` (fresh, since §12.9 uninstalled it) — accept the licensing re-consent.
  **Expected:** both installed/upgraded; 2 entries on the prod site(s).
  **Why it matters:** the licensing-enabled manifest needs admin re-consent; both products must carry the new version, and Jira is a fresh install because the XCA deploy required uninstalling it first.
- [ ] **12.11** Set the prod Managed key (encrypted).
  `forge variables set --encrypt -e production MANAGED_ANTHROPIC_KEY <our-key>`.
  **Expected:** set (encrypted).
  **Why it matters:** Managed Pro on prod is non-functional without it.
- [ ] **12.12** Confirm prod enforcement is `block`.
  `forge variables set -e production ENFORCEMENT_MODE block` (or confirm unset ⇒ block).
  **Expected:** `block` active in prod.
  **Why it matters:** the Managed per-user fair-use cap must enforce in production (it is the only thing `ENFORCEMENT_MODE` now governs — BYOK is unlimited; there is no Free cap).
- [ ] **12.13** Prod smoke test (one BYOK + one Managed E2E on a clean prod site you control) then **Resubmit** → new ECOHELP ticket.
  **Expected:** both flows green on prod; listing resubmitted with the XCA-enabled latest version.
  **Why it matters:** never resubmit a build that wasn't smoke-tested on prod; the resubmit version must be the XCA/hybrid one.

---

### Notes & rollback
- If a `--license` override seems "stuck", fully reload the app page (license is read per-invocation via `getAppContext()`); if still wrong, `forge install --upgrade … --license <X>` again.
- Restore dev to a sane state when done: `ENFORCEMENT_MODE=meter` (or `block`), `MANAGED_USER_CAP=10`, `MANAGED_ANTHROPIC_KEY` set, no debug logs.
- A bad dev deploy never affects prod (separate environments); to revert a dev code change, redeploy the prior commit's build.
