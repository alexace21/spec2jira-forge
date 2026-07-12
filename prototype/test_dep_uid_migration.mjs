/**
 * Offline test for the dependency-SOURCE identity migration
 * (static/hello-world/src/lib/v3Schema.js — removeFeatureDependency /
 * addFeatureDependency / mapFeatureDependencies).
 *
 * Plain-Node ESM, self-contained fixtures. Run:
 *   node prototype/test_dep_uid_migration.mjs
 *
 * LOCATION: the repo convention (every existing *.mjs test — test_editor_review.mjs,
 * test_insights_view.mjs, ...) is the ROOT prototype/ directory, from which the import
 * ../static/hello-world/src/lib/v3Schema.js resolves. Auto-discovered by
 * tools/run-tests.mjs (npm test).
 *
 * WHAT IT GUARDS — the SOURCE feature is now matched uid-first, name-fallback:
 *   - uid-mode isolation: two features with the SAME name but different _uid; a
 *     remove/add on ONE (by its sourceUid) leaves the OTHER's deps untouched.
 *     (Pre-migration name-match hit BOTH — the exact bug this closes.)
 *   - round-trip: remove then add (by uid) restores the dep membership.
 *   - legacy fallback: no sourceUid -> matches by name (behavior preserved).
 *   - A2 regression: a duplicate dep string is deduped at adapt, so a
 *     remove->restore round-trip does NOT collapse it.
 */
import {
  removeFeatureDependency,
  addFeatureDependency,
  adaptToLegacyShape,
} from '../static/hello-world/src/lib/v3Schema.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + msg);
  } else {
    fail++;
    console.error('  FAIL  ' + msg);
  }
}
function sameSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

// Read a feature's deps from a native-v3 breakdown (features[]) by _uid, then by name.
function depsByUid(bd, uid) {
  const f = (bd.features || []).find((x) => x && x._uid === uid);
  return f ? f.dependencies : undefined;
}
function depsByName(bd, name) {
  const f = (bd.features || []).find((x) => x && x.name === name);
  return f ? f.dependencies : undefined;
}

// ── 1. uid-mode isolation (the duplicate-name bug this migration closes) ──────
console.log('\n== uid-mode isolation (duplicate names) ==');
{
  const bd = {
    features: [
      { name: 'New Feature', _uid: 'u1', dependencies: ['Auth', 'Billing'] },
      { name: 'New Feature', _uid: 'u2', dependencies: ['Auth', 'Search'] },
    ],
  };
  // Remove 'Auth' from ONLY u1 (by its sourceUid).
  const after = removeFeatureDependency(bd, 'New Feature', 'Auth', 'u1');
  ok(sameSet(depsByUid(after, 'u1'), ['Billing']), 'u1 lost only "Auth"');
  ok(sameSet(depsByUid(after, 'u2'), ['Auth', 'Search']), 'u2 (same name) is UNTOUCHED');
  // Immutability — original breakdown unchanged.
  ok(sameSet(depsByUid(bd, 'u1'), ['Auth', 'Billing']), 'original u1 unchanged (immutable)');

  // Add 'Search' to ONLY u1 (by uid) — u2 must not gain a duplicate/anything.
  const added = addFeatureDependency(bd, 'New Feature', 'Search', 'u1');
  ok(sameSet(depsByUid(added, 'u1'), ['Auth', 'Billing', 'Search']), 'u1 gained "Search"');
  ok(sameSet(depsByUid(added, 'u2'), ['Auth', 'Search']), 'u2 (same name) is UNTOUCHED on add');
}

// ── 2. round-trip: remove then add (by uid) restores membership ───────────────
console.log('\n== round-trip (remove -> add by uid) ==');
{
  const bd = {
    features: [{ name: 'Reports', _uid: 'r1', dependencies: ['Auth', 'Billing', 'Search'] }],
  };
  const removed = removeFeatureDependency(bd, 'Reports', 'Billing', 'r1');
  ok(sameSet(depsByUid(removed, 'r1'), ['Auth', 'Search']), 'after remove: Billing gone');
  const restored = addFeatureDependency(removed, 'Reports', 'Billing', 'r1');
  ok(
    sameSet(depsByUid(restored, 'r1'), ['Auth', 'Billing', 'Search']),
    'after restore: membership content-identical to the start',
  );
  // add is idempotent — restoring twice does not duplicate.
  const twice = addFeatureDependency(restored, 'Reports', 'Billing', 'r1');
  ok(depsByUid(twice, 'r1').length === 3, 'restore is idempotent (no duplicate)');
}

// ── 3. legacy fallback: no sourceUid -> matches by name (preserved) ───────────
console.log('\n== legacy fallback (no sourceUid -> name match) ==');
{
  // A legacy breakdown whose features carry NO _uid — must still work by name.
  const legacy = {
    features: [{ name: 'Auth', dependencies: ['Users', 'Sessions'] }],
  };
  const after = removeFeatureDependency(legacy, 'Auth', 'Users');
  ok(sameSet(depsByName(after, 'Auth'), ['Sessions']), 'legacy remove by name works');
  const back = addFeatureDependency(after, 'Auth', 'Users');
  ok(sameSet(depsByName(back, 'Auth'), ['Sessions', 'Users']), 'legacy add by name works');

  // A uid-bearing breakdown but the caller passes NO sourceUid: falls back to name
  // (both same-named features change — the documented pre-migration behavior). This
  // proves the fallback is byte-identical to the old code path.
  const bd = {
    features: [
      { name: 'Dup', _uid: 'a', dependencies: ['X', 'Y'] },
      { name: 'Dup', _uid: 'b', dependencies: ['X', 'Z'] },
    ],
  };
  const nofb = removeFeatureDependency(bd, 'Dup', 'X'); // no sourceUid
  ok(
    sameSet(depsByUid(nofb, 'a'), ['Y']) && sameSet(depsByUid(nofb, 'b'), ['Z']),
    'no sourceUid -> name match hits BOTH same-named features (legacy behavior preserved)',
  );
}

// ── 4. A2 regression: duplicate dep deduped at adapt -> no collapse on round-trip ─
console.log('\n== A2 dedup regression (remove->restore does not collapse) ==');
{
  const raw = {
    metadata: { spec_summary: 'x' },
    features: [
      { name: 'Checkout', category: 'Core', dependencies: ['Cart', 'Cart', 'Payments'] },
      { name: 'Cart', category: 'Core', dependencies: [] },
      { name: 'Payments', category: 'Core', dependencies: [] },
    ],
  };
  const adapted = adaptToLegacyShape(raw);
  const co = adapted.capabilities.flatMap((c) => c.features).find((f) => f.name === 'Checkout');
  ok(sameSet(co.dependencies, ['Cart', 'Payments']), 'A2: duplicate "Cart" deduped at adapt');
  ok(!!co._uid, 'adapt minted a stable _uid on the source feature');

  // Round-trip via uid on the ADAPTED (capabilities) shape — remove 'Cart' then restore.
  const removed = removeFeatureDependency(adapted, 'Checkout', 'Cart', co._uid);
  const coR = removed.capabilities.flatMap((c) => c.features).find((f) => f._uid === co._uid);
  ok(sameSet(coR.dependencies, ['Payments']), 'A2: remove drops the single (deduped) Cart edge');
  const restored = addFeatureDependency(removed, 'Checkout', 'Cart', co._uid);
  const coRR = restored.capabilities.flatMap((c) => c.features).find((f) => f._uid === co._uid);
  ok(sameSet(coRR.dependencies, ['Cart', 'Payments']), 'A2: restore brings Cart back (no collapse)');
  // The mutation also reaches _v3_original.features (the Review display shape).
  const coOrig = (restored._v3_original.features || []).find((f) => f._uid === co._uid);
  ok(sameSet(coOrig.dependencies, ['Cart', 'Payments']), 'A2: _v3_original mirror updated too');
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);
