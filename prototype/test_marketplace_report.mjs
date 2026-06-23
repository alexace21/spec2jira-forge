#!/usr/bin/env node
/**
 * Offline tests for tools/marketplace-report.mjs pure helpers (summarize, latest).
 *
 * The IO (fetch/creds) is not tested here (no @forge/network mock + no live creds — live validation is the
 * partner's step, per strategy §13.5). What IS tested is the load-bearing pure logic: that the summary is
 * defensive on EMPTY payloads (the app is new -> arrays are legitimately empty -> must read "no data yet",
 * never crash), correct on POPULATED payloads, honest about pagination (page-1 only) symmetrically for
 * licenses AND transactions, and labels time-series points as "last in API order" (NOT an asserted
 * chronological "latest" — the order was never probe-confirmed; deep-audit §13.7).
 */
import { summarize, latest } from '../tools/marketplace-report.mjs';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name}`); }
}

// ---- latest() ----
check('latest([]) → null', latest([]) === null);
check('latest([1,2,3]) → 3', latest([1, 2, 3]) === 3);
check('latest(null) → null', latest(null) === null);
check('latest("x") → null (non-array)', latest('x') === null);
// contract: returns the LAST element (the code labels it "last in API order", not chronological latest)
check('latest([{w:"a"},{w:"b"}]) → last element', JSON.stringify(latest([{ w: 'a' }, { w: 'b' }])) === JSON.stringify({ w: 'b' }));

// ---- summarize(): empty payloads (the real current state of a freshly-launched app) ----
const empty = {
  developerId: 'uuid-x', vendorId: '820262725', fetchedAt: '2026-06-23T00:00:00Z',
  licenses: { _links: {}, licenses: [] },
  transactions: { _links: {}, transactions: [] },
  churn: { _links: {}, total: { name: 'All apps', datasets: [] }, addons: [] },
  conversion: { _links: {}, total: { name: 'All apps', series: [] }, addons: [] },
  editions: { _links: {}, usersDistributionPerMonth: [] },
  activeUsers: { _links: {}, usersDistributionPerMonth: [] },
};
const eLines = summarize(empty);
const eText = eLines.join('\n');
check('empty → returns a non-empty line array', Array.isArray(eLines) && eLines.length >= 7);
check('empty → header carries vendorId + developerId', eText.includes('820262725') && eText.includes('uuid-x'));
check('empty → 6 metric lines say "no data yet"', (eText.match(/no data yet/g) || []).length === 6);
check('empty → never throws + no "undefined" leaked', !eText.includes('undefined'));

// ---- summarize(): populated payloads ----
const full = {
  developerId: 'uuid-y', vendorId: '820262725', fetchedAt: '2026-06-23T00:00:00Z',
  licenses: { _links: { next: { href: '/x?offset=50' } }, licenses: [{}, {}, {}] },
  transactions: { _links: { next: { href: '/y?offset=50' } }, transactions: [{}, {}] },
  churn: { _links: {}, total: { datasets: [{ week: '2026-W24', value: 1 }] } },
  conversion: { _links: {}, total: { series: [{ week: '2026-W24', rate: 0.2 }] } },
  editions: { _links: {}, usersDistributionPerMonth: [{ month: '2026-06', standard: 10 }] },
  activeUsers: { _links: {}, usersDistributionPerMonth: [{ month: '2026-06', total: 10 }] },
};
const fText = summarize(full).join('\n');
check('full → installs shows 3', /Installs[^\n]*\b3\b/.test(fText));
check('full → installs flags more pages', /Installs[^\n]*more pages/.test(fText));
check('full → transactions shows 2', /Transactions[^\n]*\b2\b/.test(fText));
check('full → transactions ALSO flags more pages (symmetry)', /Transactions[^\n]*more pages/.test(fText));
check('full → churn shows 1 point + last-in-order', /Churn[^\n]*1 point/.test(fText) && /last in API order:.*2026-W24/.test(fText));
check('full → conversion shows 1 point', /conversion[^\n]*1 point/i.test(fText));
check('full → editions shows latest month', /Active users by edition[^\n]*1 point/.test(fText) && fText.includes('2026-06'));
check('full → no "no data yet" when populated', !/no data yet/.test(fText));
check('full → never asserts chronological "latest:" (honest label only)', !/\blatest:/.test(fText) && /last in API order/.test(fText));

// ---- ordering caveat is surfaced honestly in the output ----
check('output carries the ordering caveat note', /chronological order unconfirmed/.test(eText));

// ---- defensive: partial/missing nested keys must NOT throw (apiGet already fails loud on missing TOP key) ----
let threw = false;
try {
  const partial = { developerId: 'd', vendorId: 'v', fetchedAt: 't',
    licenses: {}, transactions: {}, churn: {}, conversion: {}, editions: {}, activeUsers: {} };
  const pText = summarize(partial).join('\n');
  check('partial → treated as 0 / no data', (pText.match(/no data yet/g) || []).length === 6);
} catch { threw = true; }
check('partial payload → summarize does not throw', threw === false);

console.log(`\nmarketplace-report: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
