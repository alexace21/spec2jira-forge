# Session closure — v3.0.0 MVP E2E happy path (2026-05-29 → 2026-05-30)

> Full forensic arc of the session that built the Spec2Tickets v3.0.0 Forge MVP
> from the pivot plan to a working end-to-end JIRA push. Read alongside `CLAUDE.md`.
> Every bug → fix → Forge-platform lesson is recorded so the next session (and the
> Atlassian review prep) inherits the hard-won knowledge.

## Outcome

**Full E2E happy path WORKING**: Confluence spec → Anthropic Batches API (Sonnet 4.6,
structured output) → BreakdownEditor review + Dashboard signals → chunked JIRA push
(1 Epic + N Stories + Subtasks + Story-blocks-Story links + category labels).

Validated on: App-notification spec (10 feat / 39 subtask / 16 links — full visual
confirm in JIRA), CLM (39 feat), Spec2jira own spec (39 feat / 162 subtask — generation
confirmed; chunked push at scale = next test). Empirical: Sonnet quality high
(HIGH/MEDIUM ratings, specific concerns/risks/deps, 67-80/100 avg confidence).

## The arc (chronological — each item is a bug found + fix + lesson)

### Generation path
1. **Grammar compile timeout** (Anthropic) — schema too complex (10 nested types).
   Fix: simplified to 4 types; flattened concerns/spec_concerns/shared_acs to
   `[TYPE|severity] text` prefix strings.
2. **`@forge/events` 2.x → 400 Bad Request on every Queue.push()** — both queues,
   minimal + full payload, all toolchain combos (Node 20→24, CLI 12.18→12.21,
   runtime 24→22). Isolated via a diagnostic resolver pushing `{test:1}`. Root cause:
   **2.x SDK is broken.** Fix: downgrade to `@forge/events@^1.0.3` (1.x `push()` takes
   raw payload, no `{body:}` wrapper). All 3 diag pushes succeeded on 1.x.
   *Lesson: when an SDK call fails identically across every input + toolchain combo,
   isolate the SDK version itself.*
3. **55-sec async-event timeout vs 60-150 sec Anthropic call** → runaway retry loop,
   burned ~71K tokens. Fix: **pivot generation to Anthropic Message Batches API** —
   submit instantly, poll `pollBatchStatus`, fetch on `ended`. 50% cheaper (batch tier).
   Added a retry guard + KVS pass-through (page content in KVS, key in payload).
4. **`truncated` error** on the 101K-char Spec2jira spec — 16K output cap hit
   (~32.5K needed). Fix: `MAX_OUTPUT_TOKENS = 48000` + `salvageTruncatedBreakdown`
   (recovers complete feature objects from unterminated JSON) + UI truncation note.
5. **Confluence `410 Gone`** — v1 `/content/{id}` deprecated. Fix: v2
   `/wiki/api/v2/pages/{id}?body-format=storage`; added `read:page:confluence` scope.
   Field-name mismatch fix: fetchPage returns snake_case (`page_id`, `body_length`).

### Push path
6. **`queue.push 400` again** for push — same 2.x bug; resolved by the 1.x pin.
7. **`401 - AUTH_TYPE_UNAVAILABLE`** — push ran in an async event consumer; `asUser()`
   is unavailable there. Verified via claude-code-guide agent + Atlassian docs:
   asUser() works ONLY in resolvers; `allowImpersonation` doesn't bridge queue events.
   Fix: move push to a **synchronous resolver** (`executePush`).
8. **0 Subtasks created** (39/39 failed) — hardcoded `issuetype: {name:'Sub-task'}`;
   team-managed dev project names it `Subtask`. Fix: **dynamic resolution** — GET
   project `?expand=issueTypes`, find `subtask:true`, use its id. Logs confirmed
   `subtaskType=Subtask (id=10008)`.
9. **25-sec resolver timeout** — with subtasks actually creating, JIRA bulk is slow
   (~0.85s/issue → 10 stories = 8.5s; 39 subtasks would exceed budget). Verified via
   agent: chunked-resolver is the only documented asUser-preserving path. Fix:
   **chunked push** — `startPushSession` (lookup + Epic + KVS session) + `pushSessionStep`
   (one bounded chunk: STORY/SUBTASK_CHUNK=15, LINK_CHUNK=18) + UI loop +
   `PushingScreen` progress bar. ~6 invocations for App-notif; each <25s.

### Product / UX
10. **Epic count discrepancy** (editor 12 "Epics" vs dashboard 1) — v3 schema has 1
    Epic + `category` per feature. Decision (user): **Option A** — 1 Epic header +
    Stories grouped by category labels. Renamed "Epic"→"Category" badges in editor;
    category → kebab-case JIRA label. Epic synthesized in `pollJobStatus`.
11. **Silent-misalignment defenses** (user-driven product decision) — 3 shipped:
    (a) graceful subtask fallback: no subtask type → embed tasks as `☐` bulletList
    checklist in Story description + note + support email; (b) optional required
    custom fields JSON in AdminSettings (Advanced) — merged into every create payload;
    (c) support@spec2jira.com on ErrorScreen + partial-failure block.
    *Used a bulletList not taskList — taskList validation risk would fail every Story.*
12. **No spinner / 25s frozen** — solved by the chunked `PushingScreen` progress bar.
13. **2 apps in Manage Apps + "do we need JIRA install?"** — YES: cross-product app
    (Confluence UI + JIRA write via asUser). 2 entries = both product installs. Normal;
    Atlassian reviewers expect it.

## Forge platform lessons (the durable knowledge — also in CLAUDE.md gotchas)

- `@forge/events` 2.x broken → pin 1.x (raw payload, no `{body:}`).
- Local Node must match runtime (24.x); reinstall CLI after Node upgrade.
- `asUser()` resolver-only; NOT async consumers (`AUTH_TYPE_UNAVAILABLE`).
- 25-sec resolver timeout; JIRA bulk ~0.85s/issue → chunk pushes.
- Anthropic Batches API for generation (55s async-event timeout < 60-150s call; +50% cheaper).
- Confluence v1 → 410 Gone; use v2 pages endpoint.
- Subtask type varies → resolve by `subtask:true` flag, use id.
- 48K output cap + salvage path for truncation.
- KVS pass-through for large payloads + chunked-push session state.
- Cross-product = 2 installs; both via `forge install --upgrade`.
- ADF taskList risky → bulletList for embedded checklists.
- v3 schema has no epic field → synthesize.
- Forge lint sometimes wrong → runtime + docs win; `forge deploy --no-verify`.

## Files touched this session

New: `src/anthropic_client.js`, `src/prompts.js`, `src/push_handler.js`,
`static/hello-world/src/lib/v3Schema.js`, `CLAUDE.md`, this doc.
Rewritten: `src/index.js`, `static/.../App.js`, `static/.../AdminSettings.jsx`,
`static/.../breakdown/CapabilityCard.jsx` + `BreakdownEditor.jsx`.
Modified: `manifest.yml` (globalpage migration earlier + consumers removed), `package.json`.
Deleted (intra-session, never committed): `src/generate_handler.js`.

## Empirical timings (dev site)

- App-notif (10 feat): generation batch ~136 sec / $0.09; chunked push ~6 steps, all subtasks OK.
- Spec2jira (101K chars, 39 feat): generation batch ~456 sec / $0.48; 48K cap held; chunked push = next scale test.
- CLM (28K chars, 14 feat): generation batch ~226 sec / $0.16.

## Next-session entry points

- **P1** scale-test Spec2jira chunked push (39 feat / 162 subtask / dense deps).
- **P2** commit the arc (stage source only — node_modules tracked).
- **P3** MVP backlog: tier-enforcement KVS counter → error polish → Marketplace resubmit (docs/privacy/pricing).
- **P4** cleanup: untrack node_modules.
