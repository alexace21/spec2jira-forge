# Marketing KB — Task Map (Step 1 of the marketing campaign)

> **Goal.** Assemble a single, source-verified knowledge base (KB) about Spec2Tickets that an AI
> marketing assistant can rely on to produce public content. Step 2 (built ON TOP of this KB):
> (a) blog articles hosted on spec2jira.com, (b) social posts 2–3×/week.
>
> **Location:** `docs/marketing-kb/` in the forge repo. ⚠ Deliberately NOT in the site repo —
> spec2jira.com is GitHub Pages, so anything committed there goes PUBLIC. This KB is internal.
>
> Created 2026-07-24. Owner: founder (Alex) + Claude conductor.

---

## 1. Source territories (where the truth lives)

| # | Territory | Path / URL | What it holds | Authority level |
|---|-----------|-----------|---------------|-----------------|
| T1 | Forge repo docs | `docs/*.md` (29 files: MARKETPLACE-LISTING-v3, DESIGN-BRIEF-*, PLANNER-*, DESIGN-SYSTEM-MOODBOARD, IMPL-SPEC-STANDARD-TRIAL-CREDIT…) | listing copy, feature design briefs, acceptance records | High (product facts) |
| T2 | Repo code truth | `src/usage.js`, `manifest.yml`, `src/anthropic_client.js`, `README.md`, `CLAUDE.md` | **live pricing**, scopes, models, E2E story, full history | **Authoritative** for pricing/scopes/features |
| T3 | Project memory | `~/.claude/projects/...-spec2jira-forge/memory/*.md` (32 files) | monetization strategy, competitive landscape, launch state, trial credit, 8-screen redesigns, brand system | High (decisions + strategy) |
| T4 | Site repo (separate) | `...\MVP-roll-out\spec2jira-site\spec2jira-site\` — index, how-it-works, pricing, about, docs, get-api-key, privacy, dpa, subprocessors, 404 | **lawyer-approved public copy** — hero stats, pricing Q&A, legal | **Authoritative** for compliance/legal + public tone |
| T5 | Live web | https://spec2jira.com · https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira | what is actually published today | Verification only |
| T6 | This conversation | Campaign goals from the founder (2026-07-24) | Step 2 = blog on spec2jira.com + social 2–3×/wk | Directional |
| T7 | Founder-supplied enterprise framing (2026-07-24) | Benefit categories (Growth & Innovation / Operational Excellence) + UC1–UC4 verbatim | The buyer's own language for the value | **Authoritative** for buyer framing |

**Explicitly EXCLUDED:** `docs/compliance/*` (STALE — site repo supersedes, per memory
`compliance-source-of-truth`); the old `ai-delivery-platform` codebase (pre-pivot; its story is
already captured in CLAUDE.md); `node_modules`.

---

## 2. KB deliverable (the placeholders to fill)

13 chapters, one writer agent each; conductor owns README, this map, and the gaps file.

| File | Answers | Primary sources | Visibility |
|------|---------|-----------------|------------|
| `00-enterprise-use-cases-benefit-framing.md` ⭐ | Benefit categories + UC1–UC5 in the buyer's language; mapping UC → shipped capability | T7 (verbatim), T2 CLAUDE/planner, T3 planner + test-case memories | mixed |
| `01-product-overview.md` | What is Spec2Tickets; full feature inventory; how it works E2E | T2 README/CLAUDE/manifest/usage.js, T1 listing, T4 index/how-it-works | public-safe |
| `02-business-model-pricing.md` | How we charge; USD pricing; trial + $5 managed credit; grandfathering | **T2 usage.js**, T4 pricing, T3 monetization/trial-credit/launch-state | mixed |
| `03-audience-icp-personas.md` | Who buys/uses; pains; objections; anti-ICP | T1 listing + DESIGN-BRIEF-NEXT-SCREENS (audience fears), T4, T3 competitive | public-safe |
| `04-positioning-messaging.md` | Category ("spec-to-backlog engine"); message house; pitches; voice | T3 competitive, T1 listing, T4 site copy | public-safe |
| `05-competitive.md` | POPal / Storygenie / StoryLoop; moats; comparison guardrails | T3 competitive-landscape (as of 2026-06), optional T5 refresh | mixed |
| `06-use-cases-workflows.md` | Concrete scenarios + validated proof metrics; demo script | T2 CLAUDE/README, T3 planner/test-cases, T1 PLANNER-* acceptance | public-safe |
| `07-product-tour-8-screens.md` | Screen-by-screen value story; content hooks per screen | T3 seven *-redesign memories, T1 design briefs | public-safe |
| `08-brand-voice-visual.md` | Naming rules; palette; assets inventory; style | T1 DESIGN-SYSTEM-MOODBOARD, T3 moodboard/site-punchlist, T4 | public-safe |
| `09-trust-security-compliance.md` | Data-flow story; scopes; retention honesty; DPA pointers | **T4 privacy/dpa/subprocessors (verbatim)**, T2 manifest, T1 listing §security | public-safe (site-verbatim rule) |
| `10-roadmap-vision-story.md` | Origin story (pivot); shipped timeline; vision spec→backlog→plan | T2 CLAUDE handovers, T4 about, T3 product-improvements | mixed |
| `11-faq-objections.md` | 18–25 real Q&A incl. costs, 2-apps-in-Manage-Apps, data handling | T4 docs/pricing/get-api-key, T1 listing Q&A, T2 CLAUDE | public-safe |
| `12-marketing-strategy-channels.md` | Funnel; channels; content pillars; SEO seeds; cadence skeleton; metrics | T3 launch-state/migration-protections/monitoring, T4 structure, T6 goals | internal |
| `13-claims-register.md` ⭐ | **The honesty firewall**: approved claims / forbidden claims / internal-only facts | T2 usage.js, T4 hero stats, T3 all strategy memories | internal (governs public output) |
| `README.md` (conductor) | How the assistant must use the KB; load order; rules | — | internal |
| `14-gaps-for-partner.md` (conductor) | Everything only the founder can supply | aggregated [GAP] markers | internal |

---

## 3. Source-of-truth rules (binding for every writer)

1. **Pricing** = `src/usage.js` + site `/pricing`. USD only. Every € figure (4.90/9.90/20/29/39/49/69/99) is retired history.
2. **No in-app Free tier** (retired 2026-06-03). Evaluation = 30-day Atlassian trial + $5 managed trial credit.
3. **Compliance/legal wording** = site repo verbatim (privacy/dpa/subprocessors). Never re-draft. `docs/compliance/*` is stale.
4. **No personal/financial data** in the KB: no IBAN/SWIFT, no tax/personal IDs, no street addresses. Public founder facts only (Aleks Asenov, sole trader, Sofia, BG).
5. **Internal facts** (margins, ceilings, enforcement, incidents, dev sites) live only under `## INTERNAL CONTEXT — never publish`.
6. **Naming**: product = Spec2Tickets; vendor/domain = Spec2JIRA / spec2jira.com. Intentional split.
7. **Aging metrics** carry "as of <date>". Internal test results are labeled as internal validation, not customer outcomes.

## 4. Build process

Workflow (`marketing-kb-build`): **Write** (13 parallel chapter writers) → **Audit** (3 lenses:
accuracy vs sources · completeness/contradictions · publish-safety) → **Fix** (per-file skeptical
fixers for confirmed high/medium findings) → conductor pass (spot-read claims register + pricing,
write README + gaps file) → report to founder.

## 5. Refresh triggers (keep the KB honest over time)

- Any pricing/edition change (`src/usage.js` diff) → update 02, 11, 13 same day.
- Managed/Advanced edition goes live (editions Phase 2) → update 01, 02, 09, 11, 13.
- New feature ships → 01, 06, 07 (+ a launch post in Step 2).
- Quarterly: competitive refresh (05) + live-surface check (T5) + claims re-verification (13).
- Site legal pages change → re-sync 09 verbatim.
