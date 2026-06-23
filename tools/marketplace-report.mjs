#!/usr/bin/env node
/**
 * Marketplace business-health report (Phase-2 piece 3 — docs/MONITORING-CICD-STRATEGY.md §13).
 *
 * VENDOR-SIDE ONLY read-only poller for the four business-health metrics the in-product diagnostics
 * ledger can't see across installs: installs (licenses), active users by edition, eval->paid conversion,
 * and churn. Run it by hand or from Windows Task Scheduler / cron — it is NOT Forge-callable, NOT in CI,
 * and the app NEVER calls it (no egress from the product; the no-egress moat is untouched).
 * Setup runbook (bot account, token, scheduling, troubleshooting): docs/MARKETPLACE-REPORTING-SETUP.md.
 *
 * ⭐ LIVE-CONFIRMED surface (probe, 2026-06-23 — strategy §13.5). The v2 `/vendors/{id}` API the older
 * research assumed is being SUNSET (30 Jun 2026); the working Data API is:
 *   base  = https://api.atlassian.com/marketplace/rest/3        (NOT marketplace.atlassian.com)
 *   auth  = HTTP Basic (email:api_token)  — Forge/OAuth2 cannot call this API; Basic is the only method
 *   devId = GET /developer-space/vendor/{vendorId}  -> { developerId: "<UUID>" }   (numeric vendorId != UUID)
 *   report= GET /reporting/developer-space/{developerId}/{licenses|sales/transactions|
 *           sales/metrics/churn|sales/metrics/conversion|customer-insights/editions|customer-insights/active-users}
 * All four metrics are DIRECT (churn/conversion are pre-computed time-series) -> NO local snapshot store and
 * NO delta math are needed; the server holds the history. That deletes the snapshot/delta silent-miss class.
 *
 * HONEST RESIDUALS (deep audit, 2026-06-23 — see §13.7):
 *  - "installs" is the count of LICENSE RECORDS (paid+eval entitlements), shown PAGE 1 only; for a full
 *    count past one page use --json or the API's /export endpoint. licenses & transactions are paginated.
 *  - the time-series endpoints return points in an order the (empty) probe could NOT confirm — so the shown
 *    point is labelled "last in API order", NOT asserted as the chronological latest. Confirm the ordering
 *    on the first real run with data (POLICY §9/§11 — never assert an unverified ordering).
 *  - output is stdout only (human summary, or --json); there is no file export in this version.
 *
 * Credentials live OUTSIDE the repo (never commit a token): env MKT_EMAIL + MKT_TOKEN + MKT_VENDOR, OR a
 * gitignored JSON file (default tools/.marketplace-creds.local.json: { "email","token","vendorId" }).
 * Atlassian API tokens now EXPIRE (<=1yr) — a 401 here means "the token expired/was revoked; rotate it".
 *
 * Gate discipline (strategy §13.5): FAIL LOUD on a missing/renamed top-level field (never silent-zero a
 * metric), handle 401-expired explicitly, and render empty data as an honest "no data yet". Zero deps
 * (Node 24 builtins only). The pure summarize/latest helpers are exported for an offline test; main() runs
 * only when invoked directly.
 *
 * TODO (minor, DEFERRED — NOT a met gate criterion): the `evaluations` (trial count) sub-path 404'd at
 * /reporting/.../evaluations — the portal uses /reporting/.../evaluations/hosting; resolve the exact path
 * when the trial metric is wanted. The four core metrics + transactions + active-users are covered here.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const API = 'https://api.atlassian.com/marketplace/rest/3';

function fail(msg, code = 1) { console.error(`\n[marketplace-report] ERROR: ${msg}`); process.exit(code); }

/** Load creds from env first, then an optional gitignored JSON file. Never logs the token. */
function loadCreds(credsPathDefault) {
  const e = process.env;
  let email = e.MKT_EMAIL, token = e.MKT_TOKEN, vendorId = e.MKT_VENDOR;
  if (!email || !token || !vendorId) {
    const path = e.MKT_CREDS_FILE || credsPathDefault;
    try {
      const f = JSON.parse(readFileSync(path, 'utf8'));
      email = email || f.email; token = token || f.token; vendorId = vendorId || f.vendorId;
    } catch { /* file is optional — env may supply everything */ }
  }
  if (!email || !token || !vendorId) {
    fail('missing credentials. Provide env MKT_EMAIL + MKT_TOKEN + MKT_VENDOR, OR a gitignored ' +
      `${credsPathDefault} with { "email": "...", "token": "...", "vendorId": "<numeric vendor id>" }.`);
  }
  vendorId = String(vendorId);
  // Early, clear feedback (the v3 developer-space lookup keys off the NUMERIC vendorId; the API would
  // otherwise reject a non-numeric id with an opaque 400/404).
  if (!/^\d+$/.test(vendorId)) {
    fail(`vendorId must be the NUMERIC vendor id (e.g. 820262725), got "${vendorId}".`);
  }
  return { email, token, vendorId };
}

/** GET + JSON. Fails LOUD on auth/HTTP/shape problems — a wrong number is worse than a stopped run (§8/§11). */
async function apiGet(authHeader, url, expectKey) {
  let res, text;
  try {
    res = await fetch(url, { headers: { Authorization: authHeader, Accept: 'application/json' } });
    text = await res.text();   // inside the try so a stream/read error fails loud like everything else
  } catch (err) { fail(`network/read error calling ${url}: ${String(err?.message || err)}`); }
  if (res.status === 401) fail(`401 Unauthorized (${url}) — the API token is invalid or EXPIRED. Atlassian tokens now expire (<=1yr); mint+store a new one and rotate.`);
  if (res.status === 403) fail(`403 Forbidden (${url}) — the account/token lacks Marketplace access for this resource.`);
  if (res.status !== 200) fail(`HTTP ${res.status} (${url}): ${text.slice(0, 300)}`);   // body is API status text only — never echoes the request Authorization header
  let json;
  try { json = JSON.parse(text); } catch { fail(`non-JSON response (${url}): ${text.slice(0, 200)}`); }
  if (expectKey && !(expectKey in json)) {
    fail(`UNEXPECTED RESPONSE SHAPE (${url}): missing top-level "${expectKey}" — the Marketplace API may have ` +
      `changed; do NOT trust these numbers until the parser is updated. Got keys: [${Object.keys(json).join(', ')}].`);
  }
  return json;
}

/** Pure: last element of an array, or null. NOTE: the time-series API order is unconfirmed (§13.7) — callers
 *  must label this "last in API order", not assert it is the chronological latest. */
export function latest(arr) { return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null; }

/** Pure: a defensive count for "N records" / "no data yet". */
function countOf(arr) { return Array.isArray(arr) ? arr.length : 0; }

/** Pure: a paginated-list line (licenses/transactions) — honest about page-1-only + more-pages. */
function pageLine(label, arr, links) {
  const n = countOf(arr);
  const more = n > 0 && !!links?.next;   // a 0-count with a next link can't happen; don't print the contradiction
  return `${label}: ${n}${more ? ' + more pages (use --json / the API export endpoint for the full count)' : ''}` +
    `${n === 0 ? '   — no data yet' : ''}`;
}

/** Pure: a time-series line (churn/conversion/editions/active-users). Shows the LAST element in API order
 *  (ordering unconfirmed — §13.7), never claims "latest". */
function tsLine(label, arr) {
  const n = countOf(arr);
  if (n === 0) return `${label}: 0   — no data yet`;
  return `${label}: ${n} point(s)   last in API order: ${JSON.stringify(latest(arr)).slice(0, 200)}`;
}

/** Pure: build the human-readable summary lines from the raw API payloads. Defensive on empty/missing
 *  so it never throws even if a payload is partial — apiGet already fails loud on a missing top-level key. */
export function summarize(data) {
  const { developerId, vendorId, fetchedAt, licenses, transactions, churn, conversion, editions, activeUsers } = data;
  const L = [];
  L.push(`Marketplace business health  —  fetched ${fetchedAt}`);
  L.push(`vendorId ${vendorId}  ->  developerId ${developerId}`);
  L.push('');
  L.push(pageLine('Installs (license records, page 1)', licenses?.licenses, licenses?._links));
  L.push(pageLine('Transactions (page 1)', transactions?.transactions, transactions?._links));
  L.push(tsLine('Churn (pre-computed, default window)', churn?.total?.datasets));
  L.push(tsLine('Eval->paid conversion (pre-computed, default window)', conversion?.total?.series));
  L.push(tsLine('Active users by edition', editions?.usersDistributionPerMonth));
  L.push(tsLine('Active users (total)', activeUsers?.usersDistributionPerMonth));
  L.push('');
  L.push('note: time-series points shown in the API\'s own order (chronological order unconfirmed — verify on the first real run); list counts are page 1 only where "more pages" is shown.');
  return L;
}

async function main() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 24) fail(`Node 24+ required (Forge runtime parity); you are on ${process.version}.`);

  const wantJson = process.argv.includes('--json');
  const here = dirname(fileURLToPath(import.meta.url));
  const { email, token, vendorId } = loadCreds(join(here, '.marketplace-creds.local.json'));
  const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

  // 1) numeric vendorId -> developerId (UUID). The new Developer-ID system replaced vendorId in the v3 API.
  const dev = await apiGet(auth, `${API}/developer-space/vendor/${encodeURIComponent(vendorId)}`, 'developerId');
  const developerId = dev.developerId;

  // 2) the four metrics + transactions + active-users — all DIRECT (no derivation).
  const R = `${API}/reporting/developer-space/${encodeURIComponent(developerId)}`;
  const [licenses, transactions, churn, conversion, editions, activeUsers] = await Promise.all([
    apiGet(auth, `${R}/licenses`, 'licenses'),
    apiGet(auth, `${R}/sales/transactions`, 'transactions'),
    apiGet(auth, `${R}/sales/metrics/churn`, 'total'),
    apiGet(auth, `${R}/sales/metrics/conversion`, 'total'),
    apiGet(auth, `${R}/customer-insights/editions`, 'usersDistributionPerMonth'),
    apiGet(auth, `${R}/customer-insights/active-users`, 'usersDistributionPerMonth'),
  ]);

  const data = { developerId, vendorId, fetchedAt: new Date().toISOString(),
    licenses, transactions, churn, conversion, editions, activeUsers };

  if (wantJson) { console.log(JSON.stringify(data, null, 2)); return; }
  console.log('\n' + summarize(data).join('\n') + '\n');
}

// Run only when invoked directly (not when imported by a test) — compare resolved absolute paths.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
