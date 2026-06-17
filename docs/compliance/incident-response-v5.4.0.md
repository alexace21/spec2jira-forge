> v5.4.0 RECONCILIATION (DRAFT — pending [PARTNER: legal review]). Accurate for the breakdown-only release. The original draft file is UNCHANGED. Publish THIS version for v5.4.0. Research facts verified <session, June 2026>.

# Incident-Response Runbook — Spec2Tickets "Managed" Tier (v5.4.0)

> ⚠️ **DRAFT — [PARTNER: legal review].** This is an engineering-grounded, proportionate
> runbook for a **sole-trader** vendor. It is **not legal advice** and has not been reviewed
> by a qualified data-protection lawyer. It deliberately implies **no 24/7 SOC, no on-call
> rotation, and no dedicated security team** — the sole responder is the vendor. Have counsel
> confirm the breach-notification timing and the processor/controller split before relying on it.
>
> **Scope note (v5.4.0 = breakdown-only):** this release performs **spec → Jira breakdown only**.
> There is **no test-case generation**, **no scheduled orphan-cleanup sweep**, and **no
> delete-on-regenerate**. Retention/deletion mechanics referenced below are limited to what the
> breakdown-only code actually does (transient Forge KVS storage + best-effort purge on push).

---

## 1. Scope

This runbook covers a **confidentiality, integrity, or availability incident affecting Customer
Content processed under the Managed tier** — i.e. the tier in which the vendor calls the Anthropic
API using the **vendor's own Anthropic key** (the `MANAGED_ANTHROPIC_KEY`), rather than the
customer's BYOK key. "Customer Content" is the Confluence specification page content the customer
submits for a breakdown and the generated Jira breakdown returned for review.

- **In scope:** suspected or actual unauthorised access, disclosure, alteration, loss, or
  unavailability of Customer Content in the Managed flow; compromise of the Managed Anthropic key;
  an app vulnerability that could expose Customer Content.
- **Out of scope:** BYOK incidents (the customer's content goes to Anthropic under the customer's
  own agreement — the vendor is not the processor of that content); incidents wholly internal to
  Atlassian's or Anthropic's platforms (the vendor relays, but those providers own their own
  breach handling). Features **not present in v5.4.0** (test-case generation, orphan sweep) are not
  in scope because they do not exist in this release.

---

## 2. Detect — signal sources

Watch these signals; any one can start this runbook:

- **Anthropic security/incident notice** — a breach or security advisory from Anthropic affecting
  the vendor's Managed account (e.g. via trust.anthropic.com or account email).
- **Atlassian / Forge platform alert** — a security notice or advisory from Atlassian affecting the
  Forge runtime the app depends on.
- **Customer report** — a customer admin or security contact reports a suspected incident to the
  monitored **security@** / **privacy@** mailbox. **[PARTNER: confirm monitored]** — confirm the
  mailbox is actually watched and routes to the responder.
- **In-product diagnostics ledger trace** — the app's **in-product, no-egress** diagnostics trace
  (stored in the customer's own Forge KVS; no content leaves Atlassian) can surface anomalous
  failure patterns. Note: it records lengths/identifiers/status, **not** content, so it is a
  trigger-and-triage signal, not an evidence store of the data itself.

---

## 3. Assess

On a credible signal, triage quickly and proportionately:

- **Severity** — is Customer Content actually exposed/altered/lost, or is this a near-miss / availability blip?
- **Data categories affected** — what kind of data was in the affected breakdown(s)? (Typically
  free-text business spec content that may incidentally contain names, work emails, or role titles.
  Special-category data is contractually prohibited under Managed — see the DPA.)
- **Scope** — which customers / Atlassian instances are affected, and how many. (The Managed flow is
  per-instance; identify the affected instance(s) where possible.)
- **Is it a "personal data breach" under GDPR?** — i.e. a breach of security leading to accidental
  or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to Customer
  Content that contains Personal Data (GDPR Art. 4(12)). If **yes**, proceed to Notify (Section 4)
  on the controller-notification track. If **no** (no Personal Data, or no breach), record it
  (Section 6) and close.

---

## 4. Notify

The vendor acts as a **Processor** in the Managed tier; the customer is the **Controller**.

- **Vendor → Customer (processor's duty).** Notify the affected customer's **admin / security
  contact without undue delay** after becoming aware of a personal-data breach (GDPR **Art. 33(2)**).
  Use the customer's designated security/admin contact; **[PARTNER: fill — e.g. within 72 hours of
  becoming aware]** to align with the DPA's stated timeframe.
- **Contents of the notice** — to the extent known: the **nature** of the breach; the **categories**
  of data and approximate number of records/data subjects affected; the **likely consequences**; and
  the **measures taken or proposed** to address it and mitigate harm.
- **Customer (Controller) handles downstream notification.** The controller decides on and makes any
  **supervisory-authority notification (Art. 33)** and any **data-subject communication (Art. 34)**.
  The vendor's role is to give the controller the information it needs to do so — the vendor does
  **not** notify a supervisory authority or data subjects directly for content it processes as a processor.
- **Platform-origin breaches** — if the incident originated within Anthropic or Atlassian, relay the
  relevant provider information to the affected customer; those providers handle their own regulatory
  obligations.

---

## 5. Contain & remediate

Proportionate containment for a solo vendor:

- **Compromised Managed key** — if the `MANAGED_ANTHROPIC_KEY` is or may be compromised: **rotate it
  immediately** (revoke the old key at Anthropic, issue a new one, update the Forge encrypted secret /
  environment variable for the affected environment). In-flight Managed batches are bound to the
  creating key, so factor that into the rotation timing.
- **App vulnerability** — if the incident stems from a vulnerability in the app, fix it under the
  **Atlassian Marketplace Security Bug-Fix Policy**: remediate within **Atlassian's required
  timeframe for the vulnerability's severity** (**[PARTNER: confirm current SLA tier/timeframe]**
  against Atlassian's then-current policy), then deploy the fix to production.
- **Anthropic-side residual data** — Managed content sent via the **Message Batches API** is retained
  by Anthropic for **up to ~29 days** (the Batches API is **not** ZDR-eligible). The vendor may
  **proactively delete a batch after retrieving its results** to shorten that window; where containment
  warrants it, request deletion of affected batch data via Anthropic's deletion mechanism. The vendor
  cannot guarantee deletion faster than Anthropic's process allows, nor delete content Anthropic must
  retain for legal/abuse reasons.
- **Availability** — for a Forge/Atlassian platform outage, the remediation is largely Atlassian's;
  communicate status to affected customers and monitor the platform advisory.

---

## 6. Record

For accountability under GDPR Art. 33(5) (the processor's records), log each incident:

- **Date/time** detected and resolved.
- **Nature** of the incident and how it was detected.
- **Scope** — affected customers/instances, data categories, approximate record/data-subject count.
- **Assessment** — whether it was a personal-data breach and the reasoning.
- **Actions taken** — containment, remediation, key rotation, fix deployment.
- **Notifications** — who was notified, when, and what was communicated.

Keep this record (a simple log / dated file is sufficient for a solo vendor) so the breach decision
and the response can be evidenced on audit or to a customer.

---

## 7. Roles & contacts

- **Sole responder** — the vendor. There is **one** responder; this runbook assumes no on-call
  rotation, no SOC, and no separate security team. Proportionate for a sole-trader Forge app.
- **Security / privacy intake + escalation** — **[PARTNER: fill — security@ / privacy@ + escalation]**
  (the monitored mailbox(es) and the escalation path the vendor will actually follow).
- **EU/UK representative (Art. 27 GDPR), if applicable** — **[PARTNER: legal review — required only
  if the vendor is established outside the EU/UK and offers Managed to EU/UK data subjects; otherwise
  "Not applicable — Processor is established in the EEA."]**

---

### Document control
- **Status:** DRAFT — pending **[PARTNER: legal review]**.
- **Release:** v5.4.0 — **breakdown-only** (no test-case generation, no orphan-cleanup sweep, no
  delete-on-regenerate).
- **Scope:** Managed tier only. BYOK is unaffected and remains the privacy-maximising option.
- **Source of facts (verified this session, June 2026):** Anthropic Message Batches API = **29-day
  retention, not ZDR-eligible** (vendor may proactively delete a batch after retrieving results to
  shorten the window); Anthropic does not train on commercial/API data by default (vendor keeps
  feedback-based training OFF on its org); Anthropic's DPA + SCCs are auto-incorporated into its
  Commercial Terms (no separate signature); vendor→Anthropic transfer = **SCC Module 3
  (processor-to-processor)**, auto-incorporated; reselling permitted under Commercial Terms A.1
  ("power your own product"), no scale threshold. **Model caveat:** these retention facts are for a
  **Sonnet-via-Batches** pipeline — if the Managed model ever changes to a "Covered Model" (e.g.
  Fable 5 / Mythos 5 = 30-day, no-ZDR-ever) or to the **synchronous Messages API** (ZDR-eligible),
  re-check the retention claim. **[PARTNER: verify]** all external figures (incl. the Atlassian
  Security Bug-Fix SLA timeframe) against the providers' then-current published policies at publication time.
- **Companion documents:** `docs/compliance/DPA-managed-tier.md` (Section 12 breach clause),
  `docs/compliance/subprocessors.md`.
