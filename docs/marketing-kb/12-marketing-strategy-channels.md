---
title: "Marketing strategy, funnel & channels (Spec2Tickets)"
purpose: "Internal strategic frame for the content campaign (blog + social): funnel, channel inventory, content pillars, SEO seeds, blog/social mechanics, review motion, measurement."
visibility: internal
sources:
  - "Founder conversation 2026-07-24 (campaign Step 2: blog on spec2jira.com + social 2-3x/week)"
  - "Founder pricing + onboarding decision, 2026-07-24, tier table VERIFIED against the Atlassian vendor-portal 'Set pricing' screen (founder screenshot, 2026-07-24) — SUPERSEDES every pricing statement in the sources below (free up to 10 users · then per user on a declining curve: $6.70/user across the 1-100 band (entered at the 11th user, charged from the first) · $5.10 101-250 · $3.80 251-1000 · lower again at scale · 1.5x multi-instance · per-user $5 welcome credit decided but not shipped)"
  - "C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/migration-protections.md"
  - "C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/marketplace-launch-state.md"
  - "C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/mvp-monitoring-cicd.md"
  - "C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/site-launch-punchlist.md"
  - "C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/competitive-landscape.md"
  - "C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/docs/MARKETPLACE-REPORTING-SETUP.md"
  - "C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/src/usage.js (pricing strings, grep)"
  - "C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/static/hello-world/src (grep for in-app nudges/links)"
  - "C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/CLAUDE.md (handover notes, section-scoped)"
  - "C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/index.html"
  - "C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/pricing/index.html"
  - "C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/docs/index.html"
  - "C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/sitemap.xml (+ full page inventory via glob)"
  - "Live fetch 2026-07-24: https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira"
  - "Live fetch 2026-07-24: https://spec2jira.com/pricing"
last_verified: 2026-07-24
---

# 12 — Marketing strategy, funnel & channels (INTERNAL)

> **This entire chapter is INTERNAL.** It is the strategy behind public content, not public content itself. The AI marketing assistant may USE it to plan and prioritize, but must never quote install counts, revenue readings, funnel conversion logic, or internal gap notes in public posts. Product facts for public use live in 01-product-overview.md, 02-business-model-pricing.md, and 13-claims-register.md.

## 1. Campaign context (as of 2026-07-24)

- **Campaign Step 2** (founder decision, 2026-07-24): add (a) **blog articles hosted on spec2jira.com** and (b) **social posts 2-3x/week**. This chapter is the strategic frame those two execute.
- **Where the business stands** (live Marketplace fetch 2026-07-24): listing live at version **7.1.0** (released Jul 12 2026), **3 installs**, **0 reviews**. The vendor-side reporting run of 2026-06-23 read zero across all six metrics (licenses/transactions/conversion/churn/editions/active-users). Conclusion already on record in the monitoring memory: **the binding constraint is ACQUISITION, not infrastructure**. Marketing is the highest-leverage work.
- **What is already strong:** a differentiated product — **the only whole-spec-ingesting, Confluence-native entrant in the category as of the 2026-06-01 rival research** (rivals ship continuously; the date is mandatory on any "only…" line — 05-competitive.md), processing under **BYOK to Anthropic on the customer's own agreement**. ⚠ **BYOK itself is NOT unique** — POPal markets BYOK / private-LLM, so "the only BYOK app" is a forbidden claim (13-claims-register.md B5; 05-competitive.md guardrails); the defensible form is "BYOK **to Anthropic**, at **spec altitude**, under **your own Anthropic agreement**". Also strong: a polished 10-page site, a live listing, and — the biggest acquisition asset — a **real free tier for teams of up to 10 users** (every feature, no time limit; founder-confirmed 2026-07-24). ⚠ The frictionless "value on day one without an API key" onboarding (the per-user $5 welcome credit) is **decided but NOT YET SHIPPED**, so do not plan campaigns around it yet (§2). What is missing is **discovery volume**: nobody searching outside the Marketplace finds us yet.

## 2. Commercial baseline the campaign sells

> Pricing authority = 02-business-model-pricing.md. Summary here only because every funnel stage depends on it.

- **Model (founder-confirmed 2026-07-24, tier table VERIFIED against the Atlassian vendor-portal "Set pricing" screen the same day — supersedes the live site, the in-app strings and every older note):** one edition, everything included (breakdown + push, Project Context, AI test-case generation, sprint/capacity planning). **Up to 10 users: free ($0, no time limit, no feature gates — a flat-rate override, not ten free seats)** · then **per user on a declining curve**: **$6.70 across the 1–100 band** (a site enters it at its **11th** user, but the rate is charged from the **first** user on the site, so 100 users = 100 × $6.70 = **$670**, the portal's own maximum — ⛔ never fuse threshold and label into "11–100": 90 × $6.70 = $603 ≠ $670) · **$5.10 at 101–250** · **$3.80 at 251–1000** · **$3.50 at 1001–2500** · **$3.25 at 2501–7500** · lower again above that (down to $1.15 at 45001+) — **per user above 10, NOT a flat site price**, billed in USD via the Atlassian Marketplace, which licenses the **whole Confluence instance** (every user on the site, not just app users) and shows the exact price for the customer's team size at checkout. Multi-instance customers pay **1.5x** the single-instance rate. **The consequence to keep straight: a 100-user instance is up to $670/month, not "$67 flat".** All plans BYOK: AI compute billed by Anthropic to the customer's own key, at cost, no markup ("typically a few cents per breakdown" — site language).
- **Funnel consequence (three distinct audiences, not two):** the free ≤10 band is the **acquisition engine** (no price objection exists there at all); the **paid conversation starts at 11 users** at $6.70/user, where the whole-instance mechanic is the first question a budget owner asks; and **above 100 users** the story changes again — the rate declines by band ($5.10 → $3.80 → $3.50 → …), which is the answer to "a 1,000-user site with six BAs". Plan content for all three moments separately (03-audience-icp-personas.md).
- **Evaluation:** teams of 1–10 users don't evaluate, they just use it free; teams of **11+** get the standard **30-day Atlassian Marketplace trial**. ⚠ The **$5 welcome credit per user** (free tier and paid trials alike, then BYOK) is **DECIDED 2026-07-24 but NOT YET SHIPPED** — today's code grants $5 per *install* on trial licences only — so it is **not** a public-safe product fact and must not anchor any campaign until the code ships and the founder confirms. No in-app metered "free 3/month" tier exists (retired 2026-06-03 — historical only; never confuse it with the free ≤10-user band).
- **Superseded figures (never present as current):** all EUR figures in older notes (3.90 / 4.90 / 6.90 / 9.90 / 20 / 29 / 39 / 49 / 69 / 99 EUR, ≤2026-06-03); the **$6.70/user + $57-flat-≤10** USD phase (2026-06-04 → mid-July 2026 — the ≤10 band is FREE now, though the *declining-curve* half of that framing is correct and survives); the site's **"$67/month flat for 11+, not per user"** (2026-07-16), which is wrong against the confirmed model and is being corrected; and the provisional **"$5.70/user at 101+"** recorded earlier on 2026-07-24, a misread across portal columns ($5.70 is the *multi-instance* rate of the 251–1000 band).
- ⚠ **Publication rule for content:** publish the **free-≤10 fact** freely; for the paid band say only "from 11 users it is priced per user, on a rate that declines as the instance grows" plus "the Marketplace always shows the exact price for your team size before you subscribe" — the per-user rates ($6.70 / $5.10 / $3.80 / …) stay internal until the live site is corrected and 13-claims-register.md clears them (public copy must not contradict the published page).
- [GAP: the portal tier table is now VERIFIED (2026-07-24); what remains is correcting BOTH the site pricing page ("$67 flat") and the in-app `src/usage.js` price strings to it — founder + engineering own; 02-business-model-pricing.md is the KB authority]

## 3. Funnel map — today's real assets per stage

| Stage | What exists TODAY | Notes / gaps |
|---|---|---|
| **Discover** | Atlassian Marketplace search + category browsing (listing live, "Spec2Tickets for Confluence and Jira"); spec2jira.com organic (sitemap.xml, robots.txt, OG/Twitter cards, JSON-LD Organization + SoftwareApplication + FAQPage — all live) | [PLANNED] blog + social (this campaign). No paid channels. No analytics to observe discovery. |
| **Evaluate** | The listing (live tagline, fetched 2026-07-24: "Transform Confluence specifications into structured Jira epics, stories, and subtasks with Claude AI" — this is the only live listing copy captured anywhere in the KB; see the §9 gap); site pages: landing, /how-it-works, /pricing, /docs, /about; trust pages: /privacy, /dpa, /subprocessors (linked in the footer Legal column); support mailboxes + posted hours ("Support 11:00-23:00 Europe/Sofia, 7 days a week") | The listing is the #1 conversion surface (see §9). Security/compliance wording authority = the live site repo only (see 09-trust-security-compliance.md). |
| **Try** | **Teams of ≤10 users are simply free** — install and use it, no trial clock; teams of 11+ get the 30-day Marketplace trial | ⚠ The $5 welcome credit ("generate on day one, no API key") is the intended anti-friction answer to "all rivals are zero-setup" (05-competitive.md) but is **decided, not shipped** — the BYOK key step is still the real first hurdle today. |
| **Adopt** | BYOK onboarding: in-app Settings/Setup link to the **/get-api-key** plain-English walkthrough on the site; docs "Setup (~5 min)" flow (Install → get key → configure → generate → review → push) | BYOK key = the biggest adoption objection on record; today only the get-api-key page defuses it (the welcome credit that would remove the step entirely is not shipped). |
| **Pay** | ≤10-user sites stay **$0 indefinitely**; from 11 users the 30-day trial converts via Marketplace billing into a **per-user** subscription across the whole instance | Payment fully Atlassian-managed; no vendor checkout to maintain. Rates internal until the site is corrected (§2). |
| **Expand / Advocate** | Marketplace reviews (currently **0** — see §9); "Early-access pricing — we grandfather early adopters" live on /pricing; in-app Account panel shows "Member since" | In-app review nudge status uncertain — see §9 gap. No referral/newsletter motion exists. |

## 4. Channel inventory

### Live today
| Channel | State (as of 2026-07-24) |
|---|---|
| Atlassian Marketplace listing | Live, v7.1.0, 3 installs, 0 reviews. Copy last swept 2026-06-18 (BYOK-clean). ⚠ The on-site pricing FAQ still states the superseded "$67/month flat" model and is being corrected to the confirmed per-user model (§2). |
| spec2jira.com | 10 pages (9 in sitemap + branded 404), all lastmod 2026-07-16. Self-hosted fonts, OG cards, canonical URLs, FAQ JSON-LD on /pricing. GitHub Pages, auto-deploys on push to the separate site repo. |
| In-app surfaces | Settings/Setup → /get-api-key link (live). Support email in error paths. Review nudge: see §9 gap. |

### Planned / not yet existing
| Channel | Status |
|---|---|
| Blog on spec2jira.com | Campaign Step 2 — architecture proposal in §7. |
| Social, 2-3 posts/week | Campaign Step 2. [GAP: which platforms + handles — founder decision. Candidate set to decide from: LinkedIn (BA/PO/PM buyer audience), X/Twitter (Atlassian/dev ecosystem), Atlassian Community forums (category-native, high intent)] |
| Atlassian Community / dev-community posts | Mentioned as maybe; no presence yet. [GAP: founder decision + account] |
| Email / newsletter | Does not exist; no capture form on the site. [GAP: decide if in scope at this stage] |
| Paid acquisition | Not planned; no budget decision on record. |

### Metrics available for the funnel
- **Vendor side:** Atlassian Marketplace partner-portal reporting + the repo's poller `tools/marketplace-report.mjs` (zero-dep Node 24 script; six endpoints: license records, transactions, churn, conversion, editions, active-users; "empty is normal on a new app"; fails loud; optional weekly Task Scheduler run; API token expires ≤1 year — runbook: `docs/MARKETPLACE-REPORTING-SETUP.md`). This is the **conversion source of truth** for the campaign.
- **Site side:** **no analytics installed** (verified: no analytics script in the live page heads). [GAP: decide a privacy-friendly analytics tool (must match the privacy-first brand; no personal data) — founder decides; until then blog/SEO impact is only indirectly measurable via Marketplace installs]
- **In-product:** the app is no-egress by design — it will never phone home usage data; do not plan metrics that assume product telemetry (see 09-trust-security-compliance.md).

## 5. Content pillars (5) — mapped to personas + SEO

> Personas authority = 03-audience-icp-personas.md; positioning language = 04-positioning-messaging.md. Rule for all pillars: claims must pass 13-claims-register.md; competitor facts must carry their research date (2026-06-01 snapshot in 05-competitive.md).

### Pillar 1 — Spec-writing craft (top-funnel; BA / PO / PM)
The audience's own job skill; builds trust before any product pitch. Product tie-in: a well-structured page is exactly what generates a great breakdown (the in-app Pre-flight check rewards structure).
- "The anatomy of a spec your team can actually build from"
- "Acceptance criteria that survive contact with a sprint: a BA's checklist"
- "Why your PRD's headings matter more than its prose"

### Pillar 2 — AI-in-agile workflows (mid-funnel; BA / PO / delivery leads)
Breakdown, estimation, dependencies, sprint planning with AI — the category conversation. Grounded in real product mechanics (dependency links, cycle detection, honest sizing, capacity planning).
- "From Confluence page to sprint-ready backlog: what AI can and can't decide for you"
- "AI story-point estimates you can defend in refinement"
- "Dependency links are the hard part of backlog automation — here's why"

### Pillar 3 — Privacy-first AI adoption (mid/bottom-funnel; regulated/EU buyers, engineering managers)
The BYOK/DPA moat: "process your real, confidential spec under your own Anthropic agreement" — the answer to prompt-tools that warn "don't enter real data" (05-competitive.md). No vendor backend; least-privilege scopes; human review before anything reaches Jira.
- "Bring your own key: what BYOK actually changes for GDPR and your DPO"
- "AI backlog tools and your data: the questions to ask before you paste a real spec"
- "Privacy by architecture, not by promise" (already a live site value — expand it)

### Pillar 4 — Product tours + release notes (bottom-funnel; evaluators)
The 8 redesigned screens are 8 ready-made tour posts (Page Picker mission-control, AI Insights triage, three-pane Breakdown Editor, Review & Push + Resume, Settings pre-flight, Diagnostics incident feed, Test Cases wizard, Sprint Planning "a plan that defends itself") — see 07-product-tour-8-screens.md. Marketplace releases feed release-note posts.
- "Inside the review workbench: how a BA turns an AI draft into a real backlog"
- "The plan that defends itself: why we show Claude's sequencing rationale"
- "What's new in Spec2Tickets 7.x: [release-note template]"

### Pillar 5 — Founder build-in-public [PARTNER DECISION — not approved yet]
Honest-engineering notes from a solo founder in Sofia (public founder facts only: Aleks Asenov, sole trader, Sofia, Bulgaria). The engineering culture (audits, honest UX states, "a partial push never reads clean") is genuinely distinctive material. [GAP: founder must approve the pillar and its boundaries before any post]
- "Why our app tells you when it fails (and why most don't)"
- "Building on Atlassian Forge with zero backend: what it makes impossible, and why that's the point"
- "One founder, one Marketplace app: what shipping v7 actually took"

## 6. SEO seed keywords (seeds only — unvalidated)

From site copy + category language. [GAP: keyword research — no volume/difficulty data; no tool chosen; validate before investing in per-keyword pages]

- "confluence to jira" / "confluence to jira automation"
- "generate jira stories from confluence"
- "AI backlog breakdown" / "AI backlog generator"
- "spec to user stories" / "PRD to user stories"
- "jira test case generation AI"
- "sprint planning AI"
- "capacity planning jira"
- Supporting long-tails from live site language: "sprint-ready backlog", "acceptance criteria generator", "requirements to jira tickets"

Mapping rule: pillar 1 targets spec/PRD-craft long-tails; pillar 2 targets the category head terms; pillar 3 targets "AI + GDPR/BYOK" queries; pillar 4 targets branded + "how does X work" queries.

## 7. Blog architecture proposal (static GitHub Pages site)

Constraints observed from the repo: plain static HTML (no generator), nav + footer are byte-identical components copied to every page, site.css is treated as frozen (page-scoped `<style>` blocks for additions), auto-deploys on push, founder pushes.

- **Structure:** `/blog/index.html` (chronological index with per-post cards) + `/blog/<slug>/index.html` per post. Slugs short, keyword-bearing, lowercase-hyphenated.
- **Per-post head:** unique `<title>` + meta description, `rel=canonical` (`https://spec2jira.com/blog/<slug>`), OG + Twitter card (default `og-image.png` until per-post images exist), `BlogPosting` JSON-LD (site already uses JSON-LD elsewhere — follow the pattern).
- **sitemap.xml:** add `/blog` (changefreq weekly) + every post URL with real lastmod dates.
- **Cross-links:** each post links to one relevant product page (/how-it-works, /docs, /pricing, /get-api-key) and vice versa where natural — /docs and /how-it-works should link to relevant deep-dive posts (this is the internal-linking lever for SEO).
- **Nav decision needed:** adding "Blog" to the nav means editing the byte-identical nav component on all 10 pages + 404 in one sweep. Cheaper interim: add Blog to the footer "Product" column only. [GAP: founder picks nav vs footer placement]
- **Workflow rule (hard):** the site repo auto-deploys on push → **every post = a PR the founder reviews and merges**. No direct pushes of AI-drafted content. Claims must be checked against 13-claims-register.md before the PR is opened.
- **Optional later:** RSS/Atom feed (`/blog/feed.xml`) once ≥5 posts exist — cheap and expected by the dev-adjacent audience.

## 8. Social cadence skeleton (2-3x/week)

Post archetypes (rotate; every post = one idea, one link):
1. **Feature spotlight** — one screen/one capability, screenshot-led (pillar 4).
2. **Before/after workflow** — "2-3 days of ticket-writing → minutes + human review" framing (site's transcription-tax narrative).
3. **Spec-writing tip** — standalone value, no pitch (pillar 1).
4. **Release note** — what shipped, one screenshot, honest scope.
5. **Use-case story** — one persona's Monday (see 06-use-cases-workflows.md); no invented customers or testimonials — frame as "how it works for a product team", never as a named customer story until a real one consents.
6. **Honest-engineering note** — build-in-public angle, only if pillar 5 is approved.

**Repurposing rule:** 1 blog post → 3-5 social posts (thesis post, one striking detail, one image/screenshot post, one question/discussion post, one "in case you missed it" a week later). Blog is the canonical home; social links back.

**Weekly rhythm example:** Mon = spec-writing tip · Wed = feature spotlight or blog-derived post · Fri = release note / use-case / engineering note. [GAP: platforms + handles pending — see §4]

## 9. Review-generation motion

- **The listing is the #1 conversion surface** — Marketplace shoppers compare install counts, stars, and review text before anything else. Category benchmark: incumbent POPal showed 211 installs, 4.1/5 from 11 reviews as of the 2026-06-01 research → **183 installs, 4.1/5 (11 reviews) on the 2026-07-24 live re-fetch** (use the fresher dated figure — 05-competitive.md; the decline is internal, never publish rival churn); Storygenie ~45 installs and StoryLoop 13 installs / 0 reviews remain 2026-06-01 data (their 2026-07-24 refresh failed).
- **Our state as of 2026-07-24: 0 reviews, 3 installs** (live fetch). First goal is the first 3-5 honest reviews; a single 5-star review changes the listing's face at this scale.
- ⚠ **[GAP: the current live listing copy is not held anywhere in the KB.** Only two fragments exist: the live tagline quoted in §3 (fetched 2026-07-24) and one release-note sentence quoted in 11-faq-objections.md. Before any listing edit, release-note post (Pillar 4), or listing-derived social copy, pull the **live listing title, tagline, summary, highlights and latest release notes verbatim** and record them here with a fetch date. ⚠ `docs/MARKETPLACE-LISTING-v3.md` is the **retired v3 draft, not the live listing** — it carries the superseded $6.70/user pricing (11-faq-objections.md; 13-claims-register.md B4) and the stale "~1-2 minutes" speed claim (13 B10); never source live listing copy from it, and re-check any tagline attributed to it. Owner: founder.]
- **In-app nudge:** a Page Picker feedback/review nudge shipped 2026-06-04 (per handover notes), but wiring the real listing URL (`MARKETPLACE_REVIEW_URL`) was a post-approval TODO, and a grep of the current frontend finds **no live marketplace review link** (the Page Picker was redesigned 2026-07-07). [GAP: verify whether the review nudge survived the Page Picker redesign, and wire the real listing review URL — founder/dev task]
- **Motion:** ask at the moment of delivered value (after a successful push / resolved support exchange), personally and honestly. **Never** fabricate, incentivize against Marketplace rules, or draft "sample reviews" for users. Support quality (posted 7-day support hours) is part of this motion — a review often starts as a support thread that went well.

## 10. Early-access framing + grandfathering (campaign message)

- **Live public language** (on /pricing, safe to reuse verbatim): "Early-access pricing — we grandfather early adopters as the product grows."
- **Why it exists** (internal, from migration-protections.md): pricing will evolve; labelling today's pricing "early access" makes future changes an announced evolution, not a betrayal, and creates a **lock-in-now urgency lever** for content ("subscribe now, keep this deal").
- **Mechanism (INTERNAL — do not publish details):** grandfathering is automatic — the app records each install's first-seen date and future tier logic honors it; vendor-side records/comms come from the Marketplace partner portal. The customer-visible trace is the "Member since" line in the in-app Account panel.
- **Campaign use:** every pricing-adjacent post may carry one line of early-access framing. Do NOT promise specifics ("lifetime", "forever", exact future prices) — the public commitment is exactly the sentence on /pricing, no more.
- **History note (only if a post ever needs it):** pricing evolved EUR-era (retired 2026-06-03) → USD per-user with a $57 floor ≤10 users (2026-06-04) → a short-lived flat-freemium framing on the site (free ≤10 / $67 flat, 2026-07-16) → the **confirmed model of 2026-07-24**, tier table verified against the vendor portal: free up to 10, then per user on a declining curve ($6.70 at 11–100, $5.10 at 101–250, $3.80 at 251–1000, lower again at scale). Present the earlier steps as history only, never as current options.

## 11. Measurement & operating loop

- **Weekly:** run `tools/marketplace-report.mjs` (or check the partner portal) → log installs / trials / conversions alongside that week's published content. This is the only closed loop until site analytics exist.
- **Per-release:** Marketplace version releases (e.g. 7.1.0 on Jul 12 2026) trigger a release-note post + social posts.
- **Review count:** check the listing monthly; celebrate/repost honest reviews (with permission for any quoting beyond the public listing).
- **Definition of campaign success (proposal, founder to confirm):** movement in installs + trial starts attributable to the content window, first organic reviews, first non-Marketplace referral install. [GAP: founder to set target numbers/timeframe]

## 12. Guardrails for the content engine

- Every public claim → 13-claims-register.md. Every price → 02-business-model-pricing.md (§2 here is the summary; the free-≤10 fact is publishable, the per-user rates are not yet, "$67 flat" never is).
- **No welcome-credit claim of any kind** — no "$5", no "free AI credit", no "no API key needed" — until the per-user implementation ships and the founder confirms (13-claims-register.md keeps that gate).
- No invented customers, quotes, testimonials, install counts, or benchmark numbers. Site stat-band claims (~70% less hand-work, minutes-not-days, 100% human-reviewed) are the approved public performance language.
- Competitor mentions must carry the research date (2026-06-01 snapshot) — see 05-competitive.md.
- Compliance/privacy wording: quote the live site (privacy/, dpa/, subprocessors/) only; never re-draft (the forge repo's docs/compliance/* are stale).
- Naming: product = "Spec2Tickets" ("Spec2Tickets for Confluence & Jira" on the Marketplace); vendor/domain = "Spec2JIRA" / spec2jira.com. The split is intentional — never "correct" it.
- English for all public content.

## INTERNAL CONTEXT — never publish

- **Install/review counts and their smallness** (3 installs, 0 reviews as of 2026-07-24) and the zero-reading of the 2026-06-23 vendor metrics run — internal planning facts only. **This chapter is the KB's owner of record for our own install/review figure**: 01, 03, 06, 10 and 13 B14 deliberately keep it as an open [GAP] ("pull live from the listing before citing") because the number is not publishable at this size and goes stale immediately. Rule everywhere: re-pull live on any publication day; never publish while single-digit.
- **Funnel economics:** managed welcome-credit ceilings, enforcement modes, env-var names, margin math — never in content. The only public evaluation facts today are "free for teams of up to 10 users" and "30-day Marketplace trial from 11 users"; the credit itself is not yet a public fact (decided 2026-07-24, not shipped).
- **The pricing-surface drift** (§2: the live site's "$67 flat" and `src/usage.js`'s "$6.70/user, $57 flat ≤10" both contradict the verified portal table) — resolve internally; never surface the confusion publicly, and never publish either superseded figure.
- **Grandfathering mechanism internals** (first-seen capture, tier-resolution logic) — the public message is the one /pricing sentence.
- Incident history, dev-site names, and repo/tooling details stay out of public content entirely.
- Never anywhere in marketing: bank details, tax/personal IDs, street addresses. Public founder facts end at: Aleks Asenov, sole trader, Sofia, Bulgaria.

## Consolidated gaps

1. [GAP: social platforms + handles — founder decision; candidates LinkedIn / X / Atlassian Community]
2. [GAP: site analytics — none installed; decide a privacy-friendly tool consistent with the privacy-first brand — founder decides]
3. [GAP: keyword research — SEO seeds in §6 need volume/difficulty validation; no tool chosen]
4. [GAP: in-app review nudge — verify it survived the 2026-07-07 Page Picker redesign and wire the real MARKETPLACE_REVIEW_URL]
5. [GAP: pricing surfaces are out of date against the VERIFIED model (free up to 10 · $6.70/user across the **1–100** band — a site enters it at its 11th user but the rate is charged from the FIRST user, so 100 users = $670 (never write "11–100": 90 × $6.70 = $603 ≠ the portal's $670) · $5.10 101–250 · $3.80 251–1000 · lower at scale · 1.5x multi-instance, per user, whole instance — portal-confirmed 2026-07-24) — the live site still says "$67 flat for 11+" and in-app usage.js still says "$6.70/user, $57 ≤10 flat"; correct both; founder + engineering own, 02-business-model-pricing.md is the KB authority]
5c. [GAP: the per-USER $5 welcome credit is decided (2026-07-24) but unimplemented (code today: per install, trial-only) and the production managed key funding is unconfirmed — no campaign may use it until both are cleared]
6. [GAP: blog nav placement — nav is a byte-identical component across all pages; nav link vs footer-only — founder picks]
7. [GAP: founder build-in-public pillar — needs founder approval + boundaries]
8. ✅ CLOSED 2026-07-24 — the exact vendor-portal tier values are now verified from the partner-portal "Set pricing" screen (free up to 10 · $6.70/user across the **1–100** band — a site enters it at its 11th user but the rate is charged from the FIRST user, so 100 users = $670 (never write "11–100": 90 × $6.70 = $603 ≠ the portal's $670) · $5.10 101–250 · $3.80 251–1000 · $3.50 1001–2500 · $3.25 2501–7500 · declining to $1.15 at 45001+ · 1.5x multi-instance). Recorded in §2; canonical copy in 02-business-model-pricing.md.
9. [GAP: email/newsletter channel — none exists; decide if in scope]
10. [GAP: campaign success targets — numbers + timeframe, founder sets]
11. [GAP: live Marketplace listing copy + release notes not captured in the KB — pull title/tagline/summary/highlights/latest release notes verbatim with a fetch date before any listing edit or release-note post; MARKETPLACE-LISTING-v3.md is the retired draft, not the live listing — see §9]
