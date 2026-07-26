---
title: "09 — Trust, Security & Compliance"
purpose: "Verified security/privacy/compliance facts for marketing use, plus the binding rule that all public legal wording is quoted verbatim from the live site."
visibility: mixed
sources:
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/privacy/index.html
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/dpa/index.html
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/subprocessors/index.html
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/docs/index.html
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/pricing/index.html (targeted grep — trial-credit wording only)
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/get-api-key/index.html (targeted grep)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/manifest.yml
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/docs/MARKETPLACE-LISTING-v3.md
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/src/trialCredit.js (targeted grep — trial-credit constants)
  - C:/Software Engineer/Success/Spec2Tickets/spec2jira-forge/CLAUDE.md (targeted sections — purge/sweep/egress/"Log End-User Data")
  - C:/Users/AlexAsenov/.claude/projects/C--Software-Engineer-Success-Spec2Tickets-spec2jira-forge/memory/compliance-source-of-truth.md
last_verified: 2026-07-24
---

# 09 — Trust, Security & Compliance

Trust is a primary buying argument for Spec2Tickets (see `04-positioning-messaging.md`, `05-competitive.md`): the pitch is "run your REAL, confidential specs" — which only works if every security sentence we publish is exactly true.

> **Source anchors used below:** `(privacy §N)` = spec2jira.com/privacy · `(dpa §N)` = spec2jira.com/dpa · `(subprocessors)` = spec2jira.com/subprocessors · `(docs)` = spec2jira.com/docs · `(manifest)` = forge repo manifest.yml. Site pages were read from the site repo (the deploy source) on 2026-07-24.

---

## RULE BOX — how the assistant may write about legal/compliance topics

> **BINDING for the AI marketing assistant:**
> 1. Legal, compliance, privacy, retention, GDPR, and DPA sentences may be **quoted VERBATIM from the live site only** (spec2jira.com/privacy, /dpa, /subprocessors, and the /docs "Data & privacy" section). Never re-draft them. Never "tighten" them.
> 2. **Never publish a claim stronger than the site's own wording.** If a paraphrase sounds more absolute than the source sentence (e.g. "zero retention", "never trains", "instantly deleted"), it is wrong — use the quote bank in this file or the exact site sentence.
> 3. If a sentence you need does not exist on the live site, do not invent it — write **[GAP: legal]** and escalate to the founder (who owns legal wording with lawyer review).
> 4. The forge repo's `docs/compliance/*` files are **STALE and forbidden** as a source (per the recorded partner correction, 2026-06-17). The live site repo is the only authoritative compliance source.
> 5. Approved short marketing phrasings (non-legal) live in `13-claims-register.md` — prefer those for social copy; fall back to the verbatim quotes here for anything legal.

---

## 1. The data-flow story (step by step, honest)

Public-safe. This is the whole lifecycle of a customer's content; every step is backed by the site or the manifest.

| # | Step | What happens | Where the content is | Whose credentials / permissions |
|---|---|---|---|---|
| 1 | Read the page | The app reads the Confluence page the user selects | Customer's own Atlassian instance | The signed-in user's own Atlassian permissions (`asUser`) — users "can only act on content they already have access to" (privacy §11) |
| 2 | Generate | Page content is sent to Anthropic's Claude (Message Batches API) | In transit over TLS to `api.anthropic.com` — the app's **only** configured network egress (privacy §7, manifest) | The **customer's own Anthropic API key** (BYOK); during the free-trial welcome credit, the vendor's own Anthropic account instead (privacy §2, #managed) |
| 3 | Store the result | The generated breakdown is stored transiently in Atlassian Forge Key-Value Storage | Inside the customer's own Atlassian instance, "encrypted and managed by Atlassian" (privacy §5) | Forge app storage (`storage:app` scope) |
| 4 | Human review | The user edits stories, ACs, dependencies, points, labels | Same Forge storage | n/a — nothing has touched Jira yet |
| 5 | Push to Jira | Epic + Stories + Subtasks + dependency links (and, via the planner, sprints) are created | Customer's Jira project | The signed-in user's own Jira permissions (`asUser`); the app **creates issues, never deletes** them (listing scope justification: "creates-only-never-deletes") |
| 6 | Cleanup on push | The stored page content and breakdown are removed from Forge storage | — | Automatic ("The App removes them when you push to Jira" — privacy §5) |
| 7 | Never pushed | Auto-removed after **7 days of inactivity**; opening it for review resets the timer | — | A scheduled daily sweep running against app storage only (privacy §5, manifest `scheduledTrigger`) |
| 8 | Anthropic's side | Batch inputs/outputs are deleted on Anthropic's schedule (see §3 below) | Anthropic (United States) | BYOK: the customer's own Anthropic agreement. Trial credit: the vendor's DPA + SCCs (dpa §13) |
| 9 | Uninstall | "Uninstalling the App removes all of its stored data." (privacy §5) | — | Atlassian platform |

**What there is NOT (public-safe, all sourced):**
- **No vendor backend.** "Spec2JIRA operates no server or database of its own, so it stores no content on Spec2JIRA-operated infrastructure." (privacy §2)
- **No other egress.** "The App sends data to no other external service. Its only configured network egress is to `api.anthropic.com`." (privacy §7)
- **No analytics/telemetry.** The app does not collect "User identities, usage analytics, or telemetry" (privacy §6); "The App collects no separate analytics or behavioural telemetry on end users." (dpa §8)
- **No content in logs.** "The App is designed so that end-user content is not written to Forge application logs (log statements record lengths, identifiers, and status, not content)." (dpa §8) Even the in-app support diagnostics feed stays inside the customer's own instance and records status/counts, not content (product behavior; consistent with dpa §8).
- **No key exposure.** The Anthropic API key sits in "Atlassian Forge encrypted secret storage, accessible only to the App's backend resolver and never exposed to the browser." (privacy §10)
- **No generation without a key path.** "If no Anthropic API key is configured, the App cannot generate a breakdown and no page content is sent beyond Atlassian." (privacy §4) (During the trial, the welcome credit provides that path — see §6.)

## 2. What the vendor never has (privacy §6 — quote directly)

Under BYOK, Spec2JIRA "does **not** receive, store, or have access to" (privacy §6):
- "Your Confluence page content or generated breakdowns — these stay within Atlassian Forge and are sent to Anthropic under your key."
- "Your Jira issue data."
- "Your Anthropic API key — held in Atlassian's encrypted Forge secret storage, resolver-only."
- "User identities, usage analytics, or telemetry — the App does not collect them."

## 3. Anthropic retention — the honest numbers (never strengthen these)

Two different site-verbatim figures exist for two different contexts. Do not mix them.

| Context | Site-verbatim claim | Source |
|---|---|---|
| **BYOK (customer's own key)** | "By default, Anthropic **does not use data submitted through its API to train its models**, and deletes API inputs and outputs within **around 30 days**; content flagged under its Usage Policy may be retained longer (up to about 2 years). Your own Anthropic agreement and retention settings govern this." | privacy §4 |
| **Managed processing (trial welcome credit)** | "Managed processing uses Anthropic's asynchronous Message Batches API, which is **not eligible for zero data retention**: batch inputs and outputs are retained by Anthropic for **up to about 29 days** and then deleted, except content Anthropic flags for trust-and-safety or legal reasons, which it may retain longer per its policy. We **do not** claim \"zero retention\" for managed processing." | privacy #managed |
| Same, DPA formulation | "The Batches API is not eligible for Zero-Data-Retention (ZDR); inputs and outputs of batch jobs are retained by Anthropic for up to approximately 29 days" | dpa §7.2 |
| Who governs it under BYOK | "Under the **Bring-Your-Own-Key (BYOK)** tier, the customer uses their **own** Anthropic key, and Anthropic is the customer's own processor under the customer's own agreement. Spec2Tickets engages no sub-processor for BYOK content." | subprocessors, callout |

**Positioning note (public-safe):** disclosing the 29-day figure instead of claiming "zero retention" is itself the trust story — the site says so: "We disclose this rather than claim zero retention. Customers who require zero or minimal retention should use the BYOK tier and configure their own Anthropic agreement accordingly." (subprocessors, callout)

### Paraphrase guardrails — approved vs forbidden

| Site-approved wording (quote this) | FORBIDDEN stronger version (never publish) |
|---|---|
| "By default, Anthropic does not use data submitted through its API to train its models" (privacy §4) | "Anthropic never trains on your data" |
| "not eligible for zero data retention ... up to about 29 days" (privacy #managed) | "zero data retention" / "deleted immediately" |
| "Spec2JIRA operates no backend and never receives your data on its own servers" (privacy meta/callout) | "Your data never leaves your Atlassian instance" (false — it goes to Anthropic) |
| "The App removes them when you push to Jira; a breakdown you never push ... is automatically removed after 7 days of inactivity, and opening it for review resets that timer." (privacy §5) | "Everything is wiped the instant you push" / "auto-deleted after 7 days" without the reset nuance |
| "Spec2Tickets does not claim SOC 2, ISO 27001, or other independent certification for its own operations" (dpa §8) | Any certification claim, including "SOC 2-grade", "ISO-level" |
| "deletes API inputs and outputs within around 30 days" (BYOK, privacy §4) | Swapping in the 29-day Batches figure for BYOK copy, or vice versa |

## 4. Scopes — least privilege, in plain English

From `manifest.yml` (repo, read 2026-07-24). 11 granular OAuth scopes; no classic catch-all Confluence content scopes (they were removed in a least-privilege pass, 2026-05-31 — CLAUDE.md). When any new scope is added, Atlassian forces a one-time admin re-consent in Manage Apps — scope changes cannot ride in silently (manifest comments; trust-positive fact).

| Scope | Plain-English why |
|---|---|
| `storage:app` | Forge Key-Value Storage inside the customer's instance: settings plus the transient breakdown/push-session state. |
| `search:confluence` | The page-picker's Confluence search (CQL). |
| `read:page:confluence` | Read the body of the one page the user selects (Confluence v2 API). |
| `read:confluence-user` | Resolve the page's last editor to a display name for the pre-flight "right page?" check ("v{n} · last edited {date} by {name}"). Degrades gracefully if the user's privacy settings hide the name; the name is never logged. (Added 2026-07-01 — manifest comment.) |
| `read:jira-work` | Read project metadata (issue types, fields) before creating anything. |
| `write:jira-work` | Create the Epic, Stories, Subtasks, and dependency links. |
| `read:board-scope:jira-software` | Planner: discover the project's Scrum board. |
| `read:project:jira` | Planner: also required by the Agile board-discovery endpoint. |
| `read:sprint:jira-software` | Planner: read existing sprints (so re-runs reuse instead of duplicate). |
| `write:sprint:jira-software` | Planner: create sprints and move issues into them. |
| `write:issue:jira-software` | Planner: required to move and rank issues into a sprint. |

**Framing lines (public-safe):**
- Every Confluence read and Jira write runs as the signed-in user (`asUser`) — "never a separate service account" (privacy §10).
- The app **creates** issues, sprints, and links; it **never deletes** customer Jira issues (listing scope justification: "creates-only-never-deletes" — CLAUDE.md 2026-06-01).
- Seeing two entries in Manage Apps is expected for a cross-product Confluence+Jira app (docs; listing doc §0).

## 5. Marketplace security posture

| Item | Fact | Source |
|---|---|---|
| Hosting | "Atlassian Forge (cloud) — no external backend"; pure Forge app, no remote host, no vendor-operated server/VM/container/database | listing doc §0, §5; dpa §8 |
| Egress | Single declared egress: `https://api.anthropic.com` (Forge manifest `permissions.external.fetch`) | manifest; listing doc §5 |
| Encryption | TLS/HTTPS in transit; Forge storage encrypted at rest by Atlassian; API keys in Forge encrypted secret storage | privacy §10; dpa §8 |
| Log End-User Data | The Marketplace listing answers **"No"** — and the app was engineered so that is literally true (log statements carry lengths/IDs/status, not content) | CLAUDE.md (listing answer + log-hygiene); dpa §8 |
| Third-party transmission | Listing answer: "Yes — one: Anthropic. ... No other external egress." | listing doc §4 |
| Certifications | "Spec2Tickets does **not** claim SOC 2, ISO 27001, or other independent certification for its own operations ... The App inherits the security posture of the **Atlassian Forge** platform; Anthropic maintains its own certifications as published at trust.anthropic.com." | dpa §8 |
| Breach notification | For Managed Processing: notify "without undue delay ... and in any event within 72 hours of becoming aware" | dpa §12 |
| International transfers | EU SCCs (Commission Decision 2021/914) + UK IDTA, "incorporated into the Anthropic Commercial Terms / Anthropic DPA"; Module Three (processor-to-processor) on the Spec2Tickets→Anthropic leg | dpa §13 |
| Security contact | security@spec2jira.com (monitored) — also the listed vulnerability-reporting channel | listing doc §0, §5; site footer |
| Privacy contact | privacy@spec2jira.com | privacy §14 |
| Published legal pages | spec2jira.com/privacy · spec2jira.com/dpa · spec2jira.com/subprocessors (DPA accepted "by incorporation by reference ... without a separate signature" — dpa §17) | site footer; dpa §17 |
| EULA | Atlassian's standard EULA (no custom terms) | listing doc §0 |
| Processor identity | Aleks Asenov, sole trader, Sofia, Bulgaria (public on the site/DPA). Governing law: Bulgaria (dpa §16). Do not publish the registered street address or any tax/personal ID in marketing material. | dpa §1, §16 |

- [GAP: legal — the LIVE Marketplace "Privacy & Security" tab answers cannot be read from any repo; the vendor portal is authoritative. The listing doc (§4–§5) is the reference copy only — partner should export/confirm the live answers before they are quoted publicly.]
- [GAP: Cloud Security Participant / Cloud Fortified participation is marked "[YOUR CALL]" in the listing doc with no recorded decision — founder decides; never claim a badge.]

## 6. The trial welcome credit (managed processing) — the compliance story

The 30-day Atlassian Marketplace trial includes a managed welcome credit: a new customer can generate breakdowns on the **vendor's** Anthropic account before adding their own key (see `02-business-model-pricing.md` for the commercial side).

- **Public wording:** the live legal pages call it "a small welcome credit" / "a limited welcome credit" — **the site never states a dollar amount**. The internal grant is $5 (see INTERNAL). [GAP: legal — whether the exact "$5" figure is approved for public marketing copy; until decided, use the site's own wording in public legal-adjacent contexts.]
- **Role change, disclosed:** during managed processing "You remain the data controller; **Spec2Tickets acts as a processor** on your instructions, and **Anthropic is our sub-processor** for the AI inference." (privacy #managed)
- **Scope of the DPA:** the published DPA "Applies to Managed Processing (during the free trial) only ... it ceases to apply once the customer uses their own Anthropic key." (dpa, header + scope callout)
- **Retention during trial:** the 29-day Batches disclosure applies (see §3) — never claim zero retention for trial runs.
- **The exit ramp is the privacy pitch:** "BYOK stays the privacy-maximising choice. If you need the strictest data posture — including configuring your own retention directly with Anthropic — use BYOK." (privacy #managed)
- **Sub-processor change notice:** "at least 30 days' prior notice" before adding/replacing a sub-processor, with an objection right (dpa §6.4; subprocessors page). Current sole content sub-processor: **Anthropic PBC** (Atlassian is listed for transparency as the hosting platform, not a disclosure recipient — subprocessors page).

## 7. Approved verbatim quote bank

Use these exactly, with attribution "spec2jira.com/privacy" (etc.) when quoting in long-form content.

1. "Spec2JIRA operates no server or database of its own, so it stores no content on Spec2JIRA-operated infrastructure." — privacy §2
2. "The App sends data to no other external service. Its only configured network egress is to api.anthropic.com." — privacy §7
3. "By default, Anthropic does not use data submitted through its API to train its models, and deletes API inputs and outputs within around 30 days; content flagged under its Usage Policy may be retained longer (up to about 2 years). Your own Anthropic agreement and retention settings govern this." — privacy §4
4. "If no Anthropic API key is configured, the App cannot generate a breakdown and no page content is sent beyond Atlassian." — privacy §4
5. "The App removes them when you push to Jira; a breakdown you never push, including one you regenerate away or leave to age, is automatically removed after 7 days of inactivity, and opening it for review resets that timer. Until removed, it remains only in your own Forge instance. Uninstalling the App removes all of its stored data." — privacy §5
6. "All access to Confluence and Jira uses Atlassian's asUser authorization — the App acts with the signed-in user's permissions, never a separate service account." — privacy §10
7. "Your Anthropic API key is stored in Atlassian Forge encrypted secret storage, accessible only to the App's backend resolver and never exposed to the browser." — privacy §10
8. "BYOK engages no Spec2Tickets sub-processor." — subprocessors (callout)
9. "Because the Managed Processing uses the Anthropic Batches API, content is retained at Anthropic for up to about 29 days. We disclose this rather than claim zero retention." — subprocessors (callout)
10. "Neither Spec2Tickets nor Anthropic uses your content to train AI models (Anthropic's commercial/API no-training default)." — privacy #managed
11. "Content is processed by Anthropic in the United States under Standard Contractual Clauses incorporated into Anthropic's commercial terms." — privacy #managed
12. "Spec2Tickets does not claim SOC 2, ISO 27001, or other independent certification for its own operations and does not represent that it holds any. The App inherits the security posture of the Atlassian Forge platform; Anthropic maintains its own certifications as published at trust.anthropic.com." — dpa §8
13. "Spec2Tickets operates no backend. Your page content is sent to Anthropic using your own API key, governed by your agreement with Anthropic — by default Anthropic does not train on API data and retains it only briefly. Page content and breakdowns are stored transiently in Atlassian Forge storage and removed after you push." — docs, "Data & privacy"
14. "The App collects no separate analytics or behavioural telemetry on end users." — dpa §8
15. "The only external destination for content is Anthropic (the sub-processor above). The app runs no separate vendor backend or database, and Spec2Tickets keeps no copy of customer content on any Spec2Tickets-operated system." — subprocessors

---

## INTERNAL CONTEXT - never publish

**Managed-edition compliance surfaces — current state (repo read 2026-07-24):**
- History: when the v6 "both editions BYOK" pivot dropped Managed as an offer (2026-06-18), the site's Managed compliance copy was HIDDEN with comment toggles (privacy #managed sections, footer /dpa + /subprocessors nav links) while the /dpa and /subprocessors page BODIES stayed live at their URLs (lawyer-approved, only unlinked).
- Now: the $5-trial-credit pivot (2026-07-11/12) required managed compliance again. As of the repo state read 2026-07-24, the toggles are FLIPPED BACK: privacy #managed is visible and reframed "during your free trial"; /dpa and /subprocessors were updated (both "Last updated: July 12, 2026") and are linked in every page footer. If a paid Managed/"Advanced" edition ships at editions Phase 2, its additional disclosures get re-activated the same way — flip toggles, never re-draft (compliance-source-of-truth memory).
- Residual stale spots inside the DPA: §10.2's parenthetical and the "Document control → Source of facts" line still carry PRE-sweep wording (their toggle comments to restore the 7-day-sweep phrase were never flipped). When quoting sweep/retention, prefer dpa §7.1, privacy §5, or the subprocessors page — not dpa §10.2.
- [GAP: whether the live spec2jira.com pages currently match this repo state (the repo auto-deploys on git push; push status is not verifiable offline) — partner confirms before any "as published at spec2jira.com/..." attribution.]

**Known copy-vs-behavior nuance (do not amplify the site claim):**
- The site says content is removed "when you push to Jira". Precisely: a FULL push purges the job; a PARTIAL push surgically purges the raw page snapshot but retains the derived breakdown data for up to 7 days so the push can be resumed, after which the sweep removes it. Adding this nuance to the site's DPA/privacy copy is a known deferred item ([GAP: legal — the partial-push retention sentence does not yet exist on the site]). Marketing must therefore quote the existing site sentence verbatim and never escalate it to "everything is deleted the moment you push".

**Trial-credit money-safety (why "bounded trial spend" is honest, but keep the mechanics internal):**
- The managed grant is $5 per install, lifetime, trial-only (`TRIAL_GRANT_USD` in `src/trialCredit.js`, env-overridable via `MANAGED_TRIAL_CREDIT_USD`). A hard spend ceiling defaults to 1.2x the grant (~$6; `MANAGED_HARD_CEILING_USD`, set to 6 on prod per partner decision), and a pre-flight blocker refuses any managed run whose estimate exceeds the remaining credit — the $5 is a real cap. Paid users are always BYOK; the vendor key is `MANAGED_ANTHROPIC_KEY`. None of these names/numbers are public.
- `ENFORCEMENT_MODE` (block/meter, per Forge environment) governs internal metering only — never mention publicly.

**Listing / scope history (internal):**
- The listing doc's §5 scope table lists only the original 5 scopes — STALE vs the 11-scope manifest (5 jira-software planner scopes added with v6.0.0, 2026-06-22, which triggered a live customer re-consent; `read:confluence-user` added 2026-07-01, re-consent due at whichever prod release first ships it). Update the portal questionnaire copy from the manifest, not from the listing doc, when it is next edited.
- Incident history (never public): the original Marketplace rejection (2026-05-27) was a Forge-Invocation-Token validation finding against the OLD self-hosted backend; the v3 Forge/BYOK rebuild removed the remote host entirely, which is why the "no backend" architecture exists. Also 2026-06-01: two content-derived log statements were tightened so "Log End-User Data: No" is literally true. Public framing is only the positive result ("Forge-native, no remote host, no content in logs") — never the rejection story.
- The forge repo `docs/compliance/*` files are stale drafts kept for history — forbidden as sources.

**Never in this KB or any output:** bank details (IBAN/SWIFT), tax/personal ID numbers, registered street addresses, dev-site names.
