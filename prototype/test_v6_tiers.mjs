#!/usr/bin/env node
/**
 * Offline truth-table test for the v6 value-split tier decouple (src/usage.js).
 *
 * THE make-or-break invariants (a wrong one is a margin leak, a silent mis-gate, or a
 * dead-end on a LIVE app):
 *   - capabilityAdvanced ⇒ Advanced = BYOK + test-cases + unlimited (NOT our managed key).
 *   - safe default: any unknown/absent active capabilitySet ⇒ Standard (BYOK, no test-cases).
 *   - NO capabilitySet-resolved (live) tier is keySource 'managed' — managed is dormant only.
 *   - EXACTLY one live tier grants hasTestCases (Advanced); Standard must NOT.
 *   - TIERS are frozen (shared by reference; a mutation would corrupt the singleton).
 *
 * resolveTier/pricingTable are pure (they take the license; never call kvs/getAppContext),
 * so this exercises the real exported code. Usage: node prototype/test_v6_tiers.mjs
 */
import { resolveTier, pricingTable, TIERS, MANAGED_USER_CAP } from '../src/usage.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`  XX  ${name}`); }
}

console.log('v6 tier truth-table:');

// 1. capabilityAdvanced ⇒ Advanced: BYOK + test-cases + unlimited (NOT managed)
const adv = resolveTier({ active: true, capabilitySet: 'capabilityAdvanced' });
check('Advanced.key === byokAdvanced', adv.key === 'byokAdvanced');
check('Advanced.keySource === byok (NOT managed — margin-leak guard)', adv.keySource === 'byok');
check('Advanced.hasTestCases === true', adv.hasTestCases === true);
check('Advanced.limit === null (unlimited)', adv.limit === null);
check('Advanced.edition === advanced', adv.edition === 'advanced');

// 2. capabilityStandard ⇒ Standard: BYOK, no test-cases, unlimited
const std = resolveTier({ active: true, capabilitySet: 'capabilityStandard' });
check('Standard.key === byokPro', std.key === 'byokPro');
check('Standard.keySource === byok', std.keySource === 'byok');
check('Standard.hasTestCases === false (feature paywall)', std.hasTestCases === false);
check('Standard.limit === null (unlimited)', std.limit === null);

// 3. safe default: unknown active capabilitySet ⇒ Standard (never grants premium by accident)
const unknown = resolveTier({ active: true, capabilitySet: 'capabilityGarbage' });
check('unknown set ⇒ Standard (safe default)', unknown.key === 'byokPro');
check('unknown set ⇒ hasTestCases false (no accidental premium)', unknown.hasTestCases === false);
check('unknown set ⇒ keySource byok (never our key)', unknown.keySource === 'byok');

// 4. absent capabilitySet (active) ⇒ Standard
const noset = resolveTier({ active: true });
check('absent capabilitySet ⇒ Standard', noset.key === 'byokPro' && noset.hasTestCases === false);

// 5. case-insensitive (documented casing drift)
const advCi = resolveTier({ active: true, capabilitySet: 'CapabilityAdvanced' });
check('case-insensitive: CapabilityAdvanced ⇒ Advanced', advCi.key === 'byokAdvanced' && advCi.hasTestCases === true);

// 6. inactive / null ⇒ unlicensed (blocked, never our key)
const inactive = resolveTier({ active: false, capabilitySet: 'capabilityAdvanced' });
check('inactive ⇒ unlicensed', inactive.key === 'unlicensed');
check('unlicensed.limit === 0 (blocked)', inactive.limit === 0);
check('unlicensed.hasTestCases === false', inactive.hasTestCases === false);
check('unlicensed.keySource === byok (never our key, even defensively)', inactive.keySource === 'byok');
check('null license ⇒ unlicensed', resolveTier(null).key === 'unlicensed');
check('isActive alias also counts as active', resolveTier({ isActive: true, capabilitySet: 'capabilityStandard' }).key === 'byokPro');

// 7. EXACTLY one LIVE (capabilitySet-resolvable) tier grants hasTestCases — and it is Advanced
const liveTiers = [
  resolveTier({ active: true, capabilitySet: 'capabilityStandard' }),
  resolveTier({ active: true, capabilitySet: 'capabilityAdvanced' }),
];
check('exactly ONE live tier has hasTestCases', liveTiers.filter((t) => t.hasTestCases).length === 1);

// 8. NO capabilitySet input resolves to a managed key-source (managed is dormant only)
const sweep = ['capabilityStandard', 'capabilityAdvanced', 'capabilityGarbage', '', undefined]
  .map((cs) => resolveTier({ active: true, capabilitySet: cs }));
check('NO live tier is keySource managed (managed dormant)', sweep.every((t) => t.keySource === 'byok'));

// 9. dormant managedPro is NOT reachable by resolveTier, and its edition is decoupled
check('managedPro exists as dormant data', TIERS.managedPro && TIERS.managedPro.keySource === 'managed');
check('dormant managedPro.edition === managed (NOT advanced — decouple guard)', TIERS.managedPro.edition === 'managed');
check('no live tier object IS the managed tier', sweep.every((t) => t !== TIERS.managedPro));

// 10. TIERS frozen (shared by reference — mutation must not corrupt the singleton)
check('TIERS is frozen', Object.isFrozen(TIERS));
check('TIERS.byokAdvanced is frozen', Object.isFrozen(TIERS.byokAdvanced));
let mutated = false;
try { TIERS.byokAdvanced.hasTestCases = false; } catch (e) { /* strict throws */ }
mutated = TIERS.byokAdvanced.hasTestCases === false;
check('frozen tier resists mutation (still hasTestCases true)', resolveTier({ active: true, capabilitySet: 'capabilityAdvanced' }).hasTestCases === true);

// 11. pricingTable = the two LIVE editions, both BYOK, both priced; managed NOT listed
const pt = pricingTable();
check('pricingTable lists exactly 2 editions', pt.length === 2);
check('pricingTable keys are byokPro + byokAdvanced', pt[0].key === 'byokPro' && pt[1].key === 'byokAdvanced');
check('pricingTable does NOT list managedPro', !pt.some((p) => p.key === 'managedPro'));
check('pricingTable Advanced is priced ($13.40)', /13\.40/.test(pt[1].price || ''));
check('pricingTable Standard is priced ($6.70)', /6\.70/.test(pt[0].price || ''));
check('pricingTable carries hasTestCases per edition', pt[0].hasTestCases === false && pt[1].hasTestCases === true);

// 12. v6.1: the Capacity-Sheet Planner is Advanced-only too — hasPlanner MIRRORS hasTestCases on every tier.
// (Standard must NOT get the planner; Advanced must; an unknown/inactive set must default to no-planner.)
check('Advanced.hasPlanner === true', adv.hasPlanner === true);
check('Standard.hasPlanner === false (feature paywall)', std.hasPlanner === false);
check('unknown set ⇒ hasPlanner false (no accidental premium)', unknown.hasPlanner === false);
check('absent capabilitySet ⇒ hasPlanner false', noset.hasPlanner === false);
check('inactive/unlicensed ⇒ hasPlanner false', inactive.hasPlanner === false);
check('exactly ONE live tier has hasPlanner', liveTiers.filter((t) => t.hasPlanner).length === 1);
check('hasPlanner mirrors hasTestCases on every LIVE tier', liveTiers.every((t) => t.hasPlanner === t.hasTestCases));
check('pricingTable carries hasPlanner per edition', pt[0].hasPlanner === false && pt[1].hasPlanner === true);
check('dormant managedPro.hasPlanner === true (mirrors hasTestCases)', TIERS.managedPro.hasPlanner === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
