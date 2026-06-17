# Data Processing Addendum — Spec2Tickets "Managed" Tier

> ⚠️ **[PARTNER: legal review]** — This is an engineering-grounded DRAFT prepared by the
> vendor team. It is **not legal advice** and has **not** been reviewed by a qualified
> data-protection lawyer. Before you publish it, link it from the Marketplace listing, or
> rely on it with any customer, have counsel in your governing jurisdiction review the
> entire document — especially the bracketed `[PARTNER: fill]` legal/contract values, the
> liability and indemnity placeholders, and the SCC module selection. Do not present this
> as a binding agreement until that review is complete.

---

## 0. Why this DPA exists (plain-English orientation — not part of the contract)

Spec2Tickets offers two ways to generate a Jira breakdown from a Confluence spec:

- **BYOK (Bring Your Own Key) — the privacy-maximising option.** The customer supplies
  their **own** Anthropic API key. The customer's spec content goes from Atlassian Forge
  straight to Anthropic **under the customer's own agreement with Anthropic**. In that
  model Spec2Tickets operates no backend and is **not** a processor of the content sent to
  Anthropic — the customer's relationship is directly with Anthropic. **This DPA is not
  required for BYOK.**

- **Managed — covered by this DPA.** The customer does not supply a key. Instead,
  **Spec2Tickets calls the Anthropic API using Spec2Tickets' own Anthropic account** to
  process the customer's spec content. In this model Spec2Tickets **is a processor** acting
  on the customer's instructions, and **Anthropic is Spec2Tickets' sub-processor**. This
  Addendum governs that processing.

If a customer wants the strictest data-handling posture, **BYOK remains available** and is
the recommended choice; under BYOK no customer content is processed under the vendor's
account.

---

## 1. Parties, structure, and order of precedence

This Data Processing Addendum (**"DPA"**) supplements and forms part of the agreement under
which **[PARTNER: fill — legal entity name]** (**"Spec2Tickets"**, **"we"**, **"Processor"**)
provides the Spec2Tickets Forge application (the **"App"**) to the customer that has enabled
the **Managed tier** (**"Customer"**, **"Controller"**). That underlying agreement is the
Atlassian Marketplace end-user license / terms of service applicable to the App (the
**"Principal Agreement"**).

- **Spec2Tickets legal entity:** [PARTNER: fill — registered entity name and form; note: the
  current Marketplace payout record lists an *individual* (Tax ID = EGN). Confirm whether the
  contracting party is an individual sole trader or an incorporated entity, and state it here.]
- **Registered address:** [PARTNER: fill]
- **Data-protection / privacy contact:** [PARTNER: fill — e.g. privacy@spec2jira.com or
  security@spec2jira.com]
- **EU/UK representative (Art. 27 GDPR), if applicable:** [PARTNER: legal review — required
  only if Spec2Tickets is established outside the EU/UK and offers the Managed tier to
  EU/UK data subjects. If not applicable, state "Not applicable — Processor is established
  in the EEA."]

**Order of precedence.** This DPA applies **only** to Customer's use of the **Managed tier**.
In the event of a conflict between this DPA and the Principal Agreement **on the subject of
the processing of Personal Data**, this DPA prevails. On all other matters the Principal
Agreement prevails. Nothing in this DPA limits any rights the Customer has directly against
Atlassian or Anthropic under their respective terms.

---

## 2. Definitions

Capitalised terms not defined here have the meaning given in the **EU General Data
Protection Regulation 2016/679 ("GDPR")** and, where applicable, the **UK GDPR** and the
**Data Protection Act 2018**.

- **"Applicable Data Protection Law"** — all data-protection and privacy laws applicable to
  the processing under this DPA, including the GDPR, the UK GDPR, and any implementing or
  successor legislation. [PARTNER: legal review — add CCPA/CPRA terms if you knowingly serve
  California businesses under Managed; this draft is GDPR/UK-GDPR-first.]
- **"Controller"**, **"Processor"**, **"Sub-processor"**, **"Data Subject"**, **"Personal
  Data"**, **"Processing"**, **"Personal Data Breach"** — as defined in the GDPR.
- **"Customer Content"** — the Confluence specification page content and any related text the
  Customer (through its authorised users) submits to the App for processing under the Managed
  tier, together with the Jira breakdown generated from it, to the extent any of the foregoing
  contains Personal Data.
- **"Managed tier"** — the App tier in which Spec2Tickets, using its own Anthropic account and
  API key, calls the Anthropic API to generate a breakdown from Customer Content (as distinct
  from the BYOK tier, in which the Customer uses its own Anthropic key).
- **"Sub-processor"** — any third party engaged by Spec2Tickets to process Customer Content on
  its behalf in connection with the Managed tier. The sole Sub-processor at the effective date
  is identified in Section 6 and at **[PARTNER: fill — public sub-processor URL,
  e.g. https://spec2jira.com/subprocessors]** (see `docs/compliance/subprocessors.md`).
- **"Standard Contractual Clauses" / "SCCs"** — (a) for EU transfers, the clauses approved by
  Commission Implementing Decision (EU) 2021/914 of 4 June 2021; and (b) for UK transfers, the
  UK International Data Transfer Addendum to the EU SCCs ("UK Addendum") issued by the ICO.

---

## 3. Roles of the parties

- The **Customer is the Controller** of Customer Content. The Customer determines the purposes
  and means of the processing (it decides which spec pages to submit and what they contain).
- **Spec2Tickets is a Processor**, processing Customer Content only on the Customer's documented
  instructions for the purpose of providing the Managed tier.
- **Anthropic PBC is Spec2Tickets' Sub-processor** for the Managed tier (AI inference). With
  respect to the content Spec2Tickets sends it under the Managed tier, Anthropic acts as a
  processor; Anthropic's own terms govern that relationship (Section 6).
- Where the Customer is itself a processor for an upstream controller, the Customer warrants it
  has the authority to engage Spec2Tickets as a sub-processor on those terms, and this DPA
  applies *mutatis mutandis* with the Customer in the processor role.

---

## 4. Subject-matter, nature, purpose, duration, and scope of processing

This Section is the **Annex / Description of Processing** required by Art. 28(3) GDPR.

| Element | Description |
|---|---|
| **Subject-matter** | Processing of Customer Content to generate a structured Jira backlog from a Confluence specification, using AI inference, under the Managed tier. |
| **Nature of the processing** | Collection (receipt of the selected page content from Atlassian Forge), transient storage, transmission to the Sub-processor (Anthropic) for inference, generation of a breakdown (Epic, stories, subtasks, acceptance criteria, story points, dependency links), return to the Customer for human review, and deletion. No profiling, no automated decision-making producing legal/similar effects on Data Subjects within the meaning of Art. 22 GDPR. |
| **Purpose** | Solely to provide the Managed-tier breakdown feature requested by the Customer. **No** use of Customer Content for product analytics, marketing, or model training (Section 9). |
| **Duration** | For the term of the Customer's use of the Managed tier, and only for as long as needed to perform each breakdown, subject to the retention and deletion terms in Section 7. |
| **Categories of Data Subjects** | Determined by the Customer. Typically: the Customer's employees, contractors, and project stakeholders referenced in a specification. The App is **not** designed for, and the Customer should **not** submit, special-category data (Art. 9) or children's data. |
| **Categories of Personal Data** | Determined by the Customer and limited to whatever Personal Data the Customer chooses to include in a submitted spec page — typically free-text business/product specification content that may incidentally contain names, work email addresses, role titles, or other identifiers. The Customer controls and should minimise this. |
| **Special-category data** | Not contemplated. **[PARTNER: legal review]** — if any customer intends to submit special-category data under Managed, additional Art. 9 safeguards and explicit instructions are required; the recommended position is to prohibit it (Section 5.4) and direct such customers to BYOK. |
| **Frequency** | On-demand, each time an authorised Customer user runs a Managed-tier breakdown. |

---

## 5. Obligations of Spec2Tickets as Processor (Art. 28(3))

### 5.1 Processing on documented instructions
Spec2Tickets processes Customer Content **only** on the Customer's documented instructions,
including with regard to international transfers, unless required to do otherwise by EU/Member-
State or UK law to which Spec2Tickets is subject (in which case Spec2Tickets will inform the
Customer of that legal requirement before processing, unless the law prohibits it on important
grounds of public interest). The Customer's instructions are: (a) this DPA; (b) the Principal
Agreement; and (c) the Customer's configuration and use of the App (each Managed-tier
generation the Customer initiates is an instruction to process the selected content for that
breakdown). Spec2Tickets will inform the Customer if, in its opinion, an instruction infringes
Applicable Data Protection Law.

### 5.2 Confidentiality
Spec2Tickets ensures that persons authorised to process Customer Content are bound by an
appropriate duty of confidentiality. **[PARTNER: verify]** that everyone with access to the
deploying Atlassian developer account and to the Managed Anthropic account is under a written
confidentiality obligation.

### 5.3 Security
Spec2Tickets implements appropriate technical and organisational measures under Art. 32 GDPR,
as described in Section 8.

### 5.4 No special-category / prohibited data instruction
The Customer instructs Spec2Tickets to process **only** ordinary Personal Data. The Customer
agrees **not** to submit special-category data (Art. 9), criminal-offence data (Art. 10),
payment-card data, or any data subject to heightened regulatory regimes via the Managed tier,
and to use the BYOK tier (or to redact) where such data may be present. Spec2Tickets does not
inspect content for, and cannot guarantee detection of, such data.

### 5.5 Sub-processing
Section 6.

### 5.6 Assistance with data-subject rights
Section 10.

### 5.7 Assistance with controller obligations
Taking into account the nature of the processing and the information available to it,
Spec2Tickets assists the Customer in ensuring compliance with Arts. 32–36 GDPR (security,
breach notification, data-protection impact assessments, and prior consultation), as further
described in Sections 8, 10, and 12.

### 5.8 Deletion or return at end of services
Section 7.4.

### 5.9 Records and demonstrable compliance
Spec2Tickets makes available to the Customer the information necessary to demonstrate
compliance with Art. 28 and contributes to audits as described in Section 11.

---

## 6. Sub-processors (Art. 28(2), 28(4))

### 6.1 General authorisation
The Customer provides a **general written authorisation** for Spec2Tickets to engage
Sub-processors for the Managed tier, subject to the change-notice and objection rights below.

### 6.2 Current Sub-processors (effective date)

| Sub-processor | Role / purpose | Processing location | Terms / safeguards |
|---|---|---|---|
| **Anthropic PBC** (Anthropic, the maker of Claude) | AI inference for the Managed tier: receives the Customer Content sent for a breakdown and returns the generated breakdown. | United States; Anthropic's then-current sub-processor and processing regions apply. **[PARTNER: verify]** the region/configuration of the Managed Anthropic account and state it here. | Anthropic Commercial Terms of Service, into which **Anthropic's Data Processing Addendum and the EU SCCs are incorporated by reference** (no separate signature). Anthropic's own sub-processors and a 15-day change-notice are published at **trust.anthropic.com**. |
| **Atlassian** (platform) | Hosts the App (Atlassian Forge) and stores the App's data within the Customer's own Atlassian instance. | Per the Customer's Atlassian instance region. | Governed by the Customer's existing agreement with Atlassian. Atlassian is the platform on which the App runs; for the Managed tier it is **not** an additional content-disclosure recipient beyond the Customer's own instance. |

> **Note on Atlassian's role.** Forge data is stored *within the Customer's own Atlassian
> instance*, so Atlassian is not a recipient to whom Spec2Tickets *discloses* Customer Content
> in the Managed flow in the way Anthropic is. It is listed for completeness and transparency.
> The materially relevant Sub-processor for the Managed tier is **Anthropic PBC**.

The authoritative, public Sub-processor list is maintained at
**[PARTNER: fill — public URL]** (source file: `docs/compliance/subprocessors.md`).

### 6.3 Flow-down
Spec2Tickets imposes on each Sub-processor data-protection obligations that are, in substance,
no less protective than those in this DPA, to the extent applicable to the Sub-processor's role.
For Anthropic, this is achieved through the Anthropic Commercial Terms and the DPA/SCCs
incorporated therein. **[PARTNER: verify]** that the Managed Anthropic account is on the
**Commercial / API terms** (not the consumer terms) so that the no-training default and the
DPA/SCCs apply.

### 6.4 Change notice and objection
Spec2Tickets will give the Customer **at least 30 days'** prior notice (via the public
Sub-processor list and/or email to the Customer's designated contact) before adding or
replacing a Sub-processor. **[PARTNER: verify]** the notice channel and period you can
actually honour. If the Customer reasonably objects on data-protection grounds within that
period, the parties will discuss in good faith; if no resolution is reached, the Customer may
terminate the Managed tier for the affected processing without penalty (the BYOK tier remains
available as an alternative). Spec2Tickets remains liable for its Sub-processors' performance
of their data-protection obligations.

---

## 7. Retention, transience, and deletion

This Section states the actual data lifecycle. **It is deliberately honest about residual
retention at the Sub-processor; do not read it as a "zero-retention" guarantee.**

### 7.1 Inside Atlassian Forge (storage Spec2Tickets controls)
- Customer Content (the submitted page content and the generated breakdown) is stored
  **transiently** in Atlassian Forge key-value storage (**KVS**) **within the Customer's own
  Atlassian instance**, only to drive the review-and-push workflow.
- The App **purges** the stored page content and breakdown after the Customer pushes the
  breakdown to Jira (`purgeJob` deletes the job's content + breakdown and its page→job index;
  the push-session record is deleted when the push completes). This is best-effort and runs as
  part of the normal flow.
- **Backstop for abandoned jobs (implemented 2026-06-14, Task #13):** a breakdown that is
  generated but never pushed is removed automatically by a daily **Forge scheduled-trigger
  sweep** (`sweepHandler` in `src/index.js`) **7 days after its last access**. This is an
  INACTIVITY timer, not a fixed lifetime: it is renewed (`jobmeta.lastAccessedAt`, via
  `touchJobAccess`) on every meaningful access — review/reconnect AND the test-case + push sub-journeys —
  so a breakdown a user is actively working (incl. its test cases) is preserved. A creation-anchored native KVS TTL was
  deliberately rejected — a KVS TTL renews only on `set`, so a read-only review/push would
  silently delete the deliverable. The sweep also covers breakdowns regenerated away (each
  regenerate orphans the prior job, which then ages out of access). So transient content does
  not linger if a user walks away. The user is told this on the picker (a 7-day-inactivity
  notice); the claim is exactly what the code performs (no over-claim).
- Uninstalling the App removes its Forge-stored data for that instance.

### 7.2 At Anthropic (Sub-processor — the residual retention to disclose)
- The Managed tier uses the **Anthropic Message Batches API**. **The Batches API is not
  eligible for Zero-Data-Retention (ZDR); inputs and outputs of batch jobs are retained by
  Anthropic for up to approximately 29 days**, after which they are deleted in the ordinary
  course, per Anthropic's then-current retention policy.
- Accordingly, the honest framing is: **Customer Content is not retained at rest by
  Spec2Tickets after the breakdown is returned and purged from Forge, except** (a) for the
  **≤ ~29-day** retention of batch inputs/outputs at Anthropic described above, and (b) any
  **limited legal / safety / abuse-prevention retention** described in Section 7.3.
- **We do not claim "zero retention" for the Managed tier.** A customer that requires zero
  retention should use **BYOK** and configure ZDR (if eligible) directly under its own
  Anthropic agreement, or avoid submitting the data.

### 7.3 Limited legal / abuse retention at the Sub-processor
Even where ordinary retention limits apply, Anthropic may retain content that is flagged for
trust-and-safety, legal, or abuse-prevention reasons for a **longer period (up to
approximately 2 years)**, as described in Anthropic's policies. This is outside Spec2Tickets'
control and is disclosed for transparency. **[PARTNER: verify]** the current figure against
Anthropic's published policy at submission time.

### 7.4 Deletion or return at end of services
On termination of the Managed tier, or on the Customer's written request, Spec2Tickets will
delete the Customer Content it holds in Forge (or, at the Customer's option and where
technically feasible, return it), save to the extent retention is required by law. Residual
copies held by Anthropic are deleted on Anthropic's retention schedule (Sections 7.2–7.3);
where a customer requires expedited deletion of batch-job data at Anthropic, see the data-
subject-rights caveat in Section 10.3.

---

## 8. Security measures (Art. 32)

Spec2Tickets relies on Atlassian Forge's platform security and applies the following technical
and organisational measures appropriate to the risk. **[PARTNER: verify]** each statement is
true of your actual operations before publishing; do not assert controls you do not operate.

**Platform and architecture**
- The App runs entirely on **Atlassian Forge's managed runtime** (`nodejs24.x`); there is **no
  separate Spec2Tickets-operated server, VM, container, or database** for the Managed flow.
- The only external egress declared in the Forge manifest is **`https://api.anthropic.com`**.
- For the Managed tier, the call to Anthropic uses **Spec2Tickets' own Anthropic API key**,
  stored in **Forge encrypted secret storage** and accessible only to the backend resolver
  (never returned to the browser). **[PARTNER: verify]** the Managed key is provisioned via a
  Forge environment variable / encrypted storage and is never logged.

**Encryption**
- **In transit:** TLS/HTTPS for all Atlassian API calls and for the call to
  `api.anthropic.com`.
- **At rest:** Forge storage is encrypted and managed by Atlassian; secrets use Forge encrypted
  secret storage.

**Access control and tenant isolation**
- The App inherits Forge tenant isolation; data is stored within the Customer's own instance.
- Confluence reads and Jira writes act under the **signed-in user's own Atlassian permissions**
  (`asUser()`), not a shared service account, so users can only act on content they may already
  access. **[PARTNER: verify]** that Managed-tier generation/push remains gated behind an
  active license/trial as designed.
- Administrative access to the Atlassian developer account that deploys the App and to the
  Managed Anthropic account is **[PARTNER: verify]** restricted to authorised personnel and
  protected by **MFA**.

**Data minimisation and logging**
- The App is designed so that **end-user content is not written to Forge application logs**
  (log statements record lengths/identifiers/status, not content). **[PARTNER: verify]** this
  remains true for any Managed-specific code paths added for this tier.
- Customer Content is held only transiently and purged per Section 7.

**Telemetry**
- The App collects **no separate analytics or behavioural telemetry** on end users.
  **[PARTNER: verify]** before asserting.

**Certifications**
- Spec2Tickets does **not** claim SOC 2, ISO 27001, or other independent certification for its
  own operations and does not represent that it holds any. The App inherits the security posture
  of the Atlassian Forge platform; Anthropic maintains its own certifications as published at
  trust.anthropic.com. **[PARTNER: legal review]** — do not add certification claims unless and
  until they are genuinely held and evidenced.

---

## 9. No training on Customer Content

- Spec2Tickets does **not** use Customer Content to train, fine-tune, or improve any machine-
  learning model.
- For the Sub-processor: under the **Anthropic Commercial Terms (§B)**, Anthropic **does not
  train its models on customer content submitted via the commercial/API services by default**;
  Anthropic's Privacy Center confirms this for commercial/API use. **[PARTNER: verify]** the
  Managed account is on commercial/API terms so this default applies, and that no optional
  data-sharing/model-improvement setting has been enabled on the account.

---

## 10. Data-subject rights and assistance (Arts. 12–23, 28(3)(e))

### 10.1 Forwarding requests
If Spec2Tickets receives a request from a Data Subject relating to Customer Content (access,
rectification, erasure, restriction, portability, or objection), Spec2Tickets will, unless
legally prohibited, **not** respond directly (except to confirm the request was received and
will be routed) and will **forward** it to the Customer without undue delay so the Customer, as
Controller, can respond.

### 10.2 Assistance
Taking into account the nature of the processing, Spec2Tickets provides reasonable assistance —
by appropriate technical and organisational measures, insofar as possible — to help the
Customer fulfil its obligation to respond to Data-Subject requests. Because Customer Content in
Forge is held transiently and stored within the Customer's own instance, the Customer can often
satisfy access/erasure requests directly (e.g. by editing or removing the source page and by
deleting/regenerating the breakdown).

### 10.3 ⚠️ Caveat — deletion of data held by the Sub-processor
Erasure of Customer Content that resides in **Anthropic's batch-job storage** during the
≤ ~29-day retention window is **not within Spec2Tickets' direct technical control**. Where a
Data-Subject erasure request requires expedited deletion of such residual data, Spec2Tickets
will, on the Customer's documented request, **submit a corresponding deletion request to
Anthropic** and pass back Anthropic's response, but cannot guarantee a deletion timeline
shorter than Anthropic's processes allow, and cannot delete content Anthropic is required to
retain for legal/abuse reasons (Section 7.3). **For use cases that demand guaranteed,
controller-driven erasure, BYOK is the appropriate tier.** **[PARTNER: verify]** Anthropic's
current data-deletion request mechanism and reflect its actual capabilities here.

---

## 11. Audit (Art. 28(3)(h))

- On the Customer's reasonable written request (no more than **once per 12 months**, except
  following a Personal Data Breach affecting the Customer or where required by a supervisory
  authority), Spec2Tickets will make available the information necessary to demonstrate
  compliance with Art. 28 — including this DPA, the public Sub-processor list, the security
  summary in Section 8, and relevant Atlassian Forge / Anthropic platform documentation and
  any third-party attestations those providers publish.
- Given the no-backend architecture, Spec2Tickets' own auditable surface is limited; much of
  the relevant assurance derives from **Atlassian's** and **Anthropic's** published security
  documentation and attestations, which Spec2Tickets will help the Customer locate.
- On-site audits or detailed questionnaires beyond the above will be handled on reasonable
  notice, during business hours, subject to confidentiality, and **[PARTNER: legal review]**
  may be subject to a reasonable cost-recovery and frequency limit to be stated here.

---

## 12. Personal Data Breach (Arts. 33–34)

- Spec2Tickets will notify the Customer **without undue delay** after becoming aware of a
  Personal Data Breach affecting Customer Content processed under the Managed tier, and in any
  event within **[PARTNER: fill — e.g. 72 hours]** of becoming aware, providing the information
  reasonably available to enable the Customer to meet its own notification obligations.
- The notification will, to the extent known, describe the nature of the breach, likely
  consequences, and measures taken or proposed.
- **[PARTNER: verify]** the security/incident contact (**security@spec2jira.com**) is monitored,
  and that there is a defined internal incident-response process behind it.
- Breaches occurring within Atlassian's or Anthropic's platforms are subject to those providers'
  own notification commitments to Spec2Tickets; Spec2Tickets will relay relevant information to
  the Customer.

---

## 13. International transfers (Chapter V)

- The Managed tier transfers Customer Content to **Anthropic PBC in the United States** (and
  potentially other regions per Anthropic's sub-processor list). This is a **restricted/third-
  country transfer** under the GDPR and UK GDPR.
- **Transfer mechanism — SCCs.** The transfer is covered by the **EU Standard Contractual
  Clauses (2021/914)** and, for UK data, the **UK International Data Transfer Addendum**, as
  **incorporated into the Anthropic Commercial Terms / Anthropic DPA** between Spec2Tickets and
  Anthropic. **[PARTNER: legal review]** — confirm the correct **SCC module** for the
  Spec2Tickets→Anthropic leg (Module 3, processor-to-processor) and, where Spec2Tickets
  contracts with EU/UK customers, ensure the **Spec2Tickets↔Customer** leg is also covered by
  the appropriate SCC module (Module 2, controller-to-processor) or that this DPA's clauses
  suffice under your counsel's view. Identify the governing law and competent supervisory
  authority required by the SCCs.
- **Transfer impact / supplementary measures.** **[PARTNER: legal review]** — maintain a Transfer
  Impact Assessment (TIA) reflecting the data categories (low-risk business spec content,
  customer-controlled, no special categories instructed), the ≤29-day Sub-processor retention,
  encryption in transit, and the no-training default, and reference any supplementary measures.
- **Atlassian Forge** stores data within the Customer's chosen Atlassian region; data residency
  for the App's Forge-stored data follows the Customer's instance (Section 8). The transfer that
  leaves the Atlassian boundary is the **Anthropic** call described above.

---

## 14. Liability

Each party's liability arising out of or related to this DPA is subject to, and counts toward,
the **limitations and exclusions of liability set out in the Principal Agreement**, except where
Applicable Data Protection Law does not permit such limitation. **[PARTNER: legal review — fill]**
the liability cap, carve-outs, and any indemnity arrangement; coordinate with the Principal
Agreement / Marketplace EULA so the caps are consistent and enforceable.

---

## 15. Term and termination

- This DPA takes effect when the Customer enables the Managed tier and continues for as long as
  Spec2Tickets processes Customer Content under that tier.
- It terminates automatically on termination of the Principal Agreement or when the Customer
  ceases using the Managed tier.
- On termination, Section 7.4 (deletion/return) applies. Provisions which by their nature should
  survive (confidentiality, liability, governing law) survive.

---

## 16. Governing law and jurisdiction

This DPA is governed by **[PARTNER: fill — governing law, e.g. the laws of Bulgaria / the
Member State of establishment]**, and the courts of **[PARTNER: fill — jurisdiction]** have
exclusive jurisdiction, **without prejudice** to any mandatory provisions of Applicable Data
Protection Law and to the governing-law/forum requirements of the SCCs. **[PARTNER: legal
review]** align this with the Principal Agreement and the SCC requirements.

---

## 17. Signatures / acceptance

**[PARTNER: legal review]** — decide the execution model:
- **Click-through / incorporation by reference** from the Marketplace listing and Principal
  Agreement (common for self-serve Marketplace apps), with this DPA published at a stable URL; or
- A **counter-signable** version for enterprise customers who require a signed DPA.

| | Customer (Controller) | Spec2Tickets (Processor) |
|---|---|---|
| Name | [Customer] | [PARTNER: fill] |
| Title | | |
| Date | | |
| Signature | | |

---

### Document control
- **Status:** DRAFT — pending `[PARTNER: legal review]`.
- **Scope:** Managed tier only. BYOK is unaffected and remains the privacy-maximising option.
- **Source of facts:** Anthropic Commercial Terms (§A.1, §B, §D.4), Anthropic Privacy Center /
  trust.anthropic.com, Anthropic Message Batches API retention (non-ZDR, ≤~29 days; flagged
  content up to ~2 years), and the App's actual Forge KVS purge behaviour (`purgeJob` +
  push-session deletion). **[PARTNER: verify]** all external figures against the providers'
  then-current published policies at the time of publication.
- **Last updated:** 2026-06-03.
