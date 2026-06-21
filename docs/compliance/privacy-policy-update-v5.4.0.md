# Privacy Policy Update — Managed Tier (vendor-key) data processing

> **v5.4.0 RECONCILIATION (DRAFT — pending [PARTNER: legal review]).** Accurate for the
> breakdown-only v5.4.0 release (no test-case generation, no automatic orphan sweep / TTL,
> no delete-on-regenerate). This is **new content to splice into the public privacy policy**
> (`spec2jira.com/privacy`); it does **not** modify any live-site page. The partner publishes
> it into the site repo separately. Research facts verified <session, June 2026>.

> ⚠️ **[PARTNER: legal review]** — This is an engineering-grounded DRAFT prepared by the
> vendor team. It is **not legal advice** and has not been reviewed by a qualified
> data-protection lawyer. Before publishing it, have counsel in your governing jurisdiction
> review it — especially the bracketed `[PARTNER: …]` values and the SCC / transfer
> statements. Confirm every external figure against the providers' then-current published
> policies at the time of publication.

---

## Two editions, two data postures (read this first)

Spec2Tickets turns a Confluence page into a structured Jira breakdown using Anthropic's
Claude models. There are two editions, and **where your content goes depends on which one you
use**:

- **Standard (BYOK — "Bring Your Own Key").** You supply your **own** Anthropic API key. Your
  page content goes from Atlassian Forge straight to Anthropic **under your own agreement with
  Anthropic**. Your relationship with Anthropic is **direct** — you are the controller and
  Anthropic is **your** processor. Spec2Tickets operates no backend in this flow and is **not**
  a processor of the content sent to Anthropic. **The Managed-tier section below does not apply
  to BYOK.** If you want the strictest data-handling posture, BYOK is the recommended choice.

- **Advanced (Managed — vendor key).** You do **not** supply a key. Spec2Tickets calls the
  Anthropic API using **Spec2Tickets' own** Anthropic account to generate your breakdown. In
  this edition **you are the controller, Spec2Tickets is your processor, and Anthropic is
  Spec2Tickets' sub-processor.** The section below discloses exactly what that means.

---

## Managed tier (vendor-key) — data processing

This section applies **only** when you use the **Advanced (Managed)** edition.

### What data is processed

When you run a Managed-tier breakdown, Spec2Tickets processes:

- **The Confluence page (specification) text you submit** — the page content selected for the
  breakdown, plus the generated Jira breakdown (Epic, stories, subtasks, acceptance criteria,
  story points, dependency links). This free-text content is **controlled by you** and may
  incidentally contain personal data (for example, names, work email addresses, or role titles
  written into a spec). You decide what a page contains and should not include
  special-category or other sensitive data — for those, use BYOK or redact first.
- **The submitting user's Atlassian account identity** — the Atlassian account of the user who
  runs the breakdown, used to perform the action under that user's own Atlassian permissions
  and (for the Managed edition) to meter fair-use against that user's monthly allowance.

We do **not** use your content for analytics, marketing, advertising, or model training.

### Sub-processor: Anthropic PBC (United States)

For the Managed edition, Spec2Tickets sends your page content to **Anthropic PBC** (the maker
of Claude), located in the **United States**, for AI inference, and receives the generated
breakdown back. Anthropic is Spec2Tickets' **sub-processor** for this edition.

- **API used:** the Anthropic **Message Batches API** (asynchronous).
- **Retention at Anthropic:** the Batches API is **not** eligible for Zero-Data-Retention.
  Inputs and outputs of a batch job are **retained by Anthropic for up to approximately 29
  days**, after which they are deleted in the ordinary course, per Anthropic's then-current
  retention policy. Where technically possible, Spec2Tickets may proactively request deletion
  of a batch immediately after retrieving the breakdown, to shorten that window. We do **not**
  claim "zero retention" for the Managed edition — if you require zero/minimal retention, use
  **BYOK** and configure your own Anthropic agreement accordingly.
- **No model training by default:** under Anthropic's commercial/API terms, Anthropic does
  **not** train its models on content submitted via its commercial API by default; Spec2Tickets
  keeps any optional feedback-based training setting **off**.
- **Cross-border transfer:** the transfer of your content from Spec2Tickets (processor, in the
  EEA) to Anthropic (sub-processor, in the US) is covered by the **EU Standard Contractual
  Clauses, Module 3 (processor-to-processor)**, together with the UK International Data
  Transfer Addendum where UK data is involved. These are **auto-incorporated into Anthropic's
  Data Processing Addendum and Commercial Terms** (no separate signature is required).
- Anthropic may retain a small subset of content flagged for trust-and-safety, legal, or
  abuse-prevention reasons for a longer period (up to approximately 2 years), as described in
  Anthropic's own policies. This is outside Spec2Tickets' control and is disclosed for
  transparency. **[PARTNER: verify]** all Anthropic figures against Anthropic's published
  policy at the time of publication.

Anthropic publishes its own sub-processors, certifications, and change notices at
**trust.anthropic.com**.

### Storage and deletion (the honest current behaviour)

Your page content and the generated breakdown are stored **transiently inside your own
Atlassian (Forge) instance** — they are kept only to drive the review-and-push workflow, and
Spec2Tickets runs no separate vendor database or backend for them.

- When you **push the breakdown to Jira**, the App **purges** the stored page content and
  breakdown from your Forge storage as part of that flow.
- **A breakdown you generate but never push persists in your own Atlassian instance** until one
  of these happens: (a) you push it to Jira (which triggers the purge above), (b) you
  **regenerate** the breakdown for the same page (the prior content is overwritten by the new
  generation), or (c) you **uninstall** the App (Atlassian Forge clears the App's stored data
  for that instance).
- **This release ships no automatic, time-boxed sweep and no storage time-to-live (TTL).** We
  do **not** claim that an abandoned, never-pushed breakdown is deleted immediately or after
  any fixed number of days. Because that content never leaves your own Atlassian instance and
  is never sent to the sub-processor until you generate, it stays under your control. (A
  scheduled cleanup is a possible future improvement and is **not** part of this release.)

Note: the only external destination for your content is **Anthropic** (the sub-processor
above); see its ~29-day retention described earlier.

### How this differs from BYOK (Standard)

| | **Standard (BYOK)** | **Advanced (Managed)** |
|---|---|---|
| Anthropic key used | **Your** Anthropic key | **Spec2Tickets'** Anthropic key |
| Your relationship with Anthropic | **Direct** (you = controller, Anthropic = **your** processor, under **your** Anthropic agreement) | **Indirect** (you = controller, Spec2Tickets = your processor, Anthropic = Spec2Tickets' **sub-processor**) |
| Is Spec2Tickets a processor of the Anthropic-bound content? | **No** | **Yes** |
| Does this Managed section / the DPA apply? | **No** | **Yes** |

Under **BYOK**, your content goes to Anthropic under your own agreement, so Spec2Tickets is not
a processor of it. Under **Managed**, Spec2Tickets processes your content with its own key on
your behalf, which is why the DPA and the sub-processor disclosure above apply.

### Where to read more

- **Data Processing Addendum (Managed tier):** [PARTNER: fill — public DPA URL, e.g.
  `https://spec2jira.com/dpa`]
- **Sub-processor list:** [PARTNER: fill — public sub-processor URL, e.g.
  `https://spec2jira.com/subprocessors`]
- **Privacy / data-protection contact:** [PARTNER: fill — e.g. `privacy@spec2jira.com`]

---

### Document control
- **Status:** DRAFT — pending `[PARTNER: legal review]`. v5.4.0 (breakdown-only release).
- **Scope:** Adds the Managed-tier (vendor-key) disclosures to the public privacy policy.
  BYOK (Standard) is unaffected and remains the privacy-maximising option.
- **Source of facts:** Anthropic Message Batches API retention (non-ZDR, ≤ ~29 days; vendor may
  proactively delete the batch after retrieval; flagged content up to ~2 years), no model
  training on commercial-API data by default, Anthropic DPA + EU SCCs (Module 3,
  processor-to-processor) auto-incorporated into the Anthropic Commercial Terms (no separate
  signature), and the App's actual Forge KVS behaviour for v5.4.0 (`purgeJob` on push; no
  automatic sweep / TTL for never-pushed breakdowns). **[PARTNER: verify]** all external
  figures against the providers' then-current published policies before publishing.
- **Companion documents:** `docs/compliance/DPA-managed-tier-v5.4.0.md`,
  `docs/compliance/subprocessors-v5.4.0.md`.
- **Last updated:** 2026-06-17 (v5.4.0 reconciliation).
