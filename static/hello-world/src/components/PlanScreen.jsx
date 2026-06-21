import React, { useMemo, useState, useRef, useEffect } from "react";
import { invoke } from "@forge/bridge";
import { SignalIcon, SignalCallout } from "./Signal";
import {
  IconCalendar, IconUsers, IconRefresh, IconCost, IconPlus, IconTrash, IconArrowLeft, IconBan, IconLink, IconList,
} from "./Icon";
// Shared pure view-derivations — the SINGLE source of truth so PlanScreen + the Plan Brief can never
// tell two different stories (§13 gate "BRIEF-DRIFT"). See static/hello-world/src/lib/planView.js.
import {
  fmt1, fmtUsd, sprintDates, riskReasons, isRiskFlagged, buildRiskRegister, registerWhereLabel,
  overflowReasonText, deficitHeadline, fragmentationNote, skillLabel, kanbanReachVerdict,
} from "../lib/planView";

const SKILL_METER_ORDER = ["BE", "FE", "QA", "GEN"]; // Tier-2: per-bucket meter order
import { renderPlanBrief } from "../lib/planBrief";

// Clipboard + data-URI download fallback (Forge iframe blocks blob:; never a silent no-op). Tiny, so
// duplicated here rather than importing from App.js (same call the test-case export uses).
async function copyPlanText(text, filename) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (_) {
    try {
      const a = document.createElement("a");
      a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
      a.download = filename || "plan-brief.txt";
      a.style.display = "none";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      return true;
    } catch (_2) { return false; }
  }
}

// ── PlanScreen — the Capacity-Sheet Planner (review-only sprint plan) ──────────────
//
// A NEW stage after Review: the user fills an in-app capacity form; the backend (startPlan)
// validates it fail-loud, builds the uid-keyed dependency graph (push parity), asks Claude for ONE
// advisory ordering, and a deterministic packer produces the plan. This screen renders the form
// (assumptions always visible + editable) + the packed plan with honest signals: per-sprint capacity
// meters (a11y SignalIcon, never colour-alone), a typed overflow bucket, and diagnostics for cycles /
// dangling / ambiguous / oversized / unsized features. Re-pack (free, pure-fn) vs Re-rank (billed)
// are distinct buttons (ledger UX-4); cost is shown pre-flight + echoed post-run (UX-5).
//
// PROPS (all from App.js; the resolver contracts live in src/index.js):
//   featureCount, slimFeatures           — the breakdown features sent to startPlan (uid→display map)
//   form, onFormChange(patch)            — the capacity form (lifted to App.js so Plan↔Review survives)
//   result                               — last startPlan/repackPlan/getPlan response
//   busy                                 — a plan/repack call is in flight
//   estimate                             — estimatePlanCost pre-flight {expected_usd, upper_usd}
//   armed, onArmToggle                   — 2-step armed-confirm for the billed Re-rank (cost honesty)
//   onGenerate, onRepack, onBack

const WRAP = { maxWidth: "1180px", margin: "0 auto", width: "100%" };
// Stable row id for the team-member list, so a middle-row remove keeps focus on the right input
// (index keys reuse DOM nodes by position — the classic controlled-list anti-pattern; gate finding).
let _ridCounter = 0;
const rid = () => `r${++_ridCounter}_${Math.random().toString(36).slice(2, 7)}`;
const PRIORITY_TINT = {
  High: { bg: "var(--s2j-red-bg)", border: "var(--s2j-red-border)", fg: "var(--s2j-red)" },
  Medium: { bg: "var(--s2j-orange-bg)", border: "var(--s2j-orange-border)", fg: "var(--s2j-orange)" },
  Low: { bg: "var(--s2j-bg-section)", border: "var(--s2j-border)", fg: "var(--s2j-text-muted)" },
};

const fieldStyle = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--s2j-border)",
  borderRadius: 6,
  fontSize: 13,
  background: "var(--s2j-bg)",
  color: "var(--s2j-text)",
  boxSizing: "border-box",
};
const labelStyle = { fontSize: 11, fontWeight: 600, color: "var(--s2j-text-muted)", marginBottom: 3, display: "block" };

// A clickable info marker — click the ⓘ to open a small static popover the user closes manually (× or
// click-outside). Partner-preferred over a hover tooltip (more deliberate + readable; 2026-06-20). Each
// instance owns its open state; absolute-positioned (the form card has no overflow:hidden, so no clip).
function InfoTip({ text, align }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex", marginLeft: 4, verticalAlign: "-0.1em" }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label={open ? "Hide info" : "Show info"}
        aria-expanded={open}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "inline-flex", color: "var(--s2j-blue)" }}
      >
        <SignalIcon kind="info" size={12} />
      </button>
      {open ? (
        <span
          role="dialog"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute", top: "calc(100% + 6px)", zIndex: 50,
            ...(align === "right" ? { right: 0 } : { left: 0 }), // anchor right for a rightmost icon so the popover doesn't overflow the column
            width: 260, maxWidth: "72vw", background: "var(--s2j-bg)", color: "var(--s2j-text)",
            border: "1px solid var(--s2j-border)", borderRadius: 8, boxShadow: "0 4px 18px rgba(0,0,0,0.14)",
            padding: "10px 26px 10px 12px", fontSize: 12, fontWeight: 400, lineHeight: 1.5, textAlign: "left", whiteSpace: "normal",
          }}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            style={{ position: "absolute", top: 4, right: 6, background: "none", border: "none", cursor: "pointer", color: "var(--s2j-text-muted)", fontSize: 16, lineHeight: 1, padding: 2 }}
          >×</button>
          {text}
        </span>
      ) : null}
    </span>
  );
}

function NumField({ label, value, onChange, placeholder, disabled, hint, tip }) {
  return (
    <label style={{ display: "block" }}>
      <span style={labelStyle}>{label}{tip ? <InfoTip text={tip} /> : null}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={fieldStyle}
      />
      {hint ? <span style={{ fontSize: 10.5, color: "var(--s2j-text-light)", display: "block", marginTop: 2 }}>{hint}</span> : null}
    </label>
  );
}

// ── Methodology toggle — a clear segmented control (Sprints (Scrum) | Kanban backlog) ───────────────
// Bound to form.methodology (default 'scrum'). a11y: role=radiogroup; the active option carries the blue
// fill AND aria-checked (state isn't colour-alone). Switching re-runs the live preview (App.js debounce).
function MethodologyToggle({ value, onChange, disabled }) {
  const v = value === "kanban" ? "kanban" : "scrum";
  const opts = [
    { key: "scrum", label: "Sprints (Scrum)", icon: <IconCalendar size={13} /> },
    { key: "kanban", label: "Kanban backlog", icon: <IconList size={13} /> },
  ];
  return (
    <div style={{ marginBottom: 14 }}>
      <span style={labelStyle}>Planning mode<InfoTip text="Sprints (Scrum) packs the backlog into capacity-bounded sprints with dates. Kanban backlog produces a pull-ready, dependency-legal ordered backlog cut into Now / Next / Later by how much your team is likely to reach this quarter — no sprints, no dates. Both are review-only." /></span>
      <div role="radiogroup" aria-label="Planning mode" style={{ display: "inline-flex", border: "1px solid var(--s2j-border)", borderRadius: 8, overflow: "hidden", background: "var(--s2j-bg)" }}>
        {opts.map((o, i) => {
          const active = v === o.key;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => { if (!active) onChange({ methodology: o.key }); }}
              className="flex items-center gap-1"
              style={{
                padding: "7px 14px",
                fontSize: 12.5,
                fontWeight: active ? 600 : 500,
                cursor: disabled ? "not-allowed" : "pointer",
                border: "none",
                borderLeft: i === 0 ? "none" : "1px solid var(--s2j-border)",
                background: active ? "var(--s2j-blue)" : "transparent",
                color: active ? "#fff" : "var(--s2j-text-muted)",
              }}
            >
              {o.icon} {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Capacity form (controlled; the backend validates every field fail-loud) ─────────
function CapacityForm({ form, onChange, disabled }) {
  const f = form || {};
  const isKanban = f.methodology === "kanban";
  const people = Array.isArray(f.people) ? f.people : [];
  const set = (patch) => onChange(patch);
  const setPerson = (i, patch) => set({ people: people.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const addPerson = () => set({ people: [...people, { _rid: rid(), name: "", availableDays: f.sprintLengthDays || 8 }] });
  const removePerson = (i) => set({ people: people.filter((_, j) => j !== i) });
  const [advanced, setAdvanced] = React.useState(false);
  // The override field differs per methodology: pts/sprint (scrum) vs pts/quarter (kanban). The multiplier
  // inputs (hours/day, focus, hours/point) are disabled when EITHER override is set (they're then unused).
  const overrideKey = isKanban ? "pointsPerQuarterOverride" : "pointsPerSprintOverride";
  const overrideMode = f[overrideKey] !== undefined && f[overrideKey] !== "" && f[overrideKey] !== null;

  return (
    <div style={{ border: "1px solid var(--s2j-border)", borderRadius: 10, padding: 16, background: "var(--s2j-bg-section)" }}>
      {/* methodology selector — top of the form (task-1) */}
      <MethodologyToggle value={f.methodology} onChange={set} disabled={disabled} />

      <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
        <span style={{ color: "var(--s2j-blue)" }}><IconUsers size={16} /></span>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--s2j-text)", margin: 0 }}>Team capacity</h3>
      </div>
      <p style={{ fontSize: 11, color: "var(--s2j-text-muted)", margin: "0 0 12px", lineHeight: 1.5 }}>
        {isKanban
          ? <>Expected throughput this quarter is computed from each person's available days. Click the&nbsp;<SignalIcon kind="info" size={11} style={{ verticalAlign: "-0.1em" }} />&nbsp;icons for what each field means; every multiplier (and its default) is also listed in <strong>Assumptions</strong> after you generate.</>
          : <>Capacity per sprint is computed from each person's available days. Click the&nbsp;<SignalIcon kind="info" size={11} style={{ verticalAlign: "-0.1em" }} />&nbsp;icons for what each field means; every multiplier (and its default) is also listed in <strong>Assumptions</strong> after you generate.</>}
      </p>

      {/* team roster — availableDays is PER SPRINT (Scrum) or PER QUARTER (Kanban) — the pinned contract */}
      <div style={{ marginBottom: 12 }}>
        <div className="flex" style={{ gap: 8, marginBottom: 4, fontSize: 11, fontWeight: 600, color: "var(--s2j-text-muted)" }}>
          <span style={{ flex: 1, display: "inline-flex", alignItems: "center" }}>
            Team member
            <InfoTip text="A label for this capacity row — a person's name. The name is NOT sent to Claude; it only labels the row." />
          </span>
          {/* Skill is Scrum-only in v1 (Kanban is a pooled team — no skill buckets) */}
          {!isKanban ? (
            <span style={{ width: 92, display: "inline-flex", alignItems: "center" }}>
              Skill
              <InfoTip text="The discipline this person works in — Backend / Frontend / QA. When you set ANY skills, the planner splits capacity into those buckets and checks each feature against the skill it needs (so it can flag “short on backend” while QA sits idle). Leave it blank to keep one pooled team number (no skill matching). Untagged members become a generalist pool that only fills features with no recognizable skill." />
            </span>
          ) : null}
          <span style={{ width: 120, display: "inline-flex", alignItems: "center" }}>
            {isKanban ? "Available days (this quarter)" : "Available days / sprint"}
            {isKanban ? (
              <InfoTip align="right" text="Days each person is available to work OVER THE WHOLE QUARTER — the entire period, NOT per sprint. A full quarter is ≈ 60–65 working days, minus that person's planned time off. (Entering per-sprint days here under-counts the quarter's throughput.)" />
            ) : (
              <InfoTip align="right" text="Days each person is available to work IN ONE SPRINT — not the whole quarter. A 2-week sprint is ≈ 8–10 working days, minus that person's planned time off. (Entering whole-quarter days here over-counts capacity; values above the sprint length are clamped.)" />
            )}
          </span>
          <span style={{ width: 28 }} />
        </div>
        {people.map((p, i) => (
          <div key={p._rid || i} className="flex" style={{ gap: 8, marginBottom: 6, alignItems: "center" }}>
            <input
              type="text"
              value={p.name ?? ""}
              placeholder="Name (e.g. Sam)"
              disabled={disabled}
              onChange={(e) => setPerson(i, { name: e.target.value })}
              style={{ ...fieldStyle, flex: 1 }}
            />
            {!isKanban ? (
              <select
                value={p.skill ?? ""}
                disabled={disabled}
                onChange={(e) => setPerson(i, { skill: e.target.value })}
                title="Discipline — Backend / Frontend / QA (blank = generalist)"
                style={{ ...fieldStyle, width: 92 }}
              >
                <option value="">—</option>
                <option value="BE">Backend</option>
                <option value="FE">Frontend</option>
                <option value="QA">QA</option>
              </select>
            ) : null}
            <input
              type="text"
              inputMode="decimal"
              value={p.availableDays ?? ""}
              placeholder={isKanban ? "60" : "8"}
              disabled={disabled}
              onChange={(e) => setPerson(i, { availableDays: e.target.value })}
              style={{ ...fieldStyle, width: 120 }}
            />
            <button
              type="button"
              onClick={() => removePerson(i)}
              disabled={disabled || people.length <= 1}
              title="Remove this team member"
              style={{ width: 28, height: 28, border: "1px solid var(--s2j-border)", borderRadius: 6, background: "var(--s2j-bg)", color: "var(--s2j-text-muted)", cursor: people.length <= 1 ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            >
              <IconTrash size={13} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addPerson}
          disabled={disabled}
          className="text-xs flex items-center gap-1"
          style={{ background: "none", border: "1px dashed var(--s2j-border)", color: "var(--s2j-blue)", cursor: "pointer", padding: "5px 10px", borderRadius: 6, marginTop: 2 }}
        >
          <IconPlus size={13} /> Add team member
        </button>
      </div>

      {/* sprint structure — Scrum-only (Kanban has no sprint count / length / start date in v1) */}
      {!isKanban ? (
        <div className="flex" style={{ gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ width: 120 }}><NumField label="Sprints" value={f.sprintCount} onChange={(v) => set({ sprintCount: v })} placeholder="4" disabled={disabled} /></div>
          <div style={{ width: 150 }}><NumField label="Sprint length (days)" value={f.sprintLengthDays} onChange={(v) => set({ sprintLengthDays: v })} placeholder="10" disabled={disabled} /></div>
          <div style={{ width: 160 }}>
            <label style={{ display: "block" }}>
              <span style={labelStyle}>Start date (optional)</span>
              <input type="date" value={f.sprintStartDate ?? ""} disabled={disabled} onChange={(e) => set({ sprintStartDate: e.target.value })} style={fieldStyle} />
            </label>
          </div>
        </div>
      ) : null}

      {/* advanced multipliers + override — collapsible (every default echoed in assumptions) */}
      <button
        type="button"
        onClick={() => setAdvanced((a) => !a)}
        className="text-xs"
        style={{ background: "none", border: "none", color: "var(--s2j-text-muted)", cursor: "pointer", padding: 0, marginBottom: advanced ? 10 : 0 }}
      >
        {advanced ? "▾" : "▸"} Advanced — fine-tune the capacity math (sensible defaults already applied)
      </button>
      {advanced ? (
        <div>
          <p style={{ fontSize: 10.5, color: "var(--s2j-text-light)", margin: "0 0 8px", lineHeight: 1.5 }}>
            {isKanban
              ? <>The model: <strong>available days × hours/day × focus factor ÷ hours/point = points this quarter</strong>. Leave blank to use the defaults.</>
              : <>The model: <strong>available days × hours/day × focus factor ÷ hours/point = points per sprint</strong>. Leave blank to use the defaults.</>}
          </p>
          <div className="flex" style={{ gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <div style={{ width: 140 }}><NumField label="Hours / day" value={f.hoursPerDay} onChange={(v) => set({ hoursPerDay: v })} placeholder="6" disabled={disabled || overrideMode} hint="default 6" tip="Productive delivery hours in one working day, after standing overhead (stand-ups, email). Default 6 out of an 8-hour day." /></div>
            <div style={{ width: 140 }}><NumField label="Focus factor" value={f.focusFactor} onChange={(v) => set({ focusFactor: v })} placeholder="0.7" disabled={disabled || overrideMode} hint="0–1, e.g. 0.7" tip="The fraction of working time actually spent delivering stories — the rest goes to meetings, reviews and context-switching. Industry range 0.6–0.8. Default 0.7. Enter a fraction (0.7), NOT a percent (70)." /></div>
            <div style={{ width: 140 }}><NumField label="Hours / point" value={f.hoursPerPoint} onChange={(v) => set({ hoursPerPoint: v })} placeholder="6" disabled={disabled || overrideMode} hint="default 6" tip="How many hours one story point typically takes your team. Lower = more capacity. Default 6. Calibrate from past sprints if you know it." /></div>
          </div>
          <div style={{ width: 260 }}>
            {isKanban ? (
              <NumField
                label="Manual capacity (pts/quarter)"
                value={f.pointsPerQuarterOverride}
                onChange={(v) => set({ pointsPerQuarterOverride: v })}
                placeholder="(optional — overrides the team math)"
                disabled={disabled}
                hint="If set, used directly as the expected quarter throughput."
                tip="Already know your team's quarterly throughput? Enter story points per quarter directly and skip all the math above — this overrides the team calculation."
              />
            ) : (
              <NumField
                label="Manual capacity (pts/sprint)"
                value={f.pointsPerSprintOverride}
                onChange={(v) => set({ pointsPerSprintOverride: v })}
                placeholder="(optional — overrides the team math)"
                disabled={disabled}
                hint="If set, used directly instead of the team calculation."
                tip="Already know your team's velocity? Enter story points per sprint directly and skip all the math above — this overrides the team calculation."
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── One sprint column with an accessible capacity meter ─────────────────────────────
function SprintColumn({ sprint, number, byUid, oversizedSet, riskByUid, profile, startDate, sprintLengthDays }) {
  const cap = Number(sprint.capacity) || 0;
  const load = Number(sprint.load) || 0;
  const util = cap > 0 ? load / cap : 0;
  const over = sprint.overCapacity;
  const meterKind = over ? "warning" : util > 0.9 ? "warning" : "success";
  const dateLabel = sprintDates(startDate, number, sprintLengthDays);
  const fragile = !!(profile && profile.fragile);

  return (
    <div style={{ border: `1px solid ${fragile ? "var(--s2j-orange-border)" : "var(--s2j-border)"}`, borderRadius: 10, background: "var(--s2j-bg)", display: "flex", flexDirection: "column", minWidth: 200, flex: "1 1 210px" }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--s2j-border)" }}>
        <div className="flex items-center" style={{ justifyContent: "space-between" }}>
          <strong style={{ fontSize: 13, color: "var(--s2j-text)" }}>Sprint {number}</strong>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: over ? "var(--s2j-orange)" : "var(--s2j-text-muted)" }}>
            <SignalIcon kind={meterKind} size={13} title={over ? "Over capacity" : "Within capacity"} />
            {fmt1(load)} / {fmt1(cap)} pts
          </span>
        </div>
        {dateLabel ? <div style={{ fontSize: 10.5, color: "var(--s2j-text-light)", marginTop: 2 }}>{dateLabel}</div> : null}
        {/* capacity bar (secondary signal — the numeric load/cap above is primary) */}
        <div style={{ height: 5, borderRadius: 3, background: "var(--s2j-border)", marginTop: 6, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(100, util * 100)}%`, background: over ? "var(--s2j-orange)" : util > 0.9 ? "var(--s2j-orange)" : "var(--s2j-green)" }} />
        </div>
        {/* risk-heavy meter (Tier-1): a sprint that concentrates high-risk work needs ≥2 high-risk features
            AND a high mean AND a majority of its points high-risk — so a single risky item can't flash it. */}
        {fragile ? (
          <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--s2j-orange)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <SignalIcon kind="warning" size={11} title="Risk-heavy sprint" />
            Risk-heavy — {profile.highRiskCount} high-risk item{profile.highRiskCount === 1 ? "" : "s"}{profile.externalDepCount ? `, ${profile.externalDepCount} external dep` : ""}
          </div>
        ) : null}
        {/* per-skill sub-meters (Tier-2): where the pressure is. Shown only in skill mode, only for buckets
            that carry capacity or load. a11y: SignalIcon + numeric load/cap, never colour-alone. */}
        {sprint.bucketCapacity ? (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
            {SKILL_METER_ORDER.filter((k) => (Number(sprint.bucketCapacity[k]) || 0) > 0 || (Number(sprint.bucketLoad && sprint.bucketLoad[k]) || 0) > 0).map((k) => {
              const bc = Number(sprint.bucketCapacity[k]) || 0;
              const bl = Number(sprint.bucketLoad && sprint.bucketLoad[k]) || 0;
              const bover = bl > bc + 1e-9;
              const bu = bc > 0 ? bl / bc : (bl > 0 ? 1 : 0);
              return (
                <div key={k} className="flex items-center" style={{ gap: 4, fontSize: 10 }}>
                  <SignalIcon kind={bover || bu > 0.9 ? "warning" : "success"} size={9} title={skillLabel(k)} />
                  <span style={{ width: 56, color: "var(--s2j-text-muted)", textTransform: "capitalize" }}>{skillLabel(k)}</span>
                  <span style={{ color: bover ? "var(--s2j-orange)" : "var(--s2j-text-light)" }}>{fmt1(bl)} / {fmt1(bc)}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
        {sprint.ids.length === 0 ? (
          <span style={{ fontSize: 11.5, color: "var(--s2j-text-light)", fontStyle: "italic" }}>Free capacity</span>
        ) : (
          sprint.ids.map((id) => <FeatureChip key={id} feat={byUid.get(id)} id={id} oversized={oversizedSet.has(id)} risk={riskByUid && riskByUid.get(id)} />)
        )}
      </div>
    </div>
  );
}

function FeatureChip({ feat, id, oversized, risk }) {
  const name = (feat && feat.name) || id;
  const sp = feat && feat.story_points;
  const tint = PRIORITY_TINT[feat && feat.priority] || PRIORITY_TINT.Low;
  // a compact corner marker for a flagged feature (high/medium risk or external-dep/low-confidence); the
  // full reasons live in the Risk register below (chips stay scannable). Worst signal wins the icon.
  const flagged = isRiskFlagged(risk);
  const markKind = risk && risk.risk_level === "high" ? "error" : "warning";
  const markTitle = flagged ? riskReasons(risk).map((r) => r.text).join(" · ") : "";
  return (
    <div style={{ border: `1px solid ${tint.border}`, background: tint.bg, borderRadius: 6, padding: "6px 8px" }}>
      <div className="flex items-center" style={{ justifyContent: "space-between", gap: 6 }}>
        <span style={{ fontSize: 12, color: "var(--s2j-text)", lineHeight: 1.3, wordBreak: "break-word" }}>{name}</span>
        <span className="flex items-center" style={{ gap: 4, flexShrink: 0 }}>
          {flagged ? <SignalIcon kind={markKind} size={11} title={markTitle} /> : null}
          {sp != null ? <span style={{ fontSize: 10.5, fontWeight: 700, color: tint.fg }}>{sp}</span> : null}
        </span>
      </div>
      {oversized ? (
        <div style={{ fontSize: 10, color: "var(--s2j-orange)", marginTop: 3, display: "inline-flex", alignItems: "center", gap: 3 }}>
          <SignalIcon kind="warning" size={11} /> larger than one sprint — split it
        </div>
      ) : null}
    </div>
  );
}

// Async-batch wait state — the ranking runs on Anthropic's Batch API (minutes), so we show a spinner +
// live timer + "you can leave" reassurance, mirroring the breakdown GeneratingScreen.
function PlanningState({ elapsed, kanban }) {
  const e = Number(elapsed) || 0;
  const mins = Math.floor(e / 60);
  const secs = e % 60;
  return (
    <div style={{ border: "1px dashed var(--s2j-border)", borderRadius: 10, padding: 32, textAlign: "center" }}>
      <div className="animate-spin" style={{ width: 48, height: 48, margin: "0 auto 14px", borderRadius: "50%", border: "3px solid var(--s2j-border)", borderTopColor: "var(--s2j-blue)" }} />
      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--s2j-text)", margin: "0 0 4px" }}>{kanban ? "Claude is ordering your backlog…" : "Claude is planning your sprints…"}</p>
      <p style={{ fontSize: 12.5, color: "var(--s2j-text-muted)", margin: "0 0 8px", lineHeight: 1.5 }}>
        Ordering the backlog by dependencies, leverage and business value. This runs on Anthropic's
        Batch API and usually takes a few minutes.
      </p>
      <p style={{ fontSize: 13, fontFamily: "monospace", color: "var(--s2j-text-light)", margin: 0 }}>{mins}:{String(secs).padStart(2, "0")}</p>
      <p style={{ fontSize: 11.5, color: "var(--s2j-text-light)", margin: "10px 0 0", lineHeight: 1.5 }}>
        You can leave this screen — the plan finishes on its own and will be here when you come back.
      </p>
    </div>
  );
}

// Live "computed capacity" line — makes the derived pts/sprint + the focus-factor sensitivity legible
// at INPUT time (the 2026-06-20 finding: a 0.7→0.5 focus change swings capacity ~29% and the user
// couldn't see why). Shows the counterfactual at the default 0.7 so the lever's weight is obvious.
function CapacityPreview({ preview, form }) {
  const perSprint = preview.perSprintCapacityPoints[0];
  const sprints = preview.perSprintCapacityPoints.length;
  const total = preview.totalCapacityPoints;
  const ff = Number(form && form.focusFactor) || 0.7;
  const override = form && form.pointsPerSprintOverride !== undefined && form.pointsPerSprintOverride !== "" && form.pointsPerSprintOverride !== null;
  const atDefault = !override && ff > 0 ? (perSprint / ff) * 0.7 : null; // focus factor scales capacity linearly
  return (
    <div style={{ marginTop: 10, border: "1px solid var(--s2j-blue-border)", background: "var(--s2j-blue-bg)", borderRadius: 8, padding: "8px 12px" }}>
      <div style={{ fontSize: 13, color: "var(--s2j-text)" }}>
        Computed capacity: <strong>≈ {fmt1(perSprint)} pts / sprint</strong> · ~{fmt1(total)} pts total over {sprints} sprint{sprints === 1 ? "" : "s"}
      </div>
      {atDefault != null && Math.abs(ff - 0.7) > 1e-9 ? (
        <div style={{ fontSize: 11, color: "var(--s2j-text-muted)", marginTop: 3, lineHeight: 1.5 }}>
          At focus factor {ff} — this would be ~{fmt1(atDefault)} pts/sprint at the default 0.7. Focus factor scales capacity directly, so it's your single biggest lever.
        </div>
      ) : null}
      {/* Tier-2: the per-skill split, visible at INPUT time (so the bucket capacities aren't a surprise) */}
      {preview.bucketsActive && preview.perSprintBucketCapacity ? (
        <div style={{ fontSize: 11, color: "var(--s2j-text-muted)", marginTop: 4, lineHeight: 1.5 }}>
          Per skill / sprint:{" "}
          {SKILL_METER_ORDER.filter((k) => (Number(preview.perSprintBucketCapacity[k] && preview.perSprintBucketCapacity[k][0]) || 0) > 0).map((k) => `${skillLabel(k)} ≈ ${fmt1(preview.perSprintBucketCapacity[k][0])}`).join(" · ") || "—"}
        </div>
      ) : null}
    </div>
  );
}

// Kanban live preview — the THROUGHPUT range (never a single reach number as the headline). Mirrors
// CapacityPreview's pattern but reads the kanban preview shape (expectedPointsQuarter / conservative /
// optimistic). The same computeThroughput the plan uses backs it, so it can't drift (the preview guarantee).
function KanbanCapacityPreview({ preview, form }) {
  const expected = fmt1(preview.expectedPointsQuarter);
  const cons = fmt1(preview.conservativePoints);
  const opt = fmt1(preview.optimisticPoints);
  const ff = Number(form && form.focusFactor) || 0.7;
  const override = form && form.pointsPerQuarterOverride !== undefined && form.pointsPerQuarterOverride !== "" && form.pointsPerQuarterOverride !== null;
  return (
    <div style={{ marginTop: 10, border: "1px solid var(--s2j-blue-border)", background: "var(--s2j-blue-bg)", borderRadius: 8, padding: "8px 12px" }}>
      <div style={{ fontSize: 13, color: "var(--s2j-text)" }}>
        Expected ≈ <strong>{expected} pts</strong> this quarter · likely reach <strong>{cons}–{opt} pts</strong> (conservative–optimistic)
      </div>
      {!override && Math.abs(ff - 0.7) > 1e-9 ? (
        <div style={{ fontSize: 11, color: "var(--s2j-text-muted)", marginTop: 3, lineHeight: 1.5 }}>
          At focus factor {ff} — focus factor scales throughput directly, so it's your single biggest lever.
        </div>
      ) : null}
      <div style={{ fontSize: 10.5, color: "var(--s2j-text-light)", marginTop: 4, lineHeight: 1.5 }}>
        A forecast, not a target — it sharpens once the team has real flow history.
      </div>
      {/* live warnings (deep-audit G4): clamp / duplicate-name / override-discrepancy surfaced AT PREVIEW time
          — the cheapest place to catch the most-likely Kanban data-entry mistake (per-sprint days in the
          per-quarter field), instead of only after a billed Generate. */}
      {Array.isArray(preview.warnings) && preview.warnings.length ? (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
          {preview.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: "var(--s2j-orange)", display: "inline-flex", alignItems: "flex-start", gap: 4, lineHeight: 1.5 }}>
              <SignalIcon kind="warning" size={11} /> <span>{w && w.message ? w.message : String(w)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Spec-wide concerns band (SN-3) — plan-LEVEL risk/compliance posture, never attributed to a feature ──
function SpecConcernsBand({ summary }) {
  if (!summary || !summary.total) return null;
  const items = Array.isArray(summary.items) ? summary.items : [];
  const hasCompliance = summary.complianceCount > 0;
  // a compliance concern raises the bar (legal/audit) → warning; otherwise informational context.
  const kind = hasCompliance ? "warning" : "info";
  const title = hasCompliance
    ? `Spec-wide concerns — ${summary.complianceCount} compliance (${summary.total} total)`
    : `Spec-wide concerns (${summary.total})`;
  return (
    <SignalCallout kind={kind} title={title} style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, color: "var(--s2j-text-muted)", marginBottom: items.length ? 6 : 0, lineHeight: 1.5 }}>
        These apply to the whole backlog — weigh them when committing to dates; they aren’t tied to one feature.
      </div>
      {items.length ? (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {items.slice(0, 6).map((c, i) => (
            <li key={i} style={{ marginBottom: 2, fontSize: 12 }}>
              {c.type && c.type !== "NOTE" ? <span style={{ fontWeight: 600 }}>[{c.type}]</span> : null} {c.text}
            </li>
          ))}
          {items.length > 6 ? <li style={{ fontSize: 11.5, color: "var(--s2j-text-light)", listStyle: "none", marginLeft: -18 }}>…and {items.length - 6} more in the breakdown.</li> : null}
        </ul>
      ) : null}
    </SignalCallout>
  );
}

// ── Risk register — the decision-grade list of flagged features (sorted by risk), with WHY + where ──
// `kanban` true → the WHERE-tag reads the reach tier (Now/Next/Later), never "Sprint N" (task-5).
function RiskRegister({ entries, usedLlm, kanban }) {
  if (!entries || !entries.length) return null;
  return (
    <div style={{ border: "1px solid var(--s2j-border)", borderRadius: 10, background: "var(--s2j-bg)", padding: 12, marginBottom: 12 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
        <SignalIcon kind="warning" size={15} />
        <strong style={{ fontSize: 13, color: "var(--s2j-text)" }}>Risk register ({entries.length})</strong>
      </div>
      {/* honesty (§11): only claim Claude re-sequenced by risk when it actually ran — the deterministic
          fallback order ignores risk, so the register is a watch-list, not a "nudged-earlier" claim. */}
      <p style={{ fontSize: 11, color: "var(--s2j-text-muted)", margin: "0 0 10px", lineHeight: 1.5 }}>
        {usedLlm
          ? "Features carrying delivery risk — Claude was nudged to sequence these earlier so problems surface sooner. "
          : "Features carrying delivery risk — the order fell back to dependencies + priority (Claude was unavailable), so these were not re-sequenced by risk. "}
        Front-load discovery, line up external dependencies, and tighten low-confidence specs before {kanban ? "they come up for pull" : "the sprint they land in"}.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.map((e) => {
          const reasons = riskReasons(e);
          const name = e.name || e.id;
          return (
            <div key={e.id} style={{ border: "1px solid var(--s2j-border)", borderRadius: 8, padding: "7px 10px", background: "var(--s2j-bg-section)" }}>
              <div className="flex items-center" style={{ justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 12.5, color: "var(--s2j-text)", fontWeight: 500, wordBreak: "break-word" }}>{name}</span>
                <span style={{ fontSize: 10.5, color: "var(--s2j-text-light)", flexShrink: 0 }}>
                  {registerWhereLabel(e, kanban)}
                </span>
              </div>
              <div className="flex" style={{ gap: 6, flexWrap: "wrap", marginTop: 5 }}>
                {reasons.map((r, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, color: "var(--s2j-text-muted)", border: "1px solid var(--s2j-border)", borderRadius: 999, padding: "1px 7px", background: "var(--s2j-bg)" }}>
                    <SignalIcon kind={r.kind} size={10} /> {r.text}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── KANBAN: the Now / Next / Later backlog band (replaces the sprint columns for methodology=kanban) ──
// A pull-ready, dependency-legal ordered backlog cut into three confidence tiers, with VISIBLE reach lines
// (the conservative / optimistic thresholds) between them. Later is SHOWN, never hidden — so the scope
// trade-off is negotiable (research). Each tier reuses FeatureChip (name + SP + priority tint + risk mark).
function BacklogSection({ title, subtitle, kind, rows, subtotal, byUid, riskByUid, empty }) {
  return (
    <div style={{ border: `1px solid var(--s2j-border)`, borderRadius: 10, background: "var(--s2j-bg)", marginBottom: 10 }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--s2j-border)" }}>
        <div className="flex items-center" style={{ justifyContent: "space-between", gap: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--s2j-text)" }}>
            <SignalIcon kind={kind} size={13} /> {title}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--s2j-text-muted)", flexShrink: 0 }}>
            {rows.length} item{rows.length === 1 ? "" : "s"} · {fmt1(subtotal)} pts
          </span>
        </div>
        {subtitle ? <div style={{ fontSize: 10.5, color: "var(--s2j-text-light)", marginTop: 2 }}>{subtitle}</div> : null}
      </div>
      <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.length === 0 ? (
          <span style={{ fontSize: 11.5, color: "var(--s2j-text-light)", fontStyle: "italic" }}>{empty}</span>
        ) : (
          rows.map((row) => <FeatureChip key={row.id} feat={byUid.get(row.id)} id={row.id} oversized={false} risk={riskByUid && riskByUid.get(row.id)} />)
        )}
      </div>
    </div>
  );
}

// The labeled reach divider between two bands (a11y: it's text, not colour) — "— conservative reach ≈ X pts —".
function ReachLine({ label, pts }) {
  return (
    <div className="flex items-center" style={{ gap: 8, margin: "2px 0 10px" }}>
      <span style={{ flex: 1, height: 1, background: "var(--s2j-border)" }} />
      <span style={{ fontSize: 10.5, color: "var(--s2j-text-muted)", whiteSpace: "nowrap" }}>— {label} ≈ {fmt1(pts)} pts —</span>
      <span style={{ flex: 1, height: 1, background: "var(--s2j-border)" }} />
    </div>
  );
}

function BacklogBand({ plan, byUid, riskByUid }) {
  const m = plan.metrics || {};
  const now = Array.isArray(plan.now) ? plan.now : [];
  const next = Array.isArray(plan.next) ? plan.next : [];
  const later = Array.isArray(plan.later) ? plan.later : [];
  const sub = (arr) => arr.reduce((a, r) => a + (Number(r.points) || 0), 0);
  return (
    <div style={{ marginBottom: 12 }}>
      <BacklogSection
        title="Now — high confidence" subtitle="Likely delivered this quarter — pull these first." kind="success"
        rows={now} subtotal={m.reachedNowPoints != null ? m.reachedNowPoints : sub(now)} byUid={byUid} riskByUid={riskByUid}
        empty="Nothing reaches high confidence yet — raise capacity or split the earliest items."
      />
      <ReachLine label="conservative reach" pts={m.conservativePoints} />
      <BacklogSection
        title="Next — stretch (might fit)" subtitle="Within optimistic reach — a stretch, not a commitment." kind="warning"
        rows={next} subtotal={sub(next)} byUid={byUid} riskByUid={riskByUid}
        empty="No stretch items in this band."
      />
      <ReachLine label="optimistic reach" pts={m.optimisticPoints} />
      <BacklogSection
        title="Later — beyond this quarter’s likely reach" subtitle="Shown so the scope trade-off is negotiable — defer, descope, or add capacity." kind="info"
        rows={later} subtotal={m.beyondReachPoints != null ? m.beyondReachPoints : sub(later)} byUid={byUid} riskByUid={riskByUid}
        empty="The whole backlog is within optimistic reach — nothing beyond this quarter."
      />
    </div>
  );
}

// ── KANBAN honesty panel (load-bearing — THIS is the product per the research) ──────────────────────
// Renders the band framings + the backend-echoed assumptions + the upgrade path, in the SignalCallout info
// style. NEVER says "will deliver" — uses "likely reach this quarter" + "a forecast, not a target/commitment".
function KanbanHonestyPanel({ assumptions }) {
  const asm = (Array.isArray(assumptions) ? assumptions : []).filter((a) => a && a.label);
  return (
    <SignalCallout kind="info" title="How to read this plan — a forecast, not a commitment" style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: "var(--s2j-text)", lineHeight: 1.55 }}>
        <p style={{ margin: "0 0 6px" }}>
          This is the <strong>likely reach this quarter</strong> — a forecast, not a target or a commitment. The backlog
          is dependency-legal and pull-ready; pull from the top.
        </p>
        <ul style={{ margin: "0 0 6px", paddingLeft: 18 }}>
          <li style={{ marginBottom: 2 }}><strong>Now</strong> — high confidence (within conservative reach).</li>
          <li style={{ marginBottom: 2 }}><strong>Next</strong> — stretch, “might fit” (within optimistic reach).</li>
          <li style={{ marginBottom: 2 }}><strong>Later</strong> — beyond likely reach this quarter, shown so the scope trade-off is negotiable.</li>
        </ul>
        {asm.length ? (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--s2j-text-muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>Assumptions</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {asm.map((a, i) => (
                <li key={i} style={{ marginBottom: 2, fontSize: 11.5, color: "var(--s2j-text-muted)" }}>
                  {a.label}: <span style={{ color: "var(--s2j-text)", fontWeight: 500 }}>{String(a.value)}</span>{a.source === "default" ? " (default)" : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--s2j-text-light)" }}>
          The estimate sharpens once your team has real flow history.
        </p>
      </div>
    </SignalCallout>
  );
}

// ── Defensible Plan Brief (P18) — copy a stakeholder-ready, fully-grounded summary out of the iframe ──
// Pure deterministic render (lib/planBrief.js), captured in-memory → purge-safe, $0, instant. Three
// formats: Markdown (pastes clean into Confluence/Jira/Slack), plain text, and the allocation CSV.
function PlanBriefExport({ brief }) {
  const [md, setMd] = useState("idle");
  const [txt, setTxt] = useState("idle");
  const [csv, setCsv] = useState("idle");
  if (!brief) return null;
  const doCopy = async (text, set, filename) => {
    const ok = await copyPlanText(text || "", filename);
    set(ok ? "ok" : "fail");
    setTimeout(() => set("idle"), 1800);
  };
  const label = (s, base) => (s === "ok" ? "Copied" : s === "fail" ? "Copy failed — check permissions" : base);
  const btn = { background: "var(--s2j-bg)", border: "1px solid var(--s2j-border)", color: "var(--s2j-text)", cursor: "pointer", padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500 };
  return (
    <div style={{ border: "1px solid var(--s2j-border)", borderRadius: 10, background: "var(--s2j-bg-section)", padding: "10px 12px", marginBottom: 12 }}>
      <div className="flex items-center" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--s2j-text)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <SignalIcon kind="info" size={13} /> Plan brief — copy a stakeholder-ready summary
        </span>
        <span className="flex" style={{ gap: 6, flexWrap: "wrap" }}>
          <button type="button" style={btn} onClick={() => doCopy(brief.markdown, setMd, "plan-brief.md")}>{label(md, "Copy (Markdown)")}</button>
          <button type="button" style={btn} onClick={() => doCopy(brief.plainText, setTxt, "plan-brief.txt")}>{label(txt, "Copy (plain)")}</button>
          <button type="button" style={btn} onClick={() => doCopy(brief.csv, setCsv, "plan-allocation.csv")}>{label(csv, "Copy allocation (CSV)")}</button>
        </span>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--s2j-text-light)", marginTop: 6, lineHeight: 1.5 }}>
        Every line traces to a number this plan computed — capacity, what fits, what doesn’t & why, risks, assumptions. No AI prose, nothing sent anywhere.
      </div>
    </div>
  );
}

// ── What-if scenarios (P20) — explore "add a sprint / lower focus / defer X" with ZERO billed re-rank ──
// A pure diff over the FREE re-pack (previewWhatIf re-packs the CACHED Claude ordering; it does NOT re-ask
// Claude). Debounced like CapacityPreview. Honesty: a banner states the ordering is frozen; deferrals are
// preview-only (a real scope change → routed to the editor, never silently mutated). a11y: every delta is
// icon + signed words, never colour-alone.
function DeltaPill({ label, value, goodWhenNegative, unit }) {
  const v = Number(value) || 0;
  if (Math.abs(v) < 1e-9) {
    return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--s2j-text-muted)", border: "1px solid var(--s2j-border)", borderRadius: 999, padding: "2px 9px" }}><SignalIcon kind="info" size={10} /> {label}: no change</span>;
  }
  const improved = goodWhenNegative ? v < 0 : v > 0;
  const kind = improved ? "success" : "warning";
  const sign = v > 0 ? "+" : "−";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--s2j-text)", border: `1px solid ${improved ? "var(--s2j-green-border)" : "var(--s2j-orange-border)"}`, background: improved ? "var(--s2j-green-bg)" : "var(--s2j-orange-bg)", borderRadius: 999, padding: "2px 9px" }}>
      <SignalIcon kind={kind} size={10} /> {label}: {sign}{fmt1(Math.abs(v))}{unit || ""}
    </span>
  );
}

function WhatIfPanel({ jobId, baselineForm, slimFeatures, stale, planBusy, onApplyScenario }) {
  const [open, setOpen] = useState(false);
  const [sprintDelta, setSprintDelta] = useState(0);
  const [focus, setFocus] = useState(""); // "" = baseline; otherwise an override
  const [deferred, setDeferred] = useState(() => new Set());
  const [deferOpen, setDeferOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const baseSprints = Number(baselineForm && baselineForm.sprintCount) || 0;
  const baseFocus = (baselineForm && baselineForm.focusFactor) || 0.7;
  // numeric compare so a re-typed-but-equal focus (e.g. baseline "0.70", typed "0.7") isn't a no-op "change"
  const focusChanged = focus !== "" && Number.isFinite(Number(focus)) && Number(focus) !== Number(baseFocus);
  const active = sprintDelta !== 0 || focusChanged || deferred.size > 0;
  const nameOf = (id) => { const f = (slimFeatures || []).find((x) => x && x._uid === id); return (f && f.name) || id; };

  const reset = () => { setSprintDelta(0); setFocus(""); setDeferred(new Set()); setPreview(null); };
  const toggleDefer = (uid) => setDeferred((prev) => { const n = new Set(prev); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });

  // debounced previewWhatIf — read-only, no spend; mirrors the CapacityPreview cancelled-flag pattern.
  useEffect(() => {
    if (!open || !active || stale) { setPreview(null); return undefined; }
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(() => {
      invoke("previewWhatIf", { jobId, scenario: { sprintCountDelta: sprintDelta, focusFactor: focus || null, deferredUids: [...deferred] } })
        .then((res) => { if (!cancelled) { setPreview(res || null); setBusy(false); } })
        .catch(() => { if (!cancelled) { setPreview(null); setBusy(false); } });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, active, stale, jobId, sprintDelta, focus, deferred]);

  const d = preview && preview.ok ? preview.delta : null;
  const capErr = preview && preview.ok === false && preview.stage === "capacity";
  const canApplyCapacity = (sprintDelta !== 0 || focusChanged) && !planBusy && !stale;

  return (
    <div style={{ border: "1px solid var(--s2j-border)", borderRadius: 10, background: "var(--s2j-bg)", marginBottom: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--s2j-text)" }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <IconRefresh size={14} /> What if… <span style={{ fontWeight: 400, color: "var(--s2j-text-muted)", fontSize: 11.5 }}>— explore changes free, no re-rank</span>
        </span>
        <span style={{ color: "var(--s2j-text-muted)", fontSize: 12 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div style={{ padding: "0 12px 12px" }}>
          {stale ? (
            <SignalCallout kind="warning" title="Plan is out of date" style={{ marginBottom: 10 }}>
              Re-rank against the current breakdown before exploring scenarios.
            </SignalCallout>
          ) : null}

          {/* controls */}
          <div className="flex" style={{ gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
            <div>
              <span style={labelStyle}>Sprints</span>
              <div className="flex items-center" style={{ gap: 6 }}>
                <button type="button" disabled={baseSprints + sprintDelta <= 1} onClick={() => setSprintDelta((x) => x - 1)} style={{ width: 26, height: 26, border: "1px solid var(--s2j-border)", borderRadius: 6, background: "var(--s2j-bg)", color: "var(--s2j-text)", cursor: "pointer" }}>−</button>
                <span style={{ fontSize: 13, minWidth: 64, textAlign: "center" }}>{baseSprints} → <strong>{baseSprints + sprintDelta}</strong></span>
                <button type="button" onClick={() => setSprintDelta((x) => x + 1)} style={{ width: 26, height: 26, border: "1px solid var(--s2j-border)", borderRadius: 6, background: "var(--s2j-bg)", color: "var(--s2j-text)", cursor: "pointer" }}>+</button>
              </div>
            </div>
            <div style={{ width: 150 }}>
              <span style={labelStyle}>Focus factor</span>
              <input type="text" inputMode="decimal" value={focus} placeholder={`baseline ${baseFocus}`} onChange={(e) => setFocus(e.target.value)} style={fieldStyle} />
            </div>
            <button type="button" onClick={() => setDeferOpen((o) => !o)} className="text-xs" style={{ background: "none", border: "1px dashed var(--s2j-border)", color: "var(--s2j-blue)", cursor: "pointer", padding: "6px 10px", borderRadius: 6 }}>
              {deferOpen ? "▾" : "▸"} Defer features{deferred.size ? ` (${deferred.size})` : ""}
            </button>
            {active ? <button type="button" onClick={reset} className="text-xs" style={{ background: "none", border: "none", color: "var(--s2j-text-muted)", cursor: "pointer", textDecoration: "underline" }}>Reset</button> : null}
          </div>

          {/* defer checklist */}
          {deferOpen ? (
            <div style={{ border: "1px solid var(--s2j-border)", borderRadius: 8, padding: 8, marginBottom: 10, maxHeight: 160, overflowY: "auto" }}>
              {(slimFeatures || []).map((f) => f && f._uid ? (
                <label key={f._uid} className="flex items-center" style={{ gap: 6, fontSize: 12, padding: "2px 0", cursor: "pointer" }}>
                  <input type="checkbox" checked={deferred.has(f._uid)} onChange={() => toggleDefer(f._uid)} />
                  <span style={{ color: "var(--s2j-text)" }}>{f.name}{f.story_points != null ? ` (${f.story_points})` : ""}</span>
                </label>
              ) : null)}
            </div>
          ) : null}

          {/* honesty banner — the frozen-ordering truth */}
          <div style={{ fontSize: 10.5, color: "var(--s2j-text-light)", marginBottom: 10, lineHeight: 1.5 }}>
            Previews re-pack the <strong>same Claude ordering</strong> against new numbers — they don’t re-ask Claude.
            Re-rank with Claude to re-optimize the order itself.
          </div>

          {/* result */}
          {!active ? (
            <div style={{ fontSize: 12, color: "var(--s2j-text-muted)" }}>Nudge a control to preview the impact.</div>
          ) : capErr ? (
            <SignalCallout kind="error" title="Scenario input invalid">
              {(preview.capacityErrors || []).map((e, i) => <div key={i}>{e.message}</div>)}
            </SignalCallout>
          ) : preview && preview.empty ? (
            <SignalCallout kind="info" title="Nothing left to plan">{preview.detail}</SignalCallout>
          ) : busy && !d ? (
            <div style={{ fontSize: 12, color: "var(--s2j-text-light)" }}>Computing…</div>
          ) : d ? (
            <div>
              {/* delta strip */}
              <div className="flex" style={{ gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                <DeltaPill label="Capacity" value={d.capacityDelta} goodWhenNegative={false} unit=" pts" />
                <DeltaPill label="Deficit" value={d.deficitDelta} goodWhenNegative={true} unit=" pts" />
                <DeltaPill label="Overflow" value={d.overflowCountDelta} goodWhenNegative={true} />
                <DeltaPill label="Fragile sprints" value={d.fragileDelta} goodWhenNegative={true} />
              </div>
              {/* Tier-2: the per-skill shortfall — explains the Overflow when a skill bucket (not total capacity)
                  is the binding constraint, so "Deficit: no change" next to overflow isn't a contradiction. */}
              {Array.isArray(d.bucketShortfall) && d.bucketShortfall.length ? (
                <div style={{ fontSize: 11, color: "var(--s2j-orange)", marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 4, lineHeight: 1.5 }}>
                  <SignalIcon kind="warning" size={11} />
                  Short on {d.bucketShortfall.map((x) => `${skillLabel(x.bucket)} (${fmt1(x.shortfall)} pts)`).join(", ")} — a skill is the constraint, not total capacity.
                </div>
              ) : null}
              {/* honesty: deferring a blocker orphans its dependents (treated as unblocked here) — surface it */}
              {Array.isArray(d.newlyDangling) && d.newlyDangling.length ? (
                <SignalCallout kind="warning" title="A deferral left a dependency unsatisfied" style={{ marginBottom: 8 }}>
                  {d.newlyDangling.map((x) => `“${x.name}” → “${x.missingDep}”`).join("; ")} — the deferred feature was a dependency, so it’s treated as unblocked in this preview. Removing it for real may need re-sequencing.
                </SignalCallout>
              ) : null}

              {/* movement lists */}
              {d.newlyFits.length ? <DeltaList kind="success" title={`Now fits (${d.newlyFits.length})`} items={d.newlyFits.map((x) => `${nameOf(x.id)} → Sprint ${x.sprint}`)} /> : null}
              {d.newlyOverflows.length ? <DeltaList kind="warning" title={`No longer fits (${d.newlyOverflows.length})`} items={d.newlyOverflows.map((x) => `${nameOf(x.id)} — ${overflowReasonText(x, nameOf)}`)} /> : null}
              {d.moved.length ? <DeltaList kind="info" title={`Moved sprint (${d.moved.length})`} items={d.moved.map((x) => `${nameOf(x.id)}: Sprint ${x.from} → ${x.to}`)} /> : null}
              {d.deferred.length ? <DeltaList kind="info" title={`Deferred (${d.deferred.length})`} items={d.deferred.map((x) => nameOf(x.id))} /> : null}

              {/* apply / defer-note */}
              <div className="flex items-center" style={{ gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                {canApplyCapacity ? (
                  <button type="button" onClick={() => { const patch = {}; if (sprintDelta !== 0) patch.sprintCount = baseSprints + sprintDelta; if (focusChanged) patch.focusFactor = focus; onApplyScenario(patch); reset(); }} style={{ background: "var(--s2j-blue)", border: "none", color: "#fff", cursor: "pointer", padding: "7px 12px", borderRadius: 7, fontSize: 12.5, fontWeight: 600 }}>
                    Apply capacity change (free re-pack)
                  </button>
                ) : null}
                {deferred.size ? (
                  <span style={{ fontSize: 10.5, color: "var(--s2j-text-light)", lineHeight: 1.5 }}>
                    Deferrals are preview-only — to drop a feature for real, remove it in the editor.
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DeltaList({ kind, title, items }) {
  if (!items || !items.length) return null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--s2j-text)", display: "inline-flex", alignItems: "center", gap: 4 }}>
        <SignalIcon kind={kind} size={11} /> {title}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--s2j-text-muted)", marginTop: 2, marginLeft: 16 }}>{items.join(" · ")}</div>
    </div>
  );
}

// ── Skill bottleneck (Tier-2) — the honest "you're short BACKEND while QA sits idle" headline ──
function SkillBottleneck({ bucketMetrics }) {
  if (!bucketMetrics) return null;
  // overDemand = the GENUINE per-skill shortfall (own demand − own capacity) — NOT unmet (which over-counts
  // demand blocked behind a SIBLING skill's shortage on an atomic feature; that skill may sit idle).
  const short = (k) => (bucketMetrics.overDemand && bucketMetrics.overDemand[k]) || 0;
  const bottleneck = (bucketMetrics.bottleneckBuckets || []).filter((k) => short(k) > 0.05);
  if (!bottleneck.length) return null; // only worth a callout when a skill is genuinely beyond capacity
  const idle = (bucketMetrics.idle || []).filter((x) => x.freePoints > 0.05);
  return (
    <SignalCallout kind="warning" title={`Short on ${bottleneck.map(skillLabel).join(" + ")} capacity`} style={{ marginBottom: 12 }}>
      {bottleneck.map((k) => `${fmt1(short(k))} ${skillLabel(k)} pts beyond capacity`).join("; ")}.
      {idle.length ? ` Meanwhile ${idle.map((x) => `${fmt1(x.freePoints)} ${skillLabel(x.bucket)}`).join(", ")} pts of capacity sit idle.` : ""}
      {" "}Re-balance the team toward {bottleneck.map(skillLabel).join(" / ")}, or descope that work.
    </SignalCallout>
  );
}

// ── Skill diagnostics (Tier-2) — disjoint typed channels, never silent ──
function SkillDiagnostics({ skillDiagnostics }) {
  if (!skillDiagnostics) return null;
  const unc = skillDiagnostics.unclassified || [];
  const unk = skillDiagnostics.unknownTaskTypes || [];
  if (!unc.length && !unk.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
      {unc.length ? (
        <SignalCallout kind="info" title={`No recognizable skill (${unc.length})`}>
          {unc.map((u) => u.name || u.id).join(", ")} — their task types don’t map to a skill, so they’re planned against the generalist pool. Add task types in the editor for accurate per-skill planning.
        </SignalCallout>
      ) : null}
      {unk.length ? (
        <SignalCallout kind="info" title={`Unrecognized task type (${unk.length})`}>
          {unk.map((u) => `“${u.name || u.id}” (${(u.types || []).join(", ")})`).join("; ")} — outside the standard task-type set, so they didn’t map to a skill.
        </SignalCallout>
      ) : null}
    </div>
  );
}

export default function PlanScreen({
  featureCount, slimFeatures, form, result, busy, estimate, armed, elapsed, pageTitle, jobId, onArmToggle, onFormChange, onGenerate, onRepack, onApplyScenario, onBack,
}) {
  // SELF-DESCRIBING DISPLAY (reload fix 2026-06-20): every uid→name resolver (byUid, nameOfUid, the brief,
  // the what-if lists) funnels through this. The persisted plan is uid-keyed; on a hard RELOAD the LIVE
  // breakdown (slimFeatures, derived from the in-memory pendingBreakdown/results.breakdown) can be empty or
  // uid-less → names rendered as raw uids. The plan's OWN captured features (result.features, returned by
  // getPlan/repack/finalize) cover every plan uid EXCEPT a disambiguated duplicate-uid feature (plan ids use
  // `uid#i` while record.features keys the plain uid — already surfaced loudly via DUPLICATE_FEATURE_IDS), so
  // prefer them; fall back to the live slim for a fresh plan (no result.features yet) or a legacy plan
  // generated before this fix. NOTE: planSlim (the re-rank input) is deliberately NOT touched — a post-edit
  // Re-rank must still send the LIVE breakdown.
  const nameFeatures = useMemo(
    () => (result && Array.isArray(result.features) && result.features.length ? result.features : (slimFeatures || [])),
    [result, slimFeatures],
  );
  const byUid = useMemo(() => {
    const m = new Map();
    for (const f of nameFeatures) if (f && f._uid) m.set(f._uid, f);
    return m;
  }, [nameFeatures]);

  // Live capacity preview (read-only resolver; NO spend) — debounced as the form is edited so the
  // derived pts/sprint (and the focus-factor sensitivity) is visible BEFORE generating. Uses the SAME
  // pure computeCapacity the plan uses, so the preview can never drift from the real capacity.
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!form) { setPreview(null); return undefined; }
    let cancelled = false;
    const t = setTimeout(() => {
      invoke("previewCapacity", { capacityForm: form })
        .then((res) => { if (!cancelled && res) setPreview(res.ok ? res : null); })
        .catch(() => {});
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form]);

  const r = result || {};
  const plan = r.ok && r.plan ? r.plan : null;
  const capacityErrors = r.ok === false && r.stage === "capacity" ? r.errors || r.capacityErrors : null;
  const keyError = r.ok === false && r.stage === "key" ? r : null;
  // any other ok:false (a backend pipeline throw → stage:'plan', or an invoke rejection) — never silent
  const planError = r.ok === false && r.stage !== "capacity" && r.stage !== "key" ? r : null;
  const assumptions = r.assumptions || [];
  const warnings = r.warnings || [];
  const hasPlan = !!plan;

  const g = plan ? plan.graph || {} : {};
  const metrics = plan ? plan.metrics || {} : {};
  const oversizedSet = useMemo(() => new Set((plan && plan.oversized ? plan.oversized : []).map((o) => o.id)), [plan]);
  const nameOfUid = (id) => (byUid.get(id) && byUid.get(id).name) || id;

  // ⭐ METHODOLOGY BRANCH (Kanban v1): the #1 trap is reading sprint-only fields on a kanban plan (no
  // plan.sprints / overflow / oversized / deficit). Branch FIRST on the plan's OWN methodology (NOT the
  // form's — the rendered plan may pre-date a form toggle). Default 'scrum' so an OLD plan (no methodology
  // field) reads as Scrum. `formIsKanban` drives the FORM/preview (the live, possibly-unsubmitted state).
  const isKanban = (plan && plan.methodology) === "kanban";
  const formIsKanban = (form && form.methodology) === "kanban";
  // The HEADER sits above the PLAN BODY when one exists (→ match the plan's own methodology, not an
  // unsubmitted form toggle), and above the FORM before first generate (→ match the form). Resolves the
  // toggle-without-regenerate contradiction (audit M1) without falsely relabelling a still-Scrum plan body.
  const headerIsKanban = hasPlan ? isKanban : formIsKanban;

  // Tier-1 risk views — all default-GUARDED so a plan cached before the risk layer (no riskByFeature /
  // sprintRiskProfiles / specConcernSummary keys) renders cleanly as "no risk surfaced", never crashes.
  const riskByUid = useMemo(() => new Map(Object.entries((plan && plan.riskByFeature) || {})), [plan]);
  const sprintRiskProfiles = (plan && Array.isArray(plan.sprintRiskProfiles)) ? plan.sprintRiskProfiles : [];
  const specConcernSummary = (plan && plan.specConcernSummary) || null;
  // The register: shared derivation (buildRiskRegister) so the screen + the Plan Brief list the SAME
  // features in the SAME order (BRIEF-DRIFT). nameOfUid resolves the display name from the slim features.
  // buildRiskRegister itself branches on plan.methodology to tag by reach tier (kanban) vs sprint (scrum).
  const riskRegister = useMemo(() => buildRiskRegister(plan, nameOfUid), [plan, byUid]);
  // Capacity verdict (deficit / fragmentation) — Scrum-only (they read plan.sprints + deficit metrics that a
  // kanban plan does NOT have). Guarded so reading them for a kanban plan can't crash (the #1 trap).
  const deficit = plan && !isKanban ? deficitHeadline(metrics, plan.sprints.length) : null;
  const fragmentation = plan && !isKanban ? fragmentationNote(metrics) : null;
  // P12: the objective the CURRENT plan was ranked for (r.objective) vs the form's selection. A mismatch
  // means the form changed but the plan hasn't re-ranked → nudge a billed Re-rank (a free Re-pack keeps the old order).
  const objectiveChanged = hasPlan && form && ((form.objective || "balanced") !== (r.objective || "balanced"));
  // Methodology toggled on an existing plan → the plan body still reflects the OLD mode. A FREE Re-pack switches
  // methodology (the cached ranking is methodology-agnostic — only the packing step changes), so nudge Re-pack,
  // NOT a billed Re-rank (audit M1 — parity with objectiveChanged, but cheaper because order is unchanged).
  const methodologyChanged = hasPlan && form && ((form.methodology || "scrum") !== ((plan && plan.methodology) || "scrum"));

  // P18 Defensible Plan Brief — Scrum-only in v1 (the brief is sprint-shaped; a kanban brief is deferred to
  // v2 per the locked scope). Guarded so renderPlanBrief (which reads plan.sprints) is never called for kanban.
  const brief = useMemo(() => {
    if (!plan || isKanban) return null;
    let when = "";
    try { when = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch (_) { /* date optional */ }
    return renderPlanBrief({
      plan, assumptions: r.assumptions, warnings: r.warnings, cost: r.cost,
      slimFeatures: nameFeatures, form, usedLlm: r.usedLlm, stale: r.stale, pageTitle, generatedAt: when, objective: r.objective,
    });
  }, [result, nameFeatures, form, pageTitle, isKanban]);

  return (
    <div className="p-6" style={WRAP}>
      {/* header */}
      <div className="flex items-center" style={{ gap: 10, marginBottom: 6 }}>
        <button
          type="button"
          onClick={onBack}
          className="text-xs flex items-center gap-1"
          style={{ background: "none", border: "1px solid var(--s2j-border)", color: "var(--s2j-text-muted)", cursor: "pointer", padding: "5px 9px", borderRadius: 6 }}
        >
          <IconArrowLeft size={13} /> Back to review
        </button>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--s2j-text)", margin: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--s2j-blue)" }}>{headerIsKanban ? <IconList size={18} /> : <IconCalendar size={18} />}</span> {headerIsKanban ? "Backlog plan" : "Sprint plan"}
        </h2>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--s2j-text-muted)", marginTop: 0, marginBottom: 16 }}>
        {headerIsKanban
          ? <>Order this breakdown into a pull-ready backlog, cut into Now / Next / Later by how much your team is likely to reach this quarter. Claude orders the work; the reach math is deterministic. Review-only — nothing is written to Jira.</>
          : <>Allocate this breakdown across sprints from your team’s capacity. Claude orders the work; the sprint math is deterministic. Review-only — nothing is written to Jira.</>}
      </p>

      {/* stale banner (UX-1) */}
      {r.stale ? (
        <SignalCallout kind="warning" title="This plan is out of date" style={{ marginBottom: 14 }}>
          The breakdown changed since this plan was generated. Re-rank to refresh it against the current features.
        </SignalCallout>
      ) : null}

      <div className="flex" style={{ gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* LEFT: the capacity form + actions */}
        <div style={{ flex: "1 1 320px", minWidth: 300, maxWidth: 440 }}>
          <CapacityForm form={form} onChange={onFormChange} disabled={busy} />

          {/* Live computed-capacity preview — the derived pts (and the focus-factor sensitivity), visible
              BEFORE generating (transparency for the multiplier-weight finding). Branch on the preview's OWN
              methodology echo: kanban shows the THROUGHPUT RANGE (never a single reach number as headline). */}
          {!busy && preview && preview.ok && preview.methodology === "kanban" && Number.isFinite(Number(preview.expectedPointsQuarter)) ? (
            <KanbanCapacityPreview preview={preview} form={form} />
          ) : !busy && preview && preview.ok && preview.methodology !== "kanban" && Array.isArray(preview.perSprintCapacityPoints) && preview.perSprintCapacityPoints.length ? (
            <CapacityPreview preview={preview} form={form} />
          ) : null}

          {/* capacity validation blockers (CAP-1 — fail-loud, no LLM was spent) */}
          {capacityErrors && capacityErrors.length ? (
            <SignalCallout kind="error" title="Fix the capacity inputs to plan" style={{ marginTop: 12 }}>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {capacityErrors.map((e, i) => <li key={i} style={{ marginBottom: 2 }}>{e.message}</li>)}
              </ul>
            </SignalCallout>
          ) : null}

          {keyError ? (
            <SignalCallout kind="error" title="Anthropic key needed" style={{ marginTop: 12 }}>
              {keyError.detail || "Add your Anthropic API key in Settings to generate a plan."}
            </SignalCallout>
          ) : null}

          {planError ? (
            <SignalCallout kind="error" title="Couldn’t build the plan" style={{ marginTop: 12 }}>
              {planError.detail || "The plan could not be computed — please try again or adjust the breakdown."}
            </SignalCallout>
          ) : null}

          {/* warnings (clamps / duplicate names / override discrepancy / under-utilization) */}
          {warnings && warnings.length ? (
            <SignalCallout kind="info" title="Heads-up" style={{ marginTop: 12 }} iconTitle="Non-blocking notes about your inputs">
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {warnings.map((w, i) => <li key={i} style={{ marginBottom: 2 }}>{w.message}</li>)}
              </ul>
            </SignalCallout>
          ) : null}

          {/* primary action: generate / re-rank (billed) */}
          <div style={{ marginTop: 14 }}>
            {/* P12 — planning objective. Changing it re-weights the ordering → it runs a billed Re-rank
                (the free Re-pack reuses the cached, objective-specific ordering, so it would look stale). */}
            <div style={{ marginBottom: 10 }}>
              <span style={labelStyle}>Planning objective<InfoTip text="What to optimize the ORDER for. Balanced = leverage + priority first (the default). Ship the MVP fastest = a minimal working slice first. Minimize delivery risk = the most uncertain work first. Maximize early value = highest-value work first. It only re-weights the order — it never breaks a dependency. Changing it runs a billed Re-rank with Claude." /></span>
              <select
                value={(form && form.objective) || "balanced"}
                disabled={busy}
                onChange={(e) => onFormChange({ objective: e.target.value })}
                style={fieldStyle}
              >
                <option value="balanced">Balanced (default)</option>
                <option value="mvp">Ship the MVP fastest</option>
                <option value="min_risk">Minimize delivery risk</option>
                <option value="max_value">Maximize early value</option>
              </select>
              {objectiveChanged ? (
                <div style={{ fontSize: 10.5, color: "var(--s2j-orange)", marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4, lineHeight: 1.5 }}>
                  <SignalIcon kind="warning" size={11} /> Objective changed — Re-rank with Claude to apply it (Re-pack keeps the current ordering).
                </div>
              ) : hasPlan ? (
                <div style={{ fontSize: 10.5, color: "var(--s2j-text-light)", marginTop: 4 }}>Changing this re-orders the plan — a billed Re-rank.</div>
              ) : null}
            </div>
            {methodologyChanged ? (
              <div style={{ fontSize: 10.5, color: "var(--s2j-orange)", marginTop: 0, marginBottom: 6, display: "inline-flex", alignItems: "center", gap: 4, lineHeight: 1.5 }}>
                <SignalIcon kind="warning" size={11} /> Planning mode changed — Re-pack (free) to apply it.
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => {
                // BOTH first-generate AND re-rank are billed Anthropic calls → 2-step armed confirm so
                // neither spends on a single click (cost honesty; carries the test-case bill-shock lesson — PLAN-14).
                if (!armed) { onArmToggle(true); return; }
                onArmToggle(false);
                onGenerate();
              }}
              disabled={busy}
              className="flex items-center justify-center gap-2"
              style={{
                width: "100%",
                background: "var(--s2j-blue)",
                border: "none",
                color: "#fff",
                cursor: busy ? "not-allowed" : "pointer",
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? "Planning…" : armed ? (hasPlan ? "Confirm re-rank with Claude" : "Confirm & generate plan") : hasPlan ? "Re-rank with Claude" : <>{formIsKanban ? <IconList size={15} /> : <IconCalendar size={15} />} Generate plan</>}
            </button>

            {/* re-pack (free) — only once a plan exists; assumption-only edits */}
            {hasPlan ? (
              <button
                type="button"
                onClick={onRepack}
                disabled={busy}
                className="flex items-center justify-center gap-2"
                style={{ width: "100%", marginTop: 8, background: "var(--s2j-bg-section)", border: "1px solid var(--s2j-border)", color: "var(--s2j-text)", cursor: busy ? "not-allowed" : "pointer", padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500 }}
              >
                <IconRefresh size={14} /> {formIsKanban ? "Re-pack backlog (free)" : "Re-pack sprints (free)"}
              </button>
            ) : null}

            {/* cost honesty (UX-5): pre-flight estimate before generate; echo after */}
            {!hasPlan && estimate && estimate.upper_usd > 0 ? (
              <p className="text-xs" style={{ marginTop: 8, color: "var(--s2j-text-muted)" }}>
                <IconCost size={12} /> Estimated Anthropic usage:{" "}
                <strong>up to ~{fmtUsd(estimate.upper_usd)}</strong>
                {estimate.expected_usd ? ` (typically ~${fmtUsd(estimate.expected_usd)})` : ""} — billed to your own key, no markup.
              </p>
            ) : null}
            {hasPlan ? (
              <p className="text-xs" style={{ marginTop: 8, color: "var(--s2j-text-muted)" }}>
                <IconCost size={12} />{" "}
                {r.cost && r.cost.total_usd != null
                  ? <>This ranking used <strong>{fmtUsd(r.cost.total_usd)}</strong> of your Anthropic key.</>
                  : "Re-pack is free (no Claude call); Re-rank with Claude is billed to your key."}
                {" "}Adjust capacity and Re-pack as many times as you like — only Re-rank calls Claude.
              </p>
            ) : null}
          </div>

          {/* assumptions echo (every multiplier visible — the trust mechanism). Kanban surfaces these in its
              dedicated honesty panel (right pane) → suppress the left echo here to avoid a duplicate list. */}
          {!isKanban && assumptions && assumptions.length ? (
            <div style={{ marginTop: 14, border: "1px solid var(--s2j-border)", borderRadius: 8, padding: "10px 12px", background: "var(--s2j-bg)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--s2j-text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4 }}>Assumptions</div>
              {assumptions.map((a, i) => (
                <div key={i} className="flex" style={{ justifyContent: "space-between", gap: 8, fontSize: 12, padding: "2px 0" }}>
                  <span style={{ color: "var(--s2j-text-muted)" }}>{a.label}</span>
                  <span style={{ color: "var(--s2j-text)", fontWeight: 500, textAlign: "right" }}>
                    {String(a.value)}{a.source === "default" ? <span style={{ color: "var(--s2j-text-light)", fontWeight: 400 }}> (default)</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* RIGHT: the plan */}
        <div style={{ flex: "2 1 460px", minWidth: 340 }}>
          {busy ? (
            <PlanningState elapsed={elapsed} kanban={formIsKanban} />
          ) : r.empty ? (
            <SignalCallout kind="info" title="No features to plan">
              This breakdown has no features yet. Add features in the editor, then come back to plan.
            </SignalCallout>
          ) : !hasPlan ? (
            <div style={{ border: "1px dashed var(--s2j-border)", borderRadius: 10, padding: 32, textAlign: "center", color: "var(--s2j-text-light)" }}>
              <div style={{ display: "inline-flex", color: "var(--s2j-border)", marginBottom: 8 }}>{formIsKanban ? <IconList size={32} /> : <IconCalendar size={32} />}</div>
              <p style={{ fontSize: 13, margin: 0 }}>
                {formIsKanban
                  ? `Fill in your team capacity and generate a plan to see ${featureCount} features ordered into a Now / Next / Later backlog.`
                  : `Fill in your team capacity and generate a plan to see ${featureCount} features allocated across your sprints.`}
              </p>
            </div>
          ) : isKanban ? (
            // ── KANBAN plan view (methodology=kanban): Now / Next / Later band + the honesty panel ──
            // NO sprint columns, NO overflow bucket, NO what-if, NO brief, NO sprint-capacity / fragile meters
            // (all sprint-shaped → deferred to v2 per the locked scope). The diagnostics + Risk Register +
            // spec-wide concerns channels are REUSED (they're methodology-agnostic).
            <>
              {/* fallback note (LLM unavailable → deterministic order) */}
              {r.llmNote ? (
                <SignalCallout kind="info" title="Ordered without Claude" style={{ marginBottom: 12 }}>{r.llmNote}</SignalCallout>
              ) : null}

              {/* THE HONESTY PANEL (load-bearing — this IS the product per the research) */}
              <KanbanHonestyPanel assumptions={assumptions} />

              {/* grounded reach verdict (shared derivation — no "will deliver", a forecast) */}
              <SignalCallout kind="info" title="Likely reach this quarter" style={{ marginBottom: 12 }}>
                {kanbanReachVerdict(metrics)}
              </SignalCallout>

              {/* spec-wide concerns (plan-level risk/compliance posture — never per-feature) */}
              <SpecConcernsBand summary={specConcernSummary} />

              {/* the Now / Next / Later backlog band, with visible reach lines */}
              <BacklogBand plan={plan} byUid={byUid} riskByUid={riskByUid} />

              {/* risk register — the flagged features, sorted, with WHY + tier (Tier-1; tier-tagged, not sprint) */}
              <RiskRegister entries={riskRegister} usedLlm={r.usedLlm} kanban />

              {/* diagnostics — each its own honest channel, never silent (dangling / unsized / dup / cycles …) */}
              <PlanDiagnostics g={g} sizingIssues={plan.sizingIssues} nameOfUid={nameOfUid} />
            </>
          ) : (
            <>
              {/* P18 — copy a defensible, stakeholder-ready brief out of the iframe */}
              <PlanBriefExport brief={brief} />

              {/* fallback note (LLM unavailable → deterministic order) */}
              {r.llmNote ? (
                <SignalCallout kind="info" title="Ordered without Claude" style={{ marginBottom: 12 }}>{r.llmNote}</SignalCallout>
              ) : null}

              {/* deficit headline (PACK-5 — loud, never silent) */}
              {deficit ? (
                <SignalCallout kind="warning" title={deficit.title} style={{ marginBottom: 12 }}>
                  {deficit.body} Add a sprint, raise capacity, or descope — they’re listed below.
                </SignalCallout>
              ) : null}

              {/* fragmentation note (UX-7) */}
              {fragmentation ? (
                <SignalCallout kind="info" title={fragmentation.title} style={{ marginBottom: 12 }}>
                  {fragmentation.body} Re-rank or adjust sprint length.
                </SignalCallout>
              ) : null}

              {/* skill bottleneck (Tier-2): short on a discipline while another sits idle — the honest headline */}
              <SkillBottleneck bucketMetrics={plan.bucketMetrics} />

              {/* spec-wide concerns (plan-level risk/compliance posture — never per-feature) */}
              <SpecConcernsBand summary={specConcernSummary} />

              {/* sprint columns */}
              <div className="flex" style={{ gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                {plan.sprints.map((s, i) => (
                  <SprintColumn key={i} sprint={s} number={i + 1} byUid={byUid} oversizedSet={oversizedSet} riskByUid={riskByUid} profile={sprintRiskProfiles[i]} startDate={form && form.sprintStartDate} sprintLengthDays={form && form.sprintLengthDays} />
                ))}
              </div>

              {/* overflow bucket (typed reasons) */}
              {plan.overflow && plan.overflow.length ? (
                <div style={{ border: "1px solid var(--s2j-orange-border)", borderRadius: 10, background: "var(--s2j-orange-bg)", padding: 12, marginBottom: 12 }}>
                  <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
                    <SignalIcon kind="warning" size={15} />
                    <strong style={{ fontSize: 13, color: "var(--s2j-text)" }}>Doesn’t fit ({plan.overflow.length})</strong>
                  </div>
                  {plan.overflow.map((o, i) => (
                    <div key={i} style={{ fontSize: 12, color: "var(--s2j-text)", padding: "2px 0" }}>
                      <span style={{ fontWeight: 500 }}>{o.name || nameOfUid(o.id)}</span>
                      <span style={{ color: "var(--s2j-text-muted)" }}>
                        {" — "}{overflowReasonText(o, nameOfUid)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* skill diagnostics (Tier-2): unclassifiable features / unknown task types — never silent.
                  Only in skill mode — a pooled plan never opted into skills, so don't show skill jargon. */}
              {plan.bucketsActive ? <SkillDiagnostics skillDiagnostics={plan.skillDiagnostics} /> : null}

              {/* risk register — the flagged features, sorted, with WHY + where (Tier-1) */}
              <RiskRegister entries={riskRegister} usedLlm={r.usedLlm} />

              {/* what-if scenarios (P20) — explore changes free; no re-rank. HIDDEN while the form methodology is
                  toggled away from the rendered (Scrum) plan: a sprint scenario applied under a kanban form would
                  silently drop the sprint delta (computeThroughput ignores sprintCount) — §11 no silent action.
                  The methodologyChanged nudge directs the user to Re-pack first. (deep-audit G2) */}
              {!methodologyChanged ? (
                <WhatIfPanel jobId={jobId} baselineForm={form} slimFeatures={nameFeatures} stale={r.stale} planBusy={busy} onApplyScenario={onApplyScenario} />
              ) : null}

              {/* diagnostics — each its own honest channel, never silent */}
              <PlanDiagnostics g={g} sizingIssues={plan.sizingIssues} nameOfUid={nameOfUid} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Diagnostics: disjoint typed channels (cycles / dangling / ambiguous / dup / unsized) ──
function PlanDiagnostics({ g, sizingIssues, nameOfUid }) {
  const cyc = g.cyclicNodes || [];
  const dangling = g.danglingRefs || [];
  const ambiguous = g.ambiguousDeps || [];
  const dups = g.duplicateNames || [];
  const dupUids = g.duplicateUids || [];
  const selfd = g.selfDeps || [];
  const unsized = sizingIssues || [];
  const any = cyc.length || dangling.length || ambiguous.length || dups.length || dupUids.length || selfd.length || unsized.length;
  if (!any) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {cyc.length ? (
        <SignalCallout kind="warning" title={`Dependency cycle (${cyc.length} feature${cyc.length === 1 ? "" : "s"})`}>
          {cyc.map(nameOfUid).join(", ")} form a circular dependency. They were sequenced best-effort by breaking the softest edge — review the order.
        </SignalCallout>
      ) : null}
      {unsized.length ? (
        <SignalCallout kind="warning" title={`Unsized — cannot plan (${unsized.length})`}>
          {unsized.map((u) => u.name || nameOfUid(u.id)).join(", ")} — these have no valid story points, so they were left out of the plan. Add points in the editor.
        </SignalCallout>
      ) : null}
      {dangling.length ? (
        <SignalCallout kind="info" title={`Dependency refers to a missing feature (${dangling.length})`}>
          {dangling.map((d) => `“${d.name}” → “${d.missingDep}”`).join("; ")} — the named feature no longer exists, so the link was treated as unblocked.
        </SignalCallout>
      ) : null}
      {ambiguous.length ? (
        <SignalCallout kind="info" title={`Ambiguous dependency (${ambiguous.length})`}>
          {ambiguous.map((a) => `“${a.name}” → “${a.dep}”`).join("; ")} — that name matches more than one feature, so the link was left unbound. Rename to disambiguate.
        </SignalCallout>
      ) : null}
      {dups.length ? (
        <SignalCallout kind="info" title={`Duplicate feature names (${dups.length})`}>
          {dups.map((d) => `“${d.name}” ×${d.count}`).join(", ")} — dependencies pointing at a duplicated name can’t be bound reliably.
        </SignalCallout>
      ) : null}
      {dupUids.length ? (
        <SignalCallout kind="warning" title={`Duplicate internal id (${dupUids.length})`}>
          {dupUids.map((d) => `“${d.name || nameOfUid(d.id)}”`).join(", ")} share an internal id — disambiguated for planning so none is lost. Regenerate the breakdown if this persists.
        </SignalCallout>
      ) : null}
      {selfd.length ? (
        <SignalCallout kind="info" title={`Self-dependency ignored (${selfd.length})`}>
          {selfd.map((s) => `“${s.name || nameOfUid(s.id)}”`).join(", ")} listed itself as a dependency — ignored.
        </SignalCallout>
      ) : null}
    </div>
  );
}
