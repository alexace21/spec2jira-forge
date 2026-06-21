# Planner MR-1 — crafted test spec + rubric (Phase 3 risk-sequencing + Phase 9 P12)

> The two MR-1 SHIP gates need a backlog rich in **high delivery risk + external dependencies + a deep
> dependency chain + a spec-wide compliance concern + plain unflagged features**, with **varied sizing**.
> This is a full PRD engineered to elicit those shapes at FlexiCash-level density (~12-13 features). ONE
> backlog serves BOTH gates. Partner-executed (BYOK). Record fractions in the tables below.

---

## Step 1 — create the Confluence page

⭐ **CANONICAL INPUT (use this):** the partner's full PRD `Page7_MediQueue_Telehealth.md` — a complete,
realistic telehealth feature spec (document control · stakeholder conclusions · open decisions · personas ·
state models · per-feature acceptance criteria · business rules BR-xxx · §11 external-dependency table · §13
MoSCoW · §14 risk register). It is STRICTLY BETTER than the embedded fallback below for MR-1: it firms up the
two load-bearing shapes — AI-Triage `[RISK|high]` (via §14 risk register + §13 "Won't") and spec-wide
`[COMPLIANCE]` (via §5 + Open Decisions OD-1..4). The minimal embedded spec below is a fallback only.

Paste the PRD into a **new Confluence page**. Title it **"MediQueue — Telehealth Visit Platform"**.

> ⚠ Generation is stochastic. After generating, **verify the Risk Register / breakdown shows**:
> - ⭐ **AI Symptom Triage APPEARS as a feature** — it's MoSCoW "Won't (this release)" / out-of-critical-path,
>   so the generator *could* drop it as out-of-scope. It is the UNIQUE R3 anchor (only risky + low-priority
>   feature). If it's missing, regenerate; if still missing, we add a light nudge. ← check this FIRST.
> - *AI Symptom Triage* = **high / delivery risk** + **low priority**.
> - vendor-backed features (*Live Video*, *Insurance Eligibility*, *E-Prescribing*, *SMS Reminders*,
>   *Payments*) = **External dependency**.
> - a **[COMPLIANCE]** spec-wide concern (HIPAA / open compliance scoping).
> - *Visit Scheduling* = **highest priority + clean** (the R3 counterweight).
>
> If a flag under-fires, regenerate once or twice. If it still under-flags, proceed with what exists
> (low-confidence flags still exercise the de-risk nudge) and note it.

<details><summary>Embedded fallback spec (use only if the PRD is unavailable)</summary>

### ⤵ SPEC TO PASTE

```
# MediQueue — Telehealth Visit Platform

## 1. Overview & goals
MediQueue lets patients book, pay for, and attend video consultations with licensed clinicians, and receive
follow-up prescriptions — entirely online. The launch goal is a safe, compliant end-to-end visit: register →
intake → schedule → video visit → prescription. Success = a patient can complete a first visit in under ten
minutes and a clinician can run a full clinical workflow without leaving the app.

## 2. Compliance, privacy & security (cross-cutting)
All patient data is Protected Health Information (PHI). The platform must be HIPAA-compliant end to end:
encryption in transit and at rest, immutable audit logging of every PHI access, role-based access control,
configurable data-retention windows, and a signed Business Associate Agreement (BAA) with every external
sub-processor before that integration may go live. Payment flows are in PCI-DSS scope. Final HIPAA and
PCI-DSS scoping, the BAA terms, and the audit-retention windows are still open and require security and legal
sign-off before launch. These obligations apply to the whole backlog and gate launch; they are not a single feature.

## 3. Account, identity & access management
Patients register with email and phone and set a password; multi-factor authentication is required at login.
New patients complete a lightweight identity check (name, date of birth, knowledge-based verification) before
they can hold a visit. Clinicians and administrators have separate roles with least-privilege access to PHI.
Profile management lets a patient update contact details, emergency contact, and pharmacy of choice. This is
the foundation that every other flow depends on and must be in place before any other flow.

## 4. Patient intake & medical history
After an account exists, the patient completes a structured intake questionnaire: presenting complaint,
allergies, current medications, past conditions, and family history. Patients can upload photos or documents
(e.g. a rash, a prior lab result). Answers are normalised to a standard clinical vocabulary so a clinician
can read them quickly. A completed, current intake is required before a visit can be scheduled. Core,
high priority.

## 5. Insurance eligibility check
Before booking, MediQueue verifies the patient's insurance coverage and co-pay in real time by querying a
third-party eligibility clearinghouse (e.g. Change Healthcare / Availity). The clearinghouse response time
and uptime are outside our control and responses are occasionally ambiguous, so the flow must degrade
gracefully to "coverage unverified — pay out of pocket". Requires an account and basic profile. Depends on
an external network.

## 6. Visit scheduling
Patients browse real-time clinician availability filtered by specialty and book a slot; they can reschedule
or cancel, and join a waitlist for earlier openings. Time zones and clinician working hours must be handled
correctly. Scheduling requires a completed intake. This is the core of the product and the single
highest-priority flow for launch.

## 7. Payments & co-pay collection
At booking, MediQueue collects the visit co-pay (or the full self-pay amount) through Stripe, an external
payment processor; card data never touches our servers (PCI scope). The flow handles declines, refunds for
cancelled visits, and receipts. Requires scheduling and the eligibility result. Depends on an external
processor.

## 8. Live video visit
At the appointment time the patient and clinician join a real-time video room delivered through a third-party
WebRTC vendor (e.g. Daily.co). Call quality and availability depend entirely on the vendor's SLA and uptime,
which we do not control, so the visit must detect a failing connection and offer an audio-only or phone
fallback. Includes in-visit secure chat and, with explicit patient consent, recording. Requires a scheduled
(and paid) visit. Depends on an external vendor.

## 9. AI symptom triage (experimental)
Before a visit, an experimental machine-learning model suggests a likely triage category and urgency from the
intake answers, to help the clinician prepare. The model is new, its accuracy on our patient population is
unproven, and an incorrect or over-confident suggestion could mislead a clinician — so it is strictly
advisory, must show a confidence caveat, and is never shown to the patient. It is a nice-to-have for the
first launch, is explicitly secondary to the core booking and visit flow, and can be deferred to a later
release without affecting a patient's ability to book and complete a visit. Because an over-confident wrong
suggestion is a patient-safety risk and the model is unvalidated on our population, this is the highest-risk
item in the backlog and must be gated behind a clinician-accuracy review before launch. Requires intake data.

## 10. E-prescribing
After a visit, a clinician can send a prescription directly to the patient's chosen pharmacy through the
national e-prescribing network (Surescripts). Controlled substances require EPCS two-factor identity proofing
of the prescriber and are heavily regulated; a mis-routed or duplicate prescription is a patient-safety
event. Depends on a completed visit and on an external, regulated network.

## 11. SMS appointment reminders
Send SMS reminders 24 hours and 1 hour before each visit through Twilio, an external messaging provider, with
opt-out handling. Small and secondary. Requires scheduling.

## 12. In-app notification center
A simple in-app feed of appointment, message, and prescription notifications, with read/unread state. It
surfaces scheduling and visit events, so it requires scheduling to be in place. Fully self-contained — no
external services. Small and secondary.

## 13. Clinician directory
A browsable, searchable directory of clinicians with specialty, languages, bio, and patient rating.
Straightforward listing and search; no PHI. Low priority.

## 14. Visit history & records
Patients can view their past visits, clinical notes, and prescriptions, and download a visit summary PDF.
Read-only. Low priority.

## 15. Admin dashboard & audit reporting
Administrators view operational metrics (visit volume, no-show rate) and review the HIPAA audit log for
compliance. Internal-facing; straightforward reporting over existing data.
```
</details>

### How the spec maps to the rubric (what to look for — feature names match BOTH the PRD and the fallback)
- **Deep dependency chain (a):** Account → Intake → Scheduling → Video Visit → E-Prescribing (+ Eligibility/Payments branch). Tests R1.
- **Near-tie pair (b):** *SMS Appointment Reminders* (external dep, Twilio) vs *In-App Notification Center*
  (clean) — similar small/secondary. Tests R2.
- **Conflict pair (c):** *AI Symptom Triage* (high-risk, secondary/low priority) vs *Visit Scheduling* (clean,
  highest-priority core). The load-bearing R3.
- **Spec-wide compliance (d):** HIPAA/PHI → a `[COMPLIANCE]` spec concern. Tests R4.
- **Unflagged (e):** *Clinician Directory*, *Visit History*, *Admin Dashboard*, *In-App Notification Center*. Tests R5.
- **External-dep cluster:** Eligibility (clearinghouse), Payments (Stripe), Video (Daily.co), E-Prescribing
  (Surescripts), SMS (Twilio) — multiple `[EXTERNAL_DEPENDENCY]` for the de-risk nudge.

---

## Step 1b — verify-run findings (the MediQueue breakdown, 2026-06-21)

Generated breakdown = **16 features**, varied SP (1/3/5/8/13), varied priority, deep correct chain, 6
external-dep, 4 high-risk. AI Symptom Triage = `[RISK|high]` + **Low** priority ✓ (the R3 anchor is present).

- ⭐ **R3-cleanliness edit (DO THIS before the runs):** the generator over-connected AI Symptom Triage to
  `dependencies: [Intake, Live Video Visit]`. Video depends on Scheduling, so AI Triage is transitively AFTER
  Scheduling in EVERY valid order → R3 would pass by pure topology, testing nothing about de-risk-yields-to-
  priority. The spec (§9) says triage consumes **intake data, before the visit** → the Video dep is a spurious
  over-inference. **In the BreakdownEditor, remove the AI Symptom Triage → Live Video Visit dependency (leave
  Intake only).** Then AI Triage is shallow → de-risk could pull it early → priority (Low vs Scheduling's High)
  must keep it subordinate → a REAL R3 test.
- **R4 not exercised (acceptable):** HIPAA routed to `shared_acceptance_criteria` + per-feature
  `[COMPLIANCE|high]`, NOT `spec_concerns` → no spec-wide compliance band. Not the SHIP gate; per-feature
  COMPLIANCE is not a RISK_LEVEL_TYPE so it can't distort the ranking; nothing to mis-attribute → R4 passes by
  absence. Score R4 as N/A (note it).
- **R2 confound (accept):** In-App Notification Center deps `[Scheduling, Video, E-Prescribing]` is deeper than
  SMS `[Scheduling]` (spec-justified — it surfaces visit/prescription events), so In-App lands later partly for
  dependency reasons, not purely the de-risk tiebreak. R2 is flicker-tolerant (≥2/3) — accept + disclose.

## Step 2 — team capacity (same for all runs)

Use a team where MOST work fits, so the **ordering is visible across sprints** (MR-1 is about ORDER, not overflow):
- Ivan — Backend — 17 · George — Backend — 10 · Sam — Frontend — 17 · Violeta — QA — 17
- Sprints 6 · length 17 · **focus 0.7** · Planning objective **Balanced** (for Phase 3).
- *(6 sprints so this denser backlog has room to sequence across sprints, not pile into overflow.)*

---

## Phase 3 — MR-1 risk-sequencing (Balanced objective)

Run **"Re-rank with Claude" ≥3 times** on this backlog (each a fresh Batches run). Score each rule
`passes / runs`. **R1 + R3 must be 3/3** to pass the gate.

| # | Rule | What to check | Target | Run1 | Run2 | Run3 |
|---|------|---------------|--------|------|------|------|
| R1 | **Hard dep never violated** | No feature scheduled before its blocker (Intake before Scheduling before Video before E-Prescribing) | **3/3** | ☐ | ☐ | ☐ |
| R3 | **De-risk stays subordinate** | *AI Symptom Triage* (risky, low-priority) does NOT jump above *Visit Scheduling* (clean, high-priority core) | **3/3** | ☐ | ☐ | ☐ |
| R2 | **De-risk fires on near-tie** | *SMS Reminders* (external dep) lands **earlier** than *In-App Notification Center* (clean twin) | ≥2/3 | ☐ | ☐ | ☐ |
| R4 | **Spec-wide concern not mis-attributed** | HIPAA shows once in the spec-wide band; never fabricates a per-feature reason or distorts order | 3/3 | ☐ | ☐ | ☐ |
| R5 | **Absence ≠ signal** | Clinician Directory / Visit History / Admin ranked on normal signals (size/priority/leverage), neither penalised nor boosted | 3/3 | ☐ | ☐ | ☐ |
| R6 | **Rationale honesty** | Any one-clause rationale (on a non-obvious deferral/inversion) is accurate, not boilerplate | qual. | ☐ | ☐ | ☐ |

- Record fractions. **R1 + R3 = 3/3** is the gate. R2 may flicker — disclose it (don't chase 3/3 on the tail).
- If R1/R3 fail: I adjust `PLAN_RANKING_SYSTEM_PROMPT` (kept ABSTRACT — §5: no enumerating concern types), re-run, record before→after.

---

### Phase 3 RESULT (2026-06-21) — PASS ✅
R1 3/3 · R3 3/3 · R2 3/3 (zero flicker) · R5 3/3 · R4 N/A. Zero variance across 3 runs. **The Balanced
control order (baseline for Phase 9 comparison):**
- **S1:** Account · RBAC · Eligibility · Identity Verification · Intake · Profile
- **S2:** Visit Scheduling · Payments · Live Video · SMS
- **S3:** E-Prescribing · Admin · In-App Notification · Visit History · Clinician Directory
- **S4:** AI Symptom Triage *(high-risk but Low priority → deferred to last despite being Intake-only/shallow)*

## Phase 9 — MR-1 P12 (goal-directed re-rank)

Same backlog. For EACH objective, set **Planning objective** → **Re-rank with Claude ≥3×** and score vs the
**Balanced** control (from Phase 3). The hard-dep rule is the cross-objective must-hold.

| Objective | Rule | Target | Run1 | Run2 | Run3 |
|---|---|---|---|---|---|
| ALL | **Hard dependency NEVER violated** (any objective, any run) | **3/3 each** | ☐ | ☐ | ☐ |
| ALL | Produces a **visibly different order** from Balanced (not a no-op) | ≥2/3 each | ☐ | ☐ | ☐ |
| mvp | First sprint(s) are a smaller, more foundational/coherent set than Balanced | ≥2/3 | ☐ | ☐ | ☐ |
| min_risk | High-risk (AI Triage) + external-dep work ranks **earlier** than Balanced — still under blockers | ≥2/3 | ☐ | ☐ | ☐ |
| max_value | High-priority/high-leverage (Account, Intake, Scheduling) ranks **earlier** than Balanced | ≥2/3 | ☐ | ☐ | ☐ |

**MR-1 watch (the 3 P12 deep-audit failure modes — note if seen, don't fail on them alone):**
- **LESSON-E balanced bias** — `mvp`/`max_value` must NOT just become `min_risk` in disguise (risk-first under every label).
- **decisive-test drift** — the same objective shouldn't swing between two distinct strategies across the 3 runs (that's drift, not tail-tie flicker).
- **mvp no-op** — `mvp` may land close to Balanced (no cluster signal in the rows); if so, record as a known limitation, NOT a §5-violating topic-enumeration fix.

### Phase 9 RESULT (2026-06-21) — PASS-with-findings ✅ (1 run/objective; partner-accepted)
- **hard-dep 3/3 across all 4 objectives** ✅ (structural — the packer enforces it).
- **Mechanism PROVEN** ✅ — `min_risk` visibly + correctly re-orders vs Balanced: **AI Symptom Triage S4→S3** (high-risk pulled earlier), clean low-priority **Clinician Directory S3→S4**; deps untouched.
- **No LESSON-E leak** ✅ — `mvp` and `max_value` did NOT become risk-led; they returned the EXACT Balanced allocation.
- ⚠ **FINDING (accepted, not a bug):** for THIS backlog **`mvp` ≈ `max_value` ≈ Balanced; only `min_risk` is distinct.** Cause: Balanced already weights priority+leverage+deps, so value-led (`max_value`) ≈ Balanced, and MediQueue's MVP = its critical path = high priority (`mvp` ≈ Balanced). The clauses DO inject + re-weight (different prompts; cost confirms Claude calls) — they just CONVERGE when priority=value=MVP align. `max_value` may be **generally** close to Balanced (both value-weighted); `min_risk` is the clearest differentiator.
- **OPEN (future, NOT now — §9/§5):** is `max_value` distinct enough from Balanced to warrant a separate option? A product/prompt-tuning question requiring multi-run validation + a §5-clean change. Do NOT speculatively change.

---

## What to send me
- The **Risk Register** after generation (screenshot) — so I confirm the backlog carries the needed shapes.
- The **sprint order** for each run (a screenshot of the plan, or the Plan Brief "What fits" per-sprint list — the cleanest order readout).
- The **fractions** for R1/R3 (Phase 3) and the hard-dep rule (Phase 9). I fill the tables + decide pass/adjust.
