# Production deploy — setup & go-live checklist

> Operational guide for `.github/workflows/deploy.yml` (Monitoring + CI/CD Phase-2 #4 — design in
> `MONITORING-CICD-STRATEGY.md` §14). This is the HIGHEST-blast-radius automation in the repo: a single
> `FORGE_API_TOKEN` is the vendor's full Atlassian credential. `forge deploy -e production` **PUBLISHES** the
> new version — for a MINOR / no-scope release it goes LIVE and auto-rolls to **every paying customer**
> (progressive, ≤120h); a scope-touching MAJOR instead waits on per-admin re-consent. **The deploy IS the
> release — there is no separate manual publish** (live-confirmed 2026-06-23: a deploy shipped v6.2.0 live). The
> workflow runs only on a manual click behind the approval gate — so that click is a real go-to-customers decision.

## ⚠ Go-live checklist (do ALL of these before the first real deploy)

### 1. Dedicated Atlassian account + API token (the blast radius)
- Use a **dedicated, low-use Atlassian account** that has Marketplace partner access (a bot account is ideal —
  isolates blast radius from your personal admin login). Enable **MFA (TOTP, not SMS)**; store recovery codes offline.
- Mint an **API token** at <https://id.atlassian.com/manage-profile/security/api-tokens> (tokens now expire
  ≤1 year — note the date; set a ~90-day rotation reminder). This token = the entire prod blast radius; treat it accordingly.

### 2. The `production` GitHub Environment (the approval gate + secret scope)
- Repo → **Settings → Environments → New environment** → name it exactly **`production`** (the job's `environment: production` must match).
- Add a **Required reviewers** protection rule (add yourself). ⚠ As a solo vendor this is **self-approval** — a
  deliberate PAUSE, not a second pair of eyes; the real protection is the token isolation + the manual click +
  the local-`npm run ci`-green discipline. (Optional: a wait-timer.)
- ⭐ **Enable MFA on the GitHub account too** (must-have #5 is MFA on BOTH the Atlassian token account AND the
  GitHub account). The approval gate is only as strong as the account that clicks "Approve" — a compromised
  GitHub login could approve a deploy.
- ⚠ **Required reviewers may NOT be enforced on a free private repo** (GitHub gates this feature by plan; it is
  plan/date-dependent). **The §6 test is the authority:** when you click Run, confirm GitHub shows a
  *"Waiting for approval"* prompt BEFORE any step runs. If it runs straight through (no approval prompt), your
  plan does NOT enforce it → the manual click is then your ONLY gate (lean on token isolation + local `npm run ci`),
  or make the repo public (also unlocks free CodeQL) for hard enforcement.

### 3. Environment secrets (scoped to the prod job ONLY — never repo secrets)
- In the `production` Environment → **Secrets** → add **both**:
  - `FORGE_API_TOKEN` = the token from §1
  - `FORGE_EMAIL` = the Atlassian account email from §1
- Because they are **Environment** secrets, only the `deploy` job (which declares `environment: production`) can
  read them. PR/fork/Dependabot jobs (and `ci.yml`) cannot — that is the load-bearing isolation.

### 4. Staging Forge environment (rehearse scope changes)
- Create a **`staging`** Forge environment (Forge CLI / developer console). It is the ONLY place you can rehearse
  a customer re-consent flow before production: `forge deploy -e staging` → `forge install --upgrade --confirm-scopes`
  on a test Jira/Confluence site → confirm the new scope works.
- **Rule:** if a release changes manifest scopes/egress (the PR-time `scope-diff-guard` flags it), rehearse on
  staging FIRST. The deploy dialog's "scope change?" input is your conscious acknowledgment of this.

### 5. ⚠ SHA-pin the two actions (ENFORCED — the deploy will not run until you do)
- In `deploy.yml`, replace `actions/checkout@v4` and `actions/setup-node@v4` with **full commit SHAs**
  (a malicious/compromised action tag would run WITH the prod token). Get the SHA from the action's GitHub
  releases, or let Dependabot (the `github-actions` ecosystem is already configured) raise the pin PRs and merge them.
- ⭐ **This is a HARD gate, not just a checklist line:** `deploy.yml` has an early "Assert deploy actions are
  SHA-pinned" step that **FAILS the deploy** while the actions are still `@v`-tags. So the prod token literally
  cannot run a deploy until you pin them — there is no add-token-before-pinning window.

### 6. Test before trusting it
- **Confirm the approval gate actually enforces:** Actions tab → "Deploy to production" → Run workflow → confirm
  GitHub shows *"Waiting for approval"* and NO step runs until you approve. If it runs straight through, your plan
  doesn't enforce required reviewers (see §2) — decide accordingly before trusting it.
- **Confirm `forge --version` major matches** the `@forge/cli@N` pinned in `deploy.yml` (parity with your local
  CLI; if it differs, update the pin in the workflow first).
- ⚠ **The §6 "test" is a REAL release** — once you approve, `forge deploy` PUBLISHES and (MINOR/no-scope)
  ships current `main` LIVE to customers. So only run it when you're OK shipping main's app code. Approve →
  the version-bump guard, SHA-pin assertion, `npm run ci`, `forge lint`, and `forge deploy` all run → a new
  PUBLIC Marketplace version goes live. Verify the token never appears in the logs.

## Deploying (the routine)
1. On a release commit, bump **both** `package.json` `version` AND `src/diagnostics.js` `DIAG_APP_VERSION` to the
   same number; merge to `main` (CI gates green). ⚠ **The forge-assigned Marketplace version runs AHEAD of the
   repo version** (a deploy on repo-6.1.0 created Marketplace **6.2.0**) — bump the repo PAST the current live
   Marketplace number (e.g. → 6.3.0) so the in-app diagnostics label isn't behind. Check the live number in the
   portal Versions tab first.
2. Actions tab → **Deploy to production** → **Run workflow**. Fill the inputs:
   - **version** — the number you just bumped to (the workflow FAILS if it ≠ `package.json`, catching a forgotten bump).
   - **scope change?** — "no scope change" for code-only; "yes — rehearsed on staging" only after §4.
   (The deploy step ALWAYS runs `forge deploy … --no-verify` now — see §Troubleshooting — so there is no lint toggle to set.)
3. Approve the `production` Environment prompt → the deploy runs and **PUBLISHES the version**. ⚠ For a
   MINOR / no-scope release this is **immediately LIVE** and auto-rolls to all customers (≤120h) — the deploy
   IS the release. (A scope-touching MAJOR instead waits on per-admin re-consent in Manage Apps.)
4. Watch the dev-console Invocation metrics (production) error rate as the version rolls out (the ≤120h
   staggered roll is the de-facto canary). No rollback — fix-forward as a higher version if needed.

## Recovery (no rollback exists)
- Forge has **no rollback** — fix forward. A code-only fix ships as a MINOR and auto-rolls to all sites within
  ≤120h (the de-facto canary). A scope-touching fix is a new MAJOR → per-admin re-consent → recovery can be days.
- For a risky feature, **pre-place a Forge feature flag** before deploying so you can dial it to 0% (~60s) without
  a redeploy — the closest thing to instant rollback. See `docs/INCIDENT-RUNBOOK.md`.

## Troubleshooting
- **`401` on `forge deploy`** → the token expired/was revoked → mint a new one (§1), update the Environment secret (§3).
- **`forge deploy` fails on `Invalid response body … Premature close` fetching `swagger.v3.json`** → SOLVED 2026-06-26:
  the deploy step now ALWAYS runs `--no-verify`, so `forge deploy` no longer runs the internal `forge lint` that fetched
  that flaky Atlassian swagger endpoint (the recurring transient failure). The bundle is still validated by `npm run ci`
  + server-side at deploy. If this ever recurs, confirm the deploy command still carries `--no-verify`.
- **`forge lint` (the separate ADVISORY step) shows the globalPage `resolver:` error** → known false-positive
  (gotcha #13); that step is `continue-on-error` and never blocks the deploy.
- **Version-bump guard fails** → your typed version ≠ `package.json`; bump both repo strings or type the right number.
- **Deploy to the wrong environment** → the workflow is hard-wired to `-e production`; staging is a manual local step (§4).
- **`forge deploy` failed but the version appears in the portal anyway** (transient/network) → do NOT blindly
  re-trigger (you'd create a duplicate version). Inspect the version in the portal; if it's broken/unpublished,
  fix-forward as a new version. (Fix-forward is the only recovery — there is no rollback.)
- **You see a `scope change` warning at deploy time you did NOT expect** (the PR-time scope-diff-guard should have
  caught it) → DO NOT deploy. Revert the PR, confirm the guard now catches it, re-submit. A missed scope change →
  forced MAJOR → days of per-admin re-consent.
