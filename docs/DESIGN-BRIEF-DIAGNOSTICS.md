# Claude Design Brief — Diagnostics tab (screen 8 of 8)

> **How to use this.** Hand this whole document + screenshots of the current Diagnostics tab to Claude Design
> and ask for 1–2 on-brand redesign proposals. Same method + quality bar as the Settings tab and the six
> screens already redesigned (Page Picker · AI Insights · Breakdown Editor · Review & Push · Ready pre-flight ·
> Admin Settings). You already see the current UI from the screenshots — so this brief spends its words on what
> a screenshot can't tell you: the goal, the three audiences' real fears, the ONE decision, and — above all —
> **the biggest miss so far: the record rows read like a technical log, when they must read like plain-English
> incident STORIES.**

---

## THE PRODUCT (one paragraph)

**Spec2Tickets** is an Atlassian **Forge** app (Confluence Custom UI, React) that turns a Confluence spec page
into a structured **Jira breakdown** (1 Epic → Stories → Subtasks, dependencies, sizing) using **Anthropic
Claude**. **BYOK** — the customer pastes their own Anthropic key + pays Anthropic directly; there is **no
Spec2Tickets-operated backend.** Diagnostics is the app's **no-egress, no-content support/debug ledger**: it
records what the app DID (op codes, ids, counts) — **never any page or document content** — so a failure can be
diagnosed + handed to support without screenshots or quoting the spec.

---

## THE SCREEN + THE ONE INSIGHT THAT MUST DRIVE THE REDESIGN

**Diagnostics** is the second tab of the Admin console (`Settings | Diagnostics`, one file, shared health-check
underneath). It has a **System health** card (verdict + Re-run + 4 tiles + the daily orphan-sweep heartbeat +
raw probe rows), a **Recent activity** ledger (the record feed), **Site-wide signal counters**, and an
export/health/clear footer. *(The System-health card, the sweep heartbeat, the counters, and the footer are
already built + accepted — see FIXED. This redesign is really about the **Recent activity ledger** + overall
coherence.)*

> ⭐ **THE ONE INSIGHT (the miss we must fix): Diagnostics is NOT a log viewer — it is a plain-English INCIDENT
> FEED. Each row must read like a STORY a non-engineer understands, not a stack trace.** The current rows (and
> a first patch attempt) render a humanized title + then either a raw `op · class · ref` breadcrumb with raw
> `stories_created: 10` count chips, OR a GENERIC per-class sentence that is internal jargon ("Success
> breadcrumb (counts only) — a timeline marker showing the app was working at this time") and sometimes
> **misleading** ("The counts on this record show what failed" — when the chips actually show what SUCCEEDED).
> **What it must be instead:** a specific, per-record narrative built from the record's OWN data — *"Pushed 12
> stories, 47 sub-tasks and 16 links. One dependency link couldn't be created — the AI paraphrased a story name
> that didn't match."* — with friendly **✓-landed / ●-issue** chips, and the raw technical detail tucked behind
> "Show raw counts (for the report)." *(⚠ landed/failed counts + the reason are on the record [T1]; the
> destination project ("into MOBILE") is NOT on the push record — a small backend add [T2], see the palette;
> `subject_keys` on a partial push are the FAILURE keys, not the destination.)* A BA/PO or a time-pressured admin should
> read the row and instantly know **what happened, what landed, what didn't, why, and what to do** — with zero
> Jira/Forge jargon.

---

## THE AUDIENCE + THEIR REAL FEARS (three people, not one)

1. **The affected user (BA/PO, non-engineer)** — landed here from a failure (a "[Open Diagnostics]" link on an
   error). Fear: *"did I lose my work? did the app leak my page content to a vendor?"* The **"no page or
   document content"** promise + the GDPR self-erase are the **trust payload**, not chrome. A **win** = *"I see
   in plain English what broke, I copy ONE ref, and I hand it to support without screenshotting anything."*
2. **The admin doing unpaid support triage, under time pressure** — fear: *"I can't find the incident among up
   to 200 buckets, and I'll have to make the user re-do it."* A **win** = paste the ref → land on the row →
   one-click "Copy full report" to escalate. Also needs the **fix** when it's self-serviceable (a Jira-rejected
   custom field → the exact field id).
3. **The admin as JANITOR** — the **sweep heartbeat** answers *"is the vendor's daily orphan-cleanup actually
   running, or is stale data / cost silently accumulating in MY instance?"* — the only push-less ops-health
   signal they have.

**The recurring emotional core:** turn an opaque failure into *"I understand what happened and exactly what to
do next"* — in plain language, honestly, without ever exposing spec content.

---

## THE ONE DECISION + WHAT "GOOD" LOOKS LIKE

*"What failed, and what do I hand support (or fix myself)?"* **Good** = the affected user reads ONE row in
plain English + copies ONE ref and support resolves without re-running; the admin finds the incident in
seconds and, when it's self-serviceable, sees the exact fix. Today a user without an exact ref is stuck (the
ref substring is the only filter), and even with the ref the row is technical.

---

## THE SCREEN TODAY (what the screenshots can't tell you)

- Each record row = a humanized **title** (good) + then a **technical body**: either a mono `push.session ·
  partial_push · <uuid>` breadcrumb + a wall of **raw** count chips (`links_created: 16`, `stories_created:
  12`, `subtasks_orphaned: 0` … including the ZEROES), OR a **generic per-class sentence** (the `classText`
  hint) that is internal-jargon-y and occasionally misleading. Neither is a plain-English per-record story.
- The count chips show **every** count including zeros → noise; a partial-push row is a dense grid of
  `key: value` pairs, not "what landed vs what didn't."
- The **surfaced-vs-silent split** ("Silent failures (you never saw these)") is implemented but only shows when
  a record has `surfaced===false`.
- The **`Jira rejected: customfield_XXXXX`** fix-chip is implemented (amber, mono).
- **Volumes:** per-user ring caps at 50; admin "all users" scope is up to **200 buckets × 50 ≈ 10,000 records**
  in ONE unvirtualized page-scroll column.

---

## ⭐ THE FULL DATA PALETTE — by tier (the record is RICHER than the current rows show)

> Tier: **T0** = already on each record in the `getDiagnostics` response · **T1** = client-derivable pure JS ·
> **T2** = one small backend addition · **T3** = an AI call. **The per-record narrative is T1** — every fact
> below is on the record; the story is just a client-side composition of them.

**Per record (all T0):**
- `error_class` — the event type: `push_completed` · `partial_push` · `generation_completed` ·
  `testgen_completed` · `health_ok` / `health_degraded` · `kvs_write_failed` · `key_storage_failed` ·
  `settings.key` · the link/subtask residual classes.
- `op` — the operation ("push", "generation", "health check"…). `level` — info/warn/error.
- **`surfaced`** — did the user ALREADY see this live, or is it a **silent** backend failure they never noticed.
  ⚠ ALWAYS a boolean on a served record (never absent post-validation); an omitted source value coerces to
  `false` = SILENT. So there is no "absent" case — do not design a degrade path for one.
- **`counts`** — the numbers to turn into the narrative + chips. Real keys (T0): `stories_created`,
  `subtasks_created`, `links_created`, `tc_embedded` (landed); `stories_failed`, `subtasks_failed`,
  `links_api_failed` (failed); `subtasks_orphaned` (skipped); `links_unresolved_name_unknown`,
  `links_unresolved_story_failed` (dependency dropped, with the WHY in the key); `tasks_embedded` (subtasks
  became checklist items — no Subtask type); `tc_skipped` (test cases stale); `features`, `cost_usd`
  (generation); **`stories`** (test-gen — NOTE it is `stories`, NOT `stories_created`); **`http_status`** (on
  the `*_http` classes — the narrative's status code); probe results `anthropic_key`/`confluence_read`/
  `jira_project`/`kvs_rw` (0/1); + hygiene keys `approx_bytes`/`truncated`/`dropped`/`key_updated`/`tc_run_discarded`.
- **`subject_keys`** — durable **Jira issue keys**, BUT on `partial_push` these are the **FAILURE keys**
  (failed-subtask parents + unresolved-link endpoints) and on a clean `push_completed` they are **ABSENT** — so
  `subject_keys[0]` is NOT the destination. Also `subject` (singular `{kind,id}` — e.g. `{kind:'idx',id:storyIdx}`
  on the test-gen family) + `subject_idxs` (feature indices on `partial_push`).
- ⚠ **The destination project/Epic key is OFF-RECORD → `[T2]`.** `res.epic_key`/`res.project_key`/
  `res.project_name` live in the push RESULT but are never passed to the diagnostic record — "Pushed into
  {project}" needs a small backend add (pass them to `recordDiagnostic`). High-value, cheap.
- **`jira[].field_names`** — the exact **rejected custom-field IDs** — the admin's literal fix.
- `ref` + `session_ref` — the correlation ids (aborted-push classes correlate ONLY by `session_ref`).
- `occurrences` `{count, firstTs, lastTs}` — how many times + when (a merged/deduped row).

**Install-wide (T0):** `aggregate` `{class: {count, lastTs}}` (monotonic, never evicted — the source for the
Site-wide counters); `sweepHeartbeat` `{present, at, ageMs, stale, scanned, deleted, degraded, ok}` (3-way
fault + age vs a 36h SLA); `isAdmin` + `scope` (the SERVED scope — trust it, not the client toggle); the 4
`health` probes; the export `report` string (auto-stamped tier/scope/version).

**⭐ The #1 lever (T1): compose a plain-English per-record narrative from `class` + `counts` (+ the destination
project IF the T2 lands).** The narrative + the friendly ✓/● chips ARE the redesign. The generic `classText`
hint is a weak per-CLASS fallback — do NOT use it as the primary body. Target voice (counts + reason are T0/T1;
the destination is T2):
- `push_completed` → **"Pushed {stories_created} stories, {subtasks_created} sub-tasks and {links_created}
  links. All landed."** (chips: ✓ 10 stories · ✓ 33 sub-tasks · ✓ 14 links) — add "into {project}" ONLY if the
  T2 lands (no destination is on the record today).
- `partial_push` → **"{landed} items landed; {failed/unresolved} didn't — {plain reason}."** where the reason
  maps the failing key: `links_unresolved_name_unknown` → "the AI paraphrased a story name so a dependency link
  couldn't resolve"; `subtasks_orphaned` → "this project has no Sub-task type, so some sub-tasks were skipped";
  `stories_failed` → "Jira rejected some Stories (see the rejected field below)". (`subject_keys` here = the
  AFFECTED failure keys → "affected: SDTY-12, SDTY-40", not "pushed into".)
- `testgen_completed` → **"Generated test cases across {stories} stories."** (⚠ the key is `stories`, not
  `stories_created` — map it) · `partial_testgen` = the test-gen analogue of partial_push.
- **Aborted-push trio** (`push_exception`/`step_exception`/`session_not_found`): `ref` is often null → correlate
  by `session_ref`; card e.g. "A push didn't finish — {reason}. Reference: session {session_ref}."
- `generation_completed` → **"Generated {features} features · cost ~${cost_usd} on your Anthropic key."**
- `health_ok` → **"All four checks passed (Anthropic key, Confluence, Jira, storage)."**

---

## OPEN DESIGN QUESTIONS (give us your take; recommendations included)

1. **How rich, and do we fund the "into {project}" destination (a small T2)?** A short plain-English lead from a
   per-class template (landed/failed counts + the reason) + friendly chips. **Recommendation:** yes, fund the
   T2 (pass epic/project to the push record) — "Pushed into {project}" is the most natural anchor and it's a
   one-line backend add; without it, lead with the counts. Read `subject_keys` only as the FAILURE keys on a
   partial push. Zeros never shown as chips (noise) — only in "Show raw counts."
2. **Silent-vs-surfaced partition — but beware the NOISE.** ⚠ `surfaced===false` is dominated by BENIGN
   warn-level ops breadcrumbs (`gate_fail_open`, `tracking_degraded`, `pagesnap_write_failed`, `purge_incomplete`
   …) — so a naive "silent = surfaced-false + error/warn" section BURIES the must-never-miss silent **data-loss
   ERROR** among "nothing for you to fix" noise. **Recommendation:** the top partition = silent **error-level**
   (or a curated data-loss set) only; keep benign warn-noise in the normal feed or a collapsed "background"
   group. (`surfaced` is never absent — no degrade case.)
3. **10,000-row admin scope** — virtualize, paginate, or default to a tighter window + "load more"?
   **Recommendation:** a triage summary header ("N problems · M warnings · most recent Xm ago") + client-side
   filter/group (by level / subsystem / the existing ref filter); don't render 10k rows raw.
4. **Where does the raw technical detail live?** **Recommendation:** behind a per-row "Show raw counts (for the
   report)" toggle (op/class/ref/session_ref + the raw `key: value` chips) — present for support, never the
   default read.

---

## THE DESIGN SYSTEM (moodboard — non-negotiable)

Blue-on-white monochrome + glassmorphism. Navy `#0a2440` text, steel `#5483B3`, ice `#C1E8FF` borders/fills;
page on a faint ice wash. Primitives in code: `MoodCard` (glass, 3 densities), `SignalIcon`/`SignalCallout`
(traffic-light), `SettingTile`. System font stack.

**Fixed rules:** severity = colour on the ICON / a coloured dot / the left border; **the words stay dark**
(`--s2j-text`) on any tint (WCAG — a silent error row must NOT be red-text-on-red-tint). Buttons: **blue** =
Run health check / open / nav; **green** = Copy full report (the primary support action); **red / armed
two-step** = Clear diagnostics (destructive, GDPR erase). Page-scroll only (no `100vh`, no internal scroll
trap). **English** copy, plain-language (NO Jira/Forge jargon in the row body — "sub-tasks", not
`subtasks_created`). No actionable hint hidden ONLY in a hover `title`.

---

## STATES THE DESIGN MUST HANDLE (exhaustive)

Loading · load-failed → Retry · **"No problems recorded"** (positive closure) · **"No records match this ref
filter"** (distinct from empty) · admin "all users" with per-user group headers · admin scope **silently
downgraded to "mine"** (trust `resp.scope`) · a **silent** (`surfaced===false`) error-level data-loss record
(the must-never-miss — visibly distinct) · a `partial_push` with a mix of landed + failed + unresolved · a
clean `push_completed` (all landed) · `generation_completed` with cost · `health_ok` · a Jira-rejected-field
record (the fix-chip) · the sweep heartbeat present/absent/stale/errored/degraded (5 sub-states) · the
health-check panel not-run/running/passed/some-failed/could-not-run · a **resume-push** record
(`push.resume.final` — same shape, distinct op) · the **test-gen family** (`testgen_completed`/`partial_testgen`,
count key `stories`) · the **aborted-push trio** (ref null → correlate by `session_ref`) · a **degraded-served**
read (fail-open returns `{records:[], aggregate:{}}` with NO `sweepHeartbeat` + the admin toggle gone — a third
state, distinct from loading/load-failed) · the silent partition's **data-loss-error-vs-benign-warn-noise**
split (see Q2).

---

## FIXED — DO NOT REDESIGN (already built + accepted)

- The **two-tab shell** (`Settings | Diagnostics`) — Settings is a separate, done redesign.
- The **System health card** (verdict banner + Re-run + 4 tiles + the 3-way sweep heartbeat + the RAW PROBES
  rows), the **Site-wide signal counters** table (from the aggregate), and the **export footer** ("no page or
  document content" + the "Include full error details" consent + Copy full report / Run health check / armed
  Clear diagnostics) — these are DONE + accepted; refine only for coherence with the new incident cards.
- The **no-egress / no-content** contract — STRUCTURAL. Rows are codes/ids/counts only; name-level detail lives
  ONLY behind the export consent checkbox, never on-screen.
- The **humanize map** (`lib/diagnosticsView.js`, `classText`/`opLabel`/`levelColor`/`relTime`) is the single
  authority — the per-record narrative composes on top of it, it does not bypass it.
- The **surfaced/silent split** + the **`Jira rejected: {field}` fix-chip** — keep (they're the §8 levers).

---

## WHAT WE WANT BACK

1–2 on-brand proposals for the **Recent activity ledger** (the incident feed) + how it sits with the existing
System-health card + counters + footer. Label each element's data tier. Specifically show us:

- **The incident card** — the plain-English per-record STORY (a short lead sentence from `class` +
  `subject_keys` + landed/failed counts, in plain language, NO jargon) + friendly **✓-landed / ●-issue /
  ✗-failed** chips (zeros hidden) + the `Jira rejected: {field}` fix-chip + a "Show raw counts (for the
  report)" toggle hiding the technical op/class/ref + raw counts. Design the partial-push, clean-push,
  generation, health, and Jira-rejected variants.
- **The silent-failures partition** at the top when any exist.
- **A triage header** + client-side filter/group for the up-to-10,000-row admin case.
- The whole thing readable by a **non-engineer** — a story per row, not a log line.

The north star: a support console where a non-engineer reads **"what broke + what to do"** in plain English,
silent failures stand apart, an admin finds any incident fast, and the "no content leaves your instance"
promise reads as a trust badge — all within the frozen no-egress data contract.
