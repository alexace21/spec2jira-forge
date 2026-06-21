#!/usr/bin/env node
/**
 * Offline test for the P15 (Push plan to Jira) PURE join — src/plan_push_util.js.
 *   node prototype/test_plan_push.mjs
 */
import {
  sprintPushName, sprintDateRangeISO, buildSprintPushPlan,
  buildKanbanRankPlan, buildRankBatches, buildTierLabelOps, RANK_BATCH_MAX, TIER_LABELS,
} from '../src/plan_push_util.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.error(`  XX  ${name}`); } }

console.log('P15 plan-push pure join:');
{
  // sprintPushName — deterministic + idempotent (same inputs → same name → reuse on re-push)
  check('sprintPushName: default prefix', sprintPushName('', 3) === 'AI Plan · Sprint 3');
  check('sprintPushName: custom prefix', sprintPushName('Checkout', 1) === 'Checkout · Sprint 1');
  check('sprintPushName: stable across calls (idempotent)', sprintPushName('X', 2) === sprintPushName('X', 2));
  // ⭐ Jira < 30-char sprint-name limit (team-managed ENFORCES it — live-acceptance 2026-06-21 HTTP 400)
  const longTitle = 'MediQueue — Telehealth Visit Platform';
  check('sprintPushName: long prefix → name < 30 chars + ends with the sprint number', sprintPushName(longTitle, 1).length <= 29 && /· Sprint 1$/.test(sprintPushName(longTitle, 1)));
  check('sprintPushName: EVERY sprint name < 30 chars for a long prefix', [1, 5, 10, 24].every((n) => sprintPushName(longTitle, n).length <= 29));
  check('sprintPushName: keeps the sprint NUMBER (identity) when truncated', sprintPushName('A very long project title that exceeds the limit', 12).endsWith('Sprint 12'));
  check('sprintPushName: long-prefix idempotent (same N → same truncation)', sprintPushName(longTitle, 7) === sprintPushName(longTitle, 7));

  // sprintDateRangeISO — calendar offsets from the start date; null when absent/invalid
  const r = sprintDateRangeISO('2026-06-24', 1, 10);
  check('sprintDateRangeISO: sprint 1 starts on the start date', r.startDate.startsWith('2026-06-24'));
  const r2 = sprintDateRangeISO('2026-06-24', 2, 10);
  check('sprintDateRangeISO: sprint 2 offset by length', r2.startDate.startsWith('2026-07-04'));
  check('sprintDateRangeISO: no start date → nulls', sprintDateRangeISO('', 1, 10).startDate === null && sprintDateRangeISO('bad', 1, 10).startDate === null);

  // buildSprintPushPlan — the core join + the disjoint honesty channels
  const plan = {
    sprints: [{ ids: ['uA', 'uB'] }, { ids: ['uC'] }, { ids: [] }],
    overflow: [{ id: 'uD' }],
  };
  const created = [{ uid: 'uA', key: 'PROJ-1' }, { uid: 'uB', key: 'PROJ-2' }, { uid: 'uC', key: 'PROJ-3' }]; // uD never pushed; uE planned-but-no-key tested below
  const out = buildSprintPushPlan(plan, created, { namePrefix: 'Spec', sprintStartDate: '2026-06-24', sprintLengthDays: 10 });
  check('buildSprintPushPlan: 2 occupied sprints (empty sprint omitted)', out.groups.length === 2);
  check('buildSprintPushPlan: sprint 1 keys = [PROJ-1, PROJ-2]', out.groups[0].keys.join() === 'PROJ-1,PROJ-2');
  check('buildSprintPushPlan: sprint 2 keys = [PROJ-3]', out.groups[1].keys.join() === 'PROJ-3');
  check('buildSprintPushPlan: names deterministic', out.groups[0].name === 'Spec · Sprint 1' && out.groups[1].name === 'Spec · Sprint 2');
  check('buildSprintPushPlan: dates carried', out.groups[0].startDate && out.groups[0].startDate.startsWith('2026-06-24'));
  check('buildSprintPushPlan: overflow feature in its own channel (not assigned)', out.overflowed.join() === 'uD');

  // a planned feature with NO Jira key (never pushed / push failed) → noJiraKey channel, never silently assigned
  const plan2 = { sprints: [{ ids: ['uA', 'uX'] }], overflow: [] };
  const out2 = buildSprintPushPlan(plan2, [{ uid: 'uA', key: 'P-1' }], {});
  check('buildSprintPushPlan: uid with no key → noJiraKey (disjoint, never assigned)', out2.noJiraKey.join() === 'uX' && out2.groups[0].keys.join() === 'P-1');
  check('buildSprintPushPlan: rename-proof (uid-keyed, not name-keyed)', out2.groups[0].keys.length === 1); // uX absent from createdIssues → dropped to noJiraKey

  // robustness: null/empty inputs never throw
  let threw = false; let safe;
  try { safe = buildSprintPushPlan(null, null, {}); } catch (_) { threw = true; }
  check('buildSprintPushPlan: null-safe (no throw, empty channels)', !threw && safe.groups.length === 0 && safe.noJiraKey.length === 0 && safe.overflowed.length === 0);

  // ⭐ DEEP-AUDIT cross-layer regression: a DUPLICATE _uid makes buildPlannerGraph disambiguate to `uid#i`
  // in plan.sprints, while the push stamps the PLAIN _uid on created_issues. The disambiguated ids can't
  // join → they MUST fall to noJiraKey (surfaced honesty channel), NEVER mis-assigned to the wrong issue.
  // (startPlan also warns loudly at the boundary — graph.duplicateUids — so the cause is clear up front.)
  const planDup = { sprints: [{ ids: ['u1#0', 'u1#1', 'u2'] }], overflow: [] };
  const createdDup = [{ uid: 'u1', key: 'P-1' }, { uid: 'u2', key: 'P-2' }];
  const outDup = buildSprintPushPlan(planDup, createdDup, {});
  check('dup-uid: disambiguated uid#i miss the plain-uid join → noJiraKey (not mis-assigned)', outDup.noJiraKey.join() === 'u1#0,u1#1' && outDup.groups[0].keys.join() === 'P-2');
}

console.log('\nP15-kanban rank-push pure join:');
{
  // buildKanbanRankPlan — flatten now→next→later into the ordered pull list + per-tier groups + noJiraKey
  const plan = {
    methodology: 'kanban',
    now: [{ id: 'uA', points: 8 }, { id: 'uB', points: 5 }],
    next: [{ id: 'uC', points: 8 }],
    later: [{ id: 'uD', points: 3 }, { id: 'uE', points: 5 }],
  };
  const created = [{ uid: 'uA', key: 'P-1' }, { uid: 'uB', key: 'P-2' }, { uid: 'uC', key: 'P-3' }, { uid: 'uD', key: 'P-4' }]; // uE has NO key
  const kp = buildKanbanRankPlan(plan, created);
  check('buildKanbanRankPlan: orderedKeys = now→next→later (pull order)', kp.orderedKeys.join() === 'P-1,P-2,P-3,P-4');
  check('buildKanbanRankPlan: per-tier key groups', kp.tiers.now.join() === 'P-1,P-2' && kp.tiers.next.join() === 'P-3' && kp.tiers.later.join() === 'P-4');
  check('buildKanbanRankPlan: uid with no key → noJiraKey (disjoint, never silently ranked)', kp.noJiraKey.join() === 'uE' && !kp.orderedKeys.includes(undefined));
  let kThrew = false, kSafe;
  try { kSafe = buildKanbanRankPlan(null, null); } catch (_) { kThrew = true; }
  check('buildKanbanRankPlan: null-safe (no throw, empty)', !kThrew && kSafe.orderedKeys.length === 0 && kSafe.noJiraKey.length === 0);

  // buildRankBatches — chained anchor; the ABSOLUTE resulting order must equal the plan order (POLARITY guard)
  const b1 = buildRankBatches(['P-1', 'P-2', 'P-3', 'P-4']);
  check('buildRankBatches: 1 batch for ≤51 keys', b1.length === 1);
  check('buildRankBatches: ranks the tail AFTER orderedKeys[0] (anchor keeps its spot)', b1[0].issues.join() === 'P-2,P-3,P-4' && b1[0].rankAfterIssue === 'P-1');
  check('buildRankBatches: 0/1 key → nothing to reorder', buildRankBatches([]).length === 0 && buildRankBatches(['only']).length === 0);
  const big = Array.from({ length: 120 }, (_, i) => `K-${i}`); // K-0 .. K-119
  const bb = buildRankBatches(big);
  check('buildRankBatches: 120 keys → ceil(119/50)=3 batches', bb.length === 3);
  check('buildRankBatches: batch1 anchors after K-0, ranks K-1..K-50', bb[0].rankAfterIssue === 'K-0' && bb[0].issues[0] === 'K-1' && bb[0].issues.length === 50);
  check('buildRankBatches: batch2 chains after batch1 tail K-50 (no gap/overlap)', bb[1].rankAfterIssue === 'K-50' && bb[1].issues[0] === 'K-51');
  check('buildRankBatches: every key ranked once, ABSOLUTE order == plan order (polarity)', (() => { const seq = ['K-0', ...bb.flatMap((b) => b.issues)]; return seq.join() === big.join(); })());
  check('buildRankBatches: each batch ≤ RANK_BATCH_MAX', bb.every((b) => b.issues.length <= RANK_BATCH_MAX));

  // buildTierLabelOps — idempotent: ADD my tier + REMOVE the other two (re-tier never accumulates two labels)
  const ops = buildTierLabelOps(kp.tiers);
  check('buildTierLabelOps: one op per keyed feature (4)', ops.length === 4);
  const opNow = ops.find((o) => o.key === 'P-1');
  check('buildTierLabelOps: Now item adds plan-now + removes plan-next/plan-later (idempotent)', opNow.labels[0].add === 'plan-now' && opNow.labels.some((l) => l.remove === 'plan-next') && opNow.labels.some((l) => l.remove === 'plan-later'));
  const opLater = ops.find((o) => o.key === 'P-4');
  check('buildTierLabelOps: Later item adds plan-later + removes the other two', opLater.labels[0].add === 'plan-later' && opLater.labels.filter((l) => l.remove).length === 2);
  check('buildTierLabelOps: namespaced labels (no user-label collision)', Object.values(TIER_LABELS).join() === 'plan-now,plan-next,plan-later');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
