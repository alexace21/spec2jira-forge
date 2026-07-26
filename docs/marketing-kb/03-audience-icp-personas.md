---
title: "Audience, ICP & Personas — Spec2Tickets"
purpose: Defines who Spec2Tickets is for (ICP, sweet spots, anti-ICP), the six buyer personas with pains/objections/hooks, the buying committee, and trigger events — for the AI marketing assistant.
visibility: mixed
sources:
  - Founder pricing + onboarding decision, 2026-07-24, tier table VERIFIED against the Atlassian vendor-portal "Set pricing" screen (founder screenshot, 2026-07-24) — SUPERSEDES every pricing statement in the sources below (free up to 10 users · then per user on a declining curve: $6.70/user in the 1-100 band, which a site enters from its 11th user · $5.10 101-250 · $3.80 251-1000 · lower again at scale · 1.5x multi-instance · per-user $5 welcome credit decided but not shipped)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/docs/MARKETPLACE-LISTING-v3.md
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/docs/DESIGN-BRIEF-NEXT-SCREENS.md (internal audience/fear research)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/src/usage.js (tier/price strings, trial-credit comments)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/manifest.yml (current scope list)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/CLAUDE.md (handover notes — selected sections)
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/index.html
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/how-it-works/index.html
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/about/index.html
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/pricing/index.html
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/competitive-landscape.md (internal, researched 2026-06-01)
last_verified: 2026-07-24
---

# 03 — Audience, ICP & Personas

**Scope of this file:** who buys/uses Spec2Tickets, why, and what stops them. Product facts → see `01-product-overview.md`; pricing detail → `02-business-model-pricing.md`; competitors → `05-competitive.md`; workflows → `06-use-cases-workflows.md`; screens → `07-product-tour-8-screens.md`; security/legal wording → `09-trust-security-compliance.md` (quote only, never re-draft); objection scripts → `11-faq-objections.md`.

**Naming (intentional, do not "fix"):** product = **Spec2Tickets** ("Spec2Tickets for Confluence & Jira" on the Marketplace); vendor brand + domain = **Spec2JIRA** / spec2jira.com.

---

## 1. ICP — Ideal Customer Profile

**One line:** software/delivery organizations on **Atlassian Cloud** that write specs, PRDs, or requirements docs in **Confluence** and deliver in **Jira** — and want the mechanical spec→backlog translation done by AI while humans keep the judgment.

| Dimension | ICP criteria | Why (source) |
|---|---|---|
| Platform | Atlassian **Cloud** only (Forge app). Installs in **both** Confluence (UI) and Jira (push target); two Manage-Apps entries is normal | Listing doc §0; cross-product note |
| Documentation habit | Real written specs/PRDs/tech designs/requirements docs live in **Confluence pages** | The input IS a Confluence page (site, listing) |
| Delivery habit | Jira backlog with Epic → Story → Subtask; sprints (Scrum) or Kanban; team-managed and company-managed projects both supported | how-it-works; CLAUDE.md planner validation (live 2026-06-22) |
| Work style | Human-in-the-loop culture: wants AI drafts reviewed before anything lands in Jira | Site values: "AI assists, humans decide" |
| AI posture | Wants AI on real, confidential documents **without** handing them to an app vendor — BYOK (own Anthropic API key) fits AI-governance / privacy-constrained orgs; regulated/EU lean | Listing "Your data, your key"; competitive memory (2026-06-01): target "mid-to-large + regulated/EU" |
| Roles present | BA / PO / PM who owns specs; a Jira/Confluence admin who can install + paste an API key | Design brief audiences; how-it-works step 1 |
| Segments seen in copy | Product teams, engineering, agencies & consultancies, discovery teams, platform/migration teams, QA & BA | Site use-case cards |

### Size sweet spots

- **Teams of 1–10 users — FREE, and therefore the acquisition engine.** The whole product at $0, every feature, no time limit, no expiry — zero price friction, and the buying committee usually collapses to one person (the PO doubles as admin). Land here: this band is not a "sweet spot we also serve", it is where adoption starts and where product-led growth has to happen. There is no price conversation at all until the instance crosses 10 users.
- **Instances of 11–100 users — the segment where the paid conversation begins.** Crossing 10 users is the commercial event — that is the **threshold** at which paying starts — and the rate that then applies is the portal's **1–100 band at $6.70 per user/month** *(figure internal for now — see the pricing frame below)*. Because Paid via Atlassian licenses the **whole Confluence instance**, it is priced on **every user on the site, not just the people who use the app** — and the band is counted from the **first** user, not the eleventh. Expect that to be the first question a budget owner asks; answer it head-on (see 11-faq-objections.md Q3). At the top of the band that is **up to $670/month for a 100-user instance** (100 × $6.70) — size the value case accordingly, never as "$67 flat", and never write the band as "11–100 at $6.70" (90 × $6.70 = $603, which contradicts the $670 maximum).
- **Instances of 101+ users — the declining curve, and where procurement joins.** Same whole-instance mechanic at a falling per-user rate (**$5.10 at 101–250 · $3.80 at 251–1000 · $3.50 at 1001–2500 · $3.25 at 2501–7500 · lower again above that**; *internal for now*), which is what keeps a large instance with a handful of BA users viable. Expect procurement involvement and the effective-cost-per-*app*-user math. A customer licensing several Confluence instances pays a **1.5x multi-instance rate** on the same bands.

> **Pricing frame — the confirmed model (founder, 2026-07-24; tier table VERIFIED the same day against the Atlassian vendor-portal "Set pricing" screen; detail in `02-business-model-pricing.md`):**
> Paid via Atlassian, USD, per Confluence instance — **up to 10 users free ($0)** · then **per user on a declining curve**: **$6.70 in the 1–100 band** (paying starts from the 11th user — the threshold — and the band rate is then charged from the first user on the site, so a 100-user instance is $670) · **$5.10 at 101–250** · **$3.80 at 251–1000** · **$3.50 at 1001–2500** · **$3.25 at 2501–7500** · lower again above that (down to $1.15 at 45001+). Above 10 users it is **per user, not a flat site price**, and it is billed on the **whole instance** (every user on the site, not just app users); Atlassian shows the exact price for the customer's team size at checkout. A customer licensing several instances pays **1.5x** the single-instance rate ($10.05 / $7.65 / $5.70 on the first three bands).
> - **The free up-to-10 band is a real free tier** — every feature, no time limit. Never write "we have no free tier"; that statement is wrong.
> - **The most quotable consequence:** a 100-user instance is **up to $670/month**, not "$67 flat".
> - ❌ Do **not** quote the live site's "$67/month flat for teams of 11+ — not per user": it contradicts this model and is being corrected. ❌ Do **not** quote the retired "$6.70/user with $57 flat for ≤10" framing either — the ≤10 band is FREE now, not $57. ❌ Do **not** write "**$5.70 per user at 101+**" (the provisional figure recorded earlier on 2026-07-24) — it was a misread across portal columns; $5.70 is the *multi-instance* rate of the 251–1000 band.
> - ⚠ Publication status: the **free-≤10 fact is safe to publish**; the **per-user rates are portal-verified but the live site still contradicts them** — hold them out of public copy until the site is corrected and 13-claims-register.md clears them; deflect with "from 11 users it is priced per user — the Marketplace always shows the exact price for your team size before you subscribe."
> [GAP: the live spec2jira.com/pricing page still shows the superseded "$67/month flat for 11+" and `src/usage.js` price strings are stale — both surfaces must be corrected before the per-user rates enter public copy. Owner: founder + engineering; 02-business-model-pricing.md owns the resolution.]
>
> Constants: USD, billed via Atlassian Marketplace; every plan is **BYOK** (AI compute billed by Anthropic to the customer at cost, "typically a few cents per breakdown" — public pricing FAQ); test-case generation + sprint planning **included** in the standard product. The **retired in-app metered free tier** (3 breakdowns/month for unlicensed users, dropped 2026-06-03) is a different, historical thing from the free 1–10 user band — never conflate them. Any EUR figure (€3.90/€4.90/€6.90/€9.90/€20/€29/€39/€49/€69/€99) is **retired 2026-06-03-or-earlier history** — never present as current.

### Evaluation path

**Teams of 1–10 users don't evaluate — they just use it free**, indefinitely, with every feature. Only instances of **11+ users** meet an evaluation gate: the standard 30-day **Atlassian Marketplace trial** (standard for Paid-via-Atlassian apps) before the per-user subscription starts.

⚠ **Welcome credit — DECIDED 2026-07-24, NOT YET SHIPPED.** The model we are moving to: **every user** gets a one-time **$5 welcome credit** of AI usage on our managed key — on the free 1–10 tier *and* on paid tiers during the 30-day trial — and it is **per user, not per site** (in a team of up to 10 each person has their own $5, so when one person's credit runs out the team can keep going through a colleague who still has theirs). When a user's credit is spent they continue with BYOK — their own Anthropic key, paid directly to Anthropic, no markup from us. **The shipped code does something different today**: $5 per *install*, and only on a 30-day-trial licence (a free-tier install gets nothing). Treat this as "the model we are moving to (decided 2026-07-24, implementation pending)", never as a live capability. [GAP: implementation pending, AND the production managed key must be funded/set — every public claim about the welcome credit stays BLOCKED until the code ships and the founder confirms; see 13-claims-register.md.]

---

## 2. Personas

Six personas. Format: job-to-be-done · top pains · what the product gives them · #1 objection → honest answer · message hook. Pains marked *(site)* come from public copy; anxieties marked *(design research)* come from the internal per-screen fear analysis (`DESIGN-BRIEF-NEXT-SCREENS.md`) — usable as insight, don't cite the doc publicly.

### 2.1 Business Analyst — primary user & champion

- **JTBD:** turn an approved Confluence spec into a complete, consistent, traceable Jira backlog — then spend the day refining, validating, and aligning with stakeholders instead of transcribing *(site roles card)*.
- **Top pains:** the "transcription tax" — 2–3 days hand-translating one page into epics/stories/subtasks/ACs/dependencies; endless copy-paste; acceptance criteria only where someone remembered them; detail quietly lost in translation; rework downstream *(site "Today" card)*.
- **Anxieties *(design research)*:** reputation — "my name is on these tickets; if the AI got something wrong, it becomes MY mistake"; opaque AI — "did it quietly drop a requirement, and WHERE do I look?"
- **What they get:** whole-page ingestion → Epic + a Story per feature + subtasks + ACs on every story + dependency links + sizing, in minutes; an interactive review editor; AI self-check signals (confidence ✓/⚠/✗, flagged concerns) that direct scarce review time at the risky minority; traceability to the source page (it reads the approved spec, not a retyped prompt).
- **#1 objection:** "It will miss or invent details from *my* spec — and the mistakes land under my name."
- **Honest answer:** human-in-the-loop is the architecture, not a feature flag — nothing reaches Jira until they review, edit, and push; the AI flags its own low-confidence items and concerns so they know where to look; truncation of very large pages is surfaced with a warning banner, never hidden; the breakdown stays traceable to the source spec.
- **Hook:** "Stop transcribing requirements. Start analysing them."

### 2.2 Product Owner / Product Manager — everyday decision-maker, small-team buyer

- **JTBD:** get from "spec approved" to "backlog the team can estimate and start" fast, while keeping their time on priorities, scope, and outcomes *(site roles card)*.
- **Top pains:** backlog mechanics eat the calendar; slow spec→ticket turnaround delays kickoff; inconsistent story quality fuels estimation fights; dependencies surface mid-sprint instead of at planning.
- **Anxieties *(design research)*:** cost — every generation is a real charge on their own Anthropic key ("what is this costing me / am I paying twice?"); loss — "is the breakdown I paid for still there?"
- **What they get:** minutes instead of 2–3 days *(site)*; suggested priority, story points, and complexity per story — editable, honestly varied rather than uniform; a pre-flight check before spending (right page? complete? right project? estimated time + cost band); a post-generation triage view showing where to focus; a work-in-flight dashboard so runs are never lost or double-paid.
- **#1 objection:** "What does the AI actually cost me, run to run?"
- **Honest answer:** the subscription covers the app — and **on a team of 10 or fewer there is no subscription at all ($0)**, so the only cost is AI usage; AI compute is billed by Anthropic directly to the customer's own key **at cost, with no vendor markup** — public FAQ: "typically a few cents per breakdown"; the app shows a cost estimate before expensive actions and echoes the actual cost after; test-case generation sits behind an explicit two-step cost confirmation.
- **Hook:** "From approved page to sprint-ready backlog in minutes — your time stays on priorities, scope, and outcomes."

### 2.3 Scrum Master / Delivery Lead

- **JTBD:** turn the backlog into a sprint (or Kanban) plan the team can commit to and they can defend in the planning meeting; keep sequencing honest.
- **Top pains:** missed cross-feature dependencies blow up sprints; over-committed sprints from optimistic packing; capacity lives in a spreadsheet disconnected from Jira; plans nobody can explain ("why is this story in sprint 3?").
- **What they get:** cross-feature "blocks / is blocked by" relationships detected and created as **real Jira links** — "sequencing is clear from day one" *(site)*; **sprint planning included**: feed team capacity → a proposed sprint plan pushed to native Jira sprints (Scrum) or backlog rank Now/Next/Later (Kanban), on team- and company-managed boards; a plan that **defends itself** — per-feature AI rationale plus deterministic scheduling signals (unblocks / critical path / slack) and what-if exploration; honest "doesn't fit" reporting instead of a silently overstuffed sprint.
- **#1 objection:** "An AI plan won't respect our real capacity or context."
- **Honest answer:** the plan is packed deterministically from the team's **own capacity input**; the AI contributes an advisory ranking with visible, clearly-attributed reasoning ("Claude's reasoning" is labeled as such, never asserted as fact); everything is reviewable and editable before anything is written to boards.
- **Hook:** "A plan that defends itself — sequencing, capacity, and the why behind every placement."

### 2.4 Engineering Lead — technical evaluator

- **JTBD:** make sure the team starts from complete, correctly-scoped work items; protect the board from junk tickets and mid-sprint surprises.
- **Top pains:** vague one-paragraph tickets → guesswork and rework *(site: "a vague paragraph and a guess")*; missing acceptance criteria; hidden dependencies; naive AI sizing ("everything is a 5") they can't trust.
- **What they get:** a real hierarchy (Epic → Stories → Subtasks) with descriptions, ACs, and embedded task checklists; per-story priority/story-points/complexity produced by the model and editable — sizing varies honestly; confidence scores and typed concerns (risk, ambiguity, assumption, compliance) visible at review; a dependency graph including automatic circular-dependency detection and repair.
- **#1 objection:** "AI backlog tools flood Jira with slop that we then clean up."
- **Honest answer:** nothing is created until a human reviews and pushes; the app **creates issues but never deletes** anything and acts under the pushing user's **own Jira permissions**; the confirm screen shows exactly what will be created and in which project before the one irreversible write; over-inferred dependencies can be trimmed pre-push; partial push failures are itemized honestly — a partial never reads as clean success.
- **Hook:** "Start coding from a definition of done, not a guess."

### 2.5 Jira/Confluence Site Admin — the gatekeeper

- **JTBD:** approve, install, and configure the app safely for the **whole instance**; defend the data path to the security team; keep it working for every BA on the site.
- **Top pains / anxieties *(design research)*:** every AI app means a security review; accountability — a wrong project key or missing custom field "breaks it for everyone and I get blamed"; bill-shock by proxy — "I paste a key that bills MY Anthropic account; will the whole company drain it?"; non-expert anxiety — wants to be led step-by-step, not handed a flat form.
- **What they get:** a pure Atlassian Forge app — **no vendor backend, nothing to host**; a single declared external egress (`api.anthropic.com`) under the **customer's own** API key; the key held in Forge encrypted secret storage, never returned to the browser; a least-privilege scope set (11 scopes as of 2026-07-24: storage, Confluence search/read/user, Jira read/write, plus 5 jira-software scopes for sprint planning — verify against `manifest.yml` before publishing counts); ~5-minute setup via in-app Settings; a configuration health check that probes the **real** production code paths; a diagnostics ledger that contains **no page content** and never leaves the instance.
- **#1 objection:** "Another AI app to security-review — where exactly does our content go?"
- **Honest answer:** content flows Atlassian Forge → Anthropic under the customer's **own** Anthropic key and agreement; the vendor operates no servers and never receives content — "we can't see your data because we never receive it" *(site)*; privacy policy, DPA, and sub-processor pages are published on spec2jira.com (quote them via `09-trust-security-compliance.md`; never paraphrase legal wording). Two entries in Manage Apps (Confluence + Jira) are normal for a cross-product Forge app.
- **Hook:** "Privacy by architecture, not by promise."

### 2.6 QA Lead / Test Lead

- **JTBD:** ship a test suite that provably covers every acceptance criterion — sign-off they can defend when something escapes.
- **Top pains:** hand-writing test cases from tickets; suites that *look* green but silently omit an AC (the escaped bug lands on their sign-off) *(design research — the failure the feature exists to prevent)*; test cases going stale when stories are edited; scepticism that AI-generated test cases hold up under review at all — treat this as a category-level objection, never as a claim about rivals *(internal: the only evidence is one rival's advertised test-case feature failing our single 2026-06-01 trial; `05-competitive.md` forbids publishing that without re-verifying — and a second rival's test-case feature is mature, so the plural "rival tools" framing was also inaccurate)*.
- **What they get:** AI-generated acceptance test cases per story (happy path / negative / edge), **included in the standard product** *(site pricing page)*; per-AC coverage tracking with **uncovered ACs listed verbatim**; staleness detection when ACs change after generation; per-case confidence and typed concern flags; editable cases with an explicit save gate — only human-saved cases reach export or push; BA-grade **Gherkin `.feature` + CSV export** "ready to import into your test tools" *(site)*; cases embedded into the pushed Jira stories.
- **#1 objection:** "AI test cases will look plausible and silently skip a requirement."
- **Honest answer:** coverage is computed per acceptance criterion and anything uncovered is named verbatim — the product's internal design rule is "an uncovered AC is expensive; an extra depth case is a cheap delete"; the model's own low-confidence and flagged-concern cases are surfaced for review, and a human save gates everything that ships.
- **Hook:** "Every acceptance criterion, provably covered — or flagged."

---

## 3. Persona anxieties → trust levers (from the per-screen fear research)

Mined from `DESIGN-BRIEF-NEXT-SCREENS.md` — the product was explicitly designed around these fears. Use the **fear** as the pain hook and the **lever** as the proof point. (Screen names → `07-product-tour-8-screens.md`.)

| Fear (audience language) | Who feels it most | Shipped trust lever |
|---|---|---|
| "Is this the right page — and is the spec complete enough to generate from?" | BA, PO | Pre-flight check card before generating: verdict + tiles (right page? / complete? — empty sections, open task checkboxes / right project? / this run — time + cost band) |
| "What is this run costing me? Am I paying twice?" | PO, Admin | BYOK at-cost (no markup); cost estimate before, actual cost echo after; "resume vs restart" guard when a page already has a breakdown |
| "Did the AI quietly get something wrong I'll be blamed for — and where?" | BA, PO | Post-generation triage: confidence distribution, flagged-feature worklist, typed concerns (incl. compliance flags), sizing spread |
| "Am I about to pollute the WRONG Jira project?" | BA, PO, Eng Lead | Confirm screen leads with destination project name + key and exact item counts before the one irreversible write |
| "Will the push half-finish and leave Jira silently inconsistent?" | Eng Lead, SM | Chunked push with live per-phase counts; outcome ledger where a partial **never** reads as clean; resume-push creates only what didn't land |
| "Is the work I paid for lost or about to be auto-deleted?" | PO, BA | Work-in-flight dashboard; retention callouts (unpushed results kept ~7 days); "you can leave and come back" reconnect |
| "A green test suite that misses an acceptance criterion" | QA Lead | Per-AC coverage with verbatim uncovered-AC list; staleness flags; save-gated export |
| "One config mistake breaks it for the whole company" | Admin | Settings pre-flight verdict; health check probing real code paths; per-field validation; two-step armed destructive actions |
| "Where does our content actually go?" | Admin, Security | BYOK data path (Forge → Anthropic under the customer's own agreement), no vendor backend, no-content diagnostics, published privacy/DPA |

---

## 4. Buying committee

| Role | Typical titles | Role in the deal | What they need to hear |
|---|---|---|---|
| Champion / daily user | BA, PO, PM | Finds the app, installs it (free at ≤10 users) or runs the 30-day trial (11+), demos to the team | Time back (minutes vs days), quality signals, "you stay in control" |
| Technical evaluator | Engineering Lead / Tech Lead | Judges output quality on a real spec | Real hierarchy + dependencies + honest sizing; creates-never-deletes; review gate |
| Gatekeeper | Jira/Confluence site admin | Installs (both products), approves scopes, configures the API key | Forge-only, scope list, key storage, 5-minute setup, health check |
| Security / compliance | Security reviewer, DPO | Approves AI use on real documents | BYOK under the customer's own Anthropic agreement; no vendor backend; published privacy/DPA/sub-processors (see 09) |
| Budget owner | Head of Delivery/Engineering; Atlassian billing admin | Approves the Marketplace subscription — **only exists as a role once the instance passes 10 users**; below that there is nothing to approve | Pricing (see 02 + the Marketplace listing), why it is priced on the whole instance rather than app users, value per breakdown, standard 30-day trial, cancel via Atlassian admin |
| Expansion stakeholder | QA Lead | Widens usage after adoption | Included test-case generation + coverage + export |

**Small-team note:** at ≤10 users the committee usually collapses to one or two people (the PO/BA is often also the admin) **and there is no budget owner at all — the tier is free** — which is why the ≤10 band is the land-and-expand acquisition engine. The committee above only assembles when the instance crosses into the paid, per-user band at 11 users.

---

## 5. Trigger events (when they buy)

Marketing hypotheses grounded in product capabilities and public use-case copy — **not** observed customer data [GAP: no customer interview/win-loss data exists in any source as of 2026-07-24; who owns collecting it?].

- **A big spec/PRD just landed** in Confluence and needs to become a backlog this week — the core JTBD moment *(site use cases)*.
- **New quarter / PI / sprint-zero planning** — peak backlog-creation load; the included sprint/capacity planner is directly relevant.
- **Backlog refinement crunch** or a newly spun-up team staring at a blank board *(site: "a first-cut backlog to react to, instead of a blank board")*.
- **QA coverage push or audit** — the included per-AC test-case generation + Gherkin/CSV export answers it.
- **AI-adoption mandate with privacy constraints** — leadership says "use AI" while security says "don't hand our documents to a vendor"; BYOK ("your data, your key, your agreement") is the reconciling answer.
- **Agency/consultancy wins a new client** with a requirements document to scope and staff "the same day" *(site use case)*.
- **A sprint just blew up on a missed dependency** — the dependency-graph + real Jira links pitch lands hardest right after the pain.

---

## 6. Anti-ICP — who we honestly should NOT chase

| Segment | Why not | Say instead |
|---|---|---|
| Teams with no written specs in Confluence (specs in Notion/Google Docs/Word, or nothing written) | The input is a Confluence page; without one there is nothing to point the app at | "Spec2Tickets shines when your requirements already live in Confluence" |
| Prompt-first solo users ("one sentence → tickets") | Our value is whole-spec altitude, hierarchy, dependencies, traceability; a one-line prompt doesn't exercise it. Cheap prompt-to-backlog tools exist (e.g., Storygenie — free ≤10 users as of 2026-06-01; see `05-competitive.md`) | Don't position against prompt tools on the job they do; concede the segment. Note their free-≤10 offer is now **parity, not an advantage over us** — we are free ≤10 too |
| Jira/Confluence **Data Center / Server** | Forge = Atlassian **Cloud only**. (POPal serves DC — as of 2026-06-01) | "Cloud-only today" — no DC roadmap claims (see `10-roadmap-vision-story.md`) |
| Orgs that prohibit ANY external LLM processing of their documents, even under their own key | Content must flow to Anthropic's API (`api.anthropic.com`); there is no on-prem/local-model option | BYOK answers "no third-party vendor," not "no cloud AI at all" — be precise |
| Confluence-only shops that don't deliver in Jira | The output is Jira issues; the push requires the Jira Cloud install | — |
| Teams wanting in-Jira single-issue enrichment (expand one ticket in the issue view) | We work at page altitude from Confluence; rivals live inside the Jira issue view (as of 2026-06-01) | Concede the micro use case; own the spec→backlog job |

---

## 7. Message-hook cheat sheet

| Persona | Hook (derived from public site copy) |
|---|---|
| BA | "Stop transcribing requirements. Start analysing them." |
| PO / PM | "From approved page to sprint-ready backlog in minutes." |
| Scrum Master / Delivery Lead | "Sequencing visible from day one — and a plan that defends itself." |
| Engineering Lead | "A definition of done, not a guess." |
| Admin / Security | "Privacy by architecture, not by promise." |
| QA Lead | "Acceptance criteria on every story — and test cases that prove it." |

Umbrella framings (owned by `04-positioning-messaging.md`): the hero "Your Confluence page is already a backlog. Let it write itself." and the problem frame "the transcription tax" (2–3 days → minutes; ~70% less hand-work; 100% human-reviewed — all site-published stats; keep the "as published on spec2jira.com" attribution when reusing).

---

## INTERNAL CONTEXT — never publish

- **Primary persona per internal design research:** the PO/BA is explicitly a **non-engineer**; every screen was designed around cost-anxiety + reputation-anxiety (their own money via BYOK, their own name on the Jira issues). The admin is framed as configuring "for the whole instance" (accountability fear); the QA lead as doing "sign-off-grade" review (liability fear). Use as empathy input; don't cite the design brief publicly.
- **Internal cost anchors (do NOT publish figures):** internal docs cite ~$0.118 avg / ~$0.24 max Anthropic-side cost per breakdown, test-case suites roughly $1–$3.67 observed, and one live validation at $0.045 for a 10-feature breakdown (2026-06-18 note). Public phrasing is only "typically a few cents per breakdown" (site pricing FAQ).
- **Welcome-credit mechanics — decision vs code (do not blur them):** the **decision** (founder, 2026-07-24) is $5 **per user**, one-time, on the free 1–10 tier and on paid tiers during the 30-day trial, then BYOK. The **shipped code** grants $5 **per install**, lifetime (not monthly), **trial-licence-only** (a free-tier install gets nothing), spent on the vendor's Anthropic key, with a hard exposure ceiling slightly above the grant. Implementation of the per-user model is pending. **Nothing about the credit is public-safe yet** — no dollar figure, no "start without a key" promise — until the code ships AND the founder confirms (13-claims-register.md). Ceiling values, enforcement modes, and env-var names stay internal regardless.
- **Pricing — confirmed and portal-verified, but the surfaces are not aligned yet:** the founder-confirmed model (2026-07-24, tier table verified against the vendor-portal "Set pricing" screen) is free up to 10 users · $6.70/user in the 1–100 band (entered from the 11th user, then charged from the first user on the site — so 100 users = $670) · $5.10 101–250 · $3.80 251–1000 · $3.50 1001–2500 · lower again at scale, with a 1.5x multi-instance rate — per user above 10, billed on the whole instance. It supersedes **both** older states in the sources: the in-app `src/usage.js` strings ($6.70/user, "$57 flat ≤10") **and** the live site's "$67/month flat for 11+, not per user" — the site figure is wrong against the model and is being corrected. It also supersedes the **provisional "$5.70/user at 101+"** recorded earlier the same day: that was a misread across portal columns ($5.70 is the *multi-instance* rate of the 251–1000 band). The per-user figures stay out of public copy until the site is fixed; the free-≤10 fact is safe to use now. All EUR figures anywhere in older docs are retired history (pre-2026-06-04).
- **Target-market lean (internal competitive memory, 2026-06-01):** BA/PO/PM/product teams with real specs; mid-to-large; regulated/EU lean (BYOK privacy is the wedge). Storygenie's published "never input personal or customer data; use fictional personas" is the foil our "process your REAL spec under your own Anthropic agreement" answers — competitor claims must carry "as of 2026-06-01" until re-verified (see 05).
- **No customer evidence exists.** As of 2026-07-24 the sources contain **zero** named customers, testimonials, quotes, or Spec2Tickets install/review counts. Never invent any. [GAP: current Spec2Tickets install + review counts — check the live Marketplace listing before citing adoption.]
- **Why the rate declines above 100 users:** Paid-via-Atlassian bills the whole Confluence instance (all users, not just app users), so a single per-user price would price out large instances — hence the declining curve ($5.10/user at 101–250, $3.80 at 251–1000, $3.50 at 1001–2500, and lower again at scale) against $6.70/user in the 1–100 band. Sales conversations with large instances should anticipate the effective-cost-per-*app*-user question (detail in 02). The band edges are portal-verified as of 2026-07-24.
- **Scope count drift risk:** "11 scopes" is accurate against `manifest.yml` on 2026-07-24; re-verify before any public security claim (scope adds require customer re-consent and are release events).

---

## Open gaps (recap)

1. [GAP: the vendor-portal tier table is VERIFIED (2026-07-24: free up to 10 · $6.70/user in the 1–100 band, entered from the 11th user · $5.10 101–250 · $3.80 251–1000 · lower at scale · 1.5x multi-instance), but the live site still shows the wrong "$67 flat" and the in-app `src/usage.js` price strings are stale — both must be corrected before the per-user figures (not the free-≤10 fact) enter audience copy. Owner: founder + engineering.]
2. [GAP: the per-USER $5 welcome credit is a decision (2026-07-24), not shipped code (today: per-install, trial-only) — implementation pending and the production managed key must be funded/set; all public welcome-credit claims stay blocked.]
3. [GAP: no customer interview / win-loss / adoption data behind the personas — pains are grounded in product/design research + public site claims; who owns collecting real customer evidence?]
4. [GAP: current Spec2Tickets install + review counts — check the live Marketplace listing before citing adoption numbers.]
