---
title: "02 — Business model & pricing (USD, confirmed model)"
purpose: Canonical reference for how Spec2Tickets makes money and what customers pay — Marketplace subscription (free ≤10, per-user above) + BYOK AI compute — including the welcome-credit onboarding motion, pricing history, and internal pricing rationale.
visibility: mixed
sources:
  - ⭐ AUTHORITY - founder confirmation of the pricing + onboarding model, 2026-07-24 (supersedes every source below on price, tiers and welcome credit)
  - ⭐⭐ AUTHORITY (tiers) - the Atlassian partner-portal "Set pricing" screen, founder screenshot, 2026-07-24 - PORTAL-VERIFIED. Gives the exact per-user bands + the 1.5x multi-instance rate, and REPLACES the provisional "101+ = $5.70/user" figure recorded earlier the same day (that number was the multi-instance price of the 251-1000 band, misread across columns)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/src/usage.js (⚠ STALE price strings — see §3c)
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/pricing/index.html (commit b1cdfe0, 2026-07-16, in sync with origin)
  - https://spec2jira.com/pricing (fetched live 2026-07-24)
  - https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira (fetched live 2026-07-24)
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/monetization-strategy.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/standard-only-trial-credit.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/marketplace-launch-state.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/migration-protections.md
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/CLAUDE.md ("Monetization & tier enforcement" section + 2026-07-11/12 handover notes)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/docs/marketing-kb/13-claims-register.md (row B4 — per-user figures forbidden in new public copy)
last_verified: 2026-07-24
---

# 02 — Business model & pricing

> Product = **Spec2Tickets** ("Spec2Tickets for Confluence & Jira" on the Marketplace). Vendor brand/domain = **Spec2JIRA** / spec2jira.com — intentional split, do not "correct" it (see 08-brand-voice-visual.md).

## ✅ CONFIRMED PRICING MODEL — founder decision, 2026-07-24 · ⭐ TIERS PORTAL-VERIFIED 2026-07-24

The founder confirmed the subscription **and** onboarding model on **2026-07-24**, and the **tier table was
verified the same day against the Atlassian partner portal's "Set pricing" screen** (founder screenshot).
It **supersedes every other pricing statement in every source** — `src/usage.js`,
`docs/MARKETPLACE-LISTING-v3.md`, the live spec2jira.com pricing page, and every memory file. Where a
source disagrees, the **source is stale, not the model**.

| Confluence instance size | Price per user / month | Max total for the band |
|---|---|---|
| **Up to 10 users** | **$0 — FREE** | $0 |
| **1–100** (the band a site enters the moment it passes 10 users) | **$6.70** | up to **$670** = 100 × $6.70 |
| **101–250** | **$5.10** | up to **$1,435** |
| **251–1000** | **$3.80** | up to **$4,285** |
| **1001–2500** | **$3.50** | up to **$9,535** |

…and the curve keeps declining above that — full table in **§3a**.

**It is PER USER above 10 — not a flat site price.** A 40-user instance pays 40 × $6.70. The single most
quotable consequence: **a 100-user instance is up to $670/month — NOT "$67 flat."**

⚠ **Reading the band labels — two rules, and they are only consistent when stated together.**
1. **"Up to 10" is a flat-rate *override*, not an allowance.** A site whose **whole Confluence instance**
   has 10 users or fewer pays **$0**; that row replaces the bands entirely for that site. It is **not** ten
   free seats deducted from a larger site's bill.
2. **From the 11th user the bands take over — and the first band is labelled "1–100", counted from the
   FIRST user.** Once a site passes 10 users, **every** user on it is charged, starting at user 1. That is
   precisely why the band's maximum is **$670 = 100 × $6.70**.

⛔ **Never fuse the two into "11–100 users at $6.70"** — it contradicts the portal's own maximum
(90 × $6.70 = **$603**, not $670). **"From 11 users" is the THRESHOLD** at which paying starts (and the
right thing to say in copy); **"1–100" is the BAND LABEL** that then applies.

⛔ **The provisional "101+ = $5.70/user" figure is WRONG and retired.** It was recorded earlier on
2026-07-24 before the portal was seen; **$5.70 is the *multi-instance* price of the 251–1000 band**, misread
across columns. The real single-instance rate above 100 users is **$5.10** (101–250). Correct it wherever
it survives.

**Still open — do NOT treat these as settled:**

- ⚠ **The live public site is WRONG and is being corrected.** spec2jira.com/pricing currently advertises
  "**$67/month flat** for teams of 11+ — not per user". That contradicts the confirmed model.
  **Never quote $67**, and do not build copy on the "one flat price, no per-user math" line.
  ⭐ **The verified figures are safe to publish AS SOON AS this page is corrected** — until then, publishing
  them puts our copy and our own site at two different prices (13-claims-register.md A2.2).
- ⚠ **`src/usage.js` strings are stale.** The code still carries `$6.70/user/mo` with a
  "≤10 users = $57/mo flat" comment plus an `Advanced $13.40/user/mo` row. The **$6.70 figure survives**
  (it is the 1–100 band, which a site enters from its 11th user); the **$57-flat-≤10 framing is retired —
  ≤10 is FREE now.** Never quote $57.
- **Always-safe deflection** whenever precision matters: *"The Marketplace always shows the exact
  price for your team size before you subscribe."*

⛔ **Welcome credit — decided, not shipped.** The per-user $5 welcome credit described in §5 is the
founder's **decision of 2026-07-24, not current behaviour**. It is **not publishable** in any form until
the code ships and the founder confirms (13-claims-register.md, Table B).

---

## 1. The model in one line

**A subscription sold through the Atlassian Marketplace ("Paid via Atlassian") + the customer pays Anthropic directly for AI compute under their own API key (BYOK) — we never mark up tokens.**

## 2. Two bills, deliberately split (public-safe)

| Bill | Who charges | What it covers | Notes |
|---|---|---|---|
| App subscription | Atlassian (Marketplace, USD) | The whole product: breakdown generation, review editor, push to Jira, Project Context, AI test-case generation, sprint/capacity planning — **everything, one plan, unlimited breakdowns** (free ≤10 users; per-user above — §3) | Managed like any other Atlassian app (billing, cancellation, admin via Atlassian) |
| AI compute | Anthropic (customer's own account) | Claude API usage for generations, on the **customer's own key** | Site wording: "typically a few cents per breakdown. There is no vendor markup on AI." |

Why this matters for messaging:
- **No token markup** = aligned incentives; the subscription is pure app value, not resold compute.
- **BYOK** = the customer's content is processed under **their own Anthropic agreement** (privacy angle — see 09-trust-security-compliance.md).
- No Spec2Tickets-operated backend; the app runs on Atlassian Forge (see 01-product-overview.md).
- One plan, everything included — there is **no feature paywall** inside the product (as of the 2026-07-11 Standard-only pivot).

## 3. Pricing — the confirmed model (founder, 2026-07-24; tiers PORTAL-VERIFIED 2026-07-24)

### 3a. The tier table — ⭐ verified against the vendor portal "Set pricing" screen, 2026-07-24

**Single-instance pricing** (the normal case — one Confluence site). Every tier gets the same everything:
breakdown generation, review editor, push to Jira, Project Context, AI test-case generation,
sprint/capacity planning. **No feature gates, no usage cap.**

| User tier | Price per user / month | Max total for the band |
|---|---|---|
| **Up to 10 (flat)** | **FREE** — a flat-rate *override* that replaces the bands for that site, not an allowance | **$0** |
| **1–100** (the band a site enters the moment it passes 10 users) | **$6.70** | up to **$670** = 100 × $6.70 |
| **101–250** | **$5.10** | up to **$1,435** |
| **251–1000** | **$3.80** | up to **$4,285** |
| **1001–2500** | **$3.50** | up to **$9,535** |
| 2501–7500 | $3.25 | up to $25,785 |
| 7501–10000 | $2.85 | up to $32,910 |
| 10001–15000 | $2.65 | up to $46,160 |
| 15001–20000 | $2.40 | — |
| 20001–25000 | $2.20 | — |
| 25001–30000 | $2.00 | — |
| 30001–35000 | $1.60 | — |
| 35001–40000 | $1.45 | — |
| 40001–45000 | $1.35 | — |
| 45001+ | $1.15 | — |

**Multi-instance pricing** (a customer licensing several Confluence sites) = **1.5× the single-instance
rate**: $10.05 (1–100) · $7.65 (101–250) · $5.70 (251–1000) · and so on down the same curve.
⚠ **That $5.70 is the figure that was previously misread as "101+ single-instance"** — see §3c.

- **Per user above 10, not a flat site fee.** A 40-user instance pays 40 × $6.70/month; a **100-user
  instance is up to $670/month, not "$67 flat."**
- **The "Up to 10" row is a FREE flat-rate override**, not ten free seats: it replaces the bands entirely
  for a site of ≤10 users. Paying starts **from the 11th user** — that is the *threshold* — and from then
  the **"1–100" band label applies from the first user on the site**, which is why its maximum is
  **$670 = 100 × $6.70**. ⛔ Never fuse the two into "11–100 users at $6.70" (90 × $6.70 = $603 ≠ $670).
- ⚠ **Internal reading note (arithmetic, not a portal statement):** **above the first band** the "Max total"
  column reconciles as a **graduated** curve — each band's rate applies to the users *in that band*, and the
  totals run cumulatively ($670 + 150 × $5.10 = $1,435; $1,435 + 750 × $3.80 = $4,285; and so on). So
  **above the first band, never multiply a band rate by the full headcount** — a 250-user instance is
  ~$1,435, **not** 250 × $5.10. ⚠ **Inside the first band that multiplication is exactly right**: band 1 is
  counted from user 1, so a 100-user instance is 100 × $6.70 = **$670**. The two rules do not conflict —
  band 1 is charged across the whole headcount, every band above it is incremental.
  When a number must be exact, use the fallback sentence instead of doing the maths in public.
- Priced in **USD**, sold through the Atlassian Marketplace ("Paid via Atlassian" — Atlassian is USD-only for PvA).
- Paying instances get the Marketplace's standard **30-day free trial** before the subscription starts.
- **Every tier is BYOK**: AI compute is billed by Anthropic on the customer's own key, at cost, no markup.
- **One plan, everything included** at every tier — no feature paywall anywhere in the product.

### 3a-bis. How to state it in marketing (the shape — what a reader actually needs)

- **Teams of up to 10 users: FREE** — every feature, no time limit. A real free tier, not a trial.
- **From 11 users: priced PER USER, starting at $6.70/user/month, on a DECLINING CURVE** — the rate drops
  as the instance grows ($5.10 above 100 users, $3.80 above 250, and lower again at scale).
- **It is NOT a flat site price.** Paid via Atlassian licenses the **whole Confluence instance** — every
  user on the site counts, not only the people who use the app.
- **Atlassian shows the exact price for the customer's team size at checkout.**
- Customers licensing **multiple instances** pay a **1.5× multi-instance rate**.

### 3b. Why the shape is what it is (internal reasoning; public framing stays simple)

- **≤10 free is a land-grab tier, not a trial.** Full product, no clock, no gates — a small team can adopt
  Spec2Tickets permanently for $0 and pay only Anthropic for compute. It removes the single biggest
  objection for the BA/PO who cannot get budget approval to evaluate a tool.
- **The paid bands capture value where it exists.** A breakdown saves roughly 1–3 hours of BA/PO time
  (§8); at 11+ users the subscription is a rounding error against that.
- **The declining curve above 100 users is mandatory economics, not generosity** — see §4: Paid via
  Atlassian licenses the *whole instance*, so a single per-user rate would price out every large
  instance where only a handful of BAs actually use the app. The portal curve does exactly this —
  $6.70 → $5.10 → $3.80 → $3.50 and on down to $1.15 at the top.
- Public framing stays plain: *"Free for teams up to 10. Above that it's a per-user monthly price —
  the Marketplace shows the exact figure for your team size before you subscribe."*

### 3c. Retired framings — never publish these

| Retired figure / phrase | Why it is retired |
|---|---|
| **"$67/month flat for the whole site"**, "one flat price, no per-user math" | The 2026-07-16 site pivot. **Contradicts the confirmed model** (which is per-user above 10). Currently still on the live pricing page — that page is **wrong and is being corrected**. |
| **"$57/month flat up to 10 users"** and the "$6.70/user with a $57 ≤10 floor" pairing | ≤10 users is **FREE** now. The $6.70 figure survives only as the **1–100 per-user band**, which a site enters from its 11th user. |
| ⛔ **"$5.70 per user for 101+ users"** | **Never true as a single-instance rate.** A provisional figure recorded on 2026-07-24 *before* the portal was seen: **$5.70 is the *multi-instance* rate of the 251–1000 band**, misread across columns. The real single-instance rate above 100 users is **$5.10** (101–250), then $3.80 (251–1000). Portal-verified 2026-07-24; claims register B19. |
| **"Advanced $13.40/user"** | Advanced was retired as an offer on 2026-07-11 and folded into the single plan (§6). |
| Any **EUR** figure (€4.90 / €9.90 / €39 / €49 / €99 …) | Pre-launch planning, dropped 2026-06-03/04. No EUR price was ever publicly sold. |
| **"Free plan = 3 breakdowns/month"** | The in-app usage-capped Free tier was removed 2026-06-03. Do **not** conflate it with today's team-size-based free tier — different thing, different era. |

### 3d. Safe to publish

⚠ **One dependency gates the figures:** the tier table is portal-verified, but the **live pricing page still
publishes "$67/month flat"**. Until that page is corrected, publishing exact per-user figures makes our copy
contradict our own site. **The tier *shape* is publishable now; the exact figures become publishable the
moment the site fix lands** (13-claims-register.md A2.2/A2.2b).

- Sold via the Atlassian Marketplace, Paid via Atlassian, **priced in USD**.
- **Free for teams of up to 10 users — every feature, no time limit.**
- **Above 10 users it is a per-user monthly price on a declining curve** — **$6.70/user from 11 users**,
  **$5.10 above 100**, **$3.80 above 250**, and lower again at scale (portal-verified 2026-07-24).
- **Not a flat site price**, and a **1.5× rate** applies to customers licensing multiple instances.
- **One plan with everything included** — unlimited breakdowns, AI test-case generation, sprint planning.
- **BYOK: AI usage runs on the customer's own Anthropic key, billed by Anthropic at cost — no markup.**
- 30-day Marketplace free trial for teams the subscription applies to.
- Early-access framing with a grandfathering promise (§9).
- ⛔ **Not** the welcome credit — see §5; it is blocked until the code ships.

## 4. Whole-instance licensing — explain it honestly (public-safe)

- "Paid via Atlassian" licenses the **entire Confluence instance** — **every user on the site counts toward the price, not just the people who use Spec2Tickets.** This is Atlassian's standard model for cloud apps, not our choice.
- Honest framing: the price is determined by your Atlassian site's user count; the Marketplace shows the exact figure for your size before you subscribe.
- This is exactly why the **declining curve above 100 users** exists ($5.10 → $3.80 → $3.50 → … → $1.15): without it, a 500-user instance where 5 BAs use the app would be priced out. Never argue for "one flat per-user rate" — it breaks large instances.
- It is also why the **free tier is defined by instance size (≤10 users), not by app usage**: there is no way to bill only the people who open the app.
- Anticipate the objection in content: *"Why am I charged for users who never open the app?"* → because Atlassian licenses apps per instance; our answer is the declining curve above 100 users and a genuinely free tier below 11. (See 11-faq-objections.md.)

## 5. Onboarding: the $5 welcome credit ⛔ DECIDED, NOT SHIPPED — not publishable

### 5a. The model we are moving to (founder decision 2026-07-24; implementation pending)

- **Every user gets a one-time $5 welcome credit** of AI usage on **our managed Anthropic key** — on the
  **free 1–10 tier** as well as on paid tiers during their 30-day Atlassian trial.
- It is **per USER, not per site**: in a team of up to 10, each person has their own $5, so when one
  person's credit runs out the team can keep evaluating through a colleague who still has theirs.
- When a user's credit is spent they **continue with BYOK** — their own Anthropic API key, paying
  Anthropic directly, **no markup from us**. Paid customers are BYOK after the credit.
- The honest promise this buys: **"start generating immediately, no API key needed; bring your own key
  when the welcome credit runs out."** That removes the app's single largest onboarding friction — the
  BYOK wall before first value.

### 5b. ⛔ Status — critical, do not present as shipped

- The per-USER credit is the founder's **decision as of 2026-07-24**, **not the current code**.
- **What the shipped code actually does:** grants **$5 per INSTALL** (a single per-install ledger,
  `src/trialCredit.js`), and **only to a 30-day-trial license** — a **free-tier install gets nothing**.
- The implementation is **pending**. In this KB the model is described as *"the model we are moving to
  (decided 2026-07-24, implementation pending)"* — **never as a live capability**.
- **Every public claim about the welcome credit is BLOCKED** until the code ships **and** the founder
  confirms: see 13-claims-register.md **Table B** (the credit, the "$5" figure, and
  "start without an API key" are all forbidden in new public copy for now).
- A separate dependency stands regardless: the credit only works while the **production managed
  Anthropic key is funded and set**. If it is unset, users get a graceful "managed unavailable" state —
  i.e. the promise silently stops being true. See INTERNAL CONTEXT + 14-gaps-for-partner.md A2.
- What **is** safe to say about evaluation today: teams of **up to 10 users are free with every feature
  and no time limit**, and larger teams get the standard **30-day Marketplace trial**. Nothing about
  starting without an API key.
- Everything beyond this framing (ledger mechanics, ceilings, enforcement) is **internal** — see INTERNAL CONTEXT.

## 6. Managed / "Advanced" — NOT purchasable. Never present as live.

Two distinct things marketing must not blur:

| Thing | What it was/is | Status (2026-07-24) |
|---|---|---|
| **Advanced edition** (BYOK, $13.40/user/mo, test-cases as the headline) | Second Marketplace edition, submitted 2026-06-17, pending review | **Retired as an offer 2026-07-11** — folded into Standard. Site FAQ: "It has been folded into BYOK Pro… now part of the standard product… at no extra cost." Existing/pending Advanced subscribers keep full access (internal alias in code). |
| **Managed Pro** (~$13/user/mo, we supply the Anthropic key, fair-use cap) | Planned "no key required" edition (editions Phase 2, post-publish) | **Dormant. Not purchasable. Not currently advertised** — the "coming soon" card was hidden from the site on 2026-07-16. Our managed key is used **only** to fund the welcome credit (§5) — and that is per-install + trial-gated in the shipped code today, with per-user still pending. |

Rules for content: never describe Managed as available; do not advertise "coming soon" unless the site does (it currently does not); never imply test-case generation or planning cost extra — they are included in the single plan. Also do not blur the **welcome credit** (a small onboarding grant on our key, §5, currently unpublishable) with a **Managed edition** (a paid no-key plan that does not exist).

## 7. What AI compute costs the customer (BYOK, at cost — public-safe)

- Site wording: "typically a few cents per breakdown."
- Validated example: **~$0.045 for a 10-feature breakdown** (live acceptance run, 2026-06-18, batch-priced).
- Generation uses Anthropic's **Message Batches API — roughly 50% cheaper than synchronous calls**; the discount is passed through automatically because the customer pays Anthropic directly.
- **Test-case generation shows a pre-flight cost estimate ("up to ~$X, typically ~$Y") before running and the actual cost after** — the cost-transparency behavior is a product feature and safe to describe.
- Never promise a fixed AI cost — it scales with spec size. "A few cents per breakdown, on your own key, at cost" is the safe formula.

## 8. Value math (public-safe, keep it qualitative)

- A spec-to-backlog pass saves roughly **1–3 hours of BA/PO time per breakdown** (internal estimate — phrase as "hours of manual ticket-writing", not audited research).
- The pitch: the subscription pays for itself in the first breakdown or two each month; AI compute is cents against hours saved.
- [GAP: no externally validated time-savings study or customer-sourced number exists — the ~1–3h figure is the founder's internal estimate. Who decides: founder; a real customer case study would replace it. See 13-claims-register.md.]

## 9. Early access & grandfathering (public promise)

- Public wording (live site): **"Early-access pricing — we grandfather early adopters as the product grows."** (This sentence stands; only the **price figures** on that page are wrong and being corrected — §3c.)
- Meaning for content: current pricing is explicitly early-access; it may evolve; early adopters keep their terms. Frame any future change as "early adopters earned a perk," never "prices went up."
- The promise is backed technically (install first-seen date captured from day one — mechanics internal, see below).

## 10. Pricing history (context only — do NOT market these figures)

**All EUR figures ever seen in internal notes (€3.90, €4.90, €6.90, €9.90, €20, €29, €39, €49, €69, €99) are retired pre-launch planning, dropped 2026-06-03/04. No EUR price was ever publicly sold — the app has only ever been listed in USD.**

| Date | Change |
|---|---|
| 2026-05-30 | Initial internal model: Free 3 breakdowns/mo + Pro €20/mo flat (never launched) |
| 2026-06-01–03 | Per-user pivot forced by "Paid via Atlassian" (no flat fees allowed); EUR figures iterated €3.90→€4.90 (BYOK) / €6.90→€9.90 (Managed); **in-app Free tier removed 2026-06-03** → trial→paid |
| 2026-06-04 | **USD set at the portal:** Standard $6.70/user ($57 ≤10 flat, declining curve kept); EUR retired |
| 2026-06-17 | App publicly live on the Marketplace at $6.70; second "Advanced" edition ($13.40/user) submitted, pending |
| 2026-07-11/12 | **Standard-only pivot** (v6.6.0): Advanced retired as an offer, everything folded into Standard; **$5 managed credit** introduced in code — **per install, trial-licenses only** |
| 2026-07-16 | **Site pricing pivot:** free up to 10 users / $67-month flat for 11+; Advanced FAQ'd as "folded into BYOK Pro". ⚠ The **$67 flat half is now superseded and wrong** — the site is being corrected |
| 2026-07-24 (early) | Founder confirms the model: free 1–10 users · $6.70/user from 11 · **"$5.70/user 101+"** — a **provisional figure, later found WRONG** (see the next row). Plus the **per-USER $5 welcome credit** on free *and* trial tiers, BYOK after it is spent — **decided, implementation pending** |
| **2026-07-24** | ⭐⭐ **VENDOR PORTAL VERIFIED (current authority):** the partner-portal "Set pricing" screen gives the real curve — free ≤10 · **$6.70** (1–100, the band a site enters from its 11th user) · **$5.10** (101–250) · **$3.80** (251–1000) · $3.50 (1001–2500) · … · $1.15 (45001+), plus a **1.5× multi-instance** rate. **The provisional "$5.70 for 101+" is retired** — it was the multi-instance price of the 251–1000 band, misread across columns |

---

## INTERNAL CONTEXT — never publish

### Reconciliation to-do (highest priority for this chapter)
The **model is settled** (founder, 2026-07-24) and the **tier table is portal-verified** (2026-07-24). What remains is making the surfaces match it — three items, all founder- or engineering-owned (14-gaps-for-partner.md A1):
1. ✅ **RESOLVED 2026-07-24 — the vendor portal tier table is verified** from the partner-portal "Set pricing" screen (§3a). It also settled the two sub-questions this file used to carry: the **old declining-curve detail SURVIVES** (101–250 = $5.10, 251–1000 = $3.80 — the 2026-06-04 portal config was right), the **1.5× multi-instance multiplier SURVIVES**, and there is **no single "$5.70 band above 100"** — that figure was the multi-instance rate of the 251–1000 band, misread across columns.
2. **Correct the live site pricing page** — it still sells "$67/month flat, not per user", which contradicts the model. **Now the only thing standing between the verified figures and publication.**
3. **Fix the stale `src/usage.js` price strings** — `$6.70/user/mo` with a "≤10 = $57/mo flat" comment renders in the in-app Account panel, so a customer can read a tier structure we no longer sell. That is a product-trust bug, not a marketing one.
4. **Implement + ship the per-user welcome credit** (§5b) — today's code is per-install and trial-only.
- Until (2) lands, campaigns quote the tier *shape* ("free up to 10, per-user above, declining with size") and defer exact figures to the Marketplace listing.

### Why per-user at all
- Atlassian "Paid via Atlassian" **forces per-user pricing** for cloud apps — a flat fee isn't offered as a billing primitive; "flat" tiers can only be emulated as per-user × seats (this is why the retired ≤10 tier read as "$57 = 10 × $6.70", and why a genuinely flat "$67 for the whole site" was never a native billing shape).
- PvA bills the WHOLE Confluence instance (all users, not app users) → the declining curve above 100 users is mandatory economics, not generosity: a flat per-user rate would price out every 100+ instance where only a handful of BAs use the app. Historical internal rule: never flatten the curve.

### Why value-based pricing (history of the number)
- The original €20-flat idea **under-captured**: a breakdown saves ~1–3h of BA/PO time (internally valued ~€50–200 per breakdown in 2026-06 planning) → €20 captured ~2–10% of delivered value and **under-signalled** (B2B buyers eliminate the cheapest option first).
- $6.70 was chosen 2026-06-04 as the "100% of Confluence price" preset — premium signal, higher capture, and "easier to lower/grandfather than to raise." **It survives in the confirmed model as the 1–100 band** (entered from the 11th user).
- The free-≤10 tier (2026-07-16, retained in the confirmed model) trades small-team revenue for land-grab adoption: full product for ≤10 users, conversion pressure moves to 11+ instances. What the 2026-07-24 confirmation changed is the *shape above 10* — back to **per-user on the declining portal curve** ($6.70 → $5.10 → $3.80 → …) instead of the flat $67, because PvA never billed a flat site fee natively and a flat fee collapses the value capture on large instances.

### Competitor price anchors (as of 2026-06 research — recheck before citing; see 05-competitive.md)
- POPal: free ≤10 users, then ~$6/user/YEAR (annual — an order cheaper than us; don't invite direct price comparison).
- Storygenie: free ≤10, then ~$4.50/user/YEAR.
- StoryLoop: ~€42/mo for ≤10 users, no free tier.
- ChatPRD (non-Atlassian anchor): ~$15/user/mo — the reference that per-seat AI-PM tooling bears >$10.
- Positioning consequence: we are deliberately premium vs budget Jira-native rivals; sell altitude (whole-spec → backlog) and privacy (BYOK), never price-match annual-priced rivals.

### Future Managed edition — fair-use design (dormant; editions Phase 2)
- Managed Pro (we supply the key): planned ~$13/user/mo, i.e. ~2× Standard. `price: null` in code until purchasable so no dead "Subscribe" CTA can render.
- Cap design: metered **per user** (25 breakdowns/user/month; raised from 10 on 2026-06-16) because the Forge license object exposes NO seat count at runtime — per-user is the loss-bounded shape. Breakdown-only worst case 25 × $0.24 ≈ $6.00 against $13/seat ⇒ ~54% margin floor, ~90% typical.
- Known trap: test-case generation is ~8.6× breakdown cost — folding it into a count cap breaks the margin. Direction decided 2026-06-07: cap Managed by a monthly **compute budget** (~$6.50/user/mo target for ~50% gross margin), not a request count. Implement at Phase 2; not built.
- Compliance re-activates if Managed returns: we become a data processor (DPA, ~29-day Anthropic batch retention, sub-processor disclosure). Lawyer-approved copy exists on the site repo, currently hidden. Source of truth = site repo only (see 09-trust-security-compliance.md).

### Welcome credit — shipped mechanics vs the decided target
**Shipped today (v7.1.0 code, `src/trialCredit.js`):**
- Per-**INSTALL**, lifetime, real dollars, **trial-license only** ($5 grant; hard ceiling ~$6 = 1.2× grant). A free-tier (non-trial) install draws **nothing**.
- A pre-flight blocker refuses any managed run whose estimate exceeds the remaining credit, so $5 is a real cap, not "grant + one overrun."
- Worst-case vendor exposure ≈ **$5–6 per install** regardless of seat count. Reinstall-to-farm is accepted as low-frequency, bounded abuse.
- Paid subscribers never draw managed credit (margin-leak guard); any glitch fails toward BYOK / no free spend.

**Decided target (founder 2026-07-24, not built):** per-**USER** $5, granted on the **free ≤10 tier as well as** on paid tiers during the 30-day trial; BYOK after it is spent.
- ⚠ **This inverts the exposure bound the shipped design was chosen for.** Per-install $5 was deliberate ("per-user is a margin bomb" — the 2026-07-11 design note). Per-user on a *free* tier means up to **10 × $5 = $50 of managed spend on an instance that pays us $0**, and on a paid instance the grant scales with seats. The founder has made the call; the **cost guardrail is the open engineering question** (per-user ceiling, per-install aggregate cap, or both) — see 14-gaps-for-partner.md A2.
- Ops dependency (unchanged): the credit only works while the production managed Anthropic key is funded and set. If unset, users get a graceful "managed unavailable" state — i.e. **the promise silently stops being true**. [GAP: whether the production managed key is funded/set as of 2026-07-24 — a pending partner op in the 2026-07-12 handover, while the Marketplace listing already mentions trial credit. Owner: founder. Confirm before any campaign leans on "start without an API key" — which is separately blocked until the per-user code ships.]
- Enforcement of the credit cap is always-on and independent of the app's internal metering modes (those env-level details stay out of marketing entirely).

### Measured AI costs (internal calibration — public copy stays "a few cents")
- Breakdown on Sonnet (batch): measured avg **$0.118**, range $0.05–0.24 (Anthropic dashboard, 8 pages, 2026-06-07).
- Test-case generation: avg **~$1.01 per breakdown-worth**, range $0.22–3.67 (outlier: a 530-case spec) — ~8.6× a breakdown. The in-app "typically ~$Y" estimate ran ~3× low on a dense domain; ceiling estimate held ($1.27 actual vs $2.45 ceiling, live acceptance 2026-06-18). Calibration ongoing.
- The public "$0.045 / 10-feature breakdown" is a real validated single run (2026-06-18) — keep it as an example ("a validated run cost about four cents"), never as a guarantee.

### Grandfathering mechanism (promise is public; mechanism is not)
- Automatic: the app records `firstSeenAt` per install from day one; at any future migration, installs predating the cutoff resolve to grandfathered terms. No manual vendor list; vendor-side visibility comes from the Marketplace partner portal. The cutoff date deliberately does not exist yet (decided at migration time).

### Revenue share (internal)
- Atlassian/Forge fee: 0% up to $1M lifetime Marketplace revenue (we keep 100%), then ~16–17%.

---

## GAP summary (also returned structurally)

The **model itself is no longer a gap** (founder-confirmed 2026-07-24) and the **tier table is no longer a gap** (portal-verified 2026-07-24). What is still open:

1. ✅ **RESOLVED 2026-07-24** — *was:* the vendor portal tier table + the true upper boundary of the $6.70 band. **Verified from the partner-portal "Set pricing" screen** (§3a): free ≤10 · $6.70 (1–100, entered from the 11th user) · $5.10 (101–250) · $3.80 (251–1000) · declining to $1.15 · 1.5× multi-instance.
2. ✅ **RESOLVED 2026-07-24** — *was:* whether the older declining-curve detail and the 1.5× multiplier survive. **They do**, exactly as configured 2026-06-04; the provisional "$5.70 above 100" was the misread multi-instance rate and is retired.
3. [GAP: the **per-user welcome credit is decided but not implemented** — shipped code is per-install and trial-only. Needs implementation + a cost guardrail, then founder confirmation, before any public claim. Owner: founder + engineering.]
4. [GAP: whether the production managed Anthropic key is funded/set — the prerequisite for the welcome credit working at all. Owner: founder.]
5. [GAP: no externally validated time-savings number — ~1–3h/breakdown is an internal estimate. Owner: founder; replace with a customer case study.]

⚠ **Correction pending on the surfaces, not on this chapter:** the live site pricing page ($67 flat) and `src/usage.js` ($6.70 + "$57 ≤10 flat") both contradict the portal-verified model and are being fixed. This file is the authority in the meantime — and the **site fix is now the single gate on publishing the exact figures**.

**See also:** 01-product-overview.md (what the product is) · 05-competitive.md (rival pricing detail) · 09-trust-security-compliance.md (BYOK privacy + DPA) · 11-faq-objections.md (price objections) · 13-claims-register.md (approved claim wording).
