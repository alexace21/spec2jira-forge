# Product Improvements — Handover (dedicated branch, fresh session)

> Created 2026-06-01 from the competitive analysis (POPal / Storygenie / StoryLoop).
> **Build this in a FRESH session on a NEW branch — suggested `feature/product-improvements`** —
> kept ISOLATED from the launch/resubmit work on `feature/v3-pivot`. Source intel:
> `memory/competitive-landscape.md`. Apply POLICY.md (A→D→S, dispatch rule, §8 informational
> completeness, §5 Bug Y, verification where silent miss is costly).

This is a backlog, not a commitment to scope. Re-Analyze each item through the LENS at the
start of the dev session before writing code.

---

## P1 — Project Context / glossary injection  ⭐ (table-stakes)

**Analyze.** BOTH POPal and StoryLoop ship a persistent per-project **Project Context**
(domain, glossary, tech stack, team conventions, preferred AC format) that is injected into
*every* generation. POPal even has two layers (a Project Context block + project-level
additional prompts for "stories from epic" and "test cases from story"). We currently rely
*solely* on the spec page as context — no persistent house-style/glossary layer. This is the
single most common feature we lack vs rivals, and it is squarely POLICY §8 (informational
completeness): a richer, standing context improves every breakdown.

**Design (sketch).** A per-install (and/or per-Confluence-space) **Project Context** document
— bounded free text: domain, glossary ("'user' = authenticated admin"), tech stack,
conventions, preferred AC format (e.g. Given/When/Then). Store in KVS; prepend to the
**cacheable** SYSTEM_PROMPT at generation (cache_control ephemeral — POLICY §12). **Critical
guardrail (POLICY §5):** it ENRICHES, it does NOT redefine scope — the spec defines what to
build; context only shapes style/terminology. It is user-supplied config, NOT corpus-pattern
enumeration in *our* prompt, so it does not violate Bug Y — but keep it ONE bounded field; do
not grow it into a keyword/cue list.

**Why now.** Cheap, high-consistency win; matches category table-stakes; lets teams enforce a
house style → higher trust in output.

---

## P1/P2 — Test-case generation  (explicitly requested for this branch)

**Analyze.** POPal generates test cases *and* automation-script stubs (shown live: Selenium +
`assertEquals`) and is named for it; StoryLoop advertises test cases but it is **broken** on
trial. The category name itself often includes "test case." We produce none. Real gap — and a
chance to do it *better* than both (POPal is slow + complained-about; StoryLoop is broken).

**Design (sketch).** A per-Story **"Generate test cases"** action (in the editor and/or
post-breakdown) that reads the Story + its acceptance criteria → produces test cases
(Given/When/Then steps + expected result). This is a **distinct LLM call** (dispatch rule:
meaning-reading → LLM), bounded per-Story, with the §8 4-part contract (the Story, its AC,
sibling stories, provenance). **Verification (POLICY §7):** test cases are lower-stakes than a
destructive JIRA op, so a single Sonnet call is fine initially — but surface failures loudly
(unlike StoryLoop's dead "Manage License" link). Output options: push as subtasks / linked
issues / a checklist on the Story (reuse the proven `bulletList` ADF, NOT `taskList` — gotcha
#11). Later (not v1): Zephyr/Xray awareness (POPal's edge). Likely a **Pro-tier** feature.

**Why now.** Table-stakes; differentiates on quality + human-in-the-loop (our strength).

---

## P2 — Custom prompt / house-style option

**Analyze.** POPal's reviews explicitly ask for it ("I want to make my own prompt") — and POPal
*has* it but users can't find it (a discoverability failure we can beat with good UX). A light
output-style control raises adoption in teams with documentation standards.

**Design (sketch).** A small **"output style"** setting (AC format Given/When/Then vs bullets;
tone; story template). Bounded enum + one optional free-text note (folds into Project Context
above). Avoid free-form pattern lists (§5).

---

## P2/P3 — Editor UX investment  (ties to the segment decision)

**Analyze.** Our **BreakdownEditor is our human-in-the-loop surface** — and the strategic reason
we do NOT need an in-Jira panel (the editor is where the BA/PO reviews/edits before push).
POPal's #1 review complaint is "no chance to review." Our review/edit gate is a STRENGTH; make
it excellent so users never wish they were editing in Jira instead.

**Design (sketch).** Per-feature inline regenerate; smoother bulk edits; clearer dependency
editing; scroll/resize polish (the open Forge scroll-to-top item, CLAUDE.md). Scope precisely
in the dedicated session.

---

## P-next — Managed (vendor-paid, no-key) tier  [reselling question RESOLVED 2026-06-01]

**Analyze.** All three rivals are zero-setup (no key); our BYOK is the #1 onboarding-friction
objection. A Managed tier (we call Claude with OUR key; the customer just installs) erases it.
POPal proves the hybrid (Managed default + BYOK option) works at 211 installs.

**Reselling — RESOLVED (verify verbatim + with counsel before shipping).** Anthropic Commercial
Terms **A.1 explicitly permit** "use the Services, including to power products and services
Customer makes available to its own customers." Our multi-stage value-add pipeline is "building a
product that uses the API," NOT a passthrough. The prohibited pattern (D.4: "resell the Services
except as expressly approved" / authenticating raw API calls on behalf of third-party end users)
is NOT what we do. A formal reseller/partner agreement is OPTIONAL, only relevant at ~six-figure
annual API spend. **No special reseller approval needed at our scale.**

**Design (sketch).** KEEP BYOK (do NOT remove — hybrid). Add Managed: our Anthropic key in a Forge
env var (egress already to api.anthropic.com). **Cost control:** Managed = CAPPED tiers (we pay
compute) + per-tier pricing covering inference + margin. **The REAL work is data-processing, not
approval:** under Managed WE become a processor of the customer's spec content → need (a) our own
Anthropic DPA + zero-retention/no-train, (b) a DPA we offer customers, (c) updated privacy
questionnaire/listing (process-outside-Atlassian = Anthropic under OUR account; subprocessor list).

**Why now.** Next release AFTER the launch/resubmit. Erases onboarding friction → conversion;
matches the category norm; BYOK stays for privacy-max customers.

---

## Future vision / platform direction  (longer-term; value-adds that sharpen market presence)

- **Capacity-aware sprint planning:** ingest a team capacity sheet + the generated backlog (we
  ALREADY emit story points / complexity / a dependency graph) → help PO/PM plan sprints
  (fit-to-capacity, dependency-ordered sequencing). This is a coherent thesis, not just a
  "nice-to-have": it extends our existing sizing + dependency moat from **spec→backlog** to
  **spec→backlog→plan** — a platform direction rivals (flat prompt→list) cannot easily follow.
- Discipline: capture real demand signals first; re-Analyze through the LENS; post-MVP, not now.

---

## Explicitly NOT doing (decided 2026-06-01 — do not reopen without new evidence)

- **In-Jira issue panel.** Our act is per-spec, upstream, in Confluence; devs *consume* the Jira
  output, they are not users of the generator. An in-Jira surface solves a problem we don't have.
  If users ever ask for it, treat it as a signal that the **editor UX** needs work — fix that
  instead.
- **Per-dev-seat pricing as the core metric.** Our user-buyer is the BA/PO/PM (they generate);
  devs are beneficiaries. Per-breakdown is the right value metric (see pricing decision).

---

**Suggested branch:** `feature/product-improvements` (fresh session). Keep launch/resubmit work
isolated on `feature/v3-pivot`. Start each item with the LENS gate (POLICY §0).
