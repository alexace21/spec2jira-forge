/**
 * Spec2JIRA — Forge Custom UI
 *
 * Flow: loading → ready → generating → reviewing → confirming → pushed
 * Includes: reconnect on mount, non-blocking generation, confirmation step.
 *
 * Palette: Swagger/OpenAPI-inspired (#3b4151, #61affe, #49cc90, #fca130, #f93e3e)
 */
import React, { useEffect, useState, useRef, useCallback } from "react";
import { invoke, view, router } from "@forge/bridge";
import BreakdownEditor from "./components/breakdown";
import AdminSettings from "./components/AdminSettings";
import PagePickerScreen from "./components/PagePicker";
import BackButton from "./components/BackButton";
import {
  adaptToLegacyShape,
  extractV3Signals,
  removeFeatureDependency,
  addFeatureDependency,
  sortConcernsBySeverity,
  SEVERITY_PALETTE,
  CONCERN_TYPE_LABEL,
  QUALITY_PALETTE,
} from "./lib/v3Schema";
import "./index.css";

// v3.0.0 result-loading helper. Resolver getResults returns either
//   { breakdown, usage, model }                — v3 native
//   { result: {breakdown, ...} }               — v2.x legacy compat
//
// Wraps the inner breakdown через adaptToLegacyShape so BreakdownEditor's
// v2.x capability-shape expectations remain backward compatible while
// _v3_original е preserved за the embedded Dashboard-signal panel (ConfirmScreen).
function v3AdaptResultPayload(full) {
  if (!full || typeof full !== "object") return full;
  const inner = full.result || full;
  const breakdown = inner.breakdown || inner;
  if (!breakdown || typeof breakdown !== "object") return inner;
  const adaptedBreakdown = adaptToLegacyShape(breakdown);
  // Re-wrap в expected shape — BreakdownEditor reads `result.breakdown`
  return {
    ...inner,
    breakdown: adaptedBreakdown,
  };
}

const POLL_MS = 5000;

// BE1 part 29 (2026-05-09) — universal max-width style for all screens
// post-globalPage migration. Pre-2026-05-08 contentAction was xlarge
// side-panel ~720-800px wide; cards designed for that width. Post-
// migration globalPage stretches to full browser viewport (1400-2400px+),
// causing layout sparseness + readability issues. 1200px matches
// JIRA/Confluence editor default editing width — comfortable density,
// bounded on ultra-wide displays. PagePicker keeps its own narrower
// 720px constraint (intentional for picker UX).
const SCREEN_MAX_WIDTH_STYLE = {
  maxWidth: "1200px",
  margin: "0 auto",
  width: "100%",
};

/**
 * _classifyBackendError — map backend error shape to user-friendly
 * message + routing decision. Generic helper — used by ALL error
 * paths that touch backend invokes (handlePageSelected, handleGenerate,
 * handlePush, etc.).
 *
 * EH1 polish 2026-05-09 part 27 — extended from B1 polish (part 25).
 * Originally `_classifyDashboardError`; renamed для DRY reuse across
 * App.js error paths after partner sandbox surfaced 502 raw HTML
 * leak в handlePageSelected error message.
 *
 * Three classes:
 *   1. not_configured → route to Setup screen (configuration gap)
 *   2. Connection-related (502/503/504/FORGE_FETCH_BLOCKED/x-squid/
 *      timeout/network/HTML body) → "Backend unreachable" message
 *      with actionable next-step
 *   3. Generic (auth/parse/other) → fall through with raw error,
 *      но HTML stripped from detail
 *
 * Returns: { message: string, routeToSetup: boolean }
 *
 * Defensive against HTML-leak: raw nginx 502 bodies start с "<html>"
 * — sniffed and replaced с friendly summary. Backend error JSON
 * (FastAPI HTTPException detail) passes through as text.
 *
 * `contextLabel` parameter (optional): prefix for non-connection
 * generic errors so ErrorScreen shows "Could not open page: ..."
 * vs "Could not load dashboard: ..." vs "Generate failed: ..." per
 * caller context. Connection-class messages ignore label (universal
 * "Backend is unreachable" applies regardless of which call failed).
 */
function _classifyBackendError(errorShape, contextLabel = "") {
  const errorStr = String(errorShape?.error || "");
  const detailRaw = String(errorShape?.detail || "");

  // HTML-strip defense — backend 502 from nginx returns full HTML page
  // body which leaks into ErrorScreen as raw markup. Detect "<html>"
  // prefix → discard detail (information value zero; unreadable).
  const detail = /^<html|<!doctype/i.test(detailRaw.trim())
    ? ""
    : detailRaw;

  // Class 1: not_configured — route to Setup
  if (errorStr === "not_configured") {
    return {
      message: detail || "Spec2Tickets is not configured yet.",
      routeToSetup: true,
    };
  }

  // Class 2: Anthropic temporarily unavailable / overloaded (5xx, 529). This is
  // on Anthropic's side — not the user's spec or key. Just retry in a few minutes.
  if (
    /anthropic_5\d\d/i.test(errorStr) ||
    /results_fetch_5\d\d/i.test(errorStr) ||
    /Backend (500|502|503|504)/i.test(errorStr) ||
    /overloaded/i.test(errorStr + detail)
  ) {
    return {
      message:
        "Anthropic's API is temporarily unavailable or overloaded. This is on Anthropic's side, not your spec — please wait a few minutes and try Generate again.",
      routeToSetup: false,
    };
  }

  // Class 3: Anthropic rate limit reached for this API key.
  if (/rate_limit/i.test(errorStr)) {
    return {
      message:
        "Anthropic's rate limit was reached for your API key. Wait a moment and try again, or review your limits at console.anthropic.com.",
      routeToSetup: false,
    };
  }

  // Class 4: Anthropic account out of credits.
  if (/insufficient_credits/i.test(errorStr)) {
    return {
      message:
        "Your Anthropic account is out of credits. Add credits at console.anthropic.com → Billing, then try again.",
      routeToSetup: false,
    };
  }

  // Class 5: API key rejected — route to Settings so the admin can fix the key.
  if (/auth_rejected/i.test(errorStr)) {
    return {
      message:
        "Anthropic rejected the API key. Open Settings and verify your Anthropic API key (console.anthropic.com → API Keys).",
      routeToSetup: true,
    };
  }

  // Class 6: network / unreachable — the request never reached Anthropic.
  if (
    /network/i.test(errorStr + detail) ||
    /timeout/i.test(errorStr + detail) ||
    /FORGE_FETCH_BLOCKED/i.test(errorStr) ||
    /unreachable/i.test(errorStr)
  ) {
    return {
      message:
        "Couldn't reach the Anthropic API. Check your network connection and verify your Anthropic API key in Settings.",
      routeToSetup: false,
    };
  }

  // Class 7: generic — pass through with optional context label
  const errorPart = errorStr || "Unknown error";
  const detailPart = detail ? `: ${detail}` : "";
  const labelPart = contextLabel ? `${contextLabel}: ` : "";
  return {
    message: `${labelPart}${errorPart}${detailPart}`,
    routeToSetup: false,
  };
}

function App() {
  const [screen, setScreen] = useState("loading");
  const [pageData, setPageData] = useState(null);
  const [pageId, setPageId] = useState(null);
  const [error, setError] = useState(null);
  const [quotaInfo, setQuotaInfo] = useState(null);

  // Project Context profiles (P1+): the available named contexts + the one selected
  // for THIS page's generation. A workspace can span multiple projects, so the user
  // picks which context applies. Default "none" = safe (never silently mis-apply);
  // remembered per page after the first run.
  const [contextProfiles, setContextProfiles] = useState([]);
  const [selectedContextProfileId, setSelectedContextProfileId] = useState("none");
  // The page id the loaded profiles/selection belong to. handleGenerate trusts
  // selectedContextProfileId ONLY when this matches the current page — so a stale
  // cross-project selection can never be submitted before the per-page load resolves
  // (closes the async race; the backend trusts the client id, so this is the guard).
  const [contextLoadedForPageId, setContextLoadedForPageId] = useState(null);

  // Usage/tier badge data (P3a) — shows the customer their monthly breakdown
  // count + reset date on the Ready screen, for transparency BEFORE they hit the
  // free-tier wall (not only after). Best-effort; fed by the getUsage resolver.
  const [usage, setUsage] = useState(null);
  const loadUsage = useCallback(async () => {
    try {
      const u = await invoke("getUsage");
      if (u && !u.error) setUsage(u);
    } catch (_) {
      /* badge is best-effort — hide on failure */
    }
  }, []);

  // Reset scroll to top on every screen change (UX, 2026-05-30). Without this,
  // navigating away from a screen scrolled to the bottom (e.g. BreakdownEditor)
  // lands the next screen at the bottom on blank space, forcing a scroll-up.
  // Also refresh the usage badge whenever the user returns to the Ready screen.
  useEffect(() => {
    // Best-effort scroll-to-top on screen change. NOTE: Forge auto-resizes the
    // Custom UI iframe, so on a tall screen the PARENT product page scrolls and a
    // sandboxed iframe cannot reset the parent's scroll — so this only helps if
    // the iframe itself scrolls. The #root-internal-scroll approach was reverted
    // (2026-05-30): forcing #root to 100vh broke short screens (huge empty area
    // on the picker). Scroll-to-top remains an open, Forge-specific UX item.
    try {
      window.scrollTo(0, 0);
    } catch (_) {}
    if (screen === "ready") loadUsage();
  }, [screen, loadUsage]);

  // Load Project Context profiles + this page's remembered selection whenever we land
  // on the Ready screen, so the user can pick the right context before generating (a
  // workspace may span multiple projects). Best-effort — selector defaults to None.
  useEffect(() => {
    if (screen !== "ready") return;
    let cancelled = false;
    const pid = pageData?.page_id;
    // Reset to the safe default IMMEDIATELY (before the async load) so a stale
    // selection from a previously-opened page can never be shown or submitted for
    // THIS page while getContextProfiles is in flight. The selection becomes
    // trustworthy only once contextLoadedForPageId matches the current page.
    setSelectedContextProfileId("none");
    setContextLoadedForPageId(null);
    (async () => {
      try {
        const resp = await invoke("getContextProfiles", { pageId: pid });
        if (!cancelled && resp && !resp.error) {
          setContextProfiles(resp.profiles || []);
          setSelectedContextProfileId(resp.selectedProfileId || "none");
          setContextLoadedForPageId(pid);
        }
      } catch (_) {
        /* best-effort — selection stays None (safe) until a successful load */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [screen, pageData]);

  // Generation
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [startTime, setStartTime] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  // Review + Push
  const [results, setResults] = useState(null);
  const [isPushing, setIsPushing] = useState(false);
  const [pushResult, setPushResult] = useState(null);
  // Chunked-push progress (2026-05-30) — UI loops pushStep, updates these.
  const [pushProgress, setPushProgress] = useState(0);
  const [pushPhase, setPushPhase] = useState("");

  // CG-7 spec linter pre-flight (Layer 1 Session 2, 2026-05-07)

  // Confirmation flow
  const [dryRunResult, setDryRunResult] = useState(null);
  const [pendingBreakdown, setPendingBreakdown] = useState(null);

  // Stale-page detection (2026-06-02). When a completed breakdown is reopened, we
  // compare the Confluence page version it was generated against (from getResults)
  // with the page's CURRENT version (from fetchPage). If the page was edited since
  // (current > generated), this holds { generatedAt, current } → a non-blocking
  // banner on the reviewing screen nudges Regenerate. null = not stale / unknown
  // (older breakdowns with no stored version, or an unknown current version, must
  // NEVER show a false "edited" banner).
  const [staleBreakdown, setStaleBreakdown] = useState(null);

  const pollRef = useRef(null);
  const timerRef = useRef(null);
  const pushPollRef = useRef(null);

  // ── Init ──────────────────────────────────────────────────────
  // globalPage migration (2026-05-09): no longer auto-binds via
  // ctx.extension.content.id (this affordance is contentAction-specific).
  // After settings + backend gates, attempts reconnect via KVS
  // last_selected_page (surfaces active or completed jobs); falls
  // through to picker когато no active/completed job to surface.
  useEffect(() => {
    const init = async () => {
      try {
        const ctx = await view.getContext();

        if (ctx.moduleKey === "spec2jira-settings") {
          setScreen("admin");
          return;
        }

        // ═══ U3.B contentAction relay (part 33, 2026-05-09) ═══
        // confluence:contentAction module renders the SAME `main` resource
        // (App.js); when invoked from а Confluence page byline button, the
        // page's content.id surfaces via ctx.extension. We:
        //   1. Set pending deep-link в KVS с page reference
        //   2. Navigate to globalPage via router (single iframe transition)
        //   3. globalPage's init() consumes the deep-link + pre-binds page
        // Net UX: user clicks byline button → landed on Ready/Reviewing
        // screen с page bound (skips picker entirely). Closes "Apps menu
        // navigation friction" partner UX insight 2026-05-08 part 18.
        if (ctx.moduleKey === "spec2jira-launch") {
          const contentId = ctx.extension?.content?.id;
          setScreen("launching");
          if (!contentId) {
            // Defensive — contentAction normally always has content.id;
            // fall through to picker as best-recovery если absent.
            setScreen("picker");
            return;
          }
          try {
            await invoke("setPendingDeepLink", {
              pageId: String(contentId),
              title: ctx.extension?.content?.title || "",
              spaceKey: ctx.extension?.space?.key || "",
              spaceName: ctx.extension?.space?.name || "",
            });
            await router.navigate({
              target: "module",
              moduleKey: "spec2jira-app",
            });
            return; // navigation в-flight; iframe leaves this code path
          } catch (relayErr) {
            console.error("U3.B deep-link relay failed:", relayErr);
            // Best-effort fallback: route to picker so user не trapped.
            // Pending deep-link MAY have been set; globalPage init will
            // consume it when user reaches the app via Apps menu.
            setScreen("picker");
            return;
          }
        }

        // ═══ Gate 1 — Settings (v3.0.0 BYOK shape) ═══
        // v2.x checked backendUrl + backendApiKey + lastTestOk; v3.0.0
        // checks the BYOK Anthropic key + default JIRA project key. Both
        // must be configured за app к be usable. Stale-cache concerns
        // about Anthropic API health are deferred к actual generate-time
        // (when failures surface как clear errors с specific causes);
        // no automatic re-test на every app open (avoids а ~3 sec
        // Anthropic round-trip at every mount).
        const settings = await invoke("getSettings");

        if (!settings?.apiKeyConfigured || !settings?.defaultProjectKey) {
          setScreen("setup");
          return;
        }

        // ═══ Gate 3 — Pending deep-link consumption (U3 part 33) ═══
        // Highest-priority routing: explicit user intent от contentAction
        // relay OR external deep-link. Single-use semantic — KVS-side
        // delete during consume prevents stale re-bind on next session.
        // Stale entries (>5 min) auto-discarded by resolver.
        // Non-fatal fail: fall through to subsequent gates.
        try {
          const dlResp = await invoke("consumePendingDeepLink");
          const pending = dlResp?.pending;
          if (pending?.pageId) {
            const [pageResult, statusResult] = await Promise.all([
              invoke("fetchPage", { pageId: pending.pageId }),
              invoke("getGenerationStatus", { pageId: pending.pageId }),
            ]);
            if (!pageResult.error) {
              // Best-effort recordPageSelection — deep-linked pages should
              // surface в recent list (closes loop с handlePageSelected).
              try {
                await invoke("recordPageSelection", {
                  id: String(pending.pageId),
                  title: pageResult.title || pending.title || "",
                  spaceKey: pageResult.space_key || pending.spaceKey || "",
                  spaceName: pageResult.space_name || pending.spaceName || "",
                });
              } catch (recordErr) {
                console.error("recordPageSelection (deep-link) failed:", recordErr);
              }
              await routeByPageStatus(
                {
                  id: pending.pageId,
                  title: pending.title,
                  spaceKey: pending.spaceKey,
                  spaceName: pending.spaceName,
                },
                pageResult,
                statusResult,
              );
              return;
            }
            // fetchPage failed — log + fall through (don't trap user)
            console.warn(
              "Pending deep-link fetchPage failed:",
              pageResult.error,
            );
          }
        } catch (dlErr) {
          console.error("consumePendingDeepLink failed:", dlErr);
        }

        // ═══ Gate 4 — URL deep-link via window.location.search (U3.A) ═══
        // Bonus mechanism — Forge globalPage iframe MAY surface query
        // params from outer URL (e.g., bookmarks / external links shaped
        // как `?pageId=XXX`). Forge sandbox might strip them; fail-soft
        // → fall through to subsequent gates if не accessible или missing.
        try {
          const search = window?.location?.search;
          if (search) {
            const urlParams = new URLSearchParams(search);
            const urlPageId = urlParams.get("pageId");
            if (urlPageId) {
              const [pageResult, statusResult] = await Promise.all([
                invoke("fetchPage", { pageId: urlPageId }),
                invoke("getGenerationStatus", { pageId: urlPageId }),
              ]);
              if (!pageResult.error) {
                try {
                  await invoke("recordPageSelection", {
                    id: String(urlPageId),
                    title: pageResult.title || "",
                    spaceKey: pageResult.space_key || "",
                    spaceName: pageResult.space_name || "",
                  });
                } catch (recordErr) {
                  console.error(
                    "recordPageSelection (URL) failed:",
                    recordErr,
                  );
                }
                await routeByPageStatus(
                  {
                    id: urlPageId,
                    title: pageResult.title || "",
                  },
                  pageResult,
                  statusResult,
                );
                return;
              }
            }
          }
        } catch (urlErr) {
          // window.location.search inaccessible OR malformed — non-fatal.
          console.error("URL deep-link check failed:", urlErr);
        }

        // ═══ Gate 5 — KVS lastSelected reconnect (active jobs only) ═══
        // U4 part 33 (2026-05-09) — refined per partner UX directive
        // 2026-05-08 part 18: "auto-load last breakdown на app return
        // should route to picker, не resume". Reconnect ONLY когато
        // last-selected page has ACTIVE job (running/pending) — те
        // are time-sensitive (user wants monitoring); completed jobs
        // wait for explicit pick от picker (still 1-click via recent
        // list which shows last_selected at top). Idle status also
        // falls through to picker (no work to monitor).
        //
        // Net UX change: after completing a run, returning to the app
        // lands в picker → user picks deliberately whether to review
        // the completed work, start fresh, or do something else. Active
        // jobs still surface automatically (monitoring use case).
        // Failures here are non-fatal — picker fallback covers uncertainty.
        try {
          const lastResp = await invoke("getLastSelectedPage");
          const last = lastResp?.lastSelected;
          if (last?.id) {
            const [pageResult, statusResult] = await Promise.all([
              invoke("fetchPage", { pageId: last.id }),
              invoke("getGenerationStatus", { pageId: last.id }),
            ]);
            if (
              !pageResult.error &&
              (statusResult.status === "running" ||
                statusResult.status === "pending" ||
                statusResult.status === "batched")
            ) {
              await routeByPageStatus(last, pageResult, statusResult);
              return;
            }
          }
        } catch (reconErr) {
          // Non-fatal — picker fallback handles uncertainty.
          console.error("Reconnect attempt failed:", reconErr);
        }

        // Default entry: page picker.
        setScreen("picker");
      } catch (err) {
        setError(err.message);
        setScreen("error");
      }
    };
    init();
    return () => {
      clearInterval(pollRef.current);
      clearInterval(timerRef.current);
      clearInterval(pushPollRef.current);
    };
  }, []);

  // ── Timer ─────────────────────────────────────────────────────
  // The generating screen shows an elapsed-time counter — visible timing
  // helps the user calibrate expectations during the 60-150 sec run.
  useEffect(() => {
    if (screen === "generating" && startTime) {
      timerRef.current = setInterval(
        () => setElapsed(Math.floor((Date.now() - startTime) / 1000)),
        1000,
      );
    }
    return () => clearInterval(timerRef.current);
  }, [screen, startTime]);

  // ── Bug F1 fix (2026-05-10 part 44) — reviewing screen layout reflow ─
  // Symptom: in-flight generation→reviewing transition rendered breakdown
  // editor vertically-compressed (full width, but content squeezed).
  // Workaround partner found: close+reopen → fresh load → reviewing
  // renders correctly. Diagnosis: reviewing wrapper uses `height: 100vh`
  // which references iframe viewport at layout time. After а long
  // GeneratingScreen render (5-30 min с small centered content), iframe
  // viewport context settled to that smaller content size; subsequent
  // reviewing render computed 100vh against stale value. React's reuse
  // of outer <div> DOM node между screens (both wrappers са plain divs)
  // skipped fresh layout pass.
  // Fix: dispatch synthetic resize event on entering reviewing screen —
  // nudges browser/iframe к recompute viewport context для the new
  // wrapper's height. Belt-and-suspenders: companion change в the
  // reviewing wrapper itself (height → minHeight) allows natural growth.
  useEffect(() => {
    if (screen === "reviewing") {
      const id = requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
      return () => cancelAnimationFrame(id);
    }
  }, [screen]);

  // ── Polling ───────────────────────────────────────────────────
  const startPolling = useCallback((jid) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const st = await invoke("pollJobStatus", { jobId: jid });
        if (st.error) {
          clearInterval(pollRef.current);
          setError(st.error);
          setScreen("error");
          return;
        }
        setJobStatus(st);
        if (st.status === "completed") {
          clearInterval(pollRef.current);
          const full = await invoke("getResults", { jobId: jid });
          if (full.error) {
            setError(full.error);
            setScreen("error");
          } else {
            // A freshly-generated breakdown is current by definition — clear any
            // stale flag lingering from a previous reconnect (e.g. after Regenerate).
            setStaleBreakdown(null);
            setResults(v3AdaptResultPayload(full));
            setScreen("reviewing");
          }
        } else if (st.status === "failed") {
          clearInterval(pollRef.current);
          setError(st.error || "Generation failed");
          setScreen("error");
        }
      } catch (e) {
        console.error("Poll error:", e);
      }
    }, POLL_MS);
  }, []);

  // ── Page selection routing (post globalPage migration) ───────
  // routeByPageStatus is shared между init's reconnect path AND
  // handlePageSelected (picker → editor handoff). v3 routing: active job
  // (running/pending/batched) → generating screen с polling resumed;
  // completed → reviewing; idle / no job → ready. Sets pageId + pageData
  // как side-effect.
  const routeByPageStatus = useCallback(
    async (pageRef, pageResult, statusResult) => {
      setPageId(String(pageRef.id));
      setPageData(pageResult);

      if (
        statusResult.status === "running" ||
        statusResult.status === "pending" ||
        statusResult.status === "batched"
      ) {
        setJobId(statusResult.job_id);
        setJobStatus(statusResult);
        setStartTime(Date.now() - (statusResult.elapsed_seconds || 0) * 1000);
        setElapsed(Math.floor(statusResult.elapsed_seconds || 0));
        setScreen("generating");
        startPolling(statusResult.job_id);
        return;
      }

      if (statusResult.status === "completed") {
        const full = await invoke("getResults", {
          jobId: statusResult.job_id,
        });
        // v3.0.0: breakdown may live на full directly (resolver native
        // shape) OR under full.result (v2.x legacy compat). v3AdaptResultPayload
        // handles both + wraps в legacy capability shape для BreakdownEditor.
        if (full.result?.breakdown || full.breakdown) {
          // Stale-page detection: compare the page version this breakdown was
          // generated against (full.pageVersion, from getResults) with the page's
          // CURRENT version (pageResult.version, from fetchPage). Only flag stale
          // when BOTH are known numbers AND the page advanced (current > generated).
          // When the stored version is missing (older breakdowns) OR the current
          // version is unknown, clear the flag — never a false "edited" banner.
          const generatedVersion = full.pageVersion;
          const currentVersion = pageResult?.version;
          if (
            typeof generatedVersion === "number" &&
            typeof currentVersion === "number" &&
            currentVersion > generatedVersion
          ) {
            setStaleBreakdown({ generatedAt: generatedVersion, current: currentVersion });
          } else {
            setStaleBreakdown(null);
          }
          setResults(v3AdaptResultPayload(full));
          setScreen("reviewing");
          return;
        }
      }

      // Idle / no job → fresh start.
      setScreen("ready");
    },
    [startPolling],
  );

  // handlePageSelected — picker hands off the chosen page (or manual
  // ID entry). Resolves canonical page data via fetchPage, records
  // selection в KVS с canonical title (replaces "Page <id>" placeholder
  // от manual entry), then routes по job status.
  const handlePageSelected = useCallback(
    async (pageRef) => {
      setScreen("loading");
      setError(null);

      try {
        const [pageResult, statusResult] = await Promise.all([
          invoke("fetchPage", { pageId: pageRef.id }),
          invoke("getGenerationStatus", { pageId: pageRef.id }),
        ]);

        if (pageResult.error) {
          // EH1 polish part 27 — use _classifyBackendError для friendly
          // message + setup-routing decision. Replaces raw concat which
          // leaked HTML body (nginx 502) into ErrorScreen text.
          const friendly = _classifyBackendError(
            pageResult,
            "Could not open page",
          );
          if (friendly.routeToSetup) {
            setError(friendly.message);
            setScreen("setup");
            return;
          }
          setError(friendly.message);
          setScreen("error");
          return;
        }

        // Record selection с CANONICAL title (от fetchPage, не the
        // picker's pageRef shape — important for manual-ID entries
        // where pageRef.title was a placeholder). Best-effort —
        // failure не blocks the editor flow.
        try {
          await invoke("recordPageSelection", {
            id: String(pageRef.id),
            title: pageResult.title || pageRef.title,
            spaceKey: pageResult.space_key || pageRef.spaceKey || "",
            spaceName: pageResult.space_name || pageRef.spaceName || "",
          });
        } catch (recordErr) {
          console.error("recordPageSelection failed:", recordErr);
        }

        await routeByPageStatus(pageRef, pageResult, statusResult);
      } catch (err) {
        setError(err.message || "Failed to open page");
        setScreen("error");
      }
    },
    [routeByPageStatus],
  );

  // ── Start generation ─────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    setScreen("generating");
    setStartTime(Date.now());
    setElapsed(0);
    setJobStatus({ progress: 0, phase: "Starting..." });

    // Trust the selection ONLY if the per-page context finished loading for THIS
    // page; otherwise send "none" (safe). Closes the async race where a stale
    // cross-project selection could be submitted before getContextProfiles resolves.
    const effectiveProfileId =
      contextLoadedForPageId === pageData.page_id ? selectedContextProfileId : "none";
    const result = await invoke("startGeneration", {
      pageId: pageData.page_id,
      modelMode: "primary",
      contextProfileId: effectiveProfileId,
    });

    if (result.error === "quota_exceeded") {
      // Quota reached (ENFORCEMENT_MODE = 'block'). NORMAL state, not a failure —
      // route to the dedicated limit screen, NOT the red "Something went wrong"
      // error screen. The payload's fairUse flag splits the messaging there: Free
      // (fairUse=false) → subscribe to a paid edition; Managed Pro (fairUse=true) →
      // switch to BYOK Pro for unlimited (the cap is fair-use, we pay compute).
      setQuotaInfo(result);
      setScreen("limit_reached");
      return;
    }
    if (result.error === "managed_unavailable") {
      // Managed Pro selected but our server key isn't configured (rare/transient).
      // The backend composes an actionable detail (contact support OR switch to
      // BYOK) — show it directly rather than the generic classifier wrapping.
      setError(
        result.detail ||
          "The Managed service is temporarily unavailable. Please contact support, or switch to BYOK in Settings and use your own Anthropic API key.",
      );
      setScreen("error");
      return;
    }
    if (result.error) {
      // EH1 polish part 27 — friendly classifier replaces raw error string.
      const friendly = _classifyBackendError(result, "Generate failed");
      if (friendly.routeToSetup) {
        setError(friendly.message);
        setScreen("setup");
        return;
      }
      setError(friendly.message);
      setScreen("error");
      return;
    }

    setJobId(result.job_id);
    startPolling(result.job_id);
  }, [pageData, startPolling, selectedContextProfileId, contextLoadedForPageId]);

  // ── Push: Step 1 — compute count summary client-side → confirming screen
  //
  // v3.0.0 change (2026-05-28): dropped the round-trip к "dryRun" resolver
  // (was returning JIRA project metadata + would create issues а la backend).
  // v3.0.0 architecture has no customer backend; counts are computed
  // directly от the edited breakdown. ConfirmScreen renders count summary
  // + embedded Dashboard signals (overall_quality, confidence distribution,
  // spec_concerns, dependencies) at this push-decision step — eliminating
  // the standalone Dashboard surface which users rarely discovered.
  const handlePush = useCallback(async (editedBreakdown) => {
    // Compute counts от edited breakdown shape (legacy-adapted shape — has
    // capabilities[] wrapper applied by v3AdaptResultPayload at load time).
    const caps = editedBreakdown?.capabilities || [];
    const features = caps.flatMap((c) => c.features || []);
    const tasks = features.flatMap((f) => f.tasks || []);
    let depCount = 0;
    for (const f of features) depCount += (f.dependencies || []).length;
    for (const t of tasks) depCount += (t.dependencies || []).length;

    setPendingBreakdown(editedBreakdown);
    setDryRunResult({
      total_stories: features.length,
      total_subtasks: tasks.length,
      total_epics: editedBreakdown?.epic ? 1 : 0,
      total_items: features.length + tasks.length + (editedBreakdown?.epic ? 1 : 0),
      dependency_links: depCount,
      project_key: null, // populated from Settings; resolver fills at push time
      items: [], // not pre-computed — ConfirmScreen reads counts directly
    });
    setScreen("confirming");
  }, []);

  // ── Review-screen dependency editing ─────────────────────────
  // Remove / restore a cross-feature dependency at the push-decision point. The
  // change is applied to the breakdown JSON the push reads (startPush sends
  // pendingBreakdown) — NOT just the display — so the JIRA push will not recreate
  // a removed Story-blocks-Story link. dependency_links is kept in sync so the
  // "What will be created" tally matches. See v3Schema.removeFeatureDependency.
  const handleRemoveDependency = useCallback((source, target) => {
    setPendingBreakdown((prev) => removeFeatureDependency(prev, source, target));
    setDryRunResult((dr) =>
      dr ? { ...dr, dependency_links: Math.max(0, (dr.dependency_links || 0) - 1) } : dr,
    );
  }, []);
  const handleRestoreDependency = useCallback((source, target) => {
    setPendingBreakdown((prev) => addFeatureDependency(prev, source, target));
    setDryRunResult((dr) =>
      dr ? { ...dr, dependency_links: (dr.dependency_links || 0) + 1 } : dr,
    );
  }, []);

  // ── Push: Step 2 — confirmed → chunked create in JIRA ────────
  // 2026-05-30: chunked-resolver pattern. JIRA bulk create е slow (~0.85
  // sec/issue); a 200-item push exceeds the 25-sec resolver timeout. So the
  // UI calls startPush (lookup + Epic) then loops pushStep (one bounded JIRA
  // batch per call) until done, showing a progress bar on the "pushing" screen.
  const handleConfirmedPush = useCallback(async () => {
    setIsPushing(true);
    setPushProgress(0);
    setPushPhase("starting");
    setScreen("pushing");

    const fail = (res, fallback) => {
      const friendly = _classifyBackendError(res, "Push to JIRA failed");
      const message = res?.detail
        ? `${friendly.message} (${res.detail})`
        : friendly.message || fallback;
      setError(message);
      setScreen(friendly.routeToSetup ? "setup" : "error");
      setIsPushing(false);
    };

    try {
      const start = await invoke("startPush", { breakdown: pendingBreakdown });
      // Push gate (hybrid model): Free includes Generate + Review but NOT the JIRA
      // push (asUser() is forbidden for unlicensed installs — gotcha #3). Route to
      // the friendly subscription screen, NOT the red error screen. quotaInfo carries
      // the backend's tier-aware detail + pricing[] so LimitReachedScreen shows both
      // editions. isPushing must clear so the user isn't stuck on a spinner.
      if (start.error === "push_requires_license") {
        setQuotaInfo(start);
        setScreen("limit_reached");
        setIsPushing(false);
        return;
      }
      if (start.error) {
        fail(start, "Push failed to start");
        return;
      }
      const sessionId = start.session_id;
      if (!sessionId) {
        setError("Push did not start correctly (no session id).");
        setScreen("error");
        setIsPushing(false);
        return;
      }
      setPushPhase(start.phase || "stories");

      // Loop pushStep until done. Safety cap prevents runaway (huge specs
      // chunk in 15s → 2000 steps would be ~30000 items, far beyond any real spec).
      for (let i = 0; i < 2000; i++) {
        const step = await invoke("pushStep", { sessionId });
        if (step.error) {
          fail(step, "Push step failed");
          return;
        }
        if (step.done) {
          setPushResult(step.result);
          setScreen("pushed");
          setIsPushing(false);
          // Data minimization: page content + breakdown in KVS aren't needed
          // after the push — purge them (best-effort). See privacy policy §5.
          if (jobId) invoke("purgeJob", { jobId }).catch(() => {});
          return;
        }
        setPushProgress(typeof step.progress === "number" ? step.progress : 0);
        setPushPhase(step.phase || "");
      }

      setError(
        "Push took an unexpectedly large number of steps. Check JIRA for created items; contact support@spec2jira.com if items are missing.",
      );
      setScreen("error");
      setIsPushing(false);
    } catch (err) {
      setError(err.message || "Push failed");
      setScreen("error");
      setIsPushing(false);
    }
  }, [pendingBreakdown, jobId]);

  // ── Navigation ────────────────────────────────────────────────
  // handleRetry — same page, fresh attempt. Used by ErrorScreen
  // "Try again". Preserves pageId + pageData so user retries same spec
  // (e.g., transient backend error doesn't force re-pick).
  //
  // Defensive routing (caught self-audit 2026-05-09): if user reached
  // error WITHOUT a confirmed page (e.g., picker → manual ID entry →
  // fetchPage 404), pageData is null. Routing to "ready" would crash
  // ReadyScreen's `{pageData.title}` access. Fall back to picker когато
  // no page is bound.
  const handleRetry = useCallback(() => {
    clearInterval(pollRef.current);
    clearInterval(pushPollRef.current);
    setError(null);
    setJobId(null);
    setJobStatus(null);
    setResults(null);
    setPushResult(null);
    setDryRunResult(null);
    setPendingBreakdown(null);
    setIsPushing(false);
    setScreen(pageData ? "ready" : "picker");
  }, [pageData]);

  // handleRegenerate — re-run generation from the CURRENT page (2026-06-02). The
  // problem: routeByPageStatus sends a reopened completed page straight to the
  // reviewing screen (the OLD breakdown), bypassing Ready where Generate lives — so
  // a user who edited the spec had no discoverable way to regenerate. This routes
  // back to Ready (NOT auto-generate) on purpose: the user can re-pick the Project
  // Context profile + see their usage BEFORE regenerating (the right control point).
  // pageId/pageData stay bound so Ready renders. Non-destructive — the old job is NOT
  // purged: a fresh generation supersedes it, and if the user bails the cached
  // completed breakdown still resumes. Mirrors handleRetry's interval cleanup.
  const handleRegenerate = useCallback(() => {
    clearInterval(pollRef.current);
    clearInterval(pushPollRef.current);
    setResults(null);
    setPendingBreakdown(null);
    setJobId(null);
    setJobStatus(null);
    setDryRunResult(null);
    setPushResult(null);
    setStaleBreakdown(null);
    setIsPushing(false);
    setScreen("ready");
  }, []);

  // handleNewPage — clear page binding, return to picker. Used от
  // PushedScreen "Generate Another" (post-push, user wants different
  // spec).
  const handleNewPage = useCallback(() => {
    clearInterval(pollRef.current);
    clearInterval(pushPollRef.current);
    setError(null);
    setPageId(null);
    setPageData(null);
    setJobId(null);
    setJobStatus(null);
    setResults(null);
    setPushResult(null);
    setDryRunResult(null);
    setPendingBreakdown(null);
    setIsPushing(false);
    setSelectedContextProfileId("none");
    setContextLoadedForPageId(null);
    setScreen("picker");
  }, []);

  const handleBackToReview = useCallback(() => {
    setDryRunResult(null);
    setPushResult(null);
    setScreen("reviewing");
  }, []);

  // ── Render ────────────────────────────────────────────────────
  // Admin page has its own full-screen component.
  if (screen === "admin") return <AdminSettings />;
  if (screen === "setup") return <SetupScreen message={error} />;

  // Reviewing screen fills the panel (100vh). All others are top-aligned.
  // Track 2 (2026-05-09): top-left "Back to picker" affordance per partner
  // UX directive 2026-05-08 ("top-left exit arrow на every screen"). Without
  // this, user trapped on review screen — only path forward е Push to JIRA
  // (destructive) OR close panel + restart server (loses session). Click
  // discards in-progress edits + routes to picker; user can re-click their
  // page to re-enter (job_store cached for 1h TTL preserves result).
  if (screen === "reviewing") {
    return (
      <div
        // Bug F1 fix (2026-05-10 part 44) — `key` forces React к unmount
        // any prior screen's wrapper и mount а fresh DOM node для
        // reviewing. Without this, React reuses the outer <div> across
        // screens (both wrappers са plain divs), preserving stale layout
        // context от GeneratingScreen's small content size. Companion
        // change: useEffect-dispatched window.resize on screen=reviewing
        // entry (see App component top); minHeight (was height) allows
        // natural growth if content needs more than viewport.
        key="screen-reviewing"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          // BE1 part 29 (2026-05-09) — globalPage migration left BreakdownEditor
          // stretched на full browser width; cards designed для contentAction
          // ~720px now spread excessively on 1400px+ displays. Constrain to
          // 1200px (industry-standard editing width per JIRA/Confluence
          // editor defaults) + center via auto margins. Universal pattern
          // applied to all screens this ship для consistency.
          maxWidth: "1200px",
          margin: "0 auto",
          width: "100%",
        }}
      >
        <div
          className="shrink-0 px-3 py-2 flex items-center"
          style={{
            background: "var(--s2j-bg-section)",
            borderBottom: "1px solid var(--s2j-border)",
          }}
        >
          {/* U2 part 33 (2026-05-09) — refactored to use shared BackButton.
              className="" overrides default mb-3 since this button lives
              inside a flex-row top-bar (margin would push page-title span
              out of vertical alignment). */}
          <BackButton
            onClick={handleNewPage}
            className=""
            title="Return to the page picker (this breakdown stays cached ~1h — re-click the page to resume it). To generate fresh from the current page instead, use the Regenerate button."
          />
          <span
            className="ml-3 text-[11px]"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            {pageData?.title || "(reviewing)"}
          </span>
          {/* Regenerate (2026-06-02) — the must-have path back to generation. A
              reopened completed page lands here on the OLD breakdown (routeByPageStatus
              bypasses Ready), so without this a user who edited the spec page had no
              discoverable way to re-run. Routes to Ready (handleRegenerate) — NOT
              auto-generate — so the user can re-pick the Project Context profile + see
              their usage first. Always present; the stale banner below just makes it
              salient when the page changed. Mirrors BackButton's muted-with-hover style;
              ml-auto pins it to the far end of this flex-row top-bar. */}
          <button
            onClick={handleRegenerate}
            className="text-xs flex items-center gap-1.5 ml-auto"
            style={{
              background: "none",
              border: "none",
              color: "var(--s2j-text-muted)",
              cursor: "pointer",
              padding: "4px 8px",
              borderRadius: "4px",
              transition: "all 0.15s",
              marginRight: "-8px",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--s2j-border)";
              e.currentTarget.style.color = "var(--s2j-text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "none";
              e.currentTarget.style.color = "var(--s2j-text-muted)";
            }}
            title="Re-run generation from the current page (picks up any edits you've made)"
          >
            ↻ Regenerate
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {/* Stale-page banner (2026-06-02) — the page's Confluence version advanced
              since this breakdown was generated (set in routeByPageStatus). Non-blocking,
              orange warning style matching the truncation banner (ConfirmScreen). Makes
              the always-present Regenerate button salient + explains WHY. Only shows when
              both versions are known and the page genuinely changed (never on missing
              data). */}
          {staleBreakdown && (
            <div
              className="shrink-0 mx-3 mt-3 rounded-lg p-3 flex items-start gap-2"
              style={{
                background: "var(--s2j-orange-bg)",
                border: "1px solid var(--s2j-orange-border)",
              }}
            >
              <span aria-hidden="true" style={{ flexShrink: 0 }}>⚠</span>
              <div style={{ flex: 1 }}>
                <p className="text-sm font-medium" style={{ color: "var(--s2j-text)" }}>
                  This page was edited since this breakdown was generated
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--s2j-text-light)" }}>
                  Page version {staleBreakdown.generatedAt} → {staleBreakdown.current}.
                  Regenerate to include your changes.
                </p>
              </div>
              <button
                onClick={handleRegenerate}
                className="btn-primary text-xs shrink-0"
                style={{ whiteSpace: "nowrap" }}
                title="Re-run generation from the current page (picks up any edits you've made)"
              >
                ↻ Regenerate
              </button>
            </div>
          )}
          <BreakdownEditor
            initialBreakdown={pendingBreakdown || results.breakdown}
            onPush={handlePush}
            isPushing={isPushing}
          />
        </div>
      </div>
    );
  }

  switch (screen) {
    case "loading":
      return (
        <Center>
          <Spinner />
          <p className="s2j-text-muted text-sm ml-2">Connecting...</p>
        </Center>
      );
    case "launching":
      // U3.B (part 33, 2026-05-09) — contentAction → globalPage relay.
      // Visible briefly when user clicks "Generate Breakdown с Spec2Tickets"
      // byline button on a Confluence page; ctx.extension.content.id is
      // saved to KVS pending_deep_link, then router.navigate hops to
      // globalPage which consumes the link и pre-binds the page.
      return (
        <Center>
          <Spinner />
          <p className="s2j-text-muted text-sm ml-2">
            Opening Spec2Tickets...
          </p>
        </Center>
      );
    case "picker":
      return (
        <PagePickerScreen
          onSelect={handlePageSelected}
        />
      );
    case "ready":
      return (
        <ReadyScreen
          pageData={pageData}
          usage={usage}
          contextProfiles={contextProfiles}
          selectedContextProfileId={selectedContextProfileId}
          onSelectContextProfile={setSelectedContextProfileId}
          onGenerate={handleGenerate}
          onBack={handleNewPage}
        />
      );
    case "generating":
      return (
        <GeneratingScreen
          pageTitle={pageData?.title}
          jobStatus={jobStatus}
          elapsed={elapsed}
          onBack={handleNewPage}
          onStartOver={handleRegenerate}
        />
      );
    case "confirming":
      return (
        <ConfirmScreen
          dryRunResult={dryRunResult}
          breakdown={pendingBreakdown}
          truncationNote={results?.truncation_note}
          isPushing={isPushing}
          onConfirm={handleConfirmedPush}
          onBack={handleBackToReview}
          onBackToPicker={handleNewPage}
          onRemoveDependency={handleRemoveDependency}
          onRestoreDependency={handleRestoreDependency}
        />
      );
    case "pushing":
      return <PushingScreen progress={pushProgress} phase={pushPhase} />;
    case "pushed":
      return (
        <PushedScreen
          result={pushResult}
          onBack={handleBackToReview}
          onNew={handleNewPage}
        />
      );
    case "limit_reached":
      return <LimitReachedScreen quota={quotaInfo} onBack={handleNewPage} />;
    case "error":
      return (
        <ErrorScreen
          error={error}
          onRetry={handleRetry}
          onBackToPicker={pageData ? handleNewPage : null}
        />
      );
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Components
// ═══════════════════════════════════════════════════════════════

function Center({ children }) {
  return (
    <div className="flex items-center justify-center py-16">{children}</div>
  );
}

function Spinner({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      style={{ animation: "spin 0.8s linear infinite" }}
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="var(--s2j-border)"
        strokeWidth="2.5"
      />
      <path
        d="M14.5 8a6.5 6.5 0 00-6.5-6.5"
        stroke="var(--s2j-green)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

// ── Ready ───────────────────────────────────────────────────────

function ReadyScreen({
  pageData,
  usage,
  contextProfiles = [],
  selectedContextProfileId = "none",
  onSelectContextProfile,
  onGenerate,
  onBack,
}) {
  // Prices come from getUsage's pricing[] (single source of truth — no hardcoded
  // €-values in the UI). The old single "pro" key no longer exists; the hybrid has
  // two paid editions: byokPro (unlimited, own key) + managedPro (we run it).
  const byokProPrice = findPrice(usage, "byokPro");
  const managedProPrice = findPrice(usage, "managedPro");
  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      {onBack && (
        <BackButton
          onClick={onBack}
          title="Return to page picker (clears page selection; you can pick a different page)"
        />
      )}
      <h2
        className="text-lg font-semibold mb-1"
        style={{ color: "var(--s2j-text)" }}
      >
        {pageData.title}
      </h2>
      <p className="text-sm mb-4" style={{ color: "var(--s2j-text-light)" }}>
        {(pageData.body_length || 0).toLocaleString()} characters
      </p>

      {usage && (
        <div
          className="rounded-md px-3 py-2 mb-4 text-xs"
          style={{
            background: "var(--s2j-bg-section)",
            border: "1px solid var(--s2j-border)",
            color: "var(--s2j-text-light)",
          }}
        >
          {usage.unlimited ? (
            <span>
              <strong style={{ color: "var(--s2j-text)" }}>
                {usage.tierLabel} plan
              </strong>{" "}
              · unlimited breakdowns
            </span>
          ) : usage.tier === "managedPro" ? (
            // Managed Pro is CAPPED fair-use (we run Claude), not a free trial —
            // describe it as the monthly fair-use allowance, not "free breakdowns".
            <span>
              <strong style={{ color: "var(--s2j-text)" }}>
                {usage.tierLabel} plan
              </strong>{" "}
              · {usage.used} breakdowns this month (fair-use allowance) · resets{" "}
              {usage.resetsAtLabel}
              {usage.remaining === 0 && byokProPrice && (
                <span style={{ color: "var(--s2j-text)" }}>
                  {" "}
                  · for unlimited, switch to BYOK Pro ({byokProPrice}) with your own
                  key
                </span>
              )}
            </span>
          ) : (
            <span>
              <strong style={{ color: "var(--s2j-text)" }}>
                {usage.used} of {usage.limit}
              </strong>{" "}
              free breakdowns used this month · resets {usage.resetsAtLabel}
              {usage.remaining === 0 && (byokProPrice || managedProPrice) && (
                <span style={{ color: "var(--s2j-text)" }}>
                  {" "}
                  · upgrade for unlimited
                  {byokProPrice ? ` — BYOK Pro ${byokProPrice}` : ""}
                  {managedProPrice ? ` or Managed Pro ${managedProPrice}` : ""}
                </span>
              )}
            </span>
          )}
        </div>
      )}

      {/* v3.0.0 ReadyScreen — simplified UX.
          v2.x had Document Type radios (MODULE/FEATURE/EPIC_PRODUCT) +
          Bypass Cache toggle + Preview button. v3.0.0 drops all three:
          - Sonnet 4.6 doesn't need document-type scoping hint (handles
            structure automatically via its 1M context + agentic reasoning)
          - Prompt caching е auto-managed by Anthropic; не customer-facing
          - Preview (CG-7 pre-flight) was а ~30-90 sec sanity check на
            v2.x's ~10-30 min full pipeline. v3.0.0 full run е already
            60-150 sec total — preview adds no value. */}
      <div
        className="rounded-lg p-4 mb-4 text-sm"
        style={{
          background: "var(--s2j-blue-bg)",
          border: "1px solid var(--s2j-blue-border)",
          color: "var(--s2j-text)",
        }}
      >
        <strong>Ready to generate.</strong> Claude Sonnet 4.6 will analyze
        this Confluence page and produce a structured JIRA breakdown —
        Stories, Subtasks, cross-feature dependencies, and quality signals.
        Typical runtime: 60–150 seconds depending on spec size.
      </div>

      {/* Project Context selector — pick which named context applies to THIS spec, so
          a multi-project workspace never gets the wrong project's context injected. */}
      {contextProfiles.length > 0 ? (
        <div className="mb-4">
          <label
            className="text-sm font-medium block mb-1"
            style={{ color: "var(--s2j-text)" }}
          >
            Project Context
          </label>
          <select
            value={selectedContextProfileId}
            onChange={(e) => onSelectContextProfile?.(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: "0.875rem",
              borderRadius: "6px",
              border: "1px solid var(--s2j-border)",
              background: "var(--s2j-bg)",
              color: "var(--s2j-text)",
              outline: "none",
            }}
          >
            <option value="none">None — use the spec on its own</option>
            {contextProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="text-xs mt-1" style={{ color: "var(--s2j-text-muted)" }}>
            Applies your project's domain &amp; glossary to this breakdown. Pick the
            profile matching this spec's project; manage profiles in Settings.
          </p>
        </div>
      ) : (
        <p className="text-xs mb-4" style={{ color: "var(--s2j-text-muted)" }}>
          Tip: add a Project Context in Settings to tailor breakdowns to your project's
          domain, glossary, and conventions.
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={onGenerate}
          className="btn-primary flex-1 justify-center"
        >
          Generate AI Breakdown
        </button>
      </div>
    </div>
  );
}

// ── Generating ──────────────────────────────────────────────────

function GeneratingScreen({ pageTitle, jobStatus, elapsed, onBack, onStartOver }) {
  const pct = Math.round((jobStatus?.progress || 0) * 100);
  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      {/* U2 part 33 (2026-05-09) — refactored to use shared BackButton.
          Originally F1 part 30 affordance during long pipeline runs
          (10-30 min). Pipeline continues background by design; click
          clears local state + returns to picker; pipeline surfaces via
          reconnect-to-active-job flow на next visit. */}
      {onBack && (
        <BackButton
          onClick={onBack}
          title="Pipeline continues in background. Return to picker; you can come back to this page anytime to see progress."
        />
      )}
      <div className="flex items-center gap-2 mb-1">
        <Spinner size={18} />
        <h2
          className="text-lg font-semibold"
          style={{ color: "var(--s2j-text)" }}
        >
          Generating breakdown
        </h2>
      </div>
      <p className="text-sm mb-4" style={{ color: "var(--s2j-text-light)" }}>
        {pageTitle}
      </p>

      {/* Progress bar */}
      <div
        className="w-full h-2 rounded-full overflow-hidden mb-2"
        style={{ background: "var(--s2j-border)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.max(pct, 2)}%`,
            background: "var(--s2j-blue)",
          }}
        />
      </div>
      <div className="flex justify-between text-sm mb-1">
        <span style={{ color: "var(--s2j-text-light)" }}>
          {jobStatus?.phase || "Starting..."}
        </span>
        <span className="font-semibold" style={{ color: "var(--s2j-blue)" }}>
          {pct}%
        </span>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--s2j-text-muted)" }}>
        {fmtTime(elapsed)} elapsed
      </p>

      {/* After ~10 min the bare spinner reads as "broken". Generation runs on
          Anthropic's async Batch API (chosen for cost + to dodge the sync/event
          timeouts — see gotcha #5), whose turnaround VARIES with Anthropic's
          queue load (typical 6-8 min, but slower under heavy Claude load). This
          reassurance appears only once we're past the usual window, so a slow
          batch reads as "still working", not "stuck". elapsed is in seconds. */}
      {elapsed >= 600 && (
        <div
          className="rounded-lg p-3 mb-4 flex items-start gap-2"
          style={{
            background: "var(--s2j-orange-bg)",
            border: "1px solid var(--s2j-orange-border)",
          }}
        >
          <span aria-hidden="true">⏳</span>
          <div>
            <p
              className="text-xs font-medium mb-1"
              style={{ color: "var(--s2j-text)" }}
            >
              Taking longer than usual — this is normal, nothing is broken
            </p>
            <p className="text-xs" style={{ color: "var(--s2j-text-light)" }}>
              Generation runs on Anthropic's Batch API, which can slow down when
              Claude is under heavy load. Your request is still processing and your
              breakdown will finish on its own — it is not lost.
            </p>
          </div>
        </div>
      )}

      <div
        className="rounded-lg p-3"
        style={{
          background: "var(--s2j-blue-bg)",
          border: "1px solid var(--s2j-blue-border)",
        }}
      >
        <p
          className="text-xs font-medium mb-1"
          style={{ color: "var(--s2j-text)" }}
        >
          You can close this panel
        </p>
        <p className="text-xs" style={{ color: "var(--s2j-text-light)" }}>
          The pipeline continues in the background. Reopen via ••• menu to check
          progress.
        </p>
      </div>
      {onStartOver && (
        <button
          type="button"
          onClick={onStartOver}
          className="mt-3 text-xs"
          style={{
            color: "var(--s2j-text-muted)",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textDecoration: "underline",
          }}
          title="Abandon this run and start over from the current page (e.g. you edited the spec after starting this generation)"
        >
          Started this before your latest edits? Start over
        </button>
      )}
    </div>
  );
}

// ── Confirm Push ────────────────────────────────────────────────
// v3.0.0 ConfirmScreen — embeds Dashboard signals at the push decision point.
//
// Replaces the standalone Dashboard screen (which users rarely discovered —
// flow was BreakdownEditor → push, не back-to-picker → Dashboard → push).
// PO / Scrum Master / engineering manager gets quality signals + concerns +
// dependency preview AT the moment they're about к commit Stories/Subtasks к
// JIRA — the only meaningful decision point.
//
// Surfaces (in priority order):
//   1. Spec quality rating (TrustCard) — overall_quality + averageScore
//   2. Count summary (Stories + Subtasks + dependency links + project)
//   3. Concerns to review — high/medium/low severity ranking от spec_concerns
//   4. Confidence distribution (✓/⚠/✗) с feature-level concern counts
//   5. Categories breakdown ako multiple categories present
//   6. Ambiguity note от Sonnet's self-assessment
//   7. Action: Back to Editor | Create N Items в JIRA
function ConfirmScreen({
  dryRunResult,
  breakdown,
  truncationNote,
  isPushing,
  onConfirm,
  onBack,
  onBackToPicker,
  onRemoveDependency,
  onRestoreDependency,
}) {
  const total = dryRunResult?.total_items || 0;
  const epics = dryRunResult?.total_epics || 0;
  const stories = dryRunResult?.total_stories || 0;
  const tasks = dryRunResult?.total_subtasks || 0;
  const links = dryRunResult?.dependency_links || 0;
  const project = dryRunResult?.project_key || "(Settings)";

  // Extract v3 native signals от breakdown's _v3_original (preserved by
  // v3AdaptResultPayload at result-load time). Falls back gracefully когато
  // legacy-only shape (no _v3_original) — empty signals + counts still render.
  const signals = extractV3Signals(breakdown || {});
  const sortedSpecConcerns = sortConcernsBySeverity(signals.parsedSpecConcerns);
  const qualityPalette = signals.overallQuality
    ? QUALITY_PALETTE[signals.overallQuality]
    : null;

  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      {onBackToPicker && (
        <BackButton
          onClick={onBackToPicker}
          title="Discard edits and return to page picker (use 'Back to Editor' below to keep edits)"
        />
      )}
      <h2
        className="text-lg font-semibold mb-2"
        style={{ color: "var(--s2j-text)" }}
      >
        Review and Push to JIRA
      </h2>
      {signals.specSummary && (
        <p
          className="text-sm mb-5"
          style={{ color: "var(--s2j-text-muted)" }}
        >
          {signals.specSummary}
        </p>
      )}

      {/* Partial-breakdown warning — generation output hit the token cap and was
          salvaged, so later features may be missing. Surfaced at the push
          decision point so the user doesn't create an incomplete JIRA set
          unknowingly (truncation_note forwarded by getResults). */}
      {truncationNote && (
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
              Partial breakdown — some features may be missing
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--s2j-text-light)" }}>
              {truncationNote}
            </p>
          </div>
        </div>
      )}

      {/* TrustCard — overall quality + confidence + average score */}
      {(qualityPalette || signals.confidence.total > 0) && (
        <div
          className="rounded-lg p-4 mb-4"
          style={{
            background: "var(--s2j-bg-section)",
            border: "1px solid var(--s2j-border)",
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p
                className="text-xs font-medium uppercase tracking-wider mb-1"
                style={{ color: "var(--s2j-text-muted)" }}
              >
                AI self-check
              </p>
              {qualityPalette && (
                <p
                  className="text-base font-semibold"
                  style={{ color: qualityPalette.text }}
                >
                  {qualityPalette.label}
                </p>
              )}
              <p
                className="text-xs mt-1"
                style={{ color: "var(--s2j-text-muted)", maxWidth: "34ch" }}
              >
                The AI's own confidence in this breakdown — a guide for where to
                look, not a guarantee.
              </p>
              {signals.confidence.averageScore !== null && (
                <p className="text-xs mt-1" style={{ color: "var(--s2j-text-muted)" }}>
                  Average self-rated confidence: {signals.confidence.averageScore}/100
                </p>
              )}
            </div>
            <div className="flex gap-4 text-sm">
              <ConfidenceBadge
                indicator="✓"
                count={signals.confidence["✓"]}
                color="var(--s2j-green)"
                label="Confident"
              />
              <ConfidenceBadge
                indicator="⚠"
                count={signals.confidence["⚠"]}
                color="var(--s2j-orange)"
                label="Unsure"
              />
              <ConfidenceBadge
                indicator="✗"
                count={signals.confidence["✗"]}
                color="var(--s2j-red)"
                label="Low confidence"
              />
            </div>
          </div>

          {/* Traceability worklist — names the ⚠/✗ features behind the counts so
              a "1 low-confidence" count is findable (✗ first). Without this the
              counts were a dead end (partner feedback 2026-05-31). */}
          {signals.confidence.flagged?.length > 0 && (
            <div
              className="mt-3 pt-3"
              style={{ borderTop: "1px solid var(--s2j-border)" }}
            >
              <p
                className="text-xs font-medium uppercase tracking-wider mb-2"
                style={{ color: "var(--s2j-text-muted)" }}
              >
                Needs your attention before push
              </p>
              <ul
                className="space-y-1"
                style={{ listStyle: "none", margin: 0, padding: 0 }}
              >
                {signals.confidence.flagged.slice(0, 6).map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <span
                      style={{
                        color:
                          f.indicator === "✗"
                            ? "var(--s2j-red)"
                            : "var(--s2j-orange)",
                        flexShrink: 0,
                      }}
                    >
                      {f.indicator}
                    </span>
                    <span
                      className="truncate"
                      style={{ color: "var(--s2j-text)" }}
                    >
                      {f.name}
                    </span>
                    {typeof f.score === "number" && (
                      <span
                        style={{ color: "var(--s2j-text-muted)", flexShrink: 0 }}
                      >
                        {f.score}/100
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {signals.confidence.flagged.length > 6 && (
                <p
                  className="text-xs mt-1"
                  style={{ color: "var(--s2j-text-muted)" }}
                >
                  +{signals.confidence.flagged.length - 6} more — find them in the
                  breakdown below
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Count summary — what will be created в JIRA */}
      <div
        className="rounded-lg p-4 mb-4"
        style={{
          background: "var(--s2j-bg-section)",
          border: "1px solid var(--s2j-border)",
        }}
      >
        <p
          className="text-xs font-medium uppercase tracking-wider mb-3"
          style={{ color: "var(--s2j-text-muted)" }}
        >
          What will be created
          {project !== "(Settings)" && ` — Project: ${project}`}
        </p>

        <div className="space-y-2 mb-3">
          {epics > 0 && (
            <SummaryRow label="Epics" value={epics} color="var(--s2j-blue)" />
          )}
          <SummaryRow
            label="Stories"
            value={stories}
            color="var(--s2j-green)"
          />
          <SummaryRow
            label="Subtasks"
            value={tasks}
            color="var(--s2j-orange)"
          />
        </div>

        <div
          className="pt-3"
          style={{ borderTop: "1px solid var(--s2j-border)" }}
        >
          <div className="flex justify-between text-sm">
            <span
              className="font-semibold"
              style={{ color: "var(--s2j-text)" }}
            >
              Total items
            </span>
            <span
              className="font-mono font-semibold"
              style={{ color: "var(--s2j-text)" }}
            >
              {total}
            </span>
          </div>
          {links > 0 && (
            <div className="flex justify-between text-xs mt-1">
              <span style={{ color: "var(--s2j-text-muted)" }}>
                Dependency links (Story-blocks-Story)
              </span>
              <span
                className="font-mono"
                style={{ color: "var(--s2j-text-light)" }}
              >
                {links}
              </span>
            </div>
          )}
          {signals.counts.sharedACs > 0 && (
            <div className="flex justify-between text-xs mt-1">
              <span style={{ color: "var(--s2j-text-muted)" }}>
                Cross-cutting rules (shared ACs)
              </span>
              <span
                className="font-mono"
                style={{ color: "var(--s2j-text-light)" }}
              >
                {signals.counts.sharedACs}
              </span>
            </div>
          )}
          {signals.categories.length > 1 && (
            <div className="flex justify-between text-xs mt-1">
              <span style={{ color: "var(--s2j-text-muted)" }}>
                Categories
              </span>
              <span
                className="font-mono"
                style={{ color: "var(--s2j-text-light)" }}
              >
                {signals.categories.length}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Cross-feature dependency structure — shows WHICH feature depends on
          WHICH and lets the reviewer remove an over-inferred edge before push
          (partner request 2026-05-31). Always rendered: it self-guards (returns
          null when there are no active AND no removed edges), so it stays mounted
          even after the LAST active edge is removed — preserving the restore list. */}
      <DependencyStructure
        edges={signals.dependencyEdges}
        onRemove={onRemoveDependency}
        onRestore={onRestoreDependency}
      />

      {/* Spec-level concerns — risks/ambiguity/compliance ranked by severity */}
      {sortedSpecConcerns.length > 0 && (
        <div className="mb-4">
          <h3
            className="text-sm font-semibold mb-2 flex items-center gap-2"
            style={{ color: "var(--s2j-text)" }}
          >
            <span>⚠</span>
            <span>Review before push ({sortedSpecConcerns.length})</span>
          </h3>
          <p
            className="text-xs mb-3"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            Spec-level concerns surfaced by AI analysis. Address before push when severity is high.
          </p>
          <div className="space-y-2">
            {sortedSpecConcerns.map((concern, idx) => (
              <ConcernRow key={idx} concern={concern} />
            ))}
          </div>
        </div>
      )}

      {/* Feature-level concerns summary (count only — detail в editor) */}
      {signals.parsedFeatureConcerns.length > 0 && (
        <div
          className="rounded-lg p-3 mb-4 text-xs"
          style={{
            background: "var(--s2j-bg-section)",
            border: "1px solid var(--s2j-border)",
            color: "var(--s2j-text-muted)",
          }}
        >
          <strong style={{ color: "var(--s2j-text)" }}>
            +{signals.parsedFeatureConcerns.length} feature-level concerns
          </strong>{" "}
          attached to individual features (review in the editor). High-severity{" "}
          {
            signals.parsedFeatureConcerns.filter((c) => c.severity === "high")
              .length
          }{" "}
          · Medium{" "}
          {
            signals.parsedFeatureConcerns.filter((c) => c.severity === "medium")
              .length
          }{" "}
          · Low{" "}
          {
            signals.parsedFeatureConcerns.filter((c) => c.severity === "low")
              .length
          }
        </div>
      )}

      {/* Ambiguity note — Sonnet self-disclosed assumption boundary */}
      {signals.ambiguityNote && (
        <details
          className="mb-4 rounded-lg"
          style={{
            border: "1px solid var(--s2j-border)",
            background: "var(--s2j-bg-section)",
          }}
        >
          <summary
            className="cursor-pointer text-xs font-medium uppercase tracking-wider p-3"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            AI ambiguity note
          </summary>
          <div
            className="p-3 pt-0 text-xs"
            style={{
              color: "var(--s2j-text)",
              borderTop: "1px solid var(--s2j-border)",
            }}
          >
            {signals.ambiguityNote}
          </div>
        </details>
      )}

      {/* Final action */}
      <div
        className="rounded-lg p-3 mb-4"
        style={{
          background: "var(--s2j-orange-bg)",
          border: "1px solid var(--s2j-orange-border)",
        }}
      >
        <p className="text-xs" style={{ color: "var(--s2j-text)" }}>
          This will create real JIRA issues. The action cannot be undone from within Spec2Tickets.
        </p>
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="btn-secondary" disabled={isPushing}>
          ← Back to Editor
        </button>
        <button
          onClick={onConfirm}
          className="btn-primary flex-1 justify-center"
          disabled={isPushing}
        >
          {isPushing ? (
            <>
              <Spinner size={14} />
              <span>Creating {total} items...</span>
            </>
          ) : (
            `Create ${total} Items in JIRA`
          )}
        </button>
      </div>
    </div>
  );
}

// v3.0.0 — cross-feature dependency structure for the Review screen (interactive).
//
// The "What will be created" card shows only a COUNT of dependency links, which
// hides WHICH feature depends on WHICH. This renders the actual edges, grouped by
// source feature, AND lets the reviewer remove an edge that doesn't belong (e.g.
// an over-inferred dependency) before pushing.
//
// Data: edges = signals.dependencyEdges = [{source, target}] where `source` is
// the feature that depends on `target` (v3Schema.extractV3Signals; mirrors
// prompts.js rule 11 — feature.dependencies lists what THIS feature needs). In
// JIRA each edge becomes a Story-blocks-Story link — `target` blocks `source`
// (the dependency must be completed first).
//
// Remove/restore call back to the parent (onRemove/onRestore), which mutates the
// breakdown JSON the push reads — NOT just this view — so a removed edge is not
// recreated in JIRA. `removed` is local UI state only: it drives the restore
// affordance and resets when the screen remounts (a fresh review session).
function DependencyStructure({ edges, onRemove, onRestore }) {
  const [removed, setRemoved] = useState([]);

  const handleRemove = (source, target) => {
    onRemove?.(source, target);
    setRemoved((prev) =>
      prev.some((r) => r.source === source && r.target === target)
        ? prev
        : [...prev, { source, target }],
    );
  };
  const handleRestore = (source, target) => {
    onRestore?.(source, target);
    setRemoved((prev) =>
      prev.filter((r) => !(r.source === source && r.target === target)),
    );
  };

  // Group active targets by source feature, preserving first-seen order. Dedupe a
  // repeated (source,target) pair defensively (a malformed breakdown could list
  // the same dependency twice — show it once).
  const bySource = new Map();
  for (const e of edges || []) {
    if (!e || !e.source || !e.target) continue;
    if (!bySource.has(e.source)) bySource.set(e.source, []);
    const targets = bySource.get(e.source);
    if (!targets.includes(e.target)) targets.push(e.target);
  }
  const groups = Array.from(bySource.entries());

  // Nothing active AND nothing removed → render nothing.
  if (groups.length === 0 && removed.length === 0) return null;

  return (
    <div className="mb-4">
      {groups.length > 0 && (
        <>
          <h3
            className="text-sm font-semibold mb-1 flex items-center gap-2"
            style={{ color: "var(--s2j-text)" }}
          >
            <span aria-hidden="true">🔗</span>
            <span>Cross-feature dependencies ({edges.length})</span>
          </h3>
          <p className="text-xs mb-3" style={{ color: "var(--s2j-text-muted)" }}>
            Each becomes a Story-blocks-Story link in JIRA — the feature it depends on
            must be completed first. Remove any that don't belong before pushing.
          </p>
        </>
      )}

      {groups.length > 0 && (
        <div
          className="rounded-lg p-3"
          style={{
            background: "var(--s2j-bg-section)",
            border: "1px solid var(--s2j-border)",
          }}
        >
          <ul
            className="space-y-2"
            style={{ listStyle: "none", margin: 0, padding: 0 }}
          >
            {groups.map(([source, targets], gIdx) => {
              const isLast = gIdx === groups.length - 1;
              return (
                <li
                  key={source}
                  style={{
                    paddingBottom: isLast ? 0 : 8,
                    borderBottom: isLast
                      ? "none"
                      : "1px dashed var(--s2j-border)",
                  }}
                >
                  <div
                    className="text-xs font-medium leading-tight"
                    style={{ color: "var(--s2j-text)" }}
                  >
                    {source}
                  </div>
                  <ul
                    className="mt-1 space-y-0.5"
                    style={{ listStyle: "none", margin: 0, padding: 0 }}
                  >
                    {targets.map((t, tIdx) => (
                      <li
                        key={tIdx}
                        className="flex items-center justify-between gap-2 text-xs leading-snug"
                      >
                        <span
                          className="flex items-start gap-1.5"
                          style={{ minWidth: 0 }}
                        >
                          <span style={{ color: "var(--s2j-blue)", flexShrink: 0 }}>
                            depends on →
                          </span>
                          <span style={{ color: "var(--s2j-text-light)" }}>{t}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemove(source, t)}
                          title={`Remove this dependency — "${source}" will no longer be blocked by "${t}" in JIRA`}
                          aria-label={`Remove dependency: ${source} depends on ${t}`}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--s2j-text-muted)",
                            cursor: "pointer",
                            flexShrink: 0,
                            padding: "0 4px",
                            lineHeight: 1,
                            fontSize: "13px",
                          }}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {removed.length > 0 && (
        <div
          className="mt-2 rounded-lg p-3"
          style={{
            background: "var(--s2j-bg-section)",
            border: "1px dashed var(--s2j-border)",
          }}
        >
          <p
            className="text-[11px] font-medium uppercase tracking-wider mb-2"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            Removed — won't be pushed to JIRA ({removed.length})
          </p>
          <ul
            className="space-y-1"
            style={{ listStyle: "none", margin: 0, padding: 0 }}
          >
            {removed.map((r, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span
                  style={{
                    color: "var(--s2j-text-muted)",
                    textDecoration: "line-through",
                    minWidth: 0,
                  }}
                >
                  {r.source} → {r.target}
                </span>
                <button
                  type="button"
                  onClick={() => handleRestore(r.source, r.target)}
                  title="Restore this dependency"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--s2j-blue)",
                    cursor: "pointer",
                    flexShrink: 0,
                    padding: "0 4px",
                    fontWeight: 500,
                  }}
                >
                  ↩ Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// v3.0.0 — confidence indicator с count badge
function ConfidenceBadge({ indicator, count, color, label }) {
  return (
    <div className="text-center">
      <div
        className="text-xl font-bold leading-none"
        style={{ color: count > 0 ? color : "var(--s2j-text-light)" }}
      >
        {indicator} {count}
      </div>
      <div
        className="text-[10px] uppercase tracking-wider mt-1"
        style={{ color: "var(--s2j-text-muted)" }}
      >
        {label}
      </div>
    </div>
  );
}

// v3.0.0 — single concern row с severity badge + type label
function ConcernRow({ concern }) {
  const palette = SEVERITY_PALETTE[concern.severity] || SEVERITY_PALETTE.medium;
  const typeLabel = CONCERN_TYPE_LABEL[concern.type] || concern.type;
  return (
    <div
      className="rounded-lg p-3 text-sm"
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: "var(--s2j-text)",
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{
            background: palette.text,
            color: "white",
          }}
        >
          {concern.severity}
        </span>
        <span
          className="text-xs font-semibold"
          style={{ color: palette.text }}
        >
          {typeLabel}
        </span>
      </div>
      <p style={{ color: "var(--s2j-text)" }}>{concern.text}</p>
    </div>
  );
}

function SummaryRow({ label, value, color }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-2.5 h-2.5 rounded-sm"
          style={{ background: color }}
        />
        <span style={{ color: "var(--s2j-text)" }}>{label}</span>
      </div>
      <span className="font-mono font-semibold" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

// ── Pushing (in-progress, chunked) ──────────────────────────────

function PushingScreen({ progress, phase }) {
  const pct = Math.round((progress || 0) * 100);
  const phaseLabel =
    phase === "stories"
      ? "Creating stories..."
      : phase === "subtasks"
        ? "Creating subtasks..."
        : phase === "links"
          ? "Linking dependencies..."
          : phase === "starting"
            ? "Setting up..."
            : "Working...";
  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      <div className="flex items-center gap-2 mb-3">
        <Spinner size={18} />
        <h2 className="text-lg font-semibold" style={{ color: "var(--s2j-text)" }}>
          Creating issues in JIRA
        </h2>
      </div>
      <p className="text-sm mb-4" style={{ color: "var(--s2j-text-muted)" }}>
        {phaseLabel}
      </p>

      {/* Progress bar */}
      <div
        className="w-full rounded-full overflow-hidden mb-2"
        style={{ height: "10px", background: "var(--s2j-bg-section)" }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "var(--s2j-green)",
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <p className="text-xs" style={{ color: "var(--s2j-text-light)" }}>
        {pct}% complete · keep this panel open until it finishes (~10–60 sec
        depending on size). Closing now may leave a partial push.
      </p>
    </div>
  );
}

// ── Pushed (Success) ────────────────────────────────────────────

function PushedScreen({ result, onBack, onNew }) {
  const total = result?.total_items || result?.created_issues?.length || 0;
  const stories = result?.created_issues || [];
  const browseUrl = (key) =>
    result?.browse_base ? `${result.browse_base}/browse/${key}` : `/browse/${key}`;
  const openIssue = (key) => {
    try {
      router.open(browseUrl(key));
    } catch (_) {
      /* no-op if the bridge router is unavailable */
    }
  };
  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      <div
        className="rounded-lg p-4 mb-4"
        style={{
          background: "var(--s2j-green-bg)",
          border: "1px solid var(--s2j-green-border)",
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="10" fill="var(--s2j-green)" />
            <path
              d="M6 10l3 3 5-6"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--s2j-text)" }}
          >
            Pushed to JIRA
          </h2>
        </div>
        <p className="text-sm mb-1" style={{ color: "var(--s2j-text)" }}>
          {total} items created in project {result?.project_key || "unknown"}
        </p>
        <p className="text-xs" style={{ color: "var(--s2j-text-light)" }}>
          {result?.total_epics || 0} Epics · {result?.total_stories || 0}{" "}
          Stories ·{" "}
          {result?.subtasks_embedded
            ? `${result?.tasks_embedded || 0} tasks (as checklists)`
            : `${result?.total_subtasks || 0} Subtasks`}
          {result?.dependency_links_created
            ? ` · ${result.dependency_links_created} links`
            : ""}
        </p>
      </div>

      {(result?.epic_key || stories.length > 0) && (
        <div
          className="rounded-lg p-4 mb-4"
          style={{
            background: "var(--s2j-bg-section)",
            border: "1px solid var(--s2j-border)",
          }}
        >
          <p
            className="text-xs font-medium mb-2"
            style={{ color: "var(--s2j-text-light)" }}
          >
            Open in JIRA
          </p>
          {result?.epic_key && (
            <button
              onClick={() => openIssue(result.epic_key)}
              className="btn-secondary mb-3"
            >
              Open Epic {result.epic_key} ↗
            </button>
          )}
          {stories.length > 0 && (
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
              }}
            >
              {stories.map((s) => (
                <li key={s.key} style={{ padding: "3px 0" }}>
                  <button
                    onClick={() => openIssue(s.key)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      color: "var(--s2j-blue)",
                      textDecoration: "underline",
                      font: "inherit",
                    }}
                  >
                    {s.key}
                  </button>
                  <span
                    className="text-sm"
                    style={{ color: "var(--s2j-text-muted)" }}
                  >
                    {" "}
                    — {s.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Graceful-fallback note — project has no subtask type, tasks embedded
          as checklists in Story descriptions. Explains "0 Subtasks" honestly. */}
      {result?.subtasks_embedded && (result?.tasks_embedded || 0) > 0 && (
        <div
          className="rounded-lg p-3 mb-4 text-xs"
          style={{
            background: "var(--s2j-blue-bg)",
            border: "1px solid var(--s2j-blue-border)",
            color: "var(--s2j-text)",
          }}
        >
          <p className="font-medium mb-1">
            Tasks added as checklists ({result.tasks_embedded})
          </p>
          <p style={{ color: "var(--s2j-text-muted)" }}>
            This JIRA project has no Subtask issue type, so the task breakdown
            was embedded into each Story description as a checklist. To create
            them as separate Subtask issues, enable the Subtask type in project
            settings — or contact{" "}
            <a
              href="mailto:support@spec2jira.com"
              style={{ color: "var(--s2j-blue)", textDecoration: "underline" }}
            >
              support@spec2jira.com
            </a>
            .
          </p>
        </div>
      )}

      {/* Partial-failure surfacing — the push result returns failures: {stories,
          subtasks, links, details}. Surface counts + first few reasons so
          the user understands когато e.g. "0 Subtasks" appears. */}
      {(() => {
        const f = result?.failures;
        const failedStories = f?.stories || 0;
        const failedSubtasks = f?.subtasks || 0;
        const failedLinks = f?.links || 0;
        const totalFailed = failedStories + failedSubtasks + failedLinks;
        if (totalFailed === 0) return null;
        const parts = [];
        if (failedStories) parts.push(`${failedStories} Stories`);
        if (failedSubtasks) parts.push(`${failedSubtasks} Subtasks`);
        if (failedLinks) parts.push(`${failedLinks} links`);
        // First failure reason (most actionable — usually same root cause).
        // Link failures carry { source, target, reason } (not batchError), so
        // surface the specific blocked-by relationship — this is what lets a
        // customer describe the problem and lets us diagnose it from a report.
        const linkFail = f?.details?.links?.[0];
        const firstDetail =
          f?.details?.subtasks?.[0]?.batchError?.[0]?.message ||
          f?.details?.stories?.[0]?.batchError?.[0]?.message ||
          (linkFail
            ? `Link "${linkFail.source}" → "${linkFail.target}": ${
                linkFail.reason || linkFail.detail || "could not be created"
              }`
            : null) ||
          null;
        return (
          <div
            className="rounded-lg p-3 mb-4"
            style={{
              background: "var(--s2j-orange-bg)",
              border: "1px solid var(--s2j-orange-border)",
            }}
          >
            <p
              className="text-xs font-medium mb-1"
              style={{ color: "var(--s2j-text)" }}
            >
              {parts.join(" · ")} could not be created
            </p>
            {firstDetail && (
              <p className="text-xs mb-1" style={{ color: "var(--s2j-text-muted)" }}>
                Reason: {String(firstDetail).substring(0, 200)}
              </p>
            )}
            <p className="text-xs" style={{ color: "var(--s2j-text-muted)" }}>
              Need help?{" "}
              <a
                href="mailto:support@spec2jira.com"
                style={{ color: "var(--s2j-blue)", textDecoration: "underline" }}
              >
                support@spec2jira.com
              </a>
            </p>
          </div>
        );
      })()}

      {/* F3 misplacement fix part 32 (2026-05-09) — "Run again on this
          page" was removed because re-running на same page POST-PUSH
          would create duplicate JIRA tickets (semantically wrong post-
          push context). "Generate Another" renamed → "Generate on new
          page" для clarity (explicitly indicates picker-route to a
          different page, avoiding "another what?" ambiguity). */}
      <div className="flex gap-3">
        <button onClick={onBack} className="btn-secondary">
          Back to Editor
        </button>
        <button onClick={onNew} className="btn-secondary">
          Generate on new page
        </button>
      </div>
    </div>
  );
}

// ── Error ───────────────────────────────────────────────────────

// ── Limit reached / subscription required ───────────────────────
// A NORMAL freemium state (not an error) — friendly framing, no "Something went
// wrong", no pointless "Try again", no support-as-primary. Drives THREE situations
// from one screen (the routing sets `quota`):
//
//   1. Free monthly quota exhausted (quota_exceeded, fairUse=false) — used all 3
//      free breakdowns. Path forward: subscribe to BYOK Pro OR Managed Pro.
//   2. Managed Pro fair-use cap hit (quota_exceeded, fairUse=true) — we run Claude
//      and pay compute, so the cap is fair-use, not a trial wall. Path forward:
//      switch to BYOK Pro (unlimited with the customer's own key), NOT "buy higher".
//   3. Push gate (push_requires_license) — a Free user generated + reviewed but
//      Free can't create issues in JIRA. Path forward: subscribe to either edition.
//
// The backend composes a correct `detail` for each (tier-aware) — we PREFER showing
// it. Edition prices come from quota.pricing[] (single source — never hardcoded).
//
// UPGRADE_URL — where the CTA sends the user. The exact per-listing Marketplace
// subscription deep link only exists once the paid listing is live (P3b); until then
// we send them to the Atlassian admin hub, where app subscriptions are managed
// (universal — no per-site / per-listing URL needed). Set to null to fall back to
// info-only (no button); refine to the exact listing subscription URL once known.
const UPGRADE_URL = "https://admin.atlassian.com/";

// One edition row in the subscription card (label + price + one-line value prop).
function EditionRow({ name, price, blurb }) {
  if (!price) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <div style={{ minWidth: 0 }}>
        <span className="text-sm font-medium" style={{ color: "var(--s2j-text)" }}>
          {name}
        </span>
        <span className="text-xs ml-2" style={{ color: "var(--s2j-text-light)" }}>
          {blurb}
        </span>
      </div>
      <span
        className="text-sm font-semibold shrink-0"
        style={{ color: "var(--s2j-text)" }}
      >
        {price}
      </span>
    </div>
  );
}

function LimitReachedScreen({ quota, onBack }) {
  // Mode from the routing payload. push_requires_license → push gate; otherwise a
  // quota_exceeded payload, split by fairUse (Managed cap vs Free trial).
  const isPushGate = quota?.error === "push_requires_license";
  const isFairUse = !isPushGate && !!quota?.fairUse;

  const limit = quota?.limit ?? 3;
  const resetsAt =
    quota?.resetsAtLabel ||
    (quota?.resetsAt ? String(quota.resetsAt).slice(0, 10) : null);
  const byokProPrice = quota?.upgradePrice || findPrice(quota, "byokPro");
  const managedProPrice = findPrice(quota, "managedPro");

  // Headline + intro. Prefer the backend-composed `detail` for the body (it is
  // already tier-correct and mentions the reset date / prices); fall back to a
  // mode-specific sentence if it is ever absent.
  const heading = isPushGate
    ? "Subscribe to push to JIRA"
    : isFairUse
      ? "You've reached this month's fair-use limit"
      : "You've reached your free limit";
  const fallbackBody = isPushGate
    ? "Free includes Generate + Review. Subscribe to BYOK Pro or Managed Pro to create the issues in JIRA."
    : isFairUse
      ? `You've used all ${limit} breakdowns in this month's fair-use allowance.`
      : `You've used all ${limit} free breakdowns this month.`;

  const openUpgrade = () => {
    if (!UPGRADE_URL) return;
    try {
      router.open(UPGRADE_URL);
    } catch (_) {
      /* no-op if the bridge router is unavailable */
    }
  };

  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      {onBack && (
        <BackButton onClick={onBack} title="Return to the page picker" />
      )}

      <div
        className="rounded-lg p-4 mb-4"
        style={{
          background: "var(--s2j-blue-bg)",
          border: "1px solid var(--s2j-blue-border)",
        }}
      >
        <h2 className="text-lg font-semibold mb-1" style={{ color: "var(--s2j-text)" }}>
          {heading}
        </h2>
        <p className="text-sm" style={{ color: "var(--s2j-text)" }}>
          {quota?.detail || fallbackBody}
        </p>
        {/* Reset date is the actionable info for a Free/Managed user who is waiting
            it out rather than subscribing. The push gate has no monthly reset. */}
        {!isPushGate && !quota?.detail && resetsAt && (
          <p className="text-sm mt-1" style={{ color: "var(--s2j-text-light)" }}>
            Your quota resets on <strong>{resetsAt}</strong>.
          </p>
        )}
      </div>

      {/* Subscription card. Fair-use (Managed) routes to BYOK Pro ONLY (unlimited);
          Free quota + push gate offer BOTH editions. */}
      {(byokProPrice || managedProPrice) && (
        <div
          className="rounded-lg p-4 mb-4"
          style={{
            background: "var(--s2j-green-bg)",
            border: "1px solid var(--s2j-green-border)",
          }}
        >
          <p
            className="text-xs font-medium uppercase tracking-wider mb-2"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            {isFairUse ? "For unlimited" : "Choose a plan"}
          </p>

          {isFairUse ? (
            <EditionRow
              name="BYOK Pro"
              price={byokProPrice}
              blurb="unlimited — use your own Anthropic key"
            />
          ) : (
            <>
              <EditionRow
                name="BYOK Pro"
                price={byokProPrice}
                blurb="unlimited — bring your own Anthropic key"
              />
              <EditionRow
                name="Managed Pro"
                price={managedProPrice}
                blurb="we run Claude for you — no API key needed"
              />
            </>
          )}

          {UPGRADE_URL && (
            <>
              <button onClick={openUpgrade} className="btn-primary mt-3">
                {isFairUse ? "Switch to BYOK Pro" : "Subscribe"}
              </button>
              <p
                className="text-xs"
                style={{ color: "var(--s2j-text-light)", marginTop: 8 }}
              >
                Subscriptions are managed by your Atlassian site admin.
              </p>
            </>
          )}
        </div>
      )}

      <button onClick={onBack} className="btn-secondary">
        ← Back to pages
      </button>
    </div>
  );
}

function ErrorScreen({ error, onRetry, onBackToPicker }) {
  // EH1 polish part 27 (2026-05-09) — last-resort defensive HTML strip.
  // Most error paths now route through `_classifyBackendError` which
  // discards HTML detail bodies, but legacy paths (mid-pipeline polling
  // errors / unanticipated shapes) may still leak HTML into the error
  // string. Detect "<html>" prefix → replace с friendly fallback so
  // ErrorScreen never shows raw markup to the user.
  const rawError = typeof error === "string" ? error : JSON.stringify(error);
  const hasHtml = /<html|<!doctype/i.test(rawError);
  const displayError = hasHtml
    ? "Backend returned an unexpected response. The service may be unreachable or misconfigured. Verify Settings → Manage Apps → Spec2Tickets → Configure."
    : rawError;
  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      {/* U2 part 33 (2026-05-09) — top-of-content back-to-picker
          affordance, conditionally rendered когато pageData was bound
          (App.js passes onBackToPicker={pageData ? handleNewPage : null}).
          When user reached error без pageData (e.g., picker manual ID
          entry → fetchPage 404), handleRetry already routes to picker
          defensively — separate top button is redundant. */}
      {onBackToPicker && (
        <BackButton
          onClick={onBackToPicker}
          title="Abandon this page and return to picker (use 'Try again' below to retry the same page)"
        />
      )}
      <div
        className="rounded-lg p-4 mb-4"
        style={{
          background: "var(--s2j-red-bg)",
          border: "1px solid var(--s2j-red-border)",
        }}
      >
        <p
          className="text-sm font-medium mb-1"
          style={{ color: "var(--s2j-red)" }}
        >
          Something went wrong
        </p>
        <p className="text-xs" style={{ color: "var(--s2j-text)" }}>
          {displayError}
        </p>
      </div>

      <button onClick={onRetry} className="btn-secondary">
        ← Try again
      </button>

      {/* Universal support escape-hatch — for anything the user can't
          self-resolve (auth, project config, custom fields, etc). */}
      <div
        className="mt-5 pt-4 text-xs"
        style={{
          borderTop: "1px solid var(--s2j-border)",
          color: "var(--s2j-text-muted)",
        }}
      >
        Still stuck? We're here to help —{" "}
        <a
          href="mailto:support@spec2jira.com"
          style={{ color: "var(--s2j-blue)", textDecoration: "underline" }}
        >
          support@spec2jira.com
        </a>
      </div>
    </div>
  );
}

/**
 * SetupScreen — shown when Spec2Tickets is not yet configured.
 * Complements AdminSettings (does not repeat its content).
 *
 * Surfaces to customer:
 *   - Prerequisite (BYOK): an Anthropic API key + a JIRA project key
 *   - Navigation path: how to reach Settings to configure them
 */
function SetupScreen({ message }) {
  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      <div
        className="rounded-lg p-5 mb-4"
        style={{
          background: "var(--s2j-blue-bg)",
          border: "1px solid var(--s2j-blue-border)",
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle
              cx="10"
              cy="10"
              r="9"
              stroke="var(--s2j-blue)"
              strokeWidth="2"
            />
            <path
              d="M10 6v5M10 13.5v.5"
              stroke="var(--s2j-blue)"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <h2
            className="text-base font-semibold"
            style={{ color: "var(--s2j-text)" }}
          >
            Setup Required
          </h2>
        </div>

        <p className="text-sm mb-3" style={{ color: "var(--s2j-text)" }}>
          Spec2Tickets needs to be configured before first use.
        </p>

        {/* v3.0.0 BYOK prerequisite — customer needs Anthropic key + JIRA project */}
        <p className="text-sm mb-3" style={{ color: "var(--s2j-text)" }}>
          <strong>You will need:</strong>
          <br />
          • An Anthropic API key (sign up at{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--s2j-blue)", textDecoration: "underline" }}
          >
            console.anthropic.com → API Keys
          </a>
          ; billed pay-as-you-go to your own Anthropic account)
          <br />• A JIRA project key where the breakdown will be created
        </p>

        <div
          className="rounded p-3 text-xs leading-relaxed"
          style={{
            background: "var(--s2j-bg)",
            color: "var(--s2j-text-light)",
          }}
        >
          <p className="font-medium mb-1" style={{ color: "var(--s2j-text)" }}>
            How to configure:
          </p>
          <p>
            1. Go to <strong>Confluence Settings</strong> (gear icon, top right)
          </p>
          <p>
            2. Click <strong>Apps → Manage Apps</strong>
          </p>
          <p>
            3. Find <strong>Spec2Tickets Settings</strong> in the left sidebar
          </p>
          <p>
            4. Paste your Anthropic API key + JIRA Project Key, then Test &amp;
            Save
          </p>
          <p style={{ marginTop: "6px", fontStyle: "italic" }}>
            Powered by Claude Sonnet 4.6 — your spec content flows directly from Forge to the Anthropic API using your own key. No data on Spec2Tickets servers.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Util ────────────────────────────────────────────────────────

// Look up a tier's display price from a getUsage/quota pricing[] array. The
// pricing table is the SINGLE source of €-values (composed server-side) — the UI
// never hardcodes prices, so a price change in usage.js flows through everywhere.
// Accepts the full usage/quota object OR a raw pricing array. Returns null if absent.
function findPrice(usageOrPricing, key) {
  const pricing = Array.isArray(usageOrPricing)
    ? usageOrPricing
    : usageOrPricing?.pricing;
  return (pricing || []).find((t) => t.key === key)?.price || null;
}

function fmtTime(s) {
  if (!s || s < 0) return "0s";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default App;
