# Impl-Spec — Diagnostics tab redesign (Claude-Design arc, screen 8)

> **For the implementer.** You CANNOT see the Claude Design mockup — this spec encodes it. Implement the
> **Diagnostics tab (Direction B · Triage console) 1:1** in `static/hello-world/src/components/AdminSettings.jsx`
> `DiagnosticsTab`. Branch `feature/UI-UX-improvements`. The **narrative composition** (§2) is the load-bearing
> lever — a first attempt used the generic per-class hint as the body and the partner rejected it as "the old
> log." Each row must read as a plain-English INCIDENT STORY.

## 0. Scope + invariants (NON-NEGOTIABLE)
- Rebuild the `DiagnosticsTab` **Recent-activity feed** into the incident-card + triage-console layout (§3–§7).
  KEEP the System-health card (refine copy per §8), the Site-wide counters, and the export/health/clear footer.
- **NO Jira/Forge jargon in the card body** — "sub-tasks", never `subtasks_created`. Raw op/class/ref + raw
  `key:value` counts live ONLY behind the per-row "Show raw counts (for the report)" toggle. Zeros are NEVER
  friendly chips.
- **Do NOT bring the Settings config-verdict into Diagnostics.** The System-health card stays the Diagnostics
  health panel (runHealthCheck + raw probes + Run/Re-run); "Fix in Settings →" is a DEEP-LINK that switches to
  the Settings tab, NOT a re-implementation of the Settings verification.
- **Strip the `[T0]/[T1]/[T2]` tier tags** — internal jargon (the pre-flight-card decision). "Into MOBILE-100"
  shows; the "[T2]" chip does NOT.
- Buttons: **green** = Copy full report · **blue** = Run health check / nav / links · **red + armed** = Clear
  diagnostics. Severity = colour on the ICON / a coloured dot / the left border; **words stay DARK on tint**
  (WCAG — a silent error row is NOT red-text-on-red). Page-scroll only. **ASCII quotes only.** Reuse
  `MoodCard`/`SignalIcon`/`SignalCallout`.
- KEEP all `DiagnosticsTab` logic (getDiagnostics / scope toggle / ref filter / sweep heartbeat / armed clear /
  export consent / handleHealthCheck). This is a RENDER rebuild + new pure helpers.

## 1. The T2 backend — "Into {Epic}" (small, additive; do it in `src/index.js`)
The push destination Epic is not on the diagnostic record today. `validateRecord` (`src/diagnostics.js`) is a
strict whitelist — a new field would be dropped — so REUSE the `subject` singular field with `kind:'issue'`
(cleanSubject already accepts an issue key). In BOTH push-record emissions (`src/index.js` ~3727 `partial_push`
and ~3771 `push_completed`), add:
```
subject: res.epic_key ? { kind: 'issue', id: res.epic_key } : undefined,
```
(`res` = `outcome.result`; `res.epic_key` is the created Epic key, e.g. "MOBILE-100".) This is privacy-safe (an
issue key, not content) and degrades gracefully (no epic → no `subject` → the FE drops the "Into" line). The FE
reads `record.subject` (kind `issue`) as the destination; `record.subject_keys` remain the "Affected:" FAILURE
keys (unchanged).

## 2. ⭐ Narrative composition — the load-bearing lever (new pure helper)
Add `composeIncident(record)` to `static/hello-world/src/lib/diagnosticsView.js` (pure, testable — cover it in
an offline `prototype/test_diagnostics_incident.mjs`). It returns:
```
{ title, level, destination, sentence, affected[], chips[{label,tone}], fixChips[{field}], seen? }
```
- **`destination`** = `record.subject?.kind==='issue' ? record.subject.id : null` → rendered "Into {destination}".
- **`affected`** = `record.subject_keys || []` → rendered "Affected: {keys}" (partial/failed only).
- **`chips`** = `friendlyCounts(record.counts)` (already exists — reuse) → ✓-landed / ●-issue / ✗-failed.
- **`fixChips`** = `record.jira[].field_names` → "Jira rejected {id} [Add this field in Settings →]".
- **`seen`** = from `record.occurrences` → "Seen {count} times · last {relTime(lastTs)}" when count>1.
- **`title` + `sentence`** — a per-`error_class` template (the CORE — plain English, from the record's OWN
  counts; NEVER the generic classText hint as the body). For an UNKNOWN class → fall back to
  `classText(error_class).title` + `.hint` (the humanize authority handles the long tail / background ops).

**Per-class templates (title · sentence):**
| error_class | title | sentence (compose from counts) |
|---|---|---|
| `push_completed` | "Pushed to Jira — everything landed" | "Pushed {stories_created} stories, {subtasks_created} sub-tasks and {links_created} links. All landed." (+ if `tasks_embedded>0`: " Some sub-tasks became checklist items — this project has no Sub-task type." · if `tc_skipped>0`: " Some test cases were stale and skipped.") |
| `partial_push` | "Some items failed to push to Jira" | lead with the DOMINANT failure reason: `stories_failed>0`+jira → "Everything landed except {stories_failed} stories — Jira rejected them because a required custom field wasn't set." · `links_unresolved_name_unknown>0` → "Everything landed except {n} dependency link{s} — the AI paraphrased a story name that didn't match, so the link couldn't resolve." · `subtasks_orphaned>0` → "{n} sub-tasks didn't land — this project has no Sub-task type, so they were skipped." · `links_unresolved_story_failed>0` → "{n} dependency link{s} couldn't be created — a linked story failed to push." · `links_api_failed>0` → "{n} dependency link{s} failed at the Jira API." (pick the first non-zero in this order; if several, lead with the first + a trailing "…and other issues — see the counts.") |
| `generation_completed` | "A breakdown completed" | "Generated {features} features, cost ~${cost_usd} on your Anthropic key." |
| `testgen_completed` | "Test cases generated" | "Generated test cases across {stories} stories." (⚠ the count key is `stories`, not `stories_created`) |
| `health_ok` | "Health check passed" | "All four production checks passed — Anthropic key, Confluence, Jira and storage." |
| `health_degraded` | "Health check found problems" | "One or more production checks failed. Open the System health panel above to see which." |
| `push_exception` | "A push didn't finish" | "A push stopped partway — the connection dropped partway through. Nothing was rolled back; re-running picks up where it left off." (chips: ✓ {stories_created} stories so far · ✓ {subtasks_created} sub-tasks so far) |
| `session_not_found` | "A push couldn't resume" | "The push session expired before it could resume — no items were changed. Start the push again from the breakdown." |
| `step_exception` | "A push step failed" | "A step in the push hit an error. Re-run the push to continue where it stopped." |
| (any other) | `classText(error_class).title` | `classText(error_class).hint` |

- The `partial_testgen` class (if present) mirrors `partial_push` (test-gen cause-split).
- **`friendlyCounts` chip labels** already exist in `AdminSettings.jsx` (`COUNT_FRIENDLY`) — MOVE them into
  `lib/diagnosticsView.js` so `composeIncident` + the card share them; ADD `stories` → "{v} stories covered"
  (test-gen) and, for `push_exception`, a "{v} stories so far" variant (the "so far" wording is set by the
  card when the class is an aborted push — pass a flag, or a second label map).

## 3. IncidentCard (replaces the current DiagnosticRow render)
A card (MoodCard-like) per record, from `composeIncident`:
- **Left accent + icon by level:** error → red border + red `SignalIcon error`; warn → amber; info → green
  check. A **silent** record (see §4) adds a red "YOU NEVER SAW THIS" pill by the title.
- **Header row:** the humanized `title` (dark, bold — red only via the icon/border, never red text on the red
  tint) + right: a muted `error_class · relTime`.
- **"Into {destination}"** line when `destination` (small, the Epic key in a mono chip — NO "[T2]" tag).
- **`sentence`** — plain-English, `--s2j-text`/`--s2j-text-light`, one or two lines.
- **"Affected: {keys}"** line when `affected.length` (mono key chips) — failure keys only.
- **chips row** — friendly ✓/●/✗ chips (`CountChip`, exists) — zeros already excluded by `friendlyCounts`.
- **fix-chip** — when `fixChips`: an amber row "⚠ Jira rejected {field} [Add this field in Settings →]" (the
  button calls the Fix-in-Settings callback, §8).
- **`seen`** line when occurrences>1.
- **Footer row:** "Show raw counts (for the report)" toggle (reveals op/class/ref/session_ref + raw `key:value`
  chips + issue keys — the current raw block) + "Copy reference" (copies `ref || session_ref` to clipboard,
  with a "Copied" flash — reuse the app's clipboard pattern).

## 4. Silent-failures partition (top)
- `silentDataLoss` = records with `surfaced===false` AND `level==='error'` (NOT warn — the benign warn
  breadcrumbs `gate_fail_open`/`tracking_degraded`/… must NOT dilute the must-never-miss). Render them FIRST in
  a distinct red-tinted `MoodCard` section: header "**Silent failures — you never saw these**" + subtext
  "These finished in the background and lost data without an on-screen error. Handle these first." Each card is
  the IncidentCard with the "YOU NEVER SAW THIS" pill.
- The remaining records form the normal feed. Benign silent WARNS (`surfaced===false && level==='warn'`) go into
  a **collapsed "Background events" group** at the BOTTOM of the feed (a `<details>`/toggle: "Background events
  (N) — routine, nothing to fix"), NOT the top partition.

## 5. Triage header + filters (always in B)
- **Triage summary bar** (a MoodCard row): "● {problems} problem(s) · ● {warnings} warning(s) · ● {healthy}
  healthy events" (red/amber/green dots; counts over the CURRENTLY-SHOWN scope) + right "most recent {relTime}".
  Counts: problems = error-level, warnings = warn-level, healthy = info-level.
- **Filter strip:** segmented "All / Problems / Warnings" (filters by level) + an "All areas" dropdown (filters
  by SUBSYSTEM — derive from `op`/`error_class` family: Push / Generation / Test cases / Health / Settings /
  Storage) + the existing ref-filter input relabeled "Filter by reference or issue key…" (matches ref,
  session_ref, AND subject_keys). Below: "for this admin · showing {shown} of {total} · newest first".

## 6. User grouping (all-users scope)
When `data.scope === 'all'`: group the feed by `accountId`, each group a header "👤 {displayName or 'User'} ·
{accountId short} · {N} events" then its incident cards. (The backend serves buckets with accountId; a display
name may be absent → show the short accountId.) The triage summary + filters sit above all groups; "across all
users on this site · showing {shown} of {total}".

## 7. Windowing (10k rows)
Default-render the first **20** incident cards (after the silent partition); a "**Load more**" button reveals
the next 20. (Simple slice + a `visibleCount` state — no virtualization lib; Forge-safe.) The counters/filters
operate over the full filtered set; only the rendering is windowed. Surface the truncation honestly in the
"showing {shown} of {total}" line.

## 8. System-health card refinements + Fix-in-Settings
Refine the existing `healthBanner` copy to the mockup's plain-English health states:
- all ok → "All systems healthy — The four production paths … all responded from your session. Last checked
  recently." (green)
- a probe failed → "{n} check{s} failing right now — A production path is down. The raw probe and code are
  below; a field-fixable one links straight into Settings." (red)
- never run (no in-session result AND aggregate shows a stale/old health_ok) → "Health not verified recently —
  Last passed {relTime}. Run a fresh check to confirm the instance is healthy right now." (info) + the button
  reads "Run health check" (blue).
- The RAW PROBES rows already render; for a FAILED probe add the humanized hint (via `classText(p.code)`) + a
  **"Fix in Settings →"** button when the code is field-fixable (`no_project_key`/`project_not_found` →
  project; `not_configured`/`auth_rejected`/`key_storage_failed` → key — reuse `classifyProbe` from
  `settingsView.js`). The button calls a NEW prop `onFixInSettings(field)` that `AdminSettings` passes down →
  it sets `activeTab='settings'` (+ optionally the field to focus). Do NOT re-implement the Settings verdict.

## 9. States (14 — all must render)
normal (healthy mixed) · silent-data-loss-at-top · jira-rejected-field (the fix-chip + "✗ N stories rejected")
· aborted-push (push_exception + session_not_found, ref null → session_ref) · all-users-grouped · health-check
FAILING (a probe red + Fix-in-Settings) · health NOT-verified (Run health check) · sweep missing/stale ·
filter-empty ("No records match this filter") · empty ("No problems recorded") · loading · load-failed → Retry
· degraded-served (records:[] + no sweepHeartbeat + admin toggle gone) · cleared.

## 10. Build + verify
- `node --check src/index.js` (the T2 add) · `node prototype/test_diagnostics_incident.mjs` (the new helper
  tests) green · `cd static/hello-world && npm run build > log 2>&1; echo NPM_EXIT=$?; grep Compiled` (never
  `| tail`) · node smart-quote sweep CLEAN · `npm run check` 11/11 · `npm test` green.
- Trace: no jargon in the card body; raw only behind the toggle; silent partition = error-only; the tier tags
  are gone; Fix-in-Settings is a tab-switch not a re-verdict; page-scroll (no vh); ASCII.
