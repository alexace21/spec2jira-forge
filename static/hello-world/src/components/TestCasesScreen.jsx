import React, { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@forge/bridge";
import BackButton from "./BackButton";
import StoryWizard, { StoryRow } from "./StoryWizard";
import { IconCheck, IconRefresh, IconCost, IconBeaker } from "./Icon";
import { SignalIcon, SignalCallout } from "./Signal";
import { MoodCard, TYPE, glassSurface } from "./moodboard";
import { Chip } from "./moodChips";

// Blank case template for "+ Add test case" (mirrors the schema; ac_trace empty -> the parse
// repairs to a single inferred entry until the BA ticks an AC in the AcTraceEditor checklist).
const BLANK_CASE = {
  type: "happy-path",
  priority: "Medium",
  title: "New test case",
  given: [],
  when: [],
  then: [],
  expected_result: "",
  test_data: [],
  ac_trace: [],
};

// --- clipboard helper (same as in StoryWizard, duplicated to avoid a
// shared-module dep inside this CRA app -- both are tiny) -----------------
// Returns { ok: boolean, method: 'clipboard'|'download'|'none' } -- never a silent no-op.
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true, method: "clipboard" };
  } catch (_) {
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

// --- ExportBar ----------------------------------------------------
// "Copy All - Gherkin" and "Copy All - CSV" buttons.
// Calls getTestCaseExports with storyIdx=null (all stories), format=...
// Fix 2: discriminated copy feedback -- never a silent no-op on the BA's primary export action.
function ExportBar({ jobId, hasUnsavedEdits }) {
  // 'idle' | 'clipboard' | 'download' | 'failed'
  const [gherkinState, setGherkinState] = useState("idle");
  const [csvState, setCsvState] = useState("idle");
  const [exporting, setExporting] = useState(false);
  // [diag Phase 5, gate A7] honest partial-export marker: the resolver counts the
  // stories it could NOT include (failed / data missing) -- surface that count next
  // to the Copy buttons so a CSV-only consumer (no in-file marker -- RFC-4180) is
  // never silently handed an incomplete-looking-complete file.
  const [exportSkipped, setExportSkipped] = useState(0);
  // [deep-audit P4 F6] exported-but-truncated count -- the file may ship incomplete
  // case lists with zero in-file signal for CSV (Gherkin carries a # marker).
  const [exportTruncated, setExportTruncated] = useState(0);

  const handleExport = useCallback(
    async (format, setState) => {
      if (exporting) return;
      setExporting(true);
      try {
        const resp = await invoke("getTestCaseExports", {
          jobId,
          // storyIdx omitted -> all stories
          format,
        });
        if (resp && !resp.error) {
          setExportSkipped(Number.isFinite(resp.skipped) ? resp.skipped : 0);
          setExportTruncated(Number.isFinite(resp.truncated) ? resp.truncated : 0);
          const text = format === "gherkin" ? resp.gherkin : resp.csv;
          if (text) {
            const { ok, method } = await copyToClipboard(text);
            if (ok) {
              setState(method); // 'clipboard' or 'download'
              setTimeout(() => setState("idle"), 1500);
            } else {
              setState("failed");
              setTimeout(() => setState("idle"), 2500);
            }
          } else {
            // empty body (e.g. everything skipped) -- surface, never a silent no-op
            setState("failed");
            setTimeout(() => setState("idle"), 2500);
          }
        } else {
          // [deep-audit P5 MED-2] a structured {error} (e.g. not_found after a
          // post-push purge) used to be a SILENT no-op -- against this component's
          // own "never a silent no-op" contract. Reuse the failed affordance.
          setState("failed");
          setTimeout(() => setState("idle"), 2500);
        }
      } catch (_) {
        // [deep-audit P5 MED-2] invoke rejection -- same surfacing rule.
        setState("failed");
        setTimeout(() => setState("idle"), 2500);
      }
      setExporting(false);
    },
    [jobId, exporting],
  );

  const gherkinLabel =
    gherkinState === "clipboard" ? "Copied" :
    gherkinState === "download" ? "Downloaded" :
    gherkinState === "failed" ? "Copy failed - check browser permissions" :
    "Copy All - Gherkin";

  const csvLabel =
    csvState === "clipboard" ? "Copied" :
    csvState === "download" ? "Downloaded" :
    csvState === "failed" ? "Copy failed - check browser permissions" :
    "Copy All - CSV";

  return (
    <div className="flex items-center gap-2 ml-auto">
      {exportSkipped > 0 && (
        <span
          className="text-[10px]"
          style={{ color: "var(--s2j-orange)" }}
          title="These stories have no test cases to export (generation failed or data missing) -- see Settings -> Diagnostics"
        >
          <SignalIcon kind="warning" size={14} /> {exportSkipped} {exportSkipped === 1 ? "story" : "stories"} not included
        </span>
      )}
      {exportTruncated > 0 && (
        <span
          className="text-[10px]"
          style={{ color: "var(--s2j-orange)" }}
          title="These stories hit the generation output limit -- their case lists may be incomplete. Regenerate them to be sure."
        >
          <SignalIcon kind="warning" size={14} /> {exportTruncated} may be truncated
        </span>
      )}
      {hasUnsavedEdits && (
        <span
          className="text-[10px]"
          style={{ color: "var(--s2j-orange)" }}
          title="Stories with unsaved edits export their SAVED version -- Save them to include your edits"
        >
          <SignalIcon kind="warning" size={14} /> unsaved edits excluded
        </span>
      )}
      <button
        type="button"
        onClick={() => handleExport("gherkin", setGherkinState)}
        disabled={exporting}
        className="text-xs px-3 py-1.5 rounded"
        style={{
          background: gherkinState === "failed" ? "var(--s2j-red-bg)" : "var(--s2j-blue-bg)",
          border: `1px solid ${gherkinState === "failed" ? "var(--s2j-red-border)" : "var(--s2j-blue-border)"}`,
          color: gherkinState === "failed" ? "var(--s2j-red)" : "var(--s2j-blue)",
          cursor: exporting ? "not-allowed" : "pointer",
        }}
        title="Copy all test cases as a Gherkin .feature file (BDD / Xray / Zephyr / Octane / SpiraTest)"
      >
        {gherkinLabel}
      </button>
      <button
        type="button"
        onClick={() => handleExport("csv", setCsvState)}
        disabled={exporting}
        className="text-xs px-3 py-1.5 rounded"
        style={{
          background: csvState === "failed" ? "var(--s2j-red-bg)" : "var(--s2j-bg-section)",
          border: `1px solid ${csvState === "failed" ? "var(--s2j-red-border)" : "var(--s2j-border)"}`,
          color: csvState === "failed" ? "var(--s2j-red)" : "var(--s2j-text-muted)",
          cursor: exporting ? "not-allowed" : "pointer",
        }}
        title="Copy all test cases as CSV (ADO Test Plans / Jama / IBM-ETM / TestRail / qTest / codeBeamer)"
      >
        {csvLabel}
      </button>
    </div>
  );
}

// --- GeneratePrompt -----------------------------------------------
// Shown when testCaseResults is null: invites the user to generate. Moodboard MoodCard (minor, centered).
function GeneratePrompt({ storyCount, onGenerate }) {
  return (
    <MoodCard density="minor" style={{ textAlign: "center" }}>
      <p className="text-sm font-medium mb-2" style={{ color: "var(--s2j-text)" }}>
        Generate test cases for this breakdown
      </p>
      <p className="text-xs mb-4" style={{ color: "var(--s2j-text-muted)" }}>
        {storyCount > 0
          ? `Generate BA-grade acceptance scenarios for all ${storyCount} stor${storyCount === 1 ? "y" : "ies"} - Gherkin and CSV export included.`
          : "Generate BA-grade acceptance scenarios - Gherkin and CSV export included."}
      </p>
      <button type="button" onClick={onGenerate} className="btn-primary">
        Generate Test Cases
      </button>
    </MoodCard>
  );
}

// --- SummaryBar ---------------------------------------------------
// "{N} stories . {total} cases . {failedCount} failed [Regenerate N failed]"
// Fix 7 (Audit-5): when failedCount > 0, offer a single "Regenerate N failed" button
// that loops onRegenerate(storyIdx) for every failed entry only -- preserves good stories.
// v6 cost-transparency: format the post-run Anthropic-usage cost (your own key, no markup --
// distinct from the subscription price). Non-zero amounts under a cent floor to $0.01.
function fmtUsd(usd) {
  if (typeof usd !== "number" || !isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return "$0.01";
  return `$${usd.toFixed(2)}`;
}

function SummaryBar({ testCaseResults, onRegenerate, hasTestCases = true }) {
  if (!testCaseResults) return null;
  const { perStory = [], total = 0, failedCount = 0 } = testCaseResults;
  const storyCount = perStory.length;
  const totalCases = perStory.reduce((sum, entry) => {
    const cases = entry?.result?.test_cases;
    return sum + (Array.isArray(cases) ? cases.length : 0);
  }, 0);

  // Fix 4: coverage rollup -- the BA's at-a-glance "is it ready?" signal.
  // Defensive: guard nulls; only count non-error entries.
  const fullyCovered = perStory.filter(
    (e) => e && !e.error && e.coverage && e.coverage.complete,
  ).length;
  const partial = perStory.filter(
    (e) =>
      e &&
      !e.error &&
      e.coverage &&
      e.coverage.coverage_pct != null &&
      !e.coverage.complete,
  ).length;
  const noAcs = perStory.filter(
    (e) =>
      e &&
      !e.error &&
      e.coverage &&
      e.coverage.coverage_pct == null,
  ).length;
  // Only render the coverage rollup when there is something to show (at least one
  // computed coverage -- i.e. generation has run, not all entries are errors).
  const hasCoverage = fullyCovered + partial + noAcs > 0;

  const handleRetryFailed = () => {
    if (!onRegenerate) return;
    const failedEntries = perStory.filter((e) => e && e.error);
    failedEntries.forEach((e) => onRegenerate(e.storyIdx));
  };

  return (
    // Calm moodboard inset: same counts + coverage rollup, rendered as Chips.
    <div
      className="mb-4 flex flex-wrap items-center gap-2"
      style={{ ...glassSurface("utility"), padding: "10px 14px" }}
    >
      <Chip tone="neutral" title="Stories in this breakdown">
        {storyCount} stor{storyCount !== 1 ? "ies" : "y"}
      </Chip>
      <Chip tone="neutral" title="Total test cases across all stories">
        {totalCases} test case{totalCases !== 1 ? "s" : ""}
      </Chip>
      {/* v6 cost-transparency: exact post-run Anthropic-usage echo for this run (your own key, no markup) */}
      {typeof testCaseResults?.cost?.total_usd === "number" && (
        <Chip tone="neutral" icon={<IconCost size={13} />} title="Anthropic API usage for this run -- billed to your own API key, no markup">
          {fmtUsd(testCaseResults.cost.total_usd)} used
        </Chip>
      )}
      {failedCount > 0 && (
        <Chip tone="error" icon={<SignalIcon kind="error" size={13} />} title="Stories whose generation failed">
          {failedCount} failed
        </Chip>
      )}
      {/* "Regenerate N failed" is a paid action -- gated on hasTestCases. */}
      {failedCount > 0 && hasTestCases && onRegenerate && (
        <button
          type="button"
          onClick={handleRetryFailed}
          className="text-[11px] px-2 py-0.5 rounded"
          style={{
            background: "none",
            border: "1px solid var(--s2j-red-border)",
            color: "var(--s2j-red)",
            cursor: "pointer",
          }}
          title={`Regenerate the ${failedCount} failed stor${failedCount === 1 ? "y" : "ies"}`}
        >
          <IconRefresh size={13} style={{ color: "var(--s2j-red)" }} /> Regenerate {failedCount} failed {failedCount === 1 ? "story" : "stories"}
        </button>
      )}
      {/* coverage rollup -- only shown after generation has populated coverage data */}
      {hasCoverage && (
        <>
          <span aria-hidden="true" style={{ width: 1, height: 16, background: "var(--s2j-border)" }} />
          {fullyCovered > 0 && (
            <Chip tone="success" icon={<IconCheck size={13} />} title="Stories with every acceptance criterion covered">
              {fullyCovered} fully covered
            </Chip>
          )}
          {partial > 0 && (
            <Chip tone="warning" icon={<SignalIcon kind="warning" size={13} />} title="Stories with some acceptance criteria uncovered or stale">
              {partial} partial
            </Chip>
          )}
          {noAcs > 0 && (
            <Chip tone="neutral" title="Stories with no acceptance criteria">
              {noAcs} no-ACs
            </Chip>
          )}
        </>
      )}
    </div>
  );
}

// --- StaleBanner --------------------------------------------------
// Shown when the breakdown page version at test-case-generation time is behind the current page version.
function StaleBanner() {
  return (
    <SignalCallout kind="warning" title="The page was edited since these test cases were generated" style={{ marginBottom: 16 }}>
      <span style={{ color: "var(--s2j-text-light)" }}>
        Regenerate individual stories (Regenerate per card) or go back and regenerate the breakdown first.
      </span>
    </SignalCallout>
  );
}

// --- EditStaleBanner ----------------------------------------------
// Shown when the BREAKDOWN was edited (in-app) since these test cases were generated -- the cases
// (and the per-Story Jira embed) rest on the earlier acceptance criteria. Distinct from StaleBanner
// (Confluence PAGE-version drift). NO auto-regen -- the BA decides: regenerate affected stories, or push as-is.
function EditStaleBanner({ count = 0 }) {
  return (
    <SignalCallout kind="warning" title="The breakdown was edited since these test cases were generated" style={{ marginBottom: 16 }}>
      {count > 0 && (
        <p className="text-xs font-medium" style={{ color: "var(--s2j-orange)", margin: "0 0 2px" }}>
          {count} stor{count === 1 ? "y is" : "ies are"} affected (marked below).
        </p>
      )}
      <p className="text-xs" style={{ color: "var(--s2j-text-light)", margin: 0 }}>
        These cases (and the summary that embeds in each Jira Story) rest on the earlier acceptance criteria. Regenerate the affected stories (Regenerate per card) to refresh - or push as-is; it's your call.
      </p>
    </SignalCallout>
  );
}

// ================================================================
// TestCasesScreen
// ================================================================
/**
 * Dedicated Test Cases screen (P5).
 *
 * Props:
 *   testCaseResults   -- getTestCases payload or null (null = not yet generated)
 *   breakdown         -- the edited breakdown (for push + story count when null)
 *   pageTitle         -- string; shown in top bar
 *   jobId             -- string; needed for export + regenerate invokes
 *   currentVersion    -- number|null; current Confluence page version
 *   onBack            -- fn() -> Review/Confirm screen (confirming; does NOT clear testCaseResults)
 *   onPush            -- fn(breakdown) -> confirming screen
 *   onGenerate        -- fn() -> triggers bulk generation (handleGenerateTestCases)
 *   onRegenerate      -- fn(storyIdx) -> per-story regen
 *   regenStates       -- { [storyIdx]: 'idle'|'pending'|'polling'|'done'|'error' }
 */
function TestCasesScreen({
  testCaseResults,
  breakdown,
  pageTitle,
  jobId,
  currentVersion,
  tcStale,
  tcStaleStoryIdxs = [],
  tcRemovedStoryIdxs = [],
  onBack,
  onPush,
  onGenerate,
  onRegenerate,
  onSaveTestCase,
  regenStates = {},
  hasTestCases = true, // v6: false => a downgraded user viewing RETAINED cases (edit/regen need Advanced). Default true = back-compat / entitled.
}) {
  // Stale detection: testCaseResults.breakdownPageVersion < currentVersion
  const tcPageVersion = testCaseResults?.breakdownPageVersion;
  const isStale =
    typeof tcPageVersion === "number" &&
    typeof currentVersion === "number" &&
    currentVersion > tcPageVersion;

  // Story count for the GeneratePrompt (from the breakdown shape)
  const storyCount =
    (breakdown?.capabilities || []).flatMap((c) => c.features || []).length ||
    0;

  const perStory = testCaseResults?.perStory || [];

  // --- Edit drafts (human-in-the-loop) -----------------------------
  // drafts[storyIdx] = the unsaved edited result for that story. Held HERE (above the memoized
  // cards) so a card re-render / accordion collapse never drops in-progress edits. Edits reach
  // export + push ONLY after Save persists them to KVS (handleSave -> onSaveTestCase -> resolver).
  const [drafts, setDrafts] = useState({});
  // Drill-in: null => the triage OVERVIEW (compact story rows); a storyIdx => the per-story type-phase WIZARD.
  // Local state (NOT App.js) so drafts/save/coverage stay parent-held and survive the overview<->wizard hop.
  const [openStoryIdx, setOpenStoryIdx] = useState(null);
  const wizardFocusRef = useRef(null);
  const [saveStates, setSaveStates] = useState({}); // storyIdx -> 'idle'|'saving'|'saved'|'error'
  const [saveErrors, setSaveErrors] = useState({});
  // Work B: true for a story whose draft had a SAVED case deleted since last save. A delete shifts
  // array indices, making the card's per-case-by-index Save/Revert footers unsafe -> it falls back to a
  // single story-level bar. Field edits + appends (and deleting a never-saved appended case) keep
  // indices aligned and do NOT set this. Cleared on save-success / revert / regenerate.
  const [shiftedStories, setShiftedStories] = useState({});
  const clearShifted = useCallback(
    (storyIdx) => setShiftedStories((prev) => { const n = { ...prev }; delete n[storyIdx]; return n; }),
    [],
  );
  const savedTimers = useRef({});
  const pushArmTimer = useRef(null);
  const backArmTimer = useRef(null);
  const [pushArmed, setPushArmed] = useState(false);
  const [backArmed, setBackArmed] = useState(false);
  const [refreshArmed, setRefreshArmed] = useState(false);
  const refreshArmTimer = useRef(null);
  useEffect(
    () => () => {
      Object.values(savedTimers.current).forEach(clearTimeout);
      clearTimeout(pushArmTimer.current);
      clearTimeout(backArmTimer.current);
      clearTimeout(refreshArmTimer.current);
    },
    [],
  );

  const handleCaseChange = useCallback((storyIdx, caseIdx, nextCase) => {
    setDrafts((prev) => {
      const base = prev[storyIdx] || (perStory.find((e) => e && e.storyIdx === storyIdx)?.result) || { test_cases: [], no_acs: false, story_name: "" };
      const test_cases = (base.test_cases || []).map((c, i) => (i === caseIdx ? nextCase : c));
      return { ...prev, [storyIdx]: { ...base, test_cases } };
    });
    setSaveStates((prev) => ({ ...prev, [storyIdx]: "idle" }));
  }, [perStory]);

  const handleAddCase = useCallback((storyIdx, typeOverride) => {
    setDrafts((prev) => {
      const base = prev[storyIdx] || (perStory.find((e) => e && e.storyIdx === storyIdx)?.result) || { test_cases: [], no_acs: false, story_name: "" };
      // "+ Add {type} case" from a type-phase pre-sets the new case's type so it lands in that phase.
      const newCase = { ...BLANK_CASE };
      if (typeOverride && ["happy-path", "edge", "negative"].includes(typeOverride)) newCase.type = typeOverride;
      return { ...prev, [storyIdx]: { ...base, test_cases: [...(base.test_cases || []), newCase] } };
    });
    setSaveStates((prev) => ({ ...prev, [storyIdx]: "idle" }));
  }, [perStory]);

  const handleDeleteCase = useCallback((storyIdx, caseIdx) => {
    // Deleting a SAVED case (index < saved length) shifts indices -> per-case-by-index footers become
    // unsafe; flag it so the card falls back to the story-level bar. Deleting a never-saved appended
    // case (index >= saved length) keeps the saved region aligned -> no flag. (Once flagged it stays
    // until save/revert; a later imprecise eval is harmless.)
    const savedLen = (perStory.find((e) => e && e.storyIdx === storyIdx)?.result?.test_cases || []).length;
    if (caseIdx < savedLen) setShiftedStories((prev) => ({ ...prev, [storyIdx]: true }));
    setDrafts((prev) => {
      const base = prev[storyIdx] || (perStory.find((e) => e && e.storyIdx === storyIdx)?.result) || { test_cases: [], no_acs: false, story_name: "" };
      return { ...prev, [storyIdx]: { ...base, test_cases: (base.test_cases || []).filter((_, i) => i !== caseIdx) } };
    });
    setSaveStates((prev) => ({ ...prev, [storyIdx]: "idle" }));
  }, [perStory]);

  const handleRevert = useCallback((storyIdx) => {
    setDrafts((prev) => { const n = { ...prev }; delete n[storyIdx]; return n; });
    clearShifted(storyIdx);
    setSaveStates((prev) => ({ ...prev, [storyIdx]: "idle" }));
    setSaveErrors((prev) => ({ ...prev, [storyIdx]: null }));
  }, [clearShifted]);

  const handleSave = useCallback(async (storyIdx) => {
    const draft = drafts[storyIdx];
    if (!draft || !onSaveTestCase) return;
    setSaveStates((prev) => ({ ...prev, [storyIdx]: "saving" }));
    setSaveErrors((prev) => ({ ...prev, [storyIdx]: null }));
    let resp;
    try {
      resp = await onSaveTestCase(storyIdx, draft);
    } catch (_e) {
      resp = { error: "save_failed", detail: "Could not save (network). Your edits are still here - try again." };
    }
    if (resp && resp.ok) {
      // App.js delta-patched testCaseResults from the SAVED result; drop the local draft so the
      // card shows the persisted entry (with the authoritative recomputed coverage).
      setDrafts((prev) => { const n = { ...prev }; delete n[storyIdx]; return n; });
      clearShifted(storyIdx); // saved baseline now matches the draft -> per-case footers safe again
      setSaveStates((prev) => ({ ...prev, [storyIdx]: "saved" }));
      clearTimeout(savedTimers.current[storyIdx]);
      savedTimers.current[storyIdx] = setTimeout(
        () => setSaveStates((prev) => ({ ...prev, [storyIdx]: "idle" })),
        3000,
      );
    } else {
      // FAIL LOUD + keep the draft (POLICY: never silent; the BA's work must survive a failed save).
      setSaveStates((prev) => ({ ...prev, [storyIdx]: "error" }));
      setSaveErrors((prev) => ({ ...prev, [storyIdx]: (resp && resp.detail) || "Save failed - your edits are still here." }));
    }
  }, [drafts, onSaveTestCase, clearShifted]);

  // Regenerate must DISCARD this story's unsaved draft first -- else the stale draft shadows the
  // regenerated cases (the card renders draftResult || entry.result) and a later Save would clobber
  // the regenerate. Makes the "Discard edits & regenerate?" confirm truthful.
  const handleRegenerate = useCallback((storyIdx) => {
    setDrafts((prev) => { const n = { ...prev }; delete n[storyIdx]; return n; });
    clearShifted(storyIdx);
    setSaveStates((prev) => ({ ...prev, [storyIdx]: "idle" }));
    setSaveErrors((prev) => ({ ...prev, [storyIdx]: null }));
    onRegenerate?.(storyIdx);
  }, [onRegenerate, clearShifted]);

  // (#3) "Refresh N affected" -- bulk-regenerate every story whose ACs changed (tcStaleStoryIdxs).
  // Each is a paid generation -> a 2-step armed confirm (mirrors the per-card "Discard & regenerate?").
  const handleRefreshAffected = useCallback(() => {
    const idxs = Array.isArray(tcStaleStoryIdxs) ? tcStaleStoryIdxs : [];
    if (!idxs.length) return;
    if (!refreshArmed) {
      setRefreshArmed(true);
      clearTimeout(refreshArmTimer.current);
      refreshArmTimer.current = setTimeout(() => setRefreshArmed(false), 4000);
      return;
    }
    setRefreshArmed(false);
    idxs.forEach((idx) => handleRegenerate(idx));
  }, [tcStaleStoryIdxs, refreshArmed, handleRegenerate]);

  const dirtyCount = Object.keys(drafts).length;

  // The story being drilled into (null => overview). Guarded: a stale openStoryIdx with no matching entry
  // falls back to the overview render.
  const openEntry = openStoryIdx != null && testCaseResults
    ? perStory.find((e) => e && e.storyIdx === openStoryIdx)
    : null;

  // a11y: focus the wizard on drill-in so keyboard / screen-reader users land on it (mirrors PlanScreen's
  // step-focus). preventScroll keeps the iframe still.
  useEffect(() => {
    if (openStoryIdx != null && wizardFocusRef.current) {
      try { wizardFocusRef.current.focus({ preventScroll: true }); } catch (_) { wizardFocusRef.current.focus(); }
    }
  }, [openStoryIdx]);

  // Back-to-Review dirty guard -- TestCasesScreen unmounts on navigation, which would destroy
  // unsaved drafts. Two-step confirm so a BA never loses unsaved edits silently.
  const handleBackClick = useCallback(() => {
    if (dirtyCount > 0 && !backArmed) {
      setBackArmed(true);
      clearTimeout(backArmTimer.current);
      backArmTimer.current = setTimeout(() => setBackArmed(false), 4000);
      return;
    }
    setBackArmed(false);
    onBack?.();
  }, [dirtyCount, backArmed, onBack]);

  const SCREEN_MAX_WIDTH_STYLE = { maxWidth: "1200px", margin: "0 auto", width: "100%" };

  return (
    <div
      // 2026-06-26 UX: no minHeight:100vh -- TestCases has no internal overflow pane
      // (its body is a plain flex-1 p-4), so it flows naturally and the Forge resizer
      // fits the iframe to content (no empty scroll band below short results). Kept as
      // a flex column purely to keep the shrink-0 top bar layout consistent.
      style={{
        display: "flex",
        flexDirection: "column",
        ...SCREEN_MAX_WIDTH_STYLE,
      }}
    >
      {/* Top bar -- mirrors the reviewing screen's top-bar */}
      <div
        className="shrink-0 px-3 py-2 flex items-center gap-2"
        style={{
          background: "var(--s2j-bg-section)",
          borderBottom: "1px solid var(--s2j-border)",
        }}
      >
        <BackButton
          onClick={handleBackClick}
          className=""
          label={dirtyCount > 0 && backArmed ? `${dirtyCount} unsaved - leave anyway?` : "Back to Review"}
          title={dirtyCount > 0 ? "Some stories have unsaved test-case edits - Save them first or they'll be discarded" : undefined}
        />
        <span
          className="text-[11px]"
          style={{ color: "var(--s2j-text-muted)" }}
        >
          {pageTitle || "(test cases)"}
        </span>

        {/* Export bar -- only shown when results exist */}
        {testCaseResults && jobId && <ExportBar jobId={jobId} hasUnsavedEdits={dirtyCount > 0} />}

        {/* Continue to Push -- when stories have unsaved edits, a two-step confirm: push reads
            SAVED cases from KVS, so unsaved edits won't be embedded unless the BA Saves first. */}
        <button
          type="button"
          onClick={() => {
            if (dirtyCount > 0 && !pushArmed) {
              setPushArmed(true);
              clearTimeout(pushArmTimer.current);
              pushArmTimer.current = setTimeout(() => setPushArmed(false), 4000);
              return;
            }
            setPushArmed(false);
            onPush?.(breakdown);
          }}
          className="btn-primary text-xs shrink-0"
          style={{ marginLeft: testCaseResults ? "0" : "auto", whiteSpace: "nowrap" }}
          title={dirtyCount > 0 ? "Some stories have unsaved test-case edits - Save them first to include them in the push" : "Continue to push"}
        >
          {dirtyCount > 0 && pushArmed
            ? `${dirtyCount} unsaved - push anyway?`
            : <>Continue to Push <span aria-hidden="true">&rarr;</span></>}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 p-4">
        {openEntry ? (
          // --- DRILL-IN: the per-story type-phase wizard. Drafts/save/coverage are parent-held (above), so
          // entering/leaving the wizard never drops edits. Callbacks pass the ABSOLUTE caseIdx (the wizard
          // filters by type for display only). key={openStoryIdx} remounts (resets the phase to 1) when the
          // open story changes; the wrapper is the a11y focus target on drill-in. ---
          <div ref={wizardFocusRef} tabIndex={-1} style={{ outline: "none" }}>
          <StoryWizard
            key={openStoryIdx}
            entry={openEntry}
            jobId={jobId}
            hasTestCases={hasTestCases}
            isStale={tcStaleStoryIdxs.includes(openStoryIdx)}
            isRemoved={tcRemovedStoryIdxs.includes(openStoryIdx)}
            regenState={regenStates[openStoryIdx] || "idle"}
            onRegenerate={handleRegenerate}
            draftResult={drafts[openStoryIdx] || null}
            isDirty={drafts[openStoryIdx] !== undefined}
            structurallyShifted={!!shiftedStories[openStoryIdx]}
            saveState={saveStates[openStoryIdx] || "idle"}
            saveError={saveErrors[openStoryIdx] || null}
            onCaseChange={(caseIdx, next) => handleCaseChange(openStoryIdx, caseIdx, next)}
            onAddCase={(type) => handleAddCase(openStoryIdx, type)}
            onDeleteCase={(caseIdx) => handleDeleteCase(openStoryIdx, caseIdx)}
            onSave={() => handleSave(openStoryIdx)}
            onRevert={() => handleRevert(openStoryIdx)}
            onBackToList={() => setOpenStoryIdx(null)}
          />
          </div>
        ) : (
          <>
            {/* Body header -- moodboard title (navy 22 + leading blue beaker) + subtitle. Static, not sticky. */}
            <div style={{ marginBottom: 16 }}>
              <h2 style={{ ...TYPE.title, fontSize: 22, display: "inline-flex", alignItems: "center", gap: 10 }}>
                <span style={{ color: "var(--s2j-blue)", display: "inline-flex" }}><IconBeaker size={20} /></span>
                Test Cases
              </h2>
              <p style={{ ...TYPE.sub, marginTop: 4 }}>
                Acceptance scenarios for every story - open a story to review its cases by type, or export to Gherkin (BDD tools) / CSV (ADO, Jama, TestRail...).
              </p>
            </div>

            {/* Defensive fallback: post-#1-redesign this screen opens only WITH results (the Review/Confirm
                screen generates directly), so this branch is normally unreachable -- kept so a BA who somehow
                lands here without results still has a generate path. */}
            {!testCaseResults ? (
              <GeneratePrompt storyCount={storyCount} onGenerate={onGenerate} />
            ) : (
              <>
                {isStale && <StaleBanner />}
                {tcStale && <EditStaleBanner count={tcStaleStoryIdxs.length} />}
                {/* the bulk "Refresh N affected" is a paid regenerate -> gate it on hasTestCases so a
                    downgraded user gets the read-only experience the banner promises. */}
                {hasTestCases && tcStale && tcStaleStoryIdxs.length >= 2 && (() => {
                  const bulkBusy = tcStaleStoryIdxs.some((idx) => regenStates[idx] === "pending" || regenStates[idx] === "polling");
                  return (
                    <button
                      type="button"
                      onClick={handleRefreshAffected}
                      disabled={bulkBusy}
                      className="mb-4 text-xs px-3 py-1.5 rounded"
                      style={{ background: "var(--s2j-orange-bg)", border: "1px solid var(--s2j-orange-border)", color: bulkBusy ? "var(--s2j-text-muted)" : "var(--s2j-orange)", cursor: bulkBusy ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
                      title="Regenerate every story whose acceptance criteria changed -- each is a paid generation (a few minutes each)"
                    >
                      {bulkBusy
                        ? `Regenerating ${tcStaleStoryIdxs.length} stories...`
                        : refreshArmed
                        ? `Re-runs ${tcStaleStoryIdxs.length} affected stories (uses compute) - confirm?`
                        : `Refresh ${tcStaleStoryIdxs.length} affected stories`}
                    </button>
                  );
                })()}
                <SummaryBar testCaseResults={testCaseResults} onRegenerate={handleRegenerate} hasTestCases={hasTestCases} />
                <div>
                  {perStory.map((entry) => (
                    <StoryRow
                      key={entry.storyIdx}
                      entry={entry}
                      jobId={jobId}
                      hasTestCases={hasTestCases}
                      isStale={tcStaleStoryIdxs.includes(entry.storyIdx)}
                      isRemoved={tcRemovedStoryIdxs.includes(entry.storyIdx)}
                      isDirty={drafts[entry.storyIdx] !== undefined}
                      regenState={regenStates[entry.storyIdx] || "idle"}
                      onRegenerate={handleRegenerate}
                      onOpen={setOpenStoryIdx}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default TestCasesScreen;
