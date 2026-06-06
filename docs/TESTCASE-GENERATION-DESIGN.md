# Test-Case Generation — Design (Sonnet frontier + Batches API)

> The synthesized, verdict-orchestrated design for the per-Story test-case feature,
> after the **Sonnet + Batches** pivot (data-confirmed). Branch `feature/product-improvements`.
> Source-of-truth for the P3 backend build. Supersedes the earlier Haiku-sync-chunked +
> reactive-sub-chunk plan (that design's parse/key-source/reconnect/KVS *concepts* carry
> over; the *call structure* becomes a batch).

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
| `TC_MAX_OUTPUT_TOKENS = 8000` | — | anthropic_client.js |
| `submitTestCaseBatch({stories, sharedAcceptanceCriteria, specSummary, apiKey})` → `{batchId}` | `submitBreakdownBatch` (~318-421) | anthropic_client.js |
| `pollTestCaseBatch` = alias of `pollBatchStatus` (same endpoint/shape) | `pollBatchStatus` (~430-463) | anthropic_client.js |
| `fetchTestCaseResults(resultsUrl, stampedStories, apiKey)` → `{perStory:[{storyIdx,result,coverage,error?}]}` (scan ALL N JSONL rows, sort by idx) | `fetchBatchResults` (~474-588) | anthropic_client.js |
| `parseTestCaseResult(raw, story)` → `{result, coverage}` (defensive parse: cap ≤15, drop empty when/then, repair empty ac_trace→inferred, clamp confidence, normalize priority enum, sanitize test_data, OVERWRITE story_name) | §4-cap logic of `fetchBatchResults` | **testcases.js** (with `computeCoverage`) |
| `startTestCaseGeneration({jobId})` | `startGeneration` (~968-1188, trimmed) | index.js |
| `pollTestCaseStatus({jobId})` | `pollJobStatus` (~1196-1365) | index.js |
| `getTestCases({jobId})` → `{perStory, total, completedAt, breakdownPageVersion, failedCount}` (Promise.all over N keys; `story:{name,acceptance_criteria}` on each entry) | `getResults` (~1371-1397) | index.js |
| `regenerateTestCase({jobId, storyIdx})` → `{storyIdx, result, coverage}` (1-request Sonnet batch) | `submitTestCaseBatch` with `[story]` | index.js |

### KVS shapes (no TTL — match the breakdown job, for reconnect durability)
- `tcjob:<jobId>` — control: `{jobId, batchId, keySource, total, status('pending'|'batched'|'completed'|'failed'), stampedStories:[{idx,name,acceptance_criteria}], pageVersion, error?, createdAt, completedAt}`. stampedStories is LEAN ({idx,name,acceptance_criteria} only — no storyObj); ~1-2KB/story → ~40-80KB at 39 stories, well under 240KB (#10). **Never merge test-case payloads here** (240KB guard).
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

**Re-validation (running):** `bakeoff_harness --strategies S4 --max-stories 5 --runs 3` on the
dense real stories with the tweaked prompt. Gates: coverage holds ≥98% (toward 100% via the
flagged non-behavioral cases); `test_data` presence rises from 21%; **no over-use** of the
non-behavioral escape (spot-check); no false-uncovered regression from `normAC`.

---

## 5. Pitfalls + adopted mitigations (3-agent adversarial pass)

| # | Sev | Silent-miss / failure | Mitigation (adopted) |
|---|---|---|---|
| 1 | HIGH | Test cases invisible on reconnect (`getResults` reloads breakdown only) | **DONE** — `getResults` + `getGenerationStatus` now return `tcStatus` (stamped from tcjob); P4/P5 call `getTestCases` on mount + rehydrate before render. `getTestCases` is standalone (no live poll needed). |
| 2 | HIGH | Double-submit burns 2× cost | `tcjob:<jobId>` idempotency guard: if exists+batched/completed, return existing batchId — never re-submit. |
| 3 | HIGH | Mixed-batch partial failure drops stories silently | `fetchTestCaseResults` scans ALL N rows; non-`succeeded` rows store an explicit `{error}` sentinel at `testcases:<jobId>:<idx>` + a `failedStories[]`; screen renders "failed — regenerate", never blank. |
| 4 | HIGH | N sequential KVS writes blow the 25s poll resolver | `Promise.all` the per-story writes (never a sequential loop). Safe for ≤~50 stories (real range; 39-feature stress max). NOTE: chunk the fetch+store into a stepping loop only if a future spec exceeds ~50 stories. |
| 5 | HIGH | Managed key vanish between submit & fetch → wrong key | Stamp `keySource` on `tcjob`; re-resolve via `anthropicKeyForSource(keySource)` at poll/fetch (batch is bound to its creating key); generalized null-key soft-fail guard covers BOTH managed AND BYOK (a transiently-removed BYOK key now recovers). Never store key bytes. |
| 6 | MED | Uncovered ACs invisible in UI | Store `coverage` alongside `result`; P5 renders a per-story `N/M covered` badge + the `uncovered_acs` list + regenerate. |
| 7 | MED | Editor edit between submit & fetch mis-routes index→story | Stamp the LEAN story list `{idx,name,acceptance_criteria}` on `tcjob` at submit; bind results to the STAMPED list; P5 reconciles (deleted → discard, added → "not generated"). `getTestCases` exposes `story:{name,acceptance_criteria}` on each entry so P4 renderers have the story without re-joining the breakdown. |
| 8 | MED | Managed Sonnet batch unmetered → cost leak | **Phase 2 OPEN:** BYOK (launch) = customer's key, unmetered is correct. Managed metering decision deferred — consuming on success is the loss-safe default until Phase 2 settles the cap design. |
| 9 | MED | Single-story regenerate = 2-10 min batch wait | Regenerate = a 1-request Sonnet batch (quality-CONSISTENT with the bulk; "~2 min" UX, consistent with the breakdown's regenerate). Sonnet-sync rejected (one story ~38s blows 25s); Haiku-sync rejected (quality inconsistency vs the Sonnet bulk). |
| 10 | MED | Results merged into `job` → 240KB breach | Keep results in `testcases:<jobId>:<idx>` keys only; `tcjob` holds LEAN control + stampedStories {idx,name,acceptance_criteria}, ~1-2KB/story → ~40-80KB at 39 stories, well under 240KB. |
| 11 | LOW | All-errored batch → N individual "failed" buttons | `getTestCases` now returns `failedCount`. If `failedCount ≈ total`, P5 shows ONE "generation failed — retry all", not per-story. |
| 12 | LOW | False-uncovered on Sonnet verbatim variations | Re-validate `normAC` against Sonnet output (in the running re-validation); add any new normalization patterns found. |

---

## 6. Status

- ✅ **Model + architecture LOCKED** (Sonnet + batch), data-confirmed.
- ✅ **P1 prompt tweaks APPLIED** (test_data nudge + non-behavioral ACs) — re-validation running.
- ✅ **P2** (renderers + coverage strip + `normAC` real-spec fix) — unchanged, carries over.
- ✅ **P3 build** — §3 surface shipped (batch lifecycle + resolvers + `parseTestCaseResult`), all §5 mitigations wired. 4-lens audit polish applied 2026-06-06: lean stamp (#10), tcStatus on reconnect (#1), pageVersion on tcjob (#3-derived), `story` + `failedCount` in `getTestCases` (#7/#11), max_tokens 8000 + ceiling 15 (#4), generalized null-key soft-fail (#5), quota comment clarified (#8).
- ⏭ **P4** — push embed + reconnect rehydration (HIGH pitfall: `getResults` now returns `tcStatus`; P4 uses it to skip an extra round-trip). P5 (screen), P6 (§13 gate + deploy), Task #7 (full real-spec validation).
- 🚩 **Partner flag:** §5 #8 — Managed quota accounting (defer to editions Phase 2).

### Directive verdicts (2026-06-06)

- **Directive #3 (adaptive sub-chunk): CLOSED.** Sonnet single-call covers 100% on validated dense stories; the 8000-token cap is the worst-case margin. `coverageType` param reserved in `buildTestCaseUserPrompt` if ever needed.
- **Directive #4 (Epic context): VERDICT — NOT added.** `category` (cluster) + `metadata.spec_summary` (provenance) + `shared_acceptance_criteria` (cross-cutting rules) already carry the umbrella context for per-story test authoring. `epic.summary` would be largely redundant → not added. Empirical A/B available if a future need appears.

### Deferred (post-MVP hygiene)

- `tcregenjob:<jobId>:<storyIdx>` cleanup after completion (currently lingers; low-urgency).
- Multi-request batch caching across regen calls is cost-only optimization (not a correctness gap).
- A `tcJob.expiresAt` check in poll for a friendlier expiry message (currently falls through to Anthropic's raw error).
- Regen progress is binary (batched → completed); P5 renders it as indeterminate (acceptable for ~2 min wait).
