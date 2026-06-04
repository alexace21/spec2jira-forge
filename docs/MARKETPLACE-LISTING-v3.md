# Spec2Tickets — Marketplace Vendor-Page Prep

> ⚠ **The live Marketplace listing is now configured in the vendor portal
> (resubmitted as v5.3.0, 2026-06-04, awaiting review).** This doc is the
> reference / source copy — keep it aligned with the portal. Source of truth for
> the launch state: `memory/marketplace-launch-state.md` + `memory/monetization-strategy.md`.

> Copy-paste source for the Atlassian Marketplace vendor portal: listing copy,
> pricing editions, and the security/privacy questionnaire answers. Every
> security claim here is grounded in the actual `manifest.yml` + the published
> privacy policy (spec2jira.com/privacy). Items marked **[YOUR CALL]** are the
> vendor's attestation/decision — verify before submitting.

---

## 0. Identity & naming

| Field | Value |
|---|---|
| Marketplace app name | **Spec2Tickets** |
| Vendor / partner name | **Spec2JIRA** |
| Listing version (public) | **v5.3.0** (resubmitted 2026-06-04, awaiting review) |
| Hosting | **Atlassian Forge (cloud)** — no external backend |
| Compatible products | **Confluence Cloud** (app UI) + **Jira Cloud** (push target) |
| App ID | `ari:cloud:ecosystem::app/e804f31f-1cbf-4f09-86c1-11e36f387fe7` |
| Website | https://spec2jira.com |
| Privacy policy | https://spec2jira.com/privacy |
| Documentation | https://spec2jira.com/docs |
| Support contact | support@spec2jira.com |
| Security / vulnerability contact | security@spec2jira.com |
| EULA | **Atlassian's standard EULA** (no custom terms) |

> **Cross-product note:** the UI lives in Confluence (globalPage) but the push
> uses `asUser().requestJira()`. The listing declares compatibility with BOTH
> products; customers install it in each. Two entries in "Manage apps" is normal
> and expected for a cross-product Forge app — the requested scopes explain why.

---

## 1. Categories

- **Primary:** Project management
- **Secondary:** Workflow

---

## 2. Listing copy

> **Positioning sharpened 2026-06-01** against direct competitors (POPal / Storygenie / StoryLoop):
> the copy now leads with our **altitude** (a whole spec — not a prompt or a single ticket),
> **depth** (hierarchy + dependencies + sizing — a backlog engineers can run), and **privacy**
> (BYOK = process your *real* specs under your own Anthropic agreement — the answer to rivals'
> "don't enter real data"). Rationale: `memory/competitive-landscape.md`. Apply on the next listing edit.

### Tagline (one line, ~80–120 chars)
> Turn an entire Confluence spec into a complete, dependency-aware Jira backlog — under your own AI key.

### Summary (search-result blurb, 2–3 sentences)
> Most AI tools expand a one-line prompt or enrich a single ticket. Spec2Tickets reads an
> *entire* Confluence specification and generates a complete Jira breakdown — Epic, stories,
> subtasks, acceptance criteria, story points, and cross-feature dependency links — using
> Anthropic's Claude. It runs entirely on Atlassian Forge with your own Anthropic API key
> (BYOK), so you can process your real, confidential specs with no vendor backend in between.

### Full description ("More details")

**An entire spec in. A complete backlog out.**

Most AI backlog tools start from a one-line prompt or enrich a single Jira ticket.
Spec2Tickets works at a higher altitude: point it at a whole Confluence specification and
Claude Sonnet 4.6 produces a complete, ready-to-work Jira breakdown — an Epic, stories,
subtasks, acceptance criteria, story-point estimates, and cross-feature dependency links —
which you review and edit before anything reaches Jira.

**Why teams choose Spec2Tickets**

- **From your spec, not from scratch.** It reads your approved specification — not a prompt
  you retype — so the backlog stays traceable to the source, with nothing important invented
  or dropped. Large, dense specs included.
- **Depth your engineers will thank you for.** Not a flat list: a real hierarchy (Epic →
  stories → subtasks) with acceptance criteria, story points, priority, category labels, and
  mapped blocks / is-blocked-by dependencies — a backlog your delivery team can actually pick
  up and run.
- **Your data, your key, your agreement.** Runs entirely on Atlassian Forge and calls Claude
  with *your own* Anthropic API key. No vendor backend, no GPU, no content routed through our
  servers — so you can run real, confidential specifications, governed by your own agreement
  with Anthropic, not fictional placeholders.
- **Human-in-the-loop review.** Every breakdown opens in an interactive editor: adjust stories,
  acceptance criteria, dependencies, priority, story points, and labels, then approve. AI
  assists; you decide. Nothing is created in Jira until you push.
- **Clean, one-click Jira output.** One Epic, stories with acceptance criteria and embedded task
  checklists, subtasks, and Story-blocks-Story links — created in your project under your own
  Atlassian permissions.

**How it works**

1. **Install & configure** — add Spec2Tickets, then paste your Anthropic API key and
   default Jira project key in Settings (~5 minutes, no infrastructure).
2. **Generate** — pick a Confluence spec page and click Generate. Claude produces a
   structured breakdown in about a minute or two.
3. **Review** — edit stories, acceptance criteria, dependencies, priority, story
   points, and labels inline.
4. **Push to Jira** — one Epic, stories, subtasks, and dependency links, created in
   your project with one click.

**Privacy by design.** Because the app has no backend and uses your own Anthropic API key,
your specification content goes straight from Atlassian Forge to Anthropic under your own
agreement — so you can run real, confidential specs through it, not sanitized placeholders.
Spec2JIRA operates no backend and never receives your content on its own servers. See the
full [Privacy Policy](https://spec2jira.com/privacy).

### Feature highlights (the 3–4 highlight cards)

| Title | Body |
|---|---|
| Spec → full backlog | An entire Confluence spec becomes an Epic, stories, subtasks, acceptance criteria, story points, and dependency links in ~1–2 minutes — not a flat list from a prompt. |
| Depth your devs will thank you for | Real hierarchy + mapped blocks / is-blocked-by dependencies + sizing — a backlog your delivery team can pick up and run, not raw bullet points. |
| Your data, your key | Runs entirely on Atlassian Forge with your own Anthropic API key and agreement. No vendor backend — run your real, confidential specs. |
| Human review, one-click push | Edit stories, ACs, dependencies, priority, and points in an interactive editor; nothing reaches Jira until you approve. |

### What's new (release notes)

> **Spec2Tickets — Forge + BYOK.** A ground-up rebuild on Atlassian Forge with
> Anthropic Claude. Bring your own Anthropic API key — no self-hosted backend, no GPU,
> no infrastructure. New: interactive review editor with priority, story points, and
> labels; automatic cross-feature dependency links pushed to Jira; quality signals and
> a dependency overview before push; chunked push for large specs.

> *(A managed, no-key edition — "Managed Pro / Advanced", where we run the AI — is
> planned as a post-launch editions phase; see §3.)*

---

## 3. Pricing editions

**Pricing model: Paid via Atlassian, per-user, USD** (Atlassian cloud is USD-only — no single flat fee;
the small-team 1-10 band is a flat floor). **Evaluation is the standard 30-day Atlassian trial**
(auto-provided for Paid-via-Atlassian apps) — there is **no in-app free tier** (it was removed
2026-06-03); an unlicensed user is admitted only as a trial or paid subscriber.

> ⭐ **Two-edition plan, shipped in PHASES** (set in the portal 2026-06-04). The Marketplace platform
> caps an app at two editions, but editions are a **post-publish** capability: Atlassian only lets you
> create app editions once the app is **Paid via Atlassian AND live on Marketplace**, so the resubmit
> ships **BYOK Pro as a SINGLE edition (= Standard)**, and **Managed Pro (= Advanced) is added AFTER
> approval** as "editions Phase 2". The two-edition framing below is the end state; only BYOK Pro is live now.

| Edition | Price | Status | What it includes |
|---|---|---|---|
| **BYOK Pro — "Standard"** | **$6.70 / user / month** ("100% of Confluence price" preset) · **$57 / month for 1-10 users** (flat floor) · declining curve above 100 users · **1.5× multi-instance multiplier** | **LIVE** (in the v5.3.0 resubmit) | **Unlimited** breakdowns. The customer brings their own Anthropic key (the subscription covers the app only — process your real spec under your own Anthropic agreement). |
| **Managed Pro — "Advanced"** | **TBD ~$10-13 / user / month** (~1.5-2× BYOK) | **Editions Phase 2** — added post-approval, NOT in this resubmit | **We run the AI — no key to manage.** Fair-use **10 breakdowns per user / month** (metered per user, not pooled). Everything in BYOK Pro. |

**Portal notes:**
- **BYOK Pro (Standard) — the live single edition.** Price = the **"100% of Confluence price"** preset
  → **$6.70/user** (1-100 band), **$57 flat for ≤10 users**, the 100% **declining curve KEPT** (e.g.
  101-250 ~$5.10, 251-1000 ~$3.80), **multi-instance multiplier 1.5×**. ⚠ **KEEP the declining curve —
  never flatten it:** Paid-via-Atlassian bills the *whole* Confluence instance (ALL users, not just app
  users), so a flat per-user price prices out every 100+ user instance; the decline only kicks in above
  100 users (the ≤100 target pays $6.70 either way). The earlier flat-€39 / €4.90 figures are retired.
- **`editionsEnabled: true`** is kept in the manifest (the publish wizard accepted it alongside the single
  price). Edition is resolved at runtime via `context.license.capabilitySet` (`capabilityStandard` →
  BYOK Pro, `capabilityAdvanced` → Managed Pro); `resolveTier` safely **defaults an undefined
  capabilitySet → BYOK Pro** (`src/usage.js`), so the single-edition launch resolves correctly. There is
  **no $0 Free edition** (a free edition cannot coexist with paid ones, and the in-app Free tier was removed).
- **Managed Pro (Advanced) — editions Phase 2 (post-publish).** Price TBD ~$10-13/user (~1.5-2× BYOK).
  Fair-use cap = 10/user/month, env-tunable (`MANAGED_USER_CAP`), enforced in `block` mode; a Managed user
  at the cap is routed to BYOK Pro (unlimited), not "subscribe to a higher tier" (resets the 1st, UTC).
  **Compliance gate:** Managed processes content under OUR Anthropic key → it ships WITH the customer DPA +
  the ≤29-day Anthropic (Batches) retention disclosure + privacy "Managed" sections + sub-processor list
  (see `docs/compliance/`) + a separate editions review. BYOK Pro is uncapped (the customer's own key pays compute).
- Frame **"Early Access"** + grandfather early adopters (see `memory/migration-protections.md`) — chose the
  higher 100%-of-Confluence price for value-capture + premium signal ("easier to lower / grandfather than raise").
- Enforcement mode is per-environment: **production = block** (governs the future Managed fair-use cap;
  BYOK is unlimited), development = meter. Set the production env variable before go-live.

---

## 4. Privacy & security — listing fields

These are the data-handling fields in the listing form (mandatory for cloud apps).

> **Scope:** the answers below describe the **BYOK Pro (Standard)** edition shipping in the v5.3.0
> resubmit — content goes to Anthropic under the **customer's own** key/agreement, and Spec2JIRA stores
> nothing on its own systems. When **Managed Pro (Advanced)** is added (editions Phase 2), content is
> processed under **our** Anthropic key → those privacy answers gain the Managed disclosures (Anthropic =
> sub-processor, ≤29-day Batches retention, SCCs, a customer DPA); see §3 and `docs/compliance/`.

| Question | Answer |
|---|---|
| Privacy policy URL | https://spec2jira.com/privacy |
| Does the app store data outside the Atlassian cloud? | **No.** The app runs on Atlassian Forge and stores data only in Forge storage within the customer's instance. Its only external egress is to `api.anthropic.com`, using the customer's own Anthropic API key — Spec2JIRA operates no backend and stores nothing on its own systems. |
| Does the app transmit data to third parties? | **Yes — one:** Anthropic. To generate a breakdown, the selected page content is sent to the Anthropic API (`api.anthropic.com`) authenticated with the **customer's own** API key; processing is governed by the customer's agreement with Anthropic. No other external egress. |
| Security contact / vulnerability reporting | security@spec2jira.com |
| Data residency support | App logic runs on Atlassian Forge per the instance's region; AI processing occurs in the customer's Anthropic API region. No Spec2JIRA-operated datastore. |

---

## 5. Security Self-Assessment — draft answers

> For the security questionnaire shown at submit-for-review. Answers are grounded in
> `manifest.yml` and the privacy policy. **[YOUR CALL]** items are the vendor's own
> process/attestation — confirm they are true before you submit.

**Architecture & hosting**
- The app is a **pure Atlassian Forge app**. All backend logic runs in Forge's managed
  runtime (`nodejs24.x`, Forge-hosted). There is **no vendor-operated server, VM,
  container, or database.**
- The only declared external egress is **`https://api.anthropic.com`** (in the Forge
  manifest `permissions.external.fetch`).

**Data stored & where**
- Stored only in **Atlassian Forge storage (KVS)** inside the customer's own instance:
  (1) the customer's Anthropic API key and default Jira project key; (2) transient page
  content + the generated breakdown + the push session, to drive the review-and-push flow.
- The **Anthropic API key is held in Forge encrypted secret storage** (resolver-only
  access; never returned to the browser).

**Data in transit / at rest encryption**
- In transit: **TLS/HTTPS** for all Atlassian API calls and for the call to
  `api.anthropic.com`.
- At rest: Forge storage is **encrypted and managed by Atlassian**; the API key uses
  Forge **encrypted secret** storage.

**Authentication & authorization**
- All Confluence reads and Jira writes use **Atlassian `asUser()`** — the app acts with
  the **signed-in user's own permissions**, never a separate service account or shared
  credential. Users can only act on content they already have access to.
- Admin-only configuration (API key, default project key) is set via Confluence
  **Settings → Spec2Tickets** (globalSettings module).

**Requested scopes (least privilege) — from manifest.yml**
| Scope | Why |
|---|---|
| `storage:app` | Forge KVS for settings + transient breakdown/session state. |
| `search:confluence` | CQL page search in the page picker. |
| `read:page:confluence` | Read the selected page body (Confluence v2 API). |
| `read:jira-work` | Read project metadata (issue types, fields) before creating issues. |
| `write:jira-work` | Create the Epic, stories, subtasks, and dependency links. |

**Sub-processors / third parties**
- **Atlassian** — hosts the Forge app and stores its data within the customer's instance.
- **Anthropic** — processes the page content the customer chooses to send, under the
  **customer's own API key and agreement**. No other sub-processor.

**Data retention & deletion**
- Page content + generated breakdown + push session are **transient** and removed after
  push (`purgeJob`). Uninstalling the app removes all of its Forge-stored data.
- The customer can clear the stored API key and settings at any time from the Settings page.

**PII & telemetry**
- The app collects **no user identities, analytics, or telemetry.** Customer page content
  may contain the customer's own data; it is processed under the customer's Anthropic
  agreement and never stored by Spec2JIRA.

**Platform security posture**
- The app inherits Atlassian Forge's platform security (managed runtime, tenant isolation,
  egress control via manifest allow-list, encrypted storage). It declares only the scopes
  and the single egress endpoint above.

**Vendor process — [YOUR CALL] confirm/complete before submitting**
- Vulnerability reporting channel: **security@spec2jira.com** (confirm the mailbox/alias is monitored — may forward to the same inbox as support@).
- Incident-response / breach-notification process you commit to.
- Who has access to the Atlassian developer account that deploys the app, and how it's
  protected (MFA on the Atlassian account).
- Whether you'll pursue the Atlassian **Cloud Security Participant / Cloud Fortified**
  badge (the longer annual self-assessment) now or post-launch.

---

## 6. Pre-submission checklist

> Status: the items below were DONE for the **v5.3.0 resubmit (2026-06-04)** — kept as the reusable
> runbook. ⚠ A **licensed (Paid-via-Atlassian) app installs via Marketplace ONLY** — there is **no
> `forge install` on production** (`forge deploy -e production` auto-creates the Marketplace version;
> `forge install --upgrade` / `--license` are **dev-only**). The old "`forge install --upgrade` for both
> products on prod" step is WRONG for a licensed app.

- [x] `forge deploy -e production` the latest code (auto-creates the Marketplace version).
- [x] Resolve the Paid-via-Atlassian "more than one parent software" error: **vendor portal → app →
      [version] details → Compatibility tab → remove Jira** (Confluence = the SOLE billing parent). This
      was the fix — NOT a manifest change. (Jira stays an optional installed *connection* for the push —
      `write:jira-work` via `asUser().requestJira`; the push needs the Jira install, gotcha #10 holds.)
- [ ] Site live: landing, /docs, /privacy reachable at spec2jira.com (HTTPS). ⚠ **Open follow-up:** the
      `spec2jira.com/docs` pricing still shows stale figures — update it to **$6.70 / 100%-of-Confluence**
      and drop the dead "Free 3/mo" (the site is a GitHub Pages repo, separate from this one).
- [x] Set production `ENFORCEMENT_MODE` (block) env variable.
- [x] Upload the public version (v5.3.0); fill listing copy (§2), highlights, what's-new.
- [x] Configure pricing (§3): **Paid via Atlassian**, **single edition for the resubmit — BYOK Pro
      "Standard" = $6.70/user** ("100% of Confluence price"; $57 ≤10 flat; declining curve; 1.5× multi).
      **No Free edition** — evaluation is the 30-day Atlassian trial. **Managed Pro "Advanced" is editions
      Phase 2** (post-publish; TBD ~$10-13/user). (`editionsEnabled: true` kept in the manifest.)
- [x] Fill privacy/security listing fields (§4) + the questionnaire (§5).
- [x] Select **Atlassian standard EULA**.
- [x] Add screenshots (picker → editor → confirm/dashboard → Jira result) + an icon.
- [ ] **[YOUR CALL]** Have a lawyer/you review the privacy policy before go-live.
- [x] Submit for review (resubmitted 2026-06-04 → awaiting Atlassian review).
