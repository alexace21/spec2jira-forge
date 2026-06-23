# Marketplace reporting poller — setup & runbook

> Operational guide for `tools/marketplace-report.mjs` (Monitoring + CI/CD Phase-2 #3 —
> see `MONITORING-CICD-STRATEGY.md` §13). Vendor-side only: this runs on YOUR machine
> (by hand or Windows Task Scheduler / cron). It is NOT part of the Forge app, NOT in CI,
> and the app never calls it — so it touches neither the no-egress moat nor customer consent.

## 1. One-time setup

### 1.1 Credentials (a dedicated bot account is recommended)
1. **Account.** Use the Atlassian account that already has Marketplace partner access (the one logged into
   the partner portal that sees Reports for the vendor). **Your own account works** — a dedicated bot account
   is an OPTIONAL best-practice (limits blast radius if the token leaks), NOT a requirement. Whatever email +
   token combination made the live probe return `200` is the correct one to reuse here. Enable **MFA (TOTP,
   not SMS)** on the account regardless, and store the recovery codes outside the repo.
2. Mint an **API token** at <https://id.atlassian.com/manage-profile/security/api-tokens>.
   ⚠ Atlassian API tokens now **expire (max 1 year)** — note the expiry; a `401` from the script
   means "token expired/revoked → mint a new one and update the creds".
3. Find your **numeric vendorId**: in the Marketplace partner portal the URL reads
   `…/manage/vendors/{vendorId}/…` — that number (e.g. `820262725`) is it. (The script converts it to
   the new developer-space UUID for you via `GET /developer-space/vendor/{vendorId}`.)

### 1.2 Store the creds OUTSIDE the repo (gitignored)
Create `tools/.marketplace-creds.local.json` (already gitignored — verified):
```json
{ "email": "bot@your-domain", "token": "<api-token>", "vendorId": "820262725" }
```
…or set env vars instead (env takes precedence): `MKT_EMAIL`, `MKT_TOKEN`, `MKT_VENDOR`.
**Never commit a token.** The script never prints it.

## 2. Run it
```powershell
node tools/marketplace-report.mjs          # human-readable summary
node tools/marketplace-report.mjs --json   # full raw JSON (for piping / archiving)
```
Requires Node 24+ (the script asserts this).

## 3. Reading the output (honest caveats)
- **Empty is normal on a new app.** Until there is paid data, the metrics read `0 — no data yet`.
  That is correct, not a failure.
- **`Installs (license records, page 1)`** counts LICENSE records (paid + eval entitlements), and
  only the **first page**. If you see `+ more pages`, use `--json` or the API's `/export` endpoint
  for the full count. (Same for `Transactions (page 1)`.)
- **Time-series points** (churn / conversion / editions / active-users) are shown as the **last point
  in the API's own order** — the chronological order was not yet confirmable against live data, so
  the label says "last in API order", not "latest". ⚠ **On your first run that has real data,
  confirm the points are oldest→newest** (compare the week/month fields). If they come back
  newest-first, the shown point is the OLDEST — tell me and it's a one-line fix.
- Trial/evaluation count is **deferred** (the exact sub-path 404'd; the four core metrics + transactions
  + active-users are covered).

## 4. Schedule it (optional)
**Windows Task Scheduler:** Create Task → Action: *Start a program* →
Program `node`, Arguments `C:\Software Engineer\Success\Spec2Tickets\spec2jira-forge\tools\marketplace-report.mjs`,
Start-in the repo root. Trigger e.g. weekly. Tip: append `>> "%USERPROFILE%\marketplace-report.log" 2>&1`
via a one-line `.cmd` wrapper if you want a rolling log. (The script exits non-zero on any error, so a
failed run is visible in Task Scheduler history.)

**cron (if ever on Linux/macOS):** `0 8 * * 1 cd /path/to/repo && node tools/marketplace-report.mjs >> ~/marketplace-report.log 2>&1`

## 5. Token rotation & troubleshooting
- **Rotate** before the token's 1-year expiry (calendar reminder): mint a new token → update the creds
  file/env → revoke the old token.
- `401` → token invalid/expired → rotate (§5).
- `403` → the account/token lacks Marketplace access → confirm it's the partner-org account.
- `missing credentials` → env vars unset AND no creds file → see §1.2.
- `UNEXPECTED RESPONSE SHAPE` → the Marketplace API changed a top-level field → **do not trust the
  numbers**; the parser (`tools/marketplace-report.mjs`) needs updating. (This is the fail-loud guard;
  it stops rather than reporting a wrong number.)
