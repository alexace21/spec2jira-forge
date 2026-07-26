# IMPL SPEC — Per-USER welcome credit, bounded by a per-INSTALL lifetime ceiling

> **Status: APPROVED DESIGN, not yet implemented.** The shipped code grants **$5 per INSTALL, trial
> licenses only**. This document describes ONE design, founder-approved **2026-07-25**, ready to build.
> Nothing here is a live capability. Every public claim about the welcome credit stays **BLOCKED**
> (`docs/marketing-kb/13-claims-register.md` rows **A2.7 / B16 / B18**) until the code ships *and* the
> production managed key is funded *and* the founder confirms.
>
> **Scope:** `src/trialCredit.js`, `src/usage.js`, `src/index.js`, `prototype/*` tests.
> **No manifest / scope change → no customer re-consent.** Verify the manifest diff at release.

---

## 0. THE APPROVED RULE (founder, 2026-07-25)

One rule, applied uniformly to every installation. **No free-vs-paid discriminator is needed anywhere.**

| Bound | Value | Env var | Scope |
|---|---|---|---|
| **Welcome grant** | **$5 per USER**, one-time, **lifetime** | `MANAGED_TRIAL_CREDIT_USD` | keyed by `accountId` |
| **Per-user hard ceiling** | **$6** (1.2 x grant) | `MANAGED_HARD_CEILING_USD` | **re-scoped** from install to user |
| ⭐ **Per-INSTALL lifetime ceiling** | **$50** — the single new number | `MANAGED_INSTALL_CEILING_USD` | all users of one installation, forever |

$50 = 10 x $5, so a free-band site (<= 10 users) can fully serve all ten people — the founder's explicit
intent: *"person 7 can carry on when person 1 runs out."*

When a user's grant is spent, **or** the install's lifetime ceiling is reached, that user routes to
**BYOK** (their own Anthropic key, paid direct to Anthropic, no markup).

**Why this shape won.** It needs no free-vs-paid discriminator, so it is immune to the runtime's missing
seat/band data (§3 — now *verified* missing, not merely suspected). It bounds **every** install
identically: a free 10-user site draws at most $50; a paid 150-seat instance also draws at most $50
(against roughly $925/month of revenue). Exposure is a property of the *installation*, not of the
customer's size or license state.

**A per-DOMAIN / cross-install ceiling is impossible.** Forge KVS is per-installation and there is no
vendor backend. Adding one would require a new egress domain — a customer re-consent event — and would
destroy the "no Spec2Tickets-operated backend" privacy positioning (`CLAUDE.md`). Farming risk is
**accepted** as low and bounded: the credit is **not transferable** — it buys only this app's own output
(Jira breakdowns), never cash and never raw API access — and each fake user needs its own Atlassian
account. Detection (not prevention) is vendor-side via the Marketplace Reporting API
(`docs/MARKETPLACE-REPORTING-SETUP.md`). See §7.3 for the residual vectors, including one this design
does **not** close.

### 0.1 The pricing model this serves (context; unchanged by this spec)

| Band | Price |
|---|---|
| 1-10 users | **FREE ($0)** — every feature, no time limit. A real free tier, not a trial. |
| 11-100 users | **$6.70 / user / month** — the `100` boundary is the founder's "for example" figure, **unverified against the vendor portal** |
| 101+ users | **$5.70 / user / month** |

Repo strings that contradict this and are **not** authority: `src/usage.js:119` (`$6.70/user/mo` +
"<=10 users = $57/mo flat"), `src/usage.js:137` (`$13.40`), `docs/MARKETPLACE-LISTING-v3.md`, the live
site's "flat $67/month for 11+". **This spec changes credit mechanics only**; the price strings are a
separate change.

---

## 1. CURRENT BEHAVIOUR (precise, with citations)

### 1.1 One ledger per install

```js
// src/trialCredit.js:49
const LEDGER_KEY = 'trial:managed-credit';
```

A **single KVS record per installation** — no `accountId` segment, no period segment. Record shape
`{ spentUsd, updatedAt }` (`:184`). The header states the intent (`:18-22`): *"SCOPE = PER INSTALL
(site), LIFETIME ... One $5 budget per Confluence site, NOT per user and NOT per month ... (A per-USER
$5 on a 500-seat instance would be a $2500 margin bomb.)"* — the shape this spec reverses was a
**deliberate, documented loss-bounding decision**, not an oversight. The $50 install ceiling is what
makes reversing it safe: it re-imposes the same bound the per-install ledger provided, one order of
magnitude higher and independent of seat count.

### 1.2 Grant and ceiling today

| Constant | Value | Source |
|---|---|---|
| `TRIAL_GRANT_USD` | `$5`, env `MANAGED_TRIAL_CREDIT_USD` | `src/trialCredit.js:52-55` |
| `TRIAL_HARD_CEILING_USD` | `1.2 x grant` = **$6**, env `MANAGED_HARD_CEILING_USD` | `:71-74` |
| `BREAKDOWN_EST_USD` / `PLAN_EST_USD` / `REGEN_EST_USD` | `$0.24 / $0.10 / $0.10` | `src/trialCredit.js` |
| `DISTILL_STEP_EST_USD` + `distillRunEstimateUsd(stepCount)` | `$0.14` per step; the whole-run figure is **derived** as `stepCount x $0.14` (= `$0.84` for today's 6 categories) | `src/trialCredit.js` |

> ⚠ **Updated 2026-07-25.** The flat `DISTILL_EST_USD = $0.10` this row used to cite **no longer exists**.
> It was an independent whole-run constant while each step was gated at `$0.02`, so `6 x $0.02 = $0.12 >
> $0.10`: a user admitted at `startDistillSession` could be blocked at step 5 or 6 — after we had paid for
> steps 1-4 — and get nothing usable. The session figure is now derived from the per-step figure, so
> **admission guarantees completion** and the per-step gate is a genuine backstop for concurrent
> consumption only. Distill also now **holds before the call and settles to the echoed actual**
> (`settleManagedHold`), rather than charging only after the section write — see §1.6.
>
> ⚠ **Per-step figure re-derived 2026-07-25 (`$0.02` -> `$0.14`).** The `$0.02` was grounded on reading the
> 40,000-char input clip as ~10K tokens, i.e. an assumed 4 chars/token — an English-prose average, not a
> bound. Dense technical text and non-Latin scripts (Bulgarian/Cyrillic is in scope) put a REAL step above
> it, which breaks the "admission guarantees completion" invariant this section rests on. The figure is now
> derived from a worst-case TOKEN bound on that clip (tokens <= UTF-8 bytes <= 3 x UTF-16 code units, so
> <= 120K tokens, + ~10K of fixed prompt, + 800 output tokens, priced at sync un-batched Haiku $1/$5 per
> MTok = `$0.134`, rounded up). The full derivation is in the `DISTILL_STEP_EST_USD` comment — re-run it if
> the clip, the prompts, the category `maxTokens`, or the model changes. The hold still settles to the
> echoed actual, so the conservative figure gates admission without over-charging anyone.

Test-gen has no flat estimate — it uses `projectTestCaseCost` (`src/anthropic_client.js:389-432`,
returning `expected_usd` / `upper_usd`).

### 1.3 The gate chain

- **Pure stopper** `managedRunBlocker` (`src/trialCredit.js:106-121`): `insufficient` when
  `estimate > available`; `ceiling` when `spent + worst > hardCeiling`; else `null`. BYOK
  (`keySource !== 'managed'`) is **never** gated (`:107`). NaN / absent / non-positive inputs collapse
  to **block** (`:108-113`).
- **Pure status** `computeCreditStatus` (`:128-145`): `available = max(0, grant - spent)`; on
  `readOk:false` it reports `availableUsd = 0` **and** `exhausted / overCeiling = true` (`:134`, `:141`,
  `:143`) — a KVS read glitch never grants free spend.
- **The one decision point** `resolveAnthropicKey` (`src/index.js:171-204`). Our key resolves **only
  when all of** hold:
  1. no BYOK key on the install — `hasByokKey` (`:176-177`), a storage **fault counts as "has key"**;
  2. `process.env.MANAGED_ANTHROPIC_KEY` set (`:187`);
  3. `isTrialLicense(resolveLicense(context))` (`:189`);
  4. `cs.readOk && !cs.exhausted && !cs.overCeiling` (`:192`).

  Any glitch or ambiguity falls through to BYOK (`:197-203`). The comment at `:184-185` is load-bearing:
  *"This is the ONLY place the decision is made — the poll/fetch/cycle/test-gen legs reuse the STAMPED
  `job.keySource` and NEVER re-decide."*

### 1.4 The trial gate

`isTrialLicense` (`src/usage.js:280-297`):

| License shape | Result | Line |
|---|---|---|
| `isEvaluation === true`, `trialEndDate` not past | trial | `:287` |
| **`isEvaluation === false`** | **NEVER a trial**, even with a future `trialEndDate` | `:290` — *"THE margin-leak guard: a paid customer must never draw the free managed credit."* |
| `isEvaluation` undefined + **future** `trialEndDate` | trial (dev `forge install --license trial` sets only `trialEndDate`) | `:291-296` |
| no signal at all | **not** a trial (safe polarity) | `:296` |

### 1.5 What a free-band install gets today: nothing

A free-band install is not an evaluation. Unless its license happens to carry `isEvaluation:true` or a
future `trialEndDate`, `isTrialLicense` returns false, `resolveAnthropicKey` never resolves the managed
key, and the user hits `not_configured` — they **must save an Anthropic API key before the app does
anything at all**. The frictionless "generate immediately, no key needed" onboarding is available today
**only to a 30-day-trial install, once per site**.

### 1.6 Every surface that charges or reconciles credit — the change surface

| Surface | Pre-flight gate | Hold (submit) | Reconcile / charge | Marker ref |
|---|---|---|---|---|
| Breakdown | `index.js:1935-1941` | `:2253` (`holdManagedCredit`) -> stamped `:2256-2274` | `:2587-2591` | `bd:<jobId>` |
| Cycle-repair (inside the breakdown poll) | — | — | `:2616-2622` direct charge, **no marker** | — |
| Test-case generation | `:4382-4405` (uses `projection.upper_usd`) | `:4478` -> stamped `:4481-4497` | `:4712-4722` | `tc:<jobId>:<batchId>` |
| Regenerate one story | `:5142-5153` | `:5321` -> stamped `:5324-5332` | `:5541-5551` | `regen:<jobId>:<storyIdx>:<batchId>` |
| Plan (ranking) | `:3238-3245` | `:3315` -> stamped `:3317` | `:3164-3168` (`finalizePlanJob`) | `plan:<jobId>:<batchId>` |
| Distill (Project Context) | session: whole run (`distillRunEstimateUsd`) **+ per step** (`DISTILL_STEP_EST_USD`, a backstop) | ⭐ per step (`holdManagedCredit`, 2026-07-25) | per step via `settleManagedHold`, **no marker** (each step is one distinct real call) | — |
| Health check | `:6033-6037` — managed reports `ok` **without** a billed probe | — | — | — |
| `getUsage` badge | `:2953-2967` (read-only snapshot) | — | — | — |

Helpers: `holdManagedCredit` (`:218-227`), `reconcileManagedCredit` (`:245-264`, marker
`trial:charged:<ref>` **claimed before the debit**), `chargeManagedSpendSafe` (`:274-281`, deliberately
marker-free — a sync retry *is* new spend). All three are fail-safe: a ledger error never breaks the
user's run.

**None of these functions takes an `accountId`. Every one of them is in scope for this change.**

---

## 2. TARGET BEHAVIOUR

1. A **one-time, lifetime $5 grant per USER**, keyed by `accountId`, on the install where they use the app.
2. Available to **every user of every licensed install** — free band and paid band alike, in trial or not
   (§4 decides the gate).
3. Bounded by **two** ceilings: **$6 per user** and **$50 per install, lifetime**.
4. On exhaustion of either, the user routes to **BYOK**. The existing `trial_credit_exhausted` payload
   (`src/index.js:313-319`) and FE route (`static/hello-world/src/App.js:210-226`) keep their shape;
   only the copy and the blocker reason change (§5.7).
5. The grant is **never re-granted** — not monthly, not per job, not per breakdown, not on a user's
   return after months away.
6. `ENFORCEMENT_MODE` stays **decoupled** — the credit gate and both ceilings are always on
   (`src/trialCredit.js:38-43`). This is real money; a mis-set enforcement mode must never make the
   managed key unbounded liability.

---

## 3. ⭐ THE RUNTIME LICENSE SHAPE — VERIFIED (dev, 2026-07-25)

The previous revision of this section speculated. It no longer needs to: the temporary probe
(`_diagAppContext`, `src/usage.js:251-266`) was deployed and read back. **Captured under
`forge install --license active`:**

```
raw:  {"active":true,"billingPeriod":"MONTHLY","state":"active",
       "supportEntitlementNumber":null,"type":"commercial","isActive":true}
keys: ["active","billingPeriod","state","supportEntitlementNumber","type","isActive"]
appContext keys: ["appAri","appVersion","environmentAri","environmentType","installationAri",
                  "invocationId","invocationRemainingTimeInMillis","moduleKey","license",
                  "installation","permissions"]
environmentType: "DEVELOPMENT"
```

### 3.1 Findings — recorded as VERIFIED

1. **CONFIRMED: there is no seat count, no user count and no price band anywhere** in the License object
   or in the app context. The approved design's independence from that data is now a **verified
   strength, not a hope**. (This corroborates `src/usage.js:54-56`, which already recorded the absence
   of a seat count and used it to justify per-user metering.)
2. **`type` IS populated and meaningful** — `"commercial"` for a paid-equivalent license. It remains the
   only plausible free-vs-paid discriminator (Atlassian's historical license-type enum includes
   `FREE` / `STARTER` values). But a **free-band shape cannot be simulated by `forge install --license`**
   — it can only be observed on a real production free-band install. Keep this as a **footnote, not a
   dependency**: the approved design does not need the answer, now or later.
3. **`state` and `isActive` are returned at runtime but are NOT in the declared `@forge/api` `License`
   type** (`node_modules/@forge/api/out/api/runtime.d.ts:44-56` declares `active` / `isActive` /
   `billingPeriod` / `capabilitySet` / `ccpEntitlementId` / `ccpEntitlementSlug` / `isEvaluation` /
   `subscriptionEndDate` / `supportEntitlementNumber` / `trialEndDate` / `type`).
   **Lesson worth stating: the declared type is a LOWER BOUND on what the runtime returns.** Never infer
   absence from the type definition; never infer presence from it either (see finding 4).
4. **`isEvaluation`, `trialEndDate` and `capabilitySet` were ALL ABSENT** under `--license active`.
   `capabilitySet` absent is already handled (`resolveTier:333-335` falls through to Standard — the safe
   default). `isEvaluation` and `trialEndDate` both absent means `isTrialLicense` returns **false** on
   this shape via its "no signal -> not a trial" branch (`usage.js:296`). §4 turns on this.

### 3.2 Plainly

**The app cannot distinguish a free-band install from a paid one at runtime, and the approved design
does not depend on the answer.** Every install is bounded identically at $50 lifetime. Nothing in this
spec reads `type`, `billingPeriod`, `ccpEntitlementSlug`, or any other band-shaped field. Do not build
band-conditional logic on a guessed field; if a future feature genuinely needs the band, the only honest
source is a real free-band production install observation.

### 3.3 Housekeeping

`_diagAppContext` (`src/usage.js:237-266`) exists **solely to answer this section**. It is answered.
**Delete the probe and its call site (`:229`) as part of this change** — it is marked
"DELETE BEFORE ANY PRODUCTION DEPLOY" and this spec is the deploy that would carry it.

---

## 4. ⭐ DOES THE $50 CEILING MAKE THE TRIAL GATE UNNECESSARY?

The question: with a $50 lifetime per-install ceiling, should `isTrialLicense` stay in the credit path
(`src/index.js:189`)?

### 4.1 Every caller of `isTrialLicense` (checked, exhaustively)

| Site | Kind | What breaks if the function is removed |
|---|---|---|
| `src/usage.js:280` | the definition | — |
| **`src/index.js:189`** | **the ONLY production caller** | the credit gate — the subject of this section |
| `src/index.js:103` | the import | must be dropped from the import list |
| `src/index.js:102` | `resolveLicense` import — **used only to feed `:189`** | must also be dropped; `resolveLicense` itself stays alive inside `usage.js` (`:346` `getActiveTier`, `:392` `checkQuota`) |
| `prototype/test_v6_tiers.mjs:20,110-120` | 8 offline assertions + the import | must be deleted or repurposed |
| `docs/IMPL-SPEC-STANDARD-TRIAL-CREDIT.md:25` | prose | historical; leave |

Nothing else in `src/`, `static/`, `tools/` or the manifest touches it. **The blast radius is one call
site, two imports, and eight test assertions.** There is no hidden second consumer.

### 4.2 The case FOR removal

1. **The ceiling already does the gate's job, better.** `isTrialLicense` exists to bound our exposure by
   excluding non-trial users. `MANAGED_INSTALL_CEILING_USD` bounds the same exposure **directly, for
   life, for every install**, without needing to classify anyone. A gate that filters a fraction of
   installs is strictly weaker than a ceiling that binds all of them.
2. **The approved model deliberately admits paid customers.** The founder's rule is explicitly uniform
   ("no free-vs-paid distinction needed"). The trial gate is a *not-quite* free-vs-paid distinction and
   it is exactly what excludes the free band today (§1.5) — the audience the whole change exists to
   serve.
3. ⭐ **The gate cannot reliably admit the intended audience, because we cannot verify what it reads.**
   §3.1 finding 4 is decisive: on the one license shape we *have* observed, `isEvaluation` and
   `trialEndDate` are both **absent**, so `isTrialLicense` returns false. We have never observed a
   free-band shape and cannot until production. Keeping the gate therefore means shipping a feature
   whose availability to the target audience is a **lottery on an unobserved field**. Fail-closed is the
   right polarity for money, but it is the wrong polarity for an onboarding feature that must work.
4. **It deletes a three-branch heuristic plus its stale-flag guard from a billing path.** Less
   conditional logic on the money path is less silent-failure surface (`POLICY §11`). The
   `isEvaluation === false` margin-leak guard becomes dead weight the moment paid customers are admitted
   by design — leaving it in place would be a lie about the system's intent.
5. **The real discriminator is already structural and stronger: `hasByokKey`.** `resolveAnthropicKey`
   short-circuits to BYOK the moment the install has *any* stored Anthropic key (`:176-177`), and today
   the app is unusable without one unless you are on the managed trial path. So **every long-standing
   paying install almost certainly already has a site key**, and no user on it will draw a cent —
   with or without the trial gate. The gate is largely redundant with a check that runs first.

### 4.3 The case AGAINST removal

1. **A paid customer who never evaluated could draw $50 years later.** Real, but bounded: $50 once, per
   install, forever. On the 11-100 band a 25-seat customer pays about $167.50/month, so the whole
   lifetime draw is under a third of one month; at 150 seats it is roughly 5% of one month. On the free
   band it is the intended cost of the model.
2. **Timing risk.** With the gate, exposure is concentrated in a customer's first 30 days. Without it, an
   install can begin drawing at any point in its life — e.g. the day an admin deletes the site API key,
   or the day this version ships to a long-standing install that never saved one. The mitigation is
   structural, not procedural: `hasByokKey` (§4.2 point 5) plus the $50 ceiling.
3. **It costs test coverage.** Eight assertions encoding a real, hard-won behaviour (the dev
   `--license trial` shape) disappear. That knowledge should not be lost silently.

### 4.4 ⭐ VERDICT — REMOVE the trial gate from the credit path, and replace it with an explicit license gate

Removal is safe **only together with the replacement**, because `isTrialLicense` is currently doing a
second job by accident: an unlicensed install fails it, so it also keeps unlicensed users off our key.

**Specify exactly:**

1. In `resolveAnthropicKey` (`src/index.js:187-196`), replace condition 3
   (`isTrialLicense(resolveLicense(context))`) with:

   ```js
   tier.key !== 'unlicensed'      // tier is already resolved at :172 via getActiveTier(context)
   ```

   `TIERS.unlicensed` (`usage.js:161-170`) is the no-active-license backstop. This is a **tightening**
   in one direction (unlicensed can never reach our key) and a widening in the other (any licensed user,
   trial or paid, free band or paid band, may draw their one grant).

   > ⚠ **LEAK L10 — this replacement is not optional.** `startDistillSession` (`:1034`) and
   > `distillStep` (`:1127`) have **no** `buildLicenseRequired()` call, unlike every other spend surface
   > (`:1868`, `:3193`, `:4168`, `:5093`). Widen the gate without the `unlicensed` check and an
   > unlicensed invocation can spend our key through distill. The check belongs in
   > `resolveAnthropicKey` — the one decision point — so no surface can forget it.

2. Delete `isTrialLicense` from `src/usage.js` and the `isTrialLicense` + `resolveLicense` imports from
   `src/index.js:102-103`. `resolveLicense` stays exported and alive for `usage.js`'s own callers.
   Leaving an uncalled trial gate in a billing module is a loaded gun: the next reader re-wires it and
   silently re-introduces the free-band exclusion.
3. Rewrite `prototype/test_v6_tiers.mjs:104-120` rather than deleting it: replace the eight
   `isTrialLicense` assertions with assertions on the new gate (§9, cases 19-21) and keep a short
   comment recording *why* the trial gate was retired, including the verified license shape from §3.
4. **User-facing copy consequence (do not miss this).** `buildTrialCreditExhausted`
   (`src/index.js:313-319`) says *"your $5 free trial credit"*, and `App.js:3138` renders
   *"$X of $5 free trial credit left"*. Once the credit is not trial-scoped, that copy is wrong. Rename
   to **welcome credit** throughout the FE and the payload copy. The error *code*
   (`trial_credit_exhausted`) should stay unchanged — it is matched by string in four FE sites
   (`App.js:213`, `App.js:7499-7506`, `AdminSettings.jsx:2339`, `PlanScreen.jsx:1758`) and renaming it
   buys nothing but risk. **In-product copy is not blocked by B16** (which governs *public* claims), but
   confirm with the founder before shipping strings that describe the credit (§10 decision 5).

### 4.5 What removal does NOT change

- The `trial` object returned by `resolveAnthropicKey` (`:186`, `:191`) and consumed as
  `trial.grant > 0` at `:1057`, `:1920`, `:2956`, `:3234`, `:4204` keeps its shape and meaning: "the
  credit branch actually ran for this caller". Rename the variable to `credit` for honesty if you like,
  but treat it as a mechanical rename with a full call-site sweep, not a semantic change.
- `resolveTier` / `getActiveTier` / `checkQuota` / the dormant Managed count cap: untouched.
- The `isEvaluation === false` margin-leak guard: **consciously retired**, not regressed. Record it in
  the commit message and in `src/trialCredit.js`'s header so a future reader does not "restore" it.

---

## 5. THE DESIGN

### 5.1 Ledger keys

```js
// src/trialCredit.js
const LEDGER_KEY_LEGACY   = 'trial:managed-credit';          // frozen; still read + still charged (§6)
const LEDGER_KEY_PREFIX   = 'trial:managed-credit:u:';       // per-user, NO period segment
const INSTALL_LEDGER_KEY  = 'trial:managed-credit:install';  // per-install aggregate

export function creditLedgerKey(accountId) { /* pure, exported, unit-tested */ }
export function installLedgerKey() { return INSTALL_LEDGER_KEY; }
```

Mirrors the established per-user metering pattern `usage:YYYY-MM:u:<accountId>`
(`src/usage.js:359-368`) — **minus the period**.

> ⚠ **LEAK L1 — the single most expensive mistake available here.** `usageKeyFor` interpolates
> `${period}`. Copy that shape verbatim and the grant silently becomes **$5 per user per month** —
> $60/user/year, unbounded, and it would look correct in review. The key must be **period-free**, and
> the test suite must assert it by regex (§9 case 2).

**`accountId` handling — fail closed, never `'unknown'`.** `usageKeyFor` falls back to the literal
`'unknown'` (`src/usage.js:364`). For money that is wrong twice: it merges distinct users into one
drainable bucket, and it lets a hold and its reconcile land in *different* ledgers. Rule:

```
accountId absent / not a non-empty string  =>  managed is NOT resolved (fall through to BYOK)
```

No managed-spend surface runs outside a user invocation, so this costs nothing. The daily sweep
(`src/index.js:6211-6269`) has no user context and spends nothing.

> ⚠ **LEAK L17 — the per-user ledgers must never be swept or purged.** They carry the *lifetime*
> "already granted" fact. Deleting one re-grants $5. `deleteJobKeys` and `sweepHandler` only touch
> `job:` / `jobmeta:` / siblings today — keep it that way, and add a comment at both sites naming the
> `trial:managed-credit:*` prefix as never-sweepable.

### 5.2 Signature changes

| Now | Becomes |
|---|---|
| `creditStatus()` | `creditStatus(accountId)` — reads **three** records (user, install aggregate, legacy) and returns one snapshot |
| `computeCreditStatus(spent, readOk, grant, ceiling)` | `computeCreditStatus({ spentUsd, readOk, installSpentUsd, installReadOk, grantUsd, hardCeilingUsd, installCeilingUsd })` — pure, still node-testable |
| `managedRunBlocker({ keySource, availableUsd, spentUsd, estimateUsd, upperUsd, hardCeilingUsd })` | ⭐ `managedRunBlocker({ keySource, credit, estimateUsd, upperUsd })` where `credit` is the whole `creditStatus` snapshot |
| `chargeSpend(delta)` | `chargeSpend(accountId, delta)` — writes the user record **and** mirrors the effective delta into the install aggregate |
| `holdManagedCredit(keySource, est)` | `holdManagedCredit(keySource, accountId, est)` |
| `reconcileManagedCredit(record, ref, actual)` | unchanged signature — **reads the payer off the record** (§5.4) |
| `chargeManagedSpendSafe(usd)` | `chargeManagedSpendSafe(accountId, usd)` |
| — | **NEW** `chargeLegacyInstall(delta)` — the pre-migration reconcile path (§6) |

> ⚠ **LEAK L14 — why `managedRunBlocker` must take the whole snapshot, not loose numbers.** Today five
> call sites each spread individual fields (`availableUsd: trial?.available, spentUsd: trial?.spent`).
> Add two more fields and any site that forgets one **silently stops enforcing the install ceiling** —
> a green build, a passing test suite, and an unbounded install. Passing the snapshot object makes the
> omission impossible to express. Do this refactor first, before adding the ceiling.

### 5.3 The blocker — three reasons, all failing CLOSED

```
managedRunBlocker({ keySource, credit, estimateUsd, upperUsd }):
  keySource !== 'managed'                              -> null            (BYOK is never gated)
  estimate not finite or <= 0                          -> 'insufficient'  (we cannot price the run)
  credit.readOk === false                              -> 'insufficient'  (available reads 0)
  estimate > credit.availableUsd                       -> 'insufficient'
  credit.spentUsd + worst > credit.hardCeilingUsd      -> 'ceiling'
  credit.installReadOk === false                       -> 'install_ceiling'
  credit.installSpentUsd + worst > credit.installCeilingUsd -> 'install_ceiling'
  otherwise                                            -> null
  where worst = (finite, positive upperUsd) ?? estimate
```

Precedence is **deterministic and asserted** (§9 case 6). All three reasons route the user to the same
place (BYOK), so ordering affects only the copy — which is exactly why it must be pinned by a test
rather than left to accident.

**`computeCreditStatus` polarity, unchanged in spirit and extended:**

| Input | Reported |
|---|---|
| `readOk:false` | `availableUsd: 0`, `exhausted: true`, `overCeiling: true` (existing, `:130-143`) |
| `installReadOk:false` | `installSpentUsd: Infinity` (or an explicit `installOverCeiling: true`), so any run blocks |

> ⚠ **LEAK L6 — the install aggregate must fail closed exactly like `readOk`.** A transient KVS glitch
> that reads the aggregate as 0 would bypass the only bound that exists. This is the same class the
> 2026-07-12 audit caught in `computeCreditStatus` (the read-glitch money leak, `:130-134`) — do not
> re-introduce it one field over.

### 5.4 ⭐ Charge attribution across invocations — the real correctness trap

**The submitting user and the polling user are not guaranteed to be the same.** This is not speculation;
`pollJobStatus` says so in its own comment (`src/index.js:2352-2354`): *"this poll may be driven by
another user's client via the shared `pageJob:` index."*

Today it is harmless — one install, one ledger, so whoever polls, the same record is debited. Under a
per-user ledger it becomes a **silent money bug in both directions**:

> ⚠ **LEAK L2 — the negative-delta clamp.** `reconcileManagedCredit` charges
> `delta = actual - creditEstimateUsd` (`:256-257`). User A submits a breakdown: `$0.24` is held on
> **A**'s ledger; the actual is `$0.11`; user B polls. Route the debit to the *caller* and
> `chargeSpend(B, -0.13)` runs against B's fresh ledger, where `Math.max(0, prev + d)`
> (`src/trialCredit.js:183`) clamps it to **0**. Net: **A is over-charged $0.24 and never refunded, B is
> charged nothing, and the real $0.11 appears nowhere.** With an under-estimate (test-gen actual $2.10
> vs held $0.60) the mirror image happens: **$1.50 of real spend lands on the wrong user's grant.** Both
> are silent — build-green, test-green, log-free.

**The fix: stamp the charged account on the record.** Add `creditAccountId` beside the existing
`keySource` / `creditEstimateUsd` / `creditReconciled` stamps, at every submit site:

| Record | Write site |
|---|---|
| breakdown `job:` | `src/index.js:2256-2274` |
| test-gen `tcjob:` | `:4481-4497` |
| regen `tcregen:` | `:5324-5332` |
| plan `planjob:` | `:3317` |
| distill session | `:1092` |

Every finalize / charge leg then reads `record.creditAccountId` — **never `context.accountId`**:

- breakdown reconcile `:2591`; **cycle-repair** `:2616-2622` (runs inside the poll — L9);
- test-gen `:4722`; regen `:5551`; plan `:3168`;
- distill per-step `:1223` (L8 — the step is a separate HTTP invocation; the session opener is the payer).

> ⚠ **LEAK L13 — stamp `creditAccountId` UNCONDITIONALLY, not "if the hold succeeded".**
> `holdManagedCredit` returns `0` when the charge throws (`:223-226`), and the finalize then charges the
> **full actual** (`est = 0`, `delta = actual`). If the stamp were conditional on a non-zero hold, that
> full actual would route to the legacy install ledger instead of the user — the largest single
> mis-charge this design can produce. Stamp whenever `keySource === 'managed'`, independent of the hold's
> outcome.

**Do NOT reuse `ownerAccountId`.** It exists for diagnostics bucketing, is `|| null` at both sites
(`:2053`, `:4309`), and — decisively — **plan and distill records do not carry it at all** (`:3303`,
`:1092`). A null owner routes a debit to nowhere, or worse into an `'unknown'` bucket. Introduce the
dedicated field.

**Regen is the one surface where the payer is the CALLER, not the record's originator.** Regen inherits
`keySource` from the bulk `tcjob` (`:5112-5123`) but is a **fresh spend initiated by whoever clicked**.
So: run the pre-flight against the **invoker's** ledger (`creditStatus(context.accountId)` at
`:5147`) and stamp `creditAccountId = context.accountId` on the `tcregen:` record. The bulk job's
`ownerAccountId` must not pay for another user's regen.

> ⚠ **LEAK L18 — inherited `keySource` bypasses `resolveAnthropicKey`.** Because regen takes the bulk
> run's `keySource` directly, a user whom `resolveAnthropicKey` would *not* have put on the managed key
> can still reach it. Under the approved design that is mostly benign (any licensed user with no site
> key is eligible), but the **per-user credit gate and the license gate must both run on the invoker** —
> the license gate already does (`:5093`), the credit gate must be re-pointed at the invoker's ledger.

**Legacy / missing stamp:** a record with **no** `creditAccountId` is a pre-migration record whose hold
landed on the legacy install ledger, so its reconcile goes to the **legacy install ledger** too
(`chargeLegacyInstall`). Symmetric, convergent, no guessing.

### 5.5 Idempotency markers — leave them account-free

The marker is `trial:charged:<ref>` (`:247`), claimed **before** the debit (`:251`), with per-surface +
per-attempt refs (`bd:` / `tc:<jobId>:<batchId>` / `plan:<jobId>:<batchId>` /
`regen:<jobId>:<storyIdx>:<batchId>`). Those refs are already globally unique per billing event.

> ⚠ **LEAK L4 — do not "improve" the ref by adding the accountId.** If a record is rewritten (a
> re-generate by a different user), or the stamp is read differently on two polls, an account-bearing
> ref produces **two markers for one billing event -> a double charge**. The ref identifies the *event*;
> the record identifies the *payer*. Keep them separate; assert it (§9 case 13).

### 5.6 The install aggregate — maintenance and repair

`chargeSpend(accountId, delta)` mirrors **every** delta — positive *and* negative — into
`trial:managed-credit:install`.

> ⚠ **LEAK L20 — mirror the EFFECTIVE delta, not the raw one.** The user ledger clamps at zero
> (`next = Math.max(0, prev + d)`, `:183`). If the raw `d` is mirrored while the user write was clamped,
> the two stores diverge permanently. Compute `effectiveDelta = next - prev` from the user write and
> mirror that.

> ⚠ **LEAK L5 — mirror reconciles too, not only holds.** Mirroring holds alone makes the aggregate
> monotonically over-count and locks honest users out early. Customer-hostile rather than a leak, but
> equally silent.

Two non-atomic read-modify-writes per charge (4 KVS ops). Drift is bounded and of the same accepted
class as `consumeQuota` (`src/usage.js:454-460`). The realistic drift direction is **under-count** (a
lost update drops a delta), which is the leak direction — so it needs repair.

**Self-healing repair, in the existing daily sweep (`sweepHandler`, `:6211`):** enumerate
`kvs.query().where('key', WhereConditions.beginsWith('trial:managed-credit:u:'))` (the same paginated
pattern already used at `:6221` and in `diagnostics.js:791-809`), sum `spentUsd`, and write
`max(storedAggregate, recomputedSum)` — **only when the enumeration completed cleanly** (no truncation,
no error). Rationale, stated honestly:

- `kvs.query()` is **eventually consistent** (`:6232` records this hard-won fact) — a lagging index
  under-counts, and writing a low value would *grant* spend. `max()` makes the repair monotonic, so a
  lagging read can never lower the backstop.
- Consequently the repair fixes **under-count only**. Over-count is not repaired — and is not a
  realistic drift source, because a lost read-modify-write drops a delta rather than applying it twice.
  Say so in the code comment rather than implying full reconciliation.
- Log when stored and recomputed differ by more than `$0.01`. A widening gap is the earliest signal that
  the mirroring has a bug.

### 5.7 Route and copy on a block

`buildTrialCreditExhausted` (`:313-319`) gains the third reason. Recommended strings (English, per
POLICY; final wording is founder's call — §10 decision 5):

| Reason | Copy shape |
|---|---|
| `insufficient` | *"This {run} needs about $X of Anthropic usage, but only about $Y of your welcome credit is left. Add your own Anthropic API key to run it..."* (today's string, "free trial credit" -> "welcome credit") |
| `ceiling` | same as `insufficient` — the user cannot act on the distinction |
| **`install_ceiling`** | must NOT say "your credit is used" — it is not. Something like: *"This site has used all of its included AI credit. Add your own Anthropic API key to keep going — unlimited, you pay Anthropic directly."* |

> ⚠ A user with $4.90 of untouched grant who is told "you have used your credit" will file a support
> ticket. §11 (never a silent or misleading status) applies to money copy too.

### 5.8 The install-scoped BYOK key — a product-promise gap, not a bug

`getStoredApiKeyInfo` reads a **single app-scoped secret** (`src/anthropic_client.js:86-94`,
`kvs.getSecret(KVS_API_KEY_NAME)`), and `resolveAnthropicKey:176-177` treats its presence as
install-wide. Consequence under a per-user grant:

> **"When one person's credit runs out the team can keep evaluating through a colleague who still has
> theirs" holds only while NO ONE on the site has saved an API key.** The moment any admin saves the
> site key, every user — including those with $5 untouched — resolves to BYOK and their remaining grant
> becomes unreachable.

That is arguably the *right* behaviour (a site with a key does not need our money), and it is also the
structural reason the "paid customer draws $50 years later" risk in §4.3 is mostly theoretical. But it
must be a decision, not an accident — and the `getUsage` badge (`:2953-2967`, rendered at
`App.js:3131-3139`) should stop advertising a balance the user can no longer spend. -> §10 decision 3.

### 5.9 Two attribution edges to document, not fix

- **LEAK L7 — orphaned holds on record overwrite.** `startTestCaseGeneration` reuses the same `jobId`
  and overwrites the `tcjob` (`:4481`); the code already records this as an accepted residual
  (`:4296-4300`). If user B re-generates before user A's run reconciled, A's held estimate is never
  reconciled — A is over-charged by up to the held estimate. Safe polarity (over-charge, never leak) and
  it exists today; under per-user it becomes *visible to a specific user*. Document; do not add a
  "block re-gen while batched" guard (`:4300` explains the UX cost).
- **LEAK L3 — hold/reconcile split across ledgers.** Any path where the hold uses one accountId and the
  reconcile another reproduces L2. The `creditAccountId` stamp is the single mechanism preventing it;
  there must be **no second source of payer identity** anywhere in the finalize legs.

---

## 6. MIGRATION — no seeding, no double-granting, no migration write at all

### 6.1 The existing state

Installs that already ran on the managed key hold `trial:managed-credit = { spentUsd: S }` with
`0 < S <= ~$6`. There is **no** per-user attribution of `S`; the information does not exist and cannot
be reconstructed.

### 6.2 ⭐ The rule: read the legacy record live, add it to the aggregate — never copy it

```
installSpentUsd = installAggregate.spentUsd + legacyLedger.spentUsd     // both read at gate time
```

The legacy record is **never rewritten, never seeded, never marked**. Properties:

- **Idempotent by construction.** There is no "seed once" step, so there is no marker to lose, no
  crash-between-two-writes window, and no way to double-count.
- **In-flight legacy jobs stay correct automatically.** A pre-deploy record carries `keySource:'managed'`
  and `creditEstimateUsd` but no `creditAccountId`, so its reconcile goes to the legacy ledger via
  `chargeLegacyInstall` (§5.4) — exactly where its hold landed. Because the aggregate *reads* the legacy
  total rather than copying it, that late delta is counted the moment it lands. Hold and reconcile stay
  symmetric across the deploy boundary; nothing is mis-charged and nothing is dropped.
- **No user is unfairly charged.** Every user starts with a full $5; the install simply starts with
  `S` of its $50 already spent.
- Cost: one extra `kvs.get` per credit gate (three reads total: user, aggregate, legacy). Managed gates
  are rare — only for a keyless licensed user — so this is acceptable. Both reads fail **closed**.

> ⚠ **LEAK L16 — why the obvious alternative was rejected.** "Seed the aggregate with `S` once, marked
> by `legacy.migratedAt`" (the previous revision's recommendation) has a real double-count hazard: if a
> legacy in-flight job reconciles *after* the seed, its delta lands on the legacy ledger and is then
> counted again the next time anything sums them — or, if the mirror is added to `chargeLegacyInstall`,
> it is counted twice immediately. It also needs a marker write that can be lost. Reading both records
> live removes the entire class.

### 6.3 Additive or breaking?

- **Storage: purely additive.** New keys (`...:u:<id>`, `...:install`); the legacy key is retained,
  readable and still charged. **Nothing is deleted or rewritten in place.**
- **Behaviour: breaking, deliberately.** Per-install exposure rises from ~$6 to $50; the trial-only gate
  is replaced by a license gate (§4.4); the `isEvaluation === false` margin-leak guard is retired. These
  are the point of the change.
- **Manifest / scopes: unchanged -> no customer re-consent.** Verify the manifest diff at release.
- **Rollback:** re-deploying the previous version leaves per-user records orphaned but harmless, and the
  legacy ledger still carries whatever the old code charged it. The rolled-back code reads only the
  legacy key, so it under-counts what the install spent under the new code — i.e. **rollback re-opens
  up to $6 of exposure per install**, not more. State this explicitly in the release notes; do not
  describe rollback as free.
- **FE:** no structural change. `usage.trial` (`:2953-2967`, `App.js:3131-3139`) already renders a
  per-caller snapshot; the copy shifts from "this site's credit" to "**your** credit", and §5.8 decides
  what the badge shows when a site key exists.

---

## 7. COST EXPOSURE, GUARDRAILS AND ACCEPTED RISK

### 7.1 Measured unit costs (repo-sourced, internal only)

| Item | Figure | Source |
|---|---|---|
| Breakdown (Sonnet, Batches) | avg **$0.118**, range **$0.05-0.24** (Anthropic dashboard, 8 pages, 2026-06-07) | `docs/marketing-kb/02-business-model-pricing.md:186`; echoed `src/usage.js:76`, `src/trialCredit.js:78-81` |
| Test-case generation | avg **~$1.01** per breakdown-worth, range **$0.22-3.67** (~16x spread, ~8.6x a breakdown) | `02-business-model-pricing.md:187`; echoed `src/index.js:4383`, `src/usage.js:87` |
| Plan / regen / distill (whole run) | ~**$0.10** each (conservative submit estimates) | `src/trialCredit.js:82-86` |

⚠ **Table C1 internal-only** figures (`docs/marketing-kb/13-claims-register.md:178`) — they belong in
this spec, never in public copy.

### 7.2 Exposure

**What $5 buys one user**

| Mix | Runs on $5 |
|---|---|
| Breakdowns at the measured average ($0.118) | ~42 |
| Breakdowns at the **held estimate** ($0.24 — what an abandoned run is charged) | ~20 |
| Test-case runs at the average ($1.01) | ~5 |
| One dense test-case run ($3.67) | **73% of the grant in a single click** |

A user's true worst case is the per-user ceiling, **$6**, because a cheap surface admitted just under the
ceiling can still reconcile a small tail past it (`src/trialCredit.js:63-69`).

**Per install — the number that matters**

| Site | Users who run something | Lifetime managed draw | Monthly revenue | Draw vs revenue |
|---|---|---|---|---|
| Free band, 10 users, all active | 10 | **$50** (the ceiling; `min(10 x $6, $50)`) | **$0** | permanent, unrecovered — the intended cost of the model |
| Paid, 25 seats, 8 active | 8 | ~$40 (uncapped by the install ceiling) | ~$167.50 | ~24% of ONE month, once |
| Paid, 25 seats, all 25 active | 25 | **$50** (ceiling binds) | ~$167.50 | ~30% of one month, once |
| Paid, 150 seats, all active | 150 | **$50** (ceiling binds) | ~$925 (founder's figure; exact band math unverified — §0.1) | ~5% of one month, once |

**Every install, regardless of size, license state, or how many people use it, is bounded at $50
forever.** That single sentence is the whole safety argument.

### 7.3 Residual risks — accepted, with one that is NOT closed

1. **Farming free Atlassian sites.** Each new free site is worth up to $50 of our Anthropic spend. Cost
   to the farmer: ten email accounts and some minutes. **Accepted** per §0: the credit is not
   transferable (it buys only Jira breakdowns from this app, never cash or raw API access), each fake
   user needs its own Atlassian account, and detection is vendor-side via the Marketplace Reporting API.
2. ⭐ **LEAK L15 — uninstall/reinstall may reset the install ceiling. UNVERIFIED.** Forge app storage is
   per-installation; an uninstall is widely understood to discard it. If so, a farmer (or an honest
   admin) can reset the $50 ceiling *and* every per-user "already granted" record by reinstalling. This
   design does **not** close it and cannot — there is no cross-install state. **Verify the actual
   uninstall/reinstall storage behaviour on dev before funding the production key** (POLICY §9: live
   behaviour is the authority), and record the answer here. If storage does survive, the risk is void;
   if it does not, it is a named accepted risk, detectable only vendor-side.
3. **No cross-install bound exists at all.** In-app guardrails bound one site. Only two things bound our
   aggregate spend:
   - ⭐ **An Anthropic-side monthly budget / spend cap on the managed key or its organisation** — the
     true global kill-switch. **This is a prerequisite for shipping, not a nice-to-have** (§10 decision 6).
   - The manual kill-switch: **unset `MANAGED_ANTHROPIC_KEY`**. Every surface degrades gracefully to
     `managed_unavailable` / BYOK (`:1901-1914`, `:1052-1055`).

### 7.4 Guardrails to implement

1. `MANAGED_INSTALL_CEILING_USD` — default **50**, set **explicitly on production**. (`:68-69` warns
   that a ceiling derived from the grant lets a grant typo scale it; this one is an absolute constant,
   so set it rather than relying on the default.)
2. Keep the test-gen `upper_usd` pre-flight (`:4400`) — the only stopper preventing one 16x-outlier run
   from eating a whole grant. It must now consult the install ceiling too (automatic once the blocker
   takes the snapshot, §5.2).
3. **Log every grant opening** — a `console.log` on the first write of a per-user ledger, with the
   accountId **hashed or omitted** (the app's "Log End-User Data: No" posture, `CLAUDE.md`). A spike in
   openings is the earliest farm signal available inside `forge logs`.
4. Log every `install_ceiling` block. An install hitting $50 is either a healthy 10-person free team
   (good news) or a farm (bad news), and either way we want to know it happened.

### 7.5 Rejected alternatives — recorded so the reasoning survives

| Option | Why rejected |
|---|---|
| **Restrict the grant to the free band** | Not implementable: §3.1 finding 1 verifies there is no band signal at runtime, and finding 2 shows the one candidate (`type`) cannot even be *observed* for the free band without a real production free-band install. Building on it would be a guess on a money path. |
| **Scale the ceilings by instance size** | Same blocker — no seat count exists at runtime (verified). Also solves nothing the flat $50 does not: a large instance is already bounded at $50. |
| **Cap installs per domain / per customer** | **Impossible.** KVS is per-installation, there is no vendor backend, and adding one means a new egress domain -> customer re-consent -> loss of the privacy positioning. |
| **Keep the trial-only gate** | §4 — the ceiling does the job better, and the gate cannot reliably admit the intended audience because its inputs are absent on the one license shape we have verified. |
| **Seed the install aggregate from the legacy ledger once (`migratedAt`)** | §6.2 — a real double-count hazard when a legacy in-flight job reconciles after the seed, plus a losable marker write. Reading both records live removes the class. |
| **`MANAGED_TRIAL_MAX_USERS` (cap how many ledgers an install may open)** | Redundant under a dollar ceiling: $50 already bounds the install whether it is spent by 3 users or 30, and a user cap would deny a $0-cost ledger to user 11 on a legitimately large team. Dropped for simplicity. Revisit only if per-ledger KVS volume ever becomes a cost. |

---

## 8. IMPLEMENTATION ORDER (so no intermediate state can leak)

1. **`managedRunBlocker` snapshot signature** (§5.2, L14) — refactor with the existing single ceiling and
   existing tests green. No behaviour change.
2. **Per-user keys + `chargeSpend(accountId, delta)` + `creditStatus(accountId)`**, still with only the
   per-user ceiling. Ledger key derivation lands with its regex test (L1).
3. **`creditAccountId` stamp at all five submit sites + all six finalize legs** (§5.4). This must land in
   **one** commit — a half-stamped surface is exactly L2/L13.
4. **Install aggregate + `installSpentUsd` + the `install_ceiling` reason** (§5.3, §5.6), fail-closed.
5. **Legacy live-read + `chargeLegacyInstall`** (§6.2).
6. **Gate replacement + `isTrialLicense` removal + probe deletion** (§4.4, §3.3) — last, so the widened
   audience never meets a partially-built ledger.
7. **Copy** (§5.7) and the sweep repair (§5.6).

---

## 9. TEST PLAN

### 9.1 What exists today

| Suite | Covers | Gap for this change |
|---|---|---|
| `prototype/test_trial_credit.mjs` (~45 checks) | `computeCreditStatus`, `managedRunBlocker`, the reservation-convergence invariant (hold -> reconcile => `spent === actual`), read-glitch polarity, ceiling math | **No key derivation, no accountId, no install aggregate, no legacy read.** It simulates `chargeSpend` arithmetic locally because KVS is not node-testable (header, lines 3-18). |
| `prototype/test_v6_tiers.mjs` (~45 checks) | `resolveTier`, `pricingTable`, `isTrialLicense` incl. the margin-leak guard (`:110-120`) | Those 8 assertions are **retired and replaced** (§4.4 step 3) — deliberately, with a comment recording why. |
| `prototype/test_orphan_sweep.js` | `isOrphanStale` | Add coverage for the aggregate recompute (§5.6). |

Both run under `npm test` / `npm run check`.

### 9.2 New pure surface (all exported from `src/trialCredit.js`, no KVS)

- `creditLedgerKey(accountId)` / `installLedgerKey()` / `LEDGER_KEY_LEGACY`
- `resolveChargeAccount(record)` -> `{ scope: 'user' | 'legacyInstall', accountId }`
- `computeInstallSpent({ aggregate, legacy })` -> `{ installSpentUsd, installReadOk }`
- `mirrorDelta(prevUser, rawDelta)` -> `{ nextUser, effectiveDelta }` (L20)

### 9.3 Cases

**Key derivation**
1. `creditLedgerKey('abc') === 'trial:managed-credit:u:abc'`.
2. ⭐ **contains no `YYYY-MM` / period segment** — regex-asserted (guards **L1**).
3. Distinct accountIds -> distinct keys; the same id -> a stable key.
4. `''`, `null`, `undefined`, non-string -> throws / returns null (**never** `'unknown'`) (**L3**).

**Blocker**
5. `install_ceiling` fires when `installSpent + worst > installCeiling`.
6. ⭐ Precedence pinned: `insufficient` -> `ceiling` -> `install_ceiling`, asserted with an input that
   trips all three at once.
7. `installReadOk:false` => **block** (fail-closed, mirrors `readOk:false`) (**L6**).
8. `readOk:false` => block even when the install has headroom.
9. BYOK (`keySource:'byok'`) => `null` under **every** combination, including a breached install ceiling.
10. Non-finite / zero / negative `estimateUsd` => `insufficient` (existing polarity, re-asserted on the
    new signature).

**Attribution**
11. `resolveChargeAccount({ creditAccountId:'A', keySource:'managed' })` => user A.
12. Record **without** `creditAccountId` => `legacyInstall` (never the caller, never `'unknown'`).
13. ⭐ **Negative-delta clamp regression (L2):** hold $0.24 on A, actual $0.11, reconcile routed **by the
    record** => A converges to **$0.11**; and assert that routing it to a *fresh* ledger clamps to 0 —
    the bug the test exists to prevent.
14. Convergence with an **under**-estimate on the correct ledger (test-gen: hold $0.60, actual $2.10).
15. **L13:** hold glitched (estimate stamped 0) but `creditAccountId` present => the full actual charges
    the USER ledger, not the legacy one.

**Markers**
16. Every ref template (`bd:` / `tc:` / `plan:` / `regen:`) **contains no accountId** (guards **L4**).
17. Reconciling the same ref twice => one debit (existing invariant, re-asserted per-user).

**Aggregate + legacy**
18. Positive and negative deltas both mirror; aggregate = sum of user spends after a mixed sequence.
19. **L20:** a delta that clamps the user ledger at 0 mirrors the **effective** delta, so the two stores
    stay equal.
20. `computeInstallSpent` = aggregate + legacy; either read failing => `installReadOk:false`.
21. Legacy `S = 6`, ceiling `50` => 8 further full grants admissible, the 9th run blocked with
    `install_ceiling`.
22. Recompute-from-enumeration is applied as `max(stored, recomputed)` and **never lowers** the stored
    aggregate.

**Gate (replacing the retired `isTrialLicense` block)**
23. Unlicensed license shape => `tier.key === 'unlicensed'` => managed **never** resolved (guards **L10**).
24. ⭐ The **verified** `--license active` shape from §3 (`{active, isActive, type:'commercial',
    billingPeriod:'MONTHLY', state:'active'}`, no `isEvaluation`, no `trialEndDate`, no `capabilitySet`)
    => resolves Standard => **eligible** for the grant. This is the assertion that encodes the §4 decision.
25. A trial-shaped license (`isEvaluation:true`) => also eligible (no regression for the audience that
    works today).

### 9.4 Live verification (offline tests cannot reach these — POLICY §9)

- ⭐ **Uninstall/reinstall storage behaviour** (§7.3 risk 2) — does the install ceiling survive? Do the
  per-user ledgers? **Before funding the production key.**
- **Two accounts on one dev site**: each opens its own ledger; A's exhaustion does not block B (the
  founder's "person 7 carries on" requirement, verified live).
- **Cross-user poll**: A submits a breakdown, B polls it (the `pageJob:` path described at `:2352-2354`)
  => **A's** ledger converges to the actual; B's is untouched.
- **Cross-user regen**: A generates the bulk test cases, B regenerates one story => **B** pays.
- **Install-ceiling trip** with a small `MANAGED_INSTALL_CEILING_USD` (e.g. `0.5`) — never by disabling a
  gate (`src/trialCredit.js:42-43`) — and confirm the `install_ceiling` copy does **not** claim the
  user's own credit is spent (§5.7).
- **BYOK precedence**: save a site key mid-run => every user routes to BYOK (§5.8) and the badge behaves
  as decision 3 dictates.
- **A real free-band production install** — capture the license shape (§3.1 finding 2) for the record.
  Not a dependency; a footnote we want filled.

---

## 10. REMAINING DECISIONS FOR THE FOUNDER

1. **`MANAGED_INSTALL_CEILING_USD = 50`** — confirm. It is the one new number and the entire safety
   argument rests on it. ($25 halves free-band exposure but breaks the "all ten people" promise on an
   active team; $50 is the approved figure.)
2. **Uninstall/reinstall reset (§7.3 risk 2)** — accept as a known, unclosable vector, or delay funding
   until the dev verification is done? *Recommendation: verify first, then accept; it costs one dev test.*
3. **What happens to an unspent grant once a site API key is saved (§5.8)?** *Recommendation: BYOK keeps
   precedence and the badge hides the balance.* The alternative — letting a user with credit still run on
   it — contradicts "the site has a key, they do not need our money" and re-opens spend on sites that are
   already self-sufficient.
4. **Confirm "lifetime, never re-granted"** — no monthly, no annual, no reset on a user's return.
5. **In-product copy: "welcome credit" replaces "free trial credit"** (§4.4 step 4, §5.7) — confirm the
   wording, including the new `install_ceiling` string. In-product strings are not governed by B16
   (which covers *public* claims), but they are the first place the promise becomes concrete.
6. **Anthropic-side budget cap** on the managed key — value, and who sets it. **Blocking for launch:** it
   is the only cross-install bound that exists (§7.3).
7. **The `11-100` band boundary is unverified** against the vendor portal, as is what the portal
   currently bills. Not blocking for this change; it blocks the pricing-copy correction.
8. **Public claims stay BLOCKED** — `13-claims-register.md` **A2.7 / B16 / B18**, and the open GAP at
   `:86` ("does the new Free <=10 tier also receive the managed welcome credit?"). This spec answers that
   GAP **as an approved design, not as a shipped capability**; the register gate stays until code +
   funding + founder sign-off all land. Note B18 in particular: the per-install / trial-only description
   becomes *historically* wrong once this ships, so the register row needs updating at that point.

---

## Appendix — silent-failure inventory

Every place this change could leak money, double-charge, or mis-attribute a charge.

| # | Where | Failure | Polarity | Mitigation |
|---|---|---|---|---|
| L1 | Ledger key shape | A copied `${period}` segment => **$5/user/month** re-grant | Leak (severe, silent) | Period-free key + §9 case 2 |
| L2 | Reconcile routed to the caller | Negative delta clamped to 0 on a fresh ledger => real spend vanishes; an under-estimate lands on the wrong user | **Both directions**, silent | `creditAccountId` stamp (§5.4) + §9 case 13 |
| L3 | `accountId` fallback `'unknown'` | Hold and reconcile in different ledgers; one shared drainable bucket | Leak | Fail closed on an absent accountId (§5.1) |
| L4 | accountId added to the marker ref | Two markers for one billing event => **double charge** | Over-charge | Refs stay account-free (§5.5) + §9 case 16 |
| L5 | Aggregate mirrors holds but not reconciles | Monotonic over-count => honest users locked out early | Customer-hostile | Mirror every delta (§5.6) |
| L6 | Install-aggregate read glitch read as 0 | The only bound is bypassed | Leak | Fail closed, like `readOk:false` (§5.3) |
| L7 | `tcjob` overwritten before reconcile | The prior holder's estimate is orphaned on their ledger | Over-charge (safe) | Document; pre-exists (`:4296-4300`) |
| L8 | Distill per-step charge | Debited to the stepping user, not the session opener | Mis-attribution | Stamp `creditAccountId` on the session (`:1092`) |
| L9 | Cycle-repair charge | Debited to the poller, not the job owner | Mis-attribution | Read `job.creditAccountId` (`:2616-2622`) |
| L10 | Widened gate without an unlicensed check | An unlicensed user spends our key via distill (no license gate at `:1034`/`:1127`) | Leak | `tier.key !== 'unlicensed'` in `resolveAnthropicKey` (§4.4) |
| L11 | Install-scoped BYOK secret | Remaining per-user grants become unreachable once any key is saved | Promise gap | §5.8 + decision 3 |
| L12 | No cross-install bound | Total spend across farmed sites is unbounded from inside the app | **Existential** | Anthropic-side budget cap (§7.3, decision 6) |
| L13 | `creditAccountId` stamped only when the hold succeeded | A hold glitch (estimate 0) routes the **full actual** to the legacy ledger | Mis-attribution (large) | Stamp unconditionally for managed (§5.4) |
| L14 | A blocker call site omits the new install fields | The install ceiling is silently unenforced on that surface | Leak | Snapshot-object signature (§5.2) |
| L15 | Uninstall/reinstall | Install ceiling **and** every "already granted" record reset | Leak, unbounded by repetition | **UNVERIFIED** — verify on dev; otherwise accepted + vendor-side detection (§7.3) |
| L16 | Legacy seeding with a `migratedAt` marker | A late legacy reconcile is counted twice, or the marker write is lost | Both directions | Read legacy live; never seed (§6.2) |
| L17 | A per-user ledger swept/purged | The $5 grant is re-issued to that user | Leak, repeatable | Never sweep `trial:managed-credit:*`; comment at both sweep sites (§5.1) |
| L18 | Regen inherits `keySource` from another user's `tcjob` | A user reaches the managed key without their own gate running | Leak | Re-run the per-user credit gate against the **invoker** (§5.4) |
| L19 | `MANAGED_HARD_CEILING_USD` defaults to `1.2 x grant` | A grant typo scales the per-user ceiling with it | Leak | Set both ceilings explicitly on production (§7.4) |
| L20 | Aggregate mirrors the RAW delta while the user write clamped at 0 | The two stores diverge permanently | Both directions | Mirror the **effective** delta (§5.6) + §9 case 19 |
