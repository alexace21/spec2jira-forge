# Spec2Tickets — Incident Runbook (≤5-min)

> Solo-vendor incident playbook for the LIVE Forge app (Marketplace v6.1.0). Keep it short and calm.
> Pairs with the Monitoring + CI/CD strategy (`docs/MONITORING-CICD-STRATEGY.md`) — alert rules §4.3,
> recovery §6.5. The dev-console **Metrics + Alerts** page IS the dashboard; there is no custom one.
>
> ⚠ The alert rules referenced below are configured in the **Forge developer console → Alerts** (not in
> code). Until they exist, this runbook is the manual triage you run from the console on a report.

---

## 0. First 60 seconds — is it us, or the customer, or Anthropic?

A large share of "errors" on a **BYOK** app are NOT our fault. Before anything, classify:

1. Open **developer console → Metrics → Invocation**, filter **production**, last 24h, **by error type** + **by site**.
2. Decide which bucket you're in:
   - **One site only**, errors are `auth_rejected` / `insufficient_credits` / `rate_limited` → **customer's Anthropic key/credit** (not us). Reply with the fix; no deploy.
   - **One site only**, Jira errors / pending re-consent → **customer config** (re-consent after a scope release, missing project permission). Not us.
   - **Cross-install spike in `anthropic_<5xx>` / overloaded** → **Anthropic platform outage** (not us, but post a known-issue note; see §3).
   - **Cross-install spike right after a deploy**, or `unhandled exception` / `timeout` / OOM across sites → **OUR regression** → §2.

---

## 1. Alert-response (what each rule means)

| Alert | Likely cause | First check |
|---|---|---|
| **Invocation success-rate < ~95–98%** (Major) | a deploy regressed, or a dependency is down | Metrics → error type + by-site; correlate with the last `forge deploy -e production` time |
| **Invocation-error spike** (Critical) | unhandled throw / timeout / OOM in a resolver | `forge logs -e production --since <alert time>`; read the `[gen]`/`[push]`/`[sweep]` tagged lines |
| **(future) `sweep_runs` flat-lines** | the daily orphan-sweep stopped firing | Admin → **Diagnostics tab → "Orphan sweep last ran"** heartbeat (stale > 36h = ⚠) |

For a **customer-reported** failure with no alert: ask the customer for the **diagnostic reference id** (shown in-app on failure) and search it in **Admin → Diagnostics → "All users on this site"** (admins only). The ledger is the per-customer detail; no data leaves their site.

---

## 2. OUR regression — recovery is FIX-FORWARD (Forge has NO rollback)

There is no rollback/revert/un-publish on Forge. Recovery = ship corrected code as a **new version**.

1. **Stop the bleed first if pre-placed:** if the broken feature is behind a **Forge feature flag**, dial it to **0%** in the developer console (~60s, no redeploy). This is the only "instant rollback" Forge offers — and only if the flag was placed before the deploy (§6.5).
2. **Reproduce + fix** on a branch. Run the gates locally green: `npm run ci` (check → test → build:ui). For a WRITE-path change, run the **live-acceptance runbook** (`docs/PLANNER-LIVE-ACCEPTANCE.md`) — green CI ≠ proven app.
3. **Recovery speed depends on the fix's manifest impact (the asymmetry that matters):**
   - **Non-scope fix → MINOR version** → `forge deploy -e production` → auto-rolls to all sites within the staggered ≤120h window, **no customer action**. Minutes-to-hours recovery.
   - **Scope/egress-touching fix → MAJOR version** → each customer admin must **RE-CONSENT** in Manage Apps before the fix applies. Recovery can be **days**, install-by-install. Avoid scope churn under incident; the CI **scope-diff guard** flags this.
4. **Deploy** (manual, human-gated): `cd static/hello-world && npm run build` → `forge deploy -e production` (auto-publishes the Marketplace version). **Never** `forge install` on prod (licensed → blocked).
5. **Confirm recovery:** watch **Metrics → Invocation (production)** error rate drop over the next minutes/hours; the alert auto-closes when the rule clears.

### Hotfix discipline (urgent one-liner)
Branch protection is **owner-bypassable** — under pressure you can self-merge. That's fine, but still run **`npm run ci` locally green BEFORE the manual `forge deploy -e production`** so "green gates" is preserved even off the GitHub gate. Don't skip the build.

---

## 3. Anthropic platform outage (not us)

Cross-install spike in `anthropic_<5xx>` / overloaded = Anthropic is down for everyone. You can't fix it.
- Confirm at https://status.anthropic.com.
- Post a brief known-issue note to affected admins / support inbox ("Anthropic is experiencing an outage; generation will recover automatically when it does"). This prevents N duplicate tickets.
- Do **not** deploy. Do **not** let this trip the vendor-fault success-rate alert long-term (it's scoped to vendor-fault classes; if it's noisy, note it and move on).

---

## 4. Escalation / comms (solo)

- Alerts email → `support@` / `security@spec2jira.com` (monitored). No on-call rotation; email is the pager.
- Security-relevant incident (suspected token leak, data exposure): rotate the affected Atlassian API token immediately (developer console / id.atlassian.com), then triage. The CI uses **no** Forge token (phase-1 gates-only); a leak would be from the manual local deploy credential or a future phase-2 deploy token.
- Keep this runbook current as alert rules + phases evolve (it's a living doc; update on each monitoring change).
