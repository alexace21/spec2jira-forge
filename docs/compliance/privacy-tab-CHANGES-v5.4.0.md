# Privacy & Security tab — CHANGES for the hybrid (BYOK + Managed)

> The June-1, 2026 answers (approved) were filled for the **BYOK-only** app. The hybrid
> (Managed Advanced edition processes customer content with the vendor's own Anthropic key)
> flips four load-bearing fields. Apply these **with the editions submission**, before the
> official release. The questionnaire is APP-LEVEL (one declaration per listing) and must
> reflect the **most-permissive edition** (Managed) — leaving the BYOK-era answers while a
> Managed edition exists would be a misrepresentation.
>
> Only the **4 fields below change.** Everything else stays as-is (see the §"Leave as-is" note).

---

## 🔴 CHANGE THESE 4 FIELDS

### 1. "End-User Data shared with third-party entities" → **Yes**
Currently: *"Not applicable. Marketplace app does not store End-User Data outside of Atlassian."*
(That conflates *share* with *store* — the app **sends** content to Anthropic, so it shares, even though it does not *store* outside Atlassian.)

- **Shares End-User Data with third-party entities:** Yes
- **Entity:** Anthropic PBC
- **Website:** https://www.anthropic.com
- **Storage country:** United States
- **Data shared:** The Confluence page content the user submits for a breakdown, and the generated breakdown. This is customer-controlled content that may incidentally contain personal data (e.g. names or work emails in free text).
- **Purpose:** AI inference — Anthropic's Claude model generates the structured Jira breakdown from the submitted page content. Under the Managed (Advanced) edition Spec2Tickets calls Anthropic under its own account (Anthropic = sub-processor); under the BYOK (Standard) edition the call uses the customer's own Anthropic API key.
- **Integral to app functionality:** Yes

### 2. "Company/Organization is a 'data processor' under GDPR" → **Yes**
Currently: *No.*

- **Answer:** Yes
- **Explanation (if prompted):** For the Managed (Advanced) edition, Spec2Tickets processes the customer's Confluence content on the customer's documented instructions, using its own Anthropic API key, with Anthropic PBC as sub-processor — so Spec2Tickets is a data processor. Under the BYOK (Standard) edition the content is processed under the customer's own Anthropic agreement. The customer remains the data controller in both cases.

### 3. "Data Processing Agreement (DPA) for customers" → **Yes**
Currently: *Not applicable. Company/Organization is not a 'data processor' under GDPR.*

- **Answer:** Yes
- **DPA URL:** https://spec2jira.com/dpa

### 4. "GDPR approved mechanism for transferring EEA resident's End-User Data outside the EEA" → **Yes** (reword)
Currently: *Yes, … SCCs … which the customer accepts as part of their own Anthropic API agreement (BYOK). Spec2JIRA operates no backend …* — BYOK-only wording + uses the old "Spec2JIRA" name.

- **Answer:** Yes
- **Mechanism:** Transfers of EEA personal data to Anthropic (United States) are governed by the EU Standard Contractual Clauses (SCCs) incorporated by reference into Anthropic's Data Processing Addendum and Commercial Terms. Under the Managed (Advanced) edition, Spec2Tickets is the data exporter and the SCCs apply processor-to-processor (Module 3) via Spec2Tickets' own Anthropic agreement; under the BYOK (Standard) edition the transfer occurs under the customer's own Anthropic agreement. Spec2Tickets operates no backend server and does not itself store the transferred data outside Atlassian.

---

## 🟢 LEAVE AS-IS (already correct for the hybrid)

- **"End-User Data processed … outside Atlassian (excl. logs)"** = "processes but does not store …" ✓ (true for the hybrid — processes via Anthropic, stores in Atlassian).
- **"Company is a 'data controller' under GDPR"** = No ✓ (the customer is the controller, not us).
- All **logs** fields = No ✓ · **App REST APIs** = No ✓ · **Bug Bounty** = No ✓ · **Compliance certifications** = None ✓ · **CAIQ Lite** = not submitted ✓ · **PAT access** = No ✓ · **PETs** = No ✓ · **CCPA** = not applicable ✓ · security@ contact ✓.

### Storage / residency fields — keep, because they describe the app's *storage* (within Atlassian)
The data-residency, in-scope/out-of-scope lists, "stored after uninstall", "custom retention", and "full disk encryption" answers lean on *"stores exclusively within Atlassian."* That stays **true**: the app's **storage** (Forge KVS) is within Atlassian; the Managed **processing egress** to Anthropic (transit, ≤29-day transient sub-processor retention) is now disclosed via fields **1 + 4** above. Transit ≠ store, so no contradiction — leave them.
- ⚠ Only exception: if the portal now **prompts you to list in-scope data types** (because share = Yes), list: *"Confluence page content submitted for breakdown; the generated breakdown."*

---

*Source of the hybrid answers: `privacy-security-tab-answers-v5.4.0.md` (full sheet) + the verified facts in the v5.4.0 DPA / subprocessors / questionnaire drafts. claim==code for the breakdown-only v5.4.0 release.*
