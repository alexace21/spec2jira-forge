# Production deploy — setup & go-live checklist

> Operational guide for `.github/workflows/deploy.yml` (Monitoring + CI/CD Phase-2 #4 — design in
> `MONITORING-CICD-STRATEGY.md` §14). This is the HIGHEST-blast-radius automation in the repo: a single
> `FORGE_API_TOKEN` is the vendor's full Atlassian credential. `forge deploy -e production` auto-CREATES a
> Marketplace version (staged); a separate **manual portal publish** makes it live to **every paying customer**
> (this app uses "control when published"). The workflow is committed but **inert until you complete the setup
> below** — it only runs on a manual click, and the token/Environment don't exist yet.

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
- Then with a **no-op / trivial change**: approve → the version-bump guard, SHA-pin assertion, `npm run ci`,
  `forge lint`, and `forge deploy` all run → the new Marketplace version is CREATED (staged) in the portal.
  Verify the token never appears in the logs.

## Deploying (the routine)
1. On a release commit, bump **both** `package.json` `version` AND `src/diagnostics.js` `DIAG_APP_VERSION` to the
   same number; merge to `main` (CI gates green).
2. Actions tab → **Deploy to production** → **Run workflow**. Fill the inputs:
   - **version** — the number you just bumped to (the workflow FAILS if it ≠ `package.json`, catching a forgotten bump).
   - **scope change?** — "no scope change" for code-only; "yes — rehearsed on staging" only after §4.
   - **no_verify** — leave `false`; set `true` ONLY if the globalPage resolver lint false-positive blocks the deploy (gotcha #13).
3. Approve the `production` Environment prompt → the deploy runs (it CREATES a staged Marketplace version).
4. **Manual after (the version is staged, NOT yet live):** publish/release the new version in the Marketplace
   vendor portal to make it live to customers; then watch the dev-console Invocation metrics (production) error rate.

## Recovery (no rollback exists)
- Forge has **no rollback** — fix forward. A code-only fix ships as a MINOR and auto-rolls to all sites within
  ≤120h (the de-facto canary). A scope-touching fix is a new MAJOR → per-admin re-consent → recovery can be days.
- For a risky feature, **pre-place a Forge feature flag** before deploying so you can dial it to 0% (~60s) without
  a redeploy — the closest thing to instant rollback. See `docs/INCIDENT-RUNBOOK.md`.

## Troubleshooting
- **`401` on `forge deploy`** → the token expired/was revoked → mint a new one (§1), update the Environment secret (§3).
- **`forge lint` shows the globalPage `resolver:` error** → known false-positive (gotcha #13); it is ADVISORY (won't
  block). If `forge deploy` itself blocks on it, re-run with `no_verify: true`.
- **Version-bump guard fails** → your typed version ≠ `package.json`; bump both repo strings or type the right number.
- **Deploy to the wrong environment** → the workflow is hard-wired to `-e production`; staging is a manual local step (§4).
- **`forge deploy` failed but the version appears in the portal anyway** (transient/network) → do NOT blindly
  re-trigger (you'd create a duplicate version). Inspect the version in the portal; if it's broken/unpublished,
  fix-forward as a new version. (Fix-forward is the only recovery — there is no rollback.)
- **You see a `scope change` warning at deploy time you did NOT expect** (the PR-time scope-diff-guard should have
  caught it) → DO NOT deploy. Revert the PR, confirm the guard now catches it, re-submit. A missed scope change →
  forced MAJOR → days of per-admin re-consent.
