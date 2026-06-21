#!/usr/bin/env node
/**
 * Offline test for the P15 (Push plan to Jira) PURE join — src/plan_push_util.js.
 *   node prototype/test_plan_push.mjs
 */
import { sprintPushName, sprintDateRangeISO, buildSprintPushPlan } from '../src/plan_push_util.js';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
