import React, { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@forge/bridge";

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

// ── CaseRow ──────────────────────────────────────────────────────
// Renders a single test case: header line, concern banner, Given/When/Then,
// Expected Result, Test data, Covers list.
function CaseRow({ tc }) {
  if (!tc || typeof tc !== "object") return null;
  const type = tc.type || "happy-path";
  const priority = tc.priority;
  const title = tc.title || "Untitled";

  const typeBadgeColor = {
    "happy-path": { fg: "var(--s2j-green-dark)", bg: "var(--s2j-green-bg)", border: "var(--s2j-green-border)" },
    edge: { fg: "var(--s2j-orange)", bg: "var(--s2j-orange-bg)", border: "var(--s2j-orange-border)" },
    negative: { fg: "var(--s2j-red)", bg: "var(--s2j-red-bg)", border: "var(--s2j-red-border)" },
  }[type] || { fg: "var(--s2j-text-muted)", bg: "var(--s2j-bg-section)", border: "var(--s2j-border)" };

  const priorityBadgeColor = priority === "Critical" || priority === "High"
    ? { fg: "var(--s2j-red)", bg: "var(--s2j-red-bg)", border: "var(--s2j-red-border)" }
    : priority === "Medium"
    ? { fg: "var(--s2j-text-light)", bg: "var(--s2j-bg-section)", border: "var(--s2j-border)" }
    : priority === "Low"
    ? { fg: "var(--s2j-text-muted)", bg: "var(--s2j-bg-section)", border: "var(--s2j-border)" }
    : null;

  const given = Array.isArray(tc.given) ? tc.given.filter(Boolean) : [];
  const when = Array.isArray(tc.when) ? tc.when.filter(Boolean) : [];
  const then = Array.isArray(tc.then) ? tc.then.filter(Boolean) : [];
  const testData = Array.isArray(tc.test_data) ? tc.test_data.filter(Boolean) : [];
  const acTrace = Array.isArray(tc.ac_trace) ? tc.ac_trace.filter(Boolean) : [];

  return (
    <div
      className="rounded-lg border p-3 mb-2 text-xs"
      style={{
        background: "var(--s2j-bg)",
        border: "1px solid var(--s2j-border)",
      }}
    >
      {/* Header: type badge · [priority] · title */}
      <div className="flex items-start gap-2 mb-2 flex-wrap">
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
          style={{ background: typeBadgeColor.bg, border: `1px solid ${typeBadgeColor.border}`, color: typeBadgeColor.fg }}
        >
          @{type}
        </span>
        {priorityBadgeColor && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
            style={{ background: priorityBadgeColor.bg, border: `1px solid ${priorityBadgeColor.border}`, color: priorityBadgeColor.fg }}
          >
            {priority}
          </span>
        )}
        <span className="font-medium" style={{ color: "var(--s2j-text)" }}>
          {title}
        </span>
      </div>

      {/* Concern banner (orange, emitted AS-IS per §13 carry-forward) */}
      {tc.concern && (
        <div
          className="rounded px-2 py-1 mb-2 text-xs"
          style={{
            background: "var(--s2j-orange-bg)",
            border: "1px solid var(--s2j-orange-border)",
            color: "var(--s2j-text)",
          }}
        >
          {tc.concern}
        </div>
      )}

      {/* Given (preconditions) */}
      {given.length > 0 && (
        <div className="mb-1">
          <span className="font-semibold" style={{ color: "var(--s2j-text-muted)" }}>
            Given
          </span>
          <ul className="mt-0.5 ml-3 list-disc list-inside" style={{ color: "var(--s2j-text-light)" }}>
            {given.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}

      {/* When */}
      {when.length > 0 && (
        <div className="mb-1">
          <span className="font-semibold" style={{ color: "var(--s2j-text-muted)" }}>
            When
          </span>
          <ul className="mt-0.5 ml-3 list-disc list-inside" style={{ color: "var(--s2j-text-light)" }}>
            {when.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Then */}
      {then.length > 0 && (
        <div className="mb-1">
          <span className="font-semibold" style={{ color: "var(--s2j-text-muted)" }}>
            Then
          </span>
          <ul className="mt-0.5 ml-3 list-disc list-inside" style={{ color: "var(--s2j-text-light)" }}>
            {then.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Expected result */}
      {tc.expected_result && (
        <div className="mb-1">
          <span className="font-semibold" style={{ color: "var(--s2j-text-muted)" }}>
            Expected:{" "}
          </span>
          <em style={{ color: "var(--s2j-text)" }}>{tc.expected_result}</em>
        </div>
      )}

      {/* Test data */}
      {testData.length > 0 && (
        <div className="mb-1">
          <span className="font-semibold" style={{ color: "var(--s2j-text-muted)" }}>
            Test data:{" "}
          </span>
          <span style={{ color: "var(--s2j-text-light)" }}>{testData.join(", ")}</span>
        </div>
      )}

      {/* Covers: ac_trace */}
      {acTrace.length > 0 && (
        <div>
          <span className="font-semibold" style={{ color: "var(--s2j-text-muted)" }}>
            Covers:
          </span>
          <ul className="mt-0.5 ml-3" style={{ color: "var(--s2j-text-muted)" }}>
            {acTrace.map((t, i) => (
              <li key={i}>
                {t.kind === "inferred"
                  ? "[inferred — no authored AC]"
                  : t.kind === "shared-ac"
                  ? `[shared] ${t.ac_text || ""}`
                  : `[${t.kind || "ac"}] ${t.ac_text || ""}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
 * StoryTestCaseCard — a <details> accordion for one story's test cases.
 *
 * Props:
 *   entry        — perStory entry from getTestCases ({ storyIdx, storyName, story, result, coverage, error })
 *   jobId        — string; needed for the per-story export invoke
 *   regenState   — 'idle' | 'pending' | 'polling' | 'done' | 'error'
 *   onRegenerate — fn(storyIdx) — called when the user clicks ↻ Regenerate
 */
function StoryTestCaseCard({ entry, jobId, regenState, onRegenerate }) {
  // 'idle' | 'clipboard' | 'download' | 'failed'
  const [copyGherkinState, setCopyGherkinState] = useState("idle");
  const [copyCsvState, setCopyCsvState] = useState("idle");

  const storyIdx = entry?.storyIdx;
  const storyName = entry?.storyName || entry?.story?.name || `Story ${storyIdx}`;
  const result = entry?.result;
  const coverage = entry?.coverage;
  const hasError = !!entry?.error;
  const cases = result && Array.isArray(result.test_cases) ? result.test_cases : [];
  const isPolling = regenState === "polling" || regenState === "pending";

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

  return (
    <details
      open={isOpen}
      onToggle={(e) => setIsOpen(e.currentTarget.open)}
      className="mb-3 rounded-lg"
      style={{
        border: "1px solid var(--s2j-border)",
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
            First click: arms (button turns red "Confirm — replace cases?"); second click within 4 s fires.
            Auto-resets to idle after 4 s if the user doesn't confirm. */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isPolling) return;
            if (confirmArmed === "armed") {
              fireRegen();
            } else {
              armConfirm();
            }
          }}
          disabled={isPolling}
          className="text-[10px] px-2 py-0.5 rounded"
          style={{
            background: confirmArmed === "armed" ? "var(--s2j-red-bg)" : "none",
            border: `1px solid ${confirmArmed === "armed" ? "var(--s2j-red-border)" : "var(--s2j-border)"}`,
            color: isPolling
              ? "var(--s2j-text-muted)"
              : confirmArmed === "armed"
              ? "var(--s2j-red)"
              : "var(--s2j-blue)",
            cursor: isPolling ? "not-allowed" : "pointer",
            transition: "all 0.15s",
          }}
          title={
            isPolling
              ? "Generating…"
              : confirmArmed === "armed"
              ? "Click again to confirm — this will replace current cases"
              : "Re-generate test cases for this story"
          }
        >
          {isPolling
            ? "↻ Generating…"
            : confirmArmed === "armed"
            ? "Confirm — replace cases?"
            : "↻ Regenerate"}
        </button>
        {/* Per-story copy buttons — Fix 2: discriminated feedback, never silent */}
        {!hasError && result && (
          <>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCopyGherkin(); }}
              className="text-[10px] px-2 py-0.5 rounded"
              style={{
                background: "none",
                border: `1px solid ${copyGherkinState === "failed" ? "var(--s2j-red-border)" : "var(--s2j-border)"}`,
                color: copyGherkinState === "failed" ? "var(--s2j-red)" : "var(--s2j-text-muted)",
                cursor: "pointer",
              }}
              title="Copy Gherkin .feature for this story"
            >
              {copyGherkinState === "clipboard"
                ? "✓ Copied"
                : copyGherkinState === "download"
                ? "✓ Downloaded"
                : copyGherkinState === "failed"
                ? "Copy failed — check browser permissions"
                : "Copy Gherkin"}
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCopyCsv(); }}
              className="text-[10px] px-2 py-0.5 rounded"
              style={{
                background: "none",
                border: `1px solid ${copyCsvState === "failed" ? "var(--s2j-red-border)" : "var(--s2j-border)"}`,
                color: copyCsvState === "failed" ? "var(--s2j-red)" : "var(--s2j-text-muted)",
                cursor: "pointer",
              }}
              title="Copy CSV/manual-table for this story"
            >
              {copyCsvState === "clipboard"
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

        {/* Cases */}
        {!hasError && cases.map((tc, i) => (
          <CaseRow key={i} tc={tc} />
        ))}

        {!hasError && cases.length === 0 && !result?.no_acs && (
          <p className="text-xs" style={{ color: "var(--s2j-text-muted)" }}>
            No test cases generated. Try ↻ Regenerate.
          </p>
        )}

        {/* Fix 1: COVERAGE TRUST — render uncovered ACs + stale refs so the badge
            is actionable. The BA sees WHICH ACs are missing a test case, not just a number.
            Fields from computeCoverage: uncovered_acs (string[]), stale_refs (string[]). */}
        {!hasError && coverage && (() => {
          const uncovered = Array.isArray(coverage.uncovered_acs) ? coverage.uncovered_acs.filter(Boolean) : [];
          const stale = Array.isArray(coverage.stale_refs) ? coverage.stale_refs.filter(Boolean) : [];
          if (uncovered.length === 0 && stale.length === 0) return null;
          return (
            <div className="mt-3 flex flex-col gap-2">
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
                    ↻ Regenerate this story to attempt coverage.
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
// Props are: entry (only its storyIdx slot changes), jobId (stable), regenState (only
// the one card whose regen fired changes), onRegenerate (stable useCallback).
export default React.memo(StoryTestCaseCard);
