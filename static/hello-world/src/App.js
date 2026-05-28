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
import DashboardScreen from "./components/Dashboard";
import BackButton from "./components/BackButton";
import "./index.css";

const POLL_MS = 5000;

const DOC_TYPES = [
  { value: "MODULE", label: "Module", desc: "One module or subsystem" },
  { value: "FEATURE", label: "Feature", desc: "Single feature or enhancement" },
  {
    value: "EPIC_PRODUCT",
    label: "Full Product",
    desc: "Multi-domain product spec",
  },
];

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
 * handlePreview, handlePush, handleViewDashboard, etc.).
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

  // Class 2: connection-related (sniff by error code or detail content)
  const isConnection =
    /Backend (502|503|504)/i.test(errorStr) ||
    /Backend unreachable/i.test(errorStr) ||
    /FORGE_FETCH_BLOCKED/i.test(errorStr) ||
    /BACKEND_UNREACHABLE/i.test(errorStr) ||
    /timeout/i.test(errorStr + detail) ||
    /network/i.test(errorStr + detail);
  if (isConnection) {
    return {
      message:
        "Backend is unreachable. Verify that the backend service is running and that Settings → Manage Apps → Spec2Tickets → Configure has the correct Backend URL.",
      routeToSetup: false,
    };
  }

  // Class 3: generic — pass through with optional context label
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
  const [documentType, setDocumentType] = useState("MODULE");

  // Slice 3 (Layer 1 Session 4 — CG-9 cache bypass, 2026-05-08).
  // ReadyScreen checkbox surfaces this; handleGenerate + handlePreview
  // pass to invoke. Default false → cache lookups normal (typical
  // re-run experience). User opts-in для fresh re-run when stochastic
  // phase output (T>0) freezes one variant OR debugging cache invalidation.
  const [bypassCache, setBypassCache] = useState(false);

  // Generation
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [startTime, setStartTime] = useState(null);
  const [elapsed, setElapsed] = useState(0);

  // Review + Push
  const [results, setResults] = useState(null);
  const [isPushing, setIsPushing] = useState(false);
  const [pushResult, setPushResult] = useState(null);

  // CG-7 spec linter pre-flight (Layer 1 Session 2, 2026-05-07)
  const [previewResult, setPreviewResult] = useState(null);

  // CG-12 manager-summary dashboard (2026-05-09).
  // View-only surface for completed pipeline results — does NOT bind
  // page (pageId/pageData stay independent от dashboard state). User
  // enters via PagePicker "View Dashboard" button per row. Back button
  // returns to picker; bound-page state stays untouched (was never set).
  // PagePicker UI state (query/scroll) resets on re-mount; recent list
  // re-fetches от KVS (KVS persists across mounts so user sees same
  // entries — но in-memory state само е fresh each visit).
  const [dashboardData, setDashboardData] = useState(null);
  const [dashboardSourcePage, setDashboardSourcePage] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState(null);

  // Confirmation flow
  const [dryRunResult, setDryRunResult] = useState(null);
  const [pendingBreakdown, setPendingBreakdown] = useState(null);

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

        // ═══ Gate 1 — Settings ═══
        const settings = await invoke("getSettings");

        if (!settings?.backendUrl) {
          setScreen("setup");
          return;
        }

        // ═══ Gate 2 — Connection ═══
        if (settings.lastTestOk !== true) {
          const tc = await invoke("testConnection", {
            backendUrl: settings.backendUrl,
            backendApiKey: settings.backendApiKey,
          });
          if (tc.status !== "ok") {
            setError(
              "Spec2Tickets is configured but cannot reach the backend. Open Settings to verify the connection.",
            );
            setScreen("setup");
            return;
          }
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
                statusResult.status === "pending")
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
  // CG-7: previewing screen shares the elapsed-time counter — pre-flight
  // takes ~30-90 sec, so visible timing helps user calibrate expectations
  // (vs full ~10-30 min generate).
  useEffect(() => {
    if ((screen === "generating" || screen === "previewing") && startTime) {
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
          } else if (st.kind === "preview") {
            // CG-7: preview kind routes to dedicated result screen.
            // Defensive split (M-2 self-review fix 2026-05-07) — kind alone
            // gates the branch; missing preview_result surfaces an explicit
            // error instead of silently falling to BreakdownEditor (which
            // would crash on a preview-shape payload).
            if (full.preview_result) {
              setPreviewResult(full.preview_result);
              setScreen("preview_result");
            } else {
              setError(
                "Preview completed but result payload is missing. Try again or contact support.",
              );
              setScreen("error");
            }
          } else {
            setResults(full.result || full);
            setScreen("reviewing");
          }
        } else if (st.status === "failed") {
          clearInterval(pollRef.current);
          // Session 3 C1 forensic: leave jobStatus.partial_breakdown
          // intact — ErrorScreen surfaces last-known state to caller.
          setError(st.error || "Pipeline failed");
          setScreen("error");
        }
      } catch (e) {
        console.error("Poll error:", e);
      }
    }, POLL_MS);
  }, []);

  // ── Page selection routing (post globalPage migration) ───────
  // routeByPageStatus is shared между init's reconnect path AND
  // handlePageSelected (picker → editor handoff). Mirrors the old
  // init's gate 3 routing: active job → generating/previewing screen
  // с polling resumed; completed → reviewing/preview_result;
  // busy_other → error; idle → ready. Sets pageId + pageData как
  // side-effect.
  const routeByPageStatus = useCallback(
    async (pageRef, pageResult, statusResult) => {
      setPageId(String(pageRef.id));
      setPageData(pageResult);

      if (
        statusResult.status === "running" ||
        statusResult.status === "pending"
      ) {
        setJobId(statusResult.job_id);
        setJobStatus(statusResult);
        setStartTime(Date.now() - (statusResult.elapsed_seconds || 0) * 1000);
        setElapsed(Math.floor(statusResult.elapsed_seconds || 0));
        // CG-7 reconnect: preview kind reaches its own progress screen.
        setScreen(
          statusResult.kind === "preview" ? "previewing" : "generating",
        );
        startPolling(statusResult.job_id);
        return;
      }

      if (statusResult.status === "completed") {
        const full = await invoke("getResults", {
          jobId: statusResult.job_id,
        });
        // CG-7 reconnect: preview kind routes to dedicated result screen
        // (job_store.to_result_dict pivots payload by kind — preview
        // returns under preview_result key, generate under result key).
        // Defensive split (M-2 self-review fix 2026-05-07) — kind="preview"
        // без preview_result surfaces explicit error rather than silent
        // fallback to "ready" (which loses the result without warning).
        if (statusResult.kind === "preview") {
          if (full.preview_result) {
            setPreviewResult(full.preview_result);
            setScreen("preview_result");
            return;
          }
          setError(
            "Preview job completed but result payload is missing. Try again.",
          );
          setScreen("error");
          return;
        }
        if (full.result?.breakdown) {
          setResults(full.result);
          setScreen("reviewing");
          return;
        }
      }

      if (statusResult.status === "busy_other") {
        setError(
          `Pipeline is processing "${statusResult.active_page_title}". Try again later.`,
        );
        setScreen("error");
        return;
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

    const result = await invoke("startGeneration", {
      pageId: pageData.page_id,
      documentType,
      modelMode: "dual",
      // Slice 3 (CG-9, 2026-05-08): bypassCache от ReadyScreen checkbox
      // state. Forge resolver translates camelCase → snake_case body field.
      bypassCache,
    });

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
    if (result.busy) {
      setError(`Pipeline busy: ${result.active_phase}`);
      setScreen("error");
      return;
    }

    setJobId(result.job_id);
    startPolling(result.job_id);
  }, [pageData, documentType, bypassCache, startPolling]);

  // ── Start preview (CG-7 spec linter pre-flight) ─────────────
  // Backend POST /api/v1/specs/preview/{page_id} — Phase 0 routing +
  // Phase 0b constraint extraction only (~30-90 sec). Backend returns
  // 423 если pipeline busy (preview shares GPU lock с generate).
  // Polling reuses startPolling — kind="preview" routes to result
  // screen via st.kind branch.
  const handlePreview = useCallback(async () => {
    setScreen("previewing");
    setStartTime(Date.now());
    setElapsed(0);
    setJobStatus({ progress: 0, phase: "Starting pre-flight..." });

    const result = await invoke("startPreview", {
      pageId: pageData.page_id,
      // Slice 3 (CG-9, 2026-05-08): bypassCache от ReadyScreen checkbox
      // state. Preview-side cache covers Phase 0 (atomic) + Phase 0b/0c
      // (per-section); bypass forces fresh re-run.
      bypassCache,
    });

    if (result.error) {
      // EH1 polish part 27 — friendly classifier replaces raw error string.
      const friendly = _classifyBackendError(result, "Preview failed");
      if (friendly.routeToSetup) {
        setError(friendly.message);
        setScreen("setup");
        return;
      }
      setError(friendly.message);
      setScreen("error");
      return;
    }
    if (result.busy) {
      setError(`Pipeline busy: ${result.active_phase || "another job"}`);
      setScreen("error");
      return;
    }

    setJobId(result.job_id);
    startPolling(result.job_id);
  }, [pageData, bypassCache, startPolling]);

  // ── Push: Step 1 — dry run → confirming screen ───────────────
  const handlePush = useCallback(async (editedBreakdown) => {
    setIsPushing(true);
    try {
      const preview = await invoke("dryRun", { breakdown: editedBreakdown });

      if (preview.error) {
        // EH1 polish part 27 — friendly classifier replaces raw error string.
        const friendly = _classifyBackendError(preview, "Validation failed");
        if (friendly.routeToSetup) {
          setError(friendly.message);
          setScreen("setup");
          return;
        }
        setError(friendly.message);
        setScreen("error");
        return;
      }
      if (preview.busy) {
        setError(`Pipeline busy: ${preview.active_phase || "unknown"}`);
        setScreen("error");
        return;
      }

      setPendingBreakdown(editedBreakdown);
      setDryRunResult(preview);
      setScreen("confirming");
    } catch (err) {
      setError(err.message || "Validation failed");
      setScreen("error");
    } finally {
      setIsPushing(false);
    }
  }, []);

  // ── Push: Step 2 — confirmed → async create in JIRA ────────
  const handleConfirmedPush = useCallback(async () => {
    setIsPushing(true);
    try {
      const start = await invoke("pushToJira", { breakdown: pendingBreakdown });

      if (start.error) {
        // EH1 polish part 27 — friendly classifier replaces raw error string.
        const friendly = _classifyBackendError(start, "Push to JIRA failed");
        if (friendly.routeToSetup) {
          setError(friendly.message);
          setScreen("setup");
          setIsPushing(false);
          return;
        }
        setError(friendly.message);
        setScreen("error");
        return;
      }

      // Backend returns {job_id, status: "running"} — poll for result
      const pushJobId = start.job_id;
      pushPollRef.current = setInterval(async () => {
        try {
          const st = await invoke("pollPushStatus", { jobId: pushJobId });

          if (st.error) {
            clearInterval(pushPollRef.current);
            setError(st.error);
            setScreen("error");
            setIsPushing(false);
            return;
          }

          if (st.status === "completed") {
            clearInterval(pushPollRef.current);
            setPushResult(st.result);
            setScreen("pushed");
            setIsPushing(false);
          } else if (st.status === "failed") {
            clearInterval(pushPollRef.current);
            setError(st.error || "Push to JIRA failed");
            setScreen("error");
            setIsPushing(false);
          }
          // status === 'running' → keep polling
        } catch (e) {
          console.error("Push poll error:", e);
        }
      }, 3000);
    } catch (err) {
      setError(err.message || "Push failed");
      setScreen("error");
      setIsPushing(false);
    }
  }, [pendingBreakdown]);

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
    setPreviewResult(null);
    setPushResult(null);
    setDryRunResult(null);
    setPendingBreakdown(null);
    setIsPushing(false);
    setScreen(pageData ? "ready" : "picker");
  }, [pageData]);

  // handleNewPage — clear page binding, return to picker. Used от
  // PushedScreen "Generate Another" (post-push, user wants different
  // spec). Resets bypassCache (page-specific power-user setting).
  const handleNewPage = useCallback(() => {
    clearInterval(pollRef.current);
    clearInterval(pushPollRef.current);
    setError(null);
    setPageId(null);
    setPageData(null);
    setJobId(null);
    setJobStatus(null);
    setResults(null);
    setPreviewResult(null);
    setPushResult(null);
    setDryRunResult(null);
    setPendingBreakdown(null);
    setIsPushing(false);
    setBypassCache(false);
    setScreen("picker");
  }, []);

  const handleBackToReview = useCallback(() => {
    setDryRunResult(null);
    setPushResult(null);
    setScreen("reviewing");
  }, []);

  // ── Dashboard navigation (CG-12, 2026-05-09) ─────────────────
  // handleViewDashboard — picker hands off a page reference; we
  // resolve its latest completed job via getGenerationStatus, then
  // load the result_payload via getResults. На no-result OR transient
  // errors, surface DashboardEmptyState (D9.A) — better UX than error
  // screen since "no results yet" is а valid steady state.
  //
  // Does NOT bind the page (no setPageData/setPageId) — dashboard is
  // view-only. If user wants to edit, они return to picker + click
  // primary "Open" button.
  const handleViewDashboard = useCallback(async (pageRef) => {
    setDashboardSourcePage(pageRef);
    setDashboardData(null);
    setDashboardError(null);
    setDashboardLoading(true);
    setScreen("dashboard");

    try {
      const statusResult = await invoke("getGenerationStatus", {
        pageId: pageRef.id,
      });

      // H-2 self-review fix 2026-05-09 — backendGet wraps error/busy
      // responses as {error, detail} OR {busy, active_phase} shapes
      // BEFORE the status field is ever populated. Without these guards,
      // a real backend 503 / not-configured / busy-other surfaces as
      // empty-state ("No results yet") which misleads users — the
      // truth is operational. Mirror startPolling's `if (st.error)`
      // pattern for consistency.
      //
      // B1 polish 2026-05-09 part 25 — differentiate error TYPE so the
      // user gets actionable next-step. Three classes:
      //   1. Connection-related (Backend 502/503/504 / FORGE_FETCH_BLOCKED /
      //      x-squid / network) → "Backend unreachable" + link to Settings
      //   2. not_configured → route directly to Setup screen (configuration
      //      gap, not transient failure)
      //   3. Generic (auth failure / parse error / etc.) → fall through with
      //      raw error message
      if (statusResult.error) {
        const friendly = _classifyBackendError(statusResult, "Could not load dashboard");
        if (friendly.routeToSetup) {
          setError(friendly.message);
          setScreen("setup");
          return;
        }
        setDashboardError(friendly.message);
        setDashboardLoading(false);
        return;
      }
      if (statusResult.busy === true) {
        setDashboardError(
          `Pipeline busy: ${
            statusResult.active_phase || "another job is running"
          }. Try again when it completes.`,
        );
        setDashboardLoading(false);
        return;
      }

      // Filter to completed generate-kind jobs only. Preview-kind
      // results have no breakdown shape (CG-7 emits preview_result
      // payload), so dashboard's deriveDashboardSignals would return
      // null + empty-state surfaces. Same outcome for idle / running /
      // failed statuses — empty-state is the honest signal.
      if (
        statusResult.status !== "completed" ||
        statusResult.kind === "preview" ||
        !statusResult.job_id
      ) {
        setDashboardData(null);
        setDashboardLoading(false);
        return;
      }

      const full = await invoke("getResults", {
        jobId: statusResult.job_id,
      });

      if (full.error) {
        const friendly = _classifyBackendError(full, "Could not load dashboard");
        if (friendly.routeToSetup) {
          setError(friendly.message);
          setScreen("setup");
          return;
        }
        setDashboardError(friendly.message);
        setDashboardLoading(false);
        return;
      }

      // H-1 self-review fix 2026-05-09 — match startPolling line 195
      // fallback convention `full.result || full`. Backend MAY return
      // result wrapped (`{result: {breakdown, ...}}`) OR directly
      // (`{breakdown, ...}`); fallback handles both. Without this,
      // direct-shape responses route to empty-state when data IS present.
      const payload = full.result || full || null;
      setDashboardData(payload);
      setDashboardLoading(false);
    } catch (err) {
      setDashboardError(err?.message || "Failed to load dashboard");
      setDashboardLoading(false);
    }
  }, []);

  // handleBackFromDashboard — clears dashboard-only state and routes
  // to picker. Does NOT clear pageId/pageData (since dashboard never
  // set them); does NOT reset bypassCache (page-specific power-user
  // setting). Lighter than handleNewPage which clears everything.
  // Note: PagePicker re-mounts on screen change → useState resets +
  // recent list re-fetches от KVS (KVS persistence is the cross-mount
  // continuity, не in-memory React state).
  const handleBackFromDashboard = useCallback(() => {
    setDashboardData(null);
    setDashboardSourcePage(null);
    setDashboardError(null);
    setDashboardLoading(false);
    setScreen("picker");
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
            title="Discard in-progress edits and return to page picker (job result cached for 1h — re-click page to resume)"
          />
          <span
            className="ml-3 text-[11px]"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            {pageData?.title || "(reviewing)"}
          </span>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
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
          onView={handleViewDashboard}
        />
      );
    case "dashboard":
      return (
        <DashboardScreen
          data={dashboardData}
          sourcePage={dashboardSourcePage}
          loading={dashboardLoading}
          error={dashboardError}
          onBack={handleBackFromDashboard}
        />
      );
    case "ready":
      return (
        <ReadyScreen
          pageData={pageData}
          documentType={documentType}
          onDocTypeChange={setDocumentType}
          bypassCache={bypassCache}
          onBypassCacheChange={setBypassCache}
          onPreview={handlePreview}
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
        />
      );
    case "previewing":
      return (
        <PreviewingScreen
          pageTitle={pageData?.title}
          jobStatus={jobStatus}
          elapsed={elapsed}
          onBack={handleNewPage}
        />
      );
    case "preview_result":
      return (
        <PreviewResultScreen
          pageTitle={pageData?.title}
          previewResult={previewResult}
          onGenerate={handleGenerate}
          onCancel={handleRetry}
          onBackToPicker={handleNewPage}
        />
      );
    case "confirming":
      return (
        <ConfirmScreen
          dryRunResult={dryRunResult}
          isPushing={isPushing}
          onConfirm={handleConfirmedPush}
          onBack={handleBackToReview}
          onBackToPicker={handleNewPage}
        />
      );
    case "pushed":
      return (
        <PushedScreen
          result={pushResult}
          onBack={handleBackToReview}
          onNew={handleNewPage}
        />
      );
    case "error":
      return (
        <ErrorScreen
          error={error}
          partialBreakdown={jobStatus?.partial_breakdown}
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
  documentType,
  onDocTypeChange,
  bypassCache,
  onBypassCacheChange,
  onPreview,
  onGenerate,
  onBack,
}) {
  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      {/* U2 part 33 (2026-05-09) — refactored to use shared BackButton.
          Originally added partner UX directive U1-partial 2026-05-09 to
          give user nav-back when they want to abandon page mid-Ready. */}
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
        {pageData.space_name} · {pageData.body_length?.toLocaleString()}{" "}
        characters
      </p>

      <div
        className="rounded-lg p-4 mb-4"
        style={{
          background: "var(--s2j-bg-section)",
          border: "1px solid var(--s2j-border)",
        }}
      >
        <label
          className="text-sm font-medium block mb-2"
          style={{ color: "var(--s2j-text)" }}
        >
          Document type
        </label>
        <p className="text-xs mb-3" style={{ color: "var(--s2j-text-muted)" }}>
          Controls how the AI scopes the breakdown.
        </p>
        <div className="space-y-2">
          {DOC_TYPES.map((dt) => (
            <label
              key={dt.value}
              className="flex items-center gap-2 text-sm cursor-pointer"
              style={{ color: "var(--s2j-text)" }}
            >
              <input
                type="radio"
                name="docType"
                value={dt.value}
                checked={documentType === dt.value}
                onChange={() => onDocTypeChange(dt.value)}
                style={{ accentColor: "var(--s2j-green)" }}
              />
              <strong>{dt.label}</strong>
              <span style={{ color: "var(--s2j-text-muted)" }}>
                — {dt.desc}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* CG-9 cache-bypass toggle (Slice 3, 2026-05-08). Default off
          for typical re-run UX (cache hits give ~30 min → 2-3 min cycle
          per architecture promise). User opts-in за fresh re-run when
          stochastic phase output froze a bad variant OR debugging cache
          invalidation. Below docType card / above action buttons —
          power-user concern, не primary path. */}
      <label
        className="flex items-start gap-2 mb-4 text-xs cursor-pointer"
        style={{ color: "var(--s2j-text-light)" }}
      >
        <input
          type="checkbox"
          checked={bypassCache === true}
          onChange={(e) => onBypassCacheChange(e.target.checked)}
          style={{ accentColor: "var(--s2j-blue)", marginTop: "2px" }}
        />
        <span>
          <strong style={{ color: "var(--s2j-text)" }}>Bypass cache</strong>
          {" "}— skip cached phase outputs and recompute fresh. Slower run
          but useful for verifying cache invalidation or re-rolling
          stochastic outputs.
        </span>
      </label>

      {/* CG-7: Preview (secondary) + Generate (primary) side-by-side.
          Preview runs ~30-90 sec pre-flight (Phase 0 + 0b only), surfaces
          predicted counts + quality flags + wall-clock estimate before
          author commits to full ~10-30 min generate run. */}
      <div className="flex gap-3">
        <button
          onClick={onPreview}
          className="btn-secondary flex-1 justify-center"
        >
          Preview
        </button>
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

// CG-1 partial_breakdown summary helper (Layer 1 Session 3, 2026-05-07).
// Renders a single-line "latest snapshot" copy from the partial_breakdown
// dict per Session 1 PHASE_OUTPUT_CONTRACT. Returns null for missing /
// unknown phase_id values — forward-compat: ignore newer emit shapes
// the UI hasn't learned yet rather than crashing render.
//
// Capabilities shape varies by phase: phase2/2.5 emit dict
// {cap_heading: {features[], ...}}; phase3 emits list
// [{name, features[], ...}]. _walkCapabilities normalizes both.
function _walkCapabilities(caps) {
  if (Array.isArray(caps)) return caps;
  if (caps && typeof caps === "object") return Object.values(caps);
  return [];
}

function _renderPartialBreakdownLine(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const pid = snapshot.phase_id;

  if (pid === "phase1") {
    const caps = (snapshot.feature_groups || []).length;
    const feats = (snapshot.feature_signals || []).length;
    return `Routing complete — ${caps} ${
      caps === 1 ? "capability" : "capabilities"
    } detected, ${feats} ${
      feats === 1 ? "feature" : "features"
    } identified`;
  }
  if (pid === "phase0b") {
    const constraints = snapshot.phase0_constraints || {};
    const n = Object.keys(constraints).length;
    return `Constraints extracted — ${n} ${
      n === 1 ? "section" : "sections"
    } processed`;
  }
  if (pid === "phase1.5") {
    return "Context summary ready";
  }
  if (pid === "phase2") {
    const walked = _walkCapabilities(snapshot.capabilities);
    const capCount = walked.length;
    const storyCount = walked.reduce(
      (sum, c) => sum + ((c.features || []).length),
      0,
    );
    return `Stories generated — ${capCount} ${
      capCount === 1 ? "capability" : "capabilities"
    }, ${storyCount} ${storyCount === 1 ? "story" : "stories"}`;
  }
  if (pid === "phase2.5") {
    return "Story names refined";
  }
  if (pid === "phase3") {
    const walked = _walkCapabilities(snapshot.capabilities);
    let acCount = 0;
    walked.forEach((c) => {
      (c.features || []).forEach((f) => {
        acCount += (f.acceptance_criteria || []).length;
      });
    });
    return `Acceptance criteria attached — ${acCount} total AC${
      acCount === 1 ? "" : "s"
    }`;
  }
  return null;
}

function GeneratingScreen({ pageTitle, jobStatus, elapsed, onBack }) {
  const pct = Math.round((jobStatus?.progress || 0) * 100);
  // CG-1 latest snapshot — incremental visibility into what
  // the pipeline has produced so far. Block omitted когато
  // partial_breakdown is null (early/init emits) OR phase_id
  // is unknown (forward-compat).
  const snapshotLine = _renderPartialBreakdownLine(
    jobStatus?.partial_breakdown,
  );
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

      {/* CG-1 latest snapshot — appears ABOVE "You can close this panel"
          hint so reading order is: progress → emerging content →
          close-panel affordance. Renders only когато non-null. */}
      {snapshotLine && (
        <div
          className="rounded-lg p-3 mb-4"
          style={{
            background: "var(--s2j-bg-section)",
            border: "1px solid var(--s2j-border)",
          }}
        >
          <p
            className="text-[10px] font-medium uppercase tracking-wider mb-1"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            Latest
          </p>
          <p className="text-sm" style={{ color: "var(--s2j-text)" }}>
            {snapshotLine}
          </p>
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
    </div>
  );
}

// ── Previewing (CG-7 spec linter pre-flight in progress) ───────

function PreviewingScreen({ pageTitle, jobStatus, elapsed, onBack }) {
  const pct = Math.round((jobStatus?.progress || 0) * 100);
  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      {/* U2 part 33 (2026-05-09) — refactored to use shared BackButton.
          Originally F2 part 30 affordance during pre-flight (~30-90 sec
          typical). Same pattern as Generating screen — pipeline continues
          background; reconnect on return. */}
      {onBack && (
        <BackButton
          onClick={onBack}
          title="Pre-flight continues in background. Return to picker; results surface via reconnect-to-active-job when you come back."
        />
      )}
      <div className="flex items-center gap-2 mb-1">
        <Spinner size={18} />
        <h2
          className="text-lg font-semibold"
          style={{ color: "var(--s2j-text)" }}
        >
          Running pre-flight check
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
          Typically takes 30 to 90 seconds
        </p>
        <p className="text-xs" style={{ color: "var(--s2j-text-light)" }}>
          Pre-flight runs Phase 0 routing + constraint extraction only.
          Dense compliance specs may take longer. You will see predicted
          counts, quality flags, and a wall-clock estimate before deciding
          whether to commit to the full run.
        </p>
      </div>
    </div>
  );
}

// ── Preview Result (CG-7 pre-flight summary screen) ────────────

function PreviewResultScreen({
  pageTitle,
  previewResult,
  onGenerate,
  onCancel,
  onBackToPicker,
}) {
  const pr = previewResult || {};
  const predictedCaps = pr.predicted_capabilities ?? 0;
  const estFeatures = pr.estimated_features_min ?? 0;
  const sectionCount = pr.section_count ?? 0;
  const constraintCount = pr.constraint_count ?? 0;
  const wallClock = pr.estimated_full_run_minutes || "—";
  const routing = pr.routing_distribution || {};
  const flags = pr.quality_flags || [];

  // Group flags by severity. Server pre-sorts (Session 2 R-8 fix:
  // sort_quality_flags_by_severity called server-side); we cluster
  // for visual severity grouping. Unknown severity falls back to
  // medium so UI never silently drops flags на schema drift.
  const flagsBySeverity = { high: [], medium: [], low: [] };
  flags.forEach((f) => {
    const sev = (f.severity || "medium").toLowerCase();
    if (flagsBySeverity[sev]) flagsBySeverity[sev].push(f);
    else flagsBySeverity.medium.push(f);
  });

  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      {/* U2 part 33 (2026-05-09) — top-of-content back-to-picker
          affordance. "Cancel" inline button (below) returns to ready
          screen для same page; this top button abandons page entirely
          and returns to picker. Clear semantic split. */}
      {onBackToPicker && (
        <BackButton
          onClick={onBackToPicker}
          title="Abandon pre-flight result and return to page picker (you can pick a different page or return to this one later)"
        />
      )}
      <h2
        className="text-lg font-semibold mb-1"
        style={{ color: "var(--s2j-text)" }}
      >
        Pre-flight summary
      </h2>
      <p className="text-sm mb-4" style={{ color: "var(--s2j-text-light)" }}>
        {pageTitle}
      </p>

      {/* Top stat block — predicted counts + wall-clock estimate. */}
      <div
        className="rounded-lg p-4 mb-4"
        style={{
          background: "var(--s2j-bg-section)",
          border: "1px solid var(--s2j-border)",
        }}
      >
        <div className="space-y-2 mb-3">
          <SummaryRow
            label="Capabilities (predicted)"
            value={predictedCaps}
            color="var(--s2j-blue)"
          />
          <SummaryRow
            label="Features (approximate ≥)"
            value={estFeatures}
            color="var(--s2j-green)"
          />
          <SummaryRow
            label="Constraints extracted"
            value={constraintCount}
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
              Estimated full run
            </span>
            <span
              className="font-mono font-semibold"
              style={{ color: "var(--s2j-text)" }}
            >
              {wallClock}
            </span>
          </div>
          {sectionCount > 0 && (
            <div className="flex justify-between text-xs mt-1">
              <span style={{ color: "var(--s2j-text-muted)" }}>
                Spec sections analyzed
              </span>
              <span
                className="font-mono"
                style={{ color: "var(--s2j-text-light)" }}
              >
                {sectionCount}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Quality flags — severity-grouped clusters. Each cluster
          renders only когато non-empty. Server pre-sorts items WITHIN
          each cluster, so render order matches insertion order. */}
      {flags.length > 0 && (
        <div className="space-y-2 mb-4">
          <p
            className="text-[11px] font-medium uppercase tracking-wider"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            Quality concerns ({flags.length})
          </p>
          {flagsBySeverity.high.length > 0 && (
            <FlagCluster
              severity="High"
              flags={flagsBySeverity.high}
              bg="var(--s2j-red-bg)"
              fg="var(--s2j-red)"
              border="var(--s2j-red-border)"
            />
          )}
          {flagsBySeverity.medium.length > 0 && (
            <FlagCluster
              severity="Medium"
              flags={flagsBySeverity.medium}
              bg="var(--s2j-orange-bg)"
              fg="var(--s2j-orange)"
              border="var(--s2j-orange-border)"
            />
          )}
          {flagsBySeverity.low.length > 0 && (
            <FlagCluster
              severity="Low"
              flags={flagsBySeverity.low}
              bg="var(--s2j-blue-bg)"
              fg="var(--s2j-blue)"
              border="var(--s2j-blue-border)"
            />
          )}
        </div>
      )}

      {/* Routing distribution — section-bucket counts from Phase 0. */}
      {Object.keys(routing).length > 0 && (
        <div
          className="rounded-lg p-3 mb-4"
          style={{
            background: "var(--s2j-bg-section)",
            border: "1px solid var(--s2j-border)",
          }}
        >
          <p
            className="text-[11px] font-medium uppercase tracking-wider mb-2"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            Section routing
          </p>
          <div className="space-y-1">
            <RoutingRow
              label="Implement (will generate stories)"
              value={routing.implement || 0}
              color="var(--s2j-green)"
            />
            <RoutingRow
              label="Shared AC"
              value={routing.shared_ac || 0}
              color="var(--s2j-blue)"
            />
            <RoutingRow
              label="Context (background)"
              value={routing.context || 0}
              color="var(--s2j-text-light)"
            />
            <RoutingRow
              label="Distributed AC (per-feature rules)"
              value={routing.distributed_ac || 0}
              color="var(--s2j-orange)"
            />
            <RoutingRow
              label="Skip (excluded)"
              value={routing.skip || 0}
              color="var(--s2j-text-muted)"
            />
          </div>
        </div>
      )}

      {/* Actions — Cancel returns to Ready (preserves doc-type choice
          via handleRetry's setScreen("ready") + previewResult clear);
          Generate Now hands off to handleGenerate (full pipeline run).
          Arrow prefix on Cancel matches ConfirmScreen "← Back to Editor"
          convention — visual directional cue makes secondary action
          findable next to large primary CTA. Hierarchy preserved (primary
          stretches via flex-1; secondary stays intrinsic-width). */}
      <div className="flex gap-3">
        <button onClick={onCancel} className="btn-secondary">
          ← Cancel
        </button>
        <button
          onClick={onGenerate}
          className="btn-primary flex-1 justify-center"
        >
          Generate Now
        </button>
      </div>
    </div>
  );
}

function FlagCluster({ severity, flags, bg, fg, border }) {
  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: bg,
        border: `1px solid ${border}`,
      }}
    >
      <p
        className="text-[10px] font-semibold uppercase tracking-wider mb-2"
        style={{ color: fg }}
      >
        {severity} severity ({flags.length})
      </p>
      <ul
        className="space-y-1.5"
        style={{ listStyle: "none", margin: 0, padding: 0 }}
      >
        {flags.map((flag, i) => (
          <li key={i} className="text-xs flex items-start gap-2">
            <span
              className="shrink-0 font-mono"
              style={{ color: fg, opacity: 0.7 }}
            >
              §{(flag.section_index ?? 0) + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p
                className="font-medium leading-tight"
                style={{ color: "var(--s2j-text)" }}
              >
                {flag.section_heading || "(unnamed section)"}
              </p>
              <p
                className="text-[11px] leading-tight mt-0.5"
                style={{ color: "var(--s2j-text-light)" }}
              >
                {flag.message}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoutingRow({ label, value, color }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span style={{ color: "var(--s2j-text-light)" }}>{label}</span>
      <span className="font-mono font-semibold" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

// ── Confirm Push ────────────────────────────────────────────────

function ConfirmScreen({
  dryRunResult,
  isPushing,
  onConfirm,
  onBack,
  onBackToPicker,
}) {
  const items = dryRunResult?.items || [];
  const total = items.length || dryRunResult?.total_items || 0;
  const epics =
    dryRunResult?.total_epics ||
    items.filter((i) => i.type === "Epic").length ||
    0;
  const stories =
    dryRunResult?.total_stories ||
    items.filter((i) => i.type === "Story").length ||
    0;
  const tasks =
    dryRunResult?.total_subtasks ||
    items.filter((i) => i.type === "Sub-task").length ||
    0;
  const links = dryRunResult?.dependency_links || 0;
  const project = dryRunResult?.project_key || "unknown";

  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      {/* U2 part 33 (2026-05-09) — top-of-content escape hatch.
          DESTRUCTIVE: discards in-progress edits + push intent.
          "← Back to Editor" inline button (below) preserves edits;
          this top button discards them entirely. Tooltip warns explicitly
          so user picks the right escape route. */}
      {onBackToPicker && (
        <BackButton
          onClick={onBackToPicker}
          title="Discard edits and return to page picker (use 'Back to Editor' below to keep edits)"
        />
      )}
      <h2
        className="text-lg font-semibold mb-4"
        style={{ color: "var(--s2j-text)" }}
      >
        Confirm Push to JIRA
      </h2>

      {/* Summary card */}
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
          Project: {project}
        </p>

        <div className="space-y-2 mb-3">
          <SummaryRow label="Epics" value={epics} color="var(--s2j-blue)" />
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
                Dependency links
              </span>
              <span
                className="font-mono"
                style={{ color: "var(--s2j-text-light)" }}
              >
                {links}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Warning */}
      <div
        className="rounded-lg p-3 mb-4"
        style={{
          background: "var(--s2j-orange-bg)",
          border: "1px solid var(--s2j-orange-border)",
        }}
      >
        <p className="text-xs" style={{ color: "var(--s2j-text)" }}>
          This will create real JIRA issues. This action cannot be undone from
          here.
        </p>
      </div>

      {/* Actions */}
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

// ── Pushed (Success) ────────────────────────────────────────────

function PushedScreen({ result, onBack, onNew }) {
  const total = result?.created_issues?.length || result?.total_items || 0;
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
          Stories · {result?.total_subtasks || 0} Subtasks
          {result?.dependency_links_created
            ? ` · ${result.dependency_links_created} links`
            : ""}
        </p>
      </div>

      {result?.errors?.length > 0 && (
        <div
          className="rounded-lg p-3 mb-4"
          style={{
            background: "var(--s2j-orange-bg)",
            border: "1px solid var(--s2j-orange-border)",
          }}
        >
          <p
            className="text-xs font-medium"
            style={{ color: "var(--s2j-text)" }}
          >
            {result.errors.length} warning(s) during creation
          </p>
        </div>
      )}

      {/* F3 misplacement fix part 32 (2026-05-09) — "Run again on this
          page" was removed because re-running на same page POST-PUSH
          would create duplicate JIRA tickets (semantically wrong post-
          push context). Re-running need is already covered: ReadyScreen
          has Preview + Generate buttons that re-run when clicked.
          "Generate Another" renamed → "Generate on new page" для
          clarity (explicitly indicates picker-route to different page,
          avoiding "another what?" ambiguity). */}
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

function ErrorScreen({ error, partialBreakdown, onRetry, onBackToPicker }) {
  // Session 3 C1 forensic preservation (Layer 1, 2026-05-07): if the
  // pipeline crashed mid-run, job_store.to_status_dict carries the
  // last partial_breakdown snapshot per E2 always-present key contract.
  // Surfacing the snapshot saves the user от re-running blind — they
  // see how far the pipeline got. Block omitted когато null OR на
  // unknown phase_id (forward-compat).
  const forensicLine = _renderPartialBreakdownLine(partialBreakdown);

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

      {forensicLine && (
        <div
          className="rounded-lg p-3 mb-4"
          style={{
            background: "var(--s2j-bg-section)",
            border: "1px solid var(--s2j-border)",
          }}
        >
          <p
            className="text-[10px] font-medium uppercase tracking-wider mb-1"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            Last known state before failure
          </p>
          <p className="text-sm" style={{ color: "var(--s2j-text)" }}>
            {forensicLine}
          </p>
        </div>
      )}

      <button onClick={onRetry} className="btn-secondary">
        ← Try again
      </button>
    </div>
  );
}

/**
 * SetupScreen — shown when Spec2Tickets is not yet configured.
 * Complements AdminSettings (does not repeat its content).
 *
 * Surfaces to customer:
 *   - Prerequisite: self-hosted backend must exist first
 *   - Navigation path: how to reach Configure
 *   - Forward-reference: whitelist/Early Access details live in Settings
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

        {/* Prerequisite — explicit before nav steps */}
        <p className="text-sm mb-3" style={{ color: "var(--s2j-text)" }}>
          <strong>Prerequisite:</strong> Spec2Tickets connects to a self-hosted
          AI backend. If you haven't deployed the backend yet, follow the{" "}
          <a
            href="https://spec2jira.com/docs"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--s2j-blue)", textDecoration: "underline" }}
          >
            setup guide
          </a>{" "}
          first.
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
            2. Click <strong>Manage Apps</strong>
          </p>
          <p>
            3. Find <strong>Spec2Tickets</strong> and click{" "}
            <strong>Configure</strong>
          </p>
          <p>
            4. Enter your Backend URL and JIRA Project Key, then Test & Save
          </p>
          <p style={{ marginTop: "6px", fontStyle: "italic" }}>
            Early Access: whitelist approval may be required — details in the
            Settings page.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Util ────────────────────────────────────────────────────────

function fmtTime(s) {
  if (!s || s < 0) return "0s";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default App;
