import React, { useState, useRef, useEffect, useCallback } from "react";
import EditableField from "./breakdown/EditableField.jsx";
import AcTraceEditor from "./AcTraceEditor.jsx";
import { IconX } from "./Icon";
import { SignalIcon } from "./Signal";

// Canon (src/prompts.js TEST_CASE_SCHEMA): type ∈ 3, priority ∈ 4 (optional).
const TYPE_OPTIONS = ["happy-path", "edge", "negative"];
const PRIORITY_OPTIONS = ["Critical", "High", "Medium", "Low"];

const TYPE_BADGE = {
  "happy-path": { fg: "var(--s2j-green-dark)", bg: "var(--s2j-green-bg)", border: "var(--s2j-green-border)" },
  edge: { fg: "var(--s2j-orange)", bg: "var(--s2j-orange-bg)", border: "var(--s2j-orange-border)" },
  negative: { fg: "var(--s2j-red)", bg: "var(--s2j-red-bg)", border: "var(--s2j-red-border)" },
};

// ── FieldBlock — a BLOCK label sitting on its OWN line above its control. THE fix for the partner's
// "EXPECTED RESULTA valid session…" / "CONCERN (OPTIONAL)e.g…" merge bug: the old code used an INLINE
// <span> label that the value ran straight onto. One shared block-label vehicle, applied everywhere, so a
// field label can never hug its value again. Label size bumped 10→12px (readability). ───────────────────
const fieldLabelStyle = {
  display: "block", fontSize: 12, fontWeight: 600, color: "var(--s2j-text-muted)",
  textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4,
};
function FieldBlock({ label, action, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {action ? (
        <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
          <span style={{ ...fieldLabelStyle, marginBottom: 0 }}>{label}</span>
          {action}
        </div>
      ) : (
        <span style={fieldLabelStyle}>{label}</span>
      )}
      {children}
    </div>
  );
}

// ── StringListEditor — the "+Add / hover-✕ / EditableField-row" list, for given / when / then / test_data.
// Label is a FieldBlock action-row (block label + "+ Add" on the right); items bumped to 13px / 1.55. ─────
function StringListEditor({ label, items, onChange, addLabel = "+ Add", placeholder }) {
  const list = Array.isArray(items) ? items : [];
  function update(i, val) {
    const next = [...list];
    next[i] = val;
    onChange(next);
  }
  return (
    <FieldBlock
      label={label}
      action={
        <button type="button" onClick={() => onChange([...list, ""])} className="text-[12px]" style={{ color: "var(--s2j-blue)" }}>
          {addLabel}
        </button>
      }
    >
      <div className="space-y-1">
        {list.map((item, i) => (
          <div key={i} className="group/li flex items-start gap-2">
            <span className="mt-1.5 text-[10px]" style={{ color: "var(--s2j-skySteel, #7DA0CA)" }}>•</span>
            <div className="flex-1 min-w-0">
              <EditableField
                value={item}
                multiline
                placeholder={placeholder}
                className="text-[13px] leading-relaxed"
                onChange={(val) => update(i, val)}
              />
            </div>
            <button
              type="button"
              onClick={() => onChange(list.filter((_, idx) => idx !== i))}
              className="mt-1 opacity-0 group-hover/li:opacity-100 transition-all text-[12px] px-1"
              style={{ color: "var(--s2j-red)" }}
              title="Remove"
            >
              <IconX size={12} title="Remove" />
            </button>
          </div>
        ))}
        {list.length === 0 && (
          <span className="text-[12px] italic" style={{ color: "var(--s2j-text-light)" }}>none — “+ Add” to add one</span>
        )}
      </div>
    </FieldBlock>
  );
}

/**
 * EditableCaseRow — the editable card for one test case.
 *
 * Always inline-editable (click-to-edit, like FeatureCard) so at rest it reads like the view, and edits
 * commit to the parent draft via onChange(nextCase). ac_trace is edited through the coverage-safe
 * AcTraceEditor (AC-checklist, never free-text). Delete is a two-step inline confirm (window.confirm is
 * blocked in the Forge iframe). 2026-06-27 redesign: moodboard glass surface, 12/13/14px type scale (up
 * from 10/11), and FieldBlock block-labels (the merge-bug fix). Props + behavior are UNCHANGED.
 *
 * Props:
 *   tc                  — the test case object
 *   caseNumber          — 1-based display index (the ABSOLUTE index in the story's test_cases + 1)
 *   acceptanceCriteria  — string[] the story's live ACs (drives the AcTraceEditor checklist)
 *   onChange            — fn(nextCase)
 *   onDelete            — fn()
 */
export default function EditableCaseRow({
  tc,
  caseNumber,
  acceptanceCriteria,
  onChange,
  onDelete,
  // Per-case Save/Revert footer (Work B) — rendered below THIS case when it has unsaved edits, so
  // Save/Revert is always right where you're editing. Save is per-STORY (KVS is per-story; the
  // tooltip says so honestly); Revert is genuinely per-case.
  showSaveBar = false,
  isNewCase = false,
  saving = false,
  saveState = "idle",
  saveError = null,
  onSaveStory,
  onRevertCase,
  readOnly = false,
}) {
  const c = tc || {};
  const type = c.type || "happy-path";
  const badge = TYPE_BADGE[type] || { fg: "var(--s2j-text-muted)", bg: "var(--s2j-bg-section)", border: "var(--s2j-border)" };

  function set(field, val) { onChange({ ...c, [field]: val }); }

  // Validity hint — the parse DROPS a case with no When or no Then; surface it so the drop
  // is never silent (POLICY: surface failures, never silent).
  const when = Array.isArray(c.when) ? c.when.filter((s) => String(s || "").trim()) : [];
  const then = Array.isArray(c.then) ? c.then.filter((s) => String(s || "").trim()) : [];
  const invalid = when.length === 0 || then.length === 0;

  // Two-step inline delete (no window.confirm — blocked in the Forge sandboxed iframe).
  const [armed, setArmed] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onDeleteClick = useCallback(() => {
    if (armed) {
      clearTimeout(timer.current);
      setArmed(false);
      onDelete();
    } else {
      setArmed(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), 4000);
    }
  }, [armed, onDelete]);

  return (
    // [deep-audit E-#6] read-only (downgraded user): a disabled fieldset NATIVELY disables every nested
    // input/select/button → a true read-only card matching the banner, with no dead/clickable controls.
    // minInlineSize resets the fieldset's default min-content sizing so layout is unchanged.
    // Moodboard glass surface: near-opaque white fill (legibility never depends on backdrop-filter) + a
    // sky-steel hairline + a soft deep-blue shadow. An INVALID case keeps its orange border (§11 signal).
    <fieldset
      disabled={readOnly}
      className="p-4 mb-3 text-xs"
      style={{
        background: "rgba(255,255,255,0.72)",
        border: `1px solid ${invalid ? "var(--s2j-orange-border)" : "rgba(125,160,202,0.30)"}`,
        borderRadius: 14,
        boxShadow: "0 6px 22px rgba(5,38,89,0.07)",
        minInlineSize: "auto",
      }}
    >
      {/* Header: # · type · priority · title · delete */}
      <div className="flex items-start gap-2 mb-3 flex-wrap">
        <span className="text-[12px] mt-1.5 shrink-0 font-medium" style={{ color: "var(--s2j-text-muted)" }}>#{caseNumber}</span>
        <select
          value={type}
          onChange={(e) => set("type", e.target.value)}
          className="text-[12px] rounded px-1.5 py-1 font-medium shrink-0"
          style={{ background: badge.bg, border: `1px solid ${badge.border}`, color: badge.fg }}
          title="Coverage type"
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>@{t}</option>
          ))}
        </select>
        <select
          value={c.priority || ""}
          onChange={(e) => set("priority", e.target.value || undefined)}
          className="text-[12px] rounded px-1.5 py-1 shrink-0"
          style={{ background: "var(--s2j-bg-section)", border: "1px solid var(--s2j-border)", color: "var(--s2j-text-light)" }}
          title="Test-case priority (optional)"
        >
          <option value="">priority —</option>
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <div className="flex-1 min-w-[140px] font-semibold text-[14px]" style={{ color: "var(--s2j-text)" }}>
          <EditableField value={c.title} placeholder="Scenario title…" maxLength={200} onChange={(val) => set("title", val)} />
        </div>
        <button
          type="button"
          onClick={onDeleteClick}
          className="text-[11px] px-1.5 py-0.5 rounded shrink-0"
          style={{
            background: armed ? "var(--s2j-red-bg)" : "none",
            border: `1px solid ${armed ? "var(--s2j-red-border)" : "var(--s2j-border)"}`,
            color: armed ? "var(--s2j-red)" : "var(--s2j-text-muted)",
          }}
          title={armed ? "Click again to confirm — delete this case" : "Delete this case"}
        >
          {armed ? "Confirm — delete?" : <IconX size={12} title="Delete this case" />}
        </button>
      </div>

      {invalid && (
        <div className="text-[12px] mb-3 flex items-center gap-1.5" style={{ color: "var(--s2j-orange)" }}>
          <SignalIcon kind="warning" size={14} /> A case needs at least one When and one Then, or it is dropped on save.
        </div>
      )}

      {/* concern (clearable) */}
      <FieldBlock label="Concern (optional)">
        <EditableField
          value={c.concern || ""}
          multiline
          placeholder="e.g. [ASSUMPTION|medium] …"
          className="text-[13px] leading-relaxed"
          onChange={(val) => set("concern", val || undefined)}
        />
      </FieldBlock>

      {/* Scenario (BDD): Given / When / Then grouped under one labeled subsection for readability */}
      <div
        className="mb-2 pt-1"
        style={{ borderTop: "1px solid rgba(125,160,202,0.22)" }}
      >
        <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--s2j-text-light)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "8px 0 8px" }}>
          Scenario (BDD)
        </span>
        <StringListEditor label="Given (preconditions)" items={c.given} onChange={(v) => set("given", v)} placeholder="a precondition…" />
        <StringListEditor label="When (action)" items={c.when} onChange={(v) => set("when", v)} placeholder="an observable action…" />
        <StringListEditor label="Then (outcome)" items={c.then} onChange={(v) => set("then", v)} placeholder="an observable outcome…" />
      </div>

      {/* Expected result */}
      <FieldBlock label="Expected result">
        <EditableField
          value={c.expected_result || ""}
          multiline
          placeholder="the single falsifiable pass/fail assertion…"
          className="text-[13px] leading-relaxed"
          onChange={(val) => set("expected_result", val)}
        />
      </FieldBlock>

      {/* Test data */}
      <StringListEditor label="Test data (optional)" items={c.test_data} onChange={(v) => set("test_data", v)} placeholder="a concrete value…" />

      {/* ac_trace — coverage-safe checklist */}
      <div className="mt-2 pt-3" style={{ borderTop: "1px dashed rgba(125,160,202,0.30)" }}>
        <AcTraceEditor acTrace={c.ac_trace} acceptanceCriteria={acceptanceCriteria} onChange={(next) => set("ac_trace", next)} />
      </div>

      {/* Per-case Save/Revert footer (Work B) — under THIS case when it has unsaved edits, so the controls
          are always where you're editing. Save persists the WHOLE story (KVS is per-story — the tooltip is
          explicit); Revert is genuinely per-case (or "Remove" for a never-saved case). */}
      {showSaveBar && (
        <div
          className="mt-3 pt-3 flex items-center gap-2 flex-wrap"
          style={{ borderTop: "1px dashed var(--s2j-blue-border)" }}
        >
          <span
            className="text-[12px] flex-1 min-w-[120px] font-medium"
            style={{ color: saveState === "error" ? "var(--s2j-red)" : "var(--s2j-blue)" }}
          >
            {saveState === "error"
              ? saveError || "Save failed — your edits are still here. Try again."
              : isNewCase
              ? "● New case — unsaved"
              : "● Edited — unsaved"}
          </span>
          <button
            type="button"
            onClick={() => onRevertCase && onRevertCase()}
            disabled={saving}
            className="text-[12px] px-2.5 py-1 rounded shrink-0"
            style={{
              background: "none",
              border: "1px solid var(--s2j-border)",
              color: "var(--s2j-text-muted)",
              cursor: saving ? "not-allowed" : "pointer",
            }}
            title={isNewCase ? "Remove this unsaved case" : "Discard your edits to this case"}
          >
            {isNewCase ? "Remove" : "Revert this case"}
          </button>
          <button
            type="button"
            onClick={() => onSaveStory && onSaveStory()}
            disabled={saving}
            className="text-[12px] px-3.5 py-1 rounded font-medium shrink-0"
            style={{
              background: "var(--s2j-blue)",
              border: "1px solid var(--s2j-blue)",
              color: "#fff",
              cursor: saving ? "not-allowed" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
            title="Save all edits in this story (updates coverage, export & push)"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </fieldset>
  );
}
