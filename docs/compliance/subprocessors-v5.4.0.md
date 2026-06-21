> v5.4.0 RECONCILIATION (DRAFT — pending [PARTNER: legal review]). Accurate for the breakdown-only release. The original draft file is UNCHANGED. Publish THIS version for v5.4.0. Research facts verified <session, June 2026>.

# Spec2Tickets — Sub-processors

> **Public sub-processor disclosure** for the Spec2Tickets Forge app.
>
> This page lists the third parties Spec2Tickets engages to process customer content on its
> behalf. It is **material only for the Managed tier**, where Spec2Tickets calls the Anthropic
> API using **its own** Anthropic account (Spec2Tickets = processor, the listed party =
> sub-processor). Under the **BYOK tier**, the customer uses their **own** Anthropic key and
> Anthropic is the customer's *own* processor — Spec2Tickets engages **no sub-processor** for
> BYOK content.
>
> **[PARTNER: execute]** publish this page at a stable public URL (e.g.
> `https://spec2jira.com/subprocessors`) and link it from the Marketplace listing, the privacy
> policy, and the customer-facing DPA (`docs/compliance/DPA-managed-tier.md`).
>
> **[PARTNER: verify]** the region and the change-notice period below match what you actually
> operate before publishing.

**Last updated:** 2026-06-03 · **Maintained by:** Spec2Tickets · **Contact:**
[PARTNER: fill — e.g. privacy@spec2jira.com] · **Security:** security@spec2jira.com

---

## Current sub-processors (Managed tier)

| Sub-processor | Purpose of processing | Data processed | Processing location | Safeguards & references |
|---|---|---|---|---|
| **Anthropic PBC** (maker of Claude) | **AI inference for the Managed tier.** Receives the Confluence specification content the customer submits for a breakdown and returns the generated Jira breakdown (Epic, stories, subtasks, acceptance criteria, dependencies). | The selected spec page content (which may contain customer-controlled personal data, e.g. names/work emails in free text) and the generated breakdown. | **United States** (and any additional regions on Anthropic's then-current sub-processor list). **[PARTNER: verify]** the Managed account's configured region. | • Anthropic Commercial Terms of Service, with **Anthropic's DPA + EU SCCs (and UK Addendum) incorporated by reference** (no separate signature).<br>• **Cross-border transfer safeguard: SCC Module 3 (processor-to-processor)** — Spec2Tickets (processor, EEA) → Anthropic (sub-processor, US) — **auto-incorporated via Anthropic's DPA**.<br>• **No training on customer content by default** (Commercial Terms §B).<br>• **Message Batches API: not ZDR-eligible → inputs/outputs retained ≤ ~29 days**, then deleted; flagged/abuse content may be retained up to ~2 years for legal/safety.<br>• Anthropic's own sub-processors, certifications, and **15-day change-notice** are published at **trust.anthropic.com**. |

> **No "zero retention."** Because the Managed tier uses the Anthropic Batches API, content is
> retained at Anthropic for up to ~29 days. We disclose this rather than claim zero retention.
> Customers who require zero/minimal retention should use the **BYOK tier** and configure their
> own Anthropic agreement accordingly.

---

## Platform provider (not a content sub-processor in the usual sense)

| Provider | Role | Note |
|---|---|---|
| **Atlassian** | **Hosting platform.** Runs the Spec2Tickets Forge app and stores its data **within the customer's own Atlassian instance**. | Governed by the customer's existing agreement with Atlassian. Because app data is stored inside the customer's own instance, Atlassian is **not** a party to whom we *disclose* content in the Managed inference flow the way Anthropic is. Listed for transparency. |

---

## How Spec2Tickets stores and purges content (context for this list)

- Customer content (the submitted page + generated breakdown) is stored **transiently** in
  **Atlassian Forge storage within the customer's own instance**, only to drive the
  review-and-push workflow.
- It is **purged after the customer pushes the breakdown to Jira** (`purgeJob`); uninstalling
  the app removes the app's stored data. A breakdown that is **generated but never pushed**
  persists in the customer's own Forge storage until it is pushed, regenerated, or the app is
  uninstalled — **this release ships no automatic TTL or scheduled-sweep backstop** for
  un-pushed breakdowns. (Because that content never leaves the customer's own Atlassian
  instance and is never sent to a sub-processor, it stays under the customer's control.)
- The **only** external destination for content is **Anthropic** (the sub-processor above). The
  app runs no separate vendor backend or database.

---

## Change-notice policy

- We will give customers **at least 30 days'** advance notice before **adding or replacing** a
  sub-processor for the Managed tier, by updating this page (and/or notifying the customer's
  designated contact). **[PARTNER: verify]** the period and notification channel you can
  actually honour, and align it with the DPA (§6.4).
- **Two distinct notice periods, two distinct parties:** Anthropic's **~15-day** change-notice
  (above) runs **Anthropic → Spec2Tickets** (we are Anthropic's customer); Spec2Tickets'
  **≥30-day** change-notice (this section) runs **Spec2Tickets → our customers**. These are not
  in tension — they are notices given by different parties at different layers of the chain.
- Customers who reasonably object to a new sub-processor on data-protection grounds may raise
  it with us; if unresolved, the customer may stop using the Managed tier for the affected
  processing (BYOK remains available). See the customer-facing DPA for the full mechanism.

---

## How to subscribe to changes

**[PARTNER: fill]** — state the mechanism (e.g. "watch this page," an email list, or an RSS
feed) so customers can receive sub-processor change notices, as the change-notice policy
contemplates.

---

### Notes
- This list reflects the **Managed tier**. **BYOK** uses the customer's own Anthropic key and
  engages **no Spec2Tickets sub-processor** for the content sent to Anthropic.
- External retention figures (~29 days; up to ~2 years for flagged content) are **Anthropic's**
  and should be **[PARTNER: verify]**-checked against Anthropic's published policy at the time
  of any update.
- Companion documents: `docs/compliance/DPA-managed-tier.md`,
  `docs/compliance/atlassian-questionnaire-managed.md`.
