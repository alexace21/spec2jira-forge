# Claude Design Brief — Test Cases (presentation refresh)

> **Copy the block below to Claude Design, together with 2 screenshots: (1) the Test Cases
> OVERVIEW (the list of story rows), (2) a per-story WIZARD opened on a case (Happy-path step with
> a case expanded), and ideally (3) the "Coverage & trust" step.**
>
> ⚠ **This is a PRESENTATION REFRESH, not a re-architecture.** The screen's information
> architecture is GOOD and the partner wants it KEPT. Do NOT propose a new structure, new tabs, a
> merged board, or a suite-health dashboard. The job is to make the existing screen — especially
> the individual **test-case card** — read like the rest of our freshly-redesigned app, and to
> surface a few per-case signals the card already has but hides. Every "MUST KEEP" below is a hard
> constraint; every "MODERNIZE" is the actual ask.

---

## THE PRODUCT (context — same app as the previous screens you redesigned)
**Spec2Tickets** — an Atlassian **Forge** app (Confluence Custom UI, React) that turns a
Confluence spec page into a structured **Jira breakdown** (Epic -> Stories -> Subtasks) using
Anthropic Claude, **BYOK** (the customer pays Anthropic with their own key). The **Advanced**
edition adds AI **test-case generation**: for each Story it drafts acceptance test cases the QA/BA
reviews, edits, and exports to Gherkin (.feature) / CSV before pushing to Jira. This brief is that
**Test Cases** surface. You have already redesigned this app's Page Picker, AI Insights, Breakdown
Editor, Review & Push, Admin Settings and Diagnostics to the moodboard — this screen must now match
them.

## THE SCREEN + THE ONE INSIGHT THAT DRIVES THIS REFRESH
The Test Cases surface has two views:
1. **Overview** — a vertical list of **story rows**, one per Story, each showing the story name +
   status chips (coverage, type mix, "edited", "failed"...) + per-row actions (Regenerate, Copy
   Gherkin/CSV) + a blue **"Open ->"** button.
2. **Per-story wizard** (opened by "Open ->") — a **4-step stepper**: `1 Happy-path`, `2 Negative`,
   `3 Edge`, `4 Coverage & trust`. Steps 1-3 list that type's **test-case cards** (each editable +
   collapsible); step 4 shows what's covered / uncovered.

**The insight (the reframe, within the kept structure):** the **individual test-case card is where
a QA reviewer decides "can I trust this case enough to sign my name to it?"** — yet today that card
(a) sits on a flat near-white glass that is nearly invisible on the white page (it predates our
current visible ice-gradient glass), and (b) HIDES the model's own per-case trust signals it
already computed: a **confidence self-rating** (stored as the glyph `✓` / `⚠` / `✗`, plus an
independent 0-100 `confidence_score`) and a **typed concern** (`[RISK|high]`, `[COMPLIANCE|...]`,
`[ASSUMPTION|...]`) — shown today only as raw un-decoded text, if at all. So the refresh is: **make the card a first-class moodboard card that
carries its own trust signals at a glance**, and bring the whole surface (rows, chips, wizard,
coverage step) into the moodboard language the rest of the app now speaks. Nothing about the flow
changes; the card just stops whispering.

## THE AUDIENCE + WHAT THEY FEAR
A **picky QA lead / BA** doing **sign-off-grade** review. These cases become the literal
"definition of done" a developer runs and the QA lead **personally signs against**, and they get
exported into an external test tool (Xray / Zephyr / ADO / Jama / TestRail). Their deep fear is the
asymmetric one: **a case that reads "green" while it is actually wrong or thin** — a missing
negative case, a low-confidence guess presented as fact, a concern the model raised that the
reviewer never saw — so a bug ships with their name on the sign-off. A **win** = the card itself
tells them where to look: "these two cases the model was unsure about; this one carries a
compliance concern" — surfaced calmly, not buried. Secondary fear: **losing their own edits** (they
hand-edit cases) — so the edit/save affordances must stay obvious and safe.

## THE ONE DECISION + WHAT "GOOD" LOOKS LIKE
Per card: *"do I trust this case, or must I look closer / fix it?"* **Good** = at a glance on the
collapsed card the reviewer reads: which type + priority it is, whether the model was confident,
whether it carries a concern, and whether it's valid (has a When/Then) — without expanding. On
expand: the full editable scenario, with the concern decoded and the confidence shown read-only.

## THE SCREEN TODAY (what a screenshot cannot tell you)
- **Overview story row:** a hand-rolled flat-white card (`rgba(255,255,255,0.72)`, a 4px coloured
  left-accent for rows that need attention — red=failed/removed, orange=stale/edited/partial). It
  holds the story name, a cluster of small status chips, small text-button actions (Regenerate,
  Copy Gherkin, Copy CSV), and the blue **"Open ->"** button. This is the "view/edit list of all
  stories + their test cases" the partner explicitly likes and wants KEPT.
- **Wizard header:** a "<- All stories" back link, the story name, the same status chips, the same
  Regenerate/Copy actions, then the **4-step Stepper** (our WizardKit stepper, already
  moodboard-styled, with per-step case counts + a small warning marker on a step that has an
  invalid case). KEEP the stepper.
- **A type step (1-3):** lists only that type's cases as **collapsible cards** (collapsed by
  default; a newly added case opens). Each card's collapsed header = a chevron, `#N` (its number
  within the type), a **type dropdown** (colour-coded: happy=green, edge=orange, negative=red — and
  it is an editable select, the reviewer can re-type a case), a **priority dropdown** (today
  visually NEUTRAL / grey — no severity colour), the editable title, a warning icon if the case has
  no When/Then, and a delete. Expanded = the concern field (raw editable text), the Scenario (BDD)
  Given/When/Then lists, the Expected result, Test data, and an **"Covers"** AC-checklist (the
  reviewer ticks which acceptance criteria this case verifies — this is how coverage is computed;
  they never type the AC text). The Covers panel ALSO has an "Inferred - verifies behaviour with no
  authored AC" toggle, read-only shared-AC chips, and a live stale-reference sub-callout (a ticked
  AC that no longer matches the current story) - the redesigned expanded card must keep all of
  these. There is a per-case Save / Revert footer when a case is edited.
- **Coverage & trust step (4):** a "test cases by type" count line (a 0-count type is flagged as a
  possible under-tested gap), then either a list of **acceptance criteria with no test case** +
  **references that no longer match a current AC** (both amber), or a green "every AC is covered".
- The card + rows are **hybrid-styled** (Tailwind utility classes + inline `var(--s2j-*)` tokens),
  but the card glass is a hardcoded flat white, and the chips are ad-hoc small coloured spans — the
  visual generation BEFORE the moodboard token rollout. That is exactly what to modernize.

## THE FULL DATA PALETTE (tag every datum; T0 = already in hand, T1 = client-derivable, T2 = one backend field, T3 = AI)
**Per test CASE (all T0 — already parsed and on the object):**
- `title` (string) · `type` (`happy-path` | `edge` | `negative`) · `priority` (`Critical` | `High`
  | `Medium` | `Low`, **optional**) · `given[]` / `when[]` / `then[]` (BDD steps) ·
  `expected_result` (the single falsifiable assertion) · `test_data[]` (optional concrete values) ·
  `ac_trace[]` (`{kind: story-ac | shared-ac | inferred, ac_text?}` — what the case covers).
- ⭐ `confidence_indicator` (the glyph `✓` / `⚠` / `✗`, **optional**) + `confidence_score` (integer
  0-100, **optional**) — **the model's own per-case self-rating; carried today, shown NOWHERE.** The
  two are INDEPENDENT optional fields — either, both, or neither may be present, and they are not
  enforced to agree. Visual mapping: `✓` -> green check (~80-100), `⚠` -> amber warning (~50-79),
  `✗` -> red cross (~0-49). **The single most valuable hidden signal for this audience.**
- ⭐ `concern` (`"[TYPE|severity] text"`, **optional**) — a typed risk the model flagged
  (RISK / AMBIGUITY / ASSUMPTION / TECH_DEBT / EXTERNAL_DEPENDENCY / COMPLIANCE). The field is
  hand-editable free text, so a real concern may be UN-prefixed -> it decodes to type `NOTE`
  (neutral) with the whole string as the text. A reusable frontend decoder already exists
  (`parseConcernPrefix` in `lib/v3Schema.js` -> `{type, severity, text}`, plus `CONCERN_TYPE_LABEL`
  friendly labels + a `SEVERITY_PALETTE` high=red / medium=orange / low=neutral). Shown today only
  as raw un-decoded text in the edit field; never decoded into a chip.
- Validity `[T1]` — a case with an empty When or Then is "invalid" (dropped on save); already
  flagged with a warn icon.

**Per STORY (T0):** `storyName` · `story.acceptance_criteria[]` (the ticked-against ACs) ·
`result.test_cases[]` · `coverage` (`{no_acs, total_acs, covered_acs, uncovered_acs[], coverage_pct,
complete, inferred_cases, shared_ac_refs, stale_refs[]}`) · `error` (failed-generation sentinel) ·
`truncated` (hit the output limit) · a per-story `usage` (raw input/output TOKEN counts, NOT
dollars, and shown nowhere today — the only USD figure is the SUITE-level run cost). Status
booleans (T0/T1): `isStale` (ACs changed since generation), `isRemoved` (story deleted from the
breakdown — orphaned cases), `isDirty` (unsaved edits), `regenState` (regenerating).

**Suite level (T0):** story count · total cases · run cost (USD, the customer's own key) ·
failedCount · a coverage rollup (fully-covered / partial / no-ACs counts).

> Note: the partner has APPROVED surfacing the three hidden per-case signals (confidence badge,
> decoded typed-concern chip, coloured priority) — all T0, presentation-only. Please design them in.

## MUST KEEP (hard constraints — do NOT redesign these)
1. **The two-view structure**: an overview list of story rows -> "Open ->" -> the per-story view.
   Keep the "view/edit list of all stories + their test cases" model.
2. **The blue "Open ->" button** (blue fill, white text) — the partner explicitly likes it. Keep
   its colour + placement on the story row.
3. **The 4-step wizard** with exactly these steps in this order: `1 Happy-path`, `2 Negative`,
   `3 Edge`, `4 Coverage & trust`. Keep the stepper.
4. **The editable, collapsible test-case card** with its edit affordances (editable title / type /
   priority / concern / Given-When-Then / Expected result / Test data / the "Covers" AC-checklist)
   + the per-case Save / Revert footer. This is an EDITING surface — do not turn it read-only or
   remove editors.
5. All statuses/states must still be representable (see STATES below). Export to Gherkin/CSV stays.

## MODERNIZE (the actual ask — MUSTs)
1. **The test-case card** = a proper moodboard card (our visible ice-gradient glass, correct
   radius/soft blue shadow, calm spacing), whose **collapsed header carries trust at a glance**:
   type · priority (now colour-coded by severity) · title · **a confidence badge (the `✓`/`⚠`/`✗`
   glyph as a green/amber/red icon + the 0-100 score) when the model rated it** · **a compact
   typed-concern chip when present** · the validity warning · delete. On **expand**: the concern
   decoded (a typed chip + severity) ABOVE the still-editable raw concern field, and the confidence
   shown read-only, then the scenario editors. Indicator + score are INDEPENDENT (either alone, both,
   or neither). Confidence + concern render ONLY when present (graceful absence — many cases have
   neither; an absent signal shows nothing, never a hollow "unknown" chip).
2. **The overview story row** = the same visible moodboard glass card (keep the coloured
   left-accent-by-state), with the status chips redrawn in our moodboard chip style (dark text on a
   tinted pill, colour on the icon/dot — the WCAG-on-glass rule), the blue "Open ->" kept.
3. **All the small chips** (coverage badge, "ACs changed", "edited", "Failed", "may be truncated",
   type-distribution) -> the one consistent moodboard pill language.
4. **The banners** (page-edited-since / breakdown-edited-since / downgraded read-only / the
   "Refresh N affected" control) -> our SignalCallout treatment (dark text, coloured icon).
5. **The Coverage & trust step** -> moodboard: the type-count line as chips (a 0-count type stays a
   warning), the uncovered-ACs / stale-refs lists as warning callouts, the all-covered state as a
   success callout. (Keep it a simple honest read of what's covered — do NOT turn it into a big new
   readiness-scoring dashboard; just restyle the existing pieces.)
6. **The suite summary bar + the screen header** -> the moodboard header + a calm inset summary.

## THE DESIGN SYSTEM (moodboard — same as the screens you already did)
Blue-on-white monochrome + glassmorphism. Reference `docs/DESIGN-SYSTEM-MOODBOARD.md`. Key facts:
- **Glass must be VISIBLE on white**: cards use an ice->white gradient wash (not a flat near-white
  fill), a soft BLUE-tinted shadow (`rgba(5,38,89,...)`, never grey), radius 12-16 stepping down
  with nesting. Navy `#021024` headings, steel/sky-steel secondary text, ice `#C1E8FF` accents, the
  page floats on a faint ice wash `#f7faff`.
- **Action-button colours are FIXED and semantic**: **green = commit/submit** (Generate, Continue
  to Push), **blue = navigate/open** (the "Open ->" button, links) **and the per-case "Save changes"
  affordance on THIS surface** — Save is BLUE today, matching the "edited = blue" state language of
  the cards; **keep Save BLUE for this refresh, do not repaint it green** (a convention change is a
  separate decision, out of scope here) — **red = destructive** (delete, armed confirm). Do not
  otherwise repaint these.
- **Severity stays a true signal** (traffic-light): check/success = green, warn = amber, cross/error
  = red, info = blue. **On a tinted pill the TEXT stays dark navy and the COLOUR rides the icon /
  dot / border** (light-on-light-tint fails WCAG on our near-white glass). Colour is never the only
  signal — always an icon/shape + a text label.
- **Type scale**: navy headings (h2 ~22, h3 ~14-18, bold), body ~13-14, labels tiny uppercase
  ~10-12 muted, micro ~11. System font stack (no paid fonts).
- The **pre-flight-card pattern** (tri-state verdict + tiles + on-demand detail) is our house
  go/no-go read — but here the card is small; borrow its calm, not a full verdict hero.

## STATES THE DESIGN MUST COVER (exhaustive)
- Overview: a mix of story rows — normal, **stale** (ACs changed), **edited/dirty**, **failed
  generation** (no cases, un-openable, red), **removed from breakdown** (orphaned cases, cannot
  regenerate), **partial coverage**, **may-be-truncated**, plus the paid-action banners. 3 to 40+
  stories — must scan cleanly at both.
- The wizard: a normal story; a **no-ACs** story (every case inferred — the lowest-trust state); a
  **regenerating** story (editing paused); a **downgraded read-only** viewer (Standard edition
  viewing retained cases — the whole surface is disabled but still readable + exportable); an
  **empty type-phase** (e.g. 0 Negative cases — an under-tested signal, NOT an error).
- The card: collapsed vs expanded; a case WITH vs WITHOUT confidence; WITH vs WITHOUT a concern; an
  **invalid** case (no When/Then); a newly-added case (opens by default); an edited (dirty) case
  with its Save/Revert footer.
- Coverage step: fully covered (green) · uncovered ACs + stale refs (amber) · no-ACs (inferred).
- ~<=20 cases per story. Confidence + concern are frequently ABSENT — design the card so it reads
  clean and complete without them.

## FIXED — DO NOT REDESIGN
- The two-view IA, the 4 wizard steps + their order, the blue "Open ->" button, the editing model,
  the export-to-Gherkin/CSV flow, the button-colour convention.
- Forge iframe: **page-scroll only** — never full-height panes, never an internal scroll trap. All
  content flows and grows the page.
- Do not invent data. Everything above is T0/T1; no new AI calls, no new backend.

## WHAT I WANT BACK
1-3 on-brand redesign directions for the **Test Cases surface**, prioritising the **individual
test-case card** (collapsed + expanded), then the overview story row, then the wizard header +
Coverage step. For each element label its data tier. Keep the exact structure + the 4-step wizard +
the blue Open button; this is a **restyle-and-surface** pass, not a re-architecture. Show how the
confidence badge + typed-concern chip + coloured priority sit on the card cleanly (and how the card
looks when they're absent). Keep it a fast glance; reuse the moodboard chip/callout/card vocabulary
from the screens you already did for this app.
