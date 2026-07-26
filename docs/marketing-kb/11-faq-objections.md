---
title: FAQ & Objection Handling — Spec2Tickets
purpose: Ready-to-use, sourced Q&A pairs (grouped by theme) for answering prospect questions and objections in public content, plus internal answer notes.
visibility: mixed
sources:
  - Founder pricing + onboarding decision, 2026-07-24, tier table VERIFIED against the Atlassian vendor-portal "Set pricing" screen (founder screenshot, 2026-07-24); band mechanic corrected 2026-07-25 per 13-claims-register.md — SUPERSEDES every pricing statement in the sources below (free up to 10 users, a flat-rate override · paying starts from the 11th user, and the first band is labelled 1-100 at $6.70/user charged from the first user, so a 100-user site is $670 · then graduated: $5.10 101-250 · $3.80 251-1000 · lower again at scale · 1.5x multi-instance · per-user $5 welcome credit decided but not shipped)
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/pricing/index.html
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/docs/index.html
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/get-api-key/index.html
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/privacy/index.html (authoritative compliance wording)
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/dpa/index.html (grep-verified: Managed Processing = free-trial only)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/docs/MARKETPLACE-LISTING-v3.md
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/CLAUDE.md (targeted sections only — gotchas, monetization, live-acceptance, Review & Push handover)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/src/usage.js
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/src/anthropic_client.js (MAX_OUTPUT_TOKENS = 64000)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/manifest.yml (authoritative OAuth scope list — 11 scopes, read 2026-07-24)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/src/index.js (resolveAnthropicKey — the trial-credit gate)
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/standard-only-trial-credit.md
  - https://spec2jira.com/pricing (live fetch, 2026-07-24)
  - https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira (live fetch, 2026-07-24)
last_verified: 2026-07-24
---

# FAQ & Objection Handling

Usage: every Q&A below the fold is **public-safe** and reuses live site / listing wording where it exists — **except** where a "Writer's note" marks something as not-yet-publishable; those notes are internal and must be stripped before publication. Pricing answers follow the **founder-confirmed model of 2026-07-24** (free up to 10 users · then, from the 11th user, per user on a declining curve whose first band is labelled 1–100 and is charged from the first user; tier table verified against the vendor portal, band mechanic corrected 2026-07-25), which supersedes the live site's still-published "$67 flat" wording — read the pricing block in the internal section before writing anything with a dollar sign. Deep dives: pricing math → `02-business-model-pricing.md`, security/compliance → `09-trust-security-compliance.md`, screens → `07-product-tour-8-screens.md`, rivals → `05-competitive.md`.

---

## Pricing & billing

### 1. What does Spec2Tickets really cost, all-in?
Two parts: the app subscription (via the Atlassian Marketplace) and your own AI usage (billed by Anthropic directly, at cost — "no vendor markup on AI"). **While your whole Confluence site has 10 users or fewer you pay nothing for the app** — every feature, no time limit — so your only cost is AI usage. **From the 11th user the app is priced per user**, billed through the Atlassian Marketplace in USD. Two things decide your number: Paid via Atlassian licenses your **entire Confluence instance**, so every user on the site counts — not only the people who use the app — and once the site passes 10 users the per-user rate applies to **all** of them, counted from the first, not just the ones above 10. The rate itself **declines as the site grows**, and the Marketplace always shows the exact price for your team size before you subscribe. AI usage is "typically a few cents per breakdown" — one 10-feature breakdown measured at ~$0.045 (internal validation, 2026-06; an illustrative measured run, not a customer result or a guarantee) — and the app "always shows you an estimate before you run a paid action, and the exact amount after — so there are no surprises."
> ⚠ **Writer's note (do not publish):** the verified rates (vendor portal, 2026-07-24; band mechanic corrected 2026-07-25) are **$6.70 per user/month across the 1–100 band** — the band a site enters the moment it passes 10 users, charged from the **first** user on the site — then **$5.10 at 101–250**, **$3.80 at 251–1000**, **$3.50 at 1001–2500** and lower again at scale. So a 100-user instance is **$670/month** = 100 × $6.70, never "$67 flat". ⛔ Never label that first band "**11–100**": 90 users × $6.70 = **$603**, which contradicts the portal's own $670 maximum — "from 11 users" is the *threshold*, "1–100" is the *band label*. ⚠ Above the first band the curve is **graduated** (each rate applies only to the users inside its own band, so 250 users ≈ $1,435, not 250 × $5.10) — that no-multiplying rule does **not** apply inside 1–100, where multiplying the whole headcount by $6.70 is exactly how $670 arises. The figures are **not publishable yet** — the live site still advertises the superseded "flat $67/month, not per user" and is being corrected. Never write "$67 flat", never the retired "$6.70/user with $57 flat for ≤10", and never the provisional "$5.70/user at 101+" (that figure is the *multi-instance* rate of the 251–1000 band). See 02-business-model-pricing.md.

### 2. How is the subscription priced? Is it per user?
Free while your whole Confluence site has 10 users or fewer — that free rate *replaces* the per-user pricing for those sites; it is not ten free seats taken off a bigger bill. **From the 11th user it is per user** — and because "Paid via Atlassian" licenses the entire Confluence instance, the rate applies to **every user on the site, counted from the first**, not only the people who use the app and not only the users above 10. The rate declines as the instance grows. Billed in USD alongside your other Atlassian apps: "The Marketplace always shows the exact price for your team size before you subscribe."
> ⚠ **Writer's note (do not publish):** the answer flipped on 2026-07-24 — the older "no per-user math / one flat price for the whole site" line is **wrong** and is being corrected on the site. Per-user rates: see the note under Q1.

### 3. Why does pricing depend on my whole Atlassian instance, not just the people who use the app?
Atlassian's "Paid via Atlassian" model licenses the entire instance — **every user on the site, not just app users** — so the per-user price applies across the whole Confluence instance. That is Atlassian's standard mechanic for cloud apps, not our choice. Two things soften it: teams of up to 10 users pay nothing at all, and the per-user rate **decreases** for larger instances, so a big site with a handful of BAs is not priced out. The Marketplace shows the exact figure for your size before you subscribe.

### 4. Are there editions or feature tiers? What happened to the "Advanced" edition?
There is one plan and it includes everything. Site wording: "It has been folded into BYOK Pro. AI-generated acceptance test cases — BA-grade Gherkin and CSV, ready to import into your test tools — were previously planned as a separate Advanced edition and are now part of the standard product, along with sprint planning, at no extra cost."

### 5. Will you raise prices on me later?
Site wording: "Early-access pricing — we grandfather early adopters as the product grows." The intent (stated publicly on the pricing page) is that early adopters keep their terms as the price curve evolves.

### 6. How do I manage or cancel the subscription?
Site wording: "Subscriptions are handled through the Atlassian Marketplace and your Atlassian site administration, alongside your other Atlassian apps." No separate vendor account or billing relationship to manage.

---

## Trial & getting started

### 7. Is there a free trial — or a free plan?
Both, and they are different things — keep them separate in copy. **There is a real free plan: teams of up to 10 users are simply free**, "every feature included and no time limit", not a trial and not usage-metered (they bring their own Anthropic key). **Teams of 11+** get the Atlassian Marketplace's standard 30-day free trial before the per-user subscription starts.
> ⚠ **Writer's note (do not publish):** a **$5 welcome credit per user** — on the free tier *and* during paid trials, letting people generate on our Anthropic key before bringing their own — is the model decided on 2026-07-24, but it is **NOT YET SHIPPED**: today's code grants $5 per *install* and only on a trial licence, so a free-tier install gets nothing. Do not promise credit to anyone, small teams included, until the implementation lands and the founder confirms. The Marketplace release-notes line "…right away, on us, during your trial" describes the shipped per-install trial behaviour only.

### 8. Do I need an Anthropic account or API key to start?
For ongoing use, yes — you bring your own Anthropic API key (BYOK). The step-by-step guide at spec2jira.com/get-api-key takes "about 5 minutes, one time," and roughly $5–10 of Anthropic credits "is plenty to start." Don't skip Anthropic's billing step — a key without billing enabled exists but won't work. The key is what makes your content stay under **your own** Anthropic agreement.
> ⚠ **Writer's note (do not publish):** "start with no API key at all" is the **decided-but-not-yet-shipped** onboarding model (per-user $5 welcome credit on our managed key, then BYOK — founder, 2026-07-24). Today the credit exists only per install on a 30-day-trial licence, and the production managed key funding is unconfirmed — so the no-key promise must not be made publicly yet (see Q7 and 13-claims-register.md A2.7). Once it ships, the approved shape is: "start generating immediately, no API key needed; bring your own key when the welcome credit runs out."

### 9. Why do I see TWO entries in "Manage apps"?
Expected and normal. Site docs wording: "Because Spec2Tickets works across both Confluence and Jira, it registers once for each product — that's normal for a cross-product app, and the permissions it requests explain why." Atlassian reviewers expect this pattern for cross-product Forge apps.

### 10. Where do I actually open the app? I installed it and can't find it in Jira.
Everything happens in Confluence: **Apps → Spec2Tickets**, or the **••• (more actions)** menu on any page → "Generate Breakdown with Spec2Tickets". Site docs wording: "There is no separate app screen on Jira … The Jira connection just lets the app create the Epic, Stories, and Subtasks in your Jira project."

---

## Data & privacy

(Authoritative wording lives at spec2jira.com/privacy, /dpa, /subprocessors — quote those pages, never paraphrase into new claims. Summary detail: `09-trust-security-compliance.md`.)

### 11. Where does my page content go?
Privacy-policy wording: the app "runs entirely on the Atlassian Forge platform — there is no Spec2JIRA-operated server or backend." Your selected page content goes from Forge to Anthropic's API under **your own** API key and agreement; the app's only configured network egress is `api.anthropic.com`. "Spec2JIRA operates no server or database of its own, so it stores no content on Spec2JIRA-operated infrastructure."

### 12. Is my content stored? For how long?
Only transiently, inside your own Atlassian instance (Forge storage), to drive the review-and-push flow. Privacy-policy wording: "The App removes them when you push to Jira; a breakdown you never push … is automatically removed after 7 days of inactivity," and "Uninstalling the App removes all of its stored data." The vendor keeps no copy — "there is none" (no vendor systems exist).

### 13. Do you — or Anthropic — train AI models on my data?
By default, no — but the two contexts have different site-verbatim wording; never merge them into one absolute. **Under BYOK** (privacy §4): "By default, Anthropic **does not use data submitted through its API to train its models**, and deletes API inputs and outputs within around 30 days; content flagged under its Usage Policy may be retained longer (up to about 2 years). Your own Anthropic agreement and retention settings govern this." **During the trial welcome credit** (privacy, "Managed AI processing"): "Neither Spec2Tickets nor Anthropic uses your content to train AI models (Anthropic's commercial/API no-training default)." (Never tighten either sentence into "never trains" or "zero retention" — see `09-trust-security-compliance.md` §3.)

### 14. What about my data during the free trial, when you run Claude for me?
That is the one disclosed difference: during the trial the app may call Anthropic under the **vendor's** account (the welcome credit), in which case "Spec2Tickets acts as a processor on your instructions, and Anthropic is our sub-processor." Retention is disclosed honestly: the asynchronous Batches API is "not eligible for zero data retention" — inputs/outputs are "retained by Anthropic for up to about 29 days" then deleted. A published DPA and sub-processor list cover this; the moment you add your own key (or the credit is used), the app switches to BYOK — "the privacy-maximising choice."
> ⚠ **Writer's note (do not publish):** this answer describes the **data handling** of managed processing (already covered by the published privacy/DPA wording). It is not permission to advertise the welcome credit itself — that stays blocked until the per-user implementation ships (see Q7/Q8).

### 15. Who can see my Anthropic API key?
Not the vendor, and never the browser. Site wording: "Your key is stored in Atlassian's encrypted Forge secret storage — it's never shown back in the app and never sent to Spec2Tickets' own servers (we don't run any)." Privacy §10: it is "accessible only to the App's backend resolver and never exposed to the browser," and privacy §6 lists the key among the things the vendor does **not** "receive, store, or have access to." You can clear it from Settings at any time.

### 16. Does the app act with some admin service account in my Jira?
No. All Confluence reads and Jira writes use Atlassian's `asUser()` authorization — "the App acts with the signed-in user's own permissions, never a separate service account or shared credential." Users can only act on content they already have access to, and the app requests a least-privilege scope set — **11 granular scopes** as of 2026-07-24 (6 to read the page and create the issues, 5 for the sprint-planning writes), each listed in plain English in `09-trust-security-compliance.md` §4. Adding a scope forces a one-time admin re-consent in Manage Apps, so permissions can never widen silently. (Re-check the count against `manifest.yml` before publishing it — a security reviewer counts them on the consent screen.)

---

## Capability & output

### 17. Which AI model does it use?
Anthropic's **Claude Sonnet 4.6**, called through Anthropic's asynchronous Message Batches API (that's also why generation is minutes-scale and batch-priced rather than interactive). No self-hosted models, no shared AI service, no GPU or infrastructure on your side.

### 18. How long does a generation take?
Site docs wording: "typically a few minutes (longer for large pages or under heavy Anthropic load). You can leave the page and reconnect later; generation keeps running." It is deliberately asynchronous — work in flight survives closing the tab, and the app home shows breakdowns in progress.

### 19. How large a specification can it handle?
Large real-world specs: validated internally on specifications of ~100,000 characters (internal validation, 2026-05; not a customer result — this is the only public form the claims register allows, `13-claims-register.md` A4.5/C6). Output runs up to a 64K-token ceiling, and if a spec is ever dense enough to exceed it, a salvage path recovers the complete features and the app warns you honestly with a truncation note (suggesting a split) instead of failing silently.

### 20. What exactly gets created in Jira?
One **Epic** for the page; a **Story** per feature with acceptance criteria, priority, story points, and labels; **Subtasks** under each Story; and **"blocks / is blocked by" links** for cross-feature dependencies — created in your project under your own Atlassian permissions, with links to the new Epic and Stories when done. Nothing is created until you review and push.

### 21. Does it work with team-managed AND company-managed Jira projects?
Yes — both, including the sprint-planning push (native Scrum sprints and Kanban Now/Next/Later ranking on team-managed and company-managed boards, live-validated). Details like the Subtask issue-type naming difference between project types are resolved automatically per project.

### 22. What languages does it support?
The app UI is English. The generated breakdown follows the language of your source page — validation runs on Bulgarian specifications produced acceptance criteria mirroring the spec's language. (Keep public claims at "the output follows your page's language" — don't enumerate a supported-language list; none exists.)

### 23. Can it delete or overwrite my existing Jira issues?
No. It creates only — Epic, Stories, Subtasks, and links — and never deletes or edits pre-existing issues (the Jira scope justification on file is literally "creates-only-never-deletes"). Nothing reaches Jira until you approve the push from the review screen.

---

## Limits & honest objections

### 24. What happens if a push to Jira partially fails?
You get an honest, itemized outcome ledger — a partial push is never presented as success. It shows exactly what landed and what failed (with per-item causes, e.g. a rejected required field), and a **Resume** re-push creates only the items that didn't land, without duplicating the ones that did.

### 25. What does Spec2Tickets NOT do?
It does not write application code; it produces the backlog (Epic/Stories/Subtasks/links), acceptance test cases (Gherkin/CSV), and a sprint plan. There is no in-Jira panel — you work in Confluence and Jira receives the issues. It is cloud-only (Confluence Cloud + Jira Cloud on Atlassian Forge; no Server/Data Center). And it never auto-pushes: a human reviews and approves everything — by design ("AI assists; you decide").

---

## Hardest objections — quick counters

| Objection | Counter (which Q) |
|---|---|
| "Hidden AI costs on top of the subscription" | At-cost, no markup; cents per breakdown; estimate before, exact after (Q1) |
| "I don't want to set up an API key just to evaluate" | ⚠ **No public counter available yet.** The per-user welcome credit that answers this is decided but not shipped (Q7, Q8) — until it lands, the honest answer is the free ≤10 plan plus the 5-minute one-time key setup (get-api-key guide) |
| "Two apps appeared — is this malware/misconfigured?" | Expected for cross-product Forge apps; scopes explain it (Q9) |
| "Our specs are confidential — no third-party AI" | No vendor backend; your key, your Anthropic agreement; no training; purge-on-push + 7-day sweep (Q11–13) |
| "AI will spam our Jira with garbage" | Nothing reaches Jira until human review + push; creates-only; honest partial-failure ledger + Resume (Q20, Q23, Q24) |
| "Another per-seat SaaS tax" | Free for teams of ≤10 users; above that it is per user, but the rate decreases as the instance grows, and early adopters are grandfathered (Q2, Q3, Q5) |

---

## INTERNAL CONTEXT — never publish

**Pricing — the confirmed model (founder, 2026-07-24), with the tier table VERIFIED against the Atlassian vendor-portal "Set pricing" screen the same day. It supersedes every figure in every source, including the live site:**
- **Up to 10 users: free ($0)** — every feature, no time limit; a real free tier, not a trial, and a flat-rate *override* that replaces the bands for that site rather than ten free seats deducted from a larger bill. Then **per user on a declining, graduated curve**: paying starts **from the 11th user**, and the first band is labelled **1–100 at $6.70**, charged from the **first** user on the site · **$5.10 at 101–250** · **$3.80 at 251–1000** · **$3.50 at 1001–2500** · **$3.25 at 2501–7500** · lower again above that (down to $1.15 at 45001+). It is **per user above 10, NOT a flat site price**, and Paid via Atlassian licenses the **whole Confluence instance** (every user on the site, not just app users). USD, billed through the Marketplace; 30-day trial for teams of 11+. Customers licensing several instances pay a **1.5x multi-instance rate** ($10.05 / $7.65 / $5.70 on the first three bands). **The single most quotable consequence: a 100-user instance is up to $670/month, not "$67 flat".**
- ⛔ **Never fuse the threshold into the band label — "11–100 users at $6.70" is the defect.** 90 users (11 through 100) × $6.70 = **$603**, which contradicts the portal's stated $670 maximum. "From 11 users" is the **threshold** at which paying starts (and the right thing to say in copy); "**1–100**" is the **band label** whose rate then applies, across the whole headcount. ⚠ **Above** the first band the curve is **graduated** — each rate applies only to the users inside its own band, so a 250-user instance is ≈ **$1,435** ($670 + 150 × $5.10), **not** 250 × $5.10, and a 1000-user instance ≈ $4,285. That "never multiply a band rate by the full headcount" warning is scoped to the bands **above** the first: inside 1–100 the whole headcount *is* charged at $6.70, which is exactly how $670 arises. When an exact total is needed, use "the Marketplace always shows the exact price for your team size before you subscribe" rather than doing the maths in public.
- ⚠ **Publication rule:** the **free-≤10 fact is publishable**; the **per-user rates are NOT yet** — the live site still advertises the superseded "$67/month flat for 11+, not per user", so public copy quoting the real rates would contradict the published page. Deflect with "from 11 users it is priced per user — the Marketplace always shows the exact price for your team size before you subscribe" until the site is corrected and 13-claims-register.md clears the figures.
- **Wrong / retired — never publish:** "$67/month flat, not per user" (live site, 2026-07-16, being corrected) · "$6.70/user with $57/month flat ≤10" (in-app `src/usage.js`, `docs/MARKETPLACE-LISTING-v3.md`, CLAUDE.md — the ≤10 band is FREE now, not $57; ⚠ the *declining-curve* half of that old framing is CORRECT and survives — only the $57 floor is retired) · the provisional "$5.70/user at 101+" recorded earlier on 2026-07-24 (a misread across portal columns — $5.70 is the multi-instance rate of the 251–1000 band) · "Advanced" ~$13–13.40/user (never sold) · all EUR figures ≤2026-06-03 (€3.90 / €4.90 / €6.90 / €9.90 / €20 / €29 / €39 / €49 / €69 / €99).
- [GAP: BOTH the live site copy ("$67 flat") and the in-app `src/usage.js` price strings still need correcting to the verified table above — partner/pricing owner decides; see 02-business-model-pricing.md.]
- "No in-app Free tier (removed 2026-06-03)" refers to the old **3-breakdowns/month metered tier**. The current "free for teams up to 10 users" is a **pricing band with full features** — a different thing. Never conflate them in copy, and never write "we have no free tier".

**Welcome credit — DECIDED 2026-07-24, NOT YET SHIPPED (public site says only "a small welcome credit"; the in-app badge shows the $5 figure):**
- **The decision:** **every user** gets a one-time **$5 welcome credit** of AI usage on our managed key — on the free 1–10 tier *and* on paid tiers during the 30-day trial — **per user, not per site** (in a team of up to 10 each person has their own $5, so the team can keep evaluating through a colleague who still has theirs); when a user's credit is spent they continue with BYOK, paying Anthropic directly, no markup. **Implementation pending — describe it only as "the model we are moving to", never as a live capability.**
- **The code today:** $5 of managed credit **per install, lifetime** (not per user, not per month), **trial-only**; paid subscribers are always BYOK. A pre-flight stopper blocks any managed run whose estimate exceeds remaining credit, and a hard ceiling of ~1.2× the grant (~$6) bounds total vendor exposure per install. Never publish the ceiling/exposure math.
- The credit runs on a vendor-funded Anthropic key on production. As of the 2026-07-12 handover, funding/setting that key on prod was a pending partner-executed op, while Marketplace v7.1.0 release notes already advertise the trial credit. [GAP: confirm the managed credit is funded and active on production — without it, trial users hit a graceful "managed unavailable" and are asked for a key; ops owner confirms.]
- ⚠ **Today's eligibility is TRIAL-gated in code**, not team-size-gated — which is exactly what the 2026-07-24 decision changes: `resolveAnthropicKey` (src/index.js) grants the managed key only when there is no BYOK key AND `MANAGED_ANTHROPIC_KEY` is set AND `isTrialLicense(...)` is true AND credit remains. `isTrialLicense` (src/usage.js) reads `isEvaluation`, falling back to a future `trialEndDate`; an explicit `isEvaluation === false` is never a trial. A free ≤10-user install is a **licensed, $0** install, so under today's code it gets **no credit at all**. [GAP: the per-user credit (free tier included) is unimplemented — until it ships and the founder confirms, every public claim about the welcome credit stays BLOCKED, including "start with no API key" for the free band the site's primary CTA targets. Owner: founder / engineering.]

**Cost-claim calibration (keep public claims to the site's wording):**
- Breakdown: ~$0.045 for a 10-feature breakdown — one measured live-acceptance run (2026-06-18), batch-priced (Batches API ≈ 50% off sync pricing). Site's public claim: "typically a few cents per breakdown."
- Test-case generation: site says "usually under a dollar per run"; one live run on a decision-table-dense domain cost $1.27 (the in-app "up to ~$X" ceiling held; the "typically" estimate ran ~3× low). Never promise test-gen "always costs cents" — lean on "estimate before, exact after."
- **Validation internals — never public** (`13-claims-register.md` C6): the ~101,000-character spec produced **39 features / 162 subtasks**, and the push validation was **178 items / 0 failures** (2026-05-30). Q19's public form is only A4.5's labelled "~100,000 characters (internal validation)" sentence — the item counts are internal colour, and attributing any of it to a customer is a B12 violation.

**Scope counts are a release-event claim (re-verify before publishing any number):** `manifest.yml` is the only authority — **11 scopes** as of 2026-07-24 (6 read/create + 5 sprint-planning). `docs/MARKETPLACE-LISTING-v3.md` §5 still shows the STALE original 5, which is where an understated count leaks in from. Every scope addition forces a one-time admin re-consent, so the number moves with releases; the plain-English table lives in `09-trust-security-compliance.md` §4.

**Marketplace status (as of 2026-07-24, public listing data — don't cite in posts):** version 7.1.0 (released Jul 12, 2026), "Requires Confluence Cloud, Works with Jira," **3 installs, no reviews yet**. Do not quote install/review counts publicly while they are this small.
- ⭐ **The 7.1.0 reading is corroborated in-repo** (checked 2026-07-24): `package.json` version **7.1.0** and `src/diagnostics.js` `DIAG_APP_VERSION` **7.1.0** — the two strings CI keeps in lockstep and that are bumped to the number the production deploy stamps as the Marketplace version. So 7.1.0 is the best-supported live figure, and the CLAUDE.md handover language about "v6.6.0 committed, prod release pending" is a **superseded snapshot from 2026-07-12**, not a competing current state. ✅ Sibling chapters 01, 07 and 10 were reconciled to v7.1.0 on 2026-07-24 — do not weaken this file to match older text. ⚠ **No engineering handover exists for v7.0 or v7.1**, so feature/screen descriptions across the KB are written against the v6.6 handover and may be stale for what actually shipped. [GAP: the vendor portal is the only place to confirm which version is *published* vs merely deployed — owner: founder.] [GAP: no v7.0/v7.1 handover — re-verify version-sensitive capability claims against the live app.]

**Managed (no-key) edition:** internally kept dormant (code + commented-out site copy exist); the live site **no longer advertises** a "Managed Pro — coming soon" card. [GAP: whether marketing may publicly promise a future Managed/no-key edition — product owner decides; until then, answer only "today every plan is BYOK after the trial credit."]

**Support facts usable publicly (from the site footer):** support@spec2jira.com · security@spec2jira.com · privacy@spec2jira.com · "Support 11:00–23:00 (Europe/Sofia), 7 days a week" · "Made in Sofia, Bulgaria."
