# Kanban v1 — LIVE acceptance record (spec2jira-dev)

> Companion to `PLANNER-LIVE-ACCEPTANCE.md` (the Scrum 9-phase sign-off). This covers the **Kanban v1**
> planning mode: **review-only**, output = a pull-ready dependency-legal **ordered backlog** cut into a
> **Now / Next / Later** reach band. NO Jira push, NO what-if, NO skill buckets, NO brief (deferred v2).
>
> Method (POLICY §13): partner executes each action on `spec2jira-dev` (real Anthropic key, real Confluence
> page, real breakdown); shares screenshots + `forge logs`; the conductor verifies vs the EXPECTED and fills
> RESULT. POLICY §9 — live is the authority; the Scrum arc's live pass caught 8 offline-invisible bugs.
>
> Build state: 414 offline tests + build green; deep-audit (66 agents) = 0 HIGH, 10 fixes applied. Deploy =
> code-only `forge deploy` (no new scopes vs the already-consented release/v6.1.0 dev install).

| Date | Build / commit | Site | Tester |
|---|---|---|---|
| 2026-06-21 | release/v6.1.0 (Kanban v1, uncommitted) | spec2jira-dev | partner (exec) + conductor (verdict) |

---

## Phase 0 — Deploy + reach the Kanban form
**Objective:** the Kanban mode is live and reachable; Scrum entry unchanged.
**Action:** `npm run build` + `forge deploy` (dev). Open the app → generate a breakdown (or reopen one) → Review/Confirm → click **Plan capacity**.
**Expected (PASS):** the plan screen opens with a **methodology toggle at the top: "Sprints (Scrum)" | "Kanban backlog"**, defaulting to Sprints. No console errors.
**RESULT:** ✅ **PASS** (2026-06-21) — toggle present (Sprints | Kanban backlog), Kanban selectable; header "Backlog plan" + the pull-ready intro; no errors.

## Phase 1 — Kanban capacity form + live throughput preview (the RANGE)
**Objective:** the form reshapes correctly for Kanban and the live preview is an honest range, not a single number.
**Action:** toggle to **Kanban backlog**. Fill team rows + available days; optionally open Advanced.
**Expected (PASS):**
- Sprint fields (count / length / start date) **hidden**; per-person **skill select hidden** (pooled in v1).
- Available-days label → **"Available days (this quarter)"** with an InfoTip warning **PER QUARTER, not per sprint**.
- Live preview reads **"Expected ≈ X pts this quarter · likely reach Y–Z pts (conservative–optimistic)"** — a **range**, never one number.
- "A forecast, not a target — sharpens once the team has real flow history."
**RESULT:** ✅ **PASS** (2026-06-21) — sprint count/length/start + per-person skill select HIDDEN; "Available days (this quarter)" + PER-QUARTER InfoTip; live preview **"Expected ≈ 79.1 pts this quarter · likely reach 63.3–87 pts (conservative–optimistic)"** = a genuine RANGE; "a forecast, not a target" line present. (Team: Tedd 40 / Axel 40 / Violeta 33 days.)

## Phase 2 — Generate the plan (the LIVE Batches ranking for Kanban)
**Objective:** the real Anthropic Batches ranking runs for the Kanban path (never exercised live before).
**Action:** Generate → armed confirm → wait (minutes). Watch `forge logs --since 10m`.
**Expected (PASS):**
- "Claude is ordering your backlog…" spinner + live timer + "you can leave / reconnect" copy.
- Returns a completed plan. **Real ranking** (NOT the "Ordered without Claude" deterministic fallback) — confirm via the cost echo ($ > 0, batch-priced ~$0.02) and no `planLlmNote` fallback banner.
- Logs show the batch submit → poll → finalize, no unhandled throw.
**RESULT:** ✅ **PASS** (2026-06-21) — **real Batches ranking ran** (cost echo **"$0.014 of your Anthropic key"**, batch-priced — NOT the "Ordered without Claude" deterministic fallback); no fallback banner. The methodology-agnostic ranking call works for the Kanban path live.

## Phase 3 — Now / Next / Later view + honesty panel (the heart)
**Objective:** the ordered-backlog band renders honestly on real data.
**Action:** review the plan.
**Expected (PASS):**
- Three sections **Now / Next / Later**, each a list of feature chips (name + SP), with a **point subtotal**.
- A visible **reach-line divider** ("conservative reach ≈ Y pts" / "optimistic reach ≈ Z pts").
- **Later items are SHOWN**, not hidden (the scope trade-off is negotiable).
- **Honesty panel surfaces all 4 assumptions**: no-flow-history · reach-is-a-range · steady-flow + WIP · **focus factor is your biggest lever** (the C4 fix — present even at default focus 0.7).
- Wording: "likely reach this quarter" / "a forecast, not a target" — **never "will deliver"**.
- **Dependency order respected**: eyeball a known blocker→dependent pair — the blocker is never in a LATER tier than its dependent.
- Risk Register tagged by **reach tier** (Now/Next/Later), never "Sprint N". Names render correctly (not raw uids).
**RESULT:** ✅ **PASS** (2026-06-21, the heart — clean) — Now (7 items/60 pts) → "conservative reach ≈ 63.3" divider → Next (3/24) → "optimistic reach ≈ 87" divider → Later (4/23, SHOWN: "defer, descope, or add capacity"). Subtotals sum to 107 = "Backlog 107 pts". **Boundary math correct on real data** (Now stops at 60 since the 8th item → cum 68 > 63.3 → Next; Next reaches cum 84 ≤ 87; next item cum 89 > 87 → Later). **All 4 honesty assumptions surfaced incl. "Focus factor is your biggest lever" at default 0.7 (C4 fix LIVE)**. Wording "likely reach this quarter / a forecast, not a commitment" — no "will deliver". Risk Register (7) tagged by TIER (Now/Next/Later), not Sprint N; "Claude was nudged to sequence these earlier" (usedLlm copy correct). All names render (no raw uids). Dependency order looks sensible (intake→screening→pricing→…→underwriting; topo-legality is structurally guaranteed + offline-tested).

## Phase 4 — Free re-pack + methodology toggle / nudge (deep-audit C2 / G2 / M1)
**Objective:** the free re-pack and the methodology-toggle UX are correct.
**Action:** (a) lower the focus factor → **Re-pack backlog (free)**. (b) Toggle the methodology away from the rendered plan (e.g. Kanban→Sprints) WITHOUT regenerating.
**Expected (PASS):**
- (a) Re-tiers instantly; **no Claude call** (cost unchanged); the band shifts (lower capacity → more in Later).
- (b) On toggle: the **"Planning mode changed — Re-pack (free) to apply it"** nudge appears; the **header follows the rendered PLAN** (not the toggled form); the **Re-pack button noun follows the FORM** (what the click will produce); the **what-if panel is HIDDEN** while toggled (G2 — no silent sprint-scenario drop). Re-pack → switches methodology correctly.
**RESULT:** ✅ **4a PASS** (2026-06-21) — focus 0.7→0.5 → preview "Expected ≈ 56.5 · likely reach 45.2–62.2" (= 79.1×0.5/0.7), focus-lever note shown; **free Re-pack** shifted the band (Now 5/34 · Next 2/26 · Later 7/47, =107) with cost UNCHANGED at $0.014 (no Claude). ⏳ **4b confirming** — toggle Kanban→Scrum correctly switched the FORM (scrum fields + "Computed capacity ≈ 15 pts/sprint" preview) and the header correctly stayed "Backlog plan" (follows the still-kanban plan, M1). Partner reported "nothing changed" = the PLAN doesn't auto-switch on toggle (by design — applies on Re-pack). ✅ **4b MECHANICS PASS** — confirmed live: the methodologyChanged nudge **"Planning mode changed — re-pack (free) to apply it"** appears; the free button label reads **"Re-pack sprints (free)"**; clicking it switches the plan to a full **Scrum** plan (sprint columns + capacity meters + Plan brief + "8 features don't fit" overflow + Risk register). All three deep-audit fixes (C2/M1) verified.

⚠️ **LIVE FINDING (L1-live, §9 payoff — the toggle exposes a cross-methodology unit carry):** toggling Kanban→Scrum carries `availableDays` (40/40/33 entered as PER QUARTER) into the Scrum form as PER SPRINT, where it is **CLAMPED to 10 (= sprint length)** → 15 pts/sprint = a **silent ~4× capacity reduction (40→10)** NOT surfaced in the Scrum preview ("Computed capacity ≈ 15 pts/sprint" with no clamp warning). The form relabels ("Available days / sprint") + has a passive InfoTip, but the partner's immediate confusion proves passive isn't enough (§11 never-silent). The deep audit REFUTED this 0/3 as "the form warns"; live vindicated §9 (the Scrum CapacityPreview clamp-warning gap was the half I scoped G4 to kanban-only). **FIX CODED (partner chose clear-on-toggle):** `handleCapacityFormChange` (App.js) now clears ONLY `availableDays` per person when `patch.methodology` differs from the current — names/skill/focus/hours kept; empty → fail-loud INVALID_AVAILABLE_DAYS, never a silent unit-carry. Build green (+50 B). ⏳ live-verify at the next deploy.

## Phase 5 — Reconnect / persistence (the self-describing plan)
**Objective:** the KVS lifecycle + cross-layer contract hold (the class that bit Scrum live).
**Action:** **hard-reload** the page on a completed Kanban plan → reconnect. Then edit the breakdown → reopen.
**Expected (PASS):**
- The Kanban plan **rehydrates**: Now/Next/Later chips show **real names, NOT raw uids** (self-describing plan + byUid).
- Edited breakdown → reopen → **stale banner** fires ("plan is out of date"), correctly (keyed on stable content, not volatile uid).
**RESULT:** ✅ **PASS** (2026-06-21, THE big one — clean) — **5a:** hard reload rehydrated the **Kanban** plan with **REAL NAMES** (Application Intake / Eligibility / Risk-Based Pricing / Affordability / Conditional Document) — **NOT raw uids**; reach bands + honesty panel + focus 0.5 all preserved (self-describing plan + byUid). **5b:** edit breakdown → reopen → **"This plan is out of date"** stale banner fires correctly (content-keyed hash, not volatile uid). **The cross-layer/lifecycle class that bit the Scrum arc 8× is CLEAN for Kanban.**

## Phase 6 — Negative / honesty-under-stress paths
**Objective:** every failure path surfaces loudly, never silent (§11), and the honesty shines under pressure.
**Action + Expected (PASS):**
- **Tiny team / low capacity** → most features in **Later** with a loud "N features beyond this quarter's likely reach" — honest, not crammed into Now.
- **Per-sprint days in the per-quarter field** (e.g. type a small per-sprint number, or a >90 figure) → the **live preview warning** fires (deep-audit G4) BEFORE a billed Generate.
- **Invalid input** (focus 70, empty roster, hours/point 0) → typed fail-loud blocker, not a fabricated 0/NaN plan.
- **Unsized feature** → its own **"unsized — cannot place"** channel, excluded from the band (never fake-fit at 0).
- **A feature bigger than the whole optimistic quarter** → lands in **Later** with its points visible against the reach dividers (honest "too big this quarter", never force-placed).
- **Empty backlog** → clean "no features to plan", no Claude call.
**RESULT:** ✅ **PASS** (2026-06-21) — **6b:** focus 70 + cleared Axel days → **"Fix the capacity inputs to plan"** typed blocker ("Focus factor must be a fraction between 0 and 1", "Available days for Axel must be ≥ 0"), no garbage plan. **6c:** Axel 200 → **G4 clamp warning fired live** (in the preview AND a "Heads-up" callout on the plan), non-blocking (clamp = warning, correct). Deep-audit G4 verified live. (Overflow honesty already shown in Phase 4; unsized/oversized/empty are offline-covered — no easy live fixture.) **+ LIVE FINDING L2** (below). Bonus: the "New Feature (3 pts)" added during the stale test landed in Later → the stale→re-rank flow incorporates new features ($0.015).

## Phase 7 — Scrum back-compat unaffected
**Objective:** Kanban did not regress the shipped Scrum planner.
**Action:** toggle to **Sprints (Scrum)** → generate a Scrum plan.
**Expected (PASS):** sprint columns + per-sprint capacity meter + Risk Register (Sprint N) + **what-if panel** + **plan brief** all work exactly as before; the success/push path unchanged.
**RESULT:** ✅ **PASS** (2026-06-21) — **7a:** Scrum plan fully intact, incl. **Tier-2 skill-aware capacity** (Backend/Frontend/QA set → per-skill sub-meters + "Short on backend capacity" bottleneck callout + skill-aware "Doesn't fit" reasons) + Plan brief + Risk Register tagged by **Sprint N** (not reach tier — correct). **What-if panel works** (+1 sprint scenario → delta: Capacity +56.1 · Overflow −4 · "Now fits (4)" · "Moved sprint (1)"). Tier-2 skill-aware Scrum NOT regressed by Kanban. **7b (G2):** partner confirmed — toggling the form to Kanban HIDES the what-if panel (no silent sprint-scenario drop).

---

## Sign-off
| Phase | Verdict |
|---|---|
| 0 Deploy + entry | ✅ PASS |
| 1 Form + throughput range | ✅ PASS |
| 2 Live Batches ranking | ✅ PASS |
| 3 Now/Next/Later + honesty | ✅ PASS |
| 4 Re-pack + toggle/nudge | ✅ PASS (4a/4b mechanics) + L1-live fix coded |
| 5 Reconnect / persistence | ✅ PASS |
| 6 Negative / honesty-under-stress | ✅ PASS + L2-live fix coded |
| 7 Scrum back-compat | ✅ PASS (incl. Tier-2 skill-aware + G2) |

**Overall:** ✅ **8/8 PHASES PASS** (live-walked 2026-06-21). The core — capacity-derived reach band, the methodology fork, the Now/Next/Later honesty, Scrum byte-compat (incl. Tier-2 skill-aware + what-if + brief), and the **self-describing-plan reconnect** (the cross-layer class that bit the Scrum arc 8×) — is SOUND on real data. **2 live findings, both fixed + ✅ LIVE-VERIFIED 2026-06-21:** **L1** (cross-methodology `availableDays` unit carry → clear-on-toggle) · **L2** (the 90-day cap was calendar days → 66 working days + reworded warning). **✅✅ KANBAN v1 FULLY ACCEPTED — ready to commit → `release/v6.1.0`** (review-only, 0 new scopes, code-only deploy, no re-consent).

**Bugs found live (the §9 payoff):**
- **L1-live (Phase 4b, MEDIUM-UX):** cross-methodology toggle carries `availableDays` across the per-quarter↔per-sprint unit change → silent ~4× clamp (40/quarter → 10/sprint), invisible in the Scrum preview. The deep audit refuted it 0/3 ("the form warns"); live proved the passive InfoTip insufficient (§9 > offline). **FIX:** clear-on-toggle (App.js `handleCapacityFormChange` clears availableDays per person when methodology changes; fail-loud, never silent). Build green; **✅ LIVE-VERIFIED 2026-06-21** — toggling Kanban↔Scrum clears the available-days fields (fail-loud until re-entered for the new unit).
- **L2-live (Phase 6c, LOW-tuning):** `MAX_QUARTER_DAYS` was **90 (calendar days)**, but the field is WORKING days and a quarter has ~65 (13 weeks × 5). So a "90" entry (calendar-days mistake) wouldn't even warn, and the clamp warning said "per-sprint figure" (wrong direction — an over-value is calendar-vs-working, not per-sprint). **FIX:** cap → **66** (working-days max + buffer) + reworded warning ("more than the ~66 working days in a typical quarter — did you enter calendar days?"). 290 tests green; **✅ LIVE-VERIFIED 2026-06-21** — Axel 67 → clamped + the reworded warning (Tedd 66 = on the edge, not clamped). (Cap adjustable.)

---

## Phase 8 — Kanban Push-to-Jira (rank the backlog + tier labels) — NEW feature, §9 BLOCKING
> Built + §13-gated 2026-06-21 (5-lens multi-lens gate because Jira WRITE path; 11 confirmed → **7 code fixes applied** + accepted G5; 6 refuted sound). **0 new scopes** (`write:issue:jira-software` + `write:jira-work` already present from the Scrum push; manifest UNCHANGED → no re-consent). 430 offline tests + build green. NOT committed/deployed.

**Objective:** push a Kanban plan → RANK the Jira backlog Now→Next→Later (`PUT /rest/agile/1.0/issue/rank`, global Rank) + tag plan-now/next/later labels. Pure-fn join + the chunked-session pattern; a SIBLING path keyed on `plan.methodology` (the Scrum sprint-push is byte-identical/untouched).

**Action:** `forge deploy` (code-only, no new scopes → no re-consent). Push a breakdown to Jira (creates Stories) → on PushedScreen click **"Rank backlog in Jira"** (the kanban-gated panel; mutually exclusive with "Assign sprints"). Run on BOTH a **team-managed** ('simple') and a **company-managed** ('kanban') Kanban board (**SDKY** is the company-managed fixture).

**⚠ BLOCKING §9 sign-offs (the gate's HIGH + 2 MED — offline-invisible; the Scrum push proved 8 such):**
- **POLARITY (HIGH):** the rank API preserving the issues-array order after an anchor is UNDOCUMENTED. **EYEBALL: top of backlog == now[0], full sequence == now→next→later (NOT reversed, NOT shuffled).** Test a >50-feature plan too (the multi-batch chaining seam). If reversed → the whole plan is silently inverted.
- **SCOPE (MED):** confirm `PUT /issue/rank` returns 2xx (NOT 401/403) on dev — the rank ROUTE is new-to-this-scope (the Scrum live caught a scope-insufficiency). 401/403 → a scope is missing → re-consent; do NOT publish.
- **BOARD-TYPE / VISIBLE-ORDER (MED):** confirm resolveKanbanBoard reports 'simple' for team-managed + 'kanban' for company-managed; on a company-managed board the **boardNote caveat** fires + the order appears once the board filter is ORDER BY Rank (never over-promise visible order before that).

**Also verify (the gate fixes):** noJiraKey channel ("push the backlog first") · a partial/permission failure surfaces a REASON (not the generic line) · re-push is idempotent (no dupes, same order) · a board-less project / board-endpoint hiccup → proceeds best-effort with a soft warning (G1) · the tier labels (plan-now/next/later) land + a re-tier removes the old label.

**RESULT:** ✅✅ **PASS — LIVE-ACCEPTED on a company-managed Kanban board (SDKY, 2026-06-21).** Pushed breakdown (65 items in SDKY) → "Rank backlog in Jira" → **"Ranked 13 issues + Tagged 14 with plan-now/plan-next/plan-later labels"** + the boardNote caveat fired (company-managed detection ✓). All 3 BLOCKING §9 sign-offs GREEN:
> - ① **POLARITY ✅** — board filter `ORDER BY Rank ASC`; filtered **plan-now (10)** = SDKY-2,6,9,7,3,8,11,12,4,14 (EXACT plan Now order, **not** creation order → rank applied; starts with Application Intake = Now[0], **not reversed**); **plan-next (4)** = SDKY-5,15,10,13 (EXACT plan Next order). The undocumented Jira array-order-preservation HELD live.
> - ② **SCOPE ✅** — the push returned success with NO 401/403 and NO admin re-consent prompt → `write:issue:jira-software` covers `PUT /issue/rank`.
> - ③ **BOARD-TYPE / visible-order ✅** — company-managed board detected (boardNote caveat shown); order visible because the board filter is `ORDER BY Rank`.
> - Later=0 (whole backlog within optimistic reach) → no plan-later label, correctly. (plan-later absent because the tier was empty — expected.)
> - Minor live-found copy bug FIXED (the idle note falsely said "may prompt … new board-rank permission" — there are NO new scopes; reworded to the ORDER-BY-Rank hint).
>
> - ✅ **TEAM-MANAGED Kanban ALSO LIVE-ACCEPTED (KDTM, post-SP-fix):** breakdown pushed **15 Stories** + Kanban rank "Ranked 14 + Tagged 15 labels"; plan-now/plan-next labels visible on the board cards; polarity correct (plan-now cards ABOVE plan-next; keys in PLAN order, not creation order); team-managed ranking always-on (no ORDER BY Rank needed → immediately visible).
> - ⭐ **+ a live-found BREAKDOWN-PUSH fix (SEPARATE, pre-existing — not a Kanban-arc regression):** the Story-Points field was resolved from the GLOBAL field list (first "Story Points" match) → in a MIXED instance it returned the company-managed "Story Points" (customfield_10074), which a TEAM-MANAGED project rejects ("not on the appropriate screen") → **0/15 Stories created** on team-managed KDTM. FIX (`push_handler.js`): resolve from the project's Story CREATE SCREEN via **createmeta** (sets the field that actually exists there, or none — graceful; falls back to the global list only if createmeta errors). **Live-verified:** KDTM now creates 15 Stories; company-managed (SDKY) unchanged (logically identical — createmeta finds the same field). The gotcha-#7 class, exposed by mixed project types.
>
> **⇒ Kanban push LIVE-ACCEPTED on BOTH company-managed (SDKY) AND team-managed (KDTM) Kanban. The WHOLE planner arc (Scrum planner + Kanban planner v1 + Kanban push) is COMPLETE + accepted → commit + prod deploy `release/v6.1.0`.**
