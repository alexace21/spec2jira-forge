#!/usr/bin/env node
/**
 * Offline regression test for Task #3 (name→uid dependency-link binding).
 *
 * WHY THIS EXISTS: dependency links were resolved by NAME end-to-end
 * (flattenBreakdown → storyKeyMap → buildResolvableLinks). A rename in the
 * BreakdownEditor left other features' dependencies[] strings holding the OLD
 * name → the edge went unresolved → a MISLEADING "source X not created" (the
 * story WAS created, just renamed) + a ledger mis-class as name_unknown. Live S1.
 *
 * The fix binds each edge to the endpoints' stable _uid (frozen via _orig_name at
 * adaptToLegacyShape), dual-keyed at push (uid-first / name-fallback). This pins:
 *   - flattenBreakdown emits the right sourceUid/targetUid (rename / duplicate /
 *     missing / legacy),
 *   - buildResolvableLinks resolves a renamed edge by uid (the win) and a legacy
 *     edge by name (no regression),
 *   - classifyUnresolvedLinks splits the genuinely-unresolved residue honestly
 *     (story_failed vs the NEW endpoint_deleted vs name_unknown), counts summing
 *     to unresolved.length.
 * All three are pure functions (no Forge runtime) → runs under plain `node`.
 *
 * Usage: node prototype/test_uid_links.js
 */
import { flattenBreakdown, buildResolvableLinks, classifyUnresolvedLinks } from '../src/push_handler.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}  — ${detail}`); failures++; }
}
const link = (links, src, tgt) => links.find((l) => l.source === src && l.target === tgt);

console.log('Task #3 name→uid links — binding + resolution + cause-split\n' + '='.repeat(64));

// ── flattenBreakdown: binding the edge endpoints to _uid ──────────────────────
{
  console.log('\n■ flattenBreakdown — normal (no rename)');
  const A = { name: 'A', _orig_name: 'A', _uid: 's_A', dependencies: [] };
  const B = { name: 'B', _orig_name: 'B', _uid: 's_B', dependencies: ['A'] };
  const { links } = flattenBreakdown({ features: [A, B] });
  const e = link(links, 'A', 'B');
  check('one edge A→B', links.length === 1 && !!e, JSON.stringify(links));
  check('sourceUid = A._uid', e && e.sourceUid === 's_A', JSON.stringify(e));
  check('targetUid = B._uid', e && e.targetUid === 's_B', JSON.stringify(e));
}
{
  console.log('\n■ flattenBreakdown — RENAME (the S1 case: A renamed to A2, dep string + _orig_name frozen)');
  const A = { name: 'A2', _orig_name: 'A', _uid: 's_A', dependencies: [] };
  const B = { name: 'B', _orig_name: 'B', _uid: 's_B', dependencies: ['A'] };
  const { links } = flattenBreakdown({ features: [A, B] });
  const e = link(links, 'A', 'B');
  check('edge still binds to A._uid despite rename', e && e.sourceUid === 's_A', JSON.stringify(e));
  check('source NAME stays the frozen dep string', e && e.source === 'A', JSON.stringify(e));
}
{
  console.log('\n■ flattenBreakdown — DUPLICATE name (ambiguous → unbound)');
  const A1 = { name: 'A', _orig_name: 'A', _uid: 's_A1', dependencies: [] };
  const A2 = { name: 'A', _orig_name: 'A', _uid: 's_A2', dependencies: [] };
  const B = { name: 'B', _orig_name: 'B', _uid: 's_B', dependencies: ['A'] };
  const { links } = flattenBreakdown({ features: [A1, A2, B] });
  const e = link(links, 'A', 'B');
  check('ambiguous duplicate name → sourceUid null (name-fallback)', e && e.sourceUid === null, JSON.stringify(e));
}
{
  console.log('\n■ flattenBreakdown — MISSING dep (model paraphrase)');
  const B = { name: 'B', _orig_name: 'B', _uid: 's_B', dependencies: ['Ghost'] };
  const { links } = flattenBreakdown({ features: [B] });
  const e = link(links, 'Ghost', 'B');
  check('unknown dep name → sourceUid null', e && e.sourceUid === null, JSON.stringify(e));
}
{
  console.log('\n■ flattenBreakdown — LEGACY (no _uid / _orig_name)');
  const A = { name: 'A', dependencies: [] };
  const B = { name: 'B', dependencies: ['A'] };
  const { links } = flattenBreakdown({ features: [A, B] });
  const e = link(links, 'A', 'B');
  check('legacy → sourceUid null', e && e.sourceUid === null, JSON.stringify(e));
  check('legacy → targetUid null', e && e.targetUid === null, JSON.stringify(e));
  check('legacy → names preserved for fallback', e && e.source === 'A' && e.target === 'B', JSON.stringify(e));
}

// ── buildResolvableLinks: dual-path resolution ────────────────────────────────
{
  console.log('\n■ buildResolvableLinks — RENAME resolves by uid (storyKeyMap has the NEW name only)');
  const s = {
    links: [{ source: 'A', target: 'B', sourceUid: 's_A', targetUid: 's_B' }],
    storyKeyMap: { A2: 'PROJ-1', B: 'PROJ-2' }, // A was created under its renamed title
    uidKeyMap: { s_A: 'PROJ-1', s_B: 'PROJ-2' },
  };
  const { resolvable, unresolved } = buildResolvableLinks(s);
  check('renamed edge RESOLVES (0 unresolved)', unresolved.length === 0 && resolvable.length === 1, JSON.stringify({ resolvable, unresolved }));
  check('resolves to the right keys', resolvable[0] && resolvable[0].sourceKey === 'PROJ-1' && resolvable[0].targetKey === 'PROJ-2', JSON.stringify(resolvable));
}
{
  console.log('\n■ buildResolvableLinks — LEGACY resolves by name-fallback');
  const s = {
    links: [{ source: 'A', target: 'B', sourceUid: null, targetUid: null }],
    storyKeyMap: { A: 'PROJ-1', B: 'PROJ-2' },
    uidKeyMap: {},
  };
  const { resolvable, unresolved } = buildResolvableLinks(s);
  check('legacy edge resolves by name (no regression)', unresolved.length === 0 && resolvable.length === 1, JSON.stringify({ resolvable, unresolved }));
}
{
  console.log('\n■ buildResolvableLinks — genuinely unresolved carries uids + reason');
  const s = {
    links: [{ source: 'A', target: 'B', sourceUid: 's_x', targetUid: 's_B' }],
    storyKeyMap: {}, uidKeyMap: { s_B: 'PROJ-2' },
  };
  const { resolvable, unresolved } = buildResolvableLinks(s);
  check('1 unresolved', unresolved.length === 1 && resolvable.length === 0, JSON.stringify({ resolvable, unresolved }));
  check('unresolved carries sourceUid + reason', unresolved[0] && unresolved[0].sourceUid === 's_x' && /source "A" not created/.test(unresolved[0].reason), JSON.stringify(unresolved));
}
{
  console.log('\n■ buildResolvableLinks — missing uidKeyMap defaults safely (in-flight pre-deploy session)');
  const s = { links: [{ source: 'A', target: 'B', sourceUid: null, targetUid: null }], storyKeyMap: { A: 'P-1', B: 'P-2' } };
  const out = buildResolvableLinks(s); // no s.uidKeyMap
  check('does not throw + resolves by name', out.resolvable.length === 1, JSON.stringify(out));
}

// ── classifyUnresolvedLinks: honest 2-way cause-split ─────────────────────────
// (endpoint_deleted was REMOVED as unreachable dead code — flattenBreakdown can only
//  bind a uid from a surviving feature, so a deleted endpoint always yields
//  sourceUid:null → name_unknown. The deep audit proved the old endpoint_deleted
//  test "passed" only on an input the pipeline can never produce. These tests now
//  assert the REAL pipeline shapes.)
{
  console.log('\n■ classifyUnresolvedLinks — story_failed (endpoint feature exists, its Story create failed)');
  const out = classifyUnresolvedLinks(
    [{ source: 'A', target: 'B', sourceUid: 's_A', targetUid: 's_B' }],
    { featureUids: new Set(['s_A', 's_B']), featureNames: new Set(['A', 'B']), storyKeyMap: { B: 'P-2' }, uidKeyMap: { s_B: 'P-2' } },
  );
  check('story_failed=1', out.story_failed === 1 && out.name_unknown === 0, JSON.stringify(out));
}
{
  // The RETAINED uid-aware honesty win: a RENAMED source whose Story FAILED keeps
  // its _uid in featureUids → story_failed, where the old name-only split (the dep
  // string 'A' is the OLD name, absent from current featureNames {A2,B}) lied name_unknown.
  console.log('\n■ classifyUnresolvedLinks — renamed-AND-failed source → story_failed (uid-aware, beats old name-only)');
  const out = classifyUnresolvedLinks(
    [{ source: 'A', target: 'B', sourceUid: 's_A', targetUid: 's_B' }],
    { featureUids: new Set(['s_A', 's_B']), featureNames: new Set(['A2', 'B']), storyKeyMap: { B: 'P-2' }, uidKeyMap: { s_B: 'P-2' } },
  );
  check('story_failed=1 (not the old name_unknown lie)', out.story_failed === 1 && out.name_unknown === 0, JSON.stringify(out));
}
{
  // The REAL pipeline shape for a user-DELETED endpoint: flattenBreakdown binds
  // sourceUid only from surviving features → a deleted endpoint gets sourceUid:null
  // and its name is gone from featureNames → name_unknown (NOT a phantom
  // endpoint_deleted bucket — that distinction needs a frozen gen-name→uid roster, deferred).
  console.log('\n■ classifyUnresolvedLinks — user-deleted endpoint → name_unknown (the real pipeline shape)');
  const out = classifyUnresolvedLinks(
    [{ source: 'A', target: 'B', sourceUid: null, targetUid: 's_B' }],
    { featureUids: new Set(['s_B']), featureNames: new Set(['B']), storyKeyMap: { B: 'P-2' }, uidKeyMap: { s_B: 'P-2' } },
  );
  check('name_unknown=1 and no endpoint_deleted key', out.name_unknown === 1 && out.story_failed === 0 && out.endpoint_deleted === undefined, JSON.stringify(out));
}
{
  console.log('\n■ classifyUnresolvedLinks — name_unknown (genuine model paraphrase)');
  const out = classifyUnresolvedLinks(
    [{ source: 'Ghost', target: 'B', sourceUid: null, targetUid: 's_B' }],
    { featureUids: new Set(['s_B']), featureNames: new Set(['B']), storyKeyMap: { B: 'P-2' }, uidKeyMap: { s_B: 'P-2' } },
  );
  check('name_unknown=1', out.name_unknown === 1 && out.story_failed === 0, JSON.stringify(out));
}
{
  console.log('\n■ classifyUnresolvedLinks — legacy name IS a feature but no key → story_failed');
  const out = classifyUnresolvedLinks(
    [{ source: 'A', target: 'B', sourceUid: null, targetUid: null }],
    { featureUids: new Set(), featureNames: new Set(['A', 'B']), storyKeyMap: { B: 'P-2' }, uidKeyMap: {} },
  );
  check('story_failed=1 (name-only, name is a feature)', out.story_failed === 1 && out.name_unknown === 0, JSON.stringify(out));
}
{
  console.log('\n■ classifyUnresolvedLinks — precedence name_unknown > story_failed + counts sum to unresolved.length');
  const unresolved = [
    { source: 'A', target: 'B', sourceUid: 's_A', targetUid: 's_B' },     // source live, no key → story_failed
    { source: 'Ghost', target: 'E', sourceUid: null, targetUid: 's_E' },  // unknown source → name_unknown
    { source: 'X', target: 'Ghost2', sourceUid: 's_X', targetUid: null }, // mixed: source story_failed + target name_unknown → name_unknown wins
  ];
  const out = classifyUnresolvedLinks(unresolved, {
    featureUids: new Set(['s_A', 's_B', 's_E', 's_X']),
    featureNames: new Set(['A', 'B', 'E', 'X']),
    storyKeyMap: { B: 'P-2', E: 'P-5' },           // A and X have NO key (their Stories failed)
    uidKeyMap: { s_B: 'P-2', s_E: 'P-5' },
  });
  const sum = out.story_failed + out.name_unknown;
  check('sum === unresolved.length', sum === unresolved.length, `${JSON.stringify(out)} sum=${sum}`);
  check('story_failed=1, name_unknown=2 (precedence)', out.story_failed === 1 && out.name_unknown === 2, JSON.stringify(out));
}

console.log('\n' + '='.repeat(64));
if (failures === 0) console.log('✅ ALL PASS');
else { console.log(`❌ ${failures} FAILED`); process.exit(1); }
