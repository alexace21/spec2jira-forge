// planBrief.js — P18, the Defensible Plan Brief (PURE, deterministic, no LLM, no resolver, no spend).
//
// "Defensible" = every claim traces to a number the planner ALREADY computed. So this is meaning-PRESERVING
// transcription of the plan object, NOT meaning-reading — §4 says pure-function, decisively (an LLM sentence's
// provenance is the model, not the plan, which is categorically wrong for "defensible"). It assembles from the
// in-memory plan the user is looking at → purge-safe (no getTestCaseExports KVS read), instant, $0, offline
// node-testable. Shared derivations (verdict / overflow reasons / risk register / risk reasons / dates / fmt)
// come from lib/planView.js so the brief and the screen can NEVER tell two different stories (BRIEF-DRIFT).
//
// renderPlanBrief({ plan, assumptions, warnings, cost, slimFeatures, form, usedLlm, stale, pageTitle, generatedAt })
//   → { markdown, plainText, csv, meta:{ sectionCount, featureCount } }
// Every section is default-GUARDED: a plan cached before the Tier-1 risk layer (no riskByFeature /
// sprintRiskProfiles / specConcernSummary) renders "none surfaced", never throws.

import {
  fmt1, fmtUsd, sprintDates, riskReasons, buildRiskRegister,
  overflowReasonText, capacityVerdict, csvCell, toCSV, skillLabel,
} from "./planView.js"; // explicit .js so node (offline test) AND webpack both resolve it

// strip markdown markers for the plain-text variant (keep "- " bullets — readable as-is)
function mdToPlain(md) {
  return String(md)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/_(.*?)_/g, "$1");
}

const OBJECTIVE_LABEL = { mvp: "Ship the MVP fastest", min_risk: "Minimize delivery risk", max_value: "Maximize early value" }; // P12 (balanced → omitted)

export function renderPlanBrief({ plan, assumptions, warnings, cost, slimFeatures, form, usedLlm, stale, pageTitle, generatedAt, objective } = {}) {
  const L = []; // markdown lines
  if (!plan || !Array.isArray(plan.sprints)) {
    const md = "# Sprint plan\n\n_No plan to summarise yet._";
    return { markdown: md, plainText: mdToPlain(md), csv: "", meta: { sectionCount: 0, featureCount: 0 } };
  }

  // uid → {name, story_points, priority} lookup (the brief draws SP/priority/name from the slim features)
  const byUid = new Map();
  for (const f of Array.isArray(slimFeatures) ? slimFeatures : []) if (f && f._uid) byUid.set(f._uid, f);
  const nameOf = (id) => (byUid.get(id) && byUid.get(id).name) || id;
  const spOf = (id) => { const f = byUid.get(id); return f && f.story_points != null ? f.story_points : null; };
  const prioOf = (id) => { const f = byUid.get(id); return (f && f.priority) || null; };

  const metrics = plan.metrics || {};
  const sprintCount = plan.sprints.length;
  const f = form || {};
  // ONE source of truth for the LLM-availability wording (gate LOW): prefer the explicit param, else the
  // plan's own ranking flag — so the header note, the footer, and the risk preamble can never disagree.
  const llmUsed = usedLlm !== undefined ? usedLlm : !!(plan.ranking && plan.ranking.usedLlm);
  const risk = plan.riskByFeature || null;
  const riskOf = (id) => (risk && risk[id]) || null;
  const profiles = Array.isArray(plan.sprintRiskProfiles) ? plan.sprintRiskProfiles : [];

  // ── 1. HEADER + grounded verdict ──
  L.push(`# Sprint plan${pageTitle ? ` — ${pageTitle}` : ""}`);
  L.push("");
  L.push(`_Review-only — not yet in Jira.${generatedAt ? ` As of ${generatedAt}.` : ""}${llmUsed ? "" : " Ordering fell back to dependencies + priority (Claude was unavailable)."}_`);
  if (stale) L.push(`\n> ⚠ This plan is out of date — the breakdown changed since it was generated. Re-rank before sharing.`);
  L.push("");
  L.push(`> ${capacityVerdict(metrics, sprintCount)}`);
  if (OBJECTIVE_LABEL[objective]) L.push(`\n_Ordered for: **${OBJECTIVE_LABEL[objective]}**._`); // P12 (balanced → omitted)
  L.push("");

  // ── 2. CAPACITY & DATES ──
  L.push("## Capacity & dates");
  L.push(`- **Sprints:** ${sprintCount}`);
  if (f.sprintLengthDays) L.push(`- **Sprint length:** ${f.sprintLengthDays} days`);
  L.push(`- **Total capacity:** ${fmt1(metrics.totalCapacity)} pts · **backlog:** ${fmt1(metrics.totalBacklogPoints)} pts`);
  if (f.sprintStartDate) {
    const first = sprintDates(f.sprintStartDate, 1, f.sprintLengthDays);
    const last = sprintDates(f.sprintStartDate, sprintCount, f.sprintLengthDays);
    if (first || last) L.push(`- **Dates:** ${first} → ${last.split("–").pop().trim()}`);
  }
  L.push("");

  // ── 2b. SKILL CAPACITY (Tier-2) — per-discipline demand vs capacity + the bottleneck ──
  const bm = plan.bucketsActive && plan.bucketMetrics ? plan.bucketMetrics : null;
  if (bm) {
    const cap1 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
    L.push("## Skill capacity");
    ["BE", "FE", "QA", "GEN"].filter((k) => (bm.capacity[k] || 0) > 0 || (bm.demand[k] || 0) > 0).forEach((k) => {
      // overDemand = genuine shortfall (own demand − own capacity). NOT unmet — unmet over-counts collateral
      // (idle skills on an atomic feature blocked behind a sibling skill's shortage), which read as a false
      // "N pts unmet" beside ample idle capacity. A fragmentation overflow (no skill globally over) → no tail.
      const over = (bm.overDemand && bm.overDemand[k]) || ((bm.overfilled && bm.overfilled[k]) || 0);
      const tail = over > 0.05 ? ` · ${fmt1(over)} pts over capacity` : "";
      L.push(`- **${cap1(skillLabel(k))}:** ${fmt1(bm.planned[k] || 0)} / ${fmt1(bm.capacity[k] || 0)} pts used${tail}`);
    });
    if (Array.isArray(bm.bottleneckBuckets) && bm.bottleneckBuckets.length) L.push(`- _Bottleneck: ${bm.bottleneckBuckets.map(skillLabel).join(", ")}._`);
    L.push("");
  }

  // ── 3. WHAT FITS (per-sprint allocation) ──
  L.push("## What fits");
  plan.sprints.forEach((s, i) => {
    const ids = Array.isArray(s.ids) ? s.ids : [];
    const cap = Number(s.capacity) || 0;
    const load = Number(s.load) || 0;
    const util = cap > 0 ? Math.round((load / cap) * 100) : 0;
    const dates = sprintDates(f.sprintStartDate, i + 1, f.sprintLengthDays);
    const prof = profiles[i];
    const fragile = prof && prof.fragile ? `  _(risk-heavy: ${prof.highRiskCount} high-risk${prof.externalDepCount ? `, ${prof.externalDepCount} external dep` : ""})_` : "";
    L.push(`### Sprint ${i + 1}${dates ? ` (${dates})` : ""} — ${fmt1(load)}/${fmt1(cap)} pts (${util}%)${fragile}`);
    if (!ids.length) { L.push("- _Free capacity_"); }
    else ids.forEach((id) => {
      const sp = spOf(id);
      const prio = prioOf(id);
      const reasons = riskReasons(riskOf(id)).map((r) => r.text);
      L.push(`- ${nameOf(id)}${sp != null ? ` — ${sp} pts` : ""}${prio ? ` · ${prio}` : ""}${reasons.length ? ` · ⚠ ${reasons.join(", ")}` : ""}`);
    });
    L.push("");
  });

  // ── 4. WHAT DOESN'T FIT + WHY (the heart of "defensible") ──
  const overflow = Array.isArray(plan.overflow) ? plan.overflow : [];
  const oversized = Array.isArray(plan.oversized) ? plan.oversized : [];
  if (overflow.length || oversized.length) {
    L.push(`## What doesn’t fit${overflow.length ? ` (${overflow.length})` : ""}`);
    overflow.forEach((o) => L.push(`- **${o.name || nameOf(o.id)}** — ${overflowReasonText(o, nameOf)}`));
    oversized.forEach((o) => L.push(`- **${o.name || nameOf(o.id)}** — larger than one sprint; split it`));
    L.push("");
  }

  // ── 5. RISK REGISTER ──
  const register = buildRiskRegister(plan, nameOf);
  if (register.length) {
    L.push(`## Risk register (${register.length})`);
    L.push(llmUsed
      ? "_Claude was nudged to sequence these earlier so problems surface sooner._"
      : "_Order fell back to dependencies + priority — these were not re-sequenced by risk._");
    register.forEach((e) => {
      const reasons = riskReasons(e).map((r) => r.text).join(", ");
      L.push(`- **${e.name}** — ${reasons} · ${e.sprint ? `Sprint ${e.sprint}` : "doesn’t fit"}`);
    });
    L.push("");
  } else if (risk === null) {
    // deep-audit INFO-02: a plan cached BEFORE the risk layer has no riskByFeature at all — don't show a
    // bare empty section; say it honestly so "no risks" isn't mistaken for "computed and found none".
    L.push("## Risk register");
    L.push("_Risk wasn’t computed for this saved plan — re-rank to refresh it._");
    L.push("");
  }

  // ── 6. DEPENDENCY HIGHLIGHTS (critical path / leverage / cycles + diagnostics — never silent) ──
  const g = plan.graph || {};
  const signals = plan.signals || {};
  const depLines = [];
  const sigEntries = Object.entries(signals);
  if (sigEntries.length) {
    let cp = null;
    for (const [id, s] of sigEntries) if (s && (cp === null || (s.criticalPathLen || 0) > (cp.len || 0))) cp = { id, len: s.criticalPathLen || 0 };
    if (cp && cp.len > 1) depLines.push(`- **Critical path:** ${cp.len} features deep (ends at ${nameOf(cp.id)})`);
    const leverage = sigEntries
      .map(([id, s]) => ({ id, n: (s && s.downstreamUnblockCount) || 0 }))
      .filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
    if (leverage.length) depLines.push(`- **Highest leverage:** ${leverage.map((x) => `${nameOf(x.id)} (unblocks ${x.n})`).join(", ")}`);
  }
  if (Array.isArray(g.cyclicNodes) && g.cyclicNodes.length) depLines.push(`- **Dependency cycle:** ${g.cyclicNodes.map(nameOf).join(", ")} — sequenced by breaking the softest edge; review the order.`);
  if (Array.isArray(g.danglingRefs) && g.danglingRefs.length) depLines.push(`- **Missing dependency:** ${g.danglingRefs.map((d) => `“${d.name}” → “${d.missingDep}”`).join("; ")} (treated as unblocked)`);
  if (Array.isArray(g.ambiguousDeps) && g.ambiguousDeps.length) depLines.push(`- **Ambiguous dependency:** ${g.ambiguousDeps.map((d) => `“${d.name}” → “${d.dep}”`).join("; ")} (left unbound)`);
  if (depLines.length) { L.push("## Dependency highlights"); depLines.forEach((d) => L.push(d)); L.push(""); }

  // ── 7. ASSUMPTIONS (every multiplier, with provenance — the trust mechanism) ──
  const asm = Array.isArray(assumptions) ? assumptions : [];
  if (asm.length) {
    L.push("## Assumptions");
    asm.forEach((a) => L.push(`- ${a.label}: **${String(a.value)}**${a.source === "default" ? " (default)" : ""}`));
    L.push("");
  }
  const warn = Array.isArray(warnings) ? warnings : [];
  if (warn.length) { L.push("## Notes"); warn.forEach((w) => L.push(`- ${w.message}`)); L.push(""); }

  // ── 8. SPEC-WIDE CONCERNS (compliance counted once; plan-level, never per-feature) ──
  const scs = plan.specConcernSummary;
  if (scs && scs.total) {
    L.push(`## Spec-wide concerns${scs.complianceCount ? ` — ${scs.complianceCount} compliance` : ""} (${scs.total})`);
    L.push("_Apply to the whole backlog — weigh when committing to dates._");
    (Array.isArray(scs.items) ? scs.items : []).slice(0, 10).forEach((c) => L.push(`- ${c.type && c.type !== "NOTE" ? `[${c.type}] ` : ""}${c.text}`));
    if (scs.total > 10) L.push(`- …and ${scs.total - 10} more.`);
    L.push("");
  }

  // ── 9. FOOTER ──
  L.push("---");
  L.push(`_${llmUsed ? "Ordered by Claude" : "Ordered deterministically"} · sprint math is deterministic · human-reviewed.${cost && cost.total_usd != null ? ` This plan’s ranking used ${fmtUsd(cost.total_usd)} of your Anthropic key.` : ""}_`);

  const markdown = L.join("\n");

  // ── CSV: the per-sprint allocation table (the one tabular artifact a PM imports) — hardened cells ──
  const COLS = ["Sprint", "Dates", "Feature", "Story points", "Priority", "Risk"];
  const rows = [];
  plan.sprints.forEach((s, i) => {
    const dates = sprintDates(f.sprintStartDate, i + 1, f.sprintLengthDays);
    (Array.isArray(s.ids) ? s.ids : []).forEach((id) => rows.push({
      Sprint: `Sprint ${i + 1}`, Dates: dates, Feature: nameOf(id),
      "Story points": spOf(id) != null ? spOf(id) : "", Priority: prioOf(id) || "",
      Risk: riskReasons(riskOf(id)).map((r) => r.text).join("; "),
    }));
  });
  overflow.forEach((o) => rows.push({
    Sprint: "Doesn’t fit", Dates: "", Feature: o.name || nameOf(o.id),
    "Story points": spOf(o.id) != null ? spOf(o.id) : "", Priority: prioOf(o.id) || "",
    Risk: overflowReasonText(o, nameOf),
  }));
  const csv = toCSV(COLS, rows);

  return { markdown, plainText: mdToPlain(markdown), csv, meta: { sectionCount: L.filter((x) => x.startsWith("## ")).length, featureCount: byUid.size } };
}
