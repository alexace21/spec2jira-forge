# Spec2Tickets — Claude Design Brief: Next Screens

> **What this is.** A brief to get **1:1 redesign proposals** for the 8 screens below (the way we just
> redesigned the ReadyScreen "Pre-flight check" card). **You will already see the current UI from a
> screenshot** — so this brief deliberately spends its words on the things a screenshot *can't* tell you:
> **the goal, the audience's real fears + what a "win" feels like for them, the ONE decision, what "good"
> looks like, and — above all — the high-value data each screen already has but throws away.** Design from
> what we HAVE + what the user CARES ABOUT, not from what's on the screen today.
>
> **Per-screen framework:** *Goal · Who it's for & what they fear/want · The ONE decision + what "good" looks
> like · What we already have to build with · ⭐ Signals we compute but never surface · States the design must
> handle · Guardrails · Highest-value directions · Today (one line) · The ask.*

---

## PART A — Shared context (read once, applies to every screen)

### The product
**Spec2Tickets** — an Atlassian **Forge** app (Confluence Custom UI, React) that turns a Confluence spec page
into a structured **Jira breakdown** (1 Epic → Stories → Subtasks, with cross-feature dependencies, sizing,
labels) using **Anthropic Claude**. It is **BYOK** — the customer pastes their own Anthropic key and pays
Anthropic **pay-as-you-go** directly. The **Advanced** edition adds AI **test-case generation** + a **capacity
planner**. No Spec2Tickets-operated backend — everything runs in Forge + the customer's own Atlassian +
Anthropic. Generation runs on Anthropic's **async Batches API** (2–10 min, opaque until it completes).

### The user journey (state machine)
```
picker → ready (pre-flight ✅ done) → generating → insights → reviewing (Breakdown Editor)
       → confirming (Review) → pushing → pushed
                                   └─ (Advanced) Test Cases · Capacity Planner
Utility (off-flow): Admin Settings · Diagnostics
```

### Two things that colour EVERY screen's emotional design
1. **It's the user's own money + their name.** Every generation is a real charge on the user's **own** Anthropic
   key, and the output becomes **real Jira issues their team estimates and builds from**. So the recurring fears
   are **cost-anxiety** ("what is this costing me / am I paying twice?") and **reputation-anxiety** ("will I
   look careless if the AI got something wrong and I pushed it under my name?"). Good screens convert those
   fears into **directed confidence**.
2. **Async you can't see.** Work runs in the background with no server process; the app is the only place that
   reconstructs "did my spend pay off, is anything still running, did anything fail, is anything about to be
   auto-deleted?"

### Audiences
- **Product Owner / Business Analyst (primary).** Non-engineer. Owns the spec, reviews/edits, decides go/no-go,
  commits to Jira. Wants trust, fast orientation ("where do I look?"), and to not waste time or money.
- **QA / test lead (Advanced).** Sign-off-grade review of AI-drafted test cases — fears shipping a suite that
  *looks green but silently omits an acceptance criterion*.
- **Site admin (utility screens).** Configures once for the **whole instance** (so a mistake breaks it for
  everyone → accountability fear), and debugs failures under time pressure.

### Design system (moodboard) — `docs/DESIGN-SYSTEM-MOODBOARD.md`
Blue-on-white monochrome + glassmorphism. Navy `#0a2440` (text/headings), steel `#5483B3`, sky-steel `#7DA0CA`,
ice `#C1E8FF` (borders/section fills); page on a faint ice wash. Primitives in code: `MoodCard` (glass, 3
densities), `ScreenHeader`, `Stepper`, `SignalCallout`/`SignalIcon` (traffic-light). System font stack (no paid
fonts). **The pre-flight card is the house pattern for any go/no-go read** — a tri-state verdict + answer tiles
+ an on-demand detail, all from deterministic already-computed facts. Echo it on Confirm, Settings, the
Test-Cases "Coverage & trust" step, and Insights.

### Load-bearing invariants (NON-NEGOTIABLE)
1. **Forge iframe auto-sizes to CONTENT.** Every screen **page-scrolls**. **Never** `100vh`, **never** an
   internal scroll trap (`max-height` + `overflow:auto`). Tall content grows the page.
2. **Action-button colours are fixed:** **green** = commit/submit, **blue** = navigate/open, **red** =
   destructive. Pick by INTENT.
3. **Semantic severity stays a true signal** (traffic-light tints + data badges encode meaning; never
   decorative, never repainted brand-blue).
4. **A11y:** colour never the only signal (shape/icon + text label); real `<button>`s + `aria`; keyboard + SR
   parity. *(Recurring gap to fix: actionable hints hidden in hover-only `title` tooltips.)*
5. **English** copy; **system font stack** only.

### The data-tier taxonomy (tag every datum)
- **T0** — FREE. Already in the component's props/state or the resolver response it already receives.
- **T1** — client-side derivable (pure JS over present data). Zero backend.
- **T2** — one small backend addition (a resolver field / bounded call). *Flag these so we can weigh the cost.*
- **T3** — needs an AI call (out of cheap scope).
> ⚠ **We corrected many mis-tiered items during research** — several things the first draft called "T2" are
> actually **T0** (the raw field is already there; only an aggregate is derived). These corrections are marked
> **[was T2 → T0]** below because they change what's cheap vs expensive.

---

# PART B — Per-screen briefs

---

## 1. Page Picker — the home / async work overview

**Goal.** Locate a Confluence spec page (recent · cross-space search · manual page-ID) AND reconstruct the
user's **async work in flight** (a live multi-batch dashboard grouped by status).

**Who it's for & what they fear/want.** A PO/BA who fired generations they can't see. Their emotional core is
**loss-anxiety + cost-anxiety**, not "finding a page." Two concrete fears the code makes real: (a) **double-
spending** — re-generating a page that already has a completed/in-flight breakdown = paying twice; (b) a
completed-but-unpushed breakdown they **paid for is silently auto-deleted after 7 days** (`ORPHAN_INACTIVITY_MS`)
— "which of my results is about to expire?" is a real stake the screen never answers. A **win** = the calm of
*"I can see all my in-flight and finished work, nothing is lost, nothing's about to be deleted, and I know which
to resume — before I spend again."* The first-run **admin** is a different person entirely: their win is trust
("is this real/safe for my Jira?"), which the one-gray-sentence empty state under-serves.

**The ONE decision + what "good" looks like.** *"Which page do I open, and do I already have work I should
resume rather than restart?"* **Good** = in one glance the user answers *do I have work running · is any done ·
is any about to expire · did anything fail* — then decides whether to spend again.

**What we already have to build with.** Recent pages `[T0]` (`{id,title,spaceKey,spaceName,lastSelectedAt}` ×10)
· search results `[T0]` (`{id,title,spaceKey,spaceName}` ×20) · dashboard jobs `[T0]`
(`{jobId,pageId,pageTitle,status(pending|batched|completed|failed),startedAt}` ×10 per user) · per-row job
identity `[T0]` (route by the row's OWN `jobId`).

**⭐ Signals we compute but never surface (highest-value lever).**
- **7-day expiry countdown per completed job** `[T2]` — `jobmeta.lastAccessedAt` is written on every touch and
  the sweep deletes at `+7d`, but `getDashboardJobs` **drops** `lastAccessedAt`. **The single most valuable
  unused datum** — "expires in 2 days" directly answers the loss-fear. (One field on the existing jobmeta read.)
- **Per-completed-job feature count + cost** `[T2]` — the completed breadcrumb persists `counts.features` and
  `counts.cost_usd`; the dashboard shows zero size/cost signal. "Ready · 12 features · $0.11" on a row.
- **Failed-job error + detail** `[T2, and here's WHY]` — the failed `job:` record carries `{error,detail}`, but
  `getDashboardJobs` reads lean `jobmeta` first (status/title/startedAt only), so the reason isn't in the
  payload → surfacing it needs a jobmeta field OR a heavy deref (a real design choice, not free).
- **Diagnostic ref on failed rows** `[T0]` — the row already carries `jobId` (App sets `errorRefId = jobId` on
  a failed click), so a copy-ref-for-support affordance is possible **inline, no click-through**.
- **Real elapsed/finished time** `[T0/T1]` — `relAge(startedAt)` exists but is used only for in-progress rows;
  completed/failed rows show hardcoded strings and never say when they finished.
- **`lastSelectedAt` + `spaceKey`** `[T0, unused]` — Recent "last opened X ago" and space-grouping are free
  (but see the PageRow guardrail).
- **"You have N jobs running" hero predicate** `[T1]` — `dashboardJobs.filter(inFlight)` is already computed
  twice.

**States the design must handle.** In-progress (status only — **no per-job % is available; the batch is
opaque**, so honest progress = elapsed time + the coarse enum) · ready-for-review · failed · **degraded reads
that look identical to "empty"** (`getDashboardJobs` returns `{jobs:[]}` on ANY failure → the user's in-flight
work *appears lost*; `getRecentPages` fails silently the same way) · a job can **vanish** if jobmeta is missing
and the deref also fails · search error with structured detail (403 scope / egress-blocked / parse) currently
shows only the bare message. **Volumes:** worst case ~10 recent + 20 search + 10 dashboard ≈ **40 near-identical
rows** across four sections. **Frequency:** the poll runs every 15s and **MUST stop when idle** (a spinner on an
idle board would lie). **Must-never-miss:** a paid, completed-but-unpushed breakdown silently deleted after
7 days — bury the expiry signal and the user loses paid work with no recovery.

**Guardrails.** ⚠ **`PageRow` is a SHARED primitive with only title + spaceName slots** — dashboard subtitles are
crammed into the spaceName slot, so richer rows (counts/cost/expiry/failure) are a **shared-component refactor**,
not free data-wiring (it also renders search + recent). Rows route by their OWN `jobId` (a co-worker
regenerating the same page must not mis-route). The dashboard is **per-user** (a user only sees THEIR jobs).
`getDashboardJobs` is a pure read. No green/red *buttons* here (no commit); blue = Open; red is reserved for the
danger SIGNAL.

**Highest-value directions.**
- **Elevate the async dashboard from three look-alike lists into a real "work in flight" overview**, and add the
  **7-day expiry as a calm "kept for 7 days" by default, escalating to amber/red only on the specific row <48h
  from deletion** (fixes both the loss-fear and the current double-red problem).
- **A "resume vs restart" guard** — fuse a page that appears in both a dashboard group and Recent into one row
  with a "you already generated this — resume?" affordance (matches by `pageId` `[T1]`; the screen's core
  double-spend win). **Surface the diagnostic ref inline on failed rows.** **Cost transparency** as a BYOK trust
  signal (per-job / session spend). **First-run onboarding aimed at the admin's trust question** (preview the
  async model itself — the app's most differentiated, least-obvious mechanic).

**Today (one line).** A search card + three visually-identical row stacks (Results / dashboard groups / Recent)
+ a red 7-day callout + a feedback nudge.

**The ask.** A home where "resume in-flight work" and "find a page" are two clear modes, the dashboard is a
legible status+expiry+cost overview, and failures explain themselves inline.

---

## 2. AI Insights — post-generate orientation

**Goal.** The first screen after a breakdown completes, before the editor: surface the model's self-assessment
+ the concerns it flagged so the BA/PO knows **where to focus** before investing edit time.

**Who it's for & what they fear/want.** A BA/PO who **just spent real money + minutes** and whose next click
either commits to a large edit investment or **discards the paid breakdown** ("Back to pages" is irreversible
loss). Their fear is **professional**: they're about to put their name on a breakdown their eng team will build
from — *"did the AI quietly get something wrong I'll be blamed for, and WHERE, so I don't burn scarce review time
on the 80% that's fine?"* A **win** = a fast, honest triage verdict: *"these features are solid, THESE 2 are
where you must look, here's the ONE compliance/risk landmine."* The screen's emotional job is to convert
post-generation anxiety ("did this black box do a good job?") into **directed confidence** — but the current copy
leads with doubt ("flagged areas to review", "not a guarantee") and under-delivers the reassurance side.

**The ONE decision + what "good" looks like.** *"Is this trustworthy, and what do I look at first?"* **Good** =
in one scan the user can name where to look AND whether to trust — with a defined bar for "too much to orient
from" (specs run 3–30 features; >50 = over-fragmented).

**What we already have to build with (all T0 from `extractV3Signals`).** overall_quality · avg confidence ·
confidence distribution (✓/⚠/✗) + **`confidence.missing`** (unrated count — a first-class field) · flagged-
feature worklist `[{name,indicator,score}]` (✗-first) · **spec concerns AND full feature-concern detail**
`[{featureName,type,severity,text}]` · ambiguity note · breakdown counts (features/tasks/ACs/**sharedACs**/deps)
· categories `[{name,featureCount}]` · **dependency edges `{source,target,targetDisplay}`** (targetDisplay =
current post-rename name) · `hasEpic`/`epicSummary`.

**⭐ Signals we compute but never surface.**
- **Per-feature sizing — `story_points`, `complexity_score` (1–5), `priority`** `[was T2 → T0]` — these are
  **required fields on every feature**; only the *sum/spread* is derived. **This is the biggest missed signal:**
  size + complexity + priority tell the PO the WEIGHT of what they generated, and the prompt itself flags
  uniform sizing as the #1 AI failure mode — so a complexity spread validates the model did its job.
- **Feature-concern full detail incl. `.type`** `[T0]` — the full array is already returned; the screen
  **chooses** to render only severity counts and **discards the type** (Ambiguity/Risk/Assumption/Tech-debt/
  External-dep/Compliance) — a type histogram is pure T0, not T1.
- **`confidence.missing`** `[T0]` — the ✓/⚠/✗ triad silently omits unrated features, so a breakdown the model
  rated NOTHING reads as clean-zero.
- **Breakdown shape** (counts + categories + `hasEpic` + `dependencyEdges.targetDisplay`) `[T0]` — never shown
  here (only later in Review); the user gets no sense of SIZE/SHAPE at first landing.

**States the design must handle.** Legacy/pre-v3 breakdown (no signals → `overall_quality` null but confidence
may render) · model omitted `overall_quality` (confidence renders without a quality label) · **all features
unrated** (triad all-zero but NOT "nothing flagged") · **up to three amber banners stack** (truncated + unsaved
+ stale) and can push the actual insights far below the fold · clean/empty state (must give positive closure,
not a near-blank screen). **Must-never-miss:** a **[COMPLIANCE|high]** spec-level concern (exists only at spec
level — the legal/regulatory landmine); it renders but competes visually with everything.

**Guardrails.** Read-only snapshot (no live re-compute; the editor's Regenerate is the only refresh). "Back to
pages" **discards** — keep that clear. Forward CTA stays green. Confidence/concern/quality tints are true data
signals. The flagged worklist is hard-sliced to 6 (arbitrary against a 30-feature norm). Feature `_uid` is
**stable across rename/reorder** — a durable deep-link target is essentially free.

**Highest-value directions.**
- **One actionable "attention" surface** = the flagged worklist + full feature-concern detail **grouped by
  feature** (name + type + severity + text), the screen's core value, currently half-discarded.
- **A "weight map"** cross-tabbing SIZE (story points/complexity) × CONFIDENCE × PRIORITY — a *large, complex,
  ✗-confidence, High-priority* feature is the true "look here first" landmine; none of this is visible today.
- **A breakdown shape/size header**; **reframe the lead from doubt to substance** ("N of M features high-
  confidence"); a **concern-TYPE fingerprint** (mostly Ambiguity = vague spec; any Compliance = legal review);
  deep-link flagged items toward the editor via `_uid`.

**Today (one line).** An "AI self-check" card (quality chip + ✓/⚠/✗ triad) + a 6-item flagged worklist + spec-
concern cards + a "+N feature concerns" counts line + a collapsed ambiguity note + a green "Edit →".

**The ask.** A confident "here's what you got, here's the weight, here's where the risk concentrates" orientation
— where the attention list is complete + actionable and a clean breakdown still feels substantive.

---

## 3. Breakdown Editor — the human-in-the-loop edit surface

**Goal.** The AI breakdown (Epic + Categories → Stories → Subtasks + shared ACs) as **editable cards** so a
BA/PO can fix names/stories/ACs, tune sizing/priority, curate ACs + labels before push.

**Who it's for & what they fear/want.** The BA/PO carrying a **career-flavoured fear**: *"I'm about to create
real Jira issues my whole team works from; if the AI hallucinated a wrong AC, mis-scoped a story, or fabricated
a dependency, that becomes MY mistake once it's in Jira — visible, hard to walk back."* Their motivation isn't
"edit text," it's *buy back trust in a machine artifact by finding the ~10–20% that's wrong before it hardens.*
A **win** = the confident feeling of *"I looked at everything that could bite me (the ⚠/✗ stories, the AI's own
flagged concerns, the unassigned shared ACs) and either fixed it or consciously accepted it"* — informed
sign-off, not re-authoring. The all-collapsed accordion **actively works against that win**: the risky content
(low-confidence stories, per-feature concerns — the AI literally raising its hand) is invisible until manually
clicked open, so the BA either over-trusts or over-labours. Secondary fear: **silently losing their own edits**
(Reset with no confirm; remount-on-entry) — trust in the TOOL.

**The ONE decision + what "good" looks like.** *"Is this correct enough to become Jira issues, and did I look at
everything risky?"* **Good** = "I saw the ✗-confidence stories + the flagged concerns + the unassigned shared
ACs, and my hand-written ACs were never silently mutated." This is a **once-per-spec, high-stakes single pass**
(the editor remounts + resets collapse each entry) — argues for **guiding-first-pass** design, not power-density.

**What we already have to build with (T0 unless noted).** Epic summary/description/labels · category name +
grouping · feature name/user_story/description · acceptance_criteria (editable) · priority/story_points
(editable) + complexity_score (read-only) · confidence_score + confidence_indicator · **`source_heading`
provenance** · concerns (`[TYPE|severity] text`) · labels · **`feature.dependencies` (present, UNUSED)** ·
stable `_uid` + `_orig_name` · tasks (`summary/type(7-enum)/description`) · shared ACs
(`{id,text,assigned_feature,removed_by_user,source_sections}`).

**⭐ Signals we compute but never surface.**
- **Cross-feature dependencies** `[T1]` — `feature.dependencies` is on every feature AND `getSignals` already
  builds the edge list with **rename-resolving `targetDisplay`**. The BA can't see/fix dependencies on the very
  surface where they edit features (deferred to Review). **The biggest gap.**
- **Per-category triage the CapabilityCard already computes** `[T1]` — `needsReview` (⚠/✗ count), `highPriority`,
  and a **complexity high/med/low bucketing** are computed *per card* but never rolled up to the top; the Stats
  bar shows only Categories/Stories/Tasks/SP and **no review-load number**.
- **The flagged worklist + averageScore** `[T1]` — `confidence.flagged` (✗-first, names+scores) is **already
  built**, just not imported here; `averageScore` gives a single trust number — unused.
- **Provenance + trust as a system** `[T0]` — `source_heading` (which stories trace to the spec vs inferred),
  the confidence badge, concerns, and read-only complexity/category are all "AI says (locked)" vs "you decide
  (editable)" — but styled ad-hoc; a unified "locked vs yours" language would make trust legible.
- **"Unsized / placeholder / storyless" flags** `[T1]` — SP can be cleared to null (story vanishes from Total
  SP); Add-Category/Feature inject literal "New Category"/"New Feature" placeholders that push verbatim; 0-AC
  features — all detectable, none flagged.
- **Downstream cost of an edit** `[T1]` — editing a story's name/ACs is exactly what **stales already-generated
  test cases** (they bind to `_uid`); the editor is the CAUSE but gives zero "edited since generation" feedback.

**States the design must handle.** First-run placeholder templates ("New Category"/"New Feature" that push
verbatim if unedited) · "no shared ACs" → the whole SharedACPanel silently **vanishes** · legacy/partial-stamp
features render with **NO trust badge** (a silent "unknown confidence" state distinct from ✓/⚠/✗) · empty
description/AC rendered as muted italic that looks like real content · deletes **silently no-op** at the
last-item floor (button still shows) · **Add-Category is a one-way trap** (creates a read-only-named category
you can never rename). **Must-never-miss:** a ✗-confidence or high-severity-concern feature pushed unreviewed —
those signals exist per-feature but sit behind 2–3 expansions with no global surfacing.

**Guardrails.** **Page-scroll only** (a prior `vh` collapsed the editor's pane to ~0 live). ⚠ **Shared-AC
assignment has SIDE EFFECTS** — it injects/removes the AC text into `feature.acceptance_criteria` as `{id}: text`
(so a feature's AC list mixes native + shared indistinguishably), and remove/unassign uses **substring match**
(`ac.includes(...)`) that can silently delete a *different* AC containing the same substring → **"good" must
include: the BA's hand-written ACs are never silently mutated.** Shared-AC binding is by feature **name** (not
`_uid`) → renaming orphans it. Category name is READ-ONLY (derived label). Story points = Fibonacci [3,5,8,13]
(out-of-set legacy preserved; can be cleared to null). TaskCard type dropdown is **portaled to `document.body`**
(ancestor `overflow:hidden`) — don't reintroduce clipping. Green=commit, blue=nav, red=delete.

**Highest-value directions.**
- **Surface dependencies inline** (T1, data present, rename-resolved) — a "depends on / blocks" affordance on the
  Story card closes the biggest edit-vs-see gap.
- **A review-triage layer up top** (roll up the per-category `needsReview`/`highPriority`/complexity mix + the
  flagged worklist + validation warnings) with **jump-to-card** links — turn the collapsed nest into a
  prioritized worklist; add expand-all / filter / search.
- **Unify "AI says (locked) vs you decide (editable)"** as one visual language (fixes the complexity-read-only-
  but-priority-editable confusion). **Give read-only Category cards a job** (roll their computed profile into a
  scan strip) or slim them down. **Safer Reset** (confirmable) + pre-push validation + a subtle "edited since
  generation → your test cases may be stale" marker.

**Today (one line).** A stats bar + an Epic card + a collapsed SharedACPanel + collapsed Category cards holding
collapsed Feature cards (sizing/ACs/tasks inside) + a green "Continue to Review →".

**The ask.** A guiding-first-pass workbench that leads the BA to everything risky (incl. dependencies) instead
of a deep nest of collapsed cards, and never silently mutates their edits.

---

## 4. Review & Push to Jira — the irreversible commit (Confirm → Pushing → Pushed)

**Goal.** Turn the reviewed breakdown into real Jira issues. **Confirm** = the last decision (what/where +
trim dependencies + optional Advanced side-quests + irreversible warning + push). **Pushing** = chunked
progress. **Pushed** = the terminal outcome (deep-links, honest partial-failure, last-chance test export,
post-push sprint/rank panels).

**Who it's for & what they fear/want.** A non-engineer about to make the app's **one irreversible, publicly-
visible write** into their team's shared Jira (co-workers see 40 wrong-named/mis-parented issues; no bulk-undo
from the app). Their deepest fears aren't "is the count right" — they're **"am I about to pollute the WRONG
project"** and **"will this silently half-finish and leave me an inconsistent Jira I don't know is broken."** A
**win**: on Confirm, calm one-glance certainty of WHAT + WHERE (*"40 items into project MOBILE — yes, that's
mine"*); on Pushing, trust that waiting is safe and it's actually progressing (not hung); on Pushed, closure
they can act on — proof of exactly what landed, honest naming of what didn't, a frictionless jump into Jira, and
**not losing the ONLY remaining copy of paid test work.** The emotional arc is **anxiety → commitment →
relief-or-recovery** — the real job is de-risking a commitment they can't take back and can't see the blast
radius of.

**The ONE decision + what "good" looks like.** Confirm: *"right project? right count? did I trim over-inferred
dependencies?"* — a go/no-go readiness read (the **pre-flight-card pattern applies directly here**). Pushing:
*"is it safe to keep waiting?"* Pushed: *"what landed, what didn't, where do I check, what's next?"*

**What we already have to build with (T0 unless noted).** dry-run totals (items/epics/stories/subtasks/
dependency_links) · shared-AC count · categories · dependency edges · test-case results + total + fresh/stale +
cost · edition capabilities · push progress + phase · **final result** (`created_issues[{name,key,uid}]`,
`epic_key`, `browse_base`, totals, `dependency_links_created`, `tc_embedded/skipped`) · **per-category partial-
failure counts + details** · diagnostics ref · **captured exports** (the only surviving copy) · plan context.

**⭐ Signals we compute but never surface (with critical tier corrections).**
- **Destination project name + key** `[was T2 → T0]` — **`defaultProjectKey` is already in App state and already
  rendered on the pre-flight card**; it's simply **not passed into ConfirmScreen**, which is why Confirm reads
  "(Settings)". **THE single highest-value fix, and it's pure prop-threading, not backend.** `result.project_name`
  (the friendly name) is also computed and dropped on Pushed.
- **Per-phase LIVE counts on Pushing** `[was T1 → T0]` — `pushSessionStep` returns
  `counts:{stories_created, story_failures, subtasks_created, ...}` on **every** step; the App loop reads only
  `progress`/`phase` and **discards `step.counts`**. "Stories 12/40 · Subtasks 8/60" needs zero derivation.
- **A per-failed-item ledger** `[T0]` — `result.failures.details.{stories,subtasks,links}` holds up to 10
  itemized objects (name/parent/summary + individual `batchError` message); the screen renders only the FIRST
  reason. Successes are listed individually; **failures are not — but the data is fully present.**
- **The actionable "why"** `[T0]` — `result.diag` splits `links_unresolved_name_unknown` (AI paraphrased a
  dependency) vs `links_unresolved_story_failed` (a Story failed → its links/subtasks cascaded) vs
  `subtasks_orphaned`, and `diag.jira[].field_names` names the **exact rejected custom-field IDs** — none
  surfaced on Pushed.
- **Total ACs + story-points + priority-mix** `[T1, fields already on the Confirm breakdown]` — `totalFeatureACs`
  is already summed; SP + priority are per-feature (and get pushed) → a "N stories · M ACs · P points ·
  priority mix" commit summary is free.
- **Checklist-fallback + stale-tests** `[T0]` — `subtasks_embedded`/`tasks_embedded` reveal the project had no
  Subtask type (tasks became checklists); `tc_skipped` means "ACs changed since generation → embedded tests are
  stale" — both shown only as parenthetical counts.

**States the design must handle.** Confirm: **project-key NULL/"(Settings)"** (a real degraded "destination
unknown" state today) · persistFailed (test-gen disabled) · test-gen in-flight at push (WILL be discarded) ·
truncated breakdown · Standard-upsell chips vs Advanced buttons for BOTH planner + test-cases · a small single-
category breakdown collapses the summary to just Epics/Stories/Subtasks. Pushing: starting/stories/subtasks/
links. Pushed: **CLEAN vs 207-PARTIAL vs checklist-fallback vs tc-skipped-stale vs tc-discarded**, plus post-push
plan panels each with idle/running/error/done AND a **partial-unverified** sub-state. **Volumes:** a handful to
**40+** stories — design the flat created-Story list + dependency list for the 40-item case, not the 5.
**Must-never-miss:** a **207 partial must NEVER read as clean success** — the success climax + plan panels need a
visually distinct "partial / verify this" treatment.

**Guardrails.** Irreversible write — the commit CTA stays unambiguous; the warning stays. Dependency remove/
restore MUST keep mutating the pushed JSON. Confirm-before-spend on test-cases (2-step armed + visible cost) is
a bill-shock guard — don't collapse. Push is chunked (25s Forge timeout). ⚠ **Post-push the job is PURGED** →
Pushed is terminal/forward-only, **captured exports are the only surviving test copy**, and **grouping the
created list by Epic/category on Pushed is NOT free `[T2]`** (`created_issues` carries only `{name,key,uid}` and
`pendingBreakdown` is gone — grouping must be stamped at push time). Green=commit, blue=open. Page-scroll (the
long Pushed screen must not become an internal-scroll trap).

**Highest-value directions.**
- **Fuse project + irreversible-warning into ONE "you are about to create X items in project {NAME (KEY)}"
  commit block** — T0-cheap, the FIRST thing to design.
- **A high-density commit summary** (hero total + Epic/Story/Subtask breakdown + total SP + priority mix +
  AC-coverage — all T0/T1) so the BA feels the SHAPE + WEIGHT; sharpen the hierarchy (one primary commit path;
  side-quests subordinated); a pre-commit readiness strip (the pre-flight-card analog).
- **Honest live Pushing** (per-phase counts + a real ETA from the code's own ~0.85s/issue × remaining × chunk
  sizes). **Pushed as an outcome ledger** (grouped, created-vs-failed ratio, **itemized failures with reasons +
  rejected field IDs**). **Promote the export to a can't-miss primary** (unrecoverable if lost). Give the
  terminal a real primary "next" (Open the Epic).

**Today (one line).** A "what will be created" dot-list (project reads "(Settings)") + a dependency editor + an
Advanced planner/test row + an irreversible callout + a green "Create N Items"; then a single-% Pushing bar; then
a success callout + a flat Story-key list + a truncated partial-failure note + a stacked export + sprint/rank.

**The ask.** A commit flow where the BA sees WHAT + WHERE before an irreversible write, watches honest granular
progress, and lands on a legible outcome ledger with the export impossible to miss.

---

## 5. Test Cases — triage board (Advanced)

**Goal.** The QA/BA workspace for AI-drafted acceptance cases: triage every story (coverage, type mix, failures,
staleness), drill in to edit, save, regenerate, export to Gherkin/CSV before push.

**Who it's for & what they fear/want.** A QA/BA at the **last cheap checkpoint** before cases get embedded
verbatim into Jira Story descriptions AND exported into an external test tool (Xray/Zephyr/ADO/Jama/TestRail/
qTest) where they become the team's **contract of "done."** The deep fear is **sign-off liability**: shipping a
suite that **looks green but silently omits an acceptance criterion**, so a requirement goes untested to
production and the QA lead owns the escape (the codebase literally encodes this: "an uncovered AC is expensive;
an extra depth case is a cheap delete"). Second fear: **surprise bill** — every Regenerate/Refresh is a real
charge on their own key, and bulk "Refresh N affected" fires N paid generations at once. Third: **staleness** —
the cases may rest on ACs edited since generation. A **win** = *"every AC across all N stories is covered,
nothing stale/failed, I know what regenerating costs, and I can hand the export off without a caveat."*

**The ONE decision + what "good" looks like.** *"Ready to ship, or which stories do I fix first?"* **Good** (the
exact predicate) = every non-removed story has `coverage.complete` **AND `stale_refs.length===0`** AND no error
AND no unsaved drafts. **Judged against enterprise test-tool mental models**, not a generic list.

**What we already have to build with (T0).** `perStory[]` (story + `result?` + `coverage?` + error/truncated) ·
per-case (`title,type,priority(Critical/High/Medium/Low),given/when/then,expected_result,ac_trace[],test_data?,
confidence_score,confidence_indicator,concern`) · **`coverage`** (`{no_acs,total_acs,covered_acs,uncovered_acs[]
(verbatim),coverage_pct,complete,inferred_cases,shared_ac_refs,stale_refs[]}`) · suite totals + **`failedStories`
(names, not just count)** · cost echo (`total_usd` + breakdown + `cache_hit` + tokens) · provenance/version ·
edit-staleness props · export payload.

**⭐ Signals we compute but never surface.**
- **Staleness in the coverage rollup** `[T1]` — the SummaryBar counts a story "fully covered" on
  `coverage.complete` **alone, ignoring `stale_refs`** — so a story with edited-since-gen ACs reads green in the
  rollup while its own row badge shows ⚠. **A real one-source-of-truth defect** (mirror of the pill/verdict bug
  we just fixed on pre-flight): the suite "ready" count overstates readiness.
- **The verbatim uncovered-AC text** `[was T1 → T0]` — `coverage.uncovered_acs[]` (the actual AC strings) rides
  every entry; a suite-level "these ACs have NO test anywhere" list needs **aggregation, not derivation.** This
  is the single artifact that resolves the sign-off-liability fear, and it's buried in each story's wizard step.
- **Confidence is two-dimensional** `[T0]` — both `confidence_indicator` (✓/⚠/✗) AND `confidence_score` (0–100)
  are parsed per case (export-grade). A distribution + average + "lowest-confidence case" pointer — never shown.
- **Concerns are TYPED + severity-tagged** `[T0]` — `[TYPE|severity]` (RISK/AMBIGUITY/EXTERNAL_DEP/**COMPLIANCE**/
  TECH_DEBT). A "3 RISK · 1 COMPLIANCE flagged" rollup — far more actionable than a flat count; COMPLIANCE/RISK
  are exactly what a QA lead must not miss.
- **`inferred_cases` + `shared_ac_refs` per story** `[T0]` — exact grounded-vs-inferred-vs-shared split (a
  3-value `ac_trace.kind`), not a derived ratio. **`Critical`-priority case count** `[T0]` — the sharpest "look
  here first" cue. **Invalid-on-save cases** `[T1]` — cases with no When/Then are **silently dropped on save**;
  the overview never warns "K cases will be lost." **Pre-run cost estimate** `[T0 resolver]` —
  `estimateTestCaseCost` exists → "Refresh 5 stories (~$X)" on the armed confirm.

**States the design must handle.** `testCaseResults=null` → GeneratePrompt · **all-stories-failed** (rollup all
zero, no openable rows) · downgraded Standard user (read+export only — a genuinely distinct layout) · regen-in-
flight per story (+ a bulk variant) · **removed-from-breakdown stories** whose cases are orphaned and **cannot be
regenerated** (a dead-end distinct from failed/stale) · dirty/unsaved gating Continue-to-Push · an implicit
**not-ready** state (`getTestCases` returns `not_ready` unless the job completed). **Volumes:** ≤20 cases/story;
3 → 40+ stories (scan cleanly at both). **Must-never-miss:** an AC with **no test in the FINAL SAVED suite** —
only SAVED cases reach export/embed, and the displayed coverage is **last-SAVED**, so unsaved edits can make the
shown coverage diverge from what will actually ship. Make "displayed coverage = SAVED, not your current edits"
unmistakable.

**Guardrails.** Paid actions stay 2-step armed. Coverage/severity tints are true signals. Page-scroll (no scroll
trap). Drafts/save/coverage state is **parent-held** (an overview↔wizard hop must never drop edits) — don't move
it down or remount. Export/push read **SAVED** cases only. The wizard's **absolute-index** model (screen 6) is
load-bearing.

**Highest-value directions.**
- **Make the coverage rollup staleness-aware** (subtract stale/partial from "ready") — the top correctness lever.
- **A suite-level "these ACs have NO test anywhere" roll-up** (verbatim uncovered strings, T0) — the artifact
  that kills the sign-off fear. **A "suite health" panel** from data the pipeline already emits (confidence
  distribution, typed-concern rollup, Critical count, grounded/inferred/shared split). **Surface invalid-on-save
  data-loss.** **Tie cost to the action** (pre-run estimate on the armed Refresh). **An export-readiness trust
  line** ("complete & current" vs "N excluded / K truncated / unsaved not included") instead of three orange
  chips.

**Today (one line).** A top ExportBar + a SummaryBar (stories/cases/$used/failed + coverage rollup) + a flat
list of dense-chip StoryRow cards that drill into a per-story wizard.

**The ask.** A triage board that answers "which stories need work + how covered/current is my suite" at a glance
— a suite-level go/no-go, not a flat list of dense-chip cards scanned linearly.

---

## 6. Test Cases per-story wizard (Happy / Negative / Edge + "Coverage & trust")

**Goal.** The deep single-story edit surface: review/hand-edit one story's cases by TYPE across 3 stepper
phases, then a 4th **"Coverage & trust"** readiness step. Drafts save per-story to KVS; only SAVED cases flow to
export + the Jira embed.

**Who it's for & what they fear/want.** A **picky QA/test engineer** doing **sign-off-grade** review: these
cases become the literal Done-definition a developer runs and the reference they **personally sign against**.
Their fear is the asymmetric one the codebase names as "the failure this feature exists to prevent": a case that
**reads green while wrong** — a missing negative/edge case, or an AC that looks covered but isn't — shipping a
bug with their name on the sign-off. The counterpart fear is the sandbox's own trap: **coverage shown is STALE
(last-SAVED)**, so they can tick every AC, SEE green, and still export/push cases that don't match — trusting a
number that lied. A **win** = a decisive, **LIVE**, defensible *"this suite is complete and safe to ship"* verdict
per story: every AC provably has a test, no case silently dropped on save, the model's own flagged risks + low-
confidence guesses surfaced (not hidden), and the type mix not lopsided (a zero-negative story is under-tested).
Quieter fear: **wasted paid effort** — Regenerate replaces hand edits + costs money → they want to fix at the
case level, not blow away the story.

**The ONE decision + what "good" looks like.** *"Is this story's suite complete + safe to sign off, and where
must I edit?"* **Good** (the exact compound) = 100% **live** coverage AND zero will-be-dropped cases AND ≥1
negative case AND no unaddressed ✗-confidence/flagged-concern case. This is a **deep, occasional, high-stakes**
pass over ONE story — **depth + defensibility beat density.**

**What we already have to build with (T0).** story name · **acceptance_criteria (verbatim — the ONLY story-body
data stamped, deliberately frozen for coverage integrity)** · full `test_cases[]` · per case: type/title/priority/
given-when-then/expected_result/test_data/**concern (`[TYPE|severity]`)**/`ac_trace[{kind:'story-ac'|'shared-ac'|
'inferred', ac_text?}]`/**`confidence_indicator` + `confidence_score`** · last-saved `coverage` (complete,
uncovered_acs, stale_refs, inferred_cases, shared_ac_refs, no_acs) · **per-story `usage` (token counts)** · save/
regen lifecycle · entitlement.

**⭐ Signals we compute but never surface.**
- **Per-case confidence** `[T0]` — a per-case **traffic-light the model already emits** (✓/⚠/✗) + a 0–100 score;
  a ⚠/✗ case reads "clean" today. The moodboard already has `SignalIcon` — a badge on the collapsed row + a
  story rollup is pure T0.
- **LIVE coverage** `[T1, already computed]` — `AcTraceEditor` computes stale/covered **from the current draft**
  right now (its `staleEntries`/match runs live), independent of the stale saved `coverage` object — but the
  wizard shows the last-SAVED value with "reflects your last SAVE" disclaimers. Read the live value instead.
- **Exact per-story cost** `[was speculative → T0]` — each entry carries `usage` (input/output/cache tokens) →
  "this story cost $X; Regenerate replaces N hand-edited cases" next to the paid button.
- **Typed concern + no-ACs trust** `[T0]` — a forwarded `[RISK|`/`[COMPLIANCE|` concern is a model-carried risk
  (vs a routine `[ASSUMPTION]`); `no_acs` = 100% inferred = the LOWEST-trust state, currently rendered as a
  benign "nothing to check." **Will-be-dropped-on-save count** `[T1]` — a story-wide total, never surfaced as a
  gate.

**States the design must handle.** no-ACs story (lowest trust, shown as benign) · read-only/downgraded (the whole
surface is a disabled `<fieldset>`; the collapse toggle is a `role=button` span **specifically to survive it** —
any new step-4 control must be a non-button too) · **`structurallyShifted`** after deleting a SAVED case (the
per-case Save footer **vanishes**; the only Save moves to step 4 — a user editing on Happy has NO local save
button) · regenerating (editing paused) · save error (must keep edits visible) · **empty type-phase** (0 negative
= the under-tested signal, not a bug — load-bearing). **Volumes:** ≤20 cases/story; a phase can legitimately be
empty. **Must-never-miss:** only SAVED cases reach export/embed AND coverage shown is last-SAVED → a **live-vs-
saved mismatch** is the core silent-failure mode; make it impossible to overlook.

**Guardrails.** **Absolute-index edit model** (type-phases are FILTERED renders; every callback passes the
case's absolute array index, never the filtered position). `ac_trace` edited via the AC-checklist (verbatim),
never free-text, or coverage trust breaks. `AcTraceEditor.normForMatch` is a **documented duplicate** of backend
`normAC` kept in lockstep (a sync hazard — reuse `computeCoverage` semantics for any live recompute). A no-When/
no-Then case is dropped on save — keep it surfaced. Page-scroll. Green=Save (per-STORY even when the footer sits
under one case), blue=nav, red=armed-regenerate. Type + severity tints are true signals.

**Highest-value directions.**
- **A LIVE per-story readiness verdict on step 4, built from the pre-flight-card template** — green/amber/red
  "ready to export/push?" from live-recomputed coverage % + will-be-dropped count + zero-negative flag + low-
  confidence/flagged-concern counts, plus an **AC→cases traceability matrix** (which case verifies each AC,
  which ACs are untested).
- **Replace stale saved-coverage with LIVE coverage** (kills the "reflects your last SAVE" friction). **Surface
  confidence as a real channel** (per-row badge + rollup). **Cluster the three trust-eroding states** (inferred /
  flagged-concern / low-confidence) — the export deliberately drops confidence, so the wizard is the ONLY place
  a reviewer sees it before sign-off. **Relate per-story cost to Regenerate.** **Turn will-be-dropped cases into
  an actionable gate.** Make the collapsed row a dense triage line (type · priority · coverage target · validity
  · confidence · concern).

**Today (one line).** A 4-dot stepper (Happy/Negative/Edge type-phases of collapsible case rows + a "Coverage &
trust" step showing a type-count line + uncovered/stale lists + a save bar).

**The ask.** A per-story surface where "Coverage & trust" is a real, LIVE readiness dashboard (traceability +
completeness + the model's own risk signals) and a live-vs-saved mismatch can't be overlooked.

---

## 7. Admin Settings — the configuration console

**Goal.** The instance-wide admin surface: connect Anthropic (BYOK key + Test Connection), set the default Jira
project key, define reusable Project Context profiles (Claude-powered distill), optionally declare required Jira
custom fields, view Account/Plan. (Diagnostics = screen 8.)

**Who it's for & what they fear/want.** A site admin configuring **for the whole instance** — a wrong project
key or missing custom field breaks the flow for **every BA on the site**, and they get blamed. So their win
isn't "I configured it," it's **"I proved it works for everyone before I walk away."** Three more stakes: (1)
**bill-shock by proxy** — they paste a key that bills THEIR OWN Anthropic account pay-as-you-go, and worry "will
my whole company running this drain my credits?" — yet the screen shows the plan price but **never an Anthropic-
side cost anchor**; (2) **non-expert anxiety** — the copy repeatedly reassures "no technical background needed" →
the deepest win is being **LED** ("do this, now this, you're done"), not handed a flat form; (3) **privacy/
trust** — they must **defend the data path** ("page content flows Forge → Anthropic on your key, no vendor
backend") to their security team.

**The ONE decision + what "good" looks like.** *"Is Spec2Tickets fully configured to generate + push right now —
and if not, exactly what's missing?"* **Good** (machine-readable) = **all 4 health probes green + a valid project
key + a configured key** — i.e. `runHealthCheck.ok`, which **is literally the go/no-go verdict, but it lives on
the OTHER tab.**

**What we already have to build with (T0).** key configured (yes/no) + **`apiKeyLastSetAt`** · default project
key · required custom-fields JSON · context profiles (`{id,name,context}`) · plan label + **price (can be null
for unlicensed/dormant)** · `hasTestCases` + **`hasPlanner`** (both entitlements) · `edition` + **`keySource`
(always 'byok')** · quota (`limit/unlimited/used/remaining/overLimit`) · **member-since (= install first-seen,
the grandfathering signal — not a vanity date)** · **Test Connection → `result.model`** (the actual Claude model
billing them) · **health-check probes** (4, each with a normalized **code**).

**⭐ Signals we compute but never surface.**
- **`runHealthCheck.ok` as the go/no-go verdict** `[T0, on the wrong tab]` — the four probes reuse the **real
  production code paths** (testConnection, the search CQL, `lookupProject`) so a green check is a genuine end-to-
  end guarantee, not a mock. It IS "what good looks like" — but it's buried in Diagnostics.
- **A per-breakdown cost anchor** `[T0, in code]` — the codebase knows ~$0.118 avg / $0.24 max per breakdown
  (test-cases $1–3.67); a "what this costs on your key" line next to Test Connection turns the bill-shock fear
  into a concrete number. **The screen never mentions cost.**
- **Probe code → Settings field, 1:1** `[T1]` — each failed probe's code deep-links to the exact field it
  validates (`no_project_key`→Project Key; `not_configured`→API Key; `egress_blocked`→a Forge egress note;
  jira_project http→Advanced custom-fields) — and the **actionable hint** (`classText(code).hint`) is one field
  away. **`hasPlanner`** (the second paid entitlement) is never read. **Distill quality** — `droppedCategories` /
  `overflowTrimmed` tell the admin a context profile is thin, but fire only as transient callouts.

**States the design must handle.** key **CONFIGURED vs NOT vs STORAGE-FAULT** (a distinct third state) · **Account
panel PRESENT vs ABSENT** (`getUsage` failure hides the whole plan/price hero silently) · Standard vs Advanced ·
**Unlicensed/trial** (limit 0, blocked — the Account copy doesn't handle it) · distill in-progress / failed-mid-
pipeline (retry) / dropped-categories · over-char-limit AND over-aggregate-byte-limit save rejection.
**Volumes:** context profiles cap at 20 — is a typical workspace 1–3 or 15–20? (the density decision hinges on
it). **Must-never-miss:** **the API-key field must show for EVERY edition** (both editions are BYOK — repeated
code warnings; a redesign that hides/collapses it for Advanced re-introduces the exact dead-end the v6 decouple
fixed) — **the #1 non-negotiable.** Second: Clear-key + Reset are **instance-wide, irreversible** (a co-admin
can wipe the shared key for all users).

**Guardrails.** Feature gating keys on **capability flags, NEVER the edition label**. Frontend caps (20000 chars,
20 profiles) mirror server caps (a documented sync hazard). Save runs client validation before the backend re-
validates. `window.confirm` may be inert in the sandbox → use the **armed two-step** pattern (as Diagnostics-
clear does) for Clear/Reset. Test/Save/Clear/Distill all write **one shared `message` state** (a distill error
and a save success can't coexist) — a structural constraint on inline-validation. Distill is a 6-call chunked
pipeline (progress/retry/dropped are correctness features). **Config completeness = key + project (REQUIRED);
profiles + custom-fields are OPTIONAL** (don't `AND` them in). Green=Save, blue=links, red=Clear/Reset.

**Highest-value directions.**
- **Reframe the Settings tab around a "Configuration status / setup checklist" hero** (Key ✓ · Project ✓ ·
  Context ○ · Custom fields ○), all T0/T1 — **the direct analog of the pre-flight card, applied to setup.**
- **Promote the health check onto the Settings tab** (it probes the exact things being configured; `ok` is the
  verdict) — turn an abstract form into a verifiable configuration, with each failed probe deep-linking to its
  field. **Add a cost anchor** ("~$0.12/breakdown on your key"). **Consolidate the two top cards + de-dup price
  (rendered in up to 4 places, all from one source).** **Inline per-field validation** (not one shared bottom
  region). **Lighter ContextProfilesEditor** (collapsed-summary rows — but keep the distill retry + dropped-
  category signals). **Unify Clear/Reset onto the armed pattern.** **A "your data path" trust badge**
  (BYOK / Forge→Anthropic / no vendor backend) the admin can show security.

**Today (one line).** A two-tab header; the Settings tab = an Account card + a "Powered by Claude" card + a flat
form (key / project key / context profiles / collapsed custom-fields) + a shared message region + Save/Reset.

**The ask.** A setup console that says "you're configured AND it works for everyone" (or exactly what's missing)
at a glance — a pre-flight for configuration, with the health check + a cost anchor built in.

---

## 8. Diagnostics — the no-egress support/debug ledger

**Goal.** Read the **no-egress, no-content** diagnostic ledger for the user's activity (and, for admins, every
user's), run a config health check, and export a consented support report — so a failure can be diagnosed +
handed to support without screenshots or quoting page content.

**Who it's for & what they fear/want.** THREE audiences: (1) **the affected user** — fear: *"did I lose my work /
did the app leak my page content to a vendor?"* The "no page or document content" reassurance + the GDPR self-
erase are the **trust payload**, not chrome; a win = *"I see what broke, copy ONE ref, hand it to support without
screenshotting anything."* (2) **the admin doing unpaid support triage** under time pressure — fear: *"I can't
find the incident among up to 200 buckets and I'll have to make the user re-do it"*; a win = paste the ref, land
on the row, one-click "Copy full report" to escalate. (3) **the admin as JANITOR** (the brief's first draft
missed this) — the **sweep heartbeat** answers *"is the vendor's daily orphan-cleanup actually running, or is
stale data / cost silently accumulating in MY instance?"* — an ops-hygiene anxiety, the only push-less health
signal they have.

**The ONE decision + what "good" looks like.** *"What failed, and what do I hand support (or fix via health
check)?"* **Good** = the affected user copies ONE ref and support resolves without re-running; the admin finds
the incident in seconds. **Today unreachable** for a user without an exact ref (the ref substring is the ONLY
filter).

**What we already have to build with (T0).** per-record humanized **title + hint** (`classText`) · op label ·
**severity level** · correlation ids **`ref` + `session_ref`** (aborted-push classes correlate ONLY by
session_ref) · occurrence collapse (`{count,firstTs,lastTs}`) · **cause-split `counts`** · durable Jira issue
keys · install-wide **aggregate** (`{class:{count,lastTs}}`) · admin gate + served scope · per-user buckets ·
**sweep heartbeat** (`{present,at,ageMs,stale,scanned,deleted,degraded,ok}`) · **health probes** (4, name/ok/
code) · export report string (auto-stamped tier + scope + app_version).

**⭐ Signals we compute but never surface (their VALUE, not just presence).**
- **`record.surfaced` (seen vs silent)** `[T0]` — whether the user ALREADY saw this failure live vs a **silent
  backend failure they never noticed.** **The single most decision-relevant triage bit** (a silent, error-level,
  data-loss record is the must-never-miss) — and it's thrown away.
- **`record.jira[].field_names`** `[T0]` — the **exact rejected Jira custom-field IDs**. The admin's fix ("add
  required field X") is literally sitting in the record, unrendered.
- **Some failure classes exist ONLY as count chips** `[T0]` — `tasks_embedded>0` ⇒ Subtasks weren't created;
  `subtasks_orphaned` ⇒ work skipped; `links_unresolved_*` ⇒ dependency dropped. So the first draft's "demote
  count chips" would **bury whole failure categories** — instead, promote a curated set to plain-English lines.
- **The sweep heartbeat is a 3-way fault taxonomy** `[T0]` — `ok===false` (last run ERRORED) vs `degraded>0` (ran
  but N buckets failed) vs `stale` (didn't fire), plus a "no run yet" first-run state and an exact `ageMs` vs a
  **36h SLA** — collapsed today into one amber strip.
- **`warn` severity is nearly invisible** `[T0]` — the row TITLE colour special-cases only error/info; a warn
  record (partial_push/degraded) reads as neutral. **The aggregate is INSTALL-WIDE even in "mine" scope** `[T0]`
  — a non-admin sees site-wide counters next to their own rows (a scope/privacy nuance). Failed-probe **`hint`**
  is one field away (the deep-link-to-fix).

**States the design must handle.** loading · load-failed→Retry · "No problems recorded" · **"No records match
this ref filter"** (a DISTINCT empty-under-filter state) · admin "all" with per-user group headers · admin scope
**silently downgraded to "mine"** (trust `resp.scope`) · sweep heartbeat present/absent/stale/errored/degraded (5
sub-states) · health panel not-run/running/all-passed/some-failed/could-not-run. **Volumes:** per-user ring caps
at 50; admin "all" at 200 buckets × 50 = **up to ~10,000 records in ONE unvirtualized page-scroll column.**
**Frequency:** low, reactive (deep-linked from a failure) OR a periodic admin hygiene check — two very different
cadences arguing for different default views. **Must-never-miss:** a **silent** (`surfaced===false`), error-
level, data-loss class — currently indistinguishable in a recency-sorted list from a benign info breadcrumb.

**Guardrails.** ⚠ **No egress, no end-user content — STRUCTURAL.** The rows are codes/ids/counts only; name-level
detail lives ONLY behind the "Include full error details" **consent checkbox in the export**, never on-screen.
The "no content" copy is load-bearing. **The humanize map (`lib/diagnosticsView.js`) is the single authority,
1:1 with the backend** — no hardcoded strings in the component. Admin scope + heartbeat are backend-gated (live
Jira ADMINISTER). **Running the health check WRITES a ledger record + reloads the list** (the panel + ledger are
coupled). Resolvers are **fail-open** (a "clean" screen may mean "nothing broke" OR "the read failed silently").
Sort/group by `occurrences.lastTs`. Page-scroll (no inner scroll container). Green="Copy full report",
blue="Run health check", armed-underline="Clear". Red ONLY for error rows/probes.

**Highest-value directions.**
- **Split the ledger by `surfaced`: "you already saw these" vs "SILENT failures"** — a far higher-value partition
  than info-vs-error (a silent data-loss record is the one thing that must never be missed).
- **Reframe rows as plain-English incident cards** (humanized title + a **persistent, not hover-only** hint +
  humanized count chips like "3 Subtasks skipped"; demote raw op/class/ref to a "technical — copy for support"
  affordance). **Render `jira[].field_names` as a "Jira rejected: <field>" fix-chip.** **A triage summary header**
  ("N problems · M warnings · most recent Xm ago") + a manual **Refresh**. **Client-side filter/group** beyond
  ref (level chips, subsystem grouping — the taxonomy already exists in source, date groups). **Give the sweep
  heartbeat its own ops card** (3-way fault + age-vs-36h SLA). **Elevate the health check** (deep-link failed
  probes to their Setting via the existing hint). **Lead the export with its auto-computed manifest** (tier +
  version + scope + record count) as a "here's exactly what support sees" trust panel. **Unify the four hand-
  rolled block styles into one moodboard "ledger item" primitive.**

**Today (one line).** A ref-filter + an admin scope toggle + a sweep strip + a flat recency-sorted list of code-
first `DiagnosticRow`s (hint hidden in a hover tooltip) + a site-wide counter table + a footer with export /
health-check / clear.

**The ask.** A support console where a non-engineer reads "what broke + what to do" in plain English, silent
failures stand apart, an admin finds any incident fast, and the "no content leaves your instance" promise reads
as a trust badge — all within the frozen no-egress data contract.

---

# Appendix — cross-screen themes (worth a consistent house treatment)

1. **⭐ The #1 lever: render the T0/T1 data we already compute but throw away.** Every screen does it — Insights
   discards feature-concern detail + `.type` + all the per-feature SIZING (T0!); the Editor never shows
   dependencies (already edge-built) or its own per-category triage counts; Review reads "(Settings)" while the
   project key sits in state, and drops `step.counts` + itemized failures + the diagnostic "why"; Test Cases
   ignores staleness in its readiness rollup + hides confidence/typed-concerns/Critical-count; the wizard shows
   STALE coverage while a LIVE recompute already runs; Settings hides the health-check verdict on another tab;
   Diagnostics buries `surfaced` (seen-vs-silent) + the rejected-field-name fix. **Mostly zero backend.**
2. **Design for the audience's FEAR, not the feature.** Cost-anxiety (BYOK spend), reputation-anxiety (my name
   on wrong Jira), loss-anxiety (paid work auto-deleted / a silent partial), sign-off-liability (a green-but-
   wrong test suite), accountability (a config mistake breaks it for everyone). Each screen's "win" is the fear
   resolved.
3. **The pre-flight card is the house pattern for every go/no-go read** — a tri-state verdict + answer tiles +
   on-demand detail from deterministic already-computed facts. It applies almost verbatim to **Confirm** (commit
   go/no-go), **Admin Settings** (`runHealthCheck.ok` = configuration go/no-go), the Test-Cases **"Coverage &
   trust"** step (per-story readiness), and **AI Insights** (trust go/no-go).
4. **One source of truth for counts/coverage.** Several screens state the same fact two ways and can contradict
   themselves (Test Cases "fully covered" ignores staleness while the row badge shows it; Insights quality-vs-
   average; Review's dependency count echoed twice). *(We just fixed exactly this class on the pre-flight card —
   the pill/verdict counts now derive from one source.)* A trustworthy verdict subtracts stale/partial/failed
   from "ready."
5. **Handle the full STATE matrix + the silent-failure trap.** Nearly every screen has a degraded read that
   looks identical to a benign empty (dashboard `{jobs:[]}` on failure = "your work looks lost"; Diagnostics
   fail-open = "clean might mean the read broke"; Settings `getUsage` failure hides the whole plan hero). Design
   the empty/error/partial/degraded/first-run states explicitly, and make "silent failure" visibly distinct from
   "all good."
6. **Data-tier honesty.** When a proposal leans on T2/T3, flag it — and note the sharp corrections research
   surfaced: the **project key** and **per-phase push counts** and **per-feature sizing** are all **T0** (cheap
   wins), while **grouping the Pushed list by Epic** is **T2** (the breakdown is purged by then). Cheap-vs-
   expensive is often the opposite of what the screenshot suggests.
