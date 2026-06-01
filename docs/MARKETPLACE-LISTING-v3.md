# Spec2Tickets — Marketplace Vendor-Page Prep (v3.0.0)

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
| Listing version (public) | **3.0.0** |
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

### What's new in 3.0.0 (release notes)

> **Spec2Tickets 3.0.0 — Forge + BYOK.** A ground-up rebuild on Atlassian Forge with
> Anthropic Claude. Bring your own Anthropic API key — no self-hosted backend, no GPU,
> no infrastructure. New: interactive review editor with priority, story points, and
> labels; automatic cross-feature dependency links pushed to Jira; quality signals and
> a dependency overview before push; chunked push for large specs.

---

## 3. Pricing editions

Two paid editions configured per-instance (Marketplace handles billing; the customer
brings their own Anthropic key on every plan — the subscription covers the app only).

| Edition | Price | What it includes |
|---|---|---|
| **Free** | €0 | 3 breakdowns per month. Full editor, push to Jira, dependency links — no feature gating, only a monthly volume cap. |
| **Pro — Early access** | €39 / month (flat) | Unlimited breakdowns. Everything in Free with no monthly cap. *(Planned next iteration: per-seat ~€5/user above 10 users.)* |

**Portal notes:**
- Set Free as the default edition so install → 3 free breakdowns works with no purchase.
- The monthly cap resets on the 1st (UTC); enforcement is built into the app
  (`src/usage.js`), license-aware via `context.license.active`.
- **Pricing (DECIDED 2026-06-01):** €39/month flat early-access (was €20 — revised up:
  value-based, not cost-based). Per-seat (~€5/user) above 10 users is the next
  iteration. Frame introductory + grandfather early adopters.
- Enforcement mode is per-environment: **production = block** (freemium funnel),
  development = meter. Set the production env variable before go-live.

---

## 4. Privacy & security — listing fields

These are the data-handling fields in the listing form (mandatory for cloud apps).

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

- [ ] `forge deploy` the latest code (App.js + AdminSettings BG sweep, purgeJob).
- [ ] `forge install --upgrade` for **both** Confluence and Jira (manifest unchanged →
      only if needed).
- [ ] Site live: landing, /docs, /privacy reachable at spec2jira.com (HTTPS).
- [ ] Set production `ENFORCEMENT_MODE` (block) env variable.
- [ ] Upload public version **3.0.0**; fill listing copy (§2), highlights, what's-new.
- [ ] Configure pricing editions (§3): Free default + Pro €39 (early access; per-seat above 10 users next).
- [ ] Fill privacy/security listing fields (§4) + the questionnaire (§5).
- [ ] Select **Atlassian standard EULA**.
- [ ] Add screenshots (picker → editor → confirm/dashboard → Jira result) + an icon.
- [ ] **[YOUR CALL]** Have a lawyer/you review the privacy policy before go-live.
- [ ] Submit for review.
