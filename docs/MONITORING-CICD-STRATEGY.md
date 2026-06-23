# Spec2Tickets — Monitoring + CI/CD Strategy (Analyze → Design)

> **Status:** STRATEGY (Analyze → Design only). No code/config is written this session.
> Branch `feature/monitoring-ci-cd` (off `release/v6.1.0`). Conducted via the §13 model:
> a 7-agent research fan-out (6 lenses + adversarial pitfalls pre-mortem) → conductor synthesis →
> a 6-lens **deep completeness audit** (fresh-eyes) whose 13 confirmed findings are folded into
> **this revised v2**. Date: 2026-06-22. App: Marketplace v6.1.0 (LIVE).
>
> **What this is for:** a recommendation set + trade-off tables + a sequenced phase-1 roadmap the
> partner decides from. Every implementation phase will later get its own §13 gate + (for any
> WRITE-path/prod-touching change) a pre-prod adversarial gate.
>
> **Audit note (v2):** the deep audit found **0 critical, 2 high, ~5 medium, ~6 low** findings — all
> folded in below. None reversed the strategy's direction; they corrected facts, resolved one
> internal contradiction (forge lint vs zero-secret phase-1), and added completeness (rollback/recovery,
> hotfix path, Anthropic-outage observability). The audit trail is in §12.

---

## 0. TL;DR — the thesis

The **entire** monitoring + CI/CD stack a solo Forge vendor needs fits **FREE** on
**GitHub-native + Forge-native** surfaces — **no backend, no egress, no new SaaS, no customer
re-consent.** The product's hard constraints (no backend, no egress, licensed Marketplace app)
don't just *allow* a lightweight strategy — they *select* for it: the heavyweight enterprise options
(canary deploys, OTEL export, external dead-man's-switches, Datadog) are either impossible here or
actively harmful to the privacy moat.

The strategy rests on **three load-bearing decisions** where it earns its keep:

1. **CI gates the MERGE; a human gates the PUBLISH.** `forge deploy -e production` auto-publishes —
   minor versions auto-roll to customers (progressively, over up to 120h) and a scope/egress (major)
   version waits per-customer on re-consent — and a licensed prod app *cannot* be smoke-tested (no
   `forge install` on prod). So phase-1 CI is **gates-only with ZERO credentials in CI** (this is why
   `forge lint`, which needs a Forge token, is **not** in the phase-1 gates — see §3.2/§3.4); deploy
   automation (scoped token behind a manual-approval gate) is a deliberate phase-2.
2. **Observability stays Forge-native and vendor-side — the app NEVER pings out.** Any external
   monitor/heartbeat/error-tracker called *from the app* needs a new egress domain → MAJOR version →
   customer re-consent → damage to the "no-egress / Log End-User Data: No" moat. This is the single
   most seductive wrong turn, and the strategy forbids it.
3. **Green CI ≠ proven app.** CI proves *compile + pure-function correctness only*. The resolver/IO
   layer is largely untested and the Custom UI has only a compile gate. The manual **live-acceptance
   runbook stays the mandatory proof-of-customer-journey** before any WRITE-path prod deploy.
   *(Phase-1 narrows this gap cheaply: see the 207/partial pure-slice in §5.1/§8.)*

And one decision the audit added: **there is no rollback** — recovery is fix-forward, and a
scope-touching break degrades from a minutes-recovery (minor) to a days-recovery (major, re-consent).
The strategy must be designed for that (§6.5).

---

## 1. LENS §0 framing (POLICY §0)

| Question | Answer |
|---|---|
| **Where in the stream** | Not a product-pipeline step — a **meta-layer around delivery** (build→test→deploy) and **observability** of the live app. |
| **Small-agent boundary** | A strategy deliverable; research + a deep audit fanned out (breadth + fresh eyes the conductor lacks); the conductor holds the synthesis. |
| **Consumes upstream** | Verified repo state (greenfield CI, 12 offline suites, the diagnostics ledger as the in-product half) + Forge platform realities. |
| **Emits forward** | Trade-off tables + a recommendation + a sequenced phase-1 roadmap → decisions for the partner. |
| **Token/budget pressure** | Research + audit breadth (Ultracode on). |
| **Highest-value, not safest** | A **right-sized** strategy for a solo vendor (POLICY §3.5), informed by enterprise thinking but scaled down — adopt the *thinking*, skip the *machinery*; and put the cheap high-value slice of the #1 test gap in phase-1, not phase-3. |

---

## 2. Analyze — current state (verified against the live repo)

**CI/CD = greenfield.** No `.github/workflows`. Root `package.json` has **no scripts**. Deploy is
fully manual: `cd static/hello-world && npm run build` → `forge deploy -e development|production` →
portal steps. **Zero automated gates.** Every hard-won rule (Node-24 match, build-must-be-green,
per-file `node --check`) is enforced only by human discipline.

**Tests = strong base, run by hand.** The `prototype/test_*.{js,mjs}` glob matches **13 files; 12 are
offline pure-function suites** (planner math + Kahn topo + packer, diagnostics privacy wall, Jira
error-shape parser, uid-link binding, tier truth-table, orphan-sweep, cost) with adversarial inputs
and a clean `process.exit(0/1)` contract. One of them, **`test_prototype.js`, is a LIVE Anthropic-network
harness** (needs `ANTHROPIC_API_KEY`) — it is **not** offline and must be excluded from any runner.
There is no runner, no npm script, no gate today.

**Monitoring — the gap.** The **in-product half exists**: the diagnostics ledger (`src/diagnostics.js`)
records failures in the *customer's own* Forge KVS, no egress, no content. The **vendor-side half is
the gap**: deploy confidence, app health across installs, "did the daily orphan-sweep fire", error
trends — today only `forge logs` + dev-console metrics + the Marketplace API, all eyeballed.

**Verified facts (correcting stale CLAUDE.md/memory — POLICY §9 live-is-authority):**

| Stale claim | Verified reality (2026-06-22) | Consequence |
|---|---|---|
| node_modules tracked in git | **Gitignored, 0 tracked**; both `package-lock.json` present | Use `npm ci` from lockfiles; no untracking decision needed |
| DIAG_APP_VERSION stale 3.0.0 | **`'6.1.0'`** (`src/diagnostics.js:56`), in sync with `package.json` | The version-sync is a *forward guard*, not a present defect |
| eslint "just activate it" | Dormant devDep (`^8.56.0`), **no `.eslintrc`/`eslint.config.*` anywhere** | A standalone eslint step would no-op/error → rely on `node --check` + CRA's built-in eslint |
| `node --check src/*.js` checks all files | **FALSE — `node --check` validates only the FIRST file** (verified on Node 24.16.0: a bad 2nd file exits 0) | The `check` script MUST loop `node --check` **once per file**, else the "syntax wall over index.js" is false-green |
| (mechanism of ESM resolution) | `src/*.js` resolve as ESM via **Node-24 auto-detection** at RUNTIME/import (0 `require(` in `src/`); `prototype/package.json`'s `"type":"module"` anchors the **test** files | Leave both `type` fields as-is. ⚠ But `node --check <file.js>` uses the CJS goal at root and SILENTLY swallows ESM syntax errors (false-green) → `check-syntax.mjs` forces the ESM goal by piping each source to `node --check --input-type=module` via STDIN. We do NOT add `type:module` to root — it would change what the Forge bundler sees on a LIVE app (unverifiable offline). |
| — | sweep logs `[sweep] scanned=X deleted=Y degraded=Z` (`src/index.js:5513`); `scheduledTrigger orphan-sweep → orphan-sweep-fn` (`manifest.yml:77-79`) | The native-heartbeat data already exists — it's logged then lost |
| — | 207/partial HTTP-status→result mapping is **inline pure logic** in `push_handler.js` (`:1485`, `:1646-1653`) | Extractable + unit-testable with NO @forge mock (like `parseJiraErrorDetail`) → a phase-1 win (§5.1) |

**Constraints that bound the design (must respect):** no Spec2Tickets backend · no egress / "Log
End-User Data: No" (and no *perception* of egress) · licensed app (no `forge install` on prod;
`forge deploy -e production` auto-publishes; scope changes force re-consent; **no rollback** — recovery
is fix-forward) · Node 24 / `@forge/cli` pinned · pinned dep set (`@forge/resolver` exactly 1.7.1; never
`npm audit fix --force` on the CRA app; `@forge/events` is NOT a current dep — if ever re-added, pin 1.x) · solo vendor → lightweight,
maintainable by one person.

---

## 3. Design — Part A: CI/CD

### 3.1 The pipeline shape (adopt / defer / skip)

| Enterprise practice | Verdict (solo Forge) | Why |
|---|---|---|
| lint → build → test → deploy stages | **ADOPT** (gates) | The existing manual ship-ritual, automated. Free. |
| Branch protection (CI-green-to-merge) | **ADOPT** — one rule | ~80% of the value; "require review" correctly skipped (no 2nd reviewer). Admin-bypassable solo → a speed-bump, not a wall (§6.4). |
| Trunk-based / GitHub Flow | **ADOPT** (just name it) | Already the de-facto flow; `release/*` only to freeze a Marketplace submission. CI runs on `main` + `release/*` (§8). |
| `npm audit --omit=dev` + Dependabot (security-only, no auto-merge; respect the `@forge/resolver` 1.7.1 pin) | **ADOPT phase-1** | Enforces existing supply-chain discipline; **never auto-merge** + never `npm audit fix --force` (react-scripts is fragile). audit is ADVISORY (one unremediable `@forge/api`→undici HIGH; §5.2). Both in the §8 phase-1 roadmap. |
| Env promotion dev→(staging)→prod, manual prod gate | **PHASE 2** | High value but needs a deploy token in CI — defer until the gates land. |
| Secrets in CI (FORGE_EMAIL/FORGE_API_TOKEN) | **PHASE 2** (Environment-scoped) | Phase-1 has **no token in CI at all** (see 3.2). |
| `forge lint` | **PHASE 2** (deploy job) + local pre-deploy | **Needs a Forge token** → cannot be in the zero-secret phase-1 gates (§3.4). Its main check is the globalPage false-positive anyway; the auth-free **scope-diff guard** covers the high-stakes manifest case in phase-1. |
| Conventional commits + **version-lockstep guard** (NOT release-please) | **ADOPT** (Phase-2 #1, DONE) | A 5/5 persona vote dropped release-please as gold-plating → a CI drift-assert (`tools/version-drift-guard.mjs` in `npm run check`) fails the merge if `package.json` ≠ `DIAG_APP_VERSION`. Changelog deferred (no in-repo consumer). |
| SHA-pin third-party actions; pin `@forge/cli` major | **ADOPT** | 5-min defense vs the 2025/26 action-compromise class. |
| Canary / blue-green / % code rollout | **SKIP — N/A** | Not available to a Marketplace app. The Forge **MINOR-version auto-update** (progressive over ≤120h) is a de-facto canary **for routine code-only deploys ONLY** — a scope/egress (MAJOR) deploy does NOT get it (it rolls per-admin on re-consent, §3.3), so the scope-diff guard + staging rehearsal are the only safety net there. A pre-placed **kill-switch feature flag** is the closest thing to rollback for a risky feature (§6.5). |
| SBOM, commitlint, semantic-release, OIDC keyless | **SKIP** | Overkill / inapplicable (Forge has no OIDC; semantic-release can't drive the portal). |

### 3.2 The three load-bearing CI/CD decisions

**(a) Phase-1 = gates-only, NO credentials in CI.** The `FORGE_API_TOKEN` is the vendor's *full
personal Atlassian credential* and `forge deploy -e production` auto-publishes to **every paying
customer** — that single token is the entire production blast radius. The highest-value/lowest-risk
phase-1 therefore runs **only** auth-free gates (build, test, per-file `node --check`, `npm audit
--omit=dev`, the scope-diff guard) on PRs and stores **no secret**. Deploy automation (scoped token,
manual-approval Environment, staging rehearsal) is a clean phase-2 once the gates are trusted. →
*eliminates the #1 high-severity pitfall for phase-1 entirely.*

**(b) Pin Node 24 + `@forge/cli` major, or "build green" lies.** Forge runtime is `nodejs24.x`;
Atlassian's own CI examples use node 16/18. Pin the runtime via the action **input**
`with: { node-version: 24 }` on a SHA-pinned (or `@v4`/`@v6`) `actions/setup-node` — **not** a
non-existent `actions/setup-node@24` tag. Pin `@forge/cli` to its major (`@12`). Add a one-line
`node --version` (starts with `v24`) assertion.

**(c) Keep the gates job auth-free.** Because of (a), nothing in the phase-1 PR-triggered job may
require a Forge token. That is the reason `forge lint` is deferred to phase-2 (§3.4) and the
deterministic, auth-free **manifest-scope-diff guard** (§3.3) is the phase-1 manifest safety net.

### 3.3 The manifest-scope-diff guard (cheap, high-value, auth-free)

A CI step (pure git diff + a small parse — **no Forge token**) that diffs `manifest.yml` scopes +
`external.fetch` vs the base commit and **fails/loud-warns on change**, with the message: *"MAJOR
version → customers re-consent in Manage Apps; ship release notes + a staging install rehearsal."* The
pipeline must make re-consent **visible**, never try to automate it (un-automatable for a licensed app;
`forge version bulk-upgrade` excludes scope escalations). v6.1.0 spent 5 jira-software scopes → live
re-consent; this guard prevents a routine PR silently becoming a major version.

### 3.4 Why `forge lint` is NOT in the phase-1 gates (resolved contradiction)

`forge lint` requires `FORGE_EMAIL`/`FORGE_API_TOKEN` to run (verified via Atlassian community docs;
to re-confirm live, §11). Putting it in the phase-1 PR-triggered job would pull the high-blast-radius
token into the exact gates job that runs on PRs — breaking decision (a)'s "zero secrets". It is also
*advisory only* and its single most relevant check is the documented globalPage `resolver:`
false-positive (gotcha #13). **Resolution:** phase-1 relies on the auth-free scope-diff guard for
manifest safety; `forge lint` runs (i) **locally pre-deploy** (the dev already does this) and
(ii) in the **phase-2 deploy job** that legitimately holds the scoped token. This keeps "zero secrets
in phase-1" literally true.

---

## 4. Design — Part B: Monitoring / observability

### 4.1 The Forge-native, vendor-side stack (the whole answer)

| Surface | What it gives | Cost | Phase |
|---|---|---|---|
| **Dev-console invocation metrics** | Success rate, count, error types (timeout/OOM/throw), P50/90/95 latency — **aggregated across all installs**, per-function, per-site, per-env | free | 1 (no code) |
| **Dev-console Alert rules (GA)** | Up to 5 rules (success-rate / errors / API count) → **email** (to `support@`/`security@spec2jira.com`); severity tiers + 24h re-notify = solo on-call | free | 1 (no code) |
| **Native KVS heartbeat for the sweep** | Persist `last_swept_at` + `{scanned,deleted,degraded}` to app KVS; surface on the existing admin diagnostics/health view; "missed" computed at read-time | free | 1 (tiny code) |
| **`@forge/metrics` counters** | ❌ **SKIPPED** (Phase-2 #2 decision, 5/5 persona vote): NOT alert-sourceable (alert rules source only the 4 built-in metrics — web-confirmed) → dashboard-only; the 3 genuinely-new signals (push_partial_207, anthropic 5xx-vs-keyrejected) are ALREADY in the diagnostics-ledger aggregate (just per-install); a pre-1.0 dep + noisier (sampled/no-backfill). Cross-install rollup deferred to the App-Logs poller. | free | ❌ SKIP |
| **Marketplace Reporting API v2** | Installs, active users by edition, eval→paid conversion, churn — **vendor-side script, not Forge-callable** | free | 2 |
| **App Logs/Metrics API (OTLP)** | Programmatic vendor-side pull (14-day window, ~15min/call, rate-limited); a thin scheduled poller could confirm `[sweep]` across installs | free (Atlassian side) | 2/3 |
| **In-product diagnostics ledger (exists)** | Per-customer failure depth, consent-exported support trace | done | — |

> **Token hygiene for the phase-2 vendor-side tokens (Reporting + App-Logs API):** these use Basic
> auth (email + API token) and the App-Logs token can read app logs across installs (privacy-adjacent).
> Apply the SAME hygiene as the deploy token (§6.2): a **dedicated non-admin / bot Atlassian account**
> (Atlassian's own recommendation for the logs token), MFA, rotation, stored **outside the repo**
> (never in the CRA app), and run from a **local/scheduled script** — a standing hosted poller would be
> a "backend" in the no-backend sense; a laptop/cron script is fine.

### 4.2 The no-egress rule (the seductive wrong turn — forbid it)

The textbook fix for "did the cron fire" is an external dead-man's-switch (healthchecks.io / Cronitor /
Better Stack) or Sentry for errors. **For the app to ping any of them it must add the domain to
`permissions.external.fetch` → MAJOR version → customer re-consent → a second-ever egress destination
on an app sold on "no egress."** Even though a heartbeat carries no customer data, it creates the
*perception* of phoning home. **Verdict: NEVER ping an external monitor from the app.**

- **The sweep "did it fire" gap is solved natively** (the KVS heartbeat above) — the data already
  exists (`[sweep]` log line); we just persist + surface it. Zero egress, zero scope, zero re-consent.
- If a real dead-man's-switch is ever wanted, ping healthchecks.io **from a vendor-side poller** (the
  App-Logs-API reader), *never from the app* — then it monitors the poller, and the conflict disappears.
- **Sentry** fails on both halves (resolver SDK needs egress; the Custom-UI iframe sandbox is fixed +
  egress-allowlisted) → the existing no-egress ledger *is* the privacy-correct "Sentry".

### 4.3 SLO / golden-signals — adopt the thinking, scope it to vendor-fault, but name the Anthropic outage

One SLO: **"generation + push + plan success rate ≥ ~99%"**, read off the console success-rate metric,
with **2–3 alert rules**. Critical nuance (BYOK): per-customer failures (bad/expired key,
out-of-credit, rate-limit, pending Jira re-consent, missing permissions) count as "invocation errors"
but are **NOT the vendor's fault** → scope the SLO/alerts to **vendor-fault classes only**, read off the
dev-console's built-in invocation/success-rate metrics (NOT custom counters — `@forge/metrics` was **SKIPPED**
in Phase-2 #2: not alert-sourceable; see §4.1), and **start alerts in observe-mode for ~a week** before arming.

**But carve out the Anthropic-platform outage as its own observable** (the audit's catch). The app's
only egress dependency is `api.anthropic.com`; if it is down platform-wide, *every* call fails for
*every* customer — vendor-relevant (it drives support load and may need a known-issue note), and
distinct from a single customer's bad key. The backend already separates these classes by error code
(`src/anthropic_client.js`: `anthropic_<5xx>` vs `auth_rejected`/`insufficient_credits`/`rate_limited`;
mirrored in `classifyDiagGenerationError`, `src/diagnostics.js`) — note 5xx is the `anthropic_<status>`
family (status carried as data), not a standalone 'overloaded' class. So: a **cross-install spike in the
`anthropic_<5xx>` class** is a separate "dependency-down" signal — kept **out of** the auto-alert
vendor-fault threshold (to avoid fatigue) but **named and watched**. ⚠ **Interim state (until Phase 3) — a
CONSCIOUS gap, not "already solved":** this vendor-critical signal (it drives support load) has **no
automated cross-install alert or dashboard today** — custom counters can't source a Forge alert, so it is
a **manual** check of the dev-console error-type breakdown only; the cross-install rollup is a deliberate
deferral to the Phase-3 App-Logs poller (per-install, the diagnostics ledger already classifies it). Don't
let it get silently lumped into "not our problem".

Skip multi-burn-rate windows, on-call rotation, PagerDuty, formal postmortems.

### 4.4 What to skip (overkill / inapplicable for a solo no-backend app)

Standalone uptime/synthetic monitoring (no public endpoint to probe), Datadog/New Relic/Splunk standing
pipelines, the App-Logs-API→OTEL **export to a 3rd-party SaaS** (needs vendor backend infra → violates
no-backend, and routes logs off-platform → egress-perception), a customer-facing status page (premature
at MVP install counts; if ever wanted, Better Stack's free status page needs no Forge egress).

---

## 5. Design — Part C: Testing in CI

### 5.1 The honest test pyramid

- **Base (pure-function unit) — STRONG, adversarial.** 12 offline suites cover the load-bearing logic.
- **Middle (resolver/integration) — largely ABSENT.** `src/index.js` (every resolver) and the IO half
  of `push_handler.js` (KVS sessions, `asUser().requestJira` writes) have no test; `@forge/kvs`/
  `@forge/api` are never mocked. **This is the honest #1 coverage gap** — where the deep-audit memory
  keeps finding bugs (the v6.1.0 207-partial bugs `5fef67e`/`d8c86a6`).
  - **BUT the highest-recurring-bug DECISION logic is PURE and extractable NOW** (audit catch): the
    HTTP-status→result mapping (207-partial etc., inline at `push_handler.js:1485`, `:1646-1653`) needs
    **no @forge mock** once extracted into exported helpers — exactly like `parseJiraErrorDetail` was
    after a live bug. → **Phase-1** extracts these + unit-tests 200/204/207-known/207-unknown/403; the
    **full @forge KVS/API mock harness** (session orchestration, `asUser` wiring) stays **phase-3**.
- **Top (E2E) — deliberately MANUAL.** Only via `forge tunnel` + the live-acceptance runbook, which
  *provably* catches the un-mockable Forge/scope truths (the 8 live-only planner bugs) a CI E2E never
  could.

### 5.2 Gate policy

| Gate | Block / advisory | Note |
|---|---|---|
| Offline test runner (**12 suites**) | **BLOCK** | Globs `test_*.{js,mjs}` (13 files), excludes the live `test_prototype.js`. Cross-platform Node runner, child_process per file (NOT `node --test` — the suites self-run + `process.exit`). |
| **Per-file ESM** `node --check` over `src/*.js` | **BLOCK** | Loops **once per file** (a glob checks only the FIRST) AND forces the **ESM goal** via `--input-type=module` STDIN (a `.js` under the CJS-default root swallows ESM syntax errors — false-green). The only automatic touch of the untested `index.js`/IO layer. |
| CRA `npm run build` | **BLOCK** | The only frontend gate (compile-only — a logic bug still compiles). |
| `npm audit --omit=dev --audit-level=high` | **ADVISORY** (continue-on-error) | `--omit=dev` skips dev-only CRA advisories; NON-blocking because one HIGH (undici) is pulled unremediably by the pinned `@forge/api` tree (→ @forge/manifest → cheerio → undici) — it surfaces vulns without red-walling every PR. Dependabot security updates are the remediation path; re-evaluate if a CRITICAL appears. |
| Manifest-scope-diff guard | **BLOCK/warn** | Auth-free; flags MAJOR/re-consent releases (§3.3). |
| Extracted 207/status-mapping unit suite | **BLOCK** | Phase-1 add (§5.1) — the cheap slice of the #1 gap. |
| `forge lint` | **NOT in phase-1 CI** | Needs a token → phase-2 deploy job + local pre-deploy (§3.4). |
| Coverage-% threshold | **SKIP** | Would punish the deliberate pure/IO split with a misleading low number. |
| Browser/Forge E2E in CI | **SKIP** | Secret-laden, flaky; can't exercise scope-consent/board-type truths. |

### 5.3 The runner wiring traps (must get right)

- **NOT `node --test`** — the suites self-run at import and `process.exit(0/1)`, so `node --test`
  double-runs and aborts mid-suite.
- **NOT a Bash loop** — dev box is Windows, CI is Linux. Use a tiny **cross-platform Node runner**
  (`child_process` per file, fail on non-zero) so `npm test` is identical on both.
- **Exclude the live-network harness** `test_prototype.js` (real Anthropic calls). The other live
  harnesses (`analyze_live.js`, `distill_revalidate.js`, `validate_spec_source.js`, `bakeoff_harness.js`)
  are **outside** the `test_*` glob, so they're already excluded — a `*_live.*` rename for them is
  optional future-proofing only.
- **Leave the `package.json` `type` fields alone** — `src/*.js` resolve as ESM via Node-24
  auto-detection (no `require(` in `src/`); `prototype/package.json`'s `"type":"module"` anchors the
  test files. No reason to change either.

---

## 6. Operational guardrails (incl. the audit's completeness adds)

### 6.1–6.3 MUST-ADDRESS (from the adversarial pre-mortem)

1. **No auto-deploy to production on merge.** `forge deploy -e production` auto-publishes; a human
   clicks to release. (Phase-1 sidesteps this entirely: no deploy in CI.)
2. **`FORGE_API_TOKEN` (when introduced) → GitHub *Environment*-scoped to the prod job only**, never a
   plain repo secret, never exposed to PR/fork workflows. Use `pull_request` (not `pull_request_target`).
   Dedicated low-use Atlassian account + MFA + rotation. (Same hygiene generalizes to the phase-2
   Reporting/Logs tokens — §4.1.)
3. **App never pings an external monitor** — confirm the sweep natively; vendor-side observability is
   Forge-native or vendor-side-poller only.

### 6.4 Hotfix path + the branch-protection reality (audit add)

Branch protection on a solo repo is **admin-bypassable by the owner** — it is a speed-bump that nudges
discipline, not a wall (state this honestly; don't overstate the gate's value). For an urgent
customer-facing regression: the hotfix still runs **`npm run ci` locally green** (it's seconds-to-low-
minutes) **before** the manual `forge deploy -e production` — so "green CI" is preserved even when the
fix bypasses the GitHub gate under pressure. Decide explicitly whether branch protection is
"enforce-for-admins" (safer, but blocks your own emergency self-merge) or owner-bypassable (pragmatic
for solo). **Recommendation:** owner-bypassable + the local-`npm run ci`-before-deploy discipline.

### 6.5 Rollback / incident recovery (audit add — the symmetric gap)

**Forge has NO rollback / revert / un-publish.** Recovery is **fix-forward** (deploy corrected code as a
new version). The asymmetry the strategy is built around cuts both ways:

- A **non-scope fix ships as a MINOR version** → auto-rolls to all sites within the ≤120h staggered
  window (fast, no consent) — acceptable recovery.
- A **scope/egress-touching break degrades to a MAJOR fix** → gated on per-admin re-consent in Manage
  Apps → recovery can be **days**, install-by-install. This is the same blast radius as the scope-diff
  guard (§3.3), seen from the recovery side.

**Mitigations:** (a) the scope-diff guard + staging rehearsal keep scope-touching changes off the
routine path; (b) for a genuinely risky new feature (e.g. a new Jira WRITE path), **pre-place a Forge
feature flag** before the deploy so it can be dialed to 0% (~60s) *without* a redeploy — the closest
thing Forge offers to instant rollback, and the reason §3.1 doesn't blanket-skip feature flags; (c) the
incident runbook (§8) must cover **deploy-recovery**, not just alert-response.

### 6.6 Other guardrails

4. **Manifest-scope-diff guard** — fail/loud-warn on scope/egress change; route scope PRs through a
   staging rehearsal, never the normal deploy path. Re-consent is un-automatable for a licensed app.
5. **Green CI ≠ proven app** — the live-acceptance runbook stays the mandatory proof before any
   WRITE-path prod deploy. (Phase-1 narrows the gap via the 207 pure-slice, §5.1.)
6. **Build on the verified repo state, not stale prose** (npm ci from existing lockfiles;
   DIAG_APP_VERSION already 6.1.0; no eslint config; per-file node --check; 12 offline suites).
7. **Dependabot fork-PR secrets:** Dependabot PRs are treated as fork PRs and **cannot read repo
   secrets** → keeping the phase-1 gates **auth-free** (per §3.2) means Dependabot PRs pass the same
   gates as any PR. **Never** "fix" a failing token-bearing check by sending secrets to fork PRs or
   switching to `pull_request_target` — that re-opens the fork-exfiltration hole guardrail 2 forbids.

---

## 7. Tooling decision matrix (free-first; cheap-paid only where it earns its price)

| Tool | Role | Cost | Verdict |
|---|---|---|---|
| **GitHub Actions** | CI spine | Free (2,000 private min/mo ≫ need; free+unlimited public) | **ADOPT** phase-1 |
| **Branch protection** | Enforce CI-green-to-merge | Free | **ADOPT** phase-1 (owner-bypassable, §6.4) |
| **Built-in Node runner (`child_process`)** | Run the 12 offline suites | Free (zero deps) | **ADOPT** phase-1 |
| **`npm audit --omit=dev`** | Supply-chain gate (advisory — §5.2) | Free | **ADOPT** phase-1 |
| **Dependabot** (security-only, weekly, grouped, no auto-merge; respect `@forge/resolver` 1.7.1 pin) | Dep updates | Free | **ADOPT** phase-1 |
| **Forge dev-console metrics + Alerts** | Vendor-side health + email on-call | Free | **ADOPT** phase-1 |
| **version-drift-guard** (`tools/version-drift-guard.mjs`, in `npm run check`) | Version-lockstep assert (fails merge on drift) | Free | **ADOPT** (Phase-2 #1, DONE — replaced release-please per a 5/5 persona vote: strictly stronger at the §11 goal, ~5% of the surface) |
| **`@forge/metrics`** | Cross-install counters | Free | ❌ **SKIP** (Phase-2 #2, 5/5 vote: not alert-sourceable + redundant with the ledger aggregate + noisier; cross-install rollup deferred to the App-Logs poller) |
| **Marketplace Reporting API v2** | Business health | Free | **PHASE 2** (vendor-side script, token hygiene §4.1) |
| **`forge lint`** | Manifest/code lint | Free (needs token) | **PHASE 2** deploy job + local — NOT phase-1 gates (§3.4) |
| **a9-forge-gh-action** (community) | Forge deploy Action | Free | **AVOID for prod path** — low-adoption 3rd party in the token path; hand-write ~30 lines |
| **CodeQL** | Deep SAST | Free *public only*; private needs paid GHAS | **CONDITIONAL** — only if repo made public (also unlocks free unlimited Actions) |
| **Snyk** | SAST middle ground | Free tier (capped) | **OPTIONAL** if SAST wanted on a private repo |
| **healthchecks.io / Cronitor / Better Stack** | Heartbeat | Free tiers | **DO NOT call from the app** (egress/re-consent); vendor-side-poller only |
| **Sentry** | Error tracking | Free tier | **REJECT** — egress + iframe-sandbox fit fails; the ledger is the substitute |
| **SBOM / commitlint / semantic-release / OTEL export / status page** | — | varies | **SKIP** for MVP |

---

## 8. The sequenced PHASE-1 roadmap (no code this session — this is the plan)

**Phase 0 — prerequisite plumbing (the literal missing layer):**
- Add root `package.json` scripts (cross-platform Node helpers, logic in npm scripts so **local == CI**):
  - `test` — globs `prototype/test_*.{js,mjs}`, **excludes `test_prototype.js`** (+ any `*_live`), runs
    each via `child_process` `node <file>`, fails if any suite fails. (12 suites.)
  - `check` — **loops `node --check --input-type=module` (STDIN) once per `src/*.js` file**: once-per-file
    (a glob checks only the first) AND ESM-goal (a `.js` under the CJS-default root swallows ESM errors). Fails on any non-zero.
  - `build:ui` — `npm --prefix static/hello-world ci && npm --prefix static/hello-world run build`.
  - `audit` — `npm audit --omit=dev --audit-level=high` (ADVISORY — §5.2; one unremediable `@forge/api`→undici HIGH, runs non-blocking in CI).
  - `ci` — chain `check → test → build:ui` (the blocking merge gate; audit runs as a separate advisory CI step).
- Leave root with **no** `"type"`; leave `prototype/package.json` `"type":"module"`. (Optional: rename
  live harnesses to `*_live.*`.)

**Phase 1 — the CI spine (gates-only, zero secrets):**
- One `.github/workflows/ci.yml` on PR + push to `main` **and `release/*`**:
  `actions/setup-node@<sha|v6>` `with: node-version: 24` (+ cache) → `npm ci` (root + static) →
  `npm run ci` → **manifest-scope-diff guard**. (No `forge lint`, no token — §3.4.)
- Add a one-line `node --version` (v24) assertion.
- **Extract the pure 207/HTTP-status→result mapping** into exported helpers + an offline unit suite
  (200/204/207-known/207-unknown/403) → wired into the runner. (The cheap slice of the #1 gap; §5.1.)
- One **branch-protection rule** on `main`: CI status check must pass to merge (owner-bypassable, §6.4).
- Add a **Dependabot manifest** (security-only, weekly, grouped, no auto-merge; respect the
  `@forge/resolver` 1.7.1 pin; both ecosystems — root + static/hello-world).
- **No `FORGE_API_TOKEN` in CI yet** — deploy stays the existing manual local step.

**Phase 1 — monitoring (free, no/low code):**
- Turn on dev-console invocation metrics as the standing dashboard + the post-deploy smoke check
  (filter prod, per-function; watch the planner functions ramp as customers re-consent v6.1.0).
- Create 2–3 **Alert rules** (success-rate Major, error-spike Critical) → email
  `support@`/`security@spec2jira.com`; **observe-mode first**, vendor-fault-scoped thresholds.
  Manually watch the 5xx/overloaded error-type for an Anthropic-outage spike (§4.3).
- Write **one ≤5-min incident runbook** in the repo, keyed to the alert rules **and** the
  deploy-recovery / fix-forward play (§6.5).
- **Native KVS heartbeat** for the orphan-sweep (persist `last_swept_at` + counts; surface on the
  existing admin diagnostics/health view) — the one small code change in phase-1, §13-gated.

**Phase 2 — deploy automation + richer signals (when the gates are trusted):**
- Manual-approval **`production` GitHub Environment** job: `forge deploy -e production` + `forge lint`,
  Environment-scoped token, MFA + rotation. Add a **staging** Forge environment as the
  `install --upgrade --confirm-scopes` rehearsal.
- **version-drift-guard** (`tools/version-drift-guard.mjs`, wired into `npm run check` → BLOCKING in CI) — asserts
  `package.json` version === `src/diagnostics.js` `DIAG_APP_VERSION`; **fails the merge on drift** (the §11 backstop;
  kills the 67a6ea1 class). ⭐ Replaced **release-please** after a **5/5 persona vote** (release-please's two reasons —
  commit-driven semver + a published changelog — are BOTH absent here; the assert is strictly stronger at the actual
  goal, ~5% of the surface, zero new deps/secrets). NOT an auto-sync — the partner consciously bumps both at release.
  Changelog DROPPED (no in-repo consumer; portal notes cover it). `static/hello-world/package.json` (CRA bundle)
  intentionally NOT synced. ⚠ The repo version ≠ the forge-assigned Marketplace version — see the CLAUDE.md
  production-rollout note (a green check proves two-string lockstep, NOT a match to the live Marketplace number).
- ~~`@forge/metrics` counters~~ — ❌ **SKIPPED** (Phase-2 #2, 5/5 persona vote): NOT alert-sourceable
  (web-verified — alert rules source only the 4 built-in metrics) + redundant with the ledger aggregate +
  noisier (a pre-1.0 dep). The cross-install Anthropic-outage + 207-partial rollup is deferred to the
  **App-Logs poller** (Phase 3); per-install both are already classified in the diagnostics ledger.
- Marketplace Reporting API script (installs / conversion / churn) with bot-account token hygiene (§4.1).
  **→ DESIGN FINAL 2026-06-23 (§13 + live probe §13.5): a "minimal DIRECT poller" — all 4 metrics are DIRECT
  from `https://api.atlassian.com/marketplace/rest/3/reporting/developer-space/{developerId}/...` (Basic auth
  confirmed; developerId via `/developer-space/vendor/{vendorId}`); NO snapshot store needed.
  **IMPLEMENTED + §13-gated SHIP (§13.6): `tools/marketplace-report.mjs` + offline test; pending partner creds-wiring + live validation + commit.**

**Phase 3 — deferred / earn-it-first:**
- The **full `@forge/kvs`+`@forge/api` mock harness** for resolver/session-orchestration integration
  tests (the 207 *decision* logic is already covered in phase-1; this is the IO-wiring half).
- Vendor-side App-Logs-API poller (+ optional vendor-side healthchecks ping).
- CodeQL (only if repo goes public); status page (only if install volume earns it).

**Skip list (deliberate, sourced):** SBOM, commitlint, semantic-release, OTEL-export-to-SaaS,
on-call/PagerDuty, coverage-% gate, browser E2E in CI, **any external ping from the app**.

---

## 9. Open decisions for the partner (CONFIRMED 2026-06-22)

1. **CI deploys in phase-1?** → **No** (gates-only, no token); deploy = phase-2. ✅ confirmed
2. **Repo public or private?** → Private for now; public would unlock free CodeQL + unlimited Actions —
   a deliberate later call. ✅ confirmed
3. **Staging Forge environment?** → Phase-2 (only env where `install --upgrade` rehearses scope-consent).
   ✅ confirmed
4. **Sweep confirmation: KVS heartbeat or custom `@forge/metrics`?** → **Heartbeat ONLY** (zero new dep;
   `@forge/metrics` **SKIPPED** in Phase-2 #2 per a 5/5 vote: not alert-sourceable, redundant with the
   ledger aggregate, noisier). ✅ decided & implemented (commit `cf62707`)
5. **Email-only alerting?** → Yes — to `support@`/`security@spec2jira.com` (paid domain). Forward
   email→Slack via a free inbox rule if wanted. ✅ confirmed

---

## 10. To verify live before relying (POLICY §9)

- Does `forge lint` truly require auth in CI? (The §3.4 resolution — defer it to phase-2 — holds either
  way, but confirm before any future attempt to run it token-free.)
- Do `forge logs` / the App-Logs-API reliably capture **scheduledTrigger** (system-invocation) logs the
  same as resolver logs? (Confirm `[sweep]` lines appear before relying on log-scrape.)
- ~~Can a `@forge/metrics` counter source an Alert rule?~~ **ANSWERED: NO** (web-verified 2026-06-22 — Forge
  alert rules source ONLY the 4 built-in invocation/API metrics). → `@forge/metrics` SKIPPED (Phase-2 #2);
  custom-metric alerting is not possible, so no flat-line/absence alert on a `sweep_runs`-style counter.
- ~~Does `@forge/metrics` install clean vs the pinned set…~~ moot — SKIPPED (no compat-verify needed; not adopting).
- Confirm the CRA build succeeds in a clean CI checkout with only `npm ci` (no build-time env vars).
- Forge log retention is reported inconsistently (30 vs 60 days; API export window firmly 14 days) —
  confirm the authoritative number.

---

## 11. Key sources (web-verified by the research + audit agents)

- Atlassian — Set up CI/CD for Forge: https://developer.atlassian.com/platform/forge/set-up-cicd/
- Atlassian — Environments & versions: https://developer.atlassian.com/platform/forge/environments-and-versions/
- Atlassian — App versions (major/minor, re-consent, no rollback): https://developer.atlassian.com/platform/forge/versions/
- Atlassian — Versioning Connect vs Forge (≤120h minor rollout): https://developer.atlassian.com/platform/adopting-forge-from-connect/versioning-in-connect-vs-forge/
- Atlassian — Staging & production apps: https://developer.atlassian.com/platform/forge/staging-and-production-apps/
- Atlassian — Invocation metrics / Alert rules / Custom metrics: https://developer.atlassian.com/platform/forge/monitor-invocation-metrics/ · /create-alert-rules/ · /monitor-custom-metrics/
- Atlassian — Export app logs/metrics (OTLP, bot-account guidance): https://developer.atlassian.com/platform/forge/export-app-logs/
- Atlassian — Marketplace Reporting API v2: https://developer.atlassian.com/platform/marketplace/rest/v2/api-group-reporting/
- Atlassian — Feature-flag percentage rollouts: https://developer.atlassian.com/platform/forge/feature-flags/how-to-percentage-rollouts/
- Atlassian community — forge lint/deploy needs FORGE_API_TOKEN: community.developer.atlassian.com/t/.../79694 · /46786
- GitHub — `actions/setup-node` (Node via `node-version` input; SHA-pin); Actions billing; Dependabot fork-PR secret isolation.
- Google SRE — golden signals: https://sre.google/sre-book/monitoring-distributed-systems/

---

## 12. Audit trail (deep audit, 2026-06-22) — 13 findings, all folded into v2

6 fresh-eyes lenses (forge-accuracy / repo-feasibility / security-blast-radius / completeness-critic /
solo-pragmatism / internal-consistency); the conductor verified the objective findings directly against
the live repo + Node 24.16.0 (the agent verify-pass was lost to a transient burst rate-limit). **0
critical, 2 high, ~5 medium, ~6 low; 0 false-positives.**

| Finding | Sev | Resolution in v2 |
|---|---|---|
| `forge lint` needs a token → breaks zero-secret phase-1 | HIGH | §3.4: removed from phase-1 gates → phase-2 + local |
| No rollback / incident-recovery play | HIGH | §6.5 added (fix-forward, minor/major asymmetry, kill-switch flag) |
| `node --check src/*.js` checks only the first file | MED | §2/§5.2/§8: per-file loop mandated |
| No hotfix path + admin-bypass unacknowledged | MED | §6.4 added |
| Anthropic-outage lumped into "not our fault" | MED | §4.3: carved out as a distinct watched observable |
| Whole 207/resolver test gap deferred to phase-3 | MED | §5.1/§8: pure 207-mapping slice pulled into phase-1 |
| Dependabot fork-PR secret collision | MED | §6.6 (7) note added |
| ≤120h rollout is minor-only / "within minutes" overstated | LOW | §0/§3.1 qualified |
| `actions/setup-node@24` invalid ref | LOW | §3.2(b)/§8: `node-version: 24` input + SHA/vN pin |
| "12 offline suites" → 11 | LOW | corrected throughout |
| ESM-anchor rationale mechanically wrong | LOW | §2/§5.3: corrected to Node-24 auto-detection |
| Reporting/Logs API token hygiene missing | LOW | §4.1 token-hygiene note added |
| Dependabot/npm audit absent from §8 roadmap | LOW | added to §8 phase-1 |

**Re-audit (v2.1, 2026-06-22):** a focused 3-lens re-audit of the v2 revisions returned fix-verification
CLEAN + accuracy CLEAN + 2 LOW consistency findings (both stale-prose locators), now fixed: §4.3 cited
the frontend `_classifyBackendError` instead of the backend error-code locators (`src/anthropic_client.js`
+ `classifyDiagGenerationError`); and the Dependabot prescription named `@forge/events` (not a current
dependency — removed). No direction change. The strategy is ACCEPTED; implementation (Phase 0 + Phase 1)
proceeds.

**§13 implementation gate (Phase 0+1, 2026-06-22):** the 3-lens gate (code-review · audit-review · 207
behavior-preservation) returned **behavior-preservation SHIP** (the 207-status extraction is byte-identical
to the prior inline logic) + 6 findings (2 HIGH, 2 LOW, 2 NIT), ALL addressed: (1) HIGH — the `npm audit`
BLOCK gate would red-wall every CI run on an unremediable `@forge/api`→undici HIGH (masked locally by an
older npm 9.6.4 that exits 0; Node-24 npm 11.x exits 1) → audit is now ADVISORY (continue-on-error); (2)
HIGH — `npm ci` hard-failed on a pre-existing CORRUPT static lockfile entry (`typescript@6.0.3`, which
doesn't exist on npm) → reconciled to `4.9.5`; the real `npm run build:ui` (`npm ci`+build) now passes
(the §10 clean-checkout proof — earlier masked by `npm run build` reusing drifted node_modules); (3) LOW —
`scope-diff-guard` now ignores comment-only lines (no false MAJOR warning on a comment edit); (4) LOW — the
Phase-1 incident runbook was created (`docs/INCIDENT-RUNBOOK.md`); (5) NIT — offline-suite count corrected
(12 run; 13 `test_*` files, the live `test_prototype.js` excluded); (6) NIT — CI actions SHA-pin left a
documented TODO (Dependabot github-actions surfaces bumps). **LESSON (environment-masked CI):** verify CI
gates under the CI toolchain (Node-24 npm 11.x; real `npm ci`, not `npm run build` on drifted node_modules)
— the conductor's local green was a false pass on a mismatched npm + a drift-tolerant build path.

**Post-ship ARMY deep review (Phase 0+1, 2026-06-22):** a 7-lens fresh-eyes review + waved adversarial verify
(partner-requested AFTER the per-change gate) found **1 HIGH + ~9 LOW/nit, all confirmed; 0 critical** — the
207-refactor + security lenses were clean. ALL addressed: **HIGH — `check-syntax.mjs` was a FALSE-GREEN wall**
(`node --check <file.js>` under the CJS-default root silently swallowed ESM syntax errors → the gate never
caught a real error; reproduced) → fixed to `node --check --input-type=module` via STDIN (verified: a real
ESM error now fails the gate). LOW cluster, all fixed: (a) **heartbeat-UI honesty** — an errored-but-recent or
all-degraded sweep rendered a GREEN "healthy" icon → now amber on stale OR ok===false OR degraded>0; (b)
**scope-guard hardening** — strips INLINE comments (not just full-line), resolves manifest path
cwd-independently + fail-open, header notes the base.sha-staleness limitation; (c) **runner robustness** —
120s per-suite spawnSync timeout + signal report, case-insensitive `_live` exclude; (d) **ci.yml** — job
`timeout-minutes: 15` + a BLOCKING critical-only audit step (highs stay advisory, a future critical can't
ship). DEFERRED (sound, low-value): scope-guard set-normalization for reorder (would flatten the egress-vs-scopes
distinction — poor trade). KNOWN: **local npm 9.6.4 ≠ CI npm 11** (Node-24 bundled) — the audit exit-code +
strict `npm ci` only bite on npm≥10, so local pre-checks under 9.6.4 understate CI; match the local npm to
Node 24 to pre-see CI behavior. **LESSON: the flagship gate I wrote (check-syntax) was itself the false-green —
a per-change gate validates a tool's stated mechanic (glob-vs-single-file), an army re-tests whether the tool
actually WORKS on the real input (ESM goal). Re-verified after fixes: `npm run check` now CATCHES a real ESM
error; `npm test` 12/12; `npm run build:ui` green.**

---

## 13. Phase-2 #3 — Marketplace Reporting API script: Analyze→Design decision (2026-06-23)

> Conducted via §13: a **14-agent Analyze→Design army** (4 web-verified research lenses → 3-angle
> design panel → 4-judge confidence vote → 3-lens adversarial pre-mortem; ALL read-only `Explore`,
> per the review-army-isolation lesson). Conductor synthesis below. **DESIGN ONLY — no code; the
> implementation is GATED on a partner live-probe (§13.3).**

### 13.1 The decision — P2 "concise poller" synthesis

A **vendor-side, zero-dependency Node `.mjs` script under `tools/`** (idiomatic to `version-drift-guard.mjs`:
ESM, pure exported helpers, conditional `main()`), run **vendor-side ONLY** (Windows Task Scheduler / cron —
NEVER in CI, NEVER Forge-callable), that pulls the 4 business-health metrics (installs/active-installs ·
active users by edition · eval→paid conversion · churn) over **HTTP Basic auth**, persists timestamped
snapshots to a **gitignored `tools/data/`** (JSON Lines), and computes time-series deltas. Credentials =
a **dedicated non-admin/bot Atlassian account + API token**, stored OUTSIDE the repo, MFA, rotation.

Vote spread (4 judges × 3 proposals): P1 "Script" **7.53** · **P2 "Poller" 7.95** (tightest spread 7.8–8.1,
unanimous *low* over-built) · P3 "Metrics-Poller MVP" **7.03** (widest spread 5.9–8.5 — the over-built
smell-signal per [[deep-audit-vs-per-change-gate]]). All three converged on the SAME shape; the only real
differentiator was P3's `report`/multi-mode CLI, which all judges flagged as Phase-3 scope creep (§3.5).
**Winner = P2's architecture + grafts:** P1's concrete Windows-credential playbook + honest "whatItSkips"
gaps list + delta-math pseudocode; **DEFER the report/multi-mode CLI to Phase-3.**

### 13.2 Auth verification (partner-requested, web-verified 2026-06-23)

- ✅ **HTTP Basic auth (Atlassian account email + API token) is the CORRECT, CURRENT, non-deprecated
  method** for the Marketplace REST API — confirmed in the v2 AND v3/v4 intros ("The Marketplace API uses
  HTTP basic authentication. The username is your Atlassian Account email and the password is a generated
  API token."). Nothing "more serious" (OAuth 2.0/3LO) is offered or required for the **vendor reporting
  API** — 3LO is for user-facing app authorization, not vendor-side server scripts. The "stop using Basic
  auth" advice circulating online targets (a) Basic auth with **passwords** (deprecated 2019) and (b)
  Jira/Confluence **data** APIs where OAuth/scoped tokens are preferred — NOT the vendor Marketplace API.
- ⚠ **NEW fact the research army got WRONG:** Atlassian API tokens NO LONGER live forever. Since
  **2024-12-15** new tokens carry a **mandatory expiry, default + max 1 year**; pre-2024-12-15 tokens were
  force-expired Mar–May 2026. → the design's "tokens never auto-expire; 90-day rotation is pure discipline"
  is **superseded**: rotation is now partly FORCED (≤1 yr) and the script MUST handle **401 token-expired
  LOUDLY** (it WILL hit it).
- 🔎 **Scoped API tokens** are now Atlassian's recommended, more-secure token type. **Probe-time open
  question:** does the Marketplace API accept a *scoped* token (and which scope), or does it need a
  *classic/unscoped* token? Verify before relying on a scoped token.
- ⚠ **API-version drift:** the army mapped endpoints on **v2** (`marketplace.atlassian.com/rest/2`), but the
  live intro now states **"Version 3 is the latest"** (base `…/rest/3`), with v4 doc paths in transition.
  → the probe MUST confirm the current version + base URL + exact reporting endpoint paths; the v2 paths
  are likely stale.

### 13.3 ⭐ The probe-first gate (resolve BEFORE implementing — POLICY §9 live-is-authority + §3.5 simplicity)

Two research lenses **CONTRADICT** on the load-bearing question — are conversion + churn **DIRECT**
(ready-made from `/sales/metrics/*` + `/customer-insights/editions`) or must they be **DERIVED** from local
snapshots + delta math? Both were MEDIUM confidence (no example payloads in the docs). This is THE design fork:
- **Direct** → the snapshot-store + delta machinery (and its whole silent-miss class) is UNNECESSARY →
  collapse toward the minimal design.
- **Derived** → P2's snapshot+delta design is required.

A **~1-hour live API probe with the vendor's real credentials** (partner-only — Claude has no creds and must
not) settles: (1) current version + base URL + reporting endpoint paths; (2) exact response field names;
(3) whether conversion/churn/edition come ready-made or need derivation; (4) whether a scoped token works;
(5) pagination/rate-limit behavior. **Implementation is gated on this result.**

### 13.4 Hard gate criteria for the eventual implementation (from the adversarial pre-mortem — silent-miss is the worst failure, POLICY §8/§11)

1. **Fail-LOUD on missing/renamed fields** — never silently default a metric to 0 (the #1 silent miss:
   a schema change → plausible-but-garbage numbers).
2. **Window-aware deltas** — store the prior snapshot's timestamp; compute the ACTUAL elapsed window;
   annotate/flag if the gap ≠ expected cadence (a missed run silently rates the wrong window).
3. **Idempotent same-day runs** — delta always vs the most-recent DISTINCT snapshot (a double-run must
   not double/zero the delta).
4. **Net-change honesty** — naive `prev.active − curr.active` conflates new installs with churn; either
   per-install state diffing or label it "net change", not "churn rate".
5. **Credential source fails LOUD, never silently downgrades** (e.g. Cred-Manager-missing → silent
   plaintext `.env.local` fallback the vendor doesn't notice).
6. **401 token-expired handled explicitly** (mandatory ≤1-yr expiry, §13.2) + `.gitignore` the data dir
   AND the credential file.

**Status: superseded by §13.5 below — the probe is DONE; the design is FINAL.**

### 13.5 ⭐ Probe RESULTS — live-confirmed surface + FINAL design (2026-06-23, partner-run throwaway token)

The live probe settled everything and CORRECTED the army's v2-based research (the whole §13.1 endpoint
map was v2 and is being sunset). The decisive facts:

**The ONLY correct combination (live-confirmed 200s):**
- **Base host = `https://api.atlassian.com/marketplace/rest/3`** — NOT `marketplace.atlassian.com/rest/3`
  (that host 404s/403s these). The earlier `marketplace.atlassian.com/rest/2/vendors` **410** was only the
  deprecated v2 *collection* for token apps; the portal's own v2 calls go through a session+gateway, not us.
- **Auth = HTTP Basic (email + API token) — CONFIRMED WORKING (200), existing token, NO scope change.** The
  string of `403 poco` rejections were purely wrong-host / wrong-path-order / numeric-vs-UUID id — NOT a
  token-scope problem. (Doc also states "Forge and OAuth2 apps cannot access this REST resource" → Basic is
  the only method. The partner's auth question is definitively closed.)
- **developerId resolution:** `GET /developer-space/vendor/{vendorId}` → `{ "developerId": "<UUID>" }`. The
  numeric **vendorId (820262725) ≠ the UUID developerId** — that mismatch caused every earlier 400/403.
- **Reporting (path order A, this host):** `GET /reporting/developer-space/{developerId}/{report}` → **200** on:
  `licenses` (+ `/licenses/export?accept=csv|json`) · `sales/transactions` (+ export; full dated New/Renewal/
  Upgrade/Refund history) · `sales/metrics/churn?aggregation=week&startDate&endDate` (**pre-computed churn
  time-series**, `total.datasets`) · `sales/metrics/conversion` (**pre-computed conversion time-series**,
  `total.series`) · `customer-insights/editions` (**active users by edition**, `usersDistributionPerMonth`) ·
  `customer-insights/active-users`. (`evaluations` 404 at that exact path — the trial count is under a
  different sub-path, e.g. `evaluations/hosting` per the portal; minor, resolve at implementation.)
  Path order B (`/developer-space/{id}/reporting/...`) → 403; `marketplace.atlassian.com` host → 404/403.
  **Order A on api.atlassian.com is definitive.** (Arrays/datasets are currently EMPTY — new app, no paid
  data yet; the endpoints themselves all work.)

**⭐ direct-vs-derived = RESOLVED: ALL FOUR core metrics (+ transactions + active-users; 6 endpoints) are DIRECT.** churn + conversion are pre-computed
time-series; editions/active-users from `customer-insights`; installs from `licenses`; transactions = full
dated history. → **the local snapshot store + delta math (P2's central machinery, §13.1) is UNNECESSARY.**

**FINAL DESIGN = "minimal direct poller" (SUPERSEDES the P2 snapshot+delta synthesis of §13.1):**
a zero-dep Node `.mjs` in `tools/` that (1) reads creds from outside the repo; (2) resolves developerId via
`/developer-space/vendor/{vendorId}` (cache it); (3) GETs the dedicated metric/report endpoints above;
(4) formats a human-readable summary (or `--json`). [Built: stdout only — there is NO file/CSV export in
this version; the `tools/data/` gitignore entry is forward-prep, currently unused. See §13.7.]
**No snapshot store, no delta math** → this deletes the snapshot/delta silent-miss class §13.4 worried about
(window / idempotency / net-change / schema-default-zero). [Residual flagged by the deep audit (§13.7): the
time-series ORDER is an unverified assumption — handled by honest labelling ("last in API order"), not a
chronological-latest claim.] This is the §3.5 simplicity win the probe-first
gate (§13.3) existed to surface — confirmed by live data, not assumed. The §13 army's value held: it picked
the right SHAPE (vendor-side zero-dep tools/ poller, Basic auth, bot-account hygiene) and flagged the
direct-vs-derived fork; the probe then collapsed it to the simpler branch.

**Surviving gate criteria for implementation (the rest of §13.4 are MOOT — no derivation):**
1. Fail-LOUD on a missing/renamed top-level field — never silent-zero a metric.
2. Handle **401 token-expired** explicitly (mandatory ≤1-yr token expiry, §13.2) + `.gitignore` the creds.
3. **Empty-data honesty:** arrays/datasets are currently empty (new app) — render "0 / no data yet"
   honestly; don't crash or imply failure.
4. Resolve the exact `evaluations` sub-path at implementation (minor).

**Status: design FINAL (minimal direct poller); surface live-confirmed.**

### 13.6 IMPLEMENTED + §13-gated (2026-06-23)

Built the minimal direct poller. Files:
- **`tools/marketplace-report.mjs`** — zero-dep Node 24 ESM, idiomatic to `version-drift-guard.mjs` (shebang,
  dense header, exported pure helpers `summarize`/`latest`, `main()` only on direct invoke). Creds from
  env (`MKT_EMAIL`/`MKT_TOKEN`/`MKT_VENDOR`) or a gitignored `tools/.marketplace-creds.local.json`; Basic
  auth; resolves developerId via `/developer-space/vendor/{vendorId}`; GETs the 6 confirmed report endpoints;
  prints a human summary (or `--json`). Fails LOUD on 401-expired / 403 / non-200 / non-JSON / missing
  top-level key (never silent-zeros); renders empty data as "no data yet". No snapshot store, no deltas.
- **`prototype/test_marketplace_report.mjs`** — 21 offline assertions over the pure helpers (empty-data
  honesty, populated counts, page-1 pagination symmetry, "last in API order" labelling, partial-payload
  no-throw); picked up by the runner (offline suites 13→14).
- **`.gitignore`** — explicit patterns for the creds file + `tools/data/` (the global `*.local` does NOT
  match `*.local.json`).

**§13 gate = SHIP** (2 read-only `Explore` lenses: code-review + audit-review). Both clean — 0 HIGH/MED,
only NITs; design-faithful, GENERAL (not a patch). Gate criteria 1-3 + 5 met; **criterion 4 (evaluations
sub-path) is consciously DEFERRED, not "met"** — corrected in §13.7 (the per-change gate's "all 5 met"
phrasing was inaccurate). One NIT tightened (a 0-count-with-next-link could print a contradictory
"0+ … no data yet" — `morePages` gated on `count>0`). Verified: `npm test` green.

**PENDING (partner):** wire creds (bot account + API token, gitignored file or env), run live to validate
against the real surface (arrays will be empty until paid data exists — see the runbook), commit + push (the
5 files: the script + test + `.gitignore` + `docs/MARKETPLACE-REPORTING-SETUP.md` + this strategy doc),
optionally schedule via Windows Task Scheduler. Then revoke the throwaway probe token + delete the
out-of-repo probe.

### 13.7 Deep adversarial audit (2026-06-23) — partner-requested, post-SHIP

A **32-agent deep audit** (5 diverse read-only `Explore` lenses — correctness / security / audit-policy+
metric-semantics / completeness / doc-accuracy → a per-finding skeptic verify, default-refuted) ran AFTER
the per-change §13 gate said SHIP. **27 findings → 22 confirmed/partial, 5 refuted; 0 HIGH, 0 real MED code
defect.** The value (per the [deep-audit-vs-per-change-gate] discipline) was catching what the per-change
gate is structurally blind to — including **its own over-claims**:

- ⭐ **The headline:** the per-change gate said "all 5 gate criteria met" — but that statement was itself
  inaccurate (criterion 4, the evaluations sub-path, was DEFERRED not met), AND the design (§13.5) had
  claimed the minimal poller "deletes the whole silent-miss class" while a **time-series ORDERING assumption
  was unverified** (the probe arrays were empty, so `latest()` returning the last element was never exercised
  — if the API is descending, it would show the OLDEST point as "latest"). Both are the write-time-optimism /
  unverified-assumption class a per-delta gate cannot see. **Fixed:** the output now labels the shown point
  "last in API order" (not "latest") + carries an ordering caveat + a live-validation note + a contract test;
  the docs/gate-claims are corrected (this section).

**Fixes applied (verdict-taker, all verified — `npm test` green, this suite 21 assertions):**
1. Ordering honesty (`tsLine` "last in API order" + caveat note + `latest()` contract test). 
2. `res.text()` moved inside the `try` (a stream-read error now fails loud like everything else).
3. Pagination honesty + symmetry — licenses AND transactions both labelled "page 1" and both flag "more
   pages" (transactions previously didn't); full count via `--json`/export.
4. Doc corrections — "all 5 criteria met" → 4 met + evaluations deferred; "ALL FOUR DIRECT" → 4 core + 2;
   the promised-but-unbuilt CSV/file export clarified as stdout-only (`tools/data/` is forward-prep).
5. Setup runbook written (`docs/MARKETPLACE-REPORTING-SETUP.md`) — the operational-completeness gap.
6. Cheap hardening — `.gitignore` broadened to typo-proof creds patterns (`git check-ignore`-verified on 4
   variants incl. the no-leading-dot typo), numeric-`vendorId` early check, Node-24+ runtime guard.
7. `installs` relabelled "license records" (paid+eval entitlements, page 1) — honest about the metric.

**Refuted (5, the skeptic kept the army honest):** scope-creep 4-vs-6 endpoints (intentional, design-
authorized), Promise.all "crash" (fail()/process.exit fires before any rejection — by design), date-window-
not-stated (dropped from the surviving gate criteria when the design went minimal-direct; a default-window
note was still added), active-vs-total-installs ambiguity (the labels are explicit + separate lines), and a
query-param doc "inconsistency" (a misread of a narrative annotation). **Verdict: SHIP (hardened).**

---

## 14. Phase-2 #4 — production-deploy automation: Analyze→Design decision (2026-06-23)

> §13 army: 14 agents (4 web-verified research lenses → 3 design angles → 4-judge confidence vote → 3-lens
> adversarial pre-mortem; all read-only `Explore`). **DESIGN ONLY — no token, no GitHub Environment, no
> deploy created this run.** Implementation is a SEPARATE step (own §13 gate); the token + GitHub Environment
> + staging Forge env setup is **PARTNER-ONLY** (secrets / console UI / Atlassian account).

### 14.1 The decision — manual `workflow_dispatch` + Environment-gated deploy (all 3 designs CONVERGED)

All three design angles (manual-dispatch / version-tag / release-branch) independently recommended
**`workflow_dispatch` (a manual "Run workflow" button)** and rejected tag-push + release-branch as more
ceremony/coupling for a solo vendor (POLICY §3.5). Vote: all 3 write-ups scored 7.5–9.5 (converge on the
same shape); the tightest ~9.1 avg. The differences are presentation depth, not substance. **This is the
recommended design.**

### 14.2 The pipeline (synthesized)
- **Trigger:** `workflow_dispatch`. The partner consciously bumps `package.json` + `src/diagnostics.js`
  `DIAG_APP_VERSION` on a release commit, then clicks **Run workflow → Deploy to production**. The click IS
  the human release decision (decoupled from git history; no tag/branch ritual).
- **Approval gate:** a **`production` GitHub Environment** with a required-reviewers protection rule. The
  deploy job declares `environment: production`, so GitHub blocks it until approval. ⚠ Solo = **self-approval**
  (a deliberate PAUSE, not a true second pair of eyes — honest limitation, §14.4).
- **Token isolation (THE load-bearing decision):** `FORGE_API_TOKEN` lives **ONLY in that Environment's
  secret**, never a repo secret. Only the job targeting `environment: production` can read it. A **NEW
  `.github/workflows/deploy.yml`** (token-bearing, manual) stays **separate from the zero-secret `ci.yml`**
  (PR gates). Trigger is `pull_request` semantics — **never `pull_request_target`** (fork-exfil hole).
- **Deploy job sequence:** `npm ci` → `npm run ci` (= version-drift + per-file ESM + offline tests +
  CRA build:ui) → **`forge lint`** (now legitimately holds the token, §3.4) → `forge deploy -e production`
  (**PUBLISHES the version — MINOR/no-scope goes LIVE + auto-rolls to all customers ≤120h; MAJOR/scope gates
  on per-admin re-consent. THE DEPLOY IS THE RELEASE — no separate manual publish; live-confirmed §14.7**).
  ⭐ **Scope check at deploy-time is a CONSCIOUS
  manual `scope_ack` input, NOT a re-run of `scope-diff-guard.mjs`** (corrected at the §13 gate, §14.5): a
  `workflow_dispatch` has no meaningful base SHA to diff, and the auto guard already ran at PR-time in
  `ci.yml` — forcing the human to type "rehearsed on staging" IS the §3.3 goal (make re-consent visible,
  never auto-decide it). Plus a version-bump guard (typed version must equal `package.json`) and a
  **pre-flight SHA-pin assertion** that FAILS the deploy while the actions are still `@v`-tags.
- **Staging rehearsal:** a Forge **`staging` environment** for the **procedural** scope dry-run
  (`forge install --upgrade --confirm-scopes`) whenever scope-diff-guard flags a change — BEFORE prod (the
  no-rollback asymmetry makes this load-bearing, not optional).
- **Token hygiene:** dedicated/bot Atlassian account + **MFA** + ≤90-day rotation (Atlassian enforces ≤1-yr
  expiry); revoke-on-leak runbook.
- **Recovery:** **fix-forward** (no rollback). MINOR auto-rolls ≤120h (de-facto canary); MAJOR/scope =
  per-admin re-consent (days). **Pre-place a kill-switch feature flag** for risky features (~60s to 0%).

### 14.3 Top risks → implementation MUST-HAVES (from the 3-lens pre-mortem; several HIGH converged)
1. **`pull_request` NOT `pull_request_target`** + token in the **Environment** secret only + `deploy.yml`
   separate from `ci.yml` (the #1 risk: token exfil via a fork PR / repo-secret blast radius).
2. **SHA-pin every third-party action in the deploy job** (a malicious/compromised action runs WITH the
   token). **ENFORCED (§14.5):** `deploy.yml` ships with a pre-flight assertion step that FAILS the deploy
   while `actions/checkout`/`actions/setup-node` are still `@v`-tags — so the token cannot run a deploy until
   the partner SHA-pins them (a hard gate, not just a checklist line).
3. **Never echo the token**; set least-privilege `permissions:` on the workflow/job.
4. **Staging-vs-prod naming guard** — avoid deploying to prod thinking it's staging (wrong-env-targeted).
5. **MFA on BOTH** the GitHub account AND the Atlassian token account (the approval gate is only as strong
   as the account that clicks it).
6. **scope-diff guard → procedural staging gate** before any scope-touching prod deploy (multi-day re-consent
   recovery otherwise).

### 14.4 Honest limitations (§10)
- **Solo self-approval ≠ a second reviewer** — the real protection is the Environment token-isolation + the
  deliberate manual pause + local `npm run ci` green, NOT a second human.
- **Staging rehearsal + token rotation are procedural discipline**, not automated gates (Forge offers no
  scope-consent automation; rotation is a calendar reminder).
- **No rollback** — fix-forward only; a scope-touching bug is a days-long recovery.

**Status: DESIGN FINAL + IMPLEMENTED + §13-gated (§14.5). `.github/workflows/deploy.yml` + `docs/PROD-DEPLOY-SETUP.md`
written, INERT until the partner-only setup (FORGE_API_TOKEN on a bot account, the `production` GitHub
Environment, the `staging` Forge env, SHA-pinning the actions) — the workflow self-enforces SHA-pinning and
runs only on a manual click. No token/secret created this arc.**

### 14.5 §13 gate (2026-06-23)

`deploy.yml` + `PROD-DEPLOY-SETUP.md` built, then a 3-lens read-only `Explore` gate: **correctness = SHIP**
(⭐ verified the Forge CLI flags `--non-interactive` / `--no-verify` / `forge lint` are REAL via
`forge deploy --help`; `@forge/cli@12` valid), **security + audit = SHIP-WITH-FIXES**. Fixes applied
(verdict-taker):
- ⭐ **SHA-pin turned from a checklist item into a HARD gate** — a pre-flight assertion FAILS the deploy while
  the actions are `@v`-tags (the security lens's "make the checklist a code assertion"; closes the
  add-token-before-pinning race).
- **Post-deploy summary split** `if: success()` vs `if: failure()` (no more "deployed ✅" text on a failed run).
- **Documented the scope-diff swap** (manual `scope_ack` at deploy-time vs the PR-time auto guard — the audit's
  design-vs-impl honesty catch; §14.2 corrected).
- `@forge/cli@12` flagged to be matched to the partner's local CLI major; minor doc clarifications.
- **REFUTED (skeptic): the `::add-mask::` finding** — GitHub auto-redacts values sourced from `secrets.*` in
  all logs, so an explicit mask step would be redundant cargo-cult; added a clarifying comment instead.
**Verified:** `npm test` unaffected (14/14; deploy.yml is a workflow, not in the test glob). YAML is
visually + gate-reviewed (no local YAML parser; GitHub validates on push).

### 14.6 Deep adversarial audit (2026-06-23) — partner-requested, post-gate

A **57-agent deep audit** (5 read-only `Explore` lenses — security-threat-model / correctness-actions-semantics
/ audit-design-overclaims / completeness-operational / platform-reality-web → per-finding skeptic verify, some
running the grep/`forge --help` live) ran AFTER the §14.5 per-change gate. **52 findings → 47 confirmed/partial,
5 refuted; 0 real HIGH defect.** The HIGH-severity *confirmed* items were POSITIVE (trigger isolation,
Environment-secret scoping, no-injection — all verified correct). The audit's value (per
[deep-audit-vs-per-change-gate]) was auditing the CLAIMS — and it caught real over-claims, all fixed:

- ⭐ **"auto-publishes to every customer" was reframed to "auto-creates a STAGED version + manual publish"** —
  ⚠ **this correction was itself WRONG and was REVERTED at §14.7 (live test):** `forge deploy -e production`
  actually PUBLISHES (a MINOR/no-scope version goes LIVE + auto-rolls to all customers; the deploy IS the
  release — there is no manual-publish step). The ORIGINAL "auto-publishes" framing was right. Lesson: a deep
  audit can debate wording both ways; only the live deploy settled it (§9). Final wording is in §14.7.
- **MFA-on-GitHub was missing from the runbook** (must-have #5 = MFA on BOTH accounts; only Atlassian MFA was
  documented) → added to PROD-DEPLOY-SETUP §2 (the approval gate is only as strong as the approving account).
- **SHA-pin assertion over-claimed as protection** — it is FAIL-FAST POLICY ENFORCEMENT (fails before any token
  use); the REAL token protection is Environment-secret scoping (the token isn't injected into checkout/setup-node).
  Comments clarified. Also hardened the grep to `^[[:space:]]*uses:` so a `# uses:…@v` comment can't false-trigger.
- **"Free private repo may not enforce required reviewers"** → reframed: the §6 TEST is the authority (confirm a
  "Waiting for approval" prompt appears); if not enforced, the manual click is the only gate (token isolation +
  local `npm run ci` remain the real protection). The agents themselves DISAGREED on the exact plan-gating, so
  "verify by test" is the honest call.
- **@forge/cli@12 parity** → added a §6 checklist item (confirm `forge --version` major matches the pin).
- **forge-lint advisory + partial-deploy + scope-caught-at-deploy** → success-summary now notes the lint
  advisory; troubleshooting covers don't-re-trigger-on-partial-publish + revert-don't-deploy-on-unexpected-scope.
- **REFUTED again (skeptic, ×5): `::add-mask::`** — correctly redundant (GitHub auto-redacts `secrets.*`).
**Verdict: SHIP (hardened) — no code defect; the fixes were documentation-accuracy + completeness + one cheap
grep hardening. The implementation's security architecture (workflow_dispatch-only + Environment-scoped token +
no-injection) was verified correct by multiple independent lenses.**

### 14.7 §6 live test (2026-06-23, partner-executed go-live) — gate ENFORCES + one CI-only fix

The partner set up the `production` Environment (required reviewer = self; "Allow admins to bypass" UNCHECKED so
the pause is non-skippable; "Deployment branches" restricted to `main`; FORGE_API_TOKEN + FORGE_EMAIL as
Environment secrets; MFA on BOTH the GitHub + Atlassian accounts), merged to main, and ran the §6 test.
- ⭐ **The required-reviewer gate ENFORCES** — run #1 sat at "production · waiting for review" with ZERO steps
  executed until approval. This RESOLVES the open "does a free-private-repo enforce required reviewers?" question
  (§14.6) empirically: on this repo/plan it DOES. The whole pipeline then ran green through `forge lint`.
- ⭐ **The test caught a CI-ONLY failure no other check could:** `forge deploy --non-interactive` errored
  `--non-interactive requires an analytics setting. Use forge settings set usage-analytics <value>` — a FRESH
  CLI in CI has no usage-analytics preference and `--non-interactive` refuses to run until one is set (the
  partner's local CLI already had it, masking this). **Fix:** the Install-Forge-CLI step now runs
  `forge settings set usage-analytics false` (CLI telemetry off — privacy-consistent; CLI-only, not app data).
  This is "green CI ≠ proven app" + live-is-authority ([[deep-audit-vs-per-change-gate]] / §0) vindicated again:
  only a real CI run on a fresh CLI surfaced it. (The "Node-20-actions forced to Node-24" annotation is a
  harmless deprecation notice on v4.3.1/v4.4.0; Dependabot will bump them.)
- Everything else verified green LIVE: SHA-pin assertion ✅, version-bump guard (6.1.0) ✅, `npm run ci` ✅
  (check + offline tests + CRA build, ~19s), forge lint advisory ✅, the failure-summary path rendered correctly.

**⭐⭐ #4 FULLY LIVE-VALIDATED (2026-06-23).** After the usage-analytics fix, a FRESH `workflow_dispatch` run
(NOT a re-run — a re-run replays the OLD commit's workflow, so it kept failing; the fresh run picked up the fixed
`deploy.yml` from main) went **green end-to-end** and `forge deploy -e production` **published Marketplace
version 6.2.0, confirmed LIVE to customers** in the portal (partner: "да live за клиентите"; accepted — the
code is the live 6.1.0 line + the dev-validated Phase-0/1 observability; #3/#4 are repo-tooling, not bundled).
Two confirmed truths corrected the docs:
- ⭐ **`forge deploy -e production` PUBLISHES (goes live), it does NOT "stage" for a manual publish** — reverting
  the §14.6 over-correction; deploy.yml header + summary + PROD-DEPLOY-SETUP all now say "publishes / live".
  ⚠ Therefore the §6 "test" IS a real customer release — documented as such.
- 📌 **Marketplace version runs AHEAD of the repo version** (repo 6.1.0 → forge-assigned Marketplace 6.2.0). The
  in-app diagnostics will read the repo number (6.1.0) until bumped. **NEXT release: bump package.json +
  DIAG_APP_VERSION PAST the live Marketplace number (→ ≥6.3.0) before deploying** (the documented repo≠Marketplace
  gap the version-drift-guard cannot close). Noted in PROD-DEPLOY-SETUP §"Deploying" step 1.
- HARD-WON: **"Re-run jobs" replays the original run's commit/workflow — it does NOT pick up a pushed fix; use a
  fresh "Run workflow".** And `forge deploy --non-interactive` needs `forge settings set usage-analytics <v>` on
  a fresh CLI.

**Phase-2 #4 = DONE + LIVE. Phase-2 is COMPLETE (#1 done · #2 skipped · #3 live-validated · #4 live). Remaining:
Phase 3 (deferred — @forge mock harness, App-Logs poller, CodeQL-if-public) + closing the 3 Dependabot PRs.**
