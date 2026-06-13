# Engineering POLICY — Spec2Tickets (foundational, binding)

> This is the engineering philosophy for the Spec2Tickets project — the
> principles the partner taught across the v2.x pipeline work, carried forward
> verbatim where they are foundational. **Read this at the start of every
> session. It is POLICY, not preference.** When a change feels unsure, return
> here. The runtime changed (Qwen pipeline → Anthropic API + Forge); the
> principles did not.
>
> CLAUDE.md is the project map (architecture, Forge gotchas, handover).
> POLICY.md is the operating philosophy. Read both.

---

## 0. The working LENS (ОЧИ) — apply at task START

> Partner's framing (verbatim, preserve across compaction):
> *"Когато преминеш към следващата задача: валидирай с какви ОЧИ гледаш задачата."*
> — Before any task: validate with what EYES you look at it.

The product is **one continuous stream**: spec on the left → JIRA breakdown on
the right. Inside, every step is a **small agent** with a bounded job.
**Our engineering owns** decomposition, information flow, prompt construction,
token budget, fail-closed defaults, observability. **The model engine owns** the
semantic reasoning inside each call. When output is poor, ask FIRST: *did our
engineering give the model what it needed?* — not *can we tighten the prompt?*

### The LENS validation gate — answer all six before writing code

1. **Where in the stream does this task sit?** Name the step + upstream + downstream.
2. **What is the small-agent boundary?** Single call, multi-pass verification, or pure-function orchestration?
3. **What does this step consume from upstream?** (the 4-part informational contract — §8.)
4. **What does this step emit forward?** Name the fields downstream reads.
5. **Where does token budget pressure live?** Filter vs full-input vs adaptive scaling.
6. **What is the HIGHEST-VALUE option here, not the safest one?** (§3.)

Six clean answers = the lens is on. Any "I'll figure it out as I go" = STOP and
re-Analyze through the stream lens.

---

## 1. Analyze → Design → Solve — always, for EVERYTHING

No exceptions. Applies to new features, bug fixes, refactors, prompt edits, docs.
Skipping to Solve produces patches; following the discipline produces architecture.

- **Analyze** — frame the real question. Name the decision under the hood, the
  variable that decides it, the constraints, the priority ladder (§4). If you
  can't state the choice in one sentence, you haven't analyzed yet.
- **Design** — put trade-offs on a table. Rows = candidate designs; columns =
  cost / coverage / determinism / failure-mode / alignment. Fill the inconvenient
  cells honestly. Check: is there an existing call/helper to extend? Is the winner
  universal or patch-specific? What's the defense-in-depth story?
- **Solve** — implement the winning row, with comments referencing why others were
  rejected. End with a **measurement plan**: what signal confirms it worked?

**Cautionary case (Bug AA):** reusing an existing function without checking whether
its correctness assumptions hold at the NEW call site is the same shortcut as
inventing a heuristic without analysis. There is no "small change" exemption — the
discipline applies to reuse too.

---

## 2. Priorities (in order)

1. **Quality of output** — the breakdown must faithfully reflect the spec, at the
   right hierarchy level. No dropped content, no invented features.
2. **Small, fast, reliable calls** — prefer many small bounded calls over one giant
   one; prefer a pure function over any LLM call when the task is deterministic.
3. **SOLID** — single responsibility, pure functions testable in isolation, no
   hidden state across stages.
4. **Universal over patch-specific** — a fix that only helps one spec is not a fix.

**Quality over time elapsed.** The performance buffer we earn is OUR budget for
quality (verification passes, richer prompts) — do not optimize for wall-clock at
the cost of output the user keeps.

---

## 3. Highest-value principle — search for the MAXIMUM, not the safest

> Partner's framing (verbatim): *"При всички решения взети в pipeline които
> решават даден проблем — винаги търсим НАЙ-ГОЛЯМОТО VALUE СТОЙНОСТ."*

Every decision must search for the **highest-value option** within the
architectural constraints — NOT the most-conservative-re-prior-policy option.
Conservative defaults are floors to prevent regressions, NOT goals. A decision
that under-delivers because it played safe is the same defect shape as one that
over-delivers and introduces a trap.

  ❌ "What's the safest option re prior POLICY?"
  ✅ "What option delivers MAXIMUM value to the model / user / product — within constraints?"

The constraints (Bug Y, info-completeness, token budget, dispatch rule) bound the
search space. Inside it, search for the maximum.

---

## 3.5 Simplicity over complexity — the simple design IS the high-value one

> Partner's framing (2026-06-08, verbatim): *"Simplicity over complexity."* —
> e.g. a stable `story_uid` instead of fragile index/name-matching heuristics IS
> simplicity, and improves the design.

When two designs solve the same problem, prefer the one with **fewer moving parts
and a clearer invariant** — even if it touches more files to introduce. A stable
identity (a minted `uid`) is SIMPLER than re-deriving identity from position or
name at every comparison, because the invariant ("this id always means this thing")
removes a whole class of drift bugs (reorder / rename / restructure mis-targeting).
Heuristic matching (index → name → content) is *more code at every call site* and
*more failure modes*; a single source of truth is *less*. **"Simplicity" is measured
by the invariants a reader must hold in their head, NOT by lines-of-diff today.**

  ❌ Re-derive identity (index/name) at every binding site → N places to drift-wrong.
  ✅ Mint a stable id once, thread it → the binding is trivially correct everywhere.

This composes with §3 (highest-value): the simplest correct design that deletes a
bug *class* is usually also the highest-value one. Reach for it even when the quick
patch (one more heuristic) looks cheaper in the moment — the heuristic is the
complexity; the stable invariant is the simplicity.

**Addendum — Simplicity over over-engineering + SOLID (2026-06-11, partner directive,
binding):** build what the NAMED use-case needs end-to-end — no speculative abstractions,
config flags, or extension points for futures nobody has asked for. Prefer extending an
existing proven pattern over introducing a new shape. **SOLID (§2, priority 3) is the
boundary discipline** — one responsibility per module/helper, pure functions testable in
isolation, no hidden state — not an invitation to layer architecture. The acceptance test
for any piece of design: *which requirement, nameable TODAY, does it serve?* No answer =
cut it. Complete ≠ maximal: a feature is DONE when its use-case closes end-to-end
(§9-measured), not when every conceivable extension is scaffolded.

---

## 4. Pure-function vs LLM — the dispatch rule

The dispatch is binary. Each task is either **deterministic** (answer derivable
from the bytes alone → pure function) or **meaning-reading** (answer requires
understanding what the text *says* → LLM call). There is no third bucket
"pure-function as defense-in-depth for meaning-reading" — that's a regex patch in
disguise; refuse it.

**Pure function ONLY for:** parsing structure (XHTML/JSON/ADF), splitting on known
delimiters, normalizing whitespace, counting, hashing, closed finite lookups,
composition/orchestration, detecting structural artifacts we emit ourselves.

**LLM call for EVERYTHING else:** classification, routing, dedup, coverage,
constraint extraction, naming, paraphrase detection, anything multi-language or
prone to paraphrase, anything whose predicate names a *concept* ("is_junk",
"is_boilerplate") rather than a *structure* ("starts with literal '['").

### The 4-test check before adding any `is_X(text) -> bool`

1. Could a competent human disagree on a paraphrased input? → LLM.
2. Is the input multi-language (BG/DE/EN/…)? → LLM.
3. Will the next unseen spec expose a missing pattern? → LLM.
4. Does the predicate name a *concept* vs a *structure*? → if concept, LLM.

Three "yes" = do NOT add the pure function. The right safety net for a
meaning-reading call is **another LLM call**, never a regex.

**LLM as gatekeeper:** when an LLM returns "nothing here" (e.g. empty extraction),
TRUST it. Don't add a regex to "double-check". Pre-filters that decide which
content reaches an LLM by encoding observed-spec patterns are patch-specific —
refuse them. Bound only by *structural* orchestration (size caps, idempotency).

---

## 5. Bug Y POLICY — no pattern enumeration; abstract decisive-tests

The most violated rule. Applies to **prompts** as much as code.

A prompt/schema/rubric that **enumerates corpus-observed patterns** ("recognize X,
Y, Z", "words like A / B / C", "and similar variations") is a patch in disguise —
tomorrow's author paraphrases past every entry; the list grows on each new spec.
**The recurring pressure to add another pattern entry IS the signal to add
something better** (a verification call, an abstract rule), not another pattern.

**Allowed in a prompt:** cost-asymmetry framing, conservative-bias instruction,
role/persona, deterministic output-shape contract, and few-shot examples where
**each example teaches a DISTINCT lesson** (a different decision condition or
failure mode) — up to ~4-5 per direction; never the same lesson in different
surface forms.

**Forbidden:** modal-verb / keyword lists, "Tier-X broaden" entries, multi-language
pattern enumeration, cue-list spotting, "and translations like …".

**Write the DECISIVE TEST first** as a one-sentence abstract question that holds
universally across vendors/technologies/domains, with a "why universal" clause.
Anchor with worked examples that show the reasoning, not a closed checklist.

---

## 6. Prompt Engineering POLICY — 5 mandatory slots

Every prompt (the SYSTEM_PROMPT, any schema instruction, any future verification
call) MUST have these, in order:

1. **ROLE** — persona with seniority + domain ("senior BA / engineer auditing…").
   Never "You are a helpful assistant".
2. **RULES** — state the cost asymmetry explicitly. Name the rare error, the
   common-path cost, the bias-default ("when in doubt, do X").
3. **OUTPUT FORMAT** — exact shape, line by line; required/forbidden tokens; no
   markdown inside structured slots; no commentary. (For Anthropic: use structured
   outputs / JSON schema — the schema IS the contract.)
4. **AGILE / DELIVERY LENS** — when the call makes a prioritization/sizing/inclusion
   decision, frame it in sprint-deliverable terms.
5. **FEW-SHOT EXAMPLES** — corpus-drawn (not invented), both directions, each
   teaching a distinct lesson (§5).

**Anti-mandates:** no generic persona; no missing cost-asymmetry on asymmetric-cost
calls; no widening a critic's verdict set into a re-classifier; no markdown in
structured slots; no invented few-shots; don't measure prompt quality by token
count — measure by parser/schema yield + precision on the corpus.

---

## 7. Where quality is critical — verification (N / N+1 / N+1+)

When **silent miss is the worst case**, add verification. The canonical shape is
three DISTINCT roles (not just more calls):

| Round | Role | Evidence |
|---|---|---|
| **N — Primary** | first authoritative answer | semantic reasoning over the input |
| **N+1 — Self-critique / debate** | adversarial challenge | same evidence + the primary's own trail |
| **N+1+ — Auditor** | different-lens final check | DIFFERENT evidence: structural guard, coverage audit, embedding, or human-in-the-loop |

A critic must see **everything the primary saw + more** — a critic blinder than the
primary just re-rolls the same dice. An auditor must bring evidence the critic
didn't see (else it's another critic, not an auditor).

**v3 note:** generation is a single Sonnet 4.6 call with structured output —
Sonnet's quality replaces the Qwen-era multi-call critic pipeline. The PRINCIPLE
still applies: if a future step has asymmetric cost-of-error (e.g. a destructive
JIRA operation, a quality gate), add real verification — don't trust a single call
where a silent miss is expensive. Don't stack verification where one call suffices.

---

## 8. Informational completeness — don't starve the call

Every LLM call operates under a 4-part contract. Violating any part is a defect —
the model can't reason without it:

1. **The item under decision.**
2. **Structural location** — where it sits (page, section hierarchy, siblings).
3. **Already-decided peers** — what's already correctly classified/placed.
4. **Source provenance + upstream signals** — headings, prior verdicts, scorer hints.

Spend prompt-input budget generously on signal richness. A call that LOOKS
defensible from limited information but is wrong because context was withheld is a
**silent miss** — the worst failure mode. Before merging any new call, answer the
4 questions. Three "no"s = the call is starved; refactor before merge.

**Token budget rule:** filter to what THIS call needs when it decides about ONE
item; give the WHOLE hierarchy when it decides about a hierarchy (Epic+Stories);
when budget is tight, scale down adaptively but never invent/paraphrase/truncate
the truth the model must reason about.

---

## 9. Stepwise empirical method — fix → measure → decide

One increment at a time. Do not batch 3 fixes then measure — the signal muddles.
After each change: run end-to-end on a real spec, compare output to source, count
what surfaced vs what was lost. Only after measuring do you decide whether to
extend, follow-up, or change direction. A fix that "looks right" but isn't measured
is not done.

---

## 10. Self-audit discipline (rigorous mentor mode)

Before shipping, review your own work adversarially as a strict mentor would:
- Re-read your analysis: what did you assume that you haven't verified?
- 6-step trace: canonical case + negative/edge cases. Does each behave correctly?
- Did you pick the highest-value option, or the safest-re-prior-policy one (§3)?
- For new LLM calls: does it satisfy the 4-part contract (§8) and Bug Y (§5)?
- Surface findings honestly — including "I over-flagged this" or "this is a
  pre-existing bug, not a regression". Honest framing > inflated bug counts.

If a task feels smelly/suspicious (missing info, fuzzy success criteria, scope
creep), apply the N/N+1/N+1+ pattern to your OWN work: step back, self-critique,
audit against POLICY.

---

## 11. Anti-patterns to refuse

- **Patching a specific test spec** ("add this persona because page 2 has it").
  Ask: what is the universal rule?
- **One big call that does everything.** Decompose.
- **Silent failures.** When a step can't place content, log it loudly. Data loss is
  the worst bug.
- **Mixing engineering and model responsibilities.** The model reasons; the pipeline
  assembles output.
- **Fix without measurement.**
- **Regex as a safety net for meaning-reading** (§4).
- **Pattern enumeration in prompts** (§5).

---

## 12. Call-size / token-budget monitoring

Before merging any prompt change, render it with a realistic worst-case fixture and
estimate tokens. Anthropic Sonnet 4.6 context is large (1M input), so input is rarely
the constraint — but **output** is capped (`MAX_OUTPUT_TOKENS=64000` in
anthropic_client.js; large specs need it; there's a truncation-salvage path). Use
prompt caching (`cache_control: ephemeral`) on the stable SYSTEM_PROMPT. Under-use
of budget is also a signal — a call artificially starved of examples/context is
leaving quality on the table.

---

## 13. The Conductor model — agent-orchestrated delivery (binding, 2026-06-02)

> Partner's directive (verbatim intent): *"Искам ти да бъдеш главния диригент. Нека
> всичко което правим занапред — analyze, design, предложение за solution, confidence
> vote на предложенията, анализ за подводни камъни и edge cases, review + auditor след
> промени — се извършва от агенти, всеки с изолирана задача. Ти ще менажираш като им
> задаваш задачите и четеш reports."*

Claude is the **CONDUCTOR**, not the soloist. Substantive work is decomposed into
**isolated agent tasks** — one bounded responsibility each — and Claude orchestrates:
assigns the tasks, passes each agent the upstream outputs it needs, reads the reports,
synthesizes, and makes the final calls. The conductor does NOT do the deep work alone
when it can be delegated to a focused agent.

**The phases — each an agent (or an agent panel):**
1. **Analyze** — frame the real decision, constraints, priority ladder (§1).
2. **Design** — candidate designs on a trade-off table (§1).
3. **Solution proposal(s)** — one or more concrete proposals; diverse angles when the
   space is wide.
4. **Confidence vote** — independent judges score the proposals; the conductor reads
   the *spread*, not just the winner.
5. **Pitfalls / edge-cases** — a dedicated adversarial pass: what breaks, what's
   unhandled, where the silent-miss path is.
6. **Implement** — the change (conductor or an implementer agent).
7. **Review + Auditor** — an N+1 review then an N+1+ **different-lens** auditor over
   the change (§7); adversarially **verify** findings (skeptic agents, default-refuted)
   before acting on them.

**MANDATORY post-implementation review gate (binding, 2026-06-02 — partner directive):**
after ANY implementation change, ALWAYS run BOTH (a) an **audit-review** agent — did it
miss, skip, or sub-optimize anything vs the task, and is it a genuine GENERAL solution or
a PATCH over-fitted to the one case in front of us? — AND (b) a **code-review** agent —
correctness, quality, conventions, edge-cases, regressions. The two MAY be **combined
into one agent ONLY when the change is small enough that combining does not raise task
complexity**; keep them separate when either lens is substantial. This gate is not
waivable for "small" changes. Proven 2026-06-02: the audit-review caught a distill-prompt
set that was code-correct but a **sepsis PATCH** (a §5 violation — it had memorised one
input's answer key); the code-review alone passed it ("SHIP"). One lens cannot see the
other's failure — run both.

**How:** use the **Workflow tool** to encode multi-phase / fan-out pipelines
deterministically (the conductor reads the synthesized reports and intervenes between
phases); use single **Agent** calls for one isolated phase. This **operationalizes**
the existing philosophy (LENS §0, A→D→S §1, dispatch §4, Bug Y §5, verification §7) —
it is the DELIVERY MODEL, not a replacement: the agents apply the policy; the conductor
owns it. Proven 2026-06-02: a multi-agent review caught a HIGH cross-project race bug
that a solo self-review pass had missed.

**Information completeness between agents (§8):** when agent B needs agent A's output,
the conductor hands it forward with the 4-part contract (item / location / decided
peers / provenance). A starved downstream agent's silent miss is the worst failure —
never let one reason without what an upstream agent already established.

**Scale to the task (§3):** substantive work — features, fixes, designs, reviews,
audits — runs through the agent phases. Trivial, independently-verifiable mechanical
steps (a typo, a one-line rename, a pure function with exhaustive unit tests) don't
need the full ceremony; use judgment, and when unsure lean toward orchestration (the
partner's stated preference: more efficient, more detailed, higher quality). The opt-in
is **STANDING** — do not wait to be re-asked each task.

---

*The four load-bearing sections, read in order: the LENS (§0) → A→D→S (§1) →
dispatch rule (§4) → Bug Y + Prompt POLICY (§5–6). Everything else operationalizes
these — and §13 is HOW we now execute them: Claude conducting, isolated agents doing
the bounded work.*
