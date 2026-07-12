/**
 * Spec2Tickets — Capacity-Sheet Planner (pure functions).
 *
 * WHAT (the stream, POLICY §0): a NEW stage AFTER a push-ready breakdown. The user fills an
 * in-app capacity form (team, per-sprint available days, sprint structure); this module turns
 * the breakdown's already-produced sizing (story_points / complexity_score / priority) + its
 * uid-bound dependency graph into a SCRUM sprint plan. v1 = review-only (no Jira write).
 *
 * WHY PURE (POLICY §4 dispatch): the capacity arithmetic, dependency topology, scheduling
 * signals, ranking normalization, and sprint packing are ALL deterministic structure — derivable
 * from the bytes alone. They live here as pure functions, node-testable in isolation. The ONLY
 * meaning-judgment (which work to defer when business-priority / dependency-leverage / risk
 * conflict and not everything fits) is a single LLM ranking call OUTSIDE this module
 * (anthropic_client.rankFeaturesForPlan). The LLM is ADVISORY: it proposes a preference order;
 * this module owns the ordinal, the totality, every number, and a deterministic fallback.
 *
 * DEPENDENCY KEYING — PARITY WITH push_handler (ledger GRAPH-3/4, LLM-8): the planner builds its
 * adjacency on the stable _uid, resolving each dependency NAME-string via the frozen
 * _orig_name → [_uid] map — the SAME resolution push_handler.flattenBreakdown uses (push_handler.js
 * ~233). Keying on the CURRENT f.name would make the plan show as unblocked what the push links as
 * blocked. A dep name matching >1 uid is AMBIGUOUS (unbound); matching 0 is DANGLING; a self-edge
 * is dropped. All three are surfaced, never silently absorbed (graph.js detectCycles silently
 * filters them — the planner must not).
 *
 * NO SILENT FAILURES (POLICY §11): the capacity form is the type/unit boundary. Every field is
 * Number()-coerced and validated BEFORE any compute or billed LLM call; a bad input is a TYPED
 * blocker, never a fabricated 0 / NaN / Infinity capacity that packing turns into a plausible-
 * looking all-overflow plan. Overflow, oversized items, cycles, dangling refs, and unsized stories
 * each have their OWN diagnosed channel.
 *
 * This module imports nothing (self-contained, offline-testable). Forge wiring + the LLM call live
 * in index.js / anthropic_client.js.
 */

// ── Honest defaults (ledger CAP-3: every defaulted constant is echoed in `assumptions`) ──
export const DEFAULT_HOURS_PER_DAY = 6; // nominal delivery hours in a working day (≈8h minus standing overhead)
export const DEFAULT_FOCUS_FACTOR = 0.7; // industry band 0.6–0.8: discount for meetings / context-switch / unplanned work
export const DEFAULT_HOURS_PER_POINT = 6; // points→hours ratio; a forward-looking default (no team history at plan time)

export const MAX_SPRINTS = 52; // ledger CAP-6: bound the array / packing loop / KVS payload
export const MAX_SPRINT_LENGTH_DAYS = 90;
export const EPS = 1e-9; // ledger CAP-10: float capacity compare, epsilon-tolerant against IEEE-754 boundary flips

// ── Kanban reach band (methodology=kanban; research 2026-06-21) ──
export const MAX_QUARTER_DAYS = 66; // WORKING-days-per-quarter sanity bound (13 weeks × 5 ≈ 65 max; catches the calendar-days-entered-as-working-days error + typos — live-acceptance 2026-06-21 L2: 90 was calendar days, too loose)
// A single reach NUMBER is "fake precision" with no flow history → the reach is a RANGE, derived from the
// SAME multipliers (ZERO new inputs). Conservative is skewed DOWN (ramp-up / steady-flow is a future state,
// not week 1 — research countermeasure to the steady-flow fallacy); optimistic adds modest stretch headroom.
export const REACH_CONSERVATIVE_FACTOR = 0.8;
export const REACH_OPTIMISTIC_FACTOR = 1.1;

// ════════════════════════════════════════════════════════════════
// 1. CAPACITY  — fail-loud validation + the points/sprint math (ledger CAP-*, SIZE-1)
// ════════════════════════════════════════════════════════════════

/**
 * Strict finite-number coercion at the form boundary (ledger CAP-5). '' / null / undefined /
 * non-numeric → {ok:false} (NEVER silently 0). Returns {ok, val}.
 */
function numOf(v) {
  if (v === '' || v === null || v === undefined) return { ok: false };
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? { ok: true, val: n } : { ok: false };
}

/**
 * Compute per-sprint capacity in story points from the in-app capacity form, validating EVERY
 * field at the boundary. Returns a blocker list (ok:false → render the blockers, fire NO LLM) or
 * a finite per-sprint capacity array + the echoed assumptions/warnings that make the number honest.
 *
 * Model (capacity-DERIVED, not velocity — no team history at plan time):
 *   perSprintCapacity = Σ_people(availableDays × hoursPerDay) × focusFactor ÷ hoursPerPoint
 * applied UNIFORMLY to every sprint. availableDays is PER SPRINT (ledger CAP-4 — the deepest silent
 * ×sprintCount error; pinned + labelled on the form). A direct pointsPerSprintOverride takes
 * precedence (ledger CAP-9) but the team-derived value is still computed + surfaced for the discrepancy.
 *
 * @param {object} form { people:[{name,availableDays}], sprintCount, sprintLengthDays, sprintStartDate?,
 *                        hoursPerDay?, focusFactor?, hoursPerPoint?, pointsPerSprintOverride? }
 * @returns {{ok:boolean, errors:Array, perSprintCapacityPoints:number[]|null, totalCapacityPoints:number|null,
 *            assumptions:Array, warnings:Array}}
 */
export function computeCapacity(form) {
  const f = form && typeof form === 'object' ? form : {};
  const errors = [];
  const warnings = [];
  const assumptions = [];
  const err = (code, field, message) => errors.push({ code, field, message });
  const warn = (code, message) => warnings.push({ code, message });

  // ── sprint structure ──
  let sprintCount = 0;
  {
    const r = numOf(f.sprintCount);
    if (!r.ok) err('INVALID_SPRINT_COUNT', 'sprintCount', 'Enter the number of sprints (a whole number ≥ 1).');
    else if (!Number.isInteger(r.val) || r.val < 1) err('INVALID_SPRINT_COUNT', 'sprintCount', 'Sprint count must be a whole number of at least 1.');
    else if (r.val > MAX_SPRINTS) err('SPRINT_COUNT_TOO_LARGE', 'sprintCount', `Sprint count is capped at ${MAX_SPRINTS}.`);
    else sprintCount = r.val;
  }

  let sprintLengthDays = 0;
  {
    const r = numOf(f.sprintLengthDays);
    if (!r.ok) err('INVALID_SPRINT_LENGTH', 'sprintLengthDays', 'Enter the sprint length in working days (≥ 1).');
    else if (r.val < 1) err('INVALID_SPRINT_LENGTH', 'sprintLengthDays', 'Sprint length must be at least 1 working day.');
    else if (r.val > MAX_SPRINT_LENGTH_DAYS) { sprintLengthDays = MAX_SPRINT_LENGTH_DAYS; warn('SPRINT_LENGTH_CLAMPED', `Sprint length ${r.val} is unusually large; clamped to ${MAX_SPRINT_LENGTH_DAYS} days for the date display.`); }
    else sprintLengthDays = r.val;
  }

  // ── multipliers (defaulted, but echoed with provenance — ledger CAP-3) ──
  let hoursPerDay = DEFAULT_HOURS_PER_DAY;
  if (f.hoursPerDay !== undefined && f.hoursPerDay !== '' && f.hoursPerDay !== null) {
    const r = numOf(f.hoursPerDay);
    if (!r.ok || r.val <= 0) err('INVALID_HOURS_PER_DAY', 'hoursPerDay', 'Productive hours per day must be a number greater than 0.');
    else hoursPerDay = r.val;
    assumptions.push({ key: 'hoursPerDay', label: 'Productive hours / day', value: hoursPerDay, source: 'user' });
  } else {
    assumptions.push({ key: 'hoursPerDay', label: 'Productive hours / day', value: hoursPerDay, source: 'default' });
  }

  let focusFactor = DEFAULT_FOCUS_FACTOR;
  if (f.focusFactor !== undefined && f.focusFactor !== '' && f.focusFactor !== null) {
    const r = numOf(f.focusFactor);
    // strictly (0,1]: reject 0 (typo for 0.7), >1 (the 70-meaning-70% unit trap), negative — DON'T clamp (hides it)
    if (!r.ok || r.val <= 0 || r.val > 1) err('INVALID_FOCUS_FACTOR', 'focusFactor', 'Focus factor must be a fraction between 0 and 1 (e.g. 0.7, not 70).');
    else focusFactor = r.val;
    assumptions.push({ key: 'focusFactor', label: 'Focus factor', value: focusFactor, source: 'user' });
  } else {
    assumptions.push({ key: 'focusFactor', label: 'Focus factor', value: focusFactor, source: 'default' });
  }

  let hoursPerPoint = DEFAULT_HOURS_PER_POINT;
  if (f.hoursPerPoint !== undefined && f.hoursPerPoint !== '' && f.hoursPerPoint !== null) {
    const r = numOf(f.hoursPerPoint);
    if (!r.ok || r.val <= 0) err('INVALID_HOURS_PER_POINT', 'hoursPerPoint', 'Hours per story point must be a number greater than 0.'); // divisor guard (ledger CAP-1)
    else hoursPerPoint = r.val;
    assumptions.push({ key: 'hoursPerPoint', label: 'Hours / story point', value: hoursPerPoint, source: 'user' });
  } else {
    assumptions.push({ key: 'hoursPerPoint', label: 'Hours / story point', value: hoursPerPoint, source: 'default' });
  }

  // ── per-person available days (PER SPRINT) ──
  const people = Array.isArray(f.people) ? f.people : [];
  let teamDays = 0;
  let validPeople = 0;
  const seenNames = new Set();
  const bucketDays = { BE: 0, FE: 0, QA: 0, GEN: 0 }; // Tier-2: per-skill day pools (untagged → GEN generalist)
  let anySkillTagged = false;
  people.forEach((p, i) => {
    const person = p && typeof p === 'object' ? p : {};
    const name = typeof person.name === 'string' ? person.name.trim() : '';
    const r = numOf(person.availableDays);
    if (!r.ok) {
      // Reject NON-numeric / NaN naming the row (never poison the sum with NaN — ledger CAP-8)
      err('INVALID_AVAILABLE_DAYS', `people[${i}].availableDays`, `Available days for ${name || `person ${i + 1}`} must be a number ≥ 0.`);
      return;
    }
    if (r.val < 0) {
      err('INVALID_AVAILABLE_DAYS', `people[${i}].availableDays`, `Available days for ${name || `person ${i + 1}`} cannot be negative.`);
      return;
    }
    let days = r.val; // fractional (half-days) is legitimate — allowed
    if (sprintLengthDays > 0 && days > sprintLengthDays + EPS) {
      warn('AVAILABLE_DAYS_CLAMPED', `${name || `Person ${i + 1}`} is marked available ${days} days, more than the ${sprintLengthDays}-day sprint; clamped to ${sprintLengthDays}.`); // ledger CAP-8
      days = sprintLengthDays;
    }
    if (name) {
      if (seenNames.has(name.toLowerCase())) warn('DUPLICATE_PERSON_NAME', `"${name}" appears more than once — check for an accidental duplicate row.`); // ledger CAP-13
      seenNames.add(name.toLowerCase());
    } else if (days > 0) {
      warn('BLANK_PERSON_NAME', `A team member with ${days} available days has no name — its capacity still counts.`); // ledger CAP-13
    }
    teamDays += days;
    validPeople += 1;
    const skill = SKILL_BUCKETS.includes(person.skill) ? person.skill : GEN_BUCKET; // Tier-2: untagged → generalist
    if (skill !== GEN_BUCKET) anySkillTagged = true;
    bucketDays[skill] += days;
  });

  // ── override path (ledger CAP-9: precedence + surfaced, never silent shadow) ──
  const overridePresent = f.pointsPerSprintOverride !== undefined && f.pointsPerSprintOverride !== '' && f.pointsPerSprintOverride !== null;
  let overrideVal = null;
  if (overridePresent) {
    const r = numOf(f.pointsPerSprintOverride);
    if (!r.ok || r.val <= 0) err('INVALID_OVERRIDE', 'pointsPerSprintOverride', 'The points-per-sprint override must be a number greater than 0.');
    else overrideVal = r.val;
  }

  // team-derived per-sprint (only meaningful if the multipliers validated)
  const multipliersOk = !errors.some((e) => ['INVALID_HOURS_PER_DAY', 'INVALID_FOCUS_FACTOR', 'INVALID_HOURS_PER_POINT'].includes(e.code));
  const teamPerSprint = multipliersOk && hoursPerPoint > 0 ? (teamDays * hoursPerDay * focusFactor) / hoursPerPoint : NaN;

  // ZERO_CAPACITY only when NOT overriding and the team genuinely yields nothing (ledger CAP-1)
  if (!overridePresent) {
    if (validPeople === 0 && !people.length) err('ZERO_CAPACITY', 'people', 'Add at least one team member with available days.');
    else if (multipliersOk && teamDays <= 0 && validPeople > 0) err('ZERO_CAPACITY', 'people', 'Total available days is 0 — the team has no capacity to plan against.');
  }

  if (errors.length > 0) {
    return { ok: false, errors, perSprintCapacityPoints: null, totalCapacityPoints: null, assumptions, warnings };
  }

  // ── resolve the per-sprint value ──
  let perSprint;
  if (overridePresent) {
    perSprint = overrideVal;
    assumptions.push({ key: 'override', label: 'Capacity source', value: `manual override: ${overrideVal} pts/sprint`, source: 'user' });
    if (Number.isFinite(teamPerSprint)) {
      assumptions.push({ key: 'computedTeam', label: 'Team-derived (for reference)', value: `${round1(teamPerSprint)} pts/sprint`, source: 'computed' });
      // surface a large discrepancy so a stale override can't silently shadow a freshly-edited team (CAP-9)
      if (teamPerSprint > 0 && Math.abs(overrideVal - teamPerSprint) / teamPerSprint > 0.5) {
        warn('OVERRIDE_DISCREPANCY', `Manual override (${overrideVal}) differs from the team-derived capacity (${round1(teamPerSprint)} pts/sprint) — confirm the override is intended.`);
      }
    }
  } else {
    perSprint = teamPerSprint;
    assumptions.push({ key: 'availableDaysContract', label: 'Available days are PER SPRINT', value: 'each person’s days count once per sprint', source: 'contract' }); // ledger CAP-4
    assumptions.push({ key: 'uniformPerSprint', label: 'Capacity applied uniformly', value: 'every sprint uses the same computed capacity', source: 'contract' });
  }

  if (!Number.isFinite(perSprint) || perSprint < 0) {
    return { ok: false, errors: [{ code: 'NON_FINITE_CAPACITY', field: 'capacity', message: 'The computed capacity is not a valid number — check the team and multiplier inputs.' }], perSprintCapacityPoints: null, totalCapacityPoints: null, assumptions, warnings };
  }

  const perSprintCapacityPoints = new Array(sprintCount).fill(perSprint); // FLOAT — never pre-rounded (ledger CAP-10)

  // ── per-bucket capacity (Tier-2 skill-aware) ──
  // bucketsActive ONLY when the user MEANINGFULLY tagged ≥1 person AND there's no pooled override (one
  // override number can't be honestly partitioned by skill — CAP-9). Otherwise the planner stays POOLED
  // (today's exact behaviour) — skill-aware is strictly OPT-IN, so an untagged team plans exactly as before.
  const bucketsActive = anySkillTagged && !overridePresent;
  const bucketFactor = (multipliersOk && hoursPerPoint > 0) ? (hoursPerDay * focusFactor) / hoursPerPoint : 0;
  const perSprintBucketCapacity = {};
  for (const b of PLAN_BUCKETS) perSprintBucketCapacity[b] = new Array(sprintCount).fill(bucketDays[b] * bucketFactor);
  if (bucketsActive) {
    assumptions.push({ key: 'skillBuckets', label: 'Skill-aware capacity', value: 'capacity split across BE / FE / QA from task types', source: 'contract' });
    assumptions.push({ key: 'skillMap', label: 'Task type → skill', value: 'API/DB/ML/OPS → BE · UI/DOC → FE · TEST → QA', source: 'assumption' });
    assumptions.push({ key: 'skillProration', label: 'Multi-skill features', value: 'story points split evenly across the skills a feature needs', source: 'assumption' });
    if (bucketDays.GEN > 0) assumptions.push({ key: 'generalistPool', label: 'Untagged members', value: 'a generalist pool — fills only features with no recognizable skill', source: 'assumption' });
  } else if (overridePresent && anySkillTagged) {
    assumptions.push({ key: 'overrideDisablesBuckets', label: 'Skill buckets off', value: 'a manual capacity override plans against one pooled number', source: 'contract' });
  }

  return {
    ok: true,
    errors: [],
    perSprintCapacityPoints,
    totalCapacityPoints: perSprint * sprintCount,
    perSprintBucketCapacity,
    bucketsActive,
    assumptions,
    warnings,
  };
}

function round1(n) { return Math.round(n * 10) / 10; }

// ════════════════════════════════════════════════════════════════
// 1.4 THROUGHPUT  — Kanban capacity (methodology=kanban). Same fail-loud validation as computeCapacity.
// ════════════════════════════════════════════════════════════════
//
/**
 * Kanban throughput — "how much can the team get through this quarter", expressed as a flow TOTAL (no sprint
 * boxes). Same fail-loud numOf validation + honest echoes as computeCapacity, with two differences: (1) NO
 * sprint structure (sprintCount/length), and (2) availableDays is PER QUARTER — the whole period, NOT per
 * sprint (the one semantic that differs from the Scrum form; it MUST be labelled on the form, else it's the
 * per-sprint×N silent error in reverse). The forecast is a RANGE, not a point (a single number is the #1
 * Kanban-forecast pitfall — fake precision; research 2026-06-21): conservative/optimistic = expected ×
 * the echoed REACH_*_FACTOR. A direct pointsPerQuarterOverride takes precedence (team-derived still surfaced).
 *
 * @param {object} form { people:[{name,availableDays}], hoursPerDay?, focusFactor?, hoursPerPoint?, pointsPerQuarterOverride? }
 * @returns {{ok, expectedPointsQuarter, conservativePoints, optimisticPoints, assumptions, warnings, errors}}
 */
export function computeThroughput(form) {
  const f = form && typeof form === 'object' ? form : {};
  const errors = [];
  const warnings = [];
  const assumptions = [];
  const err = (code, field, message) => errors.push({ code, field, message });
  const warn = (code, message) => warnings.push({ code, message });

  // ── multipliers (defaulted, echoed with provenance — ledger CAP-3) ──
  let hoursPerDay = DEFAULT_HOURS_PER_DAY;
  if (f.hoursPerDay !== undefined && f.hoursPerDay !== '' && f.hoursPerDay !== null) {
    const r = numOf(f.hoursPerDay);
    if (!r.ok || r.val <= 0) err('INVALID_HOURS_PER_DAY', 'hoursPerDay', 'Productive hours per day must be a number greater than 0.');
    else hoursPerDay = r.val;
    assumptions.push({ key: 'hoursPerDay', label: 'Productive hours / day', value: hoursPerDay, source: 'user' });
  } else assumptions.push({ key: 'hoursPerDay', label: 'Productive hours / day', value: hoursPerDay, source: 'default' });

  let focusFactor = DEFAULT_FOCUS_FACTOR;
  if (f.focusFactor !== undefined && f.focusFactor !== '' && f.focusFactor !== null) {
    const r = numOf(f.focusFactor);
    if (!r.ok || r.val <= 0 || r.val > 1) err('INVALID_FOCUS_FACTOR', 'focusFactor', 'Focus factor must be a fraction between 0 and 1 (e.g. 0.7, not 70).');
    else focusFactor = r.val;
    assumptions.push({ key: 'focusFactor', label: 'Focus factor', value: focusFactor, source: 'user' });
  } else assumptions.push({ key: 'focusFactor', label: 'Focus factor', value: focusFactor, source: 'default' });

  let hoursPerPoint = DEFAULT_HOURS_PER_POINT;
  if (f.hoursPerPoint !== undefined && f.hoursPerPoint !== '' && f.hoursPerPoint !== null) {
    const r = numOf(f.hoursPerPoint);
    if (!r.ok || r.val <= 0) err('INVALID_HOURS_PER_POINT', 'hoursPerPoint', 'Hours per story point must be a number greater than 0.'); // divisor guard
    else hoursPerPoint = r.val;
    assumptions.push({ key: 'hoursPerPoint', label: 'Hours / story point', value: hoursPerPoint, source: 'user' });
  } else assumptions.push({ key: 'hoursPerPoint', label: 'Hours / story point', value: hoursPerPoint, source: 'default' });

  // ── per-person available days (PER QUARTER — the whole period, NOT per sprint) ──
  const people = Array.isArray(f.people) ? f.people : [];
  let teamDays = 0;
  let validPeople = 0;
  const seenNames = new Set();
  people.forEach((p, i) => {
    const person = p && typeof p === 'object' ? p : {};
    const name = typeof person.name === 'string' ? person.name.trim() : '';
    const r = numOf(person.availableDays);
    if (!r.ok) { err('INVALID_AVAILABLE_DAYS', `people[${i}].availableDays`, `Available days for ${name || `person ${i + 1}`} must be a number ≥ 0.`); return; }
    if (r.val < 0) { err('INVALID_AVAILABLE_DAYS', `people[${i}].availableDays`, `Available days for ${name || `person ${i + 1}`} cannot be negative.`); return; }
    let days = r.val; // fractional (half-days) legitimate
    if (days > MAX_QUARTER_DAYS + EPS) { warn('AVAILABLE_DAYS_CLAMPED', `${name || `Person ${i + 1}`} is marked available ${days} days this quarter, more than the ~${MAX_QUARTER_DAYS} working days in a typical quarter; clamped — did you enter calendar days instead of working days?`); days = MAX_QUARTER_DAYS; }
    if (name) {
      if (seenNames.has(name.toLowerCase())) warn('DUPLICATE_PERSON_NAME', `"${name}" appears more than once — check for an accidental duplicate row.`);
      seenNames.add(name.toLowerCase());
    } else if (days > 0) warn('BLANK_PERSON_NAME', `A team member with ${days} available days has no name — its capacity still counts.`);
    teamDays += days;
    validPeople += 1;
  });

  // ── override path (precedence + surfaced, never silent shadow — ledger CAP-9) ──
  const overridePresent = f.pointsPerQuarterOverride !== undefined && f.pointsPerQuarterOverride !== '' && f.pointsPerQuarterOverride !== null;
  let overrideVal = null;
  if (overridePresent) {
    const r = numOf(f.pointsPerQuarterOverride);
    if (!r.ok || r.val <= 0) err('INVALID_OVERRIDE', 'pointsPerQuarterOverride', 'The points-per-quarter override must be a number greater than 0.');
    else overrideVal = r.val;
  }

  const multipliersOk = !errors.some((e) => ['INVALID_HOURS_PER_DAY', 'INVALID_FOCUS_FACTOR', 'INVALID_HOURS_PER_POINT'].includes(e.code));
  const teamExpected = multipliersOk && hoursPerPoint > 0 ? (teamDays * hoursPerDay * focusFactor) / hoursPerPoint : NaN;

  if (!overridePresent) {
    if (validPeople === 0 && !people.length) err('ZERO_CAPACITY', 'people', 'Add at least one team member with available days.');
    else if (multipliersOk && teamDays <= 0 && validPeople > 0) err('ZERO_CAPACITY', 'people', 'Total available days is 0 — the team has no capacity to plan against.');
  }

  if (errors.length > 0) return { ok: false, errors, expectedPointsQuarter: null, conservativePoints: null, optimisticPoints: null, assumptions, warnings };

  let expected;
  if (overridePresent) {
    expected = overrideVal;
    assumptions.push({ key: 'override', label: 'Capacity source', value: `manual override: ${overrideVal} pts/quarter`, source: 'user' });
    if (Number.isFinite(teamExpected)) {
      assumptions.push({ key: 'computedTeam', label: 'Team-derived (for reference)', value: `${round1(teamExpected)} pts/quarter`, source: 'computed' });
      if (teamExpected > 0 && Math.abs(overrideVal - teamExpected) / teamExpected > 0.5) warn('OVERRIDE_DISCREPANCY', `Manual override (${overrideVal}) differs from the team-derived capacity (${round1(teamExpected)} pts/quarter) — confirm the override is intended.`);
    }
  } else {
    expected = teamExpected;
    assumptions.push({ key: 'availableDaysContract', label: 'Available days are PER QUARTER', value: 'each person’s days count once over the whole quarter, not per sprint', source: 'contract' }); // the reverse of CAP-4
  }

  if (!Number.isFinite(expected) || expected < 0) return { ok: false, errors: [{ code: 'NON_FINITE_CAPACITY', field: 'capacity', message: 'The computed capacity is not a valid number — check the team and multiplier inputs.' }], expectedPointsQuarter: null, conservativePoints: null, optimisticPoints: null, assumptions, warnings };

  const conservativePoints = expected * REACH_CONSERVATIVE_FACTOR;
  const optimisticPoints = expected * REACH_OPTIMISTIC_FACTOR;
  // honesty echoes (research 2026-06-21 — wear the no-history imprecision on the OUTSIDE, the cost-estimate pattern)
  assumptions.push({ key: 'noFlowHistory', label: 'Capacity-based estimate', value: 'no flow history yet — a capacity estimate, not a measured forecast; it sharpens once the team has real throughput', source: 'contract' });
  assumptions.push({ key: 'reachBand', label: 'Reach is a range', value: `conservative ${round1(conservativePoints)} – optimistic ${round1(optimisticPoints)} pts (×${REACH_CONSERVATIVE_FACTOR} / ×${REACH_OPTIMISTIC_FACTOR} of the ${round1(expected)} expected)`, source: 'contract' });
  assumptions.push({ key: 'steadyFlow', label: 'Assumes steady flow + limited WIP', value: 'early throughput is typically lower (ramp-up); starting too much work at once lowers real throughput below this', source: 'assumption' });
  // C4 (deep-audit): surface the focus-factor leverage on the COMPLETED plan, not only the pre-generate preview —
  // the research names it the single biggest lever, so it belongs with the other two honesty assumptions always.
  assumptions.push({ key: 'focusLever', label: 'Focus factor is your biggest lever', value: 'it scales throughput directly — a small change moves the whole reach line', source: 'contract' });

  return { ok: true, errors: [], expectedPointsQuarter: expected, conservativePoints, optimisticPoints, assumptions, warnings };
}

// ════════════════════════════════════════════════════════════════
// 1.5 SKILL BUCKETS  — Tier-2 skill-aware capacity (BE/FE/QA + a generalist fallback). PURE.
// ════════════════════════════════════════════════════════════════
//
// v1 answers "can my ACTUAL team deliver this?" by splitting capacity into a SMALL FIXED set of skill
// buckets (memory: 3 disciplines, NEVER 7), derived from the breakdown's per-TASK `type` enum. The skill
// is DERIVED from tasks[].type — NO LLM (§4: the enum already classifies deterministically; an LLM here
// would be a reverse-§4 patch). Every judgment (the 7→3 map, even-proration, the generalist fallback) is
// an ECHOED, surfaced assumption — never an opaque heuristic (§5/§11, the CAP-3 honesty pattern).

export const SKILL_BUCKETS = ['BE', 'FE', 'QA']; // the user-facing disciplines (the per-person skill select)
const GEN_BUCKET = 'GEN'; // generalist/unassigned fallback: untagged people + features with no recognizable skill
export const PLAN_BUCKETS = ['BE', 'FE', 'QA', GEN_BUCKET]; // internal — GEN surfaces only when it carries capacity/demand
// The 7-value task-type enum → the 3 disciplines. JUDGMENT, echoed + tunable (NOT a buried switch). DOC→FE
// is the one debatable cell (user-facing copy/docs ≈ front-of-house) — surfaced in the plan's assumptions.
export const TASK_TYPE_TO_SKILL = Object.freeze({ API: 'BE', DB: 'BE', ML: 'BE', OPS: 'BE', UI: 'FE', DOC: 'FE', TEST: 'QA' });

function taskTypesOf(feature) {
  if (Array.isArray(feature && feature.task_types)) return feature.task_types;                // the slim projection
  if (Array.isArray(feature && feature.tasks)) return feature.tasks.map((t) => t && t.type);  // a raw breakdown feature
  return [];
}

/**
 * The SET of disciplines a feature needs, from its tasks' types (mapped 7→3). Returns the skills in
 * SKILL_BUCKETS order (deterministic), the unknown task-types it carried (schema drift — surfaced, never
 * silently bucketed), and whether it had any tasks. A feature with no mapped skill needs the generalist pool.
 */
export function requiredSkillsOf(feature) {
  const types = taskTypesOf(feature).filter((t) => typeof t === 'string' && t.trim());
  const have = new Set();
  const unknownTypes = [];
  for (const t of types) { const k = TASK_TYPE_TO_SKILL[t]; if (k) have.add(k); else unknownTypes.push(t); }
  return { skills: SKILL_BUCKETS.filter((b) => have.has(b)), unknownTypes, hasTasks: types.length > 0 };
}

/**
 * Apportion a feature's story_points EVENLY (float — never pre-rounded, CAP-10) across the buckets it
 * needs. The only data-supported split: a feature has ONE story_points + typed tasks but no per-task
 * points, so even-across-skills is the sole non-fabricating choice (surfaced as an assumption). A feature
 * with no recognizable skill → its WHOLE points land in GEN (never silently dropped / even-split, §11).
 */
export function apportionPoints(points, skills) {
  const out = { BE: 0, FE: 0, QA: 0, GEN: 0 };
  const p = Number(points);
  if (!Number.isFinite(p) || p <= 0) return out;
  const list = Array.isArray(skills) ? skills.filter((s) => SKILL_BUCKETS.includes(s)) : [];
  if (list.length === 0) { out.GEN = p; return out; }
  const share = p / list.length;
  for (const s of list) out[s] = share;
  return out;
}

/**
 * Per-feature bucket DEMAND from the task-type enum (SIZED features only — unsized is validateSizing's
 * channel). Returns the demand map keyed on idOf (graph.idByIndex parity) + the DISJOINT diagnostic
 * channels: skill_unclassified (a sized feature with no recognizable skill → its points go to GEN, surfaced,
 * never dropped) and unknown_task_type (schema drift). idOf is the SAME positional keyer as validateSizing.
 */
export function featureSkillSplit(features, idOf, points) {
  const list = Array.isArray(features) ? features : [];
  const pts = points instanceof Map ? points : new Map();
  const demand = new Map();
  const unclassified = [];
  const unknownTaskTypes = [];
  list.forEach((f, i) => {
    const id = idOf(f, i);
    if (!pts.has(id)) return; // only sized features carry a demand
    const req = requiredSkillsOf(f);
    if (req.unknownTypes.length) unknownTaskTypes.push({ id, name: (f && f.name) || '', types: Array.from(new Set(req.unknownTypes)) });
    if (req.skills.length === 0) unclassified.push({ id, name: (f && f.name) || '', reason: req.hasTasks ? 'no_mapped_skill' : 'no_tasks' });
    demand.set(id, apportionPoints(pts.get(id), req.skills));
  });
  return { demand, unclassified, unknownTaskTypes };
}

// ════════════════════════════════════════════════════════════════
// 2. SIZING  — validate story points post-edit (ledger SIZE-1)
// ════════════════════════════════════════════════════════════════

/**
 * The schema's Fibonacci 3/5/8/13 must NOT be trusted after editor edits. A story with missing /
 * 0 / negative / non-integer story_points is UNSIZED → excluded from packing into a dedicated
 * bucket, NEVER fake-fit at 0 (which "fits" anywhere) and never fed unflagged to the LLM.
 * @param {Array<{_uid?:string, name?:string, story_points?:number}>} features
 * @returns {{points:Map<string,number>, unsized:Array<{id:string,name:string,reason:string}>}}
 */
export function validateSizing(features, idOf) {
  const list = Array.isArray(features) ? features : [];
  const points = new Map();
  const unsized = [];
  // idOf is called with (feature, index) so callers can key by POSITION (graph.idByIndex) — never
  // indexOf, which collapses a duplicate object ref and is O(n²).
  list.forEach((f, i) => {
    const id = idOf(f, i);
    const r = numOf(f && f.story_points);
    if (!r.ok) { unsized.push({ id, name: (f && f.name) || '', reason: 'missing_story_points' }); return; }
    if (!Number.isInteger(r.val) || r.val <= 0) { unsized.push({ id, name: (f && f.name) || '', reason: 'invalid_story_points' }); return; }
    points.set(id, r.val);
  });
  return { points, unsized };
}

// ════════════════════════════════════════════════════════════════
// 3. GRAPH  — uid-keyed adjacency with push_handler parity (ledger GRAPH-2/3/4, LLM-8)
// ════════════════════════════════════════════════════════════════

/**
 * The canonical stable id of a feature: its frontend-minted _uid (v3Schema.newStoryUid). A
 * deterministic fallback keeps the planner robust if a feature ever arrives without one (should not
 * happen via the frontend edited-breakdown path), so ids are never collided onto a name.
 */
export function featureId(f, index) {
  return (f && typeof f._uid === 'string' && f._uid) || `idx_${index}`;
}

/**
 * Build the planner dependency graph on _uid, resolving each dependency NAME-string via the frozen
 * _orig_name → [uid] map — IDENTICAL keying to push_handler.flattenBreakdown so the plan and the
 * push can never disagree about what is blocked. Surfaces (never silently drops) dangling /
 * ambiguous / self / duplicate-name issues.
 *
 * @param {Array<object>} features  the edited breakdown features (carry _uid + _orig_name)
 * @returns {{ ids:string[], byId:Map, nameOf:Map<string,string>, blockers:Map<string,Set<string>>,
 *            dependents:Map<string,Set<string>>, danglingRefs:Array, ambiguousDeps:Array,
 *            selfDeps:Array, duplicateNames:Array }}
 */
export function buildPlannerGraph(features) {
  const list = Array.isArray(features) ? features : [];
  const ids = [];
  const byId = new Map();
  const nameOf = new Map();
  const idByIndex = [];
  const seenIds = new Set();
  const duplicateUids = [];
  list.forEach((f, i) => {
    let id = featureId(f, i);
    if (seenIds.has(id)) {
      // Duplicate _uid (a malformed payload — uids are minted UNIQUE on the frontend). Disambiguate
      // positionally so NO feature collapses onto another (§11: never silently lose one) and surface
      // it. This keeps graph.ids STRICTLY UNIQUE, so topo/pack can never livelock on a dup.
      duplicateUids.push({ id, index: i, name: (f && f.name) || '' });
      id = `${id}#${i}`;
    }
    seenIds.add(id);
    ids.push(id);
    byId.set(id, f);
    nameOf.set(id, (f && f.name) || '');
    idByIndex.push(id);
  });

  // frozen _orig_name → [uid…]  (parity with push_handler.js:233 — array so a duplicate name stays UNBOUND)
  const nameToIds = new Map();
  const nameCounts = new Map();
  list.forEach((f, i) => {
    const key = f && ((typeof f._orig_name === 'string' && f._orig_name) || f.name);
    if (key == null) return;
    if (!nameToIds.has(key)) nameToIds.set(key, []);
    nameToIds.get(key).push(idByIndex[i]);
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  });

  const blockers = new Map(); // id → Set(blockerId): the features that must come FIRST
  const dependents = new Map(); // id → Set(dependentId)
  ids.forEach((id) => { blockers.set(id, new Set()); dependents.set(id, new Set()); });

  const danglingRefs = [];
  const ambiguousDeps = [];
  const selfDeps = [];

  list.forEach((f, i) => {
    const id = idByIndex[i];
    const ownKey = f && ((typeof f._orig_name === 'string' && f._orig_name) || f.name);
    const deps = Array.isArray(f && f.dependencies) ? f.dependencies : [];
    for (const depName of deps) {
      if (typeof depName !== 'string' || !depName) continue;
      if (depName === ownKey || depName === (f && f.name)) { selfDeps.push({ id, name: nameOf.get(id), dep: depName }); continue; } // ledger GRAPH-5
      const cand = nameToIds.get(depName);
      if (!cand || cand.length === 0) { danglingRefs.push({ id, name: nameOf.get(id), missingDep: depName }); continue; } // ledger GRAPH-2
      if (cand.length > 1) { ambiguousDeps.push({ id, name: nameOf.get(id), dep: depName, matches: cand.slice() }); continue; } // ledger GRAPH-4 (parity: >1 = UNBOUND)
      const blockerId = cand[0];
      if (blockerId === id) { selfDeps.push({ id, name: nameOf.get(id), dep: depName }); continue; }
      blockers.get(id).add(blockerId);
      dependents.get(blockerId).add(id);
    }
  });

  const duplicateNames = [];
  for (const [name, count] of nameCounts) if (count > 1) duplicateNames.push({ name, count });

  return { ids, byId, nameOf, idByIndex, blockers, dependents, danglingRefs, ambiguousDeps, selfDeps, duplicateNames, duplicateUids };
}

// ════════════════════════════════════════════════════════════════
// 4. TOPO + CYCLES  — Kahn with deterministic cycle-break (ledger GRAPH-1/6/8)
// ════════════════════════════════════════════════════════════════

/**
 * Kahn topological sort over `blockers`. If the graph has a cycle, Kahn stalls with an in-degree>0
 * remainder; we deterministically break it (drop the soft edge into the lowest-priority remaining
 * node) so EVERY node still gets a legal-best-effort order and NONE silently vanishes (ledger
 * GRAPH-1). Cycle membership + the cut edges are returned for a loud red callout (no LLM spent on
 * cycle resolution in v1). The tiebreak among ready nodes is deterministic + caller-supplied
 * (prefRank) so the LLM preference is honoured on independent/tie choices (ledger GRAPH-8).
 *
 * @param {object} graph from buildPlannerGraph
 * @param {(id:string)=>number} prefRank lower = higher preference (LLM-array position; fallback otherwise)
 * @param {(id:string)=>number} priorityRank lower = higher business priority (final tiebreak)
 * @returns {{ order:string[], cyclicNodes:string[], cutEdges:Array<{from:string,to:string}> }}
 */
export function topoSortAndCycles(graph, prefRank, priorityRank) {
  const ids = graph.ids.slice();
  const indeg = new Map();
  const remainingBlockers = new Map();
  ids.forEach((id) => { const b = new Set(graph.blockers.get(id) || []); remainingBlockers.set(id, b); indeg.set(id, b.size); });

  const placed = new Set();
  const order = [];
  const cyclicNodes = new Set();
  const cutEdges = [];

  const cmp = (a, b) => (prefRank(a) - prefRank(b)) || (priorityRank(a) - priorityRank(b)) || (a < b ? -1 : a > b ? 1 : 0);

  const readyList = () => ids.filter((id) => !placed.has(id) && indeg.get(id) === 0).sort(cmp);

  let guard = 0;
  while (placed.size < ids.length) {
    if (++guard > ids.length + 1) break; // defensive: ids are unique so this can't trip — but NEVER livelock
    let ready = readyList();
    if (ready.length === 0) {
      // cycle: pick the lowest-priority remaining node, cut its remaining incoming edges (ledger GRAPH-1)
      const stuck = ids.filter((id) => !placed.has(id)).sort((a, b) => (indeg.get(a) - indeg.get(b)) || cmp(a, b));
      const victim = stuck[0];
      if (victim === undefined) break; // nothing left to place (defensive — unreachable with unique ids)
      cyclicNodes.add(victim);
      for (const bId of remainingBlockers.get(victim)) { cutEdges.push({ from: bId, to: victim }); }
      remainingBlockers.set(victim, new Set());
      indeg.set(victim, 0);
      ready = [victim];
    }
    const next = ready[0];
    order.push(next);
    placed.add(next);
    for (const dep of graph.dependents.get(next) || []) {
      if (placed.has(dep)) continue;
      const rb = remainingBlockers.get(dep);
      if (rb.has(next)) { rb.delete(next); indeg.set(dep, rb.size); }
    }
  }

  return { order, cyclicNodes: Array.from(cyclicNodes), cutEdges };
}

// ════════════════════════════════════════════════════════════════
// 5. SCHEDULING SIGNALS  — pre-computed so the LLM never estimates them (ledger LLM-6, GRAPH-7)
// ════════════════════════════════════════════════════════════════

/**
 * Per-feature deterministic signals fed to the ranking LLM as INPUTS (so it reasons over them
 * instead of guessing): criticalPathLen (longest blocker-chain INTO this node, 1-based),
 * downstreamUnblockCount (transitive dependents this node unblocks), slack (unweighted total
 * float = how far it can move without extending the critical path). Memoized DFS over the
 * cycle-broken (acyclic) order → O(V+E), well under budget. Guards every divisor (ledger GRAPH-6).
 *
 * @param {object} graph
 * @param {string[]} order acyclic order from topoSortAndCycles (used to bound recursion safely)
 * @returns {Map<string,{criticalPathLen:number, downstreamUnblockCount:number, slack:number}>}
 */
export function computeSchedulingSignals(graph, order) {
  const ids = graph.ids;
  const orderPos = new Map(order.map((id, i) => [id, i]));
  // effective blockers = only those EARLIER in the acyclic order (cut edges excluded → no recursion into a cycle)
  const effBlockers = (id) => Array.from(graph.blockers.get(id) || []).filter((b) => orderPos.has(b) && orderPos.get(b) < orderPos.get(id));
  const effDependents = (id) => Array.from(graph.dependents.get(id) || []).filter((d) => orderPos.has(d) && orderPos.get(d) > orderPos.get(id));

  // longest chain ENDING at id (depth), via earlier blockers
  const depthMemo = new Map();
  const depthOf = (id) => {
    if (depthMemo.has(id)) return depthMemo.get(id);
    let d = 1;
    for (const b of effBlockers(id)) d = Math.max(d, depthOf(b) + 1);
    depthMemo.set(id, d);
    return d;
  };
  // longest chain STARTING at id (height), via later dependents
  const heightMemo = new Map();
  const heightOf = (id) => {
    if (heightMemo.has(id)) return heightMemo.get(id);
    let h = 1;
    for (const d of effDependents(id)) h = Math.max(h, heightOf(d) + 1);
    heightMemo.set(id, h);
    return h;
  };
  // transitive dependent count (downstream unblock)
  const downMemo = new Map();
  const downOf = (id) => {
    if (downMemo.has(id)) return downMemo.get(id);
    const acc = new Set();
    for (const d of effDependents(id)) { acc.add(d); for (const x of downOf(d)) acc.add(x); }
    downMemo.set(id, acc);
    return acc;
  };

  // compute in REVERSE order for height/down (dependents resolved first), forward for depth
  for (const id of order) depthOf(id);
  for (let i = order.length - 1; i >= 0; i--) { heightOf(order[i]); downOf(order[i]); }

  let maxChain = 0;
  for (const id of ids) maxChain = Math.max(maxChain, depthOf(id) + heightOf(id) - 1);

  const out = new Map();
  for (const id of ids) {
    const cp = depthOf(id);
    const chainThrough = depthOf(id) + heightOf(id) - 1;
    out.set(id, {
      criticalPathLen: cp,
      downstreamUnblockCount: downOf(id).size,
      slack: Math.max(0, maxChain - chainThrough),
    });
  }
  return out;
}

/**
 * The uids on the SINGLE longest dependency chain (the "critical path"), ordered root→end.
 * Deterministic: start from the deepest node (max criticalPathLen; ties by smallest uid — the END of the
 * longest chain, since that node's height is necessarily 1), then walk BACKWARD along effective-blocker
 * edges that step the depth down by exactly 1 (ties by smallest uid). `effBlockers` mirrors
 * computeSchedulingSignals — a blocker only counts when it is EARLIER in `order` — so a cut soft-cycle edge
 * (whose blocker sits AFTER in the acyclic order) is excluded BY CONSTRUCTION; a cycle can never fabricate a
 * bogus whole-graph path. The depths read from `signals` (criticalPathLen), so the returned chain is always
 * consistent with the per-chip depth shown. Returns [] when there is no dependency chain of length >= 2
 * (a plan with no real dependencies has no critical path to name → the FE marks/plots nothing).
 *
 * ⚠ MUST be given the SAME `order` + `signals` computeSchedulingSignals was given (baseTopo.order) so the
 * depth values line up — otherwise the step-down trace can pick an inconsistent predecessor.
 *
 * @param {object} graph  from buildPlannerGraph
 * @param {string[]} order  the acyclic order computeSchedulingSignals was given (baseTopo.order)
 * @param {Map<string,{criticalPathLen:number}>} signals  from computeSchedulingSignals
 * @returns {string[]}  root→end uids on the longest chain (length >= 2), or []
 */
export function computeCriticalPathUids(graph, order, signals) {
  const ids = Array.isArray(graph && graph.ids) ? graph.ids : [];
  const sig = signals instanceof Map ? signals : new Map();
  if (ids.length === 0) return [];
  const orderPos = new Map((Array.isArray(order) ? order : []).map((id, i) => [id, i]));
  const depthOf = (id) => { const s = sig.get(id); return s && Number.isFinite(s.criticalPathLen) ? s.criticalPathLen : 1; };
  // effective blockers = only those EARLIER in the acyclic order (mirrors computeSchedulingSignals →
  // a cut soft-cycle edge is excluded by construction; no legal.cutEdges lookup needed).
  const effBlockers = (id) => {
    const pos = orderPos.has(id) ? orderPos.get(id) : Infinity;
    return Array.from(graph.blockers.get(id) || []).filter((b) => orderPos.has(b) && orderPos.get(b) < pos);
  };

  // deepest node = the END of the single longest chain (max depth; ties by smallest uid)
  let end = null;
  let maxDepth = 0;
  for (const id of ids) {
    const d = depthOf(id);
    if (end === null || d > maxDepth || (d === maxDepth && id < end)) { maxDepth = d; end = id; }
  }
  if (end === null || maxDepth < 2) return []; // no dependency chain of length >= 2 → no critical path

  const chain = [];
  const seen = new Set();
  let cur = end;
  while (cur != null && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    const d = depthOf(cur);
    if (d <= 1) break;
    // step DOWN one level: a blocker whose depth is exactly d-1 (a predecessor on the longest chain); ties → smallest uid
    let nextNode = null;
    for (const b of effBlockers(cur)) {
      if (depthOf(b) === d - 1 && (nextNode === null || b < nextNode)) nextNode = b;
    }
    cur = nextNode;
  }
  chain.reverse(); // root (depth 1) → end (max depth)
  return chain;
}

// ════════════════════════════════════════════════════════════════
// 6. NORMALIZE RANKING  — make the advisory LLM output TOTAL + legal (ledger LLM-1/2/8)
// ════════════════════════════════════════════════════════════════

/**
 * Reconcile the LLM's ranking against the canonical feature set into a STRICT TOTAL preference
 * order. Engineering owns the ordinal: order comes from ARRAY POSITION (the rank integer is
 * advisory display only — Anthropic structured outputs reject numeric constraints, so duplicate /
 * garbage ranks are EXPECTED). Unknown ids are dropped (→violations), duplicates de-duped, and
 * EVERY omitted feature is appended by a deterministic fallback so no feature ever silently
 * vanishes from the plan (POLICY §11). The result is a soft PREFERENCE order; packSprints enforces
 * dependency legality on top of it.
 *
 * @param {Array<{feature_id:string}>} ranking  raw LLM output (may be [], partial, scrambled)
 * @param {object} graph
 * @param {Map} signals
 * @param {(id:string)=>number} priorityRank lower = higher business priority
 * @param {(id:string)=>number} complexityRank lower = higher complexity
 * @returns {{ preferenceOrder:string[], unknownIds:string[], duplicateIds:string[], omittedIds:string[], usedLlm:boolean }}
 */
export function normalizeRanking(ranking, graph, signals, priorityRank, complexityRank) {
  const canonical = new Set(graph.ids);
  const seen = new Set();
  const ordered = [];
  const unknownIds = [];
  const duplicateIds = [];
  const list = Array.isArray(ranking) ? ranking : [];

  for (const row of list) {
    const id = row && typeof row === 'object' ? row.feature_id : row;
    if (typeof id !== 'string') continue;
    if (!canonical.has(id)) { unknownIds.push(id); continue; } // hallucinated / cross-breakdown id
    if (seen.has(id)) { duplicateIds.push(id); continue; }
    seen.add(id);
    ordered.push(id);
  }

  // deterministic fallback sort for the OMITTED features (and for an empty/garbage ranking)
  const sig = (id) => signals.get(id) || { criticalPathLen: 0, downstreamUnblockCount: 0, slack: 0 };
  const fallbackCmp = (a, b) =>
    (priorityRank(a) - priorityRank(b)) ||
    (complexityRank(a) - complexityRank(b)) ||
    (sig(b).downstreamUnblockCount - sig(a).downstreamUnblockCount) ||
    (sig(b).criticalPathLen - sig(a).criticalPathLen) ||
    (a < b ? -1 : a > b ? 1 : 0);

  const omittedIds = graph.ids.filter((id) => !seen.has(id)).sort(fallbackCmp);
  const usedLlm = ordered.length > 0;
  const preferenceOrder = ordered.concat(omittedIds);
  return { preferenceOrder, unknownIds, duplicateIds, omittedIds, usedLlm };
}

// A rationale string is capped defensively so a runaway model row can't bloat the response / KVS payload.
export const RATIONALE_MAX_CHARS = 400;

/**
 * Build a compact { [feature_id]: rationale } map from the RAW LLM ranking array (record.ranking — rows of
 * shape {feature_id, rank, rationale?}). Includes ONLY entries whose rationale is a non-empty TRIMMED string,
 * each capped to RATIONALE_MAX_CHARS. A null / undefined / [] / non-array ranking (a deterministic-fallback
 * plan has record.ranking === null) → {} — the STRUCTURAL absence the honesty firewall relies on (a plan with
 * no Claude reasoning must show NO reasoning, never a fabricated one). PURE + derive-on-read: this is computed
 * at RESPONSE time from record.ranking, NOT a new persisted KVS field. First rationale wins on a duplicate
 * feature_id (deterministic; mirrors normalizeRanking keeping the first occurrence). feature_id == the plan-time
 * _uid the chips already key on, so the map is directly consumable by the FeatureChip.
 *
 * @param {Array<{feature_id:string, rationale?:string}>|null|undefined} ranking
 * @returns {{[feature_id:string]: string}}
 */
export function buildRationaleMap(ranking) {
  const out = {};
  const list = Array.isArray(ranking) ? ranking : [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const id = row.feature_id;
    if (typeof id !== 'string' || !id) continue;
    if (Object.prototype.hasOwnProperty.call(out, id)) continue; // first rationale wins (dup feature_id)
    const raw = row.rationale;
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue; // empty / whitespace-only → omitted (never a hollow "no reason" entry)
    out[id] = trimmed.length > RATIONALE_MAX_CHARS ? trimmed.slice(0, RATIONALE_MAX_CHARS) : trimmed;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════
// 7. PACK SPRINTS  — readiness-gated greedy (ledger PACK-1..10, the linear≠sprint fix)
// ════════════════════════════════════════════════════════════════

/**
 * Pack features into capacity-bounded sprints, FRONT-LOADED, respecting dependencies at PLACEMENT
 * time (the linear-order ≠ sprint-assignment fix, ledger PACK-2): a feature enters sprint S only
 * when ALL its blockers are already placed in a sprint ≤ S (same-sprint co-placement allowed since
 * the blocker fills earlier within the sprint — PACK-3). Greedy places, in preference order, any
 * READY item that fits the remaining capacity (natural back-fill of gaps). Capacity is a HARD
 * ceiling — items that don't fit overflow; the ONE exception is an OVERSIZED item (points larger
 * than any single sprint), which is force-placed at the earliest sprint it's ready with a loud
 * over-capacity flag rather than blocking its whole downstream forever (PACK-1). Overflow cascades
 * transitively with a typed reason + root cause (PACK-4). overflow / oversized / sizingIssues /
 * violations are DISJOINT channels (PACK-8/9).
 *
 * @param {string[]} preferenceOrder soft order from normalizeRanking
 * @param {number[]} perSprintCapacityPoints FLOAT capacities
 * @param {object} graph
 * @param {Map<string,number>} points sized features only (validateSizing.points)
 * @param {Array} unsized from validateSizing
 * @returns {object} the full plan result
 */
export function packSprints(preferenceOrder, perSprintCapacityPoints, graph, points, unsized, cutEdges, bucketCtx) {
  const caps = Array.isArray(perSprintCapacityPoints) ? perSprintCapacityPoints : [];
  const N = caps.length;
  // Tier-2 skill mode: per-bucket capacity + demand. ABSENT (bucketCtx falsy) → the scalar pooled path
  // runs byte-identically to v1 (existing tests green). PRESENT → each sprint also carries per-bucket
  // load/capacity and the fit test is per-bucket. The dependency readiness gate is skill-AGNOSTIC (unchanged).
  const sk = bucketCtx && bucketCtx.demand instanceof Map ? bucketCtx : null;
  const bcaps = sk ? (bucketCtx.bucketCaps || {}) : {};
  const bcap = (k, s) => ((bcaps[k] && Number(bcaps[k][s])) || 0);
  const demandOf = (id) => (sk && sk.demand.get(id)) || null;
  const maxBcap = {}; if (sk) for (const k of PLAN_BUCKETS) maxBcap[k] = (bcaps[k] || []).reduce((a, b) => Math.max(a, Number(b) || 0), 0);
  const sprints = caps.map((cap, i) => {
    const sp = { index: i, capacity: cap, load: 0, ids: [], overCapacity: false };
    if (sk) { sp.bucketLoad = { BE: 0, FE: 0, QA: 0, GEN: 0 }; sp.bucketCapacity = { BE: bcap('BE', i), FE: bcap('FE', i), QA: bcap('QA', i), GEN: bcap('GEN', i) }; }
    return sp;
  });
  const maxCap = caps.length ? Math.max(...caps) : 0;

  // CUT edges (broken to make a cyclic graph schedulable) must NOT count as blockers for placement —
  // else a cycle member can never satisfy readiness and DEADLOCKS into overflow with a false reason
  // even when sprints sit idle (deep-audit PLAN-01: topoSortAndCycles cut the edge for the legal order,
  // but the packer was reading the RAW graph.blockers). Mirror computeSchedulingSignals.effBlockers.
  const cut = new Set((Array.isArray(cutEdges) ? cutEdges : []).map((e) => `${e.from}\u0000${e.to}`));
  const effectiveBlockers = (id) => Array.from(graph.blockers.get(id) || []).filter((b) => !cut.has(`${b}\u0000${id}`));

  // only SIZED features participate; preserve preference order
  const sizedSet = new Set(points.keys());
  const queue = preferenceOrder.filter((id) => sizedSet.has(id));
  const remaining = new Set(queue);
  const placedSprint = new Map(); // id → sprint index
  const oversized = [];

  const blockersReadyBy = (id, s) => {
    for (const b of effectiveBlockers(id)) {
      if (!sizedSet.has(b)) {
        // a blocker that is UNSIZED can never be placed → this id can never be legally placed either
        return false;
      }
      const bs = placedSprint.get(b);
      if (bs === undefined || bs > s) return false;
    }
    return true;
  };

  // preference position precomputed once (deep-audit PLAN-06: queue.indexOf×2 inside a sort comparator
  // is an O(n³log n) cliff at the feature cap — mirror the prefPos Map pattern used in assemblePlan).
  const prefPos = new Map(queue.map((id, i) => [id, i]));
  const inPrefOrder = (a, b) => (prefPos.get(a) ?? 0) - (prefPos.get(b) ?? 0);

  // FIT test — scalar (total) OR per-bucket AND (skill mode). The bucket fit is the binding constraint
  // (Σ demand = points, Σ bucketCap = cap → bucket-fit implies scalar-fit), so it stands alone in skill mode.
  const fits = (id, s) => {
    if (sk) {
      const d = demandOf(id); if (!d) return false;
      for (const k of PLAN_BUCKETS) if (d[k] > EPS && sprints[s].bucketLoad[k] + d[k] > bcap(k, s) + EPS) return false;
      return true;
    }
    return sprints[s].load + points.get(id) <= sprints[s].capacity + EPS;
  };
  // OVERSIZED — can't fit ANY sprint. Scalar: points > maxCap. Skill: a required bucket whose share exceeds
  // that bucket's max per-sprint capacity, BUT only when the bucket HAS capacity — a ZERO-capacity required
  // bucket is NOT oversized; it genuinely can't be staffed → it overflows bucket_exhausted, never force-placed.
  const isOversized = (id) => {
    if (sk) { const d = demandOf(id); return PLAN_BUCKETS.some((k) => d[k] > EPS && maxBcap[k] > EPS && d[k] > maxBcap[k] + EPS); }
    return points.get(id) > maxCap + EPS;
  };
  const place = (id, s, over) => {
    sprints[s].ids.push(id);
    sprints[s].load += points.get(id);
    if (sk) { const d = demandOf(id) || {}; for (const k of PLAN_BUCKETS) sprints[s].bucketLoad[k] += (d[k] || 0); }
    if (over) sprints[s].overCapacity = true;
    remaining.delete(id);
    placedSprint.set(id, s);
  };

  for (let s = 0; s < N; s++) {
    // keep filling sprint s until nothing READY fits (and no oversized to force)
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const ready = Array.from(remaining).filter((id) => blockersReadyBy(id, s)).sort(inPrefOrder);
      if (ready.length === 0) break;
      // 1) place the highest-preference READY item that FITS (per-bucket in skill mode) — natural back-fill
      let placed = null;
      for (const id of ready) { if (fits(id, s)) { placed = id; break; } }
      if (placed) { place(placed, s); continue; }
      // 2) nothing fits — is the top READY item OVERSIZED (can't fit ANY sprint)? force-place it here (PACK-1)
      const top = ready[0];
      if (isOversized(top)) {
        place(top, s, true);
        const ov = { id: top, name: graph.nameOf.get(top), points: points.get(top), maxCapacity: maxCap };
        if (sk) {
          const d = demandOf(top) || {};
          ov.buckets = PLAN_BUCKETS.filter((k) => d[k] > EPS && maxBcap[k] > EPS && d[k] > maxBcap[k] + EPS);
          // Per-bucket by-how-much: in skill mode the BINDING constraint is a single bucket's demand vs THAT
          // bucket's per-sprint cap, NOT the feature total vs the pooled cap (that can read "fits"). Record it so
          // the reason string is honest ("needs N backend pts vs an M-pt backend cap per sprint").
          ov.bucketDetail = ov.buckets.map((k) => ({ bucket: k, demand: d[k], cap: maxBcap[k] }));
        }
        oversized.push(ov);
        // CLOSE the sprint after a forced oversized placement (deep-audit PLAN-05): the sprint is already
        // over capacity, so don't cram more (incl. a 2nd oversized) into it — distribute one per sprint.
        break;
      }
      // 3) ready items exist but none fit this sprint's remaining gap → close the sprint
      break;
    }
  }

  // ── per-bucket totals (skill mode) — the bottleneck story ──
  const bucketCapacityTotal = {}, bucketPlanned = {}, bucketDemandTotal = {};
  if (sk) {
    for (const k of PLAN_BUCKETS) {
      bucketCapacityTotal[k] = (bcaps[k] || []).reduce((a, b) => a + (Number(b) || 0), 0);
      bucketPlanned[k] = sprints.reduce((a, sp) => a + (sp.bucketLoad[k] || 0), 0);
      bucketDemandTotal[k] = Array.from(sizedSet).reduce((a, id) => a + ((demandOf(id) || {})[k] || 0), 0);
    }
  }
  const bucketUnmet = (k) => (bucketDemandTotal[k] || 0) - (bucketPlanned[k] || 0); // >0 → demand couldn't be placed (overflowed)
  // overfilled = points FORCE-PLACED over the bucket's capacity (an oversized-by-bucket feature). Without
  // this the bottleneck story LIES: a 10-pt BE feature crammed into a 7-cap BE bucket shows unmet=0 yet the
  // bucket is 143% loaded (§13 gate MED). BOTH unmet (overflowed) and overfilled (force-placed over) are "short".
  const bucketOverfilled = (k) => Math.max(0, (bucketPlanned[k] || 0) - (bucketCapacityTotal[k] || 0));
  // ⭐ HONEST bottleneck (live-acceptance 2026-06-20): a skill is a TRUE bottleneck ONLY when its OWN demand
  // exceeds its OWN capacity. bucketUnmet (demand−placed) OVER-COUNTS collateral: when an ATOMIC feature
  // overflows because ONE required skill is exhausted (e.g. QA=0), its OTHER skills' demand is also unplaced
  // even though those skills sit IDLE — flagging them "beyond capacity" while idle is contradictory and gives
  // wrong advice ("rebalance toward backend" when backend is idle). overDemand = the genuine shortfall, and it
  // subsumes overfilled (planned>cap ⇒ demand>cap). A cross-sprint FRAGMENTATION overflow (no skill globally
  // over capacity) is correctly NOT a skill bottleneck — the "leftover gaps" note covers that case.
  const bucketOverDemand = (k) => Math.max(0, (bucketDemandTotal[k] || 0) - (bucketCapacityTotal[k] || 0));

  // ── overflow classification with transitive cascade (PACK-4) + per-bucket reason (skill mode) ──
  const overflow = [];
  const overflowSet = new Set(remaining);
  for (const id of remaining) {
    let reason = sk ? 'bucket_exhausted' : 'capacity_exhausted';
    let rootCause = null;
    for (const b of effectiveBlockers(id)) { // cut edges aren't real blockers (PLAN-01)
      if (!sizedSet.has(b)) { reason = 'blocker_unsized'; rootCause = b; break; }
      if (overflowSet.has(b)) { reason = 'blocker_overflowed'; rootCause = b; break; }
    }
    const row = { id, name: graph.nameOf.get(id), reason, rootCause, rootCauseName: rootCause ? graph.nameOf.get(rootCause) : null };
    if (sk && reason === 'bucket_exhausted') {
      const d = demandOf(id) || {};
      const req = PLAN_BUCKETS.filter((k) => d[k] > EPS);
      // name the genuinely short skill(s): a required bucket whose OWN demand exceeds its OWN capacity (or has
      // zero capacity). NOT bucketUnmet — that over-counts collateral (an idle skill on an atomic feature that
      // overflowed because a SIBLING skill was exhausted would be wrongly named "short").
      let starved = req.filter((k) => bucketOverDemand(k) > EPS || maxBcap[k] <= EPS);
      if (starved.length === 0) starved = req; // pure cross-sprint fragmentation fallback → name all its skills
      row.starvedBuckets = starved;
    }
    overflow.push(row);
  }

  // ── §11 SELF-AUDIT invariant (PACK-8/9): in skill mode a feature must NEVER overflow when a READY sprint
  // had simultaneous room in ALL its required buckets. This channel MUST stay empty if the packer is correct. ──
  const violations = [];
  if (sk) {
    for (const o of overflow) {
      if (o.reason !== 'bucket_exhausted') continue;
      const d = demandOf(o.id) || {};
      const req = PLAN_BUCKETS.filter((k) => d[k] > EPS);
      const readyFrom = effectiveBlockers(o.id).reduce((m, b) => Math.max(m, placedSprint.has(b) ? placedSprint.get(b) : 0), 0);
      const fitSomewhere = sprints.some((sp) => sp.index >= readyFrom && req.every((k) => bcap(k, sp.index) - sp.bucketLoad[k] >= d[k] - EPS));
      if (fitSomewhere) violations.push({ id: o.id, name: o.name, note: 'overflowed but all required buckets had simultaneous room in a ready sprint' });
    }
  }

  // ── utilization / honesty metrics (ledger PACK-5/6, UX-7, CAP-12) ──
  for (const sp of sprints) sp.utilization = sp.capacity > 0 ? sp.load / sp.capacity : 0;
  const totalCapacity = caps.reduce((a, b) => a + b, 0);
  const totalPlanned = sprints.reduce((a, sp) => a + sp.load, 0);
  const overflowPoints = Array.from(remaining).reduce((a, id) => a + (points.get(id) || 0), 0);
  const totalBacklogPoints = queue.reduce((a, id) => a + (points.get(id) || 0), 0);
  const wastedCapacity = sprints.reduce((a, sp) => a + Math.max(0, sp.capacity - sp.load), 0);
  const deficitPoints = Math.max(0, totalBacklogPoints - totalCapacity);
  // empty trailing sprints (PACK-6): contiguous run of load===0 at the tail after a non-empty sprint
  let emptyTrailing = 0;
  for (let i = sprints.length - 1; i >= 0; i--) { if (sprints[i].load === 0) emptyTrailing++; else break; }
  if (emptyTrailing === sprints.length) emptyTrailing = 0; // a fully-empty plan isn't "trailing free capacity"

  // fragmentation signal (UX-7): overflow exists WHILE capacity remains free
  const fragmentation = overflow.length > 0 && wastedCapacity > EPS;

  // per-bucket metrics (skill mode): "BE is the bottleneck; QA has N idle pts" — the Tier-2 payload.
  let bucketMetrics = null;
  if (sk) {
    // a bucket is a bottleneck ONLY if its OWN demand exceeds its OWN capacity (overDemand subsumes the
    // force-placed-over case). Collateral (unplaced demand on an idle skill, blocked behind a sibling skill's
    // shortage) is deliberately NOT a bottleneck — it shows up as idle capacity instead. ⭐ SKILL_BUCKETS only
    // (BE/FE/QA): GEN over-demand is a CLASSIFICATION gap (a feature whose tasks map to no skill), NOT a
    // capacity shortage — flagging "rebalance toward generalist" would contradict the SkillDiagnostics
    // "add task types" advice (§13 gate LOW). GEN's shortfall is surfaced via SkillDiagnostics + the GEN-only
    // overflow reason instead.
    const bottleneck = SKILL_BUCKETS.filter((k) => bucketOverDemand(k) > EPS);
    bucketMetrics = {
      capacity: bucketCapacityTotal,
      planned: bucketPlanned,
      demand: bucketDemandTotal,
      unmet: Object.fromEntries(PLAN_BUCKETS.map((k) => [k, Math.max(0, bucketUnmet(k))])),
      overfilled: Object.fromEntries(PLAN_BUCKETS.map((k) => [k, bucketOverfilled(k)])),
      // overDemand = the GENUINE per-skill shortfall (own demand − own capacity); the honest "N pts beyond
      // capacity" the bottleneck callout shows (NOT unmet, which includes sibling-blocked collateral).
      overDemand: Object.fromEntries(PLAN_BUCKETS.map((k) => [k, bucketOverDemand(k)])),
      // idle = spare capacity in NON-bottleneck skills (the rebalance-FROM targets). Excludes a bottleneck
      // bucket that ALSO has fragmented free capacity, so the callout can never read "short on X" + "X idle".
      idle: PLAN_BUCKETS.filter((k) => bucketCapacityTotal[k] - bucketPlanned[k] > EPS && !bottleneck.includes(k)).map((k) => ({ bucket: k, freePoints: bucketCapacityTotal[k] - bucketPlanned[k] })),
      bottleneckBuckets: bottleneck,
    };
  }

  return {
    sprints,
    overflow,
    oversized,
    sizingIssues: Array.isArray(unsized) ? unsized : [],
    violations, // INVARIANT breaches — stays empty when the packer is correct (self-audit channel, PACK-8/9)
    bucketsActive: !!sk,
    bucketMetrics,
    metrics: {
      totalCapacity,
      totalBacklogPoints,
      totalPlanned,
      overflowPoints,
      overflowCount: overflow.length,
      wastedCapacity,
      deficitPoints,
      utilizationRatio: totalCapacity > 0 ? totalBacklogPoints / totalCapacity : null,
      emptyTrailingSprints: emptyTrailing,
      fragmentation,
    },
  };
}

// ════════════════════════════════════════════════════════════════
// 7.5 PACK BACKLOG REACH  — Kanban v1: a pull-ready ordered backlog cut by a Now/Next/Later reach band
// ════════════════════════════════════════════════════════════════
//
// The Kanban analogue of packSprints (the methodology fork seam in assemblePlan). Kanban has NO sprints and
// NO time-boxes (§0): the plan IS the dependency-legal ranked order, presented as one pull list, cut by a
// THROUGHPUT reach band. We deliberately do NOT build a probabilistic forecaster (Monte Carlo / percentile
// SLEs) — those need flow history the team does not have yet, and faking it is the dishonest path (research
// 2026-06-21). Instead we walk the ALREADY topo-legal order accumulating story points and assign each sized
// feature a confidence TIER:
//   now   = cumulative ≤ conservative reach          (high confidence)
//   next  = conservative < cumulative ≤ optimistic   (stretch — "might fit")
//   later = beyond optimistic                        (explicitly NOT forecast this quarter)
// An item goes `now` only if it FULLY fits under conservative (cumulative-WITH-it ≤ conservative) — the
// straddling item is honestly demoted to `next`. Because the order is dependency-legal (a blocker always
// precedes its dependent) and cumulative points are monotonic, a feature's tier is ALWAYS ≥ its blockers'
// tier → no `now` item ever depends on a `next`/`later` item (dependency-tier consistency is AUTOMATIC; no
// readiness loop needed, unlike packSprints). Honest, never silent: an item bigger than the whole optimistic
// quarter lands in `later` (a real "too big for this quarter" signal, not a force-place), and unsized items
// go to the DISJOINT sizingIssues channel (never fake-fit at 0 points).
//
// @param {string[]} preferenceOrder the dependency-legal order (legal.order from topoSortAndCycles)
// @param {object} band { conservativePoints, optimisticPoints, expectedPointsQuarter }
// @param {object} graph
// @param {Map<string,number>} points sized features only (validateSizing.points)
// @param {Array} unsized from validateSizing
// @returns {object} { now, next, later, sizingIssues, metrics }
export function packBacklogReach(preferenceOrder, band, graph, points, unsized) {
  const conservative = Math.max(0, Number(band && band.conservativePoints) || 0);
  const optimistic = Math.max(conservative, Number(band && band.optimisticPoints) || 0); // optimistic ≥ conservative (guard)
  const sizedSet = new Set(points.keys());
  const queue = (Array.isArray(preferenceOrder) ? preferenceOrder : []).filter((id) => sizedSet.has(id));

  const now = [], next = [], later = [];
  let cumulative = 0;
  for (const id of queue) {
    const p = points.get(id) || 0;
    cumulative += p;
    // C1 (deep-audit): rows carry id/points/cumulative ONLY — NOT name. The FE resolves the display name from
    // record.features via byUid (the single self-describing name source the 2026-06-20/21 reload fix established);
    // a per-row name here would be dead weight in the persisted plan (KVS ~240KB watch) AND a second name source.
    const row = { id, points: p, cumulative };
    if (cumulative <= conservative + EPS) now.push(row);
    else if (cumulative <= optimistic + EPS) next.push(row);
    else later.push(row);
  }

  const sum = (arr) => arr.reduce((a, r) => a + r.points, 0);
  const reachedNowPoints = sum(now);
  const reachedNextPoints = reachedNowPoints + sum(next);
  const beyondReachPoints = sum(later);

  return {
    now, next, later,
    sizingIssues: Array.isArray(unsized) ? unsized : [],
    metrics: {
      totalBacklogPoints: reachedNextPoints + beyondReachPoints,
      expectedPointsQuarter: Math.max(0, Number(band && band.expectedPointsQuarter) || 0),
      conservativePoints: conservative,
      optimisticPoints: optimistic,
      reachedNowPoints,
      reachedNextPoints,
      beyondReachPoints,
      nowCount: now.length,
      nextCount: next.length,
      laterCount: later.length,
    },
  };
}

// ════════════════════════════════════════════════════════════════
// 8. COST PROJECTION  — pre-flight honest estimate for the ranking call (ledger UX-5)
// ════════════════════════════════════════════════════════════════

/**
 * Project the cost of the ONE ranking call BEFORE firing it (mirrors the test-case cost-honesty
 * pattern). The ranking call is small + bounded: one short row per feature in, one short row out.
 * SYNC pricing (not Batches). Returns batch:false USD. The post-run echo (message.usage →
 * estimateCost) is the ground truth shown after the run.
 *
 * @param {object} args { featureCount, avgNameChars?, model? }
 * @returns {{expected_usd:number, upper_usd:number, feature_count:number}}
 */
// MEASURED 2026-06-20 (P12 deep-audit): the ranking SYSTEM prompt is ~2170 tokens (8676 chars — it grew with
// de-risk + spec-wide + the P12 objective paragraph + LESSON E; the old "~1407" was stale) + the GLOBAL §8 USER
// blocks at their caps: spec-summary (≤600 chars ≈150) + spec-wide CONCERNS (≤10×184 ≈460) + the PLANNING
// OBJECTIVE block (≈100) ≈ 2880. 2950 keeps the pre-flight "up to ~$X" a TRUE upper on the input half (PLAN-04).
export const PLAN_SYSTEM_OVERHEAD_TOKENS = 2950;
export const PLAN_INPUT_TOKENS_PER_FEATURE = 110; // EXPECTED input/feature: signals row + the §8 user_story sub-line (clipped)
export const PLAN_INPUT_UPPER_PER_FEATURE = 170; // UPPER input/feature: + unclipped names / dense blocked_by / a long user_story (ceiling must hold)
export const PLAN_OUTPUT_TOKENS_PER_FEATURE = 45; // {feature_id, rank, one-clause rationale}
export const PLAN_OUTPUT_UPPER_PER_FEATURE = 110; // a verbose rationale ceiling

// The max_tokens the ranking call actually permits — the SINGLE source of truth, imported by
// rankFeaturesForPlan (the API cap) AND estimatePlanCost (so the displayed "up to ~$X" upper can
// never sit below what the API may emit → a TRUE ceiling, deep-audit PLAN-04). Keep them in lockstep.
export function planRankingMaxTokens(n) {
  return Math.min(8000, 600 + Math.max(0, Number(n) || 0) * 80);
}

export function estimatePlanCost({ featureCount = 0, model = 'claude-sonnet-4-6' } = {}) {
  const n = Math.max(0, Number(featureCount) || 0);
  if (n === 0) return { expected_usd: 0, upper_usd: 0, feature_count: 0 };
  const isHaiku = String(model).startsWith('claude-haiku');
  const BATCH_FACTOR = 0.5; // the ranking runs on the Batches API = 50% of standard sync pricing (2026-06-20)
  const base = isHaiku ? { input: 1.0, output: 5.0 } : { input: 3.0, output: 15.0 }; // $/Mtok standard
  const rate = { input: base.input * BATCH_FACTOR, output: base.output * BATCH_FACTOR };
  const inputExpected = PLAN_SYSTEM_OVERHEAD_TOKENS + n * PLAN_INPUT_TOKENS_PER_FEATURE;
  // UPPER input has headroom (unclipped names + dense deps + a full user_story) so the displayed "up to ~$X"
  // never sits below the echo over REAL input — the PLAN-04 ceiling must hold on the INPUT half too (gate finding).
  const inputUpper = PLAN_SYSTEM_OVERHEAD_TOKENS + n * PLAN_INPUT_UPPER_PER_FEATURE;
  const expOut = n * PLAN_OUTPUT_TOKENS_PER_FEATURE;
  // upper output = the GREATER of the heuristic and the API's permitted max — so the echo can NEVER exceed
  // the pre-flight "up to" (the ceiling-must-hold policy from the test-case deep audit; PLAN-04).
  const upOut = Math.max(n * PLAN_OUTPUT_UPPER_PER_FEATURE, planRankingMaxTokens(n));
  const usd = (inTok, outTok) => (inTok / 1e6) * rate.input + (outTok / 1e6) * rate.output;
  return { expected_usd: usd(inputExpected, expOut), upper_usd: usd(inputUpper, upOut), feature_count: n };
}

// ════════════════════════════════════════════════════════════════
// 9. SOURCE HASH  — staleness detection across edits (ledger UX-1)
// ════════════════════════════════════════════════════════════════

/**
 * A deterministic hash of the plan-relevant breakdown CONTENT (name + story_points + complexity +
 * priority + sorted dependency-names). Stored at plan time; recompared on entering the Plan screen → a
 * mismatch fires the "this plan is out of date" banner. Pure (FNV-1a 32-bit over a canonical, sorted,
 * delimited projection).
 *
 * ⚠ Deliberately NOT keyed on _uid (live-acceptance fix 2026-06-20): _uid is FE-minted
 * (v3Schema.newStoryUid) and is NOT persisted to the backend breakdown, so every getResults→adapter
 * RELOAD re-mints fresh uids → a uid-keyed hash false-flagged EVERY reload as "out of date". Content is
 * deterministic across the adapter, so a content hash is stable across reload while a real edit (rename /
 * resize / re-prioritize / dependency change / add / remove) still flips it. Only blind spot: a name-swap
 * between two OTHERWISE-IDENTICAL features (negligible — the plan is identical anyway).
 *
 * @param {Array<object>} features
 * @returns {string}
 */
export function planSourceHash(features) {
  const list = Array.isArray(features) ? features : [];
  const rows = list.map((f) => {
    const deps = Array.isArray(f && f.dependencies) ? f.dependencies.slice().sort() : [];
    return [(f && f.name) || '', f && f.story_points, f && f.complexity_score, f && f.priority, deps.join('')].join('');
  });
  rows.sort();
  return fnv1a(rows.join(''));
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

// ════════════════════════════════════════════════════════════════
// 9.5 RISK SIGNALS  — risk-aware sequencing (Tier-1; from the upstream typed concerns + confidence)
// ════════════════════════════════════════════════════════════════
//
// The breakdown already produces per-feature typed concerns "[TYPE|severity] text" + confidence_indicator
// (✓/⚠/✗); v1 DISCARDED them before ranking. This PURE layer reduces them to a compact, decision-grade risk
// descriptor that (a) the ranking LLM reads as SET FLAGS only (never the score / the confidence score / the
// prose — §5/§8) to de-risk-early, and (b) drives a Risk Register + a per-sprint fragile-sprint meter. The
// riskScore + weights + fragile threshold are JUDGMENT encoded as ECHOED, tunable constants (the CAP-3 /
// hoursPerPoint honesty pattern — opaque hand-tuned weights would be a §5 enumerated heuristic AND a §11
// silent failure). ⚠ ADDITIVE ONLY: this NEVER touches the packer / DAG legality / capacity math (DAG-1).

// Severity → base points. Type → multiplier (RISK/EXTERNAL_DEPENDENCY are the load-bearing DELIVERY-risk
// types; AMBIGUITY/TECH_DEBT/ASSUMPTION are quality concerns, weighted low). All TUNABLE judgment, echoed.
export const RISK_SEVERITY_POINTS = { high: 30, medium: 15, low: 6 };
export const RISK_TYPE_WEIGHT = { RISK: 1.0, EXTERNAL_DEPENDENCY: 1.0, AMBIGUITY: 0.4, TECH_DEBT: 0.4, ASSUMPTION: 0.3 };
export const RISK_TYPE_WEIGHT_UNKNOWN = 0.4; // an unrecognized-but-valid-prefix type → a generic low-tier concern (PARSE-3)
export const RISK_UNTYPED_CONCERN_POINTS = 5; // a prefix-LESS concern's mere PRESENCE (carry-forward) counts — never reads as "no concern" (PARSE-1)
export const RISK_COMPLEXITY_POINTS = 8; // per complexity point ABOVE 3 (only 4/5 add risk)
export const RISK_LOW_CONFIDENCE_POINTS = { '⚠': 12, '✗': 25 };
export const FRAGILE_MEAN_RISK = 40; // a sprint's mean riskScore at/above this …
export const FRAGILE_HIGH_RISK_POINT_FRACTION = 0.5; // … AND ≥this share of its points are high-risk …
export const FRAGILE_MIN_HIGH_RISK_FEATURES = 2; // … AND ≥this many high-risk features → fragile (UX-2: a 1-item sprint can't flash)
const RISK_LEVEL_TYPES = new Set(['RISK', 'EXTERNAL_DEPENDENCY']); // only these RAISE risk_level above 'low' (PARSE-2)
const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

/**
 * Parse a "[TYPE|severity] text" concern prefix. Mirrors v3Schema.parseConcernPrefix (self-contained —
 * planner.js imports nothing). Returns {type, severity} for a typed concern, or null for a prefix-less one
 * (the carry-forward case) — which the caller counts as an UNTYPED concern, never as "no concern" (PARSE-1).
 */
export function parseConcernType(raw) {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^\s*\[([A-Z_]+)\|(high|medium|low)\]/i);
  if (!m) return null;
  return { type: m[1].toUpperCase(), severity: m[2].toLowerCase() };
}

/**
 * Per-feature risk descriptor from the upstream concerns + confidence + complexity. PURE + deterministic
 * (no Date/random/order dependence) so a free re-pack never flickers the meter. Returns Map(id → descriptor).
 * @param {Array} features
 * @param {(f:object,i:number)=>string} idOf  the SAME canonical id the graph uses (graph.idByIndex — IR-3)
 */
export function computeRiskSignals(features, idOf) {
  const list = Array.isArray(features) ? features : [];
  const out = new Map();
  list.forEach((f, i) => {
    const id = idOf(f, i);
    const concerns = Array.isArray(f && f.concerns) ? f.concerns.filter((c) => typeof c === 'string' && c.trim()) : [];
    let score = 0, levelSev = 0, typedCount = 0, untypedCount = 0;
    let hasExternalDep = false;
    for (const raw of concerns) {
      const p = parseConcernType(raw);
      if (!p) { score += RISK_UNTYPED_CONCERN_POINTS; untypedCount += 1; continue; } // PARSE-1: presence counts, type unknown
      typedCount += 1;
      const sevPts = RISK_SEVERITY_POINTS[p.severity] || 0;
      const typeW = Object.prototype.hasOwnProperty.call(RISK_TYPE_WEIGHT, p.type) ? RISK_TYPE_WEIGHT[p.type] : RISK_TYPE_WEIGHT_UNKNOWN;
      score += sevPts * typeW;
      if (RISK_LEVEL_TYPES.has(p.type)) levelSev = Math.max(levelSev, SEVERITY_RANK[p.severity] || 0);
      if (p.type === 'EXTERNAL_DEPENDENCY') hasExternalDep = true;
    }
    const cx = Number(f && f.complexity_score);
    if (Number.isFinite(cx) && cx > 3) score += (cx - 3) * RISK_COMPLEXITY_POINTS; // only 4/5 add
    const glyph = f && f.confidence_indicator;
    const lowConfidence = glyph === '⚠' || glyph === '✗';
    if (lowConfidence) score += RISK_LOW_CONFIDENCE_POINTS[glyph] || 0;

    score = Math.max(0, Math.min(100, score)); // clamp; never NaN/Infinity (PARSE-4)
    let risk_level = 'none';
    if (levelSev >= 3) risk_level = 'high';
    else if (levelSev === 2) risk_level = 'medium';
    else if (levelSev === 1 || typedCount || untypedCount || lowConfidence || (Number.isFinite(cx) && cx > 3)) risk_level = 'low'; // floor: any signal → at least 'low'

    out.set(id, { risk_level, has_external_dep: hasExternalDep, low_confidence: lowConfidence, riskScore: score, typedConcernCount: typedCount, untypedConcernCount: untypedCount });
  });
  return out;
}

/**
 * Per-sprint risk profile, index-aligned 1:1 with `sprints` (UX-1: an empty/trailing sprint → a zero,
 * non-fragile profile, never omitted). `fragile` needs real substance (UX-2: ≥FRAGILE_MIN_HIGH_RISK
 * features AND a high mean AND a high-risk POINT share) so a 1-item sprint can't flash fragile, and it
 * guards divide-by-zero on an empty sprint. Pure aggregation over riskByFeature — NO LLM.
 */
export function computeSprintRiskProfile(sprints, riskByFeature, points) {
  const sp = Array.isArray(sprints) ? sprints : [];
  const risk = riskByFeature instanceof Map ? riskByFeature : new Map();
  return sp.map((s) => {
    const ids = Array.isArray(s && s.ids) ? s.ids : [];
    let sumRisk = 0, highRiskCount = 0, externalDepCount = 0, lowConfidenceCount = 0, highRiskPoints = 0, totalPoints = 0;
    for (const id of ids) {
      const r = risk.get(id) || { risk_level: 'none', riskScore: 0, has_external_dep: false, low_confidence: false };
      const pts = (points && points.get(id)) || 0;
      sumRisk += r.riskScore;
      totalPoints += pts;
      if (r.risk_level === 'high') { highRiskCount += 1; highRiskPoints += pts; }
      if (r.has_external_dep) externalDepCount += 1;
      if (r.low_confidence) lowConfidenceCount += 1;
    }
    const meanRisk = ids.length ? sumRisk / ids.length : 0;
    const highRiskPointFraction = totalPoints > EPS ? highRiskPoints / totalPoints : 0;
    const fragile = totalPoints > EPS && meanRisk >= FRAGILE_MEAN_RISK && highRiskCount >= FRAGILE_MIN_HIGH_RISK_FEATURES && highRiskPointFraction >= FRAGILE_HIGH_RISK_POINT_FRACTION;
    return { meanRisk, highRiskCount, externalDepCount, lowConfidenceCount, featureCount: ids.length, highRiskPointFraction, fragile };
  });
}

/**
 * Spec-WIDE concern summary (SN-3): spec_concerns are NOT per-feature, so they surface as a single
 * PLAN-level band (compliance counted ONCE), never machine-attributed onto a feature. Pure.
 */
export function summarizeSpecConcerns(specConcerns) {
  const arr = Array.isArray(specConcerns) ? specConcerns.filter((c) => typeof c === 'string' && c.trim()) : [];
  // count compliance over the FULL list (gate LOW: counting inside slice(0,25) under-reports the band
  // headline if a caller ever exceeds the cap; `total` is already arr.length, so keep them consistent).
  let complianceCount = 0;
  for (const raw of arr) { const p = parseConcernType(raw); if (p && p.type === 'COMPLIANCE') complianceCount += 1; }
  const items = arr.slice(0, 25).map((raw) => {
    const p = parseConcernType(raw);
    return { type: p ? p.type : 'NOTE', severity: p ? p.severity : 'medium', text: raw.replace(/^\s*\[[^\]]*\]\s*/, '').slice(0, 220) };
  });
  return { total: arr.length, complianceCount, items };
}

// ════════════════════════════════════════════════════════════════
// 10. ORCHESTRATOR  — compose the pure layers into a plan (LLM ranking injected by the caller)
// ════════════════════════════════════════════════════════════════

/**
 * Deterministic rank helpers from the breakdown fields (lower = higher).
 */
const PRIORITY_ORDER = { High: 0, Medium: 1, Low: 2 };
export function priorityRankOf(f) { return PRIORITY_ORDER[f && f.priority] ?? 1; }
export function complexityRankOf(f) { const c = Number(f && f.complexity_score); return Number.isFinite(c) ? -c : 0; } // higher complexity first

/**
 * Build the per-feature INPUT rows for the ranking LLM (the §8 informational contract). Each row
 * carries id/name/SP/complexity/priority/direct-blocker-names + the PRE-COMPUTED signals, so the
 * model never re-derives a number a pure fn already produced (ledger LLM-6). Unsized features are
 * marked so the model doesn't treat them as zero-cost.
 */
export function buildRankingRows(graph, signals, points, riskByFeature) {
  const risk = riskByFeature instanceof Map ? riskByFeature : new Map();
  return graph.ids.map((id) => {
    const f = graph.byId.get(id) || {};
    const s = signals.get(id) || {};
    // blocked_by carries each blocker's ID (+ name for readability) — the model MUST answer in id-space
    // (feature_id), so its dependency constraint is expressed in the SAME key it outputs (ledger LLM/§8
    // identifier consistency): no fragile name→id hop, robust to duplicate / delimiter-bearing names.
    const blockedBy = Array.from(graph.blockers.get(id) || []).map((b) => ({ id: b, name: graph.nameOf.get(b) || '' }));
    // COMPACT risk SET-FLAGS only (SN-1/SN-2): risk_level at high/medium (omit low/none), external_dep,
    // low_confidence — NEVER the 0-100 riskScore / confidence score / concern prose (those drift §4 + are §8 noise).
    const rf = risk.get(id);
    const risk_flags = [];
    if (rf) {
      if (rf.risk_level === 'high' || rf.risk_level === 'medium') risk_flags.push(`risk:${rf.risk_level}`);
      if (rf.has_external_dep) risk_flags.push('external_dep');
      if (rf.low_confidence) risk_flags.push('low_confidence');
    }
    return {
      feature_id: id,
      name: graph.nameOf.get(id) || '',
      story_points: points.has(id) ? points.get(id) : null,
      unsized: !points.has(id),
      complexity_score: Number.isFinite(Number(f.complexity_score)) ? Number(f.complexity_score) : null,
      priority: f.priority || null,
      user_story: typeof f.user_story === 'string' && f.user_story.trim() ? f.user_story.trim() : null, // §8: the WHY, for business-value weighing
      blocked_by: blockedBy,
      critical_path_length: s.criticalPathLen ?? null,
      downstream_unblock_count: s.downstreamUnblockCount ?? null,
      slack: s.slack ?? null,
      risk_flags, // §8: only the set flags (usually empty) — the de-risk-early tiebreak input
    };
  });
}

/**
 * Compose a full plan from a validated capacity result + the breakdown features + an (optional)
 * LLM ranking. Pure end-to-end EXCEPT the ranking is computed by the caller (LLM) and passed in;
 * when ranking is null/empty the deterministic fallback order is used and `usedLlm:false` is
 * reported. This is the single entry point the resolver calls after computeCapacity succeeds and
 * (optionally) the LLM returns.
 *
 * @param {object} args { features, capacity (computeCapacity result), ranking (LLM output | null) }
 * @returns {object} { graph signals + diagnostics, preferenceOrder meta, packed plan }
 */
export function assemblePlan({ features, capacity, ranking, specConcerns, precomputedRisk, methodology }) {
  const isKanban = methodology === 'kanban';
  const graph = buildPlannerGraph(features);
  // sizing keyed by the EXACT id the graph assigned per POSITION (graph.idByIndex) — never indexOf
  // (which collapses a duplicate object ref + is O(n²)). One id source of truth across both layers.
  const sizing = validateSizing(features, (f, i) => graph.idByIndex[i]);

  const prRank = (id) => priorityRankOf(graph.byId.get(id) || {});
  const cxRank = (id) => complexityRankOf(graph.byId.get(id) || {});

  const baseTopo = topoSortAndCycles(graph, () => 0, prRank); // base acyclic order for signals (no LLM pref yet)
  const signals = computeSchedulingSignals(graph, baseTopo.order);
  // The single longest dependency chain (the "critical path"), derived from the SAME order/signals so it stays
  // consistent with the per-chip criticalPathLen. Excludes cut soft-cycle edges by construction; [] when there
  // is no chain of length >= 2. Methodology-agnostic → returned on BOTH Scrum + Kanban plans (below).
  const criticalPathUids = computeCriticalPathUids(graph, baseTopo.order, signals);

  const norm = normalizeRanking(ranking, graph, signals, prRank, cxRank);
  // re-derive the legal order honouring the LLM preference as the ready-tiebreak (ledger GRAPH-8)
  const prefPos = new Map(norm.preferenceOrder.map((id, i) => [id, i]));
  const prefRank = (id) => (prefPos.has(id) ? prefPos.get(id) : Number.MAX_SAFE_INTEGER);
  const legal = topoSortAndCycles(graph, prefRank, prRank);

  // SKILL-AWARE layer (Tier-2): derive each sized feature's per-bucket demand from its task types, and —
  // when the capacity is bucketed (the user tagged skills + no override) — pack per-bucket so a feature can
  // overflow for lack of BE while QA sits idle (the honest "can my team deliver this?" answer). The skill
  // split is keyed on graph.idByIndex (sizing parity). Pure; NO LLM (the task-type enum already classifies).
  const skill = featureSkillSplit(features, (f, i) => graph.idByIndex[i], sizing.points);
  // ⭐ METHODOLOGY FORK (POLICY §3.5 — a sibling pack fn, NOT a flag inside packSprints): everything ABOVE this
  // line (graph / sizing / signals / ranking / legal order / skill split) is methodology-agnostic. Kanban produces
  // a Now/Next/Later reach band over the SAME dependency-legal order; Scrum packs into capacity-bounded sprints.
  let packed;
  if (isKanban) {
    packed = packBacklogReach(legal.order,
      { conservativePoints: capacity.conservativePoints, optimisticPoints: capacity.optimisticPoints, expectedPointsQuarter: capacity.expectedPointsQuarter },
      graph, sizing.points, sizing.unsized);
  } else {
    // skill-aware capacity is a Scrum-only concept in v1 (Kanban is pooled); cut edges keep the readiness gate honest (PLAN-01)
    const bucketCtx = capacity && capacity.bucketsActive
      ? { demand: skill.demand, bucketCaps: capacity.perSprintBucketCapacity }
      : undefined;
    packed = packSprints(legal.order, capacity.perSprintCapacityPoints, graph, sizing.points, sizing.unsized, legal.cutEdges, bucketCtx);
  }

  // RISK-AWARE layer (Tier-1) — ADDITIVE post-pass: keyed on graph.idByIndex (dup-_uid '#i' safe — IR-3),
  // computed AFTER packing, NEVER touching the packer / DAG legality / capacity (DAG-1). riskByFeature +
  // sprintRiskProfiles are SIBLING keys returned AFTER ...packed so a name collision is impossible (IR-1).
  // ⭐ per-feature risk + the spec-wide summary are computed ONCE at startPlan (from the upstream concerns);
  // those concerns are then DROPPED from the persisted records to keep them under the ~240KB KVS value cap
  // (gate HIGH 2026-06-20 — 300 feats × concerns ≈ 816KB → silent persist loss). finalize / re-pack pass
  // the COMPACT precomputedRisk back in; only sprintRiskProfiles is re-derived (it depends on THIS packing).
  const riskByFeature = precomputedRisk && precomputedRisk.riskByFeature
    ? (precomputedRisk.riskByFeature instanceof Map ? precomputedRisk.riskByFeature : new Map(Object.entries(precomputedRisk.riskByFeature)))
    : computeRiskSignals(features, (f, i) => graph.idByIndex[i]);
  // Kanban has no sprints → no per-sprint fragile-meter in v1 (a backlog-segment risk profile is deferred v2);
  // per-feature risk still flows through riskByFeature + the Risk Register, which do NOT depend on sprints.
  const sprintRiskProfiles = isKanban ? [] : computeSprintRiskProfile(packed.sprints, riskByFeature, sizing.points);
  const specConcernSummary = (precomputedRisk && precomputedRisk.specConcernSummary)
    ? precomputedRisk.specConcernSummary
    : summarizeSpecConcerns(specConcerns); // spec-WIDE band, never per-feature (SN-3)

  return {
    methodology: isKanban ? 'kanban' : 'scrum',
    graph: {
      danglingRefs: graph.danglingRefs,
      ambiguousDeps: graph.ambiguousDeps,
      selfDeps: graph.selfDeps,
      duplicateNames: graph.duplicateNames,
      duplicateUids: graph.duplicateUids,
      cyclicNodes: legal.cyclicNodes,
      cutEdges: legal.cutEdges,
    },
    signals: Object.fromEntries(signals),
    criticalPathUids, // the single longest dependency chain (root→end uids); [] when there's no chain >= 2
    ranking: { usedLlm: norm.usedLlm, unknownIds: norm.unknownIds, duplicateIds: norm.duplicateIds, omittedCount: norm.omittedIds.length },
    ...packed,
    riskByFeature: Object.fromEntries(riskByFeature),
    sprintRiskProfiles,
    specConcernSummary,
    // Tier-2 skill diagnostics — DISJOINT typed channels (never silent): a sized feature with no
    // recognizable skill (its points went to the generalist pool) + any task type outside the enum.
    skillDiagnostics: { unclassified: skill.unclassified, unknownTaskTypes: skill.unknownTaskTypes },
  };
}

// ════════════════════════════════════════════════════════════════
// 11. WHAT-IF DIFF  — P20 free scenarios (a PURE diff over two assemblePlan outputs; no LLM, no spend)
// ════════════════════════════════════════════════════════════════
//
// A what-if explores the consequences of a quantity/scope change (add a sprint / lower focus / defer a
// feature) under the SAME frozen ranking → it is pure scheduling arithmetic the planner already owns
// (assemblePlan over the cached ranking, the free repackPlan path). This diff compares the BASELINE plan
// to a SCENARIO plan and reports what changed. Honesty: a deferred feature (absent from the scenario set)
// goes in its OWN disjoint `deferred` channel — NEVER counted as "newly overflows" (it wasn't dropped for
// lack of capacity; the user removed it). Pure set/number ops → stable, no flicker, node-testable.
export function diffPlans(baseline, scenario) {
  const b = baseline && typeof baseline === 'object' ? baseline : {};
  const s = scenario && typeof scenario === 'object' ? scenario : {};
  const sprintOf = (plan) => {
    const m = new Map();
    (Array.isArray(plan.sprints) ? plan.sprints : []).forEach((sp, i) => (Array.isArray(sp && sp.ids) ? sp.ids : []).forEach((id) => m.set(id, i + 1)));
    return m;
  };
  const overflowSet = (plan) => new Set((Array.isArray(plan.overflow) ? plan.overflow : []).map((o) => o && o.id).filter((x) => x != null));
  // carry the FULL overflow row (not just the reason) so newlyOverflows keeps starvedBuckets + rootCauseName
  // → the what-if "No longer fits" can say "not enough backend capacity" / "blocked by X", never the
  // grammar-broken "not enough a skill capacity" / "blocked by undefined" (live-found 2026-06-20).
  const scenarioOverflowRow = (plan) => {
    const m = new Map();
    (Array.isArray(plan.overflow) ? plan.overflow : []).forEach((o) => { if (o && o.id != null) m.set(o.id, o); });
    return m;
  };
  const bSprint = sprintOf(b), sSprint = sprintOf(s);
  const bOver = overflowSet(b), sOver = overflowSet(s);
  const sOverRow = scenarioOverflowRow(s);
  const bUniverse = new Set([...bSprint.keys(), ...bOver]);
  const sUniverse = new Set([...sSprint.keys(), ...sOver]);

  const deferred = [], newlyFits = [], newlyOverflows = [], moved = [];
  for (const id of bUniverse) {
    if (!sUniverse.has(id)) { deferred.push({ id }); continue; } // absent from scenario = DEFERRED (disjoint channel)
    const bIn = bSprint.has(id), sIn = sSprint.has(id);
    if (!bIn && sIn) newlyFits.push({ id, sprint: sSprint.get(id) });           // was overflow → now placed
    else if (bIn && !sIn) { // was placed → now overflow; keep the full typed reason for an honest "why"
      const r = sOverRow.get(id) || {};
      newlyOverflows.push({ id, reason: r.reason || 'capacity_exhausted', starvedBuckets: r.starvedBuckets, rootCause: r.rootCause, rootCauseName: r.rootCauseName });
    }
    else if (bIn && sIn && bSprint.get(id) !== sSprint.get(id)) moved.push({ id, from: bSprint.get(id), to: sSprint.get(id) });
  }

  const bm = b.metrics || {}, sm = s.metrics || {};
  const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  const fragileCount = (plan) => (Array.isArray(plan.sprintRiskProfiles) ? plan.sprintRiskProfiles.filter((p) => p && p.fragile).length : 0);

  // Tier-2: the scenario's per-skill shortfall (overflowed demand + force-placed-over capacity) — the honest
  // explanation for WHY features overflow in skill mode even when the SCALAR deficit is unchanged (a specific
  // skill bucket is the binding constraint, while idle QA/generalist capacity pads the scalar total).
  const sbm = s.bucketMetrics || null;
  // the GENUINE per-skill shortfall (own demand − own capacity); honest like the main bottleneck callout. Falls
  // back to unmet+overfilled for a legacy scenario bucketMetrics that predates overDemand (back-compat).
  const bucketShortfall = sbm
    ? PLAN_BUCKETS.map((k) => ({
      bucket: k,
      shortfall: (sbm.overDemand && typeof sbm.overDemand[k] === 'number')
        ? sbm.overDemand[k]
        : (((sbm.unmet && sbm.unmet[k]) || 0) + ((sbm.overfilled && sbm.overfilled[k]) || 0)),
    })).filter((x) => x.shortfall > EPS)
    : [];

  // §11 honesty (gate finding): deferring a feature that BLOCKS a kept one orphans the kept feature's
  // dependency → it goes DANGLING (treated as unblocked) and slides earlier. That's a real consequence the
  // user must SEE, not a free win. Report the dangling refs the scenario introduced (absent in baseline).
  const danglingKey = (d) => `${d && d.name}${d && d.missingDep}`;
  const bDangling = new Set((b.graph && Array.isArray(b.graph.danglingRefs) ? b.graph.danglingRefs : []).map(danglingKey));
  const newlyDangling = (s.graph && Array.isArray(s.graph.danglingRefs) ? s.graph.danglingRefs : []).filter((d) => !bDangling.has(danglingKey(d)));

  return {
    sprintCountDelta: (Array.isArray(s.sprints) ? s.sprints.length : 0) - (Array.isArray(b.sprints) ? b.sprints.length : 0),
    capacityDelta: num(sm.totalCapacity) - num(bm.totalCapacity),
    deficitDelta: num(sm.deficitPoints) - num(bm.deficitPoints),
    overflowCountDelta: num(sm.overflowCount) - num(bm.overflowCount),
    wastedDelta: num(sm.wastedCapacity) - num(bm.wastedCapacity),
    newlyFits, newlyOverflows, moved, deferred, newlyDangling, bucketShortfall,
    fragileBaseline: fragileCount(b), fragileScenario: fragileCount(s), fragileDelta: fragileCount(s) - fragileCount(b),
  };
}
