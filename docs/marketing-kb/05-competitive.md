---
title: "Competitive landscape + comparison guardrails"
purpose: Rival profiles (POPal, Storygenie, StoryLoop), an honest comparison matrix, our moats and exposures, and the rules for making public competitive claims.
visibility: mixed
sources:
  - "Founder pricing + onboarding decision, 2026-07-24, tier table VERIFIED against the Atlassian vendor-portal 'Set pricing' screen (founder screenshot, 2026-07-24); band mechanic corrected 2026-07-25 per 13-claims-register.md — SUPERSEDES every pricing statement in the sources below (free up to 10 users, a flat-rate override · paying starts from the 11th user, and the first band is labelled 1-100 at $6.70/user charged from the first user, so a 100-user site is $670 · then graduated: $5.10 101-250 · $3.80 251-1000 · lower again at scale · 1.5x multi-instance · per-user $5 welcome credit decided but not shipped)"
  - "C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/competitive-landscape.md (internal research, 2026-06-01)"
  - "C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/CLAUDE.md (2026-06-01 competitive-analysis handover + current product-state sections)"
  - "https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira (live fetch 2026-07-24)"
  - "https://marketplace.atlassian.com/search?query=POPal (live fetch 2026-07-24; POPal listing = marketplace.atlassian.com/apps/1231182/)"
  - "C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/pricing/index.html (live public site, revision marked 'v7 FLAT-FREEMIUM (2026-07-16)') — our own price in the comparison matrix"
  - "C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/src/usage.js (in-app price strings — the conflicting older per-user model)"
last_verified: 2026-07-24
---

# 05 — Competitive landscape + comparison guardrails

Category: **"AI user-story / backlog generation for Atlassian."** Three direct rivals, all Jira-native. Spec2Tickets is the only Confluence-native, whole-spec-ingesting entrant (as of the 2026-06-01 internal research) — a different altitude, not a like-for-like clone.

## Data freshness — read this first

- **Base dataset = internal research dated 2026-06-01** (Marketplace pricing snapshots ~Feb 2026; StoryLoop from partner screenshots + a live trial). Label any reuse of it **"as of 2026-06-01 (internal research)"**.
- **Refreshed 2026-07-24 (live Marketplace fetch):** POPal install/review counts only. Storygenie and StoryLoop could not be re-verified (Marketplace search did not surface them) — their figures below remain 2026-06-01 data. [GAP: refresh Storygenie + StoryLoop install/review counts and current feature state; direct listing URLs unknown — memory holds app keys `au.com.storygenie` and Formkraft's StoryLoop but not numeric listing IDs]
- **Our own product facts are current as of 2026-07-24** and post-date the rival research: test-case generation and capacity/sprint planning have SHIPPED since 2026-06-01 (see "What changed since the research" below). Never reuse the June "we lack test cases" framing.

### OUR OWN PRICE — the confirmed model (founder, 2026-07-24; tier table VERIFIED against the vendor portal), and what is publishable

A price comparison is the single most-copied thing in this file, so read this before writing any figure of ours. The confirmed model (Paid via Atlassian, USD, per Confluence instance) **supersedes every older figure in every source**, and its tier table is **verified against the Atlassian vendor-portal "Set pricing" screen** (founder screenshot, 2026-07-24):

| Band (single instance) | Price per user / month | Band maximum |
|---|---|---|
| **Up to 10 users (flat)** | **Free ($0)** — every feature, no time limit. A flat-rate *override* that replaces the bands for that site, **not** ten free seats deducted from a larger site's bill | $0 — a real free tier, not a trial. **Parity with POPal's and Storygenie's free-≤10 offers** |
| **1–100 users** (the band a site enters the moment it passes 10) | **$6.70** | up to **$670/month** = 100 × $6.70 — once a site passes 10 users, **every** user on it is charged, starting at user 1 |
| **101–250 users** | **$5.10** | up to $1,435/month |
| **251–1000 users** | **$3.80** | up to $4,285/month |
| **1001–2500 users** | **$3.50** | up to $9,535/month |
| **2501–7500 users** | **$3.25** | up to $25,785/month |
| **7501+ users** | **$2.85** at 7501–10000, then $2.65 · $2.40 · $2.20 · $2.00 · $1.60 · $1.45 · $1.35 · **$1.15 at 45001+** | up to $32,910 (7501–10000) · up to $46,160 (10001–15000) |

- It is **per user above 10, NOT a flat site price**, and Paid via Atlassian licenses the **whole Confluence instance** (every user on the site, not just app users). Atlassian shows the exact price for the customer's team size at checkout.
- **Multi-instance customers pay 1.5x** the single-instance rate ($10.05 at 1–100, $7.65 at 101–250, $5.70 at 251–1000, and so on down the same curve).
- ⭐ **Threshold vs band label — the distinction a price comparison must not fuse.** "**From 11 users**" is the *threshold* at which paying starts; "**1–100**" is the *band label* whose rate then applies, counted from the **first** user on the site. ⛔ Never fuse them into "11–100 users at $6.70": that contradicts the portal's own maximum, since 90 users (11 through 100) × $6.70 = **$603**, not $670. Say the threshold, label the band 1–100.
- **Above the first band the curve is graduated** — each rate applies only to the users inside its own band, which is exactly how the maxima above reconcile ($670 + 150 × $5.10 = $1,435 at 250 users; + 750 × $3.80 = $4,285 at 1000). ⚠ The "never multiply one band rate by the full headcount" rule is true **above the first band only** — inside 1–100 the whole headcount *is* charged at $6.70, and that multiplication is precisely how $670 arises.
- **The number to keep straight in any comparison:** a 100-user instance is **up to $670/month**, not "$67 flat".
- ❌ **Never quote "$67/month flat for 11+ / not per user"** — the live site still says it, it contradicts this model, and it is being corrected. ❌ **Never quote the retired "$6.70/user with $57 flat for ≤10"** — the ≤10 band is FREE now, not $57 (13-claims-register.md Table B4). ❌ **Never quote "$5.70/user at 101+"** — a provisional figure recorded earlier on 2026-07-24 and corrected against the portal ($5.70 is the *multi-instance* rate of the 251–1000 band).
- **Publishable today:** the free-≤10 fact, and for the paid band a deflection — *"from 11 users it is priced per user, on a rate that declines as the instance grows; the Marketplace always shows the exact price for your team size before you subscribe."* The **per-user rates stay out of public copy** until the live site is corrected and 13 clears them (public copy must not contradict the currently-published page).
- [GAP: the live spec2jira.com/pricing page still advertises the superseded "$67/month flat" and the in-app `src/usage.js` price strings are stale — both must be corrected before our per-user figures may appear in any public comparison. Owner: founder (Aleks Asenov) + engineering. Full treatment: 02-business-model-pricing.md]

---

## Rival profile 1: POPal (Agilemove Inc) — the incumbent

Listing name: "AI Test Case and User Story Issue Auto Generator for Jira" · app key `popal.plugins.epicstory` · marketplace.atlassian.com/apps/1231182/

| Fact | Value |
|---|---|
| Platforms | **Jira Cloud + Data Center** (only rival with DC) |
| Traction | 211 installs, 4.1/5 (11 reviews) as of 2026-06-01 → **183 installs, 4.1/5 (11 reviews) as of 2026-07-24** (live fetch; note the decline) |
| Live since | Jun 2023 |
| AI model | OpenAI/ChatGPT. Vendor-paid by default **plus a BYOK / private-LLM option** (DC docs: custom OpenAI-compatible endpoint URL + model + token) → hybrid |
| Input | **One Jira issue** (Epic/Story) via the three-dot menu; **only title + description are read** — custom fields, labels, components, comments, attachments silently ignored. No spec/page/bulk input |
| Output | Child Stories from an Epic; in-place Epic/Story enrichment (Benefit Hypothesis + AC); test cases with steps; **test-automation script stubs** (language + driver, e.g. Python+Playwright; Selenium shown live); test data; routes cases into **Zephyr/Xray** |
| Pricing (as of 2026-06-01) | **Free ≤10 users**; annual per-user above: 15 users = $90/yr ($6/user/yr) … 1,000 = $4,350 … 100k = $186,600. Renewals = 50% of initial. ~$18/mo at 30 users. 30-day trial |
| Marketing posture | "Trusted by Fortune 500 enterprises", "Generated 10,000+ User Stories & Test Cases" (their claims, as of 2026-06-01) |

- **Strengths (honest):** test-automation script generation (rare in category); Zephyr/Xray awareness; full in-Jira test lifecycle; cross-project generation; deep layered config (Project Context + two project-level prompts + per-issue prompt + issue-as-example); BYOK/private-LLM option; DC support; established incumbent; review-before-save gate made DEFAULT-ON in v5.4.0.
- **Weaknesses (many sourced from their own 11 reviews, as of 2026-06-01):** reads title+description only; single-issue scope; **slow 1–5 min synchronous generation (#1 review complaint)**; review gate historically flag-gated and often off (fire-and-forget into the backlog); custom prompts exist but users can't find them; required-fields gotcha silently blocks generation; manual page refresh; vendor-managed OpenAI on Cloud with **no documented DPA/residency**; a "support ticket went unanswered" review. [GAP: POPal was v5.4.0 at research time — current version/features unverified since 2026-06-01]

## Rival profile 2: Storygenie (Storygenie Pty Ltd, AU) — cheapest, prompt→backlog

App key `au.com.storygenie`. All data as of 2026-06-01 (internal research); 2026-07-24 refresh failed.

| Fact | Value |
|---|---|
| Platforms | Jira Cloud (Forge) |
| Traction | ~45 installs, ~0–1 reviews (as of 2026-06-01) |
| AI model | **Multi-model** (OpenAI / Anthropic / Gemini / xAI), smart-model-by-volume, **vendor-paid** (no BYOK) |
| Input | A **short text prompt** (+ built-in Prompt Enhancer + AI chat) — not a spec document |
| Output | Epics/Stories/Tasks + AI acceptance criteria, Jira ADF, one-click publish, "full backlog from one prompt" modes, Volume Selector, regenerate-in-context, bulk Epic assign |
| Pricing (as of 2026-06-01) | **Free ≤10 users**; then ~$4.50/user/YEAR (15 users = $67.50/yr) down to $0.77 at 100k; an "unlimited" option at $0.05/user/mo; renewals 50% |
| Privacy | Zero-persistence claim; only OpenAI documented (30-day retention) despite the multi-model claim; **Australian Privacy Act only — no GDPR/SCC/DPA**; published guidance telling users **not to input personal or customer data and to use fictional personas** (paraphrase of their docs as of 2026-06-01 — re-verify before quoting publicly) |

- **Strengths:** lowest-friction input; vendor-paid zero setup; multi-model; extremely cheap/free; polished UX; clean zero-persistence soundbite.
- **Weaknesses:** privacy documentation lags the multi-model claim; **no GDPR/SCC = EU-buyer blocker**; prompt-only input caps spec fidelity/traceability; tiny install base; no certifications; **no dependency graph, cycle handling, or sizing signals**; pricing is vendor-subsidized (likely loss-leading/rate-limited — durability question).

## Rival profile 3: StoryLoop (Formkraft-Digital) — newest, QA-loop angle

All data as of 2026-06-01 (partner screenshots + live trial); 2026-07-24 refresh failed.

| Fact | Value |
|---|---|
| Platforms | Jira Cloud (Forge), v4.3.0 at research time |
| Traction | 13 installs, 0 reviews (as of 2026-06-01) |
| AI model | Undisclosed; vendor-paid (no key) |
| Input | **One Jira issue** (sidebar panel); 6 issue types |
| Config | Per-issue-type Template + gold-standard Example; **GitHub PR review against ACs** (requires a broad GitHub PAT — `repo`/`admin:repo_hook`; GitHub Cloud only, no Bitbucket/self-hosted); Analytics; Project Context injection |
| Pricing (as of 2026-06-01) | ~$45.25/mo (~€42) flat ≤10 users; per-user above; 30-day trial; **no free tier** (the only rival with none — small teams pay them and pay us nothing; they remain our closest price-peer **above** 10 users) |

- **Strengths:** real GitHub PR-review "close the loop" (unique in category); Project Context injection; Discard/Append/Replace apply UX.
- **Weaknesses:** ⚠ **NOT FOR PUBLICATION** — **"Write Test Cases" was broken on our 2026-06-01 trial** + a dead "Manage License" link. Single-trial observation about a named vendor, now ~8 weeks stale; internal only unless re-verified (the matrix states this neutrally: "we could not exercise it"). [GAP: re-verify before ever using this publicly — may be fixed]; incomplete rebrand ("JiraGenie" codename still in UI strings); PR review demands a powerful PAT; manual per-type configuration; issue-level only; tiny adoption.

---

## Comparison matrix

Public-usable **only** with dates attached: rival columns are "as of 2026-06-01 (internal research; POPal counts re-checked 2026-07-24)"; the Spec2Tickets column is current as of 2026-07-24. ⚠ **Our two pricing rows carry the founder-confirmed model — the per-user rates are not publishable yet; read the pricing box above before publishing either.** Pricing detail for us: see 02-business-model-pricing.md.

| Capability | **Spec2Tickets** (2026-07-24) | POPal | Storygenie | StoryLoop |
|---|---|---|---|---|
| Input altitude | **Whole Confluence spec page** | One Jira issue (title+description only) | Short text prompt | One Jira issue |
| Output hierarchy | **Epic → Stories → Subtasks** | Epic → child Stories (no subtasks) | Flat Epics/Stories/Tasks | Single-issue text + AC |
| Dependencies | **Story-blocks-Story links + cycle detection/repair** | No | No | No |
| Sizing signals | **Story points + priority + complexity + AI confidence** | No | No | No |
| Test cases | Yes — per-Story, human-editable, Gherkin (.feature) + CSV export | Yes — cases + automation-script stubs + Zephyr/Xray routing | No (AC only) | Advertised (we could not exercise it on our 2026-06-01 trial; unverified since) |
| Test-automation scripts | No | **Yes** (e.g. Selenium/Playwright stubs) | No | No |
| Capacity / sprint planning | **Yes — capacity sheet → Scrum sprints or Kanban Now/Next/Later rank** | No | No | No |
| Project context / glossary | Yes — named per-project profiles + AI-assisted distill | Yes — Project Context + layered prompts | No (prompt enhancer instead) | Yes — Project Context |
| AI model | Anthropic Claude | OpenAI/ChatGPT | Multi-model (OpenAI/Anthropic/Gemini/xAI) | Undisclosed |
| Who pays for AI | **BYOK** (customer's own Anthropic key). A managed **$5 welcome credit per user** — free tier and paid trials alike — is **decided (2026-07-24) but NOT YET SHIPPED** (today's code: per install, trial-only), so it must not appear in any public comparison yet (13-claims-register.md A2.7) | Vendor-paid default, BYOK/private-LLM option | Vendor-paid only | Vendor-paid only |
| Privacy / DPA posture | Customer's own Anthropic DPA/SCCs; published DPA + sub-processor list (see 09-trust-security-compliance.md) | No documented DPA/residency on vendor-paid Cloud | No GDPR/SCC; AU Privacy Act only; "don't enter real data" guidance | Undisclosed AI vendor |
| Hosting | Confluence Cloud (required) + Jira Cloud | Jira Cloud + **Data Center** | Jira Cloud | Jira Cloud |
| Price, ~10-user team | **$0 — free for teams of up to 10 users** (confirmed 2026-07-24) — **parity with POPal and Storygenie in this band**; above it the subscription is **per user on a declining, graduated curve** (paying starts from the 11th user, and the first band is **1–100 at $6.70/user counted from the first user** — so a 100-user site is **$670/month** — then $5.10 at 101–250, $3.80 at 251–1000, lower again at scale; portal-verified 2026-07-24, band mechanic corrected 2026-07-25 — internal, not yet publishable), plus the customer's own Anthropic API usage. ⚠ Never publish "$67 flat", the retired $6.70/user · $57-flat framing, or the superseded "$5.70 at 101+" — see the pricing box above | **Free ≤10**; from ~$90/yr at 15 users | **Free ≤10**; ~$67.50/yr at 15 users | ~$45.25/mo flat ≤10 |
| Free tier / evaluation | **Free for teams of up to 10 users — every feature, no time limit** (a real free tier, confirmed 2026-07-24 — matches the rivals' free-≤10 offers); teams of 11+ get the standard 30-day Marketplace trial. A per-user managed **welcome credit** is decided but **not yet shipped** — do not present it as part of the offer. ⚠ The tier retired 2026-06-03 was the *in-app* 3-breakdowns/month metered allowance — a different thing, do not conflate | Free ≤10; 30-day trial | Free ≤10 | No free tier; 30-day trial |

## Our moats (defensible, public-safe when dated)

1. **Spec as input + traceability** — nobody else ingests a specification document; rivals take a prompt or a single issue (as of 2026-06-01). The BA/PO "approved spec → complete backlog" job is ours alone.
2. **Dependency graph + cycle detection/repair** — none of the three models inter-story blocks-links or resolves circular dependencies (as of 2026-06-01).
3. **Hierarchy + honest sizing in one pass** — Epic→Stories→Subtasks with SP/priority/complexity/confidence. POPal: epic→stories, no subtasks/sizing; Storygenie: flat; StoryLoop: one issue.
4. **Privacy angle (the corrected, sharper form):** "process your real, confidential spec under **your own Anthropic key and DPA/SCCs**." Storygenie is the privacy-weak pole (vendor-paid, no GDPR/SCC, tells users not to enter real data). See guardrails: this is NOT "we're the only BYOK."
5. **Scale + reliability** — asynchronous batch generation, chunked push, validated on a 178-item breakdown with 0 failures (internal validation, 2026-05-30).
6. **Spec → backlog → PLAN** — capacity-aware sprint/Kanban planning (live since v6.0.0, 2026-06-22); no rival plans sprints at all (as of 2026-06-01).

## Where rivals genuinely beat us (internal honesty — do not publish as-is)

- **POPal:** install base (183 vs our single-digit count, 2026-07-24); Jira **Data Center** (we're cloud-only); test-**automation** script generation (we generate cases, not scripts); Zephyr/Xray routing; lives inside the Jira issue where devs already are. **Price: their free-≤10 tier is NOT an advantage over us any more — we are free ≤10 too (confirmed 2026-07-24), so that band is parity.** The gap is real only **above** 10 users, where POPal charges ~$6/user/**yr** (as of 2026-06-01) against our **$6.70/user/month** across the **1–100** band — the band a site enters from its 11th user, charged from the first (portal-verified 2026-07-24; band mechanic corrected 2026-07-25) — roughly an order of magnitude at list (⚠ don't publish our figure — see the pricing box above).
- **Storygenie:** price above the free band (~$4.50/user/**yr** as of 2026-06-01, against our $6.70/user/**month** across the **1–100** band, which applies from a site's 11th user onward, portal-verified 2026-07-24 — an order cheaper than us); true zero-setup; multi-model flexibility. **Their free ≤10 is matched by ours — parity, not an exposure.**
- **StoryLoop:** GitHub PR-review loop — closes spec→code verification; we have nothing in the code-review loop. (They have **no** free tier — the only band where our free ≤10 is a straight advantage.)
- **All three:** single Jira install vs our Confluence+Jira dual install; vendor-paid zero-setup vs our BYOK requirement. ⚠ The per-user welcome credit that would soften the BYOK step is **decided but not shipped** — do not count it as a live mitigation.

## What changed since the 2026-06-01 research (our side)

| June 2026 exposure | Status 2026-07-24 |
|---|---|
| "No test-case generation" | **CLOSED** — per-Story test cases shipped (editable, Gherkin/CSV export, pushed into Jira) |
| "No capacity planning" (unlisted then; category gap) | **CLOSED** — capacity-sheet planner live on prod since v6.0.0 (2026-06-22) |
| "No Project Context" | **CLOSED** — shipped 2026-06-02 |
| "Our Free=3/mo is the stingiest free option" | **Framing obsolete; the exposure is CLOSED in the ≤10 band** — two separate changes: (a) the *in-app* 3-breakdowns/month metered tier was retired 2026-06-03; (b) **teams of up to 10 users are now free** (confirmed 2026-07-24), every feature, no time limit — so rivals' free-≤10-forever is **matched, not an advantage over us**. Residual exposure is only the 11+ segment, where we charge per user and POPal/Storygenie stay cheap (and StoryLoop has no free tier at all). ⚠ Per-user figures not publishable — see the pricing box above |
| "Setup friction (BYOK key)" | **Still open.** The per-user $5 welcome credit that would let a customer generate before adding a key is **decided (2026-07-24) but NOT YET SHIPPED** — today's code grants it per install and only on a trial licence, and the production managed key is unconfirmed. Do not claim this exposure is mitigated |
| No DC, no in-Jira-issue surface, dual install | **Still open** |

## Comparison guardrails — binding rules for public content

**Forbidden claims (false — never publish):**
- ❌ "The only BYOK app" / "only we let you bring your own key" — **false**: POPal offers BYOK/private-LLM on Cloud and DC.
- ❌ "The only one with Project Context" — **false**: POPal has Project Context + layered prompts; StoryLoop has Project Context injection.
- ❌ Undated "the only spec-ingesting / dependency-modeling tool" — true as of 2026-06-01, but must carry the date; rivals ship continuously.

**Required practices:**
- Compare **capabilities factually**; never disparage rivals or their teams.
- Never quote a rival's review score or install count **without a date** ("4.1/5, 11 reviews, as of 2026-07-24").
- Never publicly cite StoryLoop's broken test cases or dead license link without re-verifying first — single-trial observation from 2026-06-01.
- Rival prices: quote as "as of" the research date; their EUR/USD figures are theirs (StoryLoop ~€42 is a rival price, not our retired EUR pricing — see 02-business-model-pricing.md for our currency history).
- Storygenie's "don't enter real data" guidance: paraphrase and date it; re-verify against their live docs before each public use.
- **Our own pricing in comparisons: USD only, and only what is publishable** (see the pricing box at the top). Say "free for teams of up to 10 users, with every feature included and no time limit"; for the paid band say "from 11 users it is priced **per user**, on a rate that declines as the instance grows" plus the always-safe deflection *"the Marketplace always shows the exact price for your team size before you subscribe."* ❌ **Never publish "$67/month flat — not per user"** (wrong against the confirmed model; the live site is being corrected), ❌ never the retired **$6.70/user · $57-flat-≤10** framing (13-claims-register.md Table B4), ❌ never the superseded **"$5.70/user at 101+"**, ❌ never a EUR figure, and ❌ not the verified per-user rates (**$6.70 / $5.10 / $3.80 / …**) until the site is corrected and 13 clears them.
- Positioning language belongs to 04-positioning-messaging.md; claim wording belongs to 13-claims-register.md. Public competitive claims ride the same approval mechanic as all public content: **every post is a PR the founder reviews and merges** (12-marketing-strategy-channels.md §7), checked against 13 before the PR opens. [GAP: confirm the founder (Aleks Asenov) is the named sign-off for competitive claims specifically, and record that owner IN 13-claims-register.md — 13 currently has a usage protocol but no named claim owner, so this reference has no destination]

## INTERNAL CONTEXT — never publish

- **Our install base is single-digit (3 installs, 0 reviews as of 2026-07-24, live Marketplace fetch).** Do not invite install-count or review-score comparisons in public content until we have meaningful numbers; the matrix deliberately omits an installs row.
- **POPal's active installs declined 211 → 183 between 2026-06-01 and 2026-07-24** (Marketplace counts active installs, so this implies churn). Watch, don't gloat — and don't publish rival churn claims.
- **Price-delta reality:** POPal/Storygenie price per-user per-YEAR; our paid band is **per user per MONTH** on a declining, graduated curve (paying starts at the 11th user, then **$6.70 across the 1–100 band counted from the first user**, $5.10 at 101–250, $3.80 at 251–1000, $3.50 at 1001–2500, lower again at scale — portal-verified 2026-07-24, band mechanic corrected 2026-07-25) — roughly an order of magnitude apart at list, but **only above 10 users**, since the ≤10 band is free on both sides. This is deliberate value-based premium positioning (a breakdown saves hours of BA/PO time), with StoryLoop as the nearest price-peer. Sales/content must anchor on value-per-breakdown and privacy, never on price proximity to POPal/Storygenie. ⚠ Whole-instance licensing amplifies the delta on large sites (we bill every user on the instance, not just app users): a 100-user instance is **up to $670/month**, and a 1000-user instance up to ~$4,285 — anticipate the effective-cost-per-app-user question above 100 users, and lead with the declining curve when you do.
- **Strategic read (2026-06-01, still current):** do NOT compete on "AI that writes stories" (commoditized; rivals are zero-setup — though their free-≤10 tiers are now **matched by ours**, so the remaining asymmetry is setup friction, not price, in that band). Compete on altitude (spec→backlog), depth (hierarchy+dependencies+sizing+planning), privacy (your key, your DPA). Target: BA/PO/PM teams with real specs; mid-to-large + regulated/EU buyers (Storygenie's no-GDPR posture is our EU opening).
- **POPal proves the hybrid vendor-paid+BYOK model works at scale** — that de-risked our managed welcome-credit motion (still unshipped in its per-user form) and any future managed edition.
- **Category-name signal:** "test case" appears in POPal's listing NAME — test cases are table-stakes vocabulary in Marketplace search; our shipped test-case feature should be visible in listing copy/SEO (coordinate with 12-marketing-strategy-channels.md).
- Competitor research refresh cadence is unowned. [GAP: who owns re-running the rival research (installs, pricing, features) and on what cadence — quarterly suggested]
