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
import React, { useEffect, useState, useCallback } from "react";
import { invoke } from "@forge/bridge";

const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_MIN_QUERY_LEN = 2;

function PagePickerScreen({ onSelect }) {
  const [recent, setRecent] = useState([]);
  const [recentLoaded, setRecentLoaded] = useState(false);

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
        if (!cancelled) {
          setRecent(Array.isArray(r?.recent) ? r.recent : []);
        }
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
      <h1
        className="text-xl font-semibold mb-1"
        style={{ color: "var(--s2j-text)" }}
      >
        Spec2Tickets
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--s2j-text-light)" }}>
        Pick a Confluence page to generate a JIRA breakdown.
      </p>

      {/* ── Search input ──────────────────────────────────────── */}
      <div className="mb-6">
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

      {/* ── Manual fallback ──────────────────────────────────── */}
      <div
        className="rounded-lg p-4"
        style={{
          background: "var(--s2j-bg-section)",
          border: "1px solid var(--s2j-border)",
        }}
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
              <button type="submit" className="btn-primary">
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

      {/* ── First-run hint (no recent + no search) ───────────── */}
      {showInitialHint && (
        <p
          className="text-xs mt-4 text-center"
          style={{ color: "var(--s2j-text-muted)" }}
        >
          Start typing above to search, or paste a page ID to begin.
        </p>
      )}
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
          title="Open page (run generation OR resume)"
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
      </div>
    </li>
  );
}

export default PagePickerScreen;
