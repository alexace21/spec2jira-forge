---
title: "Roadmap, Vision & Origin Story"
purpose: "The canonical origin/pivot story, verified release history, safe near-roadmap language, and the reusable long-term vision for Spec2Tickets marketing content."
visibility: mixed
sources:
  - "Founder pricing + onboarding decision, 2026-07-24, tier table VERIFIED against the Atlassian vendor-portal 'Set pricing' screen (founder screenshot, 2026-07-24); band mechanic corrected 2026-07-25 per 13-claims-register.md — SUPERSEDES every pricing statement in the sources below (free up to 10 users, a flat-rate override · paying starts from the 11th user, and the first band is labelled 1-100 at $6.70/user charged from the first user, so a 100-user site is $670 · then graduated: $5.10 101-250 · $3.80 251-1000 · lower again at scale · 1.5x multi-instance · per-user $5 welcome credit decided but not shipped)"
  - "C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/CLAUDE.md (handover notes: 2026-05-30 through 2026-07-12; ⚠ none exists for v7.0/v7.1)"
  - "C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/about/index.html (live site About page)"
  - "C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/product-improvements.md"
  - "C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/marketplace-launch-state.md"
  - "C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/monetization-strategy.md"
  - "C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/MEMORY.md (project memory index)"
  - "C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/pricing/index.html (live pricing page, v7 flat-freemium revision 2026-07-16)"
  - "C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/src/usage.js (in-app tier/price strings)"
  - "C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/package.json + src/diagnostics.js (repo version strings; corrected 6.6.0 -> 7.1.0 in commit 88c35dc, 2026-07-12)"
  - "docs/marketing-kb/02-business-model-pricing.md (pricing conflict box + section 6 Managed/Advanced rules)"
  - "docs/marketing-kb/09-trust-security-compliance.md + 13-claims-register.md (publishability of the rejection story; banned-claims rows B4/B8)"
  - "docs/marketing-kb/11-faq-objections.md + 12-marketing-strategy-channels.md (live-listing fetch 2026-07-24: version 7.1.0)"
last_verified: 2026-07-24
---

# 10 — Roadmap, Vision & Origin Story

How to use this file: everything above the "INTERNAL CONTEXT" section is safe raw material for blog posts and social content — **except where a section carries its own conflict/decision flag (see §1, which is currently blocked pending a founder ruling)**. Release dates are verified from internal engineering handovers. Pricing details live in `02-business-model-pricing.md`; messaging pillars in `04-positioning-messaging.md`; security/compliance wording in `09-trust-security-compliance.md` (quote the live site, never re-draft).

Naming rule (intentional, do not "fix"): the **product** is **Spec2Tickets** ("Spec2Tickets for Confluence & Jira" on the Atlassian Marketplace); the **vendor brand and domain** are **Spec2JIRA / spec2jira.com**. The site's own About page states: "The app is published on the Atlassian Marketplace as Spec2Tickets. Spec2JIRA is the vendor name and this site's domain. They refer to the same product."

---

## 1. The origin story (⚠ publication BLOCKED — see the flag)

> ⚠⚠ **CONFLICT — do not publish this section until the founder rules on it.** Two other chapters classify the 2026-05-27 rejection as internal-only: `09-trust-security-compliance.md` (INTERNAL) says "Public framing is only the positive result ('Forge-native, no remote host, no content in logs') — **never the rejection story**," and `13-claims-register.md` Table C4 lists "2026-05-27 Marketplace security-bot FIT rejection" under internal-only facts with zero tolerance in public copy. The telling below is written as reusable public copy and contradicts both. **Until the founder decides, use only the positive-result framing** (tell the architecture — Forge-native, no vendor backend, BYOK — not the rejection that caused it); treat everything in §1 as internal raw material. If the founder approves the rejection narrative, 09 and 13 must be updated and 13 needs a Table A row with the approved wording, so writers have one sanctioned version. [PARTNER DECISION: may the founder-approved rejection narrative be told publicly?]

### 1.1 Canonical short telling — reusable as-is *(pending the ruling above)*

> Spec2Tickets didn't start on Atlassian Forge. The first version was a self-hosted AI pipeline — an open-source model running on the founder's own GPU backend, with the Atlassian app calling out to that server. When the app went through Atlassian's Marketplace security review in May 2026, it was rejected: the remote backend did not validate the Forge Invocation Token, the mechanism that proves a request really comes from Atlassian — an impersonation risk inherent to any remote-backend design. Instead of patching token validation onto the server, the founder made a harder call: delete the backend entirely. The app was re-architected in days to run natively on Atlassian Forge, with Anthropic's Claude doing the AI work on the customer's own API key (BYOK). There is no vendor server anymore — nothing to receive a token, nothing to validate, nothing to breach. The security review that rejected the first architecture is the reason the current one exists: privacy by architecture, not by promise. The rebuilt app passed review and launched publicly on the Atlassian Marketplace on June 17, 2026.

### 1.2 The verified facts behind the story

| Fact | Detail | Public-safe? |
|---|---|---|
| Original architecture | v2.x: self-hosted LLM pipeline (Qwen-14B on the founder's own GPU backend, `api.spec2jira.com`), Atlassian app calling the remote host | Yes |
| Rejection | 2026-05-27, Atlassian Marketplace security review (automated security scan): "remote host does not validate the Forge Invocation Token (FIT)" — an impersonation risk inherent to remote-backend architectures | ⚠ **Conflict — 09 §INTERNAL + 13 C4 classify this as internal-only; blocked pending the founder ruling above** |
| The pivot decision | Re-architect rather than patch: v3 = pure Atlassian Forge (runs inside Atlassian's cloud) + BYOK (Anthropic Claude on the customer's own API key). No Spec2Tickets-operated backend at all; the only external call is to `api.anthropic.com` | Yes |
| Speed of rebuild | Rejection 2026-05-27 → rebuilt app working end-to-end (Generate → Review → Push) by 2026-05-30 → resubmitted 2026-06-01 | Yes **as a cadence fact only** ("re-architected in days") — do not name the rejection as the trigger unless the ruling above approves it |
| The review outcome | On resubmission, the security concern was resolved architecturally — there is no remote host, so the FIT risk cannot exist. The security check passed (2026-06-02) | Yes |
| The moat | The forced re-architecture became the product's core privacy claim, in the site's own words: "Privacy by architecture, not by promise… We can't see your data because we never receive it." | Yes (quote the site) |
| Public launch | 2026-06-17: live + publicly discoverable at https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira | Yes |

### 1.3 How to tell it (guardrails)

- **Non-defensive toward Atlassian — always.** The frame is "their review made the product better," never "we got unfairly rejected." Atlassian's security bar is presented as a feature of the ecosystem the customer benefits from.
- Lead with the counterintuitive decision (deleting your own backend), not the rejection.
- The privacy consequence is the payoff: no vendor server → customer content flows only between Atlassian and the customer's own Anthropic account. Use the live site's exact phrasing for the claim (see `09-trust-security-compliance.md`).
- Between resubmission (2026-06-01) and public launch (2026-06-17) there were additional review rounds about Marketplace listing configuration (billing/edition setup, not security). Publicly, compress this to "after the re-architecture and Marketplace review cycles." Do not narrate the listing-config back-and-forth or name any Atlassian reviewer.
- Do not invent drama (no "we almost gave up" unless the founder actually says so).

---

## 2. Founder & company facts (public-safe)

| Fact | Value | Source |
|---|---|---|
| Founder / vendor | Aleks Asenov, sole trader ("independent software vendor"), Sofia, Bulgaria | Live site (About + legal pages) |
| Company voice | "We're small, we ship deliberately, and we'd genuinely like to hear how the product works for you." | Live About page |
| Company focus | "Practical AI tooling for software delivery teams" | Live About page |
| Support posture | support@spec2jira.com; 7 days a week, 11:00–23:00 Europe/Sofia; target response within 24 hours | Live About page |
| Footer identity | "Made in Sofia, Bulgaria 🇧🇬" | Live site footer |

**NEVER publish** (appears in internal notes, excluded from this KB by policy): bank/payout details, tax or personal ID numbers, street addresses.

### The "AI-built product" angle — option, not yet approved

[PARTNER DECISION: how much of the AI-assisted engineering story to tell publicly]

- The true underlying fact: the product is engineered AI-first — the founder uses Claude heavily throughout the development process itself (design, implementation, multi-agent review/audit passes), i.e. the product that sells AI-assisted delivery is itself built with AI-assisted delivery.
- Potential angles if approved: "solo founder + AI = a shipping cadence that reads like a team" (see the release history below — public launch to a full planning suite in ~6 weeks); "we drink our own champagne"; build-in-public posts.
- Risks to weigh: "AI-built" can read as "unreviewed" to enterprise buyers — if used, pair it with the human-review/audit discipline part of the story. Until the partner decides, do not publish this angle; the shipping-cadence facts alone are safe.

---

## 3. Release history (public-safe highlights)

Label as release history in content; all dates verified from engineering handovers. "v" numbers are Marketplace app versions.

| Date | Release | What shipped |
|---|---|---|
| 2026-05-27 | — | ⚠ **Not publishable as written** (same block as §1): original self-hosted-backend version rejected by Atlassian security review (the pivot trigger). Public form until the founder rules: "the architecture moved to Forge-native + BYOK; there is no vendor backend" — the outcome, not the rejection |
| 2026-05-30 | v3.0 (internal) | Forge-native + BYOK rebuild working end-to-end: Confluence page → AI breakdown (Epic + Stories + Subtasks + dependency links + sizing) → human review → push to Jira |
| 2026-06-01 | — | Resubmitted to the Atlassian Marketplace with the backend-free architecture; security check passed 2026-06-02 |
| **2026-06-17** | **v5.4 — public Marketplace launch** | App live + publicly discoverable: https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira ; branding unified as "Spec2Tickets" | 
| 2026-06-18 | v6.0 (to production) | Test-case generation (per-Story, BA-grade Given/When/Then, Gherkin/CSV export), diagnostics/support ledger, live multi-breakdown dashboard, automatic data-hygiene sweep |
| 2026-06-22 | v6.0 (Marketplace release) | **Capacity / Sprint Planner live**: spec → backlog → PLAN → Jira. Risk-aware AI sequencing, what-if capacity modeling, defensible plan brief; pushes native Scrum sprints and Kanban Now/Next/Later ranking; works on team-managed and company-managed boards |
| 2026-06-28 | v6.5 | Full app-wide UI redesign (the "moodboard" design system: blue-on-white glassmorphism, consistent signal/traffic-light language) |
| 2026-07-07 → 07-11 | (design arc) | The 8-screen redesign arc completed screen-by-screen: Page Picker, AI Insights, Breakdown Editor (three-pane review workbench), Review & Push (+ Resume-push for interrupted pushes), Admin Settings, Diagnostics, Test Cases, Sprint Planning |
| 2026-07-12 | **v7.1.0** (the same work the engineering handovers call "v6.6.0") | Standard-only edition (one plan, everything included) + the first **managed trial credit** implementation (as shipped: $5 per *install*, 30-day-trial licences only); the 8-screen redesign ships in this release. **Version reconciliation:** the repo's own version strings (`package.json` + `DIAG_APP_VERSION`) were corrected 6.6.0 → **7.1.0** on 2026-07-12 (commit `88c35dc`), and `11-faq-objections.md` + `12-marketing-strategy-channels.md` record a live Marketplace listing at **version 7.1.0, released Jul 12 2026** (fetch 2026-07-24). **Production is v7.1.0 as of 2026-07-24** — use it; "v6.6" is only the internal working label. ⚠ **No engineering handover exists for v7.0/v7.1**, so any release-content statement below written from the v6.6 handover may be stale. [GAP: the credit only functions once the vendor-funded managed AI key is set on production — a pending founder-executed op at the 2026-07-12 handover; and the **per-user** credit model decided 2026-07-24 is not implemented at all. Confirm both before publishing any "$5 credit" or "start without an API key" content] |

**Cadence fact (safe to cite):** from public launch (2026-06-17) to a shipped planning suite + full UI redesign (v6.5, 2026-06-28) took 11 days. Good raw material for the shipping-velocity story. ⚠ The wider "3 weeks from the 2026-05-27 security rejection to public launch" framing is **gated by the §1 ruling** — it names the rejection, which 09 and 13 currently class as internal-only. Safe substitute: "from the Forge/BYOK re-architecture to a public Marketplace launch in about three weeks."

---

## 4. Near roadmap — what is safe to say publicly

No dates, no commitments. Forward-looking statements must use "planned / coming soon / under evaluation" language.

- **Managed / no-key processing — NOT purchasable and NOT advertised anywhere public.** A managed edition (Spec2Tickets supplies the AI key) exists in code as a dormant path, but it was never sold on the Marketplace and the "coming soon" card was **removed from the public pricing page on 2026-07-16** — it survives only inside an HTML comment, so a visitor sees nothing about Managed today. Do not mention it publicly and **never quote a price for it** (the ~$13/user figure is commented-out history, not a published price). The only managed processing a customer meets today is the trial welcome credit (below). [GAP: whether marketing may publicly promise a future Managed/no-key edition — product owner decides; until then answer only "today every plan is BYOK after the trial credit" (matches `11-faq-objections.md`).]
- **The "Advanced" edition is folded-in history, not roadmap — do not blur it with Managed.** Advanced was retired as a separate offer on 2026-07-11 and merged into the standard product; test-case generation and sprint planning are included at no extra cost (live pricing FAQ: "It has been folded into BYOK Pro… now part of the standard product… at no extra cost"). Mention it only as history, never as a coming or buyable tier. Managed (dormant, we-supply-the-key) and Advanced (retired, folded in) are two different things — see `02-business-model-pricing.md` §6.
- **Pricing — the confirmed model (founder, 2026-07-24; tier table VERIFIED against the vendor-portal "Set pricing" screen), but do not quote the paid figures from this file.** Paid via Atlassian, USD, per Confluence instance: **up to 10 users free ($0)** — a flat-rate *override* that replaces the bands for that site, not ten free seats deducted from a larger bill · then **per user on a declining, graduated curve**: paying starts **from the 11th user**, and the first band is labelled **1–100 at $6.70/user, charged from the first user on the site** (so a 100-user instance is **$670/month** = 100 × $6.70) · **$5.10 at 101–250** · **$3.80 at 251–1000** · **$3.50 at 1001–2500** · lower again at scale — **per user above 10, not a flat site price**, billed on the **whole instance**, with a **1.5x multi-instance rate** for customers licensing several sites. ⛔ Never fuse the threshold with the band label into "**11–100 at $6.70**": 90 × $6.70 = $603, which contradicts the portal's $670 maximum. ⚠ Above the first band each rate applies only to the users inside its own band, so never multiply one of those rates by the full headcount — inside 1–100 that multiplication is exactly how $670 arises. This supersedes every older state: the live site's "**flat $67/month for 11+, not per user**" (wrong against the model; being corrected — never quote it), the retired in-app "**$6.70/user with $57 flat ≤10**" (`13-claims-register.md` B4 — the ≤10 band is FREE now), and the provisional "**$5.70/user at 101+**" recorded earlier on 2026-07-24 (a misread — $5.70 is the *multi-instance* rate of the 251–1000 band). Publishable today: the free-≤10 fact, plus "from 11 users it is priced per user" and the deflection "the Marketplace always shows the exact price for your team size before you subscribe." Hold the per-user rates until the site is corrected and 13 clears them. Treat `02-business-model-pricing.md` as the single source. [GAP: the live pricing page and `src/usage.js` still contradict the verified table — founder + engineering correct both]
- **Evaluation experience (current):** teams of up to 10 users are **free — a real free tier**, every feature, no time limit; teams of 11+ get the Atlassian Marketplace's standard 30-day trial before the per-user subscription starts. ⚠ A **per-user $5 welcome credit** (free tier and paid trials alike, then BYOK) is **decided 2026-07-24 but NOT YET SHIPPED** — today's code grants $5 per install on trial licences only, and the production managed key funding is unconfirmed (§3 GAP) — so it must not be described as part of the current evaluation experience. ⚠ Do not say "there is no free plan" — the **in-app** metered free tier (3 breakdowns/month for unlicensed users) was retired 2026-06-03, but the free 1–10-user band is a current, full-feature **pricing band**. Different things; never conflate them.
- **Continued deepening of the planning layer** — the spec → backlog → plan flow is the stated platform direction (see §5); further planning/delivery capabilities are under evaluation. Keep vague; do not name specific unshipped features. [GAP: which near-roadmap items are approved for public mention — partner decides. Managed/no-key is NOT one of them by default; see the first bullet of §4]
- **Do NOT promise publicly:** an in-Jira issue panel (explicitly decided against — the product's act is per-spec, upstream of Jira), per-developer-seat pricing (decided against), custom prompts / house-style templates (backlog, unshipped), or any date for the Managed edition.

---

## 5. The long vision (public-safe)

**Reusable vision paragraph (approved framing; adapt tone, keep claims):**

> Spec2Tickets exists to remove the mechanical layer between a written idea and a delivering team. It started with the most painful handoff in software delivery: turning a thoughtful Confluence spec into a structured, dependency-aware Jira backlog — work that used to cost an analyst hours of transcription and now takes minutes plus a human review. With the Capacity Planner, the same breakdown now flows into a defensible sprint or Kanban plan built around the team's real capacity, with the AI's sequencing reasoning shown, not hidden. The direction is a full delivery copilot for agile teams — spec → backlog → plan — where AI does the transcription and sequencing, people keep the judgment, every output is reviewable before it touches Jira, and the customer's content stays inside the Atlassian and Anthropic boundaries they already trust.

**The vision ladder (status as of 2026-07-24):**

| Stage | Status | Evidence |
|---|---|---|
| Spec → Backlog | Shipped (launch, 2026-06-17) | Epic + Stories + Subtasks + dependencies + sizing from one Confluence page |
| Backlog → Test coverage | Shipped (v6.0, June 2026) | Per-Story test-case generation, Gherkin/CSV export |
| Backlog → Plan | Shipped (v6.0, 2026-06-22) | Capacity Planner: risk-aware sequencing, what-if, Scrum + Kanban |
| Plan → Jira execution | Shipped (v6.0, 2026-06-22) | Native sprint creation/assignment + Kanban ranking on real boards |
| Full delivery copilot | Direction, not a commitment | The stated platform direction; no public feature promises |

**Principles the vision always carries** (quote-ready, from the live About page): "AI assists, humans decide" · "Privacy by architecture, not by promise" · "Work at the altitude of the page" (whole-page breakdowns, not single-ticket prompts) · "Least privilege, always" (creates issues, never deletes them).

---

## INTERNAL CONTEXT - never publish

### Roadmap internals

- **Managed edition mechanics (editions "Phase 2"):** Atlassian editions are a post-publish, separately-reviewed process. An "Advanced" edition was submitted 2026-06-17 (then defined as Managed) and has never gone purchasable. The 2026-07-11 Standard-only pivot supersedes the v6 value-split plan: Advanced is to be **retired in the vendor portal** (one Standard edition, everything included); existing internal capability mappings keep any hypothetical Advanced subscriber full-featured. In-app the Managed price is deliberately `null` in `src/usage.js` (no non-buyable Subscribe CTA), and the site's ~$13 "coming soon" card was **hidden on 2026-07-16** — it survives only inside an HTML comment in `pricing/index.html`. So Managed is currently invisible on every public surface; the ~$13 figure is retired history, not a published price.
- **Vendor-pays / "reselling" path:** research (2026-06-01, re-verified 2026-06-03) established Anthropic's Commercial Terms §A.1 permit powering our own product — no special reseller approval needed at current scale. Real prerequisites for Managed GA are compliance, not permission: our own Anthropic DPA posture, honest retention disclosure (Anthropic Batches API is not zero-data-retention; ≤29-day retention, no-training default), customer-facing DPA, updated Marketplace privacy questionnaire. Lawyer-approved Managed compliance copy already exists on the site repo behind hidden toggles — re-activate, never re-draft (`09-trust-security-compliance.md`).
- **Welcome credit — the decision (2026-07-24) vs the code:** the **decision** is $5 **per user**, one-time, on the free 1–10 tier *and* on paid tiers during the 30-day trial, then BYOK; per-user (not per-site) so a small team can keep evaluating through a colleague whose credit is intact. The **shipped internals** are different: per-**install**, lifetime (not monthly), **trial-licence-only**, spent from a company-funded Anthropic key; a pre-flight blocker makes $5 a real cap, with a hard spend ceiling slightly above the grant (~1.2×, ≈$6/install) as the absolute backstop, so worst-case managed spend is bounded per install regardless of seat count. Never publish ceilings or the mechanism — and until the per-user model ships, nothing about the credit is publishable at all.
- **Release dependency (the release shipped as v7.1.0; "v6.6.0" is the same work under its internal working label):** the credit only works in production once the founder funds/sets the managed AI key — a pending founder-executed op at the 2026-07-12 handover, even though the repo version strings and the live listing both read 7.1.0. The per-user redesign of the credit is a further, unimplemented change. If marketing content ever leans on the credit, confirm both first (see the GAP in §3).

### Decided NOT-doing (never promise, even casually)

- In-Jira issue panel (product acts per-spec, upstream; devs consume the Jira output).
- Per-developer-seat pricing as the core metric (buyer is the BA/PO/PM).
- Perpetual **in-app** free tier — the metered 3-breakdowns/month allowance for unlicensed users (retired 2026-06-03). ⚠ This is NOT the same as **"free for teams of up to 10 users, every feature included, no time limit"**, which is a current, founder-confirmed **pricing band** (2026-07-24) and is publicly stated on spec2jira.com/pricing. Never say "there is no free plan"; never conflate the two.
- Usage top-ups / mid-cycle re-buys (not possible under Paid-via-Atlassian billing).

### Timeline nuances (context, not for publication)

- Two distinct review hurdles: the 2026-05-27 **security** rejection (FIT — the candidate story, currently blocked from publication by the §1 flag), then a **listing-configuration** hurdle (cross-product app vs "Paid via Atlassian" single-parent billing), resolved 2026-06-04 via the vendor portal's Compatibility tab. Only the first is story material; the second is process noise and involves reviewer names — keep it out.
- v6.0 has two dates because the code went to production 2026-06-18 while the planner-complete Marketplace version 6.0.0 is dated 2026-06-22 — use 06-22 for the planner, 06-18 for test cases + diagnostics, per the table above.
- EUR prices (3.90/4.90/6.90/9.90/20/29/39/49/69/99) found anywhere in internal notes are the retired pre-2026-06-04 plan — never present a EUR figure as current. Current pricing is USD only and set by the founder-confirmed model of 2026-07-24, whose tier table is **verified against the vendor portal** and whose band mechanic was corrected 2026-07-25 (free up to 10 · paying starts from the 11th user, with the first band labelled **1–100 at $6.70/user charged from the first user**, so a 100-user site is $670 · then graduated: $5.10 101–250 · $3.80 251–1000 · lower again at scale · 1.5x multi-instance); both `src/usage.js` ("$6.70/user, $57 flat ≤10") and the live pricing page ("$67 flat for 11+") are **out of date against it** and are being corrected — read `02-business-model-pricing.md` before quoting anything.
- Old model name: the v2.x pipeline ran Qwen-14B. Fine as public origin-story color; never imply Qwen is in the current product (current: Anthropic Claude Sonnet, Haiku fallback).

### Gaps

- [GAP: the welcome credit needs BOTH the per-USER implementation (decided 2026-07-24, not built — today's code is per install and trial-only) AND a funded/set managed AI key on production (a pending founder-executed op at the 2026-07-12 handover) before publishing any "$5 credit" or "start without an API key" content. (The release VERSION is reconciled: repo strings + the live listing both read **7.1.0**, released 2026-07-12 — see §3.)]
- [GAP: the vendor-portal tier table is VERIFIED as of 2026-07-24, band mechanic corrected 2026-07-25 (free up to 10 · then, from the 11th user, the **1–100** band at $6.70/user charged from the first user — a 100-user site is $670 · $5.10 101–250 · $3.80 251–1000 · lower at scale, graduated · 1.5x multi-instance), but the live site still shows the wrong "$67 flat" and `src/usage.js` still shows the retired "$6.70/user, $57 flat ≤10" — both must be corrected before any paid figure is quoted from this file; see §4 and `02-business-model-pricing.md`. Owner: founder + engineering]
- [GAP: no engineering handover exists for v7.0/v7.1 — release-content statements written from the v6.6 handover may be stale for what actually shipped as 7.1.0]
- [PARTNER DECISION: may the 2026-05-27 rejection narrative in §1 be told publicly? `09-trust-security-compliance.md` and `13-claims-register.md` C4 currently classify it as internal-only — §1 is blocked until this is resolved]
- [GAP: which near-roadmap items are approved for public mention — partner decides. Managed/no-key is NOT one of them by default; see the first bullet of §4]
- [GAP: no sourced install/review counts for our own Marketplace listing — check the live listing before citing any adoption or traction numbers]
- [PARTNER DECISION: how much of the AI-assisted engineering story to tell publicly]
