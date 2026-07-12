/**
 * Offline test for the Breakdown-Editor review helpers
 * (static/hello-world/src/lib/v3Schema.js additions).
 *
 * Plain-Node ESM, self-contained fixtures. Run:
 *   node prototype/test_editor_review.mjs
 *
 * NOTE ON LOCATION: the impl spec names this file
 *   static/hello-world/prototype/test_editor_review.mjs
 * but the repo's convention (every existing *.mjs test — test_insights_view.mjs,
 * test_planner.mjs, ...) is the ROOT prototype/ directory, from which the import
 * path ../static/hello-world/src/lib/v3Schema.js resolves. This test follows the
 * actual repo convention so it lives beside its siblings and its import resolves.
 *
 * Covers the SHARED DATA CONTRACT:
 *   - concernIdFor stability
 *   - get/set disposition round-trip + open-clears-entry + immutability
 *   - computeReviewReadiness open/resolved math + orphaned-entry ignore
 *   - wouldCreateCycle (self, direct back-edge, acyclic, transitive, rename-keyed)
 *   - acIsSharedFor exact-id match (the hand-written-same-text data-loss bug)
 *   - sharedAcInjected / findFeatureByUid
 */
import {
  concernIdFor,
  getConcernDisposition,
  setConcernDisposition,
  computeReviewReadiness,
  wouldCreateCycle,
  sharedAcInjected,
  acIsSharedFor,
  findFeatureByUid,
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
function eq(a, b, msg) {
  ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
function feature(over) {
  return {
    name: 'Feature',
    category: 'Core',
    story_points: 3,
    complexity_score: 2,
    priority: 'Medium',
    confidence_score: 80,
    confidence_indicator: '✓', // check
    concerns: [],
    tasks: [],
    acceptance_criteria: [],
    dependencies: [],
    _uid: 's_' + Math.random().toString(36).slice(2),
    _orig_name: 'Feature',
    ...over,
  };
}

// A native-v3 breakdown with three features carrying concerns.
function makeBreakdown() {
  const auth = feature({
    name: 'Auth',
    _uid: 's_auth',
    _orig_name: 'Auth',
    confidence_indicator: '✗', // cross (low confidence)
    confidence_score: 55,
    priority: 'High',
    story_points: 8,
    complexity_score: 4,
    concerns: [
      '[COMPLIANCE|high] Stores PII across a regulatory boundary.',
      '[AMBIGUITY|medium] Session timeout is unspecified.',
    ],
  });
  const search = feature({
    name: 'Search',
    _uid: 's_search',
    _orig_name: 'Search',
    confidence_indicator: '⚠', // warning
    confidence_score: 70,
    concerns: ['[RISK|medium] Index rebuild may be slow.'],
  });
  const footer = feature({
    name: 'Footer',
    _uid: 's_footer',
    _orig_name: 'Footer',
    confidence_indicator: '✓',
    confidence_score: 96,
    priority: 'Low',
    story_points: 1,
    complexity_score: 1,
    concerns: [],
  });
  return {
    epic: { summary: 'Test Epic' },
    metadata: { overall_quality: 'medium' },
    spec_concerns: [],
    features: [auth, search, footer],
  };
}

// ── 1. concernIdFor stability ────────────────────────────────────────────────
console.log('== concernIdFor ==');
eq(concernIdFor('s_auth', 0), 's_auth#0', 'concernIdFor formats uid#index');
eq(concernIdFor('s_auth', 0), concernIdFor('s_auth', 0), 'concernIdFor is deterministic');
ok(concernIdFor('s_auth', 0) !== concernIdFor('s_auth', 1), 'different index -> different id');
ok(concernIdFor('s_a', 0) !== concernIdFor('s_b', 0), 'different uid -> different id');

// ── 2. get/set disposition round-trip + defaults ─────────────────────────────
console.log('\n== disposition get/set ==');
let bd = makeBreakdown();
const idAuth0 = concernIdFor('s_auth', 0);

eq(getConcernDisposition(bd, idAuth0).state, 'open', 'missing disposition defaults to open');
eq(getConcernDisposition(bd, 'nope#9').state, 'open', 'unknown id defaults to open');

const bdAccepted = setConcernDisposition(bd, idAuth0, 'accepted');
eq(getConcernDisposition(bdAccepted, idAuth0).state, 'accepted', 'set accepted round-trips');
ok(
  getConcernDisposition(bdAccepted, idAuth0).reason === undefined,
  'accepted carries no reason'
);

const bdEdited = setConcernDisposition(bdAccepted, idAuth0, 'edited');
eq(getConcernDisposition(bdEdited, idAuth0).state, 'edited', 'set edited round-trips');

const bdDismissed = setConcernDisposition(bdEdited, idAuth0, 'dismissed', 'accepted risk, tracked in ticket');
eq(getConcernDisposition(bdDismissed, idAuth0).state, 'dismissed', 'set dismissed round-trips');
eq(
  getConcernDisposition(bdDismissed, idAuth0).reason,
  'accepted risk, tracked in ticket',
  'dismissed stores the reason'
);

// reason is ignored for non-dismissed states
const bdAcceptedWithReason = setConcernDisposition(bd, idAuth0, 'accepted', 'should be dropped');
ok(
  getConcernDisposition(bdAcceptedWithReason, idAuth0).reason === undefined,
  'reason ignored for accepted state'
);

// dismissed with no reason -> stored as empty string (not undefined)
const bdDismissNoReason = setConcernDisposition(bd, idAuth0, 'dismissed');
eq(getConcernDisposition(bdDismissNoReason, idAuth0).reason, '', 'dismissed with no reason -> empty string');

// ── 3. open state DELETES the entry (Undo) ───────────────────────────────────
console.log('\n== open clears the entry ==');
const bdReopened = setConcernDisposition(bdDismissed, idAuth0, 'open');
eq(getConcernDisposition(bdReopened, idAuth0).state, 'open', 'setting open reads back as open');
ok(
  !bdReopened._concern_dispositions || !(idAuth0 in bdReopened._concern_dispositions),
  'setting open DELETES the map entry (no lingering key)'
);

// ── 4. immutability — original breakdown untouched ───────────────────────────
console.log('\n== immutability ==');
const before = makeBreakdown();
const beforeHadMap = '_concern_dispositions' in before;
const after = setConcernDisposition(before, idAuth0, 'accepted');
ok(after !== before, 'set returns a NEW breakdown object');
ok(!beforeHadMap && !('_concern_dispositions' in before), 'original breakdown gained no map (untouched)');
eq(getConcernDisposition(before, idAuth0).state, 'open', 'original still reads open (not mutated)');
ok(after.features === before.features, 'features array kept by reference (React-safe shallow clone)');
ok(after._concern_dispositions !== undefined, 'new breakdown has the map');

// second set does not mutate the first result's map
const after2 = setConcernDisposition(after, concernIdFor('s_search', 0), 'edited');
ok(
  after._concern_dispositions !== after2._concern_dispositions,
  'each set clones the map (no shared-reference mutation)'
);
eq(
  getConcernDisposition(after, concernIdFor('s_search', 0)).state,
  'open',
  'first result unaffected by the second set'
);

// ── 5. computeReviewReadiness open/resolved math ─────────────────────────────
console.log('\n== computeReviewReadiness math ==');
let r = computeReviewReadiness(bd);
// Auth: 2 concerns, Search: 1, Footer: 0 -> total 3, all open initially
eq(r.totalConcerns, 3, 'totalConcerns = 3 (2 + 1 + 0)');
eq(r.openConcerns, 3, 'openConcerns = 3 (all open initially)');
eq(r.resolvedConcerns, 0, 'resolvedConcerns = 0 initially');
// storiesNeedingReview: Auth (open + cross), Search (open + warning), Footer (none) -> 2
eq(r.storiesNeedingReview, 2, 'storiesNeedingReview = 2 (Auth + Search)');
eq(r.perFeature.length, 3, 'perFeature has an entry per feature');
// weight-sorted desc: Auth (cross + high concern + high prio + big) must be #1
eq(r.perFeature[0].name, 'Auth', 'perFeature sorted by weight desc -> Auth first');
ok(r.perFeature[0].weight >= r.perFeature[1].weight, 'perFeature weights are descending');
// landmine surfaces the Auth COMPLIANCE high concern
ok(r.landmine !== null, 'landmine present (Auth COMPLIANCE high)');
eq(r.landmine.type, 'COMPLIANCE', 'landmine.type = COMPLIANCE');

// resolve one of Auth's concerns -> resolved count moves
const bd1 = setConcernDisposition(bd, concernIdFor('s_auth', 1), 'accepted');
r = computeReviewReadiness(bd1);
eq(r.openConcerns, 2, 'openConcerns = 2 after resolving one');
eq(r.resolvedConcerns, 1, 'resolvedConcerns = 1 after resolving one');
// Auth still needs review (concern 0 still open + cross indicator)
eq(r.storiesNeedingReview, 2, 'Auth still needs review (open concern + cross)');

// resolve ALL of Auth's concerns -> Auth is now REVIEWED (a flagged ✗ story with 0 open concerns is
// "reviewed": the human addressed every AI concern). Auth DROPS from storiesNeedingReview; only Search
// (still has an open concern) remains.
let bd2 = setConcernDisposition(bd1, concernIdFor('s_auth', 0), 'dismissed', 'legal signed off');
r = computeReviewReadiness(bd2);
eq(r.openConcerns, 1, 'openConcerns = 1 (only Search left)');
eq(
  r.storiesNeedingReview,
  1,
  'Auth is now REVIEWED (✗ with all concerns resolved) -> only Search still needs review'
);
// Auth's perFeature entry is flagged reviewed; its ORIGINAL ✗ indicator is preserved.
const auth2 = r.perFeature.find((p) => p.name === 'Auth');
eq(auth2.reviewed, true, 'Auth.reviewed === true (✗ story, all concerns resolved)');
eq(auth2.indicator, '✗', 'Auth original ✗ indicator preserved (reviewed does not rewrite it)');

// resolve Search too -> BOTH flagged stories are now reviewed -> nothing needs review.
let bd3 = setConcernDisposition(bd2, concernIdFor('s_search', 0), 'accepted');
r = computeReviewReadiness(bd3);
eq(r.openConcerns, 0, 'openConcerns = 0 (all resolved)');
eq(r.resolvedConcerns, 3, 'resolvedConcerns = 3 (all)');
eq(
  r.storiesNeedingReview,
  0,
  'Auth (✗) + Search (⚠) both REVIEWED with 0 open concerns -> 0 need review'
);
eq(r.perFeature.find((p) => p.name === 'Auth').reviewed, true, 'Auth reviewed after full resolution');
eq(r.perFeature.find((p) => p.name === 'Search').reviewed, true, 'Search reviewed after full resolution');

// ── 5c. REVIEWED safeguards: a flagged story with NO concerns, and an unrated story, do NOT flip ──
console.log('\n== reviewed safeguards ==');
// (a) a ✗ story with concerns ALL resolved -> reviewed, NOT counted (covered above; assert explicitly).
const bdResolved = {
  features: [
    feature({ name: 'Resolved', _uid: 's_res', _orig_name: 'Resolved', confidence_indicator: '✗',
      concerns: ['[RISK|high] Something risky.'] }),
  ],
};
const bdResolvedDone = setConcernDisposition(bdResolved, concernIdFor('s_res', 0), 'accepted');
const rResolved = computeReviewReadiness(bdResolvedDone);
eq(rResolved.storiesNeedingReview, 0, '(a) ✗ story with all concerns resolved -> NOT in storiesNeedingReview');
eq(rResolved.perFeature.find((p) => p.name === 'Resolved').reviewed, true, '(a) its perFeature.reviewed === true');

// (b) a ✗ story with ZERO concerns -> nothing to resolve -> STILL counts, reviewed === false.
const bdNoConcerns = {
  features: [
    feature({ name: 'CrossNoConcerns', _uid: 's_ncc', _orig_name: 'CrossNoConcerns',
      confidence_indicator: '✗', concerns: [] }),
  ],
};
const rNoConcerns = computeReviewReadiness(bdNoConcerns);
eq(rNoConcerns.storiesNeedingReview, 1, '(b) ✗ story with ZERO concerns STILL needs review (nothing to resolve)');
eq(rNoConcerns.perFeature[0].reviewed, false, '(b) reviewed === false (a flagged story with no concerns is not "reviewed")');

// (c) an unrated story with 0 concerns -> no indicator -> STILL counts, reviewed === false.
const bdUnratedNoConcerns = {
  features: [
    feature({ name: 'UnratedEmpty', _uid: 's_ue', _orig_name: 'UnratedEmpty',
      confidence_indicator: undefined, concerns: [] }),
  ],
};
const rUnratedEmpty = computeReviewReadiness(bdUnratedNoConcerns);
eq(rUnratedEmpty.storiesNeedingReview, 1, '(c) unrated story (no indicator, 0 concerns) STILL needs review');
eq(rUnratedEmpty.perFeature[0].reviewed, false, '(c) reviewed === false (an unrated story is never "reviewed")');

// ── 5b. UNRATED stories count as needing review (fresh-army false-reassurance fix) ──
console.log('\n== unrated counts as needing review ==');
const bdUnrated = {
  features: [
    feature({ name: 'Rated', _uid: 's_rated', _orig_name: 'Rated', confidence_indicator: '✓', concerns: [] }),
    feature({ name: 'Unrated', _uid: 's_unrated', _orig_name: 'Unrated', confidence_indicator: undefined, concerns: [] }),
  ],
};
const rUnrated = computeReviewReadiness(bdUnrated);
eq(rUnrated.storiesNeedingReview, 1, 'an UNRATED story (no indicator, 0 concerns) counts; the ✓ story does not');

// ── 6. orphaned disposition entries are IGNORED ──────────────────────────────
console.log('\n== orphaned disposition entries ==');
// disposition for a deleted feature + an out-of-range index -> must not change counts
let bdOrphan = setConcernDisposition(bd, concernIdFor('s_deleted', 0), 'accepted');
bdOrphan = setConcernDisposition(bdOrphan, concernIdFor('s_auth', 99), 'dismissed', 'x');
const rOrphan = computeReviewReadiness(bdOrphan);
eq(rOrphan.totalConcerns, 3, 'orphaned entries do not inflate totalConcerns');
eq(rOrphan.openConcerns, 3, 'orphaned entries do not change openConcerns (real concerns still open)');
eq(rOrphan.resolvedConcerns, 0, 'orphaned entries do not fake resolved concerns');

// ── 7. wouldCreateCycle ──────────────────────────────────────────────────────
console.log('\n== wouldCreateCycle ==');
// Graph: B depends on A (B -> A). C depends on nothing.
function cycleBreakdown() {
  return {
    features: [
      feature({ name: 'A', _uid: 's_A', _orig_name: 'A', dependencies: [] }),
      feature({ name: 'B', _uid: 's_B', _orig_name: 'B', dependencies: ['A'] }),
      feature({ name: 'C', _uid: 's_C', _orig_name: 'C', dependencies: [] }),
    ],
  };
}
const cg = cycleBreakdown();
// self-edge A -> A is a cycle
eq(wouldCreateCycle(cg, 'A', 'A'), true, 'self-edge A->A is a cycle');
// adding A -> B when B -> A already exists closes a loop
eq(wouldCreateCycle(cg, 'A', 'B'), true, 'A->B closes a loop (B->A exists)');
// adding A -> C is acyclic (C reaches nothing)
eq(wouldCreateCycle(cg, 'A', 'C'), false, 'A->C is acyclic');
// adding C -> A is acyclic (A reaches nothing back to C)
eq(wouldCreateCycle(cg, 'C', 'A'), false, 'C->A is acyclic');

// transitive: C -> B -> A. Adding A -> C closes the transitive loop.
function transitiveBreakdown() {
  return {
    features: [
      feature({ name: 'A', _uid: 's_A', _orig_name: 'A', dependencies: [] }),
      feature({ name: 'B', _uid: 's_B', _orig_name: 'B', dependencies: ['A'] }),
      feature({ name: 'C', _uid: 's_C', _orig_name: 'C', dependencies: ['B'] }),
    ],
  };
}
const tg = transitiveBreakdown();
eq(wouldCreateCycle(tg, 'A', 'C'), true, 'A->C closes a TRANSITIVE loop (C->B->A)');
eq(wouldCreateCycle(tg, 'A', 'B'), true, 'A->B closes a loop (B->A directly)');
eq(wouldCreateCycle(tg, 'C', 'A'), false, 'C->A is still acyclic in the transitive graph');

// rename case: dependency edges key on _orig_name, so a CURRENT-name rename must
// not change the cycle result. Rename B's display name; the edge B->A frozen on
// _orig_name 'A' still holds.
const renamed = {
  features: [
    feature({ name: 'Authentication (renamed)', _uid: 's_A', _orig_name: 'A', dependencies: [] }),
    feature({ name: 'Login Flow (renamed)', _uid: 's_B', _orig_name: 'B', dependencies: ['A'] }),
  ],
};
eq(
  wouldCreateCycle(renamed, 'A', 'B'),
  true,
  'cycle keyed on _orig_name survives a display rename (A->B still closes B->A)'
);

// pre-existing cycle in data must not hang (visited-set guard): A->B, B->A already
const preexisting = {
  features: [
    feature({ name: 'A', _uid: 's_A', _orig_name: 'A', dependencies: ['B'] }),
    feature({ name: 'B', _uid: 's_B', _orig_name: 'B', dependencies: ['A'] }),
  ],
};
eq(wouldCreateCycle(preexisting, 'A', 'C'), false, 'pre-existing A<->B cycle does not hang; A->C unaffected');

// guards
eq(wouldCreateCycle(null, 'A', 'B'), false, 'null breakdown -> false (guard)');
eq(wouldCreateCycle(cg, null, 'B'), false, 'null source -> false (guard)');

// capabilities-shaped graph is read too
const capsGraph = {
  capabilities: [
    { name: 'Cat', features: [
      feature({ name: 'A', _uid: 's_A', _orig_name: 'A', dependencies: [] }),
      feature({ name: 'B', _uid: 's_B', _orig_name: 'B', dependencies: ['A'] }),
    ] },
  ],
};
eq(wouldCreateCycle(capsGraph, 'A', 'B'), true, 'capabilities-shaped graph read for cycle check');

// ── 8. shared-AC exact-id match (the data-loss bug we kill) ───────────────────
console.log('\n== acIsSharedFor / sharedAcInjected ==');
const sharedItem = { id: 'shared-0', text: 'All screens must be responsive.', assigned_feature: 's_auth' };
eq(
  sharedAcInjected(sharedItem),
  'shared-0: All screens must be responsive.',
  'sharedAcInjected builds `${id}: ${text}`'
);
// the injected string is matched
eq(acIsSharedFor(sharedAcInjected(sharedItem), sharedItem), true, 'injected string is matched by exact id');
// a hand-written AC with the SAME TEXT but NO `id: ` prefix is NOT matched (the bug)
eq(
  acIsSharedFor('All screens must be responsive.', sharedItem),
  false,
  'hand-written same-text AC (no id prefix) is NOT matched -> no data loss'
);
// a different id prefix is not matched
eq(
  acIsSharedFor('shared-1: All screens must be responsive.', sharedItem),
  false,
  'different id prefix is not matched'
);
// prefix must be exactly `id: ` (with the space + colon), not a longer id sharing a prefix
eq(
  acIsSharedFor('shared-01: something', { id: 'shared-0', text: 'x' }),
  false,
  'shared-01 is NOT matched by shared-0 (exact `id: ` prefix, not startsWith on the id alone)'
);
// non-string / missing-id guards
eq(acIsSharedFor(null, sharedItem), false, 'non-string acString -> false');
eq(acIsSharedFor('shared-0: x', { text: 'x' }), false, 'item with no id -> false');

// ── 9. findFeatureByUid ──────────────────────────────────────────────────────
console.log('\n== findFeatureByUid ==');
const fb = makeBreakdown();
ok(findFeatureByUid(fb, 's_auth') && findFeatureByUid(fb, 's_auth').name === 'Auth', 'finds native-v3 feature by uid');
eq(findFeatureByUid(fb, 's_missing'), null, 'missing uid -> null');
eq(findFeatureByUid(null, 's_auth'), null, 'null breakdown -> null');
eq(findFeatureByUid(fb, null), null, 'null uid -> null');
// capabilities-shaped lookup
const capsBd = {
  capabilities: [
    { name: 'Cat1', features: [feature({ name: 'X', _uid: 's_x', _orig_name: 'X' })] },
    { name: 'Cat2', features: [feature({ name: 'Y', _uid: 's_y', _orig_name: 'Y' })] },
  ],
};
ok(findFeatureByUid(capsBd, 's_y') && findFeatureByUid(capsBd, 's_y').name === 'Y', 'finds feature across capabilities');

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);
