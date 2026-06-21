# Test-Case Generation — Design (Sonnet frontier + Batches API)

> The synthesized, verdict-orchestrated design for the per-Story test-case feature,
> after the **Sonnet + Batches** pivot (data-confirmed). Branch `feature/product-improvements`.
> Source-of-truth for the FULL feature: P1 prompt → P3 backend → P4 push embed → P5 screen →
> §9 human-in-the-loop editing. Supersedes the earlier Haiku-sync-chunked + reactive-sub-chunk
> plan (that design's parse/key-source/reconnect/KVS *concepts* carry over; the *call structure*
> becomes a batch).

---

## 1. The decision (data-confirmed)

**Generation = Anthropic Claude Sonnet 4.6 via the Message Batches API.** Empirical bake-off
on the 5 richest real stories (4×8-AC + 1×7-AC, the dense cases where coverage struggled),
fixed coverage strip:

| Strategy | Cov% (8+) | Complete% | Cov% (6-7) | Notes |
|---|---|---|---|---|
| Haiku single (2400t, sync) | 78.3% | 37.5% | 71% | the old locked design |
| Haiku reactive (2400t + targeted completion) | 95.4% | 75% | 86% | sync, <25s, more orchestration |
| **Sonnet single (6000t, batch)** | **98.5%** | **87.5%** | **100%** | **chosen** |

**Why Sonnet + batch wins:** best coverage + completeness (the BA/PO "no-doubt" bar);
max quality (Sonnet reasoning, longest assertions); **simpler architecture** — reuses the
proven `submitBreakdownBatch`/`pollBatchStatus`/`fetchBatchResults` lifecycle, **no
chunked-sync-session, no reactive sub-chunk**; consistent with the breakdown (both
Sonnet+batch); batch is ~50% cheaper than sync.

**Tradeoffs (accepted):** async latency 2-10 min (the breakdown already does this; the
user can leave/reconnect); Sonnet under-populates discrete `test_data` (tuned via a prompt
nudge — see §4); the ~1.5% residual gap = non-behavioral compliance ACs (handled honestly,
never silent — see §4).

**Key correction (folds into Forge gotcha #5):** "Sonnet ~54s blows the 25s limit" was true
for the *sync* transport. The **Batches API is async** — the 25s resolver limit binds ONLY
on the POLL resolver (the fetch+parse of the already-completed JSONL), NOT on Sonnet's
generation time. So `max_tokens` can be generous (6000) without any timeout risk.

---

## 2. Architecture — the test-case batch lifecycle

```
Review screen → "Generate test cases for all stories"
   │  startTestCaseGeneration({ jobId })
   │    resolve key + quota · extract stories from job.breakdown.features
   │    submit ONE batch of N requests (one per Story, custom_id = story index)
   │    write tcjob:<jobId> {batchId, keySource, status:'batched', stampedStories}
   ▼
POLL  (UI loops, like the breakdown's generating screen)
   │  pollTestCaseStatus({ jobId })  — poll the batch; in_progress → progress%
   │    on 'ended': fetch JSONL → per-story parse + computeCoverage →
   │               Promise.all KVS writes testcases:<jobId>:<idx> → status:'completed'
   ▼
Test Cases screen  (getTestCases({ jobId }) — standalone read, reconnect-safe)
   │  per-story: cases + coverage badge (covered / uncovered / non-behavioral-flagged)
   │  per-Story REGENERATE (1-request Sonnet batch, "~2 min" UX)
   ▼
PUSH embed (P4)
```

**One batch, N requests** (custom_id = story array index — the authoritative identity; no
name-collision risk; the parse overwrites `story_name` from the real story anyway). Anthropic
Batches supports 100K requests / 256MB — N (≤~50 stories) is trivially within bounds.
**No reactive sub-chunk** — Sonnet at 6000t covers ~98% in one shot; the residual is an
honest flagged case (§4), not a silent gap.

---

## 3. Backend surface (clone-points)

| New | Clone from | File |
|---|---|---|
| `TC_MAX_OUTPUT_TOKENS = 16000` (8000→16000 for the §10 §7-feed; per-story output is 15-case-ceiling-bound, not spec-size-bound) | — | anthropic_client.js |
| `submitTestCaseBatch({stories, sharedAcceptanceCriteria, specSummary, apiKey})` → `{batchId}` | `submitBreakdownBatch` (~318-421) | anthropic_client.js |
| `pollTestCaseBatch` = alias of `pollBatchStatus` (same endpoint/shape) | `pollBatchStatus` (~430-463) | anthropic_client.js |
| `fetchTestCaseResults(resultsUrl, stampedStories, apiKey)` → `{perStory:[{storyIdx,result,coverage,error?}]}` (scan ALL N JSONL rows, sort by idx) | `fetchBatchResults` (~474-588) | anthropic_client.js |
| `parseTestCaseResult(raw, story)` → `{result, coverage}` (defensive parse: cap ≤15, drop empty when/then, repair empty ac_trace→inferred, clamp confidence, normalize priority enum, sanitize test_data, OVERWRITE story_name) | §4-cap logic of `fetchBatchResults` | **testcases.js** (with `computeCoverage`) |
| `startTestCaseGeneration({jobId})` | `startGeneration` (~968-1188, trimmed) | index.js |
| `pollTestCaseStatus({jobId})` | `pollJobStatus` (~1196-1365) | index.js |
| `getTestCases({jobId})` → `{perStory, total, completedAt, breakdownPageVersion, failedCount}` (Promise.all over N keys; `story:{name,acceptance_criteria,_uid}` on each entry) | `getResults` (~1371-1397) | index.js |
| `regenerateTestCase({jobId, storyIdx, breakdown})` → `{storyIdx, result, coverage, story:{name,acceptance_criteria,_uid}}` (1-request Sonnet batch; persists the edited breakdown skip-if-unchanged, then targets the story by stable `_uid`→name→idx; `pollRegenerateTestCase` syncs the bulk tcjob's stamped story + returns the edited `story` so the per-story staleness clears) | `submitTestCaseBatch` with `[story]` | index.js |

### KVS shapes (no TTL — match the breakdown job, for reconnect durability)
- `tcjob:<jobId>` — control: `{jobId, batchId, keySource, total, status('pending'|'batched'|'completed'|'failed'), stampedStories:[{idx,_uid,name,acceptance_criteria}], pageVersion, error?, createdAt, completedAt}`. stampedStories is LEAN ({idx,name,acceptance_criteria} only — no storyObj); ~1-2KB/story → ~40-80KB at 39 stories, well under 240KB (#10). **Never merge test-case payloads here** (240KB guard).
- `testcases:<jobId>:<idx>` — per-story: `{storyIdx, storyName, result, coverage, error?}`. Per-story keys (size + duplicate-name safety). ~2-4KB each, well under 240KB.

---

## 4. Prompt reconciliation for Sonnet (P1 tweaks — `TEST_CASE_SYSTEM_PROMPT`, schema unchanged)

Three changes, all Bug-Y-clean (abstract, no corpus enumeration), HIGH confidence:

1. **max_tokens 8000 + ceiling 15 (raised from 6000/12 in the deep-audit polish).** At
   tok/c ~280, 6000 already fit ~21 cases and achieved 100% coverage + completeness on the
   validated dense stories — it was never the binding constraint. 8000 is free worst-case
   margin (batch async removes the 25s cost; the reactive sub-chunk was dropped, so this cap
   IS the monster-story safety net). Ceiling 15 (from 12) preserves the distinct depth cases
   Sonnet generates on rich stories (the bake-off CDS story wanted 14-15); the MERGE RULE +
   expected_result-uniqueness remain the anti-padding controls.
2. **test_data nudge** (APPLIED) — Sonnet embeds boundary values in Given prose (21% discrete
   `test_data` vs Haiku 41%). The nudge: a value mentioned in a Given is NOT a reason to
   withhold it — surface the exact pass/fail-deciding value as a discrete `test_data` entry
   too, so TestRail/Xray/Zephyr + Gherkin Examples consume it without parsing prose.
3. **NON-BEHAVIORAL ACs** (APPLIED) — the residual gap = policy/retention/residency/infra ACs
   that clause (a) of the decisive test genuinely cannot run. The prompt now forbids BOTH
   silent-skip (hidden gap) AND a fake runtime test (naïve), and instead emits ONE honestly-
   flagged case: traces the AC verbatim (→ coverage accounts for it), `expected_result` is a
   config/audit-CHECKABLE fact (falsifiable by review, not "works correctly"), `⚠` + an
   `[ASSUMPTION|medium]` concern naming it a review-verified requirement. Loophole-guarded:
   "ONLY when clause (a) genuinely cannot be met." → converts the silent miss into an
   auditable signal; coverage reaches ~100% honestly (every AC accounted-for, non-runtime
   ones unmistakably flagged).

**Breadth-first ordering + the ≤15 ceiling — keep** (coverage-safety + precision, not timing
artifacts). max_tokens is now 8000 (raised from 6000) — batch async removes the 25s risk;
the extra headroom covers rich/monster stories without any timeout cost. **Schema needs NO
change** (concern + ac_trace kind='story-ac' + expected_result already carry the non-behavioral path).

**Re-validation (DONE 2026-06-06):** `bakeoff_harness --strategies S4` on the 5 dense real
stories with the tweaked prompt + the 8000/ceiling-15 config. RESULT: **100% AC coverage +
100% complete on every run** (the non-behavioral flagged cases closed the residual gap);
`test_data` presence 21%→47% on dense stories (honest — compliance cases correctly omit it);
0 truncation at 8000t; the tail (cases 12-16) spot-checked DISTINCT (not padding). Ceiling-15
is DATA-JUSTIFIED: a 16-case story lost 1 AC at cap-12 (88%) but holds 100% at cap-15;
`parseTestCaseResult` partitions AC-covering cases before the cap (cost-asymmetry). ~$5 of
validation across the model/architecture/config decisions.

---

## 5. Pitfalls + adopted mitigations (3-agent adversarial pass)

| # | Sev | Silent-miss / failure | Mitigation (adopted) |
|---|---|---|---|
| 1 | HIGH | Test cases invisible on reconnect (`getResults` reloads breakdown only) | **DONE** — `getResults` + `getGenerationStatus` now return `tcStatus` (stamped from tcjob); P4/P5 call `getTestCases` on mount + rehydrate before render. `getTestCases` is standalone (no live poll needed). |
| 2 | HIGH | Double-submit burns 2× cost | `tcjob:<jobId>` idempotency guard: if exists+batched/completed, return existing batchId — never re-submit. |
| 3 | HIGH | Mixed-batch partial failure drops stories silently | `fetchTestCaseResults` scans ALL N rows; non-`succeeded` rows store an explicit `{error}` sentinel at `testcases:<jobId>:<idx>` + a `failedStories[]`; screen renders "failed — regenerate", never blank. |
| 4 | HIGH | N sequential KVS writes / large-JSONL fetch+parse blow the 25s poll resolver | `Promise.all` the per-story writes (never a sequential loop). ⚠ The §10 raise to `max_tokens 16000` DOUBLED the worst-case JSONL size → the safe story-count dropped from ~50 toward ~25-30 at the all-cap pathological case. Realistic risk stays LOW (the 15-case ceiling caps REAL per-story output ~8-10K, not 16K → a 39-story dense spec ≈ ~1MB JSONL << 25s). FOLLOW-UP for 50+ dense-story specs: chunk the fetch/parse/store across poll cycles (cursor on tcjob), do NOT raise N×ceiling unbounded. |
| 5 | HIGH | Managed key vanish between submit & fetch → wrong key | Stamp `keySource` on `tcjob`; re-resolve via `anthropicKeyForSource(keySource)` at poll/fetch (batch is bound to its creating key); generalized null-key soft-fail guard covers BOTH managed AND BYOK (a transiently-removed BYOK key now recovers). Never store key bytes. |
| 6 | MED | Uncovered ACs invisible in UI | Store `coverage` alongside `result`; P5 renders a per-story `N/M covered` badge + the `uncovered_acs` list + regenerate. |
| 7 | MED | Editor edit between submit & fetch mis-routes index→story | Stamp the LEAN story list `{idx,name,acceptance_criteria}` on `tcjob` at submit; bind results to the STAMPED list; P5 reconciles (deleted → discard, added → "not generated"). `getTestCases` exposes `story:{name,acceptance_criteria}` on each entry so P4 renderers have the story without re-joining the breakdown. |
| 8 | MED | Managed Sonnet batch unmetered → cost leak | **Phase 2 OPEN:** BYOK (launch) = customer's key, unmetered is correct. Managed metering decision deferred — consuming on success is the loss-safe default until Phase 2 settles the cap design. |
| 9 | MED | Single-story regenerate = 2-10 min batch wait | Regenerate = a 1-request Sonnet batch (quality-CONSISTENT with the bulk; "~2 min" UX, consistent with the breakdown's regenerate). Sonnet-sync rejected (one story ~38s blows 25s); Haiku-sync rejected (quality inconsistency vs the Sonnet bulk). |
| 10 | MED | Results merged into `job` → 240KB breach | Keep results in `testcases:<jobId>:<idx>` keys only; `tcjob` holds LEAN control + stampedStories {idx,name,acceptance_criteria}, ~1-2KB/story → ~40-80KB at 39 stories, well under 240KB. |
| 11 | LOW | All-errored batch → N individual "failed" buttons | `getTestCases` now returns `failedCount`. If `failedCount ≈ total`, P5 shows ONE "generation failed — retry all", not per-story. |
| 12 | LOW | False-uncovered on Sonnet verbatim variations | Re-validate `normAC` against Sonnet output (in the running re-validation); add any new normalization patterns found. |

---

## 6. Status — CODE-COMPLETE (P1–P5); live-validation pending (P6 + Task #7)

Every phase: built → §13 gate (code-review + audit) → 4-lens deep audit → fix → commit. ~$5 validation.

- ✅ **P1 — prompt/schema** (Sonnet config): test_data nudge + non-behavioral-AC honest exception;
  max_tokens 8000 + ceiling 15 + AC-covering partition before the cap. §4 re-validation DONE (100%).
  Commits `e90d318`/`4459d2a`.
- ✅ **P2 — renderers + coverage strip** (`renderGherkin`/`renderManualTable`/`computeCoverage` +
  the `normAC` real-spec fix). Commit `33aaede`.
- ✅ **P3 — backend** (Sonnet + Batches API): the §3 surface + all §5 mitigations + the 4-lens polish.
  Commit `108ac84`.
- ✅ **P4 — push embed + reconnect** (see §7): compact-summary embed; the AC-hash staleness
  fingerprint; reconnect rehydration; purgeJob cleanup. Commit `01a32d4`.
- ✅ **P5 — Test Cases screen** (see §8): generate/view/regenerate/export; the uncovered/stale-AC
  rendering (trust); `getTestCaseExports`. Commit `e22bee0`.
- ✅ **Push-embed Story-attachment FIX + human-in-the-loop EDITING** (see §7 revised + §9): content-match
  each Story to its cases by AC-hash (the live-smoke "only the first story embedded" fix + a collision
  guard) AND the editable Test Cases screen (`saveTestCases` + `AcTraceEditor` + `EditableCaseRow` +
  dirty-guards). §13 conductor design army + a 4-lens deep adversarial audit (which caught the
  hash-collision mis-embed + the edit-during-regen shadow/clobber). Commit `90cba80`.
- ⭐ **Regression verdict (P5 deep-audit integration lens):** the core breakdown → review → push E2E
  is INTACT — a push with NO test cases is BYTE-IDENTICAL to pre-P4; reconnect / state-machine /
  purgeJob all fail-soft. P4/P5's shared-path changes did not break the shipped flow.
- ⏭ **P6 — §13 gate ✅ + design doc ✅ (this file) → deploy + live E2E smoke remain** (first real run:
  generate via Sonnet batch → view/coverage → EDIT a few cases + Save → export → push → verify the JIRA
  Story summary across ALL stories) · **Task #7 — validate quality on the partner's ~9 real Confluence
  pages** (the pre-ship "sharpen the axe" gate). No manifest change (resolvers are `resolver.define`
  within the single function; egress + scopes unchanged → deploy-safe).
- 🚩 **Partner flag:** §5 #8 — Managed quota accounting (defer to editions Phase 2).

### Directive verdicts (2026-06-06)

- **Directive #3 (adaptive sub-chunk): CLOSED.** Sonnet single-call covers 100% on validated dense stories; the 8000-token cap is the worst-case margin. `coverageType` param reserved in `buildTestCaseUserPrompt` if ever needed.
- **Directive #4 (Epic context): VERDICT — NOT added.** `category` (cluster) + `metadata.spec_summary` (provenance) + `shared_acceptance_criteria` (cross-cutting rules) already carry the umbrella context for per-story test authoring. `epic.summary` would be largely redundant → not added. Empirical A/B available if a future need appears.

### Deferred (post-MVP hygiene)

- `tcregenjob:<jobId>:<storyIdx>` cleanup after completion (currently lingers; low-urgency).
- Multi-request batch caching across regen calls is cost-only optimization (not a correctness gap).
- A `tcJob.expiresAt` check in poll for a friendlier expiry message (currently falls through to Anthropic's raw error).
- Regen progress is binary (batched → completed); P5 renders it as indeterminate (acceptable for ~2 min wait).
- (P5) Export is a lazy resolver round-trip per click (~300ms); pre-render on mount is a later optimization (CRA can't import `../../../src` → no clean frontend render path).
- (P5) "Copy All" silently skips failed stories (the SummaryBar shows the failed count above it); a per-button count is a nicety.

---

## 7. P4 — JIRA push embed (compact summary) + reconnect

- **Embed = a COMPACT summary (partner decision), NOT the full cases.** Each Story description gets a
  `renderTestCasesAdf(result, coverage)` block: a heading + 3 paragraphs — "{N} cases · {M}/{T} ACs
  covered", the type breakdown + flagged count, and a pointer to the screen/export. ONLY
  heading/paragraph/text ADF nodes. The deep audit flagged the original full 7-paragraph-per-bullet
  rendering as an UNPROVEN ADF structure (whole-chunk-fail risk, gotcha #11) AND as noise that buries
  the story; the summary de-risks AND de-noises. The full cases live in the export + the P5 screen
  (the BA's primary artifact).
- **⭐ Push integration — content-match, NOT position (live-smoke fix 2026-06-06):** `jobId` →
  `startPush` → session carries `tcHashToIdx` (AC-content-hash → generation storyIdx) + `tcTotal`. For
  each pushed feature, `stepStories` looks up `tcHashToIdx[acSetHash(feature.acceptance_criteria)]` →
  fetches `testcases:<jobId>:<idx>` → appends the summary. The push order (`flattenBreakdown` —
  capability-grouped from the EDITED breakdown) diverges from the generation order (flat `features[]`),
  so the original POSITION-keying (`testcases:<jobId>:<start+j>`) embedded only the coincidentally-first
  Story — the bug the partner hit. Binding by AC-CONTENT makes each feature find ITS cases regardless of
  reorder, and the hash lookup IS the staleness check (a feature whose ACs were edited post-generation
  matches no entry → no embed, never a mis-attribution). Embed wrapped in try/catch (fail-open); no test
  cases → BYTE-IDENTICAL to pre-P4.
- **⭐ Collision guard + counts (deep-audit 2026-06-06):** `tcHashToIdx` is built with a collision guard
  — two stories with an identical AC set (incl. multiple no-AC stories, which all hash the empty set)
  would collapse to one idx (last-writer-wins) and embed the WRONG cases; an ambiguous hash is DROPPED →
  those features read as honest `tc_skipped`, never a wrong embed. A SINGLE no-AC story keeps its unique
  (empty-set) hash → still embeds (no regression). `tc_embedded` (gated on `test_cases.length>0`) /
  `tc_skipped` (`= max(0, tcTotal − tc_embedded)`) surface on the PushedScreen (a skip is visible, never
  silent). The real long-term fix is a stable `story_uid` minted at generation.
- **Reconnect:** `getResults`/`getGenerationStatus` return `tcStatus`; App.js rehydrates + resumes the
  poll. `purgeJob` deletes `tcjob` + `testcases:*` after push (fail-soft; no-tcjob → no-op).

## 8. P5 — the Test Cases screen

- **Flow:** Review → "Test Cases" → (generate → poll → display) → "Continue to Push". OPTIONAL /
  skippable (never-open → push unchanged). New screen states `testcases`/`generatingTests` clone the
  breakdown's submit→poll→display (reconnect-able, "you can leave" copy).
- **Display:** a `<details>` accordion — failed + partial-coverage stories open by default; internal
  open-state (the controlled `open` prop snapped back on re-render, fighting the user — fixed). Per
  story: a coverage badge + ⭐ the **`uncovered_acs` + `stale_refs` lists** (the trust signal — a
  number without the named gaps is not honest for the BA), the cases (type/priority/Given-When-Then/
  expected/test_data/concern/ac_trace), a SummaryBar coverage rollup ("{N} fully covered · {M} partial
  · {K} no-ACs · {W} failed").
- **Regenerate:** per-story (1-request Sonnet batch, delta-patch) with a TWO-STEP inline confirm
  (window.confirm may be blocked in the Forge sandbox iframe) + a retry-all-failed button.
- **Export (the primary artifact):** `getTestCaseExports({jobId, storyIdx?, format})` renders via the
  single-source `testcases.js` (CRA cannot import `../../../src`); per-story + all-stories; Gherkin +
  CSV; clipboard primary + data-URI download (Forge blocks `blob:`); discriminated feedback
  (✓ Copied / ✓ Downloaded / "Copy failed") — never a silent no-op on the BA's key action.

## 9. Human-in-the-loop test-case EDITING (2026-06-06)

The Test Cases screen is read-no-more — each story's cases are **editable like the BreakdownEditor**
(the partner's named reference), so a BA refines the expert DRAFT before export/push. Designed via the
§13 conductor model (3-lens design army → verdict synthesis) and gated by a 4-lens deep adversarial audit.

- **⭐ The persistence model (load-bearing decision).** Unlike the breakdown (which travels in the push
  payload → in-memory edits suffice), test cases are RE-READ from KVS by BOTH the export
  (`getTestCaseExports`) and the push embed (`stepStories`). So an edit reaches export/push ONLY if
  persisted back to `testcases:<jobId>:<idx>`. ⇒ an explicit per-story **Save** — the ONE deliberate
  divergence from the no-save BreakdownEditor — which keeps ONE source of truth for bounds (the canonical
  `parseTestCaseResult` + `computeCoverage`) and one persistence path shared by bulk/regen/edit/export/push.
  (The spec-fidelity audit lens challenged this hard and BLESSED it: threading edits through the payload
  would still need the server-side re-parse + coverage recompute, so the Save button is the higher-value choice.)
- **`saveTestCases({jobId, storyIdx, result})` resolver.** Guard chain (no_job_id / bad_story_idx /
  invalid_result / license / not_found / not_ready / story_out_of_range / regen_in_progress) → re-sanitize
  the user-edited result through `parseTestCaseResult` (user input is LESS trusted than model JSON — the
  parser owns every bound: drop empty when/then, repair ac_trace→inferred, priority whitelist, test_data
  cap, cap-15 AC-covering partition) → recompute coverage against the **STAMPED ACs** (the same oracle the
  embed-hash + generation use, NOT the live breakdown) → REJECT an empty result (would silently erase the
  story's export + embed) → write EXACTLY ONE key (tcjob's stamped ACs stay IMMUTABLE = embed key +
  coverage oracle) → return `{ok, result, coverage}`. Pure KVS op (no Anthropic call → no keySource).
  Editing CASES never touches ACs → the embed AC-hash is unchanged → push reads the edited entry for free
  (no push_handler change needed for editing).
- **⭐ Coverage-safe `ac_trace` editing (the trust pillar).** Coverage is the BA's #1 signal, derived
  from `ac_trace.ac_text` matched VERBATIM vs the story ACs — so ac_trace is NEVER free-text. The
  `AcTraceEditor` is an **AC-checklist**: ticking a story AC writes `{kind:'story-ac', ac_text:<verbatim
  AC>}`, so the stored text is always verbatim-equal to a live AC → coverage stays trustworthy BY
  CONSTRUCTION (no free-text drift — the exact failure this feature must prevent). Plus an inferred toggle
  (mutually exclusive) + shared-ac chips (display+remove) + stale-ref cleanup. The badge shows the
  last-SAVED (authoritative) coverage; the recompute is server-side on Save — no duplicated coverage logic
  in the frontend (the frontend `normForMatch` is a display-only port of `normAC` and can never mis-check
  toward green, since the stored text is verbatim).
- **State architecture + dirty discipline.** Edit drafts live in `TestCasesScreen` (`drafts[storyIdx]`),
  ABOVE the memoized `StoryTestCaseCard`, so a card re-render / accordion collapse never drops in-progress
  edits. `App.handleSaveTestCase` delta-patches `testCaseResults.perStory[idx]` from the SAVED + sanitized
  result/coverage (mirrors the regenerate delta-patch). **Pessimistic, fail-loud:** a failed save KEEPS the
  buffer + dirty state (never a silent "saved"); only `{ok}` clears the draft. Dirty guards (all two-step,
  no `window.confirm` — Forge iframe): Regenerate-when-dirty ("Discard edits & regenerate?" + clears the
  draft so it can't shadow the regen), Back-to-Review + Continue-to-Push ("⚠ N unsaved"), Copy/Export
  disabled-or-warned when dirty (export reads SAVED KVS). Save↔Regenerate mutual exclusion (last-writer KVS
  race) + a `regen_in_progress` backend backstop; **editing is PAUSED while a regen poll is in flight**.
- **New components.** `AcTraceEditor.jsx` (coverage-safe checklist), `EditableCaseRow.jsx` (editable case —
  reuses the breakdown's `EditableField` + a FeatureCard-style `+Add`/hover-✕ StringListEditor + native
  `<select>` for type/priority + two-step delete). `StoryTestCaseCard` swaps read-only CaseRow →
  EditableCaseRow + the Save bar; `TestCasesScreen` owns the drafts + the guards.

**4-lens deep audit — caught what the per-change §13 gate missed:**

| Lens | Finding | Sev | Fix |
|---|---|---|---|
| Correctness | hash-collision mis-embed (multiple no-AC / identical-AC stories → WRONG cases on a Story) | HIGH | collision guard drops ambiguous hashes → honest `tc_skipped` (§7) |
| Silent-failure | edit-during-regen-poll: a new draft shadows the regenerated cases + a later Save clobbers them | MED | editing paused while `isPolling` |
| Backend-security | guard chain complete · coverage vs stamped ACs · tcjob immutable · empty-result reject | — | SHIP (clean) |
| Spec-fidelity | both asks delivered; AC-hash join-key + Save-button are the RIGHT engineering, not gold-plating | — | blessed |

Folded the same pass: `AcTraceEditor` shared-ac symmetry guard, `acSetHash` djb2-readability parens.

**Deferred (post-MVP, honest):** restore-original-cases-after-save undo (Revert covers UNSAVED edits;
post-save undo needs regenerate) · "Copy All" omits the failed-story count · `tc_embedded` over-counts on a
story-create failure (cosmetic, success-screen only) · array-index list keys · a friendlier KVS-oversize
message · a post-save "N cases dropped" toast (the pre-save inline warning + the empty-result reject already
cover the silent-drop). A stable `story_uid` at generation would retire the AC-hash collision residual.

Commit `90cba80`.

## 10. §7-aware test generation — the §8 informational-completeness fix (2026-06-06)

A 4-lens EVALUATION of a real output (FlexiCash loan spec) found two weaknesses with ONE root cause:
per-Story test-gen was STARVED of the spec's §7 business rules — it saw only the Story's ACs, which
reference rules by ID ("BR-101..BR-109") WITHOUT the concrete numbers + the decision matrix in the spec
body. So tests asserted NO concrete eligibility thresholds and only ~4 of a 15-cell decision matrix. A §8
(informational-completeness) gap — a starved call.

**Fix (test-gen-only; the LOCKED breakdown generation is untouched):**
- **Snapshot** the source page at breakdown generation → sibling KVS key `pagesnap:<jobId>`
  (`resolveSpecSourceText` reads it at test-gen, version-checked, fail-soft). Coherent-by-construction
  with the stamped ACs (same execution/pageVersion). **Byte-capped ~180KB** (a char cap overflows the
  ~240KB KVS limit on Cyrillic/CJK — binary-search byte-trim). **Deleted by `purgeJob`** (it IS page
  content — the privacy-critical item).
- **Feed** it as a SHARED ephemeral-cached "SOURCE SPECIFICATION" system block in `submitTestCaseBatch`
  (paid ~once across the N batch requests — 1 cache-write + N-1 reads). Both call-sites (bulk +
  regenerate). Backward-compat: no snapshot → identical to prior behaviour.
- **Prompt** (`buildSpecSourceSystemText` + RULE 6 + LESSON D — Bug-Y-clean/domain-free; the domain
  content rides the DATA block): assert each threshold at/just-inside/just-outside its literal value;
  one case per reachable decision-table cell with its exact outcome; scope-fence binds; rule-derived
  cases trace kind='inferred' + a concern naming the rule. Breadth-first ladder ranks rule-cells
  alongside ACs (before depth); cap-overflow surfaces a loud `[RISK]` concern.
- **`max_tokens` 8000 → 16000** (per-story output is 15-case-ceiling-bound, not spec-size-bound; 16K
  covers the densest single story; CEILING not target → free for normal stories; timing-safe on async
  Batches — see §5 #4 for the >50-dense-story poll-scale follow-up).

**Empirically validated** (Sonnet, 3 runs, A/B WITH vs WITHOUT, real FlexiCash, `prototype/validate_spec_source.js`):
decision matrix **~4/15 → 12-15/15** cells (every present cell asserts the CORRECT BR-402 outcome);
eligibility literals **0/8 → 7-8/8** at boundaries (18/17, 70/71, 75/76, €1,200/€1,199…); **ZERO
regression** of the validated affordability/pricing boundary cases; scope-fence held; no truncation at
16K; cache-read confirmed. Quality ~6.5 → ~8.5. Commit `7614772` (+ deep-audit fixes).

**§13-gated + 4-lens deep audit:** Bug-Y PASS (prompt domain-free, independently re-verified). Fixed the
snapshot char-cap KVS-overflow (→ byte-cap) and `purgeJob` not deleting `pagesnap` (privacy).

**Deferred follow-ups (ranked):** (1) **breakdown-side BR-ID→value resolution** — the eval found the
BREAKDOWN's ACs are ID-only too; a Bug-Y-clean Rule-5 sharpening ("inline an ID-referenced rule's deciding
value when the spec body defines it") would lift breakdown fidelity, but touches the LOCKED generation →
own §13 gate. (2) **Pricing/Affordability A/B** — only Decisioning + Eligibility got the A/B; confirm the
§7 feed lifts multi-lever BR-505/BR-507 + compound BR-204 during pre-ship Task #7. (3) **chunked poll**
for 50+ dense-story specs (§5 #4). (4) **regenerate §7 cache cost** (~$0.06/regen; BYOK-acceptable; flag
for Managed metering at editions Phase 2). (5) a **rule_coverage signal** (not a BR-regex — Bug-Y; e.g.
surface inferred-cell count beside coverage_pct) so "100% AC coverage" stops slightly over-signalling.
