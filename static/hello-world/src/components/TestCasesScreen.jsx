import React, { useState, useCallback } from "react";
import { invoke } from "@forge/bridge";
import BackButton from "./BackButton";
import StoryTestCaseCard from "./StoryTestCaseCard";

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
function ExportBar({ jobId }) {
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
 *   onBack            — fn() → reviewing screen (does NOT clear testCaseResults)
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
  onBack,
  onPush,
  onGenerate,
  onRegenerate,
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
        <BackButton onClick={onBack} className="" label="Back to Review" />
        <span
          className="text-[11px]"
          style={{ color: "var(--s2j-text-muted)" }}
        >
          {pageTitle || "(test cases)"}
        </span>

        {/* Export bar — only shown when results exist */}
        {testCaseResults && jobId && <ExportBar jobId={jobId} />}

        {/* Continue to Push */}
        <button
          type="button"
          onClick={() => onPush?.(breakdown)}
          className="btn-primary text-xs shrink-0"
          style={{ marginLeft: testCaseResults ? "0" : "auto", whiteSpace: "nowrap" }}
        >
          Continue to Push →
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

        {!testCaseResults ? (
          <GeneratePrompt storyCount={storyCount} onGenerate={onGenerate} />
        ) : (
          <>
            {isStale && <StaleBanner />}
            <SummaryBar testCaseResults={testCaseResults} onRegenerate={onRegenerate} />
            <div>
              {perStory.map((entry) => (
                <StoryTestCaseCard
                  key={entry.storyIdx}
                  entry={entry}
                  jobId={jobId}
                  regenState={regenStates[entry.storyIdx] || "idle"}
                  onRegenerate={onRegenerate}
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
