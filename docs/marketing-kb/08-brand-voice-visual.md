---
title: "08 — Brand: naming, voice, visual system, assets"
purpose: One-stop brand reference — the two-name rule, trademark hygiene, voice/copy rules, both visual token systems (product UI + website), typography, and the current asset inventory.
visibility: mixed
sources:
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/docs/DESIGN-SYSTEM-MOODBOARD.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/moodboard-design-system.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/site-launch-punchlist.md
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/ui-button-color-convention.md
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/docs/MARKETPLACE-LISTING-v3.md
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/CLAUDE.md (handover sections on moodboard, button tokens, copy sweeps)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/static/hello-world/src/index.css (live app tokens)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/src/usage.js (edition names)
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/index.html
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/pricing/index.html (tier names only)
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/assets/css/site.css
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/favicon.svg
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/og-image.svg (+ og-image.png verified 1200x630)
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/assets/fonts/OFL-NOTICE.txt
last_verified: 2026-07-24
---

# 08 — Brand: naming, voice, visual system, assets

How to SAY it (naming + voice) and how to SHOW it (color, type, marks, assets). For what to claim, see `13-claims-register.md`; for message architecture, see `04-positioning-messaging.md`.

---

## 1. Naming guide

### 1.1 Two names, one product — the split is INTENTIONAL

| Name | What it is | Where it appears |
|---|---|---|
| **Spec2Tickets** | The PRODUCT name. Marketplace listing title: **"Spec2Tickets for Confluence & Jira"** | Marketplace listing, app UI, page `<title>`s, product references in all copy, schema.org `SoftwareApplication` name |
| **Spec2JIRA** | The VENDOR brand + domain (`spec2jira.com`) | Site nav/footer wordmark, Marketplace vendor/partner name, copyright line ("© 2026 Spec2JIRA"), legal pages, support/security/privacy @spec2jira.com emails, schema.org `Organization` name |

Rules:
- **Never "correct" one into the other.** The split is a deliberate, recorded decision ("two names, one product"): Spec2Tickets = what you install; Spec2JIRA = who makes it.
- Talking about features, screens, pricing, the app → **Spec2Tickets**. Signing as the company, legal/privacy voice, the domain → **Spec2JIRA**.
- Each schema.org block lists the other as `alternateName` — the site treats them as aliases of one identity, not two products.
- Live usage examples: hero eyebrow "Spec2Tickets — for Confluence + Jira"; footer "Made in Sofia, Bulgaria" under the Spec2JIRA wordmark.
- Public founder facts that may accompany the vendor name: **Aleks Asenov, sole trader, Sofia, Bulgaria** (already public on the site). Nothing beyond that (no street address, no IDs, no bank data — ever).

### 1.2 Plan / edition names (public, as of 2026-07-24)

- The live pricing page names plans **"Free"** (teams up to 10) and **"BYOK Pro"** (flat price). The formerly-planned second edition name **"Advanced"** is publicly framed as *"folded into BYOK Pro"* (its features — AI test-case generation, sprint planning — are standard now).
- **"Standard" / "Advanced"** are the Atlassian Marketplace *edition* labels used in the portal and app code — fine internally; in public copy prefer the plan names the pricing page uses.
- **Do not quote prices from this chapter.** All figures live in `02-business-model-pricing.md` (see INTERNAL note below — the two pricing sources currently disagree; 02 owns the reconciliation).
- No in-app Free *tier* exists inside the product; evaluation = the 30-day Atlassian Marketplace trial with $5 of managed trial credit (details + wording in 02 and `11-faq-objections.md`).

### 1.3 Third-party trademarks — descriptive use only

Atlassian, Jira, Confluence, Forge, Atlassian Marketplace, Anthropic, and Claude are third-party trademarks. Rules:
- Use **descriptively**: "for Confluence and Jira", "runs on Atlassian Forge", "available on the Atlassian Marketplace", "powered by Anthropic Claude", "built on Anthropic Claude", "your own Anthropic API key".
- **Never imply endorsement, partnership, or certification** by Atlassian or Anthropic. No "official", no co-branding, no using their logos as if ours.
- In prose write **"Jira"** (not "JIRA") and "Confluence" — as the live site does. The all-caps "JIRA" inside **Spec2JIRA** is the historical vendor lockup and stays as-is; don't extend that styling to prose.
- Model naming when needed: "Anthropic Claude" generally; the app runs Claude Sonnet 4.6 with a Haiku fallback (cite `01-product-overview.md` for tech facts).

### 1.4 Spelling & capitalization quick list

| Write | Not |
|---|---|
| Spec2Tickets | Spec2tickets, Spec 2 Tickets, S2T (public) |
| Spec2JIRA (vendor only) | Spec2Jira, spec2JIRA |
| BYOK / bring your own key | B.Y.O.K. |
| Jira, Confluence, Forge | JIRA (in prose), ForgeApp |
| Epic, Stories, Subtasks (as Jira objects) | epics/stories randomly capitalized mid-sentence |
| sprint-ready backlog | sprintready |

---

## 2. Voice & public copy rules

### 2.1 Voice attributes (how the brand sounds)

- **Value-first and concrete** — lead with the outcome ("Your Confluence page is already a backlog. Let it write itself."), then the mechanics.
- **Calm, premium, honest** — enterprise-trustworthy without corporate density; claims are architectural, not aspirational ("We can't see your data because we never receive it").
- **Human-in-control** — the recurring principle "AI assists, humans decide" / "AI drafts; your team reviews and decides before anything ships". Never write copy implying the AI ships tickets unsupervised.
- **Plainspoken about time** — "minutes, not the 2–3 days a manual breakdown takes".

### 2.2 Hard copy rules

1. **English only** in all public and user-facing copy (binding project policy; Bulgarian is conversation-only, never shipped).
2. **Don't lead with the jargon word "spec"** at hero level — customers may not parse it. Anchor it in supporting copy as *"a spec, PRD, or requirements doc"*; prefer "Confluence page" as the subject (the live hero does exactly this).
3. **No invented numbers, customers, quotes, or testimonials.** The site has zero customer quotes; approved stats are only: **~70% less hand-work · minutes not 2–3 days · 100% human-reviewed** (see `13-claims-register.md` before using any stat).
4. **Privacy claims must match the live site/legal pages verbatim in spirit** — the site repo (privacy/, dpa/, subprocessors/) is the only authoritative compliance wording; quote it, never re-draft (see `09-trust-security-compliance.md`).
5. **Pricing copy** comes only from `02-business-model-pricing.md`. Never resurrect retired EUR figures (they are pre-2026-06-03 history).
6. Trademark rules from §1.3 apply to every asset, including social images and alt text.

### 2.3 Signature phrases (safe to reuse — from live site + listing copy)

- "Your Confluence page is already a backlog. Let it write itself." (hero)
- "The transcription tax" (the problem frame)
- "Your data, your key" / "Privacy by architecture, not by promise"
- "AI assists, humans decide" · "AI drafts; your team reviews and decides"
- "An entire spec in. A complete backlog out." (listing)
- "Work at the altitude of the page" · "spec-to-backlog engine" (positioning; see 04)
- "One capability, many Mondays" (use-cases header)
- "Turn a Confluence page into a sprint-ready Jira backlog — in minutes, reviewed by humans." (footer tagline)
- Trust strip items: "Runs on Atlassian Forge · Available on Atlassian Marketplace · Powered by Anthropic Claude · Bring-your-own-key"

### 2.4 CTA conventions

- Primary CTA text: **"Start for free"** → always the Marketplace listing URL (https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira), opened in a new tab.
- Secondary CTAs are ghost/outline: "See how it works" (/how-it-works), "View pricing" (/pricing).
- CTA support line pattern: short middot-separated trust facts, e.g. "Bring your own Anthropic API key · Managed through the Atlassian Marketplace" (pricing-specific clauses in that line: defer to 02).

---

## 3. Visual system

Two coordinated layers exist. Don't blend them carelessly:

| Layer | Where | Character |
|---|---|---|
| **Product-UI moodboard** | The Forge app (all 8 screens), product screenshots | Blue-on-white monochrome + glassmorphism, airy, light |
| **Website system** | spec2jira.com, OG/social cards | Dark-navy hero bands + light sections, brand blue→violet gradient |

### 3.1 Product-UI palette (the moodboard — authoritative for anything showing the app)

Mood in one line: **"Premium, calm, trustworthy, tech-forward — a blue-on-white monochrome with glass."** Airy whitespace, big confident navy headings, frosted glass cards over soft blue→white washes, quiet liquid/wave accents. Enterprise SaaS that feels modern and *light*, not dense and corporate.

Core swatches (darkest → lightest):

| Token | Hex | Role |
|---|---|---|
| navy | `#021024` | Display headings on light, deepest text, darkest gradient stop |
| deep blue | `#052659` | Secondary headings, strong accents |
| steel | `#5483B3` | Mid accents, muted active states, icon bodies |
| sky steel | `#7DA0CA` | Soft accents, borders-on-blue, glow tints |
| ice | `#C1E8FF` | Lightest fills, glass tints, hairlines |
| **action blue** | `#0c66e4` | Navigation buttons/links in the app (Atlassian-style blue; live app token, hover `#0055cc`) |

Signature gradient moves (describe-in-words for template creators):
- **Surface wash**: barely-there ice→transparent tint from the top-left of a card, so it feels lit.
- **Deep panel / hero band**: navy `#021024` → deep blue `#052659` → steel `#5483B3` diagonal, white text on top.
- **Glow**: a soft radial sky-steel glow at low opacity behind one focal element per region.

Glass recipe (the signature card): translucent white fill (~72% opacity) with an **ice→white gradient** so the glass stays visible on white; 1px sky-steel hairline border; soft **blue-tinted** shadow (never hard gray); **16px** card radius (10–12px inner controls, full-pill chips); generous padding (16–24px inside, 24–32px between sections). Backdrop blur is a nice-to-have only — legibility must never depend on it.

Layout principles: one idea per region; whitespace is a feature; content max-width ~1100–1180px; progressive disclosure for secondary detail.

### 3.2 Semantic color rules (app — never violate in product shots or UI mockups)

- **Green = commit/submit** (`#49cc90`) — Generate, Push, "Continue to Review".
- **Blue = navigate/open** (`#0c66e4`) — Back, Open, deep-links. Blue takes you somewhere; green changes something.
- **Red = destructive/danger** (`#f93e3e`) — delete/remove, irreversible warnings. An amber/orange tone exists for caution states.
- Pick color by INTENT of the action, not by screen.
- **Severity color goes on the ICON; the words stay dark.** Status text is never rendered in the alert color (WCAG AA on near-white glass). Traffic-light meaning: red triangle = error, amber = warning, blue circle-i = info, green check = success.
- Confidence/severity badges (✓ / ⚠ / ✗) are data signals — keep them semantic, don't restyle decoratively. The app's confidence accent is **teal** (the "trust" token), a convention that beat a one-off mockup green.

### 3.3 Website palette (spec2jira.com)

| Group | Tokens (hex) | Use |
|---|---|---|
| Ink scale (dark surfaces) | `#0B1526` (hero/footer bg, also the `theme-color`) · `#0F1D33` · `#16263F` · `#23364F` | Dark hero + dark feature bands |
| Brand | blue `#2684FF` · button blue `#1D6FE0` · on-dark link blue `#7DB3FF` · violet `#7C5CFC` | Accents, icons, links, primary buttons |
| **Brand gradient** | `linear-gradient(135deg, #2684FF → #7C5CFC)` | The "2" in the wordmark, gradient text, hero highlights |
| Light surfaces | white · mist `#F6F8FB` / `#EDF1F7` · border `#DDE3EC` | Alternating light sections, chips, wells |
| Text | `#101B2C` headings / `#3E4C61` body / `#64748B` muted; inverse `#F2F6FC` / `#A8B6CC` on dark | |
| Semantic | ok `#0E8A5F` · warn `#B25E09` · danger `#C4322E` · info bg `#EAF2FF` | Check/cross compare lists, notes |

Rhythm: dark navy hero → light sections alternating white/mist → a dark "for the whole team" band → dark footer. Soft blue-tinted shadows, radii 10/14/20px + pill, ~1140px container.

### 3.4 Which system for which marketing surface

- **Showing the product** (screenshots, UI mockups, feature walkthroughs) → moodboard layer; never repaint the app's semantic button/severity colors.
- **Brand-level surfaces** (social cards, ads, site banners, OG images) → website system (dark navy + `#2684FF→#7C5CFC` gradient + Space Grotesk headline).
- The two share DNA (deep navy + blue family); a social template that pairs a dark-navy card with a light glassy product screenshot inside it is on-brand.

---

## 4. Typography

### 4.1 Website (licensed, public-safe to name)

- **Display**: **Space Grotesk** (weights ~700–800, tight tracking) — headings, wordmark, stat numbers, prices.
- **Body**: **Inter** (1rem, line-height 1.7; leads 1.155rem/1.65).
- **Mono**: Cascadia Code / ui-monospace stack (code snippets).
- Both fonts are **self-hosted latin variable subsets under the SIL Open Font License 1.1** (OFL notice in-repo) — deliberately no third-party font requests. Safe to name publicly and to reuse in social templates.
- Scale feel: huge hero (clamp ~2.5–4.25rem, w800, lh 1.05), uppercase 0.8rem w700 "eyebrow" labels above sections.

### 4.2 Product UI — and the AKONY/Surgena rule

- The partner's moodboard references **AKONY** (bold geometric display) + **Surgena** (soft rounded sans). Both are paid fonts and are **EVOKED, NOT licensed or imported**. ⚠ **Public materials must never name them as "our fonts"** — describe the feel instead: *"bold geometric sans display; soft, comfortable sans body."*
- In the app the feel is achieved with the system sans stack: headings 700–800 weight, larger sizes, slightly tight letter-spacing (−0.01→−0.02em), navy `#021024`; body at comfortable sizes with line-height 1.5–1.6; labels min 12px.
- Anyone building "product-look" graphics outside the app: use a neutral geometric sans (or the site's Space Grotesk/Inter) — do not go buy/embed AKONY/Surgena for marketing collateral without a licensing decision.

---

## 5. Logo & marks

| Mark | Description | Status |
|---|---|---|
| **"S2" app mark** (favicon.svg) | Rounded square (radius ~23%), **`#2684FF`→`#7C5CFC` diagonal gradient fill**, white extrabold "S2" monogram, tight tracking | Live: site favicon + schema.org logo. The de-facto logo mark |
| **"Spec2JIRA" wordmark** | Text lockup in the display stack, w800: "Spec" in near-black ink (inverse on dark) · "2" filled with the brand gradient · "JIRA" in blue `#1D6FE0` (on dark: `#7DB3FF`) | Live in site nav + footer. Text-styled (CSS), not a drawn vector |
| **OG share card** (og-image.svg → .png) | 1200×630, dark navy `#1B2A4A`; S2 tile + "Spec2Tickets" label top-left; headline "Turn a Confluence spec into a sprint-ready **Jira backlog**." (highlight `#4C9AFF`); sub-line "Epic, stories, subtasks, acceptance criteria & dependencies — in minutes."; footer "Bring your own Anthropic key · Runs on Atlassian Forge · spec2jira.com" | PNG export EXISTS in-repo (1200×630, file dated 2026-07-15) |
| Marketplace app icon | Uploaded with the listing (checklist item marked done at the v5.3.0 resubmit, 2026-06-04) | On the live listing; source file location [GAP below] |

[GAP: no standalone logo package exists in either repo — no horizontal Spec2Tickets lockup, no monochrome/reversed variants, no press-kit folder; partner decides whether to commission one or bless favicon.svg + the CSS wordmark as the official set.]

---

## 6. Asset inventory + status (as of 2026-07-24, from the site + app repos)

| Asset | Location (site repo unless noted) | Status |
|---|---|---|
| favicon.svg | `/favicon.svg` | ✅ present, referenced by every page |
| og-image.svg (source) | `/og-image.svg` | ✅ present |
| **og-image.png 1200×630** | `/og-image.png` | ✅ **present** (verified 1200×630, ~140 KB, dated 2026-07-15) — the older "export pending" punch-list item is resolved in-repo. [verify: latest repo state pushed live — GAP] |
| OG + Twitter card meta | all pages | ✅ verified on landing + pricing (summary_large_image, canonical, og:image 1200×630); site-wide per the 2026-06-04 infra pass |
| sitemap.xml / robots.txt / 404.html | site root | ✅ present |
| Webfonts + license | `/assets/fonts/` (2 woff2 + OFL-NOTICE.txt) | ✅ present, OFL 1.1, self-hosted |
| Structured data | JSON-LD `Organization` + `SoftwareApplication` on the landing page | ✅ present (offers data → 02's lane) |
| Site pages | landing, /how-it-works, /pricing, /docs, /about, /get-api-key, /privacy, /dpa, /subprocessors, 404 | ✅ all present in repo (dpa/subprocessors unlinked from nav by design; see 09) |
| Marketplace screenshots + icon | vendor portal | Uploaded at the v5.3.0 resubmit (2026-06-04). [GAP: likely STALE vs the 2026-07 8-screen UI redesign — partner to verify the live listing images and recapture] |
| Current-UI marketing screenshots | — | [GAP: partner to capture on a clean demo site after the v6.6.0 release; the app UI changed substantially in the July redesign arc] |
| Moodboard source PDF | `Spec2Tickets_MoodboardWebDesign.pdf` (partner-held) | Referenced by the design system doc; not found in either repo [GAP: partner holds the file] |
| Demo video | — | [GAP: none found in sources; owner: partner] |

---

## 7. Cross-references

- Product facts & tech claims → `01-product-overview.md` · Pricing figures/wording → `02-business-model-pricing.md`
- Message architecture & positioning lines → `04-positioning-messaging.md` · Competitor contrast lines → `05-competitive.md`
- Screen-by-screen UI descriptions → `07-product-tour-8-screens.md` · Privacy/legal wording → `09-trust-security-compliance.md`
- Every reusable stat/claim → `13-claims-register.md`

---

## INTERNAL CONTEXT — never publish

- **Pricing-source conflict (route to 02, do not publish numbers from here):** the site pricing page carries a `v7 FLAT-FREEMIUM (2026-07-16)` change (plans: Free ≤10 users / flat "BYOK Pro" for 11+; "Advanced folded into BYOK Pro"), while the app's `src/usage.js` still shows the per-user Standard model ($6.70/user, ≤10 flat $57) and the KB brief matches usage.js. Until 02 reconciles which is live on the Marketplace portal, this chapter cites only the public plan NAMES. Also: the landing JSON-LD offers reflect the v7 model.
- **AKONY/Surgena** are paid fonts named only in the internal moodboard; the app never imports them (licensing + iframe weight). Never present them publicly as brand fonts; the OFL story (Space Grotesk/Inter, self-hosted, no third-party requests) is the public-safe typography narrative.
- **Copy drift to fix at next asset refresh:** og-image headline says "Confluence **spec**" while the hero standard is "Confluence **page**" (the anti-jargon rule); align when the OG card is next regenerated.
- The app's internal design-token names (`--s2j-*`), CSS file paths, kit component names (glassSurface, WizardKit, moodChips), and the Swagger-palette lineage are engineering detail — describe the look, not the implementation, in public materials.
- The moodboard rollout shipped app-wide at v6.5.0 (2026-06-28); the v6.6.0 release was committed and gate-green but pending the partner's production push at the last handover (2026-07-12). Don't reference internal version numbers publicly; the Marketplace listing shows its own version.
- Never include anywhere in marketing output: bank/payout details, tax or personal ID numbers, street addresses, dev-site names (spec2jira-dev, SCRUM-DEV), env-var names, enforcement modes, margins, or cost ceilings. Public founder facts are limited to: Aleks Asenov, sole trader, Sofia, Bulgaria; support hours "11:00–23:00 (Europe/Sofia), 7 days a week" (public on the site footer).
