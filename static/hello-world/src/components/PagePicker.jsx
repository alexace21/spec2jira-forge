/**
 * PagePickerScreen — entry point post globalPage migration (2026-05-09).
 *
 * Replaces auto-binding via ctx.extension.content.id (contentAction-specific).
 * Three-path discovery surface:
 *   1. RECENT — fast path, last N selections from KVS (newest-first)
 *   2. SEARCH — title-substring across user's accessible pages (cross-space)
 *   3. MANUAL — page-ID input fallback for empty results / permission gaps
 *
 * Contract:
 *   onSelect(pageRef) — called after user confirms a choice.
 *   pageRef shape: {id, title, spaceKey, spaceName}
 *
 * Parent (App.js) is responsible for:
 *   - fetchPage to resolve canonical title (esp. for manual entry)
 *   - recordPageSelection AFTER fetchPage success (avoids polluting recent
 *     list with placeholder titles or unreachable pages)
 *
 * The picker itself does NOT call recordPageSelection — single source of
 * truth is the parent's flow гate.
 */
import React, { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@forge/bridge";
import { SignalCallout } from "./Signal";
import { IconSettings } from "./Icon";

const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_MIN_QUERY_LEN = 2;
// (multi-batch dashboard) how often the picker re-reconciles IN-FLIGHT jobs (the loop STOPS when
// none remain — see the effect). Batches take 2-10 min, so 15s is ample; bumped 10s→15s to trim
// KVS reads (the Atlassian read-throughput quota).
const DASH_POLL_MS = 15000;

// Relative age for a dashboard row ("started 4 min ago"). Frontend-only, cosmetic.
function relAge(startedAt) {
  if (!startedAt) return "";
  const ms = Date.now() - new Date(startedAt).getTime();
  if (!(ms >= 0)) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  return hr === 1 ? "1 hr ago" : `${hr} hr ago`;
}

// Atlassian Marketplace listing URL (where customers leave a review). The public
// listing isn't live until the app is approved, so this is a placeholder the partner
// sets to the real listing's reviews URL post-approval (like PRO_UPGRADE_URL).
const MARKETPLACE_REVIEW_URL = "https://marketplace.atlassian.com/";

function PagePickerScreen({ onSelect, onOpenSettings }) {
  const [recent, setRecent] = useState([]);
  const [recentLoaded, setRecentLoaded] = useState(false);
  // (multi-batch dashboard) the per-user tracked jobs (in-progress + completed + failed),
  // grouped by LIVE status in the render. Reconciled on mount + every DASH_POLL_MS while the
  // picker is open: getDashboardJobs reports current truth, then we poll each in-flight job
  // (advances batched→completed in KVS), then repaint. dashPollRef holds the interval.
  const [dashboardJobs, setDashboardJobs] = useState([]);
  const [reconciling, setReconciling] = useState(false);
  const dashPollRef = useRef(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const [showManual, setShowManual] = useState(false);
  const [manualId, setManualId] = useState("");
  const [manualError, setManualError] = useState(null);

  // ── Load recent on mount ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await invoke("getRecentPages");
        if (!cancelled) setRecent(Array.isArray(r?.recent) ? r.recent : []);
      } catch (e) {
        // Non-fatal — recent list просто won't render. Search + manual
        // fallback still work, so не error-screen on this path.
        console.error("getRecentPages failed:", e);
      } finally {
        if (!cancelled) setRecentLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Multi-batch dashboard: load + reconcile on mount, then on an interval ──
  // (multi-batch dashboard) The picker IS the dashboard. While it is open we keep the tracked
  // jobs live: read current truth, advance each in-flight job by polling it ONE at a time
  // (each its own resolver, 25s-safe — the same poll the foreground watch makes), then
  // repaint. This is what makes "fire 3 → lunch → return → see done + running" work: every
  // fired job was tracked at startGeneration and the job: records persist (no server process;
  // status only advances when a poll drives it — here, the dashboard drives it). Picker-scoped
  // by construction (this component mounts only on the picker screen), so it never fights the
  // foreground generating-screen poll, and unmount cleans the interval.
  useEffect(() => {
    const signal = { cancelled: false };
    let running = false; // guard against overlapping sweeps if one runs past DASH_POLL_MS
    // (KVS read fix) The loop exists ONLY to advance batched→completed. When no job is in-flight,
    // STOP the interval — further sweeps are pure read waste (the dominant quota leak: a picker left
    // open re-reading every 15s with nothing changing). A new job is always fired from the generating
    // screen, which unmounts the picker → a fresh mount re-evaluates + re-arms. Returns the in-flight bool.
    const stopIfIdle = (jobs) => {
      const inFlight = jobs.some((j) => j.status === "pending" || j.status === "batched");
      if (!inFlight && dashPollRef.current) {
        clearInterval(dashPollRef.current);
        dashPollRef.current = null;
      }
      return inFlight;
    };
    const loadAndReconcile = async () => {
      if (running) return;
      running = true;
      try {
        let jobs = [];
        try {
          const r = await invoke("getDashboardJobs");
          jobs = Array.isArray(r?.jobs) ? r.jobs : [];
          if (!signal.cancelled) setDashboardJobs(jobs);
        } catch (e) {
          console.error("getDashboardJobs failed (non-fatal):", e);
          return;
        }
        if (signal.cancelled) return;
        if (!stopIfIdle(jobs)) return; // nothing in-flight → interval stopped; done
        const inFlight = jobs.filter((j) => j.status === "pending" || j.status === "batched");
        if (!signal.cancelled) setReconciling(true);
        for (const j of inFlight) {
          if (signal.cancelled) return;
          try {
            await invoke("pollJobStatus", { jobId: j.jobId }); // advances KVS batched→completed
          } catch (e) {
            console.error("dashboard reconcile poll failed (non-fatal):", e);
          }
        }
        if (signal.cancelled) return;
        // Repaint with advanced statuses, and stop the interval if everything finished this sweep.
        try {
          const r2 = await invoke("getDashboardJobs");
          const jobs2 = Array.isArray(r2?.jobs) ? r2.jobs : [];
          if (!signal.cancelled) setDashboardJobs(jobs2);
          if (!signal.cancelled) stopIfIdle(jobs2);
        } catch (e) {
          console.error("getDashboardJobs (post-reconcile) failed (non-fatal):", e);
        }
      } finally {
        running = false;
        if (!signal.cancelled) setReconciling(false);
      }
    };
    // Install the interval FIRST so the initial sweep can stop it at once if nothing is in-flight.
    dashPollRef.current = setInterval(loadAndReconcile, DASH_POLL_MS);
    loadAndReconcile();
    return () => {
      signal.cancelled = true;
      clearInterval(dashPollRef.current);
    };
  }, []);

  // ── Debounced search ─────────────────────────────────────────
  // Fires SEARCH_DEBOUNCE_MS after user stops typing. Below
  // SEARCH_MIN_QUERY_LEN clears results immediately (no spurious calls).
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_QUERY_LEN) {
      setResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    setSearchError(null);

    const timer = setTimeout(async () => {
      try {
        const r = await invoke("searchPages", { query: trimmed });
        if (r?.error) {
          setSearchError(r.error);
          setResults([]);
        } else {
          setResults(Array.isArray(r?.results) ? r.results : []);
        }
      } catch (e) {
        setSearchError(`Search failed: ${e?.message || "unknown error"}`);
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  // ── Selection handlers ───────────────────────────────────────
  const handlePick = useCallback(
    (page) => {
      // Hand off to parent — parent fetchPage + recordPageSelection.
      // Picker не records here (parent owns the canonical contract).
      onSelect(page);
    },
    [onSelect],
  );

  const handleManualSubmit = useCallback(
    (e) => {
      e?.preventDefault?.();
      const id = manualId.trim();
      if (!id) {
        setManualError("Page ID is required");
        return;
      }
      if (!/^\d+$/.test(id)) {
        setManualError("Page ID must be numeric (e.g., 123456789)");
        return;
      }
      setManualError(null);
      // Manual entry: title не yet known. Parent's fetchPage will resolve
      // the canonical title before recordPageSelection fires. Pass a
      // placeholder shape that matches the contract.
      handlePick({
        id,
        title: `Page ${id}`,
        spaceKey: "",
        spaceName: "",
      });
    },
    [manualId, handlePick],
  );

  const trimmedQuery = query.trim();
  const showSearchEmpty =
    trimmedQuery.length >= SEARCH_MIN_QUERY_LEN &&
    results.length === 0 &&
    !searching &&
    !searchError;
  const showRecent = recentLoaded && recent.length > 0;
  const showInitialHint =
    recentLoaded &&
    recent.length === 0 &&
    trimmedQuery.length < SEARCH_MIN_QUERY_LEN;

  return (
    <div className="p-6" style={{ maxWidth: "720px", margin: "0 auto" }}>
      {/* Title left, Settings top-right (flex) — the in-app entry into AdminSettings,
          since the globalSettings Configure page is unreachable in the centralized admin. */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1
          className="text-xl font-semibold"
          style={{ color: "var(--s2j-text)" }}
        >
          Spec2Tickets
        </h1>
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="text-xs shrink-0"
            style={{
              background: "none",
              border: "none",
              color: "var(--s2j-text-muted)",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "4px",
            }}
            title="Open Spec2Tickets settings"
          >
            <IconSettings size={14} /> Settings
          </button>
        )}
      </div>
      <p className="text-sm mb-6" style={{ color: "var(--s2j-text-light)" }}>
        Pick a Confluence page to generate a Jira breakdown.
      </p>

      {/* ── Find a page (search + manual ID) — the primary action zone ──────────
          A visually distinct card (tinted bg + border + subtle lift) that sets the
          two ways to LOCATE a page apart from the white list rows below, and keeps
          the manual page-ID option right next to search instead of buried at the
          bottom of the screen (where it was easy to miss). 2026-06-26 UX. */}
      <div
        className="rounded-lg p-4 mb-6"
        style={{
          background: "var(--s2j-bg-section)",
          border: "1px solid var(--s2j-border)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <label
          className="block text-sm font-medium mb-2"
          style={{ color: "var(--s2j-text)" }}
        >
          Search pages
        </label>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type at least 2 characters..."
          className="w-full px-3 py-2 rounded text-sm"
          style={{
            background: "var(--s2j-bg)",
            border: "1px solid var(--s2j-border)",
            color: "var(--s2j-text)",
            outline: "none",
          }}
        />
        {searching && (
          <p
            className="text-xs mt-1"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            Searching...
          </p>
        )}
        {searchError && (
          <div
            className="rounded p-2 mt-2 text-xs"
            style={{
              background: "var(--s2j-red-bg)",
              border: "1px solid var(--s2j-red-border)",
              color: "var(--s2j-text)",
            }}
          >
            <strong style={{ color: "var(--s2j-red)" }}>Search error</strong>
            {" — "}
            {searchError}
          </div>
        )}

        {/* Manual page-ID — the second way to find a page, kept right next to search. */}
        <div
          className="mt-3 pt-3"
          style={{ borderTop: "1px solid var(--s2j-border)" }}
        >
          {!showManual ? (
            <button
              onClick={() => setShowManual(true)}
              className="text-xs"
              style={{
                color: "var(--s2j-blue)",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Or enter a page ID manually
            </button>
          ) : (
            <form onSubmit={handleManualSubmit}>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "var(--s2j-text)" }}
              >
                Manual page ID
              </label>
              <p
                className="text-xs mb-2"
                style={{ color: "var(--s2j-text-muted)" }}
              >
                Find the numeric ID in the page URL (e.g., 123456789).
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  placeholder="123456789"
                  className="flex-1 px-3 py-2 rounded text-sm"
                  style={{
                    background: "var(--s2j-bg)",
                    border: "1px solid var(--s2j-border)",
                    color: "var(--s2j-text)",
                    outline: "none",
                  }}
                />
                {/* btn-nav (blue) — follows the "blue = open/navigate to a page"
                    convention shared with the row Open buttons + the Back button. */}
                <button type="submit" className="btn-nav">
                  Open
                </button>
              </div>
              {manualError && (
                <p className="text-xs mt-2" style={{ color: "var(--s2j-red)" }}>
                  {manualError}
                </p>
              )}
            </form>
          )}
        </div>
      </div>

      {/* ── Search results ───────────────────────────────────── */}
      {results.length > 0 && (
        <div className="mb-6">
          <p
            className="text-[11px] font-medium uppercase tracking-wider mb-2"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            Results ({results.length})
          </p>
          <ul
            className="space-y-1"
            style={{ listStyle: "none", margin: 0, padding: 0 }}
          >
            {results.map((p) => (
              <PageRow
                key={`s-${p.id}`}
                page={p}
                onPick={handlePick}
              />
            ))}
          </ul>
        </div>
      )}

      {/* ── Search empty-state ──────────────────────────────── */}
      {showSearchEmpty && (
        <div
          className="rounded p-3 mb-6 text-xs"
          style={{
            background: "var(--s2j-bg-section)",
            border: "1px solid var(--s2j-border)",
            color: "var(--s2j-text-light)",
          }}
        >
          No pages found matching "{trimmedQuery}". Try a different keyword
          or use the manual page ID below.
        </div>
      )}

      {/* ── Live multi-batch dashboard (3 status groups) ──────────
          The picker IS the dashboard. Every job the user fired (tracked at startGeneration)
          shows here grouped by LIVE status, reconciled while the picker is open — so "fire 3
          → lunch → return" shows all 3 with their current state. Reuses PageRow; the row
          subtitle carries age/status. Clicking a row opens it via onSelect → the parent's
          routeByPageStatus (in-progress → generating+resume poll, completed → reviewing +
          stale-check + test-case rehydrate, failed → ready/Generate). A page may also appear
          in Recent below (different meaning) — harmless overlap, the group header disambiguates. */}
      {(() => {
        const inProgress = dashboardJobs.filter((j) => j.status === "pending" || j.status === "batched");
        const ready = dashboardJobs.filter((j) => j.status === "completed");
        const failed = dashboardJobs.filter((j) => j.status === "failed");
        const renderGroup = (title, color, jobs, prefix, subtitleFor) =>
          jobs.length === 0 ? null : (
            <div className="mb-6">
              <p
                className="text-[11px] font-medium uppercase tracking-wider mb-2"
                style={{ color }}
              >
                {title} ({jobs.length})
              </p>
              <ul className="space-y-1" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {jobs.map((j) => (
                  <PageRow
                    key={`${prefix}-${j.jobId}`}
                    page={{
                      id: j.pageId,
                      title: j.pageTitle,
                      spaceName: subtitleFor(j),
                      // Carry the row's OWN job identity so the parent routes by THIS job, not
                      // the shared page→latest index (deep-audit MED: cross-user wrong-job open).
                      jobId: j.jobId,
                      jobStatus: j.status,
                      startedAt: j.startedAt,
                    }}
                    onPick={handlePick}
                  />
                ))}
              </ul>
            </div>
          );
        return (
          <>
            {renderGroup(
              `In progress${reconciling ? " · checking…" : ""}`,
              "var(--s2j-text-muted)",
              inProgress,
              "p",
              (j) => `Generating · started ${relAge(j.startedAt) || "moments ago"}`,
            )}
            {renderGroup("Ready for review", "var(--s2j-blue)", ready, "r", () => "Completed — not yet pushed")}
            {renderGroup("Needs attention", "var(--s2j-red)", failed, "f", () => "Generation failed — reopen to retry")}
            {(inProgress.length > 0 || ready.length > 0 || failed.length > 0) && (
              <SignalCallout kind="error" fontSize={12} style={{ marginBottom: 16 }}>
                {/* Task #13: honest cleanup notice — matches the scheduled orphan sweep
                    (7-day inactivity) + the privacy/DPA disclosure (no over-claim). RED
                    (kind="error", partner UX 2026-06-26): this warns of irreversible
                    auto-removal, so it must read as IMPORTANT, not neutral info. */}
                Generated breakdowns you don't push to Jira are automatically removed after
                7 days of inactivity. Opening one resets its timer.
              </SignalCallout>
            )}
          </>
        );
      })()}

      {/* ── Recent list ──────────────────────────────────────── */}
      {showRecent && (
        <div className="mb-6">
          <p
            className="text-[11px] font-medium uppercase tracking-wider mb-2"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            Recent
          </p>
          <ul
            className="space-y-1"
            style={{ listStyle: "none", margin: 0, padding: 0 }}
          >
            {recent.map((p) => (
              <PageRow
                key={`r-${p.id}`}
                page={p}
                onPick={handlePick}
              />
            ))}
          </ul>
        </div>
      )}

      {/* ── Manual page-ID fallback moved UP into the "Find a page" card (2026-06-26 UX);
          it used to sit here at the bottom where users lost it. ── */}

      {/* ── First-run hint (no recent + no search) ───────────── */}
      {showInitialHint && (
        <p
          className="text-xs mt-4 text-center"
          style={{ color: "var(--s2j-text-muted)" }}
        >
          Start typing above to search, or paste a page ID to begin.
        </p>
      )}

      {/* ── Feedback / review nudge ─────────────────────────────
          Gentle prompt to report bugs (support email) or leave a Marketplace review
          — drives the feedback loop + adoption (reviews lift the listing). The review
          link is wired post-approval (the public listing isn't live yet). */}
      <div
        className="mt-10 rounded-lg p-4 text-sm leading-relaxed"
        style={{
          background: "var(--s2j-bg-section)",
          border: "1px solid var(--s2j-border)",
          color: "var(--s2j-text-light)",
        }}
      >
        <span className="font-semibold" style={{ color: "var(--s2j-text)" }}>
          Help us keep improving Spec2Tickets.
        </span>{" "}
        Found a bug or have an idea? Email{" "}
        <a href="mailto:support@spec2jira.com" style={{ color: "var(--s2j-blue)" }}>
          support@spec2jira.com
        </a>{" "}
        — we read every message. Enjoying it?{" "}
        <a
          href={MARKETPLACE_REVIEW_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--s2j-blue)" }}
        >
          Leave a quick review
        </a>{" "}
        on the Atlassian Marketplace — it takes a minute and helps other teams find
        us.
      </div>
    </div>
  );
}

/**
 * PageRow — single page list item shared by search results AND recent list.
 * Click (title area) triggers onPick(page) → editor flow.
 *
 * (The legacy CG-12 secondary "Dashboard" button was removed 2026-05-31 — the
 * standalone manager dashboard surface was obsolete and misled users on the
 * picker; quality signals now live inline on the Review screen.)
 */
function PageRow({ page, onPick }) {
  return (
    <li>
      <div
        className="flex items-stretch rounded text-sm s2j-page-row"
        style={{
          background: "var(--s2j-bg)",
          border: "1px solid var(--s2j-border)",
          overflow: "hidden",
        }}
      >
        <button
          onClick={() => onPick(page)}
          className="flex-1 text-left px-3 py-2"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--s2j-text)",
            cursor: "pointer",
            outline: "none",
            minWidth: 0,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--s2j-bg-section)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          title="Open this page to create or resume a breakdown"
        >
          <div className="font-medium leading-tight">{page.title}</div>
          {page.spaceName && (
            <div
              className="text-xs mt-0.5"
              style={{ color: "var(--s2j-text-muted)" }}
            >
              {page.spaceName}
            </div>
          )}
        </button>
        {/* Explicit "Open" CTA (2026-06-26 UX) — a blue block on the right of every row
            (search results, dashboard groups, recent) so the open affordance is obvious,
            not implied by a clickable row. Same action as the title button (onPick). Blue
            reuses --s2j-blue (the "Ready for review" header colour). */}
        <button
          onClick={() => onPick(page)}
          className="shrink-0 flex items-center justify-center px-4 text-sm font-semibold"
          style={{
            background: "var(--s2j-blue)",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            outline: "none",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--s2j-blue-dark)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--s2j-blue)")}
          title="Open this page"
          aria-label={`Open ${page.title}`}
        >
          Open
        </button>
      </div>
    </li>
  );
}

export default PagePickerScreen;
