import React from "react";

// Checkbox-matching normalizer — kept IN SYNC with normAC in src/testcases.js (the authoritative
// backend coverage normalizer). Ticking an AC stores the VERBATIM live AC string, so the box-tick →
// coverage path is sound regardless; this only governs the INITIAL checked state of a MODEL-emitted
// trace. Using normAC's exact folds (curly quotes / NBSP / "AC1:" label prefix / backslash artifacts)
// removes the one display inconsistency (a model-emitted trace reading unchecked while the backend
// counts it covered). Pure function, no Node deps. ⚠ keep in lockstep with src/testcases.js normAC.
function normForMatch(s) {
  return String(s == null ? "" : s)
    .replace(/^\s*AC\s*\d+\s*[:.]\s*/i, "")
    .replace(/\\/g, "")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// A grounded trace entry = covers a real AC of THIS story (kind 'story-ac', or a legacy/
// untyped grounded entry). 'shared-ac' and 'inferred' are NOT story-AC coverage.
function isGrounded(t) {
  return t && typeof t === "object" && t.kind !== "inferred" && t.kind !== "shared-ac" && !!t.ac_text;
}

/**
 * AcTraceEditor — the coverage-SAFE editor for a case's ac_trace.
 *
 * The BA never types ac_text; they TICK the story's real acceptance criteria, so the stored
 * ac_text is always verbatim-equal to a live AC → coverage stays trustworthy BY CONSTRUCTION
 * (no free-text drift, the failure this whole feature must prevent).
 *
 * Props:
 *   acTrace             — [{ kind:'story-ac'|'shared-ac'|'inferred', ac_text? }]
 *   acceptanceCriteria  — string[] the story's live ACs (from the stamped story)
 *   onChange            — fn(nextAcTrace)
 */
export default function AcTraceEditor({ acTrace, acceptanceCriteria, onChange }) {
  const trace = Array.isArray(acTrace) ? acTrace : [];
  const acs = Array.isArray(acceptanceCriteria) ? acceptanceCriteria : [];

  const isInferred = trace.some((t) => t && t.kind === "inferred");
  const sharedEntries = trace.filter((t) => t && t.kind === "shared-ac");
  const groundedEntries = trace.filter(isGrounded);

  const acNorms = acs.map(normForMatch);
  const coveredNorms = new Set(groundedEntries.map((t) => normForMatch(t.ac_text)));
  // grounded entries matching NO live AC → stale (an AC was edited/deleted since generation)
  const staleEntries = groundedEntries.filter((t) => !acNorms.includes(normForMatch(t.ac_text)));

  function toggleAc(acText, checked) {
    const n = normForMatch(acText);
    if (checked) {
      // Add verbatim (kind 'story-ac'); drop any inferred entry + any prior story-AC entry for this
      // AC. Exclude shared-ac (a shared chip with text equal to a story AC must NOT be dropped —
      // symmetry with the uncheck / removeStale paths).
      const kept = trace.filter(
        (t) => !(t && t.kind === "inferred") && !(t && t.ac_text && t.kind !== "shared-ac" && normForMatch(t.ac_text) === n),
      );
      onChange([...kept, { kind: "story-ac", ac_text: acText }]);
    } else {
      onChange(
        trace.filter((t) => !(t && t.ac_text && t.kind !== "shared-ac" && normForMatch(t.ac_text) === n)),
      );
    }
  }

  function removeShared(targetIdx) {
    let k = -1;
    onChange(
      trace.filter((t) => {
        if (t && t.kind === "shared-ac") { k += 1; return k !== targetIdx; }
        return true;
      }),
    );
  }

  function removeStale(acText) {
    const n = normForMatch(acText);
    onChange(trace.filter((t) => !(t && t.ac_text && t.kind !== "shared-ac" && normForMatch(t.ac_text) === n)));
  }

  function toggleInferred(checked) {
    // Inferred = "no authored AC governs this." ON → clears AC ticks + shared (mutually exclusive).
    // OFF → empty trace; the parse repairs [] → inferred, but the BA will normally tick an AC next.
    onChange(checked ? [{ kind: "inferred" }] : []);
  }

  // No-ACs story: nothing to tick; every case is inferred by nature.
  if (acs.length === 0) {
    return (
      <div className="text-[11px] italic" style={{ color: "var(--s2j-text-muted)" }}>
        This story has no acceptance criteria — its cases are inferred. (Add ACs in the breakdown to enable coverage.)
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--s2j-text-muted)" }}>
        Covers — which acceptance criteria does this verify?
      </span>

      <div className="space-y-1">
        {acs.map((ac, i) => {
          const checked = coveredNorms.has(acNorms[i]);
          return (
            <label key={i} className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => toggleAc(ac, e.target.checked)}
                className="mt-0.5 shrink-0"
              />
              <span
                className="text-[11px] leading-relaxed"
                style={{ color: checked ? "var(--s2j-text)" : "var(--s2j-text-light)" }}
              >
                <span style={{ color: "var(--s2j-text-muted)" }}>{i + 1}.</span> {ac}
              </span>
            </label>
          );
        })}
      </div>

      {/* shared-ac chips — read-only + remove (re-adding a shared AC is deferred to v2) */}
      {sharedEntries.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {sharedEntries.map((t, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: "var(--s2j-bg-section)", border: "1px solid var(--s2j-border)", color: "var(--s2j-text-muted)" }}
              title="Shared acceptance criterion (from the spec-wide set) — counted separately, not toward this story's coverage"
            >
              [shared] {t.ac_text || ""}
              <button type="button" onClick={() => removeShared(i)} style={{ color: "var(--s2j-red)" }} title="Remove">
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {/* inferred toggle */}
      <label className="flex items-center gap-2 cursor-pointer pt-0.5">
        <input type="checkbox" checked={isInferred} onChange={(e) => toggleInferred(e.target.checked)} className="shrink-0" />
        <span className="text-[11px]" style={{ color: "var(--s2j-text-muted)" }}>
          Inferred — verifies behaviour with no authored AC
        </span>
      </label>

      {/* stale references — grounded entries matching no current AC; dropped on save */}
      {staleEntries.length > 0 && (
        <div
          className="rounded px-2 py-1 text-[11px]"
          style={{ background: "var(--s2j-orange-bg)", border: "1px solid var(--s2j-orange-border)", color: "var(--s2j-text)" }}
        >
          <p className="font-semibold mb-0.5">
            ⚠ {staleEntries.length} reference{staleEntries.length > 1 ? "s" : ""} no longer match an AC (will be dropped on save)
          </p>
          {staleEntries.map((t, i) => (
            <div key={i} className="flex items-start gap-1">
              <span style={{ color: "var(--s2j-text-light)" }}>{t.ac_text}</span>
              <button type="button" onClick={() => removeStale(t.ac_text)} style={{ color: "var(--s2j-red)" }} title="Remove now">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
