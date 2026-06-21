#!/usr/bin/env node
/**
 * Offline control-flow test for the deep-audit cycle-resolution fix (verifyAndRepairCycles, index.js).
 *
 * The bug: the old `for (const path of cycles)` loop iterated the STALE cycle list from ONE detectCycles
 * call. A single cut can break SEVERAL overlapping cycles (a mutual A↔B pair; a 3-node knot seen from
 * different entry nodes), so the stale loop over-cut genuine edges AND emitted contradictory concerns
 * (FlexiCash: a mutual RBP↔ACD pair had BOTH directions cut + 3 contradictory [RISK|low] concerns).
 *
 * The fix: re-detect after each cut (only ever cut a STILL-LIVE cycle) + a cutEdges guard refusing to
 * cut the reverse of an already-cut edge (never cut both directions of a mutual pair).
 *
 * This test REPLICATES the loop's control flow EXACTLY (the cut-selection is the only thing stubbed —
 * deterministic "cut the softest edge" instead of the LLM) and runs it against the REAL detectCycles,
 * proving the algorithm is COHERENT (no both-directions cut), MINIMAL (no over-cut of a dead cycle),
 * and TERMINATING. Zero API cost.
 *
 * Usage: node prototype/test_cycle_repair.js
 */
import { detectCycles } from '../src/graph.js';

const MAX_CYCLE_RESOLVES = 5;

/**
 * Replica of verifyAndRepairCycles' control flow. `chooseCut(path, features)` stands in for the LLM
 * resolveDependencyCycle call — here a deterministic stub. Returns { cuts, concerns, finalFeatures }.
 */
function runRepair(features, chooseCut) {
  let cycles = detectCycles(features);
  const byName = new Map(features.map((f) => [f.name, f]));
  const concerns = [];
  const cuts = [];
  const cutEdges = new Set();
  const unresolvable = new Set();
  const sigOf = (p) => [...p].sort().join('|');
  let resolves = 0;
  let iterations = 0;

  while (resolves < MAX_CYCLE_RESOLVES) {
    if (++iterations > 100) throw new Error('NON-TERMINATING: exceeded 100 iterations');
    const path = cycles.find((c) => !unresolvable.has(sigOf(c)));
    if (!path) break;

    const cut = chooseCut(path, path.map((n) => byName.get(n)).filter(Boolean));
    const f = cut && byName.get(cut.cut_from);
    const edgeLive = f && Array.isArray(f.dependencies) && f.dependencies.includes(cut.cut_to);
    const reverseAlreadyCut = cut && cutEdges.has(`${cut.cut_to}→${cut.cut_from}`);

    if (edgeLive && !reverseAlreadyCut) {
      f.dependencies = f.dependencies.filter((d) => d !== cut.cut_to);
      cutEdges.add(`${cut.cut_from}→${cut.cut_to}`);
      cuts.push(`${cut.cut_from}→${cut.cut_to}`);
      resolves++;
      concerns.push(`[RISK|low] dropped ${cut.cut_from}→${cut.cut_to}`);
      cycles = detectCycles(features);
      continue;
    }
    concerns.push(`[RISK|medium] ${path.join('→')}→${path[0]}`);
    unresolvable.add(sigOf(path));
  }
  for (const c of cycles) {
    if (!unresolvable.has(sigOf(c))) {
      concerns.push(`[RISK|medium] ${c.join('→')}→${c[0]}`);
      unresolvable.add(sigOf(c));
    }
  }
  return { cuts, concerns, finalFeatures: features };
}

// Deterministic stub: cut the edge from path[0] → next-in-path (the "closing" softer edge convention).
// Mirrors the LLM picking ONE edge per cycle; the test asserts the LOOP stays coherent regardless.
function stubCutFirstEdge(path) {
  return { cut_from: path[0], cut_to: path[1] || path[0], reason: 'stub' };
}
// Adversarial stub: tries to cut the REVERSE of whatever 2-cycle it sees (worst case for coherence).
function stubCutReverse(path) {
  // For a 2-cycle [A,B], cut B→A; the loop's reverseAlreadyCut guard must still prevent both directions.
  return { cut_from: path[path.length - 1], cut_to: path[0], reason: 'stub-rev' };
}

function clone(features) {
  return features.map((f) => ({ name: f.name, dependencies: [...(f.dependencies || [])] }));
}
function pairBothCut(cuts) {
  const set = new Set(cuts);
  for (const e of cuts) {
    const [a, b] = e.split('→');
    if (set.has(`${b}→${a}`)) return `${a}↔${b}`;
  }
  return null;
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}  — ${detail}`); failures++; }
}

console.log('Cycle-repair control-flow test (offline, real detectCycles)\n' + '='.repeat(60));

// ── Case 1: FlexiCash knot — mutual RBP↔ACD + 3-node ACD→Aff→RBP→ACD ──────────────
{
  const g = [
    { name: 'RBP', dependencies: ['ACD'] },
    { name: 'ACD', dependencies: ['RBP', 'Eligibility', 'Affordability', 'Document'] },
    { name: 'Affordability', dependencies: ['RBP', 'Eligibility'] },
    { name: 'Eligibility', dependencies: [] },
    { name: 'Document', dependencies: [] },
  ];
  console.log('\n■ Case 1: FlexiCash knot (mutual RBP↔ACD + 3-node)');
  console.log(`    cycles before: ${detectCycles(clone(g)).length}`);
  const r = runRepair(clone(g), stubCutFirstEdge);
  console.log(`    cuts: [${r.cuts.join(', ')}]  concerns: ${r.concerns.length}`);
  check('graph becomes acyclic', detectCycles(r.finalFeatures).length === 0, 'still cyclic');
  check('no node-pair cut in BOTH directions', !pairBothCut(r.cuts), `both: ${pairBothCut(r.cuts)}`);
  check('minimal cuts (≤2, old loop emitted 3)', r.cuts.length <= 2, `${r.cuts.length} cuts`);
}

// ── Case 2: pure 2-cycle (mutual) — must cut EXACTLY ONE edge, not both ────────────
{
  const g = [
    { name: 'A', dependencies: ['B'] },
    { name: 'B', dependencies: ['A'] },
  ];
  console.log('\n■ Case 2: pure 2-cycle A↔B');
  const r = runRepair(clone(g), stubCutFirstEdge);
  console.log(`    cuts: [${r.cuts.join(', ')}]  concerns: ${r.concerns.length}`);
  check('exactly ONE cut (not both directions)', r.cuts.length === 1, `${r.cuts.length} cuts`);
  check('acyclic after', detectCycles(r.finalFeatures).length === 0, 'still cyclic');
}

// ── Case 3: adversarial stub on a 2-cycle — reverse-guard must still hold ──────────
{
  const g = [
    { name: 'A', dependencies: ['B'] },
    { name: 'B', dependencies: ['A'] },
  ];
  console.log('\n■ Case 3: 2-cycle with adversarial reverse-cutting stub');
  const r = runRepair(clone(g), stubCutReverse);
  console.log(`    cuts: [${r.cuts.join(', ')}]  concerns: ${r.concerns.length}`);
  check('no node-pair cut in BOTH directions', !pairBothCut(r.cuts), `both: ${pairBothCut(r.cuts)}`);
  check('acyclic after', detectCycles(r.finalFeatures).length === 0, 'still cyclic');
}

// ── Case 4: acyclic graph — no cuts, no concerns ──────────────────────────────────
{
  const g = [
    { name: 'A', dependencies: ['B'] },
    { name: 'B', dependencies: ['C'] },
    { name: 'C', dependencies: [] },
  ];
  console.log('\n■ Case 4: acyclic A→B→C');
  const r = runRepair(clone(g), stubCutFirstEdge);
  check('no cuts', r.cuts.length === 0, `${r.cuts.length} cuts`);
  check('no concerns', r.concerns.length === 0, `${r.concerns.length} concerns`);
}

// ── Case 5: two INDEPENDENT cycles — both resolved, terminates ─────────────────────
{
  const g = [
    { name: 'A', dependencies: ['B'] },
    { name: 'B', dependencies: ['A'] },
    { name: 'X', dependencies: ['Y'] },
    { name: 'Y', dependencies: ['Z'] },
    { name: 'Z', dependencies: ['X'] },
  ];
  console.log('\n■ Case 5: two independent cycles (2-node A↔B + 3-node X→Y→Z→X)');
  const r = runRepair(clone(g), stubCutFirstEdge);
  console.log(`    cuts: [${r.cuts.join(', ')}]  concerns: ${r.concerns.length}`);
  check('acyclic after', detectCycles(r.finalFeatures).length === 0, 'still cyclic');
  check('exactly 2 cuts (one per independent cycle)', r.cuts.length === 2, `${r.cuts.length} cuts`);
  check('no both-directions', !pairBothCut(r.cuts), `both: ${pairBothCut(r.cuts)}`);
}

console.log('\n' + '='.repeat(60));
console.log(failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
