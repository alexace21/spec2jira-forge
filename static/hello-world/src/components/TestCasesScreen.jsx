import React, { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@forge/bridge";
import BackButton from "./BackButton";
import StoryTestCaseCard from "./StoryTestCaseCard";

// Blank case template for "+ Add test case" (mirrors the schema; ac_trace empty → the parse
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

// ── clipboard helper (same as in StoryTestCaseCard, duplicated to avoid a
// shared-module dep inside this CRA app — both are tiny) ─────────────────
// Returns { ok: boolean, method: 'clipboard'|'download'|'none' } — never a silent no-op.
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

// ── ExportBar ────────────────────────────────────────────────────
// "Copy All — Gherkin" and "Copy All — CSV" buttons.
// Calls getTestCaseExports with storyIdx=null (all stories), format=…
// Fix 2: discriminated copy feedback — never a silent no-op on the BA's primary export action.
function ExportBar({ jobId, hasUnsavedEdits }) {
  // 'idle' | 'clipboard' | 'download' | 'failed'
  const [gherkinState, setGherkinState] = useState("idle");
  const [csvState, setCsvState] = useState("idle");
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(
    async (format, setState) => {
      if (exporting) return;
      setExporting(true);
      try {
        const resp = await invoke("getTestCaseExports", {
          jobId,
          // storyIdx omitted → all stories
          format,
        });
        if (resp && !resp.error) {
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
          }
        }
      } catch (_) {}
      setExporting(false);
    },
    [jobId, exporting],
  );

  const gherkinLabel =
    gherkinState === "clipboard" ? "✓ Copied" :
    gherkinState === "download" ? "✓ Downloaded" :
    gherkinState === "failed" ? "Copy failed — check browser permissions" :
    "Copy All — Gherkin";

  const csvLabel =
    csvState === "clipboard" ? "✓ Copied" :
    csvState === "download" ? "✓ Downloaded" :
    csvState === "failed" ? "Copy failed — check browser permissions" :
    "Copy All — CSV";

  return (
    <div className="flex items-center gap-2 ml-auto">
      {hasUnsavedEdits && (
        <span
          className="text-[10px]"
          style={{ color: "var(--s2j-orange)" }}
          title="Stories with unsaved edits export their SAVED version — Save them to include your edits"
        >
          ⚠ unsaved edits excluded
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

// ── GeneratePrompt ───────────────────────────────────────────────
// Shown when testCaseResults is null: invites the user to generate.
function GeneratePrompt({ storyCount, onGenerate }) {
  return (
    <div
      className="rounded-lg p-6 text-center"
      style={{
        background: "var(--s2j-bg-section)",
        border: "1px solid var(--s2j-border)",
      }}
    >
      <p
        className="text-sm font-medium mb-2"
        style={{ color: "var(--s2j-text)" }}
      >
        Generate test cases for this breakdown
      </p>
      <p className="text-xs mb-4" style={{ color: "var(--s2j-text-muted)" }}>
        {storyCount > 0
          ? `Generate BA-grade acceptance scenarios for all ${storyCount} stor${storyCount === 1 ? "y" : "ies"} — Gherkin and CSV export included.`
          : "Generate BA-grade acceptance scenarios — Gherkin and CSV export included."}
      </p>
      <button
        type="button"
        onClick={onGenerate}
        className="btn-primary"
      >
        Generate Test Cases
      </button>
    </div>
  );
}

// ── SummaryBar ───────────────────────────────────────────────────
// "{N} stories · {total} cases · {failedCount} failed [↻ Regenerate N failed]"
// Fix 7 (Audit-5): when failedCount > 0, offer a single "↻ Regenerate N failed" button
// that loops onRegenerate(storyIdx) for every failed entry only — preserves good stories.
function SummaryBar({ testCaseResults, onRegenerate }) {
  if (!testCaseResults) return null;
  const { perStory = [], total = 0, failedCount = 0 } = testCaseResults;
  const storyCount = perStory.length;
  const totalCases = perStory.reduce((sum, entry) => {
    const cases = entry?.result?.test_cases;
    return sum + (Array.isArray(cases) ? cases.length : 0);
  }, 0);

  // Fix 4: coverage rollup — the BA's at-a-glance "is it ready?" signal.
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
  // computed coverage — i.e. generation has run, not all entries are errors).
  const hasCoverage = fullyCovered + partial + noAcs > 0;

  const handleRetryFailed = () => {
    if (!onRegenerate) return;
    const failedEntries = perStory.filter((e) => e && e.error);
    failedEntries.forEach((e) => onRegenerate(e.storyIdx));
  };

  return (
    <div
      className="rounded-md px-3 py-2 mb-4 text-xs flex flex-col gap-1"
      style={{
        background: "var(--s2j-bg-section)",
        border: "1px solid var(--s2j-border)",
        color: "var(--s2j-text-muted)",
      }}
    >
      {/* Row 1: counts + failed + retry button */}
      <div className="flex items-center gap-2 flex-wrap">
        <span>
          <strong style={{ color: "var(--s2j-text)" }}>{storyCount}</strong>{" "}
          stor{storyCount !== 1 ? "ies" : "y"}
        </span>
        <span>·</span>
        <span>
          <strong style={{ color: "var(--s2j-text)" }}>{totalCases}</strong>{" "}
          test case{totalCases !== 1 ? "s" : ""}
        </span>
        {failedCount > 0 && (
          <>
            <span>·</span>
            <span style={{ color: "var(--s2j-red)" }}>
              <strong>{failedCount}</strong> failed
            </span>
            {onRegenerate && (
              <button
                type="button"
                onClick={handleRetryFailed}
                className="text-[10px] px-2 py-0.5 rounded"
                style={{
                  background: "none",
                  border: "1px solid var(--s2j-red-border)",
                  color: "var(--s2j-red)",
                  cursor: "pointer",
                }}
                title={`Regenerate the ${failedCount} failed stor${failedCount === 1 ? "y" : "ies"}`}
              >
                ↻ Regenerate {failedCount} failed {failedCount === 1 ? "story" : "stories"}
              </button>
            )}
          </>
        )}
      </div>

      {/* Row 2: coverage rollup — only shown after generation has populated coverage data */}
      {hasCoverage && (
        <div className="flex items-center gap-2 flex-wrap">
          {fullyCovered > 0 && (
            <span style={{ color: "var(--s2j-green-dark)" }}>
              ✓ <strong>{fullyCovered}</strong> fully covered
            </span>
          )}
          {partial > 0 && (
            <>
              {fullyCovered > 0 && <span>·</span>}
              <span style={{ color: "var(--s2j-orange)" }}>
                ⚠ <strong>{partial}</strong> partial
              </span>
            </>
          )}
          {noAcs > 0 && (
            <>
              {(fullyCovered > 0 || partial > 0) && <span>·</span>}
              <span style={{ color: "var(--s2j-text-muted)" }}>
                <strong>{noAcs}</strong> no-ACs
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── StaleBanner ──────────────────────────────────────────────────
// Shown when the breakdown page version at test-case-generation time
// is behind the current page version.
function StaleBanner() {
  return (
    <div
      className="rounded-lg p-3 mb-4 flex items-start gap-2"
      style={{
        background: "var(--s2j-orange-bg)",
        border: "1px solid var(--s2j-orange-border)",
      }}
    >
      <span aria-hidden="true" style={{ flexShrink: 0 }}>⚠</span>
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--s2j-text)" }}>
          The page was edited since these test cases were generated
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--s2j-text-light)" }}>
          Regenerate individual stories (↻ Regenerate per card) or go back and regenerate the breakdown first.
        </p>
      </div>
    </div>
  );
}

// ── EditStaleBanner ──────────────────────────────────────────────
// Shown when the BREAKDOWN was edited (in-app) since these test cases were generated — the cases
// (and the per-Story Jira embed) rest on the earlier acceptance criteria. Distinct from StaleBanner
// (Confluence PAGE-version drift). NO auto-regen — the BA decides: regenerate affected stories, or push as-is.
function EditStaleBanner({ count = 0 }) {
  return (
    <div
      className="rounded-lg p-3 mb-4 flex items-start gap-2"
      style={{
        background: "var(--s2j-orange-bg)",
        border: "1px solid var(--s2j-orange-border)",
      }}
    >
      <span aria-hidden="true" style={{ flexShrink: 0 }}>⚠</span>
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--s2j-text)" }}>
          The breakdown was edited since these test cases were generated
        </p>
        {count > 0 && (
          <p className="text-xs mt-0.5 font-medium" style={{ color: "var(--s2j-orange)" }}>
            {count} stor{count === 1 ? "y is" : "ies are"} affected (marked below).
          </p>
        )}
        <p className="text-xs mt-0.5" style={{ color: "var(--s2j-text-light)" }}>
          These cases (and the summary that embeds in each Jira Story) rest on the earlier acceptance criteria. Regenerate the affected stories (↻ Regenerate per card) to refresh — or push as-is; it's your call.
        </p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TestCasesScreen
// ════════════════════════════════════════════════════════════════
/**
 * Dedicated Test Cases screen (P5).
 *
 * Props:
 *   testCaseResults   — getTestCases payload or null (null = not yet generated)
 *   breakdown         — the edited breakdown (for push + story count when null)
 *   pageTitle         — string; shown in top bar
 *   jobId             — string; needed for export + regenerate invokes
 *   currentVersion    — number|null; current Confluence page version
 *   onBack            — fn() → Review/Confirm screen (confirming; does NOT clear testCaseResults)
 *   onPush            — fn(breakdown) → confirming screen
 *   onGenerate        — fn() → triggers bulk generation (handleGenerateTestCases)
 *   onRegenerate      — fn(storyIdx) → per-story regen
 *   regenStates       — { [storyIdx]: 'idle'|'pending'|'polling'|'done'|'error' }
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

  // ── Edit drafts (human-in-the-loop) ──────────────────────────────
  // drafts[storyIdx] = the unsaved edited result for that story. Held HERE (above the memoized
  // cards) so a card re-render / accordion collapse never drops in-progress edits. Edits reach
  // export + push ONLY after Save persists them to KVS (handleSave → onSaveTestCase → resolver).
  const [drafts, setDrafts] = useState({});
  const [saveStates, setSaveStates] = useState({}); // storyIdx → 'idle'|'saving'|'saved'|'error'
  const [saveErrors, setSaveErrors] = useState({});
  // Work B: true for a story whose draft had a SAVED case deleted since last save. A delete shifts
  // array indices, making the card's per-case-by-index Save/Revert footers unsafe → it falls back to a
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

  const handleAddCase = useCallback((storyIdx) => {
    setDrafts((prev) => {
      const base = prev[storyIdx] || (perStory.find((e) => e && e.storyIdx === storyIdx)?.result) || { test_cases: [], no_acs: false, story_name: "" };
      return { ...prev, [storyIdx]: { ...base, test_cases: [...(base.test_cases || []), { ...BLANK_CASE }] } };
    });
    setSaveStates((prev) => ({ ...prev, [storyIdx]: "idle" }));
  }, [perStory]);

  const handleDeleteCase = useCallback((storyIdx, caseIdx) => {
    // Deleting a SAVED case (index < saved length) shifts indices → per-case-by-index footers become
    // unsafe; flag it so the card falls back to the story-level bar. Deleting a never-saved appended
    // case (index ≥ saved length) keeps the saved region aligned → no flag. (Once flagged it stays
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
      resp = { error: "save_failed", detail: "Could not save (network). Your edits are still here — try again." };
    }
    if (resp && resp.ok) {
      // App.js delta-patched testCaseResults from the SAVED result; drop the local draft so the
      // card shows the persisted entry (with the authoritative recomputed coverage).
      setDrafts((prev) => { const n = { ...prev }; delete n[storyIdx]; return n; });
      clearShifted(storyIdx); // saved baseline now matches the draft → per-case footers safe again
      setSaveStates((prev) => ({ ...prev, [storyIdx]: "saved" }));
      clearTimeout(savedTimers.current[storyIdx]);
      savedTimers.current[storyIdx] = setTimeout(
        () => setSaveStates((prev) => ({ ...prev, [storyIdx]: "idle" })),
        3000,
      );
    } else {
      // FAIL LOUD + keep the draft (POLICY: never silent; the BA's work must survive a failed save).
      setSaveStates((prev) => ({ ...prev, [storyIdx]: "error" }));
      setSaveErrors((prev) => ({ ...prev, [storyIdx]: (resp && resp.detail) || "Save failed — your edits are still here." }));
    }
  }, [drafts, onSaveTestCase, clearShifted]);

  // Regenerate must DISCARD this story's unsaved draft first — else the stale draft shadows the
  // regenerated cases (the card renders draftResult || entry.result) and a later Save would clobber
  // the regenerate. Makes the "Discard edits & regenerate?" confirm truthful.
  const handleRegenerate = useCallback((storyIdx) => {
    setDrafts((prev) => { const n = { ...prev }; delete n[storyIdx]; return n; });
    clearShifted(storyIdx);
    setSaveStates((prev) => ({ ...prev, [storyIdx]: "idle" }));
    setSaveErrors((prev) => ({ ...prev, [storyIdx]: null }));
    onRegenerate?.(storyIdx);
  }, [onRegenerate, clearShifted]);

  // (#3) "Refresh N affected" — bulk-regenerate every story whose ACs changed (tcStaleStoryIdxs).
  // Each is a paid generation → a 2-step armed confirm (mirrors the per-card "Discard & regenerate?").
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

  // Back-to-Review dirty guard — TestCasesScreen unmounts on navigation, which would destroy
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
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        ...SCREEN_MAX_WIDTH_STYLE,
      }}
    >
      {/* Top bar — mirrors the reviewing screen's top-bar */}
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
          label={dirtyCount > 0 && backArmed ? `⚠ ${dirtyCount} unsaved — leave anyway?` : "Back to Review"}
          title={dirtyCount > 0 ? "Some stories have unsaved test-case edits — Save them first or they'll be discarded" : undefined}
        />
        <span
          className="text-[11px]"
          style={{ color: "var(--s2j-text-muted)" }}
        >
          {pageTitle || "(test cases)"}
        </span>

        {/* Export bar — only shown when results exist */}
        {testCaseResults && jobId && <ExportBar jobId={jobId} hasUnsavedEdits={dirtyCount > 0} />}

        {/* Continue to Push — when stories have unsaved edits, a two-step confirm: push reads
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
          title={dirtyCount > 0 ? "Some stories have unsaved test-case edits — Save them first to include them in the push" : "Continue to push"}
        >
          {dirtyCount > 0 && pushArmed
            ? `⚠ ${dirtyCount} unsaved — push anyway?`
            : "Continue to Push →"}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 p-4">
        <h2
          className="text-base font-semibold mb-1"
          style={{ color: "var(--s2j-text)" }}
        >
          Test Cases
        </h2>
        <p className="text-xs mb-4" style={{ color: "var(--s2j-text-muted)" }}>
          Acceptance scenarios for every story — export to Gherkin (BDD tools) or CSV (ADO, Jama, TestRail…).
        </p>

        {/* Defensive fallback: post-#1-redesign this screen opens only WITH results (the
            Review/Confirm screen generates directly), so this branch is normally unreachable —
            kept so a BA who somehow lands here without results still has a generate path. */}
        {!testCaseResults ? (
          <GeneratePrompt storyCount={storyCount} onGenerate={onGenerate} />
        ) : (
          <>
            {isStale && <StaleBanner />}
            {tcStale && <EditStaleBanner count={tcStaleStoryIdxs.length} />}
            {tcStale && tcStaleStoryIdxs.length >= 2 && (() => {
              // T2 fix: while any affected story is regenerating, DISABLE + show progress (the button used
              // to stay live + give no feedback while the cards quietly flipped to "Generating…").
              const bulkBusy = tcStaleStoryIdxs.some((idx) => regenStates[idx] === "pending" || regenStates[idx] === "polling");
              return (
                <button
                  type="button"
                  onClick={handleRefreshAffected}
                  disabled={bulkBusy}
                  className="mb-4 text-xs px-3 py-1.5 rounded"
                  style={{
                    background: "var(--s2j-orange-bg)",
                    border: "1px solid var(--s2j-orange-border)",
                    color: bulkBusy ? "var(--s2j-text-muted)" : "var(--s2j-orange)",
                    cursor: bulkBusy ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                  title="Regenerate every story whose acceptance criteria changed — each is a paid generation (a few minutes each)"
                >
                  {bulkBusy
                    ? `⏳ Regenerating ${tcStaleStoryIdxs.length} stories…`
                    : refreshArmed
                    ? `⚠ Re-runs ${tcStaleStoryIdxs.length} affected stories (uses compute) — confirm?`
                    : `↻ Refresh ${tcStaleStoryIdxs.length} affected stories`}
                </button>
              );
            })()}
            <SummaryBar testCaseResults={testCaseResults} onRegenerate={handleRegenerate} />
            <div>
              {perStory.map((entry) => (
                <StoryTestCaseCard
                  key={entry.storyIdx}
                  entry={entry}
                  jobId={jobId}
                  isStale={tcStaleStoryIdxs.includes(entry.storyIdx)}
                  isRemoved={tcRemovedStoryIdxs.includes(entry.storyIdx)}
                  regenState={regenStates[entry.storyIdx] || "idle"}
                  onRegenerate={handleRegenerate}
                  draftResult={drafts[entry.storyIdx] || null}
                  isDirty={drafts[entry.storyIdx] !== undefined}
                  structurallyShifted={!!shiftedStories[entry.storyIdx]}
                  saveState={saveStates[entry.storyIdx] || "idle"}
                  saveError={saveErrors[entry.storyIdx] || null}
                  onCaseChange={(caseIdx, next) => handleCaseChange(entry.storyIdx, caseIdx, next)}
                  onAddCase={() => handleAddCase(entry.storyIdx)}
                  onDeleteCase={(caseIdx) => handleDeleteCase(entry.storyIdx, caseIdx)}
                  onSave={() => handleSave(entry.storyIdx)}
                  onRevert={() => handleRevert(entry.storyIdx)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default TestCasesScreen;
