# Claude Design Brief — Sprint / Capacity Planning (data-surfacing calibration)

> **Copy the block below to Claude Design, together with these screenshots: (1) Step 4 "Your plan"
> with the sprint columns (the main artifact), (2) a single sprint column with its feature chips
> close-up, (3) Step 2 "Team capacity" (the roster + advanced math + live preview), (4) Step 5 "Plan
> health" (deficit / overflow / risk register), and ideally (5) Step 3 "Review & generate" (objective
> + cost) and (6) the Kanban "Your plan" Now/Next/Later bands.**
>
> ⚠ **This is a DATA-SURFACING CALIBRATION, not a re-architecture.** The screen's information
> architecture — a 4-or-5-step wizard (Planning mode -> Team capacity -> Review & generate -> Your
> plan -> [Plan health]) — is GOOD, already on the moodboard, and LIVE ON PRODUCTION since June,
> multi-round live-accepted. The partner wants it KEPT. Do NOT propose a new wizard shape, new
> steps, a merged screen, or a dashboard. The job has TWO beats: **(1) make the plan explain its own
> reasoning on-screen** — surface a small set of high-value signals the planner already computes (and
> even pays Claude to produce) but currently hides — and **(2) make the "Team capacity" input (step 2)
> clear and trustworthy** — it is a plain form today, yet the whole plan rests on it (a wrong
> per-sprint / focus-factor value silently corrupts everything) — plus bring any last rough edges into
> the moodboard language the rest of the app now speaks. Every "MUST KEEP" is a hard constraint; every
> "SURFACE" and "MODERNIZE" is the actual ask.

---

## THE PRODUCT (context — same app as the previous screens you redesigned)
**Spec2Tickets** — an Atlassian **Forge** app (Confluence Custom UI, React) that turns a Confluence
spec page into a structured **Jira breakdown** (Epic -> Stories -> Subtasks) using Anthropic Claude,
**BYOK** (the customer pays Anthropic with their own key). Beyond the breakdown, the app has a
**Capacity-Sheet Planner**: the user enters their team's capacity for a quarter, and the app proposes
an **AI-assisted delivery PLAN** — which breakdown features land in which **Scrum sprint**, or, in
**Kanban** mode, a pull-ready **Now / Next / Later** backlog order. The plan respects the dependency
graph (hard), the team's capacity (hard ceiling), and per-feature story-points / complexity /
priority / risk (all already produced upstream). You have already redesigned this app's Page Picker,
AI Insights, Breakdown Editor, Review & Push, Admin Settings, Diagnostics and Test Cases to the
moodboard — this **Sprint / Capacity Planning** screen is the LAST one, and it must match them.

## THE SCREEN + THE ONE INSIGHT THAT DRIVES THIS CALIBRATION
The Planner is a wizard the user walks once:
1. **Planning mode** — two choice cards: **Sprints (Scrum)** vs **Kanban backlog**.
2. **Team capacity** — a team roster (name, optional skill, available-days), sprint structure
   (Scrum), advanced capacity math, plus a live "computed capacity" preview.
3. **Review & generate** — a recap, a **planning-objective** select (Balanced / Ship-MVP-fastest /
   Minimize-risk / Maximize-early-value), a cost estimate, and the **billed** "Generate plan" button
   (a 2-step armed confirm; runs Claude on the Batch API — takes a few minutes).
4. **Your plan** — the plan artifact itself (plan-first): Scrum **sprint columns** with capacity
   meters and feature chips, or Kanban **Now/Next/Later bands**. Plus a free **What-if** panel and a
   copy-out **Plan brief**.
5. **Plan health** *(conditional — only appears when there's analysis to show)* — capacity deficit,
   the "doesn't fit" overflow list, skill bottlenecks, spec-wide concerns, and a **Risk Register**.

**The insight (the reframe, WITHIN the kept structure):** our planner's whole differentiator over the
incumbents (Jira Advanced Roadmaps, Easy Agile, BigPicture — all deterministic packers with **no
reasoning layer**) is that **Claude produces a sequencing RATIONALE** on top of a deterministic,
dependency-honest packer. The planner computes a rich justification for *why each feature sits where
it does* — a per-feature **"why here" from Claude** (a one-clause reason for every non-obvious
placement), plus the deterministic facts behind it (this feature is **on the critical path**, it
**unblocks N others**, it has **slack**, it carries a **risk score**). **Today almost all of that
reasoning is dark.** The single AI narrative the feature generates — the per-feature `rationale` — is
billed, generated, persisted, and then shown **NOWHERE on screen at all** (zero references in the
whole frontend). The per-feature scheduling signals are fed to Claude and then discarded from the UI
too — their only leak is two aggregate lines buried inside the copy-out brief. So the plan renders as
a bag of chips in columns and stays **mute
about its own logic**. The calibration: **make the plan defend itself.** The user should be able to
read *why* a feature is in sprint 3, or why Claude pulled the risky one first — at a glance or one
click away — without reverse-engineering the packer or opening a copy-out. Nothing about the flow
changes; the plan just stops whispering.

## THE AUDIENCE + WHAT THEY FEAR
A **Product Owner / BA / Scrum Master** taking an AI-proposed plan into a **planning meeting** and
presenting it to their team and stakeholders. Their deep fear is the accountability one: **being
unable to DEFEND the plan.** "Why is the high-priority login feature in sprint 3, not sprint 1?"
"Why did the AI pull the payments integration first?" — and having no answer, looking like they
rubber-stamped a black box. The asymmetric bad outcome: they commit a sequence they can't justify,
the team pushes back, and the plan (and their judgment) loses credibility. A **win** = the plan
**pre-answers those questions** — each non-obvious placement carries its reason ("pulled early: it
unblocks 4 features and carries an external-dependency risk we chose to hit early"), so the PO walks
in able to explain every call. Secondary fear: **a hidden problem** — a feature that silently didn't
fit, a skill bottleneck, an AI that referenced a feature that doesn't exist — surfacing in the
meeting instead of on the screen. Tertiary: **fake precision** — a plan that over-promises certainty
the team's no-history estimates can't support; they need honesty ("a forecast, not a commitment"),
which the screen already does well and must keep.

## THE ONE DECISION + WHAT "GOOD" LOOKS LIKE
The screen-level go/no-go: **"Can I stand behind this plan and take it to the team?"** Under it, the
per-feature decision: **"Why is this here — and do I agree?"** **Good** = on the plan artifact, a
feature that was placed non-obviously visibly carries its reason; the user can glance a chip and see
its leverage (unblocks N / on critical path / has slack) and, one click away, read Claude's one-line
"why here." **Good** also = the plan's honest problems (deficit, overflow, bottleneck, AI
hallucinated/omitted a feature) are impossible to miss, and the calm "this is a forecast, not a
commitment" framing stays. The user leaves able to defend the plan, not just to have generated it.

## THE SCREEN TODAY (what a screenshot cannot tell you)
- **The wizard is 4 OR 5 steps, not fixed 5.** Base steps are `Planning mode`, `Team capacity`,
  `Review & generate`, `Your plan`. A 5th step **"Plan health"** is appended **only when there's
  analysis worth a step** (Scrum always has it; a clean Kanban plan with no risks/warnings renders as
  a **4-step** wizard). The 5th step must **earn its place** — do not force it onto a clean plan.
- **Step 1 (Planning mode):** two `ChoiceCard`s (Scrum / Kanban), each a 2px-blue-bordered ice-wash
  card with an icon tile, a title, a description, and a success-check when selected. A small orange
  nudge appears if the user switches mode after generating (prompting a free Re-pack).
- **Step 2 (Team capacity):** a bordered form card. A **team roster** table (columns: Team member
  name, Skill select [Scrum only: Backend/Frontend/QA], Available days). Add/remove person rows.
  Sprint structure (Scrum): sprint count, sprint length, optional start date. An **Advanced**
  collapsible (hours/day, focus factor, hours/point — or a manual capacity override). Several fields
  carry a click-to-open **InfoTip** popover (ⓘ). Below the form, a **live computed-capacity preview**
  ("Computed capacity approx X pts/sprint · ~Y total over N sprints", plus a focus-factor
  counterfactual and per-skill split) that recomputes as you type — no AI, no spend.
- **Step 3 (Review & generate):** a recap block (mode / features / team / sprint structure /
  computed capacity), the **planning-objective** `<select>` with an InfoTip, a cost estimate
  callout ("Up to ~$X (typically ~$Y) — billed to your own key, no markup"), and the GREEN primary
  button (Generate / Re-rank) that **arms on first click, fires on second** (a billed Claude call).
  Objective/mode changes disarm and nudge a billed re-rank.
- **Step 4 (Your plan) — Scrum:** a top-right neutral **"Re-pack sprints (free)"** button; then
  **sprint columns**. Each `SprintColumn` = a header ("Sprint N", a success/warning icon, `load/cap
  pts`), a date label, a **capacity bar** (green, or orange when over capacity), an optional orange
  **"Risk-heavy"** meter ("N high-risk items, M external dep") when the sprint is fragile, optional
  **per-skill sub-meters** (BE/FE/QA), and the body: **`FeatureChip`s** or "Free capacity". A
  `FeatureChip` today shows the **name + story-points**, a **priority tint** (a coloured left edge:
  High=red / Medium=orange / Low=neutral), a **risk-corner icon** (a small warning/error glyph whose
  hover-title lists risk reasons), and a "larger than one sprint — split it" note when oversized.
  **That is all a chip shows — no leverage, no critical-path membership, no "why here."** Below the
  columns: a fragmentation note, an ALWAYS-present **Plan-health strip** (`PlanHealthStrip` — the §11
  bridge that keeps the demoted problem counts + magnitude on this hero step: "Doesn't fit (N)",
  "Short on Backend X pts", "Risks (N)", warning-tinted, OR a green "No blockers — N features planned"
  affirmation when clean; it links to step 5 when there's more), the **What-if** panel, the **Plan
  brief** copy-out, and a cost footer.
- **Step 4 (Your plan) — Kanban:** the same shell but **Now / Next / Later bands** (`BacklogBand`)
  with "conservative reach" / "optimistic reach" divider lines, a "Likely reach this quarter"
  verdict, and an honesty panel ("a forecast, not a commitment").
- **Loading is a SUB-STATE of step 4:** while Claude plans, step 4 shows a spinner + "Claude is
  planning your sprints… runs on the Batch API… takes a few minutes" + a live mm:ss timer + "you can
  leave this screen and come back." A free re-pack shows an instant "Re-packing…" instead.
- **Step 5 (Plan health):** input warnings, a **capacity deficit** callout ("Add a sprint, raise
  capacity, or descope"), a **"Doesn't fit (N)"** overflow list with typed reasons, a **skill
  bottleneck** callout, a **spec-wide concerns** band, the **Risk Register** (a list of the plan's
  riskiest features with WHERE they landed and why-flagged chips), and collapsible accordions
  (Assumptions / Skill detail / Data quality). The Risk Register's preamble honestly changes copy
  depending on whether Claude actually ranked (`usedLlm`) or a deterministic fallback ordered it.
- The whole screen is **hybrid-styled** (Tailwind utility classes + inline `var(--s2j-*)` moodboard
  tokens) and already on the moodboard glass (WizardKit `stepSurface`, `SignalCallout`/`SignalIcon`,
  the ice-gradient glass). It reads well. The gap is **not** paint — it is that the plan's own
  reasoning is computed and thrown away.

## THE FULL DATA PALETTE (tag every datum; T0 = already on the FE plan object, T1 = client-derivable, T2 = one backend thread, T3 = new AI)

### ⭐ The under-surfaced reasoning — the heart of this calibration
- ⭐⭐ **Per-feature `rationale` (Claude's "why here")** — a **one-clause reason** the model writes
  for **every non-obvious placement** (a deliberate deferral, a high-priority item forced late by a
  dependency, an item pulled early to de-risk or to unblock many). It is **sparse by design** (the
  schema omits it for obvious placements — so it is low-noise: a chip that has one is exactly a chip a
  reviewer would question). It is **billed, generated, and persisted** in the plan record, but **no
  resolver returns it to the UI and it is rendered NOWHERE** (0 references in the whole frontend).
  **Tier: T2** — the string exists server-side; surfacing it needs one small backend thread (return a
  compact `uid -> rationale` map alongside the plan). ⚠ **HONESTY FIREWALL:** the rationale is
  **untrusted model prose** — it can occasionally make a checkably-wrong factual claim. Show it
  **attributed** ("Claude's reasoning"), **display-only**, next to the authoritative deterministic
  signals — never as an asserted fact, exactly like the Test Cases concern text and the Risk
  Register's `usedLlm`-gated copy. When a plan was ordered by the deterministic fallback (no Claude),
  there are no rationales — say so, don't fake them. *(Implementer note for the impl-spec: the
  rationale array is persisted in `record.ranking` — the RAW LLM array, a sibling of `record.plan`
  whose own `ranking` is stripped to diagnostics; it survives a free re-pack and is `null` on a
  fallback plan, so the absence is structural. The T2 resolver returns a compact `uid -> rationale`
  map from it — no Claude re-call; keying is clean since `feature_id` == the plan-time `_uid` the
  chips already use.)*
- ⭐ **Per-feature scheduling signals** — for every feature the planner computes and **already carries
  on the FE plan object** (`plan.signals[uid]`): **`downstreamUnblockCount`** (how many features this
  one unblocks — its leverage), **`criticalPathLen`** (its depth on the longest dependency chain —
  whether it's on the critical path), **`slack`** (how much it could slip). Today these are fed to
  Claude and then leaked only as **two aggregate lines** ("Critical path: N deep", "Highest leverage:
  top 3 by unblock-count") inside the **copy-out brief** — never shown per-feature, and `slack` is shown
  nowhere at all. **Tier: T0** (already on the FE plan object; pure presentation). These are the
  **deterministic facts that justify the order** — the trustworthy companions to the untrusted
  rationale.
- **Per-feature `riskScore` (0-100)** — computed per feature; **used only to sort** the Risk Register;
  the magnitude is never displayed. **Tier: T0.**

### The plan artifact (Scrum) — all T0 (already on `plan`)
- `plan.sprints[]`: `{ index, capacity, load, ids[], overCapacity, utilization, bucketLoad{},
  bucketCapacity{} }` — the columns + capacity meters + per-skill sub-meters (shown).
- `plan.overflow[]`: `{ id, name, reason, rootCause, rootCauseName, starvedBuckets[] }` — typed
  "doesn't fit" reasons (`capacity_exhausted` / `bucket_exhausted` / `blocker_overflowed` /
  `blocker_unsized`) (shown, decoded via `overflowReasonText`).
- `plan.oversized[]`: `{ id, name, points, maxCapacity, buckets[] }` — a feature bigger than any
  single sprint. Today the UI/brief only say "larger than one sprint — split it"; **the by-how-much
  numbers (`points` vs `maxCapacity`) are dropped.** T0, under-surfaced.
- `plan.metrics`: `{ totalCapacity, totalBacklogPoints, totalPlanned, overflowPoints, overflowCount,
  wastedCapacity, deficitPoints, utilizationRatio, emptyTrailingSprints, fragmentation }`. Deficit /
  wasted / overflow / fragmentation are shown; **`totalPlanned`, `utilizationRatio` (plan-level),
  and `emptyTrailingSprints` are computed and discarded.** T0.
- `plan.sprintRiskProfiles[]`: `{ meanRisk, highRiskCount, externalDepCount, lowConfidenceCount,
  featureCount, highRiskPointFraction, fragile }` — the fragile-sprint meter uses `fragile` +
  `highRiskCount` + `externalDepCount`; **`meanRisk` (the magnitude), `lowConfidenceCount`, and
  `highRiskPointFraction` are discarded.** T0.

### Skill capacity (Scrum only) — T0
- `plan.bucketMetrics`: `{ capacity{}, planned{}, demand{}, unmet{}, overfilled{}, overDemand{},
  idle[], bottleneckBuckets[] }` — the plan-level per-skill (Backend / Frontend / QA / GEN) capacity
  payload. It drives the **skill-bottleneck** callout ("short on Backend X pts while QA sits idle"),
  the What-if **bucket-shortfall** line, and the plan-health teaser. Mostly SHOWN (bottleneck / idle),
  but a redesign must know this data shape so it doesn't drop the skill panels. Also on each sprint as
  `bucketLoad{}` / `bucketCapacity{}` -> the per-skill sub-meters. Kanban is a POOLED team -> Scrum-only.
- `plan.skillDiagnostics`: `{ unclassified[], unknownTaskTypes[] }` — features whose skill couldn't be
  derived / unrecognized task types. Shown in the step-5 "Skill detail" accordion; a disjoint typed
  channel, absent when clean. T0.

### The plan artifact (Kanban) — T0
- `plan.now[] / next[] / later[]` (rows `{ id, points, cumulative }`) + `plan.metrics`
  `{ expectedPointsQuarter, conservativePoints, optimisticPoints, reachedNow/Next/BeyondReach
  Points, now/next/laterCount }`. Shown as bands + reach dividers; per-row `cumulative` running total
  is dropped. T0.

### Risk / concerns — T0
- `plan.riskByFeature[uid]`: `{ risk_level, has_external_dep, low_confidence, riskScore,
  typedConcernCount, untypedConcernCount }` — flags feed the chip risk-corner + Risk Register;
  **`riskScore`, `typedConcernCount`, `untypedConcernCount` are discarded** (see above).
- `plan.specConcernSummary`: `{ total, complianceCount, items[{ type, severity, text }] }` — shown as
  a spec-wide band; **item `severity` is dropped** (only type + text shown). T0.

### Honesty / diagnostics — T0, partly hidden
- `plan.ranking`: `{ usedLlm, unknownIds[], duplicateIds[], omittedCount }` — **whether Claude
  actually ran** (`usedLlm`, shown) and **its reconciliation diagnostics** (`unknownIds` = Claude
  referenced feature ids that don't exist; `duplicateIds`; `omittedCount` = features Claude forgot to
  rank, appended deterministically). **The reconciliation diagnostics are computed and shown
  NOWHERE** — a silent-miss: Claude can hallucinate or omit features and the user never learns. T0,
  a §11 honesty gap worth surfacing calmly.
- `plan.graph`: `{ danglingRefs, ambiguousDeps, selfDeps, duplicateNames, duplicateUids, cyclicNodes,
  cutEdges }` — most are surfaced in the "Data quality" accordion (`PlanDiagnostics`) — **keep those**.
  ⚠ Exception: **`cutEdges` (the soft dependency edge the packer cut to break a cycle) is NOT
  rendered** — the cycle callout names the cyclic *nodes* but never the cut *edge* (from -> to). A
  minor discarded datum; optional to surface ("broke the X -> Y cycle by cutting the softer link").
- `plan.violations` — a §11 self-audit channel that MUST stay empty when the packer is correct; logged
  server-side only. **Deliberately NOT a UI datum — do not try to render it.**
- `plan.sizingIssues` — features with missing/invalid story-points ("unsized — cannot plan"); an
  honest problem channel shown via `PlanDiagnostics`. Keep it loud. T0.
- `assumptions[]` / `warnings[]` — every defaulted capacity constant with provenance; fully shown
  (Assumptions accordion + Heads-up). Keep.

### Plan-level narrative
- **The deterministic Plan brief** — `renderPlanBrief(plan)` already assembles a stakeholder-ready
  narrative **client-side** ({markdown, plainText, csv}): sprint-by-sprint allocation, the critical
  path + highest-leverage lines, the risk register, the capacity verdict, "what we cut & why". Today
  it is a **copy-out only** (three "Copy" buttons at the foot of step 4). Its content is **T1**
  (already assembled on the FE) — surfacing a **readable on-screen version** (in addition to the copy
  buttons) is a strong data-surfacing move that keeps the IA. ⚠ Scrum-only in v1 (a Kanban brief is
  deferred).
- **There is NO AI `plan_summary` and NO sprint-goal field** anywhere — the model produces only the
  per-feature `rationale`. If a plan-level AI narrative or per-sprint goals are ever wanted, that is
  **T3** (a new AI field) — call it out as an option, do not assume it exists. (Recommendation: prefer
  surfacing the existing DETERMINISTIC brief on-screen over inventing an AI summary — the deterministic
  one is defensible cell-by-cell; an AI summary's provenance is the model.)

## OPEN DESIGN QUESTIONS (give a recommendation; explore freely)
1. **Where does the per-feature "why here" live?** The chip is small and the rationale is sparse.
   Options: (a) a subtle **"why" affordance on the chip** (a small info dot / a bottom "why here"
   line) that only appears when a rationale/notable-signal exists, expanding in place or in a small
   popover; (b) an on-demand **chip-expand** that reveals `rationale` + the deterministic signals
   (unblocks N / on critical path / slack / risk score); (c) a compact **"Sequencing rationale"
   panel** on step 4 that lists just the features Claude gave a reason for. *Recommendation:* (a)+(b)
   — keep the collapsed chip calm (it currently only shows a rationale exists via a marker), reveal
   the full "why here" on click. The signal set on the chip should be tiny (leverage + critical-path
   membership); the rest on expand. Design the absent case: most chips have no rationale — they must
   read clean, never a hollow "no reason" state.
2. **How much of a feature's leverage belongs on the collapsed chip vs on expand?** `downstreamUnblockCount`
   ("unblocks 4") is the most decision-relevant single number; `criticalPathLen` reads best as a
   binary "on the critical path" marker; `slack` is expand-only detail. *Recommendation:* at most one
   compact leverage marker collapsed; the trio on expand.
3. **Surface the deterministic Plan brief on-screen?** *Recommendation:* yes — a compact readable
   "Plan summary / story" panel on step 4 (the narrative + critical-path + leverage lines that are
   currently copy-out-only), with the existing Copy (MD / plain / CSV) buttons kept. This is the
   "defensible plan, on screen" made concrete. Keep it honest and deterministic; do not add an AI
   summary.
4. **Surface the LLM reconciliation honesty (`unknownIds` / `omittedCount`)?** *Recommendation:* yes,
   calmly — a small info note on the plan or in Plan health when Claude referenced a non-existent
   feature or omitted some (which were appended deterministically). It closes a silent-miss without
   alarming a clean plan (absent = show nothing).
5. **`riskScore` magnitude + `meanRisk` per sprint + `oversized` numbers** — worth showing? *Recommendation:*
   show the sprint `meanRisk` on the fragile meter and the `oversized` "X pts vs Y-pt sprint cap"
   number (concrete beats "larger than one sprint"). The per-feature `riskScore` is probably too
   noisy on the chip — keep it to expand or leave it as the register's sort key.

## MUST KEEP (hard constraints — do NOT redesign these)
1. **The wizard IA**: the ordered steps `Planning mode` -> `Team capacity` -> `Review & generate` ->
   `Your plan` -> `[Plan health]`, and the **4-or-5-step behavior** (Plan health appears only when
   there's analysis; a clean Kanban plan is 4 steps — it must still earn the 5th). Keep the WizardKit
   Stepper.
2. **Both methodologies** — Scrum sprint columns AND Kanban Now/Next/Later bands, with their distinct
   reach/forecast honesty. Do not merge or drop either.
3. **Plan-first (step 4 leads with the plan; analysis is step 5).** The "Your plan" artifact is the
   hero; "Plan health" is the subordinate detail. Keep that split (it is the Linear-Insights pattern
   the partner chose in June).
4. **The two-path re-run model:** a **free** "Re-pack (free)" (deterministic, instant, neutral
   button) vs a **billed** "Re-rank with Claude" / "Generate" (GREEN, 2-step armed confirm, with the
   cost estimate). Keep the honesty: mode/objective changes disarm and nudge the right path. Never
   bill a re-pack.
5. **The billed-call honesty:** the pre-flight cost estimate, the armed 2-step confirm, the "billed
   to your own key, no markup" copy, the "Claude is planning… Batch API… a few minutes… you can
   leave" loading state with the live timer.
6. **The forecast-not-commitment framing** (Kanban reach range, the honesty panel, "a forecast, not a
   target"), the capacity assumptions with provenance, and every LOUD honest problem channel (deficit,
   typed overflow, skill bottleneck, spec concerns, data-quality diagnostics). Data loss / silent
   success is the worst outcome — no problem may become quieter.
7. **Every capacity FIELD + its load-bearing semantics** — the roster (name / skill / available-days),
   sprint structure, the advanced math (hours-day / focus-factor / hours-point / manual override), the
   fail-loud validation, the InfoTip explanations, and the live computed-capacity preview + focus-factor
   counterfactual + per-skill split. Keep every field + its meaning (esp. the per-sprint-vs-quarter
   contract, #13). ⭐ But the form's LAYOUT + presentation ARE in scope to redesign (step 2 is an
   explicit target — SURFACE #7 + WHAT I WANT BACK): do not remove a field, change a unit, or weaken a
   validation / InfoTip, but you MAY re-lay-out and moodboard-ify the form.
8. **The What-if panel** (free scenario explorer: ±sprints, focus override, defer-subset, delta
   strip) and the **Plan brief** copy-out (MD / plain / CSV). Keep both; you may surface the brief's
   content on-screen (Q3) but keep the copy buttons. ⚠ Two honesty firewalls inside it: the **Defer**
   action is PREVIEW-ONLY (it never mutates scope — it routes the user to the editor to really drop a
   feature), and the preview re-packs the **cached** ordering WITHOUT re-asking Claude (frozen
   ordering). Do not let "Defer" read like an apply/commit.
9. **The button-colour convention** (below) and the post-push **Assign sprints / Rank backlog** Jira
   panels (those live on the separate Pushed screen, not here — out of scope, do not touch).
10. **The `PlanHealthStrip`** — always present on the plan (step 4): warning-tinted when there are
    demoted problems (counts + magnitude), a GREEN "No blockers" affirmation when clean. Its clean
    state must be an explicit affirmation, never silence — absence must never read as "all clear"
    (POLICY §11).
11. **One source of truth for the plan's story (`lib/planView.js`).** The on-screen plan + the
    copy-out brief already share `capacityVerdict` / `buildRiskRegister` / `overflowReasonText` +
    date/format helpers so they can NEVER tell two stories. If you surface the brief on-screen (Q3),
    it MUST reuse those same derivations — do not re-derive the verdict / register / overflow inline,
    or the on-screen summary and the copied brief will diverge.
12. **Skill buckets are Scrum-only.** Kanban is a POOLED team — never show per-skill sub-meters, the
    skill-bottleneck, or the skill column on a Kanban plan.
13. **`Available days` is PER-SPRINT (Scrum) vs PER-QUARTER (Kanban)** — the column label + InfoTip
    carry that contract, which prevents the deepest silent ×sprintCount capacity error. Keep the exact
    label semantic per methodology.

## SURFACE / MODERNIZE (the actual ask — MUSTs)
1. ⭐⭐ **The per-feature "why here" — make the plan explain its sequencing.** On the **`FeatureChip`**,
   when Claude gave a placement a `rationale`, mark it (a subtle affordance) and reveal on click:
   Claude's one-clause reason (attributed, display-only) + the deterministic signals that justify the
   placement (**unblocks N**, **on the critical path**, **slack**, **risk**). This is the single most
   valuable hidden asset and the app's differentiator, currently invisible. Design the collapsed chip
   to stay calm and the "why here" to be one glance/one click. (T2 for the rationale string; T0 for
   the signals.)
2. ⭐ **Per-feature leverage on the chip / on expand.** Bring `downstreamUnblockCount` /
   `criticalPathLen` / `slack` out of the copy-out brief and onto the plan (at least on chip-expand;
   the top leverage marker may sit collapsed). These are the deterministic facts a skeptic trusts.
   (T0.)
3. **Surface the plan's own story on-screen** (Q3) — a compact readable "Plan summary" panel drawn
   from the existing deterministic brief (critical path, highest-leverage, capacity verdict, "what we
   cut & why"), keeping the Copy buttons. (T1.)
4. **Close the honesty gaps:** show the LLM reconciliation note (`unknownIds` / `omittedCount`) when
   non-empty; show the `oversized` "X pts vs Y-pt cap" number; show sprint `meanRisk` on the fragile
   meter. All calm, all absent-when-clean. (T0.)
5. **Moodboard consistency polish:** the screen builds its **own inline `<h2>` header** instead of the
   shared **`ScreenHeader`** the other 7 screens use — align it. Bring any last ad-hoc chips /
   callouts into the shared moodboard chip + `SignalCallout` language (dark text on tinted pills,
   colour on the icon/dot — the WCAG-on-glass rule). Ensure the `FeatureChip`, sprint columns, bands,
   and Risk Register read like the Editor / Review / Test Cases cards you already did.
6. **The Risk Register + Plan health blocks** -> the same moodboard callout/card vocabulary; keep the
   `usedLlm`-gated honesty copy (a deterministic fallback is a watch-list, not "Claude nudged these").
7. ⭐ **Step 2 "Team capacity" — a clear, confidence-inspiring input form.** Today it is a plain
   bordered card (not the moodboard glass the wizard steps use), and the two highest-leverage knobs —
   **focus factor** (a direct linear multiplier on capacity) and **available days PER SPRINT vs PER
   QUARTER** — are easy to get wrong, and a wrong value silently corrupts the whole plan. Redesign it
   into a moodboard form that makes those inputs legible and their EFFECT visible: keep every field +
   InfoTip + the fail-loud validation, but bring the **live computed-capacity preview** (pts/sprint,
   the total, the focus-factor counterfactual, the per-skill split, the non-blocking warnings) forward
   as a prominent, trustworthy read-out beside the inputs — so the user SEES the capacity their numbers
   produce and the high-leverage knobs read as consequential. The roster table, the advanced-math
   collapsible, and the Scrum-vs-Kanban field differences (skills + sprint structure only in Scrum;
   per-quarter days in Kanban) all stay. (T0 — the preview is already computed live via
   `previewCapacity`; this is presentation + prominence, no new data.)

> ⭐ **Ship-order + scope discipline (read this):** the **T0 scheduling signals (#2) are the safest,
> free, most-certain win** — already on the FE, no backend, no honesty firewall — lean on them; the
> **T2 rationale (#1) is the highest-CEILING win** but carries the one backend thread + the firewall.
> Design the chip so it reads well even before the rationale thread lands. ⚠ **Watch panel
> accretion:** step 4 already stacks the sprint columns, a fragmentation note, the Plan-health strip,
> the What-if panel, the Plan brief, and a cost footer. Surfacing the plan's story (#3) must stay
> SUBORDINATE to the plan hero — **prefer chip-level "why here" (Q1a/b) over adding new full-width
> panels.** New stacked panels are the most plausible way this CALIBRATION drifts into the "dashboard"
> it forbids. Keep the plan the hero.

## THE DESIGN SYSTEM (moodboard — same as the screens you already did)
Blue-on-white monochrome + glassmorphism. Reference `docs/DESIGN-SYSTEM-MOODBOARD.md`. Key facts:
- **Glass must be VISIBLE on white**: cards use an ice->white gradient wash (WizardKit `stepSurface` /
  `glassSurface`), a soft BLUE-tinted shadow (`rgba(5,38,89,...)`, never grey), radius 12-16 stepping
  down with nesting. Navy `#021024` headings, steel / sky-steel secondary text, ice `#C1E8FF`
  accents; the page floats on a faint ice wash `#f7faff`.
- **Action-button colours are FIXED and semantic**: **green = commit/submit** (Generate / Re-rank,
  "Continue to review", the Jira assign/rank buttons), **blue = navigate/wayfinding** (the WizardKit
  "Next" buttons, the What-if "Apply (free re-pack)", the BackButton), **neutral = the free "Re-pack"
  action**, **red = destructive** (none in this flow — red appears only as a severity tint). Do not
  repaint these.
- **Severity stays a true signal** (traffic-light): success = green, warn = amber, error = red,
  info = blue. **On a tinted pill the TEXT stays dark navy and the COLOUR rides the icon / dot /
  border** (light-on-light-tint fails WCAG on our near-white glass). Colour is never the only
  signal — always an icon/shape + a text label. (The planner already follows this via `SignalIcon` /
  `SignalCallout` — match it.)
- **Type scale**: navy headings (h2 ~22, h3 ~14-18 bold), body ~13-14, tiny uppercase labels ~10-12
  muted, micro ~11. System font stack (no paid fonts).
- The **pre-flight-card pattern** (tri-state verdict + tiles + on-demand detail) is our house go/no-go
  read — the plan-health teaser strip already borrows its calm; keep that, don't build a second big
  verdict hero.

## STATES THE DESIGN MUST COVER (exhaustive)
- **Mode:** Scrum vs Kanban (different step 4 artifact; Kanban may be a 4-step wizard).
- **Wizard:** step 1-3 idle/editing; a **capacity-error** step 2 (fix inputs before planning) + the
  step-2 live-preview NON-blocking **warnings** (clamp / duplicate-name / override-discrepancy —
  distinct from the blocking error); the **armed** billed confirm on step 3.
- **Nudges (drift -> re-run):** a **methodology-changed** nudge appears in THREE places (step 1
  inline, step 3 inline, and on step 4 it REPLACES the What-if panel with a "planning mode changed"
  callout) -> prompts a free Re-pack; an **objective-changed** nudge on step 3 -> prompts a billed
  Re-rank.
- **Step 3 errors:** **key-needed** ("Anthropic key needed") · **plan-failed** ("Couldn't build the
  plan") · **edition/license-required** (an upgrade payload) — each a distinct callout.
- **Step 4 loading:** billed ("Claude is planning… a few minutes… timer… you can leave") vs free
  ("Re-packing…" instant); **batched-polling / reconnect** (resumed on reload).
- **Step 4 plan:** a healthy Scrum plan (columns fit) · an **overflow** plan ("Doesn't fit (N)" +
  fragile sprints) · a Kanban Now/Next/Later plan · a plan **ordered without Claude** (deterministic
  fallback — no rationales; register is a watch-list) · a **stale** plan (banner; inputs changed
  since generation) · **empty** ("no features to plan").
- **The FeatureChip:** with vs without a `rationale`; with vs without risk; oversized; high/medium/low
  priority. Rationale + notable signals are **frequently ABSENT** — the chip must read clean and
  complete without them (never a hollow "no reason" chip). Edge: a duplicate-uid feature can fall back
  to rendering its raw uid string as the name — keep that graceful.
- **Step 5 (Plan health):** present vs **absent** (a clean Kanban plan has no step 5); Scrum
  (deficit / overflow / bottleneck blocks) vs Kanban; `usedLlm` true vs false (register copy flips).
- **What-if:** closed / open-idle / stale / capacity-error / computing / has-delta / defer-preview /
  a **newly-dangling** warning (a deferral left a dependency unsatisfied) / a **bucket-shortfall** line
  (a skill is the constraint, not total capacity).
- Team sizes 1 to ~10 people; backlogs of a handful to ~300 features; sprint counts 1-N. Must scan
  cleanly at both ends.

## FIXED — DO NOT REDESIGN
- The wizard IA + step order + the 4-or-5-step behavior; both methodologies; plan-first (step 4) with
  analysis subordinated (step 5); the two-path (free Re-pack vs billed Re-rank) model + armed confirm
  + cost honesty; the capacity form fields; the What-if panel; the copy-out brief; the button-colour
  convention; the post-push Jira panels (not on this screen).
- Forge iframe: **page-scroll only** — never full-height panes, never an internal scroll trap. All
  content flows and grows the page. (The wizard already respects this.)
- **Do not invent data, and do not add an AI call.** Everything asked for is T0 / T1 / one small T2
  backend thread (the rationale string). The honesty firewall on the rationale (attributed,
  display-only, absent on a deterministic-fallback plan) is mandatory. No new backend beyond returning
  the already-persisted rationale map.

## WHAT I WANT BACK
1-3 on-brand redesign directions for the **Sprint / Capacity Planning** screen, covering TWO surfaces:
**(A) the "Your plan" artifact and its `FeatureChip`** (how a feature carries its "why here" — Claude's
rationale + the deterministic leverage / critical-path / slack signals — collapsed calm vs expanded),
and **(B) step 2 "Team capacity"** redesigned into a clear, confidence-inspiring moodboard input form
with the live computed-capacity preview brought forward (keep every field + InfoTip + validation).
Then the **on-screen plan summary** (the deterministic brief surfaced) and the moodboard-consistency
polish (ScreenHeader, chips, Risk Register, Plan health). For each element label its data tier. **Keep
the exact wizard IA, both methodologies, plan-first, the two-path re-run, the capacity fields + their
semantics, and the honesty framing** — this is a **surface-the-reasoning + restyle** pass, not a
re-architecture. Show the chip **with** a rationale + signals and **without** (the common clean case),
and show the capacity form in both **Scrum** (roster + skills + sprint structure) and **Kanban**
(pooled, per-quarter days) shapes. Keep it a fast glance; reuse the moodboard chip / callout / card
vocabulary from the screens you already did for this app.
