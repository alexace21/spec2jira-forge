#!/usr/bin/env node
/**
 * Offline truth-table test for the STANDARD-ONLY tier model + the trial-license gate (src/usage.js).
 *
 * ⭐ 2026-07-11 STANDARD-ONLY PIVOT (supersedes the v6 value-split invariants this file used to assert):
 * editions collapsed to a SINGLE offer — Standard includes EVERYTHING. The make-or-break invariants now:
 *   - Standard (byokPro) grants BOTH hasTestCases AND hasPlanner (no feature is gated behind an edition).
 *   - A pending/existing capabilityAdvanced subscriber STILL resolves to a FULL-featured tier (byokAdvanced,
 *     retained as an internal alias) — nobody loses access.
 *   - safe default: any unknown/absent ACTIVE capabilitySet ⇒ Standard (full-featured; no dead-end).
 *   - NO capabilitySet-resolved (live) tier is keySource 'managed' — the $5 managed trial credit is a SEPARATE
 *     dynamic mechanism (resolveAnthropicKey + src/trialCredit.js), NOT a tier. Managed stays dormant data.
 *   - pricingTable advertises ONE edition (Standard).
 *   - inactive/null ⇒ unlicensed (blocked, never our key).
 *   - isTrialLicense: only isEvaluation===true (and trialEndDate not past) counts as the 30-day trial.
 *
 * resolveTier/pricingTable/isTrialLicense are pure, so this exercises the real exported code.
 * Usage: node prototype/test_v6_tiers.mjs
 */
import { resolveTier, pricingTable, TIERS, isTrialLicense } from '../src/usage.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`  XX  ${name}`); }
}

console.log('standard-only tier truth-table:');

// 1. capabilityStandard ⇒ Standard: BYOK, EVERYTHING included, unlimited
const std = resolveTier({ active: true, capabilitySet: 'capabilityStandard' });
check('Standard.key === byokPro', std.key === 'byokPro');
check('Standard.keySource === byok', std.keySource === 'byok');
check('Standard.hasTestCases === true (included — no paywall)', std.hasTestCases === true);
check('Standard.hasPlanner === true (included — no paywall)', std.hasPlanner === true);
check('Standard.limit === null (unlimited)', std.limit === null);

// 2. capabilityAdvanced STILL resolves to a FULL-featured tier (no existing subscriber loses access)
const adv = resolveTier({ active: true, capabilitySet: 'capabilityAdvanced' });
check('Advanced still full-featured: hasTestCases', adv.hasTestCases === true);
check('Advanced still full-featured: hasPlanner', adv.hasPlanner === true);
check('Advanced.keySource === byok (NOT managed — margin-leak guard)', adv.keySource === 'byok');
check('Advanced.limit === null (unlimited)', adv.limit === null);

// 3. safe default: unknown active capabilitySet ⇒ Standard (full-featured; never a dead-end)
const unknown = resolveTier({ active: true, capabilitySet: 'capabilityGarbage' });
check('unknown set ⇒ Standard', unknown.key === 'byokPro');
check('unknown set ⇒ hasTestCases true (full features)', unknown.hasTestCases === true);
check('unknown set ⇒ hasPlanner true (full features)', unknown.hasPlanner === true);
check('unknown set ⇒ keySource byok (never our key by tier)', unknown.keySource === 'byok');

// 4. absent capabilitySet (active) ⇒ Standard, full-featured
const noset = resolveTier({ active: true });
check('absent capabilitySet ⇒ Standard full-featured', noset.key === 'byokPro' && noset.hasTestCases === true && noset.hasPlanner === true);

// 5. case-insensitive (documented casing drift) still full-featured
const advCi = resolveTier({ active: true, capabilitySet: 'CapabilityAdvanced' });
check('case-insensitive: CapabilityAdvanced ⇒ full-featured', advCi.hasTestCases === true && advCi.hasPlanner === true);

// 6. inactive / null ⇒ unlicensed (blocked, never our key)
const inactive = resolveTier({ active: false, capabilitySet: 'capabilityAdvanced' });
check('inactive ⇒ unlicensed', inactive.key === 'unlicensed');
check('unlicensed.limit === 0 (blocked)', inactive.limit === 0);
check('unlicensed.hasTestCases === false', inactive.hasTestCases === false);
check('unlicensed.hasPlanner === false', inactive.hasPlanner === false);
check('unlicensed.keySource === byok (never our key, even defensively)', inactive.keySource === 'byok');
check('null license ⇒ unlicensed', resolveTier(null).key === 'unlicensed');
check('isActive alias also counts as active', resolveTier({ isActive: true, capabilitySet: 'capabilityStandard' }).key === 'byokPro');

// 7. EVERY live (capabilitySet-resolvable) tier grants BOTH features (no feature gated behind an edition)
const liveTiers = [
  resolveTier({ active: true, capabilitySet: 'capabilityStandard' }),
  resolveTier({ active: true, capabilitySet: 'capabilityAdvanced' }),
  resolveTier({ active: true, capabilitySet: 'capabilityGarbage' }),
  resolveTier({ active: true }),
];
check('EVERY live tier has hasTestCases (no edition paywall)', liveTiers.every((t) => t.hasTestCases === true));
check('EVERY live tier has hasPlanner (no edition paywall)', liveTiers.every((t) => t.hasPlanner === true));

// 8. NO capabilitySet input resolves to a managed key-source (the $5 credit is NOT a tier)
const sweep = ['capabilityStandard', 'capabilityAdvanced', 'capabilityGarbage', '', undefined]
  .map((cs) => resolveTier({ active: true, capabilitySet: cs }));
check('NO live tier is keySource managed (managed is not a tier)', sweep.every((t) => t.keySource === 'byok'));

// 9. dormant managedPro stays as data but is NOT reachable by resolveTier
check('managedPro exists as dormant data', TIERS.managedPro && TIERS.managedPro.keySource === 'managed');
check('no live tier object IS the managed tier', sweep.every((t) => t !== TIERS.managedPro));

// 10. TIERS frozen (shared by reference — mutation must not corrupt the singleton)
check('TIERS is frozen', Object.isFrozen(TIERS));
check('TIERS.byokPro is frozen', Object.isFrozen(TIERS.byokPro));
try { TIERS.byokPro.hasTestCases = false; } catch (e) { /* strict throws */ }
check('frozen Standard resists mutation (still hasTestCases true)', resolveTier({ active: true, capabilitySet: 'capabilityStandard' }).hasTestCases === true);

// 11. pricingTable = a SINGLE offer (Standard); managed NOT listed
const pt = pricingTable();
check('pricingTable lists exactly 1 edition (Standard-only)', pt.length === 1);
check('pricingTable key is byokPro', pt[0].key === 'byokPro');
check('pricingTable does NOT list managedPro', !pt.some((p) => p.key === 'managedPro'));
check('pricingTable Standard is priced ($6.70)', /6\.70/.test(pt[0].price || ''));
check('pricingTable Standard carries hasTestCases true', pt[0].hasTestCases === true);
check('pricingTable Standard carries hasPlanner true', pt[0].hasPlanner === true);

// 12. isTrialLicense — only the 30-day Atlassian evaluation counts (gates the $5 managed credit)
const FUTURE = new Date(Date.now() + 7 * 864e5).toISOString();
const PAST = new Date(Date.now() - 7 * 864e5).toISOString();
check('isEvaluation true ⇒ trial', isTrialLicense({ active: true, isEvaluation: true }) === true);
check('isEvaluation true + future trialEndDate ⇒ trial', isTrialLicense({ isEvaluation: true, trialEndDate: FUTURE }) === true);
check('isEvaluation true + PAST trialEndDate ⇒ NOT trial (stale flag guard)', isTrialLicense({ isEvaluation: true, trialEndDate: PAST }) === false);
check('paid (isEvaluation false) ⇒ NOT trial', isTrialLicense({ active: true, isEvaluation: false }) === false);
check('isEvaluation absent ⇒ NOT trial', isTrialLicense({ active: true }) === false);
check('null license ⇒ NOT trial', isTrialLicense(null) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
