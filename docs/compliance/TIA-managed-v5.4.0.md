# Transfer Impact Assessment (TIA) — Spec2Tickets "Managed" Tier (v5.4.0)

> v5.4.0 RECONCILIATION (DRAFT — pending [PARTNER: legal review]). Accurate for the breakdown-only release. The original draft file is UNCHANGED. Publish THIS version for v5.4.0. Research facts verified <session, June 2026>.

---

> ⚠️ **DRAFT — [PARTNER: legal review]**
> This is a lightweight, engineering-grounded Transfer Impact Assessment prepared by the
> vendor team to support the Schrems II / GDPR Chapter V analysis for the Managed tier. It is
> **research-informed, not legal advice**, and has **not** been reviewed by a qualified
> data-protection lawyer. The legal-conclusion sections (the third-country regime assessment in
> §4 and the residual-risk conclusion in §6) are **left to [PARTNER: legal review]** — the data
> exporter bears that judgment and it cannot be fully outsourced to an engineering draft. Have
> counsel in your governing jurisdiction review the whole document before you rely on it,
> publish it, or reference it from a customer DPA.

A Transfer Impact Assessment under **GDPR Art. 46 / Schrems II (C-311/18)** for the one
restricted transfer the Managed tier performs: **vendor (processor, EEA) → Anthropic
(sub-processor, US)**. It is deliberately **proportionate for a sole-trader vendor** — honest
and structured, not enterprise-bloated.

This assessment is for the **v5.4.0 breakdown-only release**. The App's only feature is
generating a Jira breakdown from a Confluence page. There is no test-case generation, no
orphan-cleanup sweep, and no delete-on-regenerate behaviour in this release; nothing in this
TIA should be read to claim any of those.

---

## 1. Scope & parties

| Role | Party | Establishment |
|---|---|---|
| **Data exporter** | **[PARTNER: confirm entity]** — the vendor, **Aleks Asenov**, operating as a sole trader (BG/EU). [PARTNER: confirm the exact registered entity name/form and address — the Marketplace payout record lists an *individual* (Tax ID = EGN); confirm whether the contracting party is an individual sole trader or an incorporated entity.] | EEA (Bulgaria) |
| **Data importer** | **Anthropic PBC** (the maker of Claude) | United States |

**Applicability.** This TIA covers the **Managed (vendor-key) tier ONLY** — the tier in which
the vendor calls the Anthropic API using **the vendor's own Anthropic account/key** to process
the customer's content. In that model the vendor is a **processor** and Anthropic is the
vendor's **sub-processor**.

**BYOK is out of scope.** Under BYOK the customer supplies its **own** Anthropic key, putting
the customer in a **direct relationship with Anthropic** under the customer's own Anthropic
agreement. The vendor operates no backend in that path and is not the exporter for the
Anthropic transfer, so this TIA does not apply to BYOK. BYOK remains the privacy-maximising
option for customers that prefer to own the Anthropic relationship outright.

---

## 2. Transfer description

| Element | Description |
|---|---|
| **Data categories** | (a) The **Confluence specification / page text** the submitting user selects for a breakdown — free-text business/product content that may *incidentally* contain ordinary Personal Data (names, work email addresses, role titles). (b) The **submitting user's Atlassian account identity** associated with the request. No special-category data (Art. 9) is contemplated or instructed (see §5). |
| **Purpose** | **LLM inference** to generate the structured Jira breakdown (Epic, stories, subtasks, acceptance criteria, story points, dependency links) from the submitted page. Inference only — no profiling, no Art. 22 automated decision-making producing legal/similar effects. |
| **Volume / frequency** | **Per breakdown, on demand** — content is transferred only when an authorised customer user runs a Managed-tier breakdown. Not bulk, not continuous, not background-synced. Volume is bounded by the size of a single submitted page per request. |
| **Endpoint** | The **Anthropic Message Batches API** (`api.anthropic.com`). This is the **sole external egress** declared in the Forge manifest. |
| **Direction** | One-way submission of the input content + return of the generated breakdown; the breakdown is delivered back into the customer's own Atlassian instance for human review and push. |

---

## 3. Transfer mechanism

The transfer relies on the **EU Standard Contractual Clauses (Commission Implementing Decision
(EU) 2021/914)**, specifically **SCC Module 3 (processor-to-processor)** for the
vendor (processor, EEA) → Anthropic (sub-processor, US) leg.

- The SCCs (together with Anthropic's Data Processing Addendum) are **auto-incorporated by
  reference into Anthropic's Commercial Terms** — **no separate signature** is required for the
  vendor↔Anthropic relationship.
- **Note on the upstream leg.** The customer (controller, EEA) → vendor (processor, EEA) leg is
  **intra-EEA**, so **no SCCs are required there** — Art. 28 DPA terms suffice (see
  `docs/compliance/DPA-managed-tier.md`). The **only** restricted/third-country transfer requiring
  SCCs, and therefore the only transfer this TIA assesses, is the vendor → Anthropic (US) leg.
- **[PARTNER: verify]** the Managed Anthropic account is on the **Commercial / API terms** (not
  consumer terms), so the DPA + SCCs (and the no-training default) actually apply.

---

## 4. Assessment of the third-country (US) legal regime

> **[PARTNER: legal review]** — This section provides the **structure and prompts** for the
> Schrems II third-country analysis. The **legal conclusion is left to counsel.** Do not treat
> the prompts below as a finished assessment.

The Schrems II inquiry asks whether US law and practice impinge on the SCCs' effectiveness for
**this specific transfer** of **this specific data**, and whether supplementary measures
(see §5) bring the protection up to the EU-essential-equivalence standard.

Points to evaluate (counsel to conclude):

1. **FISA Section 702.** Could the importer be an "electronic communication service provider"
   subject to 50 U.S.C. § 1881a directives? Assess Anthropic's exposure and the nature/sensitivity
   of the data actually transferred here (narrow business spec text, customer-controlled, no bulk
   special-category data). **[PARTNER: legal review.]**
2. **Executive Order 12333.** Bulk/transit interception considerations; relevance given TLS in
   transit and the absence of a vendor-operated intermediary server (see §5). **[PARTNER: legal
   review.]**
3. **EU-US Data Privacy Framework (DPF) / Executive Order 14086.** Consider whether the
   redress-mechanism and proportionality safeguards introduced post-Schrems II, and any DPF
   self-certification by the importer, bear on essential equivalence. **[PARTNER: verify]**
   Anthropic's current certification/status and reflect it. **[PARTNER: legal review.]**
4. **Practical likelihood of access for THIS data.** Weigh the realistic probability that the
   transferred content (ordinary business specification text submitted ad hoc) is of interest to
   US government access mechanisms, against the categories and volume described in §2.
   **[PARTNER: legal review.]**

**Importer transparency materials.** Anthropic publishes **transparency / transfer materials,
sub-processor lists, and security documentation** (e.g. at **trust.anthropic.com** — **[PARTNER:
verify]** the current URL) intended to support exactly this kind of importer-side assessment;
counsel should review the then-current versions when finalising §4 and §6.

**Conclusion on the third-country regime:** **[PARTNER: legal review].**

---

## 5. Supplementary measures relied on

These are the **technical and organisational measures** that reduce the practical risk of the
transfer and support the essential-equivalence analysis. Each is true of the v5.4.0
breakdown-only architecture; **[PARTNER: verify]** each remains accurate before publishing.

**Architectural / minimisation**
- **No Spec2Tickets backend or server.** The App runs entirely on Atlassian Forge's managed
  runtime; there is no vendor-operated VM, container, database, proxy, or intermediary host. The
  **sole external egress** is `api.anthropic.com`. There is consequently no additional vendor
  hop at which content could be intercepted or compelled.
- **Content transits transiently.** For the Managed transfer, the page content passes through to
  Anthropic to produce the breakdown; the vendor does **not** store it at rest **outside the
  customer's own Atlassian instance**. (Honest scope note: within Forge KVS the content is held
  transiently in the customer's own instance to drive the review/push workflow; v5.4.0 performs
  no separate vendor-side persistence and no automatic time-boxed sweep — do not assert one.)
- **Deliverable stays in the customer's instance.** The generated breakdown is written back into
  the **customer's own (potentially EEA-pinned) Atlassian instance**; data residency for the
  App's Forge-stored data follows the customer's chosen Atlassian region.
- **Narrow content.** The transfer is **spec/page text**, customer-controlled and minimisable —
  **not** bulk special-category data. The Managed tier instructs against submitting
  special-category (Art. 9), criminal-offence (Art. 10), or payment-card data; such use cases
  are directed to BYOK or redaction (see the DPA).

**Importer-side retention & use**
- **Bounded retention with proactive deletion.** The Managed tier uses the **Anthropic Message
  Batches API**, which is **not ZDR-eligible** and retains batch inputs/outputs for up to
  **~29 days**. The vendor **may proactively DELETE the batch at Anthropic after retrieving the
  results**, shortening the practical retention window below the 29-day ceiling. **[PARTNER:
  verify]** the proactive-delete step is implemented and operating for the Managed path before
  relying on it as a measure.
- **No training by default.** Anthropic does **not train on commercial/API data by default**;
  the vendor must keep any feedback-based / model-improvement training **OFF** on its
  organisation. **[PARTNER: verify]** no optional data-sharing setting is enabled on the Managed
  account.

**Cryptographic**
- **TLS in transit** for all Atlassian API calls and for the call to `api.anthropic.com`.

> **Model caveat (re-check trigger).** These retention facts hold for the current
> **Sonnet-via-Batches** pipeline. If the Managed model is ever changed to a "Covered Model"
> (e.g. Fable 5 / Mythos 5 = 30-day retention, no ZDR ever) **or** to the **synchronous Messages
> API** (which *is* ZDR-eligible), the retention claim and the supplementary-measures analysis
> here **must be re-checked**. See §7.

---

## 6. Residual-risk conclusion

> **[PARTNER: legal review].**
>
> Having described the transfer (§2), the mechanism (§3 — SCC Module 3, auto-incorporated), the
> third-country regime (§4 — left to counsel), and the supplementary measures (§5 — no vendor
> backend, transient transit, EEA-pinned deliverable, narrow customer-controlled content,
> ~29-day Anthropic retention with optional proactive delete, no-training default, TLS), the
> **exporter must reach the residual-risk judgment**: whether, taken together, the SCCs plus
> these measures provide protection **essentially equivalent** to that guaranteed within the EEA
> for this transfer, and whether the transfer may proceed (and on what conditions).
>
> This conclusion **cannot be fully outsourced** to an engineering draft — the data exporter
> bears it. It is recorded here as **[PARTNER: legal review]** and must be completed by counsel
> before the Managed tier is offered in reliance on this assessment.

---

## 7. Review cadence

Re-assess this TIA on any **material change**, including:

- **Model change** — switching the Managed model away from the current Sonnet-via-Batches
  pipeline (especially to a "Covered Model" such as Fable 5 / Mythos 5, or to the synchronous
  Messages API), which alters the retention/ZDR profile (see the §5 model caveat).
- **Endpoint change** — moving off the Anthropic Message Batches API, adding a new egress
  destination, or introducing any vendor-side intermediary/server.
- **Anthropic policy change** — changes to Anthropic's retention period, sub-processor list,
  DPA/SCC incorporation, training defaults, transfer mechanism, or DPF/certification status.
- **Architecture change** — any change that causes the vendor to store Managed content at rest
  outside the customer's Atlassian instance, or that adds processing beyond the breakdown
  feature.
- **Legal change** — a relevant CJEU/court ruling, supervisory-authority guidance, or change in
  the US legal regime bearing on §4.

Absent a material change, review at least **annually**. **[PARTNER: verify]** and date each
review below.

---

### Document control
- **Status:** DRAFT — pending **[PARTNER: legal review]**. Research-informed, **not legal advice**.
- **Release scope:** **v5.4.0 breakdown-only**. No test-case generation, no orphan-cleanup sweep,
  no delete-on-regenerate behaviour is claimed.
- **Applies to:** the **Managed (vendor-key) tier ONLY**. BYOK is out of scope (customer↔Anthropic
  direct relationship).
- **Transfer assessed:** vendor (processor, EEA) → Anthropic (sub-processor, US); mechanism = SCC
  Module 3, auto-incorporated via Anthropic's DPA into its Commercial Terms.
- **Source of facts:** Anthropic Message Batches API retention (not ZDR-eligible, ≤~29 days, with
  optional vendor proactive delete after fetch); Anthropic no-training-by-default on commercial/API
  data; Anthropic DPA + SCCs auto-incorporated into the Commercial Terms; SCC module analysis
  (intra-EEA controller→processor = Art. 28 only; processor→US sub-processor = Module 3). Research
  facts verified **<session, June 2026>**. **[PARTNER: verify]** all external figures against the
  providers' then-current published policies at publication time.
- **Last updated:** 2026-06-17.
