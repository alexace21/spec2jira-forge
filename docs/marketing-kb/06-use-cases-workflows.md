---
title: "06 — Use cases & workflows: scenarios, proof metrics, demo script"
purpose: Concrete use cases with personas, flows, internally-validated proof points, content hooks, and a 3-5 minute demo script for public content production.
visibility: mixed
sources:
  - Founder pricing + onboarding decision, 2026-07-24, tier table VERIFIED against the Atlassian vendor-portal "Set pricing" screen (founder screenshot, 2026-07-24); band mechanic corrected 2026-07-25 per 13-claims-register.md — SUPERSEDES every pricing statement in the sources below (free up to 10 users, a flat-rate override · paying starts from the 11th user, and the first band is labelled 1-100 at $6.70/user charged from the first user, so a 100-user site is $670 · then graduated: $5.10 101-250 · $3.80 251-1000 · lower again at scale · 1.5x multi-instance · per-user $5 welcome credit decided but not shipped)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/README.md
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/CLAUDE.md (Status, MILESTONE, Monetization, 2026-06-21/22 planner handovers, 2026-07-02/07/08/09/10/11/12 UI + trial-credit handovers, Forge gotcha #8)
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/capacity-sheet-planner.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/testcase-generation-feature.md
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/how-it-works/index.html
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/docs/PLANNER-LIVE-ACCEPTANCE.md
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/docs/PLANNER-KANBAN-LIVE-ACCEPTANCE.md
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/src/usage.js + src/trialCredit.js + src/index.js (grep-verified in-app STRINGS: the "$6.70/user/mo" Standard label, $5 trial credit, exhaustion copy — a code string is not proof of the billed Marketplace price)
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/pricing/index.html (live public pricing — revision "v7 FLAT-FREEMIUM", 2026-07-16)
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/privacy/index.html (public "welcome credit" trial wording)
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/standard-only-trial-credit.md (trial-credit mechanics + the pending production managed-key ops)
  - https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira (reference URL only)
last_verified: 2026-07-24
---

# 06 — Use cases & workflows

**Read me first (for the AI assistant):** every metric below comes from **internal validation runs on our own dev instance** — we have **no public customer case studies yet** [GAP: no public customer case studies or referenceable customers — founder decides when/how to collect]. When writing public content, phrase numbers as "in our internal validation runs" with the date, never as customer results. Product = **Spec2Tickets** (Marketplace: "Spec2Tickets for Confluence & Jira"); vendor brand/domain = **Spec2JIRA** / spec2jira.com (intentional split — see 08-brand-voice-visual.md). Pricing details → see 02-business-model-pricing.md. Screen-by-screen tour → see 07-product-tour-8-screens.md. ⚠ **No approved specimen of the product's actual output exists anywhere in this KB** — no sample Epic/Story with its acceptance criteria, no Gherkin scenario, no plan-brief excerpt (07 and 08 likewise carry screenshot/demo-asset GAPs). Describe the output *shape*, as the use cases below do; never invent an example and present it as real generated output.

## The baseline workflow (all use cases build on this)

Public framing from spec2jira.com/how-it-works — four steps:

| Step | What happens |
|---|---|
| 1. Install & configure | Install from the Atlassian Marketplace into Confluence + Jira (cross-product; two Manage Apps entries is normal). In-app Settings: Anthropic API key (BYOK) + default Jira project key. "About five minutes — no servers, no infrastructure." |
| 2. Generate | Pick a Confluence page → Generate. Claude reads the whole page, produces a structured breakdown — "typically in a few minutes" (async; you can leave and come back, it keeps running). |
| 3. Review in the editor | Interactive editor: feature names, user stories, acceptance criteria, dependencies, priority, story points, labels. Quality signals surfaced: confidence, risks, ambiguities, auto-resolved circular dependencies. |
| 4. Push to Jira | One Epic + a Story per feature + Subtasks + "blocks / is blocked by" links + labels — created under the user's own Atlassian permissions, with links back to the new issues. |

What lands in Jira (site copy, public-safe): full hierarchy · descriptions + acceptance criteria · sizing signals (priority, story points, complexity) · real dependency links · quality signals · category labels. "Nothing reaches Jira until you push it."

---

## Use case 1 — PRD → sprint-ready backlog in one review session

- **Persona:** Product Owner / Business Analyst on a cloud Confluence + Jira team (see 03-audience-icp-personas.md).
- **Situation:** A finished PRD sits in Confluence; turning it into a Jira backlog by hand means hours of copy-paste, and dependencies/estimates usually never make it in.
- **Flow:** Page Picker → pre-flight check card (is this the right page/version/project? is it complete?) → Generate → AI Insights triage ("look here first") → Breakdown Editor (fix flagged stories, adjust Fibonacci story points, edit ACs) → Review screen (destination project verdict + commit summary) → Push.
- **Outcome:** A reviewed Epic + Stories + Subtasks + dependency links + sizing in Jira in one sitting, with a human approving everything before it lands.
- **Proof (internal validation):** 178 items pushed with **0 failures** in one E2E run on our dev instance, 2026-05-30. Generation typically takes a few minutes (async batch). Public site claim: "~70% less hand-work / minutes, not days / 100% human-reviewed" (positioning claim on the landing page, not a measured study — see 13-claims-register.md).
- **Content hook:** "Your PRD is already a backlog — it's just trapped in prose."

## Use case 2 — The huge legacy spec (100K+ characters)

- **Persona:** BA/PO or tech lead inheriting a large, dense specification (legacy system doc, regulatory spec, big-bang project doc).
- **Situation:** The document is too big to decompose by hand without losing structure; naive AI tools truncate or flatten it.
- **Flow:** Same as UC1; the architecture is built for scale — async batch generation (no timeout on big pages), chunked push to Jira (bounded batches with a progress bar), truncation salvage + an honest truncation banner if a limit is ever hit.
- **Outcome:** A structured, dependency-linked breakdown of the whole document — not the first N pages of it.
- **Proof (internal validation):** our own ~101,000-character product spec produced **39 features / 162 subtasks with dense cross-feature dependencies**, validated end-to-end through chunked push on our dev instance (2026-05-30).
- **Content hook:** "We fed it a 101,000-character spec. It came back as 39 features and 162 subtasks — with the dependency graph."

## Use case 3 — QA: per-story test cases with Gherkin + CSV export

- **Persona:** QA lead / senior BA who writes acceptance tests as their own deliverable (maximally critical audience — the internal quality bar).
- **Situation:** Test design lags the backlog; test cases rarely trace back to acceptance criteria; every tool wants a different import format.
- **Flow:** After review, "Generate Test Cases" (armed two-step confirm with a cost estimate up front on your own key) → triage board of all stories → per-story wizard by type (happy path / negative / edge + a coverage-and-trust step) → editable cases with confidence / typed-concern / priority chips → export **Gherkin `.feature`** (with `@type`/`@priority` tags and `# Covers:` AC traceability) or **RFC-4180 CSV** (formula-injection-neutralized) → on push, each Jira Story gets an embedded test-case summary (count · coverage · type breakdown).
- **Outcome:** Draft acceptance tests per story, traceable to ACs, in the two shapes that cover the professional tool world — Gherkin for BDD stacks (e.g. Xray, Zephyr, Cucumber-based flows) and CSV for table-driven tools (e.g. TestRail, Azure DevOps Test Plans). Export shape validated with real parsers internally, not live-imported into every tool.
- **Proof (internal validation):** 100% AC coverage, 0 invalid cases and 0 render failures across multi-run validation on real specs (2026-06-07/08); live E2E: 13 test-case summaries embedded on push (`tc_embedded=13`, 2026-06-18); pre-flight cost ceiling held on real data ($1.27 actual vs a "$2.45 max" pre-flight ceiling, 2026-06-18). Generated cases carry typed concerns forward ([RISK]/[COMPLIANCE]/[AMBIGUITY]…) instead of silently dropping them.
- **Content hook:** "The AC you wrote is a test case waiting to happen — with a `# Covers:` line to prove it."

## Use case 4 — Quarterly capacity planning → native Scrum sprints

- **Persona:** PO/BA or delivery lead planning a quarter with a skeptical room (the plan must be *defensible*).
- **Situation:** The backlog exists (from a breakdown), but slotting it into sprints while respecting dependencies, skills, and risk is spreadsheet purgatory — and incumbent tools are deterministic packers with no reasoning attached.
- **Flow:** From Review, "Plan capacity" → in-app capacity form (people, available days, sprint count/length, optional per-person skill: Backend / Frontend / QA) → armed confirm → Claude ranks the backlog (one advisory call; deterministic math does all the packing and never lets the model violate a dependency) → sprint columns with per-skill capacity meters, risk register, per-feature "why here" rationale + scheduling signals (unblocks / critical path / slack) → free instant what-if scenarios (+1 sprint, lower focus factor, defer a feature) → copy a stakeholder-ready **Plan Brief** (Markdown / plain text / CSV) → "Assign sprints in Jira": creates real, native Scrum sprints with dates and moves each Story in.
- **Outcome:** A quarter plan the PO can defend line-by-line — every placement traces to capacity math, dependency order, and a visible rationale — pushed into Jira as actual sprints (works on both team-managed and company-managed projects).
- **Proof (internal validation, 2026-06-21):** "Assigned **17 issues across 5 sprints**" live on a team-managed board on our dev instance; hard-dependency rule held **3/3 runs with zero variance** in multi-run ranking validation, and 3/3 across all four planning objectives (balanced / MVP / min-risk / max-value); skill-bottleneck honesty verified live ("Short on QA capacity… meanwhile backend idle"); ranking cost observed ~$0.014–0.018 per run on the customer key.
- **Content hook:** "A sprint plan that defends itself: every story shows why it's in that sprint — and the math behind it."

## Use case 5 — Kanban teams: Now / Next / Later ranked backlog

- **Persona:** Kanban / continuous-flow team lead (no sprints, allergic to fake forecasting).
- **Situation:** Flow teams get ignored by sprint-planning tools; Monte Carlo forecasting needs flow history a new backlog doesn't have.
- **Flow:** Same planner, methodology toggle → "Kanban backlog" → quarter capacity form → Claude-ranked, dependency-legal ordered backlog cut into **Now / Next / Later** by an honest capacity-derived reach *range* (conservative–optimistic, never a fake single number; Later items shown, never hidden) → "Rank backlog in Jira": applies the real global Jira backlog rank top-to-bottom + `plan-now` / `plan-next` / `plan-later` labels (idempotent re-runs).
- **Outcome:** The Jira backlog physically ordered the way the plan says, with tier labels — on both team-managed and company-managed Kanban boards.
- **Proof (internal validation, 2026-06-21):** 8/8 live acceptance phases passed; **"Ranked 13 issues + tagged 14"** on a company-managed board and **"Ranked 14 + tagged 15"** on a team-managed board, with the board order matching the plan order exactly (polarity verified card-by-card); honesty language enforced ("likely reach this quarter… a forecast, not a target").
- **Content hook:** "No sprint theater for flow teams: Now / Next / Later, ranked straight into your Jira backlog."

## Use case 6 — Domain-heavy teams: Project Context profiles

- **Persona:** Teams in dense domains (fintech, clinical, logistics…) where generic AI output misses the house vocabulary and domain constraints.
- **Situation:** A generic breakdown names things wrong and misses domain-implied features; retyping context per run doesn't scale.
- **Flow:** In Settings, create a named Project Context profile per project → "Distill with Claude" reads your existing Confluence pages and extracts a compact domain pack across six categories (Domain / Glossary / Personas / Tech / Regulatory / Conventions) → the profile is injected into every generation as **reference-only** context (it enriches vocabulary and surfacing; it never changes scope or rewrites your authored ACs) → per-page profile selection is remembered.
- **Outcome:** Breakdowns that speak the team's language and surface domain-implied work — without scope drift.
- **Proof (internal validation, 2026-06-02):** WITH-vs-WITHOUT comparison on a real epic: the context run surfaced an architecture feature (multi-tenant isolation) the no-context run missed, used the project's real component names, and kept the boundary clean — all numeric ACs verbatim, zero cross-domain bleed across four test domains.
- **Content hook:** "Teach it your glossary once — every breakdown after that speaks your team's language."

## Use case 7 — Mid-push Jira failure: honest partial ledger + Resume

- **Persona:** BA pushing a large backlog into a real-world Jira (custom required fields, permission quirks, flaky moments).
- **Situation:** Most tools report a big write as "done" even when parts failed — the worst outcome is a partial push that *reads* clean.
- **Flow:** Push runs chunked with live per-phase counts and an ETA → the Pushed screen is a severity-graded **outcome ledger**: completeness %, itemized failures per story/subtask/link, the exact rejected field ID surfaced as a fix chip, honest link-failure causes. A partial **never reads clean**. Then **Resume push** creates only what didn't land — idempotent by stable internal IDs, so re-running never duplicates issues.
- **Outcome:** Trust in the one irreversible step: you always know exactly what landed, what didn't, why — and you can finish the job without cleanup.
- **Proof (internal validation):** a clean 82-item push read **"100% — 82 of 82"** with the full outcome ledger live on our dev instance (2026-07-09); partial-status (HTTP 207) handling on Jira write paths was specifically adversarially audited before prod (2026-06-22).
- **Content hook:** "Our success screen is designed for the day Jira says no — and for never pushing a duplicate."

## Use case 8 — New customer onboarding: value on day one, no API key ⚠ DECIDED, NOT YET SHIPPED

- **Persona:** Evaluating PO/BA/admin who just installed from the Marketplace and doesn't have an Anthropic API key yet.
- **Situation:** BYOK is a trust feature but an onboarding wall — "get an API key first" kills day-one evaluation.
- **The model we are moving to (founder decision 2026-07-24, implementation pending):** install — free outright at 1–10 users, or on the standard **30-day Atlassian Marketplace trial** at 11+ — and generate immediately, because **every user gets a one-time $5 welcome credit** of AI usage on our managed key. It is **per user, not per site**: in a team of up to 10 each person has their own $5, so when one person's credit runs out the team can keep evaluating through a colleague who still has theirs. When a user's credit is spent they continue with **BYOK** — their own Anthropic key, paid directly to Anthropic, no markup. The honest promise: *"start generating immediately, no API key needed; bring your own key when the welcome credit runs out."*
- **What the code actually does today (do not blur these):** $5 **per install**, lifetime, and **only on a 30-day-trial licence** — a free-tier install gets nothing. Shipped supporting behaviour: a visible "$X of $5 credit left" badge, a pre-run check that blocks any run which wouldn't fit the remaining credit (no surprise cut-offs mid-run), and on exhaustion a friendly "Add your own Anthropic API key to keep going — you pay Anthropic directly" prompt (verified in code 2026-07-24).
- **Outcome (once shipped):** first breakdown within minutes of installing, before any Anthropic signup; paid users are BYOK after the credit.
- **Proof (internal validation):** the (per-install) trial-credit flow was live-accepted on our dev instance 2026-07-12; a typical 10-feature breakdown cost ~$0.045 in API usage in a live run (2026-06-18) — i.e. $5 covers meaningful real evaluation.
- ⚠⚠ **PUBLICATION BLOCKED — this use case may not be used publicly in any form yet.** Three dependencies: (1) the **per-user credit is a decision, not code** — writing it as a live capability would be a false claim; (2) the **"$5" figure is not on the public site** (the live privacy page says only "a small welcome credit") and 13-claims-register.md A2.7 forbids publishing it; (3) the whole no-key experience depends on the **production managed Anthropic key being funded and set** — a pending founder operation at the last recorded handover (2026-07-12), where production was in fact recommended to keep it UNSET; if it is unset, users get a graceful "managed unavailable" prompt instead. [GAP: confirm (a) the per-user welcome credit has shipped to production and (b) the managed Anthropic key is funded + set, before publishing any "$5" or "start without an API key" claim — owner: founder.] Until then the only usable framing is the site's own: "During your free trial, you can start on our Anthropic key — a small welcome credit — before adding your own."
- **Content hook (gated by the block above):** "Install → pick a page → generate. Your first backlog before you've even created an Anthropic account."

---

## Proof-metrics quick table (ALL = internal validation on our dev instance; no customer data)

| Metric | Value | Run date |
|---|---|---|
| Full E2E push, zero failures | 178 items, 0 failures | 2026-05-30 |
| Large-spec breakdown | ~101K-char spec → 39 features / 162 subtasks, dense dependency graph, through chunked push | 2026-05-30 |
| Clean push outcome ledger | 82-item push read "100% — 82 of 82" | 2026-07-09 |
| Scrum plan → native Jira sprints | 17 issues across 5 sprints (team-managed board) | 2026-06-21 |
| Kanban plan → Jira backlog rank | 13 ranked + 14 labeled (company-managed); 14 ranked + 15 labeled (team-managed); order exact | 2026-06-21 |
| Ranking discipline (multi-run) | Hard dependency never violated: 3/3 runs, zero variance; 3/3 across all 4 planning objectives | 2026-06-21 |
| Test-case generation quality | 100% AC coverage, 0 invalid, 0 render-fail across multi-run validation on real specs | 2026-06-07/08 |
| Test cases embedded on push | 13 stories embedded (`tc_embedded=13 tc_skipped=0`) | 2026-06-18 |
| Cost transparency held | Test-gen actual $1.27 < pre-flight "$2.45 max" ceiling; regen accumulates honestly ($1.27→$1.31) | 2026-06-18 |
| Typical breakdown API cost (BYOK) | ~$0.045 for a 10-feature breakdown (batch-priced, single observation) | 2026-06-18 |
| Planner ranking API cost (BYOK) | ~$0.014–0.018 per run | 2026-06-21 |
| Project Context boundary | Domain feature surfaced that no-context run missed; numeric ACs verbatim; 0 cross-domain bleed | 2026-06-02 |

Public phrasing rule: "in internal validation runs (as of <date>)" — never "customers achieve…". Time-savings claims: only the site's positioning line ("~70% less hand-work"), flagged as positioning in 13-claims-register.md [GAP: no measured time-savings study — founder decides whether/how to run one].

---

## Demo script — 3–5 minutes (page → push → plan)

**Prep (before the call):** one rich Confluence spec page open; one breakdown for the same or a second page **already generated** (generation is async and takes minutes — never wait for it live); Jira project empty-ish so created issues are obvious. Suggested framing: "This is a real Confluence page, a real Jira project, my own Anthropic key."

| ~Time | Beat | Say / show | Wow? |
|---|---|---|---|
| 0:00–0:20 | Page Picker | "Spec2Tickets lives inside Confluence." Show the work-in-flight dashboard + pick the spec page. | |
| 0:20–0:50 | Pre-flight check | The go/no-go card: right page? right version/author? complete (unchecked tasks, empty sections)? right Jira project? estimated run. "It checks the input *before* you spend anything." | ⭐ wow #1 — an AI tool that tells you *not* to run it yet |
| 0:50–1:10 | Generate | Click Generate on the live page; show the async spinner + "you can leave, it keeps running". Then: "so we don't watch paint dry — here's one I generated earlier." Switch to the prepared breakdown. | |
| 1:10–1:40 | AI Insights | The triage verdict: shape of the breakdown, the one landmine (e.g. a compliance concern), "look here first" worklist ordered by weight. | ⭐ wow #2 — the AI critiques its own output |
| 1:40–2:30 | Breakdown Editor | Three-pane workbench: worklist → focused story (ACs, Fibonacci points, subtasks, depends-on) → AI-concern rail. Resolve one flagged concern (Edit / Accept / Dismiss) and watch the story flip to reviewed. | ⭐ wow #3 — human-in-the-loop is real, not a checkbox |
| 2:30–3:00 | Review & Push | Confirm screen: destination project by name, commit summary (stories / points / ACs), dependency list. Push → live per-phase progress → outcome ledger: "100% — N of N", Open the Epic. | ⭐ wow #4 — real Epic, Stories, Subtasks **and dependency links** in Jira, seconds later |
| 3:00–3:20 | In Jira | Open the Epic: hierarchy, ACs in descriptions, story points, labels, blocks/blocked-by links. "Everything you saw approved — nothing else." | |
| 3:20–4:20 | Planner | "Plan capacity": team + days + skills → sprint columns with capacity meters, risk register, per-feature 'why here' rationale. One free what-if (+1 sprint) → instant re-pack. Copy the Plan Brief. Then "Assign sprints in Jira" → native sprints appear on the board. | ⭐ wow #5 — spec → backlog → **a defensible plan → real sprints** |
| 4:20–4:40 | Close | "Runs on your own Anthropic key — your content, your agreement. And for teams of up to 10 users the app itself is free — every feature, no time limit." CTA: Marketplace listing. ⚠ Do **not** say "$5", "welcome credit" or promise a no-key start — UC8 is decided-but-not-shipped and publication-blocked; for the paid band say only "from 11 users it is priced per user" and point at the Marketplace listing (see INTERNAL CONTEXT). | |

**Optional QA beat (+40s, for QA-heavy audiences):** from Review, Generate Test Cases (show the cost estimate + armed confirm — "no surprise spend") → triage board → one story's Gherkin with `# Covers:` traceability → Copy .feature/CSV. ⭐ wow — traceable acceptance tests per story, export-ready.

**Kanban variant:** replace the Planner beat with the methodology toggle → Now/Next/Later reach band ("a forecast range, not a fake promise") → "Rank backlog in Jira" → the board reorders.

[GAP: no recorded demo video / public demo asset exists yet — marketing to produce; script above is the source]

---

## Content angles the hooks feed (for 12-marketing-strategy-channels.md)

- Scale story (UC2) and honesty story (UC7) are the most differentiated angles vs. competitors (see 05-competitive.md: rivals are prompt-to-ticket, not spec-to-backlog).
- Planner content (UC4/UC5) targets the "AI that shows its work" theme — deterministic math + advisory AI rationale is a defensible technical story (see 04-positioning-messaging.md).
- Trial content (UC8) pairs with BYOK trust content (see 09-trust-security-compliance.md) — "your key, your data" plus "but day one is on us."

---

## INTERNAL CONTEXT — never publish

- **Dev/validation environments behind the numbers:** dev site `spec2jira-dev.atlassian.net`; projects: SCRUM-DEV/SDTY (178-item run, 82-item ledger run, 17-issues/5-sprints Scrum push), SDKY (company-managed Kanban rank run), KDTM (team-managed Kanban rank + a live-found story-points field fix). The ~101K-char spec is our own Spec2jira product spec.
- **Numbers discipline:** the 82-item "100%" run and the 178/0 run are *clean-path* validations; the partial-ledger/Resume path is validated by design review + adversarial audits and negative-path tests, not by a staged customer outage — don't imply a "recovered from a real customer incident" story.
- **Test-gen cost calibration (do not publish raw):** internal sweep average ~$1.01 per breakdown's test cases, observed range $0.22–3.67 (varies ~16× by spec density); "typically ~$Y" estimator known to run low on decision-table-dense specs (calibration item). Public framing: "estimate up front, hard ceiling shown, actual echoed after — on your own key."
- **Internal quality rubric:** the 11-page test-case sweep scored mean ~7.9/10 on our internal rubric ("expert-grade draft" bar). Never publish the rubric score; publish the coverage/integrity facts instead.
- **Welcome-credit economics — decision vs code:** the **decision** (founder, 2026-07-24) is $5 **per user**, one-time, on the free 1–10 tier and on paid tiers during the 30-day trial, then BYOK. **Shipped today:** $5 **per install**, lifetime, **trial-licence-only**, with a hard spend ceiling of 1.2× the grant (~$6) bounding our worst-case managed exposure per install and a pre-run blocker enforcing "estimate must fit remaining credit". Implementation of the per-user model is pending, so UC8 stays publication-blocked. Managed/"Advanced" as a purchasable edition remains dormant (`price: null` in-app). Never publish ceilings, enforcement modes, or env-var names.
- **Retired-EUR history:** any €3.90/€4.90/€6.90/€9.90/€20/€29/€39/€49/€69/€99 figures in older notes are retired (pre-2026-06-04) — never present a EUR figure as current.
- ⚠ **Pricing — the confirmed model (founder, 2026-07-24; tier table VERIFIED the same day against the Atlassian vendor-portal "Set pricing" screen), superseding every other source.** Paid via Atlassian, USD, per Confluence instance: **up to 10 users free ($0, every feature, no time limit — a real free tier)**, which is a flat-rate *override* replacing the bands for that site, not ten free seats deducted from a bigger bill · then **per user on a declining, graduated curve**: paying starts **from the 11th user**, and the first band is labelled **1–100 at $6.70/user, charged from the first user on the site** (so a 100-user instance is **$670/month** = 100 × $6.70, never "$67 flat") · **$5.10 at 101–250** · **$3.80 at 251–1000** · **$3.50 at 1001–2500** · lower again at scale. ⛔ Never fuse the threshold and the band label into "**11–100 at $6.70**" — 90 users × $6.70 = $603, which contradicts the portal's $670 maximum; say "from 11 users", label the band 1–100. ⚠ Above the first band the curve is graduated (each rate applies only to the users inside its band), so never multiply one of *those* rates by the full headcount — inside 1–100 that multiplication is exactly how $670 arises. It is **per user above 10, not a flat site price**, billed on the **whole instance** (all users, not just app users), with Atlassian showing the exact price for the customer's team size at checkout and a **1.5x multi-instance rate** for customers licensing several sites. ❌ The live public site still says "**$67/month flat for 11+ — not per user**": that is wrong against this model and is being corrected — never quote it. ❌ The in-app `src/usage.js` string "**$6.70/user/mo, ≤10 = $57/mo flat**" is also wrong — the ≤10 band is FREE now (13-claims-register.md B4 still bans $57 / $13.40 in new copy). ❌ The provisional "**$5.70/user at 101+**" recorded earlier on 2026-07-24 is superseded — a misread across portal columns ($5.70 is the *multi-instance* rate of the 251–1000 band). ✅ Publishable now: the free-≤10 fact and "from 11 users it is priced per user"; ❌ hold the per-user rates out of public copy until the site is corrected and 13 clears them. [GAP: the live site and the in-app `src/usage.js` price strings still contradict the verified table — owner: founder (Aleks) + engineering.] Every pricing statement in the use cases and demo script above defers to **02-business-model-pricing.md**; never improvise or "reconcile" a number.
- **Demo risk notes:** live generation takes minutes (Anthropic Batches) — always pre-generate; sprint names auto-truncate to ≤29 chars ("{page} · Sprint N") — pick a short page title for demos; the planner's ranking is advisory (deterministic fallback exists) — if the "Ordered without Claude" banner ever appears in a demo, the honesty framing *is* the talking point.

## Gaps (also returned structurally)

- [GAP: no public customer case studies, testimonials, or referenceable customers — all proof is internal validation; founder decides collection approach]
- [GAP: no measured time-savings study behind the "~70% less hand-work" site claim — positioning only; founder decides whether to run one]
- [GAP: no recorded demo video or public demo asset — marketing to produce from the script above]
- [GAP: no approved specimen of real generated output exists in the KB — a sanitised end-to-end example (source-page excerpt → Epic + one Story with its ACs, points, priority, labels and a blocks-link → one Gherkin scenario with its `# Covers:` line → a plan-brief excerpt) would be the single most useful asset for demonstrative content. Founder to capture one and clear it in 13-claims-register.md Table A; until then writers must describe the output shape, never fabricate a sample]
- [GAP: the per-USER $5 welcome credit is a founder decision of 2026-07-24, NOT shipped code (today: per install, trial-licence only) — it is publishable only after the implementation ships, the managed Anthropic key is funded + set on production, and the founder confirms; see the publication block in Use case 8]
- [GAP: the per-user rates are portal-VERIFIED as of 2026-07-24, with the band mechanic corrected 2026-07-25 ($6.70 across the **1–100** band, which a site enters from its 11th user and which is charged from the first user · $5.10 at 101–250 · $3.80 at 251–1000 · lower at scale, graduated · 1.5x multi-instance), but they are still not reflected on the live site (which shows the wrong "$67 flat") nor in `src/usage.js` — only the free-≤10 fact is publishable today]
- [GAP: current Marketplace install/review counts as of 2026-07-24 not in my sources — see 13-claims-register.md before citing any]
