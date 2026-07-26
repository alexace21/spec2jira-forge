# Spec2Tickets — Marketing Knowledge Base

The source of truth an AI marketing assistant loads before writing anything public about
Spec2Tickets. Built 2026-07-24. Owner: founder (Aleks Asenov) + Claude conductor.

⚠ **Internal. Do not publish this directory.** It lives in the forge repo deliberately — the
spec2jira.com repo is GitHub Pages, so anything committed there is public.

---

## 1. What is here

| File | Purpose | Visibility |
|---|---|---|
| `00-enterprise-use-cases-benefit-framing.md` | ⭐ Buyer-language layer: benefit categories + UC1–UC5 | mixed |
| `01-product-overview.md` | What it is; full feature inventory; E2E journey | public-safe |
| `02-business-model-pricing.md` | How we charge (confirmed model); free tier; ⛔ welcome credit status | mixed |
| `03-audience-icp-personas.md` | Who buys, who uses, pains, objections | public-safe |
| `04-positioning-messaging.md` | Category, message house, pitches, voice | public-safe |
| `05-competitive.md` | POPal / Storygenie / StoryLoop + comparison rules | mixed |
| `06-use-cases-workflows.md` | Scenarios, proof metrics, demo script | mixed |
| `07-product-tour-8-screens.md` | Screen-by-screen value story + content hooks | public-safe |
| `08-brand-voice-visual.md` | Naming, palette, assets, style | public-safe |
| `09-trust-security-compliance.md` | Data flow, scopes, retention honesty | public-safe (site-verbatim rule) |
| `10-roadmap-vision-story.md` | Origin story, timeline, vision | mixed |
| `11-faq-objections.md` | 20+ real Q&A | public-safe |
| `12-marketing-strategy-channels.md` | Funnel, channels, pillars, SEO, cadence | **internal** |
| `13-claims-register.md` | ⭐ **The honesty firewall** — approved / forbidden / internal-only | **internal (governs all output)** |
| `14-gaps-for-partner.md` | What only the founder can answer | internal |
| `TASK-MAP.md` | How this KB was built + refresh triggers | internal |

## 2. Load order for the assistant

1. **`13-claims-register.md`** — constraints first. Nothing gets written that Table A does not support.
2. **`00-enterprise-use-cases-benefit-framing.md`** — the buyer's own language for the value.
3. **`04` + `03`** — how we speak, and to whom.
4. **Task-specific chapters** — `01`/`06`/`07` for product content, `09` for privacy content,
   `05` for comparisons, `02`/`11` for pricing and objections, `12` for channel/format decisions.

## 3. Binding rules for every public artifact

1. **The firewall.** Every number, claim and superlative must trace to `13-claims-register.md`
   Table A. Not there → do not invent it. Ask, or write `[GAP: …]` and leave it out.
2. **Never publish an INTERNAL section.** Anything under `## INTERNAL CONTEXT — never publish`,
   plus all of `12` and `13`, is for reasoning only.
3. **Legal and privacy sentences are quoted, never drafted.** The live spec2jira.com pages
   (privacy / dpa / subprocessors) are the only authority. A paraphrase that sounds *stronger*
   than the site is a defect, not an improvement.
4. **⚠ Pricing: the founder's confirmed model is the authority — not the site, not the app code.**
   Confirmed **2026-07-24**, with the **tier table PORTAL-VERIFIED the same day** against the Atlassian
   partner-portal "Set pricing" screen. `02-business-model-pricing.md` and `13-claims-register.md` carry it:

   | User tier | Price per user / month | Max total for the band |
   |---|---|---|
   | **Up to 10 (flat)** | **FREE** | **$0** |
   | **1–100** — entered at the **11th** user, charged from the **first** | **$6.70** | up to **$670** (= 100 × $6.70) |
   | **101–250** | **$5.10** | up to **$1,435** |
   | **251–1000** | **$3.80** | up to **$4,285** |
   | **1001–2500** | **$3.50** | up to **$9,535** |

   …declining to **$1.15** at 45001+ (full table in `02` §3a). **Multi-instance = 1.5× the rate.**
   - **Up to 10 users: FREE** — every feature, no time limit. A real free tier, not a trial.
   - **From 11 users: per user, from $6.70, on a declining curve** — the rate drops as the instance
     grows. **It is not a flat site price.** Paid via Atlassian licenses the whole Confluence instance,
     so every user on the site counts — not only the people who use the app.
   - The most quotable consequence: **a 100-user instance is up to $670/month, NOT "$67 flat."** And
     never multiply a band rate by the full headcount — the curve is graduated.

   **Never quote:** **$67/month flat** (still on the live site — that page is **wrong and being
   corrected**), **"$5.70/user for 101+"** (a misread of the multi-instance column — the real rate is
   **$5.10**; claims register B19), **$57 flat ≤10** or **Advanced $13.40/user** (`src/usage.js` strings
   are stale; ≤10 is FREE now), or any EUR figure. When precision matters, use the approved fallback:
   *"The Marketplace always shows the exact price for your team size before you subscribe."*

   **⚠ Publication gate:** the figures are verified, but the **live pricing page has not been corrected
   yet**. Until it is, publish the *shape* and defer numbers to the fallback sentence; the moment the
   site is fixed, the exact figures are cleared with no further sign-off (`13`, rows A2.2/A2.2b/A2.2e).

   **⛔ The $5 welcome credit is NOT publishable.** Every user getting a one-time $5 of AI usage on
   our key — free tier included, BYOK afterwards — is the founder's **decision of 2026-07-24 with
   implementation pending**; the shipped code grants it **per install** and **only on a 30-day
   trial**. So no "$5 credit", no "start without an API key", no frictionless-onboarding angle,
   until the code ships **and** the founder confirms (13-claims-register.md, row B16).

   **Editions:** the Advanced edition was **folded into the single plan** — test cases and sprint
   planning are included at no extra cost. The Managed/no-key edition is **not advertised at all**;
   do not write "Managed is coming soon" — the site does not say it.
5. **Internal validation ≠ customer results.** We have no customer case studies yet. Numbers from
   our own dev instance are labelled as internal validation, with a date, or omitted.
6. **No invented customers, quotes, testimonials, logos or metrics.** Ever.
7. **Dates on aging facts.** Install counts, review scores, competitor prices and features carry
   "as of &lt;date&gt;", and are re-checked live on publication day.
8. **Competitors:** compare capabilities factually, never disparage, never quote a rival's rating
   without a date. `05` lists the forbidden claims (e.g. "the only BYOK app" is false).
9. **Trademarks:** "for Confluence and Jira", "built on Anthropic Claude" — descriptive use only.
   Never imply partnership, endorsement or certification by Atlassian or Anthropic.
10. **Language:** all public output in English. (Internal conversation with the founder is Bulgarian.)
11. **Honest-never-hype voice:** numbers over adjectives; "AI drafts, you decide"; never promise
    unreviewed AI output, guaranteed savings, or capability that is not shipped.

## 4. Output contract (what the assistant returns)

Every draft ships with a short **provenance block**: which KB files it drew on, which Table A claims
it used, and any `[GAP]` it hit. A draft that needs an unresolved gap is delivered with the gap
named — not with a plausible guess in its place.

## 5. Keeping it honest

`TASK-MAP.md` §5 lists the refresh triggers. The short version: any pricing or edition change, any
feature launch, any change to the site's legal pages, and a quarterly competitive + live-surface
re-check. **Stale KB → confidently wrong marketing**, which is worse than no marketing.
