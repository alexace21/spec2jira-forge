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
