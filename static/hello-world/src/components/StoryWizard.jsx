import React, { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@forge/bridge";
import EditableCaseRow from "./EditableCaseRow.jsx";
import BackButton from "./BackButton";
import { IconCheck, IconRefresh, IconDownload, IconBan } from "./Icon";
import { SignalIcon, SignalCallout } from "./Signal";
import { MOOD, WIZARD_WRAP, Stepper } from "./WizardKit";
import { glassSurface } from "./moodboard";
import { Chip, Dot } from "./moodChips";

// The 3 type-phases (display order: main flow -> failures -> boundaries) + a 4th non-type "Coverage" step.
const TYPE_PHASES = ["happy-path", "negative", "edge"];
const TYPE_LABEL = { "happy-path": "Happy-path", negative: "Negative", edge: "Edge" };

// --- clipboard helper (data-URI download fallback; blob: is blocked in the Forge sandbox -- CLAUDE.md P1) ---
async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); return { ok: true, method: "clipboard" }; }
  catch (_) {
    try {
      const a = document.createElement("a");
      a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
      a.download = "testcases.txt"; a.style.display = "none";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      return { ok: true, method: "download" };
    } catch (_2) { return { ok: false, method: "none" }; }
  }
}

// --- CoverageBadge -- success=100% / warning=partial-or-stale / neutral=no-ACs (a moodChips Chip) ----------
function CoverageBadge({ coverage }) {
  if (!coverage) return null;
  const { coverage_pct, covered_acs, total_acs, no_acs, stale_refs } = coverage;
  const staleCount = Array.isArray(stale_refs) ? stale_refs.length : 0;
  if (no_acs) {
    return <Chip tone="neutral" title="No acceptance criteria - all cases are inferred">no ACs</Chip>;
  }
  const pct = typeof coverage_pct === "number" ? coverage_pct : null;
  const isComplete = pct === 100 && staleCount === 0;
  const tone = isComplete ? "success" : pct !== null ? "warning" : "neutral";
  const label = pct !== null ? `${covered_acs}/${total_acs} ACs` : "-/- ACs";
  const title = pct !== null
    ? `${covered_acs} of ${total_acs} acceptance criteria covered${staleCount ? ` - ${staleCount} stale reference${staleCount > 1 ? "s" : ""}` : ""}`
    : "Coverage unknown";
  return (
    <Chip tone={tone} title={title} icon={staleCount > 0 ? <SignalIcon kind="warning" size={13} /> : undefined}>
      {label}
    </Chip>
  );
}

// --- StoryChips -- the chip cluster shown on BOTH the overview row and the wizard header -------------------
function StoryChips({ entry, isStale, isRemoved, isDirty, cases, distribution }) {
  const hasError = !!entry?.error;
  const coverage = entry?.coverage;
  return (
    <>
      {isRemoved && !hasError ? (
        <Chip tone="error" icon={<IconBan size={13} />} title="This story was removed from the breakdown in the editor - its cases are orphaned and won't embed on push. Re-add the story; it cannot be regenerated.">
          Removed from breakdown
        </Chip>
      ) : isStale && !hasError ? (
        <Chip tone="warning" icon={<SignalIcon kind="warning" size={13} />} title="This story's acceptance criteria changed since these test cases were generated - Regenerate to refresh">
          ACs changed
        </Chip>
      ) : null}
      {isDirty && (
        <Chip tone="info" icon={<Dot tone="info" />} title="This story has unsaved edits - Save to update coverage, export and push">edited</Chip>
      )}
      {hasError && (
        <Chip tone="error" icon={<SignalIcon kind="error" size={13} />}>Failed</Chip>
      )}
      {!hasError && coverage && <CoverageBadge coverage={coverage} />}
      {!hasError && entry?.truncated === true && (
        <Chip tone="warning" icon={<SignalIcon kind="warning" size={13} />} title="Generation hit the output limit for this story - complete cases were recovered, but the last ones may be missing. Regenerate to be sure.">
          may be truncated
        </Chip>
      )}
      {!hasError && cases && cases.length > 0 && distribution && (
        <Chip tone="neutral" title="Case count by type">{distribution}</Chip>
      )}
    </>
  );
}

// --- useStoryActions -- per-story Regenerate (2-step armed) + Copy (Gherkin/CSV) state + handlers ----------
function useStoryActions({ jobId, storyIdx, onRegenerate }) {
  const [copyGherkinState, setCopyGherkinState] = useState("idle");
  const [copyCsvState, setCopyCsvState] = useState("idle");
  const [confirmArmed, setConfirmArmed] = useState("idle");
  const confirmTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(confirmTimerRef.current), []);
  const armConfirm = useCallback(() => {
    setConfirmArmed("armed");
    clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => setConfirmArmed("idle"), 4000);
  }, []);
  const fireRegen = useCallback(() => {
    clearTimeout(confirmTimerRef.current);
    setConfirmArmed("idle");
    if (typeof storyIdx === "number") onRegenerate?.(storyIdx);
  }, [storyIdx, onRegenerate]);
  const handleCopy = useCallback(async (format, setState) => {
    try {
      const resp = await invoke("getTestCaseExports", { jobId, storyIdx, format });
      const text = format === "gherkin" ? resp?.gherkin : resp?.csv;
      if (resp && !resp.error && text) {
        const { ok, method } = await copyToClipboard(text);
        setState(ok ? method : "failed");
        setTimeout(() => setState("idle"), ok ? 1500 : 2500);
      } else { setState("failed"); setTimeout(() => setState("idle"), 2500); }
    } catch (_) { setState("failed"); setTimeout(() => setState("idle"), 2500); }
  }, [jobId, storyIdx]);
  return { copyGherkinState, setCopyGherkinState, copyCsvState, setCopyCsvState, confirmArmed, armConfirm, fireRegen, handleCopy };
}

const copyLabel = (s, base) => (s === "clipboard" ? "Copied" : s === "download" ? "Downloaded" : s === "failed" ? "Copy failed - check permissions" : base);

// --- StoryActions -- the Regenerate + per-story Copy buttons (shared by row + wizard header) ---------------
function StoryActions({ jobId, entry, isDirty, isPolling, isSaving, isRemoved, readOnly, onRegenerate }) {
  const storyIdx = entry?.storyIdx;
  const hasError = !!entry?.error;
  const hasResult = !!entry?.result;
  const a = useStoryActions({ jobId, storyIdx, onRegenerate });
  const regenArmedLabel = isDirty ? "Discard edits & regenerate?" : "Confirm - replace cases?";
  const regenDisabled = isPolling || isSaving || isRemoved || readOnly;
  const btn = { fontSize: 11, padding: "3px 8px", borderRadius: 6 };
  return (
    <span className="flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => { if (regenDisabled) return; if (a.confirmArmed === "armed") a.fireRegen(); else a.armConfirm(); }}
        disabled={regenDisabled}
        style={{
          ...btn,
          background: a.confirmArmed === "armed" ? "var(--s2j-red-bg)" : "none",
          border: `1px solid ${a.confirmArmed === "armed" ? "var(--s2j-red-border)" : "var(--s2j-border)"}`,
          color: regenDisabled ? "var(--s2j-text-muted)" : a.confirmArmed === "armed" ? "var(--s2j-red)" : "var(--s2j-blue)",
          cursor: regenDisabled ? "not-allowed" : "pointer",
        }}
        title={isRemoved ? "This story was removed from the breakdown - it cannot be regenerated" : isPolling ? "Generating..." : isSaving ? "Saving - wait, then regenerate" : a.confirmArmed === "armed" ? "Click again to confirm - this will replace current cases" : "Re-generate test cases for this story"}
      >
        {isPolling ? "Generating..." : a.confirmArmed === "armed" ? regenArmedLabel : "Regenerate"}
      </button>
      {!hasError && hasResult && (
        isDirty ? (
          <span className="text-[11px] italic px-2 py-0.5 inline-flex items-center gap-1 rounded" style={{ color: "var(--s2j-text-muted)", border: "1px dashed var(--s2j-border)" }} title="Export copies the SAVED cases - save your edits to include them">
            <IconDownload size={14} /> Save to enable export
          </span>
        ) : (
          <>
            <button type="button" onClick={() => a.handleCopy("gherkin", a.setCopyGherkinState)} style={{ ...btn, background: "none", border: `1px solid ${a.copyGherkinState === "failed" ? "var(--s2j-red-border)" : "var(--s2j-border)"}`, color: a.copyGherkinState === "failed" ? "var(--s2j-red)" : "var(--s2j-text-muted)", cursor: "pointer" }} title="Copy Gherkin .feature for this story">
              {copyLabel(a.copyGherkinState, "Copy Gherkin")}
            </button>
            <button type="button" onClick={() => a.handleCopy("csv", a.setCopyCsvState)} style={{ ...btn, background: "none", border: `1px solid ${a.copyCsvState === "failed" ? "var(--s2j-red-border)" : "var(--s2j-border)"}`, color: a.copyCsvState === "failed" ? "var(--s2j-red)" : "var(--s2j-text-muted)", cursor: "pointer" }} title="Copy CSV for this story">
              {copyLabel(a.copyCsvState, "Copy CSV")}
            </button>
          </>
        )
      )}
    </span>
  );
}

// type distribution string for the overview row, e.g. "6 happy . 3 neg . 4 edge"
function typeDistribution(cases) {
  if (!Array.isArray(cases) || cases.length === 0) return null;
  const c = { "happy-path": 0, negative: 0, edge: 0 };
  cases.forEach((tc) => { const t = (tc && tc.type) || "happy-path"; if (c[t] != null) c[t] += 1; });
  const short = { "happy-path": "happy", negative: "neg", edge: "edge" };
  return TYPE_PHASES.filter((t) => c[t] > 0).map((t) => `${c[t]} ${short[t]}`).join(" · ");
}

// ========================================================================================================
// StoryRow -- a compact overview row (1C). One vertical scan triages N stories; "Open ->" drills into the
// per-story wizard. Per-row Regenerate + Copy so the BA never drills in to retry.
// ========================================================================================================
export const StoryRow = React.memo(function StoryRow({ entry, jobId, isStale, isRemoved, isDirty, regenState, onRegenerate, onOpen, hasTestCases = true }) {
  const readOnly = !hasTestCases;
  const hasError = !!entry?.error;
  const storyName = entry?.storyName || entry?.story?.name || `Story ${entry?.storyIdx}`;
  const result = entry?.result;
  const cases = result && Array.isArray(result.test_cases) ? result.test_cases : [];
  const isPolling = regenState === "polling" || regenState === "pending";
  // left accent = a story that needs attention (failed / unsaved / ACs changed / removed / partial coverage)
  const partial = entry?.coverage && entry.coverage.coverage_pct != null && !entry.coverage.complete;
  const accent = hasError || isRemoved ? "var(--s2j-red)" : (isStale || isDirty || partial) ? "var(--s2j-orange)" : "transparent";

  return (
    <div
      className="mb-2 flex items-center gap-2 flex-wrap"
      style={{
        ...glassSurface("minor"),
        borderLeft: `4px solid ${accent}`,
        padding: "10px 14px",
      }}
    >
      <span className="font-semibold flex-1 min-w-[160px]" style={{ fontSize: 14, color: MOOD.navy }}>{storyName}</span>
      <StoryChips entry={entry} isStale={isStale} isRemoved={isRemoved} isDirty={isDirty} cases={cases} distribution={typeDistribution(cases)} />
      <StoryActions jobId={jobId} entry={entry} isDirty={isDirty} isPolling={isPolling} isSaving={false} isRemoved={isRemoved} readOnly={readOnly} onRegenerate={onRegenerate} />
      {hasError ? (
        <span className="text-[11px]" style={{ color: "var(--s2j-red)" }}>Generation failed - Regenerate</span>
      ) : (
        <button type="button" onClick={() => onOpen(entry.storyIdx)} className="btn-nav" style={{ fontSize: 12.5, padding: "6px 14px" }} title="Open this story's test cases">
          Open <span aria-hidden="true">&rarr;</span>
        </button>
      )}
    </div>
  );
});

// ========================================================================================================
// StoryWizard -- the drill-in per-story editor. Stepper phases = the 3 types + a "Coverage & trust" step.
// Each type-phase lists ONLY that type's cases (3-6, not 16). INDEX INVARIANT: the type-phase is a
// FILTERED RENDER over the FULL test_cases array -- every callback receives the case's ABSOLUTE index, never
// the filtered position (the save/coverage model keys by absolute index). The draft/Save/Revert/coverage
// wiring is UNCHANGED; only the shell presentation changed.
// ========================================================================================================
export default function StoryWizard({
  entry, jobId, isStale = false, isRemoved = false, regenState, onRegenerate,
  draftResult, isDirty = false, structurallyShifted = false, saveState = "idle", saveError = null,
  onCaseChange, onAddCase, onDeleteCase, onSave, onRevert, hasTestCases = true, onBackToList,
}) {
  const readOnly = !hasTestCases;
  const storyIdx = entry?.storyIdx;
  const storyName = entry?.storyName || entry?.story?.name || `Story ${storyIdx}`;
  const acceptanceCriteria = entry?.story?.acceptance_criteria || [];
  const result = draftResult || entry?.result;
  const coverage = entry?.coverage; // last-SAVED coverage (recomputed on save)
  const hasError = !!entry?.error;
  const cases = result && Array.isArray(result.test_cases) ? result.test_cases : [];
  const isPolling = regenState === "polling" || regenState === "pending";
  const isSaving = saveState === "saving";

  // Per-case Save/Revert footers (Work B) -- ALL keyed by ABSOLUTE index into result.test_cases.
  const savedCases = !hasError && entry?.result && Array.isArray(entry.result.test_cases) ? entry.result.test_cases : [];
  const perCaseMode = isDirty && !structurallyShifted && !!draftResult && cases.length >= savedCases.length;
  const caseIsNew = (i) => i >= savedCases.length;
  const caseIsDirty = (i) => perCaseMode && (caseIsNew(i) || JSON.stringify(cases[i]) !== JSON.stringify(savedCases[i]));
  const anyCaseFooter = perCaseMode && cases.some((_, i) => caseIsDirty(i));

  // --- wizard phase state: 1..3 = the 3 types, 4 = "Coverage & trust" ---
  const [phase, setPhase] = useState(1);
  const [movedNote, setMovedNote] = useState(null); // {to} after a type-switch re-homes a case
  useEffect(() => { if (!movedNote) return undefined; const t = setTimeout(() => setMovedNote(null), 4500); return () => clearTimeout(t); }, [movedNote]);

  // per-type counts + a §11 warning marker (an invalid case -- no When/Then -- hides nothing on the stepper)
  const byType = (t) => cases.map((tc, i) => ({ tc, i })).filter(({ tc }) => ((tc && tc.type) || "happy-path") === t);
  const isInvalid = (tc) => {
    if (!tc) return false;
    const w = Array.isArray(tc.when) ? tc.when.filter((s) => String(s || "").trim()) : [];
    const th = Array.isArray(tc.then) ? tc.then.filter((s) => String(s || "").trim()) : [];
    return w.length === 0 || th.length === 0;
  };
  const uncovered = coverage && Array.isArray(coverage.uncovered_acs) ? coverage.uncovered_acs.filter(Boolean) : [];
  const staleRefs = coverage && Array.isArray(coverage.stale_refs) ? coverage.stale_refs.filter(Boolean) : [];
  const coverageWarn = uncovered.length > 0 || staleRefs.length > 0 || (isDirty && !anyCaseFooter);

  const stepLabels = [
    ...TYPE_PHASES.map((t) => {
      const list = byType(t);
      return { label: TYPE_LABEL[t], count: list.length, warn: list.some(({ tc }) => isInvalid(tc)) };
    }),
    { label: "Coverage & trust", warn: coverageWarn },
  ];

  // Type-switch mid-edit: changing a case's type moves it to another phase. Never let it silently vanish --
  // commit the change, then auto-navigate to the destination type's phase + show a "moved to {type}" note.
  const handleCaseChangeLocal = useCallback((absIdx, next) => {
    const prevType = (cases[absIdx] && cases[absIdx].type) || "happy-path";
    const nextType = (next && next.type) || "happy-path";
    onCaseChange && onCaseChange(absIdx, next);
    if (nextType !== prevType) {
      const target = TYPE_PHASES.indexOf(nextType);
      if (target >= 0) { setPhase(target + 1); setMovedNote({ to: TYPE_LABEL[nextType] }); }
    }
  }, [cases, onCaseChange]);

  const wrapStyle = { ...WIZARD_WRAP, maxWidth: "920px", padding: "4px 0 16px" };

  // A failed story has no cases -> no wizard; show the error + back (defensive -- overview keeps failed rows un-openable).
  if (hasError) {
    return (
      <div style={wrapStyle}>
        <BackButton onClick={onBackToList} label="All stories" title="Back to all stories" className="mb-2" />
        <h3 style={{ fontSize: 18, fontWeight: 700, color: MOOD.navy, margin: "0 0 12px" }}>{storyName}</h3>
        <SignalCallout kind="error" title="Generation failed - Regenerate to retry this story." />
        <div className="mt-3"><StoryActions jobId={jobId} entry={entry} isDirty={isDirty} isPolling={isPolling} isSaving={isSaving} isRemoved={isRemoved} readOnly={readOnly} onRegenerate={onRegenerate} /></div>
      </div>
    );
  }

  const activeType = phase >= 1 && phase <= 3 ? TYPE_PHASES[phase - 1] : null;
  const activeList = activeType ? byType(activeType) : [];

  return (
    <div style={wrapStyle}>
      {/* header */}
      <BackButton onClick={onBackToList} label="All stories" title="Back to all stories" className="mb-2" />
      <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 6 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: MOOD.navy, letterSpacing: "-0.01em", margin: 0, flex: "1 1 200px" }}>{storyName}</h3>
        <StoryChips entry={entry} isStale={isStale} isRemoved={isRemoved} isDirty={isDirty} cases={cases} distribution={null} />
        <StoryActions jobId={jobId} entry={entry} isDirty={isDirty} isPolling={isPolling} isSaving={isSaving} isRemoved={isRemoved} readOnly={readOnly} onRegenerate={onRegenerate} />
      </div>

      {readOnly && (
        <SignalCallout kind="info" title="Read-only" style={{ marginBottom: 12 }}>
          Editing is temporarily unavailable, but you can still read and export these cases.
        </SignalCallout>
      )}

      <Stepper labels={stepLabels} step={phase} maxStep={4} onJump={setPhase} busy={false} ariaLabel="Test-case types" />

      {result?.no_acs && (
        <SignalCallout kind="warning" style={{ marginBottom: 12 }}>
          This story has no acceptance criteria - every case is inferred. Coverage can't be computed; review each case on its own merit.
        </SignalCallout>
      )}
      {isPolling && (
        <div className="flex justify-center" style={{ marginBottom: 12 }}>
          <Chip tone="info" icon={<IconRefresh size={13} />} title="Regenerating this story - editing is paused until the new cases arrive">Regenerating - editing paused</Chip>
        </div>
      )}
      {movedNote && (
        <p className="text-xs mb-2" style={{ color: "var(--s2j-blue)" }}><SignalIcon kind="info" size={13} /> Moved to "{movedNote.to}" - that case now lives in this type.</p>
      )}

      {/* --- a type-phase: only this type's cases, each with its ABSOLUTE index --- */}
      {activeType && !isPolling && (
        <>
          {activeList.length === 0 ? (
            <p className="text-[13px] mb-3" style={{ color: "var(--s2j-text-muted)" }}>
              No {TYPE_LABEL[activeType]} cases yet{activeType === "negative" ? " - a story with no negative tests may be under-tested." : "."}
            </p>
          ) : (
            activeList.map(({ tc, i }, pos) => (
              <EditableCaseRow
                key={i}
                tc={tc}
                // display: position WITHIN this type ("#1, #2, #3" -- clean), not the jumpy absolute index.
                // all callbacks below use the ABSOLUTE index `i` (the save/coverage model keys by it).
                caseNumber={pos + 1}
                acceptanceCriteria={acceptanceCriteria}
                onChange={(next) => handleCaseChangeLocal(i, next)}
                onDelete={() => onDeleteCase && onDeleteCase(i)}
                showSaveBar={caseIsDirty(i)}
                isNewCase={caseIsNew(i)}
                saving={isSaving || isPolling}
                saveState={saveState}
                saveError={saveError}
                readOnly={readOnly}
                onSaveStory={readOnly ? undefined : onSave}
                onRevertCase={() => caseIsNew(i) ? (onDeleteCase && onDeleteCase(i)) : handleCaseChangeLocal(i, JSON.parse(JSON.stringify(savedCases[i])))}
              />
            ))
          )}
          {!readOnly && (cases.length < 20 ? (
            <button type="button" onClick={() => onAddCase && onAddCase(activeType)} className="text-[12px] mb-1" style={{ color: "var(--s2j-blue)" }}>
              + Add {TYPE_LABEL[activeType]} case
            </button>
          ) : (
            <p className="text-[12px] mb-1" style={{ color: "var(--s2j-text-muted)" }}>Maximum 20 cases per story - delete one to add another.</p>
          ))}
        </>
      )}

      {/* --- Coverage & trust step --- */}
      {phase === 4 && (
        <div>
          {/* type distribution -- surfaces an under-tested story (e.g. 0 negative cases) at the readiness checkpoint */}
          <div className="mb-3 flex items-center gap-1.5 flex-wrap">
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--s2j-text)" }}>Test cases by type:</span>
            {TYPE_PHASES.map((t) => {
              const cnt = byType(t).length;
              return (
                <Chip key={t} tone={cnt === 0 ? "warning" : "neutral"} title={cnt === 0 ? `No ${TYPE_LABEL[t]} cases - this story may be under-tested` : `${cnt} ${TYPE_LABEL[t]} case(s)`}>
                  {TYPE_LABEL[t]} {cnt}{cnt === 0 ? " - under-tested?" : ""}
                </Chip>
              );
            })}
          </div>
          {result?.no_acs ? (
            <p className="text-[13px] mb-3 italic" style={{ color: "var(--s2j-text-muted)" }}>This story has no acceptance criteria, so there is no coverage to check - every case is inferred.</p>
          ) : null}

          {/* structurally-shifted story-level Save/Revert FALLBACK bar lives HERE (a deleted saved case shifts
              indices -> per-case footers are unsafe). The Coverage-step dot carries the warn marker (coverageWarn). */}
          {isDirty && !anyCaseFooter && !readOnly && (
            <div className="mb-3 flex items-center gap-2 rounded-md px-3 py-2 flex-wrap" style={{ background: saveState === "error" ? "var(--s2j-red-bg)" : "var(--s2j-blue-bg)", border: `1px solid ${saveState === "error" ? "var(--s2j-red-border)" : "var(--s2j-blue-border)"}` }}>
              <span className="text-xs flex-1 min-w-[160px]" style={{ color: saveState === "error" ? "var(--s2j-red)" : "var(--s2j-blue)" }}>
                {saveState === "error" ? (saveError || "Save failed - your edits are still here. Try again.") : "Unsaved edits - coverage, export and push use SAVED cases."}
              </span>
              <button type="button" onClick={() => onRevert && onRevert()} disabled={isSaving || isPolling} className="text-[12px] px-2.5 py-1 rounded" style={{ background: "none", border: "1px solid var(--s2j-border)", color: "var(--s2j-text-muted)", cursor: (isSaving || isPolling) ? "not-allowed" : "pointer" }} title="Discard ALL your edits to this story">Revert all edits</button>
              <button type="button" onClick={() => onSave && onSave()} disabled={isSaving || isPolling} className="text-[12px] px-3.5 py-1 rounded font-medium" style={{ background: "var(--s2j-blue)", border: "1px solid var(--s2j-blue)", color: "#fff", cursor: (isSaving || isPolling) ? "not-allowed" : "pointer", opacity: (isSaving || isPolling) ? 0.7 : 1 }} title="Save your edits (updates coverage, export and push)">{isSaving ? "Saving..." : "Save changes"}</button>
            </div>
          )}
          {!isDirty && saveState === "saved" && (
            <div className="mb-3 text-xs flex items-center gap-1.5" style={{ color: "var(--s2j-green-dark)" }}><IconCheck size={14} /> Saved - coverage, export and push now use your edits.</div>
          )}

          {coverage && (uncovered.length > 0 || staleRefs.length > 0) ? (
            <div className="flex flex-col gap-2">
              {isDirty && (
                <p className="text-[12px] italic" style={{ color: "var(--s2j-text-muted)" }}>Coverage below reflects your last SAVE - Save to recompute against your current edits.</p>
              )}
              {uncovered.length > 0 && (
                <SignalCallout kind="warning" title={`Acceptance criteria without a test case (${uncovered.length})`}>
                  <ul className="ml-3 list-disc text-[13px]" style={{ color: "var(--s2j-text-light)" }}>{uncovered.map((ac, i) => <li key={i}>{ac}</li>)}</ul>
                  <p className="mt-1 italic text-[12px]" style={{ color: "var(--s2j-text-muted)" }}>Add a case + tick the AC under "Covers", or Regenerate.</p>
                </SignalCallout>
              )}
              {staleRefs.length > 0 && (
                <SignalCallout kind="warning" title={`References that no longer match a current AC (${staleRefs.length}) - an AC may have been edited since generation`}>
                  <ul className="ml-3 list-disc text-[13px]" style={{ color: "var(--s2j-text-light)" }}>{staleRefs.map((ref, i) => <li key={i}>{ref}</li>)}</ul>
                </SignalCallout>
              )}
            </div>
          ) : !result?.no_acs ? (
            <SignalCallout kind="success" title="Every acceptance criterion is covered by at least one test case.">
              {isDirty ? <span style={{ fontSize: 12, color: "var(--s2j-text-muted)" }}>Shown as of your last save - Save to recompute against your current edits.</span> : null}
            </SignalCallout>
          ) : null}
        </div>
      )}
    </div>
  );
}
