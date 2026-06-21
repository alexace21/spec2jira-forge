# v6.0.0 — LIVE E2E Acceptance Testing (user stories)

> The hands-on acceptance script for the v6.0.0 value-split work. Run it on **dev**
> (`spec2jira-dev`) using Atlassian's edition simulation. Each story is independently
> checkable — tick the **Then** lines. A story's ⭐ marks a load-bearing guard a §13
> gate or design pitfall flagged; treat a ⭐ failure as a blocker.
>
> **Scope under test:** branch reconciliation + step 2 (decouple key-source/edition/feature
> + `hasTestCases` gating) + step 3 (cost-transparency). Editions config (Advanced =
> Managed → test-cases in the vendor portal) is **Phase 2 / post-approval** and is NOT part
> of this dev script — see *Deploy timing* at the bottom.

---

## 0. Setup (do once)

```powershell
# 1. Build the Custom UI + deploy code to dev
cd "C:\Software Engineer\Success\Spec2Tickets\spec2jira-forge\static\hello-world"
npm run build
cd ..
forge deploy            # dev environment

# 2. Watch logs in a second terminal for the whole session
forge logs --since 5m
```

**Edition simulation (the key tool).** `forge install --license <Standard|Advanced>` is
DEV-ONLY and makes `context.license.capabilitySet` resolve to `capabilityStandard` /
`capabilityAdvanced`. Re-run with `--upgrade` to switch editions on the same site:

```powershell
forge install --upgrade -p Confluence --license Standard --site spec2jira-dev.atlassian.net
forge install --upgrade -p Jira       --license Standard --site spec2jira-dev.atlassian.net
# …re-run both with --license Advanced when you reach Epic C.
```

**⭐ Margin-leak test prerequisite (important).** To *prove* Advanced runs on the
customer's BYOK key and NOT our Managed key, set up so the two are distinguishable:
- **Easiest:** ensure `MANAGED_ANTHROPIC_KEY` is **UNSET** on dev
  (`forge variables list --environment development`). Then if Advanced generation
  *succeeds* using the BYOK key you entered, it provably used BYOK — had it tried the
  Managed path it would fail `managed_unavailable`.
- **Or:** keep both set and watch `forge logs` for `keySource=byok` on the generation.

Configure a **BYOK Anthropic key + a Jira project key** in Settings before generating
(both editions are BYOK now).

---

## ⭐ Edition Rendering Matrix — the one-glance "what shows per edition"

The v6 model: **both editions are BYOK** (the customer's own Anthropic key). The ONLY
difference is the **value/feature set** — and on screen that means *which options render*.
Run each screen on `--license Standard`, then `--license Advanced`, and tick that the
rendered UI matches this column. (Exact on-screen strings quoted so you can match verbatim.)

| Screen → element | **Standard** (CORE, BYOK) | **Advanced** (CORE + test-cases, BYOK) |
|---|---|---|
| **Setup** (no key yet) | Asks for **Anthropic API key + Jira project key** | **Same** — both BYOK need a key |
| **Settings → API key field** | **VISIBLE** (paste / Test Connection / Clear) | **VISIBLE** — identical (⭐ the dead-end fix: NOT hidden) |
| **Settings → info callout** | "Powered by Claude… Standard *core breakdown + push + Project Context*; Advanced *+ test-case generation*. Both run on your own Anthropic key" | **Same** callout (both editions described) |
| **Settings → Account panel footnote** | "Your **Standard** plan includes unlimited breakdowns on your own Anthropic key. Upgrade to Advanced…" | "Your **Advanced** plan includes unlimited breakdowns **+ test-case generation**…" |
| **Settings → Project Context editor** | **Available** (Distill needs the BYOK key) | **Available** (identical) |
| **Ready screen → plan badge** | "**Standard** plan · unlimited breakdowns" | "**Advanced** plan · unlimited breakdowns **· includes test cases**" |
| **Review/Confirm → test-case card header** | "**Acceptance test cases — Advanced**" | "Optional: acceptance test cases" (or "✓ …generated") |
| **Review → test-case action** | **🧪 Advanced feature** chip (no Generate button, no spend) | **🧪 Generate Test Cases** button |
| **Review → cost-estimate line** | **NOT shown** (no run possible) | **"💲 Estimated Anthropic usage: up to ~$X (typically ~$Y)…"** |
| **Generate → confirm** | n/a | **2-step armed** → "⚠ Confirm & generate" (1st click arms, no spend) |
| **Test Cases screen** | reachable ONLY if downgraded-with-retained-cases → **read-only** (banner + disabled controls; View/Export still work) | **full** generate / edit / regenerate / export |
| **Post-run echo** | n/a | **"💲 $Z used"** on the SummaryBar + Review card |
| **Hit test-gen anyway** (stale client) | backend **fail-closed** → **LimitReachedScreen "Advanced feature"** upsell (non-destructive Back) | n/a |
| **CORE: generate → review → push** | ✅ works (on the BYOK key) | ✅ works (on the BYOK key) |

> The rows in **bold** are the v6 load-bearing differences. Everything else is identical by
> design (both editions are the same BYOK core).

---

## ⭐ Cost-Estimation Walkthrough (Advanced) — "explain the cost BEFORE the action"

The customer must see what a paid action will cost **before** spending, and the exact amount
**after**. Walk this end-to-end on `--license Advanced`:

1. **Generate a breakdown** (core flow) → open the **Review/Confirm** screen.
2. **Pre-flight estimate (before any spend):** the test-case card shows
   **"💲 Estimated Anthropic usage: up to ~$X (typically ~$Y) — billed to your own API key,
   no markup. Rough estimate; you'll see the exact amount after the run."**
   - ✅ `~$X` (upper) ≥ `~$Y` (typical); both look sane for the story/AC count.
   - ✅ If the breakdown has no cached source spec, it appends "(excludes source-spec context; actual may be lower)".
   - ✅ The figure is clearly **Anthropic usage on your key** — NOT the subscription price ("$…/user/mo").
3. **Confirm-before-spend:** click **🧪 Generate Test Cases** → it ARMS to **"⚠ Confirm & generate"**
   and does **NOT** spend on the first click. ✅ Only the second click (within ~4 s) starts the run.
4. **Run completes** → the **Test Cases** screen SummaryBar shows the EXACT actual:
   **"💲 $Z used"**, and returning to Review shows **"💲 This run used $Z of Anthropic usage — your own API key, no markup."**
   - ✅ `$Z` is at/under the earlier `up to ~$X` upper bound (it can never exceed it — that's the fix). If it ever does, note it (the heuristic needs calibration; the echo is authoritative).
5. **Regenerate one story** (per-card ↻ — it has its own 2-step armed confirm) → after it completes
   the SummaryBar cost **increases** to reflect the extra spend (not stuck at the old `$Z`). ✅
6. **Stale re-run:** edit an AC on Review, return → the card shows **🔄 Re-run all** with its own
   armed confirm and a fresh estimate (the upcoming run, not the prior actual). ✅

---

## Epic A — Reconciliation sanity (the 38-commit merge didn't break the core)

### US-A1 — Core breakdown still works end-to-end
- **As a** BA, **I want** the spec→Jira core to work after the branch reconciliation,
  **so that** the merge introduced no regression.
- **Given** a configured dev install (any edition) on a Confluence spec page,
- **When** I open the app, pick the page, Generate, Review, and Push,
- **Then** a breakdown is produced and an Epic + Stories + Subtasks + dependency links land in Jira. ✅
- *Guards:* the 38-commit `feature/product-improvements` + v5.4.0 merge (`3c7d503`/`35a56b5`).

### US-A2 — The merged delta is present
- **Given** the app is open,
- **Then** the live **multi-batch dashboard** (picker status groups), **Diagnostics** tab,
  and **Project Context** profiles in Settings are all present and functional. ✅

---

## Epic B — Decouple: **Standard** edition (BYOK core, test-cases are Advanced-only)

> Install with `--license Standard`.

### US-B1 — ⭐ Standard requires a BYOK key (no silent "no key needed")
- **As a** Standard customer, **I want** to be asked for my own Anthropic key,
  **so that** I'm never let past setup keyless and then dead-ended at generate.
- **Given** a fresh Standard install with NO key configured,
- **When** the app opens,
- **Then** I land on Setup and it asks for an **Anthropic API key + Jira project key**
  (NOT a "No Anthropic API key needed / Managed runs Claude" message). ✅
- **And** in Settings the **Anthropic API Key field is visible** with Test Connection. ✅

### US-B2 — Standard core flow works (BYOK)
- **Given** a Standard install with a BYOK key + project key,
- **When** I Generate → Review → Push,
- **Then** the full breakdown + push succeeds on **my** key. ✅

### US-B3 — ⭐ Test-cases are gated as an Advanced upsell (no free premium feature)
- **As a** Standard customer, **I want** to see test-cases offered as an upgrade,
  **so that** the value-split is real (Standard doesn't get the Advanced feature free).
- **Given** the Review/Confirm screen on Standard,
- **Then** the test-case card shows **"Acceptance test cases — Advanced"** with a
  **🧪 Advanced feature** chip — **NOT** a working "Generate Test Cases" button. ✅
- **And** there is no pre-flight cost estimate shown (no run is possible). ✅

### US-B4 — ⭐ A forced test-gen on Standard routes to Upgrade, not an error
- **Given** Standard (defense-in-depth: simulate a stale client that still calls the backend
  — e.g. trigger `startTestCaseGeneration` if you can, or downgrade after generating),
- **When** the backend `hasTestCases` gate denies it (`edition_required`),
- **Then** the UI shows the **LimitReachedScreen in "Advanced feature" mode** with an
  "Upgrade to Advanced" CTA — **NOT** a red generic Error screen. ✅
- *Guards:* fail-closed feature gate + the `edition_required` FE routing.

### US-B5 — Project Context stays available in Standard
- **Given** Standard Settings,
- **Then** the **Project Context profiles editor works** (create/edit; Distill needs the BYOK
  key) — Project Context is in Standard, not gated to Advanced. ✅

---

## Epic C — Decouple: **Advanced** edition (BYOK + test-cases)

> `forge install --upgrade --license Advanced` (both products). Keep the same BYOK key.

### US-C1 — ⭐⭐ Advanced can enter/save a key (the highest dead-end fix)
- **As an** Advanced customer, **I want** the key field to show for me too,
  **so that** I can configure my own Anthropic key (under v6 Advanced is BYOK).
- **Given** an Advanced install,
- **When** I open Settings,
- **Then** the **Anthropic API Key field is VISIBLE** (NOT replaced by a "No key needed"
  card), and I can paste + Test Connection + Save. ✅
- *Guards:* the AdminSettings `isManaged`-hides-key dead-end (the pre-v6 bug where
  `edition==='advanced'` hid the field — an Advanced BYOK customer could never enter a key).

### US-C2 — ⭐⭐ Advanced runs on the BYOK key, NOT the Managed key (margin-leak guard)
- **As the** vendor, **I want** Advanced to bill the customer's Anthropic account,
  **so that** I don't silently eat every Advanced customer's compute bill.
- **Given** the margin-leak prerequisite from Setup (`MANAGED_ANTHROPIC_KEY` unset, or logs watched),
- **When** an Advanced user Generates a breakdown (and test-cases),
- **Then** generation **succeeds on the BYOK key** (and `forge logs` shows `keySource=byok`,
  never `managed` / `managed_unavailable`) for both breakdown and test-cases. ✅
- *Guards:* `resolveAnthropicKey` reading `tier.keySource` (was `edition==='advanced'?'managed'`).

### US-C3 — Advanced can generate test-cases
- **Given** Advanced + a completed breakdown,
- **When** I open the Review screen,
- **Then** the test-case card shows a working **🧪 Generate Test Cases** button (no upsell chip),
- **And** generation produces per-Story acceptance scenarios I can View/edit/export. ✅

### US-C4 — Advanced push embeds test-case summaries
- **Given** generated test-cases on Advanced,
- **When** I Push,
- **Then** each Story in Jira carries its test-case summary. ✅

---

## Epic D — Cost-transparency (Advanced — the spend paths)

> All on `--license Advanced` (only it can run test-cases).

### US-D1 — ⭐ Pre-flight estimate before any spend
- **As an** Advanced customer, **I want** to see the projected Anthropic cost before I run,
  **so that** I'm never surprised by an invisible bill.
- **Given** the Review screen with a generated breakdown and NO test-cases yet,
- **Then** the test-case card shows **"💲 Estimated Anthropic usage: up to ~$X (typically ~$Y)
  — billed to your own API key, no markup. Rough estimate; you'll see the exact amount after the run."** ✅
- **And** `~$X` (upper) ≥ `~$Y` (typical), both look sane for the story/AC count (cents-to-low-dollars). ✅
- *Guards:* `estimateTestCaseCost` + `projectTestCaseCost` (cache-amortized, batch-priced, no 24K ceiling).

### US-D2 — ⭐ Confirm-before-spend on first-time generate (the bill-shock vector)
- **Given** the estimate is showing,
- **When** I click **🧪 Generate Test Cases** the FIRST time,
- **Then** the button ARMS to **"⚠ Confirm & generate"** and does NOT spend on the first click;
  only the second click (within ~4s) starts the run. ✅
- **And** the same 2-step confirm applies to **🔄 Re-run all** when stale ("⚠ Confirm re-run"). ✅

### US-D3 — ⭐ Post-run echo shows the EXACT cost
- **When** a test-case run completes and I'm on the Test Cases screen,
- **Then** the SummaryBar shows **"💲 $Z used"** (the exact actual cost), and returning to the
  Review screen shows **"💲 This run used $Z of Anthropic usage — your own API key, no markup."** ✅
- **And** `$Z` is plausibly within/under the earlier `up to ~$X` upper bound (if it ever exceeds it,
  note it — the heuristic constants need calibration, but the echo is authoritative). ✅

### US-D4 — ⭐ A per-story regenerate updates the run total (echo stays honest)
- **Given** a completed run showing "💲 $Z used",
- **When** I regenerate one story (per-card ↻),
- **Then** after it completes the SummaryBar cost **increases** to reflect the additional spend
  (not stuck at the old $Z). ✅
- *Guards:* backend regen-usage accumulation + the FE cost re-fetch after regen.

### US-D5 — Compute cost is never confused with the subscription price
- **Then** the Anthropic-usage figures (💲, "Anthropic usage", "your own API key, no markup")
  are visually/verbally distinct from the Marketplace **subscription** price ("$…/user/mo"). ✅

### US-D6 — Breakdown cost diagnostic is batch-priced (internal sanity)
- **Given** `forge logs` during a breakdown generation,
- **Then** the internal `cost_usd` breadcrumb is ~50% of the old value (batch-priced now) —
  expected, not a regression. ✅ (Dev-internal; no customer-facing impact.)

---

## Epic E — Regression guards (both editions)

### US-E1 — Push, dashboard, diagnostics, distill unaffected
- **Then** on BOTH editions: Jira **push** works; the **multi-batch dashboard** tracks jobs;
  **Diagnostics** records/【Open Diagnostics】navigation works; **Distill with Claude** works on
  the BYOK key. ✅

### US-E2 — Reconnect / reopen
- **Given** a generated breakdown (and test-cases),
- **When** I close and reopen the page,
- **Then** the breakdown + test-cases (+ their cost echo) rehydrate; no silent loss. ✅

### US-E3 — Downgrade (Advanced → Standard) keeps retained output readable
- **Given** test-cases generated on Advanced, then `--upgrade --license Standard`,
- **When** I open the breakdown,
- **Then** I can still **View/Export** the existing test-cases (+ see their cost echo), but
  **edit/regenerate** routes to the Upgrade screen; the TestCases screen shows the
  "Viewing your existing test cases — editing/regenerating requires Advanced" banner. ✅
- *Guards:* read/export ungated (retained paid output) vs write paths gated.

---

## Deploy timing (⚠ production — NOT this dev script)

This script runs on **dev** via `--license` simulation. For **production**, the v6 code
flips `capabilityAdvanced` → BYOK + test-cases, but the **pending portal Advanced edition
still advertises "Managed — no key, fair-use 25"** until the Phase-2 re-config. Deploying
the v6 code to prod before the portal copy changes would strand a brand-new Advanced
subscriber (promised no-key) on a must-bring-key product. **Safe order: re-author the
Advanced edition (portal copy → BYOK + test-cases) FIRST, deploy the v6 code SECOND.** And
do **not** unset `MANAGED_ANTHROPIC_KEY` at cutover — legacy in-flight jobs stamped
`keySource=managed` drain on it. (See `memory/v6-value-split-editions` + the manifest note.)

## Known residuals (acceptable; documented — not test failures)
- The pre-flight estimate uses **uncalibrated** output heuristics → treat `up to ~$X` as a
  rough bound until calibrated against real echoed runs (the echo is the ground truth).
- Concurrent **"Regenerate N failed"** fan-out can slightly under-count the echo (Forge KVS
  has no compare-and-set); self-corrects on the next full read.
- Per-story regenerate has no pre-flight estimate (it's ~one story; confirm is scoped to bulk
  paths) — its cost still shows in the post-run echo.
