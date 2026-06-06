import React, { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@forge/bridge";
import EditableCaseRow from "./EditableCaseRow.jsx";

// ── CoverageBadge ────────────────────────────────────────────────
// Green = 100% coverage, orange = partial, grey = no ACs.
// Shows covered/total, stale count if any.
function CoverageBadge({ coverage }) {
  if (!coverage) return null;
  const { coverage_pct, covered_acs, total_acs, no_acs, stale_refs } = coverage;
  const staleCount = Array.isArray(stale_refs) ? stale_refs.length : 0;

  if (no_acs) {
    return (
      <span
        className="text-[10px] px-1.5 py-0.5 rounded font-medium"
        style={{
          background: "var(--s2j-bg-section)",
          border: "1px solid var(--s2j-border)",
          color: "var(--s2j-text-muted)",
        }}
        title="No acceptance criteria — all cases are inferred"
      >
        no ACs
      </span>
    );
  }

  const pct = typeof coverage_pct === "number" ? coverage_pct : null;
  const isComplete = pct === 100 && staleCount === 0;
  const fg = isComplete
    ? "var(--s2j-green-dark)"
    : pct !== null
    ? "var(--s2j-orange)"
    : "var(--s2j-text-muted)";
  const bg = isComplete
    ? "var(--s2j-green-bg)"
    : pct !== null
    ? "var(--s2j-orange-bg)"
    : "var(--s2j-bg-section)";
  const border = isComplete
    ? "var(--s2j-green-border)"
    : pct !== null
    ? "var(--s2j-orange-border)"
    : "var(--s2j-border)";

  const label =
    pct !== null ? `${covered_acs}/${total_acs} ACs` : "–/– ACs";
  const title =
    pct !== null
      ? `${covered_acs} of ${total_acs} acceptance criteria covered${staleCount ? ` · ${staleCount} stale reference${staleCount > 1 ? "s" : ""}` : ""}`
      : "Coverage unknown";

  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-1"
      style={{ background: bg, border: `1px solid ${border}`, color: fg }}
      title={title}
    >
      {label}
      {staleCount > 0 && (
        <span title={`${staleCount} AC reference(s) no longer match the current story`}>
          ⚠
        </span>
      )}
    </span>
  );
}

// ── clipboard helper ─────────────────────────────────────────────
// Returns { ok: boolean, method: 'clipboard'|'download'|'none' } so callers
// can give specific feedback. Never a silent no-op on the BA's primary export action.
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true, method: "clipboard" };
  } catch (_) {
    // Best-effort data-URI download as fallback (data: survives the Forge sandbox;
    // blob: is blocked — CLAUDE.md hard-won §P1).
    try {
      const a = document.createElement("a");
      a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
      a.download = "testcases.txt";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return { ok: true, method: "download" };
    } catch (_2) {
      return { ok: false, method: "none" };
    }
  }
}

// ── StoryTestCaseCard ────────────────────────────────────────────
/**
 * StoryTestCaseCard — a <details> accordion for one story's test cases, now EDITABLE.
 *
 * At rest (collapsed) it's a summary; expanded, every case is an EditableCaseRow (click-to-edit,
 * like a FeatureCard). Edits flow to the parent draft via the on*Case callbacks; a per-story
 * Save bar persists them to KVS (so export + push, which re-read KVS, see them). Regenerate is
 * dirty-aware (escalates the confirm) and mutually exclusive with Save (last-writer race guard).
 *
 * Props:
 *   entry        — perStory entry ({ storyIdx, storyName, story, result, coverage, error })
 *   jobId        — string; needed for the per-story export invoke
 *   regenState   — 'idle' | 'pending' | 'polling' | 'done' | 'error'
 *   onRegenerate — fn(storyIdx)
 *   draftResult  — the edited (unsaved) result for this story, or null (→ use entry.result)
 *   isDirty      — bool; true when draftResult differs from the saved entry
 *   saveState    — 'idle' | 'saving' | 'saved' | 'error'
 *   saveError    — string|null
 *   onCaseChange — fn(caseIdx, nextCase)
 *   onAddCase    — fn()
 *   onDeleteCase — fn(caseIdx)
 *   onSave       — fn()  (persist this story's draft to KVS)
 *   onRevert     — fn()  (discard this story's draft)
 */
function StoryTestCaseCard({
  entry,
  jobId,
  regenState,
  onRegenerate,
  draftResult,
  isDirty = false,
  structurallyShifted = false,
  saveState = "idle",
  saveError = null,
  onCaseChange,
  onAddCase,
  onDeleteCase,
  onSave,
  onRevert,
}) {
  // 'idle' | 'clipboard' | 'download' | 'failed'
  const [copyGherkinState, setCopyGherkinState] = useState("idle");
  const [copyCsvState, setCopyCsvState] = useState("idle");

  const storyIdx = entry?.storyIdx;
  const storyName = entry?.storyName || entry?.story?.name || `Story ${storyIdx}`;
  const acceptanceCriteria = entry?.story?.acceptance_criteria || [];
  // The working result = the unsaved draft when present, else the saved entry.result.
  const result = draftResult || entry?.result;
  const coverage = entry?.coverage; // last-SAVED coverage (recomputed on save)
  const hasError = !!entry?.error;
  const cases = result && Array.isArray(result.test_cases) ? result.test_cases : [];
  const isPolling = regenState === "polling" || regenState === "pending";
  const isSaving = saveState === "saving";

  // ── Per-case Save/Revert footers (Work B) ──────────────────────────────────────────
  // In the COMMON flow (field edits + appends) each edited/new case shows its own footer below it,
  // so Save/Revert is always where you're editing. A DELETE shifts array indices, making per-case-
  // by-index comparison unsafe → the parent flags `structurallyShifted` and we fall back to ONE
  // story-level bar at the bottom. savedCases = the last-SAVED cases (entry.result).
  const savedCases =
    !hasError && entry?.result && Array.isArray(entry.result.test_cases) ? entry.result.test_cases : [];
  const perCaseMode = isDirty && !structurallyShifted && !!draftResult && cases.length >= savedCases.length;
  const caseIsNew = (i) => i >= savedCases.length;
  const caseIsDirty = (i) =>
    perCaseMode && (caseIsNew(i) || JSON.stringify(cases[i]) !== JSON.stringify(savedCases[i]));
  // True when at least one per-case footer is showing → suppress the story-level fallback bar.
  const anyCaseFooter = perCaseMode && cases.some((_, i) => caseIsDirty(i));

  // Fix 3: two-step inline confirm — avoids window.confirm (may be blocked in Forge iframe).
  // 'idle' | 'armed'; auto-resets after 4 s if the user doesn't confirm.
  const [confirmArmed, setConfirmArmed] = useState("idle");
  const confirmTimerRef = useRef(null);
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
  // Clean up the timer when the card unmounts.
  useEffect(() => () => clearTimeout(confirmTimerRef.current), []);

  // Fix 1+2: internal open state — initialized ONCE so user toggles survive re-renders.
  // Problem stories (failed OR partial coverage) open by default; fully-covered + no-ACs collapse.
  const initialOpen = (() => {
    if (hasError) return true;
    if (coverage && coverage.coverage_pct != null && !coverage.complete) return true;
    return false;
  })();
  const [isOpen, setIsOpen] = useState(initialOpen);

  const handleCopyGherkin = useCallback(async () => {
    try {
      const resp = await invoke("getTestCaseExports", {
        jobId,
        storyIdx: storyIdx,
        format: "gherkin",
      });
      if (resp && !resp.error && resp.gherkin) {
        const { ok, method } = await copyToClipboard(resp.gherkin);
        if (ok) {
          setCopyGherkinState(method); // 'clipboard' or 'download'
          setTimeout(() => setCopyGherkinState("idle"), 1500);
        } else {
          setCopyGherkinState("failed");
          setTimeout(() => setCopyGherkinState("idle"), 2500);
        }
      }
    } catch (_) {}
  }, [jobId, storyIdx]);

  const handleCopyCsv = useCallback(async () => {
    try {
      const resp = await invoke("getTestCaseExports", {
        jobId,
        storyIdx: storyIdx,
        format: "csv",
      });
      if (resp && !resp.error && resp.csv) {
        const { ok, method } = await copyToClipboard(resp.csv);
        if (ok) {
          setCopyCsvState(method); // 'clipboard' or 'download'
          setTimeout(() => setCopyCsvState("idle"), 1500);
        } else {
          setCopyCsvState("failed");
          setTimeout(() => setCopyCsvState("idle"), 2500);
        }
      }
    } catch (_) {}
  }, [jobId, storyIdx]);

  // Regenerate when this story has unsaved edits → escalate the armed-confirm copy.
  const regenArmedLabel = isDirty ? "Discard edits & regenerate?" : "Confirm — replace cases?";

  return (
    <details
      open={isOpen}
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
      className="mb-3 rounded-lg"
      style={{
        border: `1px solid ${isDirty ? "var(--s2j-blue-border)" : "var(--s2j-border)"}`,
        background: "var(--s2j-bg-section)",
      }}
    >
      <summary
        className="cursor-pointer px-3 py-2 flex items-center gap-2 flex-wrap"
        style={{ listStyle: "none" }}
      >
        <span
          className="font-medium text-sm flex-1 min-w-0"
          style={{ color: "var(--s2j-text)" }}
        >
          {storyName}
        </span>
        {/* Unsaved-edits chip — visible even when collapsed */}
        {isDirty && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{ background: "var(--s2j-blue-bg)", border: "1px solid var(--s2j-blue-border)", color: "var(--s2j-blue)" }}
            title="This story has unsaved edits — Save to update coverage, export and push"
          >
            ● edited
          </span>
        )}
        {/* Fix 8: Failed badge — visible without expanding (Audit-9) */}
        {hasError && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{
              background: "var(--s2j-red-bg)",
              border: "1px solid var(--s2j-red-border)",
              color: "var(--s2j-red)",
            }}
          >
            ⚠ Failed
          </span>
        )}
        {/* Coverage badge */}
        {!hasError && coverage && <CoverageBadge coverage={coverage} />}
        {/* Case count */}
        {!hasError && cases.length > 0 && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background: "var(--s2j-bg-section)",
              border: "1px solid var(--s2j-border)",
              color: "var(--s2j-text-muted)",
            }}
          >
            {cases.length} case{cases.length !== 1 ? "s" : ""}
          </span>
        )}
        {/* Fix 3: Two-step inline Regenerate — avoids window.confirm (may be blocked in the Forge sandboxed iframe).
            First click: arms; second click within 4 s fires. Auto-resets after 4 s.
            Disabled while saving (mutual exclusion with Save — last-writer race guard). */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isPolling || isSaving) return;
            if (confirmArmed === "armed") {
              fireRegen();
            } else {
              armConfirm();
            }
          }}
          disabled={isPolling || isSaving}
          className="text-[10px] px-2 py-0.5 rounded"
          style={{
            background: confirmArmed === "armed" ? "var(--s2j-red-bg)" : "none",
            border: `1px solid ${confirmArmed === "armed" ? "var(--s2j-red-border)" : "var(--s2j-border)"}`,
            color: (isPolling || isSaving)
              ? "var(--s2j-text-muted)"
              : confirmArmed === "armed"
              ? "var(--s2j-red)"
              : "var(--s2j-blue)",
            cursor: (isPolling || isSaving) ? "not-allowed" : "pointer",
            transition: "all 0.15s",
          }}
          title={
            isPolling
              ? "Generating…"
              : isSaving
              ? "Saving — wait, then regenerate"
              : confirmArmed === "armed"
              ? "Click again to confirm — this will replace current cases"
              : "Re-generate test cases for this story"
          }
        >
          {isPolling
            ? "↻ Generating…"
            : confirmArmed === "armed"
            ? regenArmedLabel
            : "↻ Regenerate"}
        </button>
        {/* Per-story copy buttons — Fix 2: discriminated feedback, never silent.
            Copy/export read SAVED KVS — warn (title) when there are unsaved edits. */}
        {!hasError && result && (
          <>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (isDirty) return; handleCopyGherkin(); }}
              disabled={isDirty}
              className="text-[10px] px-2 py-0.5 rounded"
              style={{
                background: "none",
                border: `1px solid ${copyGherkinState === "failed" ? "var(--s2j-red-border)" : "var(--s2j-border)"}`,
                color: copyGherkinState === "failed" && !isDirty ? "var(--s2j-red)" : "var(--s2j-text-muted)",
                cursor: isDirty ? "not-allowed" : "pointer",
              }}
              title={isDirty ? "Save this story first — export reads the SAVED cases" : "Copy Gherkin .feature for this story"}
            >
              {isDirty
                ? "Save to export"
                : copyGherkinState === "clipboard"
                ? "✓ Copied"
                : copyGherkinState === "download"
                ? "✓ Downloaded"
                : copyGherkinState === "failed"
                ? "Copy failed — check browser permissions"
                : "Copy Gherkin"}
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (isDirty) return; handleCopyCsv(); }}
              disabled={isDirty}
              className="text-[10px] px-2 py-0.5 rounded"
              style={{
                background: "none",
                border: `1px solid ${copyCsvState === "failed" ? "var(--s2j-red-border)" : "var(--s2j-border)"}`,
                color: copyCsvState === "failed" && !isDirty ? "var(--s2j-red)" : "var(--s2j-text-muted)",
                cursor: isDirty ? "not-allowed" : "pointer",
              }}
              title={isDirty ? "Save this story first — export reads the SAVED cases" : "Copy CSV/manual-table for this story"}
            >
              {isDirty
                ? "Save to export"
                : copyCsvState === "clipboard"
                ? "✓ Copied"
                : copyCsvState === "download"
                ? "✓ Downloaded"
                : copyCsvState === "failed"
                ? "Copy failed — check browser permissions"
                : "Copy CSV"}
            </button>
          </>
        )}
      </summary>

      {/* Body */}
      <div
        className="px-3 pb-3 pt-2"
        style={{ borderTop: "1px solid var(--s2j-border)" }}
      >
        {/* Error sentinel */}
        {hasError && (
          <div
            className="rounded p-2 text-xs"
            style={{
              background: "var(--s2j-red-bg)",
              border: "1px solid var(--s2j-red-border)",
              color: "var(--s2j-red)",
            }}
          >
            Generation failed — click ↻ Regenerate to retry this story.
          </div>
        )}

        {/* No-ACs note */}
        {!hasError && result?.no_acs && (
          <p
            className="text-xs mb-2 italic"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            This story had no acceptance criteria — every test case below is inferred. Review before relying.
          </p>
        )}

        {/* While a regenerate is in flight, PAUSE editing for this story — a draft created during
            the 2-10 min poll would shadow the regenerated cases, and a later Save would clobber the
            regenerate (deep-audit 2026-06-06). The draft was already cleared when regen started. */}
        {!hasError && isPolling && (
          <p className="text-xs mb-2 italic" style={{ color: "var(--s2j-text-muted)" }}>
            ↻ Regenerating this story — editing is paused until the new cases arrive…
          </p>
        )}

        {/* Editable cases */}
        {!hasError && !isPolling && cases.map((tc, i) => (
          <EditableCaseRow
            key={i}
            tc={tc}
            caseNumber={i + 1}
            acceptanceCriteria={acceptanceCriteria}
            onChange={(next) => onCaseChange && onCaseChange(i, next)}
            onDelete={() => onDeleteCase && onDeleteCase(i)}
            showSaveBar={caseIsDirty(i)}
            isNewCase={caseIsNew(i)}
            saving={isSaving || isPolling}
            saveState={saveState}
            saveError={saveError}
            onSaveStory={onSave}
            onRevertCase={() =>
              caseIsNew(i)
                ? onDeleteCase && onDeleteCase(i)
                : onCaseChange && onCaseChange(i, JSON.parse(JSON.stringify(savedCases[i])))
            }
          />
        ))}

        {!hasError && !isPolling && cases.length === 0 && (
          <p className="text-xs mb-2" style={{ color: "var(--s2j-text-muted)" }}>
            No test cases. Add one below, or ↻ Regenerate.
          </p>
        )}

        {/* + Add test case — disabled at the 20-case ceiling (the parse caps at 20 — testcases.js
            parseTestCaseResult; adding a 21st would be silently dropped). Hidden while regenerating. */}
        {!hasError && !isPolling && (cases.length < 20 ? (
          <button
            type="button"
            onClick={() => onAddCase && onAddCase()}
            className="text-[11px] mb-1"
            style={{ color: "var(--s2j-blue)" }}
          >
            + Add test case
          </button>
        ) : (
          <p className="text-[11px] mb-1" style={{ color: "var(--s2j-text-muted)" }}>
            Maximum 20 cases per story — delete one to add another.
          </p>
        ))}

        {/* Story-level Save/Revert FALLBACK bar — shown only when NO per-case footer is (a case was
            removed → indices shifted, so per-case-by-index revert is unsafe; or a no-op draft). In the
            common edit/append flow the per-case footers above handle Save/Revert (Work B).
            WHY explicit save (unlike the breakdown editor's in-memory edits): test cases are re-read
            from KVS by BOTH export and the Jira push, so edits must be persisted there. */}
        {!hasError && isDirty && !anyCaseFooter && (
          <div
            className="mt-2 flex items-center gap-2 rounded-md px-3 py-2 flex-wrap"
            style={{
              background: saveState === "error" ? "var(--s2j-red-bg)" : "var(--s2j-blue-bg)",
              border: `1px solid ${saveState === "error" ? "var(--s2j-red-border)" : "var(--s2j-blue-border)"}`,
            }}
          >
            <span className="text-xs flex-1 min-w-[160px]" style={{ color: saveState === "error" ? "var(--s2j-red)" : "var(--s2j-blue)" }}>
              {saveState === "error"
                ? (saveError || "Save failed — your edits are still here. Try again.")
                : "Unsaved edits — coverage, export and push use SAVED cases."}
            </span>
            <button
              type="button"
              onClick={() => onRevert && onRevert()}
              disabled={isSaving || isPolling}
              className="text-[11px] px-2 py-1 rounded"
              style={{
                background: "none",
                border: "1px solid var(--s2j-border)",
                color: "var(--s2j-text-muted)",
                cursor: (isSaving || isPolling) ? "not-allowed" : "pointer",
              }}
              title="Discard ALL your edits to this story"
            >
              Revert all edits
            </button>
            <button
              type="button"
              onClick={() => onSave && onSave()}
              disabled={isSaving || isPolling}
              className="text-[11px] px-3 py-1 rounded font-medium"
              style={{
                background: "var(--s2j-blue)",
                border: "1px solid var(--s2j-blue)",
                color: "#fff",
                cursor: (isSaving || isPolling) ? "not-allowed" : "pointer",
                opacity: (isSaving || isPolling) ? 0.7 : 1,
              }}
              title={isPolling ? "Regenerating — wait, then Save" : "Save your edits (updates coverage, export and push)"}
            >
              {isSaving ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
        {!hasError && !isDirty && saveState === "saved" && (
          <div className="mt-2 text-xs" style={{ color: "var(--s2j-green-dark)" }}>
            ✓ Saved — coverage, export and push now use your edits.
          </div>
        )}

        {/* Fix 1: COVERAGE TRUST — render uncovered ACs + stale refs so the badge
            is actionable. Reflects the LAST SAVED coverage (recomputed on save). */}
        {!hasError && coverage && (() => {
          const uncovered = Array.isArray(coverage.uncovered_acs) ? coverage.uncovered_acs.filter(Boolean) : [];
          const stale = Array.isArray(coverage.stale_refs) ? coverage.stale_refs.filter(Boolean) : [];
          if (uncovered.length === 0 && stale.length === 0) return null;
          return (
            <div className="mt-3 flex flex-col gap-2">
              {isDirty && (
                <p className="text-[11px] italic" style={{ color: "var(--s2j-text-muted)" }}>
                  Coverage below reflects the last save — Save to recompute against your edits.
                </p>
              )}
              {uncovered.length > 0 && (
                <div
                  className="rounded-lg px-3 py-2 text-xs"
                  style={{
                    background: "var(--s2j-orange-bg)",
                    border: "1px solid var(--s2j-orange-border)",
                  }}
                >
                  <p className="font-semibold mb-1" style={{ color: "var(--s2j-text)" }}>
                    Acceptance criteria without a test case ({uncovered.length})
                  </p>
                  <ul className="ml-3 list-disc" style={{ color: "var(--s2j-text-light)" }}>
                    {uncovered.map((ac, i) => (
                      <li key={i}>{ac}</li>
                    ))}
                  </ul>
                  <p className="mt-1 italic" style={{ color: "var(--s2j-text-muted)" }}>
                    Add a case + tick the AC under “Covers”, or ↻ Regenerate.
                  </p>
                </div>
              )}
              {stale.length > 0 && (
                <div
                  className="rounded-lg px-3 py-2 text-xs"
                  style={{
                    background: "var(--s2j-orange-bg)",
                    border: "1px solid var(--s2j-orange-border)",
                  }}
                >
                  <p className="font-semibold mb-1" style={{ color: "var(--s2j-text)" }}>
                    References that no longer match a current AC ({stale.length}) — an AC may have been edited since generation
                  </p>
                  <ul className="ml-3 list-disc" style={{ color: "var(--s2j-text-light)" }}>
                    {stale.map((ref, i) => (
                      <li key={i}>{ref}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </details>
  );
}

// Fix 5: React.memo — a single-story regen's setState doesn't re-render all N cards.
export default React.memo(StoryTestCaseCard);
