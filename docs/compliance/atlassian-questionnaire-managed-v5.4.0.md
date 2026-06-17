> v5.4.0 RECONCILIATION (DRAFT — pending [PARTNER: legal review]). Accurate for the breakdown-only release. The original draft file is UNCHANGED. Publish THIS version for v5.4.0. Research facts verified <session, June 2026>.

# Atlassian Marketplace — Privacy & Security Questionnaire (Managed tier)

> **Purpose.** Copy-paste source for the Atlassian Marketplace Privacy & Security
> questionnaire and the listing's data-handling fields, **reconciled to the Managed-tier
> truth**. The app ships a **hybrid**: BYOK (customer's key) **and** Managed (our key). The
> questionnaire is per-app, so the answers below describe the app **as a whole, taking the
> Managed tier into account** — because once Managed exists, "we process content under our
> own account" becomes true for the app.
>
> The **"Differs from prior BYOK-only answer"** column is the audit trail: it shows exactly
> which answers change versus the BYOK-only submission recorded in
> `docs/MARKETPLACE-LISTING-v3.md` §4–§5 and `memory/marketplace-launch-state.md`. Use it so
> nothing silently regresses and so you can explain the deltas to the reviewer.
>
> ⚠️ **[PARTNER: verify]** every factual answer against the shipped Managed code before
> submitting. **[PARTNER: legal review]** the GDPR/transfer answers. Do not assert a control
> or a retention figure the implementation does not actually provide.

---

## A. The core data-handling questions

| # | Questionnaire question | Managed-tier answer | Differs from prior BYOK-only answer? |
|---|---|---|---|
| 1 | **Does the app store, process, or transmit data outside of the Atlassian cloud environment?** | **Yes.** To generate a breakdown, the app sends the selected Confluence page content to the **Anthropic API** (`api.anthropic.com`). In the **BYOK** tier this uses the *customer's own* Anthropic key under the customer's agreement; in the **Managed** tier it uses **Spec2Tickets' own Anthropic account**, making Spec2Tickets a processor of that content. | **Changed in substance.** BYOK framed this as "transmits to Anthropic under the *customer's* key; vendor operates no backend and stores nothing on its own systems." Managed adds: the vendor now **processes content under its own Anthropic account** (vendor = processor, Anthropic = sub-processor). Still **no vendor-operated server/DB** — the call originates from Forge and uses a vendor-held key. |
| 2 | **Does the app transfer end-user data to a third party / sub-processor?** | **Yes — Anthropic PBC.** Page content is sent to Anthropic for AI inference. Under Managed this is a **sub-processor** relationship (we engage Anthropic under our account). See the public sub-processor list. | **Changed.** BYOK answer: "Yes — Anthropic, but under the customer's own key/agreement (the customer's direct relationship)." Managed: "Yes — **Anthropic as our sub-processor**," with a customer-facing DPA + published sub-processor list. |
| 3 | **Are there sub-processors? List them.** | **Yes:** **Anthropic PBC** (AI inference for the Managed tier). Atlassian is the hosting platform (data stored within the customer's own instance). Public list: **[PARTNER: fill — sub-processor URL]** (`docs/compliance/subprocessors.md`). | **Changed.** BYOK did not need to name a *sub-processor* (Anthropic was the customer's own processor). Managed **names Anthropic as a sub-processor** and publishes a list with change-notice. |
| 4 | **Is end-user data transferred to / processed in the EEA, or transferred out of the EEA?** | **Yes — transferred outside the EEA.** Managed processing sends content to **Anthropic in the United States** (and possibly other regions per Anthropic's sub-processor list). | **Same answer, now our responsibility.** Under BYOK an EEA transfer also occurred, but under the *customer's* Anthropic agreement. Under Managed the transfer happens under **our** account, so **we** must stand behind the transfer mechanism. |
| 5 | **Is there a GDPR-valid transfer mechanism for that transfer?** | **Yes — Standard Contractual Clauses (SCCs).** The Spec2Tickets→Anthropic transfer relies on the **EU SCCs (and UK Addendum) incorporated into the Anthropic Commercial Terms / Anthropic DPA** (auto-incorporated; no separate signature). The applicable leg is **vendor (processor, EEA) → Anthropic (sub-processor, US) = SCC Module 3 (processor-to-processor)**. The **customer (controller, EEA) → Spec2Tickets (processor, EEA)** leg is intra-EEA and therefore relies on an **Art. 28 DPA only (no SCCs needed)**. Spec2Tickets offers a **customer-facing DPA** (`docs/compliance/DPA-managed-tier.md`) for that customer↔Spec2Tickets leg. | **Changed / strengthened.** BYOK relied on **the customer's own** Anthropic DPA/SCCs (lawyer-confirmed acceptable). Managed adds **our own** customer-facing DPA + the **Spec2Tickets→Anthropic** SCCs leg (Module 3). **[PARTNER: legal review]** the SCC module selection. |
| 6 | **Data residency — does the app support data residency / where is data stored?** | App logic + the app's stored data run on **Atlassian Forge within the customer's instance region** (no separate vendor datastore). **AI inference for Managed occurs in Anthropic's region (US/other per Anthropic).** Forge-stored content is transient and purged after push. | **Essentially the same, with one honest addition.** BYOK: "Forge per the instance region; AI in the customer's Anthropic region; no vendor datastore." Managed: identical **except** the Anthropic region is now **our** account's region, not the customer's — state it as US/Anthropic-defined. Pick the Marketplace "stores within Atlassian" residency option (matches the scope justification + privacy policy), not "does not store." |
| 7 | **What is the data-retention period?** | **Transient + a disclosed sub-processor window.** In Forge: page content + breakdown are **transient** and **purged after the user pushes to Jira** (`purgeJob`); uninstall removes app data. At **Anthropic (Managed)**: the **Message Batches API is not ZDR-eligible**, so batch inputs/outputs are **retained for up to ~29 days** at Anthropic, then deleted; the vendor MAY proactively **delete the batch after retrieving results** to shorten that window. Flagged/abuse content may be retained up to ~2 years for legal/safety. **No "zero-retention" claim.** | **Changed — this is the most important delta.** BYOK said "transient, removed after push; nothing stored by the vendor." Managed must **additionally disclose the ≤~29-day Anthropic batch retention** (and the up-to-2-year legal/abuse exception). **Honest framing:** "not retained at rest by us after the response is returned and purged, **except** ≤~29 days for asynchronous batch jobs at Anthropic and limited legal/abuse retention." |
| 8 | **Is end-user data used to train AI / ML models?** | **No.** Spec2Tickets does not train any model on customer content. Anthropic **does not train on commercial/API data by default** (the vendor keeps any feedback-based training OFF on its org); confirmed by Anthropic's Privacy Center. | **Same answer; now also our attestation.** BYOK relied on the customer's own Anthropic terms. Under Managed, the no-training default applies to **our** commercial account — **[PARTNER: verify]** the Managed account is on commercial/API terms and no data-sharing/model-improvement toggle is enabled. |
| 9 | **Does the app log or share end-user content (e.g. in application logs)?** | **No.** The app is designed so that **content is not written to Forge application logs** (logs record lengths/identifiers/status, not content). Log-sharing with third parties: **No.** | **Same — must stay true.** This was a hard-won BYOK answer ("Log End-User Data: No"). **[PARTNER: verify]** any Managed-specific code path (e.g. the vendor-key call, seat metering) still logs **no content** and **never logs the Managed API key.** |
| 10 | **Security / vulnerability contact.** | **security@spec2jira.com** (monitored). | **Same.** **[PARTNER: verify]** the alias is monitored and backed by an incident-response process (now matters more — under Managed, a breach of content under our account triggers **our** Art. 33 notification duty; see DPA §12). |
| 11 | **Personal-data collection (the app's own analytics/telemetry on users).** | **No** separate user analytics/telemetry collected by the app. Customer page content may contain the customer's own personal data, processed under the DPA for the Managed tier. | **Same.** BYOK said personal-data = No / analytics empty. Keep it, but ensure the **listing privacy fields now point to the customer-facing DPA + sub-processor list** for the Managed tier. |
| 12 | **Encryption in transit / at rest.** | **In transit:** TLS/HTTPS for all Atlassian + Anthropic calls. **At rest:** Forge storage encrypted/managed by Atlassian; the **Managed Anthropic key** held in **Forge encrypted secret storage** (resolver-only, never returned to the browser). | **Same posture; one new secret.** BYOK stored the *customer's* key as a Forge secret. Managed adds the **vendor's** Managed key as a Forge secret — **[PARTNER: verify]** it is in encrypted secret storage / a Forge env var and never logged. |
| 13 | **Authentication model for Atlassian access.** | **`asUser()`** — the app acts with the **signed-in user's own Atlassian permissions** for Confluence reads and Jira writes; no shared service account. **There is no in-app Free tier** (the perpetual in-app Free path was removed 2026-06-03). Evaluation is the **30-day Atlassian trial** (auto-provided for Paid-via-Atlassian apps; it reads as an active license and resolves to a paid tier). A **truly unlicensed user is blocked natively by Atlassian**, backed by a defensive `license_required` backstop in the resolvers. **Managed-tier generate/push is gated behind an active license/trial.** | **Same security model.** Note for the reviewer: this preserves the **already-approved `asUser()` model**; Managed did **not** switch to `asApp()` (which would reopen the service-account concern). **[PARTNER: verify]** the license-gating is implemented as designed and that the unlicensed-user block + `license_required` backstop are in place. |
| 14 | **Certifications (SOC 2 / ISO 27001 / etc.).** | The app **inherits Atlassian Forge platform security**; **Spec2Tickets claims no independent certification of its own operations.** Anthropic's certifications are published at trust.anthropic.com. | **Same — do not overclaim.** Keep this honest; do **not** add certifications you do not hold. |
| 15 | **Does the app run on / require a vendor-operated remote backend?** | **No.** No `remotes:` in the manifest; the only external egress is `api.anthropic.com`. The Managed tier still has **no vendor server** — it calls Anthropic from the **Forge resolver** using a **vendor-held key**, not from a vendor-hosted host. | **Same — and reinforce it.** This is the answer that resolved the original **FIT/remote-host rejection**. Managed does **not** reintroduce a remote host. Make sure the reviewer sees that "vendor's key" ≠ "vendor's server." |

> **Note on the "Stores End-User Data outside Atlassian" / "Runs on Atlassian" framing.** The app
> egresses to `api.anthropic.com` in **both** editions (BYOK uses the *customer's* key; Managed uses
> the *vendor's* key), so the **"Runs on Atlassian" badge never applied** to this app — the
> breakdown-only v5.4.0 release does **not** newly forfeit it. For the **"Stores End-User Data outside
> Atlassian"** question specifically, the answer is **borderline** because Anthropic retains
> inputs/outputs transiently (≤~29 days) as a sub-processor. **Recommended (conservative) answer:**
> "**No** — the app stores breakdowns/page content **inside Atlassian (Forge KVS)**; the Anthropic
> sub-processor retains inputs/outputs **transiently ≤29 days** as a sub-processor, **not the app
> storing externally**." **[PARTNER: confirm the reviewer's read in writing].** Lean on **BYOK + the
> published DPA** as the privacy counter-narrative.

---

## B. Scope justification (free-text, ≤1000 chars) — reuse, unchanged

The 5 least-privilege scopes are **unchanged** by the Managed tier (no new scopes, no new
egress). Reuse the approved justification:

> Spec2Tickets requests five least-privilege scopes. `storage:app` — Forge KVS for settings
> and transient breakdown/push state. `search:confluence` — CQL page search in the picker.
> `read:page:confluence` — read the selected spec page body (v2 API). `read:jira-work` — read
> project metadata (issue types/fields) before creating issues. `write:jira-work` — create the
> Epic, stories, subtasks, and dependency links. The app **creates** Jira issues and **never
> deletes**. Only external egress is `api.anthropic.com` for AI inference. No vendor backend.

| Differs from BYOK? | **No.** Same scopes, same egress endpoint, same "creates-only-never-deletes" wording. The Managed tier changes **whose Anthropic key** is used, not the Forge scopes. |
|---|---|

---

## C. Listing privacy/data-handling fields (the public listing form)

| Field | Managed-tier value | Differs from BYOK? |
|---|---|---|
| Privacy policy URL | **[PARTNER: verify]** https://spec2jira.com/privacy — **must be updated** to describe the Managed tier (vendor-as-processor, Anthropic sub-processor, ≤29-day batch retention, no-training, BYOK as the privacy-max alternative) and to link the DPA + sub-processor list. | **Changed content.** BYOK privacy policy said "vendor receives no content on its own servers." That remains true of *servers*, but the policy must now explain Managed processing under the vendor's account. |
| Customer-facing DPA URL | **[PARTNER: fill]** publish `docs/compliance/DPA-managed-tier.md` at a stable URL and link it. | **New.** BYOK did not require a vendor DPA. |
| Sub-processor list URL | **[PARTNER: fill]** publish `docs/compliance/subprocessors.md` at a stable URL and link it. | **New.** |
| Stores data outside Atlassian? | **No (conservative)** — stored inside Atlassian (Forge KVS); Anthropic retains inputs/outputs transiently ≤29 days as a sub-processor, not the app storing externally. See A.7 + the note above. **[PARTNER: confirm the reviewer's read in writing.]** | **Changed framing** (BYOK leaned on "under the customer's key"; v5.4.0 takes the conservative "inside Atlassian; sub-processor transient retention" read). |
| Transmits to third parties? | **Yes — Anthropic** (sub-processor under Managed). | **Changed** (sub-processor framing). |
| Personal data collected by the app? | **No** app analytics/telemetry. | Same. |
| Security contact | **security@spec2jira.com** | Same. |

---

## D. Reviewer-facing notes (paste into the submission notes / be ready to explain)

1. **Hybrid app, two data postures.** BYOK = customer's key (vendor not a processor of the
   Anthropic content). Managed = vendor's key (vendor = processor, Anthropic = sub-processor).
   The questionnaire answers above describe the app **inclusive of Managed**, which is why
   several answers are now "Yes / under our account."
2. **FIT/remote-host is still resolved.** Managed introduces **no remote host** — it calls
   `api.anthropic.com` from the Forge resolver with a vendor-held key. There is nothing new for
   a Forge Invocation Token to be validated against.
3. **Retention is disclosed honestly.** We use the **Anthropic Batches API**, which is **not
   ZDR-eligible** (≤~29-day retention; the vendor may proactively delete the batch after
   retrieving results to shorten the window). We **deliberately do not claim zero retention.** A
   customer needing zero retention uses **BYOK**.
4. **No new scopes or egress** versus the approved build. Only the **key source** changes for
   Managed.
5. **`asUser()` preserved.** Managed did not move to `asApp()`. Managed generate/push is
   license-gated; the approved per-user `asUser()` permission model is intact.
6. **Editions / change review.** An editions review is a **functional / packaging / guidelines**
   review plus Atlassian's **continuous security review**.
   **[PARTNER: confirm via Marketplace support / the ECOHELP ticket whether the editions reviewer
   actively re-runs the security/privacy assessment for this data-handling change]** rather than
   assuming the questionnaire is re-evaluated automatically.

---

## E. [PARTNER: verify / legal review] before submitting

- [ ] **[PARTNER: verify]** Managed Anthropic account is on **commercial/API terms** (enables
      no-training default + auto-incorporated DPA/SCCs).
- [ ] **[PARTNER: verify]** Managed code logs **no content** and **never logs the Managed key**;
      key is in Forge encrypted secret/env storage.
- [ ] **[PARTNER: verify]** Forge purge for Managed (post-push `purgeJob`) works. **Honest current
      behaviour for v5.4.0 (breakdown-only):** there is **no scheduled sweep / TTL** for abandoned
      breakdowns in this release. An un-pushed breakdown **persists in the customer's own Atlassian
      instance (Forge KVS) until it is pushed, regenerated, or the app is uninstalled** — purge
      happens **on push**. Do **not** assert a live sweep/TTL; state only the on-push purge +
      uninstall removal. (Anthropic-side inputs/outputs still auto-delete ≤~29 days regardless.)
- [ ] **[PARTNER: verify]** Managed generate/push is gated behind an active license/trial;
      `asUser()` retained (no `asApp()`). There is **no in-app Free tier** (removed 2026-06-03);
      evaluation = the 30-day Atlassian trial; a truly unlicensed user is blocked natively + a
      defensive `license_required` backstop is present.
- [ ] **[PARTNER: legal review]** SCC module(s): **Spec2Tickets→Anthropic = Module 3
      (processor-to-processor)**; the **customer↔Spec2Tickets** leg is intra-EEA = **Art. 28 DPA
      only (no SCCs)**; TIA on file for the US transfer.
- [ ] **[PARTNER: execute]** Publish the **privacy policy update**, the **customer-facing DPA**,
      and the **sub-processor list** at stable URLs **before** submitting; link all three in the
      listing.
- [ ] **[PARTNER: verify]** the **~29-day** retention and **~2-year** flagged-content figures
      against Anthropic's then-current published policy at submission time. **Model caveat:** these
      retention facts are for a **Sonnet-via-Batches** pipeline. If the Managed model ever changes
      to a "Covered Model" (e.g. Fable 5 / Mythos 5 = 30-day, no-ZDR-ever) or to the **synchronous
      Messages API** (ZDR-eligible), the retention claim must be **re-checked**.
- [ ] **[PARTNER: verify]** `security@spec2jira.com` is monitored and backed by an incident
      process (Art. 33 duty now lands on us for Managed content).

---

### Document control
- **Status:** DRAFT — `[PARTNER: verify]` / `[PARTNER: legal review]` as marked.
- **Companion files:** `docs/compliance/DPA-managed-tier.md`, `docs/compliance/subprocessors.md`.
- **Supersedes for Managed:** the BYOK-only answers in `docs/MARKETPLACE-LISTING-v3.md` §4–§5
  (those remain accurate for a BYOK-only world; this file is the Managed-inclusive version).
- **Reconciled for:** the **v5.4.0 breakdown-only** release (no test-case generation, no orphan/TTL
  sweep, no delete-on-regenerate). The original `atlassian-questionnaire-managed.md` is UNCHANGED.
- **Last updated:** 2026-06-03 (v5.4.0 reconciliation, June 2026).
