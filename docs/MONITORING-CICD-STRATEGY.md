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
but are **NOT the vendor's fault** → scope the SLO/alerts to **vendor-fault classes only** (prefer
`@forge/metrics` counters incremented only on vendor-fault paths, mirroring the ledger's closed
error-class registry), and **start alerts in observe-mode for ~a week** before arming.

**But carve out the Anthropic-platform outage as its own observable** (the audit's catch). The app's
only egress dependency is `api.anthropic.com`; if it is down platform-wide, *every* call fails for
*every* customer — vendor-relevant (it drives support load and may need a known-issue note), and
distinct from a single customer's bad key. The backend already separates these classes by error code
(`src/anthropic_client.js`: `anthropic_<5xx>` vs `auth_rejected`/`insufficient_credits`/`rate_limited`;
mirrored in `classifyDiagGenerationError`, `src/diagnostics.js`) — note 5xx is the `anthropic_<status>`
family (status carried as data), not a standalone 'overloaded' class. So: a **cross-install spike in the
`anthropic_<5xx>` class** is a separate "dependency-down" signal — kept **out of** the auto-alert
vendor-fault threshold (to avoid fatigue) but **named and watched** (a manual check of the dev-console
error-type breakdown; the cross-install rollup is deferred to the App-Logs poller — NOT a custom-metric
alert, which Forge does not support). Don't let it get silently lumped into "not our problem".

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
4. **Sweep confirmation: KVS heartbeat or `@forge/metrics`?** → Heartbeat first (zero new dep);
   `@forge/metrics` in phase-2. ✅ confirmed
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
