---
title: Gaps for the founder — what only you can answer
purpose: Everything the KB could not resolve from sources, ranked by what it blocks.
visibility: internal
sources:
  - ⭐ Founder confirmation of the pricing + onboarding model, 2026-07-24 (resolves the former pricing conflict)
  - ⭐⭐ The Atlassian partner-portal "Set pricing" screen, founder screenshot, 2026-07-24 - PORTAL-VERIFIED tier table (resolves A1 item 1)
  - Aggregated [GAP] / [PARTNER DECISION] markers across all 14 KB files
  - Conductor verification against src/usage.js, src/trialCredit.js, package.json / src/diagnostics.js (version), the git history of v7.0.0 / v7.1.0 (resolves A4), and the live site pricing page
last_verified: 2026-07-24
---

# Gaps for the founder

Aggregated from every `[GAP: …]` marker the KB writers left. Ranked: **blockers** stop public
content today; **Step-2 enablers** are needed before the blog + social engine starts; the rest is
governance that can run in parallel.

---

## A. BLOCKERS — resolve before any public content

### A1. ✅ Pricing model DECIDED + ⭐ TIERS PORTAL-VERIFIED (both 2026-07-24) — three surfaces still to match

**Settled by you on 2026-07-24**, and the **tier table verified the same day against the partner-portal
"Set pricing" screen**. Now the KB's authority (02 + 13 rewritten to it).

**Single-instance pricing:**

| User tier | Price per user / month | Max total for the band |
|---|---|---|
| **Up to 10 (flat)** | **FREE** — every feature, no time limit. A real free tier, not a trial. | **$0** |
| **1–100** — a site enters this band at its **11th** user, but the rate is charged from the **first** | **$6.70** | up to **$670** (= 100 × $6.70) |
| **101–250** | **$5.10** | up to **$1,435** |
| **251–1000** | **$3.80** | up to **$4,285** |
| **1001–2500** | **$3.50** | up to **$9,535** |

…declining to $1.15 at 45001+ (full table in 02 §3a). **Multi-instance = 1.5× the single-instance rate.**

**Per user above 10 — not a flat site price.** Paid via Atlassian licenses the whole Confluence
instance, so every user on the site counts. **A 100-user instance is up to $670/month, not "$67 flat."**

⛔ **One correction propagated everywhere:** the provisional **"101+ = $5.70/user"** figure recorded
earlier on 2026-07-24 was **WRONG** — $5.70 is the *multi-instance* price of the 251–1000 band, misread
across columns. The real single-instance rate above 100 users is **$5.10**. It is now a
never-publish entry in the claims register (13, row B19).

**What remains — three items, none of them a marketing decision:**

1. ✅ **RESOLVED 2026-07-24 — the vendor portal tier table is verified.** *Was:* "verify the portal
   table, including the real upper boundary of the $6.70 band." Your screenshot settled it: the bands
   above are the real ones, the **$6.70 band runs to 100 users**, the older declining-curve detail
   ($5.10 / $3.80) and the **1.5× multi-instance multiplier both survive**, and there is no single
   "$5.70 band above 100". Nothing further is needed from you here.
2. **Correct the live site pricing page.** spec2jira.com/pricing still sells "**$67/month flat**
   for teams of 11+ — not per user", which contradicts your model. Any prospect who reads our copy
   and then the site sees two different prices. **Now the single highest-urgency item — and the only
   thing standing between the verified figures and publishable copy.**
3. **Fix the stale `src/usage.js` price strings** — `$6.70/user/mo` with a "≤10 users = $57/mo flat"
   comment (plus an Advanced `$13.40/user/mo` row) renders in the in-app Account panel, so a paying
   customer can read a tier structure we no longer sell. A product-trust bug, not a marketing one.
4. **Implement + ship the per-user welcome credit** — see A2.

**Blocks:** exact price figures in blog posts, social posts, FAQ answers and comparison tables —
**but only until item 2 lands.** The figures themselves are now verified and pre-approved (13, rows
A2.2 / A2.2b / A2.2e); correcting the site clears them with no further sign-off. The tier *shape*
(free ≤10, per-user above, declining with size) is publishable today.
✅ **KB hygiene: done.** All 14 chapters were swept to the confirmed model in the same pass
(conductor-verified 2026-07-24): every surviving mention of "$67 flat", "$57 ≤10" or the per-install
credit is now explicitly labelled *retired / never publish / being corrected*, not asserted.

### A2. Implement the per-user welcome credit — and decide its cost guardrail
You decided on 2026-07-24 that **every user gets a one-time $5 welcome credit** on our managed key —
on the **free ≤10 tier as well as** on paid tiers during the 30-day trial — and continues with BYOK
once it is spent. **That is not what the code does today:** `src/trialCredit.js` grants **$5 per
install**, and only to a **30-day-trial licence** — so a free-tier install gets **nothing**, i.e. the
promise is currently false for exactly the audience it is aimed at.

**You must decide, before it is built:**
- **The cost guardrail.** Per-install was chosen deliberately to bound exposure at ~$5–6 per install
  regardless of seats. Per-user on a *free* tier means up to **10 × $5 = $50 of managed AI spend on
  an instance that pays us $0**, and on paid instances the grant scales with seat count. Options to
  weigh: a per-user ceiling, an aggregate per-install cap on top of it, restricting the free-tier
  grant, or accepting the exposure as a customer-acquisition cost with a monitored ceiling.
- **Funding + configuration.** The credit only works while the **production managed Anthropic key is
  funded and set** (`MANAGED_ANTHROPIC_KEY`); the 2026-07-12 handover still lists it as a pending
  founder task. Unset ⇒ users get a graceful "managed unavailable" and the promise silently fails.
- **The go-live confirmation.** Marketing unblocks the claim only when the code ships **and** you
  confirm — that gate is written into `13-claims-register.md` row B16.

**Blocks:** "start generating without an API key", any "$5 credit" claim, and the whole
frictionless-onboarding campaign angle — currently our strongest onboarding message and entirely
unusable until this ships.

### A3. ✅ RESOLVED — production version
**Production is v7.1.0 as of 2026-07-24** (repo `package.json` and `DIAG_APP_VERSION` are both
`7.1.0`, in lockstep as the CI drift-guard requires). No longer a blocker.

### A4. ✅ RESOLVED 2026-07-24 — the missing v7.0 / v7.1 handover does not hide any product change
*Was:* the KB's feature inventory came from `CLAUDE.md`, whose newest handover covers **v6.6.0
(2026-07-12)**; two releases shipped after it with no handover note, so the KB might have been
describing an older product than the one people install.

**Answered from the git history (conductor-verified 2026-07-24) — no founder input needed:**

- **v7.0.0 (`8e9c270`) and v7.1.0 (`88c35dc`) changed ONLY the two version strings** in
  `package.json` + `src/diagnostics.js` (Forge auto-assigns the Marketplace version; the repo strings
  were corrected to match it — the number bounced 6.5.0 → 7.0.0 → 6.6.0 → 7.1.0 across three
  version-only commits).
- The **only** functional change since the v6.6.0 release commit is one **internal safety fix**
  (`bd537a2`): the trial-credit hard ceiling tightened from ~$10 to ~$6 (1.2× the $5 grant). Not
  customer-visible, and blocked from public copy anyway by B16.
- **`manifest.yml` is byte-identical** to the v6.6.0 release commit ⇒ **no new scopes ⇒ no customer
  re-consent event**.
- Everything else in the range is merge commits, a `CLAUDE.md` handover doc, and a dev-only eslint bump.

⇒ **v7.1.0 is functionally v6.6.0. The KB feature inventory is NOT stale**, and `01` / `06` / `07`
stand as written. There is no "what's new" story in v7.0/v7.1 to tell.
⚠ Residual (tracked under B4, not here): screenshots still need refreshing against the **July
redesign** that shipped *in* v6.6.0 — a UI-currency question, not a missing-feature one.

---

## B. STEP-2 ENABLERS — needed to start the blog + social engine

| # | Decision | Why it blocks |
|---|---|---|
| B1 | **Social platforms + handles.** Candidates: LinkedIn (the BA/PO/PM buyer), X (Atlassian/dev ecosystem), Atlassian Community forums (category-native, highest intent). | No channel = no 2–3×/week cadence. Pick 1–2, not all. |
| B2 | **Blog placement on the site:** nav link vs footer-only. The nav is a byte-identical component across all 10 pages, so this is one decision applied everywhere. | Blocks the blog architecture PR. |
| B3 | **Site analytics** — none is installed. Needs a privacy-friendly choice consistent with the privacy-first brand. | Without it, blog/SEO impact is only indirectly measurable via Marketplace installs. |
| B4 | **Screenshots of the live v7.1 UI** (the 8 screens). Existing listing images are likely stale vs the July redesign. (A4 is now resolved: v7.0/v7.1 changed no UI — the redesign shipped *in* v6.6.0, so the screenshots are one release behind at most.) | Blocks visual social posts, blog illustrations, and a listing refresh. |
| B5 | **`og-image.png`** — the 1200×630 export was still pending; `og-image.svg` exists. | Every shared link renders without a social card. |
| B6 | **Logo package** — none exists beyond `favicon.svg` + a CSS wordmark. Commission one, or bless the current set as official? | Blocks templates and any co-branded asset. |
| B7 | **Demo asset** — no recorded video exists. The demo script in `06` is ready to record. | The single highest-converting asset for this category. |
| B8 | **Keyword research** — the SEO seeds in `12` have no volume/difficulty validation and no tool chosen. | Blocks committing to per-keyword pillar pages. |

---

## C. PROOF — we have no external evidence yet

| # | Gap | Note |
|---|---|---|
| C1 | **No customer case studies, testimonials or referenceable customers.** All proof is internal validation on our own dev instance. | Decide how and when to collect: an early-adopter interview offer is the usual first move. |
| C2 | **No measured time-savings study** behind the site's "~70% less hand-work". | It is positioning, not measurement. Either commission a small study or keep it clearly qualitative. |
| C3 | **Current install / review counts unknown** for our listing (and the rivals'). | Pull live on publication day; never cite a remembered number. |
| C4 | **Marketplace listing images/copy likely stale** vs the July redesign. | A listing refresh is arguably higher ROI than the first three blog posts. |

---

## D. GOVERNANCE — decide once, applies to everything

| # | Decision |
|---|---|
| D1 | **Build-in-public / AI-assisted engineering story** — how much of "this product was built with Claude as the engineering partner" is public? It is a genuinely strong differentiator *and* a possible objection. Your call, with boundaries. |
| D2 | **May we publicly promise the Managed (no-key) edition?** Today the honest line is "coming soon"; anything firmer is a commitment. |
| D3 | **Who signs off comparative claims** about POPal / Storygenie / StoryLoop, and **who re-runs the rival research** (quarterly suggested)? Their 2026-06-01 data ages fast. |
| D4 | **Atlassian Marketplace partner branding rules** — a skim before producing new public assets bearing Atlassian/Jira/Confluence names. |
| D5 | **The Marketplace "Privacy & Security" tab answers** cannot be read from any repo. Export/confirm the live answers before quoting our security posture publicly. |
| D6 | **Is the live site actually in sync with the site repo?** It auto-deploys on push; push status is not verifiable offline. Confirm before attributing any wording to "as published at spec2jira.com/…". |
| D7 | **The "Octane" reference** in UC4 is a real evaluator's incumbent tool. Publishable, or replace with "a separate test-management system"? |
| D8 | **Campaign success targets** — numbers and timeframe (installs, trials, reviews, site sessions). Without them the engine has no steering signal. |
| D9 | **A partial-push retention sentence does not exist on the site** (a partial push retains derived data ≤7 days). Legal wording is needed before any content describes it. |

---

## How to use this file

Work top-down. **A1 item 2 and A2 are the remaining true blockers** — A3 is resolved (production is
v7.1.0), A4 is resolved (v7.0/v7.1 changed nothing customer-visible), and A1 item 1 is resolved (the
portal tier table is verified). Everything else can proceed with `[GAP]` placeholders. When you answer
one, the KB file that owns it gets updated the same day (`TASK-MAP.md` §5), and
`13-claims-register.md` gains or loses a row.

The two with a deadline attached: **A1 item 2** (the live site still advertises a price we do not
charge — and it is now the *only* thing gating a set of verified, pre-approved price figures) and
**A2** (the onboarding promise we cannot make until the code matches the decision).
