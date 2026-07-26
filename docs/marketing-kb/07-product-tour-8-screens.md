---
title: "Product tour: the 8 redesigned screens"
purpose: Screen-by-screen reference (what the user sees, the fear each screen removes, screenshot moments, content hooks) for writing blog/social content about the Spec2Tickets product experience.
visibility: mixed
sources:
  - Founder pricing + onboarding decision, 2026-07-24, tier table VERIFIED against the Atlassian vendor-portal "Set pricing" screen (founder screenshot, 2026-07-24); band mechanic corrected 2026-07-25 per 13-claims-register.md — SUPERSEDES every pricing statement in the sources below (free up to 10 users, a flat-rate override · paying starts from the 11th user, and the first band is labelled 1-100 at $6.70/user charged from the first user, so a 100-user site is $670 · then graduated: $5.10 101-250 · $3.80 251-1000 · lower again at scale · 1.5x multi-instance · per-user $5 welcome credit decided but not shipped); production version v7.1.0
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/page-picker-redesign.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/ai-insights-redesign.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/breakdown-editor-redesign.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/review-push-resume-redesign.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/admin-console-redesign.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/test-cases-redesign.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/sprint-planning-redesign.md
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/docs/DESIGN-BRIEF-NEXT-SCREENS.md
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/CLAUDE.md (handover notes 2026-07-02 pre-flight card, 2026-06-28 moodboard rollout, 2026-07-12 v6.6.0 release state)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/static/hello-world/src/lib/settingsView.js (COST_ANCHOR constant rendered by the Settings tab)
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/pricing/index.html (approved public cost phrasing)
last_verified: 2026-07-24
---

# Product tour: the 8 redesigned screens

Spec2Tickets is a journey, not a form: find a page → check it → generate → triage → review/edit → push to Jira → (optionally) test cases + sprint plan, with an admin console off to the side. In mid-2026 (June–July) every screen was redesigned around one idea: **name the user's real fear, then resolve it on-screen with data the app already computes**. This file gives writers one section per screen, in journey order.

```
Page Picker → Pre-flight check (on the chosen page) → [generation runs async, minutes]
  → AI Insights → Breakdown Editor → Review & Push → Pushed (outcome ledger)
       side-quests after review: Test Cases · Sprint/Capacity Planner
       off-flow utility: Admin console (Settings + Diagnostics)
```

- Screenshots: [GAP: partner to capture current-version screenshots from the live app — production is **v7.1.0** as of 2026-07-24]
- Pricing/editions wording for any screen: see `02-business-model-pricing.md` (do NOT reuse edition labels found in older design docs — see internal notes below).
- Visual identity (colors, glassmorphism, button grammar): see `08-brand-voice-visual.md`.

## Design philosophy (the through-line for every screen)

- **Never-silent honesty.** A partial push never reads as success; an unrated AI feature is never painted green "confident"; a verdict subtracts stale/partial/unknown from "ready"; a degraded data read is shown as degraded, not as a clean empty state. Honesty is treated as a feature, enforced in code.
- **Human-in-the-loop by design.** The AI drafts; a human reviews, edits, and explicitly commits. Every paid action (regenerate, test-case generation) and every destructive action (clear key, reset) is a deliberate two-step "armed" confirm. Nothing reaches Jira without a person deciding it should.
- **Design for the fear, not the feature.** Each screen is built against a named anxiety: cost (it's the customer's own Anthropic key), reputation ("my name on wrong Jira issues"), loss (paid async work expiring), sign-off liability (a green-but-incomplete test suite), admin accountability (one config mistake breaks it for everyone).
- **The go/no-go "pre-flight" pattern is the house pattern.** Tri-state verdict + answer tiles + on-demand detail, always derived from deterministic, already-computed facts — reused on the pre-flight card, the push Confirm, Settings, and test-case coverage.
- **The look**: blue-on-white glassmorphism — navy headings, steel/ice accents, glass card surfaces on a faint ice-blue field — with a fixed button grammar (green = commit, blue = navigate/open, red = destructive) and severity colors that always mean something. Color is never the only signal (icon shapes + text labels; WCAG-checked). Details in `08-brand-voice-visual.md`.

---

## 1. Page Picker — async mission control (app home)

**Journey point:** entry. | **Primary user:** PO/BA with AI work running in the background.

**What the user sees / does**
- A "You have work in flight" banner with a live heartbeat, a "Checking for updates…" pill, and three count tiles: Running · Ready to review · Needs attention — plus a calm "kept 7 days" note that escalates to an amber callout only when a specific result is close to expiry.
- Filter chips (All / Needs attention / Expiring / Running / Ready) over a dense, urgency-sorted work ledger (status · page · result · kept-until), designed to stay legible at ~40 rows.
- A find zone for the next spec: recent pages, cross-space search, manual page ID — with a "you already generated this — resume?" guard so nobody pays twice for the same page.
- Permanent 3-step onboarding for first-run users (find a page → generate → review & push).

**Fear it removes:** loss + double-spend anxiety — "is my paid, in-flight work lost? Is a finished breakdown about to be auto-deleted? Am I about to pay again for a page I already processed?"
**Screenshot moment:** the mission-control banner with live tiles above the urgency-sorted ledger — an AI workload dashboard where a file picker used to be.
**Content hook:** "Your AI work runs async. Your home screen should be mission control, not a file picker." (Secondary: honest expiry design — calm by default, amber only when it matters.)

---

## 2. Pre-flight check card — go/no-go on the chosen page

**Journey point:** after opening a page, before "Generate AI Breakdown". | **Primary user:** PO/BA about to spend real money on generation.

**What the user sees / does**
- A verdict banner (green / amber) over four answer tiles: **Right page?** (version, last edited, author) · **Complete?** (task-checkbox progress, empty sections, open to-dos) · **Right project?** (the configured Jira destination) · **This run** (estimated time band, project key, page size).
- A structure summary with per-section pills (child counts, orange tags on empty/unfinished sections) and an on-demand detailed per-heading outline with content chips (tables, images, diagrams, code).
- Everything is deterministic and instant — real headings, real unchecked Confluence task boxes, real empty sections. No AI call, no prose guessing (the card counts actual `☐` task checkboxes, never the word "TODO" in prose — a wrong number would erode trust permanently).
- The card never blocks Generate — it informs the go/no-go; the human decides.

**Fear it removes:** wrong-page / half-baked-spec anxiety — "am I about to spend money and team attention generating from the wrong, stale, or unfinished page?"
**Screenshot moment:** an amber verdict enumerating exactly why ("N items: 3 open tasks · 1 empty section") above the four tiles.
**Content hook:** "Before the AI reads your spec, the app does — version, author, structure, unchecked task boxes — deterministically, in milliseconds, for free."

---

## 3. AI Insights — directed triage after generation

**Journey point:** first screen after the async generation completes. | **Primary user:** PO/BA deciding where to spend scarce review time.

**What the user sees / does**
- A breakdown shape header (features, stories, ACs, dependencies) and a tri-state trust verdict, with four confidence tiles: ✓ confident · ⚠ unsure · ✗ low-confidence · **unrated** (its own bin — never silently folded into "fine").
- A structurally separate "landmine" callout for any compliance or high-severity concern — it can never be buried under a green summary.
- A weight-sorted "look here first" list that fuses each flagged feature's size, complexity, priority, confidence, and concern text — followed by a "confident skim" strip, a concern-type fingerprint (mostly Ambiguity → vague spec; any Compliance → get legal eyes), and a sizing-spread check (uniform sizing is an AI failure tell, so the spread is shown).

**Fear it removes:** opaque-AI / reputation anxiety — "did the black box quietly get something wrong I'll be blamed for — and where do I look first so I don't re-review the 80% that's fine?"
**Screenshot moment:** the verdict card + four tiles above the weight-sorted attention list.
**Content hook:** honesty-as-feature — "The verdict refuses to say 'trustworthy' unless a strict majority of features are high-confidence, and an unrated feature is never painted green."

---

## 4. Breakdown Editor — the 3-pane review workbench

**Journey point:** the main human-in-the-loop edit surface. | **Primary user:** BA/PO turning an AI draft into issues their team will actually build.

**What the user sees / does**
- **Left — worklist:** pinned Epic and Shared-AC entries above category-grouped, flag-sorted story rows, each with a confidence glyph (check-circle / triangle / diamond / question mark — distinct shapes, not just colors).
- **Center — focused story:** big editable title, segmented Fibonacci story points (1/2/3/5/8/13), description + user story, checklist acceptance criteria, locked shared-AC rows, editable sub-tasks with inline type, and a depends-on editor with a circular-dependency guard.
- **Right — AI-concern rail:** the focused story's flagged concerns as actionable cards — Edit to fix / Accept / Dismiss with a reason / Undo — plus a "why this score" explanation of the AI's own confidence.
- **The "reviewed" flip:** when a flagged story's concerns are all addressed, its worklist icon flips to confident and it drops out of the "needs eyes" count — while the AI's original score stays visible as the machine's fixed read. Review becomes a finishable worklist, not an endless scroll.

**Fear it removes:** career fear — "if the AI hallucinated an AC or fabricated a dependency, it becomes MY mistake once it's in Jira." Everything risky is surfaced up front; nothing hides in collapsed accordions.
**Screenshot moment:** all three panes with a flagged story in focus and its concern cards (Edit / Accept / Dismiss) on the rail.
**Content hook:** "Human-in-the-loop isn't a checkbox — it's a workbench. The AI raises its own hand; you resolve every concern and watch the story flip to confident."

---

## 5. Review & Push — the one irreversible commit (Confirm → Pushing → Pushed)

**Journey point:** the app's single irreversible, publicly visible write into the team's Jira. | **Primary user:** non-engineer PO/BA committing under their own name.

**What the user sees / does**
- **Confirm:** a pre-push verdict that leads with the destination **project name + key** (the wrong-project fear, answered first), a commit summary (story count, total story points, priority mix, AC total), a readiness strip, and a dependency editor — including amber warnings on dependencies that won't resolve to a real Jira link, shown BEFORE the push.
- **Pushing:** "Epic {KEY} created" as an anchor, then live per-phase counts (stories → sub-tasks → links) with an honest denominator so the bar never stalls-then-jumps, plus a real ETA and percentage.
- **Pushed:** a severity-graded outcome ledger — clean green only when everything landed; amber/red with itemized failures, causes (e.g. "the AI paraphrased a story name"), and a fix-chip naming the exact rejected Jira field. Completeness % top-right; Download .feature/.csv; "Open the Epic" as the primary next step.
- **Resume-push:** after a partial, one click creates ONLY what didn't land — idempotent, no duplicates — while the raw page content is still removed at push time (the privacy claim holds even on a partial).

**Fear it removes:** the irreversible-write fear — "am I about to pollute the WRONG project?" and "will this silently half-finish and leave me an inconsistent Jira I don't know is broken?"
**Screenshot moment:** the Pushed outcome ledger on a clean run — 100% completeness with every story deep-linked — or the amber partial ledger with its Resume button (the honesty shot).
**Content hook:** "A partial push never reads as success — and Resume-push finishes what it started without duplicating a single issue."

---

## 6. Test Cases — triage board + per-story wizard with a trust cluster

**Journey point:** optional post-review workspace; cases embed into pushed stories and export to Gherkin/CSV. | **Primary user:** QA/test lead doing sign-off-grade review.

**What the user sees / does**
- A **triage board**: one glass row per story with coverage and type-mix chips, per-row Regenerate/Copy, and a blue "Open →" that drills into that story's wizard.
- A **per-story 4-step wizard** organized by test TYPE — Happy path / Negative / Edge — plus a "Coverage & trust" readiness step (an empty Negative phase is itself a signal: an under-tested story).
- Every case card carries a **trust cluster**: a confidence badge (teal, distinct shapes — consistent with the rest of the app), a typed concern chip (Risk / Ambiguity / Compliance…), an "Inferred" chip when a case isn't grounded in a written AC, and an invalid marker — each appearing only when it has something to say.
- Expanded cards are fully editable — boxed Given/When/Then/Expected/Test-data fields, AC-coverage checkboxes, save/revert — and only SAVED cases reach export or the Jira embed.

**Fear it removes:** sign-off liability — "a suite that looks green but silently omits an acceptance criterion, and the escape ships with my name on it." (Plus bill-shock: regeneration is a two-step armed confirm with the cost shown.)
**Screenshot moment:** an expanded case card — trust cluster on the right, decoded concern strip above the editable Given/When/Then boxes.
**Content hook:** "Every AI-drafted test case carries its own confidence score and the model's own stated doubt — surfaced for the reviewer, not hidden. An uncovered AC is expensive; an extra case is a cheap delete."

---

## 7. Sprint / Capacity Planner — the plan that defends itself

**Journey point:** optional post-review workspace: backlog → sprint plan (Scrum) or Now/Next/Later (Kanban), pushable to real Jira sprints/board rank. | **Primary user:** PO/BA/Scrum Master who must justify the plan in a planning meeting.

**What the user sees / does**
- A **5-step wizard**: planning mode (Scrum/Kanban choice cards) → team capacity (a familiar form with a sticky live read-out and a "biggest lever" hint on focus-factor; Kanban gets a pooled per-quarter reach forecast) → review & generate (recap, objective, cost, armed Generate) → **your plan** (plan-first sprint columns or a Now/Next/Later band, with what-if re-planning) → **plan health**.
- Each placed feature is a calm chip with a conditional "unblocks N" marker and a "+ why here" cue. Expanding it shows **"Claude's reasoning"** (clearly attributed to the AI, display-only) and **"the numbers behind it"** — deterministic scheduling signals: unblocks count, on-the-critical-path, no-slack, risk.
- A compact plan-summary panel and a never-silent health strip: a green "No blockers" affirmation when clean, and honest, specific reporting when something doesn't fit (including per-skill capacity detail — "needs 10 backend pts vs an 8-pt backend cap").
- Re-rank the whole plan by objective: Balanced / MVP-first / maximize value / minimize risk.

**Fear it removes:** the indefensible plan — "why is X in sprint 3?" Auto-schedulers output a packing; this outputs a packing plus reasons, so every placement can be defended to the team.
**Screenshot moment:** an expanded feature chip showing Claude's reasoning next to the deterministic numbers behind it.
**Content hook:** "The plan defends itself: a deterministic capacity packer + AI sequencing rationale — every placement has receipts."

---

## 8. Admin console — Settings that prove themselves + a readable incident feed

**Journey point:** off-flow utility, one console, two tabs. | **Primary user:** site admin configuring for the whole instance and triaging failures.

**What the user sees / does — Settings tab (a pre-flight for configuration)**
- A verdict hero + answer tiles ("configured AND verified working" — or exactly what's missing), with required items amber and optional ones neutral, and a guided "Set up in order" spine where completed steps collapse.
- A built-in health check that probes the real production code paths (Anthropic key, Confluence search, Jira project); a failed probe deep-links to the exact field that fixes it — or says honestly when a field here can't.
- A cost anchor showing the expected spend for a breakdown on the customer's own key — billed straight to their own Anthropic account, pay-as-you-go, no markup from us — and a "your data path" trust badge (BYOK · Forge → Anthropic · no vendor backend) the admin can show their security team.
- Instance-wide destructive actions (Clear key / Reset) use the armed two-step pattern — nothing wipeable by one misclick.

**What the user sees / does — Diagnostics tab (an incident feed, not a log)**
- Each row is a plain-English story composed from the record's own numbers: "Pushed 9 stories, 33 sub-tasks and 14 links. All landed." / "Everything landed except 1 dependency link — the AI paraphrased a story name…"
- **Silent failures are partitioned at the top** — errors the user never saw live can't hide in a recency-sorted list; benign background events collapse into their own group.
- Triage summary, filters, per-user grouping (admin), a system-health card with "Fix in Settings →" deep-links, and a support export — all built on a no-egress, no-content ledger: codes, counts and issue keys only, never page content.

**Fear it removes:** admin accountability — "one wrong setting breaks this for every BA on the site" becomes "I proved it works before I walked away." And silent failure: "did something break that nobody saw?"
**Screenshot moment:** the Settings verdict hero fully green — or one plain-English Diagnostics incident row a non-engineer can read.
**Content hook:** "Settings that prove themselves, and a diagnostics feed written in plain English — with zero page content ever leaving your Atlassian instance."

---

## Cross-screen story angles (for 12-marketing-strategy-channels.md)

| Angle | Screens | One-liner |
|---|---|---|
| Honesty as a feature | 3, 5, 6, 7, 8 | Partials never read clean; unrated is never green; verdicts subtract what they can't prove. |
| Designed against fears, not features | all 8 | Cost, reputation, loss, sign-off liability, admin accountability — each screen names and resolves one. |
| Human-in-the-loop as a workbench | 4, 5, 6 | The AI raises its own hand; the human disposes; nothing hits Jira without review. |
| The go/no-go pattern | 2, 5, 6, 8 | One reusable verdict-and-tiles pattern for every "should I proceed?" moment. |
| AI with receipts | 3, 4, 7 | Confidence scores, concern types, and sequencing rationale are shown, attributed, and editable. |

---

## INTERNAL CONTEXT - never publish

- **Numbering mismatch (avoid public confusion):** engineering's "8-screen Claude-Design arc" (June–July 2026) counts Settings and Diagnostics as two separate screens and does NOT count the Pre-flight card (built earlier, 2026-07-02, as the pattern-setter). This marketing tour merges Settings+Diagnostics into one "Admin console" entry and includes the Pre-flight card to keep the customer journey coherent. Don't mix the two numberings in public copy; prefer "every screen" over "the 8 screens" if precision is risky.
- **Release status: production is v7.1.0 as of 2026-07-24** (repo `package.json` + `DIAG_APP_VERSION` in lockstep; live listing reads 7.1.0, released Jul 12 2026 — see 11-faq-objections.md). The redesigns in this tour were built on branch `feature/UI-UX-improvements` under the internal working label **v6.6.0**, which is the same work; v6.5.0 (app-wide visual re-theme, pre-redesign IA) was the previous confirmed-live version (2026-06-28), and the planner shipped in its original wizard form at v6.0.0 (2026-06-22). ⚠ **No engineering handover exists for v7.0 or v7.1**, so screen descriptions here are written against the v6.6 handover and may be stale for what actually shipped. [GAP: confirm against the live v7.1.0 app which redesigned surfaces are present before publicly presenting a specific screen detail (e.g. the rationale chips, the incident feed) as shipped — partner/deploy log decides.]
- **Edition-label trap:** `docs/DESIGN-BRIEF-NEXT-SCREENS.md` (July 8) predates the Standard-only pivot (2026-07-11) and calls Test Cases + Planner "Advanced". There is ONE offer including everything, **free for teams of up to 10 users** (a flat-rate override, not ten free seats) and **per user above that on a declining, graduated curve** — paying starts from the 11th user, and the first band is labelled **1–100 at $6.70/user, charged from the first user on the site** (so a 100-user site is **$670/month**), then $5.10 at 101–250, $3.80 at 251–1000, lower again at scale (portal-verified 2026-07-24, band mechanic corrected 2026-07-25, internal until the live site is corrected; 02-business-model-pricing.md). ⛔ Never write the first band as "11–100 at $6.70" — 90 × $6.70 = $603 contradicts the $670 maximum; "from 11 users" is the threshold, "1–100" is the band label. ⚠ The **$5 welcome credit** is **decided 2026-07-24 but not yet shipped** (today's code: per install, trial-licence only) — do not describe it on any screen as a live capability. Pricing/edition wording: `02-business-model-pricing.md` only.
- **Validation run behind the "100%" claim:** the clean-push screenshot claim traces to an internal E2E run on the dev site, 2026-07-09 — an 82-item push reading "100% / 82-of-82" with a full green ledger. Public phrasing: "validated end-to-end on real Jira pushes"; never name the dev site (spec2jira-dev / SCRUM-DEV / SDTY) or imply a customer ran it.
- **Cost anchors are dev-calibrated, not guarantees:** ~$0.118 avg / ~$0.24 max per breakdown; test-case generation roughly $1–$3.67 per run observed, with the in-app "typically" estimate having run ~3× low on one dense real spec (calibration ongoing). The app shows estimates + a post-run actual echo; public copy should say "the app shows you the estimated and actual cost on your own key" rather than quoting our internal averages as promises. **These figures are Table C1 internal-only ("zero tolerance in public copy", `13-claims-register.md`) — do not lift them into blog/social copy even though the Settings screen renders them** (the in-app anchor constant is `~$0.12` typical / `~$0.24` max, so a raw Settings screenshot exposes them — crop or annotate). The only approved public cost phrasing is the live site's "typically a few cents per breakdown" (claim A2.6).
- **Internal design codenames** (Claude Design mockup directions "6A three-pane", "4A directed triage", "1A trust cluster", "2A capacity"; "moodboard" as a doc name; agent-army audit process) are internal process vocabulary. The build-in-public story of the redesign method could be great content, but that's a deliberate partner decision — don't leak it casually as product fact.
- **Known residual gaps (don't claim perfection):** generation-side dependency canonicalization ("AI paraphrased a story name" links) is mitigated by pre-push warnings, not eliminated; the push fix-chip shows the raw Jira field ID (friendly name is a planned lookup); a Forge iframe scroll-to-top quirk on tall screens is accepted for MVP.
- **Competitor names for the planner angle** (deterministic schedulers) appear in internal notes; verify any named-competitor claim against `05-competitive.md` + `13-claims-register.md` before publishing.
