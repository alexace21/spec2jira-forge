import React, { useState, useRef, useEffect, useCallback } from "react";
import EditableField from "./breakdown/EditableField.jsx";
import AcTraceEditor from "./AcTraceEditor.jsx";
import { IconX, IconChevronRight } from "./Icon";
import { SignalIcon } from "./Signal";
import { glassSurface } from "./moodboard";
import { Chip, ConfidenceBadge, ConcernChip, ConcernStrip, priorityTone, resolveConfidence, TONE } from "./moodChips";
import { ConfidenceGlyph, confidenceToken } from "./breakdown/signalTokens";

// Canon (src/prompts.js TEST_CASE_SCHEMA): type in 3, priority in 4 (optional).
const TYPE_OPTIONS = ["happy-path", "edge", "negative"];
const PRIORITY_OPTIONS = ["Critical", "High", "Medium", "Low"];

const TYPE_BADGE = {
  "happy-path": { fg: "var(--s2j-green-dark)", bg: "var(--s2j-green-bg)", border: "var(--s2j-green-border)" },
  edge: { fg: "var(--s2j-orange)", bg: "var(--s2j-orange-bg)", border: "var(--s2j-orange-border)" },
  negative: { fg: "var(--s2j-red)", bg: "var(--s2j-red-bg)", border: "var(--s2j-red-border)" },
};

// Shared outlined-box style for editable field entries (mockup fidelity: each field entry reads as a
// bordered white form-field box, matching FocusedStory's outlined content boxes). Presentation only.
const fieldBoxStyle = { border: "1px solid var(--s2j-border)", background: "var(--s2j-bg)", borderRadius: 10, padding: "7px 10px" };

// FieldBlock -- a BLOCK label sitting on its OWN line above its control. THE fix for the partner's
// "EXPECTED RESULTA valid session..." / "CONCERN (OPTIONAL)e.g..." merge bug: the old code used an INLINE
// <span> label that the value ran straight onto. One shared block-label vehicle, applied everywhere, so a
// field label can never hug its value again. Label size 12px (readability); textTransform uppercases it.
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

// StringListEditor -- the "+Add / hover-x / EditableField-row" list, for given / when / then / test_data.
// Label is a FieldBlock action-row (block label + "+ Add" on the right); items are 13px / 1.55.
function StringListEditor({ label, items, onChange, addLabel = "+ Add", placeholder, emptyLabel }) {
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
            <div className="flex-1 min-w-0 flex items-start gap-2" style={fieldBoxStyle}>
              <span className="mt-1.5 text-[10px]" style={{ color: "var(--s2j-skySteel, #7DA0CA)" }}>&bull;</span>
              <div className="flex-1 min-w-0">
                <EditableField
                  value={item}
                  multiline
                  placeholder={placeholder}
                  className="text-[13px] leading-relaxed"
                  onChange={(val) => update(i, val)}
                />
              </div>
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
          <span className="text-[12px] italic" style={{ color: "var(--s2j-text-light)" }}>{emptyLabel || 'none - "+ Add" to add one'}</span>
        )}
      </div>
    </FieldBlock>
  );
}

/**
 * EditableCaseRow -- the editable card for one test case (Round 8, direction 1A).
 *
 * Always inline-editable (click-to-edit, like FeatureCard) so at rest it reads like the view, and edits
 * commit to the parent draft via onChange(nextCase). ac_trace is edited through the coverage-safe
 * AcTraceEditor (AC-checklist, never free-text). Delete is a two-step inline confirm (window.confirm is
 * blocked in the Forge iframe). Presentation: moodboard glassSurface("utility") + a left-accent-by-state
 * (dirty=blue / invalid=orange) + the right-edge trust cluster (confidence / concern / invalid marker).
 * Props + behavior are UNCHANGED; the three new signals are already-present per-case data surfaced as chips.
 *
 * Props:
 *   tc                  -- the test case object
 *   caseNumber          -- 1-based display index (the position WITHIN its type-phase)
 *   acceptanceCriteria  -- string[] the story's live ACs (drives the AcTraceEditor checklist)
 *   onChange            -- fn(nextCase)
 *   onDelete            -- fn()
 */
export default function EditableCaseRow({
  tc,
  caseNumber,
  acceptanceCriteria,
  onChange,
  onDelete,
  // Per-case Save/Revert footer (Work B) -- rendered below THIS case when it has unsaved edits, so
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

  // Collapsible (partner 2026-06-28): cases are CLOSED by default so a long story reads as a quick
  // scan -- the header (# . type . priority . title . trust cluster) stays visible; the chevron opens the
  // editor. A NEW case starts OPEN (it must be filled). The save bar + an invalid marker stay visible even
  // collapsed (POLICY: never hide unsaved / dropped state). The toggle is a <span role="button">, NOT a
  // <button>, so it still works inside the read-only disabled <fieldset> (which natively disables buttons).
  const [open, setOpen] = useState(!!isNewCase);
  const chevronRef = useRef(null);
  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    // a11y (gate fix): collapsing unmounts the body, so if focus was inside it, keep focus on the
    // chevron rather than letting the browser strand it on <body>. (The chevron is always mounted.)
    if (!next && chevronRef.current) chevronRef.current.focus();
  };

  // Validity hint -- the parse DROPS a case with no When or no Then; surface it so the drop
  // is never silent (POLICY: surface failures, never silent).
  const when = Array.isArray(c.when) ? c.when.filter((s) => String(s || "").trim()) : [];
  const then = Array.isArray(c.then) ? c.then.filter((s) => String(s || "").trim()) : [];
  const invalid = when.length === 0 || then.length === 0;

  // Two-step inline delete (no window.confirm -- blocked in the Forge sandboxed iframe).
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

  // The three already-present per-case SIGNALS (all optional, graceful absence):
  const dirty = !!showSaveBar; // this card carries an unsaved-edits footer
  const accent = dirty ? "var(--s2j-blue)" : invalid ? "var(--s2j-orange)" : "transparent";
  const pTone = priorityTone(c.priority);
  const conf = resolveConfidence(c.confidence_indicator, c.confidence_score); // null when neither present
  // The glyph for the read-only self-confidence panel: the actual indicator when present, else DERIVED
  // from the band (high check / medium triangle / low diamond) so ConfidenceGlyph always renders a shape.
  const confHasInd = c.confidence_indicator != null && String(c.confidence_indicator).trim() !== "";
  const confGlyph = conf
    ? (confHasInd ? String(c.confidence_indicator).trim() : (conf.band === "high" ? "✓" : conf.band === "medium" ? "⚠" : "✗"))
    : null;
  const hasConcern = !!(c.concern && String(c.concern).trim());
  // Inferred = this case has an ac_trace entry with kind 'inferred' (no authored AC governs it) -- the
  // SAME predicate AcTraceEditor uses. Surfaced as a small neutral header chip (mockup board 1E).
  const acTrace = Array.isArray(c.ac_trace) ? c.ac_trace : [];
  const isInferred = acTrace.some((t) => t && t.kind === "inferred");

  return (
    // [deep-audit E-#6] read-only (downgraded user): a disabled fieldset NATIVELY disables every nested
    // input/select/button -> a true read-only card matching the banner, with no dead/clickable controls.
    // minInlineSize resets the fieldset's default min-content sizing so layout is unchanged.
    // Moodboard glass surface (utility density: ice->white wash + sky-steel hairline + soft blue shadow).
    // The left-accent bar carries state (blue=dirty, orange=invalid) -- the FocusedStory pattern.
    <fieldset
      disabled={readOnly}
      className="p-4 mb-3 text-xs"
      style={{
        ...glassSurface("utility"),
        borderLeft: `4px solid ${accent}`,
        minInlineSize: "auto",
      }}
    >
      {/* Header: chevron . # . type . priority . title . [right trust cluster] -- ALWAYS visible; the body
          below collapses. The chevron is a <span role=button> (works inside the read-only fieldset). */}
      <div className="flex items-start gap-2 flex-wrap" style={{ marginBottom: open ? 12 : 0 }}>
        <span
          ref={chevronRef}
          role="button"
          tabIndex={0}
          onClick={toggleOpen}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOpen(); } }}
          aria-expanded={open}
          aria-label={open ? "Collapse this test case" : "Expand this test case"}
          className="mt-1 shrink-0"
          style={{ cursor: "pointer", color: "var(--s2j-text-muted)", lineHeight: 0, padding: 2 }}
          title={open ? "Collapse this case" : "Expand this case"}
        >
          <span style={{ display: "inline-flex", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
            <IconChevronRight size={14} />
          </span>
        </span>
        <span className="text-[12px] mt-1.5 shrink-0 font-medium" style={{ color: "var(--s2j-text-muted)" }}>#{caseNumber}</span>
        {/* type -- editable pill, coloured by type (happy=green / edge=orange / negative=red) */}
        <select
          value={type}
          onChange={(e) => set("type", e.target.value)}
          className="text-[11px] shrink-0 font-medium s2j-field"
          style={{ background: badge.bg, border: `1px solid ${badge.border}`, color: badge.fg, borderRadius: 999, padding: "2px 9px" }}
          title="Coverage type"
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>@{t}</option>
          ))}
        </select>
        {/* priority -- editable pill, coloured by priorityTone; a LOW-EMPHASIS placeholder when absent */}
        <select
          value={c.priority || ""}
          onChange={(e) => set("priority", e.target.value || undefined)}
          className="text-[11px] shrink-0 s2j-field"
          style={{
            ...(pTone
              ? { background: TONE[pTone].bg, border: `1px solid ${TONE[pTone].border}`, color: "var(--s2j-text)", fontWeight: 500 }
              : { background: "transparent", border: "1px dashed var(--s2j-border)", color: "var(--s2j-text-muted)", fontWeight: 400 }),
            borderRadius: 999,
            padding: "2px 9px",
          }}
          title="Test-case priority (optional)"
        >
          <option value="">Set priority</option>
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <div className="flex-1 min-w-[140px] font-semibold text-[14px]" style={{ color: "var(--s2j-text)" }}>
          <EditableField value={c.title} placeholder="Scenario title..." maxLength={200} onChange={(val) => set("title", val)} />
        </div>
        {/* Right-edge trust cluster -- each part renders ONLY when its datum exists (graceful absence;
            a case with none of confidence/concern/invalid shows just the delete, like mockup case #5). */}
        <div className="flex items-center gap-1.5 shrink-0" style={{ marginTop: 2 }}>
          <ConfidenceBadge indicator={c.confidence_indicator} score={c.confidence_score} />
          <ConcernChip concern={c.concern} />
          {/* inferred marker (mockup 1E) -- this case verifies behaviour no authored AC governs */}
          {isInferred && (
            <Chip tone="neutral" title="No authored acceptance criterion governs this case.">Inferred</Chip>
          )}
          {/* collapsed-visible §11 marker -- a dropped-risk (no When/Then) case must show even when closed */}
          {invalid && !open && (
            <Chip
              tone="warning"
              icon={<SignalIcon kind="warning" size={13} />}
              title="This case is missing a When or Then - it will be dropped on save. Open it to fix."
            >
              needs When/Then
            </Chip>
          )}
          <button
            type="button"
            onClick={onDeleteClick}
            className="text-[11px] px-1.5 py-0.5 rounded"
            style={{
              background: armed ? "var(--s2j-red-bg)" : "none",
              border: `1px solid ${armed ? "var(--s2j-red-border)" : "var(--s2j-border)"}`,
              color: armed ? "var(--s2j-red)" : "var(--s2j-text-muted)",
            }}
            title={armed ? "Click again to confirm - delete this case" : "Delete this case"}
          >
            {armed ? "Confirm - delete?" : <IconX size={12} title="Delete this case" />}
          </button>
        </div>
      </div>

      {/* Collapsible body -- the full editor; closed by default (the partner's scan-then-open flow). */}
      {open && (
        <>
          {invalid && (
            <div className="text-[12px] mb-3 flex items-center gap-1.5" style={{ color: "var(--s2j-orange)" }}>
              <SignalIcon kind="warning" size={14} /> A case needs at least one When and one Then, or it is dropped on save.
            </div>
          )}

          {/* Trust panels row -- only the panels whose data exists; omit the whole row if neither. */}
          {(conf || hasConcern) && (
            <div className="flex flex-wrap gap-2" style={{ marginBottom: 12 }}>
              {conf && (
                <div style={{ flex: "1 1 220px", background: TONE[conf.kind].bg, border: `1px solid ${TONE[conf.kind].border}`, borderRadius: 12, padding: "8px 12px" }}>
                  <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
                    <ConfidenceGlyph indicator={confGlyph} size={16} title={`Model self-confidence: ${confidenceToken(confGlyph).label}`} />
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--s2j-text-muted)" }}>
                      Model self-confidence - read-only
                    </span>
                    {conf.hasScore && (
                      <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "var(--s2j-text)" }}>{conf.score}/100</span>
                    )}
                  </div>
                  <p style={{ fontSize: 12, lineHeight: 1.5, color: "var(--s2j-text)", margin: 0 }}>
                    {confidenceToken(confGlyph).explain}
                  </p>
                </div>
              )}
              {hasConcern && (
                <div style={{ flex: "1 1 220px" }}>
                  <ConcernStrip concern={c.concern} />
                </div>
              )}
            </div>
          )}

          {/* concern editor -- the RAW editable "[TYPE|severity] text"; the decoded strip above is
              display-only (editing is unchanged). Clearable (empty -> undefined). */}
          <FieldBlock label="Concern - editable - [TYPE|severity] text">
            <div style={fieldBoxStyle}>
              <EditableField
                value={c.concern || ""}
                multiline
                placeholder="e.g. [ASSUMPTION|medium] ..."
                className="text-[13px] leading-relaxed"
                onChange={(val) => set("concern", val || undefined)}
              />
            </div>
          </FieldBlock>

          {/* Scenario (BDD): Given / When / Then grouped under one labeled subsection for readability */}
          <div className="mb-2 pt-1" style={{ borderTop: "1px solid rgba(125,160,202,0.22)" }}>
            <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--s2j-text-light)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "8px 0 8px" }}>
              Scenario (BDD)
            </span>
            <StringListEditor label="Given (preconditions)" items={c.given} onChange={(v) => set("given", v)} placeholder="a precondition..." />
            <StringListEditor label="When (action)" items={c.when} onChange={(v) => set("when", v)} placeholder="an observable action..." />
            <StringListEditor label="Then (outcome)" items={c.then} onChange={(v) => set("then", v)} placeholder="an observable outcome..." />
          </div>

          {/* Expected result */}
          <FieldBlock label="Expected result - the single falsifiable assertion">
            <div style={fieldBoxStyle}>
              <EditableField
                value={c.expected_result || ""}
                multiline
                placeholder="the single falsifiable pass/fail assertion..."
                className="text-[13px] leading-relaxed"
                onChange={(val) => set("expected_result", val)}
              />
            </div>
          </FieldBlock>

          {/* Test data */}
          <StringListEditor
            label="Test data - optional"
            items={c.test_data}
            onChange={(v) => set("test_data", v)}
            placeholder="a concrete value..."
            emptyLabel={'none - "+ Add" to attach concrete values'}
          />

          {/* ac_trace -- coverage-safe checklist */}
          <div className="mt-2 pt-3" style={{ borderTop: "1px dashed rgba(125,160,202,0.30)" }}>
            <AcTraceEditor acTrace={c.ac_trace} acceptanceCriteria={acceptanceCriteria} onChange={(next) => set("ac_trace", next)} />
          </div>
        </>
      )}

      {/* Per-case Save/Revert footer (Work B) -- under THIS case when it has unsaved edits, so the controls
          are always where you're editing. Save persists the WHOLE story (KVS is per-story -- the tooltip is
          explicit); Revert is genuinely per-case (or "Remove" for a never-saved case). Save stays BLUE. */}
      {showSaveBar && (
        <div
          className="mt-3 pt-3 flex items-center gap-2 flex-wrap"
          style={{ borderTop: "1px dashed var(--s2j-blue-border)" }}
        >
          <span
            className="text-[12px] flex-1 min-w-[120px] font-medium inline-flex items-center gap-1.5"
            style={{ color: saveState === "error" ? "var(--s2j-red)" : "var(--s2j-blue)" }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block", flexShrink: 0 }} />
            {saveState === "error"
              ? saveError || "Save failed - your edits are still here. Try again."
              : isNewCase
              ? "New case - unsaved"
              : "Edited - unsaved"}
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
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      )}
    </fieldset>
  );
}
