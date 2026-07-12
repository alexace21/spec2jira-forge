# IMPL-SPEC — Test Cases presentation refresh (Round 8, direction 1A)

> **Phase 2 spec.** The partner approved the Claude Design "Round 8" mockup, card direction **1A
> (right-edge trust cluster)**. This spec encodes that mockup 1:1 against the real components.
> Nature of the change: **PRESENTATION-ONLY visual refresh** + surfacing three already-present
> per-case signals (confidence / typed-concern / priority). **No IA reframe. No backend. No new
> resolvers. No changed prop contracts.** Branch `feature/UI-UX-improvements` (frontend-only ->
> no re-consent).

The mockup boards, all to build: **1A** collapsed card · **EXP** expanded card (shared) · **1C**
overview story row + screen chrome · **1D** Coverage & trust step · **1E** preserved states
(no-ACs / regenerating / read-only). The conductor has the images; this text is their faithful
encoding — build from THIS.

---

## 0. NON-NEGOTIABLES (presentation-only discipline)
- **Preserve ALL logic + data flow + props + state.** The components keep their EXACT prop contracts
  with `App.js` and each other. No prop renames, no new props to `App.js`, no changed resolver calls.
- **Preserve the state machine + invariants:** overview<->wizard `openStoryIdx`; the 4-step wizard
  (`phase` 1..4 = Happy-path / Negative / Edge / Coverage & trust); the **ABSOLUTE-INDEX invariant**
  (type-phases are FILTERED renders; every callback passes the case's absolute array index —
  StoryWizard.jsx:339-357 today); the draft / Save / Revert / per-case-footer / `structurallyShifted`
  / coverage / export / push model; every state (stale / edit-stale / removed / failed / truncated /
  no-ACs / downgraded-read-only / dirty / regenerating / invalid). If a behaviour exists today it
  behaves IDENTICALLY after.
- **Keep the blue "Open ->"** (`className="btn-nav"`), the green `.btn-primary` "Continue to Push",
  the button-colour convention (green=commit / blue=nav / red=danger). **The per-case "Save changes"
  stays BLUE** (the "edited = blue" language) — do NOT repaint it green.
- **Forge iframe:** page-scroll only. NEVER `100vh`, never an internal scroll trap. (Already
  compliant — keep it.)
- **ASCII-only in code.** No curly quotes / smart quotes / en/em dashes in JS string literals (the
  smart-quote compile-break trap). After edits, a byte sweep for the curly set must be clean.
- **Tokens + primitives, not hardcoded flat glass.** The one legitimate raw-rgba is the
  `glassSurface` gradient recipe itself (reuse the helper).
- **Do NOT expose Claude-Design internal tags** — the mockup shows a small "T0" tag on the summary
  bar; that is a data-tier annotation, NOT product. Do not render it (last session stripped the same
  tier tags from Diagnostics).

## 1. Files
1. `static/hello-world/src/components/moodChips.jsx` — **NEW** shared primitives (single source of
   truth; both the card and the containers import it -> no divergence).
2. `static/hello-world/src/components/EditableCaseRow.jsx` — the individual card (1A collapsed + EXP
   expanded) + the new per-case signals.
3. `static/hello-world/src/components/StoryWizard.jsx` — `StoryRow` (1C), `StoryChips`,
   `CoverageBadge`, `StoryActions`, `StoryWizard` shell + Coverage step (1D) + 1E states.
4. `static/hello-world/src/components/TestCasesScreen.jsx` — screen chrome (1C header, SummaryBar,
   banners, GeneratePrompt, ExportBar, top bar).
5. `static/hello-world/src/components/AcTraceEditor.jsx` — light label/spacing polish only.

**Verify actual export names before importing** (`./moodboard`, `./WizardKit`, `./Signal`, `./Icon`,
`./lib/v3Schema`). Reconnaissance: `glassSurface(density)`, `MoodCard`, `MOOD`, `TYPE`, `DENSITY_PAD`
from `./moodboard`; `MOOD`, `WIZARD_WRAP`, `Stepper` from `./WizardKit`; `SignalIcon`, `SignalCallout`
from `./Signal`; `parseConcernPrefix`, `CONCERN_TYPE_LABEL`, `SEVERITY_PALETTE` from `./lib/v3Schema`.

## 2. moodChips.jsx (NEW — the shared primitives)
Pure presentational, dependency-light (import `SignalIcon` from `./Signal`; `parseConcernPrefix` +
`CONCERN_TYPE_LABEL` from `./lib/v3Schema`). Text ALWAYS `var(--s2j-text)` (dark navy) on tinted bg;
colour rides the icon/dot/border (WCAG-on-glass). Export everything below.

- **`TONE`** map (the one place tones are defined): `neutral | info | warning | error | success |
  trust` -> `{ bg, border, fg }`:
  - neutral -> `var(--s2j-bg-section)` / `var(--s2j-border)` / `var(--s2j-text-muted)`
  - info    -> `var(--s2j-blue-bg)` / `var(--s2j-blue-border)` / `var(--s2j-blue)`
  - warning -> `var(--s2j-orange-bg)` / `var(--s2j-orange-border)` / `var(--s2j-orange)`
  - error   -> `var(--s2j-red-bg)` / `var(--s2j-red-border)` / `var(--s2j-red)`
  - success -> `var(--s2j-green-bg)` / `var(--s2j-green-border)` / `var(--s2j-green-dark)`
  - trust   -> `var(--s2j-trust-bg)` / `var(--s2j-trust-border)` / `var(--s2j-trust)`
- **`Chip({ tone='neutral', icon, title, children, style })`** — a pill: `display:inline-flex`,
  `alignItems:center`, `gap:6`, `borderRadius:999`, `padding:"2px 9px"`, `fontSize:11`,
  `fontWeight:500`, `background:TONE.bg`, `border:1px solid TONE.border`, `color:var(--s2j-text)`.
  `icon` node first (a `SignalIcon` or a 6px dot in `TONE.fg`). `title` -> the `title` attr.
- **`ConfidenceBadge({ indicator, score, size })`** — the model's per-case self-rating. Render
  **only when `indicator` OR `score` is present** (both OPTIONAL + INDEPENDENT; else return `null`).
  Resolve the tone/glyph: use `indicator` (`✓`->success, `⚠`->warning, `✗`->error) if present; else
  derive from `score` (`>=80`->✓/success, `50-79`->⚠/warning, `<50`->✗/error). Render a compact
  pill: a `SignalIcon kind={success|warning|error}` + (score != null ? the number, dark : nothing).
  `title="Model self-rated confidence for this case"`. Small — sits in the collapsed right cluster.
- **`ConcernChip({ concern })`** — decode `parseConcernPrefix(concern)` -> `{type, severity, text}`
  (an un-prefixed string -> `type:'NOTE'`). Render `null` for an empty/whitespace concern. Tone by
  type: `COMPLIANCE | RISK | EXTERNAL_DEPENDENCY -> warning`; everything else (`AMBIGUITY |
  ASSUMPTION | TECH_DEBT | NOTE`) -> `neutral`. Label = `CONCERN_TYPE_LABEL[type]` (uppercase-ish,
  e.g. "Compliance", "Assumption", "Ext. Dep", "Note"), rendered as a `Chip` with a small dot in the
  tone `fg`. `title` = the full concern text. This is the COLLAPSED compact chip (type only).
- **`ConcernStrip({ concern, style })`** — the EXPANDED decoded strip: a warning/neutral tinted box
  (`padding:"8px 12px"`, `borderRadius:12`, tone bg/border) containing: a `Chip` with the type label
  (tone) + a small severity chip (SEVERITY_PALETTE colour on the dot; "High severity" / "Medium" /
  "Low") + the concern `text` (dark). Render `null` when no concern.
- **`priorityTone(priority)`** -> a tone key: `Critical->error`, `High->warning`, `Medium->info`,
  `Low->neutral`, absent/unknown -> `null`. Used to tint the editable priority `<select>`.

## 3. EditableCaseRow.jsx — the card (1A + EXP)
Read the file first. It is `<fieldset disabled={readOnly}>` with a collapsed-by-default header + an
expandable body. Preserve ALL of it (the `role="button"` chevron span that survives the disabled
fieldset, the collapse state, `EditableField` / `StringListEditor` / `FieldBlock` / `AcTraceEditor`,
the per-case Save/Revert footer, the delete 2-step confirm, the invalid (no When/Then) detection, the
type `TYPE_BADGE` colouring, `caseNumber`).

**Card surface:** replace the hardcoded flat glass with `glassSurface("utility")`. Add a
**left-accent-by-state** (4px `borderLeft`, the FocusedStory pattern): `dirty -> var(--s2j-blue)`,
else `invalid -> var(--s2j-orange)`, else transparent. New cases still open by default.

**Collapsed header (1A), left -> right:**
1. chevron (`role="button"` span, rotates when open — KEEP the exact a11y span).
2. `#{caseNumber}` (muted).
3. **type** editable `<select>` — keep the colour-by-type (happy=green / edge=orange / negative=red);
   align its pill look to the `Chip`/tone treatment. Stays functional (reviewer can re-type a case).
4. **priority** editable `<select>` — now COLOURED by `priorityTone(priority)` (dark text on the tone
   tint). When priority is ABSENT (`null`), render a LOW-EMPHASIS "Set priority" placeholder select
   (muted text + a subtle/dashed border) — NOT a signal chip. Stays editable.
5. **title** — inline `EditableField` (14px semibold dark). `flex:1`.
6. **[right cluster]** (only the parts whose data exists — graceful absence): `ConfidenceBadge`
   (indicator/score) · `ConcernChip` (compact type chip) · the **invalid marker** (a
   `SignalIcon kind="warning"` + "needs When/Then" when the case has no When/Then, shown when
   collapsed) · **delete** (the existing 2-step confirm; red-on-hover / armed).
   A case with none of confidence/concern/invalid shows only the delete at the right (clean, like
   mockup case #5).

**Expanded body (EXP), top -> bottom:**
1. **Trust panels row** (only the panels whose data exists; omit the whole row if neither):
   - LEFT: a "MODEL SELF-CONFIDENCE - READ-ONLY" panel — a tinted box (tone from the resolved
     confidence) with the `SignalIcon` glyph + `"{score}/100"` (or the glyph alone if no score) + a
     one-line caption `"The model rated this {high|medium|low}. Look closer before you sign."`
     (band from indicator/score). **READ-ONLY** — confidence is the model's fixed read, never
     user-editable. Render only when confidence present.
   - RIGHT: `ConcernStrip` (the decoded typed chip + severity + concern text). Render only when a
     concern is present. If only one of the two exists it may span the row width.
2. **Concern editor:** label "CONCERN - EDITABLE - [TYPE|severity] TEXT" + the EXISTING raw editable
   `EditableField` (the `[TYPE|severity] text`), placeholder preserved. The raw field STAYS — the
   decoded strip above is display-only; editing is unchanged.
3. **Scenario (BDD):** "SCENARIO (BDD)" heading + GIVEN (preconditions) / WHEN (action) / THEN
   (outcome) `StringListEditor`s (+Add), moodboard labels + outlined boxes.
4. **Expected result:** "EXPECTED RESULT - THE SINGLE FALSIFIABLE ASSERTION" label + the editable
   field.
5. **Test data:** "TEST DATA - OPTIONAL" + `StringListEditor` (+Add); empty -> a muted
   'none - "+Add" to attach concrete values'.
6. **Covers:** the `AcTraceEditor` (checklist + live stale-ref sub-callout + Inferred toggle +
   shared-AC chip) — unchanged logic, polished labels (see section 5).
7. **Per-case footer** (when dirty): a "* Unsaved edits" (blue) marker + `Revert` (neutral) + blue
   "Save changes" — KEEP the exact per-case footer logic (`showSaveBar` / `caseIsDirty` / the
   story-level fallback in StoryWizard remains for the structurally-shifted case).

## 4. StoryWizard.jsx
### StoryRow (1C overview card)
- Surface: `glassSurface("minor")` KEEPING the existing `borderLeft: 4px solid ${accent}` logic
  verbatim (red=failed/removed, orange=stale/edited/partial, transparent normal — StoryWizard.jsx:190).
- Keep: story name (navy 14), `StoryChips`, `StoryActions` (Regenerate / Copy Gherkin / Copy CSV as
  small secondary buttons), blue `btn-nav` "Open ->". For a FAILED story the "Open ->" is
  disabled/greyed (mockup) and the row shows "generation failed - no cases". Keep `React.memo` + props.
### StoryChips + CoverageBadge
- Re-implement each chip via `Chip` (moodChips) with the same tones + EXACT show/hide conditions +
  titles: Removed -> error (IconBan), ACs-changed -> warning, edited -> info (dot), Failed -> error
  (SignalIcon), truncated -> warning, type-distribution -> neutral. `CoverageBadge` -> a `Chip`
  (`success` 100% & no-stale; `warning` partial or stale; `neutral` no-ACs) with the same
  `label`/`title`. Behaviour identical.
### StoryWizard shell
- Header: "<- All stories" (blue back link), story name `<h3>` (18/700/navy, keep), `StoryChips`,
  `StoryActions`. Modernize spacing.
- Stepper (WizardKit `Stepper`) — leave as-is (already moodboard; carries the `{count,warn}` dots +
  the Coverage `warn`).
- Type-phase intros / empty states / "+ Add {type} case" (blue ghost-add) / `movedNote` / `no_acs` /
  `isPolling` notices -> moodboard `TYPE` scale + tokens; keep copy. `movedNote` uses
  `SignalIcon kind="info"` (already).
- Case list -> `EditableCaseRow` — WIRING UNCHANGED (every callback passes the ABSOLUTE index `i`).
### Coverage & trust step (1D, phase===4) — restyle, KEEP logic + copy
- Type-distribution -> each type a `Chip`: a 0-count type -> `warning` tone + "under-tested?"
  suffix; non-zero -> `neutral`. Same counts.
- Uncovered-ACs box + stale-refs box -> `SignalCallout kind="warning"` (same headings + verbatim AC
  lists + the "Add a case + tick the AC / Regenerate" hint).
- The all-covered state -> `SignalCallout kind="success"` "Every acceptance criterion is covered by
  at least one test case."
- The dirty / saved / structurally-shifted Save-Revert fallback bar -> a moodboard info/error tinted
  bar (blue Save with white text stays). Keep the "reflects your last SAVE" note. Do NOT turn this
  step into a scoring dashboard — just restyle the existing pieces.
### 1E preserved states (restyle the existing handling)
- **no-ACs:** the existing `result.no_acs` path -> a `SignalCallout kind="warning"` "This story has
  no acceptance criteria - every case is inferred. Coverage can't be computed; review each case on
  its own merit." + cases carry an "INFERRED" `Chip` (neutral). Keep the existing no_acs logic.
- **regenerating (`isPolling`):** dim the case list + a centered "Regenerating - editing paused" pill
  (spinner icon). Keep the existing editing-paused behaviour.
- **downgraded read-only (`readOnly`):** a `SignalCallout kind="info"` "Read-only - Standard edition.
  Editing is off, but you can still read and export these cases." + the disabled `<fieldset>` +
  Copy Gherkin/CSV available. Keep the existing readOnly gating.

## 5. TestCasesScreen.jsx (1C chrome)
- **Top bar:** keep "<- Back to Review" + page title + `ExportBar` ("Copy All - Gherkin" / "Copy All
  - CSV") + green `.btn-primary` "Continue to Push ->". Keep the 2-step armed logic on Back + Push.
- **Body header:** replace the plain `<h2>Test Cases</h2>` with the moodboard title (`fontSize:22`,
  navy, a leading BLUE `IconBeaker`) + `TYPE.sub` subtitle (keep the copy meaning). Static, not
  sticky.
- **SummaryBar:** keep ALL data + logic (story count, total cases, cost echo "$X used - your key",
  failed + retry, coverage rollup fully-covered/partial/no-ACs). Restyle to a calm moodboard inset;
  render the counts + coverage-rollup as `Chip`s (success for "N fully covered", etc.). Same numbers;
  do NOT make the rollup staleness-aware (out of scope). **Strip the "T0" tier tag.**
- **Banners** — restyle to `SignalCallout`, keep BOTH distinct banners + their conditions + copy:
  `StaleBanner` (Confluence page-version drift) -> `kind="warning"`; `EditStaleBanner`
  (breakdown edited in-app, with the affected-count) -> `kind="warning"`; the downgraded read-only
  notice -> `kind="info"`. The "Refresh N affected" armed button (on the edit-stale path) keeps its
  2-step armed logic + copy, restyled to a warning affordance with a blue action. Do NOT merge the
  two banners — the mockup's single banner is illustrative; keep both code paths.
- **GeneratePrompt** (defensive fallback): -> a `MoodCard` (`density="minor"`, centered) + the green
  `.btn-primary` generate button + copy.
- **Overview list:** unchanged wiring (`perStory.map` -> `StoryRow`).

## 6. AcTraceEditor.jsx — light polish only
No logic change. Align the "Covers" label + AC-checklist spacing/type to the moodboard scale. It
already uses `SignalCallout` for the live stale-ref warning — leave that. The shared-AC chips + the
Inferred toggle may adopt the `Chip` look for consistency; keep every behaviour.

## 7. Graceful-absence + a11y (MUST)
- `confidence_indicator`, `confidence_score`, `concern`, `priority` are ALL OPTIONAL per case. Every
  new chip/panel renders `null` when its datum is absent — NEVER a hollow "unknown" chip, never an
  empty slot (mockup case #5 = zero signals + still clean/complete). Confidence indicator + score are
  INDEPENDENT — the badge survives indicator-only, score-only, both, neither.
- Colour is never the only signal: every chip carries TEXT + an icon/dot. `readOnly` mode still
  renders the display chips/panels (they're not edits).

## 8. Build-verify (before reporting done)
From `static/hello-world`:
`npm run build > /c/Users/ALEXAS~1/AppData/Local/Temp/tc_build.log 2>&1; echo NPM_EXIT=$?; grep -E "Compiled|Failed|Error" /c/Users/ALEXAS~1/AppData/Local/Temp/tc_build.log | head`
NEVER `| tail` (returns tail's exit -> false green). Report NPM_EXIT + the Compiled/Failed line. Then
byte-sweep the changed files for curly quotes/dashes and confirm clean.

## 9. Report back
- Files changed + a per-file summary of the visual changes.
- Explicit confirmation that NO logic / prop / state / invariant changed — call out the
  absolute-index invariant + the save/coverage model + the per-case-footer model by name.
- Build result (NPM_EXIT + Compiled line) + the curly-quote sweep result.
- Any reconnaissance/export mismatch and how you resolved it.
