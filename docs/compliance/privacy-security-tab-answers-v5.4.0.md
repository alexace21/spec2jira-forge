# Atlassian Marketplace — "Privacy & Security" Tab — Copy-Paste Answer Sheet (v5.4.0)

> **What this is.** One field → one answer, ready to paste into the Marketplace
> "Privacy & Security" tab for the **v5.4.0 breakdown-only** release (Managed + BYOK hybrid).
> Source: `docs/compliance/atlassian-questionnaire-managed-v5.4.0.md` (Sections A and C).
> `[PARTNER: ...]` markers flag a value the partner must supply or a confirmation needed
> before submitting. **[PARTNER: legal review]** the GDPR/transfer lines.

---

## Core data-handling fields

- **Field: Does the app process End-User Data outside of the Atlassian cloud environment?**
  -> Answer: **Yes.** To generate a breakdown, the app sends the selected Confluence page content to the Anthropic API (`api.anthropic.com`) for AI inference. In the BYOK tier this uses the customer's own Anthropic key; in the Managed tier it uses Spec2Tickets' own Anthropic account (vendor = processor, Anthropic = sub-processor). No vendor-operated server or database — the call originates from the Forge resolver.

- **Field: Does the app store End-User Data outside of the Atlassian cloud environment?**
  -> Answer: **No.** The app stores breakdowns and page content inside Atlassian (Forge KVS). The Anthropic sub-processor retains inputs/outputs transiently (up to ~29 days) as a sub-processor — this is sub-processor retention, not the app storing data externally. [PARTNER: confirm the reviewer's read in writing — this is the conservative answer; the retention is disclosed under "data retention" below.]

- **Field: Does the app transmit / share End-User Data with a third party or sub-processor?**
  -> Answer: **Yes — Anthropic PBC** (domain `anthropic.com`; storage country **United States**; purpose **LLM inference / AI text generation**). Under the Managed tier Anthropic is engaged as Spec2Tickets' sub-processor; under BYOK it operates under the customer's own Anthropic agreement. See the published sub-processor list.

- **Field: List sub-processors / third parties.**
  -> Answer: **Anthropic PBC** — AI inference (Managed tier). Atlassian is the hosting platform (data stored within the customer's own instance). Public sub-processor list: [PARTNER: fill — sub-processor URL] (`docs/compliance/subprocessors.md`).

- **Field: Is End-User Data transferred to / processed in, or out of, the EEA?**
  -> Answer: **Yes — transferred outside the EEA.** Managed processing sends content to Anthropic in the United States (and possibly other regions per Anthropic's sub-processor list).

- **Field: Is there a GDPR-valid transfer mechanism for that transfer?**
  -> Answer: **Yes — Standard Contractual Clauses (SCCs).** The Spec2Tickets -> Anthropic transfer relies on the EU SCCs (and UK Addendum) auto-incorporated into the Anthropic Commercial Terms / DPA (no separate signature). The applicable leg is **vendor (processor, EEA) -> Anthropic (sub-processor, US) = SCC Module 3 (processor-to-processor)**. The **customer (controller, EEA) -> Spec2Tickets (processor, EEA)** leg is intra-EEA and relies on an **Art. 28 DPA only (no SCCs)**. [PARTNER: legal review the SCC module selection; TIA on file for the US transfer.]

- **Field: Is Spec2Tickets a data processor for End-User Data?**
  -> Answer: **Yes** (for the Managed tier — content is processed under our own Anthropic account, with Anthropic as our sub-processor). Under BYOK the customer's key is used and the vendor is not a processor of the Anthropic content.

- **Field: Does the app / vendor offer a Data Processing Agreement (DPA)?**
  -> Answer: **Yes.** A customer-facing DPA is published for the Managed tier. DPA URL: [PARTNER: fill — publish `docs/compliance/DPA-managed-tier.md` at a stable URL and link it].

- **Field: Does the app log or share End-User Data (e.g. in application logs)?**
  -> Answer: **No.** Content is not written to Forge application logs (logs record lengths, identifiers, and status — not content). The Managed Anthropic key is never logged. Log-sharing with third parties: No.

- **Field: Data residency — where is data stored / does the app support data residency?**
  -> Answer: App logic and stored data run on **Atlassian Forge within the customer's instance region** (no separate vendor datastore). Forge-stored content is transient and purged after push. AI inference for the Managed tier occurs in **Anthropic's region (US / Anthropic-defined)**. Select the Marketplace residency option **"stores within Atlassian"** (matches the scope justification and privacy policy) — not "does not store."

- **Field: What is the data-retention period / does the app store data after uninstall?**
  -> Answer: **Transient, plus a disclosed sub-processor window.** In Forge, page content and the breakdown are transient and **purged on push to Jira** (`purgeJob`); **uninstall removes app data**. An un-pushed breakdown persists in the customer's own Atlassian instance (Forge KVS) until it is pushed, regenerated, or the app is uninstalled — **there is no scheduled sweep / TTL in this release**. At Anthropic (Managed), the Message Batches API is **not ZDR-eligible**, so batch inputs/outputs are retained **up to ~29 days** then deleted (the vendor may proactively delete the batch after retrieving results to shorten this); flagged/abuse content may be retained up to ~2 years for legal/safety. **No "zero-retention" claim** — a customer needing zero retention uses BYOK. [PARTNER: verify the ~29-day / ~2-year figures against Anthropic's then-current policy at submission.]

---

## Supporting fields

- **Field: Is End-User Data used to train AI / ML models?**
  -> Answer: **No.** Spec2Tickets does not train any model on customer content. Anthropic does not train on commercial/API data by default, and the vendor keeps any feedback-based training OFF on its org. [PARTNER: verify the Managed account is on commercial/API terms with no model-improvement toggle enabled.]

- **Field: Does the app collect personal data via its own analytics / telemetry?**
  -> Answer: **No** separate user analytics or telemetry collected by the app. Customer page content may contain the customer's own personal data, processed under the DPA for the Managed tier.

- **Field: Encryption in transit / at rest.**
  -> Answer: **In transit** — TLS/HTTPS for all Atlassian and Anthropic calls. **At rest** — Forge storage encrypted/managed by Atlassian; the Managed Anthropic key is held in Forge encrypted secret storage (resolver-only, never returned to the browser).

- **Field: Authentication model for Atlassian access.**
  -> Answer: **`asUser()`** — the app acts with the signed-in user's own Atlassian permissions for Confluence reads and Jira writes; no shared service account. There is no in-app Free tier; evaluation is the 30-day Atlassian trial. A truly unlicensed user is blocked natively by Atlassian, backed by a defensive `license_required` backstop. Managed-tier generate/push is gated behind an active license/trial. (Managed did not switch to `asApp()`.)

- **Field: Does the app run on / require a vendor-operated remote backend?**
  -> Answer: **No.** No `remotes:` in the manifest; the only external egress is `api.anthropic.com`. The Managed tier calls Anthropic from the Forge resolver using a vendor-held key — a vendor's key is not a vendor's server. (This is what resolved the original FIT/remote-host rejection; Managed does not reintroduce a remote host.)

- **Field: Certifications (SOC 2 / ISO 27001 / etc.).**
  -> Answer: The app inherits Atlassian Forge platform security. Spec2Tickets claims no independent certification of its own operations. Anthropic's certifications are published at trust.anthropic.com. [Do not overclaim — keep this honest.]

- **Field: Security / vulnerability contact.**
  -> Answer: **security@spec2jira.com** (monitored). [PARTNER: verify the alias is monitored and backed by an incident-response process — Art. 33 notification duty lands on the vendor for Managed content.]

---

## Listing privacy/data-handling URLs (public listing form)

- **Field: Privacy policy URL**
  -> Answer: [PARTNER: verify] https://spec2jira.com/privacy — must describe the Managed tier (vendor-as-processor, Anthropic sub-processor, <=~29-day batch retention, no-training, BYOK as the privacy-max alternative) and link the DPA + sub-processor list.

- **Field: Customer-facing DPA URL**
  -> Answer: [PARTNER: fill] publish `docs/compliance/DPA-managed-tier.md` at a stable URL and link it.

- **Field: Sub-processor list URL**
  -> Answer: [PARTNER: fill] publish `docs/compliance/subprocessors.md` at a stable URL and link it.

---

### Notes
- Source of truth: `docs/compliance/atlassian-questionnaire-managed-v5.4.0.md` (Sections A and C).
- Reconciled for the **v5.4.0 breakdown-only** release (no test-case generation, no orphan/TTL sweep, no delete-on-regenerate).
- Resolve every `[PARTNER: ...]` marker before submitting; `[PARTNER: legal review]` the GDPR/SCC lines.
