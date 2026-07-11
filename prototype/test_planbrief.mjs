#!/usr/bin/env node
/**
 * Offline test for the FE plan view-derivations + the Defensible Plan Brief (P18).
 *   static/hello-world/src/lib/planView.js  — shared pure derivations (single source of truth)
 *   static/hello-world/src/lib/planBrief.js — renderPlanBrief (pure, deterministic, no LLM)
 * Pure ES modules → node imports them directly:  node prototype/test_planbrief.mjs
 */
import {
  fmt1, capacityVerdict, overflowReasonText, oversizedReasonText, buildRiskRegister, riskReasons, isRiskFlagged, csvCell, toCSV,
  criticalPathInfo,
} from '../static/hello-world/src/lib/planView.js';
import { renderPlanBrief } from '../static/hello-world/src/lib/planBrief.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`  XX  ${name}`); }
}

// ════════════════ planView — shared derivations ════════════════
console.log('planView — verdict / overflow reasons / risk register / hardened CSV:');
{
  // capacityVerdict
  check('capacityVerdict: deficit case says "exceeds"', /exceeds .* by 8 pts/.test(capacityVerdict({ totalBacklogPoints: 34, totalCapacity: 26, deficitPoints: 8, overflowCount: 2 }, 2)));
  check('capacityVerdict: deficit purely from an oversized item (overflow 0) never reads "0 features"', (() => { const v = capacityVerdict({ totalBacklogPoints: 40, totalCapacity: 39, deficitPoints: 1, overflowCount: 0 }, 3, 1); return !/0 feature/.test(v) && /larger than one sprint/.test(v); })());
  check('capacityVerdict: clean fit (no overflow) → "fits within" + spare', /fits within .* \(6 pts to spare\)/.test(capacityVerdict({ totalBacklogPoints: 20, totalCapacity: 26, deficitPoints: 0, overflowCount: 0 }, 2)));
  // ⭐ BRIEF-VERDICT honesty (live-acceptance 2026-06-20): total fits BUT a skill/sequencing overflow exists →
  // the headline must reconcile with "What doesn’t fit", NOT read as a bare "fits within … to spare".
  {
    const v = capacityVerdict({ totalBacklogPoints: 107, totalCapacity: 183, deficitPoints: 0, overflowCount: 1 }, 6);
    check('capacityVerdict: total-fits + 1 overflow → reconciled headline (spare overall + doesn’t fit, NOT bare "fits within")',
      /spare overall/.test(v) && /1 feature doesn’t fit the sprint layout/.test(v) && !/fits within/.test(v));
    const v2 = capacityVerdict({ totalBacklogPoints: 50, totalCapacity: 120, deficitPoints: 0, overflowCount: 3 }, 5);
    check('capacityVerdict: total-fits + N overflow → pluralized "N features don’t fit"', /3 features don’t fit the sprint layout/.test(v2));
  }

  // overflowReasonText — the defensible "why"
  check('overflowReasonText: blocker_overflowed', overflowReasonText({ reason: 'blocker_overflowed', rootCauseName: 'Auth' }) === 'blocked by “Auth” which didn’t fit');
  check('overflowReasonText: blocker_unsized', overflowReasonText({ reason: 'blocker_unsized' }) === 'blocked by an unsized feature');
  check('overflowReasonText: default (no capacity)', overflowReasonText({ reason: 'capacity_exhausted' }) === 'no capacity left');
  check('overflowReasonText: bucket_exhausted names the short skill (Tier-2)', overflowReasonText({ reason: 'bucket_exhausted', starvedBuckets: ['BE'] }) === 'not enough backend capacity');
  check('overflowReasonText: GEN-only → classification message, not "generalist capacity"', overflowReasonText({ reason: 'bucket_exhausted', starvedBuckets: ['GEN'] }) === 'its skill couldn’t be determined — add task types');

  // oversizedReasonText — the CONCRETE by-how-much (shared: panel + step-5 + brief read the SAME string)
  check('oversizedReasonText: pooled — concrete total vs cap', oversizedReasonText({ points: 13, maxCapacity: 12 }) === 'needs 13 pts vs a 12-pt single-sprint cap. Split it.');
  check('oversizedReasonText: skill-mode uses BUCKET demand vs BUCKET cap (not total vs pooled)', oversizedReasonText({ points: 10, maxCapacity: 10.5, buckets: ['BE'], bucketDetail: [{ bucket: 'BE', demand: 10, cap: 3.5 }] }) === 'needs 10 backend pts vs a 3.5-pt backend cap per sprint. Split it, or add backend capacity.');
  check('oversizedReasonText: pooled guard — total <= cap without bucket detail → vague (no false "fits")', oversizedReasonText({ points: 10, maxCapacity: 10.5 }) === 'larger than one sprint - split it');
  check('oversizedReasonText: missing numbers → vague fallback', oversizedReasonText({}) === 'larger than one sprint - split it');

  // buildRiskRegister — sorted by riskScore, sprint-tagged, name-resolved; legacy plan → []
  const plan = {
    sprints: [{ ids: ['uA', 'uB'] }, { ids: ['uC'] }],
    riskByFeature: { uA: { risk_level: 'high', has_external_dep: true, low_confidence: false, riskScore: 60 }, uB: { risk_level: 'medium', riskScore: 20 }, uC: { risk_level: 'none', riskScore: 0 } },
  };
  const nameOf = (id) => ({ uA: 'Auth', uB: 'Billing', uC: 'Settings' }[id] || id);
  const reg = buildRiskRegister(plan, nameOf);
  check('buildRiskRegister: only flagged (uC none excluded)', reg.length === 2 && reg.every((e) => e.id !== 'uC'));
  check('buildRiskRegister: sorted by riskScore desc (uA first)', reg[0].id === 'uA' && reg[1].id === 'uB');
  check('buildRiskRegister: sprint-tagged + name-resolved', reg[0].sprint === 1 && reg[0].name === 'Auth');
  check('buildRiskRegister: legacy plan (no riskByFeature) → []', buildRiskRegister({ sprints: [] }, nameOf).length === 0);

  // hardened CSV — formula-injection neutralized, negatives preserved, quotes/newlines safe
  check('csvCell: =cmd neutralized with leading apostrophe', csvCell('=cmd') === `"'=cmd"`);
  check('csvCell: @SUM neutralized', csvCell('@SUM(A1)') === `"'@SUM(A1)"`);
  check('csvCell: genuine negative number preserved', csvCell('-5') === '"-5"');
  check('csvCell: embedded quote doubled (RFC-4180)', csvCell('a"b') === '"a""b"');
  check('csvCell: newline flattened', csvCell('l1\nl2') === '"l1 / l2"');
  check('toCSV: header + row', toCSV(['A', 'B'], [{ A: '1', B: '2' }]) === '"A","B"\n"1","2"');

  // riskReasons / isRiskFlagged
  check('riskReasons: high + external + low confidence → 3 reasons', riskReasons({ risk_level: 'high', has_external_dep: true, low_confidence: true }).length === 3);
  check('isRiskFlagged: none/no-signal → false', !isRiskFlagged({ risk_level: 'none' }) && !isRiskFlagged(null));

  // criticalPathInfo — the "ends at" node must be the RENDERED chain end (plan.criticalPathUids last), never
  // the position-first tie-break of the signals scan. On a TIED max depth those two disagree → invariant #4
  // drift. Here uZ and uA both have criticalPathLen 3 (uZ is scanned FIRST → the old code picked it), but the
  // backend's chain ends at uA (smallest-uid tie-break). endName must follow the chain, i.e. equal chainNames' last.
  {
    const tiePlan = {
      signals: {
        uZ: { criticalPathLen: 3, downstreamUnblockCount: 0, slack: 0 },
        uA: { criticalPathLen: 3, downstreamUnblockCount: 0, slack: 0 },
        uM: { criticalPathLen: 2, downstreamUnblockCount: 1, slack: 0 },
      },
      criticalPathUids: ['uM', 'uX', 'uA'],
    };
    const tieName = (id) => ({ uZ: 'Zeta', uA: 'Alpha', uM: 'Mid', uX: 'Ex' }[id] || id);
    const cpi = criticalPathInfo(tiePlan, tieName);
    check('criticalPathInfo: tied max-depth → endName === chainNames last (rendered chain end, not position-first)',
      !!cpi && cpi.endName === cpi.chainNames[cpi.chainNames.length - 1] && cpi.endName === 'Alpha' && cpi.len === 3);
    // No chain supplied (legacy plan) → falls back to the signals scan (position-first), chainNames null.
    const legacyCp = criticalPathInfo({ signals: tiePlan.signals }, tieName);
    check('criticalPathInfo: no criticalPathUids → falls back to signals scan (chainNames null)',
      !!legacyCp && legacyCp.chainNames === null && legacyCp.endName === 'Zeta');
  }
}

// ════════════════ renderPlanBrief — the Defensible Plan Brief ════════════════
console.log('\nrenderPlanBrief — grounded sections, honesty gating, legacy-guard, CSV injection:');
{
  const plan = {
    sprints: [{ ids: ['uA', 'uB'], capacity: 13, load: 11, overCapacity: false }, { ids: ['uC'], capacity: 13, load: 5, overCapacity: false }],
    overflow: [{ id: 'uD', reason: 'capacity_exhausted' }],
    oversized: [],
    metrics: { totalCapacity: 26, totalBacklogPoints: 34, deficitPoints: 8, overflowCount: 1, overflowPoints: 8, wastedCapacity: 2, fragmentation: false },
    graph: { cyclicNodes: [], danglingRefs: [], ambiguousDeps: [] },
    signals: { uA: { criticalPathLen: 2, downstreamUnblockCount: 1, slack: 0 }, uB: { criticalPathLen: 1, downstreamUnblockCount: 0, slack: 1 }, uC: { criticalPathLen: 1, downstreamUnblockCount: 0, slack: 0 } },
    riskByFeature: { uA: { risk_level: 'high', has_external_dep: true, low_confidence: false, riskScore: 60 }, uB: { risk_level: 'none', riskScore: 0 } },
    sprintRiskProfiles: [{ fragile: false, highRiskCount: 1, externalDepCount: 1 }, { fragile: false }],
    specConcernSummary: { total: 1, complianceCount: 1, items: [{ type: 'COMPLIANCE', severity: 'high', text: 'GDPR data export' }] },
    ranking: { usedLlm: true },
    sizingIssues: [],
  };
  const slim = [
    { _uid: 'uA', name: 'Auth', story_points: 8, priority: 'High' },
    { _uid: 'uB', name: '=Injection', story_points: 3, priority: 'Low' }, // malicious name → CSV must neutralize
    { _uid: 'uC', name: 'Settings', story_points: 5, priority: 'Medium' },
    { _uid: 'uD', name: 'Reports', story_points: 8, priority: 'Medium' },
  ];
  const form = { sprintCount: 2, sprintLengthDays: 10, focusFactor: 0.7, sprintStartDate: '2026-07-01' };
  const out = renderPlanBrief({ plan, assumptions: [{ label: 'Focus factor', value: 0.7, source: 'default' }], warnings: [], cost: { total_usd: 0.022 }, slimFeatures: slim, form, usedLlm: true, stale: false, pageTitle: 'My Spec', generatedAt: 'Jul 1, 2026' });

  check('brief: header carries the page title', out.markdown.includes('# Sprint plan — My Spec'));
  check('brief: grounded verdict (exceeds)', /exceeds .* by 8 pts/.test(out.markdown));
  check('brief: all core sections present', ['## Capacity & dates', '## What fits', '## What doesn’t fit', '## Risk register', '## Dependency highlights', '## Assumptions', '## Spec-wide concerns'].every((s) => out.markdown.includes(s)));
  check('brief: what-doesn’t-fit names the overflow + the why', out.markdown.includes('Reports') && out.markdown.includes('no capacity left'));
  check('brief: risk register lists the high-risk feature with reasons', out.markdown.includes('Auth') && out.markdown.includes('High delivery risk') && out.markdown.includes('External dependency'));
  check('brief: usedLlm=true → "Claude was nudged"', out.markdown.includes('Claude was nudged'));
  check('brief: spec-wide compliance surfaced', out.markdown.includes('Spec-wide concerns') && out.markdown.includes('GDPR data export'));
  check('brief: cost echo in footer', out.markdown.includes('$0.022'));
  check('brief: CSV has the allocation header', out.csv.includes('"Sprint","Dates","Feature","Story points","Priority","Risk"'));
  check('brief: CSV neutralizes the =Injection feature name', out.csv.includes(`"'=Injection"`));
  check('brief: plainText strips markdown headers', !out.plainText.includes('## ') && out.plainText.includes('Sprint plan'));

  // usedLlm=false → honest fallback wording (no "nudged" claim)
  const fout = renderPlanBrief({ plan, slimFeatures: slim, form, usedLlm: false });
  check('brief: usedLlm=false → fallback honesty, no "nudged"', fout.markdown.includes('fell back to dependencies') && !fout.markdown.includes('Claude was nudged'));

  // stale → a visible warning INSIDE the brief text (not just on-screen)
  const sout = renderPlanBrief({ plan, slimFeatures: slim, form, usedLlm: true, stale: true });
  check('brief: stale → out-of-date warning inside the text', sout.markdown.includes('out of date'));

  // legacy plan (no Tier-1 risk keys) → no throw, no risk section, "fits" verdict
  const legacy = { sprints: [{ ids: ['uA'], capacity: 10, load: 5 }], overflow: [], oversized: [], metrics: { totalCapacity: 10, totalBacklogPoints: 5, deficitPoints: 0 }, ranking: { usedLlm: false } };
  let threw = false; let lout;
  try { lout = renderPlanBrief({ plan: legacy, slimFeatures: [{ _uid: 'uA', name: 'A', story_points: 5 }], form: { sprintCount: 1 } }); } catch (_) { threw = true; }
  check('brief: legacy plan (no risk keys) → no throw', !threw);
  check('brief: legacy plan (no risk layer) → honest "risk wasn’t computed" fence-post, not a silent omission', lout && lout.markdown.includes('## Risk register') && lout.markdown.includes('wasn’t computed'));
  check('brief: legacy plan → "fits within" verdict', lout && lout.markdown.includes('fits within'));

  // null plan → graceful stub, never throws
  let threw2 = false; let nout;
  try { nout = renderPlanBrief({ plan: null }); } catch (_) { threw2 = true; }
  check('brief: null plan → graceful stub, no throw', !threw2 && nout.markdown.includes('No plan to summarise'));

  // Tier-2: a skill-aware plan surfaces a Skill capacity section + the bottleneck (overDemand = genuine shortfall)
  const skillPlan = { ...plan, bucketsActive: true, bucketMetrics: { capacity: { BE: 10, FE: 10, QA: 0, GEN: 0 }, planned: { BE: 10, FE: 5, QA: 0, GEN: 0 }, demand: { BE: 14, FE: 5, QA: 0, GEN: 0 }, unmet: { BE: 4, FE: 0, QA: 0, GEN: 0 }, overDemand: { BE: 4, FE: 0, QA: 0, GEN: 0 }, overfilled: { BE: 0, FE: 0, QA: 0, GEN: 0 }, idle: [{ bucket: 'FE', freePoints: 5 }], bottleneckBuckets: ['BE'] } };
  const skb = renderPlanBrief({ plan: skillPlan, slimFeatures: slim, form, usedLlm: true });
  check('brief: Skill capacity section present + Backend listed', skb.markdown.includes('## Skill capacity') && skb.markdown.includes('Backend'));
  check('brief: bottleneck surfaced in the brief', skb.markdown.includes('Bottleneck: backend'));
  check('brief: genuine over-capacity shows "4 pts over capacity" (from overDemand)', skb.markdown.includes('4 pts over capacity'));
  check('brief: a non-skill plan has NO skill section', !out.markdown.includes('## Skill capacity'));

  // ⭐ HONEST-BOTTLENECK: a skill with unplaced COLLATERAL demand (unmet>0) but overDemand=0 (idle capacity)
  // must NOT read as "over capacity" and must NOT be a bottleneck — only the genuinely-short skill is.
  const collateralPlan = { ...plan, bucketsActive: true, bucketMetrics: { capacity: { BE: 30, FE: 10, QA: 0, GEN: 0 }, planned: { BE: 0, FE: 0, QA: 0, GEN: 0 }, demand: { BE: 5, FE: 0, QA: 5, GEN: 0 }, unmet: { BE: 5, FE: 0, QA: 5, GEN: 0 }, overDemand: { BE: 0, FE: 0, QA: 5, GEN: 0 }, overfilled: { BE: 0, FE: 0, QA: 0, GEN: 0 }, idle: [{ bucket: 'BE', freePoints: 30 }], bottleneckBuckets: ['QA'] } };
  const cb = renderPlanBrief({ plan: collateralPlan, slimFeatures: slim, form, usedLlm: true });
  check('brief: collateral BE (unmet but idle) does NOT read "over capacity"', !/Backend:.*over capacity/.test(cb.markdown) && cb.markdown.includes('Bottleneck: QA'));

  // P12: a non-balanced objective surfaces an honest "Ordered for" line; balanced omits it
  const objBrief = renderPlanBrief({ plan, slimFeatures: slim, form, usedLlm: true, objective: 'mvp' });
  check('brief: objective → "Ordered for: Ship the MVP fastest" line', objBrief.markdown.includes('Ordered for') && objBrief.markdown.includes('Ship the MVP fastest'));
  check('brief: balanced objective → no "Ordered for" line', !out.markdown.includes('Ordered for'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
