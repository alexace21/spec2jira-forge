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
> resolvers. ⭐⭐ **PRICING IS USD AS OF 2026-06-04 (live portal): BYOK Pro $6.70/user (unlimited, "Standard"; ≤10 users = $57/mo flat, declining curve >100)** and **Managed Pro $13/user (fair-use 10/user/mo, "Advanced") — COMING SOON (editions Phase 2, post-publish; `price=null` in-app until then, shown on the site as "coming soon")**. The **€4.90/€9.90/€49/€39/€20 figures throughout this section AND the older handover notes are the RETIRED EUR plan — read them as history.** The per-user *mechanics* (per-user via Paid-via-Atlassian, declining curve, ≤10 floor) remain authoritative; only the currency/figures + the Free-tier framing changed. Source of truth: `src/usage.js` (BYOK `$6.70/user/mo`; Managed `null` until Phase 2) + the live vendor portal.

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
forge deploy -e production             # deploy code to production (auto-creates the Marketplace version)
# ⚠ do NOT `forge install` on prod — see below (licensed app → Marketplace-only)
```

- ⚠ **NO `forge install` on production.** This is a **licensed (Paid-via-Atlassian)** app →
  `forge install` on prod fails `LICENSED_APP_INSTALL_NOT_PERMITTED` (and `--license` is
  dev-only). Production distribution is **Marketplace ONLY** — customers subscribe/install via
  the listing. Prod rollout = `forge deploy -e production` (which AUTO-creates the Marketplace
  version — no manual portal "Create version") → then resubmit/publish via the portal. *(The
  obsolete pre-licensing v3/v4 step `forge install --upgrade -e production` is RETIRED since the
  v5 licensing migration — following it now throws `LICENSED_APP_INSTALL_NOT_PERMITTED`.)*
- **Production `ENFORCEMENT_MODE`** is `block` by default when unset — it governs ONLY the
  **Managed Pro** per-user fair-use cap (BYOK is unlimited; unlicensed is blocked natively by
  Atlassian — there is NO in-app Free tier). Usually no action. Set explicitly:
  `forge variables set --environment production ENFORCEMENT_MODE block`. Also set
  `MANAGED_ANTHROPIC_KEY` on prod (for the Managed/Advanced edition — wired at editions Phase 2).
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

## ⚡ HANDOVER NOTE (2026-06-22 — ⭐⭐⭐ Capacity-Sheet Planner arc LIVE ON PRODUCTION (Marketplace v6.0.0) + a pre-prod gate caught 2 §11 fixes; agent-conducted)

> ⚠ Branch-independent record: **`memory/capacity-sheet-planner.md`** (the LIVE-on-prod block at top) · [[deep-audit-vs-per-change-gate]]. Durable in-repo: `docs/PLANNER-LIVE-ACCEPTANCE.md` + `docs/PLANNER-KANBAN-LIVE-ACCEPTANCE.md`.

**THE WHOLE Capacity-Sheet Planner arc is LIVE on the public Atlassian Marketplace** — app `1475765564`, **Forge version 6.0.0**, release date **Jun 22 2026**. spec → backlog → **PLAN → Jira**, both **Scrum** (native Agile sprints) and **Kanban** (backlog rank Now→Next→Later + `plan-now/next/later` tier labels), on **team-managed AND company-managed** boards. Shipped from **`release/v6.1.0`**: partner `git push` + `forge deploy -e production` (auto-creates the Marketplace version) + portal publish. ⚠ **NO `forge install` on prod** (licensed → `LICENSED_APP_INSTALL_NOT_PERMITTED`); the post-deploy CLI hint "run forge install --upgrade / restart tunnel" is generic boilerplate for DEV — on a licensed app the scopes take effect via Marketplace + customer re-consent, NOT forge install.

**⚠ Re-consent is LIVE now.** This release adds **5 jira-software scopes** (`read:board-scope:jira-software`, `read:project:jira`, `read:sprint:jira-software`, `write:sprint:jira-software`, `write:issue:jira-software`) → every existing customer's site admin is prompted to re-approve in **Manage Apps**. Until approved: the legacy breakdown→push path keeps working; the new plan-to-Jira features are dormant for that customer (graceful, by design). The release summary/notes were written to surface this (the ≤80/≤1000 Marketplace copy is published).

**⭐ Pre-prod adversarial gate (BEFORE the deploy) — the headline rigor win.** A 9-agent Workflow (3 lenses: SP-fix regression · Kanban-push integrity · prod-deploy safety → verify-per-finding) returned **0 prod-blockers, 6 confirmed findings**, AND caught **2 real §11 silent-success gaps on the Jira WRITE paths that EVERY per-change §13 gate + the full 9-phase live acceptance MISSED** ([[deep-audit-vs-per-change-gate]] vindicated at the prod gate): a Jira **207 (Multi-Status = partial)** was read as a clean full success on BOTH push paths. Fixed: **Kanban rank `5fef67e`** (FE-only) + **Scrum sprint-move `d8c86a6`** (3-layer mirror `moveIssuesToSprint`→step→`AssignSprintsPanel`) — now a 207 surfaces a "Verify the …" nudge. Both additive (200/204 happy path byte-identical; only the mishandled 207 changes), §13-gated SHIP, build green. **LESSON (fold into the deep-audit memory): even after a clean 9-phase live acceptance, a fresh adversarial pass at the prod gate finds load-bearing §11 residue on the un-live-testable error branches — run a pre-prod gate before any outward-facing WRITE-path prod deploy.**

**Final commit chain (`release/v6.1.0`):** `82ea249` Scrum planner (Tier 1+2) → `b928704` Kanban v1 → `99f8759` Kanban push → `47ffc0b` SP-field team-managed fix (resolve Story-Points from the project's create screen via createmeta, not the global field list — gotcha #7 mixed-instance class) → `5fef67e` Kanban 207 §11 → `d8c86a6` Scrum 207 §11. Mechanical pre-prod gate all green (node --check 11/11 · tests 290+36+uid ✓ · build exit 0 · clean tree).

**Post-launch tracked (all minor, non-blocking):** ① **diagnostics version string stale** — `src/diagnostics.js:56` `DIAG_APP_VERSION` + `package.json:3` are `3.0.0` while Marketplace = 6.0.0 → bump BOTH on the NEXT release (the live diagnostics export currently shows 3.0.0; the comment says "BUMP ON RELEASE"; don't deploy just for a string). ② gate low-residuals: `createmeta` field pagination / SP global-fallback (only on >50-field Story create screens), rank anchor advancing past a failed tail key on a 207-partial, unsized features getting no post-push rank reminder. ③ dependency `name_unknown` paraphrase residual ([[layer1-name-uid-tasks]] deferred). ④ optional 1-min company-managed (SDKY) smoke re-verify.

**Branch hygiene (partner-executed, from session start):** delete merged `feature/product-improvements` + `feature/v3-pivot`; retire `feature/capacity-sheet-planner`; decide `main` = trunk.

С усмивка ✨ — целият spec → backlog → **PLAN → Jira** arc е жив на production: risk-aware sequencing, what-if, defensible brief, skill-aware capacity, goal-directed re-rank, и Push-to-Jira (native sprints + Kanban rank), на team- и company-managed бордове. Pre-prod gate-ът хвана 2 §11 пропуска точно преди прода — затова го пускаме. Продуктът е на друго ниво.

---

## ⚡ HANDOVER NOTE (2026-06-21 — ⭐⭐⭐ Capacity-Sheet Planner arc LIVE E2E ACCEPTED on dev (all 9 phases green) + 8 live-only bugs found & fixed; agent-conducted)

> ⚠ Branch `feature/capacity-sheet-planner` (off `release/v6.0.0`). **NOT committed/deployed to prod — dev-only; partner commits.** Branch-independent record: **`memory/capacity-sheet-planner.md`** (the full LIVE-acceptance record + the 8 fixes + what's next) · [[deep-audit-vs-per-change-gate]]. Durable in-repo: **`docs/PLANNER-LIVE-ACCEPTANCE.md`** (the filled 9-phase sign-off) + **`docs/PLANNER-MR1-TEST-SPEC.md`** (the crafted MR-1 test spec + rubric).

This session: a full **LIVE end-to-end acceptance** of the whole Tier-1 + Tier-2 planner arc on `spec2jira-dev` (real Anthropic key, real Confluence pages, real Jira), conducted via the §13 model throughout (Workflow agent gates after every fix; I = conductor + verdict-taker). **All 9 runbook phases GREEN. 310 offline tests + build green.**

**MR-1 SHIP gates (partner-run, ≥3 live runs rule-by-rule):** Phase 3 risk-sequencing **PASS** (R1 hard-dep 3/3 · R3 de-risk-subordinate 3/3 · R2 3/3, zero flicker; **zero variance** across 3 runs). Phase 9 P12 **PASS-with-findings** (hard-dep 3/3 all objectives; `min_risk` visibly+correctly distinct — AI Triage S4→S3; no LESSON-E leak. ⚠ FINDING: for a backlog where priority=value=MVP align, `mvp`≈`max_value`≈Balanced — only `min_risk` re-weights; `max_value` may be GENERALLY close to Balanced. Accepted, not a bug — the clauses inject + re-weight, they just converge).

**P15 Push-to-Jira (real Agile Sprints) — WORKS end-to-end, incl. TEAM-MANAGED projects** (the new Jira "Spaces"): "Assigned 17 issues across 5 sprints", native sprints on the SCRUM-DEV board with the right Stories + dates + points. ⚠⚠ **P15 adds 5 jira-software scopes (was 3) → customer RE-CONSENT** (`forge install --upgrade -p jira`).

⭐ **Live acceptance caught 8 REAL bugs that 310 offline tests + EVERY per-change §13 gate missed** ([[deep-audit-vs-per-change-gate]] strongest run yet; POLICY §9 live-is-authority repeatedly vindicated). All found → fixed → §13-gated → live-re-verified. Classes: **write-time optimism · cross-layer ref-correlation breaks (uid↔name, plan↔purge) · live-only scope/platform truths**. Headlines (full detail in `memory/capacity-sheet-planner.md`): (1) reload → names shown as raw uids (self-describing plan — return `record.features`); (2) reload → false stale banner (`planSourceHash` keyed on volatile FE-minted `_uid` → re-key on stable CONTENT); (3) brief verdict over-promised vs skill-overflow; (4) skill-bottleneck attribution (`bucketOverDemand` not `bucketUnmet` collateral; GEN excluded); (5) post-push "Assign sprints" → "Generate a plan first" (purge deletes `plan:<jobId>` → capture-before-purge via payload); (6) Agile 401 — manifest scopes valid but INSUFFICIENT (+`read:project:jira` for GET /board, +`write:issue:jira-software` for move); (7) team-managed board not found (type `'simple'` not `'scrum'`); (8) sprint name HTTP 400 (<30-char cap → truncate prefix, keep "Sprint N"). **For an outward-facing WRITE path (Jira), live acceptance is non-negotiable — none of these were offline-detectable.**

❌ **user-named sprints — DISMISSED (partner, 2026-06-21):** users can rename a sprint (and edit it) natively in Jira → an in-app naming field is redundant. The auto `"{page} · Sprint N"` (truncated ≤29) is just the initial name; no code change. ⇒ **No blocking 'next' — the arc is ACCEPTED.** Remaining is optional secondary (CORE arc accepted): Phase-8 idempotent-re-run confirm · company-managed Scrum test (§9-③; team-managed PASSED, company-managed is the more-standard Agile case) · Phase-7 opt-out · copy-failure fallback (full list in `memory/capacity-sheet-planner.md`). Then commit (DONE this session) + (when ready) fold toward release (⚠ P15 = customer re-consent, 5 jira-software scopes).

С усмивка ✨ — целият spec → backlog → **PLAN** arc е жив и приет на дев: risk-aware sequencing, what-if, defensible brief, skill-aware capacity, goal-directed re-rank, и Push-to-Jira с native sprints (вкл. team-managed). Live acceptance-ът хвана 8 реални бъга, които offline никога нямаше да види — точно затова го правим. Следва user-named sprints.

---

## ⚡ HANDOVER NOTE (2026-06-18 — ⭐⭐⭐ v6.0.0 SHIPPED TO PRODUCTION + LIVE-acceptance GREEN + UI/UX pass + site filtered; agent-conducted)

> ⚠ Branch-independent record in `memory/` (always-loaded), ALL updated this session: testcase-generation-feature · site-launch-punchlist · marketplace-launch-state · v6-value-split-editions · deep-audit-vs-per-change-gate · **capacity-sheet-planner (NEW — the next chapter)**.

### v6.0.0 is LIVE on PRODUCTION + full LIVE-acceptance GREEN
Partner ran a complete LIVE E2E acceptance on dev (Standard + Advanced) and **deployed v6.0.0 to production** (`forge deploy -e production` → auto-creates the Marketplace version; NO `forge install` on prod — licensed). Manifest diff v5.4.0→v6.0.0 = **NO new scopes** (no customer re-consent) + the new `scheduledTrigger` (orphan-sweep; registers per customer upgrade). The big v5.5.0/v6 delta (test-cases, diagnostics, dashboard, orphan-sweep, value-split editions) + this session's UI/UX pass are now on prod.

**LIVE-acceptance verdicts (all GREEN):**
- **Standard (BYOK Pro $6.70):** breakdown→edit→review→push (Epic+stories+subtasks+links) · Project Context · distill · onboarding. Batch cost confirmed ($0.045/10-feat = batch-priced; Epic-D fix live).
- **Advanced (BYOK $13.40 + test-cases):** ⚠ **edition switch needs `forge uninstall` + fresh `forge install --license advanced` (lowercase) — `install --upgrade --license` is a NO-OP at latest version.** $13.40 plan · gated test-cases · armed 2-step confirm · push embed `tc_embedded=13` · regen cost accumulates ($1.27→$1.31) · BA-grade Gherkin/CSV export · reconnect.
- ⭐ **Margin-leak (existential) LIVE-CLEAN:** Advanced generated on the BYOK key with `MANAGED_ANTHROPIC_KEY` UNSET → Advanced ≠ Managed, proven live.
- 📊 **Cost calibration:** the "up to ~$X" CEILING HELD on real data ($1.27 < $2.45 — deep-audit true-ceiling fix validated); "typically ~$Y" ran ~3× low ($0.44 vs $1.27, decision-table-dense domain) → calibrate `TC_OUTPUT_TOKENS_PER_AC` post-launch on N≥3-5 echoed runs (NOT on N=1); record (typically→actual) pairs. [[testcase-generation-feature]].

### Post-push fixes + traffic-light UI/UX pass — SHIPPED (`140c699`) + LIVE-verified
Partner UX punch-list from acceptance, §13-gated (14-agent sweep workflow: build PASS + adversarial review; + a code-review of the hand-written logic = SHIP) + build green + LIVE-verified on the deployed app:
- **Post-push regression door CLOSED** — removed "Back to Editor" from the success screen (purge made it a stale trap); now terminal/forward-only.
- **Post-push export (capture-before-purge)** — the export is BACKEND-rendered (`getTestCaseExports` reads KVS → 404s post-purge), so the FE captures the rendered Gherkin/CSV into memory BEFORE `purgeJob` and offers Copy on the success screen (`PostPushExport`). Privacy-safe (memory-only; purge unchanged, runs every path).
- **Honest embedded Jira pointer** (`src/testcases.js`) — no longer promises a post-purge screen.
- ⭐ **Traffic-light icon system** — NEW `src/components/Icon.jsx` (21 inline-SVG icons, zero deps) + `Signal.jsx` (`SignalIcon`/`SignalCallout`: red triangle=error / amber=warning / blue circle-i=info / green check=success; callout body text stays DARK for legibility). App-wide sweep replaced **~95 ad-hoc emoji across 11 files**; Picker 7-day notice → a legible blue info callout. `confidence_indicator` ✓/⚠/✗ badges CORRECTLY LEFT (schema DATA values). ⚠ **FOLLOW-UP:** professionalize them via a RENDER-ONLY glyph→SignalIcon map (data/comparisons untouched — the [[layer1-name-uid-tasks]] display-vs-key pattern).

### Production env-var hygiene (decided this session)
Prod: `ENFORCEMENT_MODE=block` + `MANAGED_ANTHROPIC_KEY` (set); `MANAGED_USER_CAP` unset (default 25). ⭐ **Both are UNSET-SAFE on prod under v6** — the "don't unset MANAGED_ANTHROPIC_KEY (legacy jobs drain on it)" caution applies ONLY to envs that ran Managed (dev); **prod never sold Managed**, and v6 `resolveTier` NEVER returns `keySource:'managed'` (both editions BYOK). **Recommended: UNSET `MANAGED_ANTHROPIC_KEY` on prod** — removes an unused live credential AND makes the margin-leak guard STRUCTURAL (a stray managed resolution fails-loud, not silently bills). `ENFORCEMENT_MODE` = no behavior change either way (unset→defaults to block). Re-add both only if off-Marketplace Managed is ever revived (editions Phase-2 does NOT need them — Advanced is BYOK).

### Site (spec2jira.com — SEPARATE repo, partner pushes) — filtered to v6, NON-DESTRUCTIVE
Filtered with `<!-- v6 -->` comment-toggles (nothing deleted): **pricing** Managed Pro→Advanced (card/Q&A/finenote/3 meta); **privacy** all Managed-tier sentences hidden (#managed section + intro one-liner + §2 + §6 + §9-GDPR); **footer /dpa + /subprocessors nav paths HIDDEN across all 10 pages** (pages stay live at URL); the **four 7-day-sweep toggles FLIPPED** (sweep shipped). `dpa/`+`subprocessors/` BODIES kept LIVE + untouched (lawyer-approved Managed docs, only unlinked). "Spec2JIRA" = intentional vendor/domain name (left). ⚠ Partner pushes the site repo (+ still-uncommitted `get-api-key/index.html` + docs link). [[site-launch-punchlist]] · [[compliance-source-of-truth]].

### ⚠ EDITIONS GATE (still open — the one critical deploy-timing constraint)
Editions still PENDING review (v5.4.0 submission: Standard BYOK live + **Advanced = "Managed Pro" pending**). The "approved" in the OLD ECOHELP ticket is the old app-version approval, NOT the editions (verify in portal → Editions tab). ⚠ v6 code maps Advanced → **BYOK + test-cases (NOT Managed)**. Deploying v6 was SAFE (only Standard live; Advanced dormant in prod). But **do NOT publish the pending Advanced-as-Managed edition under v6** — reconfigure it to **BYOK + test-cases $13.40** at editions Phase-2 (POST-PUBLISH) BEFORE it goes purchasable, else an Advanced subscriber promised "no key" gets a BYOK product. v6 Advanced=BYOK → **lighter compliance** (no Managed DPA needed); `usage.js` Advanced price already $13.40 (no flip). [[marketplace-launch-state]] · [[v6-value-split-editions]].

### ⭐ NEXT CHAPTER — Capacity-Sheet Planner (new branch `feature/capacity-sheet-planner`)
Partner's chosen next feature: the user feeds their team's **capacity sheet for a quarter** → the app proposes an **AI sprint/Kanban PLAN** (spec → backlog → **plan**, the long-stated future vision). Full vision + LENS §0 framing + Analyze→Design starting points + the pure-function-vs-LLM dispatch in **[[capacity-sheet-planner]]** (NEW memory). Develop NEXT session via the §13 conductor model (Analyze→Design→Solve, agents — do NOT jump to Solve). `feature/product-improvements` is CLOSED (fully merged into release/v6.0.0; local branch deleted; ⚠ partner deletes the remote: `git push origin --delete feature/product-improvements`).

С усмивка ✨ — v6 е жив на production, acceptance-GREEN, UI-полиран, сайтът честен; следва Capacity-Sheet планиращият помощник.

---

## ⚡ HANDOVER NOTE (2026-06-17 — ⭐⭐⭐ v5.4.0 LIVE on Marketplace + ⭐ v6.0.0 EDITION-STRATEGY PIVOT to value-split BYOK; agent-conducted)

> ⚠ **This note is on `release/v6.0.0`. The FULL v5.4.0-launch handover lives on `release/v5.4.0` (commit `a056b4d`); the branch-independent record is in `memory/` (marketplace-launch-state + v6-value-split-editions + marketplace-publish-mechanics + monetization-strategy + product-improvements — ALL updated this session, always-loaded).**

### Part 1 — v5.4.0 SHIPPED + LIVE (brief; full detail on release/v5.4.0 + memory)
The app is **officially live + publicly discoverable on the Atlassian Marketplace** — **https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira** (App ID `e804f31f`). v5.4.0 (Build 2000080, PUBLIC, 2026-06-17): branding Spec2JIRA→Spec2Tickets + Managed cap 10→25. **Editions SUBMITTED 2026-06-17 → PENDING** (Standard BYOK $6.70 / Advanced Managed $13.40). Privacy&Security tab BYOK→hybrid submitted; site updated (real Marketplace URL + honest 7-day-sweep `<!-- v5.5.0 TOGGLE -->` comments) + lawyer-approved. POST-APPROVAL TODO + the HARD-WON publish mechanics (editions cumulative; Privacy-tab nests share-with-sub-processor UNDER store-outside=Yes) → `memory/marketplace-launch-state` + `memory/marketplace-publish-mechanics`.

### Part 2 — ⭐ v6.0.0 EDITION-STRATEGY PIVOT (the new decision; north star = `memory/v6-value-split-editions`)
Partner flagged: Managed (no-key) is a weak differentiator + test-cases are too expensive to cap. An 11-agent §13 stress-test + 3-judge confidence vote (**8/7/7, unanimous PROCEED_WITH_CHANGES**) validated the pivot. **Editions pivot from KEY-SOURCE → VALUE; both BYOK. Standard (BYOK $6.70) = core breakdown+push + Project Context · Advanced (BYOK $13.40) = + test-case generation + custom prompts + future-expensive.** Managed DROPPED as a Marketplace edition (off-Marketplace fallback; deletes the cap/metering/COGS/Managed-DPA burden). Market-validated (no rival splits on key-source; the Bake "Unlimited vs Metered" natural experiment; ChatPRD/$13.40 pricing). **6 binding execution requirements** (Phase-2-timing · NEW `hasTestCases` capability not overloading `advanced`=Managed · cost-transparency launch-blocker · BYOK onboarding wizard · single-anchor on test-cases · honest no-key-segment framing) — all in `memory/v6-value-split-editions`. **Future vision: Capacity Sheet → planning** (PO/BA capacity → breakdown+complexity → sprint PLAN, Kanban/Scrum).

### Part 3 — ✅ BRANCH RECONCILIATION (v6.0.0 prep) — DONE 2026-06-17 (commits `35a56b5` + `3c7d503`; local, partner pushes)
**`release/v6.0.0` is now reconciled** (was `7bb7159` + branding + cap-25 only). Merged in:
- **`release/v5.4.0`** (`35a56b5`): the compliance pack (`docs/compliance/*-v5.4.0.md` — DPA/questionnaire/subprocessors/TIA/IR/privacy-tab + partner checklist). v5.4.0 differed from v6.0.0 in docs ONLY.
- **`feature/product-improvements`** (`3c7d503`): the WHOLE v5.5.0 delta (38 commits — test-cases P1-P5 + §7 injection + editable screen/export, diagnostics ledger `src/diagnostics.js`, Layer-1 #3/#4/#13 orphan-sweep `src/sweep_util.js`, live dashboard, distill/cycle-fix hardening).
- **Conflict resolution (verified):** usage.js → cap-25 KEPT; manifest.yml auto-merged with BOTH branding AND the orphan-sweep `scheduledTrigger`; App.js clean (0 residual user-facing "Spec2JIRA"); ONLY CLAUDE.md conflicted (kept v6.0.0's superset handover). **Verified GREEN:** `node --check` all 9 `src/*.js` + `npm run build` "Compiled successfully" (`spec2tickets-ui@0.1.70`).
→ **v6.0.0 ADDs (north star = `memory/v6-value-split-editions`):**
- (2) ✅ **DONE 2026-06-17** (`6d344eb`, local) — `hasTestCases` gating + DECOUPLE key-source/edition/feature. A 3-judge "P1-spine hybrid": explicit per-tier `keySource`+`hasTestCases` (Object.freeze'd TIERS), NEW `byokAdvanced` (BYOK/unlimited/$13.40/test-cases), `byokPro`→"Standard" (key unchanged), `managedPro` DORMANT (`edition:'managed'`); `resolveAnthropicKey` reads `tier.keySource` (THE cut); fail-CLOSED `hasTestCases` gate on start/regen/save test-case resolvers (reads/exports ungated); FE dead-ends removed (key field always shows), ConfirmScreen/TestCasesScreen gated, `edition_required`→LimitReachedScreen, value-framing copy. **Verified: truth-table 34/34 + build green + §13 4-lens gate SHIP** (no margin-leak/dead-end/leak; 6 findings folded in). ⚠ **DEPLOY-TIMING (runbook):** portal Advanced still=Managed until Phase-2 → portal copy FIRST, code SECOND; do NOT unset `MANAGED_ANTHROPIC_KEY` at cutover (legacy jobs drain on it).
- (3) ✅ **DONE 2026-06-17** (`d9d4f22`, local) — cost-transparency (pre-flight estimate + post-run echo) for test-case generation. P1-Lean design + 4-lens §13 gate (findings folded in). `estimateCost({batch})` ×0.5 (Batches API = 50% — confirmed; breakdown poll flipped → corrects a pre-existing 2×-high dev cost_usd); `projectTestCaseCost` (cache-amortized, never the 24K ceiling as expected); echo captures `message.usage` on every branch → `tcjob.usage` (regen-accumulating, idempotent) → `getTestCases` cost; NEW read-only `estimateTestCaseCost` resolver. FE: pre-flight "up to ~$X (typically ~$Y) · your key, no markup · exact after run", armed-confirm now covers first-time generate (bill-shock vector) + stale, post-run echo (ConfirmScreen + SummaryBar). `prototype/test_v6_cost.mjs` 22/22 + build green. ⚠ POST-LAUNCH: calibrate the output heuristics vs real echoed runs.
- ✅ **DEEP AUDIT DONE 2026-06-18** (`52603b0` + `977f50e`) — a 19-agent per-epic persona legion (6 lenses) + a 2-lens fix-verification gate audited the whole shipped v6 surface (Epics A-E from the acceptance plan). **Verdict: STRONG SHIP.** Epic A 9/9/9 (clean merge); Epic C **9/9/9/9 — margin-leak guard unanimous clean** (Advanced=BYOK-not-Managed, the existential risk); B/D/E SHIP_WITH_FIXES. **8 real cross-cutting defects** the per-change §13 gates missed — all fixed + verified (tests 34/34 + 25/25 + build green): the headline = test-case "up to ~$X" was NOT a true ceiling (verbose run could exceed 1.5-8×) → now the true per-story ceiling; + failed-regen echo under-count, concurrent-regen double-count, phantom "+ custom prompts" copy (dropped → single-anchor), edition_required discarding the in-flight breakdown, downgrade TestCasesScreen read-only. See [[deep-audit-vs-per-change-gate]].
- (4) BYOK onboarding wizard (in-app + site; ⚠ compliance/site source of truth = the SEPARATE `spec2jira-site` repo, NOT forge `docs/compliance/*` which are stale) · (5) keep Project Context in Standard, single-anchor Advanced on test-cases. Edition re-config (Advanced: Managed→test-cases) = Phase 2 post-approval. **DON'T touch the pending v5.4.0 editions.**

С усмивка ✨ — продуктът е жив; стратегията е заострена и stress-test-ната; branch-овете са reconciled + build-green; следват трите v6.0.0 ADD-а под value-split editions.

---

## ⚡ HANDOVER NOTE (2026-06-04 EOD — spec2jira.com rebuilt to USD + in-app "spec"→"page" cleanup + DPA/SEO/a11y; agent-conducted)

A long, agent-conducted session (§13 throughout) updating the **public site** + customer-facing app copy. The site lives in the **SEPARATE GitHub Pages repo** (`C:\Software Engineer\Success\AI-delivery\ai-delivery-platform\MVP-roll-out\spec2jira-site\spec2jira-site`; auto-deploys on `git push`). All §13 gates passed (incl. a 5-agent adversarial audit + per-wave reviews). **NOT committed/deployed — partner pushes the site + builds/deploys the forge app.**

**Site (spec2jira.com) — REBUILT:**
- **New IA:** removed How-it-works + Pricing from the landing → dedicated **/how-it-works** + **/pricing**; added **/about**; standardized nav (5 links) + footer (8 links: …+ DPA + Sub-processors).
- **Value-first landing**, hero **"Your Confluence page → a sprint-ready Jira backlog."** (partner-picked; the jargon "spec" was dropped from the hero — customers may not parse it; the subhead anchors it as "a spec, PRD, or requirements doc"). Stats: **~70%** less hand-work / minutes-not-days / 100% human-reviewed.
- **USD pricing** everywhere: **BYOK Pro $6.70/user** ($57 ≤10 flat, declining >100); **Managed Pro $13/user "Coming soon"** (editions Phase 2). Old "Free 3/mo" dropped → 30-day trial.
- **Published /dpa + /subprocessors** (clean — NO `[PARTNER]` placeholders; Anthropic facts WEB-VERIFIED true: ≤29-day non-ZDR Batches, no-training default, SCCs incorporated). Processor named = **Aleks Asenov Asenov** (sole trader; Ovcha Kupel 2, Sofia, BG; governing law Bulgaria). Privacy scoped (BYOK-absolutes → BYOK only + Managed role-map; "removed on push" softened to honest wording).
- **A11y**: `--gray`/link contrast → WCAG AA; `<main id>`+skip-link, `:focus-visible`, heading order, `aria-hidden` (all 8 pages). **SEO infra**: favicon.svg, sitemap.xml, robots.txt, 404.html, OG/Twitter+canonical on all 8. ⚠ **og-image.png PENDING** — partner exports `og-image.svg` → 1200×630 PNG (social cards reference it).

**App (forge) — copy + price:**
- `usage.js`: BYOK €4.90→**$6.70/user**; Managed €9.90→**`null`** (Managed isn't a buyable edition until Phase 2 — a price there surfaced a false "Subscribe to Managed" CTA in AdminSettings; `null` hides it everywhere, verified safe; $13 lives on the site as coming-soon).
- **In-app "spec"→"page/document" cleanup** (~19 user-facing strings: App.js + AdminSettings + FeatureCard + SharedACPanel + the `v3Schema` `'Spec Breakdown'`→`'Untitled Breakdown'` fallback) — customers may not understand "spec". Backend prompts (`prompts.js`), comments, identifiers (`spec_concerns` etc.) correctly LEFT. Also fixed a stale in-app **"60–150 seconds"→"a few minutes"** (batch reality). 3 €→USD code-comments. **Build verified GREEN** (`npm run build`). ⚠ Frontend changed → needs `npm run build` + `forge deploy`.

**OPEN — partner-executed:** (1) **commit+push the SITE** (5 NEW untracked infra files: 404.html / favicon.svg / og-image.svg / robots.txt / sitemap.xml) + **build+deploy the forge app** (separate the pricing commit from the copy commit, per review). (2) **Export og-image.png.** (3) **DPA legal confirm-true** before relying on /dpa: MFA (dev + Managed Anthropic accounts) · no-content-logging (Managed path) · written confidentiality · a defined incident-response process · a maintained TIA · monitored privacy@/security@ · confirm SCC Module 2 — full list in **`memory/site-launch-punchlist.md`**. (4) Post-approval: wire the real Marketplace listing URL into the CTAs + `PRO_UPGRADE_URL`.

С усмивка ✨ — сайтът е USD-чист, по-ясен (без жаргонния "spec"), достъпен, с публикувани легални страници; app copy-то е изчистено; всичко §13-gate-нато. Остават твоите push/deploy + og-image export + legal confirm.

---

## ⚡ HANDOVER NOTE (2026-06-04 PM — Marketplace blocker RESOLVED; resubmit = BYOK-Pro single-edition; pricing set; 3 bugs fixed)

**Supersedes the 2026-06-04 note below** (its "fundamental PvA blocker → open Atlassian ticket" is RESOLVED). Live portal/CLI behavior is the authority (POLICY §9).

**⭐ PvA "more than one parent software" — RESOLVED (no ticket needed).** NOT the manifest (removing AND keeping `compatibility.jira` both failed — Jira Cloud showed [REQUIRED] regardless). **Fix: vendor portal → app → [version] details → Compatibility tab → remove Jira (leave Confluence only) → Save** → "Make public" passed (Confluence = sole billing parent; Jira optional/no-badge). The listing Compatibility tab declared Jira as a 2nd billing parent, independent of the manifest.

**Gotcha #10 HOLDS** — the Jira push still needs the Jira install (`forge install -p jira`; a Confluence-only install 403s). Jira = an optional installed CONNECTION (manifest `jira.required:false` + `write:jira-work`); the Compatibility-tab removal only drops it as a billing PARENT, not the connection.

**⭐ Editions are a POST-PUBLISH 3-phase process** (Plan→Build→Publish-editions; SEPARATE review; appear only after approval) layered onto an already-published PvA app → **the two editions can't be set in the initial publish. Resubmit = BYOK Pro SINGLE-edition (Standard); Managed Pro (Advanced) = editions Phase 2 after approval (+ DPA/29-day compliance THEN).** Simplifies the resubmit (no Managed compliance needed yet); supersedes "full hybrid in the resubmit." Code is editions-ready (`resolveTier` safely defaults undefined `capabilitySet` → BYOK Pro, verified).

**Portal pricing SET (BYOK Pro / Standard):** "100% of Confluence price" → **$6.70/user**, **≤10 flat $57**, the 100% **declining curve KEPT** (do NOT flatten — PvA bills the WHOLE Confluence instance, so a flat per-user prices out 100+ instances; the decline only starts >100 users, the ≤100 target pays $6.70 either way), **1.5x multi-instance** multiplier. USD (Atlassian USD-only). Supersedes €4.90/€49. Managed Pro price TBD at the editions phase.

**3 bugs fixed + committed (partner pushes), acceptance-tested green on dev:** i18n English-only user-facing strings + push-error de-dup (`dbb601f`); task-type dropdown clipped by card `overflow:hidden` → React portal (`382225a`); task/subtask descriptions generated + pushed end-to-end (`6d64ec6` — schema + prompt + push ADF, task-type prefix preserved).

**STATUS (2026-06-04 EOD): RESUBMITTED v5.3.0 (Build 2000070 — includes the 3 bug fixes) → awaiting Atlassian review.** `forge deploy -e production` AUTO-creates the Marketplace version (no manual portal "Create version" needed — unlike the 4.2.0→5.x step), and Resubmit catches the latest. The **Editions tab is now unlocked** but states *"Your app must be Paid via Atlassian AND live on Marketplace before you can create app editions"* → empirically CONFIRMS **Managed Pro = post-publish (editions Phase 2).** Release behavior = "Let me control when app is published" (partner controls go-live). **NEXT (post-approval): publish → editions Phase 2 (Managed Pro + DPA/29-day compliance), wire `PRO_UPGRADE_URL`.** Site pending: `spec2jira.com/docs` pricing ($6.70/100%, drop the dead Free-3/mo tier) + `/privacy` (BYOK fine now; Managed disclosures at Phase 2) — both URLs 200-verified. New improvement logged: concurrent-generation → notification/review-queue (`memory/product-improvements.md`). Full detail: `memory/marketplace-launch-state.md` + `memory/monetization-strategy.md`.

С усмивка ✨ — блокерът падна (Marketplace portal config, не наш код); resubmit-ът е по-прост (BYOK-first single-edition); цените са сложени; продуктът е по-чист (3 бъга + English-only).

---

## ⚡ HANDOVER NOTE (2026-06-04 — dev acceptance COMPLETE + prod deployed; BLOCKED on a Paid-via-Atlassian cross-product constraint → open Atlassian ticket)

A long, agent-conducted session continuing the XCA/hybrid resubmit on `feature/product-improvements`.
**Dev acceptance testing is COMPLETE and GREEN; the app/code is done + verified. The ONLY blocker is a
Marketplace listing-config contradiction (NOT an app problem) — now an open Atlassian question.**

**Dev acceptance — COMPLETE (`docs/DEV-VERIFICATION-PLAN.md`):** Managed Pro + BYOK Pro both verified
end-to-end on spec2jira-dev via `forge install --license Advanced|Standard` (dev edition sim). ⭐§6
accountId real (`usage:YYYY-MM:u:<id>`); §8 Managed key path (our `MANAGED_ANTHROPIC_KEY`); §7.5
cap→fair-use + LimitReached; BYOK unlimited (`usage:YYYY-MM`, no `:u:`); distill; push; reconnect.
(`--license` is DEV-ONLY — rejected on prod.)

**Polish SHIPPED (committed; partner pushes — `d36a5b7` `01b43c4` `d59a632` `449204a`):** (1) tier-aware
onboarding + **in-app Settings** (the Forge globalSettings "Configure" is UNREACHABLE in Atlassian's
centralized "Connected apps" admin → a Settings entry-point in the globalPage opens AdminSettings);
(2) editor edits now reflect in the Review AI-self-check (`extractV3Signals` read the frozen
`_v3_original`; now reads the edited `capabilities` — the push was always correct, cosmetic only);
(3) per-feature AI concerns rendered in the editor (counted-but-not-shown gap closed); (4) honest
generation spinner (the determinate bar sat at 0% for the opaque Anthropic batch → big spinner + live
timer + strengthened "you can leave/reconnect" copy, backed by the no-TTL KVS job record); (5) PagePicker
feedback/review nudge. All §13-reviewed → SHIP.

**⭐ THE BLOCKER (open Atlassian ticket): a cross-product app can't be a single "Paid via Atlassian"
listing.** Publishing fails: *"Invalid value for field 'supportedPaymentModel': More than one parent
software is not supported for paid via Atlassian apps."* EMPIRICALLY (the authority): the **`write:jira-work`
SCOPE** forces Jira to be a REQUIRED parent (the publish screen shows Jira Cloud [REQUIRED]) — and BOTH
manifest forms fail identically: `jira.required:false` (v5.0.0) AND removing the jira block (v5.1.0). The
multi-app-compatibility DOCS say Confluence-required + Jira-optional = a single paid listing (Confluence
sole billing parent, Jira free "Works with"), but the live publish CONTRADICTS the docs. **That
docs-vs-reality gap is the ticket question** (partner drafting): *"docs say Confluence-required +
Jira-optional = single paid listing, but our app with `write:jira-work` fails 'More than one parent
software' — why + the correct cross-product PvA config?"* Likely outcomes: a missing config · two separate
listings · Paid-via-vendor.

**Hard-won corrections (fold into the gotchas):** ① PvA = exactly ONE parent; the Jira write scope makes
Jira a parent → cross-product blocked on single-listing PvA. ② A LICENSED (PvA) app CANNOT be
`forge install`-ed on PRODUCTION (`LICENSED_APP_INSTALL_NOT_PERMITTED`) — prod = Marketplace-only; the
runbook "forge install on prod" step is WRONG for a licensed app. ③ In-place upgrade non-XCA→XCA+licensing
FAILS (Atlassian 500) — needs a FRESH install; real customers install fresh post-approval. ④ The Jira push
DOES need the Jira install (asUser().requestJira; Confluence-only 403s) — gotcha #10 HOLDS; Jira = an
optional installed CONNECTION. ⑤ Editions FINALIZED **€4.90/€9.90**; Free + unlicensedAccess + push-gate
REMOVED (trial→paid); "uninstall Jira FIRST before the XCA deploy" is correct.

**Prod state:** v5.1.0 deployed (jira-removed — ineffective for PvA); alexacenov uninstalled; vs-overlord22
(reviewer's) outdated; env vars set (`MANAGED_ANTHROPIC_KEY` + `ENFORCEMENT_MODE=block`). manifest.yml
REVERTED to the documented `jira.required:false` form (committed this session).

**RESUME:** (a) [optional] one clean re-test of `jira.required:false` (re-deploy + re-publish) to be 100%
sure; (b) the ATLASSIAN ECOHELP ticket — the authority on the cross-product PvA contradiction; (c) once
PvA is resolved → configure 2 editions €4.90/€9.90 → resubmit → Managed compliance docs (DPA + 29-day
retention) for the review. POST-APPROVAL: wire `PRO_UPGRADE_URL` + `MARKETPLACE_REVIEW_URL`. Full state:
`memory/marketplace-launch-state.md`.

С усмивка ✨ — app-ът е готов и доказан; блокерът е чисто Marketplace-policy (тяхно противоречие), не наш
код. Топката е в полето на Atlassian.

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
