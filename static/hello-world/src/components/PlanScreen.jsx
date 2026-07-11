import React, { useMemo, useState, useRef, useEffect } from "react";
import { invoke } from "@forge/bridge";
import { SignalIcon, SignalCallout } from "./Signal";
import {
  IconCalendar, IconUsers, IconRefresh, IconCost, IconPlus, IconTrash, IconList, IconChevronDown, IconChevronUp,
} from "./Icon";
// Shared pure view-derivations — the SINGLE source of truth so PlanScreen + the Plan Brief can never
// tell two different stories (§13 gate "BRIEF-DRIFT"). See static/hello-world/src/lib/planView.js.
import {
  fmt1, fmtUsd, sprintDates, riskReasons, isRiskFlagged, buildRiskRegister, registerWhereLabel,
  overflowReasonText, oversizedReasonText, deficitHeadline, fragmentationNote, skillLabel, kanbanReachVerdict,
  capacityVerdict, criticalPathInfo, highestLeverage,
} from "../lib/planView";

const SKILL_METER_ORDER = ["BE", "FE", "QA", "GEN"]; // Tier-2: per-bucket meter order
import { renderPlanBrief } from "../lib/planBrief";
import BackButton from "./BackButton";
import { MOOD, WIZARD_WRAP, stepSurface, stepTitleStyle, stepSubStyle, Stepper, Accordion, WizardNext } from "./WizardKit";
import { ScreenHeader, glassSurface } from "./moodboard";

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
const labelStyle = { fontSize: 12, fontWeight: 600, color: "var(--s2j-text-muted)", marginBottom: 3, display: "block" };

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
// hideMethodology: when the wizard's Step 1 already owns the planning mode, suppress the in-form toggle.
function CapacityForm({ form, onChange, disabled, hideMethodology }) {
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
      {/* methodology selector — top of the form (task-1). Suppressed when the wizard's Step 1 already
          owns the planning mode (hideMethodology), so the mode isn't asked for twice. */}
      {hideMethodology ? null : <MethodologyToggle value={f.methodology} onChange={set} disabled={disabled} />}

      <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
        <span style={{ color: "var(--s2j-blue)" }}><IconUsers size={16} /></span>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--s2j-text)", margin: 0 }}>Team capacity</h3>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--s2j-text-muted)", margin: "0 0 12px", lineHeight: 1.5 }}>
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
              <InfoTip align="right" text="PER QUARTER (Kanban): days each person is available OVER THE WHOLE QUARTER — the entire period, NOT per sprint. A full quarter is about 60-65 working days, minus planned time off. In Scrum the SAME field is per sprint — getting this wrong silently multiplies the throughput error, so read the label. (Entering per-sprint days here under-counts the quarter.)" />
            ) : (
              <InfoTip align="right" text="PER SPRINT (Scrum): days each person is available IN ONE SPRINT — counted once every sprint, NOT the whole quarter. A 2-week sprint is about 8-10 working days, minus planned time off. In Kanban the SAME field is per quarter — getting this wrong silently multiplies the capacity error by the sprint count, so read the label. (Whole-quarter days here over-count; values above the sprint length are clamped.)" />
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
            <div style={{ width: 140 }}><NumField label={<>Focus factor <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--s2j-blue)", background: "var(--s2j-blue-bg)", border: "1px solid var(--s2j-blue-border)", borderRadius: 999, padding: "1px 6px", marginLeft: 4, whiteSpace: "nowrap" }}>Biggest lever</span></>} value={f.focusFactor} onChange={(v) => set({ focusFactor: v })} placeholder="0.7" disabled={disabled || overrideMode} hint="0–1, e.g. 0.7" tip="The fraction of working time actually spent delivering stories — the rest goes to meetings, reviews and context-switching. Industry range 0.6–0.8. Default 0.7. Enter a fraction (0.7), NOT a percent (70)." /></div>
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
function SprintColumn({ sprint, number, byUid, oversizedSet, riskByUid, profile, startDate, sprintLengthDays, signalsByUid, rationaleByUid, onCritical, usedLlm, criticalChainExists }) {
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
            Risk-heavy — {profile.highRiskCount} high-risk item{profile.highRiskCount === 1 ? "" : "s"}{profile.externalDepCount ? `, ${profile.externalDepCount} external dep` : ""}{Number.isFinite(Number(profile.meanRisk)) ? ` · mean risk ${Math.round(Number(profile.meanRisk))}` : ""}
          </div>
        ) : null}
        {/* per-skill sub-meters (Tier-2): where the pressure is. Shown only in skill mode, only for buckets
            that carry capacity or load. a11y: SignalIcon + numeric load/cap, never colour-alone. */}
        {sprint.bucketCapacity ? (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {SKILL_METER_ORDER.filter((k) => (Number(sprint.bucketCapacity[k]) || 0) > 0 || (Number(sprint.bucketLoad && sprint.bucketLoad[k]) || 0) > 0).map((k) => {
              const bc = Number(sprint.bucketCapacity[k]) || 0;
              const bl = Number(sprint.bucketLoad && sprint.bucketLoad[k]) || 0;
              const bover = bl > bc + 1e-9;
              const bu = bc > 0 ? bl / bc : (bl > 0 ? 1 : 0);
              return (
                <div key={k} className="flex items-center" style={{ gap: 6, fontSize: 12 }}>
                  <SignalIcon kind={bover || bu > 0.9 ? "warning" : "success"} size={13} title={skillLabel(k)} />
                  <span style={{ color: "var(--s2j-text)", textTransform: "capitalize", fontWeight: 500 }}>{skillLabel(k)}</span>
                  <span style={{ marginLeft: "auto", color: bover ? "var(--s2j-orange)" : "var(--s2j-text-muted)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt1(bl)} / {fmt1(bc)}</span>
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
          sprint.ids.map((id) => (
            <FeatureChip
              key={id} feat={byUid.get(id)} id={id} oversized={oversizedSet.has(id)} risk={riskByUid && riskByUid.get(id)}
              signals={signalsByUid && signalsByUid[id]} rationale={rationaleByUid && rationaleByUid[id]} onCritical={onCritical ? onCritical(id) : false} usedLlm={usedLlm} criticalChainExists={criticalChainExists}
            />
          ))
        )}
      </div>
    </div>
  );
}

// A tiny category dot — the COLOUR rides the dot; the label stays dark navy (moodboard "colour on the dot").
function Dot({ color, size = 7 }) {
  return <span aria-hidden="true" style={{ width: size, height: size, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />;
}
const chipPill = {
  display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "var(--s2j-text)",
  border: "1px solid var(--s2j-border)", background: "var(--s2j-bg)", borderRadius: 999, padding: "1px 8px", lineHeight: 1.5,
};
const numLabelStyle = { fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--s2j-text-muted)" };
const tierTagStyle = { fontSize: 9, color: "var(--s2j-text-light)", border: "1px solid var(--s2j-border)", borderRadius: 4, padding: "0 4px" };

// ── FeatureChip (1A in-flow "why here") — used in BOTH the Scrum SprintColumn and the Kanban BacklogBand ──
// Collapsed = calm: the priority-tint left edge, name, SP, the risk-corner icon, the oversized note — PLUS two
// conditional, graceful-absent markers: an "unblocks N" leverage pill (downstreamUnblockCount>0) and a
// "+ why here" cue (a Claude rationale exists). A chip with neither reads exactly as calm as before.
// Clicking expands IN PLACE (no rail, no popover — the chip grows down the column; Forge page-scroll-safe):
//   CLAUDE'S REASONING — attributed, display-only (T2, the honesty firewall — never asserted as fact), then
//   THE NUMBERS BEHIND IT — the deterministic T0 signals (the authoritative numbers next to the untrusted
//   prose), rendered truthfully + non-redundantly (never "On the critical path" AND "slack" together).
// On a deterministic-fallback plan there is no rationale → the reasoning block is structurally ABSENT (a muted
// line says so), never fabricated. a11y: the header is a keyboard-operable button carrying aria-expanded.
function FeatureChip({ feat, id, oversized, risk, signals, rationale, onCritical, usedLlm, criticalChainExists }) {
  const [open, setOpen] = useState(false);
  const name = (feat && feat.name) || id;
  const sp = feat && feat.story_points;
  const tint = PRIORITY_TINT[feat && feat.priority] || PRIORITY_TINT.Low;
  const flagged = isRiskFlagged(risk);
  const markKind = risk && risk.risk_level === "high" ? "error" : "warning";
  const markTitle = flagged ? riskReasons(risk).map((r) => r.text).join(" · ") : "";

  // T0 scheduling signals (defensive: an old plan without plan.signals → all absent, chip stays calm).
  const s = signals || {};
  const unblock = Number(s.downstreamUnblockCount) || 0;
  const slack = Number(s.slack) || 0;
  const riskNotable = !!(risk && (risk.risk_level === "high" || risk.risk_level === "medium" || risk.has_external_dep));
  const riskScore = risk && Number.isFinite(Number(risk.riskScore)) ? Math.round(Number(risk.riskScore)) : null;
  const hasRationale = typeof rationale === "string" && rationale.trim().length > 0;

  // Truthful + non-redundant chip set (honesty firewall on the deterministic signals): a critical-path member
  // has zero slack by definition, so never show both "On the critical path" and a slack figure for one chip.
  const showUnblocks = unblock > 0;
  const showCritical = !!onCritical;
  const showSlack = slack > 0 && !onCritical;
  // A zero-slack feature NOT on the single named critical chain is still on a CO-EQUAL critical path (CPM: slack
  // 0 means it is on some longest chain) — surface "no slack" so it never reads as schedule-flexible. Guarded on
  // a chain actually existing, so a dependency-free plan (every feature slack 0) marks nobody.
  const showNoSlack = slack === 0 && !onCritical && !!criticalChainExists;
  const showRisk = riskNotable && riskScore != null;
  const hasSignalChips = showUnblocks || showCritical || showSlack || showNoSlack || showRisk;
  const expandable = hasRationale || hasSignalChips;
  const toggle = () => { if (expandable) setOpen((o) => !o); };

  return (
    <div style={{ border: `1px solid ${tint.border}`, background: tint.bg, borderRadius: 6, padding: "6px 8px" }}>
      <div
        {...(expandable
          ? {
              role: "button", tabIndex: 0, "aria-expanded": open, onClick: toggle,
              onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } },
              style: { cursor: "pointer" },
            }
          : {})}
      >
        <div className="flex items-center" style={{ justifyContent: "space-between", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--s2j-text)", lineHeight: 1.3, wordBreak: "break-word" }}>{name}</span>
          <span className="flex items-center" style={{ gap: 4, flexShrink: 0 }}>
            {flagged ? <SignalIcon kind={markKind} size={11} title={markTitle} /> : null}
            {sp != null ? <span style={{ fontSize: 10.5, fontWeight: 700, color: tint.fg }}>{sp}</span> : null}
            {expandable ? (open
              ? <IconChevronUp size={13} style={{ color: "var(--s2j-text-muted)" }} title="Hide why here" />
              : <IconChevronDown size={13} style={{ color: "var(--s2j-text-muted)" }} title="Why here" />) : null}
          </span>
        </div>
        {(showUnblocks || (hasRationale && !open)) ? (
          <div className="flex items-center" style={{ gap: 6, marginTop: 4, flexWrap: "wrap" }}>
            {showUnblocks ? (
              <span style={{ ...chipPill, borderColor: "var(--s2j-blue-border)", background: "var(--s2j-blue-bg)" }}>
                <Dot color="var(--s2j-blue)" /> unblocks {unblock}
              </span>
            ) : null}
            {hasRationale && !open ? (
              <span style={{ fontSize: 10.5, color: "var(--s2j-blue)", fontWeight: 600 }}>+ why here <span aria-hidden="true">&rsaquo;</span></span>
            ) : null}
          </div>
        ) : null}
      </div>

      {oversized ? (
        <div style={{ fontSize: 10, color: "var(--s2j-orange)", marginTop: 3, display: "inline-flex", alignItems: "center", gap: 3 }}>
          <SignalIcon kind="warning" size={11} /> larger than one sprint - split it
        </div>
      ) : null}

      {open && expandable ? (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--s2j-border)", display: "flex", flexDirection: "column", gap: 8 }}>
          {hasRationale ? (
            <div>
              <div className="flex items-center" style={{ gap: 6, marginBottom: 4 }}>
                <span style={numLabelStyle}>Claude's reasoning</span>
                <span style={tierTagStyle}>display-only · T2</span>
              </div>
              <p style={{ fontSize: 11.5, color: "var(--s2j-text)", fontStyle: "italic", margin: 0, lineHeight: 1.5 }}>
                "{rationale.trim()}" <span style={{ fontStyle: "normal", color: "var(--s2j-text-light)" }}>- Claude</span>
              </p>
            </div>
          ) : (
            // FIX 4: rationale is SPARSE even on a real Claude plan, so a per-feature rationale absence is NOT
            // evidence of a deterministic plan. Branch on the PLAN-level usedLlm: only assert "deterministic
            // plan" when Claude genuinely didn't rank; on a Claude plan, say so honestly for THIS feature.
            <div style={{ fontSize: 11, color: "var(--s2j-text-muted)", lineHeight: 1.5 }}>
              {usedLlm
                ? "Claude ranked this plan but didn't note a specific reason for this feature - the signals below are why it's placed here."
                : "No Claude reasoning on a deterministic plan. Only the signals below are available."}
            </div>
          )}
          {hasSignalChips ? (
            <div>
              <div className="flex items-center" style={{ gap: 6, marginBottom: 4 }}>
                <span style={numLabelStyle}>The numbers behind it</span>
                <span style={tierTagStyle}>T0</span>
              </div>
              <div className="flex" style={{ gap: 5, flexWrap: "wrap" }}>
                {showUnblocks ? <span style={chipPill}><Dot color="var(--s2j-blue)" /> Unblocks {unblock}</span> : null}
                {showCritical ? <span style={chipPill}><Dot color={MOOD.blueDeep} /> On the critical path</span> : null}
                {showSlack ? <span style={chipPill}><Dot color={MOOD.skySteel} /> slack: {fmt1(slack)}</span> : null}
                {showNoSlack ? <span style={chipPill}><Dot color={MOOD.blueDeep} /> no slack</span> : null}
                {showRisk ? <span style={chipPill}><SignalIcon kind={markKind} size={10} /> Risk {riskScore}</span> : null}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 10.5, color: "var(--s2j-text-light)" }}>No standout scheduling signals for this one.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Async-batch wait state — the ranking runs on Anthropic's Batch API (minutes), so we show a spinner +
// live timer + "you can leave" reassurance, mirroring the breakdown GeneratingScreen.
function PlanningState({ elapsed, kanban, repacking }) {
  const e = Number(elapsed) || 0;
  const mins = Math.floor(e / 60);
  const secs = e % 60;
  if (repacking) {
    // Free, instant, deterministic re-pack (no Claude / no Batch API) — distinct honest copy so the billed
    // generation messaging ("runs on the Batch API, takes a few minutes") is never shown for a free re-pack.
    return (
      <div style={{ border: "1px dashed var(--s2j-border)", borderRadius: 10, padding: 32, textAlign: "center" }}>
        <div className="animate-spin" style={{ width: 40, height: 40, margin: "0 auto 14px", borderRadius: "50%", border: "3px solid var(--s2j-border)", borderTopColor: "var(--s2j-blue)" }} />
        <p style={{ fontSize: 14, fontWeight: 600, color: "var(--s2j-text)", margin: "0 0 4px" }}>{kanban ? "Re-packing your backlog…" : "Re-packing your sprints…"}</p>
        <p style={{ fontSize: 12.5, color: "var(--s2j-text-muted)", margin: 0, lineHeight: 1.5 }}>
          Re-applying your capacity to the same Claude ordering — instant and free, no Claude call.
        </p>
      </div>
    );
  }
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

// ── Live read-out shell (2A / 2K) — a glass card with a green "LIVE" dot; the sticky sidebar beside the form.
function ReadoutShell({ title, children }) {
  return (
    <div style={{ ...glassSurface("minor"), padding: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--s2j-text-muted)", marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--s2j-green)", display: "inline-block" }} /> {title}
      </div>
      {children}
    </div>
  );
}

// Per-skill split bars (Scrum) — the bucket capacities as proportional bars so the split is legible at a glance
// (colour is neutral steel: capacity is not a severity). a11y: skill label + numeric value carry the meaning.
function SkillSplitBars({ perSprintBucketCapacity }) {
  const rows = SKILL_METER_ORDER
    .map((k) => ({ k, v: Number(perSprintBucketCapacity[k] && perSprintBucketCapacity[k][0]) || 0 }))
    .filter((r) => r.v > 0);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.v), 1);
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--s2j-text-muted)", marginBottom: 5 }}>Per skill / sprint</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {rows.map((r) => (
          <div key={r.k} className="flex items-center" style={{ gap: 8 }}>
            <span style={{ width: 62, fontSize: 11, color: "var(--s2j-text-muted)", textTransform: "capitalize", flexShrink: 0 }}>{skillLabel(r.k)}</span>
            <span style={{ flex: 1, height: 7, borderRadius: 4, background: "var(--s2j-border)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${Math.max(6, (r.v / max) * 100)}%`, background: MOOD.skySteel }} />
            </span>
            <span style={{ width: 34, textAlign: "right", fontSize: 11, fontWeight: 600, color: "var(--s2j-text)", flexShrink: 0 }}>{fmt1(r.v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Scrum live read-out (2A) — the big pts/sprint + total, the per-skill split, the focus-factor counterfactual
// (the biggest lever, made legible via a DIFFERENT focus value so the linear sensitivity is obvious), the
// non-blocking warnings, and the "no AI, no spend" caption. Driven by the same previewCapacity as the plan.
function CapacityPreview({ preview, form }) {
  const perSprint = preview.perSprintCapacityPoints[0];
  const sprints = preview.perSprintCapacityPoints.length;
  const total = preview.totalCapacityPoints;
  const ff = Number(form && form.focusFactor) || 0.7;
  const override = form && form.pointsPerSprintOverride !== undefined && form.pointsPerSprintOverride !== "" && form.pointsPerSprintOverride !== null;
  const compareFf = Math.abs(ff - 0.8) < 1e-9 ? 0.7 : 0.8; // counterfactual at a DIFFERENT ff so the delta is real
  const cf = !override && ff > 0 ? (perSprint / ff) * compareFf : null; // focus factor scales capacity linearly
  const delta = cf != null ? cf - perSprint : null;
  const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
  return (
    <ReadoutShell title="Computed capacity · live">
      <div style={{ fontSize: 22, fontWeight: 700, color: MOOD.navy, lineHeight: 1.15 }}>
        ≈ {fmt1(perSprint)} <span style={{ fontSize: 13, fontWeight: 600, color: "var(--s2j-text-muted)" }}>pts / sprint</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--s2j-text-muted)", marginTop: 2 }}>~{fmt1(total)} pts total over {sprints} sprint{sprints === 1 ? "" : "s"}</div>

      {preview.bucketsActive && preview.perSprintBucketCapacity ? <SkillSplitBars perSprintBucketCapacity={preview.perSprintBucketCapacity} /> : null}

      {cf != null ? (
        <div style={{ marginTop: 10, fontSize: 11, color: "var(--s2j-text-muted)", lineHeight: 1.5, borderTop: "1px dashed var(--s2j-border)", paddingTop: 8 }}>
          If focus factor were {compareFf} → <strong style={{ color: "var(--s2j-text)" }}>≈ {fmt1(cf)}</strong> pts/sprint ({delta >= 0 ? "+" : "-"}{fmt1(Math.abs(delta))}). Focus factor scales capacity linearly - a small change moves the whole plan.
        </div>
      ) : null}

      {warnings.length ? (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: "var(--s2j-orange)", display: "inline-flex", alignItems: "flex-start", gap: 4, lineHeight: 1.5 }}>
              <SignalIcon kind="warning" size={11} /> <span>{w && w.message ? w.message : String(w)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ marginTop: 10, fontSize: 10, color: "var(--s2j-text-light)", display: "inline-flex", alignItems: "center", gap: 4 }}>
        <SignalIcon kind="info" size={10} /> No AI, no spend - recomputes as you type.
      </div>
    </ReadoutShell>
  );
}

// Kanban live read-out (2K) — the throughput FORECAST (never a single reach number as the headline): expected,
// a conservative-optimistic range BAR, the range-derivation note, the focus-factor lever, non-blocking warnings,
// and the "a forecast, not a commitment" honesty. Same computeThroughput the plan uses → it can't drift.
function KanbanCapacityPreview({ preview, form }) {
  const expected = Number(preview.expectedPointsQuarter) || 0;
  const cons = Number(preview.conservativePoints) || 0;
  const opt = Number(preview.optimisticPoints) || 0;
  const ff = Number(form && form.focusFactor) || 0.7;
  const override = form && form.pointsPerQuarterOverride !== undefined && form.pointsPerQuarterOverride !== "" && form.pointsPerQuarterOverride !== null;
  const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
  const max = Math.max(opt, expected, 1);
  const pct = (v) => `${Math.max(2, Math.min(100, (v / max) * 100))}%`;
  return (
    <ReadoutShell title="Likely reach this quarter · live">
      <div style={{ fontSize: 22, fontWeight: 700, color: MOOD.navy, lineHeight: 1.15 }}>
        Expected ≈ {fmt1(expected)} <span style={{ fontSize: 13, fontWeight: 600, color: "var(--s2j-text-muted)" }}>pts</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--s2j-text-muted)", marginTop: 2 }}>likely reach {fmt1(cons)} - {fmt1(opt)} pts (conservative - optimistic)</div>

      {/* range bar: the conservative-to-optimistic band, drawn to scale against the optimistic reach */}
      <div style={{ marginTop: 10, position: "relative", height: 8, borderRadius: 5, background: "var(--s2j-border)", overflow: "hidden" }}>
        <span style={{ position: "absolute", top: 0, bottom: 0, left: pct(cons), width: `calc(${pct(opt)} - ${pct(cons)})`, background: MOOD.skySteel }} />
      </div>
      <div style={{ fontSize: 10.5, color: "var(--s2j-text-light)", marginTop: 4, lineHeight: 1.5 }}>
        Range = x0.8 / x1.1 of expected. Focus factor is the biggest lever.
      </div>

      {!override && Math.abs(ff - 0.7) > 1e-9 ? (
        <div style={{ fontSize: 11, color: "var(--s2j-text-muted)", marginTop: 6, lineHeight: 1.5 }}>
          At focus factor {ff} - focus factor scales throughput linearly, your single biggest lever.
        </div>
      ) : null}

      {warnings.length ? (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 11, color: "var(--s2j-orange)", display: "inline-flex", alignItems: "flex-start", gap: 4, lineHeight: 1.5 }}>
              <SignalIcon kind="warning" size={11} /> <span>{w && w.message ? w.message : String(w)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ marginTop: 10, fontSize: 10.5, color: "var(--s2j-text-light)", lineHeight: 1.5 }}>
        A forecast, not a commitment - it sharpens once the team has real flow history.
      </div>
    </ReadoutShell>
  );
}

// ── Spec-wide concerns band (SN-3) — plan-LEVEL risk/compliance posture, never attributed to a feature ──
function SpecConcernsBand({ summary, max = 6 }) {
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
          {items.slice(0, max).map((c, i) => (
            <li key={i} style={{ marginBottom: 2, fontSize: 12 }}>
              {c.type && c.type !== "NOTE" ? <span style={{ fontWeight: 600 }}>[{c.type}]</span> : null} {c.text}
            </li>
          ))}
          {items.length > max ? <li style={{ fontSize: 11.5, color: "var(--s2j-text-light)", listStyle: "none", marginLeft: -18 }}>…and {items.length - max} more in the breakdown.</li> : null}
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
function BacklogSection({ title, subtitle, kind, rows, subtotal, byUid, riskByUid, empty, signalsByUid, rationaleByUid, onCritical, usedLlm, criticalChainExists }) {
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
          rows.map((row) => (
            <FeatureChip
              key={row.id} feat={byUid.get(row.id)} id={row.id} oversized={false} risk={riskByUid && riskByUid.get(row.id)}
              signals={signalsByUid && signalsByUid[row.id]} rationale={rationaleByUid && rationaleByUid[row.id]} onCritical={onCritical ? onCritical(row.id) : false} usedLlm={usedLlm} criticalChainExists={criticalChainExists}
            />
          ))
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

function BacklogBand({ plan, byUid, riskByUid, signalsByUid, rationaleByUid, onCritical, usedLlm, criticalChainExists }) {
  const m = plan.metrics || {};
  const now = Array.isArray(plan.now) ? plan.now : [];
  const next = Array.isArray(plan.next) ? plan.next : [];
  const later = Array.isArray(plan.later) ? plan.later : [];
  const sub = (arr) => arr.reduce((a, r) => a + (Number(r.points) || 0), 0);
  const chipProps = { byUid, riskByUid, signalsByUid, rationaleByUid, onCritical, usedLlm, criticalChainExists };
  return (
    <div style={{ marginBottom: 12 }}>
      <BacklogSection
        title="Now — high confidence" subtitle="Likely delivered this quarter — pull these first." kind="success"
        rows={now} subtotal={m.reachedNowPoints != null ? m.reachedNowPoints : sub(now)} {...chipProps}
        empty="Nothing reaches high confidence yet — raise capacity or split the earliest items."
      />
      <ReachLine label="conservative reach" pts={m.conservativePoints} />
      <BacklogSection
        title="Next — stretch (might fit)" subtitle="Within optimistic reach — a stretch, not a commitment." kind="warning"
        rows={next} subtotal={sub(next)} {...chipProps}
        empty="No stretch items in this band."
      />
      <ReachLine label="optimistic reach" pts={m.optimisticPoints} />
      <BacklogSection
        title="Later — beyond this quarter’s likely reach" subtitle="Shown so the scope trade-off is negotiable — defer, descope, or add capacity." kind="info"
        rows={later} subtotal={m.beyondReachPoints != null ? m.beyondReachPoints : sub(later)} {...chipProps}
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

// ── Plan summary panel (Scrum, step 4) — the plan's own STORY, on screen (Q3). Reuses the SAME planView
// derivations the copy-out brief uses (capacityVerdict / criticalPathInfo / highestLeverage / overflowReasonText)
// so the on-screen summary and the copied brief can NEVER tell two stories (invariant #4 — one source of truth).
// Collapsible (default shown), SUBORDINATE to the plan hero. KEEPS the three Copy buttons + the "nothing is
// sent anywhere" caption — it ABSORBS the former PlanBriefExport (P18), so step 4 carries one story panel, not
// two. Pure deterministic render (lib/planBrief.js), captured in-memory → purge-safe, $0, instant.
function PlanSummaryPanel({ plan, sprintCount, nameOf, brief }) {
  const [open, setOpen] = useState(true);
  const [md, setMd] = useState("idle");
  const [txt, setTxt] = useState("idle");
  const [csv, setCsv] = useState("idle");
  const metrics = plan.metrics || {};
  const oversizedCount = Array.isArray(plan.oversized) ? plan.oversized.length : 0;
  const verdict = capacityVerdict(metrics, sprintCount, oversizedCount);
  const verdictKind = (metrics.deficitPoints > 0 || (metrics.overflowCount || 0) > 0 || oversizedCount > 0) ? "warning" : "success";
  const cp = criticalPathInfo(plan, nameOf);
  const leverage = highestLeverage(plan, nameOf, 3);
  const overflow = Array.isArray(plan.overflow) ? plan.overflow : [];
  // FIX 6: a force-placed feature larger than one sprint lands in plan.oversized, NOT plan.overflow. The panel
  // must surface it too (the copy-out brief lists it under "What doesn't fit"), else "Everything planned fits"
  // is literally false when an oversized item exists.
  const oversized = Array.isArray(plan.oversized) ? plan.oversized : [];
  const chainText = cp
    ? (cp.chainNames && cp.chainNames.length
        ? cp.chainNames.slice(0, 5).join(" → ") + (cp.chainNames.length > 5 ? ` → … (+${cp.chainNames.length - 5} more)` : "")
        : `${cp.len} features deep - ends at ${cp.endName}`)
    : null;

  const doCopy = async (text, set, filename) => {
    const ok = await copyPlanText(text || "", filename);
    set(ok ? "ok" : "fail");
    setTimeout(() => set("idle"), 1800);
  };
  const label = (st, base) => (st === "ok" ? "Copied" : st === "fail" ? "Copy failed - check permissions" : base);
  const btn = { background: "var(--s2j-bg)", border: "1px solid var(--s2j-border)", color: "var(--s2j-text)", cursor: "pointer", padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500 };
  const secLabel = { fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--s2j-text-muted)", marginBottom: 4 };

  return (
    <div style={{ ...glassSurface("minor"), padding: "12px 16px", marginBottom: 12 }}>
      <div className="flex items-center" style={{ justifyContent: "space-between", gap: 8 }}>
        <span className="flex items-center" style={{ gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: MOOD.navy }}>Plan summary - the story this plan tells</span>
          <span style={{ fontSize: 9.5, color: "var(--s2j-text-light)", border: "1px solid var(--s2j-border)", borderRadius: 4, padding: "0 5px" }}>T1 · deterministic · same source as the copy-out</span>
        </span>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center" style={{ gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--s2j-blue)", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
          {open ? <>Hide <IconChevronUp size={13} /></> : <>Show <IconChevronDown size={13} /></>}
        </button>
      </div>

      {open ? (
        <>
          <div className="flex" style={{ gap: 20, flexWrap: "wrap", marginTop: 12 }}>
            <div style={{ flex: "1 1 260px", minWidth: 240, display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={secLabel}>Capacity verdict</div>
                <div className="flex items-start" style={{ gap: 6 }}>
                  <span style={{ marginTop: 2 }}><SignalIcon kind={verdictKind} size={13} /></span>
                  <span style={{ fontSize: 12, color: "var(--s2j-text)", lineHeight: 1.5 }}>{verdict}</span>
                </div>
              </div>
              {chainText ? (
                <div>
                  <div style={secLabel}>Critical path · {cp.len} deep</div>
                  <div style={{ fontSize: 12, color: "var(--s2j-text)", lineHeight: 1.5, wordBreak: "break-word" }}>{chainText}</div>
                </div>
              ) : null}
            </div>
            <div style={{ flex: "1 1 260px", minWidth: 240, display: "flex", flexDirection: "column", gap: 12 }}>
              {leverage.length ? (
                <div>
                  <div style={secLabel}>Highest leverage</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {leverage.map((x) => (
                      <div key={x.id} className="flex items-center" style={{ gap: 6, fontSize: 12, color: "var(--s2j-text)" }}>
                        <Dot color="var(--s2j-blue)" /> <span style={{ wordBreak: "break-word" }}>{x.name}</span>
                        <span style={{ color: "var(--s2j-text-muted)", flexShrink: 0 }}>↑ unblocks {x.n}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div>
                <div style={secLabel}>What doesn&rsquo;t fit</div>
                {overflow.length || oversized.length ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {overflow.map((o, i) => (
                      <div key={`o${i}`} style={{ fontSize: 12, color: "var(--s2j-text)", lineHeight: 1.5 }}>
                        <span style={{ fontWeight: 500 }}>{o.name || (typeof nameOf === "function" ? nameOf(o.id) : o.id)}</span>
                        <span style={{ color: "var(--s2j-text-muted)" }}>{" - "}{overflowReasonText(o, nameOf)}</span>
                      </div>
                    ))}
                    {oversized.map((o, i) => (
                      <div key={`z${i}`} style={{ fontSize: 12, color: "var(--s2j-text)", lineHeight: 1.5 }}>
                        <span style={{ fontWeight: 500 }}>{o.name || (typeof nameOf === "function" ? nameOf(o.id) : o.id)}</span>
                        <span style={{ color: "var(--s2j-text-muted)" }}>{" - "}{oversizedReasonText(o)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--s2j-text-muted)" }}>Everything planned fits - nothing cut or oversized.</div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--s2j-border)" }}>
            <span className="flex" style={{ gap: 6, flexWrap: "wrap" }}>
              <button type="button" style={btn} onClick={() => doCopy(brief && brief.markdown, setMd, "plan-brief.md")}>{label(md, "Copy (Markdown)")}</button>
              <button type="button" style={btn} onClick={() => doCopy(brief && brief.plainText, setTxt, "plan-brief.txt")}>{label(txt, "Copy (plain)")}</button>
              <button type="button" style={btn} onClick={() => doCopy(brief && brief.csv, setCsv, "plan-allocation.csv")}>{label(csv, "Copy allocation (CSV)")}</button>
            </span>
            <span style={{ fontSize: 10, color: "var(--s2j-text-light)" }}>Grounded in this plan's numbers - nothing is sent anywhere.</span>
          </div>
        </>
      ) : null}
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

  // Discoverable: a blue-tinted header (the partner's "unnoticeable at the bottom" finding) with an
  // explanatory ⓘ. The toggle and the InfoTip are SIBLINGS — never an InfoTip <button> inside the
  // toggle <button> (nested interactive = invalid).
  return (
    <div style={{ border: "1px solid var(--s2j-blue-border)", borderRadius: 10, background: "var(--s2j-blue-bg)", marginBottom: 12 }}>
      <div className="flex items-center" style={{ justifyContent: "space-between", gap: 8, padding: "10px 12px" }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, color: "var(--s2j-text)" }}
        >
          <span className="flex items-center" style={{ gap: 6 }}>
            <span style={{ color: "var(--s2j-blue)", display: "inline-flex" }}><IconRefresh size={15} /></span>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>What-if scenarios</span>
            <span style={{ fontWeight: 400, color: "var(--s2j-text-muted)", fontSize: 11.5 }}>— explore changes free</span>
          </span>
          <span aria-hidden="true" style={{ color: "var(--s2j-text-muted)", fontSize: 13, lineHeight: 1 }}>{open ? "▾" : "▸"}</span>
        </button>
        <InfoTip align="right" text="Preview the impact of a change — add or remove a sprint, lower the focus factor, or defer features — for FREE. It re-packs the SAME Claude ordering against the new numbers; it never spends or re-asks Claude. To actually re-optimize the ORDER, use Re-rank with Claude. Deferrals here are preview-only — to drop a feature for real, remove it in the editor." />
      </div>
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
            <button type="button" onClick={() => setDeferOpen((o) => !o)} aria-expanded={deferOpen} className="text-xs" style={{ background: "none", border: "1px dashed var(--s2j-border)", color: "var(--s2j-blue)", cursor: "pointer", padding: "6px 10px", borderRadius: 6 }}>
              {deferOpen ? "▾" : "▸"} Defer features{deferred.size ? ` (${deferred.size})` : ""}
            </button>
            {active ? <button type="button" onClick={reset} className="text-xs" style={{ background: "none", border: "none", color: "var(--s2j-text-muted)", cursor: "pointer", textDecoration: "underline" }}>Reset</button> : null}
          </div>

          {/* defer checklist — no internal maxHeight/overflow: the picker is opt-in (collapsed by default)
              and PAGE-scrolls with the rest (Forge-iframe content-driven sizing; no internal scroll trap). */}
          {deferOpen ? (
            <div style={{ border: "1px solid var(--s2j-border)", borderRadius: 8, padding: 8, marginBottom: 10 }}>
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
                  <button type="button" onClick={() => { const patch = {}; if (sprintDelta !== 0) patch.sprintCount = baseSprints + sprintDelta; if (focusChanged) patch.focusFactor = focus; onApplyScenario(patch); reset(); }} className="btn-nav" style={{ padding: "7px 12px", borderRadius: 7, fontSize: 12.5 }}>
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

// Moodboard wizard primitives (MOOD / WIZARD_WRAP / stepSurface / step*Style / Stepper / Accordion /
// WizardNext) now live in ./WizardKit (shared with the Test Cases wizard). ChoiceCard + RecapRow stay
// here (planner-specific). See docs/DESIGN-SYSTEM-MOODBOARD.md.

const STEP_LABELS = ["Planning mode", "Team capacity", "Review & generate", "Your plan"];

// A big, readable mode card (Step 1). Selected = blue border + ice wash + a check; the glassy surface
// evokes the moodboard. The whole card is one button (no nested interactive elements).
function ChoiceCard({ icon, title, desc, selected, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      style={{
        flex: "1 1 250px", textAlign: "left", cursor: disabled ? "not-allowed" : "pointer",
        borderRadius: 14, padding: 18, transition: "all 0.15s", position: "relative",
        border: `2px solid ${selected ? "var(--s2j-blue)" : "rgba(125,160,202,0.32)"}`,
        // Selected: the moodboard "soft surface wash" (rgba .35 ice at the 55% stop, matching stepSurface)
        // over an OPAQUE white base — legible without backdrop-filter (never lean on transparency). The 2px
        // blue border carries "selected".
        background: selected ? "linear-gradient(160deg, rgba(193,232,255,0.35) 0%, rgba(255,255,255,0) 55%), #ffffff" : "#fff",
        boxShadow: selected ? "0 6px 22px rgba(5,38,89,0.12)" : "0 2px 10px rgba(5,38,89,0.05)",
      }}
    >
      <div className="flex items-center" style={{ gap: 10, marginBottom: 8 }}>
        <span style={{
          width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: "inline-flex",
          alignItems: "center", justifyContent: "center",
          background: selected ? "var(--s2j-blue)" : MOOD.ice, color: selected ? "#fff" : MOOD.blueDeep,
        }}>{icon}</span>
        <span style={{ fontSize: 15.5, fontWeight: 700, color: MOOD.navy }}>{title}</span>
        {selected ? <span style={{ marginLeft: "auto", color: "var(--s2j-blue)", display: "inline-flex" }}><SignalIcon kind="success" size={18} /></span> : null}
      </div>
      <p style={{ fontSize: 13, color: "var(--s2j-text-muted)", margin: 0, lineHeight: 1.55 }}>{desc}</p>
    </button>
  );
}

// One labeled row in the Step-3 recap.
function RecapRow({ label, value, last }) {
  return (
    <div className="flex" style={{ justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: last ? "none" : "1px solid var(--s2j-border)" }}>
      <span style={{ fontSize: 13, color: "var(--s2j-text-muted)" }}>{label}</span>
      <span style={{ fontSize: 13.5, color: MOOD.navy, fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}

// Compact magnitude string for the §11 teaser: "Short on Backend + QA 54 pts" — the SAME overDemand the
// SkillBottleneck callout reads, so the plan-screen teaser and the step-5 detail can never disagree.
function bottleneckTeaser(bm) {
  if (!bm) return null;
  const short = (k) => (bm.overDemand && bm.overDemand[k]) || 0;
  const bn = (bm.bottleneckBuckets || []).filter((k) => short(k) > 0.05);
  if (!bn.length) return null;
  const total = bn.reduce((a, k) => a + short(k), 0);
  return `Short on ${bn.map(skillLabel).join(" + ")} ${fmt1(total)} pts`;
}

// ── Plan-health teaser (§11) — the compact bridge from the plan (step 4) to the analysis (step 5). It keeps
// the COUNTS + MAGNITUDE of the demoted signals ON the plan screen (so a user can never commit unaware that N
// features don't fit), and routes to the detail. ALWAYS rendered: warning-tinted when any warning signal
// exists, a green affirmation when clean (absence must never read as "all clear"). When there is no step 5 to
// route to (a clean Kanban plan), it renders the affirmation as a non-interactive div.
function PlanHealthStrip({ signals, hasWarning, featureCount, routes, onOpen, sprintCount, kanban }) {
  const clean = signals.length === 0;
  const kind = hasWarning ? "warning" : clean ? "success" : "info";
  const outer = {
    width: "100%", textAlign: "left", marginBottom: 12, borderRadius: 10, padding: "10px 12px",
    border: `1px solid ${hasWarning ? "var(--s2j-orange-border)" : clean ? "var(--s2j-green-border)" : "var(--s2j-border)"}`,
    borderLeft: `4px solid ${hasWarning ? "var(--s2j-orange)" : clean ? "var(--s2j-green)" : "var(--s2j-blue)"}`,
    background: hasWarning ? "var(--s2j-orange-bg)" : clean ? "var(--s2j-green-bg)" : "var(--s2j-bg-section)",
  };
  const inner = (
    <div className="flex items-center" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
      <span className="flex items-center" style={{ gap: 8, flexWrap: "wrap" }}>
        <SignalIcon kind={kind} size={15} />
        {clean ? (
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--s2j-text)" }}>
            No blockers — {featureCount} features planned{kanban ? " in the backlog" : sprintCount ? ` across ${sprintCount} sprint${sprintCount === 1 ? "" : "s"}` : ""}
          </span>
        ) : (
          <>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--s2j-text)" }}>Plan health:</span>
            {signals.map((s, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--s2j-text)", border: `1px solid ${s.kind === "warning" ? "var(--s2j-orange-border)" : "var(--s2j-border)"}`, background: "var(--s2j-bg)", borderRadius: 999, padding: "1px 8px" }}>
                <SignalIcon kind={s.kind} size={10} /> {s.label}
              </span>
            ))}
          </>
        )}
      </span>
      {routes ? <span style={{ fontSize: 12, fontWeight: 600, color: "var(--s2j-blue)", whiteSpace: "nowrap" }}>Review plan health →</span> : null}
    </div>
  );
  if (!routes) return <div style={outer}>{inner}</div>;
  return <button type="button" onClick={onOpen} style={{ ...outer, cursor: "pointer" }}>{inner}</button>;
}

export default function PlanScreen({
  featureCount, slimFeatures, form, result, busy, estimate, armed, elapsed, pageTitle, jobId, onArmToggle, onFormChange, onGenerate, onRepack, onApplyScenario, onBack,
  trialActive = false, // 2026-07-11: on the $5 managed trial credit — reframe BYOK cost/key copy to free-trial-credit framing.
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
  // any other ok:false (a backend pipeline throw → stage:'plan', or an invoke rejection) — never silent.
  // §11: ALSO surface a resolver-GUARD payload that carries `error` but no `ok` — edition_required (a Standard
  // user who reached generate/re-pack via a mid-session downgrade or crafted client) or license_required. These
  // previously fell through (r.ok===false was false) and the "Upgrade to Advanced" / "start a trial" detail was
  // silently swallowed; the push paths already surface it, so this brings generate/re-pack to parity.
  const planError = (r.ok === false || (!!r.error && r.ok === undefined)) && r.stage !== "capacity" && r.stage !== "key" ? r : null;
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

  // ── T0 scheduling signals + T2 Claude rationale for the FeatureChip "why here" (the data-surfacing heart).
  // signalsByUid: an old plan without plan.signals → {} (chips stay calm). rationaleByUid: {} on a
  // deterministic-fallback plan (the honesty firewall's structural absence — the reasoning block is then
  // absent, never fabricated). criticalPathUids: the backend's ordered chain when PRESENT (an array, even an
  // empty one) → membership is AUTHORITATIVE; an empty [] means NOBODY is on a critical path (a dependency-free
  // plan), NOT a trigger for the slack fallback. Only when the field is GENUINELY ABSENT (a legacy plan that
  // predates it) do we derive "on the critical path" from slack === 0 — the contract's defensive fallback. ──
  const signalsByUid = (plan && plan.signals) || {};
  const rationaleByUid = (r && r.rationaleByUid) || {};
  // "Field present (even if empty)" vs "field genuinely absent" — the whole point of FIX 1. A present-but-empty
  // criticalPathUids is authoritative "no critical path"; falling back to slack===0 there would mark EVERY
  // feature on a dependency-free plan (all have slack 0), contradicting the Plan summary panel (which shows none).
  const hasCriticalField = !!(plan && Array.isArray(plan.criticalPathUids));
  const criticalSet = useMemo(() => new Set((plan && Array.isArray(plan.criticalPathUids)) ? plan.criticalPathUids : []), [plan]);
  // A named critical chain actually EXISTS (>= 2 features). Used so a zero-slack feature that sits on a CO-EQUAL
  // longest chain (not the single one criticalPathUids named) still reads as schedule-critical ("no slack")
  // instead of showing neither marker. When no chain exists (all independent, all slack 0), nobody is critical.
  const criticalChainExists = hasCriticalField && criticalSet.size > 0;
  // Legacy plans (generated before criticalPathUids existed) have NO chain field → derive membership from
  // slack===0, but ONLY when a real chain exists (some criticalPathLen >= 2) — else a dependency-free legacy
  // plan (every feature slack 0) would mark EVERYONE, the exact contradiction FIX 1 fixed for new plans.
  const legacyChainExists = !hasCriticalField && Object.values(signalsByUid || {}).some((s) => (Number(s && s.criticalPathLen) || 0) >= 2);
  const onCritical = (id) => {
    if (hasCriticalField) return criticalSet.has(id);            // field present (even empty []) → authoritative
    const sg = signalsByUid[id];                                 // field genuinely absent (legacy plan) → derive from slack===0, gated on a chain existing
    return !!(sg && Number(sg.slack) === 0 && legacyChainExists);
  };
  const specConcernSummary = (plan && plan.specConcernSummary) || null;
  // The register: shared derivation (buildRiskRegister) so the screen + the Plan Brief list the SAME
  // features in the SAME order (BRIEF-DRIFT). nameOfUid resolves the display name from the slim features.
  // buildRiskRegister itself branches on plan.methodology to tag by reach tier (kanban) vs sprint (scrum).
  // nameOfUid is a fresh closure each render but reads byUid (in the deps) and buildRiskRegister calls it
  // synchronously → byUid in the deps is sufficient; nameOfUid need not be listed (deps are complete).
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
      trialActive, // 2026-07-11: so the copy-out brief footer says "free trial credit", not "your Anthropic key", on a managed trial run
    });
  }, [result, nameFeatures, form, pageTitle, isKanban, trialActive]);

  // ── WIZARD (4 steps): Mode → Capacity → Review&generate → Plan. One focus per step (the screen was
  // overloaded). Step 4 IS the plan; "generating" is its loading sub-state. An existing plan lands on 4.
  const hasCapErrors = !!(capacityErrors && capacityErrors.length);
  const [step, setStep] = useState(() => (hasPlan ? 4 : 1));
  // maxStep headroom is 5 once a plan exists (so the Plan-health step is reachable on a reload too — must-fix);
  // the Stepper only renders as many dots as `stepLabels` has, so extra headroom on a clean Kanban plan (4 steps)
  // is harmless.
  const [maxStep, setMaxStep] = useState(() => (hasPlan ? 5 : 1));
  const wasBusy = useRef(false);
  // Auto-advance: a plan/re-rank run shows the loading sub-state on step 4; on completion land on 4 (plan
  // ready) or route a failure to where it's fixable (capacity errors → step 2; key/plan error → step 3).
  useEffect(() => {
    if (busy) { wasBusy.current = true; setStep(4); setMaxStep(4); return undefined; }
    if (wasBusy.current) {
      wasBusy.current = false;
      if (hasPlan) { setStep(4); setMaxStep(5); } // land on the PLAN; make Plan health reachable, never auto-jump to it
      else if (hasCapErrors) { setStep(2); }
      else { setStep(3); }
    }
    return undefined;
  }, [busy, hasPlan, hasCapErrors]);
  const disarm = () => { if (armed) onArmToggle(false); };
  const goStep = (n) => { disarm(); setStep(n); setMaxStep((m) => Math.max(m, n)); };

  // Re-pack / what-if-apply are FREE + instant (no Claude). Track them locally so the loading sub-state shows
  // honest "Re-packing…" copy, never the billed "Claude is planning… takes minutes". Cleared when busy ends.
  const [repacking, setRepacking] = useState(false);
  useEffect(() => { if (!busy) setRepacking(false); return undefined; }, [busy]);
  const handleRepack = () => { setRepacking(true); onRepack(); };
  const handleApply = (patch) => { setRepacking(true); onApplyScenario(patch); };

  // a11y: on a STEP change (not the first mount) move focus to the fresh step content, so keyboard / screen-
  // reader users land on the new step instead of a now-unmounted button. preventScroll keeps the iframe still.
  const stepBodyRef = useRef(null);
  const stepMounted = useRef(false);
  useEffect(() => {
    if (!stepMounted.current) { stepMounted.current = true; return undefined; }
    const el = stepBodyRef.current;
    if (el && typeof el.focus === "function") {
      try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
    }
    return undefined;
  }, [step]);

  // recap (step 3) — a concise confirmation of the setup before a billed run
  const teamSize = Array.isArray(form && form.people) ? form.people.length : 0;
  const capLine = preview && preview.ok
    ? (preview.methodology === "kanban"
        ? (Number.isFinite(Number(preview.expectedPointsQuarter)) ? `≈ ${fmt1(preview.expectedPointsQuarter)} pts expected this quarter` : "—")
        : (Array.isArray(preview.perSprintCapacityPoints) && preview.perSprintCapacityPoints.length
            ? `≈ ${fmt1(preview.perSprintCapacityPoints[0])} pts/sprint · ~${fmt1(preview.totalCapacityPoints)} pts total`
            : "—"))
    : "—";

  // step-4 collapsed-detail counts (render an accordion only when it carries content)
  const diagCount = (g.cyclicNodes || []).length + (g.danglingRefs || []).length + (g.ambiguousDeps || []).length
    + (g.duplicateNames || []).length + (g.duplicateUids || []).length + (g.selfDeps || []).length
    + ((plan && plan.sizingIssues) || []).length;
  const skillDiagCount = plan && plan.skillDiagnostics
    ? (plan.skillDiagnostics.unclassified || []).length + (plan.skillDiagnostics.unknownTaskTypes || []).length
    : 0;

  // usedLlm at the RANKING level: true ONLY when Claude actually ranked this plan (false on a deterministic
  // fallback). The reconciliation note (FIX 2) + its health teaser + its kanbanHealthCount contribution (FIX 3)
  // all gate on this — a fallback plan never ran Claude, so "omitted N it forgot to rank" would be a false claim.
  const used = !!(plan && plan.ranking && plan.ranking.usedLlm);
  // Reconciliation magnitude — usedLlm-gated. A Claude ranking can reference features that don't exist (dropped)
  // or forget to rank some (appended deterministically). On a fallback plan omittedCount == the whole feature
  // count, so these are ONLY meaningful when Claude actually ran; !used ⇒ 0.
  const planRanking = (plan && plan.ranking) || {};
  const reconUnknown = used && Array.isArray(planRanking.unknownIds) ? planRanking.unknownIds.length : 0;
  const reconOmitted = used ? (Number(planRanking.omittedCount) || 0) : 0;
  const reconCount = reconUnknown + reconOmitted;

  // ── Step 5 "Plan health": the analysis, split off the plan artifact (Linear-Insights pattern) ──
  // It EXISTS when there's analysis worth a step. Scrum always has assumptions → always; a Kanban plan only
  // if it carries risks / warnings / concerns / data-quality / a usedLlm reconciliation (else the step would be
  // empty — it must earn it). FIX 3: fold reconCount in so a clean-but-reconciled Kanban plan EARNS step 5 —
  // otherwise the reconciliation note is unreachable AND the health strip reads falsely clean (a §11 silent miss).
  const kanbanHealthCount = (warnings ? warnings.length : 0) + riskRegister.length
    + ((specConcernSummary && specConcernSummary.total) || 0) + diagCount + reconCount;
  const hasStep5 = hasPlan && (!isKanban || kanbanHealthCount > 0);
  const stepLabels = hasStep5 ? [...STEP_LABELS, "Plan health"] : STEP_LABELS;

  // §11 health teaser signals — SINGLE-SOURCED from the exact derivations the step-5 detail renders, so the
  // plan-screen counts can never drift from the page that explains them. Magnitude (pts) where it's known.
  const bnTeaser = (!isKanban && plan) ? bottleneckTeaser(plan.bucketMetrics) : null;
  const healthSignals = [];
  if (plan) {
    if (!isKanban) {
      if (plan.overflow && plan.overflow.length) healthSignals.push({ label: `Doesn’t fit (${plan.overflow.length})`, kind: "warning" });
      // Oversized (force-placed but larger than one sprint) is a DISJOINT channel from overflow. Surface it here too;
      // else an oversized-only plan (backlog <= capacity, no overflow) reads a false-green "No blockers" (POLICY 11).
      if (plan.oversized && plan.oversized.length) healthSignals.push({ label: `Larger than one sprint (${plan.oversized.length})`, kind: "warning" });
      if (deficit) healthSignals.push({ label: "Capacity shortfall", kind: "warning" });
      if (bnTeaser) healthSignals.push({ label: bnTeaser, kind: "warning" });
    } else {
      const beyond = Number(metrics.beyondReachPoints) || 0;
      // FIX 7: "N pts beyond this quarter's reach" is the SAME fact the reach verdict + the "Later" band state as
      // INFO (a negotiable scope forecast, not a blocker) — style it info to match, not orange warning.
      if (beyond > 0.05) healthSignals.push({ label: `${fmt1(beyond)} pts beyond this quarter’s reach`, kind: "info" });
    }
    if (riskRegister.length) healthSignals.push({ label: `Risks (${riskRegister.length})`, kind: "warning" });
    if (specConcernSummary && specConcernSummary.total) healthSignals.push({ label: `Concerns (${specConcernSummary.total})`, kind: specConcernSummary.complianceCount ? "warning" : "info" });
    if (diagCount) healthSignals.push({ label: `Data quality (${diagCount})`, kind: "info" });
    // FIX 3: a usedLlm reconciliation is never silent — an INFO teaser keeps the strip from reading falsely
    // clean (its green "No blockers" affirmation) when Claude dropped/omitted features. Routes to the step-5 note.
    if (reconCount) healthSignals.push({ label: `Ranking reconciled (${reconCount})`, kind: "info" });
  }
  const healthHasWarning = healthSignals.some((s) => s.kind === "warning");
  // Defensive: never sit on a step-5 that no longer exists (e.g. a plan mutated to a clean Kanban). Unreachable
  // in the normal flow (re-pack/re-rank both leave step 5 first), but keeps the stepper's active state honest.
  useEffect(() => { if (step === 5 && !hasStep5) setStep(4); return undefined; }, [step, hasStep5]);

  // ── STEP BODIES ──
  let stepBody = null;
  if (step === 1) {
    // STEP 1 — Planning mode (owns methodology so Step 2's form drops its toggle)
    stepBody = (
      <div style={stepSurface}>
        <h3 style={stepTitleStyle}>Choose how to plan</h3>
        <p style={stepSubStyle}>Two ways to turn this {featureCount}-feature breakdown into a plan — you can change this anytime.</p>
        <div className="flex" style={{ gap: 14, flexWrap: "wrap" }}>
          <ChoiceCard
            icon={<IconCalendar size={20} />}
            title="Sprints (Scrum)"
            desc="Pack the backlog into capacity-bounded sprints with dates. Best when you run fixed-length iterations and want a sprint-by-sprint allocation."
            selected={!formIsKanban}
            disabled={busy}
            onClick={() => onFormChange({ methodology: "scrum" })}
          />
          <ChoiceCard
            icon={<IconList size={20} />}
            title="Kanban backlog"
            desc="A pull-ready, dependency-legal backlog cut into Now / Next / Later by how much your team is likely to reach this quarter — no sprints, no dates."
            selected={formIsKanban}
            disabled={busy}
            onClick={() => onFormChange({ methodology: "kanban" })}
          />
        </div>
        {methodologyChanged ? (
          <div style={{ fontSize: 11.5, color: "var(--s2j-orange)", marginTop: 12, display: "inline-flex", alignItems: "center", gap: 4, lineHeight: 1.5 }}>
            <SignalIcon kind="warning" size={12} /> You switched the planning mode — on the plan step, Re-pack (free) to apply it to your existing plan.
          </div>
        ) : null}
        <div className="flex" style={{ justifyContent: "flex-end", marginTop: 22 }}>
          <WizardNext onClick={() => goStep(2)}>Next: team capacity</WizardNext>
        </div>
      </div>
    );
  } else if (step === 2) {
    // STEP 2 — Team capacity (2A/2K): the form (LEFT) + a sticky LIVE read-out sidebar (RIGHT) so the user
    // SEES the capacity their numbers produce as they type — the highest-leverage knobs read as consequential.
    const readout = preview && preview.ok && preview.methodology === "kanban" && Number.isFinite(Number(preview.expectedPointsQuarter))
      ? <KanbanCapacityPreview preview={preview} form={form} />
      : preview && preview.ok && preview.methodology !== "kanban" && Array.isArray(preview.perSprintCapacityPoints) && preview.perSprintCapacityPoints.length
        ? <CapacityPreview preview={preview} form={form} />
        : null;
    stepBody = (
      <div style={stepSurface}>
        <h3 style={stepTitleStyle}>Tell us about your team</h3>
        <p style={stepSubStyle}>
          {formIsKanban
            ? "Each person's available days this quarter set the expected throughput."
            : "Each person's available days per sprint set the capacity for each sprint."}
          {" "}Click the <SignalIcon kind="info" size={12} style={{ verticalAlign: "-0.1em" }} /> icons for what a field means.
        </p>
        <div className="flex" style={{ gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 440px", minWidth: 300 }}>
            <CapacityForm form={form} onChange={onFormChange} disabled={busy} hideMethodology />
            {hasCapErrors ? (
              <SignalCallout kind="error" title="Fix the capacity inputs to plan" style={{ marginTop: 12 }}>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {capacityErrors.map((e, i) => <li key={i} style={{ marginBottom: 2 }}>{e.message}</li>)}
                </ul>
              </SignalCallout>
            ) : null}
          </div>
          {/* sticky sidebar — page-scroll-safe (a position:sticky element in the document flow, NOT an internal
              scroll trap); it stacks BELOW the form on a narrow viewport (flex-wrap). */}
          <div style={{ flex: "1 1 300px", minWidth: 260, position: "sticky", top: 12, alignSelf: "flex-start" }}>
            {readout || (
              <div style={{ ...glassSurface("minor"), padding: 16, fontSize: 12, color: "var(--s2j-text-muted)", lineHeight: 1.5 }}>
                Add at least one team member with available days to see the computed capacity - live, no AI, no spend.
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center" style={{ justifyContent: "space-between", marginTop: 22 }}>
          <BackButton onClick={() => goStep(1)} label="Back" className="" title="Back to planning mode" />
          <WizardNext onClick={() => goStep(3)}>Next: review &amp; generate</WizardNext>
        </div>
      </div>
    );
  } else if (step === 3) {
    // STEP 3 — Review & generate (recap + objective + cost estimate + the billed Generate/Re-rank)
    stepBody = (
      <div style={stepSurface}>
        <h3 style={stepTitleStyle}>Review &amp; generate</h3>
        <p style={stepSubStyle}>Confirm the setup and pick what to optimize for. Claude orders the work; the {formIsKanban ? "reach" : "sprint"} math is deterministic. Review-only — nothing is written to Jira.</p>

        <div style={{ marginBottom: 18 }}>
          <RecapRow label="Planning mode" value={formIsKanban ? "Kanban backlog" : "Sprints (Scrum)"} />
          <RecapRow label="Features to plan" value={String(featureCount)} />
          <RecapRow label="Team" value={`${teamSize} ${teamSize === 1 ? "person" : "people"}`} />
          {!formIsKanban ? <RecapRow label="Sprint structure" value={`${(form && form.sprintCount) || "—"} sprints × ${(form && form.sprintLengthDays) || "—"} days`} /> : null}
          <RecapRow label="Computed capacity" value={capLine} last />
        </div>

        <div style={{ marginBottom: 16 }}>
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
            <div style={{ fontSize: 11, color: "var(--s2j-orange)", marginTop: 4, display: "inline-flex", alignItems: "center", gap: 4, lineHeight: 1.5 }}>
              <SignalIcon kind="warning" size={11} /> Objective changed — Re-rank with Claude to apply it.
            </div>
          ) : hasPlan ? (
            <div style={{ fontSize: 11, color: "var(--s2j-text-light)", marginTop: 4 }}>Changing this re-orders the plan — a billed Re-rank.</div>
          ) : null}
        </div>

        {methodologyChanged ? (
          <div style={{ fontSize: 11, color: "var(--s2j-orange)", marginBottom: 12, display: "inline-flex", alignItems: "center", gap: 4, lineHeight: 1.5 }}>
            <SignalIcon kind="warning" size={11} /> Planning mode changed — on the plan step, Re-pack (free) to apply it.
          </div>
        ) : null}

        {keyError ? (
          <SignalCallout kind="error" title="Anthropic key needed" style={{ marginBottom: 12 }}>
            {keyError.detail || "Add your Anthropic API key in Settings to generate a plan."}
          </SignalCallout>
        ) : null}
        {planError ? (
          <SignalCallout kind="error" title="Couldn’t build the plan" style={{ marginBottom: 12 }}>
            {planError.detail || "The plan could not be computed — please try again or adjust the breakdown."}
          </SignalCallout>
        ) : null}

        {!hasPlan && estimate && estimate.upper_usd > 0 ? (
          <SignalCallout kind="info" title="Estimated Anthropic usage" style={{ marginBottom: 14 }} iconTitle="Pre-flight cost estimate">
            <span style={{ fontSize: 12.5 }}>
              Up to <strong>~{fmtUsd(estimate.upper_usd)}</strong>{estimate.expected_usd ? ` (typically ~${fmtUsd(estimate.expected_usd)})` : ""}{trialActive ? " — drawn from your $5 free trial credit. Exact cost is echoed after the run." : " — billed to your own key, no markup. Exact cost is echoed after the run."}
            </span>
          </SignalCallout>
        ) : null}

        <button
          type="button"
          onClick={() => {
            // BOTH first-generate AND re-rank are billed Anthropic calls → 2-step armed confirm so neither
            // spends on a single click (cost honesty; carries the test-case bill-shock lesson — PLAN-14).
            if (!armed) { onArmToggle(true); return; }
            onArmToggle(false);
            onGenerate();
          }}
          disabled={busy}
          className="btn-primary"
          style={{ width: "100%", justifyContent: "center", padding: "11px 16px", fontSize: 14, borderRadius: 10 }}
        >
          {busy ? "Planning…" : armed ? (hasPlan ? "Confirm re-rank with Claude" : "Confirm & generate plan") : hasPlan ? <><IconRefresh size={15} /> Re-rank with Claude</> : <>{formIsKanban ? <IconList size={15} /> : <IconCalendar size={15} />} Generate plan</>}
        </button>
        {armed ? (
          <p style={{ fontSize: 11, color: "var(--s2j-orange)", margin: "8px 0 0", textAlign: "center", lineHeight: 1.5 }}>
            {trialActive ? "Click again to confirm — this runs a Claude call on your free trial credit." : "Click again to confirm — this runs a billed Claude call on your own key."}
          </p>
        ) : null}

        <div className="flex items-center" style={{ justifyContent: "space-between", marginTop: 18 }}>
          <BackButton onClick={() => goStep(2)} label="Back" className="" title="Back to team capacity" />
          {hasPlan ? <WizardNext onClick={() => goStep(4)}>View plan</WizardNext> : null}
        </div>
      </div>
    );
  } else if (step === 5 && hasStep5) {
    // ── STEP 5 — Plan health: ALL the analysis, separated from the plan artifact (Linear-Insights split).
    // Critical blocks (deficit / doesn't-fit / bottleneck / concerns / risks) render OUTSIDE accordions; only
    // assumptions / skill detail / data quality stay collapsed. The narrow WIZARD_WRAP applies (step !== 4). ──
    stepBody = (
      <div>
        <h3 style={stepTitleStyle}>Plan health</h3>
        <p style={stepSubStyle}>Everything that shapes whether this plan holds — what doesn’t fit, where you’re short, and the risks to front-load. The plan itself is on the previous step.</p>

        {warnings && warnings.length ? (
          <SignalCallout kind="info" title="Heads-up" style={{ marginBottom: 12 }} iconTitle="Non-blocking notes about your inputs">
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{warnings.map((w, i) => <li key={i} style={{ marginBottom: 2 }}>{w.message}</li>)}</ul>
          </SignalCallout>
        ) : null}

        {/* Reconciliation note (§11 silent-miss made visible): Claude can reference a feature that doesn't exist
            (dropped) or forget to rank some (appended deterministically). Absent when the reconciliation is clean. */}
        {(() => {
          // FIX 2: only a REAL Claude ranking can be "reconciled". On a deterministic-fallback plan (usedLlm
          // false) omittedCount == the whole feature count, so the note would falsely say "Claude omitted N it
          // forgot to rank" though Claude never ran — contradicting the llmNote banner + the Risk register.
          if (!used) return null;
          const rk = (plan && plan.ranking) || {};
          const unknown = Array.isArray(rk.unknownIds) ? rk.unknownIds.length : 0;
          const omitted = Number(rk.omittedCount) || 0;
          if (!unknown && !omitted) return null;
          const parts = [];
          if (unknown) parts.push(`referenced ${unknown} feature${unknown === 1 ? "" : "s"} that ${unknown === 1 ? "doesn't" : "don't"} exist (dropped)`);
          if (omitted) parts.push(`omitted ${omitted} it forgot to rank (appended deterministically at the end)`);
          return (
            <SignalCallout kind="info" title="Claude's ranking was reconciled" style={{ marginBottom: 12 }} iconTitle="A silent miss made visible">
              <div style={{ fontSize: 12, color: "var(--s2j-text)", lineHeight: 1.5 }}>
                Claude {parts.join(" and ")}. A silent miss made visible - absent when the reconciliation is clean.
              </div>
              <div style={{ fontSize: 10, color: "var(--s2j-text-light)", marginTop: 4 }}>T0 · ranking.unknownIds / omittedCount</div>
            </SignalCallout>
          );
        })()}

        {!isKanban ? (
          <>
            {deficit ? (
              <SignalCallout kind="warning" title={deficit.title} style={{ marginBottom: 12 }}>
                {deficit.body} Add a sprint, raise capacity, or descope — they’re listed below.
              </SignalCallout>
            ) : null}
            {plan.overflow && plan.overflow.length ? (
              <div style={{ border: "1px solid var(--s2j-orange-border)", borderRadius: 10, background: "var(--s2j-orange-bg)", padding: 12, marginBottom: 12 }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
                  <SignalIcon kind="warning" size={15} />
                  <strong style={{ fontSize: 13, color: "var(--s2j-text)" }}>Doesn’t fit ({plan.overflow.length})</strong>
                </div>
                {plan.overflow.map((o, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--s2j-text)", padding: "2px 0" }}>
                    <span style={{ fontWeight: 500 }}>{o.name || nameOfUid(o.id)}</span>
                    <span style={{ color: "var(--s2j-text-muted)" }}>{" — "}{overflowReasonText(o, nameOfUid)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {/* Oversized — the CONCRETE by-how-much (points vs single-sprint cap), not just "larger than one
                sprint". Concrete beats vague; names the skill to add when the feature needs one bucket. */}
            {plan.oversized && plan.oversized.length ? (
              <div style={{ border: "1px solid var(--s2j-orange-border)", borderRadius: 10, background: "var(--s2j-orange-bg)", padding: 12, marginBottom: 12 }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
                  <SignalIcon kind="warning" size={15} />
                  <strong style={{ fontSize: 13, color: "var(--s2j-text)" }}>Larger than one sprint ({plan.oversized.length})</strong>
                </div>
                {plan.oversized.map((o, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--s2j-text)", padding: "2px 0" }}>
                    <span style={{ fontWeight: 500 }}>{o.name || nameOfUid(o.id)}</span>
                    <span style={{ color: "var(--s2j-text-muted)" }}>{" - "}{oversizedReasonText(o)}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <SkillBottleneck bucketMetrics={plan.bucketMetrics} />
          </>
        ) : null}

        <SpecConcernsBand summary={specConcernSummary} />
        <RiskRegister entries={riskRegister} usedLlm={r.usedLlm} kanban={isKanban} />

        {/* collapsed detail — demoted, never dropped (Plan brief moved to the foot of step 4 — partner) */}
        {!isKanban && assumptions && assumptions.length ? (
          <Accordion title="Assumptions" count={assumptions.length} kind="info">
            {assumptions.map((a, i) => (
              <div key={i} className="flex" style={{ justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "3px 0" }}>
                <span style={{ color: "var(--s2j-text-muted)" }}>{a.label}</span>
                <span style={{ color: "var(--s2j-text)", fontWeight: 500, textAlign: "right" }}>
                  {String(a.value)}{a.source === "default" ? <span style={{ color: "var(--s2j-text-light)", fontWeight: 400 }}> (default)</span> : null}
                </span>
              </div>
            ))}
          </Accordion>
        ) : null}
        {!isKanban && plan.bucketsActive && skillDiagCount ? (
          <Accordion title="Skill detail" count={skillDiagCount} kind="info">
            <SkillDiagnostics skillDiagnostics={plan.skillDiagnostics} />
          </Accordion>
        ) : null}
        {diagCount ? (
          <Accordion title="Data quality" count={diagCount} kind="info">
            <PlanDiagnostics g={g} sizingIssues={plan.sizingIssues} nameOfUid={nameOfUid} />
          </Accordion>
        ) : null}

        <div className="flex items-center" style={{ justifyContent: "space-between", marginTop: 16, flexWrap: "wrap", gap: 10 }}>
          <BackButton onClick={() => goStep(4)} label="Back to plan" className="" title="Back to your plan" />
          {/* Terminal forward CTA — back to the breakdown review, where Push to Jira / test-case generation live.
              GREEN (commit) per the partner: it's the culmination of the planning flow, not mere wayfinding. */}
          <button type="button" onClick={onBack} className="btn-primary" style={{ fontSize: 13.5, padding: "9px 18px" }} title="Return to the breakdown review — from there you can push to Jira or generate test cases">
            Continue to review <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    );
  } else {
    // ── STEP 4 — Your plan (plan-first; all analysis demoted to step 5 + the health teaser). "Generating"
    // is the loading sub-state. ──
    stepBody = (
      <div>
        {busy ? (
          <PlanningState elapsed={elapsed} kanban={formIsKanban} repacking={repacking} />
        ) : r.empty ? (
          <SignalCallout kind="info" title="No features to plan">
            This breakdown has no features yet. Add features in the editor, then come back to plan.
          </SignalCallout>
        ) : !hasPlan ? (
          <div style={{ border: "1px dashed var(--s2j-border)", borderRadius: 12, padding: 32, textAlign: "center", color: "var(--s2j-text-light)" }}>
            <div style={{ display: "inline-flex", color: "var(--s2j-border)", marginBottom: 8 }}>{formIsKanban ? <IconList size={32} /> : <IconCalendar size={32} />}</div>
            <p style={{ fontSize: 13.5, margin: "0 0 14px", lineHeight: 1.55 }}>
              {formIsKanban
                ? `Fill in your team capacity and generate a plan to see ${featureCount} features ordered into a Now / Next / Later backlog.`
                : `Fill in your team capacity and generate a plan to see ${featureCount} features allocated across your sprints.`}
            </p>
            <WizardNext onClick={() => goStep(1)}>Start setup</WizardNext>
          </div>
        ) : isKanban ? (
          // ── KANBAN plan view (plan-first): the backlog + the honesty framing lead; analysis demoted to step 5 ──
          <>
            <div className="flex" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
              <button type="button" onClick={handleRepack} disabled={busy} title="Free: re-applies your current capacity to the same Claude ordering — instant, no Claude call. To re-optimize the order itself, change the Planning objective and Re-rank with Claude." className="btn-secondary" style={{ fontSize: 12.5 }}>
                <IconRefresh size={13} /> Re-pack backlog (free)
              </button>
            </div>
            {r.llmNote ? (<SignalCallout kind="info" title="Ordered without Claude" style={{ marginBottom: 12 }}>{r.llmNote}</SignalCallout>) : null}

            {/* honesty stays INLINE — it frames HOW to read the bands (load-bearing per the research), like the
                fragmentation note frames the sprint columns; only verdicts-about-features move to step 5. */}
            <KanbanHonestyPanel assumptions={assumptions} />
            <SignalCallout kind="info" title="Likely reach this quarter" style={{ marginBottom: 12 }}>{kanbanReachVerdict(metrics)}</SignalCallout>

            {/* THE PLAN */}
            <BacklogBand plan={plan} byUid={byUid} riskByUid={riskByUid} signalsByUid={signalsByUid} rationaleByUid={rationaleByUid} onCritical={onCritical} usedLlm={r.usedLlm} criticalChainExists={criticalChainExists} />

            {/* §11 health teaser → step 5 (or a clean affirmation when this Kanban plan carries no analysis) */}
            <PlanHealthStrip signals={healthSignals} hasWarning={healthHasWarning} featureCount={featureCount} routes={hasStep5} onOpen={() => goStep(5)} kanban />

            {r.cost && r.cost.total_usd != null ? (
              <p className="text-xs" style={{ marginTop: 12, color: "var(--s2j-text-light)" }}>
                <IconCost size={12} /> This ranking used {fmtUsd(r.cost.total_usd)}{trialActive ? " of your free trial credit. Re-pack is free; only Re-rank with Claude uses it." : " of your Anthropic key. Re-pack is free; only Re-rank with Claude is billed."}
              </p>
            ) : null}
          </>
        ) : (
          // ── SCRUM plan view (plan-first): the sprint columns + What-if lead; all analysis demoted to step 5 ──
          <>
            <div className="flex" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
              <button type="button" onClick={handleRepack} disabled={busy} title="Free: re-applies your current capacity to the same Claude ordering — instant, no Claude call. To re-optimize the order itself, change the Planning objective and Re-rank with Claude." className="btn-secondary" style={{ fontSize: 12.5 }}>
                <IconRefresh size={13} /> Re-pack sprints (free)
              </button>
            </div>
            {r.llmNote ? (<SignalCallout kind="info" title="Ordered without Claude" style={{ marginBottom: 12 }}>{r.llmNote}</SignalCallout>) : null}

            {/* THE PLAN — sprint columns (the first thing the user came for) */}
            <div className="flex" style={{ gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              {plan.sprints.map((s, i) => (
                <SprintColumn key={i} sprint={s} number={i + 1} byUid={byUid} oversizedSet={oversizedSet} riskByUid={riskByUid} profile={sprintRiskProfiles[i]} startDate={form && form.sprintStartDate} sprintLengthDays={form && form.sprintLengthDays} signalsByUid={signalsByUid} rationaleByUid={rationaleByUid} onCritical={onCritical} usedLlm={r.usedLlm} criticalChainExists={criticalChainExists} />
              ))}
            </div>

            {/* fragmentation stays INLINE — a one-line caveat about the order you're reading, not a separate verdict */}
            {fragmentation ? (
              <SignalCallout kind="info" title={fragmentation.title} style={{ marginBottom: 12 }}>
                {fragmentation.body} Re-rank or adjust sprint length.
              </SignalCallout>
            ) : null}

            {/* What-if — the co-star, +1 prominence right under the plan. Hidden when the form's mode no longer
                matches the rendered plan (a sprint scenario under a kanban form would silently drop — §11);
                the nudge then explains + points at Re-pack. */}
            {methodologyChanged ? (
              <SignalCallout kind="warning" title="Planning mode changed" style={{ marginBottom: 12 }}>
                You switched the planning mode since this plan was built. Re-pack (free, top-right) to rebuild it in the new mode — What-if scenarios return once the plan and the mode agree.
              </SignalCallout>
            ) : (
              <WhatIfPanel jobId={jobId} baselineForm={form} slimFeatures={nameFeatures} stale={r.stale} planBusy={busy} onApplyScenario={handleApply} />
            )}

            {/* §11 health teaser — the counts + magnitude stay ON the plan; the per-feature WHY lives on step 5 */}
            <PlanHealthStrip signals={healthSignals} hasWarning={healthHasWarning} featureCount={featureCount} routes={hasStep5} onOpen={() => goStep(5)} sprintCount={plan.sprints.length} />

            {/* Plan summary — the plan's story ON screen (verdict / critical path / leverage / what-we-cut),
                reusing the SAME derivations as the copy-out; keeps the three Copy buttons. Foot of the plan. */}
            <PlanSummaryPanel plan={plan} sprintCount={plan.sprints.length} nameOf={nameOfUid} brief={brief} />

            {r.cost && r.cost.total_usd != null ? (
              <p className="text-xs" style={{ marginTop: 12, color: "var(--s2j-text-light)" }}>
                <IconCost size={12} /> This ranking used {fmtUsd(r.cost.total_usd)}{trialActive ? " of your free trial credit. Re-pack is free; only Re-rank with Claude uses it." : " of your Anthropic key. Re-pack is free; only Re-rank with Claude is billed."}
              </p>
            ) : null}
          </>
        )}

        {!busy && hasPlan ? (
          <div className="flex items-center" style={{ justifyContent: "space-between", marginTop: 16, flexWrap: "wrap", gap: 10 }}>
            <BackButton onClick={() => goStep(2)} label="Back to capacity" className="" title="Adjust team capacity" />
            {hasStep5 ? (
              <WizardNext onClick={() => goStep(5)}>View plan health</WizardNext>
            ) : (
              // Clean Kanban has no step 5 → step 4 is terminal, so it carries the green Continue-to-review CTA.
              <button type="button" onClick={onBack} className="btn-primary" style={{ fontSize: 13.5, padding: "9px 18px" }} title="Return to the breakdown review — from there you can push to Jira or generate test cases">
                Continue to review <span aria-hidden="true">→</span>
              </button>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="p-6" style={step === 4 ? WRAP : WIZARD_WRAP}>
      <ScreenHeader
        onBack={onBack}
        backLabel="Back to review"
        backTitle="Return to the breakdown review"
        icon={headerIsKanban ? <IconList size={20} /> : <IconCalendar size={20} />}
        title={headerIsKanban ? "Backlog plan" : "Sprint plan"}
        subtitle={headerIsKanban
          ? "Order this breakdown into a pull-ready backlog, cut into Now / Next / Later by likely reach."
          : "Allocate this breakdown across sprints from your team's capacity."}
      />

      <Stepper labels={stepLabels} step={step} maxStep={maxStep} onJump={goStep} busy={busy} ariaLabel="Planner steps" />

      {r.stale ? (
        <SignalCallout kind="warning" title="This plan is out of date" style={{ marginBottom: 14 }}>
          The breakdown changed since this plan was generated. Re-rank to refresh it against the current features.
        </SignalCallout>
      ) : null}

      {/* tabIndex=-1 focus target: the step-change effect focuses this so AT users land on the new step */}
      <div ref={stepBodyRef} tabIndex={-1} style={{ outline: "none" }}>{stepBody}</div>
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
