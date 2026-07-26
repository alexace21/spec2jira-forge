---
title: "04 — Positioning & messaging house"
purpose: One-stop reference for Spec2Tickets' category POV, message house, pitches, taglines, voice rules, terminology, and do/don't language for all public marketing copy.
visibility: mixed
sources:
  - Founder pricing + onboarding decision, 2026-07-24, tier table VERIFIED against the Atlassian vendor-portal "Set pricing" screen (founder screenshot, 2026-07-24) — SUPERSEDES every pricing statement in the sources below (free up to 10 users · then per user on a declining curve: $6.70/user in the 1-100 band, which a site enters from its 11th user · $5.10 101-250 · $3.80 251-1000 · lower again at scale · 1.5x multi-instance · per-user $5 welcome credit decided but not shipped)
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/competitive-landscape.md (positioning decision, 2026-06-01)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/docs/MARKETPLACE-LISTING-v3.md (listing copy: tagline, summary, description, highlights)
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/index.html (live landing copy)
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/how-it-works/index.html (workflow + output copy)
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/about/index.html (principles, naming callout, founder facts)
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/pricing/index.html (live pricing FAQ + CTA/plan wording; pricing-adjacent messaging verification)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/src/usage.js (in-app plan strings, grep verification only)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/docs/marketing-kb/13-claims-register.md (binding firewall: approved A2 pricing wording, forbidden B2/B4, USAGE PROTOCOL)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/CLAUDE.md (project history: naming conventions, "spec"->"page" sweep, hero history)
last_verified: 2026-07-24
---

# 04 — Positioning & messaging house

How to use: this file is the source for HOW we talk about Spec2Tickets. For WHAT the product does see 01-product-overview.md; for prices see 02-business-model-pricing.md; for competitor detail see 05-competitive.md; for the full approved/forbidden claims firewall see 13-claims-register.md.

Naming rule (intentional, never "correct" it): the **product** is **Spec2Tickets** ("Spec2Tickets for Confluence & Jira" on the Atlassian Marketplace). The **vendor brand + domain** are **Spec2JIRA** / spec2jira.com. The about page states it publicly: "Two names, one product. The app is published on the Atlassian Marketplace as Spec2Tickets. Spec2JIRA is the vendor name and this site's domain."

---

## 1. Category & point of view

### The category (as others frame it)
"AI user-story / backlog generation for Atlassian" — a crowded space where rivals expand a one-line prompt or enrich a single Jira ticket (category snapshot 2026-06-01; detail in 05-competitive.md).

### The category we claim: the spec-to-backlog engine
Decided 2026-06-01 (do not re-litigate). We do NOT compete on "AI that writes stories" (commoditized). Positioning statement (internal north star, from the competitive analysis):

> "The spec-to-backlog engine: turn an approved Confluence specification into a complete, traceable, dependency-aware Jira breakdown — processed privately under your own Anthropic key."

### The three-axis POV (every piece of copy should land at least one)

| Axis | The claim | Why it differentiates |
|---|---|---|
| **Altitude** | We read a **whole Confluence page** (spec, PRD, requirements doc) — not a prompt you retype, not one ticket | Input altitude ladder: prompt < single issue < whole spec. Only Spec2Tickets sits at the top (as of 2026-06-01) |
| **Depth** | Output is a **real backlog**: Epic → Stories → Subtasks, acceptance criteria, story points, priority, complexity, category labels, and mapped "blocks / is blocked by" dependency links — plus test cases and a capacity plan | Rivals output flat lists or single-issue text; none modeled inter-story dependency links or cycle repair (as of 2026-06-01 — re-verify before public use) |
| **Privacy** | **BYOK**: your real, confidential spec is processed under **your own** Anthropic key and agreement; no vendor backend — "We can't see your data because we never receive it" | The answer to the category's "don't enter real data" problem. Careful: we are NOT the only BYOK tool (POPal also offers BYOK) — the sharp claim is BYOK **to Anthropic + spec-level + your own agreement** |

Target buyer: BA / PO / PM / delivery teams with real specs; mid-to-large and regulated/EU organizations (see 03-audience-icp-personas.md).

**Segment logic (updated 2026-07-24 with the confirmed pricing model):** teams of **1–10 users are free** — that band is the **acquisition engine**, so top-of-funnel copy aimed at it should carry no price anxiety at all ("free for teams of up to 10 users, every feature, no time limit"). The **paid conversation only starts at 11 users**, where the subscription is priced **per user and billed on the whole Confluence instance** (every user on the site, not just app users) — so copy aimed at larger instances must handle that mechanic honestly rather than avoid it. Above 100 users the per-user rate **declines by band** (101–250, 251–1000, and lower again at scale), which is the argument that keeps a big instance with a handful of BA users viable — lead with it whenever the audience is an enterprise instance. Figures and publication status: 02-business-model-pricing.md and §INTERNAL below.

---

## 2. Message house

### Roof — core promise
**"Your Confluence page → a sprint-ready Jira backlog."**
Live expressions of it (as of 2026-07-24):
- Site footer tagline: "Turn a Confluence page into a sprint-ready Jira backlog — in minutes, reviewed by humans."
- Live landing H1: "Your Confluence page is already a backlog. Let it write itself."
- Hero lead anchors the jargon: "a spec, PRD, or requirements doc".

### Pillars (with proof points — each traceable to live copy)

| # | Pillar | Message | Proof points (source) |
|---|---|---|---|
| 1 | **Whole-spec understanding** | It reads the entire page and produces a coherent, traceable backlog — nothing important invented or dropped | Full hierarchy: one Epic, a Story per feature, subtasks beneath (how-it-works); cross-feature "blocks / is blocked by" links created as real Jira links (site + listing); honest sizing: suggested priority, story-point estimate, complexity signal — editable (how-it-works); quality signals flag low-confidence features, risks, ambiguities, auto-resolved circular dependencies (how-it-works); large, dense specs supported (listing) |
| 2 | **Human-in-the-loop review workbench** | AI drafts; you decide. Nothing reaches Jira until you push it | "The editor is the product — the AI gives a strong first draft, not the final word" (about/landing); interactive editor for names, stories, ACs, dependencies, priority, points, labels (how-it-works); site stat: "100% human-reviewed before anything reaches Jira" (landing, as of 2026-07-24) |
| 3 | **Your data, your key** | Privacy by architecture, not by promise — no vendor backend, content goes to your own Anthropic account under your own agreement | Runs entirely on Atlassian Forge; "Nothing is stored on our servers — because we don't operate any" (landing); "We can't see your data because we never receive it" (about); least privilege: only needed scopes, creates issues but never deletes them, acts with your own Atlassian permissions (about); privacy/DPA wording: quote the live site only — see 09-trust-security-compliance.md |
| 4 | **Beyond tickets: from page to plan** | The backlog is the start — the same flow yields acceptance test cases and a sprint/capacity plan | AI-generated Gherkin test cases included, "ready to import into your test tools" (landing use-case card); "AI-generated acceptance test cases (BA-grade Gherkin / CSV)" + "Sprint planning" listed as included features (pricing page, as of 2026-07-24); plan output = Scrum sprints or Kanban Now / Next / Later (product; see 07-product-tour-8-screens.md) |

### Foundation — the problem we solve: "the transcription tax"
Live framing (landing): "A thoughtful page already exists. Then someone spends days hand-translating it into epics, stories, subtasks, acceptance criteria, and dependencies — and that is where detail quietly gets lost." Supporting site stats (as of 2026-07-24; substantiation status in 13-claims-register.md):
- "~70% less hand-work building a sprint-ready backlog"
- "Minutes — not the 2–3 days a manual breakdown takes"
- "100% human-reviewed before anything reaches Jira"

---

## 3. Elevator pitches (drafts, grounded in live copy — partner sign-off pending)

**25 words:**
> Spec2Tickets reads your Confluence page and writes the whole Jira backlog — Epic, stories, subtasks, acceptance criteria, and dependency links — in minutes. You approve every push.

**50 words:**
> Most AI tools expand a prompt or enrich one ticket. Spec2Tickets works at the altitude of the page: it reads an entire Confluence spec and drafts a full Jira backlog — hierarchy, acceptance criteria, sizing, dependency links — which your team reviews before anything reaches Jira. On your own Anthropic key.

**100 words:**
> Every delivery team pays the transcription tax: a thoughtful Confluence page exists, and someone spends days hand-translating it into epics, stories, subtasks, acceptance criteria, and dependencies. Spec2Tickets removes that mechanical step. Point it at a page; Anthropic's Claude reads the whole document and drafts a complete Jira backlog — one Epic, a Story per feature, subtasks, acceptance criteria, story points, and real "blocks" dependency links. Your team reviews and edits everything in an interactive editor before a single issue is created. It runs entirely on Atlassian Forge with your own Anthropic key — no vendor backend. Test cases and sprint planning included.

---

## 4. Tagline bank

### Canonical / live lines (quote as-is; attribute nothing — they are ours)

| Line | Where it lives | Status |
|---|---|---|
| "Your Confluence page → a sprint-ready Jira backlog." | Core promise (hero line chosen 2026-06-04) | Canonical short promise |
| "Your Confluence page is already a backlog. Let it write itself." | Live site H1 (as of 2026-07-24) | LIVE |
| "Turn a Confluence page into a sprint-ready Jira backlog — in minutes, reviewed by humans." | Site footer tagline, every page | LIVE |
| "Turn an entire Confluence spec into a complete, dependency-aware Jira backlog — under your own AI key." | Marketplace listing tagline (listing doc §2) | LIVE listing copy |
| "An entire spec in. A complete backlog out." | Listing description headline | LIVE listing copy |
| "Your data, your key." | Site privacy section heading / listing highlight | LIVE |
| "AI assists, humans decide." | Site values (landing + about) | LIVE |
| "Privacy by architecture, not by promise." | Site values (landing + about) | LIVE |

### Draft variants (UNREVIEWED — consistent with the house; do not publish without partner approval)

- DRAFT: "The spec-to-backlog engine for Confluence and Jira."
- DRAFT: "Stop transcribing requirements. Start reviewing them."
- DRAFT: "One page in. One sprint-ready backlog out."
- DRAFT: "From PRD to sprint-ready — reviewed by you, in minutes."
- DRAFT: "AI does the reading. You make the calls."
- DRAFT: "A backlog your engineers can actually run — dependencies, sizing, and all."
- DRAFT: "Your spec, your key, your call."
- DRAFT: "The end of the transcription tax."

---

## 5. Voice & tone rules

1. **Professional, concrete, honest — never hype.** No "revolutionary", "game-changing", "magic". The live copy's register is calm and specific; match it.
2. **Numbers over adjectives.** "One Epic, a Story per feature, subtasks, dependency links" beats "comprehensive output". Attach "as of <date>" to anything that ages.
3. **"AI drafts; you decide."** Every automation claim must carry the human-review counterweight. We never sell fire-and-forget; the review editor is the product.
4. **Never over-promise privacy.** The approved shape is architectural: no vendor backend, your own key, your own agreement, "we never receive it". Never absolute ("your data is 100% safe", "zero risk"). Privacy/legal wording: quote the live site pages verbatim (privacy/, dpa/, subprocessors/) — never re-draft (see 09-trust-security-compliance.md).
5. **Never over-promise automation or speed.** "Minutes" / "a few minutes", with the honest caveat where space allows ("longer for large pages, or when Anthropic is under heavy load" — how-it-works). Never quote fixed seconds.
6. **Honest caveats are on-brand.** The product surfaces its own risks (quality signals, concerns, partial-push honesty); marketing copy inherits that ethos — admit limits before a customer discovers them.
7. **English only for public copy.** (Internal team conversation is Bulgarian; every user-facing and public string is pure English.)
8. **Plain words over jargon.** Lead with "page" or "document"; anchor "spec" as "a spec, PRD, or requirements doc" on first use (in-app copy deliberately prefers "page/document" — customers may not parse "spec").
9. **Roles get outcomes, not features.** BAs "shift from transcribing to creating value"; POs get "priorities, scope, and outcomes"; developers "start coding from clear, complete work items" (landing).
10. **Respect the naming split.** Spec2Tickets = product; Spec2JIRA = vendor/site. Never merge or "fix" them.

---

## 6. Terminology glossary (use these words, consistently)

| Term | Meaning | Usage note |
|---|---|---|
| **page / spec** | The Confluence source document | Lead with "page"; anchor as "a spec, PRD, or requirements doc". Avoid bare "spec" as the only noun in public copy |
| **breakdown** | The generated structured result (Epic + stories + subtasks + ACs + sizing + dependencies) before push | The unit of work ("unlimited breakdowns") |
| **feature / story** | A feature in the breakdown becomes a Jira **Story** on push | "A Story per feature" |
| **category** | The grouping label over features | NOT "epic" for groups — there is exactly one real Epic per breakdown; groups are categories (pushed as labels) |
| **Epic** | The single Jira Epic created per page/breakdown | Singular by design |
| **subtask** | Task beneath a Story, with name/description/type | Jira subtask on push |
| **acceptance criteria (AC)** | Per-story definition of done | "Acceptance criteria on every story" |
| **shared AC** | An acceptance criterion spanning several stories, allocated during review | Public phrasing: "shared acceptance criteria" |
| **concern** | An AI-flagged risk, ambiguity, or gap (typed, with severity) surfaced for review | Public phrasing: "quality signals" / "flags" |
| **pre-flight** | The go/no-go readiness check before generating or pushing | "Pre-flight check" |
| **push** | One-click creation in Jira: Epic, Stories, Subtasks, dependency links — under the user's own Atlassian permissions | "Creates issues, never deletes them"; "nothing reaches Jira until you push" |
| **resume** | After a partial push, create only what didn't land — no duplicates | "Resume push" |
| **plan** | The capacity/sprint output: Scrum sprint columns or Kanban **Now / Next / Later** | "Sprint planning" on the site |
| **dependency links** | Cross-feature "blocks / is blocked by" relationships, created as real Jira links | Always the quoted Jira phrasing |
| **quality signals** | Confidence / risk / ambiguity indicators on review | Includes auto-resolved circular dependencies |
| **test cases** | AI-generated acceptance test cases — "BA-grade Gherkin / CSV, ready to import into your test tools" | Included in the product (as of 2026-07-24 site copy) |
| **BYOK** | Bring Your Own Key — the customer's own Anthropic API key pays for AI compute directly, "at cost, no markup" | Expand on first use |
| **trial** | The standard 30-day Atlassian Marketplace evaluation — it applies to teams of **11+ users**, i.e. the band that actually pays | Teams of 1–10 users don't need a trial: **they are free, permanently, with every feature** (confirmed 2026-07-24; 13 A2.1/B2). There is NO in-app *metered* free tier (the 3-breakdowns/month allowance, retired 2026-06-03) — a different thing, different era, and **never** a reason to write "we have no free plan". See §INTERNAL for the welcome-credit caveat |
| **welcome credit** | A one-time $5 of AI usage on our managed key, so a user can generate before bringing their own Anthropic key | ⚠ **DECIDED 2026-07-24, NOT YET SHIPPED** (the decided model is per **user**, free tier and paid trials alike; today's code is per **install** and trial-only). Write it only as "the model we are moving to", never as a live capability — and **no public claim about it may ship** until the code lands and the founder confirms (13-claims-register.md) |
| **Standard** | The live edition name (BYOK; everything included) | "Advanced" was folded into the standard product — don't market it as separate |

---

## 7. Do / Don't language quick list

(Fast reference for the writing assistant; the binding firewall is 13-claims-register.md.)

### DO say
- "Reads the **whole** Confluence page / an **entire** spec"
- "Epic, stories, subtasks, acceptance criteria, story points, and dependency links"
- "Sprint-ready backlog" · "minutes, not days"
- "AI drafts; you decide" · "nothing reaches Jira until you push it" · "100% human-reviewed"
- "Your data, your key" · "no vendor backend" · "under your own Anthropic agreement" · "runs on Atlassian Forge"
- "Creates issues, never deletes them" · "acts with your own Atlassian permissions"
- "AI-generated acceptance test cases (Gherkin / CSV)" · "sprint planning included"
- "Powered by Anthropic Claude"
- "30-day free trial via the Atlassian Marketplace" (for teams of 11+ — the band the subscription applies to)
- **The free tier, plainly** — founder-confirmed 2026-07-24 and already public: "Start for free" · "Free up to 10 users · Bring your own Anthropic API key" · "free for teams of up to 10 users, with every feature included and no time limit". This is a **real free tier**, not a trial — say so.
- **For the paid band, deflect rather than quote a figure:** "from 11 users it is priced per user" + the always-safe fallback "The Marketplace always shows the exact price for your team size before you subscribe." (The confirmed per-user rates exist — see §INTERNAL — but they are not publishable until the live site is corrected and 13 clears them.)

### DON'T say
- ❌ "The only BYOK tool / only privacy-safe AI app" — false (POPal also offers BYOK; corrected 2026-06-01)
- ❌ "Fully automated" / "no human needed" — contradicts the core pillar
- ❌ "Your data never leaves Atlassian" — false; content goes to Anthropic under the **customer's** key; use the approved privacy shape instead
- ❌ Absolute privacy/security claims ("zero risk", "100% safe", "zero retention") — see 09
- ❌ **"$67/month flat" / "one flat price, no per-user math"** — wrong against the confirmed model (it is **per user** above 10 users); the live site still carries this line and is being corrected, so do not mirror it
- ❌ The retired per-user framing **"$6.70/user with $57/month flat for teams up to 10"** — the ≤10 band is **FREE** now, not $57
- ❌ **"$5.70 per user above 100 users"** — a provisional figure recorded earlier on 2026-07-24 and since corrected against the vendor portal; $5.70 is the **multi-instance** rate of the 251–1000 band. The single-instance curve is $5.10 (101–250) / $3.80 (251–1000) / lower again at scale (§INTERNAL)
- ❌ Any EUR price (€3.90/€4.90/€6.90/€9.90/€20/€29/€39/€49/€69/€99 are retired history, 2026-06-03 or earlier) — and NO subscription figure at all without checking 02-business-model-pricing.md first (see §INTERNAL: the confirmed per-user rates are not yet publishable)
- ❌ Any welcome-credit claim — a dollar figure, "no API key needed to start", "free AI credit" — it is **decided but not shipped** (§INTERNAL); publication stays blocked until the code ships and the founder confirms
- ❌ "Free plan = 3 breakdowns/month", or any in-app usage-metered free tier — that allowance was retired 2026-06-03 (13 B2). ⚠ This does NOT mean "we have no free plan": **teams of up to 10 users are free**, permanently, with every feature — saying otherwise is a factual error. Never state or imply that the 30-day trial is the only way to evaluate
- ❌ "Epics" for feature groups — they are **categories**; one Epic per breakdown
- ❌ Fixed generation times ("60–150 seconds", "instant") — say "a few minutes", with the load caveat
- ❌ Internal jargon in public copy: T0/T2 data tiers, enforcement modes, env-var names, "moodboard", edition code names
- ❌ Invented customers, testimonials, quotes, review counts, install counts — none exist in approved sources
- ❌ "Unlimited" without its BYOK context (unlimited breakdowns are a BYOK-plan property)
- ❌ Renaming Spec2Tickets ↔ Spec2JIRA

---

## INTERNAL CONTEXT — never publish

### Positioning rationale (internal honesty; public detail belongs in 05-competitive.md)
- Decided 2026-06-01 against POPal (incumbent, hybrid vendor-paid+BYOK, Jira Cloud+DC), Storygenie (cheapest, prompt→backlog, weak privacy posture), StoryLoop (GitHub PR-loop angle, test cases broken on trial). All three are Jira-native and issue/prompt-level; none ingest a spec document.
- The dependency-graph and cycle-repair uniqueness claims date to 2026-06-01. **Re-verify the competitive landscape before repeating "nobody else does X" publicly** — 8+ weeks stale as of 2026-07-24.
- Known exposures — never volunteer, have answers ready (see 11-faq-objections.md): BYOK setup friction (rivals are zero-setup); Confluence+Jira dual install (two Manage-Apps entries is normal for a cross-product Forge app); no Jira Data Center (cloud-only). ⚠ **"Price-for-small-teams vs rivals' free tiers" is NO LONGER an exposure** — we are free for teams of up to 10 users too, so that band is parity; the only price exposure left is the paid band at 11+ users (see 05-competitive.md).

### PRICING — the confirmed model (founder, 2026-07-24; tier table VERIFIED against the vendor portal) and what may be written today
The model, which **supersedes every older pricing statement in every source** (in-app `src/usage.js`, the live site, the Marketplace listing doc, memory files) and whose tier table is now **verified against the Atlassian vendor-portal "Set pricing" screen** (founder screenshot, 2026-07-24): Paid via Atlassian, USD, per Confluence instance —
- **Up to 10 users: free ($0)** — every feature, no time limit. A real free tier, not a trial.
- **From 11 users: per user, on a declining curve** — **$6.70** in the **1–100** band · **$5.10** at 101–250 · **$3.80** at 251–1000 · **$3.50** at 1001–2500 · **$3.25** at 2501–7500 · lower again above that (down to **$1.15** at 45001+).
  ⚠ **Threshold vs band label:** "from 11 users" is the *threshold* at which paying starts; **"1–100" is the band label**, and it is counted from the **first** user on the site — which is why a 100-user instance is 100 × $6.70 = $670. Never fuse the two into "11–100 at $6.70" (90 × $6.70 = $603, not $670). Above the first band the curve is **graduated** (each rate applies only to the users inside its band), so a 250-user instance is ~$1,435, **not** 250 × $5.10.
- **Per user above 10 — NOT a flat site price.** Paid via Atlassian licenses the **whole Confluence instance** (all users on the site, not only the people who use the app). Atlassian shows the exact price for the customer's team size at checkout.
- **Multi-instance customers pay 1.5x** the single-instance rate ($10.05 / $7.65 / $5.70 on the first three bands).
- **The single most quotable consequence:** a 100-user instance is **up to $670/month**, not "$67 flat".

**Not settled / not publishable yet:**
- The live site still advertises "**$67/month flat for teams of 11+ — not per user**". That is **wrong against this model and is being corrected** — do not quote it, and do not "fix" copy toward it.
- The retired "$6.70/user with $57/month flat for ≤10" framing is also wrong: the ≤10 band is **free** now.
- The provisional "**$5.70/user at 101+**" recorded earlier on 2026-07-24 is **superseded** — it was a misread across portal columns ($5.70 is the *multi-instance* rate of the 251–1000 band).
- [GAP: the live spec2jira.com/pricing page and the in-app `src/usage.js` price strings both still contradict the verified table — until they are corrected, the per-user rates stay out of public copy. Owner: founder + engineering; 02-business-model-pricing.md owns the answer.]

**How to write today:**
- ✅ Allowed: the **free-≤10 fact** in full ("free for teams of up to 10 users, with every feature included and no time limit"), the 30-day Marketplace trial for teams of 11+, "AI usage at cost, no markup", and the deflections "sold through the Atlassian Marketplace, in USD" and "The Marketplace always shows the exact price for your team size before you subscribe."
- ✅ Allowed for the paid band, without a figure: "from 11 users it is priced **per user**, on a rate that comes down as the instance grows, and Atlassian licenses the whole instance."
- ❌ Forbidden: the **$67-flat** wording; the retired **$6.70/user + $57-flat-≤10** framing; the superseded **$5.70-at-101+** figure; any EUR figure; inventing or inferring a number; and — until the live site is corrected and 13-claims-register.md clears them — publishing the **per-user rates** ($6.70 / $5.10 / $3.80 / …), because public copy must not contradict the currently-published page.
- Site CTA labels currently live on every page: "Start for free" (nav + hero, → the Marketplace listing) and the support line "Free up to 10 users · Bring your own Anthropic API key · Managed through the Atlassian Marketplace." **These remain reusable verbatim** — they are published, and consistent with the confirmed free tier (08 §2.4 names "Start for free" the primary CTA text).

### $5 welcome credit — DECIDED 2026-07-24, NOT YET SHIPPED (publication blocked)
The model we are **moving to**: **every user** gets a one-time **$5 welcome credit** of AI usage on our managed key — on the free 1–10 tier *and* on paid tiers during the 30-day Atlassian trial. It is **per user, not per site** (in a team of up to 10 each person has their own $5, so when one person's credit runs out the team can keep evaluating through a colleague who still has theirs). When a user's credit is spent they continue with **BYOK** — their own Anthropic key, paid directly to Anthropic, no markup. The honest promise, once it ships: "start generating immediately, no API key needed; bring your own key when the welcome credit runs out."

⚠ **This is a decision, not the current code.** The shipped implementation grants $5 **per install** and only on a 30-day-trial licence — a free-tier install gets nothing — and the production managed key still has to be funded/set. Write it as "the model we are moving to (decided 2026-07-24, implementation pending)" and **never as a live capability**. [GAP: every public claim about the welcome credit stays BLOCKED until the code ships and the founder confirms — keep that gate in 13-claims-register.md.] When it does ship, the messaging angle is onboarding-friction removal: "try it before you bring a key."

### Copy-history notes (why the words are the way they are)
- **"spec" → "page"** in-app sweep (2026-06-04): customers may not parse "spec"; public copy leads with "page/document" and anchors "spec, PRD, or requirements doc". Backend/schema identifiers keep "spec" — irrelevant to marketing.
- **Hero evolution**: 2026-06-04 partner-picked hero was "Your Confluence page → a sprint-ready Jira backlog."; the live H1 (as of 2026-07-24) is "Your Confluence page is already a backlog. Let it write itself." Both are ours; the former remains the canonical short promise.
- **Tier/edition jargon** (T0/T2, "Standard/Advanced" internals) was deliberately stripped from the UI (2026-07-12) — keep it out of public copy too.
- **"Early access" + grandfathering** framing exists on the pricing page ("we grandfather early adopters as the product grows") — safe to echo, details in 02.

### Founder facts — public-safe boundary
Public-safe (already on the site): Aleks Asenov, sole trader / independent software vendor, Sofia, Bulgaria; support@spec2jira.com; support 11:00–23:00 Europe/Sofia, 7 days; target response within 24 hours. NEVER publish: bank details, IBAN/SWIFT, tax/personal ID numbers, street addresses, dev-site names.
