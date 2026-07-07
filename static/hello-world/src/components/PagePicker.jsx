/**
 * PagePickerScreen — the app home + mission-control for a PO/BA (redesign 2026-07).
 *
 * Replaces auto-binding via ctx.extension.content.id (contentAction-specific).
 * Two jobs on one screen:
 *   A) MISSION CONTROL — the per-user tracked jobs (in-flight + ready + failed) as a
 *      "work in flight" banner + count tiles + filter chips + a dense work LEDGER, so a
 *      user who fired several breakdowns and left can come back, see current truth, and
 *      RESUME (never pay to regenerate). Reconciled live while the picker is open.
 *   B) FIND ZONE — start something new: permanent onboarding steps + search + recent +
 *      the manual page-ID path.
 *
 * Contract:
 *   onSelect(pageRef) — called after the user confirms a choice.
 *   pageRef shape: {id, title, spaceKey, spaceName} (+ jobId/jobStatus/startedAt for
 *     a ledger row, so the parent routes by the row's OWN job, not the page→latest index).
 *
 * Parent (App.js) is responsible for:
 *   - fetchPage to resolve canonical title (esp. for manual entry)
 *   - recordPageSelection AFTER fetchPage success (avoids polluting recent
 *     list with placeholder titles or unreachable pages)
 *   - routeByPageStatus (in-progress → generating+resume poll, completed → reviewing,
 *     failed → ready/Generate).
 *
 * The picker itself does NOT call recordPageSelection — single source of
 * truth is the parent's flow gate.
 *
 * INVARIANTS (design-locked — see docs page-picker-impl-spec + [[ui-button-color-convention]]):
 *   - Every ACTION button on this screen is BLUE (.btn-nav): Open / Reopen / Resume / Retry.
 *     Nothing is committed here → NO green and NO red buttons. RED is a danger SIGNAL only
 *     (failed icon), AMBER is caution (expiring soon), STEEL is the "Truncated" quality caveat,
 *     GREEN is a success glyph/text only (ready check, "no work in flight").
 *   - NO tier labels (T0/T1/T2) in the shipped UI.
 *   - Forge iframe = page-scroll. No 100vh, no internal VERTICAL scroll trap. The ledger is
 *     grid ROWS that grow the page (a wide row may scroll HORIZONTALLY only).
 *   - Colour is never the only signal — every status has an icon + a text label.
 */
import React, { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@forge/bridge";
import { SignalCallout, SignalIcon } from "./Signal";
import { IconSettings, IconSearch, IconClock, IconCopy } from "./Icon";
import { MoodCard, TYPE, MOOD, GAP, glassSurface, formFieldStyle } from "./moodboard";

const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_MIN_QUERY_LEN = 2;
// (multi-batch dashboard) how often the picker re-reconciles IN-FLIGHT jobs (the loop STOPS when
// none remain — see the effect). Batches take 2-10 min, so 15s is ample; bumped 10s→15s to trim
// KVS reads (the Atlassian read-throughput quota).
const DASH_POLL_MS = 15000;

// The 7-day retention window (must mirror the backend orphan-sweep ORPHAN_INACTIVITY_MS). A ready
// job's expiry = lastAccessedAt + KEEP_MS; opening it resets lastAccessedAt (the timer).
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
// A ready job within this window of expiry is "expiring soon" → amber caution.
const EXPIRY_WARN_MS = 48 * 60 * 60 * 1000;

// Atlassian Marketplace listing URL (where customers leave a review). The public
// listing isn't live until the app is approved, so this is a placeholder the partner
// sets to the real listing's reviews URL post-approval (like PRO_UPGRADE_URL).
const MARKETPLACE_REVIEW_URL = "https://marketplace.atlassian.com/";

// ── Local inline-SVG glyphs the shared Icon.jsx set doesn't carry (kept minimal, same 24×24 /
// stroke=currentColor contract as Icon.jsx so they inherit colour + size cleanly). ──

// Heartbeat / activity — the "work in flight" pulse (banner + running tile).
function ActivityGlyph({ size = 16, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false"
      style={{ display: "block", ...style }}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

// Spinner — a partial-ring that rotates (CSS keyframe). Used for RUNNING/generating status.
function SpinnerGlyph({ size = 16, title, style }) {
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true, focusable: false };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ display: "block", ...style }} {...a11y}>
      {title ? <title>{title}</title> : null}
      {/* SMIL rotate — a reliable in-place spin in the Forge iframe regardless of CSS transform-box
          quirks AND independent of prefers-reduced-motion (the CSS-class spin read as frozen live,
          twice; the partner wants the motion). The <g> is the animated target; rotation pivots on
          the 24×24 viewBox centre (12,12). */}
      <g>
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        <animateTransform attributeName="transform" attributeType="XML" type="rotate"
          from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
      </g>
    </svg>
  );
}

// Diamond — the "needs attention" severity marker (distinct from the red triangle used for the
// boxed error tone; a solid diamond reads as a discrete alert token in a chip/tile).
function DiamondGlyph({ size = 14, title, style }) {
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true, focusable: false };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ display: "block", ...style }} {...a11y}>
      {title ? <title>{title}</title> : null}
      {/* alert diamond — a solid rhombus (fills with currentColor) + a white exclamation, to match
          the Claude Design "needs attention" glyph; a plain diamond didn't read as an alert. */}
      <path d="M12 2 22 12 12 22 2 12z" fill="currentColor" />
      <line x1="12" y1="7.5" x2="12" y2="13" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="16.5" x2="12.01" y2="16.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ── time helpers ─────────────────────────────────────────────────────
// Relative age for a dashboard/recent row ("started 4 min ago"). Frontend-only, cosmetic.
function relAge(startedAt) {
  if (!startedAt) return "";
  const t = typeof startedAt === "number" ? startedAt : new Date(startedAt).getTime();
  const ms = Date.now() - t;
  if (!(ms >= 0)) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? "1 hr ago" : `${hr} hr ago`;
  const d = Math.floor(hr / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

// A short calendar date "Jul 3" for "edited {date}" on search hits.
function shortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Compute a ready job's expiry facts from lastAccessedAt (epoch ms). Legacy jobs with a null
// lastAccessedAt → { expiresAt:null } so the UI shows NO expiry (graceful).
function expiryOf(job) {
  const la = job?.lastAccessedAt;
  if (typeof la !== "number" || !(la > 0)) return { expiresAt: null, remainingMs: null, expiring: false };
  const expiresAt = la + KEEP_MS;
  const remainingMs = expiresAt - Date.now();
  // expiring = inside the warn window OR ALREADY PAST expiry (remainingMs <= 0) but not yet swept.
  // An overdue ready job must read as at-risk (amber / high urgency), never as calm "Kept 7 days". (review fix)
  return { expiresAt, remainingMs, expiring: remainingMs < EXPIRY_WARN_MS };
}

// "Expires in 6h" / "Expires in <1h". Only used when expiring is true.
function expiresInLabel(remainingMs) {
  if (typeof remainingMs !== "number") return "";
  if (remainingMs <= 0) return "Expires any moment"; // already past 7d, awaiting the daily sweep
  const hrs = Math.floor(remainingMs / (60 * 60 * 1000));
  if (hrs < 1) return "Expires in <1h";
  return `Expires in ${hrs}h`;
}

// A short space chip label from a recent/search page: prefer spaceKey, else the first letters of
// spaceName (e.g. "Product Requirements" → "PR"), else "—".
function spaceChipLabel(page) {
  if (page?.spaceKey) return String(page.spaceKey).toUpperCase().slice(0, 6);
  const name = page?.spaceName;
  if (name) {
    const letters = name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase();
    if (letters) return letters.slice(0, 4);
    return name.toUpperCase().slice(0, 4);
  }
  return "—";
}

function PagePickerScreen({ onSelect, onOpenSettings }) {
  const [recent, setRecent] = useState([]);
  const [recentLoaded, setRecentLoaded] = useState(false);
  const [recentDegraded, setRecentDegraded] = useState(false);
  // (multi-batch dashboard) the per-user tracked jobs (in-progress + completed + failed),
  // grouped by LIVE status in the render. Reconciled on mount + every DASH_POLL_MS while the
  // picker is open: getDashboardJobs reports current truth, then we poll each in-flight job
  // (advances batched→completed in KVS), then repaint. dashPollRef holds the interval.
  const [dashboardJobs, setDashboardJobs] = useState([]);
  const [dashLoaded, setDashLoaded] = useState(false);
  const [dashDegraded, setDashDegraded] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const dashPollRef = useRef(null);
  const armLoopRef = useRef(null); // holds the loop's re-arming trigger (used by "Retry now")

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);      // terse error
  const [searchErrorDetail, setSearchErrorDetail] = useState(null); // actionable detail

  const [showManual, setShowManual] = useState(false);
  const [manualId, setManualId] = useState("");
  const [manualError, setManualError] = useState(null);

  // The active work-ledger filter chip ("all" | "attention" | "expiring" | "running" | "ready").
  const [filter, setFilter] = useState("all");

  // ── Load recent on mount ─────────────────────────────────────
  const loadRecent = useCallback(async () => {
    try {
      const r = await invoke("getRecentPages");
      setRecent(Array.isArray(r?.recent) ? r.recent : []);
      setRecentDegraded(!!r?.degraded);
    } catch (e) {
      // Non-fatal — recent list просто won't render. Search + manual fallback still work.
      // Distinguish "couldn't load" from "none": a throw is a degraded read, not empty.
      console.error("getRecentPages failed:", e);
      setRecent([]);
      setRecentDegraded(true);
    } finally {
      setRecentLoaded(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await loadRecent();
    })();
    return () => { cancelled = true; };
  }, [loadRecent]);

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
          if (!signal.cancelled) {
            setDashboardJobs(jobs);
            setDashDegraded(!!r?.degraded);
            setDashLoaded(true);
          }
        } catch (e) {
          // A throw is a DEGRADED read — surface it (never let a failed read read as calm-empty).
          console.error("getDashboardJobs failed (non-fatal):", e);
          if (!signal.cancelled) {
            setDashDegraded(true);
            setDashLoaded(true);
          }
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
          if (!signal.cancelled) {
            setDashboardJobs(jobs2);
            setDashDegraded(!!r2?.degraded);
          }
          if (!signal.cancelled) stopIfIdle(jobs2);
        } catch (e) {
          console.error("getDashboardJobs (post-reconcile) failed (non-fatal):", e);
        }
      } finally {
        running = false;
        if (!signal.cancelled) setReconciling(false);
      }
    };
    // Expose a re-arm trigger for the "Retry now" button (degraded read): re-install the interval
    // if it was stopped, then re-run a sweep. Safe to call while running (the `running` guard).
    armLoopRef.current = () => {
      if (signal.cancelled) return;
      if (!dashPollRef.current) dashPollRef.current = setInterval(loadAndReconcile, DASH_POLL_MS);
      loadAndReconcile();
    };
    // Install the interval FIRST so the initial sweep can stop it at once if nothing is in-flight.
    dashPollRef.current = setInterval(loadAndReconcile, DASH_POLL_MS);
    loadAndReconcile();
    return () => {
      signal.cancelled = true;
      armLoopRef.current = null;
      clearInterval(dashPollRef.current);
      dashPollRef.current = null;
    };
  }, []);

  const retryDashboard = useCallback(() => {
    setDashDegraded(false);
    if (armLoopRef.current) armLoopRef.current();
  }, []);

  // ── Debounced search ─────────────────────────────────────────
  // Fires SEARCH_DEBOUNCE_MS after user stops typing. Below
  // SEARCH_MIN_QUERY_LEN clears results immediately (no spurious calls).
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_QUERY_LEN) {
      setResults([]);
      setSearchError(null);
      setSearchErrorDetail(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    setSearchError(null);
    setSearchErrorDetail(null);

    const timer = setTimeout(async () => {
      try {
        const r = await invoke("searchPages", { query: trimmed });
        if (r?.error) {
          setSearchError(r.error);
          setSearchErrorDetail(r.detail || null);
          setResults([]);
        } else {
          setResults(Array.isArray(r?.results) ? r.results : []);
        }
      } catch (e) {
        setSearchError(`Search failed: ${e?.message || "unknown error"}`);
        setSearchErrorDetail(null);
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  // If the active filter's category empties during the live reconcile, fall back to "all" so the
  // ledger never shows blank with no active chip. (deep-audit fix)
  useEffect(() => {
    if (filter === "all" || dashboardJobs.length === 0) return;
    const cnt = dashboardJobs.filter((j) => {
      if (filter === "attention") return j.status === "failed";
      if (filter === "running") return j.status === "pending" || j.status === "batched";
      if (filter === "ready") return j.status === "completed";
      if (filter === "expiring") return j.status === "completed" && expiryOf(j).expiring;
      return true;
    }).length;
    if (cnt === 0) setFilter("all");
  }, [filter, dashboardJobs]);

  // ── Selection handlers ───────────────────────────────────────
  const handlePick = useCallback(
    (page) => {
      // Hand off to parent — parent fetchPage + recordPageSelection.
      // Picker не records here (parent owns the canonical contract).
      onSelect(page);
    },
    [onSelect],
  );

  // Open an existing job by identity (route-by-own-job). Used by the ledger, the resume-guard
  // on search hits, and "↑ shown above" recent annotations.
  const openJob = useCallback(
    (job) => {
      handlePick({
        id: job.pageId,
        title: job.pageTitle,
        spaceKey: "",
        spaceName: "",
        jobId: job.jobId,
        jobStatus: job.status,
        startedAt: job.startedAt,
      });
    },
    [handlePick],
  );

  const handleManualSubmit = useCallback(
    (e) => {
      e?.preventDefault?.();
      const id = manualId.trim();
      if (!id) {
        setManualError("Page ID is required.");
        return;
      }
      if (!/^\d+$/.test(id)) {
        setManualError("Page ID must be numeric (e.g. 262145).");
        return;
      }
      setManualError(null);
      // Manual entry: title не yet known. Parent's fetchPage will resolve
      // the canonical title before recordPageSelection fires. Pass a
      // placeholder shape that matches the contract.
      handlePick({ id, title: `Page ${id}`, spaceKey: "", spaceName: "" });
    },
    [manualId, handlePick],
  );

  // ── Derived job partitions + counts (T1 — derivable from dashboardJobs) ──
  const running = dashboardJobs.filter((j) => j.status === "pending" || j.status === "batched");
  const ready = dashboardJobs.filter((j) => j.status === "completed");
  const failed = dashboardJobs.filter((j) => j.status === "failed");
  const readyWithExpiry = ready.map((j) => ({ job: j, ...expiryOf(j) }));
  const expiringReady = readyWithExpiry.filter((x) => x.expiring);
  const R = running.length;
  const Y = ready.length;
  const F = failed.length;
  const E = expiringReady.length;
  const N = dashboardJobs.length;
  const hasWork = N > 0;

  // The soonest-expiring ready job (for the banner expiry callout).
  const soonestExpiring = expiringReady
    .slice()
    .sort((a, b) => (a.remainingMs || 0) - (b.remainingMs || 0))[0];

  // Build ledger rows (job + urgency + sort key), then apply the active filter.
  // SORT: Failed → Expiring(ready<48h) → Generating → Ready(recent first).
  const ledgerRows = dashboardJobs.map((j) => {
    const exp = expiryOf(j);
    let urgency; // for sort + left-accent
    if (j.status === "failed") urgency = 0;
    else if (j.status === "completed" && exp.expiring) urgency = 1;
    else if (j.status === "pending" || j.status === "batched") urgency = 2;
    else urgency = 3; // ready, not expiring
    return { job: j, exp, urgency };
  });
  const recencyOf = (j) =>
    (typeof j.completedAt === "number" ? j.completedAt : 0) ||
    (j.startedAt ? new Date(j.startedAt).getTime() : 0);
  ledgerRows.sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency - b.urgency;
    return recencyOf(b.job) - recencyOf(a.job); // recent first within a bucket
  });
  const filteredRows = ledgerRows.filter(({ job, exp }) => {
    if (filter === "all") return true;
    if (filter === "attention") return job.status === "failed";
    if (filter === "expiring") return job.status === "completed" && exp.expiring;
    if (filter === "running") return job.status === "pending" || job.status === "batched";
    if (filter === "ready") return job.status === "completed";
    return true;
  });

  // Cross-match pageId → the job that owns it (for the resume guard + recent annotations).
  const jobByPageId = new Map();
  for (const j of dashboardJobs) {
    // Prefer a non-terminal/most-relevant job; keep the first (dashboard order is fine for a hint).
    if (!jobByPageId.has(j.pageId)) jobByPageId.set(j.pageId, j);
  }

  // ── Search / recent visibility ───────────────────────────────
  const trimmedQuery = query.trim();
  const searchActive = trimmedQuery.length >= SEARCH_MIN_QUERY_LEN;
  const showSearchEmpty = searchActive && results.length === 0 && !searching && !searchError;
  const showRecent = recentLoaded && recent.length > 0;

  // TRUE first run = no work AND no recent (once both reads have settled). Per spec, nothing implies
  // loss here → render NOTHING in the work section (no calm "no work" strip, no divider): the Find
  // zone is the whole screen. The calm "No work in flight" strip is reserved for the find-only state
  // (has recent history, nothing in flight) where "nothing at risk" is a meaningful reassurance.
  // TRUE first run requires BOTH reads settled AND the recent read NOT degraded (a failed recent read
  // is not a first run — the user may have history we couldn't load). Gating on both-settled also kills
  // the flash where the calm strip briefly renders before recent resolves. (deep-audit fix)
  const bothLoaded = dashLoaded && recentLoaded;
  const firstRun = bothLoaded && !hasWork && !dashDegraded && !recentDegraded && recent.length === 0;
  // Does the work section render anything above the divider?
  const workSectionRenders = dashDegraded || hasWork || (bothLoaded && !firstRun);

  return (
    <div className="p-6" style={{ maxWidth: "820px", margin: "0 auto" }}>
      {/* ── Header: wordmark + subtitle (left), Settings (right) ── */}
      <div className="flex items-start justify-between gap-3 mb-1">
        {/* app-root navy wordmark (kept as <h1>: this is the top-level home). */}
        <h1 style={{ ...TYPE.title, fontSize: 22, color: MOOD.navy }}>Spec2Tickets</h1>
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
              borderRadius: 6,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
            title="Open Spec2Tickets settings"
          >
            <IconSettings size={14} /> Settings
          </button>
        )}
      </div>
      <p className="text-sm" style={{ color: "var(--s2j-text-light)", marginBottom: GAP.section }}>
        Pick a Confluence page to generate a Jira breakdown.
      </p>

      {/* ══ WORK SECTION ══ — mission control (banner + chips + ledger), OR the degraded/calm strip. */}
      {dashDegraded ? (
        <DegradedWorkCallout onRetry={retryDashboard} />
      ) : hasWork ? (
        <>
          <MissionControlBanner
            R={R}
            Y={Y}
            F={F}
            reconciling={reconciling}
            soonestExpiring={soonestExpiring}
            expiringCount={E}
          />
          <FilterChips
            filter={filter}
            setFilter={setFilter}
            counts={{ all: N, attention: F, expiring: E, running: R, ready: Y }}
          />
          <WorkLedger rows={filteredRows} onOpen={openJob} />
        </>
      ) : bothLoaded && !firstRun ? (
        <NoWorkStrip />
      ) : null}

      {/* ── Divider between "your work" and "find something new" — only when the work section rendered
          something (suppressed on true first-run so a stray line doesn't sit above the Find zone). ── */}
      {workSectionRenders && (
        <div style={{ height: 1, background: "var(--s2j-border)", margin: `${GAP.section}px 0` }} />
      )}
      {!workSectionRenders && <div style={{ height: GAP.tight }} />}

      {/* ══ FIND ZONE ══ */}
      <div className="flex items-center" style={{ gap: 8, marginBottom: 6 }}>
        <span style={{ color: "var(--s2j-blue)", display: "inline-flex" }}>
          <IconSearch size={18} />
        </span>
        <h2 style={{ ...TYPE.title, fontSize: 18, color: MOOD.navy }}>
          Find a page to start something new
        </h2>
      </div>

      {/* PERMANENT onboarding steps (G1 essence, minus BYOK). Always present. */}
      <OnboardingSteps />

      {/* Search card + collapsible manual page-ID sub-form */}
      <MoodCard density="minor" style={{ marginBottom: GAP.section }}>
        <label htmlFor="pp-search-input" className="block text-sm font-medium mb-2" style={{ color: "var(--s2j-text)" }}>
          Search Confluence pages by title
        </label>
        <input
          id="pp-search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type at least 2 characters…"
          className="s2j-field"
          style={{ ...formFieldStyle }}
        />

        {/* G4 search sub-states */}
        {searching && (
          <p className="text-xs mt-2 flex items-center" style={{ color: "var(--s2j-text-muted)", gap: 6 }}>
            <SpinnerGlyph size={13} /> Searching…
          </p>
        )}
        {searchError && (
          <SignalCallout kind="error" title={searchError} style={{ marginTop: 8 }} fontSize={12}>
            {searchErrorDetail || "Try a different keyword, or use the manual page ID below."}
          </SignalCallout>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p className="text-[11px] font-medium uppercase tracking-wider mb-2"
              style={{ color: "var(--s2j-text-muted)" }}>
              Results ({results.length})
            </p>
            <ul className="space-y-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {results.map((p) => (
                <SearchResultRow
                  key={`s-${p.id}`}
                  page={p}
                  existingJob={jobByPageId.get(p.id)}
                  onPick={handlePick}
                  onOpenJob={openJob}
                />
              ))}
            </ul>
          </div>
        )}

        {/* Empty */}
        {showSearchEmpty && (
          <div
            style={{
              ...glassSurface("utility"),
              padding: "10px 12px",
              marginTop: 12,
            }}
          >
            <p style={{ ...TYPE.micro }}>
              No pages found matching "{trimmedQuery}". Try a different keyword or the manual page ID below.
            </p>
          </div>
        )}

        {/* Manual page-ID — the second way to find a page, kept right next to search. */}
        <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--s2j-border)" }}>
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
              <label htmlFor="pp-manual-id" className="block text-sm font-medium mb-1" style={{ color: "var(--s2j-text)" }}>
                Manual page ID
              </label>
              <p className="text-xs mb-2" style={{ color: "var(--s2j-text-muted)" }}>
                Find the numeric ID in the page URL (e.g. 262145).
              </p>
              <div className="flex gap-2">
                <input
                  id="pp-manual-id"
                  type="text"
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  placeholder="262145"
                  className="s2j-field"
                  style={{ ...formFieldStyle, flex: 1 }}
                />
                {/* btn-nav (blue) — "open / navigate to a page" convention. */}
                <button type="submit" className="btn-nav">Open</button>
              </div>
              {manualError && (
                <p className="text-xs mt-2 flex items-center" style={{ color: "var(--s2j-red)", gap: 6 }}>
                  <SignalIcon kind="error" size={13} /> {manualError}
                </p>
              )}
            </form>
          )}
        </div>
      </MoodCard>

      {/* RECENT list */}
      {recentDegraded && recentLoaded && (
        <SignalCallout kind="warning" style={{ marginBottom: GAP.section }} fontSize={12}>
          Couldn’t load recent pages just now.{" "}
          <button
            type="button"
            onClick={loadRecent}
            style={{
              color: "var(--s2j-blue)",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              textDecoration: "underline",
              font: "inherit",
            }}
          >
            Retry
          </button>
          .
        </SignalCallout>
      )}
      {showRecent && (
        <div style={{ marginBottom: GAP.section }}>
          <p className="text-[11px] font-medium uppercase tracking-wider mb-2"
            style={{ color: "var(--s2j-text-muted)" }}>
            Recent ({recent.length})
          </p>
          <ul className="space-y-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {recent.map((p) => (
              <RecentRow key={`r-${p.id}`} page={p} existingJob={jobByPageId.get(p.id)} onPick={handlePick} onOpenJob={openJob} />
            ))}
          </ul>
        </div>
      )}

      {/* ── Feedback / review nudge ── */}
      <MoodCard density="minor" style={{ marginTop: 40 }}>
        <p className="text-sm leading-relaxed" style={{ color: "var(--s2j-text-light)" }}>
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
          on the Atlassian Marketplace — it takes a minute and helps other teams find us.
        </p>
      </MoodCard>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Mission-control banner (from 3A) — a glass MoodCard, only when work exists.
// ════════════════════════════════════════════════════════════════════
function MissionControlBanner({ R, Y, F, reconciling, soonestExpiring, expiringCount }) {
  // Sub-line: drop a clause when its count is 0; keep the "Resume it…" tail when Y>0.
  const segs = [];
  if (R > 0) segs.push(`${R} generating`);
  if (Y > 0) segs.push(`${Y} ready to review`);
  if (F > 0) segs.push(`${F} needs attention`);
  let subline = segs.join(" · ");
  if (Y > 0) subline = subline ? `${subline}. Resume it — don’t pay to regenerate.` : "";

  return (
    <MoodCard density="major" style={{ marginBottom: GAP.card }}>
      {/* Top row */}
      <div className="flex items-center" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div className="flex items-center" style={{ gap: 10 }}>
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "var(--s2j-bg-section)",
              border: "1px solid var(--s2j-border)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: MOOD.steel,
              flexShrink: 0,
            }}
          >
            <ActivityGlyph size={17} />
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, color: MOOD.navy }}>
            You have work in flight
          </span>
        </div>
        {reconciling && (
          <span
            className="flex items-center"
            style={{
              gap: 6,
              fontSize: 11.5,
              color: "var(--s2j-text-muted)",
              background: "var(--s2j-bg-section)",
              border: "1px solid var(--s2j-border)",
              borderRadius: 999,
              padding: "3px 10px",
            }}
          >
            <SpinnerGlyph size={12} /> Checking for updates…
          </span>
        )}
      </div>

      {/* Sub-line */}
      {subline && (
        <p style={{ ...TYPE.sub, marginTop: 8 }}>{subline}</p>
      )}

      {/* Three count TILES */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginTop: 14,
        }}
      >
        <CountTile
          label="RUNNING"
          value={R}
          sub="generating now · 2–10 min typical"
          topRight={<SpinnerGlyph size={16} title="generating" style={{ color: MOOD.steel }} />}
        />
        <CountTile
          label="READY TO REVIEW"
          value={Y}
          sub="paid & waiting · kept 7 days"
          topRight={<SignalIcon kind="success" size={16} title="ready" />}
        />
        <CountTile
          label="NEEDS ATTENTION"
          value={F}
          sub="failed — reason inside"
          topRight={<DiamondGlyph size={17} title="needs attention" style={{ color: "var(--s2j-red)" }} />}
        />
      </div>

      {/* Expiry callout — only when ≥1 ready job is <48h from expiry. */}
      {soonestExpiring && (() => {
        // Lead with the explicit time-to-expiry (spec wording), robust to an already-past job.
        const rm = soonestExpiring.remainingMs;
        const hrs = Math.floor(rm / (60 * 60 * 1000));
        const when = rm <= 0 ? "any moment now" : hrs < 1 ? "in under an hour" : `in ${hrs}h`;
        return (
          <SignalCallout kind="warning" style={{ marginTop: 14 }} fontSize={12.5}>
            {expiringCount} result{expiringCount === 1 ? "" : "s"}{" "}
            {expiringCount === 1 ? "expires" : "expire"} {when}.{" "}
            <strong>"{soonestExpiring.job.pageTitle}"</strong> will be auto-deleted — open it to keep it
            (opening resets the 7-day timer).
          </SignalCallout>
        );
      })()}

      {/* Micro caption */}
      <p style={{ ...TYPE.micro, marginTop: 12 }}>
        Live · re-checks every 15s while work is running, then stops. Only you see your jobs.
      </p>
    </MoodCard>
  );
}

function CountTile({ label, value, sub, topRight }) {
  return (
    <div
      style={{
        background: "var(--s2j-bg-section)",
        border: "1px solid var(--s2j-border)",
        borderRadius: 12,
        padding: 15,
      }}
    >
      <div className="flex items-start" style={{ justifyContent: "space-between", gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: "var(--s2j-text-muted)",
          }}
        >
          {label}
        </span>
        <span style={{ display: "inline-flex", marginTop: 1 }}>{topRight}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: MOOD.navy, lineHeight: 1.1, marginTop: 6 }}>
        {value}
      </div>
      <div style={{ ...TYPE.micro, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Filter chips (from 3B) — a row under the banner.
// ════════════════════════════════════════════════════════════════════
function FilterChips({ filter, setFilter, counts }) {
  // Category chips: only shown when their count > 0 (keep the row clean). "All" is always present.
  const cats = [
    { key: "attention", label: "Needs attention", count: counts.attention,
      glyph: <DiamondGlyph size={12} style={{ color: "var(--s2j-red)" }} /> },
    { key: "expiring", label: "Expiring", count: counts.expiring,
      glyph: <IconClock size={13} style={{ color: "var(--s2j-orange)" }} /> },
    { key: "running", label: "Running", count: counts.running,
      glyph: <SpinnerGlyph size={13} style={{ color: MOOD.steel }} /> },
    { key: "ready", label: "Ready", count: counts.ready,
      glyph: <SignalIcon kind="success" size={13} /> },
  ].filter((c) => c.count > 0);

  const Chip = ({ ck, label, count, glyph }) => {
    const active = filter === ck;
    return (
      <button
        type="button"
        onClick={() => setFilter(ck)}
        aria-pressed={active}
        className="flex items-center"
        style={{
          gap: 6,
          fontSize: 12.5,
          fontWeight: 600,
          padding: "5px 12px",
          borderRadius: 999,
          cursor: "pointer",
          border: active ? "1px solid var(--s2j-navy)" : "1px solid var(--s2j-border)",
          background: active ? "var(--s2j-navy)" : "var(--s2j-bg-section)",
          color: active ? "#fff" : "var(--s2j-text-light)",
        }}
      >
        {glyph ? <span style={{ display: "inline-flex" }}>{glyph}</span> : null}
        {label} {count != null ? count : null}
      </button>
    );
  };

  return (
    <div
      className="flex items-center"
      style={{ gap: 8, flexWrap: "wrap", marginBottom: GAP.card }}
    >
      <span style={{ fontSize: 12, fontWeight: 700, color: MOOD.navy, marginRight: 2 }}>Your work</span>
      <Chip ck="all" label="All" count={counts.all} glyph={null} />
      {cats.map((c) => (
        <Chip key={c.key} ck={c.key} label={c.label} count={c.count} glyph={c.glyph} />
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Work ledger table (from 3B) — CSS grid ROWS (not a fixed-height scroll pane).
// ════════════════════════════════════════════════════════════════════
const LEDGER_GRID = "minmax(120px, 0.9fr) minmax(160px, 2fr) minmax(120px, 1.4fr) minmax(120px, 1fr) auto";

function WorkLedger({ rows, onOpen }) {
  return (
    <div style={{ marginBottom: 4 }}>
      {/* horizontal-only scroll safety for narrow viewports (never a vertical trap). */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 620 }}>
          {/* header row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: LEDGER_GRID,
              gap: 12,
              padding: "0 12px 6px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: "var(--s2j-text-muted)",
              textTransform: "uppercase",
            }}
          >
            <span>Status</span>
            <span>Page</span>
            <span>Result</span>
            <span>Kept / Ref</span>
            <span aria-hidden />
          </div>

          {rows.length === 0 ? (
            <div
              style={{
                ...glassSurface("utility"),
                padding: "12px 14px",
              }}
            >
              <p style={{ ...TYPE.micro }}>No work in this view. Switch the filter to "All".</p>
            </div>
          ) : (
            <ul className="space-y-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {rows.map(({ job, exp, urgency }) => (
                <LedgerRow key={job.jobId} job={job} exp={exp} urgency={urgency} onOpen={onOpen} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <p style={{ ...TYPE.micro, marginTop: 10, padding: "0 12px" }}>
        Kept 7 days from last activity · opening resets the timer · only you see your jobs.
      </p>
    </div>
  );
}

// Left-accent colour by urgency: red (failed) · amber (ready & expiring) · steel (generating) · faint ice (ready).
const ACCENT = {
  0: "var(--s2j-red)",
  1: "var(--s2j-orange)",
  2: MOOD.steel,
  3: "var(--s2j-ice)",
};

function LedgerRow({ job, exp, urgency, onOpen }) {
  const isFailed = job.status === "failed";
  const isReady = job.status === "completed";
  const isRunning = job.status === "pending" || job.status === "batched";

  // STATUS cell (icon + word)
  let statusCell;
  // WCAG AA: the status WORD stays dark (readable on the near-white glass); the ICON carries the
  // severity colour (Signal.jsx's documented light-on-light fix — colour on the glyph, not the text). (deep-audit fix)
  if (isFailed) {
    statusCell = (
      <span className="flex items-center" style={{ gap: 6, color: "var(--s2j-text)", fontWeight: 600 }}>
        <DiamondGlyph size={13} style={{ color: "var(--s2j-red)" }} /> Failed
      </span>
    );
  } else if (isReady) {
    statusCell = (
      <span className="flex items-center" style={{ gap: 6, color: "var(--s2j-text)", fontWeight: 600 }}>
        <SignalIcon kind="success" size={14} /> Ready
      </span>
    );
  } else {
    statusCell = (
      <span className="flex items-center" style={{ gap: 6, color: "var(--s2j-text)", fontWeight: 600 }}>
        <SpinnerGlyph size={13} style={{ color: MOOD.steel }} /> Generating
      </span>
    );
  }

  // PAGE cell (title + sub-line)
  let pageSub = null;
  if (isFailed && job.errorReason) pageSub = job.errorReason;
  else if (isRunning) pageSub = `started ${relAge(job.startedAt) || "moments ago"} · 2–10 min typical`;

  // RESULT cell
  let resultCell;
  if (isReady) {
    const hasNumbers = typeof job.features === "number" || typeof job.costUsd === "number";
    if (hasNumbers) {
      const parts = [];
      if (typeof job.features === "number") parts.push(`${job.features} feature${job.features === 1 ? "" : "s"}`);
      // A genuine sub-cent BYOK run must not read as "$0.00" (free) to a cost-sensitive audience. (deep-audit fix)
      if (typeof job.costUsd === "number") parts.push(job.costUsd > 0 && job.costUsd < 0.005 ? "<$0.01" : `$${job.costUsd.toFixed(2)}`);
      resultCell = (
        <span className="flex items-center" style={{ gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--s2j-text)" }}>{parts.join(" · ")}</span>
          {job.truncated && <TruncatedChip />}
        </span>
      );
    } else {
      // legacy ready job — graceful: no numbers.
      resultCell = (
        <span style={{ fontSize: 13, color: "var(--s2j-text)" }}>
          Ready {job.truncated ? <TruncatedChip /> : null}
        </span>
      );
    }
  } else if (isFailed) {
    resultCell = <span style={{ ...TYPE.micro }}>no result</span>;
  } else {
    resultCell = <span style={{ ...TYPE.micro }}>—</span>;
  }

  // KEPT / REF cell
  let keptCell;
  if (isReady && exp.expiring) {
    keptCell = (
      <span
        className="flex items-center"
        style={{
          gap: 5, fontSize: 12, fontWeight: 600,
          color: "var(--s2j-text)",
          background: "var(--s2j-orange-bg)",
          border: "1px solid var(--s2j-orange-border)",
          borderRadius: 999, padding: "2px 9px", width: "fit-content",
        }}
      >
        <IconClock size={12} style={{ color: "var(--s2j-orange)" }} /> {expiresInLabel(exp.remainingMs)}
      </span>
    );
  } else if (isReady) {
    keptCell = exp.expiresAt ? (
      <span
        className="flex items-center"
        style={{
          gap: 5, fontSize: 12,
          color: "var(--s2j-text-muted)",
          background: "var(--s2j-bg-section)",
          border: "1px solid var(--s2j-border)",
          borderRadius: 999, padding: "2px 9px", width: "fit-content",
        }}
      >
        <IconClock size={12} /> Kept 7 days
      </span>
    ) : (
      // legacy ready job without lastAccessedAt — no expiry shown (graceful).
      <span style={{ ...TYPE.micro }}>—</span>
    );
  } else if (isFailed) {
    keptCell = <CopyRefChip jobId={job.jobId} />;
  } else {
    keptCell = <span style={{ ...TYPE.micro }}>—</span>;
  }

  // ACTION — blue "Open" (ready/generating) or blue "Reopen" (failed). Route-by-own-job.
  const actionLabel = isFailed ? "Reopen" : "Open";

  return (
    <li>
      <div
        style={{
          ...glassSurface("utility"),
          borderLeft: `4px solid ${ACCENT[urgency]}`,
          display: "grid",
          gridTemplateColumns: LEDGER_GRID,
          gap: 12,
          alignItems: "center",
          padding: "12px 12px 12px 12px",
        }}
      >
        {/* STATUS */}
        <div style={{ fontSize: 13, minWidth: 0 }}>{statusCell}</div>
        {/* PAGE */}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: MOOD.navy, lineHeight: 1.3, wordBreak: "break-word" }}>
            {job.pageTitle}
          </div>
          {pageSub && <div style={{ ...TYPE.micro, marginTop: 2 }}>{pageSub}</div>}
        </div>
        {/* RESULT */}
        <div style={{ minWidth: 0 }}>{resultCell}</div>
        {/* KEPT / REF */}
        <div style={{ minWidth: 0 }}>{keptCell}</div>
        {/* ACTION */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn-nav"
            style={{ padding: "6px 14px" }}
            onClick={() => onOpen(job)}
            aria-label={`${actionLabel} ${job.pageTitle}`}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </li>
  );
}

// Neutral/steel "Truncated" quality caveat chip (NOT amber — distinct from the time-critical expiry).
function TruncatedChip() {
  return (
    <span
      className="flex items-center"
      style={{
        gap: 4, fontSize: 11, fontWeight: 600,
        color: MOOD.steel,
        background: "var(--s2j-accent-info-bg)",
        border: "1px solid var(--s2j-accent-info-border)",
        borderRadius: 6, padding: "1px 7px", width: "fit-content",
      }}
      title="The breakdown was cut short (output token cap). Review it — some features may be missing."
    >
      <SignalIcon kind="warning" size={11} style={{ color: MOOD.steel }} /> Truncated
    </span>
  );
}

// A mono job-id copy-ref chip (for support). Clicking copies the ref.
function CopyRefChip({ jobId }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    try {
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(jobId).then(
          () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
          () => {},
        );
      }
    } catch (e) { /* clipboard may be blocked in the sandbox — non-fatal */ }
  }, [jobId]);
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy this job reference for support"
      className="flex items-center"
      style={{
        gap: 5, fontSize: 11,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "var(--s2j-text-muted)",
        background: "var(--s2j-bg-section)",
        border: "1px solid var(--s2j-border)",
        borderRadius: 6, padding: "2px 8px", cursor: "pointer", maxWidth: "100%",
      }}
    >
      <IconCopy size={11} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {copied ? "copied" : jobId}
      </span>
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════
// G2 — degraded dashboard read (amber, NEVER confused with calm-empty).
// ════════════════════════════════════════════════════════════════════
function DegradedWorkCallout({ onRetry }) {
  return (
    <div style={{ marginBottom: GAP.section }}>
      <SignalCallout kind="warning" title="We couldn’t load your work just now">
        This is not the same as having none — a background check failed to respond. Any in-flight or
        finished breakdowns are safe; they’ll reappear when the check succeeds.
        <div className="flex items-center" style={{ gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn-nav" style={{ padding: "6px 14px" }} onClick={onRetry}>
            Retry now
          </button>
          <span
            style={{
              fontSize: 11,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              color: "var(--s2j-text-muted)",
              background: "var(--s2j-bg-section)",
              border: "1px solid var(--s2j-border)",
              borderRadius: 6, padding: "2px 8px",
            }}
          >
            ref: dash_read
          </span>
        </div>
      </SignalCallout>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// G2 — calm "no work in flight" strip (green success tone, NOT degraded).
// ════════════════════════════════════════════════════════════════════
function NoWorkStrip() {
  return (
    <div style={{ marginBottom: GAP.section }}>
      <SignalCallout kind="success" title="No work in flight">
        Nothing is running, waiting, or at risk. Find a page below to start.
      </SignalCallout>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// PERMANENT onboarding steps (G1 essence, minus BYOK). Always present.
// ════════════════════════════════════════════════════════════════════
const STEPS = [
  { n: 1, title: "Pick a page", body: "Search, pick a recent page, or paste a page ID." },
  { n: 2, title: "Generate & leave", body: "Runs in the background 2–10 min. Close the tab — you don’t wait." },
  { n: 3, title: "Come back here", body: "Your finished breakdowns wait on this screen for review." },
];

function OnboardingSteps() {
  return (
    <div style={{ marginBottom: GAP.card }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10,
        }}
      >
        {STEPS.map((s) => (
          <div
            key={s.n}
            style={{
              ...glassSurface("utility"),
              padding: "12px 14px",
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: MOOD.navy,
                border: "none",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {s.n}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: MOOD.navy }}>{s.title}</div>
              <div style={{ ...TYPE.micro, marginTop: 2 }}>{s.body}</div>
            </div>
          </div>
        ))}
      </div>
      <p style={{ ...TYPE.micro, marginTop: 8 }}>Results are kept 7 days · only you see them.</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Space chip — a small square token derived from spaceKey / spaceName.
// ════════════════════════════════════════════════════════════════════
function SpaceChip({ page }) {
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.03em",
        color: MOOD.steel,
        background: "var(--s2j-bg-section)",
        border: "1px solid var(--s2j-border)",
        borderRadius: 6,
        padding: "3px 7px",
        lineHeight: 1.1,
      }}
      title={page?.spaceName || page?.spaceKey || ""}
    >
      {spaceChipLabel(page)}
    </span>
  );
}

// A small inline "↑ shown above" annotation tagged by state (recent rows whose page has a job).
function ShownAboveNote({ status }) {
  const word =
    status === "completed" ? "ready" :
    status === "failed" ? "failed" :
    "in progress";
  return (
    <span style={{ ...TYPE.micro, color: "var(--s2j-text-muted)", whiteSpace: "nowrap" }}>
      {word} ↑ shown above
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════
// Search result row — space chip + title + edited-date + excerpt + Open
// (+ resume-guard when the page already has a job).
// ════════════════════════════════════════════════════════════════════
function SearchResultRow({ page, existingJob, onPick, onOpenJob }) {
  // Per-state resume guard. A COMPLETED / in-progress job would be double-spent by regenerating (warn);
  // a FAILED job produced NO reusable breakdown, so retrying is the correct action — no "spends twice"
  // scare, and the CTA reopens to retry. (deep-audit fix)
  const guard = !existingJob ? null
    : existingJob.status === "failed"
      ? { msg: "This page's last breakdown failed. Reopen to retry, or start fresh below.", btn: "Reopen to retry" }
      : existingJob.status === "completed"
        ? { msg: "You already have a ready breakdown for this page. Generating again spends your key twice.", btn: "Open existing" }
        : { msg: "A breakdown for this page is already generating. Generating again spends your key twice.", btn: "Open in progress" };
  const edited = shortDate(page.lastModified);

  return (
    <li>
      <div
        style={{
          ...glassSurface("utility"),
          padding: "10px 12px",
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <div className="flex" style={{ gap: 10, flex: 1, minWidth: 0 }}>
          <div style={{ paddingTop: 1 }}><SpaceChip page={page} /></div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: MOOD.navy, lineHeight: 1.3, wordBreak: "break-word" }}>
              {page.title}
            </div>
            {edited && <div style={{ ...TYPE.micro, marginTop: 1 }}>edited {edited}</div>}
            {page.excerpt && (
              <div
                style={{
                  ...TYPE.micro,
                  marginTop: 3,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {page.excerpt}
              </div>
            )}
            {guard && (
              <div style={{ marginTop: 8 }}>
                <SignalCallout kind="warning" fontSize={11.5}>
                  {guard.msg}{" "}
                  <button
                    type="button"
                    onClick={() => onOpenJob(existingJob)}
                    style={{
                      color: "var(--s2j-blue)", background: "none", border: "none", padding: 0,
                      cursor: "pointer", textDecoration: "underline", font: "inherit", fontWeight: 600,
                    }}
                  >
                    {guard.btn}
                  </button>
                </SignalCallout>
              </div>
            )}
          </div>
        </div>
        {/* blue Open — starts a NEW breakdown for this page (the resume-guard offers "Open existing"). */}
        <button
          type="button"
          className="btn-nav"
          style={{ padding: "6px 14px", flexShrink: 0 }}
          onClick={() => onPick(page)}
          aria-label={`Open ${page.title}`}
        >
          Open
        </button>
      </div>
    </li>
  );
}

// ════════════════════════════════════════════════════════════════════
// Recent row — space chip + title + opened-age + Open (+ "↑ shown above").
// ════════════════════════════════════════════════════════════════════
function RecentRow({ page, existingJob, onPick, onOpenJob }) {
  const opened = relAge(page.lastSelectedAt);
  return (
    <li>
      <div
        style={{
          ...glassSurface("utility"),
          padding: "10px 12px",
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}
      >
        <SpaceChip page={page} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: MOOD.navy, lineHeight: 1.3, wordBreak: "break-word" }}>
            {page.title}
          </div>
          <div className="flex items-center" style={{ gap: 8, marginTop: 1, flexWrap: "wrap" }}>
            {opened && <span style={{ ...TYPE.micro }}>opened {opened}</span>}
            {existingJob && (
              <>
                <span style={{ ...TYPE.micro, color: "var(--s2j-border)" }}>·</span>
                <ShownAboveNote status={existingJob.status} />
              </>
            )}
          </div>
        </div>
        {/* Route-by-own-job: when this page already has the user's OWN tracked job, Open RESUMES it
            (via its jobId) instead of falling back to the shared per-install page->job index — closing
            the same cross-user mis-route the ledger avoids, and guaranteeing resume-not-restart. (review fix) */}
        <button
          type="button"
          className="btn-nav"
          style={{ padding: "6px 14px", flexShrink: 0 }}
          onClick={() => (existingJob ? onOpenJob(existingJob) : onPick(page))}
          aria-label={`Open ${page.title}`}
        >
          Open
        </button>
      </div>
    </li>
  );
}

export default PagePickerScreen;
