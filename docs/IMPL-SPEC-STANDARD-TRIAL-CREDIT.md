# IMPL-SPEC — Standard-only edition + $5 managed trial credit + frictionless onboarding

> Design of record for the 2026-07-11 strategy pivot (first-customer marketing analysis).
> Conductor-held. The audit army checks fidelity against THIS document.
> Branch: `feature/UI-UX-improvements` (continues the arc; NOT committed/merged/prod).

## Partner decisions (this session — do NOT re-litigate)

1. **Editions → Standard-only.** Standard includes EVERYTHING (breakdown+push, Project Context,
   test-case generation, Capacity-Sheet Planner). Advanced is retired as an offer. Marketplace-portal
   retirement of the Advanced edition is a SEPARATE partner step — code just never gates a feature
   behind an edition anymore. A pending/existing `capabilityAdvanced` subscriber must still resolve to
   a FULL-featured tier (nobody loses access).
2. **$5 managed trial credit — PER INSTALL (site), real dollars, lifetime** (not monthly). Bounds our
   worst-case managed spend to ~$5/customer regardless of seat count.
3. **Trial-only.** Managed credit is offered ONLY while `license.isEvaluation === true` (the 30-day
   Atlassian trial). A paid subscriber is always BYOK. Exhausted OR converted → friendly BYOK prompt.
4. **The $5 funds EVERYTHING on managed** (breakdown, test-cases, planner, distill). → every managed-spend
   surface must be metered against the ledger; nothing draws on our key un-metered.

## The managed-key decision (the single choke point)

`resolveAnthropicKey(context)` (src/index.js:158) becomes credit-aware. Resolve `keySource='managed'`
IFF **ALL** of:
- `isTrialLicense(license)` — `license.isEvaluation === true` AND `trialEndDate` is absent or in the
  FUTURE (belt-and-suspenders vs a stale `isEvaluation`).
- **No BYOK key configured**, read fault-aware via `getStoredApiKeyInfo()` — a storage FAULT counts as
  "has key / do NOT fall to managed" (never spend our money on a read glitch).
- `MANAGED_ANTHROPIC_KEY` is set.
- Trial credit **available** (`grant - spent > 0`) AND under the **hard ceiling** (`spent < hardCeiling`).

Otherwise `keySource='byok'`. Fail-open to `byok` on ANY ledger/license read glitch (never strand a payer).
Return shape gains trial context: `{ apiKey, keySource, keyFault, tier, trial: { onManaged, available, exhausted, grant, spent } }`.

⚠ **anthropicKeyInfoForSource / anthropicKeyForSource (index.js:135/142) STAY PURE** — a pure
stamped-`source`→key lookup with ZERO ledger/license reads. The poll/fetch/cycle/test-gen legs reuse the
STAMPED `job.keySource` so a batch stays bound to the key that created it. The dynamic decision lives ONLY
in `resolveAnthropicKey` (start legs). (pitfall: keep dynamic logic out of the poll path.)

## The ledger (new module `src/trialCredit.js`) — reservation model

KVS key `trial:managed-credit` (per-install): `{ spentUsd, updatedAt }`. Grant + ceiling from env each read:
- `MANAGED_TRIAL_CREDIT_USD` (default **5**) = the grant.
- `MANAGED_HARD_CEILING_USD` (default **2 × grant = 10**) = the absolute backstop.

**Scalar reconciliation model (NO holds map — spentUsd is the single scalar):**
- `creditStatus()` → `{ grantUsd, spentUsd, availableUsd: grant-spent, exhausted: available<=0, hardCeilingUsd, overCeiling: spent>=ceiling }`.
- **Submit (start leg, managed only):** after a SUCCESSFUL batch submit, `chargeSpend(estimateUsd)`
  (spent += estimate) and stamp on the job record: `creditKeySource:'managed'`, `creditEstimateUsd`,
  `creditReconciled:false`. This closes the farming vector (unfinalized cheap runs still count) and the
  check-vs-charge race (in-flight spend is visible to the next gate).
- **Finalize (poll leg, terminal, managed only):** guard `if (job.creditReconciled) skip;` else
  `chargeSpend(actualUsd - job.creditEstimateUsd)` (delta — negative = refund the over-estimate), set
  `job.creditReconciled = true` in the SAME write that flips status→completed (the fresh-re-read guards
  serialize the common case; the flag guards re-entry).
- **Never-finalized job:** the estimate stays charged (caps our spend — SAFE polarity for a free credit).
  The orphan-sweep already runs daily; extend it to refund estimates for jobs abandoned > 7 days (optional
  belt-and-suspenders; not load-bearing).

`chargeSpend` is a read-modify-write on `spentUsd`; the KVS non-atomic race is bounded (one run), documented,
same class as the existing `consumeQuota` race, backstopped by the hard ceiling.

## Per-surface gate + charge points (index.js)

| Surface | Submit (hold estimate) | Finalize (reconcile) | Gate |
|---|---|---|---|
| Breakdown `startGeneration`:1756 / `pollJobStatus` finalize ~2507 | `BREAKDOWN_EST_USD`≈0.24 | `costEstimate.total_usd` (batch) | allow if `available>0` |
| Plan `startPlan`:3022 / `finalizePlanJob`:2961 (charge only when `usage` truthy — success path) | `PLAN_EST_USD`≈0.10 | `cost.total_usd` (batch) | allow if `available>0` |
| Test-gen bulk `startTCGen`:3968 / `pollTCStatus` finalize ~4472 | `projectTestCaseCost().expected_usd` | price `batchUsage` (batch) | **block if `expected_usd > available` → `trial_credit_exhausted` (with estimate)**; keeps $5 a near-hard ceiling on the one expensive surface |
| Test-gen regen `regenerateTestCase`:4843 / `pollRegenerateTestCase` ~5296 | small per-story est | price `entry.usage` (batch) | allow if `available>0` (regen fan-out race = documented residual, ceiling-bounded) |
| Distill `startDistillSession`:926 / `distillStep`:1033 | — (sync, charge actual per step) | charge `message.usage` per step (sync rate, `{batch:false}`), idempotent per step | STAMP keySource on the SESSION at start; distillStep REUSES the stamped source (fixes the mid-session managed→byok flip dead-end) |

- **Cycle-repair LLM** (index.js:2447) is extra managed spend NOT in `fetchResult.usage` — accepted as
  bounded overshoot (one small call), covered by the hard ceiling. Documented, not metered.
- **estimateCost/projectTestCaseCost** (anthropic_client.js:297/389) are unchanged — the pricing authority.
  Every ledger charge MUST pass `{ batch: true }` for breakdown/tc/plan (Batches API = 0.5×); distill is sync
  `{ batch: false }`. A missed flag double-charges the ledger.

## ENFORCEMENT_MODE decoupling (pitfall: unbounded-liability if mis-set)

The $5 credit gate + hard ceiling are **ALWAYS enforced** (real money) — NEVER governed by
`ENFORCEMENT_MODE` (which stays governing only the dormant per-user COUNT cap). Dev testing sets
`MANAGED_TRIAL_CREDIT_USD` to a test value (small to test exhaustion) and uses a low-budget managed key.
Emit a diagnostic whenever a managed resolution occurs (observability of who draws on our key).

## De-gating (Standard = everything) — src/usage.js + strip dead upsell

- `TIERS.byokPro`: `hasTestCases:true`, `hasPlanner:true` (THE load-bearing flip; Object.freeze → set in the
  literal). Update the "Advanced-only" comments.
- `resolveTier`: `capabilityAdvanced` still → a FULL-featured tier (`byokAdvanced` retained as a full-featured
  internal alias — NOT dropped from TIERS, only from pricingTable). Active-unknown → byokPro (now full).
- `checkQuota` payload: KEEP emitting `hasTestCases`/`hasPlanner` (now always true) — FE default-FALSE logic
  re-paywalls if the fields vanish.
- `pricingTable()` → `[byokPro]` only.
- Backend gate sites (remove the `if(!tier.hasTestCases/hasPlanner) return buildUpgradeRequired()` lines,
  KEEP the adjacent `unlicensed → license_required` gates): index.js **2990, 3154, 3238, 3279, 3828**
  (planner), **3961, 4731, 4837** (test-cases). `buildUpgradeRequired`/`edition_required` become dead →
  remove producer + FE handlers.
- FE strip (dead "Upgrade to Advanced" copy): App.js ConfirmScreen 5540/5594/5693 sections, LimitReachedScreen
  `isEditionRequired` branch (7301-7410), `edition_required` handlers (1717/1787/1877/2816); AdminSettings
  PlanModelCard 2843/2857 upsell branch; TestCasesScreen 385/677 read-only-downgrade callout; StoryWizard
  readOnly plumbing (leave inert OR strip). KEEP value-framing copy (ReadyScreen badge 3098, PlanModelCard
  entitled line). `prototype/test_v6_tiers.mjs` — rewrite to the single-edition-everything invariant.

## Onboarding (frictionless trial) — App.js + getUsage

- **Setup gate** App.js:716 (`!apiKeyConfigured || !defaultProjectKey → SetupScreen`): relax so a trial user
  with credit remaining is NOT walled — key on `mountUsage` new fields (`trial.onManaged`/`availableUsd>0`).
  Fail SAFE: if `getUsage` failed (`mountUsage` null) fall back to requiring setup (never hand out managed
  spend on a metering glitch). `defaultProjectKey` is only needed at PUSH — defer it to push for trial users
  (let them generate immediately).
- **getUsage** (index.js:2758) / **checkQuota** payload: add `trial: { onManaged, grantUsd, spentUsd,
  availableUsd, exhausted }` (independently try/caught so a ledger glitch hides the badge, not the panel).
  Must reflect `isEvaluation` — never show trial credit to a paid install.
- **Badge** App.js ReadyScreen ~3083: a HIGHER-priority branch (before `usage.unlimited`) shows
  "$X of $5 free trial credit left" when `trial.onManaged`.
- **`_classifyBackendError`** App.js:199: new `trial_credit_exhausted` branch (`routeToSetup:true`,
  friendly "you've used your $5 free trial credit — add your own Anthropic key to keep going", links
  spec2jira.com/get-api-key). Keep `not_configured` for the paid-no-key case, but make its copy friendly too.
- **SetupScreen** App.js:7505: pass the usage payload so it can distinguish first-run vs exhausted-trial
  framing; friendly "add your key to continue".
- Any no-key licensed user (paid OR converted-from-trial OR exhausted) → the friendly BYOK prompt, never a
  raw `not_configured`. (pitfall: trial→paid flip strands a just-converted user.)

## Backend gate wiring for exhaustion (the friendly signal)

In each start leg (breakdown/plan/tc/regen/distill), after `resolveAnthropicKey`:
- If `keySource==='byok'` AND `!apiKey` AND `trial.exhausted` (was on managed, now spent) → return
  `trial_credit_exhausted` (friendly BYOK). Else the existing `not_configured` (paid, never had credit) —
  friendly copy.
- Test-gen additionally: if managed AND `expected_usd > available` → `trial_credit_exhausted` with the
  estimate in the detail.

## Tests (offline, prototype/)

- NEW `prototype/test_trial_credit.mjs`: ledger charge/reconcile idempotency (double-finalize = one charge),
  refund on over-estimate, hard-ceiling backstop, gate matrix.
- NEW `prototype/test_resolve_key_decision.mjs`: the managed-vs-byok decision matrix (trial×key×credit×env,
  fault-aware key clause, trialEndDate-past → byok, fail-open).
- REWRITE `prototype/test_v6_tiers.mjs`: Standard has everything; pricingTable = 1 edition; capabilityAdvanced
  still full-featured.
- Build green (`CI=true npm run build`) + `node --check` all `src/*.js` at every step.

## Partner-executed / live-verify (NOT code)

- Fund + set `MANAGED_ANTHROPIC_KEY` on production (currently recommended UNSET). Set
  `MANAGED_TRIAL_CREDIT_USD=5` (both envs; dev may use a test value).
- Marketplace portal: retire the Advanced edition (keep Standard). `editionsEnabled:true` may stay (harmless).
- Compliance: re-activate the Managed DPA / 29-day-retention / sub-processor copy on the site (lawyer-approved,
  currently hidden — [[compliance-source-of-truth]]; site repo is the source of truth).
- Dev-test trial vs paid: verify `forge install --license <...>` populates `isEvaluation`; the license/compliance
  discovery agent failed (StructuredOutput cap) so this is unverified — LIVE-VERIFY (POLICY §9) that
  `getAppContext().license.isEvaluation` reflects a real trial before trusting the trial gate.
- Reinstall-to-farm $5: accepted low-frequency (admin action, ~$5/cycle bounded); monitor managed spend.

## Audit outcome (2026-07-11 — two rounds, converged)

**Deep audit (5 lenses, per-finding skeptic-verify): 9 confirmed, 0 refuted.** Headline HIGH (3 lenses converged):
the idempotency marker `trial:charged:<ref>` used the bare breakdown jobId, which breakdown/test-gen/plan ALL
share → the breakdown reconcile claimed it first and silently no-op'd the tc + plan reconcile-to-actual = an
under-metered managed leak on the expensive surface. Fixed by namespacing the ref **per surface**:
`bd:<jobId>` / `tc:<jobId>:<batchId>` / `plan:<jobId>:<batchId>` / `regen:<jobId>:<storyIdx>:<batchId>` /
`distill:<sessionId>:<step>` / `cyc:<jobId>`. (⚠ This SUPERSEDES the original "bare-jobId marker" design above — the
reconcile ref MUST be per-surface AND per-attempt.) + MED cycle-repair metered (resolveDependencyCycle returns
usage → verifyAndRepairCycles accumulates + returns it → pollJobStatus charges `cyc:<jobId>`), MED no_project_key
routeToSetup, MED TC-editor default-FALSE flip, LOW distill charge-after-persist, LOW Advanced Account price.

**Fresh army (4 lenses, verify-fixes + completeness): 6 confirmed (0 HIGH), 2 refuted.** Caught the SAME leak class
RECURRING in my own fix — I'd added the per-attempt batchId only to `regen:`, not `tc:`/`plan:` → a RE-GENERATE /
RE-RANK on the same jobId no-op'd its reconcile. Fixed (batchId on tc/plan). + the fix-#4 flip missed on the
ConfirmScreen sibling (`hasTestCases === true` → suppressed the pre-spend estimate on a getUsage glitch → flipped
to `!== false`), a parse-fail path dropping cycle usage (attach usage on the parse_failed return too), and
`runHealthCheck` making an UNMETERED managed Anthropic probe (skip the live probe for the managed key).

**Severity converged 9(3 HIGH) → 6(0 HIGH); honest refutations rose.** Every step build-green + 20/20 offline suites.

**Third pass — partner-requested code-review army (5 lenses: BE/FE code-review + task-fidelity + fix-verify-of-round-2 +
completeness): 8 confirmed+worthFixing (0 HIGH), 3 dismissed.** Fixed: (MED) the $10 hard ceiling was only
admission-enforced on test-gen's EXPECTED cost, so a big low-AC batch (verbose output near the 24K cap) could reconcile
the full actual PAST $10 → added an upper-vs-ceiling admission gate (`spent + upper_usd > TRIAL_HARD_CEILING_USD` → BYOK;
keeps big-but-CHEAP runs flowing) + softened the "NEVER past $10" doc; (MED) the SetupScreen heading said "Add your API
key" even for the `no_project_key` route → made it project-key-aware; (LOW) sync surfaces (distill step, cycle-repair)
used a batch-style marker that DROPS a legitimate retry/re-run charge (under-count = wrong margin polarity) → charge
DIRECTLY once per real sync call (`chargeManagedSpendSafe`); (LOW ×4) stale/circular copy + comments (PlanModelCard
"Everything in Standard, plus…" circular; ConfirmScreen "project key guaranteed" comments; estimateTestCaseCost +
checkQuota "Advanced-only" comments). ACCEPTED (documented, not fixed): a re-generate over an in-flight managed test
batch orphans the prior batch's reconcile — bounded to one batch's (actual−estimate), the hold is charged, and the new
upper-vs-ceiling gate backstops it; guarding it would cost UX. Dismissed by the skeptics: a `$NaN` badge (unreachable —
availableUsd always numeric) + 2 cosmetic `hasPlanner === true` chip nits (guarded by the unknown-state branch).

**STOP signal: severity 9(3 HIGH) → 6(0 HIGH) → 8(0 HIGH, mostly copy) — no HIGH for two rounds, findings shifting to
doc/copy.** Remaining verification = LIVE-acceptance on dev (partner) + the partner-executed items above.
