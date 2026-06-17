#!/usr/bin/env node
/**
 * Offline test for buildDependencyResolver (src/anthropic_client.js) — Task #4 #2.
 *
 * The test-gen dependencyContext resolved cross-feature edges by CURRENT name, so a peer
 * RENAMED in the editor (its dependencies[] entry stays the FROZEN generation name) was
 * silently dropped as dangling → the renamed dependency's enrichment vanished from the test
 * prompt, AND the reverse "blocks" lookup (keyed by the frozen string) missed a renamed
 * story's blockers. The fix keys resolution by the frozen _orig_name and DISPLAYS the
 * current name. Pure function (no Forge runtime) → runs under plain node.
 *
 * Usage: node prototype/test_dep_context.js
 */
import { buildDependencyResolver } from '../src/anthropic_client.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}  — ${detail}`); failures++; }
}
// feat(name, deps, {orig, us}) — a minimal peer feature
const feat = (name, deps, opts = {}) => ({
  name,
  dependencies: deps || [],
  user_story: opts.us || `As a user, I want ${name}.`,
  ...(opts.orig ? { _orig_name: opts.orig } : {}),
});

console.log('Task #4 #2 buildDependencyResolver — frozen→current dependency-context resolution\n' + '='.repeat(70));

{
  console.log('\n■ dependsOn — normal (no rename)');
  const ctx = buildDependencyResolver([feat('A', []), feat('B', ['A'])])(feat('B', ['A']));
  check('B dependsOn A', ctx.dependsOn.length === 1 && ctx.dependsOn[0].name === 'A', JSON.stringify(ctx.dependsOn));
  check('carries A one-line', ctx.dependsOn[0] && ctx.dependsOn[0].oneLine.includes('want A'), JSON.stringify(ctx.dependsOn));
}
{
  console.log('\n■ dependsOn — RENAME (A→A2; B.dependencies still the frozen "A")');
  const A = feat('A2', [], { orig: 'A' });
  const B = feat('B', ['A']);
  const ctx = buildDependencyResolver([A, B])(B);
  check('resolves to CURRENT name A2 (not dropped)', ctx.dependsOn.length === 1 && ctx.dependsOn[0].name === 'A2', JSON.stringify(ctx.dependsOn));
  check('carries the renamed peer one-line', ctx.dependsOn[0] && ctx.dependsOn[0].oneLine.includes('want A2'), JSON.stringify(ctx.dependsOn));
}
{
  console.log('\n■ blocks — RENAME (A→A2 still finds its blocker B by the frozen identity)');
  const A = feat('A2', [], { orig: 'A' });
  const B = feat('B', ['A']);
  const ctx = buildDependencyResolver([A, B])(A);
  check('A2.blocks includes B', ctx.blocks.length === 1 && ctx.blocks[0].name === 'B', JSON.stringify(ctx.blocks));
}
{
  console.log('\n■ dangling — deleted/paraphrase peer dropped (honest)');
  const ctx = buildDependencyResolver([feat('B', ['Ghost'])])(feat('B', ['Ghost']));
  check('Ghost dropped, no phantom edge', ctx.dependsOn.length === 0, JSON.stringify(ctx.dependsOn));
}
{
  console.log('\n■ legacy — no _orig_name → name-fallback (no regression)');
  const ctx = buildDependencyResolver([feat('A', []), feat('B', ['A'])])(feat('B', ['A']));
  check('resolves by name', ctx.dependsOn.length === 1 && ctx.dependsOn[0].name === 'A', JSON.stringify(ctx.dependsOn));
}
{
  console.log('\n■ self-edge dropped (A depends on itself by its frozen name)');
  const A = feat('A2', ['A'], { orig: 'A' });
  const ctx = buildDependencyResolver([A])(A);
  check('self-dep dropped', ctx.dependsOn.length === 0, JSON.stringify(ctx.dependsOn));
}
{
  console.log('\n■ duplicate _orig_name → first-match, no crash');
  const A1 = feat('A2', [], { orig: 'A', us: 'first A' });
  const A2 = feat('A3', [], { orig: 'A', us: 'second A' });
  const ctx = buildDependencyResolver([A1, A2, feat('B', ['A'])])(feat('B', ['A']));
  check('resolves to exactly one (deterministic first-match)', ctx.dependsOn.length === 1 && (ctx.dependsOn[0].name === 'A2' || ctx.dependsOn[0].name === 'A3'), JSON.stringify(ctx.dependsOn));
}
{
  console.log('\n■ defensive — non-array / null inputs do not throw');
  const ctx = buildDependencyResolver(null)({ name: 'X', dependencies: null });
  check('empty + no throw', Array.isArray(ctx.dependsOn) && Array.isArray(ctx.blocks) && ctx.dependsOn.length === 0 && ctx.blocks.length === 0, JSON.stringify(ctx));
}

console.log('\n' + '='.repeat(70));
if (failures === 0) console.log('✅ ALL PASS');
else { console.log(`❌ ${failures} FAILED`); process.exit(1); }
