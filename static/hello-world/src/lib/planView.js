// planView.js — SHARED pure view-derivations for the Capacity-Sheet Planner.
//
// WHY THIS EXISTS (§13 gate HIGH "BRIEF-DRIFT"): PlanScreen.jsx renders the plan and the Defensible
// Plan Brief (lib/planBrief.js) re-states the SAME facts (the capacity verdict, the typed overflow
// reasons, the risk register, the risk reasons). If those derivations were copy-pasted, the two would
// drift and a stakeholder would get two different stories from one plan — which destroys "defensible".
// So every derivation that BOTH surfaces use lives HERE, once, and both import it. Pure + framework-free
// (no React) → node-testable like src/planner.js. The backend csvCell/toCSV (src/testcases.js) can't be
// imported into the CRA bundle (separate build root + ModuleScopePlugin), so the hardened CSV guard is
// ported here verbatim (BRIEF-CSV-RUNTIME) — keep the formula-injection neutralization IDENTICAL.

// ── formatting ──────────────────────────────────────────────────────────────
export const fmt1 = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 10) / 10 : n);
export const fmtUsd = (n) => { const v = Number(n) || 0; return `$${v.toFixed(v < 1 ? 3 : 2)}`; };

// Deterministic sprint date label (local-midnight-safe; '' when no/invalid start date). PLAN-09: parse
// the ISO date from PARTS, never `new Date('yyyy-mm-dd')` (that's UTC midnight → one day early west of UTC).
export function sprintDates(startDate, number, lengthDays) {
  if (!startDate) return "";
  const parts = String(startDate).split("-");
  if (parts.length !== 3) return "";
  const start = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(start.getTime())) return "";
  const len = Number(lengthDays) || 10;
  const s = new Date(start.getTime());
  s.setDate(s.getDate() + (number - 1) * len);
  const e = new Date(s.getTime());
  e.setDate(e.getDate() + len - 1);
  const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(s)} – ${fmt(e)}`;
}

// ── risk descriptor → human reasons (a11y: icon kind + text, never colour-alone) ──
export function riskReasons(d) {
  if (!d) return [];
  const out = [];
  if (d.risk_level === "high") out.push({ kind: "error", text: "High delivery risk" });
  else if (d.risk_level === "medium") out.push({ kind: "warning", text: "Medium delivery risk" });
  if (d.has_external_dep) out.push({ kind: "warning", text: "External dependency" });
  if (d.low_confidence) out.push({ kind: "info", text: "Low spec confidence" });
  return out;
}
export function isRiskFlagged(d) {
  return !!d && (d.risk_level === "high" || d.risk_level === "medium" || d.has_external_dep || d.low_confidence);
}

// The Risk Register membership + sort + WHERE-tagging — the SINGLE derivation both the screen panel and
// the brief use (so they can never list different features). `nameOf(id)` resolves the display name (the
// caller owns the uid→name map). Default-GUARDED: a plan cached before the Tier-1 risk layer (no
// riskByFeature) yields []. Bounded so a huge backlog can't produce an endless register.
//
// WHERE-tag (the single noun-source, task-5): a Scrum plan tags each entry with its `sprint` number (1-based).
// A Kanban plan has NO sprints → it tags each entry with its reach `tier` (Now/Next/Later) instead. We change
// the noun HERE, once, so a consumer never has to re-derive "Sprint N" vs "Now" (which would reintroduce drift).
// Both shapes are returned: `sprint` (number|null) and `tier` (string|null) — a consumer reads whichever is set.
export function buildRiskRegister(plan, nameOf, limit = 12) {
  if (!plan || !plan.riskByFeature) return [];
  const isKanban = plan.methodology === "kanban";
  // Scrum: id → sprint number. Kanban: id → reach tier label (the now/next/later band membership).
  const sprintOf = new Map();
  const tierOf = new Map();
  if (isKanban) {
    const TIER = [["now", "Now"], ["next", "Next"], ["later", "Later"]];
    TIER.forEach(([key, label]) => (Array.isArray(plan[key]) ? plan[key] : []).forEach((row) => { if (row && row.id != null) tierOf.set(row.id, label); }));
  } else {
    (plan.sprints || []).forEach((s, i) => (Array.isArray(s && s.ids) ? s.ids : []).forEach((id) => sprintOf.set(id, i + 1)));
  }
  return Object.entries(plan.riskByFeature)
    .map(([id, d]) => ({ id, ...d }))
    .filter(isRiskFlagged)
    .sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0))
    .slice(0, limit)
    .map((e) => ({
      ...e,
      sprint: isKanban ? null : (sprintOf.get(e.id) || null),
      tier: isKanban ? (tierOf.get(e.id) || null) : null,
      name: (typeof nameOf === "function" && nameOf(e.id)) || e.id,
    }));
}

// The register's WHERE-label (the single noun-source, task-5): "Sprint N" for Scrum, the reach tier for
// Kanban, "Beyond reach" / "Doesn't fit" when a flagged feature isn't placed. The screen + brief both call
// this so they can never disagree on the noun (BRIEF-DRIFT). `kanban` true ⇒ never say "Sprint".
export function registerWhereLabel(entry, kanban) {
  if (!entry) return "";
  if (kanban) return entry.tier || "Beyond reach";
  return entry.sprint ? `Sprint ${entry.sprint}` : "Doesn’t fit";
}

// Tier-2 skill labels (the internal BE/FE/QA/GEN bucket → the user-facing word). Shared so the screen + brief agree.
export const SKILL_LABEL = { BE: "backend", FE: "frontend", QA: "QA", GEN: "generalist" };
export const skillLabel = (k) => SKILL_LABEL[k] || k;

// ── the typed overflow reason → the DEFENSIBLE plain-English "why" (no leading dash; caller frames it) ──
export function overflowReasonText(o, nameOf) {
  if (!o) return "no capacity left";
  if (o.reason === "blocker_overflowed") return `blocked by “${o.rootCauseName || (typeof nameOf === "function" ? nameOf(o.rootCause) : o.rootCause)}” which didn’t fit`;
  if (o.reason === "blocker_unsized") return "blocked by an unsized feature";
  if (o.reason === "bucket_exhausted") {
    const sb = Array.isArray(o.starvedBuckets) ? o.starvedBuckets : [];
    // GEN-only starvation = the feature had no recognizable skill (not a real "generalist shortage") →
    // point at classification, not capacity (avoids "not enough generalist capacity" on a no-generalist team).
    if (sb.length === 1 && sb[0] === "GEN") return "its skill couldn’t be determined — add task types";
    const b = sb.length ? sb.map(skillLabel).join(" + ") : "a skill";
    return `not enough ${b} capacity`;
  }
  return "no capacity left";
}

// The oversized "why" — the CONCRETE by-how-much. SHARED so the on-screen panel, the step-5 block AND the copy-out
// brief read the SAME string (BRIEF-DRIFT); mirrors overflowReasonText (no leading dash; the caller frames it).
// ⚠ In SKILL mode the binding constraint is a single BUCKET's demand vs THAT bucket's per-sprint cap — comparing
// the feature TOTAL vs the POOLED cap can read "fits" (total < pooled) while a bucket overflows, AND mislabels the
// total as one skill. So when the packer recorded per-bucket detail, phrase it bucket-vs-bucket. Otherwise (pooled
// mode) use total-vs-pooled ONLY when it truly exceeds the cap; else fall back to the vague phrasing.
export function oversizedReasonText(o) {
  if (!o) return "larger than one sprint - split it";
  const detail = Array.isArray(o.bucketDetail)
    ? o.bucketDetail.filter((b) => b && Number.isFinite(Number(b.demand)) && Number.isFinite(Number(b.cap)) && Number(b.demand) > Number(b.cap))
    : [];
  if (detail.length) {
    const parts = detail.map((b) => `needs ${fmt1(b.demand)} ${skillLabel(b.bucket)} pts vs a ${fmt1(b.cap)}-pt ${skillLabel(b.bucket)} cap per sprint`);
    const addWord = detail.map((b) => skillLabel(b.bucket)).join(" + ");
    return `${parts.join("; ")}. Split it, or add ${addWord} capacity.`;
  }
  const pts = Number(o.points);
  const cap = Number(o.maxCapacity);
  if (Number.isFinite(pts) && Number.isFinite(cap) && cap > 0 && pts > cap) {
    return `needs ${fmt1(pts)} pts vs a ${fmt1(cap)}-pt single-sprint cap. Split it.`;
  }
  return "larger than one sprint - split it";
}

// ── the capacity verdict (deficit headline / fragmentation note) — exact screen strings, shared ──
// deficitHeadline: when the backlog exceeds capacity. fragmentationNote: when it fits overall but gaps
// stranded some items. Both return {title, body} | null. The brief and the screen render the SAME text.
export function deficitHeadline(metrics, sprintCount) {
  if (!(metrics && metrics.deficitPoints > 0)) return null;
  const oc = metrics.overflowCount;
  const sc = Number(sprintCount) || 0;
  return {
    title: `${oc} feature${oc === 1 ? "" : "s"} don’t fit in ${sc} sprint${sc === 1 ? "" : "s"}`,
    body: `The backlog (${fmt1(metrics.totalBacklogPoints)} pts) exceeds capacity (${fmt1(metrics.totalCapacity)} pts) by ${fmt1(metrics.deficitPoints)} pts.`,
  };
}
export function fragmentationNote(metrics) {
  if (!(metrics && metrics.fragmentation && metrics.deficitPoints <= 0)) return null;
  return {
    title: "Some items didn’t fit the leftover gaps",
    body: `${fmt1(metrics.overflowPoints)} pts overflowed while ${fmt1(metrics.wastedCapacity)} pts of capacity stayed free — they didn’t fit the gaps left in earlier sprints.`,
  };
}

// One-line grounded executive verdict (the brief's headline; also a clean "fits/exceeds" summary).
export function capacityVerdict(metrics, sprintCount, oversizedCount = 0) {
  const m = metrics || {};
  const sc = Number(sprintCount) || 0;
  const totalBacklog = fmt1(m.totalBacklogPoints || 0);
  const totalCap = fmt1(m.totalCapacity || 0);
  if (m.deficitPoints > 0) {
    const oc = m.overflowCount || 0;
    const ovc = Number(oversizedCount) || 0;
    // A deficit with overflowCount 0 comes ENTIRELY from a force-placed oversized feature — never say "0 won't
    // fit" (a provable falsehood while capacity is exceeded). Name each channel honestly.
    const parts = [];
    if (oc > 0) parts.push(`${oc} feature${oc === 1 ? "" : "s"} won’t fit`);
    if (ovc > 0) parts.push(`${ovc} feature${ovc === 1 ? "" : "s"} ${ovc === 1 ? "is" : "are"} larger than one sprint`);
    const tail = parts.length ? ` — ${parts.join(" and ")} — see What doesn’t fit.` : ".";
    return `Backlog ${totalBacklog} pts exceeds ${sc}-sprint capacity ${totalCap} pts by ${fmt1(m.deficitPoints)} pts${tail}`;
  }
  const spare = fmt1(Math.max(0, (Number(m.totalCapacity) || 0) - (Number(m.totalBacklogPoints) || 0)));
  const oc = m.overflowCount || 0;
  if (oc > 0) {
    // BRIEF-VERDICT honesty (live-acceptance finding 2026-06-20): total capacity covers the backlog, but a
    // skill bucket or a sequencing/readiness gap still pushes feature(s) to overflow. The headline MUST
    // reconcile with "What doesn’t fit" — an unqualified "fits within … to spare" over-promises to a
    // stakeholder. The "spare overall" + "don’t fit" tension is the honest story (total slack, fragmented).
    return `Backlog ${totalBacklog} pts is within ${sc}-sprint total capacity ${totalCap} pts (${spare} pts spare overall), but ${oc} feature${oc === 1 ? "" : "s"} ${oc === 1 ? "doesn’t" : "don’t"} fit the sprint layout — see What doesn’t fit.`;
  }
  const ovc = Number(oversizedCount) || 0;
  if (ovc > 0) {
    // POLICY 11: an oversized feature is force-placed into a sprint but exceeds one sprint's capacity — the total
    // can fit overall while an item still needs splitting. The headline must NOT read a clean "to spare" above the
    // "What doesn't fit" list; reconcile it, mirroring the overflow branch.
    return `Backlog ${totalBacklog} pts is within ${sc}-sprint total capacity ${totalCap} pts (${spare} pts spare overall), but ${ovc} feature${ovc === 1 ? "" : "s"} ${ovc === 1 ? "is" : "are"} larger than one sprint — see What doesn’t fit.`;
  }
  return `Backlog ${totalBacklog} pts fits within ${sc}-sprint capacity ${totalCap} pts (${spare} pts to spare).`;
}

// ── KANBAN reach verdict (methodology=kanban) — the noun-agnostic "reach" headline, never "sprint" ──
// A pull-ready backlog has no sprints/dates → the honest one-liner is "how much of the backlog likely fits
// this quarter", framed as a forecast (a range), never a commitment. Shared so the screen reads one story.
// Returns a plain sentence. Metrics come from the kanban packer (reachedNowPoints / beyondReachPoints / …).
export function kanbanReachVerdict(metrics) {
  const m = metrics || {};
  const total = fmt1(m.totalBacklogPoints || 0);
  const cons = fmt1(m.conservativePoints || 0);
  const opt = fmt1(m.optimisticPoints || 0);
  const beyond = Number(m.beyondReachPoints) || 0;
  const laterCount = Number(m.laterCount) || 0;
  if (beyond > 0.05 || laterCount > 0) {
    return `Backlog ${total} pts · likely reach this quarter is ${cons}–${opt} pts (conservative–optimistic), so ${laterCount} feature${laterCount === 1 ? "" : "s"} (${fmt1(beyond)} pts) ${laterCount === 1 ? "is" : "are"} beyond likely reach — a forecast, not a commitment.`;
  }
  return `Backlog ${total} pts · likely reach this quarter is ${cons}–${opt} pts (conservative–optimistic) — the whole backlog is within optimistic reach. A forecast, not a commitment.`;
}

// ── critical-path + leverage derivations (SHARED so the on-screen Plan summary and the copy-out brief read
// ONE story — BRIEF-DRIFT). Both read plan.signals (T0). criticalPathInfo ALSO exposes the ORDERED chain when
// the backend supplied plan.criticalPathUids (T0): the brief uses only { len, endName }, the on-screen panel
// additionally renders the chain — a superset, never a contradiction. `nameOf(id)` resolves the display name.
export function criticalPathInfo(plan, nameOf) {
  const signals = (plan && plan.signals) || {};
  const entries = Object.entries(signals);
  if (!entries.length) return null;
  let cp = null;
  for (const [id, s] of entries) if (s && (cp === null || (s.criticalPathLen || 0) > (cp.len || 0))) cp = { id, len: s.criticalPathLen || 0 };
  if (!cp || cp.len <= 1) return null;
  const name = (id) => (typeof nameOf === "function" && nameOf(id)) || id;
  const chainUids = Array.isArray(plan && plan.criticalPathUids) && plan.criticalPathUids.length ? plan.criticalPathUids : null;
  // When the backend supplied the ordered chain, its LAST uid is the authoritative end — plan.criticalPathUids
  // uses a smallest-uid tie-break the panel renders, whereas the `cp` scan above breaks a tied max-depth by
  // POSITION (first-encountered). On a tied max depth those pick DIFFERENT nodes → the brief's "ends at X" would
  // name a different feature than the panel's chain end (invariant #4 drift). Derive endId/len FROM the rendered
  // chain so "ends at" and the chain end are the SAME node by construction. No chain (legacy) → fall back to cp.
  const endId = chainUids ? chainUids[chainUids.length - 1] : cp.id;
  const len = chainUids ? chainUids.length : cp.len;
  return { len, endId, endName: name(endId), chainNames: chainUids ? chainUids.map(name) : null };
}

// Top-N features by downstream unblock count (leverage) — the "highest leverage" list the brief + panel share.
export function highestLeverage(plan, nameOf, limit = 3) {
  const signals = (plan && plan.signals) || {};
  const name = (id) => (typeof nameOf === "function" && nameOf(id)) || id;
  return Object.entries(signals)
    .map(([id, s]) => ({ id, name: name(id), n: (s && s.downstreamUnblockCount) || 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit);
}

// ── HARDENED CSV (ported VERBATIM from src/testcases.js — keep the guard identical; BRIEF-CSV-RUNTIME) ──
// Neutralize spreadsheet formula-injection + RFC-4180 quote. Was a §13 HIGH in the test-case export.
export function csvCell(v) {
  let s = v == null ? "" : String(v);
  s = s.replace(/\r?\n/g, " / ").replace(/\t/g, " ");
  const lead = s.replace(/^\s+/, "");
  const isNegativeNumber = /^-\d+(\.\d+)?$/.test(lead);
  if (!isNegativeNumber && /^[=+@-]/.test(lead)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export function toCSV(columns, rows, opts = {}) {
  const delim = opts.delimiter || ",";
  const lines = [];
  if (opts.headerRow !== false) lines.push(columns.map(csvCell).join(delim));
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(delim));
  return lines.join("\n");
}
