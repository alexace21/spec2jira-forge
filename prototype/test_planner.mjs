#!/usr/bin/env node
/**
 * Offline test for the Capacity-Sheet Planner pure-function core (src/planner.js).
 * Covers EVERY must-fix from the 2026-06-19 adversarial pitfalls ledger (CAP/SIZE/GRAPH/LLM/PACK/UX).
 * Pure functions → runs under plain node:  node prototype/test_planner.mjs
 */
import {
  computeCapacity, validateSizing, buildPlannerGraph, topoSortAndCycles, computeSchedulingSignals,
  normalizeRanking, packSprints, estimatePlanCost, planSourceHash, assemblePlan, featureId,
  priorityRankOf, complexityRankOf, buildRankingRows, planRankingMaxTokens,
  parseConcernType, computeRiskSignals, computeSprintRiskProfile, summarizeSpecConcerns, diffPlans,
  SKILL_BUCKETS, TASK_TYPE_TO_SKILL, requiredSkillsOf, apportionPoints, featureSkillSplit,
  DEFAULT_FOCUS_FACTOR, DEFAULT_HOURS_PER_DAY, DEFAULT_HOURS_PER_POINT, MAX_SPRINTS,
  computeThroughput, packBacklogReach, REACH_CONSERVATIVE_FACTOR, REACH_OPTIMISTIC_FACTOR,
  buildRationaleMap, RATIONALE_MAX_CHARS, computeCriticalPathUids,
} from '../src/planner.js';
import { buildPlanRankingUserPrompt, objectiveClause, PLAN_OBJECTIVES } from '../src/prompts.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`  XX  ${name}`); }
}
const approx = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const hasErr = (r, code) => r.errors.some((e) => e.code === code);
const hasWarn = (r, code) => r.warnings.some((w) => w.code === code);
const mkF = (uid, name, sp, prio = 'Medium', deps = [], cx = 3, origName) =>
  ({ _uid: uid, _orig_name: origName || name, name, story_points: sp, priority: prio, dependencies: deps, complexity_score: cx });
const idFn = () => (f, i) => featureId(f, i); // positional — matches buildPlannerGraph's idByIndex keying

// ════════════════ 1. computeCapacity (CAP-*) ════════════════
console.log('\ncomputeCapacity — fail-loud form validation:');
{
  const ok = computeCapacity({ people: [{ name: 'A', availableDays: 10 }, { name: 'B', availableDays: 10 }], sprintCount: 3, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 });
  check('valid team → ok', ok.ok === true);
  check('CAP: 2×10×6×0.7/6 = 14 pts/sprint', approx(ok.perSprintCapacityPoints[0], 14));
  check('per-sprint array length = sprintCount', ok.perSprintCapacityPoints.length === 3);
  check('totalCapacity = 14×3 = 42', approx(ok.totalCapacityPoints, 42));

  const zero1 = computeCapacity({ people: [], sprintCount: 2, sprintLengthDays: 10 });
  check('CAP-1 empty roster → ZERO_CAPACITY', !zero1.ok && hasErr(zero1, 'ZERO_CAPACITY'));
  const zero2 = computeCapacity({ people: [{ name: 'A', availableDays: 0 }], sprintCount: 2, sprintLengthDays: 10 });
  check('CAP-1 all days 0 → ZERO_CAPACITY', !zero2.ok && hasErr(zero2, 'ZERO_CAPACITY'));

  check('CAP-2 focusFactor 0 → INVALID_FOCUS_FACTOR', hasErr(computeCapacity({ people: [{ name: 'A', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10, focusFactor: 0 }), 'INVALID_FOCUS_FACTOR'));
  check('CAP-2 focusFactor 70 (unit trap) → INVALID', hasErr(computeCapacity({ people: [{ name: 'A', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10, focusFactor: 70 }), 'INVALID_FOCUS_FACTOR'));
  check('CAP-2 focusFactor 1.0 → ok (boundary)', computeCapacity({ people: [{ name: 'A', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10, focusFactor: 1 }).ok === true);
  check('CAP-2 focusFactor negative → INVALID', hasErr(computeCapacity({ people: [{ name: 'A', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10, focusFactor: -0.5 }), 'INVALID_FOCUS_FACTOR'));

  check("CAP-5 availableDays '' → INVALID (not silent 0)", hasErr(computeCapacity({ people: [{ name: 'A', availableDays: '' }], sprintCount: 1, sprintLengthDays: 10 }), 'INVALID_AVAILABLE_DAYS'));
  check("CAP-5 availableDays 'abc' → INVALID", hasErr(computeCapacity({ people: [{ name: 'A', availableDays: 'abc' }], sprintCount: 1, sprintLengthDays: 10 }), 'INVALID_AVAILABLE_DAYS'));
  check("CAP-5 availableDays '7' (numeric string) → ok", computeCapacity({ people: [{ name: 'A', availableDays: '7' }], sprintCount: 1, sprintLengthDays: 10 }).ok === true);

  check('CAP-6 sprintCount 0 → INVALID_SPRINT_COUNT', hasErr(computeCapacity({ people: [{ name: 'A', availableDays: 5 }], sprintCount: 0, sprintLengthDays: 10 }), 'INVALID_SPRINT_COUNT'));
  check('CAP-6 sprintCount 2.5 → INVALID', hasErr(computeCapacity({ people: [{ name: 'A', availableDays: 5 }], sprintCount: 2.5, sprintLengthDays: 10 }), 'INVALID_SPRINT_COUNT'));
  check('CAP-6 sprintCount 999 → TOO_LARGE', hasErr(computeCapacity({ people: [{ name: 'A', availableDays: 5 }], sprintCount: 999, sprintLengthDays: 10 }), 'SPRINT_COUNT_TOO_LARGE'));

  check('CAP-7 sprintLengthDays 0 → INVALID_SPRINT_LENGTH', hasErr(computeCapacity({ people: [{ name: 'A', availableDays: 5 }], sprintCount: 1, sprintLengthDays: 0 }), 'INVALID_SPRINT_LENGTH'));

  check('CAP-8 availableDays negative → INVALID', hasErr(computeCapacity({ people: [{ name: 'A', availableDays: -3 }], sprintCount: 1, sprintLengthDays: 10 }), 'INVALID_AVAILABLE_DAYS'));
  const clamp = computeCapacity({ people: [{ name: 'A', availableDays: 15 }], sprintCount: 1, sprintLengthDays: 10, hoursPerDay: 6, focusFactor: 0.7, hoursPerPoint: 6 });
  check('CAP-8 availableDays > sprintLength → clamped + warn', clamp.ok && hasWarn(clamp, 'AVAILABLE_DAYS_CLAMPED'));
  check('CAP-8 clamp uses sprintLength (10 not 15): 10×6×0.7/6=7', approx(clamp.perSprintCapacityPoints[0], 7));
  check('CAP-8 fractional days 7.5 allowed', computeCapacity({ people: [{ name: 'A', availableDays: 7.5 }], sprintCount: 1, sprintLengthDays: 10 }).ok === true);

  const ov = computeCapacity({ people: [{ name: 'A', availableDays: 10 }], sprintCount: 2, sprintLengthDays: 10, hoursPerDay: 6, focusFactor: 0.7, hoursPerPoint: 6, pointsPerSprintOverride: 40 });
  check('CAP-9 override → perSprint = 40 (precedence)', ov.ok && approx(ov.perSprintCapacityPoints[0], 40));
  check('CAP-9 override discrepancy warned (team≈7 vs 40)', hasWarn(ov, 'OVERRIDE_DISCREPANCY'));
  check('CAP-9 override 0 → INVALID_OVERRIDE', hasErr(computeCapacity({ people: [{ name: 'A', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10, pointsPerSprintOverride: 0 }), 'INVALID_OVERRIDE'));

  check('CAP-1 hoursPerPoint 0 → INVALID (divisor guard)', hasErr(computeCapacity({ people: [{ name: 'A', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10, hoursPerPoint: 0 }), 'INVALID_HOURS_PER_POINT'));

  const defs = computeCapacity({ people: [{ name: 'A', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10 });
  const ff = defs.assumptions.find((a) => a.key === 'focusFactor');
  check('CAP-3 defaults echoed with source=default', ff && ff.value === DEFAULT_FOCUS_FACTOR && ff.source === 'default');
  check('CAP-4 per-sprint contract surfaced in assumptions', defs.assumptions.some((a) => a.key === 'availableDaysContract'));

  const frac = computeCapacity({ people: [{ name: 'A', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10, hoursPerDay: 6, focusFactor: 0.7, hoursPerPoint: 5 });
  check('CAP-10 float capacity preserved (10×6×0.7/5 = 8.4, not rounded)', approx(frac.perSprintCapacityPoints[0], 8.4));

  const dup = computeCapacity({ people: [{ name: 'Sam', availableDays: 10 }, { name: 'Sam', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10, hoursPerDay: 6, focusFactor: 0.7, hoursPerPoint: 6 });
  check('CAP-13 duplicate name → warn', hasWarn(dup, 'DUPLICATE_PERSON_NAME'));
  check('CAP-13 duplicate still counts both (2×10 → 14)', approx(dup.perSprintCapacityPoints[0], 14));

  const multi = computeCapacity({ people: [{ name: 'A', availableDays: -1 }], sprintCount: 0, sprintLengthDays: 0, focusFactor: 5 });
  check('multiple errors collected at once (≥3)', !multi.ok && multi.errors.length >= 3);
}

// ════════════════ 2. validateSizing (SIZE-1) ════════════════
console.log('\nvalidateSizing — post-edit story points:');
{
  const feats = [mkF('u1', 'A', 5), mkF('u2', 'B', 0), mkF('u3', 'C', -3), mkF('u4', 'D', 5.5), { _uid: 'u5', name: 'E', dependencies: [] }];
  const r = validateSizing(feats, idFn(feats));
  check('valid SP in points map', r.points.get('u1') === 5);
  check('SIZE-1 SP 0 → unsized', r.unsized.some((u) => u.id === 'u2' && u.reason === 'invalid_story_points'));
  check('SIZE-1 SP negative → unsized', r.unsized.some((u) => u.id === 'u3'));
  check('SIZE-1 SP 5.5 non-integer → unsized', r.unsized.some((u) => u.id === 'u4'));
  check('SIZE-1 missing SP → unsized missing_story_points', r.unsized.some((u) => u.id === 'u5' && u.reason === 'missing_story_points'));
  check('SIZE-1 0-pt never enters points map (no fake-fit)', !r.points.has('u2'));
}

// ════════════════ 3. buildPlannerGraph (GRAPH-2/3/4/5) ════════════════
console.log('\nbuildPlannerGraph — uid keying + push parity:');
{
  const feats = [mkF('uA', 'A', 5), mkF('uB', 'B', 5, 'Medium', ['A'])];
  const g = buildPlannerGraph(feats);
  check('edge: B depends on A → blockers(B)={uA}', g.blockers.get('uB').has('uA'));
  check('edge: dependents(A)={uB}', g.dependents.get('uA').has('uB'));
  check('keyed by _uid not name', g.ids.includes('uA') && g.ids.includes('uB'));

  const dangling = buildPlannerGraph([mkF('uA', 'A', 5, 'Medium', ['Ghost'])]);
  check('GRAPH-2 dangling dep → danglingRefs (not silent)', dangling.danglingRefs.some((d) => d.missingDep === 'Ghost'));
  check('GRAPH-2 dangling → no phantom blocker edge', dangling.blockers.get('uA').size === 0);

  const amb = buildPlannerGraph([mkF('u1', 'Login', 5), mkF('u2', 'Login', 5), mkF('u3', 'C', 5, 'Medium', ['Login'])]);
  check('GRAPH-4 duplicate name → duplicateNames', amb.duplicateNames.some((d) => d.name === 'Login' && d.count === 2));
  check('GRAPH-4 dep to dup name → ambiguous (UNBOUND, parity)', amb.ambiguousDeps.some((a) => a.dep === 'Login'));
  check('GRAPH-4 ambiguous dep leaves no edge', amb.blockers.get('u3').size === 0);

  const self = buildPlannerGraph([mkF('uA', 'A', 5, 'Medium', ['A'])]);
  check('GRAPH-5 self-dep → selfDeps, no edge', self.selfDeps.length === 1 && self.blockers.get('uA').size === 0);

  // GRAPH-3 rename parity: A renamed (name='NewA') but _orig_name='OldA'; dep string is frozen 'OldA'
  const renamed = buildPlannerGraph([mkF('uA', 'NewA', 5, 'Medium', [], 3, 'OldA'), mkF('uB', 'B', 5, 'Medium', ['OldA'])]);
  check('GRAPH-3 rename: dep resolves via frozen _orig_name → uid (push parity)', renamed.blockers.get('uB').has('uA'));
}

// ════════════════ 4. topoSortAndCycles (GRAPH-1/6/8) ════════════════
console.log('\ntopoSortAndCycles — Kahn + cycle break:');
{
  const feats = [mkF('uC', 'C', 5, 'Medium', ['B']), mkF('uB', 'B', 5, 'Medium', ['A']), mkF('uA', 'A', 5)];
  const g = buildPlannerGraph(feats);
  const t = topoSortAndCycles(g, () => 0, () => 0);
  check('linear A→B→C topo order [uA,uB,uC]', JSON.stringify(t.order) === JSON.stringify(['uA', 'uB', 'uC']));
  check('no cycles → cyclicNodes empty', t.cyclicNodes.length === 0);

  const cyc = buildPlannerGraph([mkF('uA', 'A', 5, 'Medium', ['B']), mkF('uB', 'B', 5, 'Medium', ['A'])]);
  const tc = topoSortAndCycles(cyc, () => 0, () => 0);
  check('GRAPH-1 cycle → all nodes still in order (none vanish)', tc.order.length === 2);
  check('GRAPH-1 cycle → cyclicNodes non-empty', tc.cyclicNodes.length >= 1);
  check('GRAPH-1 cycle → cutEdges recorded', tc.cutEdges.length >= 1);

  const empty = topoSortAndCycles(buildPlannerGraph([]), () => 0, () => 0);
  check('GRAPH-6 empty graph → order []', empty.order.length === 0);

  // GRAPH-8 disconnected: two independent nodes, prefRank decides order
  const ind = buildPlannerGraph([mkF('uX', 'X', 5), mkF('uY', 'Y', 5)]);
  const prefY = (id) => (id === 'uY' ? 0 : 1);
  check('GRAPH-8 disconnected honours LLM prefRank tiebreak', topoSortAndCycles(ind, prefY, () => 0).order[0] === 'uY');
}

// ════════════════ 5. computeSchedulingSignals ════════════════
console.log('\ncomputeSchedulingSignals:');
{
  const g = buildPlannerGraph([mkF('uC', 'C', 5, 'Medium', ['B']), mkF('uB', 'B', 5, 'Medium', ['A']), mkF('uA', 'A', 5)]);
  const t = topoSortAndCycles(g, () => 0, () => 0);
  const s = computeSchedulingSignals(g, t.order);
  check('criticalPathLen A=1,B=2,C=3', s.get('uA').criticalPathLen === 1 && s.get('uB').criticalPathLen === 2 && s.get('uC').criticalPathLen === 3);
  check('downstreamUnblockCount A=2,B=1,C=0', s.get('uA').downstreamUnblockCount === 2 && s.get('uB').downstreamUnblockCount === 1 && s.get('uC').downstreamUnblockCount === 0);
  check('signals defined for every node', g.ids.every((id) => s.has(id)));
}

// ════════════════ 5.5 computeCriticalPathUids (plan data-contract: the single longest chain) ════════════════
console.log('\ncomputeCriticalPathUids — single longest dependency chain, root→end:');
{
  // linear A→B→C → the whole chain, ordered root→end
  const gLin = buildPlannerGraph([mkF('uC', 'C', 5, 'Medium', ['B']), mkF('uB', 'B', 5, 'Medium', ['A']), mkF('uA', 'A', 5)]);
  const tLin = topoSortAndCycles(gLin, () => 0, () => 0);
  const sLin = computeSchedulingSignals(gLin, tLin.order);
  const cpLin = computeCriticalPathUids(gLin, tLin.order, sLin);
  check('linear chain → [uA,uB,uC] (root→end)', JSON.stringify(cpLin) === JSON.stringify(['uA', 'uB', 'uC']));
  check('chain length === max criticalPathLen (N deep)', cpLin.length === 3);

  // branch/diamond: A→B→D and A→C→D; a longest chain is length 3, deterministic tie-break by uid picks uB over uC
  const gDia = buildPlannerGraph([mkF('uA', 'A', 5), mkF('uB', 'B', 5, 'Medium', ['A']), mkF('uC', 'C', 5, 'Medium', ['A']), mkF('uD', 'D', 5, 'Medium', ['B', 'C'])]);
  const tDia = topoSortAndCycles(gDia, () => 0, () => 0);
  const sDia = computeSchedulingSignals(gDia, tDia.order);
  const cpDia = computeCriticalPathUids(gDia, tDia.order, sDia);
  check('diamond → a length-3 chain ending at uD', cpDia.length === 3 && cpDia[cpDia.length - 1] === 'uD' && cpDia[0] === 'uA');
  check('diamond → deterministic tie-break picks uB (smallest uid) not uC', cpDia.includes('uB') && !cpDia.includes('uC'));
  check('diamond → every hop is a real edge (each step blocks the next)', cpDia.every((id, i) => i === 0 || gDia.blockers.get(cpDia[i]).has(cpDia[i - 1])));

  // no dependencies → no chain of length >= 2 → []
  const gFlat = buildPlannerGraph([mkF('uX', 'X', 5), mkF('uY', 'Y', 5)]);
  const tFlat = topoSortAndCycles(gFlat, () => 0, () => 0);
  const sFlat = computeSchedulingSignals(gFlat, tFlat.order);
  check('no dependencies → [] (no critical path to name)', computeCriticalPathUids(gFlat, tFlat.order, sFlat).length === 0);

  // empty graph → []
  check('empty graph → []', computeCriticalPathUids(buildPlannerGraph([]), [], new Map()).length === 0);

  // cyclic input → no crash, excludes the cut edge (a blocker that sits AFTER in the acyclic order)
  const gCyc = buildPlannerGraph([mkF('uA', 'A', 5, 'Medium', ['B']), mkF('uB', 'B', 5, 'Medium', ['A'])]);
  const tCyc = topoSortAndCycles(gCyc, () => 0, () => 0);
  const sCyc = computeSchedulingSignals(gCyc, tCyc.order);
  const cpCyc = computeCriticalPathUids(gCyc, tCyc.order, sCyc);
  check('cyclic → no crash, array returned', Array.isArray(cpCyc));
  check('cyclic → no duplicate uid (cut edge not followed → no loop)', new Set(cpCyc).size === cpCyc.length);
  check('cyclic → length bounded by node count', cpCyc.length <= gCyc.ids.length);
  check('cyclic → the cut edge is excluded (order-position, not the raw back-edge)', cpCyc.every((id, i) => i === 0 || tCyc.order.indexOf(cpCyc[i - 1]) < tCyc.order.indexOf(id)));

  // surfaced on the assembled plan (both methodologies)
  const capCp = computeCapacity({ people: [{ name: 'A', availableDays: 10 }], sprintCount: 2, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 });
  const featsCp = [mkF('uA', 'A', 3), mkF('uB', 'B', 3, 'Medium', ['A']), mkF('uC', 'C', 3, 'Medium', ['B'])];
  const planCp = assemblePlan({ features: featsCp, capacity: capCp, ranking: null });
  check('assemblePlan (scrum): criticalPathUids present = [uA,uB,uC]', JSON.stringify(planCp.criticalPathUids) === JSON.stringify(['uA', 'uB', 'uC']));
  const thrCp = computeThroughput({ people: [{ name: 'A', availableDays: 40 }], focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 });
  const planCpK = assemblePlan({ features: featsCp, capacity: thrCp, ranking: null, methodology: 'kanban' });
  check('assemblePlan (kanban): criticalPathUids present too', JSON.stringify(planCpK.criticalPathUids) === JSON.stringify(['uA', 'uB', 'uC']));
}

// ════════════════ 5.6 buildRationaleMap (plan data-contract: uid → Claude's "why here") ════════════════
console.log('\nbuildRationaleMap — compact uid→rationale, honest structural absence:');
{
  const sparse = buildRationaleMap([
    { feature_id: 'uA', rank: 1, rationale: 'pulled early: unblocks 4 features' },
    { feature_id: 'uB', rank: 2 }, // no rationale (obvious placement) → omitted
    { feature_id: 'uC', rank: 3, rationale: '   ' }, // whitespace-only → omitted (no hollow "no reason")
    { feature_id: 'uD', rank: 4, rationale: 'deferred: depends on the external SDK' },
  ]);
  check('sparse: only rationale-bearing entries', JSON.stringify(Object.keys(sparse).sort()) === JSON.stringify(['uA', 'uD']));
  check('sparse: uA rationale preserved', sparse.uA === 'pulled early: unblocks 4 features');
  check('sparse: empty-string rationale omitted', !('uC' in sparse));
  check('sparse: missing rationale omitted', !('uB' in sparse));

  check('null ranking → {} (deterministic-fallback structural absence)', JSON.stringify(buildRationaleMap(null)) === '{}');
  check('undefined ranking → {}', JSON.stringify(buildRationaleMap(undefined)) === '{}');
  check('empty array → {}', JSON.stringify(buildRationaleMap([])) === '{}');
  check('non-array → {} (no throw)', JSON.stringify(buildRationaleMap('nope')) === '{}');

  // trimming + capping
  const trimmed = buildRationaleMap([{ feature_id: 'uA', rationale: '  spaced out  ' }]);
  check('rationale is trimmed', trimmed.uA === 'spaced out');
  const longStr = 'x'.repeat(RATIONALE_MAX_CHARS + 250);
  const capped = buildRationaleMap([{ feature_id: 'uA', rationale: longStr }]);
  check('long rationale capped to RATIONALE_MAX_CHARS', capped.uA.length === RATIONALE_MAX_CHARS);

  // defensive: garbage rows ignored; duplicate feature_id → first wins
  const garbage = buildRationaleMap([null, 42, { rank: 1 }, { feature_id: 5, rationale: 'x' }, { feature_id: 'uA', rationale: 'first' }, { feature_id: 'uA', rationale: 'second' }]);
  check('garbage rows ignored, valid kept', JSON.stringify(Object.keys(garbage)) === JSON.stringify(['uA']));
  check('duplicate feature_id → first rationale wins', garbage.uA === 'first');
}

// ════════════════ 6. normalizeRanking (LLM-1/2) ════════════════
console.log('\nnormalizeRanking — advisory LLM made TOTAL:');
{
  const g = buildPlannerGraph([mkF('uA', 'A', 5, 'High'), mkF('uB', 'B', 5, 'Low'), mkF('uC', 'C', 5, 'Medium')]);
  const t = topoSortAndCycles(g, () => 0, () => 0);
  const sig = computeSchedulingSignals(g, t.order);
  const pr = (id) => priorityRankOf(g.byId.get(id));
  const cx = (id) => complexityRankOf(g.byId.get(id));

  const good = normalizeRanking([{ feature_id: 'uC' }, { feature_id: 'uA' }, { feature_id: 'uB' }], g, sig, pr, cx);
  check('valid ranking preserved by array position', JSON.stringify(good.preferenceOrder) === JSON.stringify(['uC', 'uA', 'uB']));

  const unk = normalizeRanking([{ feature_id: 'GHOST' }, { feature_id: 'uA' }], g, sig, pr, cx);
  check('LLM-1 unknown id dropped → unknownIds', unk.unknownIds.includes('GHOST'));
  check('LLM-1 unknown not in order', !unk.preferenceOrder.includes('GHOST'));

  const dupd = normalizeRanking([{ feature_id: 'uA' }, { feature_id: 'uA' }, { feature_id: 'uB' }], g, sig, pr, cx);
  check('LLM-1 duplicate id deduped', dupd.duplicateIds.includes('uA') && dupd.preferenceOrder.filter((x) => x === 'uA').length === 1);

  const partial = normalizeRanking([{ feature_id: 'uB' }], g, sig, pr, cx);
  check('LLM-1 omitted features appended (NONE dropped)', partial.preferenceOrder.length === 3 && partial.omittedIds.length === 2);
  check('LLM-1 omitted appended after the ranked one', partial.preferenceOrder[0] === 'uB');

  const emptyR = normalizeRanking([], g, sig, pr, cx);
  check('LLM-2 empty ranking → usedLlm false', emptyR.usedLlm === false);
  check('LLM-2 empty → fallback covers all features', emptyR.preferenceOrder.length === 3);
  check('LLM-2 fallback orders by priority (High uA first)', emptyR.preferenceOrder[0] === 'uA');

  const garbageRank = normalizeRanking([{ feature_id: 'uB', rank: 999 }, { feature_id: 'uA', rank: 999 }], g, sig, pr, cx);
  check('LLM-1 order from ARRAY POSITION, ignores garbage rank int', garbageRank.preferenceOrder[0] === 'uB');
}

// ════════════════ 7. packSprints (PACK-1..10) ════════════════
console.log('\npackSprints — readiness-gated greedy:');
{
  const packWith = (feats, caps, pref) => {
    const g = buildPlannerGraph(feats);
    const sz = validateSizing(feats, idFn(feats));
    const order = pref || g.ids;
    return { g, res: packSprints(order, caps, g, sz.points, sz.unsized) };
  };

  // basic front-load
  {
    const { res } = packWith([mkF('uA', 'A', 5), mkF('uB', 'B', 3)], [8, 8]);
    check('basic: both fit sprint 0 (front-load)', res.sprints[0].ids.length === 2 && res.sprints[1].ids.length === 0);
    check('basic: no overflow', res.overflow.length === 0);
  }

  // PACK-1 oversized force-place
  {
    const { res } = packWith([mkF('uA', 'A', 13)], [8, 8]);
    check('PACK-1 oversized (13 > 8) force-placed', res.sprints[0].ids.includes('uA'));
    check('PACK-1 oversized sprint flagged overCapacity', res.sprints[0].overCapacity === true);
    check('PACK-1 oversized recorded distinctly', res.oversized.some((o) => o.id === 'uA'));
    check('PACK-1 oversized NOT dumped to overflow', !res.overflow.some((o) => o.id === 'uA'));
  }

  // PACK-2 cross-sprint readiness: B depends A; A fills sprint0 → B cannot be in sprint0
  {
    const { res } = packWith([mkF('uA', 'A', 8), mkF('uB', 'B', 5, 'High', ['A'])], [8, 8], ['uB', 'uA']);
    const sA = res.sprints.findIndex((s) => s.ids.includes('uA'));
    const sB = res.sprints.findIndex((s) => s.ids.includes('uB'));
    check('PACK-2 A placed sprint 0', sA === 0);
    check('PACK-2 B (preferred but blocked) lands AFTER A', sB > sA);
  }

  // PACK-3 same-sprint co-placement legal
  {
    const { res } = packWith([mkF('uA', 'A', 3), mkF('uB', 'B', 3, 'Medium', ['A'])], [8], ['uB', 'uA']);
    check('PACK-3 A and B both in sprint 0 (same-sprint allowed)', res.sprints[0].ids.includes('uA') && res.sprints[0].ids.includes('uB'));
    check('PACK-3 blocker A placed before dependent B in the sprint', res.sprints[0].ids.indexOf('uA') < res.sprints[0].ids.indexOf('uB'));
  }

  // PACK-4 transitive overflow cascade
  {
    const { res } = packWith([mkF('uF', 'F', 8), mkF('uA', 'A', 8), mkF('uB', 'B', 8, 'Medium', ['A'])], [8], ['uF', 'uA', 'uB']);
    check('PACK-4 F fills the only sprint', res.sprints[0].ids.includes('uF'));
    check('PACK-4 A overflows (capacity_exhausted)', res.overflow.some((o) => o.id === 'uA' && o.reason === 'capacity_exhausted'));
    check('PACK-4 B overflows blocker_overflowed + rootCause A', res.overflow.some((o) => o.id === 'uB' && o.reason === 'blocker_overflowed' && o.rootCause === 'uA'));
  }

  // PACK-5 deficit (backlog >> capacity)
  {
    const { res } = packWith([mkF('uA', 'A', 8), mkF('uB', 'B', 8), mkF('uC', 'C', 8)], [8]);
    check('PACK-5 deficitPoints = 24-8 = 16', res.metrics.deficitPoints === 16);
    check('PACK-5 two features overflow', res.overflow.length === 2);
  }

  // PACK-6 front-load + empty trailing
  {
    const { res } = packWith([mkF('uA', 'A', 5), mkF('uB', 'B', 5)], [100, 100, 100, 100]);
    check('PACK-6 all fit sprint 0', res.sprints[0].ids.length === 2);
    check('PACK-6 empty trailing sprints detected (3)', res.metrics.emptyTrailingSprints === 3);
  }

  // PACK-7 fragmentation back-fill: a small item fills a gap a big item left
  {
    const { res } = packWith([mkF('uBig', 'Big', 8), mkF('uSmall', 'Small', 2)], [8, 8], ['uBig', 'uSmall']);
    check('PACK-7 Big fills sprint0; Small back-fills sprint1 (both placed)', res.overflow.length === 0);
  }

  // PACK-8 capacity hard ceiling (no over-alloc except oversized)
  {
    const { res } = packWith([mkF('uA', 'A', 5), mkF('uB', 'B', 5)], [8]);
    check('PACK-8 sprint never over capacity for fitting items', res.sprints[0].load <= 8 + 1e-9 && res.sprints[0].overCapacity === false);
    check('PACK-8 the non-fitting one overflows', res.overflow.length === 1);
  }

  // PACK-10 single sprint
  {
    const { res } = packWith([mkF('uA', 'A', 3)], [8]);
    check('PACK-10 single sprint works', res.sprints.length === 1 && res.sprints[0].ids.includes('uA'));
  }

  // unsized excluded
  {
    const { res } = packWith([mkF('uA', 'A', 5), { _uid: 'uX', name: 'X', dependencies: [] }], [8]);
    check('unsized excluded from packing → sizingIssues', res.sizingIssues.some((u) => u.id === 'uX'));
    check('unsized never placed in a sprint', !res.sprints.some((s) => s.ids.includes('uX')));
  }

  // blocker_unsized cascade
  {
    const { res } = packWith([{ _uid: 'uX', name: 'X', dependencies: [] }, mkF('uB', 'B', 5, 'Medium', ['X'])], [8]);
    check('B blocked by unsized X → overflow blocker_unsized', res.overflow.some((o) => o.id === 'uB' && o.reason === 'blocker_unsized'));
  }

  // accounting invariant: every sized feature is placed XOR overflowed
  {
    const { g, res } = packWith([mkF('uA', 'A', 5), mkF('uB', 'B', 5), mkF('uC', 'C', 13)], [8, 8]);
    const placed = res.sprints.reduce((a, s) => a + s.ids.length, 0);
    check('accounting: placed + overflow = sized feature count', placed + res.overflow.length === g.ids.length);
    check('violations[] empty (packer correct)', res.violations.length === 0);
  }
}

// ════════════════ 8. estimatePlanCost (UX-5) ════════════════
console.log('\nestimatePlanCost:');
{
  check('0 features → $0', estimatePlanCost({ featureCount: 0 }).expected_usd === 0);
  const e = estimatePlanCost({ featureCount: 39 });
  check('39 features → expected < upper, both finite', e.expected_usd < e.upper_usd && Number.isFinite(e.upper_usd));
  check('39 features → cost is small (upper < $0.10, expected < $0.05)', e.upper_usd < 0.10 && e.expected_usd < 0.05);
}

// ════════════════ 9. planSourceHash (UX-1) ════════════════
console.log('\nplanSourceHash — staleness detection:');
{
  const base = [mkF('uA', 'A', 5), mkF('uB', 'B', 8)];
  const h0 = planSourceHash(base);
  check('same features → same hash', planSourceHash([mkF('uA', 'A', 5), mkF('uB', 'B', 8)]) === h0);
  check('reorder → same hash (set membership)', planSourceHash([mkF('uB', 'B', 8), mkF('uA', 'A', 5)]) === h0);
  check('changed SP → different hash', planSourceHash([mkF('uA', 'A', 5), mkF('uB', 'B', 13)]) !== h0);
  check('rename → different hash (real edit detected)', planSourceHash([mkF('uA', 'A2', 5), mkF('uB', 'B', 8)]) !== h0);
  check('removed feature → different hash', planSourceHash([mkF('uA', 'A', 5)]) !== h0);
  check('changed priority → different hash', planSourceHash([mkF('uA', 'A', 5, 'High'), mkF('uB', 'B', 8)]) !== h0);
  check('changed deps → different hash', planSourceHash([mkF('uA', 'A', 5, 'Medium', ['B']), mkF('uB', 'B', 8)]) !== h0);
  // ⭐ STALE-HASH FIX (live-acceptance 2026-06-20): _uid is FE-minted + NOT persisted, so a hard RELOAD
  // re-mints fresh uids. The hash MUST key on CONTENT, not _uid — else every reload false-flags "out of date".
  check('⭐ reload re-mints uids: SAME content, DIFFERENT _uids → SAME hash (no false stale)', planSourceHash([mkF('zzz9', 'A', 5), mkF('qqq7', 'B', 8)]) === h0);
  check('⭐ different _uids do NOT mask a real edit (rename + new uids) → different hash', planSourceHash([mkF('zzz9', 'A2', 5), mkF('qqq7', 'B', 8)]) !== h0);
}

// ════════════════ 10. assemblePlan (end-to-end integration) ════════════════
console.log('\nassemblePlan — full integration:');
{
  const feats = [mkF('uA', 'A', 5, 'High'), mkF('uB', 'B', 8, 'Medium', ['A']), mkF('uC', 'C', 3, 'Low')];
  const cap = computeCapacity({ people: [{ name: 'T', availableDays: 10 }], sprintCount: 3, sprintLengthDays: 10, hoursPerDay: 8, focusFactor: 0.7, hoursPerPoint: 4 });
  const plan = assemblePlan({ features: feats, capacity: cap, ranking: [{ feature_id: 'uC' }, { feature_id: 'uA' }, { feature_id: 'uB' }] });
  const placed = plan.sprints.reduce((a, s) => a + s.ids.length, 0);
  check('integration: all features placed or overflowed', placed + plan.overflow.length === 3);
  check('integration: usedLlm true (ranking given)', plan.ranking.usedLlm === true);
  check('integration: B never before its blocker A', (() => {
    const sA = plan.sprints.findIndex((s) => s.ids.includes('uA'));
    const sB = plan.sprints.findIndex((s) => s.ids.includes('uB'));
    return sB === -1 || sA === -1 || sB >= sA;
  })());

  const planNoLlm = assemblePlan({ features: feats, capacity: cap, ranking: null });
  check('integration: null ranking → usedLlm false, still a valid plan', planNoLlm.ranking.usedLlm === false && planNoLlm.sprints.length === 3);

  const rows = buildRankingRows(buildPlannerGraph(feats), computeSchedulingSignals(buildPlannerGraph(feats), topoSortAndCycles(buildPlannerGraph(feats), () => 0, () => 0).order), validateSizing(feats, idFn(feats)).points);
  check('buildRankingRows: §8 contract carries signals + blocked_by {id,name}', rows.find((r) => r.feature_id === 'uB').blocked_by.some((b) => b.name === 'A' && b.id === 'uA') && rows[0].critical_path_length !== null);
}

// ════════════════ 11. duplicate _uid hardening (gate findings #7/#8) ════════════════
console.log('\nduplicate _uid hardening — never collapse, never throw:');
{
  const dupFeats = [mkF('dup', 'A', 5), mkF('dup', 'B', 8), mkF('uC', 'C', 3)]; // two features share _uid='dup' (malformed)
  const g = buildPlannerGraph(dupFeats);
  check('duplicate _uid → ids disambiguated to 3 UNIQUE ids (no collapse)', new Set(g.ids).size === 3);
  check('duplicate _uid → surfaced in duplicateUids diagnostic', g.duplicateUids.length === 1);
  const cap = computeCapacity({ people: [{ name: 'T', availableDays: 10 }], sprintCount: 2, sprintLengthDays: 10, hoursPerDay: 8, focusFactor: 0.7, hoursPerPoint: 4 });
  let threw = false, plan2 = null;
  try { plan2 = assemblePlan({ features: dupFeats, capacity: cap, ranking: null }); } catch (_) { threw = true; }
  check('duplicate _uid → assemblePlan does NOT throw (never hard-fails)', !threw && !!plan2);
  const placed2 = plan2 ? plan2.sprints.reduce((a, s) => a + s.ids.length, 0) : 0;
  check('duplicate _uid → all 3 features accounted (none silently vanish)', !!plan2 && placed2 + plan2.overflow.length === 3);
}

// ════════════════ 12. deep-audit fixes (PLAN-01/04/05/16/17/18) ════════════════
console.log('\ndeep-audit fixes:');
{
  const idF = idFn();
  const ampleCap = computeCapacity({ people: [{ name: 'T', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10, hoursPerDay: 8, focusFactor: 1, hoursPerPoint: 1 }); // 80 pts/sprint

  // PLAN-01: a dependency cycle must PACK best-effort (cut edge ignored by the packer), not deadlock to overflow
  {
    const cyc = [mkF('uA', 'A', 5, 'Medium', ['B']), mkF('uB', 'B', 5, 'Medium', ['A'])];
    const plan = assemblePlan({ features: cyc, capacity: ampleCap, ranking: null });
    const placed = plan.sprints.reduce((a, s) => a + s.ids.length, 0);
    check('PLAN-01 cycle: BOTH members placed (cut edge not treated as a blocker)', placed === 2);
    check('PLAN-01 cycle: overflow empty despite the cycle + idle capacity', plan.overflow.length === 0);
    check('PLAN-01 cycle: surfaced as cyclicNodes (not silent)', plan.graph.cyclicNodes.length >= 1);
  }

  // packSprints with explicit cutEdges directly (unit-level for the readiness gate)
  {
    const g = buildPlannerGraph([mkF('uA', 'A', 5, 'Medium', ['B']), mkF('uB', 'B', 5, 'Medium', ['A'])]);
    const sz = validateSizing([mkF('uA', 'A', 5), mkF('uB', 'B', 5)], idF);
    const t = topoSortAndCycles(g, () => 0, () => 0);
    const res = packSprints(t.order, [80], g, sz.points, sz.unsized, t.cutEdges);
    check('PLAN-01 packSprints honours cutEdges → 0 overflow', res.overflow.length === 0 && res.sprints[0].ids.length === 2);
  }

  // PLAN-05: two oversized features distribute one-per-sprint (not crammed into sprint 0)
  {
    const g = buildPlannerGraph([mkF('uA', 'A', 13), mkF('uB', 'B', 13)]);
    const sz = validateSizing([mkF('uA', 'A', 13), mkF('uB', 'B', 13)], idF);
    const res = packSprints(['uA', 'uB'], [8, 8], g, sz.points, sz.unsized, []);
    check('PLAN-05 two oversized distribute one per sprint', res.sprints[0].ids.length === 1 && res.sprints[1].ids.length === 1);
  }

  // PLAN-17: an OVERSIZED blocker unblocks its dependent in a LATER sprint (not overflow)
  {
    const g = buildPlannerGraph([mkF('uA', 'A', 13), mkF('uB', 'B', 5, 'Medium', ['A'])]);
    const sz = validateSizing([mkF('uA', 'A', 13), mkF('uB', 'B', 5)], idF);
    const res = packSprints(['uA', 'uB'], [8, 8], g, sz.points, sz.unsized, []);
    const sB = res.sprints.findIndex((s) => s.ids.includes('uB'));
    check('PLAN-17 oversized blocker → dependent placed (not overflow)', sB >= 0 && !res.overflow.some((o) => o.id === 'uB'));
    check('PLAN-17 dependent lands AFTER the oversized blocker', sB === 1);
  }

  // PLAN-16: slack is non-zero on a side path (a linear chain would make slack trivially 0)
  {
    // chain A→B→C→D (length 4) + side path A→E→D (length 3): E has slack 1
    const feats = [mkF('uA', 'A', 3), mkF('uB', 'B', 3, 'M', ['A']), mkF('uC', 'C', 3, 'M', ['B']), mkF('uD', 'D', 3, 'M', ['C', 'E']), mkF('uE', 'E', 3, 'M', ['A'])];
    const g = buildPlannerGraph(feats);
    const t = topoSortAndCycles(g, () => 0, () => 0);
    const s = computeSchedulingSignals(g, t.order);
    check('PLAN-16 slack > 0 on the shorter side path (E)', s.get('uE').slack >= 1);
    check('PLAN-16 slack === 0 on the critical path (B)', s.get('uB').slack === 0);
  }

  // PLAN-16: computeSchedulingSignals on a CYCLIC graph terminates + defines every node (cut-edge guard)
  {
    const g = buildPlannerGraph([mkF('uA', 'A', 3, 'M', ['B']), mkF('uB', 'B', 3, 'M', ['A']), mkF('uC', 'C', 3)]);
    const t = topoSortAndCycles(g, () => 0, () => 0);
    let threw = false, s = null;
    try { s = computeSchedulingSignals(g, t.order); } catch (_) { threw = true; }
    check('PLAN-16 cyclic signals: no throw + every node defined', !threw && g.ids.every((id) => s.has(id)));
  }

  // PLAN-18: combined normalizeRanking failure (unknown + duplicate + omission) — none vanish
  {
    const g = buildPlannerGraph([mkF('uA', 'A', 5, 'High'), mkF('uB', 'B', 5, 'Low'), mkF('uC', 'C', 5, 'Medium')]);
    const t = topoSortAndCycles(g, () => 0, () => 0);
    const sig = computeSchedulingSignals(g, t.order);
    const n = normalizeRanking([{ feature_id: 'GHOST' }, { feature_id: 'uA' }, { feature_id: 'uA' }, { feature_id: 'uB' }], g, sig, (id) => priorityRankOf(g.byId.get(id)), (id) => complexityRankOf(g.byId.get(id)));
    check('PLAN-18 combined: unknown dropped', n.unknownIds.includes('GHOST'));
    check('PLAN-18 combined: duplicate deduped', n.duplicateIds.includes('uA'));
    check('PLAN-18 combined: omitted appended', n.omittedIds.includes('uC'));
    check('PLAN-18 combined: ALL 3 features present, none vanish', new Set(n.preferenceOrder).size === 3);
  }

  // PLAN-04: pre-flight upper is a TRUE ceiling — at small N it reflects the API max_tokens, not the lower heuristic
  {
    check('PLAN-04 planRankingMaxTokens(5) = 1000', planRankingMaxTokens(5) === 1000);
    check('PLAN-04 planRankingMaxTokens caps at 8000', planRankingMaxTokens(200) === 8000);
    const e5 = estimatePlanCost({ featureCount: 5 });
    // batch-priced (50%): inputUpper=2950+5*170=3800; output upper=max(5*110,1000)=1000 → (3800*1.5 + 1000*7.5)/1e6 = 0.0132
    check('PLAN-04 small-N upper reflects the max_tokens ceiling (batch-priced ~$0.0132)', approx(e5.upper_usd, 0.0132, 1e-6));
    check('PLAN-04 upper > expected', e5.upper_usd > e5.expected_usd);
    // ⭐ the ceiling-must-hold invariant (P12 deep-audit, MEASURED): the pre-flight upper ≥ the echo over a
    // REALISTIC worst-case input — the system prompt MEASURED at ~2170 tok (not the stale 1407) + the global §8
    // blocks (summary ~150 + concerns ~460 + the P12 objective ~100) ≈ 2880 floor + ~145 tok/feature realized.
    const realisticEcho = (m) => {
      const inTok = 2880 + m * 145;            // MEASURED system + ALL global blocks (incl. P12 objective) + per-feature
      const outTok = planRankingMaxTokens(m);  // output pinned at the API max (the upper already concedes this)
      return (inTok / 1e6) * 1.5 + (outTok / 1e6) * 7.5; // batch-priced Sonnet ($3/$15 × 0.5)
    };
    for (const m of [3, 5, 10, 30]) {
      check(`PLAN-04 ceiling HOLDS — upper ≥ realistic echo (n=${m})`, estimatePlanCost({ featureCount: m }).upper_usd >= realisticEcho(m));
    }
  }
}

// ════════════════ 9.5 RISK SIGNALS (Tier-1 risk-aware sequencing) ════════════════
console.log('\nrisk layer — parse / per-feature / per-sprint / spec-wide / additive:');
{
  // parseConcernType — typed prefix vs prefix-less vs non-string
  check('parseConcernType: [RISK|high] → typed', JSON.stringify(parseConcernType('[RISK|high] payment down')) === JSON.stringify({ type: 'RISK', severity: 'high' }));
  check('parseConcernType: prefix-less → null (PARSE-1)', parseConcernType('just a note') === null);
  check('parseConcernType: case-insensitive + uppercased type', parseConcernType('[external_dependency|Medium] x').type === 'EXTERNAL_DEPENDENCY');
  check('parseConcernType: non-string → null', parseConcernType(null) === null && parseConcernType(42) === null);

  // computeRiskSignals — score arithmetic, level logic, flags, robustness
  const idf = (f, i) => f._uid || String(i);
  const fA = { _uid: 'uA', concerns: ['[RISK|high] gateway down', '[EXTERNAL_DEPENDENCY|medium] vendor api'], confidence_indicator: '⚠', complexity_score: 5 };
  const fB = { _uid: 'uB', concerns: ['[AMBIGUITY|low] unclear scope'], confidence_indicator: '✓', complexity_score: 3 };
  const fC = { _uid: 'uC', concerns: [], confidence_indicator: '✓', complexity_score: 2 };
  const fD = { _uid: 'uD', concerns: ['raw concern no prefix'], confidence_indicator: '✗', complexity_score: 4 };
  const fE = { _uid: 'uE', concerns: ['[EXTERNAL_DEPENDENCY|high] third party'], confidence_indicator: '✓', complexity_score: 3 };
  const rs = computeRiskSignals([fA, fB, fC, fD, fE], idf);
  // A: 30(RISK·1) + 15(EXT·1) + 16(cx 5→(5-3)*8) + 12(⚠) = 73
  check('computeRiskSignals A: score 73', rs.get('uA').riskScore === 73);
  check('computeRiskSignals A: risk_level high', rs.get('uA').risk_level === 'high');
  check('computeRiskSignals A: has_external_dep + low_confidence', rs.get('uA').has_external_dep === true && rs.get('uA').low_confidence === true);
  // B: AMBIGUITY|low = 6*0.4 = 2.4; AMBIGUITY not a level-type → floor 'low' from typedCount
  check('computeRiskSignals B: score 2.4, level low (PARSE-2 quality concern doesn’t raise level)', approx(rs.get('uB').riskScore, 2.4) && rs.get('uB').risk_level === 'low');
  // C: no signal at all → none / 0
  check('computeRiskSignals C: no signal → none/0', rs.get('uC').risk_level === 'none' && rs.get('uC').riskScore === 0);
  // D: untyped(5) + cx 4→8 + ✗(25) = 38; floor 'low'; untypedConcernCount=1
  check('computeRiskSignals D: untyped+cx+✗ = 38, level low, untypedCount 1', rs.get('uD').riskScore === 38 && rs.get('uD').risk_level === 'low' && rs.get('uD').untypedConcernCount === 1);
  // E: EXTERNAL_DEPENDENCY|high = 30 → high + external
  check('computeRiskSignals E: external high → level high + external dep', rs.get('uE').risk_level === 'high' && rs.get('uE').has_external_dep === true);
  // clamp + robustness (PARSE-4: never NaN/Infinity; malformed concerns array doesn’t throw)
  const rh = computeRiskSignals([{ _uid: 'uH', concerns: Array(5).fill('[RISK|high] boom'), confidence_indicator: '✗', complexity_score: 5 }], idf);
  check('computeRiskSignals: riskScore clamps to 100', rh.get('uH').riskScore === 100);
  let threw = false; let rm;
  try { rm = computeRiskSignals([{ _uid: 'uM', concerns: 'not-an-array', confidence_indicator: null }], idf); } catch (_) { threw = true; }
  check('computeRiskSignals: malformed concerns → no throw, clean none/0', !threw && rm.get('uM').risk_level === 'none' && rm.get('uM').riskScore === 0);

  // buildRankingRows — compact SET flags only (SN-1/SN-2): omit risk:low/none, never the score
  const feats = [
    { _uid: 'uA', _orig_name: 'A', name: 'A', story_points: 5, priority: 'High', dependencies: [], complexity_score: 5, concerns: ['[RISK|high] x'], confidence_indicator: '⚠' },
    { _uid: 'uB', _orig_name: 'B', name: 'B', story_points: 3, priority: 'Low', dependencies: [], complexity_score: 2, concerns: [], confidence_indicator: '✓' },
    { _uid: 'uE', _orig_name: 'E', name: 'E', story_points: 3, priority: 'Medium', dependencies: [], complexity_score: 3, concerns: ['[EXTERNAL_DEPENDENCY|high] vendor'], confidence_indicator: '✓' },
  ];
  const g = buildPlannerGraph(feats);
  const idOf = (f, i) => g.idByIndex[i];
  const t = topoSortAndCycles(g, () => 0, () => 0);
  const sig = computeSchedulingSignals(g, t.order);
  const sz = validateSizing(feats, idOf);
  const risk = computeRiskSignals(feats, idOf);
  const rows = buildRankingRows(g, sig, sz.points, risk);
  const rowOf = (id) => rows.find((r) => r.feature_id === id);
  check('buildRankingRows: high-risk → risk:high flag', rowOf('uA').risk_flags.includes('risk:high'));
  check('buildRankingRows: low-confidence → low_confidence flag', rowOf('uA').risk_flags.includes('low_confidence'));
  check('buildRankingRows: clean feature → NO flags (SN-2 omits low/none)', rowOf('uB').risk_flags.length === 0);
  check('buildRankingRows: external dep → external_dep flag', rowOf('uE').risk_flags.includes('external_dep'));
  check('buildRankingRows: flags never carry the numeric score (SN-1)', rows.every((r) => r.risk_flags.every((fl) => !/\d/.test(fl) || fl.startsWith('risk:'))));

  // computeSprintRiskProfile — index-aligned + the fragile substance floor (UX-1/UX-2)
  const points = new Map([['uA', 5], ['uE', 3], ['uB', 3]]);
  const profiles = computeSprintRiskProfile([{ ids: ['uA', 'uE'] }, { ids: ['uB'] }, { ids: [] }], risk, points);
  check('sprintRiskProfile: index-aligned to sprints (3)', profiles.length === 3);
  check('sprintRiskProfile: concentrated high-risk → fragile', profiles[0].fragile === true && profiles[0].highRiskCount === 2);
  check('sprintRiskProfile: low-risk sprint not fragile', profiles[1].fragile === false);
  check('sprintRiskProfile UX-1: empty sprint → zero, not fragile, not omitted', profiles[2].featureCount === 0 && profiles[2].fragile === false);
  const single = computeSprintRiskProfile([{ ids: ['uA'] }], risk, points);
  check('sprintRiskProfile UX-2: a lone high-risk item is NOT fragile (≥2 floor)', single[0].fragile === false);

  // summarizeSpecConcerns — spec-WIDE, compliance counted once, prefix stripped (SN-3)
  const sc = summarizeSpecConcerns(['[COMPLIANCE|high] GDPR data export', '[RISK|medium] vendor lock-in', 'plain note']);
  check('summarizeSpecConcerns: total 3, compliance 1', sc.total === 3 && sc.complianceCount === 1);
  check('summarizeSpecConcerns: typed item parsed + prefix stripped', sc.items[0].type === 'COMPLIANCE' && sc.items[0].severity === 'high' && sc.items[0].text === 'GDPR data export');
  check('summarizeSpecConcerns: prefix-less → NOTE', sc.items[2].type === 'NOTE');
  check('summarizeSpecConcerns: null/non-array → zero, no throw', summarizeSpecConcerns(null).total === 0 && summarizeSpecConcerns('x').total === 0);

  // assemblePlan — additive (DAG-1/IR-1): risk keys are siblings, packing is UNAFFECTED by specConcerns
  const cap = computeCapacity({ people: [{ name: 'A', availableDays: 10 }], sprintCount: 2, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 });
  const feats2 = [
    { _uid: 'uA', _orig_name: 'A', name: 'A', story_points: 5, priority: 'High', dependencies: [], complexity_score: 5, concerns: ['[RISK|high] x'], confidence_indicator: '⚠' },
    { _uid: 'uB', _orig_name: 'B', name: 'B', story_points: 3, priority: 'Low', dependencies: [], complexity_score: 2, concerns: [], confidence_indicator: '✓' },
  ];
  const planNoSC = assemblePlan({ features: feats2, capacity: cap, ranking: null });
  const planSC = assemblePlan({ features: feats2, capacity: cap, ranking: null, specConcerns: ['[COMPLIANCE|high] gdpr'] });
  check('assemblePlan: riskByFeature present + keyed by uid', planSC.riskByFeature && planSC.riskByFeature.uA && planSC.riskByFeature.uA.risk_level === 'high');
  check('assemblePlan: sprintRiskProfiles index-aligned to sprints', planSC.sprintRiskProfiles.length === planSC.sprints.length);
  check('assemblePlan: specConcernSummary surfaced (compliance 1)', planSC.specConcernSummary.complianceCount === 1);
  check('assemblePlan DAG-1: specConcerns inert to packing (identical sprints)', JSON.stringify(planNoSC.sprints) === JSON.stringify(planSC.sprints));
  check('assemblePlan: omitted specConcerns → empty summary, no throw', planNoSC.specConcernSummary.total === 0);
}

// precomputedRisk reuse (gate HIGH fix 2026-06-20) — LEAN features (concerns stripped for KVS) + injected
// precomputedRisk → IDENTICAL per-feature risk + spec summary as computing from full features; sprintRiskProfiles
// still re-derive from the packing. Proves finalize/re-pack keep risk correct WITHOUT persisting concerns.
console.log('\nprecomputedRisk — lean-persist parity (KVS footprint fix):');
{
  const full = [
    { _uid: 'uA', _orig_name: 'A', name: 'A', story_points: 5, priority: 'High', dependencies: [], complexity_score: 5, concerns: ['[RISK|high] x'], confidence_indicator: '⚠' },
    { _uid: 'uB', _orig_name: 'B', name: 'B', story_points: 3, priority: 'Low', dependencies: [], complexity_score: 2, concerns: [], confidence_indicator: '✓' },
  ];
  const lean = full.map((f) => ({ _uid: f._uid, _orig_name: f._orig_name, name: f.name, story_points: f.story_points, complexity_score: f.complexity_score, priority: f.priority, dependencies: f.dependencies }));
  const cap = computeCapacity({ people: [{ name: 'A', availableDays: 10 }], sprintCount: 2, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 });
  const fromFull = assemblePlan({ features: full, capacity: cap, ranking: null, specConcerns: ['[COMPLIANCE|high] gdpr'] });
  const precomputed = { riskByFeature: fromFull.riskByFeature, specConcernSummary: fromFull.specConcernSummary };
  const fromLean = assemblePlan({ features: lean, capacity: cap, ranking: null, precomputedRisk: precomputed });
  check('precomputedRisk: lean+precomputed riskByFeature IDENTICAL to full', JSON.stringify(fromLean.riskByFeature) === JSON.stringify(fromFull.riskByFeature));
  check('precomputedRisk: lean features (no concerns) still yield uA high risk', fromLean.riskByFeature.uA.risk_level === 'high');
  check('precomputedRisk: specConcernSummary reused (compliance 1, total 1)', fromLean.specConcernSummary.complianceCount === 1 && fromLean.specConcernSummary.total === 1);
  check('precomputedRisk: sprintRiskProfiles re-derived, index-aligned to sprints', fromLean.sprintRiskProfiles.length === fromLean.sprints.length);
  // re-pack: a DIFFERENT capacity reuses the SAME per-feature risk but re-profiles the new sprint set
  const cap2 = computeCapacity({ people: [{ name: 'A', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 });
  const repacked = assemblePlan({ features: lean, capacity: cap2, ranking: null, precomputedRisk: precomputed });
  check('precomputedRisk: re-pack keeps per-feature risk identical', JSON.stringify(repacked.riskByFeature) === JSON.stringify(fromFull.riskByFeature));
  check('precomputedRisk: re-pack re-derives sprintRiskProfiles for new sprint count', repacked.sprintRiskProfiles.length === repacked.sprints.length);
  // back-compat: an OLD record (no precomputedRisk, full features) still computes risk from concerns
  const oldPath = assemblePlan({ features: full, capacity: cap, ranking: null, specConcerns: ['[COMPLIANCE|high] gdpr'], precomputedRisk: undefined });
  check('precomputedRisk: back-compat (no precomputed) recomputes from features', oldPath.riskByFeature.uA.risk_level === 'high' && oldPath.specConcernSummary.complianceCount === 1);
}

// ════════════════ 11. WHAT-IF DIFF (P20 free scenarios) ════════════════
console.log('\ndiffPlans — pure scenario diff (deferred is a DISJOINT channel, never "newly overflows"):');
{
  const baseline = {
    sprints: [{ ids: ['uA', 'uB'] }, { ids: ['uC'] }],
    overflow: [{ id: 'uD', reason: 'capacity_exhausted' }],
    metrics: { totalCapacity: 30, deficitPoints: 5, overflowCount: 1, wastedCapacity: 2 },
    sprintRiskProfiles: [{ fragile: true }, { fragile: false }],
  };
  // add a sprint → uD now fits, uB moved sprint 1→2, capacity up, deficit gone, a fragile sprint resolved
  const scenario = {
    sprints: [{ ids: ['uA'] }, { ids: ['uB', 'uC'] }, { ids: ['uD'] }],
    overflow: [],
    metrics: { totalCapacity: 45, deficitPoints: 0, overflowCount: 0, wastedCapacity: 5 },
    sprintRiskProfiles: [{ fragile: false }, { fragile: false }, { fragile: false }],
  };
  const d = diffPlans(baseline, scenario);
  check('diffPlans: newlyFits uD → sprint 3', d.newlyFits.length === 1 && d.newlyFits[0].id === 'uD' && d.newlyFits[0].sprint === 3);
  check('diffPlans: moved uB sprint 1→2', d.moved.length === 1 && d.moved[0].id === 'uB' && d.moved[0].from === 1 && d.moved[0].to === 2);
  check('diffPlans: nothing deferred, nothing newly overflows', d.deferred.length === 0 && d.newlyOverflows.length === 0);
  check('diffPlans: sprintCountDelta +1', d.sprintCountDelta === 1);
  check('diffPlans: capacityDelta +15', d.capacityDelta === 15);
  check('diffPlans: deficitDelta −5', d.deficitDelta === -5);
  check('diffPlans: overflowCountDelta −1', d.overflowCountDelta === -1);
  check('diffPlans: fragileDelta −1 (1→0)', d.fragileDelta === -1 && d.fragileBaseline === 1 && d.fragileScenario === 0);

  // DEFER a feature: uD removed from the set entirely → DEFERRED channel, NOT newlyOverflows (P20-DEFER-DIFF-MISCLASSIFY)
  const deferD = { sprints: [{ ids: ['uA', 'uB'] }, { ids: ['uC'] }], overflow: [], metrics: {} };
  const dd = diffPlans(baseline, deferD);
  check('diffPlans: deferred uD in the deferred channel', dd.deferred.length === 1 && dd.deferred[0].id === 'uD');
  check('diffPlans: deferred uD NEVER appears as newlyOverflows', dd.newlyOverflows.every((x) => x.id !== 'uD'));

  // a feature placed in baseline but pushed to overflow in the scenario (e.g. lower focus) → newlyOverflows
  const d3 = diffPlans({ sprints: [{ ids: ['uA', 'uB'] }], overflow: [], metrics: {} }, { sprints: [{ ids: ['uA'] }], overflow: [{ id: 'uB', reason: 'capacity_exhausted' }], metrics: {} });
  check('diffPlans: newlyOverflows uB (was placed, now overflow)', d3.newlyOverflows.length === 1 && d3.newlyOverflows[0].id === 'uB');

  // newlyOverflows must carry the FULL typed reason (live bug: what-if showed "not enough a skill capacity"
  // / "blocked by undefined" because diffPlans dropped starvedBuckets + rootCauseName).
  const d4 = diffPlans(
    { sprints: [{ ids: ['uA', 'uB'] }], overflow: [], metrics: {} },
    { sprints: [{ ids: [] }], overflow: [{ id: 'uA', reason: 'bucket_exhausted', starvedBuckets: ['BE'] }, { id: 'uB', reason: 'blocker_overflowed', rootCause: 'uA', rootCauseName: 'Auth' }], metrics: {} },
  );
  const ovA = d4.newlyOverflows.find((x) => x.id === 'uA');
  const ovB = d4.newlyOverflows.find((x) => x.id === 'uB');
  check('diffPlans: newlyOverflows carries starvedBuckets (bucket_exhausted)', ovA && ovA.reason === 'bucket_exhausted' && Array.isArray(ovA.starvedBuckets) && ovA.starvedBuckets.join() === 'BE');
  check('diffPlans: newlyOverflows carries rootCauseName (blocker_overflowed, no "undefined")', ovB && ovB.reason === 'blocker_overflowed' && ovB.rootCauseName === 'Auth');

  // Tier-2 what-if: per-skill shortfall = the GENUINE overDemand (own demand − own capacity), NOT the inflated
  // unmet (which over-counts collateral blocked behind a sibling skill). Fixture's unmet is huge to prove it's ignored.
  const d5 = diffPlans({ sprints: [], overflow: [], metrics: {} }, { sprints: [], overflow: [], metrics: {}, bucketMetrics: { overDemand: { BE: 130, FE: 5, QA: 0, GEN: 0 }, unmet: { BE: 999, FE: 999, QA: 0, GEN: 0 }, overfilled: { BE: 0, FE: 0, QA: 0, GEN: 0 } } });
  check('diffPlans: bucketShortfall uses overDemand (honest), NOT the inflated unmet', d5.bucketShortfall.length === 2 && d5.bucketShortfall.find((x) => x.bucket === 'BE').shortfall === 130 && d5.bucketShortfall.find((x) => x.bucket === 'FE').shortfall === 5);
  // back-compat: a legacy scenario bucketMetrics with no overDemand falls back to unmet + overfilled
  const d5b = diffPlans({ sprints: [], overflow: [], metrics: {} }, { sprints: [], overflow: [], metrics: {}, bucketMetrics: { unmet: { BE: 130, FE: 0, QA: 0, GEN: 0 }, overfilled: { BE: 0, FE: 5, QA: 0, GEN: 0 } } });
  check('diffPlans: legacy (no overDemand) → falls back to unmet + overfilled', d5b.bucketShortfall.length === 2 && d5b.bucketShortfall.find((x) => x.bucket === 'BE').shortfall === 130 && d5b.bucketShortfall.find((x) => x.bucket === 'FE').shortfall === 5);
  check('diffPlans: no bucketMetrics → empty bucketShortfall (back-compat)', diffPlans({}, {}).bucketShortfall.length === 0);

  // null-safety
  let threw = false; let dr;
  try { dr = diffPlans(null, undefined); } catch (_) { threw = true; }
  check('diffPlans: null-safe (no throw, empty channels)', !threw && dr.newlyFits.length === 0 && dr.deferred.length === 0 && dr.sprintCountDelta === 0);

  // INTEGRATION over assemblePlan: defer-X drops X's cached rank entry (normalizeRanking unknownId-drop) →
  // the subset re-packs the SAME relative order; X lands in deferred, never overflow; no throw.
  const feats = [
    { _uid: 'uA', _orig_name: 'A', name: 'A', story_points: 5, priority: 'High', dependencies: [], complexity_score: 3 },
    { _uid: 'uB', _orig_name: 'B', name: 'B', story_points: 5, priority: 'Medium', dependencies: [], complexity_score: 3 },
    { _uid: 'uC', _orig_name: 'C', name: 'C', story_points: 5, priority: 'Low', dependencies: [], complexity_score: 3 },
  ];
  const cap1 = computeCapacity({ people: [{ name: 'A', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 }); // ~7 pts → 1 feature fits
  const ranking = [{ feature_id: 'uA' }, { feature_id: 'uB' }, { feature_id: 'uC' }];
  const base = assemblePlan({ features: feats, capacity: cap1, ranking });
  const scen = assemblePlan({ features: feats.filter((f) => f._uid !== 'uA'), capacity: cap1, ranking }); // defer uA (rank entry dropped)
  const di = diffPlans(base, scen);
  check('diffPlans integration: deferred uA in deferred, not overflow (cached-ranking subset is safe)', di.deferred.some((x) => x.id === 'uA') && di.newlyOverflows.every((x) => x.id !== 'uA'));

  // newlyDangling (§11 honesty): deferring a BLOCKER orphans the kept dependent's dependency → surfaced
  const baseG = { sprints: [{ ids: ['uA', 'uB'] }], overflow: [], metrics: {}, graph: { danglingRefs: [] } };
  const scenG = { sprints: [{ ids: ['uB'] }], overflow: [], metrics: {}, graph: { danglingRefs: [{ name: 'Dashboard', missingDep: 'Auth' }] } };
  const dg = diffPlans(baseG, scenG);
  check('diffPlans: newlyDangling surfaces a deferral-orphaned dependency', dg.newlyDangling.length === 1 && dg.newlyDangling[0].missingDep === 'Auth');
  const dg2 = diffPlans(
    { ...baseG, graph: { danglingRefs: [{ name: 'X', missingDep: 'Y' }] } },
    { sprints: [{ ids: ['uB'] }], overflow: [], metrics: {}, graph: { danglingRefs: [{ name: 'X', missingDep: 'Y' }] } },
  );
  check('diffPlans: a pre-existing dangling ref is NOT counted as newly introduced', dg2.newlyDangling.length === 0);
}

// ════════════════ 12. SKILL-AWARE CAPACITY (Tier-2) ════════════════
console.log('\nskill-aware capacity — derivation / per-bucket capacity / partitioned packer:');
{
  const mkSkillF = (uid, name, sp, taskTypes, prio = 'Medium', deps = []) =>
    ({ _uid: uid, _orig_name: name, name, story_points: sp, priority: prio, dependencies: deps, complexity_score: 3, task_types: taskTypes });

  // ── derivation ──
  check('requiredSkillsOf: API+UI+TEST → [BE,FE,QA] in bucket order', JSON.stringify(requiredSkillsOf({ task_types: ['API', 'UI', 'TEST'] }).skills) === JSON.stringify(['BE', 'FE', 'QA']));
  check('requiredSkillsOf: reads tasks[].type too (DB,TEST → BE,QA)', JSON.stringify(requiredSkillsOf({ tasks: [{ type: 'DB' }, { type: 'TEST' }] }).skills) === JSON.stringify(['BE', 'QA']));
  check('requiredSkillsOf: no tasks → empty skills, hasTasks false', requiredSkillsOf({ task_types: [] }).skills.length === 0 && requiredSkillsOf({}).hasTasks === false);
  check('requiredSkillsOf: unknown task type surfaced (schema drift)', requiredSkillsOf({ task_types: ['FOO'] }).unknownTypes.includes('FOO'));
  check('TASK_TYPE_TO_SKILL: the echoed 7→3 map (DOC→FE)', TASK_TYPE_TO_SKILL.API === 'BE' && TASK_TYPE_TO_SKILL.DOC === 'FE' && TASK_TYPE_TO_SKILL.TEST === 'QA' && SKILL_BUCKETS.length === 3);
  check('apportionPoints: 8 across BE/FE/QA → 8/3 each (float, not pre-rounded)', approx(apportionPoints(8, ['BE', 'FE', 'QA']).BE, 8 / 3) && approx(apportionPoints(8, ['BE', 'FE', 'QA']).QA, 8 / 3));
  check('apportionPoints: no skill → whole points to GEN (never dropped)', apportionPoints(5, []).GEN === 5);
  check('apportionPoints: 0/invalid points → all zero', apportionPoints(0, ['BE']).BE === 0 && apportionPoints(NaN, ['BE']).BE === 0);
  const fs = featureSkillSplit([{ _uid: 'a', task_types: ['API'] }, { _uid: 'b', task_types: [] }], (f) => f._uid, new Map([['a', 4], ['b', 3]]));
  check('featureSkillSplit: classified demand on its bucket', fs.demand.get('a').BE === 4 && fs.demand.get('a').FE === 0);
  check('featureSkillSplit: unclassified → GEN + diagnostic channel', fs.demand.get('b').GEN === 3 && fs.unclassified.some((u) => u.id === 'b' && u.reason === 'no_tasks'));

  // ── computeCapacity per-bucket ──
  const capS = computeCapacity({ people: [{ name: 'A', skill: 'BE', availableDays: 10 }, { name: 'B', skill: 'FE', availableDays: 10 }], sprintCount: 2, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 });
  check('computeCapacity: bucketsActive when ≥1 person tagged', capS.bucketsActive === true);
  check('computeCapacity: BE/FE = 7 each, QA = 0', approx(capS.perSprintBucketCapacity.BE[0], 7) && approx(capS.perSprintBucketCapacity.FE[0], 7) && approx(capS.perSprintBucketCapacity.QA[0], 0));
  check('computeCapacity: Σ buckets === scalar perSprint (roll-up consistent)', approx(capS.perSprintBucketCapacity.BE[0] + capS.perSprintBucketCapacity.FE[0] + capS.perSprintBucketCapacity.QA[0] + capS.perSprintBucketCapacity.GEN[0], capS.perSprintCapacityPoints[0]));
  check('computeCapacity: NO skills tagged → bucketsActive false (pooled, back-compat)', computeCapacity({ people: [{ name: 'A', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 }).bucketsActive === false);
  check('computeCapacity: override disables buckets (CAP-9 honesty)', computeCapacity({ people: [{ name: 'A', skill: 'BE', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10, pointsPerSprintOverride: 20 }).bucketsActive === false);

  // ── the BOTTLENECK story: BE overflow while FE sits idle (the existential PIT-1) ──
  const feats = [mkSkillF('b1', 'BE1', 3, ['API']), mkSkillF('b2', 'BE2', 3, ['API']), mkSkillF('b3', 'BE3', 3, ['API']), mkSkillF('f1', 'FE1', 3, ['UI'])];
  const form = { people: [{ name: 'BE', skill: 'BE', availableDays: 5 }, { name: 'FE', skill: 'FE', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 };
  const plan = assemblePlan({ features: feats, capacity: computeCapacity(form), ranking: null }); // BE cap 3.5, FE cap 7
  check('packer: bucketsActive flows through assemblePlan', plan.bucketsActive === true);
  const beOver = plan.overflow.filter((o) => o.reason === 'bucket_exhausted');
  check('packer: 2 BE features overflow bucket_exhausted, starved [BE]', beOver.length === 2 && beOver.every((o) => o.starvedBuckets.join() === 'BE'));
  check('packer: FE capacity surfaced as IDLE (the idle-beside-overflow honesty)', plan.bucketMetrics.idle.some((x) => x.bucket === 'FE' && x.freePoints > 0));
  check('packer: BE named the bottleneck', plan.bucketMetrics.bottleneckBuckets.includes('BE'));
  check('packer: §11 violations channel EMPTY (no idle-beside-overflow lie)', plan.violations.length === 0);

  // ── cross-bucket dependency deadlock: FE feature blocked by a BE feature the BE bottleneck dropped ──
  const feats2 = [mkSkillF('Y', 'BackendY', 3, ['API']), mkSkillF('X', 'FrontendX', 3, ['UI'], 'Medium', ['BackendY'])];
  const plan2 = assemblePlan({ features: feats2, capacity: computeCapacity({ people: [{ name: 'FE', skill: 'FE', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 }), ranking: null }); // BE cap 0
  const oY = plan2.overflow.find((o) => o.name === 'BackendY');
  const oX = plan2.overflow.find((o) => o.name === 'FrontendX');
  check('deadlock: Y overflows bucket_exhausted [BE] (no BE staffed → not force-placed)', oY && oY.reason === 'bucket_exhausted' && oY.starvedBuckets.includes('BE'));
  check('deadlock: X overflows blocker_overflowed, rootCause = Y (chain terminates honestly)', oX && oX.reason === 'blocker_overflowed' && oX.rootCauseName === 'BackendY');
  check('deadlock: FE idle surfaced while a FE feature was dropped', plan2.bucketMetrics.idle.some((x) => x.bucket === 'FE'));
  check('deadlock: violations EMPTY', plan2.violations.length === 0);

  // ── per-bucket oversized force-place (a feature whose BE share exceeds any sprint's BE capacity) ──
  const plan3 = assemblePlan({ features: [mkSkillF('big', 'BigBE', 20, ['API'])], capacity: computeCapacity({ people: [{ name: 'BE', skill: 'BE', availableDays: 5 }], sprintCount: 2, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 }), ranking: null });
  check('oversized: BigBE force-placed, flagged oversized-by [BE]', plan3.oversized.length === 1 && Array.isArray(plan3.oversized[0].buckets) && plan3.oversized[0].buckets.includes('BE'));
  check('oversized: a sprint is marked over capacity', plan3.sprints.some((sp) => sp.overCapacity));

  // ── §13 gate MED fix: an oversized force-place must FIRE the bottleneck (not read "balanced + idle") ──
  const plan3b = assemblePlan({ features: [mkSkillF('big', 'BigBE', 10, ['API'])], capacity: computeCapacity({ people: [{ name: 'BE', skill: 'BE', availableDays: 5 }, { name: 'FE', skill: 'FE', availableDays: 10 }], sprintCount: 1, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 }), ranking: null }); // BE cap 3.5, FE cap 7
  check('overfilled: oversized BE force-place FIRES the bottleneck', plan3b.bucketMetrics.bottleneckBuckets.includes('BE') && plan3b.bucketMetrics.overfilled.BE > 6);
  check('overfilled: FE reported idle, BE (over capacity) NOT reported idle', plan3b.bucketMetrics.idle.some((x) => x.bucket === 'FE') && !plan3b.bucketMetrics.idle.some((x) => x.bucket === 'BE'));

  // ── unclassifiable (zero-task) sized feature → GEN pool, surfaced, NEVER dropped/fake-fit ──
  const plan4 = assemblePlan({ features: [mkSkillF('u1', 'NoTasks', 3, [])], capacity: computeCapacity({ people: [{ name: 'BE', skill: 'BE', availableDays: 10 }, { name: 'gen', availableDays: 5 }], sprintCount: 1, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 }), ranking: null });
  check('unclassified: zero-task sized feature flagged in skillDiagnostics', plan4.skillDiagnostics.unclassified.some((u) => u.id === 'u1' && u.reason === 'no_tasks'));
  check('unclassified: placed via the GEN generalist pool (not dropped)', plan4.sprints.some((sp) => sp.ids.includes('u1')));

  // ── multi-skill feature placed only when ALL its buckets fit simultaneously ──
  const planM = assemblePlan({ features: [mkSkillF('m', 'Multi', 6, ['API', 'UI'])], capacity: computeCapacity({ people: [{ name: 'BE', skill: 'BE', availableDays: 5 }, { name: 'FE', skill: 'FE', availableDays: 5 }], sprintCount: 1, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 }), ranking: null });
  check('multi-skill: feature consuming BE+FE placed when both have room', planM.sprints.some((sp) => sp.ids.includes('m')) && planM.overflow.length === 0);

  // ── ⭐ HONEST-BOTTLENECK FIX (live-acceptance 2026-06-20): an ATOMIC feature needing BE+QA overflows because
  //    QA=0, but BE has ample IDLE capacity. ONLY QA is the bottleneck — BE must NOT be flagged "beyond capacity"
  //    (the old bucketUnmet counted the unplaced-but-idle BE demand as a shortage → contradictory "BE beyond +
  //    BE idle" + the wrong advice "rebalance toward backend"). ──
  const planQA0 = assemblePlan({ features: [mkSkillF('beqa', 'BeQa', 8, ['API', 'TEST'])], capacity: computeCapacity({ people: [{ name: 'BE', skill: 'BE', availableDays: 20 }], sprintCount: 2, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 }), ranking: null }); // BE cap 28, QA cap 0
  const bmQ = planQA0.bucketMetrics;
  check('honest-bottleneck: QA=0 + idle BE → ONLY QA is the bottleneck (BE not falsely flagged)', bmQ.bottleneckBuckets.includes('QA') && !bmQ.bottleneckBuckets.includes('BE'));
  check('honest-bottleneck: overDemand QA>0 but overDemand BE≈0 (BE demand < BE capacity)', bmQ.overDemand.QA > 0.05 && bmQ.overDemand.BE <= 0.05);
  check('honest-bottleneck: BE reported IDLE despite the feature’s unplaced BE share', bmQ.idle.some((x) => x.bucket === 'BE' && x.freePoints > 0));
  check('honest-bottleneck: overflow reason names ONLY QA (starvedBuckets), not idle BE', planQA0.overflow[0] && planQA0.overflow[0].starvedBuckets && planQA0.overflow[0].starvedBuckets.includes('QA') && !planQA0.overflow[0].starvedBuckets.includes('BE'));
  // a genuine BE over-capacity (demand > BE capacity) MUST still flag BE — the fix doesn't suppress real shortages
  const planBEshort = assemblePlan({ features: [mkSkillF('b1', 'B1', 8, ['API']), mkSkillF('b2', 'B2', 8, ['API'])], capacity: computeCapacity({ people: [{ name: 'BE', skill: 'BE', availableDays: 5 }], sprintCount: 1, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 }), ranking: null }); // BE cap 3.5, demand 16
  check('honest-bottleneck: a GENUINE BE over-capacity still flags BE (no false negative)', planBEshort.bucketMetrics.bottleneckBuckets.includes('BE') && planBEshort.bucketMetrics.overDemand.BE > 0.05);

  // ── ⭐ §13-gate GEN EXCLUSION: an unclassifiable feature (no task types → GEN) on a team with NO generalist
  //    → GEN over-demand > 0, BUT GEN is NOT a bottleneck. GEN over-demand is a CLASSIFICATION gap ("add task
  //    types"), not a capacity shortage ("hire a generalist") — flagging GEN would reintroduce contradictory advice. ──
  const planGen = assemblePlan({ features: [mkSkillF('g1', 'NoSkill', 5, [])], capacity: computeCapacity({ people: [{ name: 'BE', skill: 'BE', availableDays: 20 }], sprintCount: 1, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 }), ranking: null }); // GEN cap 0
  check('GEN exclusion: GEN over-demand exists but GEN is NOT flagged a bottleneck (classification gap, not capacity)', planGen.bucketMetrics.overDemand.GEN > 0.05 && !planGen.bucketMetrics.bottleneckBuckets.includes('GEN'));
  check('GEN exclusion: GEN never appears as "idle" either (0 capacity) — surfaced via overflow/SkillDiagnostics', !planGen.bucketMetrics.idle.some((x) => x.bucket === 'GEN'));
  check('GEN exclusion: the overflow names GEN as the unmet skill (→ "add task types", handled by overflowReasonText)', planGen.overflow[0] && planGen.overflow[0].starvedBuckets && planGen.overflow[0].starvedBuckets.includes('GEN'));
}

// ════════════════ 13. GOAL-DIRECTED RE-RANK (P12) ════════════════
console.log('\ngoal-directed re-rank (P12) — objective clauses + prompt injection + §5 Bug-Y:');
{
  check('PLAN_OBJECTIVES: exactly 4 tokens incl. min_risk (hit_deadlines dropped)', PLAN_OBJECTIVES.length === 4 && PLAN_OBJECTIVES.includes('balanced') && PLAN_OBJECTIVES.includes('min_risk') && !PLAN_OBJECTIVES.includes('hit_deadlines'));
  check('objectiveClause: mvp → an abstract GOAL clause', /usable end-to-end slice/.test(objectiveClause('mvp') || ''));
  check('objectiveClause: min_risk → de-risk goal', /delivery uncertainty/.test(objectiveClause('min_risk') || ''));
  check('objectiveClause: balanced / unknown → null (no clause injected)', objectiveClause('balanced') === null && objectiveClause('nope') === null);
  const rows = [{ feature_id: 'a', name: 'A', story_points: 5 }];
  const pMvp = buildPlanRankingUserPrompt({ rows, globals: { objective: 'mvp', sprintCount: 2 }, specSummary: '', specConcerns: [] });
  check('buildPlanRankingUserPrompt: mvp → PLANNING OBJECTIVE block rendered (before CAPACITY)', pMvp.includes('# PLANNING OBJECTIVE') && pMvp.includes('usable end-to-end slice') && pMvp.indexOf('# PLANNING OBJECTIVE') < pMvp.indexOf('# CAPACITY CONTEXT'));
  const pBal = buildPlanRankingUserPrompt({ rows, globals: { objective: 'balanced', sprintCount: 2 }, specSummary: '', specConcerns: [] });
  check('buildPlanRankingUserPrompt: balanced → NO objective block (default order stands)', !pBal.includes('# PLANNING OBJECTIVE'));
  // §5 Bug-Y: the clauses must be ABSTRACT goals — NO enumerated domain/feature topic nouns
  const allClauses = ['mvp', 'min_risk', 'max_value'].map(objectiveClause).join(' ');
  check('§5 Bug-Y: objective clauses name NO domain/feature topics (auth/payment/dashboard/checkout/login/CRUD)', !/\b(auth|payment|dashboard|checkout|login|CRUD|signup|invoice)\b/i.test(allClauses));

  // ── P12 deep-audit (P12-03/P12-04): the allow-list ↔ clause-map LOCKSTEP + the sanitize CONTRACT ──
  // Lockstep: every non-'balanced' objective MUST resolve to a real clause and 'balanced' to null —
  // so an objective added to PLAN_OBJECTIVES without a matching OBJECTIVE_CLAUSES entry fails HERE,
  // not silently in production (it would inject the empty default order under a non-default label).
  check('P12 lockstep: every non-balanced objective has a non-null clause; balanced → null',
    PLAN_OBJECTIVES.every((t) => (t === 'balanced' ? objectiveClause(t) === null : (typeof objectiveClause(t) === 'string' && objectiveClause(t).length > 0))));
  // Sanitize CONTRACT — mirrors startPlan's allow-list gate (the resolver isn't node-importable, so the
  // contract is pinned here): unknown / missing / wrong-type → 'balanced'; a known token passes through.
  const sanitizeObjective = (v) => (new Set(PLAN_OBJECTIVES).has(v) ? v : 'balanced');
  check('P12 sanitize: unknown string → balanced', sanitizeObjective('hit_deadlines') === 'balanced' && sanitizeObjective('') === 'balanced');
  check('P12 sanitize: missing / wrong-type → balanced', sanitizeObjective(undefined) === 'balanced' && sanitizeObjective(null) === 'balanced' && sanitizeObjective(42) === 'balanced');
  check('P12 sanitize: every allow-listed token passes through unchanged', PLAN_OBJECTIVES.every((t) => sanitizeObjective(t) === t));
}

// ════════════════ Kanban v1 — computeThroughput (capacity-derived reach band) ════════════════
console.log('\nKanban — computeThroughput (reach band, fail-loud parity with computeCapacity):');
{
  // 2 people × 30 quarter-days × 6h × 0.7 ÷ 6 = 42 expected pts/quarter
  const ok = computeThroughput({ people: [{ name: 'A', availableDays: 30 }, { name: 'B', availableDays: 30 }], focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 });
  check('throughput valid → ok', ok.ok === true && ok.errors.length === 0);
  check('throughput: 2×30×6×0.7/6 = 42 expected pts/quarter', approx(ok.expectedPointsQuarter, 42));
  check('throughput: conservative = 42 × 0.8', approx(ok.conservativePoints, 42 * REACH_CONSERVATIVE_FACTOR));
  check('throughput: optimistic = 42 × 1.1', approx(ok.optimisticPoints, 42 * REACH_OPTIMISTIC_FACTOR));
  check('throughput: a RANGE, not a point (conservative < expected < optimistic)', ok.conservativePoints < ok.expectedPointsQuarter && ok.expectedPointsQuarter < ok.optimisticPoints);
  // C6 (deep-audit): prove sprint fields are INERT (accepted-and-ignored), not the tautology "no SPRINT error on an already-empty errors array"
  const withSprintFields = computeThroughput({ people: [{ name: 'A', availableDays: 30 }, { name: 'B', availableDays: 30 }], focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6, sprintCount: 4, sprintLengthDays: 10 });
  check('throughput: sprint fields are INERT (same expectedPointsQuarter with or without them)', withSprintFields.ok && approx(withSprintFields.expectedPointsQuarter, ok.expectedPointsQuarter));
  check('throughput: honesty echoes present (noFlowHistory + reachBand + steadyFlow)', ['noFlowHistory', 'reachBand', 'steadyFlow'].every((k) => ok.assumptions.some((a) => a.key === k)));
  check('throughput: availableDays labelled PER QUARTER (not per sprint)', ok.assumptions.some((a) => a.key === 'availableDaysContract' && /per quarter/i.test(a.label)));

  // fail-loud parity with computeCapacity
  check('throughput empty roster → ZERO_CAPACITY', hasErr(computeThroughput({ people: [] }), 'ZERO_CAPACITY'));
  check('throughput all days 0 → ZERO_CAPACITY', hasErr(computeThroughput({ people: [{ name: 'A', availableDays: 0 }] }), 'ZERO_CAPACITY'));
  check('throughput focusFactor 70 (unit trap) → INVALID_FOCUS_FACTOR', hasErr(computeThroughput({ people: [{ name: 'A', availableDays: 30 }], focusFactor: 70 }), 'INVALID_FOCUS_FACTOR'));
  check("throughput availableDays '' → INVALID (not silent 0)", hasErr(computeThroughput({ people: [{ name: 'A', availableDays: '' }] }), 'INVALID_AVAILABLE_DAYS'));
  check('throughput availableDays negative → INVALID', hasErr(computeThroughput({ people: [{ name: 'A', availableDays: -5 }] }), 'INVALID_AVAILABLE_DAYS'));
  check('throughput hoursPerPoint 0 → INVALID (divisor guard)', hasErr(computeThroughput({ people: [{ name: 'A', availableDays: 30 }], hoursPerPoint: 0 }), 'INVALID_HOURS_PER_POINT'));
  const clamp = computeThroughput({ people: [{ name: 'A', availableDays: 200 }], hoursPerDay: 6, focusFactor: 0.7, hoursPerPoint: 6 });
  check('throughput availableDays > MAX_QUARTER_DAYS → clamped + warn (catches a per-sprint figure)', clamp.ok && hasWarn(clamp, 'AVAILABLE_DAYS_CLAMPED'));

  // override path (precedence + surfaced)
  const ov = computeThroughput({ people: [{ name: 'A', availableDays: 30 }], pointsPerQuarterOverride: 50 });
  check('throughput override → expected = override', ov.ok && approx(ov.expectedPointsQuarter, 50));
  check('throughput override → band derived from override', approx(ov.conservativePoints, 50 * REACH_CONSERVATIVE_FACTOR) && approx(ov.optimisticPoints, 50 * REACH_OPTIMISTIC_FACTOR));

  // deep-audit branch coverage (the fail-loud parity branches the +35 block missed)
  check('throughput override <= 0 → INVALID_OVERRIDE', hasErr(computeThroughput({ people: [{ name: 'A', availableDays: 30 }], pointsPerQuarterOverride: 0 }), 'INVALID_OVERRIDE'));
  check('throughput override far from team-derived → OVERRIDE_DISCREPANCY warn', hasWarn(computeThroughput({ people: [{ name: 'A', availableDays: 30 }], focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6, pointsPerQuarterOverride: 500 }), 'OVERRIDE_DISCREPANCY'));
  check('throughput duplicate person name (case-insensitive) → DUPLICATE_PERSON_NAME warn', hasWarn(computeThroughput({ people: [{ name: 'A', availableDays: 10 }, { name: 'a', availableDays: 10 }] }), 'DUPLICATE_PERSON_NAME'));
  check('throughput blank-named person with days → BLANK_PERSON_NAME warn', hasWarn(computeThroughput({ people: [{ name: '', availableDays: 10 }] }), 'BLANK_PERSON_NAME'));
}

// ════════════════ Kanban v1 — packBacklogReach (Now / Next / Later) ════════════════
console.log('\nKanban — packBacklogReach (cumulative reach tiers):');
{
  const feats = [mkF('u1', 'A', 10), mkF('u2', 'B', 10), mkF('u3', 'C', 10), mkF('u4', 'D', 10)];
  const graph = buildPlannerGraph(feats);
  const sizing = validateSizing(feats, idFn());
  const r = packBacklogReach(['u1', 'u2', 'u3', 'u4'], { conservativePoints: 15, optimisticPoints: 25, expectedPointsQuarter: 20 }, graph, sizing.points, sizing.unsized);
  check('reach: Now = items FULLY under conservative (A only, cum 10 ≤ 15)', r.now.map((x) => x.id).join(',') === 'u1');
  check('reach: Next = conservative < cum ≤ optimistic (B, cum 20)', r.next.map((x) => x.id).join(',') === 'u2');
  check('reach: Later = beyond optimistic (C cum30, D cum40)', r.later.map((x) => x.id).join(',') === 'u3,u4');
  check('reach: cumulative carried + monotonic', r.now[0].cumulative === 10 && r.next[0].cumulative === 20 && r.later[0].cumulative === 30);
  check('reach metrics: reachedNow=10, beyondReach=20, total=40', approx(r.metrics.reachedNowPoints, 10) && approx(r.metrics.beyondReachPoints, 20) && approx(r.metrics.totalBacklogPoints, 40));
  check('reach metrics: counts (1/1/2)', r.metrics.nowCount === 1 && r.metrics.nextCount === 1 && r.metrics.laterCount === 2);

  // oversized first item → Later (honest "too big for the quarter", NEVER force-placed)
  const big = [mkF('u1', 'Big', 100)];
  const rB = packBacklogReach(['u1'], { conservativePoints: 15, optimisticPoints: 25 }, buildPlannerGraph(big), validateSizing(big, idFn()).points, []);
  check('reach: oversized first item → Later (no force-place)', rB.now.length === 0 && rB.next.length === 0 && rB.later.length === 1);

  // unsized → DISJOINT sizingIssues channel (never fake-fit at 0)
  const mixed = [mkF('u1', 'A', 10), { _uid: 'u2', _orig_name: 'B', name: 'B', priority: 'Medium', dependencies: [] }];
  const sM = validateSizing(mixed, idFn());
  const rM = packBacklogReach(['u1', 'u2'], { conservativePoints: 100, optimisticPoints: 100 }, buildPlannerGraph(mixed), sM.points, sM.unsized);
  check('reach: unsized → sizingIssues, excluded from tiers', rM.sizingIssues.length === 1 && (rM.now.length + rM.next.length + rM.later.length) === 1);

  // C5 (deep-audit): the EXACT reach boundary — the EPS-inclusive <= decision the tiering depends on (would slip silently if <= became <)
  const bd = [mkF('u1', 'A', 15), mkF('u2', 'B', 10)];
  const rBd = packBacklogReach(['u1', 'u2'], { conservativePoints: 15, optimisticPoints: 25 }, buildPlannerGraph(bd), validateSizing(bd, idFn()).points, []);
  check('reach boundary: cum == conservative → Now (EPS-inclusive, NOT demoted)', rBd.now.map((x) => x.id).join(',') === 'u1');
  check('reach boundary: cum == optimistic → Next (B at cum 25 ≤ 25)', rBd.next.map((x) => x.id).join(',') === 'u2');
  // straddle: an item that pushes cumulative just PAST conservative is honestly demoted to Next (the design claim)
  const stf = [mkF('u1', 'A', 14), mkF('u2', 'B', 3)];
  const rSt = packBacklogReach(['u1', 'u2'], { conservativePoints: 15, optimisticPoints: 25 }, buildPlannerGraph(stf), validateSizing(stf, idFn()).points, []);
  check('reach straddle: A(14)≤15 Now; B pushes cum→17 >15 → demoted to Next', rSt.now.map((x) => x.id).join(',') === 'u1' && rSt.next.map((x) => x.id).join(',') === 'u2');
  // C1 (deep-audit): band rows carry { id, points, cumulative } ONLY — no redundant name (single name source = record.features)
  check('reach: band rows carry id/points/cumulative only — no name (KVS thrift)', rBd.now.every((x) => x.name === undefined && typeof x.id === 'string' && typeof x.cumulative === 'number'));

  // edge: empty order + zero capacity
  check('reach: empty order → all empty, no throw', (() => { const e = packBacklogReach([], { conservativePoints: 10, optimisticPoints: 20 }, graph, new Map(), []); return e.now.length === 0 && e.later.length === 0 && e.metrics.totalBacklogPoints === 0; })());
  check('reach: zero capacity → everything Later (honest, never silent)', (() => { const z = packBacklogReach(['u1', 'u2', 'u3', 'u4'], { conservativePoints: 0, optimisticPoints: 0 }, graph, sizing.points, sizing.unsized); return z.now.length === 0 && z.next.length === 0 && z.later.length === 4; })());
}

// ════════════════ Kanban v1 — assemblePlan methodology fork (+ back-compat) ════════════════
console.log('\nKanban — assemblePlan fork (kanban path + scrum back-compat):');
{
  const feats = [mkF('u1', 'A', 10, 'High'), mkF('u2', 'B', 10, 'Medium', ['A']), mkF('u3', 'C', 10, 'Low')];
  const capK = computeThroughput({ people: [{ name: 'A', availableDays: 30 }], focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 }); // ~21 expected
  const planK = assemblePlan({ features: feats, capacity: capK, ranking: null, methodology: 'kanban' });
  check('kanban plan: methodology tagged "kanban"', planK.methodology === 'kanban');
  check('kanban plan: now/next/later present, NO sprints key', Array.isArray(planK.now) && Array.isArray(planK.later) && planK.sprints === undefined);
  check('kanban plan: sprintRiskProfiles empty (no sprints in Kanban)', Array.isArray(planK.sprintRiskProfiles) && planK.sprintRiskProfiles.length === 0);
  check('kanban plan: riskByFeature still present (per-feature risk works)', planK.riskByFeature && typeof planK.riskByFeature === 'object');
  check('kanban plan: dependency order respected (A before B across the reach tiers)', (() => { const all = [...planK.now, ...planK.next, ...planK.later].map((x) => x.id); return all.indexOf('u1') >= 0 && all.indexOf('u1') < all.indexOf('u2'); })());

  // BACK-COMPAT: methodology omitted/'scrum' → the existing sprint path, byte-identical
  const capS = computeCapacity({ people: [{ name: 'A', availableDays: 10 }], sprintCount: 2, sprintLengthDays: 10, focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 });
  const planOmitted = assemblePlan({ features: feats, capacity: capS, ranking: null });
  const planScrum = assemblePlan({ features: feats, capacity: capS, ranking: null, methodology: 'scrum' });
  check('scrum plan: methodology omitted → "scrum" + has sprints (back-compat)', planOmitted.methodology === 'scrum' && Array.isArray(planOmitted.sprints));
  check('scrum plan: explicit "scrum" === omitted (byte-identical)', JSON.stringify(planOmitted) === JSON.stringify(planScrum));
  check('scrum plan: keeps sprintRiskProfiles + NO now/next/later', Array.isArray(planOmitted.sprintRiskProfiles) && planOmitted.now === undefined);
}

// ════════════════ Kanban v1 — dependency-tier invariant + LLM ranking interaction (deep-audit G3) ════════════════
console.log('\nKanban — dependency-tier consistency invariant (why packBacklogReach skips the readiness gate) + ranking:');
{
  // A blocks B blocks C. Through the REAL topo (assemblePlan, not a hardcoded order) with a TIGHT band, a blocker
  // must NEVER land in a LATER reach tier than its dependent — i.e. no Now/Next feature may depend on a Later one.
  const chain = [mkF('u1', 'A', 10, 'High'), mkF('u2', 'B', 10, 'High', ['A']), mkF('u3', 'C', 10, 'High', ['B'])];
  const capK = computeThroughput({ people: [{ name: 'A', availableDays: 15 }], focusFactor: 0.7, hoursPerDay: 6, hoursPerPoint: 6 }); // ~10.5 expected → tight band
  const planK = assemblePlan({ features: chain, capacity: capK, ranking: null, methodology: 'kanban' });
  const tierOf = (id) => (planK.now.some((x) => x.id === id) ? 0 : planK.next.some((x) => x.id === id) ? 1 : 2);
  check('invariant: blocker tier ≤ dependent tier (A ≤ B ≤ C) — no Now/Next item depends on a Later item', tierOf('u1') <= tierOf('u2') && tierOf('u2') <= tierOf('u3'));

  // kanban + a NON-NULL ranking that CONTRADICTS the dependency order: the DAG must still win (B cannot precede A)
  const contrary = [{ feature_id: 'u2', rank: 1, rationale: '' }, { feature_id: 'u1', rank: 2, rationale: '' }, { feature_id: 'u3', rank: 3, rationale: '' }];
  const planR = assemblePlan({ features: chain, capacity: capK, ranking: contrary, methodology: 'kanban' });
  const order = [...planR.now, ...planR.next, ...planR.later].map((x) => x.id);
  check('kanban + contrary ranking: DAG wins — A before B before C despite the LLM order', order.indexOf('u1') < order.indexOf('u2') && order.indexOf('u2') < order.indexOf('u3'));
}

// ════════════════ summary ════════════════
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
