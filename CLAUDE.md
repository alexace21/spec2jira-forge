# Spec2Tickets — Forge App (v3.0.0) — Engineering Guide

> Read this first every session. It is the operating map for the Spec2Tickets
> Forge app: what it is, how it's wired, the hard-won Forge platform gotchas,
> current state, and where to continue.

---

## ⭐ FOUNDATIONAL POLICY — read `POLICY.md` (binding)

**`POLICY.md` holds the engineering philosophy** the partner taught — it is BINDING,
not optional. Read it at the start of every session alongside this file. The
load-bearing rules in one breath (full detail in POLICY.md):

- **LENS (ОЧИ)** — answer the 6-question gate at task START (where in the stream /
  small-agent boundary / consumes-from-upstream / emits-forward / token budget /
  **highest-value not safest**). We own engineering (decomposition, info flow,
  prompts, budget); the model owns semantic reasoning.
- **Analyze → Design → Solve** — always, for EVERYTHING (incl. reuse, bug fixes,
  docs). Skipping to Solve produces patches.
- **Highest-value principle** — search for the MAXIMUM value within constraints,
  never the safest-re-prior-policy option.
- **Pure-function vs LLM dispatch rule** — deterministic → pure function;
  meaning-reading → LLM. No regex safety-net for meaning. 4-test check.
- **Bug Y POLICY** — NO corpus-pattern enumeration in prompts/schemas; write the
  abstract decisive-test; few-shot examples teach DISTINCT lessons only.
- **Prompt Engineering POLICY** — 5 mandatory slots (ROLE / RULES (cost-asymmetry) /
  OUTPUT FORMAT / AGILE LENS / FEW-SHOT). The `prompts.js` SYSTEM_PROMPT follows these.
- **Informational completeness** — give a call the 4-part contract (item / location /
  decided peers / provenance). A starved call's silent miss is the worst failure.
- **Verification where quality is critical** — N / N+1 / N+1+ (primary / critic /
  different-lens auditor). v3 uses a single Sonnet call; add real verification only
  where silent miss is expensive (e.g. destructive JIRA ops).
- **Stepwise empirical** (fix → measure → decide) · **self-audit before ship**
  (rigorous mentor mode) · **refuse anti-patterns** (patch-specific, silent fail,
  big-everything call).
- **Bulgarian in conversation; English in all user-facing strings + UI copy.**
- ⭐ **Conductor model (§13, NEW 2026-06-02)** — Claude orchestrates ISOLATED agents for
  all substantive work (analyze → design → proposal → confidence-vote → pitfalls/edge-cases
  → implement → review + different-lens auditor), passing each the upstream output it needs
  (§8) and reading their reports. Use the Workflow/Agent tools by DEFAULT (standing opt-in);
  scale to the task (trivial verifiable steps skip the ceremony). The conductor owns the
  policy; the agents apply it.

---

## What this is

**Spec2Tickets** — an Atlassian **Forge** app (Confluence Custom UI) that turns a
Confluence specification page into a structured JIRA breakdown using
**Anthropic Claude Sonnet 4.6** with structured outputs. BYOK (customer brings
their own Anthropic API key). Forge-only — **no Spec2Tickets-operated backend**.

This is the **v3.0.0 pivot** away from the older self-hosted Qwen-14B pipeline
(that project lives at `C:\Software Engineer\Success\AI-delivery\ai-delivery-platform`
and its `CLAUDE.md` holds the foundational engineering POLICY — LENS, A→D→S,
prompt-engineering slots, etc. Those principles still apply; only the runtime changed).

**Status (2026-05-30): full E2E happy path WORKING** — Generate (Anthropic batch)
→ Review (BreakdownEditor + Dashboard) → chunked Push to JIRA (Epic + Stories +
Subtasks + dependency links + category labels). Validated on App-notification +
CLM + Spec2jira specs.

**Repo**: `C:\Software Engineer\Success\Spec2Tickets\spec2jira-forge` · branch `feature/v3-pivot`
**App id**: `ari:cloud:ecosystem::app/e804f31f-1cbf-4f09-86c1-11e36f387fe7`
**Dev site**: `spec2jira-dev.atlassian.net` (project key `SDTY` / SCRUM-DEV)

---

## 💰 Monetization & tier enforcement (DECIDED 2026-05-30; pricing revised UP 2026-06-01 — do not re-litigate)

> ⭐ **FINAL MODEL (2026-06-03): trial → paid, NO in-app Free tier.** The "Free = 3 breakdowns/month"
> framing throughout this section is **SUPERSEDED** — the in-app Free tier, `unlicensedAccess`, the
> guest-guard (`accountType`), and the push-gate (`push_requires_license`) were all **REMOVED 2026-06-03**.
> The app is **licensed-only** (Paid-via-Atlassian admits only licensed/trial users by default); evaluation
> is the **30-day Atlassian trial** (reads as an active license → resolves to a paid tier), and a truly
> unlicensed user is blocked natively by Atlassian + a defensive `license_required` backstop in the
> resolvers. The two editions are **BYOK Pro €4.90/user (unlimited, "Standard")** and **Managed Pro
> €9.90/user (fair-use 10/user/mo, "Advanced")** — see the 2026-06-03 handover note. The per-user pricing
> mechanics below remain authoritative; only the Free-tier framing is retired. Source of truth: `src/usage.js`.

Settled. Do NOT reopen these in future sessions:

- **BYOK** — the customer brings their own Anthropic API key (pays Anthropic for
  compute directly). No Spec2Tickets-operated backend.
- **Pricing (MVP early access — REVISED 2026-06-01 UP from €20; per-seat figures FINALIZED
  2026-06-02/03 — see the two-edition note below, which supersedes this single-tier framing):**
  **~~Free = 3 breakdowns/month~~ (SUPERSEDED 2026-06-03 — no in-app Free tier; evaluation = the 30-day
  Atlassian trial)** · **BYOK Pro = per-user €4.90/user/mo (Paid via Atlassian; 1-10 tier = €49 floor, declining taper), "Early Access"**
  → unlimited breakdowns. Value-based, not cost-based: under BYOK the subscription is pure
  app-value — a spec→JIRA breakdown saves ~1-3 h of BA/PO time (~€50-200 each), so the old €20
  under-captured (~2-10% of the value) AND under-signalled (B2B buyers eliminate the cheapest
  option first). €20/€29 are retired. Sold as the Marketplace subscription — `resolveTier()`
  reads `context.license` → active ⇒ Pro.
- **Pricing model — per-user (Paid via Atlassian), DECIDED 2026-06-01; BYOK rate FINALIZED
  €4.90 2026-06-03.** Atlassian forces per-user tiers for cloud apps (no single flat fee). BYOK
  Pro base **€4.90/user/mo** → the **1-10 tier resolves to €49/mo** (floor = per-user × 10), with
  **declining** rates above and a **steep taper above ~100 users** (Paid-via-Atlassian licenses
  the WHOLE instance — all users, not just app users). The earlier "flat €39" is retired
  (Atlassian forces per-user). Premium peer to StoryLoop (~€42 ≤10); deliberately above budget
  rivals (free ≤10). Frame **"Early Access" + grandfather early adopters**
  (`memory/migration-protections.md`) so the curve can evolve without churn. Details:
  `docs/MARKETPLACE-LISTING-v3.md` §3.
- **`block` is correct.** ⚠ (SUPERSEDED framing 2026-06-03: the old "Free → 3 → block → Pro freemium
  funnel" no longer applies — there is no in-app Free tier.) The acquisition motion is now the **30-day
  Atlassian trial → paid**; "Land-grab" = attractive PRICING + early-access framing + grandfathering
  (`memory/migration-protections.md`). `block` now governs only the **Managed Pro per-user fair-use cap**
  (BYOK is unlimited; unlicensed is blocked natively by Atlassian).
- **`ENFORCEMENT_MODE` is per Forge environment** (`src/usage.js`, from `process.env`):
  **production = `block`** (default when unset) · **dev = `meter`** via
  `forge variables set --environment development ENFORCEMENT_MODE meter`. It governs ONLY the Managed
  per-user cap (post-2026-06-03 there is no Free cap). Dev tests freely; production enforces.
- **The paid Marketplace listing (BYOK Pro €4.90/user; €49 ≤10-user floor) goes live WITH the
  production release** (Marketplace approval is part of the MVP launch). Dev having no listing is NORMAL, not a problem —
  so block has a working upgrade path the moment real users can hit it.
- **"Unlimited" is BYOK-only.** When vendor-pays lands (we pay the API; pending Anthropic
  reselling approval), unlimited reverts to capped tiers (else unbounded cost). See
  `memory/monetization-strategy.md`.
- **Open production-readiness item:** wire a real Upgrade BUTTON on `LimitReachedScreen`
  (`router.open` → Marketplace subscription) when the listing is live (currently
  info-only — dev has no listing URL).

---

## Architecture (end-to-end)

```
Confluence spec page
   │  fetchPage — asUser().requestConfluence  (Confluence v2 API)
   ▼
GENERATE  (Anthropic Message Batches API — async, polled)
   │  startGeneration: submit batch → returns jobId
   │  pollJobStatus: polls Anthropic batch → on 'ended' fetches results,
   │                 synthesizes Epic, stores breakdown in KVS
   ▼
REVIEW  (Forge Custom UI — BreakdownEditor + embedded Dashboard signals)
   │  user edits features / ACs / tasks; ConfirmScreen shows quality signals
   ▼
PUSH  (chunked resolver — asUser().requestJira)
   │  startPush: project lookup (resolve subtask type) + Epic create + KVS session
   │  pushStep (UI loops): one bounded chunk (≤15 issues) per call → progress bar
   │  phases: stories → subtasks → links → done
   ▼
JIRA: 1 Epic + N Stories (category labels) + Subtasks + Story-blocks-Story links
```

**Why each piece is the way it is** — these are NON-OBVIOUS, hard-won. Do not
"simplify" them without re-reading the gotchas below.

---

## ⚠ Forge platform gotchas (hard-won 2026-05-29/30 — READ BEFORE CHANGING ARCHITECTURE)

1. **`@forge/events` 2.x is BROKEN** — `Queue.push()` returns `400 Bad Request` on
   every call (both queues, minimal + full payload). **Pin `@forge/events@^1.0.3`.**
   1.x `push()` takes a RAW payload object (no `{body:}` wrapper). Verified by
   isolating with a diagnostic resolver. Do not bump to 2.x.

2. **Local Node must match the Forge runtime** — runtime is `nodejs24.x`; use
   local Node **24.x**. Node 20 caused subtle deploy issues. CLI must be reinstalled
   after a Node upgrade (`npm install -g @forge/cli@latest`).

3. **`asUser()` works ONLY in resolver context** — NOT in async event queue
   consumers (they throw `401 - AUTH_TYPE_UNAVAILABLE`). `allowImpersonation`
   does NOT bridge this for queue-pushed events (only product-trigger events).
   → Any JIRA/Confluence write that needs user attribution MUST run in a resolver.

4. **25-second resolver timeout is a hard limit.** JIRA bulk create is slow
   (~0.85 sec/issue → 10 stories ≈ 8.5 sec). A single-resolver push of 200 items
   blows the timeout. → **Push is CHUNKED**: UI loops `pushStep`, each doing one
   bounded JIRA batch (≤15 issues) under 25 sec. See `push_handler.js`.

5. **Anthropic calls use the Message Batches API, not sync.** A sync
   `/v1/messages` call runs 60-150 sec; Forge async events have a **55-sec**
   timeout → runaway retry loops + burned tokens (the 2026-05-29 incident). The
   Batches API submits instantly, processes async (2-10 min), polled via
   `pollJobStatus`. Bonus: batch pricing is ~50% cheaper. NEVER move generation
   back to a sync resolver call or an async event consumer.

6. **Confluence v1 API returns `410 Gone`.** Use **v2**:
   `/wiki/api/v2/pages/{id}?body-format=storage`. Search still uses
   `/wiki/rest/api/search?cql=` (needs `search:confluence` scope).

7. **Subtask issue type name varies** — team-managed projects name it `Subtask`,
   company-managed `Sub-task`, localized instances translate it. → Resolve it
   **dynamically** by the `subtask: true` flag from the project's `issueTypes`
   (GET project with `?expand=issueTypes`), use its **id**. Hardcoding `Sub-task`
   caused 39/39 subtask failures on the team-managed dev project.

8. **Output cap = 48000 tokens.** 16K truncated the 101K-char Spec2jira spec
   (~32.5K output needed). Sonnet 4.6 supports 64K; 48K is safe headroom. There's
   a salvage path in `fetchBatchResults` that recovers complete features from a
   truncated JSON if the cap is ever exceeded again.

9. **KVS pass-through for large payloads** — async event bodies + resolver
   round-trips have size limits. Page content + breakdowns + push sessions are
   stored in KVS keyed by jobId/sessionId; only the key travels in the payload.

10. **Cross-product app needs BOTH Confluence + Jira installs.** The UI is a
    Confluence globalPage but the push uses `asUser().requestJira()` (scope
    `write:jira-work`). `forge install --upgrade` must be run for each product
    (`-p Confluence` and `-p Jira`). **2 entries in Manage Apps is NORMAL** for a
    cross-product app — Atlassian reviewers expect it; the scopes explain why.

11. **ADF `taskList` is risky to validate** — if rejected it fails EVERY Story
    create (each carries one). Embedded task checklists use a plain `bulletList`
    with `☐` prefix (same proven-safe structure as the AC list).

12. **v3 schema has NO top-level `epic` field** — features array is primary. The
    Epic is **synthesized** in `pollJobStatus` from page title + `metadata.spec_summary`.

13. **Forge linter is sometimes wrong** — it flagged `resolver:` on globalPage as
    invalid (false positive). Runtime + official docs trump lint. Deploy with
    `forge deploy --no-verify` when lint conflicts with verified-correct config.

---

## File map (`src/` = backend resolvers; `static/hello-world/src/` = Custom UI)

| File | Role |
|---|---|
| `manifest.yml` | One `resolver` function (handles ALL backend work). globalPage + contentAction + globalSettings modules. Egress to `api.anthropic.com`. Scopes (5, least-privilege — verified 2026-05-31): `storage:app`, `search:confluence`, `read:page:confluence`, `write:jira-work`, `read:jira-work` (classic `read:confluence-content.summary`/`.all` removed — dead since the v1→v2 page-read migration; search + v2 reads confirmed working on the granular scopes alone). **No consumers** (generation = batches, push = chunked resolver). |
| `src/index.js` | All resolvers: settings (BYOK), Confluence fetch/search, `startGeneration`/`pollJobStatus`/`getResults` (batch lifecycle), `startPush`/`pushStep` (chunked push), `dryRun`. |
| `src/anthropic_client.js` | BYOK key storage (kvs secret), `testConnection`, **`submitBreakdownBatch`/`pollBatchStatus`/`fetchBatchResults`** (Batches API + truncation salvage), `estimateCost`. Models: `claude-sonnet-4-6` (primary) / `claude-haiku-4-5` (fallback). `MAX_OUTPUT_TOKENS=48000`. |
| `src/prompts.js` | `BREAKDOWN_SCHEMA` (strict JSON schema; concerns flattened to `[TYPE\|severity] text` strings) + `SYSTEM_PROMPT` (cacheable, 5 mandatory slots). |
| `src/push_handler.js` | JIRA push library: ADF builders, `lookupProject` (dynamic subtask type), bulk/single create, issue links, **`startPushSession`/`pushSessionStep`** (chunked orchestration in KVS). NOT a queue handler anymore. |
| `static/.../App.js` | State machine + all screens. `handleConfirmedPush` loops `pushStep`; `PushingScreen` progress bar. Adapts v3 flat features ↔ legacy capabilities shape via `lib/v3Schema.js`. |
| `static/.../components/AdminSettings.jsx` | BYOK settings: Anthropic key + Default JIRA project key + **Advanced: Required custom fields** (optional JSON for projects with mandatory fields). |
| `static/.../components/breakdown/*` | BreakdownEditor + CapabilityCard ("Category" not "Epic") + FeatureCard. |
| `static/.../lib/v3Schema.js` | Schema adapter (v3 ↔ legacy), concern parsing, Dashboard signal derivation. |

---

## Deploy workflow

```powershell
cd "C:\Software Engineer\Success\Spec2Tickets\spec2jira-forge\static\hello-world"
npm run build            # bundles the Custom UI
cd ..
forge deploy             # code-only changes
# forge install --upgrade  # ONLY when manifest.yml changed (pick Confluence AND Jira)
forge logs --since 5m    # watch (no --tail flag in this CLI version)
```

**Production rollout (separate environment — dev deploys do NOT touch prod).** Each
Forge environment is its own deployed version + install; the `forge deploy` above
only updates `development`. To ship to production:

```powershell
cd "C:\Software Engineer\Success\Spec2Tickets\spec2jira-forge\static\hello-world"
npm run build                          # fresh bundle (build/ is gitignored)
cd ..
forge deploy -e production             # deploy code to the production environment
forge install --upgrade -e production  # run for Confluence AND Jira (cross-product, gotcha #10)
```

- **`install --upgrade` IS needed for prod** even though the manifest was untouched
  *this* session: the least-privilege **scope reduction** (`4ece939`) landed after
  the MVP production release, and a scope change requires admin re-consent on install.
  First run `forge install --list` / check the Developer Console to confirm what is
  deployed/installed where (so you know whether it's `install` vs `install --upgrade`).
- **Production `ENFORCEMENT_MODE`** is `block` by default when unset (the freemium
  funnel is live) — verify; usually no action. To set it explicitly:
  `forge variables set --environment production ENFORCEMENT_MODE block`.
- The **Marketplace listing** distributes the production version to NEW customers
  (they install via the listing, not `forge install`); paste from
  `docs/MARKETPLACE-LISTING-v3.md`. Set the real `PRO_UPGRADE_URL` once the listing is live.

- ⚠ **Do NOT run `npm audit fix --force`** on `static/hello-world` — it destroys
  react-scripts (CRA). If broken: `git checkout package.json package-lock.json && rm -rf node_modules && npm install`.
- node_modules is tracked in git (pre-existing) — stage only source paths when committing
  (`git add src static manifest.yml package.json`), or untrack with `git rm -r --cached node_modules`.

---

## Conventions

- **Foundational POLICY** lives in **`POLICY.md`** (this repo, self-contained) —
  LENS, Analyze→Design→Solve, dispatch rule, Bug Y, prompt 5-slots, informational
  completeness, highest-value principle. Binding; read it every session.
- **Self-audit before ship**: `node --check src/*.js` for backend syntax; `npm run build`
  catches JSX errors. Trace the data flow end-to-end.
- **Surface failures, never silent** — three defenses against silent misalignment
  are wired (graceful subtask fallback / required-custom-fields config / support
  email on errors). Keep this discipline.
- **Bulgarian in conversation; English in all user-facing strings + UI copy.**
  (Some code comments mix BG particles — acceptable, but UI strings must be pure English.)

---

## Current state & known gaps

✅ **Working E2E + scale-validated**: Generate → Review → Push (Epic + Stories +
Subtasks + links + labels). Dynamic subtask type. Chunked push with progress bar.
3 silent-misalignment defenses. Support email. Batches API (48K cap + salvage).
Spec2jira spec (39 feat / 162 subtask / dense deps) validated through chunked push.

✅ **P3a — tier enforcement** (`src/usage.js`): monthly breakdown counter
(KVS `usage:YYYY-MM`; Managed Pro meters per-user `usage:YYYY-MM:u:<accountId>`),
license-aware `resolveTier` (by `capabilitySet`), `ENFORCEMENT_MODE` flag. Model (FINAL 2026-06-03):
**trial → paid, NO in-app Free tier** — **BYOK Pro €4.90/user/mo unlimited ("Standard")** +
**Managed Pro €9.90/user/mo fair-use 10/user/mo ("Advanced")** (Paid via Atlassian; 1-10 floors €49/€99,
declining taper; "Early Access"). Evaluation = the 30-day Atlassian trial; unlicensed = blocked natively +
defensive `license_required`. `startGeneration` checks/consumes (fail-open, consume-on-success); `getUsage`
feeds a usage badge on Ready; quota_exceeded (Managed at cap) → BYOK route + reset date.

✅ **UX + doc-hygiene pass**: scroll-to-top on screen change; JIRA deep-links
(Open Epic + Stories) on the success screen; stale-comment fixes (executePush →
chunked push); README rewrite; AGENTS.md removed; version → 3.0.0.

✅ **Dead-code + tidy pass**: removed the unreachable `startPreview`/preview flow
(handlePreview + PreviewingScreen/PreviewResultScreen/FlagCluster/RoutingRow +
the polling/reconnect/dashboard preview branches); removed dead `documentType`/
`bypassCache` wiring; `created_issues` now preserves duplicate-named Stories;
package names de-scaffolded (→ `spec2tickets`). Build green (bundle ≈ −1.4 kB).

✅ **MILESTONE — generation quality + push fields, E2E verified on SCRUM-DEV
(178 items, 0 failures, 2026-05-30):**
- Per-feature **complexity_score (1-5) + priority + story_points** (model-produced,
  editable; sizing now varies honestly — fixes the uniform-task-count tell).
- **Cycle Verify/Repair** (`src/graph.js` + `resolveDependencyCycle`): pure-function
  DFS detection + a tiny LLM call to cut the soft edge of a circular dependency,
  else a `spec_concern`. Verified auto-resolving the Stripe↔Subscription cycle.
- **Shared-AC dedupe** (rule 12 mutual-exclusivity + exact-match safety net).
- **Push fields**: priority → matched to the project's scheme; story_points →
  dynamically-resolved SP custom field (gotcha #7 pattern); category → kebab label;
  **reviewer-editable labels** on the Epic + each Story (`LabelsEditor`).
- UI tidy: SP = Fibonacci select (3/5/8/13); subtasks have no stray priority/SP
  controls; Category is a read-only profile; dedicated friendly `LimitReachedScreen`.

📋 **Not yet done / next**:
- **Monetization/tier enforcement** — DECIDED (see the Monetization section above).
  Production-readiness: wire the Upgrade button on `LimitReachedScreen` when the paid
  listing is live.
- **Marketplace listing (P3b)**: listing copy + Free/Pro pricing editions + security
  Q&A are drafted in `docs/MARKETPLACE-LISTING-v3.md` (ready to paste). At submission,
  apply early-access framing + grandfather early adopters
  (`memory/migration-protections.md`); the site (landing/docs/privacy) must be pushed
  live first.
- **Vendor-pays** (we pay the API): pending Anthropic reselling approval; reverts
  unlimited → capped tiers when it lands.
- **Dependency-link resolution** still keys Stories by name (`storyKeyMap`) → two
  same-named Stories can mis-resolve a blocks-link. Deeper push fix (the success-
  screen links are already fixed via `createdStories`).
- **Scroll-to-top on view change** is OPEN (Forge-specific): the Custom UI iframe
  auto-resizes, so on a tall screen the PARENT product page scrolls and a sandboxed
  iframe can't reset it. The internal-`#root`-scroll attempt was REVERTED 2026-05-30
  — forcing `#root` to 100vh broke short screens (huge empty area on the picker).
  Needs a proven Forge resize/scroll approach, or accept for MVP (minor UX).
- KVS value-size limit: push session stores full features array — very large specs
  (200+ features) may approach the ~240KB KVS limit. Monitor.

---

## ⚡ HANDOVER NOTE (2026-06-03 — XCA resubmit release: hybrid two-edition pricing, agent-conducted)

> ⭐ **TWO LATER CORRECTIONS to this note (same day, after these paragraphs were written):**
> **(1) The in-app Free tier was REMOVED.** The "Free = in-app 3/mo PERPETUAL via `unlicensedAccess`" +
> push-gate + guest-guard described below were all dropped — final model is **trial → paid, licensed-only**
> (no `unlicensedAccess`, no `push_requires_license`, no `accountType` guard; a defensive `license_required`
> backstop replaces them). Evaluation = the 30-day Atlassian trial. Editions unchanged (BYOK Pro €4.90 /
> Managed Pro €9.90). **(2) The migration ordering below is WRONG** — see the next correction: you MUST
> `forge uninstall -p jira` FIRST, then deploy (EMPIRICALLY CONFIRMED — the live deploy was BLOCKED otherwise).

A long dev session on `feature/product-improvements` (dev only). Built the **XCA Marketplace-resubmit
release** end-to-end, conducted via the §13 agent model throughout (3 research agents → backend by the
conductor → 2 parallel implementer/drafter agents → MANDATORY audit + code-review gate). **Code complete +
§13-gated + build-green + syntax-clean; NOT yet deployed/committed — the partner pushes + runs the external steps.**

**Scope (partner decisions this session — these SUPERSEDE the Monetization section + the flat-€39 framing above):**
- The v4.2.0 rejection's SOLE remaining blocker = **XCA + Paid-via-Atlassian** (FIT/security already passed).
- Partner chose the **FULL hybrid IN the resubmit** (NOT Managed-post-launch) → the resubmit **WAITS on the
  Managed compliance docs** (DPA + 29-day retention disclosure).
- **Pricing = two editions** (platform cap is exactly two): `Standard` = **BYOK Pro €4.90/user** (unlimited,
  customer key) · `Advanced` = **Managed Pro €9.90/user** (capped, OUR key). Floors €49/€99. ~~**Free = in-app
  3/mo PERPETUAL** via `unlicensedAccess`~~ **(SUPERSEDED later 2026-06-03 — REMOVED; no in-app Free tier,
  evaluation = the 30-day Atlassian trial, app is licensed-only.)** The "free ≤10 users" idea was a separate
  earlier error, also retired.
  (Per-seat figures FINALIZED €4.90/€9.90 at the 2026-06-03 implementation; the session-opening €3.90/€6.90 are retired.)

**NEW hard-won facts (3 research agents vs LIVE docs 2026-06-03) — fold into the Forge gotchas list:**
- **XCA manifest:** `app.compatibility` (Confluence required / Jira optional) + `app.licensing.enabled` +
  **`app.licensing.editionsEnabled`** — editionsEnabled is MANDATORY for two editions (easy to miss; without
  it you get ONE price). XCA still in Preview; needs `@forge/api ≥5.1.1` (have ^7.2.1). ⚠ **CORRECTED later
  2026-06-03 (EMPIRICALLY CONFIRMED — the live deploy was BLOCKED): you MUST `forge uninstall -p jira` FIRST,
  then `forge deploy`, then reconnect Jira.** Atlassian errors otherwise: *"Unable to deploy an app to an
  environment with an existing installation in an Atlassian app that is not the required Atlassian app."*
  Confluence (required) install + data ARE preserved. (The "do NOT uninstall first / TEARDOWN-only" claim
  here was WRONG — the live deploy is the authority; this restores the original "uninstall Jira first" step.)
- **Editions cap = exactly 2** (Standard/Advanced); a €0 Free edition CANNOT coexist with paid. (Originally
  → "Free is in-app"; CORRECTED later 2026-06-03 → no Free tier at all, evaluation = the 30-day Atlassian trial.)
- **`unlicensedAccess` + `asUser()`:** unlicensed users are BLOCKED by default. ⚠ **CORRECTED later 2026-06-03:**
  we LEAN INTO that default (licensed-only) rather than adding `unlicensedAccess` — so there is **no
  `unlicensedAccess`** and **no push-gate** (`asUser()` is forbidden only for unlicensed users, and there are
  none now; the defensive `license_required` backstop covers the edge). Edition at runtime =
  `context.license.capabilitySet` (`capabilityStandard`/`capabilityAdvanced`) via `getAppContext()` (@forge/api);
  `active`-only is insufficient. Test editions in dev: `forge install --license Standard|Advanced`.
- **Anthropic Batches API is NOT ZDR-eligible (≤29-day retention).** Managed (our key) discloses 29-day
  retention honestly (no-training default; SCCs auto-incorporated; Anthropic = sub-processor). Reselling
  permitted (Commercial Terms §A.1 — NO special approval needed; the old "reselling approval" premise was wrong).

**Done in code (build-green, `node --check` clean) — ⚠ the Free/unlicensed pieces below were REMOVED later 2026-06-03:**
- `manifest.yml`: compatibility + licensing(enabled + editionsEnabled). ~~`unlicensedAccess` on all 3 Confluence modules~~
  **(REMOVED — licensed-only; no `unlicensedAccess` anywhere).**
- `src/usage.js`: `TIERS` (byokPro=Standard / managedPro=Advanced / unlicensed=defensive-blocked-backstop;
  the `free` tier was REMOVED); `resolveLicense` + `resolveTier` (reads capabilitySet) + `getActiveTier`;
  `MANAGED_USER_CAP` = 10 breakdowns per USER/mo, metered per-user (`usage:YYYY-MM:u:<accountId>`), NOT pooled
  (the License object exposes no runtime seat count → per-user is the loss-bounded shape, loss-proof per-seat
  regardless); `edition`+`fairUse` in checkQuota.
- `src/index.js`: `resolveAnthropicKey`/`anthropicKeyForSource`/`buildQuotaExceeded`; Managed key path (our key
  from `MANAGED_ANTHROPIC_KEY` when Advanced; `keySource` stamped on the job + reused at poll/fetch/cycle-repair
  — a batch is bound to its creating key); tier-aware quota messaging; defensive `license_required` backstop.
  ~~push-gating in `startPush`~~ **(REMOVED — no push-gate; every user is licensed).** Distill Managed support retained.
- Frontend (App.js + AdminSettings.jsx): edition-aware onboarding + Settings (BYOK key field hidden for
  Managed) + LimitReachedScreen (Managed-at-cap → BYOK) + prices from `pricing[]`. ~~push-gate screen~~
  **(REMOVED with the push-gate);** the guest-guard / `accountType` downgrade was also REMOVED.
- `docs/compliance/` (DPA + Atlassian questionnaire + subprocessor list — honest, `[PARTNER: legal review]`),
  `docs/XCA-MIGRATION-AND-PRICING-TODO.md` (verified top-block + the PARTNER EXECUTION CHECKLIST).

**§13 gate proved its worth AGAIN:** the audit-review caught a HIGH the code-review MISSED — Managed users were
locked out of "Distill with Claude" (frontend gated on `!apiKeyConfigured`; Managed has no key → the whole
Managed-distill backend path was unreachable). Both lenses agreed on a MEDIUM/LOW Managed key-fallback in
pollJobStatus (could silently use the customer key if `MANAGED_ANTHROPIC_KEY` vanished mid-batch). Both fixed + re-verified.

**NEXT — partner-executed (Claude can't do these); full checklist in `docs/XCA-MIGRATION-AND-PRICING-TODO.md`:**
set `MANAGED_ANTHROPIC_KEY` (encrypted, both envs) · dev migration + `--license` edition tests · vendor-portal
pricing (2 editions, confirm €49/€99 floors) · compliance legal-review + questionnaire + publish · prod rollout
· resubmit. **Open items for partner review:** (1) frontend UX choices the implementer flagged (~~push-gate
reuses LimitReachedScreen~~ — moot, push-gate REMOVED later 2026-06-03; `UPGRADE_URL` still the generic admin
hub — wire real `PRO_UPGRADE_URL` post-approval; Managed fair-use routes to BYOK only; Managed hides the key
field entirely; onboarding copy density). (2) The
**abandoned-breakdown KVS purge backstop** — breakdowns generated-but-never-pushed linger in KVS (within the
customer's own Atlassian instance, so low-risk; Anthropic-side auto-deletes ≤29d); honest in the DPA; optional
`scheduledTrigger` TTL sweep as a post-resubmit hygiene follow-up.

С усмивка ✨ — resubmit-блокерът е архитектурно решен + имплементиран + §13-gate-нат end-to-end; остават твоите external стъпки (compliance legal + deploy + portal pricing + resubmit).

---

## ⚡ HANDOVER NOTE (2026-06-02 — P1 Project Context injection SHIPPED end-to-end + §13 review gate)

A long, dense session on `feature/product-improvements` (dev only; NOT production — the launch
track stays on `feature/v3-pivot`). Built the FIRST product-improvements roadmap item end-to-end,
conducted via the agent model throughout. Dev = **v13.27.0**.

**P1 — Project Context / glossary injection — DELIVERED + VALIDATED end-to-end** (distil → inject →
generate → regenerate):
- **Named profiles** (multi-project per workspace; cross-project race fixed via `contextLoadedForPageId`)
  + a Ready-screen selector + per-page remembered pick. `src/index.js` (`normalizeContextProfiles`,
  `getContextProfiles`, `startGeneration` resolves the profile), `AdminSettings.jsx` `ContextProfilesEditor`.
- **"Distill with Claude" = a 6-call DECOMPOSED chunked pipeline** (`DISTILL_CATEGORIES` + `distillCategory`
  in `anthropic_client.js`; `startDistillSession`/`distillStep` + KVS session in `index.js` — mirrors the
  chunked JIRA push). Won an **8/8-vs-5/8 empirical Haiku bake-off** over a single call (which went
  depth-first and DROPPED whole categories on rich input). Each call extracts ONE category (Domain /
  Glossary / Personas / Tech / Regulatory / Conventions), <14s, merged + `trimToBudget`. Transport =
  **sync Haiku** with per-category caps (confidence-voted over re-adding `@forge/events` — which would
  regress the 0-vuln posture — and over sync-Sonnet/batch which timed out).
- **Prompts are DOMAIN-AGNOSTIC** (the load-bearing correction). They were a **sepsis PATCH** (named
  SIRS/qSOFA, enumerated the answer-key); the §13 audit caught it, generalized to abstract decisive-tests +
  diverse few-shots + a composite-axis-compression fix. **Multi-run validated** on clinical + fintech +
  logistics + the partner's own Spec2JIRA domain — **0 cross-domain bleed**.
- **Injection:** `buildSystemContent` (2 cached system blocks) + `buildProjectContextSystemText` +
  the SYSTEM_PROMPT "PROJECT CONTEXT" slot with a **DECISIVE BOUNDARY** (reference-only: enriches
  vocabulary, NEVER changes scope / authored ACs). `PROJECT_CONTEXT_MAX_CHARS` 8000→**12000** (the
  complete decomposed profile is ~7.5K on a rich domain; 8000 risked trimming the last category).
- **END-TO-END VALIDATED on the REAL Spec2JIRA epic** (WITH vs WITHOUT, 2 independent judges + a
  quantified pass): context **APPLIED** (created a Multi-Tenant-Isolation feature NO-context lacked;
  elevated confidence-0.7 to the "never collapse" design tension; LoRA/Entity-Graph/AST naming) AND
  **BOUNDARY clean** (37→35 = consolidation not scope-loss; all numeric ACs verbatim; the context's
  design-tension insight stayed in `spec_concerns`, not scope). Value concentrates at the
  architecture/vocabulary layer; self-evident content is a wash (honest finding). Accepted: BG ACs
  mirror the spec language (good); a borderline Marketplace-listing-prep demotion = low-severity,
  likely stochastic (N=1), accepted.

**Regenerate UX** (opening a page with a prior breakdown was a dead-end — old breakdown, no way to
regenerate): `handleRegenerate` + a **Regenerate button** (always on the review screen) + a
**stale-page banner** (Confluence `version.number` stored at generation → compared on reconnect →
"page edited since this breakdown") + **Start-over** on the generating screen + a **10-min heavy-load
reassurance notice** (a slow Anthropic batch no longer reads as "broken"). `App.js` + `index.js`
(version threaded job → `getResults`).

**POLICY §13 — Conductor Model + NEW binding MANDATORY post-implementation review gate:** after ANY
implementation change, run an **audit-review agent + a code-review agent** (combinable only if low
complexity). Proven this session: the audit caught the sepsis-patch that the code-review passed ("SHIP").
New memory: **`multi-run-prompt-validation`** (single-run over-claims on stochastic models — use 3+ runs
rule-by-rule; it bit us twice this session).

**NEXT — remaining product-improvements, BY ORDER** (re-Analyze each through the LENS at session start;
full detail in `docs/PRODUCT-IMPROVEMENTS-HANDOVER.md`):
1. **P1/P2 — Test-case generation** (next; table-stakes — both rivals have it, both do it poorly →
   chance to beat them; per-Story "Generate test cases" as a distinct LLM call, `bulletList` ADF not
   `taskList` (gotcha #11), surface failures loudly; likely Pro-tier).
2. **P2 — Custom prompt / house-style** (output-style enum + one free-text note; partly subsumed by
   Project Context already shipped).
3. **P2/P3 — Editor UX** (per-feature inline regenerate — STARTED via the new Regenerate button —
   bulk edits, clearer dependency editing, the open Forge scroll-to-top item).
4. **P-next — Managed (no-key) tier** (pricing FINALIZED: Managed Pro €9.90/seat cap 10 breakdowns per USER/mo
   (metered per-user, not pooled) vs BYOK Pro €4.90/seat unlimited; real work = DPA + zero-retention, not reselling approval).
   AFTER the launch/resubmit.

**PARALLEL launch track (separate, `feature/v3-pivot`):** Marketplace **v4.2.0 re-approval** pending
Atlassian; post-approval → Pro pricing config (BYOK Pro €4.90/user, €49 ≤10-user floor) + wire `PRO_UPGRADE_URL` → payment.

С усмивка ✨ — P1 е shipped, универсален, валидиран на реален epic, и review-gate-нат. Малкият feature
се оказа цяла подсистема (distill→inject→generate→regenerate), но е честен и доказан end-to-end.

---

## ⚡ HANDOVER NOTE (2026-06-01 PM — competitive analysis + positioning + product-improvements roadmap)

A **strategy/research** session (NO app-code changes; only docs + memory + listing copy). Direct-competitor
analysis on the partner's request → positioning decisions → a forward product roadmap.

**Competitive analysis (full report: `memory/competitive-landscape.md`).** Three Jira-native rivals profiled
(a multi-agent **workflow** read all 12 POPal docs + pricing + reviews; the rest via Marketplace REST +
partner screenshots/live trials):
- **POPal** (Agilemove, `popal.plugins.epicstory`) — THE incumbent: 211 installs · 4.1/5 (11 reviews) ·
  Jira **Cloud + DC** · ChatGPT · **hybrid vendor-paid + BYOK/private-LLM** · free ≤10 then ~$6/user/yr.
  Issue-level (title+desc ONLY), test cases + **Selenium automation scripts**, Zephyr/Xray, Project Context +
  layered prompts. Weak: slow (1-5 min), single-issue scope, support complaints, review-gate was flag-gated.
- **Storygenie** (`au.com.storygenie`) — cheapest: 45 installs · multi-model · **free ≤10** then ~$4.50/user/yr ·
  prompt→flat backlog · **no GDPR/SCC, "don't enter real data."**
- **StoryLoop** (Formkraft) — newest: 13 installs · GitHub PR-loop · but test-cases **BROKEN** on trial · ~€42, no free.

**Decisions (do NOT re-litigate):**
- **Positioning = "spec-to-backlog engine"**: altitude (whole spec, not prompt/ticket) · depth (hierarchy +
  dependencies + sizing) · privacy (BYOK = process your *real* spec under your own Anthropic agreement — the
  answer to Storygenie's "don't enter real data"). Dev-delight = a buying argument to the BA/PO.
  **`docs/MARKETPLACE-LISTING-v3.md` §2 sharpened to this** (apply on the NEXT listing edit; review still pending).
- **Free tier stays 3/mo** (raise to 5 only on complaints). Do NOT match rivals' free-≤10-unlimited — our
  value-per-breakdown is high + metric is per-breakdown; the mandatory **30-day Pro trial** is the "wow".
- **PRICING MODEL → per-user (same session, after a forced Marketplace change):** marking the app
  **"Paid via Atlassian"** forces per-user tiers (no flat fee) → Pro is now **€3.90/user/mo (1-10 tier =
  €39 floor, declining taper)**, NOT flat €39. This is the Atlassian-native model we'd already planned —
  it just arrived now. Listing §3/§6 + `memory/monetization-strategy.md` updated to match.
- **TWO Pro tiers (DECIDED 2026-06-02):** **BYOK Pro €3.90/seat = UNLIMITED** (≤10 = €39 floor) ·
  **Managed Pro €6.90/seat = fair-use 10 breakdowns/seat/mo POOLED** (≤10 = €69 floor; we pay compute
  → capped). Cap=10 → ~64% net margin now (Forge 0% fee <$1M) / ~47% post-$1M; loss-proof even in the
  all-max-64K pathological case. Chose 10 to future-proof (cap cuts later are customer-hostile). Managed
  = post-launch (needs our DPA + zero-retention; reselling path cleared). Cost model + edge cases:
  `docs/PRODUCT-IMPROVEMENTS-HANDOVER.md` + `memory/monetization-strategy.md`. Live resubmission ships
  **Free + BYOK Pro €3.90** only.
- **⚠ CORRECTIONS:** "only we're BYOK" is FALSE — POPal offers BYOK/private-LLM too (sharper angle = Anthropic +
  spec-level + customer DPA). The Managed-tier **"Anthropic reselling approval" premise is also wrong**: Commercial
  Terms **A.1 permit "powering your own product"**; our pipeline ≠ reselling → **no special approval needed**
  (formal reseller agreement optional only at ~6-figure API spend). Real work = our own DPA + zero-retention +
  customer DPA. (`memory/monetization-strategy.md` updated.)

**Forward roadmap → `docs/PRODUCT-IMPROVEMENTS-HANDOVER.md`** — build in a FRESH session on a NEW branch
**`feature/product-improvements`** (isolated from launch/resubmit on `feature/v3-pivot`): P1 **Project Context /
glossary injection** (table-stakes — both rivals have it) · P1/P2 **test-case generation** · P2 custom
prompt/house-style · P2/P3 editor-UX · **P-next Managed (no-key) tier** (HYBRID — keep BYOK). NOT doing: in-Jira
issue panel · per-dev-seat pricing. Future vision: capacity-sheet → sprint planning (spec→backlog→**plan**).
New memory: `competitive-landscape.md`, `product-improvements.md`.

**NEXT SESSION:** the launch/resubmit track below is unchanged; PLUS, when ready, spin up
`feature/product-improvements` from the handover doc.

---

## ⚡ HANDOVER NOTE (2026-06-01 — Marketplace rejection recovery + full listing rebuild + RESUBMITTED)

**The big reframe:** this was NOT a fresh Marketplace launch. The app (`e804f31f`,
listed "Spec2Tickets for Confluence", vendor `spec2jira`) was **REJECTED by
Atlassian's security BOT (2026-05-27): the remote host did not validate the Forge
Invocation Token (FIT)** — impersonation risk inherent to the OLD self-hosted Qwen
backend (`api.spec2jira.com`). The v3 BYOK/Forge pivot **architecturally eliminates
it** (no remote host → nothing to validate a FIT; confirmed `manifest.yml` has no
`remotes:`, only `permissions.external.fetch` → `api.anthropic.com`). Full record:
`memory/marketplace-launch-state.md`.

**Production (3 `forge deploy -e production --no-verify` today; prod was stuck on the
rejected 3.0.0):**
- Deploy 1 = the FIT fix (ship the no-backend v3 code).
- Deploy 2 = removed dead `@forge/events` dep (the ONLY runtime vuln source; unused —
  manifest has no consumers) → **0 runtime vulns** (`npm audit --omit=dev`).
- Deploy 3 = tightened 2 content-derived logs so "Log End-User Data: No" is true
  (`index.js:509` cycle-cut feature names → generic; `push_handler.js:776`
  subtask-failure payload → Jira status/messages/field-names only). The other
  content-touching line (`anthropic_client.js:540`) is a **user-facing returned error
  detail, not a Forge log** — left intact.
- `ENFORCEMENT_MODE=block` set + active (verified `usage.js:61` — anything ≠ 'meter'
  ⇒ block). Marketplace Hub auto-created versions **4.0.0/4.1.0/4.2.0** from the 3
  deploys; **4.2.0 = the final resubmitted build** (Forge prod is now "v4").
- **Smoke-tested GREEN** E2E (Settings→Generate→Review→Push) on
  **`alexacenov.atlassian.net`** (the partner's own clean site, Confluence+Jira).
  `vs-overlord22.atlassian.net` in `forge install list` = **an Atlassian reviewer's
  site** (partner has no access — confirmed via admin.atlassian.com); ignore it.

**Marketplace listing v4.2.0 — rebuilt v3-accurate; hunted the self-hosted/Qwen
narrative out of EVERY surface** (it hid in: tagline, summary, vendor "About", app
"More details", Highlight 2, the description). Now consistent across **code ↔ privacy
policy ↔ security questionnaire ↔ listing**:
- App details de-staled; "compatible with Jira" checked; personal-data=No; analytics
  empty. Vendor profile: new mission-led "About Spec2JIRA"; contact; **bank/payout**
  (UniCredit Bulbank AD, SWIFT UNCRBGSF, Sofia 1000; Tax ID=EGN as individual).
- **Privacy & Security questionnaire reconciled to the truth:** process-outside-
  Atlassian=Yes (Anthropic content); **EEA transfer=Yes + GDPR mechanism=Yes (SCCs via
  the customer's Anthropic DPA — lawyer-confirmed OK)**; Data Residency=**option 3**
  (stores within Atlassian — matches the scope justification + privacy policy; NOT
  "does not store"); log-sharing=No; scope justification filled (≤1000, 5 scopes +
  "creates-only-never-deletes"); security contact `security@spec2jira.com` (monitored).
- Version 4.2.0: More details rebuilt (Problem/Solution/Human-in-Loop/**BYOK** — no
  Qwen/GPU); summary "Forge + BYOK rebuild on Anthropic Claude"; License "Commercial -
  no charge" + **Bonterms standard EULA**; Highlights (H1 AI breakdown · **H2 "Your
  Data, Your Key" BYOK + fresh Settings screenshot** · H3 confirm-screen signals —
  *partner may polish the "Dashboard" title; the standalone Dashboard was removed in
  v3*); **Compatibility = Confluence Cloud + Jira Cloud**; Links (docs/privacy +
  standard agreement).
- **RESUBMITTED** → new ECOHELP ticket pending → BOT re-scan. Expected to pass: FIT
  (no remote host) + deps clean.

**NEXT SESSION (partner's stated plan):**
1. **When the new ECOHELP ticket opens → fill the required vendor questionnaires**
   (partner returns for this).
2. **Pro pricing — per-user €3.90/user (DECIDED 2026-06-01; Paid via Atlassian → 1-10 tier = €39 floor, declining taper).** Configured at the **APP level**, likely **gated until
   approval** (a rejected app can't sell). Sequence so block-enforcement has an
   upgrade path before the app is public (else free users dead-end at 3/mo — consider
   temp `ENFORCEMENT_MODE=meter`).
   `memory/monetization-strategy.md`.
3. ⭐ **POST-APPROVAL: wire `PRO_UPGRADE_URL` → real payment** on `LimitReachedScreen` +
   the Account-panel CTA (currently info-only). `memory/marketplace-launch-state.md`.
4. Spot-check all listing images are current English v3 (no old/Bulgarian/self-hosted
   stragglers).

С усмивка ✨ — отхвърлянето е архитектурно решено (не закърпено), listing-ът е честен
и v3-чист навсякъде, production е smoke-нат зелен, и app-ът е подаден за повторно ревю.
Готов за пазара — отново.

---

## ⚡ HANDOVER NOTE (2026-05-31 — pre-rollout: rigorous audit + dead-code cleanup + reliability + confidence/UX)

A long, high-density session on top of the launch-prep note below. **9 commits on
`feature/v3-pivot`** (all build-green + dev-deployed; the partner pushes):
`953a674` monetization · `3f69af5` review-ux · `196df13` confidence-required ·
`4f9cfc9` v2.x cleanup+TASK_TYPES · `bd6643e` reliability(cap+errors) ·
`091f999` possible_noise · `7ccf08f` truncation banner · `c8ec578` Account panel.

**Monetization / grandfathering**
- `recordFirstSeen`/`getInstallMeta` capture `install:meta.firstSeenAt` per install
  (KVS) from day 1 — the irreplaceable grandfather signal. Wired into getUsage +
  startGeneration (idempotent, fail-open) + a one-time `[install]` log.
- ⭐ **GRANDFATHERING MECHANISM (decided — do not re-litigate):** it is AUTOMATIC.
  At the future flat→tiers migration the app reads its OWN firstSeenAt (< cutoff →
  grandfathered) — the vendor does NOT track members manually. Forge has no central
  vendor backend (the privacy selling point), so vendor-side install/license
  visibility comes from the **Atlassian Marketplace partner portal / Licensing
  API**, NOT from KVS. firstSeenAt = the app's automatic enforcement; Marketplace =
  the vendor's records/comms. (See `memory/migration-protections.md`.)
- Customer-facing **Account/Plan panel** in Settings (Plan · breakdowns this month ·
  resets-on · Member since). Upgrade CTA wired on LimitReachedScreen.

**Generation quality / reliability**
- confidence_indicator + confidence_score now **required** in BREAKDOWN_SCHEMA (were
  optional → model omitted them → blank AI self-check on fresh breakdowns).
- Output cap **48K → 64K** (Sonnet max). Real specs ~3–11K words → ~6–21K output
  (~1.9K out/1K words). Salvage + truncation_note cover beyond.
- **Truncation banner** on Review: getResults now forwards truncated/truncation_note
  (was written-but-dropped — silent partial-breakdown gap) → orange warning.
- Friendly **Anthropic-down** handling in `_classifyBackendError`: distinct messages
  for 5xx/overloaded, rate-limit, out-of-credits, key-rejected (→Settings), network.

**Review UX (design-panel vetted)** — confidence card → honest "AI self-check"
(neutral card, demoted rating, self-rated caveat, Confident/Unsure/Low-confidence
labels, traceable flagged-feature worklist `extractV3Signals.flagged`, badge reads
confidence_score). Interactive cross-feature **dependency removal** on Review
(✕/restore mutating the breakdown JSON via `v3Schema.removeFeatureDependency` across
capabilities+features+_v3_original — E2E-verified in JIRA). Removed picker Dashboard
button + deleted orphaned Dashboard.jsx.

**v2.x dead-code audit (rigorous multi-agent: 1 contract → 5 finders → adversarial
verify → synth; 27 findings).** Deleted StoryCard.jsx+constants, generateBreakdown,
dryRun resolver, unadaptToV3, the partial_breakdown/phase-pipeline cluster,
confidence_reasons + dependency_metadata reads, TaskCard AC/deps editors, DOC_TYPES,
busy_other/result.busy branches, _uid reads, dead telemetry writes, and the
SharedACPanel `possible_noise` critic (kept the LIVE removed_by_user soft-delete).
**LIVE BUGS FIXED:** TaskCard type dropdown (stale v2.x 9-enum → v3 7-enum); the
BreakdownEditor "Total SP" was always 0 (summed a dead task field → now feature SP).
The audit correctly DISMISSED getInstallMeta as intentional forward-looking code.

**NEXT SESSION — Atlassian Marketplace rollout** (partner's stated plan). **First,
deploy to production** — it is a separate environment (the session's deploys only
touched `development`); the exact commands + the scope-re-consent note are in the
**Deploy workflow → Production rollout** block above: `npm run build` →
`forge deploy -e production` → `forge install --upgrade -e production` (Confluence +
Jira). Then: submit public listing v3.0.0 (`docs/MARKETPLACE-LISTING-v3.md` §2;
Free+Pro €20 editions; §4/§5 security; screenshots+icon) · push the site live
(landing/docs/privacy → spec2jira.com) + lawyer review privacy · verify production
`ENFORCEMENT_MODE=block` · Anthropic reselling inquiry · set the real `PRO_UPGRADE_URL`
once the listing is live.

С усмивка ✨ — продуктът е audit-нат-чист, reliable, honest, и tier-visible. Готов за пазара.

---

## ⚡ HANDOVER NOTE (2026-05-31 — launch prep: English UI sweep + least-privilege scopes + Marketplace listing doc)

Pre-Marketplace-listing polish on top of the 05-30 milestone. Three things landed:

**BG-mix English sweep** — all user-facing strings carrying Bulgarian particles →
pure English (`AdminSettings.jsx` ~25 strings incl. a removed stray per-breakdown
cost estimate; `Dashboard.jsx` 907/914/915; `App.js` 1632/1655/1709). Method note for
future sweeps: a line-anchored grep blind-spots multi-line JSX (where `>` sits on the
prior line), so an exhaustive `[а-яА-Я]` sweep over `static/src` is the authoritative
check — everything else is comments (BG in comments is fine per POLICY). Build green.

**Least-privilege scopes** — dropped the two dead classic Confluence scopes
`read:confluence-content.summary` + `.all` from `manifest.yml`. Repo grep proved only
search (`/wiki/rest/api/search`) + v2 pages (`/wiki/api/v2/pages/{id}`) are called — no
v1 `/content/{id}` remains. **Dev-verified**: PagePicker search + Generate both work on
the 5 granular scopes alone (`storage:app`, `search:confluence`, `read:page:confluence`,
`write:jira-work`, `read:jira-work`). Stale 403-handler hint in `index.js` updated;
revert hint left in the manifest comment. ⚠ Future-session note: the "400 Bad Request"
incident was `@forge/events` 2.x `Queue.push()` — NOT Confluence; Confluence was
410 Gone on v1 → migrated v1→v2. Don't conflate them.

**Marketplace listing doc** — `docs/MARKETPLACE-LISTING-v3.md`: the copy-paste source
for the vendor portal (tagline/summary/description/highlights/what's-new, Free+Pro
pricing editions, privacy+security listing fields, a full security-questionnaire draft
grounded in manifest+privacy, pre-submission checklist). Categories: Project management
+ Workflow. EULA: Atlassian standard (no custom terms).

**NEXT (2026-06-01):**
- **Marketplace listing submission** — upload public version 3.0.0, paste the §2 copy,
  configure Free/Pro editions, fill §4/§5 security, add screenshots + icon, submit for
  review. The listing doc has everything.
- **Anthropic reselling approval** — submit the vendor-pays inquiry (we pay the API).
  When approved, unlimited reverts to capped tiers (`memory/monetization-strategy.md`).
- Before prod: production `ENFORCEMENT_MODE=block` (default when unset); push the site
  (landing/docs/privacy) live to spec2jira.com; lawyer review of privacy.
- Open [YOUR CALL] from the listing doc: `security@` vs `support@` mailbox; final €20
  confirmation; screenshots.

С усмивка ✨ — английски почистен, scopes минимизирани и dev-verified, listing-ът подготвен.

---

## ⚡ HANDOVER NOTE (2026-05-30 — P3a tier enforcement + UX/cleanup pass)

The v3.0.0 MVP E2E arc (Generate → Review → Push) is SHIPPED and committed — see
git log + `docs/SESSION-2026-05-30-v3-mvp-e2e.md` for the original forensic arc
(every bug + fix + Forge-platform lesson). This session built on top of it:

**Scale-validated**: Spec2jira spec (39 feat / 162 subtask / dense deps) passed
end-to-end through chunked push.

**P3a — tier enforcement** (`src/usage.js`, new): per-site monthly breakdown
counter, license-aware `resolveTier`, `ENFORCEMENT_MODE`. Model **Free 3/month +
Pro €20/month unlimited** (BYOK-only economics — see `memory/monetization-strategy.md`).
`startGeneration` checks/consumes quota (fail-open, consume-on-success); `getUsage`
feeds the Ready-screen usage badge; quota_exceeded → upgrade message + exact reset date.

**UX pass**: scroll-to-top on screen change; JIRA deep-links (Open Epic + Story list)
on the success screen (`browse_base` from Epic `self` origin + `router.open`).

**Doc-hygiene**: stale comments fixed (executePush/queue → chunked startPush/pushStep);
README rewritten; AGENTS.md removed (misleading generic Forge boilerplate); version → 3.0.0.

**NEXT entry points**:
- **⚠ Before prod**: `ENFORCEMENT_MODE='block'` needs the €20 Marketplace listing
  LICENSE-ENABLED, else free users dead-end. Use `meter` mode for dev testing.
- **P3b — Marketplace listing**: pricing/privacy/docs + early-access framing +
  grandfather early adopters (`memory/migration-protections.md`). Apply BEFORE go-to-market.
- **Vendor-pays**: pending Anthropic reselling approval → reverts unlimited to capped tiers.
- Monitor KVS push-session size on very large specs (~240KB limit).

С усмивка ✨ — MVP е технически доказан, scale-validated, и tier-enforced.
