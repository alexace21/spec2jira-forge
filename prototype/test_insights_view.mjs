/**
 * Offline test for computeInsightsView (static/hello-world/src/lib/v3Schema.js).
 *
 * Plain-Node ESM, self-contained fixtures. Run:
 *   node prototype/test_insights_view.mjs
 *
 * Asserts:
 *   1. The WEIGHT ORDERING INVARIANT — a low-confidence(✗) OR high-severity,
 *      high-priority, large feature outranks a high-confidence, low-priority,
 *      small one (the ML-Anomaly ✗·13SP·Cx5·High row lands at #1).
 *   2. A high-severity concern on an otherwise-✓ feature still lands in flagged.
 *   3. Shape counts, categories, sizing spread (healthy vs uniform), legacy,
 *      all-unrated, and the compliance landmine.
 */
import {
  computeInsightsView,
  computeFeatureWeight,
  INSIGHTS_WEIGHTS,
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

// ── Fixture: a native-v3 breakdown (breakdown.features present) ──────────────
function feature(over) {
  return {
    name: 'Feature',
    category: 'Core',
    story_points: 3,
    complexity_score: 2,
    priority: 'Medium',
    confidence_score: 80,
    confidence_indicator: '✓',
    concerns: [],
    tasks: [],
    acceptance_criteria: [],
    dependencies: [],
    _uid: 's_' + Math.random().toString(36).slice(2),
    source_heading: 'H',
    ...over,
  };
}

const mlAnomaly = feature({
  name: 'ML Anomaly Detection',
  category: 'ML',
  story_points: 13,
  complexity_score: 5,
  priority: 'High',
  confidence_score: 58,
  confidence_indicator: '✗',
  concerns: ['[RISK|high] The anomaly thresholds are unspecified.'],
});

const tinyConfident = feature({
  name: 'Static Footer Link',
  category: 'UI',
  story_points: 1,
  complexity_score: 1,
  priority: 'Low',
  confidence_score: 98,
  confidence_indicator: '✓',
  concerns: [],
});

const midAmbiguity = feature({
  name: 'Search Filters',
  category: 'UI',
  story_points: 5,
  complexity_score: 3,
  priority: 'Medium',
  confidence_score: 72,
  confidence_indicator: '⚠',
  concerns: ['[AMBIGUITY|medium] Filter persistence across sessions is unclear.'],
});

// otherwise-✓ but carries a HIGH concern → must still be flagged (W_SEV term)
const greenButLandmine = feature({
  name: 'Payment Ledger Export',
  category: 'Finance',
  story_points: 8,
  complexity_score: 4,
  priority: 'High',
  confidence_score: 90,
  confidence_indicator: '✓',
  concerns: ['[COMPLIANCE|high] Exports PII to a third party — GDPR boundary.'],
});

const breakdown = {
  epic: { summary: 'Test Epic' },
  metadata: { overall_quality: 'medium', spec_summary: 'A test spec', ambiguity_note: 'Some ambiguity.' },
  spec_concerns: ['[ASSUMPTION|medium] Assumes a single-region deployment.'],
  shared_acceptance_criteria: ['All screens must be responsive.'],
  features: [mlAnomaly, tinyConfident, midAmbiguity, greenButLandmine],
};

console.log('== computeInsightsView: main fixture ==');
const view = computeInsightsView(breakdown);

// ── 1. WEIGHT ORDERING INVARIANT ─────────────────────────────────────────────
console.log('\n-- weight ordering invariant --');
ok(view.flagged.length >= 1, 'flagged is non-empty');
eq(view.flagged[0].name, 'ML Anomaly Detection', 'ML-Anomaly (✗·13SP·Cx5·High) ranks #1');
// tinyConfident must NOT be flagged (✓, no concern) → it is in confident
ok(
  !view.flagged.some((f) => f.name === 'Static Footer Link'),
  'tiny ✓ no-concern feature is NOT flagged'
);
ok(
  view.confident.some((c) => c.name === 'Static Footer Link'),
  'tiny ✓ no-concern feature IS in confident'
);
// Direct weight comparison of the two anchors
const wMl = computeFeatureWeight({
  confidence_indicator: '✗',
  confidence_score: 58,
  priority: 'High',
  story_points: 13,
  complexity_score: 5,
  concerns: [{ severity: 'high' }],
});
const wTiny = computeFeatureWeight({
  confidence_indicator: '✓',
  confidence_score: 98,
  priority: 'Low',
  story_points: 1,
  complexity_score: 1,
  concerns: [],
});
ok(wMl > wTiny, `weight(ML-Anomaly)=${wMl.toFixed(3)} > weight(tiny)=${wTiny.toFixed(3)}`);

// ── 2. HIGH concern on a ✓ feature still gets flagged ────────────────────────
console.log('\n-- landmine under a green score --');
ok(
  view.flagged.some((f) => f.name === 'Payment Ledger Export'),
  '✓ feature with a HIGH concern is still flagged (W_SEV pulls it in)'
);

// ── 3. shape / categories / quality / confidence ─────────────────────────────
console.log('\n-- shape / categories / quality / confidence --');
eq(view.isLegacy, false, 'not legacy');
eq(view.shape.epics, 1, 'shape.epics = 1');
eq(view.shape.features, 4, 'shape.features = 4');
eq(view.shape.sharedACs, 1, 'shape.sharedACs = 1');
eq(view.quality.key, 'medium', 'quality.key = medium');
eq(view.quality.label, 'MEDIUM', 'quality.label = MEDIUM');
eq(view.confidence.confident, 2, 'confidence.confident = 2 (two ✓)');
eq(view.confidence.unsure, 1, 'confidence.unsure = 1 (one ⚠)');
eq(view.confidence.lowConf, 1, 'confidence.lowConf = 1 (one ✗)');
eq(view.confidence.unrated, 0, 'confidence.unrated = 0');
eq(view.confidence.total, 4, 'confidence.total = 4');
eq(view.categories.length, 3, 'categories: ML, UI, Finance = 3');

// ── 4. compliance landmine ───────────────────────────────────────────────────
console.log('\n-- compliance landmine --');
ok(view.complianceLandmine !== null, 'compliance landmine present');
eq(view.complianceLandmine.type, 'COMPLIANCE', 'landmine.type = COMPLIANCE');
eq(view.complianceLandmine.severity, 'high', 'landmine.severity = high');
eq(
  view.complianceLandmine.relatedFeatureName,
  'Payment Ledger Export',
  'landmine.relatedFeatureName carries the feature'
);
ok(!!view.complianceLandmine.relatedFeatureUid, 'landmine.relatedFeatureUid present');

// ── 5. concern fingerprint ───────────────────────────────────────────────────
console.log('\n-- concern fingerprint --');
// spec: ASSUMPTION x1 ; features: RISK x1, AMBIGUITY x1, COMPLIANCE x1  → total 4
eq(view.concernFingerprint.total, 4, 'fingerprint total = 4');
ok(
  view.concernFingerprint.items.some((i) => i.type === 'COMPLIANCE' && i.isCompliance),
  'fingerprint marks COMPLIANCE isCompliance'
);
ok(typeof view.concernFingerprint.narrative === 'string', 'fingerprint narrative is a string');

// ── 6. sizing spread (healthy) ───────────────────────────────────────────────
console.log('\n-- sizing spread (healthy) --');
// SP values: 13,1,5,8 → 4 distinct → healthy
eq(view.sizingSpread.healthy, true, 'healthy spread (4 distinct SP values)');
eq(view.sizingSpread.complexity.min, 1, 'complexity.min = 1');
eq(view.sizingSpread.complexity.max, 5, 'complexity.max = 5');
eq(view.sizingSpread.priority.high, 2, 'priority.high = 2 (ML + Ledger)');
eq(view.sizingSpread.priority.medium, 1, 'priority.medium = 1 (midAmbiguity)');
eq(view.sizingSpread.priority.low, 1, 'priority.low = 1 (tiny)');
eq(view.sizingSpread.storyPoints.length, 4, '4 distinct SP buckets');
eq(view.sizingSpread.storyPoints[0].sp, 1, 'SP buckets ascending (first = 1)');

// ── 7. uniform sizing → NOT healthy ──────────────────────────────────────────
console.log('\n== uniform sizing fixture ==');
const uniform = computeInsightsView({
  features: [
    feature({ name: 'A', story_points: 5, complexity_score: 3 }),
    feature({ name: 'B', story_points: 5, complexity_score: 3 }),
    feature({ name: 'C', story_points: 5, complexity_score: 3 }),
  ],
});
eq(uniform.sizingSpread.healthy, false, 'all-5s is NOT healthy (uniform)');
eq(uniform.sizingSpread.storyPoints.length, 1, 'one SP bucket for all-5s');

// ── 8. legacy (no v3 signals at all) ─────────────────────────────────────────
console.log('\n== legacy fixture ==');
const legacy = computeInsightsView({
  features: [
    { name: 'Old A', category: 'X', tasks: [], acceptance_criteria: [], dependencies: [] },
    { name: 'Old B', category: 'X', tasks: [], acceptance_criteria: [], dependencies: [] },
  ],
});
eq(legacy.isLegacy, true, 'no quality + no indicators + no concerns → isLegacy');
eq(legacy.verdict.tone, 'legacy', 'verdict.tone = legacy');
eq(legacy.flagged.length, 0, 'legacy has no flagged');

// ── 9. all-unrated (the missing bin) ─────────────────────────────────────────
console.log('\n== all-unrated fixture ==');
const unrated = computeInsightsView({
  metadata: { overall_quality: 'medium' }, // quality present but no indicators
  features: [
    feature({ name: 'U1', confidence_indicator: undefined, confidence_score: undefined, concerns: [] }),
    feature({ name: 'U2', confidence_indicator: undefined, confidence_score: undefined, concerns: [] }),
  ],
});
eq(unrated.confidence.unrated, 2, 'all-unrated: unrated = 2');
eq(unrated.confidence.total, 2, 'all-unrated: total = 2');
eq(unrated.verdict.tone, 'unrated', 'verdict.tone = unrated (rated nothing)');
eq(unrated.isLegacy, false, 'quality present → NOT legacy even if all-unrated');

// ── 10. legacy-adapted shape (capabilities) is read too ──────────────────────
console.log('\n== legacy-adapted (capabilities) fixture ==');
const adapted = computeInsightsView({
  capabilities: [
    { name: 'Cat1', features: [mlAnomaly, midAmbiguity] },
    { name: 'Cat2', features: [tinyConfident] },
  ],
  _v3_original: { features: [mlAnomaly, midAmbiguity, tinyConfident] },
});
eq(adapted.shape.features, 3, 'capabilities flatMap read → 3 features');
eq(adapted.flagged[0].name, 'ML Anomaly Detection', 'ranking holds through capabilities read');

// ── coefficients sanity ──────────────────────────────────────────────────────
console.log('\n== coefficients ==');
const sumCoeff =
  INSIGHTS_WEIGHTS.W_CONF + INSIGHTS_WEIGHTS.W_SEV + INSIGHTS_WEIGHTS.W_PRIO + INSIGHTS_WEIGHTS.W_SIZE;
ok(Math.abs(sumCoeff - 1.0) < 1e-9, `coefficients sum to 1.0 (got ${sumCoeff})`);

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);
