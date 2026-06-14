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

## ⚡ HANDOVER NOTE (2026-06-14 — ⭐ LAYER-1 DIAGNOSTICS ARC CLOSED: Task #3 + #4#1 + #4#2 + #13 all §13-gated + committed; #13 TRIPLE-verified (gate → deep audit → 9/9/9 vote); build-green; DEV-only; SESSION CLOSED — next chapter = Monitoring + CI/CD strategy)

The session that **closed the whole Layer-1 diagnostics backlog** the ledger was always pointing at (the
root-cause layer beneath the client-side ledger of `ae0cdf3`). Four tasks, each full Analyze→Design→Solve +
§13-gated, the two big ones deep-audited; the last one (#13) verified through **three escalating rounds**.
**4 commits on `feature/product-improvements` (the partner PUSHES + deploys):** `a30da12` (#3) · `5507f21`
(#4#1) · `80af1ed` (#4#2) · `c85ed5f` (#13). Still **DEV-only** (no `forge deploy -e production` until the
v5.3.0 Marketplace verdict — a prod deploy auto-creates a Marketplace version + would entangle the in-flight review).

**⭐ THE ARC — frozen stable-identity (`_orig_name`/`_uid`, POLICY §3.5) threaded through every layer a rename touches:**
- **Task #3 — uid-bind dependency links (`a30da12`).** The live-S1 banner used to say *"source 'X' not created"*
  when X was merely RENAMED (the story WAS created, under its new title) — a **misleading failure that reads
  especially bad after we hand the BA a BreakdownEditor.** Fix (approach C): freeze `_orig_name`+`_uid` at adapt
  time; push resolves links **uid-first, name-fallback** (`buildResolvableLinks`); `dependencies[]` is UNTOUCHED →
  blast radius = push + diagnostics only. Deletes the rename-"not created" class; a renamed-AND-failed story now
  honestly reads `story_failed`. ⭐ A partner-requested **5-lens DEEP audit AFTER the §13 gate SHIP'd** caught +
  removed a **structurally-unreachable `endpoint_deleted` bucket** (write-time optimism; my own offline test had
  masked it with an impossible input) — [[deep-audit-vs-per-change-gate]] again.
- **Task #4 #1 — Review shows CURRENT dependency names after a rename (`5507f21`).** The partner **RE-CLASSIFIED
  this from cosmetic → a REAL trust bug** ("the user's eyes in Review are exactly what Live-acceptance recreates;
  a stale name breeds confusion → bad impression → it is our BUG"). Fix is **display-only**: `extractV3Signals`/
  `DependencyStructure` resolve the SHOWN name via a `displayOf` map (`labelOf`), while the **mutation key stays the
  frozen `target`** — the trap avoided was *re-keying the mutation → a silent no-op remove/restore*.
- **Task #4 #2 — test-gen dependency context survives a rename (`80af1ed`).** Extracted an exported-pure
  `buildDependencyResolver(peerStories)` keyed by the frozen `_orig_name` (both directions); **parity proven by a
  17,328-resolution fuzz vs the old code = 0 mismatches**; `prompts.js` untouched; legacy data → name-fallback.
- **Task #13 — never-pushed-orphan cleanup (`c85ed5f`) — THIS session's build.** See below.

**⭐⭐ TASK #13 in full (the Analyze→Design→Brainstorm item from the 06-13 note):** a generated-but-never-PUSHED
breakdown orphaned `pagesnap:` (~180KB) + `job:` (~240KB) in the customer's own KVS indefinitely. **Impact, measured
first (5-lens vote): NOT a cost or stability problem** — Forge KVS bills **I/O only, no at-rest billing today** (reads
$0.055/GB, writes $1.090/GB, 0.1GB/mo free each per-app, billed to the VENDOR), **no documented total-storage/entity
cap** (only 240KiB/key), and orphans add **zero** I/O (never re-read). ⚠ But Atlassian announced KVS at-rest "Data
Stored" pricing **"coming later in 2026"** → a future, modest, compounding cost — and the REAL driver was **privacy /
DPA posture** (the orphan holds the customer's spec content forever; the DPA §7.1 had a live `[PARTNER: verify]`
backstop placeholder). The partner chose the **stronger posture**: implement the cleanup + make the DPA/site/UI claim
honest. **Design = access-renewed scheduled sweep, NEVER a native TTL** (a KVS TTL renews only on `set`, so a read-only
review/reconnect/push would silently lose the deliverable — §11):
- `src/sweep_util.js` (NEW, pure, fail-safe): `isOrphanStale(meta, now, inactivityMs)` — prefers `lastAccessedAt`,
  falls back to `startedAt`, **KEEPS on any missing/garbage timestamp** (never delete on absent data). In its own
  module because **index.js is NOT node-importable** (`@forge/resolver`'s `new Resolver()` throws under plain node).
- `src/index.js`: `setJob` stamps `jobmeta.lastAccessedAt`; **`touchJobAccess(jobId)`** (1h-throttled, never throws)
  renews it on **every meaningful access** (review/reconnect + the test-case sub-journey + push); `deleteJobKeys`
  EXTRACTED from purgeJob (DRY, shared); **`sweepHandler`** (daily, `kvs.query` jobmeta-prefix, bounded
  `SWEEP_MAX_DELETES=50`/run, **strict `kvs.get` re-read before the irreversible delete**, fail-open, asApp).
  `ORPHAN_INACTIVITY_MS = 7 calendar days` (partner picked 7-cal over business-day math for simplicity).
- `manifest.yml`: `scheduledTrigger` (key `orphan-sweep`, interval `day`) + the `orphan-sweep-fn → index.sweepHandler`
  function. **PagePicker.jsx**: an honest 7-day-inactivity cleanup notice (only when tracked breakdowns exist).
- **Honesty surface (claim==code, §7.1):** the SITE (`privacy`/`dpa`/`subprocessors`) + the forge
  `docs/compliance/{DPA-managed-tier,atlassian-questionnaire-managed,subprocessors}.md` all updated to "removed after
  7 days of inactivity"; the **inaccurate "removed when you regenerate" over-claim was REMOVED everywhere** (regenerate
  ORPHANS the prior job — the sweep removes it later; it is NOT an immediate purge).

**⭐ TASK #13 VERIFIED THROUGH THREE ESCALATING ROUNDS (the partner's "rigorous mode, колкото пъти е нужно") — each
caught what the prior could not, the right bar for an irreversible-delete + privacy feature:**
1. **§13 gate (4 lenses):** honesty lens was CHANGES_REQUIRED → I'd MISSED `subprocessors.html` + a dpa erasure line
   still over-claiming → fixed.
2. **5-lens DEEP audit + skeptic-verify (AFTER the gate passed) → 4 MORE real cross-layer defects, all fixed:**
   **(A)** `deleteJobKeys` deleted `jobmeta` (the sweep's SOLE enumeration key) BEFORE `pagesnap` → a transient
   pagesnap-delete failure orphaned the 180KB snapshot **un-refindably forever** → fix: jobmeta deleted **LAST + only
   if `!degraded`** = self-healing (next sweep retries). **(B)** `touchJobAccess` was only on getResults/
   getGenerationStatus → a BA editing TEST CASES (the project's core deliverable) for >7d never renewed the breakdown
   timer → swept, destroying hand-edited cases ($1-3.67) + the §7 pagesnap → fix: added to all 6 TC resolvers +
   unconditional in startTestCaseGeneration + startPush. **(C)** the sweep decided staleness from the
   **eventually-consistent `kvs.query` index** → a renew-then-immediate-sweep race could delete a just-reopened
   deliverable → fix: a strictly-consistent `kvs.get` re-read + re-check before deleting. **(D)** the SITE was updated
   but 2 FORGE-repo compliance docs still carried the old claim → updated (the mirror-copies-not-in-the-diff blind spot).
3. **Final assurance: 4 diverse personas + a 3-judge confidence vote → unanimous 9/9/9, ZERO blocking, SHIP.** Only LOW
   accuracy nits, all applied (de-enumerated the renewal-site comments; documented the degraded-purge phantom-row
   self-heal window).

**⚠⚠ ROLLOUT FLAGS for the partner (HIGH — do NOT skip):**
1. **`forge install --upgrade`** — NOT just `forge deploy`. The manifest changed (new `scheduledTrigger`); a code-only
   deploy does NOT register the trigger → **the sweep never runs and the new 7-day DPA/site/UI claim is NOT actually
   true.** Verify it registers/fires via `forge logs` (`[sweep] orphan sweep: scanned=…`) before relying on the claim.
2. **Push the SEPARATE site repo** (`…\MVP-roll-out\spec2jira-site\spec2jira-site` — privacy/dpa/subprocessors; auto-
   deploys via GitHub Pages). The forge `docs/compliance/*` mirrors are committed in `c85ed5f`.
3. Partner Live-E2E: the UI notice is observable immediately; the 7-day sweep itself is not quickly observable → covered
   by `prototype/test_orphan_sweep.js` (14 checks) + the 9/9/9 vote.

**⭐ HARD-WON (fold into the Forge gotchas / lessons):**
- **index.js is NOT node-importable** (`new Resolver()` throws under plain node) → put unit-testable pure logic in a
  sibling module (`sweep_util.js`, like `graph.js`). This is now the pattern for any testable backend core.
- **Forge KVS bills I/O, not at-rest (TODAY); at-rest "Data Stored" pricing is "coming later 2026."** A native KVS TTL
  is **sliding-on-WRITE, fixed-on-read** → it belongs on TRANSIENT/reconstructible data, **NEVER on the user's
  deliverable** (review/reconnect/push are READS and don't renew it). Access-renewed + scheduled sweep is the correct shape.
- **A multi-key delete must order its keys so a partial failure self-heals** — delete the enumeration/index key LAST and
  only on full success, so the next sweep retries rather than orphaning data un-refindably.
- A **scheduledTrigger** runs system-context (no user) → KVS-only (asApp, `storage:app`); interval = `hour|day|week`;
  manifest change → `forge install --upgrade`.
- **The 3-escalating-rounds lesson, reinforced HARD ([[deep-audit-vs-per-change-gate]]):** per-change §13 gate → deep
  multi-lens audit → persona panel + confidence vote. The deep audit found 4 real defects the gate passed; the vote
  confirmed the fixes. **Audit the FIXES, not just the feature.** For irreversible/privacy/cross-key-invariant surfaces
  this escalation is not ceremony — each layer is structurally blind to the next layer's defect class (write-time
  optimism / ref-correlation breaks BETWEEN layers / eventual-consistency races / honesty-drift in un-diffed mirrors).

**⭐ NEXT SESSION — NEW CHAPTER (partner-set): Monitoring + CI/CD STRATEGY for the MVP (`feature/product-improvements`).**
**This is Analyze → Design ONLY — build a STRATEGY + trade-offs, do NOT jump to conclusions or implementation.** Full
brief: [[mvp-monitoring-cicd]]. Survey how **enterprise** teams approach monitoring + CI/CD for a Forge app of this
shape, what market options/patterns exist, and recommend a strategy scaled to a **solo vendor** (§3.5 — lightweight):
- **CI/CD:** Forge CLI in GitHub Actions (env promotion dev→prod), automated gates = `npm run build` + `node --check
  src/*.js` + the offline test suites (`prototype/test_*.js`), `forge lint`, the tunnel for local E2E.
- **Observability within the no-egress constraint:** the **diagnostics ledger is the in-product half** (customer-side,
  no egress); the GAP is **vendor-side deploy/health confidence** — `forge logs`/metrics, deploy verification, the
  scheduledTrigger health (e.g. did the orphan sweep fire?), env-promotion safety. Recommend how to close it without a
  backend.
- Deliverable: a recommendation set + trade-offs, NOT code, until the partner picks a direction.

**BACKLOG (partner's explicit call this session — NOT urgent, quality is good):** the broader **test-case validation on
the ~9 real Confluence pages** (the pre-ship confidence sweep) is **parked in the backlog**, not done this cycle. Other
parked items unchanged: the deferred test-gen quality levers ([[product-improvements]] — uid-keyed push-embed,
directional-flag N+1, destructive negative-control, priority/ceiling/near-dup lints); UI/UX refresher + dead-code
cleanup (orphan `getLastSelectedPage`/`LAST_SELECTED_KEY`). **⛔ BLOCKED until the Marketplace Approval signal:** Managed
PRO edition (compute-budget cap) + custom prompts / house-style.

С усмивка ✨ — Layer-1 диагностичната арка е затворена изцяло: четирите задачи са §13-gate-нати и committed, замразената стабилна идентичност (`_orig_name`/`_uid`) минава през всеки слой, който rename докосва (push → Review-дисплей → test-gen контекст), а #13 е тройно-верифициран (gate → deep audit с 4 fix-а → 9/9/9 единодушен vote). Подвеждащото "source X not created" при преименуване вече го няма — точно впечатлението, което не искаме BA-ят да получи след като му дадохме BreakdownEditor. Прозрачният orphan-cleanup прави DPA/site/UI claim-а честен (claim==code). Следваща глава: стратегия за Monitoring + CI/CD — чист Analyze→Design, без скачане към действия. Test-case validation-ът на 9-те реални страници остава в backlog (качеството е добро, не е спешно).

---

## ⚡ HANDOVER NOTE (2026-06-13 cont. — Live-E2E ACCEPTANCE round (S1/S2/S3/S7/#6/distill/health/admin all GREEN) + 2 bug-fixes + polish + a binding POLICY rule; build-green; DEV-only; SESSION CLOSED)

Continuation of the diagnostics-ledger arc below. The partner ran a **dev Live-E2E acceptance sweep**; I fixed what it surfaced, added one binding POLICY rule, and CLOSED the session. **5 commits ahead of origin — the partner PUSHES.** Still DEV-only (no `forge deploy -e production` until the v5.3.0 verdict).

**⭐ LIVE-E2E ACCEPTANCE (partner, dev, 2026-06-13) — everything tested PASSED:**
- **S1 partial_push** ✓ · **S2 all-stories field rejection** ✓ (the `[object Object]` + lost-field-names bug it surfaced was fixed `9c1c82f`; retest confirmed; a field_names=1-vs-reasons=2 delta I traced = CORRECT — Jira returned the error via BOTH errorMessages (human, no addField) and the errors-map (ID, addField)) · **S3 project-not-found** ✓ · **S9 armed-clear** ✓ (→ copy "sure?" → **"⚠ Click again to confirm"**, partner-requested) · **#6 push-while-TC-generating** ✓ (the HIGH fix held — successful push screen NOT yanked; Diagnostics showed `tc_run_discarded`/`tracking_degraded` as designed) · **health check 4/4** ✓ (the one missing row on first open = KVS eventual-consistency, self-healed on reopen — diagnosed, NOT a bug) · **admin "All users"** ✓.
- **S7 deleted-page** ✓ after fix · **Distill per-step** ✓ after fix (the new record appears in the ledger).

**⭐ BUG-FIXES this session (committed `8bd7677`):**
- **S7 trashed/archived page** — Confluence SOFT-deletes to trash → the v2 GET returns the page with **HTTP 200 + `status:'TRASHED'/'ARCHIVED'` (UPPER_CASE despite the lowercase docs)**, NOT 404 → a deleted page opened + generated a breakdown from STALE content. Fix = a `status!=='current'` guard on BOTH `fetchPage` (open) and `startGeneration` (before the BILLED submit + pagesnap write — covers the trash-between-open-and-generate window). ⚠ **Both reads are LIVE — this was a missing STATUS CHECK, not a KVS-cache bug** (I refuted the partner's caching hypothesis with code evidence; rigorous-mentor honesty). S7 itself is NOT recorded in Diagnostics — by design (user picked a deleted page = expected state, self-explanatory, zero support burden, no silent loss; recording it would be noise — partner agreed).
- **Distill per-step (Q2, Managed-Pro durability)** — a per-category Anthropic failure (esp. `auth_rejected` on OUR Managed key) was a TRANSIENT FE-only message → nothing in the ledger. Now records a durable diagnostic (`op:'distill.step'`, class via `classifyDiagGenerationError`, ref=sessionId) + zone-2 verbatim, on BOTH the catch path and the `result.error` path. (Partner's call — valuable specifically for the future Managed Pro edition.)
- **page_not_available FE branch** in `_classifyBackendError` — drops the raw token, shows the clean detail (was falling through to the Class-7 generic pass-through).

**Polish (committed `8bd7677`):** success-screen ℹ note when a TC run was discarded by a push (so the user needn't open Diagnostics to learn it); the Confirm copy above.

**⭐ NEW BINDING POLICY §13 — "Conductor-holds-context rule" (committed `2685c0c`):** delegate work that genuinely benefits from an agent (independent lenses, adversarial fan-out, parallel coverage); do NOT delegate synthesis where the conductor holds context an agent would LACK — **handover notes, commit messages, integrating gathered reports, decisions needing the whole history**. Spawning agents for those degrades the result (agent starts blind) + wastes tokens = **performative orchestration, a defect not diligence**. Test: *would an agent have MORE or LESS context than me for THIS piece?* **Holds EVEN under Ultracode** (Ultracode pushes orchestration for the SUBSTANTIVE work, never for faking it on synthesis). This closure ritual was done solo for exactly that reason.

**The DIAG_FAULT harness (#4 TC-truncation A5):** organic max_tokens truncation proved UNRELIABLE (Sonnet self-limits to ~20 cases « 24K → the truncated chip rarely fires; I corrected my own earlier "use huge ACs" test-advice — huge ACs hit the 20-case COVERAGE cap, a DIFFERENT mechanism). Built a tiny env-gated `DIAG_FAULT` harness to force it deterministically, the partner verified the chip→regen flow, then **removed it cleanly per the partner's "после задължително трябва да го махнем"** — verified zero git trace (`git diff src/anthropic_client.js` empty).

**SLA-retention note (committed `8bd7677`, design doc §0):** the failure→support-receives-diagnostic window is **≥14h (≈12h contractual + relay) → can stretch to DAYS** (admin away). The design HOLDS: error records have **NO TTL** + dedupe collapses a repeated failure into ONE record (occurrences++) → a user hammering the same failure for days never churns the 50-cap; zone-2's 30d TTL covers an admin-on-vacation delay. Validates the no-TTL-on-records decision — the SLA window is exactly why the deliverable-trace must not expire.

**Never-pushed KVS orphan (task #13) — reclassified to Analyze→Design→Brainstorm (partner):** a never-PUSHED job orphans `pagesnap:` (~180KB) + `job:` (~240KB) until the explicit purgeJob. Real but bounded (per-job, customer's own instance, Anthropic-side ≤29d). Fix MUST be **access-renewed** (re-set on getResults/getGenerationStatus) **or scheduled sweep** — NEVER creation-anchored native TTL (review/push are READS, sliding-on-write TTL → silent deliverable loss). NOT a quick fix; a proper Layer-1 design item.

**Commits this session (partner pushes — 5 ahead of origin):** `ae0cdf3` (ledger) · `9c1c82f` (Jira error-shape parse) · `48e4565` (branding) [these 3 from earlier] + `8bd7677` (Live-E2E fixes + polish) + `2685c0c` (POLICY §13 rule). Plus this CLAUDE.md handover commit.

**⭐ NEXT SESSION — partner-set agenda (re-Analyze each through the LENS §0):**
1. **Remaining FUTURE-IMPROVEMENT work** (partner: "remaining work останала от досегашните future-improvements"):
   - **Diagnostic Support — Layer 1** (the real root-cause layer the ledger was always pointing at): **Task #3 `name→uid` linking** (THE lead — deletes the misleading "source X not created" class; bad impression after we gave the BA a BreakdownEditor) → then **Task #4** silent-loss behavioral halves / A6 push idempotency / A3 recovery → **Task #13** orphan-cleanup (the A→D→Brainstorm item above).
   - **Test-case generation — remaining**: broader validation on the partner's ~9 real Confluence pages (pre-ship confidence sweep), the deferred quality levers ([[product-improvements]] — uid-keyed push-embed, directional-flag N+1, destructive negative-control, priority/ceiling/near-dup lints), optional design-doc note, then fold toward release.
2. **⛔ BLOCKED until the Marketplace Approval signal (set aside — partner directive):** **Managed PRO edition** (compute-budget cap) + **custom prompts / house-style**. Both naturally gate on approval → do not start them this cycle.
3. **⭐ NEW STRATEGIC TOPIC — Monitoring + CI/CD for the MVP (partner-requested; Analyze → Design, build a STRATEGY, do NOT jump to conclusions/actions):** survey how **enterprise** teams approach monitoring + CI/CD for a Forge app of this shape, what market options/patterns exist (Forge-native: `forge logs`/metrics/`forge lint`/tunnel/CI via the Forge CLI in GitHub Actions, env promotion dev→prod, automated `npm run build` + `node --check` + the offline test suites as gates; observability within the no-backend constraint — the diagnostics ledger is the in-product half, but vendor-side health/deploy confidence is the gap), and a recommended strategy. Pure A→D — a recommendation set + trade-offs, NOT implementation, until the partner picks a direction.

С усмивка ✨ — acceptance round-ът мина зелен; двата реални бъга (trashed-page status check + distill durability) са затворени и Live-потвърдени; DIAG_FAULT harness-ът свърши работа и е премахнат чисто; и хванахме едно важно правило в POLICY-то — диригентът не делегира синтеза, който само той държи в контекст. Следваща сесия: Layer-1 diagnostics + test-case validation + стратегия за Monitoring/CI-CD (Managed PRO + custom prompts чакат approval).

---

## ⚡ HANDOVER NOTE (2026-06-13 — CLIENT-SIDE DIAGNOSTIC LEDGER shipped end-to-end + 6 deep-audit passes + cross-phase seams audit; build-green, 193/193 offline tests, S1 + health + admin-view LIVE-verified; DEV-only)

The longest conductor-orchestrated (§13) arc yet on `feature/product-improvements`: the partner's "we're helpless as support — failures leave no trace we can investigate" pain → a full **client-side diagnostic ledger** (NO egress, NO end-user content, lives in the customer's own Forge KVS). Built in 6 phases, then **audited phase-by-phase with two independent fresh-eyes agents each (adversarial bug-hunter + contract/coverage auditor) + a final cross-phase seams pass** — ~65 real fixes on top of code that had ALREADY passed 12 per-change §13 gates. **Committed this session (Claude); the partner PUSHES.** DEV-only — do NOT `forge deploy -e production` until the v5.3.0 Marketplace verdict (auto-creates a Marketplace version, would entangle the in-flight review).

**⭐ WHAT SHIPPED — the support model in its HONEST form (no-backend constraint turned into the design):**
- **`src/diagnostics.js` (NEW) — the single owner**: closed `DIAG_OPS`/`DIAG_CLASSES` registries; `validateRecord` = the PRIVACY WALL (whitelist-CONSTRUCTS the record — no free-text field survives under ANY name; enums→sentinels; ids shape-checked; counts code-shaped); `mergeIntoRing` (dedupe-in-place by `(ref,op,error_class)` → `occurrences`, info-first eviction, cap 50); `classifyDiagGenerationError` (1:1 mapper of OUR OWN error codes — Bug-Y-clean); IO shell (lazy `@forge/kvs`, fail-open, never throws — verified incl. `null` arg). Per-USER ring `spec2jira_diag:u:<accountId>` + install-wide `:agg` sidecar (class-keyed triage) + **zone-2** `spec2jira_diagdetail:<ref>` (verbatim detail, 4KB, ~30d TTL, consent-gated export only).
- **Record schema (content-free):** `{v,ts,ref,session_ref?,op,error_class,level,subject?,subject_idxs?,subject_keys?,jira?[{status,field_names}],counts?,occurrences?,surfaced}`. **Sanctioned:** Jira issue KEYS (embed project key, already declared). **Banned:** names/summaries/page-title/AC text/detail/message/reason/browseBase/accountId-in-body.
- **Wiring (all 5 pipelines):** generation (terminal failures + `generation_completed` breadcrumb w/ `cost_usd`+`features` + `truncation_salvaged` + silent-class warns: pagesnap/context-profile/consumeQuota/cycle-repair + `gate_fail_open` ×license/quota/distill) · push (ONE coalesced `partial_push` at `buildFinalResult` w/ cause-split counts `links_unresolved_{name_unknown,story_failed}`/`links_api_failed`/`subtasks_orphaned`, subject_idxs+keys, jira[], zone-2 detail; `push_completed` breadcrumb; A2 chunk-log miscount fixed) · test-gen (`partial_testgen`/`testgen_completed`/`truncation_salvaged`; **detection halves A4** key-fault-vs-never-set, **A5** TC stop_reason truncation, **A7** export skip+truncate markers; `regen_overwrote_good`; distill `distill_category_dropped`) · settings/key/Confluence/dashboard/purge.
- **Surfaces:** error/failure messages **verbatim-PRESERVED + enriched** with `Diagnostic ref + [Copy] + [Open Diagnostics]` (in-app click-nav → pre-filtered tab); **S4 dashboard ⚠ click → Ready failure card** (was a pristine-screen dead-end — live bug, fixed); AdminSettings **Diagnostics tab** (humanized rows via `lib/diagnosticsView.js`, aggregate counters, **enterprise admin "All users" view** behind a live Jira ADMINISTER check, **health check** = 4 probes, **armed Clear** = GDPR self-service); §2b consent checkbox for verbatim detail in the export.

**⭐⭐ THE AUDIT CAMPAIGN — the load-bearing lesson, reinforced HARD ([[deep-audit-vs-per-change-gate]]):** ~65 fixes on code that already passed 12 §13 gates. The recurring defect CLASSES (fold into review instinct): (1) **write-time optimism** — a counter measuring INTENT not OUTCOME (`tc_embedded++` at payload-build survived a failed create → the "honest" record lied); (2) **ref-correlation breaks BETWEEN layers** — the aborted-push class recorded under `session_ref` but the error screen showed `jobId` → unfindable by the ref the user is shown; (3) **"accepted" residuals with UNVERIFIED economics** — the TC-clobber "re-run is cheap" rationale was FALSE (a clobbered `completed` made per-story results status-gated-unreachable → the natural retry RE-BILLED the full $1-3.67 TC batch); (4) **the cross-phase HIGH** — push-while-TC-generating → purge deletes the batched tcjob → the still-live TC poll yanked the user OFF their SUCCESSFUL push screen onto a red error (needs push+test-gen+purge+poll-lifecycle in ONE journey — invisible to every per-phase lens; fixed: background-gate the TC poll branches + Create-button warning + `tc_run_discarded` purge record). Also twice: a grep `\ ──` artifact read as broken code → **Read confirmed both were fine** (verify suspicious greps with Read).

**⭐ HARD-WON (fold into the Forge gotchas):**
- **A fail-open ledger only sees CAUGHT failures.** The prereq wraps (Phase 0) had to be PER-CALL-SITE with opposite contracts (initial write = fail-fast BEFORE the billed submit; post-billed writes = record+proceed, NEVER abort; the 'ended' persist = terminalize with a SMALL `{...job,status:'failed'}` record (spread `job` NEVER `completed`) + hand the breakdown forward inline `persistFailed:true`). A blanket `setJob` swallow would orphan a BILLED batch.
- **KVS size is BYTES not UTF-16 length** — `new TextEncoder().encode(JSON.stringify(x)).length`, not `.length` (~2× undercount on Cyrillic — our market).
- **Concurrent-poll 'ended' clobber:** before any failed-bookkeeping write, re-read and yield to ANY terminal peer (`completed` OR `failed`) — a transient fetch error must not overwrite a peer's just-persisted result. Same guard on the TC/regen polls + the unknown-status flag write.
- **The dedupe key omits `subject`** → same `(ref,op,class)` across different stories merges (occurrences counts all, subject shows newest). Partition by flow-leg op (added `testgen.poll`) where a tuple became a junk-drawer.
- **Webpack folds `import('@forge/kvs')` into the single chunk** because index.js statically imports it — dynamic import is alive in the bundle (empirically proven). Keep the static import.
- **The privacy wall MASKS a typo'd op/class into `unknown_*` at runtime** with no signal → the offline test suite now has a **call-site literal scanner** + an **FE-map↔registry sync** tripwire (`prototype/test_diagnostics.js` §17). 193 checks total.

**⭐ LIVE ACCEPTANCE (partner, dev, 2026-06-13):** **S1 partial_push VERIFIED end-to-end** — renamed a depended-on story → 8 unresolved links → amber banner w/ ref + [Open Diagnostics] → pre-filtered tab → `partial_push` record (`links_unresolved_name_unknown:8`/`story_failed:0` — the ledger told the TRUTH while the banner prose says the misleading "source X not created") → consent export (unchecked = zero names, only UUID/Jira-keys/numbers; checked = names ONLY in the zone-2 detail section). **Health check** 4/4 + breadcrumb (the one missing row was KVS eventual-consistency → self-healed on reopen, exactly diagnosed — NOT a bug). **S6 admin "All users"** = per-user buckets + accountId grouping. Envelope carries `scope:"mine"/"all"`. **S2 (all-stories field rejection) VERIFIED + surfaced a REAL pre-existing bug Live E2E caught that 6 offline audit passes could not** (they used synthetic Jira error shapes): the WHOLE-BULK 400 body returns `errors` INDEXED by element (`{"0":{detail-obj}}`), so the old `jiraErrorMessage` did `String(detail-obj)` → **"[object Object]"** in both the user message AND zone-2, and captured **zero `field_names`** (only `{status:400}`). Fixed in `src/push_handler.js`: a shape-agnostic `parseJiraErrorDetail()` (flat / indexed-whole-bulk / nested-elementErrors / documented top-level array — all 4 shapes; values→reasons=zone-2/consent, field-IDs→`field_names`=content-free ledger, numeric element-indices NEVER become field names); `bulkCreateIssues` attaches `field_names` on BOTH paths; `diagAddJiraErrors` prefers it. + the banner `Reason:` truncation → word-boundary + ellipsis (was a hard `substring(0,200)` → "…Required custom fie"). New offline regression `prototype/test_jira_error_parse.js` (pins all 4 shapes + the no-value-leak + numeric-key-exclusion + depth-bound). §13-reviewed (privacy-wall PASS, no value leak; the review itself caught the array-shape MED → fixed). Committed as a follow-up `fix` after `ae0cdf3`. **LESSON: Live E2E finds what audits structurally cannot — the REAL upstream API shape. The diagnostics WALL held perfectly (clean record, counts correct: `subtasks_orphaned:13`/`story_failed:5`); the garbage was upstream "garbage in", now fixed.**

**⭐ THE name→uid INSIGHT (partner-confirmed, leads the Layer-1 backlog):** the live S1 banner shows *"source 'Notification Delivery Pipeline' not created"* — MISLEADING (the story WAS created, under its renamed title SDTY-2521). The ledger recorded the truth (`name_unknown`), but the user-facing prose lies, and — the partner's sharp point — **after we gave them a BreakdownEditor, a rename reading as "not created" is a bad impression.** Layer-1 `name→uid` linking (Task #3) would delete this whole "failure" class: dependency edges resolve by stable id, not the renamed name. This is now the #1 Layer-1 argument.

**Files (committed; partner pushes):** NEW `src/diagnostics.js`, `static/.../lib/diagnosticsView.js`, `docs/DIAGNOSTICS-FAILURE-SURFACE.md` (the ~80-op failure map), `docs/DIAGNOSTICS-LEDGER-DESIGN.md` (v2.2 contract + 8 residual blocks), `prototype/test_diagnostics.js` (193 offline checks). MODIFIED `src/index.js`, `src/push_handler.js`, `src/anthropic_client.js`, `static/.../App.js`, `AdminSettings.jsx`, `StoryTestCaseCard.jsx`, `TestCasesScreen.jsx`, `POLICY.md` (§3.5 addendum: simplicity-over-over-engineering + SOLID, binding). ⚠ Untracked-by-rule left alone: `bakeoff_*.json`, `prototype/_*.{mjs,cjs}`, `prototype/analyze_quality.js`, `docs/TESTCASE-SWEEP-FINDINGS.md`.

**⭐ NEXT SESSION:**
1. **Finish Live E2E** (partner running in parallel): #4 TC-truncation A5 chain (chip→regen→save→export markers) · **#6 J6** (push WHILE test cases generate → the Create-button warning + the successful screen must NOT be yanked — the new HIGH fix; wait the full poll tick) · S1b Jira-field rejection · armed Clear · distill mid-flight.
2. **Layer-1 Task #3 — `name→uid` linking** (the highest-value follow-up; deletes the misleading-"not created" class + the bad BreakdownEditor impression). Then Task #4 (A6 push idempotency / A3 full breakdown recovery / the other silent-loss behavioral halves).
3. **Optional dev fault-harness** (~30 lines, `DIAG_FAULT` env-gated, inert in prod) to live-trigger the non-simulable classes (kvs_persist_failed S2, 25s-kill, terminal ⚠ S4) — partner's call; otherwise they stay offline-verified.
4. Open named residuals (all in `docs/DIAGNOSTICS-LEDGER-DESIGN.md` §7 blocks): zone-2 key-by-ref+op, detail-sibling owner-stamp, agg op-granularity, J2 cross-user half-story exports. None block deploy.

С усмивка ✨ — питането „безпомощни ли сме като support?" има вече одитиран до кост отговор: провал → видим ref → един клик до диагностиката → честен content-free пакет → admin вижда целия екип → health check затваря конфиг-казусите за минута. Privacy moat-ът недокоснат (нула egress, стена структурна на всеки hop). 6 прохода × 2 лещи + seams доказаха, че натрупаните "SHIP" крият ~65 неща — особено write-time оптимизъм, ref-correlation скъсвания между слоевете, и cross-phase journeys, които никой пер-фазов поглед не вижда.

---

## ⚡ HANDOVER NOTE (2026-06-10 — LIVE MULTI-BATCH DASHBOARD shipped + LIVE-verified: A+D queue → 2 deep-audit ARMIES → per-user dashboard → CueBanner removal → live-acceptance UX fixes; ALL §13-gated + GREEN)

A long, conductor-orchestrated (§13) session on `feature/product-improvements` that built the **live multi-batch dashboard** (the "Concurrent-generation notification / review queue" backlog item) end-to-end + **LIVE-verified by the partner**. Two partner-requested deep-audit ARMIES hardened it; the §13 conductor model + the armies repeatedly caught real bugs the per-change gate — and even my OWN fixes — missed. **The partner commits + pushes.** Everything below is build-green + live-verified or confidence-voted.

**⭐ WHAT SHIPPED — live multi-batch dashboard (per-USER), the vision "fire 3 → lunch → return → see done + running":**
- **Evolution, not rewrite:** began as (A) de-hijack (the breakdown poll navigates ONLY the foreground job, jobId-identity guarded) + (D) a per-install "ready for review" queue; the partner upgraded the ask to true live tracking → GENERALIZED the queue into a per-USER tracked-jobs list.
- **Backend (`src/index.js`):** `TRACKED_JOBS_PREFIX='spec2jira_tracked_jobs:u:'+accountId` (reuse usage.js keying); `recordTrackedJob` (prepend+dedupe-by-page+cap) written at **startGeneration** (EVERY fired job → kills the old fire-3-see-1 limit); `getDashboardJobs({context})` = a **PURE READ** (derefs each ref for LIVE status, drops `!job`; NO supersede-prune, NO self-heal write — see deep-audit); `pollJobStatus` is the reconcile primitive (unchanged + a re-read guard at 'ended'); `purgeJob` filters the per-user list + has a pageJob value-equality delete-guard.
- **Frontend:** the **picker IS the dashboard** (`PagePicker.jsx`) — a picker-scoped reconcile effect (mount + `DASH_POLL_MS=10s`, `running`-guarded, cleanup) loops `pollJobStatus` over in-flight rows then repaints; 3 `.filter()` status groups (⏳ In progress / ✓ Ready for review / ⚠ Needs attention) reusing PageRow; dashboard rows carry their OWN jobId → **click routes by jobId** (not shared pageJob). **CueBanner REMOVED** (`App.js`) — the durable dashboard superseded the transient readyCue/failureCue banner; the de-hijack GUARDS were KEPT.

**⭐⭐ TWO DEEP-AUDIT ARMIES (partner-requested, §13) caught what the per-change gate missed — [[deep-audit-vs-per-change-gate]] reinforced HARD:**
- **Round 1** (over A+D): a dedicated **concurrency lens** caught a stale-poll-callback MED the 2-agent gate PASSED (a screen-NAME-only guard hijacked the wrong job + `clearInterval`-orphaned the new poll) → Fix A (`currentPollJobIdRef` jobId-identity guards in BOTH polls); + Fix B (failure-cue masking, §11), Fix D (queue prune), purgeJob hardening.
- **Round 2** (over MB) caught **3 MED, 2 against my OWN round-1 fixes:** MED-2 cross-user own-job-drop (the per-USER list was pruned against the SHARED PAGE_JOB index → a co-worker regenerating the same page silently dropped your in-flight job) → fixed by making `getDashboardJobs` a PURE READ (removed supersede-prune + self-heal write; same-page supersede is handled by dedupe-at-write; also closed a 2-tab self-heal-clobber the round-1 "unreachable" claim got WRONG); MED-3 click-routes-by-shared-page-latest → route by the row's OWN jobId; MED-1 my round-1 re-read guard de-dups only SERIAL re-polls NOT the concurrent double-poll it named → honest comment downgrade (concurrent double-fetch open but idempotent; rare cycle-gated duplicate billed LLM, accepted — no 'finalizing' state machine).

**⭐ LIVE ACCEPTANCE (partner, dev site) — feature is live-proven:** T1 (fire-3 → "IN PROGRESS (3)") + de-hijack (a breakdown completing while on the picker STAYED) + T2-T9 ALL VICTORY. T7 (⚠ failed) + T10 (per-user) NOT live-triggerable → §13 confidence vote (2 judges, both 9/10): ⚠ correct but only reachable via a rare post-submit Anthropic batch failure (empty key=instant error/no job; invalid key=failed-but-UNTRACKED — both by-design); per-user isolation holds (accountId parity across 4 sites, shared-index leak removed). TWO live UX findings fixed + verified: **reconnect→picker** (reopening resumed a single generating spinner, hiding the dashboard → RETIRED Gate 5's active-resume; reopen ALWAYS lands on the picker/dashboard; explicit deep-links unchanged) + **"Start over" abandon** (it routed to Ready but never STOPPED the run → MB exposed it as a lingering ⏳; new `handleStartOver` reuses handleRegenerate THEN best-effort `purgeJob` → vanishes from the dashboard; the Anthropic batch orphans + expires ~24h; partner chose this over a cancel-API). Purge coherence adversarially verified 9.5/10: a purged job can NEVER resurface (recordTrackedJob is ONLY in startGeneration; nothing polls a purged/untracked job) + NO conflict with a new same-page job (MED-2 pageJob value-guard + dedupe-by-page + distinct keys).

**⭐ KVS-COST optimization (same session, after an Atlassian "50% of free monthly KVS READ" quota email; separate commit):** the dashboard reconcile loop's `getDashboardJobs` dereferenced the FULL `job:` record (~240KB breakdown) per tracked ref just for 5 scalars, on a 10s loop while the picker was open → KVS READ-throughput amplification. FIX (design confidence-voted 8.5–9/10 by 2 judges; impl §13 SHIP, build green): (a) a lean `jobmeta:<jobId>` sibling (~100B: status/pageTitle/startedAt) that `getDashboardJobs` reads instead of the heavy record — **KVS has NO field projection, so a sibling lean key is the ONLY way to read a subset** (batchGet/cache don't help — read is BYTE-metered); (b) a `setJob()` helper centralizes the `job:` write + TTL + jobmeta-mirror so no write site can forget either (jobmeta coverage is §11-critical — a miss = a silently-stale dashboard group; a missing TTL = an active job expiring on its creation-clock — judge-1's footgun); (c) **reconcile STOPS its interval when no job is in-flight** (the dominant leak — a picker left open re-reading every sweep with nothing changing; re-arms on remount since firing a job unmounts the picker) + cadence 10s→15s; (d) back-compat read-fallback to `job:` when jobmeta absent (READ-ONLY, no backfill — preserves the pure-read invariant). **STORAGE rider — ⚠ ADDED THEN REVERTED after a deep audit (same session):** the initial KVS commit added a 30-day `@forge/kvs` TTL to `job:`/`pagesnap:`/`jobmeta:`. A partner-requested 6-lens deep audit (3 HIGH across 3 INDEPENDENT lenses) found it **silently expired the user's BREAKDOWN deliverable** — review/reconnect/**PUSH are READS, and a native KVS TTL renews only on `set`**, so a completed-but-unpushed breakdown vanished at completion+30d (§11 silent-data-loss), and `pagesnap:` expired out from under §7-aware test-gen (loses the source spec silently). My single-agent §13 review MISSED this (it trusted my own "renews on touch" comment — but review/push aren't touches). **TTL FULLY REMOVED** → job:/jobmeta:/pagesnap: persist until the explicit `purgeJob` (on push), restoring pre-optimization durability. Plus a deep-audit MED fix: `pollJobStatus`'s terminal early-return now re-asserts the jobmeta mirror (a failed best-effort jobmeta write at a terminal transition otherwise stranded the dashboard row + defeated stop-idle → the read leak returning). **Storage bound for never-pushed orphans is now a proper FOLLOW-UP — must be ACCESS-renewed (re-set on getResults/getGenerationStatus) or scheduled, NEVER creation-anchored.** ⭐ LESSON (fold into gotchas): a TTL belongs on TRANSIENT/reconstructible data, NEVER on the user's deliverable; KVS TTL is sliding-on-WRITE, fixed-on-read, so READS (review/push/reconnect) don't renew it. (`tcjob:` was never TTL'd; moot now.) **Files: `src/index.js` + `PagePicker.jsx` (2nd commit, after the dashboard `df15335`).**

**Hard-won (fold into gotchas/lessons):** (1) **§3.5 simplicity repeatedly WON** — `getDashboardJobs` PURE READ closed MED-2 + 5×LOW by REMOVING code (supersede-prune + self-heal); generalizing queue→dashboard reused everything. (2) **route-by-jobId = the `story_uid` stable-identity lesson again** — a per-user surface must NOT route through a shared per-install index. (3) **deep-audit the FIXES, not just the feature** — round 2 caught that my round-1 concurrency fix didn't do what its comment claimed. (4) **live acceptance catches EMERGENT UX** (reconnect, start-over) that code review cannot. (5) the **2026-05-08 "return → picker, не resume" directive** is now fully honored — the dashboard makes the active-job carve-out unnecessary.

**Files changed (partner commits + pushes):** `src/index.js` · `static/hello-world/src/App.js` · `static/hello-world/src/components/PagePicker.jsx` + this CLAUDE.md. (Memory `product-improvements.md` holds the full blow-by-blow.) ⚠ The staged-from-prior-session artifacts (`bakeoff_*.json` in root, `prototype/*`, `docs/TESTCASE-SWEEP-FINDINGS.md`) are left UNTRACKED — `prototype/analyze_quality.js` is the "uncommitted by rule" ground-truth lint; the partner decides their fate separately.

**Known follow-ups (none blockers):** orphan `getLastSelectedPage` resolver + `LAST_SELECTED_KEY` write (dead-code cleanup — Gate 5 was the only reader) · `getResults` has no owner-check (pre-existing defense-in-depth; capability-bounded — jobId never leaked via the per-user dashboard) · no manual-dismiss for ⚠ failed rows (clears on regenerate/cap) · reconcile repaints once post-loop (not incremental) · eventual-consistency KVS re-read can show ⏳ one extra ~10s sweep (cosmetic).

**⭐ NEXT SESSION — open the next pending feature / remaining work** (re-Analyze each through the LENS §0; full detail [[product-improvements]]): **Managed PRO compute/token-BUDGET cap** (still blocked behind Marketplace approval + editions Phase 2 — VERIFY launch status FIRST) · **UI/UX refresher** (the open Forge scroll-to-top; the dead-code cleanup above; editor polish) · **batch-queue notifications** (now largely SUBSUMED by this dashboard — re-scope) · **custom prompts / house-style**. PARALLEL launch track unchanged (Marketplace v5.3.0 review).

С усмивка ✨ — multi-batch dashboard-ът е live-доказан end-to-end; двете deep-audit армии (по партньорска заявка) втвърдиха дизайна и хванаха каквото §13-gate-ът + дори моите собствени fixes пропуснаха; §3.5 simplicity спечели многократно (pure-read затвори MED+LOW чрез ПРЕМАХВАНЕ на код); и двата live UX-проблема (reconnect→picker, start-over→purge) са затворени и потвърдени.

---

## ⚡ HANDOVER NOTE (2026-06-08 — Test-case feature FINISHED + LIVE-confirmed: edited-state #1/#2/#3 → multi-run validation → finished-spec regression → targeted-refresh + `story_uid` + LIVE bug-fixes; ALL §13-gated + GREEN)

A very long, conductor-orchestrated (§13) session on `feature/product-improvements` that took the test-case
feature from "validated quality core" to **functionally COMPLETE + multi-run-validated + LIVE-confirmed by
the partner**. Everything below is build-green + §13-gated (often deep-audited) + the partner deployed +
LIVE-tested the user-facing pieces. **The partner does the final commit of the whole arc + any remaining
deploy.** New binding **POLICY §3.5 "Simplicity over complexity"** added this session (read it).

**⭐ PRIORITY #1-#3 SHIPPED (committed `e15d9c9` earlier in the arc; partner-deployed):**
- **#1 edited-state bug (the release-blocker)** — test-gen used to consume the PRISTINE `job.breakdown`, not
  the Human-EDITED one. FIXED: `startTestCaseGeneration` PERSISTS the edited breakdown (`payload.breakdown`
  → `flattenBreakdown` → `job.breakdown.features`); the Review/ConfirmScreen is the SINGLE entry to test-gen
  (editor "Continue to Review" lifts edits → `pendingBreakdown`), removing the 2 bypass paths. Edit-after-gen
  honesty: amber "Test cases may be outdated" + a content-aware idempotency bypass (re-generates on a real AC change).
- **#2 §8 info-completeness** — feed typed `concerns[]` (Rule 7: act-on-each OR carry-forward PRESERVING type)
  + scoped cross-feature deps + spec-level concerns (incl. `[COMPLIANCE]`) + LESSON E few-shot into
  `buildTestCaseUserPrompt`. 3-tier cap partition (AC-coverage absolute-priority). **The 0-`[RISK]`/1148-ASSUMPTION
  monotony the self-review flagged is BROKEN.**
- **#3 UI spinner** — dropped the misleading "0% complete" (async batch never advances) → indeterminate + timer.

**⭐⭐ MULTI-RUN VALIDATION (#4) COMPLETE — the make-or-break signals settled (deterministic lint `prototype/analyze_quality.js`
extended with concern-type-dist + carry-forward + priority-dist + directional-surfacer = ground-truth; + agent armies):**
- **#2 carry-forward = SYSTEMATIC** across 6 runs (Workflow ×3 + DocRevival ×3) + 3 finished specs; type-preserving;
  **5 non-ASSUMPTION types validated end-to-end** (AMBIGUITY · RISK · COMPLIANCE · EXTERNAL_DEPENDENCY · TECH_DEBT);
  typed-% TRACKS the spec's real concern density (3% on clean FlexiCash, 16-59% on messy/unfinished → no over-flag/scope-creep, the partner's worry unfounded — Sonnet is disciplined).
- **directional-flag inversion = STOCHASTIC (~1/3), NOT systematic** (2 independent forensic agents: 0 inversions in 2 fresh Workflow runs; CORRECTS the single-run "RECURS" over-claim — [[multi-run-prompt-validation]]).
- **destructive cascade-delete = SHIP-quality** (DocRevival 3 runs: 0 dangerous tests, revival-entry-survives, today-boundary).
- **⭐ RECALIBRATION (partner): Workflow + DocRevival are UNFINISHED Confluence pages** (in-progress BA — no Jira items/estimation expected until complete); the OTHER 9 sweep pages are complete. Their low sweep scores reflect INCOMPLETE INPUTS, not generator weakness; typed concerns are EVEN MORE valuable there (the BA's finish-worklist). **Recalibrated scores: Workflow 7.6→~8.2 · DocRevival 7.8→~8.5 · FlexiCash ~8.1→~8.4; the whole finished-band lifts post-#2.** Partner's bar: **8.00+ = excellent draft.**
- **FINISHED-SPEC REGRESSION (FlexiCash · DocApproval · Notification, all on NEW code): 0 regression** — 100% coverage, §7 decision-matrix preserved, integrity clean.

**⭐ UX + the "targeted refresh" feature (all LIVE-confirmed working by the partner):**
- **ConfirmScreen navigation-trap FIXED** — the stale state used to show ONLY "Re-run all" → trapped the BA away from the Test Cases screen. Now a 3-state button group: none→Generate · fresh→[View/edit →] · stale→[View/edit →]+[🔄 Re-run all].
- **TARGETED REFRESH (a+b+c)** — after an in-app AC edit: **(a)** per-STORY staleness pinpoints WHICH stories changed ("⚠ ACs changed" chip + banner count); **(b)** per-card ↻ `regenerateTestCase` PERSISTS the edited breakdown → reads the edited ACs; **(c)** `pollRegenerateTestCase` syncs `tcjob.stampedStories[idx]` + returns the edited `story` → the chip clears + the push-embed matches. Design = **system PINPOINTS + human DECIDES** (no auto-regen). Plus a bulk **"↻ Refresh N affected stories"** button (2-step armed, disabled+"⏳ Regenerating…" while busy).
- **⭐ `story_uid` (POLICY §3.5) — the stable identity** that makes all of the above robust to reorder/rename/DELETE. Minted on the frontend (`adaptToLegacyShape` + editor add-feature), threaded spread-preserving → stamped in `stampedStories._uid` → matched `uid→unique-name→index` in `tcStaleInfo` + backend regen-target. Deep-audit (3-agent army) caught the index-identity mis-target the §13 gate missed; `story_uid` fixes it (adversarial-agent-confirmed). Reorder is code-confirmed handled (uid `.find` is order-independent) + not UI-reachable → no LIVE test needed.

**⭐ LIVE bug-fixes this session (partner found + I fixed + partner re-confirmed working):**
- **DUPLICATE test-case card** — regenerating a DELETED story's ORPHAN card positional-fell-back to a NEIGHBOUR → dup-named card. FIXED: `regenerateTestCase` returns `{error:'story_removed'}` for a uid-bearing-but-gone stamp (NO positional fallback); orphan cards get a red **"⊘ Removed from breakdown"** chip + disabled Regenerate (`tcStaleInfo` classifies `removedIdxs` vs `staleIdxs`). = the structural-DELETE reconciliation (deep-audit's P5, partner-promoted in-scope).
- **bulk button** stayed live + no feedback during regen → disabled + "⏳ Regenerating N stories…".
- **new sub-task/feature had NO Description field** (`{x.description && …}` hid the editor + `addTask` had no description) → always-render with placeholder + `description:''`.

**Files changed across the arc (partner commits):** backend `src/index.js` (+ `src/push_handler.js` `flattenBreakdown` export, `src/prompts.js` #2); frontend `static/.../App.js`, `components/TestCasesScreen.jsx`, `components/StoryTestCaseCard.jsx`, `lib/v3Schema.js` (`newStoryUid`+mint), `components/breakdown/{CapabilityCard,BreakdownEditor,FeatureCard,TaskCard}.jsx`; `POLICY.md` (§3.5); `docs/TESTCASE-GENERATION-DESIGN.md`. **Uncommitted by rule:** `prototype/analyze_quality.js` (the extended sweep lint = permanent ground-truth tool).

**Hard-won (fold into the gotchas/lessons):** the Edit tool can't reliably retype the ORIGINAL code's curly-quotes/NBSP in `normAC` (curly `‘’`/`“”`, NBSP 0xa0) — match clean lines + REUSE the existing `sig`/`normAC` rather than re-typing the norm. Adapter spread/by-reference (`adaptToLegacyShape`, `flattenBreakdown`, `editFeature`) means a single `_uid` mint rides everywhere automatically. Push-embed binds by AC-content hash (`acSetHash`→`normAC`), so adding `_uid` to `stampedStories` is inert there.

**⭐ NEXT SESSION (Wed 2026-06-10 — weekly limit hit 96%; branch `feature/product-improvements`):** the test-case feature is DONE — fold toward release. The forward backlog (re-Analyze each through the LENS; full detail [[product-improvements]]):
1. **Managed PRO edition — compute/token-BUDGET cap + adjustments** (replace the count-cap with a monthly compute budget ~$6.50/user/mo target ~50% margin; BYOK = always-on escape; evaluate Haiku-for-Managed re-validated on the CURRENT schema; editions Phase 2, post-publish — needs DPA/29-day). `src/usage.js` + vendor portal + site.
2. **UI/UX improvement refresher** — the open Forge scroll-to-top item; editor polish; the per-test-CASE + per-CATEGORY targeted regen (granular, deferred); orphaned-card FULL reconciliation (a "remove card" affordance — partial done).
3. **Batch-queue / notification of bulk generation** (P2/P3, surfaced 2026-06-04) — when a power user batch-generates several specs, whichever finishes first auto-HIJACKS the screen → a notification cue + a "ready for review" QUEUE instead of the random auto-route. Builds on the existing reconnect + no-TTL KVS job infra.
4. **Custom prompts / house-style** (P2) — output-style enum + one free-text note (partly subsumed by the shipped Project Context).
- **Deferred quality levers** (next-version, [[product-improvements]]): uid-keyed push-embed (eliminates the AC-hash collision-drop — the now-stamped `_uid` enables it); priority near-binary / ceiling-compression / near-dup padding; wire the remaining deterministic lints (literal-mismatch/ceiling/near-dup) into `analyze_quality.js`; a dup-`_uid` guard IF a "duplicate feature" editor button is ever added.
- **PARALLEL launch track (separate):** Marketplace v5.3.0 awaiting Atlassian review → publish → editions Phase 2 (Managed + DPA) → wire `PRO_UPGRADE_URL`; site og-image.png + DPA legal confirm-true ([[site-launch-punchlist]]).

С усмивка ✨ — feature-ът е завършен и LIVE-потвърден през 5 реални спека + adversarial-армии; #2 е дисциплиниран; targeted-refresh-ът + `story_uid`-ът са §13-deep-audit-gate-нати; и трите LIVE-бъга са затворени. Опростихме дизайна (стабилен uid > index/name heuristics — нова POLICY §3.5). Следваща сряда: Managed PRO budget-cap → UI/UX refresher → batch-queue notifications → custom prompts.

---

## ⚡ HANDOVER NOTE (2026-06-07 cont. — FULL 11-page quality sweep COMPLETE + agent-army SELF-REVIEW + ⭐ CRITICAL edited-state bug + cost/pricing + Q5 deps + UI spinner)

A long conductor-orchestrated session (§13) completing the PRE-SHIP test-case quality sweep and a partner-requested adversarial SELF-REVIEW of the validation itself. **Nothing committed/deployed this session — analysis + findings-doc updates only; the partner pushes + the fixes land in a fresh session.** Full sweep record + self-review: `docs/TESTCASE-SWEEP-FINDINGS.md` (the SELF-REVIEW section at the end is the load-bearing re-calibration).

**SWEEP COMPLETE — 11/11 real Confluence pages validated (4-lens agent army each + verdict-taker synthesis).** Scoreboard (post-self-review re-calibration): FlexiCash 8.1 · E-commerce 8.2 · AML ~7.9 · Notification 8.0 · Workflow 7.6 · spec2jira 8.3 · CLM 8.2 · DocApproval 8.2 · DocRevival 7.8 · e-Prescribing ~8.0 · **Sepsis(ADVERSARIAL) ~7.9** (was 8.4 — corrected, see below). **Honest mean ~7.9; ALL SHIP-quality.** The 10th page (e-Prescribing) = 1st with PROJECT CONTEXT → it propagated faithfully (Token 0-misuse, RFC-3161/erasure-archive/20-char rules reached cases). The 11th (Sepsis) = a deliberately ADVERSARIAL spec (bilingual DE/EN, planted traps: OI-not-requirements, v1.4-supersession exception, MAP/MDAP ambiguity, 30-vs-20mL/kg conflict-resolution) → the generator **HELD** (8–9/10 traps avoided, flawless arithmetic).

**⭐⭐ CRITICAL FEATURE BUG (partner-flagged VITAL, CODE-CONFIRMED by me) — test-gen uses the INITIAL breakdown, NOT the Human-EDITED one.** `startTestCaseGeneration` (index.js:1766) reloads `job.breakdown` from KVS (`kvs.get`@1797 → `job.breakdown.features`@1802) = the pristine generated breakdown. The frontend trigger (App.js:1137 `invoke("startTestCaseGeneration",{jobId})`) sends **ONLY jobId**. The BA/PO's Review edits live in `BreakdownEditor` React state and reach the backend ONLY at `startPush({breakdown:pendingBreakdown,jobId})`@App.js:1077 — which writes to JIRA, never back to `job.breakdown` (grep: `JOB_KEY_PREFIX` is written ONLY during generation, lines 1158–1466; there is NO save-edited-breakdown resolver). The code comment@index.js:1818-1820 even bakes in the assumption ("the stamped list preserves the ORIGINAL ACs"). **→ The partner's exact scenario is real: a BA who edits stories to perfection then generates test cases gets test cases for the UN-EDITED stories ("защо ми го връща с първоначалния НЕ ПИПНАТ story").** FIX (A→D→S, fresh session): persist the edited breakdown to KVS on Review→TestCases (or pass it in the `startTestCaseGeneration` payload like Push does) so test-gen reads the EDITED state; stamp coverage from the edited ACs. **This is the #1 pre-GA fix — it makes the whole "refine→perfect→generate" flow honest.**

**Q4b (concerns) + Q5 (deps) — both CONFIRMED gaps (buildTestCaseUserPrompt@prompts.js:525):** the per-Story test-gen prompt feeds name/user_story/description/ACs/category/siblingNames/sharedACs/specSummary/specSource — but NOT (a) the feature's `concerns[]`/ambiguity-notes (so a Human who ADDRESSES a concern is doubly unseen — concerns aren't fed AT ALL, and even if they were they'd be the initial ones), NOR (b) cross-feature **dependencies** (blocks/depends-on edges — only sibling NAMES as a scope fence). **Q5 verdict (my recommendation): YES, add deps (scoped)** — §8 informational-completeness; a story that "depends on / is blocked by" a sibling has test-relevant integration/precondition context → enriches boundary+integration cases. Feed the immediate edge + the peer's one-line, not the transitive graph. Folds into the SAME fix as VITAL #1 (feed `concerns[]` WITH TYPES) — see the findings doc.

**⭐ COST analysis (partner captured Anthropic dashboard $; 8 of 11 pages):** breakdown avg **$0.118** (range .05–.24); test-cases avg **$1.01** (range .22–**3.67** spec2jira/530-case outlier); **test-gen = 8.6× the breakdown cost**, blended **$0.0045/case** / **$0.065/story**. ⚠ **The Managed-PRO count-cap (10 breakdowns/mo) is the WRONG instrument** — cost varies 16× by spec size, so cap=10 gives a typical 12% margin but **−201% on a spec2jira-class** ($39 cost on $13 revenue). **RECOMMENDATION (the partner's own MAX-style framing): cap Managed PRO by a monthly COMPUTE/TOKEN BUDGET, not a request count** (a user spends it on many small OR a few big test-gens; at exhaustion → "continue on BYOK or wait for reset"). **BYOK PRO = always-on at the customer's own Anthropic cost = the escape hatch** (no cap). Target ~50% gross margin → ~$6.50 budget/user/mo (Forge 0% fee <$1M). Also a cost LEVER to evaluate: the test-gen MODEL is Sonnet (24K tok/story) — a Haiku option (~⅓ cost) could be the Managed default while BYOK offers Sonnet (the original validation chose Haiku as quality-adequate, but on the OLD schema — re-validate before relying). Record: `memory/monetization-strategy.md`.

**UI/UX fix (partner-flagged, batch-processing class — same as the breakdown progress bar):** the test-gen loading spinner shows **"0% complete" until the very end** (it's an async Anthropic BATCH — no incremental progress) → reads as "broken." **FIX: remove the 0%/determinate progress from the test-gen spinner; use an indeterminate spinner + live timer + "you can leave/reconnect" copy** (mirror the generation-spinner fix already done for breakdowns). Frontend-only.

**⭐ SELF-REVIEW (agent army audited MY validation) — found REAL methodology gaps I own (full detail: findings-doc SELF-REVIEW section):** (1) I ran cross-page AGGREGATE checks only at the END → missed 4 UNIFORM systemic gaps visible only in aggregate: **concern-TYPE monotony is STRUCTURAL** (0 `[RISK]`/1148 concerns across ALL 11 pages — the generator can't emit a typed RISK; F-RISK is 11/11 structural, NOT "2-page stochastic"), **priority near-binary** (84.3% Crit/High, Low=0.4%, 6/11 pages ZERO Low), **ceiling-compression INVERTED** (r≈−0.614; richest/safety-critical stories MOST cap-compressed; 46/172 at/near the 20-cap → coverage≠depth), **combinatorial near-dup padding** (~84 pairs on non-decisive axes, e.g. Workflow's role×status cross-product). (2) My F-RISK SCORING was inconsistent (`corr(score, unflagged-RISK-count)=+0.45` — penalized only the 2 hand-traced pages for a UNIVERSAL defect). (3) I **designed but never RAN** the literal-mismatch lint → now run: wrong-VALUE class is RARE (~1 real/2518). (4) **N=1 per page** → DOWNGRADED the "Project Context ELIMINATES F-RISK" claim to one SUGGESTIVE data point (confounded by domain). (5) Validated the OUTPUT JSONs, not the edit-propagation flow (the partner caught the edited-state bug). **Re-calibration:** the CRAFT is genuinely strong + earned (coverage-strip honesty, sharp boundary literals, negative+edge ≥52% every page, 0 dup-titles); but the band was anchored (stdev 0.234) and didn't price the 4 uniform gaps → honest mean **~7.9**, and the adversarial Sepsis should NOT be tied-highest (it EXPOSES the systemic gaps most). All gaps are PROMPT/SCHEMA-fixable (the model varies confidence across 32 values → it CAN differentiate when the field elicits it).

**NEXT SESSION (fresh; branch `feature/product-improvements`) — PARTNER-SET PRIORITY ORDER (do strictly in this sequence; A→D→S each through the LENS):**
1. ⭐⭐ **FIX the edited-state bug** (#1, the highest-value) — persist the Human-edited breakdown to KVS on Review→TestCases (or pass it in the `startTestCaseGeneration` payload like Push does at App.js:1077), so `startTestCaseGeneration` (index.js:1797-1802) reads the EDITED `breakdown.features`, NOT the pristine `job.breakdown`; stamp coverage from the EDITED ACs. Makes the "refine→perfect→generate" flow honest.
2. ⭐ **INFORMATION COMPLETENESS for test-gen (§8)** — feed into `buildTestCaseUserPrompt` (prompts.js:525): (a) the feature's `concerns[]`/ambiguity-notes **WITH THEIR TYPES PRESERVED** (closes the 0-`[RISK]`/1148 concern-monotony + F-RISK + Q4b), and (b) the **cross-feature dependencies** (immediate blocks/depends-on edge + the peer's one-line, scoped — NOT the transitive graph; Q5). One §8 lever; depends on #1 (the edited concerns/deps must be the ones fed).
3. **UI spinner** — remove the "0% complete" from the test-gen loading screen (it's an async batch → reads as broken); indeterminate spinner + live timer + "you can leave/reconnect" copy (mirror the breakdown-spinner fix). Frontend-only.
4. **Multi-run re-validate — KEY specs ONLY (cost-aware; NO trivial reruns).** Regenerate **Workflow + DocRevival 3× each** (the two N=1-fragile pages that drove the low scores: the directional-flag inversion + F-RISK) to settle whether they RECUR or were unlucky draws — this sets the VITAL #1/#2 fix priority and confirms #2's effect. Optionally 1 complex spec (AML or the adversarial Sepsis) to confirm trap-resistance isn't luck. SKIP the trivial/cheap pages (Notification etc.). Needs the partner's Anthropic key (`C:\Users\AlexAsenov\Downloads\anthropic-key.txt`). Also wire the deterministic lints (literal-mismatch + priority-dist + ceiling + near-dup) into `prototype/analyze_quality.js` as permanent ground-truth + the literal-mismatch as a pre-export check.
5. **Managed compute-budget cap + BYOK escape** — replace the Managed-PRO count-cap with a monthly COMPUTE/TOKEN budget (spend on many small OR a few big test-gens; at exhaustion → "continue on BYOK or wait for reset"); BYOK PRO = always-on at the customer's cost = the escape hatch. Target ~50% margin (~$6.50/user/mo). Evaluate Haiku-for-Managed (re-validate on the CURRENT schema first). Update `src/usage.js` + the vendor portal + site at editions Phase 2.

Then: §13 audit+code-review gate → build → `forge deploy` → partner Live-E2E.
*(Note: the partner's "findings" referenced this session WERE the four above — cost, UI spinner, edited-state, deps; all already folded in. No new findings pending.)*

С усмивка ✨ — sweep-ът е завършен (11/11, adversarial-ът издържа), но честната оценка е ~7.9 с 4 универсални systemic-ceiling находки; армията хвана това, което per-page-ът не видя; и партньорът хвана голямото — test-gen НЕ лови edited state-а (CRITICAL #1 fix). Приоритетният ред за следващата сесия е фиксиран по партньора. Cost-моделът + pricing-ът + UI-spinner-ът са документирани.

---

## ⚡ HANDOVER NOTE (2026-06-07 — Test-case feature: deep-audit cycle-fix (PROD-VALIDATED) + Work B per-case Save/Revert + export validation; Live-E2E GREEN)

A focused session on `feature/product-improvements` hardening the test-case feature after the partner's
Live E2E. **3 commits (pending partner push → 8 ahead of origin): `396b204` cycle-fix · `7374289` Work B ·
`6919b16` export polish+validation.** All §13-gated; Live-E2E confirmed working by the partner.

**Deep audit (rigorous, 4-lens) of the ceiling-20 §7-fed FlexiCash output → ~8.1/10, SHIP.** Confirmed:
decision-matrix **14/15** cells (the missing E-band cell is a CORRECT MERGE, not a gap — band E
AUTO_DECLINEs regardless of affordability per BR-303, so E/PASS is the strongest falsifiable test and the
redundant E cell is rightly not padded), **100% AC coverage on all 11 stories**, eligibility 8/8 +
affordability + pricing boundary literals, 175 cases / 50 inferred (inferred = genuine §7 boundary
enrichment: BR-901 30d purge, BR-108/109 bounds at/inside/outside — NOT padding), 0 title/body mismatches,
0 stale refs.

**The ONE code bug found + fixed — cycle-resolution incoherent narrative (PROD-VALIDATED fix):**
`verifyAndRepairCycles` (index.js) iterated a STALE `detectCycles` list → on overlapping/mutual cycles it
over-cut + emitted CONTRADICTORY `[RISK|low]` concerns (FlexiCash: a mutual RBP↔ACD pair had BOTH directions
cut + 3 contradictory notes, one factually wrong about BR-402). The dependency GRAPH was always
acyclic+buildable — only the NARRATIVE (the BA's audit trail) was incoherent, which for this trust-critical
audience is decisive. **Fix (pure control-flow, NO LLM/prompt change):** re-detect after each cut (only cut
STILL-LIVE cycles) + a `cutEdges` reverse-guard (never cut both directions of a mutual pair) + an
`unresolvable` loop-guard + **dropped the LLM's free-text `reason` from the user-facing note** (the edge
CHOICE is legitimately the LLM's, but its prose can make a checkably-wrong factual claim → kept the
deterministic WHAT, handed the WHY to the BA: "Review whether this is the right edge to remove"). §13 gate
(code-review + adversarial audit) → SHIP; offline control-flow test `prototype/test_cycle_repair.js` 5/5.
**VALIDATED IN PRODUCTION**: the partner's fresh Live breakdown shows ONE coherent concern + a
semantically-correct cut (RBP made independent = the spec's own "pricing-first" sequencing assumption).

**⭐ Pure-function dispatch debate (partner-raised, POLICY §4/§7) — RESOLVED: the pure fix is CORRECT, NOT a
patch, and NO LLM critic/verdict-taker is needed.** The cycle pipeline is a correctly-partitioned HYBRID:
DETECTION = structure → pure (`detectCycles`); EDGE-CHOICE = meaning → LLM (`resolveDependencyCycle`,
UNTOUCHED — the reasoning lives here); ORCHESTRATION = structure → pure (the fix); VERDICT-on-correctness =
the HUMAN BA (surfaced `[RISK|low]` advisory). 4-test on orchestration: structure / universal / an-LLM-
would-be-worse / deterministic-wrong-is-testable. NOT a patch — `graph.js` documents non-FlexiCash cycle
instances (Subscription↔Payment, ConfluenceConnection↔ConfluenceExtraction); the fix is domain-blind +
abstract-graph-tested. §7 critic bar (silent + expensive) NOT met — cuts are SURFACED + recoverable in the
editor; a verdict-taker LLM would RE-INTRODUCE exactly the unreliable prose the fix removed. If ever more
rigor is wanted, the §7-correct place is a critic on EDGE-CHOICE (#2), never orchestration (#3) —
over-engineering today. (Folded into `memory/deep-audit-vs-per-change-gate` thinking + the dispatch rule.)

**Work B — per-case Save/Revert footers (partner UX ask "move Save+Revert under each case #1, #2"):** each
edited/new case shows its own footer `[↩ Revert this case]` (or `[↩ Remove]` for a never-saved case) +
`[Save changes]`. HONEST about per-STORY save (KVS is one value/story → per-case "Save changes" persists the
WHOLE story; tooltip says so); per-case revert is genuine (reuses onCaseChange/onDeleteCase — no new backend
path). SAFE index handling: per-case-by-index is valid only while no SAVED case was deleted (a delete shifts
indices) → parent flags `structurallyShifted` (sticky; set on saved-case delete; cleared on
save/revert/regen) AND `cases.length >= savedCases.length`; when unsafe → a story-level FALLBACK bar (also
the catch-all for a no-op draft, so the BA is NEVER trapped with unsaved edits + no control). §13 gate
(code-review + UX/data-loss audit) → SHIP (the decisive delete-saved+append-to-equal-length case holds via
the sticky flag; no false-negative dirty; no data-loss path; Back/Push/Regenerate dirty-guards intact).
**Bonus fix:** stale frontend "+ Add" cap 15→20 (backend caps at 20 — `testcases.js` `slice(0,20)`; the UI
silently blocked cases 16-20).

**Save-to-export polish (Live-E2E feedback):** when a story is dirty the Copy Gherkin/CSV buttons used to
become two DISABLED "Save to export" buttons (correct — export renders SAVED KVS, mid-edit would copy stale
— but it READS as broken). Now ONE clear dashed-border hint "⤓ Save to enable export"; the Copy buttons
return after Save. Pure presentation; the no-stale-export guard unchanged.

**Export format VALIDATED (partner's "test Copy works"):** `prototype/validate_exports.js` renders the live
FlexiCash test-cases through the PROD renderers (`renderGherkin`/`renderManualTable` — what
`getTestCaseExports` calls). Gherkin = valid `.feature` (Feature / @tags / Scenario / # Covers /
Given-When-Then, `expected_result` as the final assertion STEP, no empty steps, all 11 stories render); CSV
= valid RFC-4180 (11 columns, consistent column count, formula-injection neutralized, multi-row per case).
Both tool-importable (Xray/Zephyr/Octane · ADO/Jama/TestRail). [Worth a real Copy→paste into ONE target tool
on next deploy to 100% close it.]

**RESUME / remaining:**
1. **Partner: push the 8 commits + `npm run build` && `forge deploy`** — Work B + the export polish are
   FRONTEND (the cycle-fix backend was ALREADY deployed — the Live breakdown proved it). Then a quick Live
   E2E of the "Save to enable export" hint + a real Copy→paste into Xray/ADO to 100% confirm import.
2. **Test-case feature finish-line:** optional design-doc note (Work B + cycle coherence) in
   `docs/TESTCASE-GENERATION-DESIGN.md`; broader quality validation on the partner's ~9 real Confluence
   pages (beyond FlexiCash) as the pre-ship confidence sweep; then fold the feature toward a release.
3. **Launch track (separate, unchanged):** Marketplace v5.3.0 awaiting Atlassian review → post-approval
   publish → editions Phase 2 (Managed Pro + DPA/29-day) → wire `PRO_UPGRADE_URL`; site og-image.png + DPA
   legal confirm-true (`memory/site-launch-punchlist.md`).

С усмивка ✨ — deep audit-ът хвана + затвори единствения реален бъг (prod-validated), pure-function
dispatch-ът е защитен през самата политика, а Work B + export polish-ът са §13-gate-нати и Live-E2E зелени.

---

## ⚡ HANDOVER NOTE (2026-06-05 cont. — Test-case FORMAT research (14 tools) → dual-format strategy; P1 core reshaped + §13-gated + re-validated; P2 next)

A long conductor-orchestrated (§13) session on `feature/product-improvements` continuing the test-case feature. **P1 DONE; P2–P6 pending. Committed this session (partner pushes).** Folds in / supersedes the 4 directives in the note below.

**Format research (partner-directed "sharpen the axe" before hands-on):** a 14-tool sweep (Xray/Zephyr/TestRail/qTest/PractiTest/**OpenText ALM Octane**/Polarion/codeBeamer/Jama/IBM-ETM/**Azure DevOps Test Plans**/Cucumber-Studio/Gauge/SpiraTest/TestLink) → **DUAL-FORMAT strategy LOCKED**: two output shapes cover the whole professional world, both **deterministic pure-function renders from ONE rich schema** (§4, zero extra model tokens): **Gherkin `.feature`** (BDD world: Octane BDD-Spec / Xray / Zephyr / Cucumber-Studio / SpiraTest / Polarion) + **structured table/CSV** (manual/enterprise: **ADO = huge + NO native Gherkin**, Jama, IBM-ETM, codeBeamer, TestLink). `type`→@tag; `ac_trace`→References/`# Covers:`; `confidence`→internal-only; `given[]`=preconditions (rendered, not a schema field). ⚠ **NEVER emit Octane `@TID/@REV`** (Octane generates them). UI label "Test Cases", framed as **acceptance scenarios** (BDD/Octane culture). test_data flat v1; Examples/Scenario-Outline = v2. Push v1 = Gherkin `codeBlock` embed (verify ADF-safety in P4, else bulletList fallback).

**P1 (validated-core reshape):** schema −`coverage_self_assessment`, +`priority` (Critical/High/Medium/Low, capitalized) +`test_data` (flat string[]); prompt BREADTH-FIRST + Bug-Y-clean priority/test_data guidance + few-shots now demo priority; `category` provenance line. **§13 4-lens gate** (audit / code-review / Bug-Y / integration + conductor adversarial synthesis): the **Bug-Y agent caught a §5 crack in the TEST DATA guidance that the code-review PASSED** → rewrote to the abstract decisive-test; conductor OVERRODE one finding (kept "or compliance" in PRIORITY — abstract archetype + load-bearing for the regulated BA audience). **Re-validated** (Haiku/2400, multi-run): **≤5-AC = 100% coverage every run**, <17s, 0 flags, **priority now on EVERY case** (few-shot demo closed the prior 1/18 gap), **test_data BA-grade** (concrete boundary values + leap-year). **6-AC (rich) stories truncate stochastically** (the verbose new fields ate the budget; breadth-first did NOT fix it — Haiku ordering limit) → handled BY DESIGN by **P3's REACTIVE sub-chunk** (coverage strip DETECTS, never silent; **max_tokens 2400 KEEP** — bumping gambles the HARD 25s OUTPUT-token limit). Harness defaults FIXED (4000→2400, Sonnet→Haiku, +`--sonnet`, `category` wired). Spend ≈ $0.69 / 4 runs (1 was a max_tokens=4000 mis-config — the harness default, now fixed → won't recur).

**Hard-won (fold into the Forge gotchas):** Anthropic structured outputs REJECT numeric JSON-schema constraints (maxItems/minItems/min/max) — bounds live in the defensive parse. The 25s Forge resolver limit binds on **OUTPUT** tokens (Haiku ~140 tok/s measured). Forge sandbox iframe blocks `blob:` downloads → copy-to-clipboard primary, data-URI best-effort. **ADF `codeBlock` safety is UNPROVEN** in this app's push — validate in isolation before relying (else bulletList, gotcha #11).

**Committed this session (partner pushes):** `src/prompts.js` (P1 core) + `prototype/testcase_harness.js` + `prototype/fixtures/testcase_stories.json` + this `CLAUDE.md`. *(The `.claude` memory `testcase-generation-feature.md` is auto-persisted, not in-repo.)*

**RESUME (on the partner's GREEN signal — do NOT start P2 unprompted):** **P2 — the two deterministic renderers (`renderGherkin` + `renderManualTable`/CSV) + port `computeCoverage` into a prod lib** (v3Schema.js or new testcases.js), with OFFLINE unit tests (escaping / no-acs / stale-AC / inferred / duplicate-name). **Zero API cost.** Then P3 (backend `generateTestCasesForStory` + chunked session + reactive sub-chunk + defensive parse; clone distillCategory@anthropic_client.js:826 + startDistillSession/distillStep@index.js:484-629) → P4 (push embed + reconnect rehydration HIGH + staleness fingerprint) → P5 (dedicated screen) → P6 (§13 gate + `docs/TEST-CASE-GENERATION-DESIGN.md` + build + deploy). **Carry-forwards:** P2 must render a `NOTE` concern-type gracefully (a prefix-less concern defaults to NOTE, outside the breakdown vocab) + use `(story_name,title)` composite for binding; P3 parse keeps+defaults a prefix-less concern (`[ASSUMPTION|medium]`) + salvage overwrites `story_name`. Full detail: `.claude` memory `testcase-generation-feature.md`.

С усмивка ✨ — брадвата е наточена (14-tool format research), P1 ядрото е reshape-нато + §13-gate-нато + re-validate-нато; остават renderers + backend + screen, фаза по фаза.

---

## ⚡ HANDOVER NOTE (2026-06-05 — Test-case generation: design + make-or-break PROMPT empirically VALIDATED + LOCKED; backend/UI deferred to a fresh session; 4 partner directives folded in)

A long, conductor-orchestrated (§13) session on `feature/product-improvements` building the NEXT
product-improvements feature — **per-Story TEST-CASE generation** (the P1/P2 roadmap item). **Design
locked + the make-or-break quality core (schema + prompt) built and EMPIRICALLY VALIDATED; backend +
UI implementation deliberately deferred to a FRESH focused session** (partner's call at a natural
milestone — large context). **NOT committed/deployed — partner commits the validated core + builds
the rest fresh.** Full state: `memory/testcase-generation-feature.md`.

**Feature (partner-LOCKED):** a dedicated **"Test Cases" screen**, flow **Review → Test Cases → Push,
OPTIONAL/skippable** (NOT mixed into the already-dense breakdown editor), with **bulk "generate for all
stories"** (progress bar) + per-Story regenerate. Audience = picky senior **BA/PO**; test cases are
their core professional deliverable → **MAX quality** bar.

**⭐ AUDIENCE & VALUE NORTH STAR (partner's framing — the WHY behind every decision):** the BA/PO are
**maximally critical** — writing tests is their own discipline + job description, so they will **hunt for
the smallest wrong thing to latch onto**; the output must survive expert scrutiny. **But the bar is
EXCELLENT, not PERFECT** — AI AUGMENTS the human (it doesn't replace them; they have a job), so a strong
expert-grade DRAFT that gives a tough expert a real head-start makes them **happy, satisfied, and READY TO
PAY**; they refine + sign off (human-in-the-loop). **Quality > speed** (Haiku was chosen only because it
empirically MATCHED the quality bar, not for speed). **Highest value, spend tokens SMARTLY** — drop what
the expert doesn't need (→ no self-assessment for tests) and reinvest the budget on what adds value for
them. **Signal direction = "would a critical BA/PO expert be impressed enough to pay?"** — every choice
(trustworthy coverage, falsifiable cases, honestly-flagged assumptions, scope fence, 1:1 with their real
tools/format) points there.

**⭐ VALIDATED + LOCKED** (in `src/prompts.js`: `TEST_CASE_SCHEMA` + `TEST_CASE_SYSTEM_PROMPT` +
`buildTestCaseUserPrompt`; harness in `prototype/`):
- **Model = claude-haiku-4-5.** An empirical bake-off OVERRODE the partner's initial "Sonnet quality-
  first" pick (re-confirmed Haiku WITH data): Haiku is at the BA/PO quality bar across clinical/fintech/
  logistics + no-acs/trivial/rich probes, fits the 25s budget, ~1/3 cost. **Sonnet was superb but ~54s
  single-call / ~38s per-type → blows the 25s resolver limit** and inflated volume.
- **Transport = ONE sync structured-output call PER STORY**; **`max_tokens ~2400` HARD-bounds the call
  <~18s.** ⭐ The 25s Forge resolver limit binds on **OUTPUT tokens, not input** (Haiku ≈ 110 tok/s), so
  engineering owns the cap (§4) — a high max_tokens risks a >25s timeout that kills the resolver before
  any salvage runs. Per-type chunking was rejected (timing-safe but bloated to 17-27 cases/story).
- The **"COVER EVERY AC FIRST" prompt rule makes truncation COVERAGE-SAFE** — 100% AC coverage on every
  validated run even when the tail truncates (the PURE coverage strip is authoritative). Multi-run × 3
  domains + 3 probes: 9-12 calibrated cases/story, 100% coverage, ~15-22s, 0 heuristic flags, BA/PO-grade
  (boundary inclusive/exclusive, leap-year month-end, self-co-sign, honest `[ASSUMPTION]` concerns,
  scope fence, shared ACs used). ~$0.65 of validation calls on the partner's key.
- **Hard-won (fold into the Forge gotchas):** Anthropic **structured outputs REJECT numeric JSON-schema
  constraints** — `output_config.format.schema: For 'array' type, property 'maxItems' is not supported`
  (also `minItems`/`minimum`/`maximum`; `BREAKDOWN_SCHEMA` uses none) → enforce ceilings/bounds in the
  **defensive parse**, not the schema. **AC-trace by VERBATIM text, never by index** (an index goes
  stale-but-in-range and silently mis-attributes coverage — the worst §8 failure). The PURE coverage
  strip (`normAC` + match → covered / uncovered / stale / inferred; `coverage_pct` null, never vacuous
  100%, on no-ACs) is the implementation contract for `v3Schema.js` — drafted in `prototype/testcase_harness.js`.
- **prototype/ dual-file rule is DEAD** (`prototype/prompts.js` frozen 2026-05-30; schema/prompt live
  ONLY in `src/prompts.js`). prototype/ is reused as the standalone LLM validation harness:
  `prototype/testcase_harness.js` + `prototype/fixtures/testcase_stories.json` (`--selftest` offline,
  `--runs`, `--per-type`, `--haiku`, `--max-tokens`; needs an Anthropic key — partner's at
  `C:\Users\AlexAsenov\Downloads\anthropic-key.txt`).

**⭐⭐ PARTNER DIRECTIVES for the fresh session — do these as part of the schema/format rework BEFORE finalizing:**
1. **REMOVE `coverage_self_assessment`** from the schema + prompt. BA/PO are experts at test cases — they
   do NOT need the model's self-assessment of test coverage (self-assessment is useful only for the
   TECHNICAL breakdown stories/details, not the tests). Bonus: it cuts output tokens (likely lets typical
   stories finish CLEANLY at max_tokens 2400 → kills the "truncated" cosmetic) and it was the truncated
   tail anyway. Re-validate after removal.
2. **RESEARCH professional BA test-case tooling + format; align 1:1.** Investigate the tools BAs actually
   use to author test cases (Xray, Zephyr, TestRail, qTest, PractiTest, …) and the FORMAT they expect
   (Gherkin/BDD step tables, CSV/import schemas, fields: preconditions / test steps / test data / expected
   results / priority / labels). Compare to our schema + the JIRA push format and **make our output 1:1
   with what they work with** so they can drop it straight into their tools. ⇒ This may RESHAPE the schema
   + the push format — the current schema is QUALITY-validated but the FORMAT is pending this research. Do
   this FIRST (it informs #1's rework).
3. **Per-Story stepping + a progress bar + ADAPTIVE sub-chunking for rich Stories.** Generation runs one
   Story at a time (the chunked-session pattern, progress bar). For a VERY RICH Story (would exceed 25s /
   the case ceiling), split that ONE Story's Haiku call into several (per-type, or loop-until-done) so each
   sub-call stays bounded — i.e. the session supports 1+ steps per Story, adaptive.
4. **INVESTIGATE Epic / Category context.** Check whether feeding the Epic summary + the feature's Category
   (the cluster the Story sits in) into the call adds **highest-value** (richer §8 provenance). **Verify the
   value BEFORE adding** (don't bloat the call blindly) — verdict-pending.

**RESUME (fresh session, branch `feature/product-improvements`):** re-Analyze through the LENS; do
directives #2 → #1 first (BA-tool format research may reshape the schema) → then T3 backend
(`generateTestCasesForStory` Haiku-call + chunked session, adaptive per-Story) → T4 push-embed (richADF
☐-bulletList, gotcha #11) + separate-KVS persistence + **reconnect rehydration** (HIGH pitfall: `getResults`
reloads `job.breakdown` which has NO test cases → must rehydrate `testcases:<jobId>` into the editor or
expensive output vanishes silently on reload) → T5 quota/key-source (mid-run managed-key-vanish FAIL LOUD;
distill RE-RESOLVES the key per step, does NOT stamp) → T6 dedicated screen → **T7 §13 audit + code-review
gate** → T8 design doc + build + deploy. Clone templates: `distillCategory` (anthropic_client.js:826) +
`startDistillSession`/`distillStep` (index.js:484-629) + `resolveAnthropicKey`/`checkQuota`/`buildQuotaExceeded`
(index.js:73-130). The 10-agent design + 14 pitfalls are recorded in `memory/testcase-generation-feature.md`.

**To COMMIT now (partner):** `src/prompts.js` (the validated schema + prompt + user-builder) +
`prototype/testcase_harness.js` + `prototype/fixtures/testcase_stories.json` (the validation harness) +
the new memory. Suggested: `feat(product-improvements): test-case generation — validated quality core (schema+prompt+harness)`;
the backend/UI lands next session.

С усмивка ✨ — make-or-break-ът (качеството на prompt-а + изборът на модел) е емпирично доказан и
заключен; остават имплементацията + format-research-ът, в свежа фокусирана сесия.

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
