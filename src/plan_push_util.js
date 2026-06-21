// plan_push_util.js — PURE helpers for P15 (Push plan to Jira). No @forge imports → node-testable
// (prototype/test_plan_push.mjs). §4 dispatch: the feature→sprint→Jira-key mapping is deterministic
// structure (no meaning-reading) — it belongs here, separate from the Jira-calling code in push_handler.js.

// Deterministic sprint name — idempotent: a re-push matches by exact name → reuse, never duplicate.
// ⚠ Jira caps a sprint name at < 30 characters (TEAM-MANAGED projects ENFORCE it — live-acceptance 2026-06-21:
// POST /sprint → HTTP 400 "Sprint name must be shorter than 30 characters"). Keep "Sprint N" intact (the number
// IS the sprint's identity) and truncate the PREFIX to fit ≤ 29. Idempotent: the SAME prefix+N always builds
// the SAME name → reuse, never duplicate. (Same N → same suffix length → same prefix budget → same truncation.)
export function sprintPushName(prefix, n) {
  const suffix = ` · Sprint ${n}`;
  const MAX = 29; // strictly < 30
  const budget = MAX - suffix.length;
  const raw = (typeof prefix === 'string' && prefix.trim()) ? prefix.trim() : 'AI Plan';
  const head = budget > 0 ? raw.slice(0, budget).trim() : '';
  return head ? `${head}${suffix}` : `Sprint ${n}`.slice(0, MAX);
}

// A sprint's calendar date range as ISO datetimes (best-effort; null when no/invalid start date). Built from
// UTC date PARTS (not `new Date('yyyy-mm-dd')`) so it's deterministic + offset-stable, like planView.sprintDates.
export function sprintDateRangeISO(startDate, n, lengthDays) {
  if (!startDate) return { startDate: null, endDate: null };
  const parts = String(startDate).split('-');
  if (parts.length !== 3) return { startDate: null, endDate: null };
  const base = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  if (isNaN(base.getTime())) return { startDate: null, endDate: null };
  const len = Number(lengthDays) || 10;
  const start = new Date(base.getTime()); start.setUTCDate(start.getUTCDate() + (n - 1) * len);
  const end = new Date(start.getTime()); end.setUTCDate(end.getUTCDate() + len - 1);
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

// Compose plan(uid->sprintIndex) o push(uid->JiraKey) -> groups of Jira keys per OCCUPIED sprint.
//   noJiraKey  = planned features with no created Story (never pushed / push failed)
//   overflowed = features the plan couldn't fit (not in any sprint)
// Both are DISJOINT honesty channels, never silently dropped (§11). The join is uid-keyed (rename-proof,
// the Task #3 lesson) — the push must stamp `uid` onto each created issue for this to work.
export function buildSprintPushPlan(plan, createdIssues, opts = {}) {
  const keyByUid = new Map();
  for (const ci of (Array.isArray(createdIssues) ? createdIssues : [])) {
    if (ci && ci.uid && ci.key) keyByUid.set(ci.uid, ci.key);
  }
  const sprints = Array.isArray(plan && plan.sprints) ? plan.sprints : [];
  const groups = [];
  const noJiraKey = [];
  sprints.forEach((sp, i) => {
    const ids = Array.isArray(sp && sp.ids) ? sp.ids : [];
    const keys = [];
    for (const uid of ids) {
      const key = keyByUid.get(uid);
      if (key) keys.push(key); else noJiraKey.push(uid);
    }
    if (keys.length) {
      const range = sprintDateRangeISO(opts.sprintStartDate, i + 1, opts.sprintLengthDays);
      groups.push({ sprintIndex: i, number: i + 1, name: sprintPushName(opts.namePrefix, i + 1), startDate: range.startDate, endDate: range.endDate, keys, sprintId: null, assignCursor: 0 });
    }
  });
  const overflowed = (Array.isArray(plan && plan.overflow) ? plan.overflow : []).map((o) => o && o.id).filter(Boolean);
  return { groups, noJiraKey, overflowed };
}

// ════════════════════════════════════════════════════════════════
// KANBAN PUSH (P15-kanban) — rank the backlog to the plan order + tier labels. PURE (node-testable).
// ════════════════════════════════════════════════════════════════
// Kanban has NO sprints — the plan IS the ordered backlog (now → next → later, pull from the top). The push
// RANKS the Jira backlog to that order (PUT /rest/agile/1.0/issue/rank — the GLOBAL Rank, never the per-instance
// Rank custom field, gotcha #7) + tags each issue with its reach tier. §4: 100% deterministic from the plan →
// the mapping lives here as pure functions; the Jira-calling code is in push_handler.js. (The one LLM call —
// advisory ranking — already happened upstream in assemblePlan.)

export const RANK_BATCH_MAX = 50; // Agile rank API: max 50 issue keys per /issue/rank call
export const TIER_LABELS = { now: 'plan-now', next: 'plan-next', later: 'plan-later' }; // namespaced → no collision with user labels

// Compose plan(now/next/later uid order) ∘ push(uid→JiraKey) → the ordered Jira-key pull list + per-tier key
// groups (for labels) + the DISJOINT noJiraKey honesty channel (§11). uid-keyed (rename-proof, the Task #3
// lesson). The tiers are disjoint by construction (packBacklogReach assigns each feature to ONE tier), so
// orderedKeys carries no duplicates.
export function buildKanbanRankPlan(plan, createdIssues) {
  const keyByUid = new Map();
  for (const ci of (Array.isArray(createdIssues) ? createdIssues : [])) {
    if (ci && ci.uid && ci.key) keyByUid.set(ci.uid, ci.key);
  }
  const orderedKeys = [];
  const tiers = { now: [], next: [], later: [] };
  const noJiraKey = [];
  for (const t of ['now', 'next', 'later']) {
    const rows = Array.isArray(plan && plan[t]) ? plan[t] : [];
    for (const row of rows) {
      const uid = row && row.id;
      if (!uid) continue;
      const key = keyByUid.get(uid);
      if (key) { orderedKeys.push(key); tiers[t].push(key); }
      else noJiraKey.push(uid);
    }
  }
  return { orderedKeys, tiers, noJiraKey };
}

// Batch the ordered pull list into ≤50-issue rank ops, each chained AFTER the previous batch's last key, so the
// final backlog rank == the plan order (orderedKeys[0] highest = pulled first). Batch 1 anchors after
// orderedKeys[0] (which keeps its position; the planned block stays cohesive + ordered). Idempotent: the same
// order yields the same ops → a re-push re-imposes the plan order (no dupes; rank is a MOVE, not a create).
// ⚠ before/after POLARITY is a §9 LIVE-ONLY correctness check (inverted = the whole plan silently reversed) →
// the offline test asserts the ABSOLUTE resulting sequence, and live-acceptance must eyeball top-of-backlog == now[0].
export function buildRankBatches(orderedKeys) {
  const keys = (Array.isArray(orderedKeys) ? orderedKeys : []).filter(Boolean);
  const batches = [];
  if (keys.length < 2) return batches; // 0 or 1 issue: nothing to re-order
  let anchor = keys[0];
  let i = 1;
  while (i < keys.length) {
    const chunk = keys.slice(i, i + RANK_BATCH_MAX);
    batches.push({ issues: chunk, rankAfterIssue: anchor });
    anchor = chunk[chunk.length - 1];
    i += chunk.length;
  }
  return batches;
}

// Per-issue tier-label ops (idempotent): ADD the issue's plan-tier label + REMOVE the other two, so a re-tiered
// issue (e.g. Now → Next on a re-push) never carries two tier labels. Jira's add/remove update verbs make
// removing an absent label a no-op, so this is safe to re-apply.
export function buildTierLabelOps(tiers) {
  const all = Object.values(TIER_LABELS);
  const ops = [];
  for (const t of ['now', 'next', 'later']) {
    const mine = TIER_LABELS[t];
    const labels = [{ add: mine }, ...all.filter((l) => l !== mine).map((l) => ({ remove: l }))];
    for (const key of (Array.isArray(tiers && tiers[t]) ? tiers[t] : [])) {
      ops.push({ key, labels });
    }
  }
  return ops;
}
