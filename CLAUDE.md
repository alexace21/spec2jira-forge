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

## 💰 Monetization & tier enforcement (DECIDED 2026-05-30 — do not re-litigate)

Settled. Do NOT reopen these in future sessions:

- **BYOK** — the customer brings their own Anthropic API key (pays Anthropic for
  compute directly). No Spec2Tickets-operated backend.
- **Pricing (MVP early access):** **Free = 3 breakdowns/month** (resets the 1st, UTC)
  · **Pro = €20/month → UNLIMITED**. One flat paid price; €20 is a deliberate floor
  (below it reads as a hobby). Sold as the Marketplace subscription —
  `resolveTier()` reads `context.license.active` → active ⇒ Pro/unlimited.
- **`block` is correct.** Free → 3 → block → Pro is a sound freemium funnel: the free
  trial acquires, the €20-unlimited deal is the generous part. "Land-grab" = attractive
  PRICING + early-access framing + grandfathering (`memory/migration-protections.md`),
  NOT an unlimited free tier. (Was over-flagged once — do not re-debate.)
- **`ENFORCEMENT_MODE` is per Forge environment** (`src/usage.js`, from `process.env`):
  **production = `block`** (default when unset) · **dev = `meter`** via
  `forge variables set --environment development ENFORCEMENT_MODE meter`. Dev tests
  freely; production enforces.
- **The €20 Marketplace listing goes live WITH the production release** (Marketplace
  approval is part of the MVP launch). Dev having no listing is NORMAL, not a problem —
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

✅ **P3a — tier enforcement** (`src/usage.js`): per-site monthly breakdown counter
(KVS `usage:YYYY-MM`), license-aware `resolveTier`, `ENFORCEMENT_MODE` flag. Model:
**Free 3/month + Pro €20/month unlimited** (BYOK-only economics — customer pays
Anthropic; the €20 buys the app). `startGeneration` checks/consumes (fail-open,
consume-on-success); `getUsage` feeds a usage badge on Ready; quota_exceeded →
upgrade + reset date.

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
  Production-readiness: wire the Upgrade button on `LimitReachedScreen` when the €20
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
