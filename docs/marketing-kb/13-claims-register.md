---
title: "13 — Claims Register: the honesty firewall"
purpose: "The single authoritative list of approved, forbidden, and internal-only claims — MANDATORY reading before the AI marketing assistant writes anything public."
visibility: internal
sources:
  - ⭐ AUTHORITY - founder confirmation of the pricing + onboarding model, 2026-07-24 (supersedes every pricing source below)
  - ⭐⭐ AUTHORITY (tiers) - the Atlassian partner-portal "Set pricing" screen, founder screenshot, 2026-07-24 - PORTAL-VERIFIED. The exact per-user bands + the 1.5x multi-instance rate; REPLACES the provisional "101+ = $5.70/user" figure recorded earlier the same day (see B19)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/src/usage.js (⭐ GOVERNED SURFACE — re-read 2026-07-25: price strings CORRECTED, no retired figure. See "Governed surfaces" below)
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/index.html
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/pricing/index.html
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/privacy/index.html
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/dpa/index.html (founder-name line only)
  - https://spec2jira.com/ (live fetch 2026-07-24)
  - https://spec2jira.com/pricing (live fetch 2026-07-24)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/docs/MARKETPLACE-LISTING-v3.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/monetization-strategy.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/competitive-landscape.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/standard-only-trial-credit.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/marketplace-launch-state.md
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/CLAUDE.md (Monetization section; handovers 2026-05-30, 2026-06-17/18, 2026-06-21/22, 2026-07-09, 2026-07-11/12 — the validation milestones behind A5)
  - spec2jira-site repo git log (commit b1cdfe0 "Pricing pivot: free up to 10 users, $67/month flat, Advanced merged in" — pushed to origin/main; still HEAD as of 2026-07-25, i.e. still what the live page serves)
  - spec2jira-site working tree, read 2026-07-25 — the pricing correction is WRITTEN but UNCOMMITTED and UNPUSHED. It changes nothing about what is served until it is pushed (see the publication gate below)
  - docs/marketing-kb/drafts/SITE-PRICING-COPY-CORRECTED.md (the paste-ready corrected copy — a draft, not a publication)
last_verified: 2026-07-25
---

# 13 — Claims Register (the honesty firewall)

**This file governs every public sentence.** Nothing in a blog post, social post, listing edit, or reply may
assert a fact that is not in Table A. Table B claims are banned even if an older source seems to support
them. Table C facts never appear in public copy in any form. When in doubt: quote the live site verbatim.

Naming rule (intentional, do NOT "fix"): the **product** is **Spec2Tickets** ("Spec2Tickets for Confluence
and Jira" on the Marketplace); the **vendor brand + domain** are **Spec2JIRA** / spec2jira.com.

### ⭐ GOVERNED SURFACES — everything a customer can read, not only marketing documents

This register governs the sentence wherever it is rendered. A claim does not stop being a claim because it
lives in code:

| Surface | Examples |
|---|---|
| **Public marketing copy** | blog posts, LinkedIn / Atlassian Community posts, social copy, briefs, drafts |
| **The site** | spec2jira.com pages, meta descriptions, JSON-LD, CTA support lines, image captions |
| **The Marketplace listing** | tagline, summary, highlights, release notes, edition descriptions |
| ⭐ **Product UI strings** | **`src/usage.js` — the tier `price` and `priceNote` a customer reads in the in-app Account panel and on the subscription card** — plus any other in-app copy that states the offer, and anything visible in a screenshot |

Product UI strings are **governed by, and never a second owner of**, the free-tier rule (A2.1 + the
qualification test under the A2 table). Where a UI constraint makes A2.1 verbatim impossible — the
Account panel's `price` cell is ≲25 characters — the shortened wording must still pass the qualification
test, and **marketing quotes A2.1, never the UI string**. A UI string is not an alternative approved
shape, and a change to one is a claims change: re-check it here.

---

## ✅ CONFIRMED PRICING MODEL — read before writing ANY pricing copy (founder 2026-07-24; ⭐ tiers PORTAL-VERIFIED 2026-07-24)

The founder confirmed the model on **2026-07-24**, and the **tier table was verified the same day against
the Atlassian partner-portal "Set pricing" screen**. It **supersedes every other source** — `src/usage.js`,
`docs/MARKETPLACE-LISTING-v3.md`, the live spec2jira.com pricing page, and every memory file.

**Single-instance pricing** (the normal case — one Confluence site):

| User tier | Price per user / month | Max total for the band |
|---|---|---|
| **Up to 10 (flat)** | **FREE** — every feature, no time limit. A real free tier, not a trial. A flat-rate *override* that replaces the bands for that site, not an allowance. | **$0** |
| **1–100** (the band a site enters the moment it passes 10 users) | **$6.70** | up to **$670** = 100 × $6.70 |
| **101–250** | **$5.10** | up to **$1,435** |
| **251–1000** | **$3.80** | up to **$4,285** |
| **1001–2500** | **$3.50** | up to **$9,535** |

…declining further at scale ($3.25 · $2.85 · $2.65 · $2.40 · $2.20 · $2.00 · $1.60 · $1.45 · $1.35 ·
$1.15 at 45001+). Full table: 02-business-model-pricing.md §3a — ⚠ **that chapter still labels the first
paid band "11–100" (the error corrected here); this register is authoritative until 02 is re-synced.**

**Multi-instance** (several Confluence sites) = **1.5× the single-instance rate**.

**Per user above 10 — not a flat site price.** Paid via Atlassian licenses the whole Confluence instance
(every user on the site, not only app users). The most quotable consequence: **a 100-user instance is up
to $670/month, NOT "$67 flat."**

⭐⭐ **THE BAND MECHANIC — get this right, or the label contradicts the maximum.** Two rules, and they
are only consistent when stated together (corrected 2026-07-25; matches the correction shipped into the
site copy):

1. **"Up to 10" is a FLAT-RATE OVERRIDE, not an allowance.** A site of 10 users or fewer pays **$0**;
   the flat row *replaces* the bands entirely for that site. It is **not** ten free seats deducted from
   a larger site's bill.
2. **From the 11th user the bands take over — and the first band is "1–100", counted from the FIRST
   user.** Once a site passes 10 users, **every** user on it is charged, starting at user 1. That is
   precisely why the band's maximum is **$670 = 100 × $6.70**.

⛔ **Never relabel the first paid band "11–100".** It contradicts the portal's own maximum: 90 × $6.70 =
**$603**, not $670. The distinction that makes both true: **"from 11 users" is the THRESHOLD** (correct,
and the right thing to say in copy); **"1–100" is the BAND LABEL** (correct, and what the rate applies
across). Say the threshold, label the band 1–100 — never fuse the two into "11–100 users at $6.70".

- ⚠⚠ **PUBLICATION GATE — a CONDITION WITH A CHECK, not a standing statement of fact.** The figures are
  verified; what gates them is whether **our own live page agrees with them**. No sentence in this KB is
  evidence of what the live page says today — **load the page**:

  > ### THE CHECK — run it on publication day, every time
  > Open **https://spec2jira.com/pricing** (or `curl -s https://spec2jira.com/pricing | grep -i '\$67\|month flat\|not per user'`).
  > - **Any flat site price survives on it** — a "$67", a "/ month flat", a "not per user" — ⇒ the gate is
  >   **CLOSED**. No exact figure enters public copy, and `/pricing` is not a link target. Use **A2.1** for
  >   the shape and **A2.9** wherever a number is expected.
  > - **The corrected page is served** — free while the site has ≤10 users, then **per user** on a declining
  >   curve ⇒ the gate is **OPEN**. **A2.2 / A2.2b / A2.2e are cleared for unrestricted public use and
  >   `/pricing` links are restored, with NO further sign-off**, and every "until the site is corrected"
  >   caveat pointing at this gate is struck the same day.

  **State of the correction, 2026-07-25 — this is exactly why the check exists.** The corrected copy
  **EXISTS**: paste-ready in `drafts/SITE-PRICING-COPY-CORRECTED.md`, and the edits are present in the
  founder's site-repo working tree. It is **NOT committed and NOT pushed** — site `HEAD` is still
  `b1cdfe0`, so the served page is unchanged and **the gate is CLOSED today.** Two failure modes this gate
  exists to prevent, in both directions:
  - **(a) Publishing the figures too early**, because the correction "exists" or "is done". A correction
    that is not pushed changes nothing a prospect can read. Written ≠ live.
  - **(b) Keeping the block forever**, because a document still says "the site still publishes $67". That
    sentence is a dated observation, not a licence to keep blocking; **the check is the authority, and it
    outranks every prose caveat in this KB.**

  ⚠ **`/pricing` is not the whole fix list.** The homepage CTA support line (*"Free up to 10 users · …"*)
  is part of the same pending correction — a gate-open check should confirm the landing page too. The
  site's non-price sentences (30-day trial, BYOK footnote, early-access) remain quotable throughout. ⚠ Its
  **free-tier sentences do NOT** — they state the offer without the whole-instance qualifier, so they fail
  the qualification test below; the free tier is published only as **A2.1**.
  ⛔ **$67 is never quotable — before or after the fix** (B17). The gate governs *our* verified figures; it
  never unlocks the retired one.
- ⛔ **"$5.70 per user for 101+ users" is RETIRED and must be corrected wherever it survives** — B19. The
  real single-instance rate above 100 users is **$5.10**.
- ✅ **RESOLVED 2026-07-25 — `src/usage.js` no longer carries a retired price string.** *Was:* the in-app
  tier rendered `$6.70/user/mo` with a "≤10 users = $57/mo flat" note. Re-read in the working tree on
  2026-07-25: `price` is now `'See Marketplace pricing'`, and `priceNote` states the shape **with** the
  whole-instance qualifier and defers the figure to the Marketplace listing — **no rate, no $57 floor,
  nothing a customer can read as a tier we do not sell.** The **$6.70 figure itself survives** as the
  1–100 band (A2.2); the **$57-flat-≤10 framing stays retired** (≤10 is FREE) — B4. ⚠ What remains open
  is *only* this: the corrected strings are uncommitted, so a **screenshot** of the Account panel is safe
  only if it comes from a build that carries them — which is the current-version rule every screenshot
  already has, not a separate price block.
- ⛔ **The welcome credit is NOT publishable** in any form — B16. The per-user model is decided but the
  shipped code is per-install and trial-only.
- ⚠ **Above the first band, never multiply one band rate by the full headcount.** The portal's "Max total"
  column reconciles as a **graduated** curve (each band's rate applies only to the users inside that
  band), so a 250-user instance is ~$1,435, **not** 250 × $5.10. Inside the **first** paid band the whole
  headcount *is* charged at $6.70 — that is exactly how a 100-user site reaches $670 — so the two rules do
  not conflict: band 1 starts at user 1, every band above it is incremental. When a number must be exact,
  use A2.9 rather than doing the maths in public.
- Safe fallback sentence (approved, always true): *"The Marketplace always shows the exact price for your
  team size before you subscribe."* (live pricing FAQ).

---

## TABLE A — APPROVED PUBLIC CLAIMS

All wording verified against the named source on **2026-07-24**. Prefer verbatim reuse; paraphrase must not
strengthen the claim.

### A1 — Positioning & product

| # | Approved wording (exact) | Source |
|---|---|---|
| A1.1 | "Your Confluence page is already a backlog. Let it write itself." (hero H1) | site index.html + live fetch |
| A1.2 | "Turn a Confluence page into a sprint-ready Jira backlog — in minutes, reviewed by humans." (short-form tagline; the arrow variant "Your Confluence page → a sprint-ready Jira backlog" is the retired 2026-06-04 hero — same meaning, still acceptable shorthand) | site footer tagline (live); CLAUDE.md 2026-06-04 |
| A1.3 | "Spec2Tickets reads your Confluence page — a spec, PRD, or requirements doc — and writes the whole Jira backlog: Epic, stories, subtasks, acceptance criteria, and dependency links, in minutes." | site hero lead |
| A1.4 | Stat: "~70% — less hand-work building a sprint-ready backlog" | site stats band (live) |
| A1.5 | Stat: "Minutes — not the 2–3 days a manual breakdown takes" | site stats band (live) |
| A1.6 | Stat: "100% — human-reviewed before anything reaches Jira" | site stats band (live) |
| A1.7 | "AI drafts; your team reviews and decides before anything ships." / "Nothing reaches Jira until a person reviews and approves it." | site compare card + values |
| A1.8 | "Most AI tools expand a one-line prompt or enrich a single ticket. Spec2Tickets reads an *entire* Confluence specification…" (altitude positioning) | MARKETPLACE-LISTING-v3.md §2 |
| A1.9 | "Cross-feature dependencies detected and linked in Jira" / real "blocks / is blocked by" Jira links | site compare card + use-case card |
| A1.10 | Marketplace name + URL: "Spec2Tickets for Confluence and Jira" — https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira | site CTAs; marketplace-launch-state |

### A2 — Pricing & trial (per the confirmed model above)

| # | Approved wording (exact) | Source |
|---|---|---|
| A2.1 | ⭐⭐ **THE CANONICAL FREE-TIER CLAIM — the single approved wording. This register owns it; every other artifact — document *or* product UI string (see "Governed surfaces") — cites `A2.1` and quotes it verbatim, and none defines, restates or paraphrases it.** → *"Spec2Tickets is free while your whole Confluence site has 10 users or fewer — every feature included, no time limit. Paid via Atlassian licenses the entire Confluence instance, so every user on the site counts toward the price, not only the people who use the app. Above 10 users it is priced per user, on a rate that declines as the site grows, and the Atlassian Marketplace shows you the exact price for your site size before you subscribe."* ← Publishable **now**: it carries no figure, so the site-fix dependency below does not touch it. It may be shortened only if the shortened form still passes the qualification test under this table; the whole-instance sentence is never what gets cut. | founder confirmation 2026-07-24; Atlassian PvA model; live pricing FAQ |
| A2.2 | ⭐ **PORTAL-VERIFIED.** "Above 10 users it is a per-user monthly price — **$6.70 per user, per month for users 1–100** — and every user on the site is counted from the first, so a **100-user site is $670 a month**." ⚠ **Threshold vs band label:** say "from 11 users" for the *threshold*, label the *band* **1–100**. "11–100 users at $6.70" is forbidden — it contradicts the $670 maximum (90 × $6.70 = $603); see the band mechanic above. ⚠ **Gated** — publishable only when the publication-gate check passes. | portal "Set pricing" screen, 2026-07-24 |
| A2.2b | ⭐ **PORTAL-VERIFIED.** "The rate declines as the instance grows: **$5.10 per user from 101 users, $3.80 from 251**, and lower again at larger sizes." Above the first band the curve is **graduated** — each rate applies only to the users inside its own band. Same publication gate. (Individual deeper bands — $3.50, $3.25, … $1.15 — are verified and may be quoted, but rarely help a reader; prefer the shape.) | portal "Set pricing" screen, 2026-07-24 |
| A2.2c | "It is per user above 10 — not a flat price for the site." | founder confirmation 2026-07-24 |
| A2.2d | ⛔ **CONSOLIDATED INTO A2.1 (2026-07-25) — no longer a separate wording.** The whole-instance qualifier is now the second sentence of the canonical claim, so it can never travel without the offer it qualifies. The id is kept only so older references resolve: cite **A2.1**. | see A2.1 |
| A2.2e | ⭐ **PORTAL-VERIFIED.** "Customers licensing multiple Confluence instances pay a 1.5× multi-instance rate." Same publication gate. | portal "Set pricing" screen, 2026-07-24 |
| A2.2f | ⛔ **CONSOLIDATED INTO A2.1 (2026-07-25) — no longer a separate wording, and the old text is withdrawn.** Its shorthand opening ("Free for teams of up to 10…") stated the offer **without** the whole-instance qualifier, i.e. it failed the qualification test under this table while presenting itself as approved copy. The canonical claim carries the same shape *with* the qualifier attached. Cite **A2.1**. | see A2.1 |
| A2.3 | "Larger teams get the Atlassian Marketplace's standard 30-day free trial before the subscription starts." (⚠ the live page says "before the *flat* subscription starts" — drop the word "flat", it belongs to the retired model) | live pricing FAQ, de-flattened |
| A2.4 | "Prices are in USD and set through the Atlassian Marketplace. Every plan is BYOK — AI usage runs on your own Anthropic key and is billed by Anthropic at cost." | live pricing footnote |
| A2.5 | "Early-access pricing — we grandfather early adopters as the product grows." | live pricing footnote |
| A2.6 | "The AI compute is paid separately, directly to Anthropic, using your own API key (typically a few cents per breakdown). There is no vendor markup on AI." | live pricing FAQ |
| A2.7 | ⛔ **WITHDRAWN — moved to Table B (B16).** The welcome credit / "start on our key before adding your own" is **forbidden in new public copy** until the per-user implementation ships and the founder confirms. The live privacy page carries a trial-scoped sentence of its own; **do not extend, amplify, or build campaign copy on it** while B16 stands. | see B16 |
| A2.8 | "Subscriptions are handled through the Atlassian Marketplace and your Atlassian site administration." | live pricing FAQ |
| A2.9 | "The Marketplace always shows the exact price for your team size before you subscribe." — the always-safe fallback whenever precision is needed. Mandatory in place of a figure **whenever the publication gate is closed** (check it, don't assume); useful afterwards too, whenever a *total* (rather than a per-user rate) is being asked for. | live pricing FAQ |

- ⭐⭐ **WHAT MAKES A FREE-TIER CLAIM "QUALIFIED" — the one test, and the only one.** A free-tier claim is
  qualified **only if the words that state the 10-user limit are accompanied, in the same breath, by the
  statement that the limit counts every user on the whole Confluence site — not only the people who use the
  app.** Anything shorter is unqualified and is not publishable, in any format, at any length, on any
  surface (body copy, headline, meta description, CTA line, image caption, social post, PR title). If it
  does not fit, the free-tier claim comes out and **A2.9** goes in; the qualifier is never what gets cut.
  **A2.1 is the only approved free-tier wording. No other artifact — skill, calendar, blog plan, brief,
  draft, or product UI string (`src/usage.js` tier `price`/`priceNote` and any in-app copy; see "Governed
  surfaces") — may define, restate, paraphrase or offer an alternative "approved shape" for this rule.
  They cite the id `A2.1` and quote this row verbatim.** A shipped UI string is *bound by* the rule, and is
  never a source to quote from: where a UI constraint makes A2.1 verbatim impossible, the shortened
  wording must still pass the test below, and marketing still quotes A2.1. Reusing an unqualified sentence because it is already
  published on our own site is **not** an exemption (same reasoning as B17): a published page is not a
  licence to spread the error to new surfaces — conductor ruling, 2026-07-25, settled and binding.
- ✅ **RESOLVED 2026-07-24 — the tier figures are portal-verified.** *Was:* "the 11–100 / 101+ split is the
  founder's illustrative shape, not a verified portal tier table." The partner-portal "Set pricing" screen
  now confirms the bands, so A2.2 / A2.2b / A2.2e may **state the ranges**, not just the prices. ⚠ **The
  verified first range is `1–100`, not the `11–100` of that retired sentence** — corrected 2026-07-25; see
  the band mechanic above.
- ⚠⚠ **BINDING PUBLICATION GATE (the one live constraint on A2.2 / A2.2b / A2.2e).** The figures are
  *true*; the constraint is agreement with our own published page, and it is **decided by the check above,
  never by what a document asserts.** The reasoning it encodes: while a flat price is still served, a
  prospect who reads our copy and then our own site sees two different prices.
  - **Gate CLOSED** (a flat price is still served): publish the *shape* — the canonical free-tier claim
    **A2.1**, plus A2.2c — and use **A2.9** wherever a number is expected.
  - **Gate OPEN** (the corrected page is served): **A2.2 / A2.2b / A2.2e are cleared for unrestricted
    public use, immediately, with no further approval** — and the caveats pointing here come out.
  [GAP — a **condition to test, not a status to quote**: is the corrected pricing page live at
  spec2jira.com/pricing? Owner: founder / site repo (the copy is written and staged; it needs a push).
  Verify by loading the page on publication day. This is the *only* thing gating the exact figures.]
- **Never multiply a band rate by the full headcount** (graduated curve — see the model block above). If a
  total is requested, give A2.9.
- ✅ **CLOSED 2026-07-25 — the `src/usage.js` price strings.** *Was:* "[GAP: `src/usage.js` still renders
  '$6.70/user/mo (≤10 users = $57/mo flat)' in the in-app Account panel — a paying customer can read a tier
  structure we no longer sell.]" Re-verified by reading the file: the tier now carries
  `price: 'See Marketplace pricing'` and a `priceNote` that states the shape, keeps the whole-instance
  qualifier and defers the figure to the Marketplace. **No engineering gap remains here**, and it no longer
  blocks anything — see the screenshot note under B4 and the governed-surfaces table above.

### A3 — Trust, privacy, security (quote the live site/privacy page; never re-draft legal wording)

| # | Approved wording (exact) | Source |
|---|---|---|
| A3.1 | "In this BYOK model, AI processing happens under *your* agreement with Anthropic, and Spec2JIRA operates no backend and never receives your data on its own servers." | privacy page one-liner |
| A3.2 | "Your content stays under your own Anthropic agreement." (hero note) | site hero note (live) |
| A3.3 | "No vendor backend. The app runs entirely on Atlassian Forge. Nothing is stored on our servers — because we don't operate any." | site privacy/trust card |
| A3.4 | "The App sends data to no other external service. Its only configured network egress is to api.anthropic.com." | privacy §7 |
| A3.5 | "By default, Anthropic does not use data submitted through its API to train its models, and deletes API inputs and outputs within around 30 days" (always attribute to Anthropic's own docs, as the privacy page does) | privacy §4 |
| A3.6 | "The app requests only the scopes it needs, creates issues but never deletes them, and acts with your own Atlassian permissions." | site values ("Least privilege, always") |
| A3.7 | Data stored only in Atlassian Forge KV storage inside the customer's instance; API key in encrypted secret storage; un-pushed breakdowns auto-removed after 7 days of inactivity; removed on push; uninstall removes all stored data. | privacy §3/§5 |
| A3.8 | Managed trial processing (welcome credit): "Spec2Tickets acts as a processor… Anthropic is our sub-processor"; batch inputs/outputs "retained by Anthropic for up to about 29 days"; "We do not claim 'zero retention' for managed processing"; no training; SCCs for US processing. | privacy "Managed AI processing" section |
| A3.9 | "All access to Confluence and Jira uses Atlassian's asUser authorization — the App acts with the signed-in user's permissions, never a separate service account." | privacy §10 |
| A3.10 | "Privacy by architecture, not by promise. …We can't see your data because we never receive it." (BYOK context only) | site values |
| A3.11 | Vendor is "Aleks Asenov Asenov, a sole trader (individual) established in Sofia, Bulgaria, operating under the Spec2JIRA / Spec2Tickets brand." Public founder facts stop at name + sole trader + Sofia, Bulgaria. "Made in Sofia, Bulgaria" + "Support 11:00–23:00 (Europe/Sofia), 7 days a week." | dpa page; site footer |

### A4 — Capabilities & technology

| # | Approved wording (exact) | Source |
|---|---|---|
| A4.1 | Output = one Epic + stories + subtasks + acceptance criteria on every story + story points + priority + category labels + Story-blocks-Story dependency links, created "under your own Atlassian permissions". | site how-it-works; listing §2 |
| A4.2 | "Powered by Anthropic Claude" (site) / "Claude Sonnet 4.6" (listing description). Current primary model in code: claude-sonnet-4-6. | site trust strip; listing §2; CLAUDE.md file map |
| A4.3 | "AI-generated acceptance test cases (BA-grade Gherkin / CSV)" — included in the standard product; "ready to import into your test tools". | live pricing feature list; site QA/BA use-case card |
| A4.4 | "Sprint planning" is included; the planner pushes **native Scrum sprints** and **Kanban ranking (Now / Next / Later)** on **both team-managed and company-managed boards** (live on the Marketplace since v6.0.0, 2026-06-22). | live pricing feature list; CLAUDE.md 2026-06-22 handover |
| A4.5 | "Handles large, dense specs" — quantified form must be labelled: "validated internally on specifications of ~100K characters" (internal validation, 2026-05; not a customer result). | listing §2; CLAUDE.md gotcha #8 (101K-char spec) |
| A4.6 | Project Context / glossary profiles per project enrich generation vocabulary without changing scope. | CLAUDE.md 2026-06-02 handover (P1 shipped) |
| A4.7 | Setup: "paste your Anthropic key and a default Jira project key. About five minutes." | site how-it-works step 1 |
| A4.8 | Generation timing: "minutes" / "a few minutes" (asynchronous processing). Never promise seconds or "1–2 minutes" (see B10). | site copy; CLAUDE.md (batch reality) |
| A4.9 | Runs on Atlassian Forge, cloud-only, Confluence + Jira; two entries in "Manage apps" is normal for a cross-product Forge app. | listing §0; CLAUDE.md gotcha #10 |
| A4.10 | Review editor: adjust names, stories, acceptance criteria, dependencies, priority, story points, labels inline; quality signals show where to look. | site how-it-works step 3 |

### A5 — Internal-validation proof points (labelled + dated; NEVER customer results)

These are our own runs on our own instance — publishable, but only in this shape. Every use MUST carry
(a) the words "internal validation" (or "in our own validation runs"), (b) the run date, and (c) no
customer, testimonial, or "customers achieve…" framing (B12). Never name the dev site or its projects
(C5) and never describe the methodology (C6). Strip the label or the date and the claim becomes forbidden.

| # | Approved wording (exact) | Source |
|---|---|---|
| A5.1 | "In internal validation (2026-05-30), a single end-to-end run created 178 Jira items with 0 failures." | CLAUDE.md 2026-05-30 milestone |
| A5.2 | "Our own ~101,000-character product spec came back as 39 features and 162 subtasks with dense cross-feature dependencies, validated end to end through the chunked push (internal validation, 2026-05-30)." The shorter listing-style form stays A4.5. | CLAUDE.md gotcha #8 + 2026-05-30 |
| A5.3 | "A clean 82-item push read '100% — 82 of 82' with a full outcome ledger (internal validation, 2026-07-09)." | CLAUDE.md 2026-07-09 handover |
| A5.4 | "The planner assigned 17 issues across 5 sprints on a team-managed board (internal validation, 2026-06-21)." | CLAUDE.md 2026-06-21 handover |
| A5.5 | "13 stories carried their generated test cases into Jira on push (internal validation, 2026-06-18)." Plain English only — never the raw `tc_embedded=13` token. | CLAUDE.md 2026-06-18 handover |
| A5.6 | "The hard-dependency rule held in 3 of 3 runs, across all four planning objectives (internal validation, 2026-06-21)." | CLAUDE.md 2026-06-21 handover |

- The remaining rows of 06-use-cases-workflows.md's proof-metrics table (Kanban rank counts, test-case
  coverage/quality, Project-Context boundary) inherit the same labelling rule but are **not** individually
  pre-approved here — verify each against its named run before it enters public copy.
- ⛔ **Cost figures are deliberately NOT in A5** — unit economics stay internal (C1). The single-run
  "~$0.045 for a 10-feature breakdown" is a LOW-END observation against our own measured average of
  ~$0.118 (range $0.05–0.24), so publishing it as typical would understate our own data; the same applies
  to the test-generation "$1.27 actual vs $2.45 ceiling" run and the ~$0.014–0.018 planner run. The only
  approved public cost wording is A2.6 ("typically a few cents per breakdown"). ⚠ 06 and 11 currently
  publish "~$0.045" — correct that before reusing those sentences.

---

## TABLE B — FORBIDDEN / RETIRED CLAIMS

Never publish these, regardless of what an older document says.

| # | Forbidden claim | Reason |
|---|---|---|
| B1 | Any EUR price (€3.90, €4.90, €6.90, €9.90, €20, €29, €39, €49, €69, €99) | Retired EUR-era plans (all pre-2026-06-04). Live pricing is USD via the Atlassian Marketplace. EUR figures may appear only as clearly-labelled history, and only where the history itself matters. |
| B2 | "Free plan = 3 breakdowns per month" (or any in-app usage-capped free tier) | The in-app Free tier was removed 2026-06-03. Do NOT conflate with the CURRENT free tier, which is stated only as A2.1 — different thing, different era. |
| B3 | "Flat €39/month" (or any flat-EUR price) | Retired 2026-06-01/03; Atlassian PvA forced per-user tiers at the time, and the currency is USD. |
| B4 | **"flat $57/month up to 10 users"**, the "$6.70/user **with a $57 flat ≤10 floor**" pairing, and **"Advanced $13.40/user"** | Retired by the confirmed model: **≤10 users is FREE**, not $57. (The bare **$6.70/user figure is NOT forbidden** — it is the approved **1–100** band, A2.2, gated by the publication gate — only the $57-floor framing and the Advanced price are.) Advanced was folded into the single plan on 2026-07-11. ✅ **`src/usage.js` no longer carries these strings** (re-read 2026-07-25 — corrected to a shape that defers to the Marketplace). The only residue is a **screenshot** taken from an older build: capture the Account panel from a build carrying the corrected strings, which the current-version screenshot rule already requires. |
| B5 | "The only BYOK app" / "the only app where you bring your own key" | False. POPal also markets BYOK / private-LLM (competitive research 2026-06-01). Approved sharper angle: BYOK **to Anthropic**, at **spec altitude**, under **your own Anthropic agreement**. |
| B6 | "Zero data retention" / "your data never leaves Atlassian" / "no third party ever sees your content" | False. Page content is sent to Anthropic (sole egress, api.anthropic.com); Anthropic's API retention is ~30 days by default; managed-trial batches are retained up to ~29 days and are NOT zero-data-retention eligible. The privacy page explicitly refuses the "zero retention" claim. |
| B7 | "Unlimited" without the BYOK qualifier | "Unlimited" is safe only because the customer's own Anthropic key pays compute. Approved form: "unlimited breakdowns on your own Anthropic key". The managed welcome credit is small and bounded — never "unlimited". |
| B8 | Managed edition or "Advanced" edition presented as buyable today | Managed was never sold on the Marketplace; Advanced was folded into the standard product (live pricing FAQ: "It has been folded into BYOK Pro"). Mention Advanced only as folded-in history. **Managed no-key processing must not be mentioned at all right now** — its only live use is the welcome credit, which B16 blocks. |
| B9 | Perfection / autonomy promises: "perfect stories", "no review needed", "fully automatic backlog", guaranteed accuracy | Contradicts the core position (A1.6/A1.7: 100% human-reviewed; AI drafts, humans decide). |
| B10 | Specific speed promises: "60–150 seconds", "~1–2 minutes", any sub-minute figure | Generation is an asynchronous batch that can take several minutes; in-app copy was corrected to "a few minutes". The listing draft's "~1–2 minutes" is stale — do not reuse. Approved: "minutes, not days". |
| B11 | Competitor metrics (installs, ratings, prices) without an explicit "as of" date | All competitor figures are snapshots (~Feb–Jun 2026) and age fast. See 05-competitive.md for the dated table. |
| B12 | Internal validation presented as customer results; invented customers, testimonials, quotes, or named logos | No customer results, testimonials, or case studies exist in any source. "~70% less hand-work" and the ~100K-char scale figure are internal claims — never attribute them to a named customer. |
| B13 | Naming AKONY / Surgena as our fonts, or claiming their use | The moodboard "evokes" them; they are not imported. The site's actual webfonts are Space Grotesk + Inter. |
| B14 | "Trusted by Fortune 500" or any install/user count for Spec2Tickets | Fortune-500 is a POPal claim, not ours; no fresh install/review figures for Spec2Tickets exist in KB sources. [GAP: current Marketplace install + review counts — pull live from the listing on the day of publication before citing any number.] |
| B15 | "The app stores nothing at all" | Overclaim. It stores configuration + transient breakdowns in Forge KV storage inside the customer's instance (A3.7). The approved absolute is "no Spec2JIRA-operated servers / backend". |
| B16 | ⛔ **The welcome credit — ALL of it, in any public form.** Includes: "$5 welcome credit", "$5 of AI usage", "every user gets $5", "start generating without an API key", "no API key needed to start", "free AI credit to try it", and any paraphrase of the onboarding motion. | **The per-user credit is DECIDED but NOT yet implemented** — the shipped code grants **$5 per install** and **only to a 30-day-trial license** (a free-tier install gets nothing), so the promise would be false for exactly the audience it targets. **Unblock only when the code ships AND the founder confirms.** A second precondition stands independently: the production managed Anthropic key must be funded and set, or the capability fails to a graceful "managed unavailable". ⚠ 01, 02, 06, 11 and 12 still contain "$5" / no-key-onboarding sentences — per this register **none of them are cleared for public reuse.** |
| B17 | **"$67/month flat for the whole site"**, "one flat price, no per-user math", "flat subscription" as our pricing shape | **Wrong against the confirmed model** (founder, 2026-07-24): pricing is **per user above 10 users**. It was still being served at the last check (2026-07-25 — the correction is written but unpushed), but **check rather than assume** (the publication gate). Either way this row does not move: a published page is not a licence to repeat it, and **$67 is never quotable, before or after the fix.** |
| B19 | **"$5.70 per user for 101+ users"** — and any "the declining band above 100 users is $5.70" phrasing | **Retired 2026-07-24 by the portal check.** It was a provisional figure recorded earlier the same day: **$5.70 is the *multi-instance* price of the 251–1000 band**, misread across columns. The real **single-instance** rate above 100 users is **$5.10** (101–250), then **$3.80** (251–1000) — A2.2b. Correct it wherever it survives; $5.70 may appear **only** as the multi-instance 251–1000 rate, which is not a figure worth publishing on its own. |
| B18 | Per-install / trial-only descriptions of the credit: "$5 per installation", "one $5 credit per site", "the credit is only for the 30-day trial", "free-tier teams don't get credit" | Doubly blocked. It describes the **superseded** design (the target is per-USER, on the free tier as well), *and* the whole subject is blocked by B16. Internal-only orientation; never public, not even as "how it works today". |

---

## INTERNAL CONTEXT — never publish

### TABLE C — INTERNAL-ONLY FACTS (background for the assistant; zero tolerance in public copy)

| # | Internal fact class | Detail (for orientation only) |
|---|---|---|
| C1 | Unit economics | Breakdown compute avg ~$0.118 (range ~$0.05–0.24); test-case generation avg ~$1.01/breakdown (range $0.22–3.67, ~8.6× a breakdown); Anthropic Batches ≈ 50% of sync pricing; historical Managed margin floors (~54% at cap). |
| C2 | Welcome-credit internals | **Shipped:** $5 grant is per-install, lifetime, trial-gated; hard ceiling ~$6 (1.2× grant); reservation ledger (hold at submit → reconcile at finalize); pre-flight run blocker; env vars MANAGED_ANTHROPIC_KEY, MANAGED_TRIAL_CREDIT_USD, MANAGED_HARD_CEILING_USD. **Decided target (2026-07-24, unbuilt):** per-USER $5, free tier included → exposure scales with seats instead of installs; the guardrail is an open engineering question (14-gaps-for-partner.md A2). Both states are internal; the public claim is blocked either way (B16). |
| C3 | Enforcement / metering | ENFORCEMENT_MODE (block prod / meter dev); MANAGED_USER_CAP=25 (dormant Managed path); per-user KVS metering keys; firstSeenAt grandfathering signal. |
| C4 | Incident + review history | 2026-05-27 Marketplace security-bot FIT rejection (old self-hosted backend, architecturally fixed by the Forge/BYOK pivot); 2026-05-29 runaway-retry token burn; the XCA / "more than one parent" Paid-via-Atlassian saga; CI deploy "Premature close" (Node 24.17.0 regression); 2026-07-12 trial-credit overrun caught in live testing. |
| C5 | Dev / test environments | spec2jira-dev.atlassian.net, project SDTY / SCRUM-DEV, alexacenov.atlassian.net, the reviewer site vs-overlord22 — never name in public. |
| C6 | Validation *internals* — not the headline results | Bake-off + multi-agent-audit methodology, run-by-run internals, which environment/project each run used (C5), and ANY unlabelled or undated use of a validation figure. ⚠ The headline results themselves (178 items / 0 failures; the ~101K-char spec → 39 features / 162 subtasks; 82-of-82; 17 issues across 5 sprints) ARE publishable — but only in the labelled, dated **A5** / A4.5 form, and never as customer results (B12). Cost/unit-economics figures stay internal under C1 (see the ⛔ note under A5). |
| C7 | Portal mechanics | "100% of Confluence price" preset, declining-curve *rationale* (why we do not flatten it), editions-are-cumulative rules, editions Phase 2 sequencing. ⚠ **Two things moved OUT of C7 on 2026-07-24:** the **tier figures themselves** and the **1.5× multi-instance rate** are customer-facing pricing, now approved as A2.2 / A2.2b / A2.2e (subject to the publication gate). What stays internal is *why* the curve is shaped that way. |
| C8 | Roadmap dates + internal versions | v6.6.0 release state, prod-ops checklist, editions Phase 2 timing — see 10-roadmap-vision-story.md; never pre-announce dates. |
| C9 | Anthropic ops | Managed-key account funding status, reselling/commercial-terms analysis, model fallback details (haiku fallback) beyond the public "Powered by Anthropic Claude". |
| C10 | Absolute exclusions — never anywhere, not even internal KB reuse | Bank details (IBAN/SWIFT), tax or personal ID numbers (EGN), street addresses. Founder facts stop at: Aleks Asenov, sole trader, Sofia, Bulgaria (A3.11). |

### Sensitivity notes

- **Atlassian brand compliance.** [GAP: partner to skim the Atlassian Marketplace partner branding rules before new public assets.] Internal note (2026-06-02): the "Spec2JIRA" vendor name + spec2jira.com domain contain "JIRA" and were flagged internally as a potential brand-guideline exposure (never raised by Atlassian review). Treatment: fine as the established vendor/domain name; **new public assets lead with "Spec2Tickets"**; never invent new JIRA-containing names; the app-name pattern "…for Confluence and Jira" is the allowed form. Do not imply Atlassian endorsement.
- **Anthropic naming.** "Powered by Anthropic Claude" is factual model use — never imply partnership, endorsement, or preferred-vendor status.
- **Founder privacy.** Name, sole-trader status, and Sofia, Bulgaria are public (site + DPA). Everything beyond (street address, IDs, banking, personal email) stays out of ALL marketing surfaces, internal or public.
- **Pricing sensitivity.** The **model** is confirmed and the **tier table is portal-verified** (both 2026-07-24). What is *not* a standing fact is whether the live site agrees — that is the publication gate, and it is answered by loading the page, not by re-reading this KB. So: never improvise a number, never quote $67 (B17) or the retired $5.70 (B19), never fuse the threshold and the band label into "11–100", and **while the gate is closed** use A2.9 (the Marketplace-shows-your-price sentence) wherever exactness matters. Expect prospects to compare our copy against the site until the corrected page is live; the moment it is, the verified figures need no further caveat.
- **Legal wording.** Privacy/DPA/sub-processor language is quoted from the live site only (lawyer-approved); never paraphrase it into stronger promises. The forge repo's docs/compliance/* are STALE — never source from them.

---

## USAGE PROTOCOL (for the AI marketing assistant — every public draft)

1. Before publishing, check EVERY number, name, and factual claim against Table A; reuse the approved wording verbatim or weaker — never stronger.
2. If a claim is not in Table A, do NOT invent or infer it: ask the partner, or mark it [GAP: …] and leave it out of the draft.
3. Scan the draft against Table B; delete or rewrite any match — no exceptions for "an old doc said so".
4. Confirm nothing from Table C (or the exclusions in C10) appears, even paraphrased or as a hint.
5. For pricing: use the **confirmed, portal-verified model** — **A2.1** for the free tier (the canonical claim, quoted verbatim or shortened only within the qualification test), A2.2–A2.2e for the paid bands — never the retired "$67 flat" (B17), never the "$57 flat ≤10" framing (B4), never the retired "$5.70 for 101+" (B19), and never "11–100" as a band label (say "from 11 users"; the band is **1–100**). **Then run the publication-gate check — do not infer the answer from this file.** Gate closed ⇒ publish the shape (A2.1) and use A2.9 for numbers. Gate open ⇒ A2.2/A2.2b/A2.2e are cleared as-is. **Say nothing about the welcome credit** (B16).
6. **The free-tier rule has exactly one home: A2.1 in this register.** If a skill, calendar, brief, draft **or product UI string** (`src/usage.js` tier `price`/`priceNote`, in-app copy — see "Governed surfaces") contains its own formulation of the rule — its own "approved shape" sentence, its own definition of what counts as qualified — that is a defect in that file, not a second opinion: fix it there and cite `A2.1`. A shipped UI string is governed by the rule and is **never** an approved alternative wording to quote from; where a UI constraint forbids A2.1 verbatim, the shortened string must still pass the qualification test. Drift between restatements is what produced three incompatible standards before 2026-07-25.
7. Attach "as of <date>" to every metric that ages (installs, reviews, competitor prices, validation figures) and re-verify it on the day of publication. Internal-validation figures additionally carry the A5 label — the words "internal validation" plus the run date, never a customer result.
