---
title: Enterprise use cases — benefit-category framing
purpose: The buyer-language layer that sits above the product KB — how Spec2Tickets maps to enterprise benefit categories and named use cases.
visibility: mixed (UC text is buyer-facing; the mapping commentary is internal)
sources:
  - Partner-supplied framing + original use cases (founder, 2026-07-24 conversation) — UC1–UC4 verbatim, except UC4's incumbent test-tool name, generalised for publication safety (original recorded in the INTERNAL CONTEXT block)
  - UC5 authored 2026-07-24 by the conductor, grounded in the shipped Capacity-Sheet Planner
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/CLAUDE.md (planner + test-case + Project Context handovers)
  - memory/capacity-sheet-planner.md · memory/testcase-generation-feature.md
  - docs/PLANNER-LIVE-ACCEPTANCE.md · docs/PLANNER-KANBAN-LIVE-ACCEPTANCE.md
  - static/hello-world/src/components/PlanScreen.jsx (free re-pack vs billed Claude re-rank copy; the conditional "+ why here" rationale on the FeatureChip)
  - manifest.yml (Confluence-only modules — the app declares no Jira UI surface)
  - docs/marketing-kb/01-product-overview.md · 11-faq-objections.md · 10-roadmap-vision-story.md (the "no in-Jira issue panel" product boundary)
last_verified: 2026-07-24
---

# Enterprise use cases — benefit-category framing

> **Read this BEFORE the numbered chapters.** Chapters 01–13 describe *what the product is*.
> This file describes *how a buyer categorises the value* — the language an enterprise
> evaluator, an Atlassian-program reviewer, or a procurement sponsor actually uses.
> Marketing content should lead with the benefit category and the problem statement,
> then reach into 06-use-cases-workflows.md for the workflow detail.

## Benefit categories

| Code | Category | Definition | Our weight |
|---|---|---|---|
| **A** | **Growth & Innovation** | Indirect benefit to driving revenue growth and innovation | Secondary — earned through better ideation → requirements traceability |
| **B** | **Operational Excellence** | Productivity benefits for teams and individuals | **Primary** — 4 of 5 use cases land here |

---

## UC1 — Improve ideation and requirements refinement
*Benefit: Operational Excellence **and** Growth & Innovation*

1. **Use Case(s)** — Improve flexibility of ideation tools to enable teams to more efficiently brainstorm, ideate and bring ideas into requirements while maintaining traceability across goals and work.
2. **Problem Statement** — Current tooling isn't flexible enough for the work that is done in ideation stages. Teams resort to using tools to help with ideation but inputs get lost sometimes or aren't widely visible.
3. **Desired Outcomes** — Efficiency improvements to build roadmaps by making it easier to prepare and run quarterly planning workshops. Improve efficiency to create product requirements documents.

> **Product mapping.** This is **Project Context** (context summarisation): distilled domain/glossary/personas/tech/regulatory/conventions profiles are injected into generation, so created work items are *context-aware*. That makes backlog generation **smart and intelligent** rather than fast-forward generation without logical explanation or interconnection.

---

## UC2 — AI work item creation
*Benefit: Operational Excellence*

1. **Use Case(s)** — There are multiple contexts in which a user might need to create work items in Jira. Goal is to make it easier and faster to capture work in Jira tickets and to use AI to help improve ticket descriptions and summaries using the information derived from the context where the user is currently working.
2. **Problem Statement** — This is time consuming and laborious when multiple work items need to be created at once, or when work items need to be created outside of Jira and the user doesn't want to context switch into Jira.
3. **Desired Outcome** — Less time spent creating Jira work items and reduced context switching, leading to greater efficiency.
4. **App(s) in Scope** — **Confluence:** AI-powered work item creation and planning. **Jira:** AI work breakdown into work items in Kanban/Agile view. **Artificial Intelligence:** create work items, test cases and planning from a Claude agent.

> **⚠ Editor's note — do NOT publish UC2's Jira line verbatim.** That line describes the *evaluator's desired scope*, not our shipped surface. Spec2Tickets has **no in-Jira UI**: the app runs entirely in Confluence (`confluence:globalPage` + the page-byline action; the manifest declares no Jira module), and the Jira side is **write-only** — it creates the Epic, Stories, Sub-tasks and dependency links, and for a plan it creates/assigns sprints or ranks the backlog and applies tier labels. A per-issue Jira panel is an explicit non-goal (01-product-overview.md "What it does NOT do"; 11-faq-objections.md Q10; 10-roadmap-vision-story.md "do NOT promise publicly"). Campaign content derived from UC2 must say **"created in your Jira project, from the Confluence page you are already reading"** — never "in the Jira Kanban/Agile view". [GAP: founder to confirm UC2's Jira scope line before it enters a submission or public post.]

---

## UC3 — Improve user story descriptions and acceptance criteria
*Benefit: Operational Excellence*

1. **Use Case(s)** — Improve quality of user story descriptions and inclusion of acceptance criteria and test cases using an AI agent that incorporates best practices from well-known established enterprise standards.
2. **Problem Statement** — Manually creating and updating work item descriptions and summaries is time consuming. Inconsistent formatting of Jira work items makes it hard to find necessary information. Missing acceptance criteria and test cases leads to waiting times and bottlenecks in delivery and decreases value from the use of AI capabilities during the software development lifecycle.
3. **Desired Outcome** — Improve the time it takes to break down work and complete high-quality user story descriptions including acceptance criteria and test cases. Improve quality of user story descriptions to include relevant acceptance criteria and test cases.
4. **App(s) in Scope** — **AI Agent:** Claude, which improves user story descriptions and suggests acceptance criteria and test cases. **Jira:** automation in the context of issue creation.

---

## UC4 — Generate test cases from requirements and system specs
*Benefit: Operational Excellence*

1. **Use Case(s)** — In the Atlassian Spec2Tickets app, generate test cases in-app from user stories and convert test cases to Gherkin syntax.
2. **Problem Statement** — Currently using a separate test-management system that lives outside Jira and Confluence. This separation creates challenges for shift-left testing and test-driven development. Manual test plan generation is time consuming and there is a desire to have user stories and test case documentation in the same system to reduce context switching and improve traceability.
3. **Desired Outcomes** — Improve efficiency to create test plans and improve quality of testing by deriving test cases from Jira issues directly.

---

## UC5 — Generate quarterly planning from pre-existing methodologies (Agile / Kanban)
*Benefit: Operational Excellence* — **authored 2026-07-24, grounded in the shipped Capacity-Sheet Planner (live on production since v6.0.0, 2026-06-22)**

1. **Use Case(s)** — Generate a quarter's delivery plan directly from the refined backlog and the team's own capacity sheet, expressed in the methodology the team already runs — Scrum (sprint-by-sprint allocation) or Kanban (Now / Next / Later flow) — without forcing a new process on the team. The user supplies capacity per skill group (e.g. backend, frontend, QA), sprint length, number of sprints and a focus factor; the app packs the sized, dependency-aware backlog into sprints or flow tiers, and writes the result back as **native Jira sprints** (Scrum) or **backlog rank order plus tier labels** (Kanban), on both team-managed and company-managed boards. The plan is re-runnable, and the two paths cost differently: capacity, focus-factor and sprint-count changes (and previewing a deferral) re-pack instantly and **free** — deterministic, no AI call; switching the **planning objective** (balanced / MVP-first / maximum value / minimum risk) re-optimises the order itself with a **billed Claude re-rank**, with the estimated cost shown before you confirm.
2. **Problem Statement** — Quarterly and PI planning is prepared in spreadsheets and slides that live outside Jira, so the capacity mathematics is manual, error-prone and stale the moment the backlog changes. Dependencies and critical-path work are discovered during the workshop instead of before it, sequencing decisions cannot be defended when challenged ("why is this in sprint 3?"), and the resulting plan has to be re-keyed into Jira by hand — which means re-planning is so expensive that plans are rarely revised, and teams lose traceability between the requirements they refined and the sprints they commit to. Existing planning tools are deterministic packers that produce an allocation but no reasoning, so the plan carries no argument a delivery lead can take into a stakeholder meeting.
3. **Desired Outcomes** — Reduce the time to produce a defensible quarterly plan from days of spreadsheet work to a single planning session. Ground the plan in real capacity, real dependencies and real sizing rather than optimism, and surface honestly what does **not** fit and why (over-capacity skill groups, items too large for one sprint, blocked chains). Make placements defensible in the planning meeting — each item carries the deterministic scheduling signals (what it unblocks, whether it is on the critical path, whether it has slack, its risk), plus the AI's stated rationale wherever it made a non-obvious sequencing trade-off; if the AI ranking is unavailable the plan is produced deterministically and labelled as such, with the signals still shown. Deliver the plan as executable Jira state, not a document, so the quarter starts already loaded on the board; and make re-planning cheap enough that the plan stays current all quarter.
4. **App(s) in Scope** — **Confluence:** the requirements source and the planning workshop surface (page → breakdown → plan, with the plan brief exported for the meeting). **Jira Software:** native sprint creation and issue assignment with dates and story points for Scrum boards; backlog rank ordering plus `plan-now` / `plan-next` / `plan-later` tier labels for Kanban boards; team-managed and company-managed projects both supported. **Artificial Intelligence:** a Claude agent performs risk-aware sequencing and goal-directed re-ranking, and states its rationale where the sequencing choice was not obvious; all capacity mathematics, dependency resolution, critical-path and packing logic remain deterministic and auditable.

> **Product mapping.** This is the **Capacity-Sheet Planner** — the step that completes the arc **spec → backlog → plan → Jira**. The dispatch is deliberate: pure functions own everything that must be reproducible (capacity buckets, packing, critical path, oversized detection, health reconciliation); one advisory LLM call owns the part that is genuinely judgement (sequencing rationale and objective-driven re-ranking), and its output is presented as **display-only reasoning, never asserted as fact**. This is our sharpest differentiator against deterministic planning add-ons: **the plan defends itself.**

---

## Mapping: use case → shipped capability

| UC | Benefit | Shipped capability | Where it lives in the KB |
|---|---|---|---|
| UC1 | A + B | **Project Context** profiles — distil domain/glossary/personas/tech/regulatory/conventions from Confluence, inject into generation | 01 · 06 (use case 6) |
| UC2 | B | **Spec → breakdown → chunked push**: Epic + Stories + Sub-tasks + dependency links + category labels + priority + story points, created from the page the user is already reading | 01 · 06 (use cases 1–2) · 07 |
| UC3 | B | **Breakdown Editor** (3-pane review workbench) — AI-drafted descriptions, user stories, acceptance criteria, shared-AC handling, per-item AI concerns with a disposition loop | 01 · 07 (screen 4) |
| UC4 | B | **Test-case generation** — per-story, in-app, editable; Gherkin `.feature` + CSV export; checklist embedded on the pushed Jira issue | 01 · 06 (use case 3) · 07 (screen 6) |
| UC5 | B | **Capacity-Sheet Planner** — Scrum native sprints + Kanban rank/tiers, skill-aware capacity, risk-aware sequencing, what-if, plan brief | 06 (use cases 4–5) · 07 (screen 7) |

## How to use this framing in campaign content

- **Lead with the problem statement, not the feature.** Each UC's paragraph 2 is written in the buyer's own words — it is the strongest opening for a blog post or a LinkedIn hook.
- **One UC = one content cluster.** A pillar article per use case, then 3–5 social posts derived from it (see 12-marketing-strategy-channels.md).
- **Benefit category picks the audience.** Operational Excellence → delivery leads, BA/PO, QA leads (efficiency language, time saved). Growth & Innovation → product leadership (traceability from goal to work, better requirements → better bets).
- **Keep the honesty firewall.** Everything published from this framing still passes 13-claims-register.md: no invented customer outcomes, internal validation labelled as such, no promise that AI output ships unreviewed.

### INTERNAL CONTEXT — never publish

- UC1–UC4 are the partner's original framing, supplied 2026-07-24; UC5 was authored to complete the set and is the conductor's synthesis of already-shipped functionality — it describes nothing that is not live.
- UC4's problem statement, as supplied, named **Octane** as the incumbent being displaced. That is a real evaluator's context, not ours to publish, and UC-paragraph text is buyer-facing — so the paragraph above has been generalised **in place** to "a separate test-management system". Restore the specific name only if the founder confirms the reference is shareable. [GAP: founder to decide whether the Octane reference may be named in any external content.]
- **UC2's "App(s) in Scope" Jira line is the evaluator's desired scope, not shipped behaviour** — see the editor's note under UC2. There is no in-Jira UI; the Jira side is write-only (issue creation + link/sprint/rank writes). Every other UC line maps to something live; this one does not, so it must be re-worded (never quoted) in public content.
- The "verify you understand the product" intent behind UC5: the mapping table above is the answer — every use case ties to a capability that is live on production, not roadmap. ⚠ **Production is v7.1.0 as of 2026-07-24, and no engineering handover exists for v7.0/v7.1** — the capability statements here were written against handovers up to the v6.6 work, so re-verify against the live app before a submission leans on a specific behaviour.
- **No pricing statement appears in this file, deliberately** — the UC text is benefit framing, and the "free" in UC5 refers to a free deterministic re-pack (no AI call), not to a price. If a submission or campaign derived from these use cases needs pricing, take it from `02-business-model-pricing.md`: the confirmed model (founder, 2026-07-24; tier table **verified against the Atlassian vendor-portal "Set pricing" screen** the same day) is **free for teams of 1-10 users**, then **per user** above that on a **declining curve** — $6.70/user in the **1-100** band (paying starts from the 11th user, and from then every user on the site is charged from the first, so a 100-user site is 100 x $6.70 = $670; never write "11-100 users at $6.70" — that contradicts the $670 maximum), $5.10 at 101-250, $3.80 at 251-1000, lower again at larger scale (rates internal until the live site is corrected) — billed on the **whole Confluence instance** (every user on the site, not only app users). Never repeat the site's superseded "$67/month flat, not per user"; never write "$5.70/user above 100 users" (that was a provisional misread — $5.70 is the *multi-instance* rate of the 251-1000 band); and never present the $5 welcome credit as live (decided 2026-07-24, implementation pending).
- Candidate UC6/UC7 if more slots are needed (not yet written): **(a)** dependency-aware traceability from goal → requirement → work item → test case (Growth & Innovation — the traceability thread UC1 opens but no UC closes); **(b)** privacy-governed AI adoption — BYOK means the enterprise's own model agreement and DPA govern processing, unblocking AI adoption where a vendor-hosted model would fail review (Operational Excellence + risk). Both are true today; both need the founder's call before entering a submission.
