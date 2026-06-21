# PARTNER CHECKLIST — v5.4.0 Managed-Tier Compliance (Single-Pass)

> **What this is.** A consolidated, de-duplicated, actionable checklist of **every** `[PARTNER: …]`
> marker across the five v5.4.0 Managed-tier compliance drafts, so you fill/verify everything in one
> pass instead of hunting through five files. Grouped into 5 buckets. Each item gives a one-line
> action + the source doc(s) it came from, and is marked **[BLOCKER]** (must be done before "Submit
> for review") or **[FOLLOW]** (can land in parallel / shortly after, without holding submission).
>
> **Release scope:** v5.4.0 = **breakdown-only** (NO test-case generation, NO orphan-cleanup
> sweep/TTL, NO delete-on-regenerate). Do not assert any of those features in any doc.
>
> **Source docs (short codes used below):**
> - **DPA** = `docs/compliance/DPA-managed-tier-v5.4.0.md`
> - **Q** = `docs/compliance/atlassian-questionnaire-managed-v5.4.0.md`
> - **SUB** = `docs/compliance/subprocessors-v5.4.0.md`
> - **TIA** = `docs/compliance/TIA-managed-v5.4.0.md`
> - **IR** = `docs/compliance/incident-response-v5.4.0.md`
>
> **Two overarching gates** (touch nearly every doc — do these and most `[PARTNER: legal review]`
> markers below are discharged): **(G1) a qualified data-protection lawyer reviews the whole set**
> (every draft is marked "not legal advice"); **(G2) re-verify all Anthropic figures against
> Anthropic's then-current published policy at submission.**

---

## Bucket 1 — LEGAL IDENTITY TO FILL (fill once, reuse everywhere)

> These are the same few facts repeated across all five docs. Decide them once; paste the identical
> values into every occurrence. Filling these is a **[BLOCKER]** — the docs cannot be published with
> `[PARTNER: fill]` identity placeholders.

| # | Action (one line) | Source doc(s) | Status |
|---|---|---|---|
| 1.1 | **[BLOCKER]** Confirm + state the **legal entity name AND form** — sole trader (individual) vs incorporated. The Marketplace payout record lists an *individual* (Tax ID = EGN); confirm which is the contracting party and use it everywhere. | DPA §1, DPA §17 (signature "Name"), TIA §1 (exporter) | ☐ |
| 1.2 | **[BLOCKER]** Fill the **registered address**. | DPA §1, TIA §1 | ☐ |
| 1.3 | **[BLOCKER]** Fill the **governing law** (e.g. laws of Bulgaria / Member State of establishment) — align with the Principal Agreement + SCC requirements. | DPA §16 | ☐ |
| 1.4 | **[BLOCKER]** Fill the **jurisdiction / competent courts** (align with SCCs). | DPA §16 | ☐ |
| 1.5 | **[BLOCKER]** Fill the **data-protection / privacy contact** (e.g. privacy@spec2jira.com) — used as the "Maintained by / Contact" on the sub-processor page and the DPA party block. | DPA §1, SUB header ("Contact"), IR §7 | ☐ |
| 1.6 | **[BLOCKER]** Decide the **EU/UK Art. 27 representative** question: state "Not applicable — Processor established in the EEA" if EEA-established, else appoint + name a representative. (Same decision in DPA + IR.) | DPA §1, IR §7 | ☐ |

---

## Bucket 2 — LEGAL DECISIONS (lawyer pass — discharges the `[PARTNER: legal review]` markers)

> All of these need counsel. Most are **[BLOCKER]** because they sit in the customer-facing DPA / the
> transfer mechanism / the questionnaire's GDPR answers — i.e. things a reviewer or customer relies on.

| # | Action (one line) | Source doc(s) | Status |
|---|---|---|---|
| 2.1 | **[BLOCKER]** Confirm **SCC module selection**: Spec2Tickets→Anthropic = **Module 3 (processor-to-processor)**; customer→Spec2Tickets = **intra-EEA, Art. 28 DPA only (no SCCs)**; identify SCC governing law + competent supervisory authority. | DPA §2, §13; Q A.5, E; TIA §3; SUB row | ☐ |
| 2.2 | **[BLOCKER]** Confirm Spec2Tickets' **place of establishment is in the EEA** (drives the "Leg 1 needs no SCCs" conclusion); if vendor or customer is outside EEA/UK, add the correct module/UK Addendum. | DPA §13 | ☐ |
| 2.3 | **[BLOCKER]** Fill the **liability cap, carve-outs, and any indemnity**; coordinate with the Principal Agreement / Marketplace EULA so caps are consistent. | DPA §14 | ☐ |
| 2.4 | **[BLOCKER]** Decide the **breach-notification window**: keep GDPR-accurate "without undue delay" alone, or commit a fixed max (e.g. within 48–72h of awareness) to support the customer's downstream 72h duty. Make DPA §12 and IR §4 say the **same** thing. | DPA §12; IR §4 | ☐ |
| 2.5 | **[BLOCKER]** Decide the **signature / execution model**: click-through/incorporation-by-reference (published at a stable URL) vs a counter-signable DPA for enterprise customers. | DPA §17 | ☐ |
| 2.6 | **[BLOCKER]** Reach + record the **TIA residual-risk conclusion** (§6) and the **third-country (US) regime assessment** (§4: FISA 702, EO 12333, EU-US DPF/EO 14086, practical-access likelihood) — counsel-owned, cannot be outsourced to the engineering draft. | TIA §4, §6 | ☐ |
| 2.7 | **[FOLLOW]** Decide **special-category-data handling**: recommended position is to **prohibit** Art. 9 / Art. 10 / payment-card data under Managed and direct such customers to BYOK/redaction (already drafted §5.4) — confirm with counsel. | DPA §2 (definitions), §4 (table), §5.4 | ☐ |
| 2.8 | **[FOLLOW]** Decide **CCPA/CPRA terms** — add only if you knowingly serve California businesses under Managed (draft is GDPR/UK-GDPR-first). | DPA §2 (Applicable Data Protection Law) | ☐ |
| 2.9 | **[FOLLOW]** Decide the **audit cost-recovery + frequency limit** wording for on-site audits / detailed questionnaires beyond the standard once-per-12-months. | DPA §11 | ☐ |
| 2.10 | **[FOLLOW]** Confirm **no certification claims** (SOC 2 / ISO 27001) are added unless genuinely held + evidenced — keep the honest "inherits Forge security, no independent cert" posture. | DPA §8 (Certifications) | ☐ |

---

## Bucket 3 — OPERATIONAL: MUST BE TRUE before asserting (`[PARTNER: verify]`)

> These are factual assertions the docs make about how you actually operate. **Do not publish a doc
> that asserts a control you do not operate.** All are **[BLOCKER]** for the data-handling assertions —
> they are the substance the reviewer/customer is being told is true. Verify each against the shipped
> v5.4.0 code + your account settings.

| # | Action (one line) | Source doc(s) | Status |
|---|---|---|---|
| 3.1 | **[BLOCKER]** **MFA on every data-touching account** — the Atlassian developer account that deploys the app AND the Managed Anthropic account (extend to GitHub + email per the bucket brief); restrict admin access to authorised personnel. | DPA §8 (Access control); IR (responder context) | ☐ |
| 3.2 | **[BLOCKER]** **Written confidentiality self-undertaking** — everyone with access to the deploying Atlassian dev account + the Managed Anthropic account is under a written confidentiality obligation. | DPA §5.2 | ☐ |
| 3.3 | **[BLOCKER]** **`security@` / `privacy@` monitored + a defined incident-response process** behind it (the IR runbook). Confirm the mailbox is actually watched and routes to the responder. | DPA §12; Q A.10, E; IR §2, §7 | ☐ |
| 3.4 | **[BLOCKER]** **Managed Anthropic account is on Commercial / API terms** (not consumer) — so the no-training default + auto-incorporated DPA/SCCs apply. | DPA §6.3, §9; Q #8, E; TIA §3 | ☐ |
| 3.5 | **[BLOCKER]** **Feedback-based / model-improvement training is OFF** on the Managed org (no optional data-sharing toggle enabled). | DPA §9; Q #8; TIA §5 | ☐ |
| 3.6 | **[BLOCKER]** **No content in logs on Managed code paths** — logs record lengths/identifiers/status, not content; verify for any Managed-specific path (vendor-key call, seat metering). | DPA §8 (logging); Q #9, E | ☐ |
| 3.7 | **[BLOCKER]** **Managed key in Forge encrypted secret storage / env var, never logged**, resolver-only (never returned to the browser). | DPA §8 (Managed key); Q #12, E | ☐ |
| 3.8 | **[BLOCKER]** **Managed generate/push gated behind an active license/trial**; `asUser()` retained (no `asApp()`); no in-app Free tier; unlicensed user blocked natively + `license_required` backstop present. | DPA §8 (tenant isolation); Q #13, E | ☐ |
| 3.9 | **[BLOCKER]** **On-push `purgeJob` purge works**, AND state ONLY the honest v5.4.0 behaviour: no scheduled sweep / no TTL; an un-pushed breakdown persists in the customer's own Forge KVS until pushed/regenerated/uninstalled. Do NOT assert a live sweep. | DPA §7.1, §10.2; Q #7, E; SUB "How … purges" | ☐ |
| 3.10 | **[FOLLOW]** **Proactive batch-delete-after-fetch** — verify it is actually implemented + operating before relying on it as a measure (the docs say "MAY"; if not implemented, do not claim it as an active control). | DPA §7.2; TIA §5; IR §5 | ☐ |
| 3.11 | **[FOLLOW]** **No separate analytics/behavioural telemetry** collected on end users — verify before asserting. | DPA §8 (Telemetry); Q #11 | ☐ |
| 3.12 | **[FOLLOW]** **Sub-processor region/config** — verify the Managed Anthropic account's configured region (US / other) and state it in DPA §6.2 + SUB. | DPA §6.2; Q #4; SUB row; TIA §2 | ☐ |
| 3.13 | **[FOLLOW]** **Sub-processor change-notice channel + period** — confirm the ≥30-day notice + the notification channel you can actually honour (align DPA §6.4 ↔ SUB), and state the "subscribe to changes" mechanism. | DPA §6.4; SUB (change-notice + "How to subscribe") | ☐ |
| 3.14 | **[FOLLOW]** **Confirm the Atlassian Security Bug-Fix SLA tier/timeframe** to cite in the remediation step (against Atlassian's then-current policy). | IR §5 | ☐ |
| 3.15 | **[FOLLOW]** **Re-verify the retention facts at any model change** — these facts hold for the Sonnet-via-Batches pipeline only; re-check if Managed moves to a Covered Model or the synchronous (ZDR-eligible) Messages API. | DPA §6 (model caveat); Q E; TIA §5/§7; IR doc-control | ☐ |

---

## Bucket 4 — PUBLISH at stable public URLs (cross-linked from the listing)

> **[PARTNER: execute]** — all three must be live at stable URLs **before** submitting, and
> cross-linked (listing ↔ privacy policy ↔ DPA ↔ sub-processor list). All **[BLOCKER]**.

| # | Action (one line) | Source doc(s) | Status |
|---|---|---|---|
| 4.1 | **[BLOCKER]** **Update + publish the privacy policy** (https://spec2jira.com/privacy) to describe the Managed tier (vendor-as-processor, Anthropic sub-processor, ≤~29-day batch retention, no-training, BYOK as the privacy-max alternative) and link the DPA + sub-processor list. | Q C (Privacy policy URL), E; DPA implied | ☐ |
| 4.2 | **[BLOCKER]** **Publish the customer-facing DPA** at a stable URL and link it from the listing. | Q C, E; DPA §17 | ☐ |
| 4.3 | **[BLOCKER]** **Publish the sub-processor list** at a stable public URL (e.g. https://spec2jira.com/subprocessors) and link it from the listing, privacy policy, and DPA. | SUB header, "execute"; DPA §2, §6.2; Q #3, C, E | ☐ |
| 4.4 | **[FOLLOW]** **Back-fill the published URLs** into the DPA's `[PARTNER: fill — public URL]` slots (DPA §2 + §6.2 reference the sub-processor URL) once 4.3 is live. | DPA §2, §6.2 | ☐ |

---

## Bucket 5 — ATLASSIAN / ANTHROPIC CONFIRMS (get it in writing where noted)

| # | Action (one line) | Source doc(s) | Status |
|---|---|---|---|
| 5.1 | **[BLOCKER]** **ECOHELP: does the editions reviewer re-run the security/privacy assessment** for this data-handling change (vs assuming the questionnaire is auto-re-evaluated)? Confirm via Marketplace support / the ECOHELP ticket. | Q D.6 | ☐ |
| 5.2 | **[BLOCKER]** **Confirm the "stores data outside Atlassian" answer in writing** — the recommended conservative read is **"No — stored inside Atlassian (Forge KVS); Anthropic retains inputs/outputs transiently ≤~29 days as a sub-processor, not the app storing externally."** Get the reviewer's read confirmed. | Q A (note after table), C ("Stores data outside Atlassian"), A.7 | ☐ |
| 5.3 | **[BLOCKER]** **Re-verify Anthropic's ~29-day retention + ~2-year flagged-content figures** against Anthropic's then-current published policy at submission (this is gate G2). | DPA §7.3, doc-control; Q E; SUB notes; IR doc-control; TIA doc-control | ☐ |
| 5.4 | **[FOLLOW]** **Check whether Anthropic offers an EU / non-US Batches region** for the Managed account, and reflect the actual configured region. (Reduces / changes the §4 transfer analysis if a non-US region exists.) | DPA §6.2; TIA §2/§4 (DPF + region); SUB row | ☐ |
| 5.5 | **[FOLLOW]** **Verify Anthropic's data-deletion request mechanism** + the current trust.anthropic.com transparency materials/URL, and reflect actual capabilities (DSR-erasure caveat + TIA importer-transparency). | DPA §10.3; TIA §4 | ☐ |
| 5.6 | **[FOLLOW]** **Confirm Anthropic's DPF / certification status** and reflect it in the TIA §4 essential-equivalence analysis. | TIA §4 | ☐ |

---

## Quick blocker summary (the "can't submit without these")

**BLOCKERS for Submit-for-review:**
- All of Bucket 1 (1.1–1.6) — legal identity.
- Bucket 2: 2.1–2.6 — SCC module, EEA establishment, liability cap, breach window, execution model, TIA conclusion.
- All of Bucket 3 operational truths 3.1–3.9 — the controls the docs assert.
- All of Bucket 4 publish items 4.1–4.3 — the three URLs + cross-links.
- Bucket 5: 5.1–5.3 — ECOHELP re-assessment, "stores outside Atlassian" written read, Anthropic figures re-verified.
- **Plus the two overarching gates: G1 (full lawyer review) and G2 (re-verify Anthropic figures).**

**FOLLOW (parallel / shortly after, not submission-blocking):** 2.7–2.10, 3.10–3.15, 4.4, 5.4–5.6.

---

### Document control
- **Status:** Consolidated partner action list for the v5.4.0 (breakdown-only) Managed-tier compliance set.
- **De-duplicated from:** DPA / questionnaire / sub-processors / TIA / incident-response (all v5.4.0).
- **Note:** Filling the same identity value in multiple docs counts as one item here (Bucket 1); the
  "Source doc(s)" column lists every place that value/assertion must land.
- **Last updated:** 2026-06-17.
