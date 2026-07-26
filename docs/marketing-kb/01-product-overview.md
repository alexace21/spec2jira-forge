---
title: "Spec2Tickets — Product Overview & Full Feature Inventory"
purpose: One-stop factual reference on what Spec2Tickets is, the end-to-end workflow, every shipped feature, platform facts, and honest boundaries.
visibility: mixed
sources:
  - Founder pricing + onboarding decision, 2026-07-24, tier table VERIFIED against the Atlassian vendor-portal "Set pricing" screen (founder screenshot, 2026-07-24) — SUPERSEDES every pricing statement in the sources below (free up to 10 users · then per user on a declining curve: $6.70/user in the 1-100 band, which a site enters from its 11th user · $5.10 101-250 · $3.80 251-1000 · lower again at scale · 1.5x multi-instance · per-user $5 welcome credit decided but not shipped)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/README.md
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/CLAUDE.md (sections: "What this is", Monetization block, "Architecture (end-to-end)", "Current state & known gaps", handover notes 2026-06-02 through 2026-07-12)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/docs/MARKETPLACE-LISTING-v3.md
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/manifest.yml
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/src/usage.js
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/index.html
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/how-it-works/index.html
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/pricing/index.html
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/standard-only-trial-credit.md (Standard-only pivot; Advanced retired as an offer 2026-07-11)
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/marketplace-launch-state.md (edition state; Managed dormant/never sold)
  - https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira (listing URL; not fetched)
last_verified: 2026-07-24
---

# 01 — Product Overview & Full Feature Inventory

## Naming (intentional — do not "fix")

- **Product name:** **Spec2Tickets** — "Spec2Tickets for Confluence & Jira" on the Atlassian Marketplace.
- **Vendor brand / domain:** **Spec2JIRA** / **spec2jira.com**. The split is deliberate: Spec2JIRA is the vendor, Spec2Tickets is the app.
- Founder facts that are public-safe: Aleks Asenov, sole trader, Sofia, Bulgaria (on the public site). Never publish bank/tax/ID details or street addresses.

## Elevator descriptions

**1 sentence.** Spec2Tickets is an Atlassian Forge app that reads an entire Confluence specification page and — using Anthropic Claude, normally on the customer's own API key — turns it into a reviewed, sprint-ready Jira backlog: one Epic, Stories with acceptance criteria and story points, Subtasks, and real dependency links.

**Short paragraph.** Most AI backlog tools expand a one-line prompt or enrich a single ticket. Spec2Tickets works at the altitude of the whole document: point it at a Confluence spec, PRD, or requirements page and Claude produces a complete Jira breakdown — Epic, Stories, Subtasks, acceptance criteria, story points, priorities, labels, and cross-feature "blocks / is blocked by" links — which a human reviews and edits in an interactive editor before anything is written to Jira. It runs entirely inside the customer's Atlassian Cloud instance on Atlassian Forge (no vendor backend), and content goes straight to the customer's own Anthropic account (BYOK), so teams can process real, confidential specs.

**Long paragraph.** Spec2Tickets attacks the "transcription tax": a thoughtful Confluence page already exists, then someone spends 2-3 days hand-translating it into epics, stories, subtasks, acceptance criteria, and dependencies — and detail quietly gets lost. Spec2Tickets reads the whole page and drafts the entire backlog in minutes. The workflow keeps humans in charge end-to-end: a deterministic pre-flight check confirms you picked the right, complete page; generation runs asynchronously (leave and come back); an AI Insights triage screen tells you where to look first; a three-pane review workbench lets you edit every story, AC, subtask, and dependency and work through the AI's own flagged concerns; and a chunked Push creates the Epic, Stories, Subtasks, dependency links, and labels in Jira under the user's own Atlassian permissions, with a live progress bar and an honest outcome ledger (a partial push never reads as clean, and Resume-push finishes only what didn't land). Beyond the core breakdown, the same reviewed backlog feeds two follow-on capabilities: per-story AI test-case generation (BA-grade Gherkin/CSV, embeddable into the pushed Jira stories) and a capacity-aware sprint/Kanban planner that turns the backlog plus a team capacity sheet into a defensible plan and pushes it to real Jira sprints or backlog rank. Privacy is architectural, not contractual: no vendor backend, the only external egress is api.anthropic.com, and under BYOK the vendor never receives customer content.

## Quick facts

| Fact | Value |
|---|---|
| Category | AI backlog generation / project management for Atlassian Cloud |
| Platform | Atlassian **Forge** app — runs inside the customer's Atlassian Cloud instance; **no vendor-operated backend** |
| Products | **Confluence Cloud** (the app UI lives there) + **Jira Cloud** (push target). Cross-product: **2 entries in Manage Apps is normal and expected** |
| AI | **Anthropic Claude Sonnet 4.6** (primary) / **Claude Haiku 4.5** (fallback; also powers Project Context distillation), via the Anthropic **Message Batches API** |
| Key model | **BYOK** — customer's own Anthropic API key; stored in Forge encrypted secret storage; content governed by the customer's own Anthropic agreement |
| Evaluation | **Teams of 1-10 users are free ($0)** — every feature, no time limit. A real free tier, not a trial (founder-confirmed 2026-07-24). **Teams of 11+** get the standard **30-day Atlassian Marketplace trial** before the per-user subscription starts. ⚠ The **$5 welcome credit** of managed AI usage (per user, on the free tier and during paid trials) is **DECIDED 2026-07-24 but NOT YET SHIPPED** — today's code grants $5 per *install* and only on a trial licence — so never write it as a live capability. Detail → 02-business-model-pricing.md. **No in-app metered free tier** (the 3-breakdowns/month allowance for unlicensed users was retired 2026-06-03 — a different, historical thing; do not conflate) |
| Edition | A single **Standard** edition includes everything (breakdown + push, Project Context, test cases, planner) |
| Edition — retired vs dormant (never blur these two) | **Advanced** (BYOK, test-case generation as its anchor) was **folded into Standard on 2026-07-11 and is no longer an offer**; existing/pending Advanced subscribers keep full access. **Managed / "no key required"** (we would supply the Anthropic key) is a **dormant edition that was never sold and is not advertised** — do not price it publicly. Figures and status → 02-business-model-pricing.md |
| Marketplace | https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira |
| Site | https://spec2jira.com (vendor brand Spec2JIRA) |
| Support | support@spec2jira.com · security@spec2jira.com · privacy@spec2jira.com · support hours 11:00-23:00 Europe/Sofia, 7 days/week (site footer) |
| Headline site stats (as of 2026-07-24, site copy) | "~70% less hand-work", "minutes, not 2-3 days", "100% human-reviewed before anything reaches Jira" |

## End-to-end user journey

1. **Install & configure (~5 min).** Install from the Marketplace into **both** Confluence and Jira (two Manage Apps entries = normal). In-app Settings (reachable from the app itself, no digging through Atlassian admin): paste an Anthropic API key + a default Jira project key. ⚠ Starting **without** a key (generating on our managed key against a $5 welcome credit) is the **decided-but-not-yet-shipped** onboarding model (2026-07-24) — do not describe it as available; see 02-business-model-pricing.md.
2. **Open the app.** Two entry points: the Spec2Tickets global page in Confluence (its home is an async "mission control" Page Picker — work in flight, resumable jobs, expiry notices, page search) or a **"Generate Breakdown with Spec2Tickets"** action directly on a Confluence page (opens the app with that page pre-selected).
3. **Pre-flight check (deterministic, no AI).** Before generating, a go/no-go card answers: right page? (version, last-edited date/author) · complete? (structural outline, empty sections, open task checkboxes) · right project? · what this run will look like (size, time band). Advisory only — it never blocks Generate.
4. **Generate (async).** The page is submitted to Claude via the Message Batches API. Typically a few minutes; longer for large pages or heavy Anthropic load. **The user can close the tab and come back** — the job keeps running and the app reconnects to it. A stale-page banner appears if the Confluence page was edited since generation; one-click Regenerate.
5. **AI Insights triage.** Post-generation orientation: an overall verdict, count tiles (including an explicit "unrated" bin), the one compliance landmine if present, a weight-sorted "look here first" list, and a sizing/concern fingerprint of the breakdown.
6. **Review workbench (Breakdown Editor).** Three panes: a worklist (Epic + shared ACs + category-grouped stories with confidence icons), a focused story editor (title, description, user story, ACs, editable subtasks with types, story points on a Fibonacci scale, priority, labels, depends-on with a circular-dependency guard), and an AI-concern rail (Edit-to-fix / Accept / Dismiss-with-reason per concern; resolved stories flip to "reviewed"). Shared ACs are allocated via a wizard; new stories can be added.
7. **Review & Push (Confirm → Pushing → Pushed).** Confirm leads with the destination **project name + key** (kills the wrong-project fear), a commit summary (story points, priority mix, AC totals), a readiness strip, and a dependency editor that flags unresolvable links before push. Push is **chunked** (bounded Jira batches with live per-phase counts, ETA and %). The Pushed screen is an honest outcome ledger: completeness %, itemized failures, deep links to the new Epic/Stories — **a partial push never reads as clean**, and **Resume-push** creates only what didn't land (idempotent, no duplicates).
8. **Optional follow-ons from the same breakdown.** Per-story **test-case generation** (typed cases, Gherkin/.feature + CSV export, embeddable into the pushed stories) and the **Capacity/Sprint Planner** (capacity sheet in → risk-aware plan out → push to native Scrum sprints or Kanban Now/Next/Later rank).
9. **Data hygiene, automatic.** The raw page content and breakdown are purged after a successful push; generated-but-never-pushed breakdowns are auto-deleted 7 days after last access (daily sweep). See 09-trust-security-compliance.md.

Result in Jira: **1 Epic + N Stories (with ACs, story points, priority, category labels) + Subtasks + Story-blocks-Story links** — created under the invoking user's own Atlassian permissions (`asUser`), never a service account.

## Full feature inventory

### Core breakdown + push

| Feature | What it does | Who cares |
|---|---|---|
| Whole-spec breakdown | Reads an entire Confluence page (spec/PRD/design/requirements) and generates Epic → Stories → Subtasks with descriptions, user stories, ACs — not a flat list from a prompt | BA/PO (days → minutes), engineering (traceable to source) |
| Acceptance criteria on every story | Consistent AC coverage; shared/cross-cutting ACs are deduplicated and allocatable to the right story | QA, BA, developers ("definition of done, not a guess") |
| Sizing signals | Model-produced, editable story points (Fibonacci), priority, and complexity per feature — sizing varies honestly per feature | PO, delivery leads, estimators |
| Cross-feature dependency links | Detects "blocks / is blocked by" relationships and creates them as **real Jira issue links** | Engineering leads, planners (sequencing visible day one) |
| Automatic cycle repair | Deterministic detection of circular dependencies + a targeted AI call to cut the soft edge; surfaced to the reviewer, never silent | Engineering leads, skeptical reviewers |
| Category labels | Features grouped/labelled by category; labels editable on Epic + every Story before push | PO, teams with label conventions |
| Chunked push with live progress | Issues created in bounded batches with per-phase live counts, ETA and % — scales to very large specs (internally validated: 39 features / 162 subtasks / 178 Jira items in one push, 0 failures, 2026-05-30) | Anyone with a big spec; admins (reliability) |
| Dynamic Jira adaptation | Resolves subtask issue type, story-points field, and priority scheme per project (team-managed and company-managed, localized instances); optional required-custom-fields config | Jira admins, enterprises with customized Jira |
| Attributed writes | All Confluence reads and Jira writes run as the signed-in user (`asUser`) — user's own permissions, no service account | Admins, security reviewers |
| Async generation you can walk away from | Message Batches API job + reconnect: close the tab, come back, resume review | Busy BAs/POs |

### Pre-flight page check (before Generate)

| Feature | What it does | Who cares |
|---|---|---|
| Go/no-go verdict card | Green/amber verdict with enumerated causes before spending AI budget | PO/BA (confidence), finance-minded admins |
| "Right page?" tile | Page version, last-edited date and author | Reviewers avoiding stale/wrong pages |
| "Complete?" tile | Structural facts only (no prose guessing): empty sections, task-checkbox progress, content outline with per-section pills | BA (spec completeness) |
| Run preview | Estimated generation time band, destination project key, page size | Everyone about to click Generate |
| Never blocks | Purely advisory — Generate stays available | Users who know their page is fine |

### AI Insights triage (post-generation)

| Feature | What it does | Who cares |
|---|---|---|
| Tri-state verdict + tiles | Immediate read on breakdown trustworthiness, including an explicit "unrated" bin (never false-green) | PO/BA deciding how much review to invest |
| "Look here first" list | Features weight-sorted by risk/uncertainty so review time goes where it matters | Time-pressed reviewers |
| Compliance landmine callout | Surfaces the one flagged compliance-critical item, if any | Regulated-industry teams |
| Concern fingerprint + sizing spread | Distribution of concern types and story-point spread across the breakdown | Leads sanity-checking shape |

### Breakdown Editor (3-pane review workbench)

| Feature | What it does | Who cares |
|---|---|---|
| Three-pane layout | Worklist (Epic + shared ACs + flag-sorted stories) · focused story · AI-concern rail | Reviewers on large breakdowns |
| Full inline editing | Title, description, user story, ACs, subtasks (name/description/type), story points, priority, labels, dependencies | BA/PO shaping the backlog |
| AI-concern workflow | Per-concern Edit-to-fix / Accept / Dismiss-with-reason + undo; a story whose concerns are all addressed flips to "reviewed" and leaves the worklist count | Reviewers ("what's left to check?") |
| AI self-check honesty | Confidence badges are the model's own original read, labeled as such (Confident / Unsure / Low-confidence) — never presented as ground truth | Skeptical adopters, AI-governance minded buyers |
| Shared-AC assignment wizard | Cross-cutting ACs allocated to the right story via a guided wizard (mutual-exclusivity rules) | QA/BA (no duplicate ACs) |
| Add stories / cycle guard | New stories via wizard into a chosen category; dependency edits guarded against creating cycles | Teams filling gaps the AI missed |

### Review & Push (Confirm → Pushing → Pushed) + Resume

| Feature | What it does | Who cares |
|---|---|---|
| Pre-push Confirm | Destination project **name + key** up front, commit summary (SP sum, priority mix, AC total), readiness strip, armed two-step confirm | Anyone afraid of pushing to the wrong project |
| Dependency pre-check | Unresolvable dependency links flagged amber **before** push ("won't create a Jira link"), removable/restorable per link | Engineering leads |
| Live push progress | Epic-created anchor, per-phase counts (stories → subtasks → links), real ETA and % | Users pushing 100+ items |
| Honest outcome ledger | Severity-graded results, completeness %, itemized failures with causes, rejected-field fix hints; **a partial never reads as clean** | Admins, trust-sensitive buyers |
| Resume-push | After a partial, creates **only** what didn't land — idempotent, duplicate-safe | Anyone whose push hit a permissions/field snag |
| Deep links + exports | Open-the-Epic / open-Stories links; captured test-case exports (.feature/CSV) survive the post-push purge | Reviewers closing the loop |

### Test-case generation (per-story)

| Feature | What it does | Who cares |
|---|---|---|
| Per-story AI test cases | Generates typed test cases (happy-path / negative / edge) per Story, grounded in the story + the source spec | QA, BA (rivals do this poorly — see 05-competitive.md) |
| Triage board + wizard | Overview board (type distribution, per-story open/regenerate) drilling into a per-story wizard by test type + a coverage-and-trust step | QA leads on large backlogs |
| Editable cases with trust signals | Each case editable (Given/When/Then/Expected/Test data), with confidence badge, typed concerns, coverage mapping to ACs | QA reviewers |
| BA-grade export | Gherkin **.feature** + **CSV** export, ready to import into test tools | QA teams with Zephyr/Xray-style workflows |
| Push-embedded | Test cases embed into the pushed Jira Stories | Teams who live in Jira |
| Cost transparency | Pre-flight "up to ~$X (typically ~$Y)" ceiling estimate + exact post-run cost echo, on the customer's key, no markup; armed 2-step confirm before spend | Budget owners; BYOK cost hawks |

### Capacity / Sprint Planner

| Feature | What it does | Who cares |
|---|---|---|
| Capacity sheet → plan | 5-step wizard: planning mode → team capacity (skill-aware buckets, focus factor) → review & generate → the plan → plan health | Scrum masters, PO/BA, delivery managers |
| Scrum output | Real **native Jira sprints** created and populated (issues moved in, dates, points) — team-managed **and** company-managed boards | Scrum teams |
| Kanban output | **Now / Next / Later** backlog ranking + `plan-now/next/later` tier labels | Kanban teams |
| Risk-aware sequencing | Hard dependencies honored; de-risking work subordinated sensibly; planning objectives (balanced / MVP / max-value / min-risk) | Leads defending a sequence |
| "The plan defends itself" | Per-feature AI rationale + the numbers behind it (unblocks count, critical path, slack, risk) surfaced on each placement; deterministic fallback clearly labeled | Anyone presenting the plan in a planning meeting |
| What-if + plan health | Capacity what-ifs; honest "doesn't fit / oversized / shortfall" reporting — a problem never hides behind a green banner | Realists |
| Copy-out plan brief | A defensible plan summary, single-sourced from the same data as the screen | PO reporting upward |

### Project Context profiles (glossary / domain distillation)

| Feature | What it does | Who cares |
|---|---|---|
| Named context profiles | Per-project context (multi-project per site), selectable at generation, remembered per page | Agencies/consultancies, multi-team sites |
| "Distill with Claude" | Feeds source material through a 6-category extraction (Domain / Glossary / Personas / Tech / Regulatory / Conventions) into a reusable profile | Domain-heavy teams (fintech, clinical, logistics) |
| Reference-only injection | Context enriches vocabulary and architecture naming but **never changes scope or authored ACs** (validated cross-domain with zero bleed) | Anyone worried AI context = scope drift |

### Admin console (Settings + Diagnostics)

| Feature | What it does | Who cares |
|---|---|---|
| Settings pre-flight | Verdict hero + setup tiles (key, project, health), "set up in order" guidance, inline validation, one-time auto-verify, live model/plan card, cost anchor | Admins doing first-time setup |
| Key handling | Anthropic key in Forge **encrypted secret storage**, never returned to the browser; armed two-step Clear/Reset | Security teams |
| Required-custom-fields config | Optional JSON for projects with mandatory custom fields, so pushes don't bounce | Enterprise Jira admins |
| Diagnostics incident feed | Plain-English incident narratives (not a log), silent-failure partition at top, filters, system-health card, all-time counters — **no-egress, content-free, stored only in the customer's own instance** | Admins + our support (customer can self-serve a trace) |
| Usage/plan visibility | Account panel: current plan + price, breakdowns this month, reset date, member-since; usage badge on the Ready screen | Admins, budget owners |

### Onboarding & evaluation (free tier + welcome credit)

| Feature | What it does | Who cares |
|---|---|---|
| Free for teams of 1-10 users | Every feature, no time limit — the real entry tier, not a trial (founder-confirmed 2026-07-24). Teams of 11+ get the standard 30-day Marketplace trial before the per-user subscription starts | Small teams; evaluators |
| $5 welcome credit ⚠ **DECIDED, NOT YET SHIPPED** | The model we are moving to (decided 2026-07-24, implementation pending): **every user** gets a one-time $5 of managed AI usage — on the free 1-10 tier and during a paid team's 30-day trial — then continues with BYOK. **Today's shipped code differs**: $5 per *install*, trial licences only (a free-tier install gets nothing). Never present as a live capability; public claims stay blocked (13-claims-register.md) | First-run evaluators; the demo moment (once shipped) |
| Graceful credit exhaustion | Honest "$X needed, $Y left — add your own key" prompts on every AI surface; a run that wouldn't fit the remaining credit is blocked **before** spend (shipped, against today's per-install credit) | Evaluators (no surprise stops mid-run) |
| Guided setup routing | Post-trial/exhaustion flows route to exactly the missing thing (API key vs project key vs full setup) | New admins |

## Platform & architecture facts (public-safe)

- **Pure Atlassian Forge app.** All backend logic runs in Forge's managed runtime inside the customer's instance. **No vendor server, VM, container, or database exists.**
- **Single external egress:** `https://api.anthropic.com`, declared in the Forge manifest. Under BYOK it is authenticated with the **customer's own** Anthropic key; the vendor never receives content ("we can't see your data because we never receive it" — site).
- **Storage:** Forge KVS inside the customer's instance only — settings, the API key (encrypted secret storage), and transient breakdown/push state. Purged on push; never-pushed breakdowns swept after 7 days; uninstall removes everything.
- **Cross-product by design:** Confluence hosts the UI (global page + on-page action); Jira receives the push. Requires installing into both products → **two entries in Manage Apps is normal** and Atlassian reviewers expect it.
- **Least-privilege scopes** (manifest, verified): `storage:app`, `search:confluence`, `read:page:confluence`, `read:confluence-user` (pre-flight author name), `read:jira-work`, `write:jira-work`, plus 5 granular `jira-software` scopes for the planner's native sprint/board writes. Details in 09-trust-security-compliance.md.
- **AI stack:** Claude **Sonnet 4.6** primary, **Haiku 4.5** fallback (Haiku also runs Project Context distillation), via the **Message Batches API** (asynchronous; enables walk-away generation on large specs). Generation typically takes minutes.
- **No telemetry/analytics; no user identities collected** (Marketplace security answers). Diagnostics stay in the customer's instance.
- Licensing is **Paid via Atlassian** (Marketplace-billed, USD); a single **Standard** edition includes every feature above. Pricing numbers → **see 02-business-model-pricing.md** (do not quote prices from this file).

## What it does NOT do (honest boundaries — use these proactively)

- **No code generation.** It creates work items and human-readable test cases (Gherkin/CSV for import into test tools) — not application code and not executable automation scripts.
- **No in-Jira issue panel.** The product works at spec altitude from Confluence; a per-issue Jira panel is an explicit non-goal (deliberate positioning vs. issue-level rivals — see 05-competitive.md).
- **Creates, never deletes.** The app creates Epics/Stories/Subtasks/links and moves/ranks issues for plans; it never deletes Jira issues. (Its own stored working data is what gets purged/swept.)
- **Human review is mandatory by design.** Nothing reaches Jira until a person reviews and pushes. "AI assists, humans decide" is a stated product principle, not a limitation to apologize for.
- **Cloud only.** Atlassian Forge = Atlassian Cloud; no Data Center/Server version.
- **Not a chat prompt tool.** It does not draft one ticket from a prompt; input is an existing Confluence page.
- **AI self-ratings are self-ratings.** Confidence indicators are the model's own read, clearly labeled — marketing must not present them as objective quality guarantees.

## INTERNAL CONTEXT - never publish

- **Confirmed pricing model (founder, 2026-07-24) — supersedes every older figure in the sources; the tier table is now VERIFIED against the Atlassian vendor-portal "Set pricing" screen (founder screenshot, 2026-07-24).** Paid via Atlassian, USD, per Confluence instance: **up to 10 users = free ($0, every feature, no time limit)** · then **per user on a declining curve** — **$6.70/user at 1-100** (the portal's band label; the "up to 10" row is a flat-rate *override* that replaces the bands for a site of ≤10 users, so **paying starts from the 11th user** — but the 1-100 rate is then charged from the **first** user on the site, which is exactly why a 100-user instance reaches 100 x $6.70 = $670. Never fuse the two into "11-100 at $6.70": 90 x $6.70 = $603, not $670), **$5.10 at 101-250**, **$3.80 at 251-1000**, **$3.50 at 1001-2500**, **$3.25 at 2501-7500**, and lower again above that (down to $1.15 at 45001+). Band maxima follow from the rate: a 100-user instance is **up to $670/month** — *not* "$67 flat". Customers licensing several Confluence instances pay a **1.5x multi-instance rate** ($10.05 at 1-100, $7.65 at 101-250, $5.70 at 251-1000, and so on down the same curve). It is **per user above 10, NOT a flat site price**, and Paid via Atlassian licenses the **whole Confluence instance** (every user on the site, not just app users); Atlassian shows the exact price for the customer's team size at checkout. Retired/wrong and never to be quoted: the live site's "$67/month flat for 11+, not per user" (wrong against this model, being corrected); the old "$6.70/user with $57 flat for ≤10" (the ≤10 band is FREE now, not $57); and the provisional **"$5.70/user at 101+"** recorded earlier on 2026-07-24 (a misread across portal columns — $5.70 is the *multi-instance* rate of the 251-1000 band). ⚠ Publication status: the **free-≤10 band is safe to publish**; the **per-user rates are portal-verified but the live site still contradicts them** — keep them out of public copy until the site is corrected and 13-claims-register.md clears them, and deflect with "from 11 users it is priced per user — the Marketplace always shows the exact price for your team size before you subscribe."
  - [GAP: the live spec2jira.com/pricing page still advertises the superseded "$67/month flat for 11+, not per user", and the in-app `src/usage.js` price strings are stale — both surfaces must be corrected before the per-user rates enter public copy. Owner: founder + engineering.]
- **Welcome credit — DECIDED 2026-07-24, IMPLEMENTATION PENDING.** The model we are moving to: **every user** gets a one-time **$5 welcome credit** of managed AI usage — on the free 1-10 tier *and* on paid tiers during the 30-day Atlassian trial — and it is **per user, not per site** (in a team of up to 10 each person has their own $5, so the team can keep evaluating through a colleague who still has theirs). When a user's credit is spent they continue with BYOK, paying Anthropic directly, no markup.
- **Trial-credit mechanics AS SHIPPED TODAY (differs from the decision above):** the $5 grant is per-**install**, lifetime (one-time), **trial-only** (`isEvaluation`/`trialEndDate` gated — so a free-tier install gets nothing), runs on the vendor's `MANAGED_ANTHROPIC_KEY`; hard ceiling ~$6 (1.2x grant) via `MANAGED_HARD_CEILING_USD`; a reservation ledger (hold at submit → reconcile to actual) plus a pre-flight run blocker makes $5 a real cap. Paid subscribers are always BYOK — the managed key must never serve a paid user (margin-leak guard). As of the 2026-07-12 handover, **funding + setting the production managed key was still a pending founder action**. ⇒ Marketing must describe the credit only as "the model we are moving to (decided 2026-07-24, implementation pending)", never as a live capability, and every public claim about it stays BLOCKED until the code ships and the founder confirms.
- **Enforcement:** `ENFORCEMENT_MODE` (block/meter, per environment; production = block) governs only the dormant Managed per-user cap (25/user/mo). BYOK is uncapped because the customer pays Anthropic directly.
- **Unit-economics anchor (internal):** a breakdown costs roughly $0.118 avg / $0.24 max in API spend (basis for the public "typically a few cents per breakdown" claim); test-case generation historically ~$1-3.7 per run — always quoted with pre-flight ceiling + post-run echo in-app.
- **Managed Pro ("we run the key")** exists in code as a dormant, off-Marketplace fallback only. Site/portal treatment of "Advanced/Managed": retired/commented out. Do not market it.
- **Known engineering gaps (never claim perfection):** dependency-link resolution can mis-bind between two identically-named stories in an edge case; iframe scroll-to-top on tall screens is an accepted Forge limitation; very large specs (200+ features) approach a Forge storage size limit (monitored).
- **Version state:** **production is v7.1.0 as of 2026-07-24** (repo `package.json` + `DIAG_APP_VERSION` in lockstep; live listing reads 7.1.0, released Jul 12 2026 — see 11-faq-objections.md). "v6.6.0" is the internal working label for the same work (trial credit + the 8-screen UI arc); v6.5.0 (2026-06-28) is the older confirmed-live version. ⚠ **No engineering handover exists for v7.0/v7.1**, so any capability statement in this chapter that was written against the v6.6 handover may be stale for what actually shipped — re-verify against the app before publishing anything version-sensitive.
- Dev/test environments and internal project names exist but are deliberately omitted from this KB chapter.

## Gaps

- [GAP: the vendor-portal tier table is VERIFIED as of 2026-07-24 (free up to 10 · $6.70/user in the 1-100 band, entered from the 11th user · $5.10 101-250 · $3.80 251-1000 · lower at scale · 1.5x multi-instance), but two surfaces still contradict it: the live site shows "$67/month flat for 11+" and `src/usage.js` carries stale price strings. Both must be corrected before any per-user figure enters public copy. Owner: founder + engineering; 02-business-model-pricing.md is canonical]
- [GAP: the per-USER $5 welcome credit is a decision (2026-07-24), not code — implementation pending, and the production managed key must also be funded/set before any "start without an API key" claim. Owner: founder + engineering]
- [GAP: current install count / review count / rating for the Marketplace listing as of 2026-07-24 — pull live from the Marketplace listing before citing any traction numbers]
- [GAP: no engineering handover exists for v7.0/v7.1 — the production version is 7.1.0, but this chapter's feature inventory was written against the v6.6 handover; re-verify version-sensitive claims against the live app]

## See also

- 02-business-model-pricing.md — editions, price points, trial, BYOK economics
- 03-audience-icp-personas.md — who the BA/PO/QA/admin personas are
- 05-competitive.md — POPal / Storygenie / StoryLoop and positioning vs. them
- 06-use-cases-workflows.md — PRD→backlog, tech design→tasks, client requirements, migrations
- 07-product-tour-8-screens.md — screen-by-screen walkthrough of everything inventoried here
- 09-trust-security-compliance.md — scopes, privacy, DPA, sub-processors (site repo is the only authoritative wording)
- 13-claims-register.md — which of the claims above are cleared for public use
