# Impl-Spec — Sprint / Capacity Planning redesign (data-surfacing calibration)

> The shared contract for the 2 engineer agents. Synthesis of the Claude Design mockups
> (`DESIGN-BRIEF-SPRINT-PLANNING.md` is the brief). **Scope: calibration — KEEP the 4-or-5-step
> wizard IA, both methodologies, plan-first, two-path re-run, the honesty framing.** Surface the
> reasoning the planner already computes; restyle to the moodboard. NO new AI call, NO new scope.
> Frontend + ONE tiny backend thread (return the already-persisted rationale).

## SYNTHESIS (locked by the partner from the mockups)
- **Chip "why here" = 1A IN-FLOW** (expand in place, no side rail). Rejected 1B's docked rail
  (Forge horizontal constraint + no side-panel accretion). The "one place to read the plan's logic"
  is delivered by the compact **Plan summary panel** below the columns, NOT a rail.
- **Step 2 Scrum capacity = 2A** (the familiar form + a sticky live read-out sidebar).
- **Step 2 Kanban capacity = 2K** (pooled, per-quarter, reach forecast).
- **Kanban plan = K** (Now/Next/Later + the SAME in-flow "why here" chip).
- **Plan health (step 5) = mockup "5"** with the honesty gaps surfaced.

---

## THE DATA CONTRACT (both agents build to this)
Per-feature keys are the plan-time `_uid` (== `feature_id` in the ranking; == the id in
`plan.sprints[].ids` / `plan.now/next/later[].id`). These are ALL that the chip/panels consume:

1. **`result.rationaleByUid: { [uid]: string }`** — NEW, from the backend (T2). Sparse: only features
   Claude gave a rationale (most features have none). `{}` on a deterministic-fallback plan
   (`record.ranking == null`) — this is the STRUCTURAL absence the honesty firewall relies on.
2. **`plan.signals[uid]: { criticalPathLen, downstreamUnblockCount, slack }`** — EXISTING (T0), already
   returned on `plan`. `downstreamUnblockCount` = leverage ("unblocks N"). `slack` = how much it can
   slip.
3. **`plan.criticalPathUids: string[]`** — NEW, from the backend (T0 after add). The uids on the single
   longest dependency chain → the truthful "On the critical path" membership marker.
4. **`plan.riskByFeature[uid]: { risk_level, has_external_dep, low_confidence, riskScore, ... }`** —
   EXISTING (T0). `riskScore` (0-100) drives the "Risk NN" chip.
5. Everything else already on `plan` (sprints/overflow/oversized/metrics/sprintRiskProfiles/
   specConcernSummary/ranking/graph/skillDiagnostics/bucketMetrics) — EXISTING.

⚠ **Rendering the scheduling chips truthfully + non-redundantly (honesty firewall applies to the
deterministic signals too):** show per chip, each only when present/notable:
- **Unblocks N** — `downstreamUnblockCount > 0`.
- **On the critical path** — `uid ∈ plan.criticalPathUids`.
- **Slack** — show `slack: N` ONLY when `slack > 0` AND the uid is NOT on the critical path (a
  critical-path member has zero slack by definition; do NOT show "On the critical path" and "No slack"
  as if they were two independent facts — that reads as padded/misleading).
- **Risk NN** — `riskScore` when `risk_level` is notable (high/medium) or `has_external_dep`.

---

## AGENT 1 — BACKEND / DATA CONTRACT (files: `src/planner.js`, `src/index.js`, `prototype/test_planner.mjs`)
Small, additive, pure, NO new scope, NO AI call.

### 1. `buildRationaleMap(ranking)` — pure helper (in `src/planner.js`, exported)
- Input: `record.ranking` (the RAW LLM array `[{feature_id, rank, rationale?}]`) OR `null`/`undefined`.
- Output: `{ [feature_id]: rationale }` including ONLY entries whose `rationale` is a non-empty
  trimmed string. `null`/`undefined`/`[]` → `{}`.
- Cap each rationale string defensively (e.g. ≤ 400 chars, trim) to bound the return/KVS size.
- Offline test: sparse input → only rationale-bearing entries; `null` → `{}`; empty-string rationale →
  omitted; long string → capped.

### 2. Thread `rationaleByUid` into EVERY plan-returning resolver (`src/index.js`)
- In each of `finalizePlanJob`, `pollPlanStatus` (completed branch), `getPlan` (completed branch),
  `repackPlan`, `previewWhatIf`, add `rationaleByUid: buildRationaleMap(record.ranking)` to the
  returned object (a SIBLING of `plan`, top-level in the response).
- `record.ranking` is the raw array persisted at `finalizePlanJob`; it survives a free re-pack
  (verify: `repackPlan` keeps `record.ranking`). On a fallback plan it is `null` → `{}`.
- Do NOT change `assemblePlan`'s stripping of `plan.ranking` (that stays the diagnostics object).
- ⚠ Keep it out of the KVS *record* if it's already derivable from `record.ranking` on read — just
  compute it at return time. (No new persisted field; derive-on-read.)

### 3. `criticalPathUids` on the plan (`src/planner.js` `assemblePlan` + `computeSchedulingSignals` area)
- FIRST read `computeSchedulingSignals` to learn the exact `criticalPathLen` / `slack` semantics
  in THIS codebase (do not assume). Then compute the single longest dependency chain deterministically
  (trace from the max-`criticalPathLen` node along blocker edges that step the length down; break ties
  by uid) and return `criticalPathUids: string[]` on the assembled `plan` (both Scrum + Kanban).
- Respect `cutEdges` (exclude a cut soft-cycle edge from the chain trace, mirroring the packer's
  `effectiveBlockers`) so a cycle can't produce a bogus infinite/whole-graph "critical path".
- If — after reading the code — `slack === 0` is already the exact, sufficient membership signal AND a
  separate longest-chain set adds no truth, you MAY skip `criticalPathUids` and document that the FE
  should use `slack === 0`. Decide by the code, document the decision at the top of the resolver diff,
  and tell the conductor which the FE must render.
- Offline test: a known DAG → the expected chain members; a cyclic input → no crash, excludes the cut
  edge; empty → `[]`.

### 4. Report back (for the conductor to relay to the FE agent if it diverges from the default)
State the FINAL contract: the exact shape of `rationaleByUid`, whether `criticalPathUids` was added or
the FE should use `slack === 0`, and any semantic caveat. Do NOT touch PlanScreen.jsx / App.js.

---

## AGENT 2 — FRONTEND (files: `static/hello-world/src/components/PlanScreen.jsx`, `static/hello-world/src/lib/planView.js` if a new shared derivation is needed; may read `result.rationaleByUid` — NO App.js prop change needed since PlanScreen already receives `result={planResult}`)

Read `result.rationaleByUid` (default `{}`), `plan.signals`, `plan.criticalPathUids` (default: derive
"on critical path" from `signals.slack === 0` if the field is absent), `plan.riskByFeature`.

### A. `FeatureChip` — the hero element (1A in-flow). Used in BOTH Scrum `SprintColumn` and Kanban `BacklogBand` rows.
**Collapsed (calm):**
- KEEP: the coloured left-edge **priority tint** (High=red / Medium=orange / Low=neutral), the feature
  **name**, the **story-points**, the existing **risk-corner** icon (whose title lists risk reasons),
  the oversized note.
- ADD, CONDITIONAL (graceful-absent — a clean chip shows NEITHER, reads complete, never a hollow "no
  reason" state):
  - a compact **"unblocks N"** leverage marker — ONLY when `downstreamUnblockCount > 0`.
  - a subtle **"+ why here ›"** affordance — ONLY when `rationaleByUid[uid]` exists. (This is the click
    target; the chip is clickable to expand.)
- Most chips have neither marker and must read exactly as calm as today.

**Expanded in place (on click — NO new panel, NO rail; the chip grows downward inside its column/row):**
- **"CLAUDE'S REASONING"** label + a muted **`display-only · T2`** tag, then the rationale in *italic
  quotes*, ATTRIBUTED to Claude. This is the honesty firewall: never presented as fact.
- **"THE NUMBERS BEHIND IT"** label + a muted **`T0`** tag, then the deterministic signal chips per the
  contract's truthful/non-redundant rule: **Unblocks N** · **On the critical path** · **slack: N** (only
  when not on the critical path) · **Risk NN**. These are the authoritative numbers next to the untrusted
  prose.
- **Fallback / deterministic plan (`rationaleByUid` empty for this uid):** show NO "Claude's reasoning"
  block; instead a muted line **"No Claude reasoning on a deterministic plan. Only the signals below are
  available."** + the T0 signal chips only. (Structural absence — never fabricate a reason.)
- Clicking again collapses. a11y: the expand toggle is a real button with `aria-expanded`; keyboard
  operable; works inside any read-only fieldset context.

### B. Plan summary panel (Scrum only — a compact, collapsible panel BELOW the sprint columns)
- Header: **"Plan summary — the story this plan tells"** + a muted **`T1 · deterministic · same source
  as the copy-out`** tag + a **Hide/Show ▲▾** toggle (default shown).
- Two columns of content, ALL rendered from the SAME `lib/planView.js` derivations the copy-out brief
  uses (`capacityVerdict`, the critical-path line, highest-leverage, "what we cut & why") — **reuse the
  shared helpers; DO NOT re-derive inline** (one source of truth — the on-screen panel and the copied
  brief must never tell two stories):
  - **CAPACITY VERDICT** (`capacityVerdict`) with a status dot.
  - **CRITICAL PATH · N DEEP** — the chain string (e.g. "Delivery Pipeline → REST API → …").
  - **HIGHEST LEVERAGE** — top 3 by `downstreamUnblockCount` (the `planBrief.js:154-157` list) with an
    "↑N unblocks M" style read.
  - **WHAT WE CUT & WHY** — the overflow features + their typed `overflowReasonText`.
- KEEP the three copy buttons: **Copy (Markdown)** · **Copy (plain)** · **Copy allocation (CSV)** with
  the existing `copyPlanText` clipboard→data-URI fallback + "Copied"/"Copy failed" transient state, and
  the "nothing is sent anywhere" caption.
- ⚠ Kanban brief is deferred (v1) → NO Plan summary panel on the Kanban plan. (Kanban keeps its
  existing honesty panel + reach verdict.)
- Scope: this panel is COMPACT and SUBORDINATE to the plan hero — not a dashboard. It + the What-if
  panel are both collapsible so step 4 doesn't accrete.

### C. Plan-health strip (`PlanHealthStrip`) — never silent (both methodologies, on step 4)
- Warning-tinted when there are demoted problems: an amber strip with **"Plan health:"** + pills
  (**"Doesn't fit (N)"**, **"Short on Backend ~X pts"**, **"Risks (N)"** — counts + magnitude, from the
  existing `bucketMetrics` / overflow / risk data) + a **"Review plan health →"** link to step 5.
- Clean: a GREEN affirmation **"No blockers — N features planned across M sprints."** (Kanban: "…in the
  backlog"). Absence of the strip must NEVER be the clean signal — the green affirmation IS the clean
  signal. Keep the existing computation; align the copy + moodboard styling to the mockup.

### D. Step 5 "Plan health" — surface the honesty gaps (all T0, calm, absent-when-clean)
Keep every existing block (deficit callout, "Doesn't fit (N)" overflow list with `overflowReasonText`,
`SkillBottleneck`, `SpecConcernsBand`, `RiskRegister`, Assumptions / Skill detail / Data quality
accordions). ADD / ENHANCE:
- **Reconciliation note** (NEW) — when `plan.ranking.unknownIds.length` or `plan.ranking.omittedCount`
  is non-zero: an info callout **"Claude referenced N feature(s) that don't exist (dropped) and omitted
  M it forgot to rank (appended deterministically at the end). A silent miss made visible — absent when
  the reconciliation is clean."** with a muted `T0 · ranking.unknownIds / omittedCount` tag. Absent when
  both are zero.
- **Oversized numbers** — enhance the oversized message to the concrete **"needs X {skill} pts vs a
  Y-pt single-sprint cap → X pts vs Y-pt cap. Split it, or add {skill} capacity."** from
  `plan.oversized[]` (`points` / `maxCapacity` / `buckets`). "Concrete beats 'larger than one sprint'."
- **Sprint meanRisk** — on the fragile-sprint meter (`SprintColumn` risk-heavy row), add the
  `sprintRiskProfiles[i].meanRisk` magnitude (e.g. "…· mean risk 68") next to the existing counts.
- **RiskRegister** — keep the `usedLlm`-gated copy (a deterministic fallback is a **watch-list**, not
  "Claude nudged these"); the mockup's fallback line: *"If a plan is ordered by the deterministic
  fallback, this line flips to: 'ordered deterministically — a watch-list, not Claude's picks.'"* This
  already exists via `usedLlm` — keep + align.
- Assumptions accordion: keep all 8 rows incl. "Available days are PER SPRINT".

### E. Step 2 "Team capacity" — 2A (Scrum) + 2K (Kanban)
**2A (Scrum) — form + sticky live read-out sidebar:**
- LEFT: the existing form, moodboard-ified (glass card). KEEP EVERY field + InfoTip + fail-loud
  validation: the roster (name / **skill select** / **available-days** with the **"PER SPRINT"** chip +
  its InfoTip), sprint structure (sprints / length / start date), the **Advanced** collapsible
  (hours-day / **focus factor** / hours-point / manual override). Add a **"+ BIGGEST LEVER"** badge on
  the Focus-factor label.
- RIGHT (sticky, stays in view while editing): a **"COMPUTED CAPACITY · LIVE"** read-out driven by the
  existing `previewCapacity` (no AI, no spend): the big **≈ X pts / sprint** + **~Y total over N
  sprints**, the **PER SKILL / SPRINT** split bars (BE/FE/QA), the **focus-factor counterfactual**
  ("IF FOCUS FACTOR WERE 0.8 → ≈ Z (+Δ) — focus factor scales capacity linearly, a small change moves
  the whole plan"), the non-blocking **warnings** (e.g. "{person}'s N days is below the M-day sprint
  length — used as entered. Not blocking."), and a muted **"No AI, no spend — recomputes as you type."**
- The **InfoTip · AVAILABLE DAYS** must say: days are **per sprint** (Scrum) — counted once every
  sprint; **in Kanban this field is per quarter** — getting this wrong silently multiplies the error by
  the sprint count. (The per-sprint-vs-quarter contract is load-bearing; keep it LOUD.)

**2K (Kanban):** no skill column, no sprint structure; the available-days field carries a **"PER
QUARTER"** chip; the read-out is a **"LIKELY REACH THIS QUARTER · LIVE"** forecast: **Expected ~X pts**,
a **conservative … – optimistic …** range bar, "Range = ×0.8 / ×1.1 of expected. Focus factor is the
biggest lever," and a **"A forecast, not a commitment — it sharpens once the team has real flow
history"** note.

### F. Kanban plan (K) — Now / Next / Later
Keep the existing bands + reach dividers ("— conservative reach ≈ X pts —" / "— optimistic reach ≈ Y
pts —") + the honesty header ("Likely reach this quarter — a forecast, not a commitment"). The rows use
the SAME `FeatureChip` in-flow treatment (unblocks N marker + "why here" expand + T0 signals + the
fallback behavior). Keep the "Later — beyond this quarter's likely reach (shown so the scope trade-off
is negotiable)" band.

### G. Moodboard consistency
- Replace PlanScreen's inline `<h2>` header with the shared **`ScreenHeader`** (from
  `components/moodboard.jsx`), matching the other 7 screens (title + icon + subtitle).
- All chips/callouts in the shared moodboard vocabulary: dark navy text on tinted pills, colour on the
  icon/dot (WCAG on near-white glass). Reuse `Signal.jsx` / `Icon.jsx` / `glassSurface`.

---

## INVARIANTS (both agents — do not break; these are the MUST-KEEPs)
1. **Honesty firewall on the rationale:** attributed ("Claude's reasoning"), display-only, structurally
   ABSENT on a deterministic-fallback plan (never fabricated). The deterministic signals are the
   authoritative numbers shown alongside.
2. **Deterministic signals shown truthfully + non-redundantly** (no "on critical path" + "no slack" as
   two independent facts).
3. **Never silent:** the Plan-health strip's clean state is an explicit green affirmation; absence is
   never "all clear". Every problem channel (deficit / overflow / bottleneck / spec concerns / data
   quality / reconciliation) stays LOUD.
4. **One source of truth:** the on-screen Plan summary reuses the `lib/planView.js` derivations the
   copy-out brief uses — no inline re-derivation, no drift.
5. **Button colours fixed:** green=commit (Generate/Re-rank, "Continue to review"), blue=nav
   (Next/Back), neutral=free Re-pack, no red action button (red = severity only).
6. **Two-path re-run:** free Re-pack (deterministic, neutral) vs billed Re-rank (green, armed 2-step,
   cost estimate). Never bill a re-pack. Cost honesty + Batch-API loading state + "you can leave" kept.
7. **Per-sprint (Scrum) vs per-quarter (Kanban)** available-days label + InfoTip contract kept LOUD.
8. **Skill buckets Scrum-only** (Kanban is pooled — no skill column, no per-skill meters).
9. **What-if "Defer" is preview-only** (never mutates scope) + frozen ordering (re-packs the cached
   ranking, no new Claude call). Keep both firewalls.
10. **Forge iframe:** page-scroll only, content-driven height — NO 100vh, NO internal scroll trap. The
    1A chip expands by growing the page (additive vertical flow). No docked rail.
11. **The 4-or-5-step wizard behavior** (Plan health earns its place; a clean Kanban plan is 4 steps),
    plan-first (step 4 hero, step 5 subordinate), both methodologies — all kept.
12. **Duplicate-uid graceful fallback** (a chip may render its raw uid as name — keep graceful).

---

## VERIFY (before the gate)
- `cd static/hello-world && CI=true npm run build > build.log 2>&1; echo NPM_EXIT=$?; grep -i "Compiled\|Failed\|Error" build.log` — must be "Compiled successfully" (NEVER `| tail` — it masks the exit).
- Backend: `node --check src/planner.js && node --check src/index.js`; `node prototype/test_planner.mjs` green (+ the new rationale/critical-path tests).
- ASCII sweep on the edited files (no smart quotes / non-ASCII in code — the Edit-tool smart-quote trap): grep for curly quotes / non-ASCII in the changed regions and fix to ASCII.
- Trace: rationale absent on fallback; clean chip shows nothing extra; Plan summary matches the copy-out; plan-health strip green when clean.
