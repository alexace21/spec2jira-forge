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
import TestCasesScreen from "./components/TestCasesScreen";
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
import { classText } from "./lib/diagnosticsView";
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
        "Anthropic's API is temporarily unavailable or overloaded. This is on Anthropic's side, not your page — please wait a few minutes and try Generate again.",
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

  // The classes below humanize specific backend error CODES so the user never sees
  // a raw HTTP body or an opaque token. They must come BEFORE Class 7 (the generic
  // pass-through, which would otherwise append the raw `detail` verbatim).

  // Page trashed / archived (soft-deleted) — Confluence still serves it with HTTP 200,
  // the backend rejects it (S7 fix). Drop the raw token; the detail is already clean.
  if (/page_not_available/i.test(errorStr)) {
    return {
      message:
        detail ||
        "This page is no longer available — it may have been moved to the trash or archived in Confluence. Pick another page.",
      routeToSetup: false,
    };
  }

  // Confluence permission / scope error — the app couldn't read the page or search
  // because of authorization (403 / missing scope / search/parse failure). Actionable:
  // re-authorize the app. Checked before the numeric confluence_<status> class below.
  if (
    /confluence_403/i.test(errorStr) ||
    /scope/i.test(errorStr + detail) ||
    /forbidden/i.test(errorStr + detail) ||
    /search[ _]failed/i.test(errorStr) ||
    /parse[ _]failed/i.test(errorStr)
  ) {
    return {
      message:
        "Couldn't search Confluence (permission error) — ask your Confluence admin to re-authorize Spec2Tickets, or contact support@spec2jira.com.",
      routeToSetup: false,
    };
  }

  // Confluence returned some other error reading the page (e.g. confluence_404,
  // confluence_500). Friendly summary — never the raw Confluence body.
  if (/confluence_\d+/i.test(errorStr)) {
    return {
      message:
        "Couldn't read this Confluence page (Confluence returned an error). Try reopening the page; if it persists, contact support@spec2jira.com.",
      routeToSetup: false,
    };
  }

  // Jira returned an error while creating issues (jira_<status>). Point at project
  // settings — never the raw Jira body.
  if (/jira_\d+/i.test(errorStr)) {
    return {
      message:
        "Jira returned an error while creating issues. Check your project settings, or contact support@spec2jira.com.",
      routeToSetup: false,
    };
  }

  // Anthropic 4xx (e.g. 400 / 413) — NOT the 5xx already handled in Class 2. Usually
  // the page is too large or malformed for the request. Suggest a smaller/cleaner page.
  if (/anthropic_4\d\d/i.test(errorStr)) {
    return {
      message:
        "The page couldn't be processed (it may be too large or malformed). Try a smaller/cleaner page.",
      routeToSetup: false,
    };
  }

  // Couldn't retrieve the generated result (results_fetch_<status>, non-5xx — the 5xx
  // case is folded into Class 2 above). Transient — just retry.
  if (/results_fetch_\d+/i.test(errorStr)) {
    return {
      message:
        "Couldn't retrieve the result of your breakdown. Please try again in a moment.",
      routeToSetup: false,
    };
  }

  // The page is too short to generate a meaningful breakdown.
  if (/page_too_small/i.test(errorStr)) {
    return {
      message:
        "This page is too short to generate a breakdown — add more detail to the page, then try again.",
      routeToSetup: false,
    };
  }

  // Anthropic declined to process the page (a refusal). Ask the user to review the
  // page content rather than showing the raw refusal text.
  if (/refused/i.test(errorStr)) {
    return {
      message:
        "Anthropic declined to process this page. Review the page content and try again.",
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
  // screenRef mirrors screen state so poll callbacks always read the CURRENT value
  // without a stale closure (fix 6: navigate to testcases only when generatingTests).
  const screenRef = useRef("loading");
  // (A deep-audit fix 2026-06-10) the job id each poll is CURRENTLY tracking. The poll
  // guards must key on JOB IDENTITY, not just screen name: with one shared pollRef/tcPollRef
  // and a closure-captured jid, a stale in-flight callback from an ABANDONED job (user hit
  // Start over → Generate B while A's poll was awaiting) would otherwise pass a bare
  // screen-name check and (1) hijack to the wrong job and (2) clearInterval the NEWER poll's
  // interval, orphaning it. startPolling/startTcPolling set these; the guards compare
  // `jid === current` before navigating, setting status, or clearing the shared ref.
  const currentPollJobIdRef = useRef(null);
  const currentTcJobIdRef = useRef(null);
  const [pageData, setPageData] = useState(null);
  const [pageId, setPageId] = useState(null);
  const [error, setError] = useState(null);
  // [diag Phase 3, design §5] The diagnostic correlation id (jobId) for the CURRENT error
  // screen, or null when the failure has no job in scope (page-fetch errors, submit
  // errors whose response carries no job_id, init failures). Set EXPLICITLY at every
  // setScreen("error") site — never inferred from possibly-stale jobId state — so the
  // ErrorScreen ref can never point at an unrelated job's diagnostic record.
  const [errorRefId, setErrorRefId] = useState(null);
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

  // Usage/tier badge data (P3a) — shows the customer their plan + (for Managed Pro)
  // their monthly fair-use count + reset date on the Ready screen, for transparency
  // before they hit the cap (not only after). Best-effort; fed by the getUsage resolver.
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

  // Persist-failed degraded mode (diagnostics Phase 0, design §3.1). TRUE when the
  // completed breakdown could NOT be written to Forge storage (typically the ~240KB KVS
  // value cap on very large pages) — pollJobStatus terminalized the job and handed the
  // results forward INLINE (persistFailed: true on the poll response), so they exist ONLY
  // in this tab's memory. Drives an additive amber banner on the reviewing + confirm
  // screens ("review and push it now"). Cleared whenever results load normally from
  // storage (poll getResults path + routeByPageStatus reconnect).
  const [persistFailed, setPersistFailed] = useState(false);

  // [diag Phase 3, S4] Failure notice for the Ready screen. The dashboard's ⚠ "Needs
  // attention" click (and any reconnect to a failed job) used to fall through to a
  // PRISTINE Ready screen — zero failure info, no ref. routeByPageStatus's failed branch
  // sets { refId, code, detail }; ReadyScreen renders an additive failure card with the
  // diagnostic ref, and the existing Generate button doubles as the retry. Cleared on
  // ANY navigation away from Ready (new generation → "generating", different page →
  // "picker"/"loading", Settings, …) so it can never leak onto another page's Ready.
  const [genFailureNotice, setGenFailureNotice] = useState(null);
  useEffect(() => {
    if (screen !== "ready") setGenFailureNotice(null);
  }, [screen]);

  // Test-case results (P4). null = none generated / not loaded.
  // Shape: the getTestCases resolver return ({ perStory, total, completedAt, ... }).
  // Set on reconnect rehydration (routeByPageStatus completed branch) when
  // tcStatus === 'completed'. Cleared on page change / regenerate / retry.
  const [testCaseResults, setTestCaseResults] = useState(null);

  // In-app Settings access (2026-06-03). WHY this exists: the Forge
  // confluence:globalSettings "Configure" page (which renders AdminSettings) is
  // NOT reachable from Atlassian's centralized "Connected apps" admin — the classic
  // UPM URL now redirects to "App management has moved" and the centralized admin
  // exposes no Configure link. So the app must surface its OWN in-app Settings entry
  // point (Setup / Ready / Picker screens), independent of the admin UI.
  //   reinitNonce — bumped on closing in-app Settings; re-runs the init/config gate
  //     (re-checks config → routes to picker if now configured) via the init useEffect's
  //     dependency array.
  //   settingsFromApp — TRUE only when Settings was opened from WITHIN the app (show a
  //     "← Back" button above AdminSettings). FALSE on the globalSettings admin surface
  //     (standalone, no Back). handleOpenSettings is the ONLY place that sets it TRUE.
  const [reinitNonce, setReinitNonce] = useState(0);
  const [settingsFromApp, setSettingsFromApp] = useState(false);
  // [diag Phase 5, design §5] Which AdminSettings tab to land on + an optional
  // diagnostic-ref pre-filter for the Diagnostics tab. handleOpenSettings keeps its
  // historical behavior (Settings tab, no filter); handleOpenDiagnostics — the
  // [Open Diagnostics] click-nav on failure surfaces — sets both. Cleared when
  // leaving the admin screen (handleCloseSettings) so a stale ref filter can never
  // greet a later, unrelated Settings visit.
  const [settingsInitialTab, setSettingsInitialTab] = useState("settings");
  const [settingsDiagRefFilter, setSettingsDiagRefFilter] = useState(null);
  // [P5 LOW-1] which screen [Open Diagnostics] left from — 'pushed' is restored on
  // close (its purged-job summary is pure client state and unrecoverable otherwise).
  const settingsReturnScreenRef = useRef(null);

  const pollRef = useRef(null);
  const timerRef = useRef(null);
  const pushPollRef = useRef(null);

  // Test-case generation state (P5)
  const [tcJobStatus, setTcJobStatus] = useState(null);
  const [tcStartTime, setTcStartTime] = useState(null);
  const [tcElapsed, setTcElapsed] = useState(0);
  // Fix 6: tracks whether a TC generation is in-flight (persists across screen transitions
  // so the reviewing-screen button can show "⏳ Generating…" even after the BA navigates back)
  const [tcGenerating, setTcGenerating] = useState(false);
  // [polish] captured at push time: was a test-case run in flight when the user
  // pushed? (the push purges it). Drives a confirmation note on the success screen
  // so the user doesn't have to open Diagnostics to learn the run was discarded.
  const [tcDiscardedAtPush, setTcDiscardedAtPush] = useState(false);
  const tcPollRef = useRef(null);
  // Per-story regenerate: { [storyIdx]: 'idle'|'pending'|'polling'|'done'|'error' }
  const [regenStates, setRegenStates] = useState({});
  const regenPollRefs = useRef({});

  // Keep screenRef in sync with screen state (fix 6: poll callbacks read the current screen
  // without a stale closure — useEffect fires after every render where screen changed).
  useEffect(() => { screenRef.current = screen; }, [screen]);

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

        // ═══ Gate 1 — Settings (tier-aware, hybrid 2026-06-03) ═══
        // v3.0.0 required a BYOK Anthropic key + a default JIRA project key. The
        // hybrid makes the KEY requirement TIER-AWARE: Managed Pro (the Advanced
        // edition) runs Claude on OUR key, so a Managed user has NO BYOK key by
        // design — requiring one wrongly trapped them on the BYOK setup screen
        // (the bug this fixes). BYOK Pro (Standard) still needs the customer's own
        // key. Both editions still need a default JIRA project key (used by push).
        // getUsage carries the license-resolved edition; fetched in PARALLEL with
        // getSettings (no added latency) and fail-soft — on a metering glitch it is
        // null, so we fall back to the BYOK key requirement (safe: at worst a
        // Managed user is asked to open Settings; the key SOURCE is backend-resolved
        // from the license regardless, so the wrong key is never actually used).
        // Anthropic-health staleness stays deferred to generate-time (no re-test on
        // every mount).
        const [settings, mountUsage] = await Promise.all([
          invoke("getSettings"),
          invoke("getUsage").catch(() => null),
        ]);
        if (mountUsage && !mountUsage.error) setUsage(mountUsage);
        const isManaged = mountUsage?.edition === "advanced";

        if (
          (!isManaged && !settings?.apiKeyConfigured) ||
          !settings?.defaultProjectKey
        ) {
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

        // ═══ Gate 5 — reopen ALWAYS lands on the picker (the dashboard) ═══
        // (multi-batch dashboard, 2026-06-10 — partner live-acceptance UX finding) Reopening
        // the app WITHOUT an explicit deep-link always lands on the picker. The picker IS the
        // live multi-batch dashboard now: every in-flight job shows under "⏳ In progress" (10s
        // reconcile), completed under "✓ Ready for review", failed under "⚠ Needs attention".
        // So the OLD Gate-5 behavior — auto-resuming the SINGLE last-selected job's generating
        // SCREEN when it had an active job — was RETIRED: it hid the other batched jobs behind
        // one spinner, contradicting the whole "fire several → return → see them ALL" vision.
        // The monitoring use case the old gate served is now covered better by the dashboard;
        // from the picker the user clicks any "⏳ In progress" row to drop into that job's
        // generating screen (route-by-jobId). Explicit deep-links (Gates 3/4 above) still open
        // their specific page directly — that intent is unambiguous, so they are unchanged.
        // (The 2026-05-08 "return → picker, не resume" directive is now fully honored — it had
        // carved out active jobs; the dashboard makes that carve-out unnecessary.)

        // Default entry: page picker (the dashboard).
        setScreen("picker");
      } catch (err) {
        setErrorRefId(null); // [diag Phase 3] init failure — no job in scope
        setError(err.message);
        setScreen("error");
      }
    };
    init();
    return () => {
      clearInterval(pollRef.current);
      clearInterval(timerRef.current);
      clearInterval(pushPollRef.current);
      clearInterval(tcPollRef.current);
      Object.values(regenPollRefs.current).forEach(clearInterval);
    };
    // reinitNonce: bumped by handleCloseSettings → re-runs the init/config gate after
    // closing in-app Settings (re-checks config → routes to picker if now configured).
  }, [reinitNonce]);

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

  // TC timer — elapsed counter for the generatingTests screen
  useEffect(() => {
    if (screen === "generatingTests" && tcStartTime) {
      const id = setInterval(
        () => setTcElapsed(Math.floor((Date.now() - tcStartTime) / 1000)),
        1000,
      );
      return () => clearInterval(id);
    }
  }, [screen, tcStartTime]);

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
    currentPollJobIdRef.current = jid; // this poll now owns pollRef
    pollRef.current = setInterval(async () => {
      try {
        const st = await invoke("pollJobStatus", { jobId: jid });
        // (A deep-audit fix) Is this callback's job STILL the one this poll tracks? A stale
        // tick from an abandoned job (a newer startPolling replaced pollRef) must not clear
        // the newer poll's interval, overwrite its status, or drive the screen. isCurrent
        // gates every side effect that touches the shared pollRef / current screen.
        const isCurrent = jid === currentPollJobIdRef.current;
        if (st.error) {
          if (isCurrent) clearInterval(pollRef.current); // only the owner clears the shared ref
          // not_found / job-gone: route to error ONLY for the foreground job. Background or
          // stale → quiet (a cue would point at nothing).
          if (isCurrent && screenRef.current === "generating") {
            setErrorRefId(jid); // [diag Phase 3] diagnostic ref for the error screen
            setError(st.error);
            setScreen("error");
          }
          return;
        }
        // Progress drives the generating screen — only for the tracked job, so a stale tick
        // can't overwrite the new job's progress.
        if (isCurrent) setJobStatus(st);
        if (st.status === "completed") {
          if (isCurrent) clearInterval(pollRef.current);
          // Navigate to review ONLY for the foreground job (tracked AND its generating screen
          // is up). A background/stale completion just stops polling — the per-user dashboard
          // on the picker surfaces it durably (⏳→✓), so no screen-yank and no separate cue.
          if (isCurrent && screenRef.current === "generating") {
            if (st.persistFailed === true) {
              // [diag Phase 0, §3.1 degraded path] The breakdown completed but could NOT be
              // saved to Forge storage — the poll response carries the full results inline.
              // SKIP getResults (the job record now holds only a small terminal 'failed'
              // record — getResults would error and throw the breakdown away) and feed the
              // inline payload through the SAME adapter the getResults path uses below.
              // The results live only in this tab → persistFailed drives the amber
              // review-and-push-now banner on the reviewing/confirm screens.
              setStaleBreakdown(null);
              setPersistFailed(true);
              setResults(v3AdaptResultPayload(st));
              setScreen("reviewing");
            } else {
              const full = await invoke("getResults", { jobId: jid });
              if (full.error) {
                setErrorRefId(jid); // [diag Phase 3] diagnostic ref for the error screen
                setError(full.error);
                setScreen("error");
              } else {
                // A freshly-generated breakdown is current by definition — clear any
                // stale flag lingering from a previous reconnect (e.g. after Regenerate).
                setStaleBreakdown(null);
                setPersistFailed(false);
                setResults(v3AdaptResultPayload(full));
                setScreen("reviewing");
              }
            }
          }
        } else if (st.status === "failed") {
          if (isCurrent) clearInterval(pollRef.current);
          // Foreground → error screen. A background/stale failure stops quietly — the
          // dashboard's ⚠ Needs attention group surfaces it durably (§11: shown, not silent).
          if (isCurrent && screenRef.current === "generating") {
            // [diag P5 audit] humanize the terminal CODE via the single FE map — the
            // raw `st.error` used to render literally ("anthropic_529") while the S4
            // card and TC poll already humanized. st.detail stays deliberately
            // unrendered (network_failure carries raw exception prose — the H rule);
            // zone-2 keeps the verbatim detail for the consent export.
            setErrorRefId(jid);
            const t = classText(st.error);
            setError(st.error ? `${t.title} (${st.error})` : "Generation failed");
            setScreen("error");
          }
        }
      } catch (e) {
        console.error("Poll error:", e);
      }
    }, POLL_MS);
  }, []);

  // ── Test-case poll (P5) ─────────────────────────────────────
  // ⚠ Declared BEFORE routeByPageStatus, which references startTcPolling in its
  // reconnect path AND its dependency array. A `const` referenced before its own
  // declaration line is a Temporal-Dead-Zone crash at render ("Cannot access … before
  // initialization") — it blanks the whole app. Order matters; keep this above routeByPageStatus.
  const startTcPolling = useCallback(
    (jid) => {
      clearInterval(tcPollRef.current);
      currentTcJobIdRef.current = jid; // this poll now owns tcPollRef
      tcPollRef.current = setInterval(async () => {
        try {
          const st = await invoke("pollTestCaseStatus", { jobId: jid });
          // (A deep-audit fix, mirrored from the breakdown poll) ignore a stale tick from an
          // abandoned TC job — a newer startTcPolling owns tcPollRef now; this callback must
          // not clear its interval, overwrite its status, or drive the screen.
          const isCurrent = jid === currentTcJobIdRef.current;
          if (st.error) {
            if (isCurrent) {
              clearInterval(tcPollRef.current);
              setTcGenerating(false); // Fix 6
              // [seams-audit HIGH] navigate ONLY when the user is watching the TC
              // generating screen — a BACKGROUND error must stop quietly. The
              // reachable yank: push-while-TC-generating → push done → purgeJob
              // deletes the batched tcjob → the next tick here got not_found and
              // pulled the user OFF their SUCCESSFUL push summary onto a red error.
              if (screenRef.current === "generatingTests") {
                const friendly = _classifyBackendError(st, "Test case generation failed");
                setErrorRefId(jid); // [diag Phase 3] tcjob: is keyed by the breakdown jobId
                setError(friendly.message);
                setScreen("error");
              }
            }
            return;
          }
          if (isCurrent) setTcJobStatus(st);
          if (st.status === "completed") {
            if (!isCurrent) return; // stale — a newer TC poll owns tcPollRef
            clearInterval(tcPollRef.current);
            const tc = await invoke("getTestCases", { jobId: jid });
            if (tc.error) {
              setTcGenerating(false); // Fix 6
              const friendly = _classifyBackendError(tc, "Failed to load test cases");
              setErrorRefId(jid); // [diag Phase 3]
              setError(friendly.message);
              setScreen("error");
            } else {
              setTestCaseResults(tc);
              setTcGenerating(false); // Fix 6
              // Fix 6: navigate to testcases ONLY when the user is on the generating screen;
              // if they backed to reviewing, update results silently — don't yank them away.
              if (screenRef.current === "generatingTests") {
                setScreen("testcases");
              }
            }
          } else if (st.status === "failed") {
            if (!isCurrent) return; // stale
            clearInterval(tcPollRef.current);
            setTcGenerating(false); // Fix 6
            // [seams-audit HIGH] same background-gate as the error branch above — a
            // legitimately failed background batch surfaces via the TC screen's own
            // affordances on return, never by yanking an unrelated screen.
            if (screenRef.current === "generatingTests") {
              const friendly = _classifyBackendError(st, "Test case generation failed");
              setErrorRefId(jid); // [diag Phase 3]
              setError(friendly.message);
              setScreen("error");
            }
          }
        } catch (e) {
          console.error("TC poll error:", e);
        }
      }, POLL_MS);
    },
    [],
  );

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
      // Defensive: clear any test cases from a previously-routed page before this page's
      // state loads — the completed branch below re-sets them when tcStatus==='completed'.
      setTestCaseResults(null);

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
          // Results just loaded fine FROM storage → any persist-failed flag belongs to a
          // previous tab-local breakdown (diagnostics Phase 0) — clear it so the banner
          // never false-fires on a normally-stored breakdown.
          setPersistFailed(false);
          setResults(v3AdaptResultPayload(full));
          // P4 (§13 BUG-6): stamp jobId so a reconnect→push carries it to startPush —
          // else the push reads tcjob:<null> and the embed is silently skipped.
          setJobId(statusResult.job_id);
          // P4 audit B3: transition to reviewing BEFORE the getTestCases await so the
          // user sees the review screen immediately. Test cases feed the P5 screen, not
          // the review screen — they must not block the transition. The rehydrate is
          // still non-fatal: a failure here must never block the reviewing screen.
          setScreen("reviewing");
          // P4 reconnect rehydration: if test cases were completed for this job,
          // load them back into state so the Test Cases screen can restore without
          // re-generating. Non-fatal. full.tcStatus forwarded by getResults.
          if (full.tcStatus === 'completed') {
            try {
              const tc = await invoke("getTestCases", { jobId: statusResult.job_id });
              if (!tc.error) setTestCaseResults(tc);
            } catch (e) {
              console.error("getTestCases rehydrate failed (non-fatal):", e);
            }
          }
          // Fix 6 (Audit-6/7 reconnect): if TC generation was in-flight when the user
          // reconnected (tcStatus batched/pending), resume polling so completion still lands.
          // setTcGenerating(true) drives the "⏳ Generating tests…" state on the Review/Confirm
          // screen's test-cases button (the in-flight state surfaces there post-#1-redesign).
          if (full.tcStatus === 'batched' || full.tcStatus === 'pending') {
            setTcGenerating(true);
            startTcPolling(statusResult.job_id);
          }
          return;
        }
      }

      // [diag Phase 3, S4 — design §5] FAILED branch. Before this, a ⚠ "Needs attention"
      // dashboard click (or any reconnect to a failed job) fell through to the pristine
      // Ready screen below — zero failure info, no ref: the exact confusion the diagnostics
      // feature exists to prevent. Land on Ready WITH a failure card: fetch the stored
      // user-facing detail (a failed job's getResults returns { error, detail }), stash the
      // notice, and let the existing Generate button double as the retry. Best-effort — a
      // getResults glitch still shows the card with the generic body + the diagnostic ref.
      if (statusResult.status === "failed") {
        let failCode = statusResult.error || null;
        let failDetail = null;
        try {
          const failed = await invoke("getResults", { jobId: statusResult.job_id });
          if (failed && failed.error) failCode = failed.error;
          if (failed && typeof failed.detail === "string" && failed.detail) {
            failDetail = failed.detail;
          }
        } catch (e) {
          console.error("getResults (failed-job detail) failed (non-fatal):", e);
        }
        setGenFailureNotice({
          refId: statusResult.job_id,
          code: failCode,
          detail: failDetail,
        });
        setScreen("ready");
        return;
      }

      // Idle / no job → fresh start.
      setScreen("ready");
    },
    [startPolling, startTcPolling],
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
        // Dashboard rows carry their OWN jobId+status (the per-user identity) → route by THAT,
        // not by getGenerationStatus → the shared per-install page→job index, which a co-worker
        // generating the same page can overwrite (deep-audit MED: a dashboard click would then
        // open the OTHER user's job). Recent-list / reconnect rows have no jobId → resolve by page.
        const statusReq = pageRef.jobId
          ? Promise.resolve({
              status: pageRef.jobStatus,
              job_id: pageRef.jobId,
              elapsed_seconds: pageRef.startedAt
                ? Math.max(0, Math.floor((Date.now() - new Date(pageRef.startedAt).getTime()) / 1000))
                : 0,
            })
          : invoke("getGenerationStatus", { pageId: pageRef.id });
        const [pageResult, statusResult] = await Promise.all([
          invoke("fetchPage", { pageId: pageRef.id }),
          statusReq,
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
          // [diag P3 audit NIT-8] a dashboard ⚠ row carries its OWN jobId — the
          // generation-failure record lives under it; keep the one-click prefilter
          // even when the PAGE no longer fetches (deleted/permission). Non-dashboard
          // rows have no jobId → null as before.
          setErrorRefId(pageRef?.jobId || null);
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
        setErrorRefId(pageRef?.jobId || null); // [diag P3 audit NIT-8] keep a dashboard row's ref
        setError(err.message || "Failed to open page");
        setScreen("error");
      }
    },
    [routeByPageStatus],
  );

  // ── Start generation ─────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    // [diag Phase 3, S4] A new run supersedes the failure notice (the card promises
    // "Generating again will start a fresh run"). The screen-change effect also clears
    // it; this is the explicit belt for the named lifecycle event.
    setGenFailureNotice(null);
    setScreen("generating");
    setStartTime(Date.now());
    setElapsed(0);
    setJobStatus({ progress: 0, phase: "Starting..." });

    // Trust the selection ONLY if the per-page context finished loading for THIS
    // page; otherwise send "none" (safe). Closes the async race where a stale
    // cross-project selection could be submitted before getContextProfiles resolves.
    const effectiveProfileId =
      contextLoadedForPageId === pageData.page_id ? selectedContextProfileId : "none";
    let result;
    try {
      result = await invoke("startGeneration", {
        pageId: pageData.page_id,
        modelMode: "primary",
        contextProfileId: effectiveProfileId,
      });
    } catch (invokeErr) {
      // [diag Phase 5, design §2] TERMINAL invoke failure — the resolver rejected or
      // was killed before returning (25s kill leaves NO backend write), so file the
      // client-side fallback record (fire-and-forget; the .catch keeps the fallback
      // from ever cascading), then route to the error screen instead of stranding the
      // user on the generating spinner. No jobId exists yet for this run
      // (startGeneration is what mints it) → no ref. invoke_rejected for ALL shapes —
      // @forge/bridge exposes no structural timeout discriminator.
      invoke("recordClientDiagnostic", { error_class: "invoke_rejected" }).catch(() => {});
      setErrorRefId(null);
      setError(invokeErr?.message || "Generate failed");
      setScreen("error");
      return;
    }

    if (result.error === "quota_exceeded") {
      // Managed Pro fair-use cap reached (we run Claude + pay compute, so the
      // monthly allowance is fair-use; payload carries fairUse=true). NORMAL state,
      // not a failure — route to the dedicated limit screen, NOT the red "Something
      // went wrong" error screen. (There is no Free tier; this can only be Managed.)
      setQuotaInfo(result);
      setScreen("limit_reached");
      return;
    }
    if (result.error === "license_required") {
      // Defensive (the 30-day Atlassian trial → paid model means licensed users
      // shouldn't hit this). If the backend ever reports no active license, show its
      // composed detail on the friendly limit screen rather than the red error screen.
      setQuotaInfo(result);
      setScreen("limit_reached");
      return;
    }
    if (result.error === "managed_unavailable") {
      // Managed Pro selected but our server key isn't configured (rare/transient).
      // The backend composes an actionable detail (contact support OR switch to
      // BYOK) — show it directly rather than the generic classifier wrapping.
      setErrorRefId(null); // [diag Phase 3] fails before a job record exists — no ref
      setError(
        result.detail ||
          "The Managed service is temporarily unavailable. Please contact support, or switch to your own Anthropic API key in Settings.",
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
      // [diag Phase 5, gate MED-1] submit failures carry job_id on the error response
      // (a job + ledger record + zone-2 detail exist under it backend-side) — surface
      // that ref so support can correlate. Other start errors carry none → null.
      // Never reuse the stale jobId state for an unrelated error.
      setErrorRefId(typeof result.job_id === "string" ? result.job_id : null);
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
    // [polish] snapshot whether a TC run is in flight NOW — the push will purge it
    // (the Create-button warning already told the user; this drives the post-push
    // confirmation note so they don't have to check Diagnostics to know it happened).
    setTcDiscardedAtPush(tcGenerating);
    setIsPushing(true);
    setPushProgress(0);
    setPushPhase("starting");
    setScreen("pushing");

    const fail = (res, fallback) => {
      const friendly = _classifyBackendError(res, "Push to Jira failed");
      // Only append the raw detail as a parenthetical when it adds NEW information.
      // For generic (Class 7) errors _classifyBackendError already folds res.detail
      // into friendly.message (": <detail>"), so re-appending it here doubled the
      // identical sentence. Append only when the detail is non-empty AND not already
      // contained in the friendly message (e.g. a connection-class message that omits it).
      const detail = res?.detail ? String(res.detail) : "";
      const message =
        detail && friendly.message && !friendly.message.includes(detail)
          ? `${friendly.message} (${detail})`
          : friendly.message || fallback;
      // [diag Phase 3] the push diagnostics record under ref jobId (startPush/pushStep
      // pass it through) — thread it so the error screen's ref matches the record.
      setErrorRefId(jobId || null);
      setError(message);
      setScreen(friendly.routeToSetup ? "setup" : "error");
      setIsPushing(false);
    };

    // [diag Phase 5] Hoisted so the TERMINAL invoke-catch below can stamp the push
    // session on the client-side fallback record (sessionId is otherwise block-scoped
    // inside the try).
    let pushSessionId = null;

    try {
      const start = await invoke("startPush", { breakdown: pendingBreakdown, jobId });
      // No push gate: every app user is licensed (30-day Atlassian trial → paid;
      // unsubscribed users are blocked natively by Atlassian, never reaching here),
      // so push proceeds. Any startPush error is a genuine failure → normal path.
      if (start.error) {
        fail(start, "Push failed to start");
        return;
      }
      const sessionId = start.session_id;
      if (!sessionId) {
        setErrorRefId(jobId || null); // [diag Phase 3]
        setError("Push did not start correctly (no session id).");
        setScreen("error");
        setIsPushing(false);
        return;
      }
      pushSessionId = sessionId; // [diag Phase 5] for the terminal invoke-catch fallback record
      setPushPhase(start.phase || "stories");

      // Loop pushStep until done. Safety cap prevents runaway (huge specs
      // chunk in 15s → 2000 steps would be ~30000 items, far beyond any real spec).
      for (let i = 0; i < 2000; i++) {
        // jobId rides the payload (deep-audit P2 ref-correlation): the pushStep
        // CATCH classes (push_exception/session_not_found) have no session to read
        // a jobId from — without it their records are ref:null and unfindable by
        // the ref the error screen shows. The backend shape-checks it.
        const step = await invoke("pushStep", { sessionId, jobId: jobId || undefined });
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

      setErrorRefId(jobId || null); // [diag Phase 3]
      setError(
        "Push took an unexpectedly large number of steps. Check Jira for created items; contact support@spec2jira.com if items are missing.",
      );
      setScreen("error");
      setIsPushing(false);
    } catch (err) {
      // [diag Phase 5, design §2] TERMINAL invoke failure — the startPush/pushStep
      // resolver rejected or was killed (the 25s kill leaves NO backend write), and the
      // push aborts to the error screen. File the client-side fallback record:
      // fire-and-forget WITH .catch so the fallback can never cascade into this error
      // path. invoke_rejected for ALL shapes — @forge/bridge exposes no structural
      // timeout discriminator (BridgeAPIError is a bare Error subclass; only message
      // prose differs, and prose matching is banned).
      invoke("recordClientDiagnostic", {
        error_class: "invoke_rejected",
        ref: jobId || undefined,
        session_ref: pushSessionId || undefined,
      }).catch(() => {});
      setErrorRefId(jobId || null); // [diag Phase 3]
      setError(err.message || "Push failed");
      setScreen("error");
      setIsPushing(false);
    }
  }, [pendingBreakdown, jobId, tcGenerating]);

  // ── Test-case generation (P5) ─────────────────────────────────

  const handleGenerateTestCases = useCallback(async () => {
    if (!jobId) return;
    // [diag §3.1 / gate M1] persistFailed = the breakdown lives ONLY in this tab (its job
    // record is a small terminal 'failed' stub). Test-gen reads job.breakdown from storage →
    // it would return breakdown_not_ready, route to the Error screen, and STRAND the unsaved
    // breakdown (the one thing the degraded path protects). The Confirm-screen affordance is
    // hidden in this mode; this guard is defense-in-depth for any other entry point.
    if (persistFailed) return;
    setScreen("generatingTests");
    setTcGenerating(true); // Fix 6: mark in-flight before the invoke
    setTcStartTime(Date.now());
    setTcElapsed(0);
    setTcJobStatus({ progress: 0, phase: "Starting…" });

    // #1 fix (edited-state): send the BA's edited breakdown (lifted into pendingBreakdown on the
    // Review→TestCases nav) so the backend generates test cases for the EDITED stories/ACs, not
    // the pristine generated ones. Mirrors the push (handleConfirmedPush sends the same shape).
    let result;
    try {
      result = await invoke("startTestCaseGeneration", {
        jobId,
        breakdown: pendingBreakdown || results?.breakdown,
      });
    } catch (invokeErr) {
      // [diag Phase 5, design §2] TERMINAL invoke failure — mirrors handleGenerate's
      // catch (resolver rejected/killed → no backend write possible → client-side
      // fallback record, fire-and-forget with .catch), then the error screen.
      invoke("recordClientDiagnostic", {
        error_class: "invoke_rejected",
        ref: jobId || undefined,
      }).catch(() => {});
      setTcGenerating(false); // Fix 6
      setErrorRefId(jobId || null);
      setError(invokeErr?.message || "Test case generation failed");
      setScreen("error");
      return;
    }

    if (result.error === "quota_exceeded") {
      setTcGenerating(false); // Fix 6
      setQuotaInfo(result);
      setScreen("limit_reached");
      return;
    }
    if (result.error === "license_required") {
      setTcGenerating(false); // Fix 6
      setQuotaInfo(result);
      setScreen("limit_reached");
      return;
    }
    if (result.error === "managed_unavailable") {
      setTcGenerating(false); // Fix 6
      setErrorRefId(jobId || null); // [diag Phase 3] TC-gen failure for THIS job
      setError(
        result.detail ||
          "The Managed service is temporarily unavailable. Please contact support, or switch to your own Anthropic API key in Settings.",
      );
      setScreen("error");
      return;
    }
    if (result.error) {
      setTcGenerating(false); // Fix 6
      const friendly = _classifyBackendError(result, "Test case generation failed");
      if (friendly.routeToSetup) {
        setError(friendly.message);
        setScreen("setup");
        return;
      }
      setErrorRefId(jobId || null); // [diag Phase 3]
      setError(friendly.message);
      setScreen("error");
      return;
    }

    // Idempotency: if the resolver returned already-completed, load results directly.
    // Fix 5: if getTestCases returns an error on the fast-path, do NOT silently return
    // (leaves user stuck on generatingTests) — fall through to startTcPolling to re-poll.
    if (result.status === "completed") {
      const tc = await invoke("getTestCases", { jobId });
      if (!tc.error) {
        setTcGenerating(false); // Fix 6
        setTestCaseResults(tc);
        setScreen("testcases");
        return;
      }
      // tc.error → fall through: re-poll picks up the completed status and retries the fetch
    }

    startTcPolling(jobId);
  }, [jobId, startTcPolling, pendingBreakdown, results, persistFailed]);

  const handleRegenerateTestCase = useCallback(
    (storyIdx) => {
      // [deep-audit F7] symmetry with handleGenerateTestCases' M1 guard: a
      // persistFailed breakdown lives only in this tab — the backend would read
      // the small terminal stub. Provably unreachable today (testCaseResults is
      // nulled on every path into persistFailed mode), kept as defense-in-depth.
      if (persistFailed) return;
      setRegenStates((prev) => ({ ...prev, [storyIdx]: "pending" }));
      (async () => {
        let submitResult;
        try {
          // (b) send the EDITED breakdown so the backend regen reads the BA's edited ACs (not the
          // generation-time snapshot). The resolver persists it to job.breakdown (mirrors #1).
          submitResult = await invoke("regenerateTestCase", { jobId, storyIdx, breakdown: pendingBreakdown || results?.breakdown });
        } catch (_invokeErr) {
          setRegenStates((prev) => ({ ...prev, [storyIdx]: "error" }));
          return;
        }
        if (submitResult.error) {
          setRegenStates((prev) => ({ ...prev, [storyIdx]: "error" }));
          return;
        }
        setRegenStates((prev) => ({ ...prev, [storyIdx]: "polling" }));

        // Poll this story's regen until done
        clearInterval(regenPollRefs.current[storyIdx]);
        regenPollRefs.current[storyIdx] = setInterval(async () => {
          try {
            const st = await invoke("pollRegenerateTestCase", { jobId, storyIdx });
            if (!st || st.error) {
              clearInterval(regenPollRefs.current[storyIdx]);
              setRegenStates((prev) => ({ ...prev, [storyIdx]: "error" }));
              return;
            }
            if (st.status === "completed") {
              clearInterval(regenPollRefs.current[storyIdx]);
              // Delta-patch: only update the one entry in testCaseResults.perStory
              setTestCaseResults((prev) => {
                if (!prev) return prev;
                const updated = prev.perStory.map((entry) => {
                  if (entry.storyIdx !== storyIdx) return entry;
                  return {
                    ...entry,
                    result: st.result !== undefined ? st.result : entry.result,
                    coverage: st.coverage !== undefined ? st.coverage : entry.coverage,
                    // (c) adopt the EDITED story the regen used → the per-story staleness clears for this card.
                    story: st.story !== undefined ? st.story : entry.story,
                    error: st.error,
                    // [deep-audit P4 F1] the A5 flag rides the live response — spread-only
                    // kept a STALE chip after a clean regen and showed NO chip after a
                    // still-truncated one (both self-corrected only on remount).
                    truncated: st.truncated === true ? true : undefined,
                  };
                });
                const failedCount = updated.filter((e) => e && e.error).length;
                return { ...prev, perStory: updated, failedCount };
              });
              setRegenStates((prev) => ({ ...prev, [storyIdx]: "done" }));
            } else if (st.status === "failed") {
              clearInterval(regenPollRefs.current[storyIdx]);
              setRegenStates((prev) => ({ ...prev, [storyIdx]: "error" }));
            }
          } catch (e) {
            console.error("Regen poll error:", e);
          }
        }, POLL_MS);
      })();
    },
    [jobId, pendingBreakdown, results, persistFailed],
  );

  // handleSaveTestCase — persist ONE story's hand-edits to KVS via saveTestCases, then delta-patch
  // testCaseResults from the SAVED + sanitized result/coverage (the resolver returns the authoritative
  // shape: cap-20, dropped empties, recomputed coverage — never the raw edit buffer). Returns the
  // resolver response so TestCasesScreen drives its per-story Save UI (saved / fail-loud-keep-buffer).
  // Mirrors the regenerate delta-patch above. Editing CASES doesn't change ACs → the push-embed
  // AC-hash is unchanged → the embed reads the edited entry for free (no push change needed).
  const handleSaveTestCase = useCallback(
    async (storyIdx, result) => {
      let resp;
      try {
        resp = await invoke("saveTestCases", { jobId, storyIdx, result });
      } catch (e) {
        return { error: "save_failed", detail: String(e?.message || e) || "Save failed (network)." };
      }
      if (resp && resp.ok) {
        setTestCaseResults((prev) => {
          if (!prev) return prev;
          const updated = prev.perStory.map((entry) => {
            if (entry.storyIdx !== storyIdx) return entry;
            return {
              ...entry,
              result: resp.result !== undefined ? resp.result : entry.result,
              coverage: resp.coverage !== undefined ? resp.coverage : entry.coverage,
              error: undefined, // a hand-authored valid story drops any prior error sentinel
              // [deep-audit P4 F3] clear-on-save semantics, ALIGNED with storage: the
              // saved entry is the BA's reviewed content — the stored rebuild drops the
              // A5 flag, so the chip must clear here too (it used to linger till remount).
              truncated: undefined,
            };
          });
          const failedCount = updated.filter((e) => e && e.error).length;
          return { ...prev, perStory: updated, failedCount };
        });
      }
      return resp;
    },
    [jobId],
  );

  const handleOpenTestCases = useCallback((edited) => {
    // Navigate to the Test Cases screen. After the #1 flow redesign this is reached from the
    // Review/Confirm screen, where pendingBreakdown was ALREADY lifted (handlePush on the
    // editor→Review step) — so test-gen consumes the EDITED breakdown. The optional `edited` arg
    // + `.capabilities` guard remain a defensive lift: only a real legacy-shaped breakdown lifts,
    // never a stray truthy value (e.g. a SyntheticEvent) that would corrupt pendingBreakdown.
    if (edited && edited.capabilities) setPendingBreakdown(edited);
    setScreen("testcases");
  }, []);

  const handleBackFromTestCases = useCallback(() => {
    // #1 fix (flow redesign): Test Cases is now reached FROM the Review/Confirm screen (the single
    // lift point), so Back returns there — not to the editor. (dryRunResult + pendingBreakdown were
    // set by handlePush on the editor→Review step, so the Review screen re-renders cleanly.)
    setScreen("confirming");
    // Intentionally does NOT clear testCaseResults — they persist until page change / regenerate
  }, []);

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
    // Fix 4: stop in-flight TC + regen polls (interval-leak on SPA navigation)
    clearInterval(tcPollRef.current);
    Object.values(regenPollRefs.current).forEach(clearInterval);
    // Fix 6: reset TC UI state so the reviewing screen doesn't show a stuck "⏳ Generating…"
    setTcGenerating(false);
    setRegenStates({});
    setTcJobStatus(null);
    setError(null);
    setErrorRefId(null); // [diag Phase 3] leaving the error screen — drop its ref
    setJobId(null);
    setJobStatus(null);
    setResults(null);
    setTestCaseResults(null);
    setPushResult(null);
    setDryRunResult(null);
    setPendingBreakdown(null);
    setPersistFailed(false); // [deep-audit F6] clear wherever results is nulled (defensive invariant)
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
    // Fix 4: stop in-flight TC + regen polls (interval-leak on SPA navigation)
    clearInterval(tcPollRef.current);
    Object.values(regenPollRefs.current).forEach(clearInterval);
    // Fix 6: reset TC UI state so the reviewing screen doesn't show a stuck "⏳ Generating…"
    setTcGenerating(false);
    setRegenStates({});
    setTcJobStatus(null);
    setResults(null);
    setTestCaseResults(null);
    setPendingBreakdown(null);
    setJobId(null);
    setJobStatus(null);
    setDryRunResult(null);
    setPushResult(null);
    setStaleBreakdown(null);
    setPersistFailed(false); // [deep-audit F6] clear wherever results is nulled
    setIsPushing(false);
    setScreen("ready");
  }, []);

  // handleStartOver (multi-batch, 2026-06-10) — "Start over" on the GENERATING screen. The user
  // edited the page after starting, so this in-flight run is on a STALE version → ABANDON it.
  // Reuses handleRegenerate (clears polls + state, routes to Ready) THEN best-effort purges the
  // job so it disappears from the dashboard immediately — otherwise it lingered as "⏳ In
  // progress" (pre-dashboard this side effect was invisible; the run keeps going on Anthropic's
  // side and expires ~24h orphaned — we just stop tracking/surfacing it; partner chose this over
  // a cancel-batch API). Capture jobId BEFORE handleRegenerate nulls it. (Reviewing's
  // "Regenerate" deliberately KEEPS its completed job — that breakdown is still useful + resumable;
  // only the in-flight Start-over abandons.)
  const handleStartOver = useCallback(() => {
    const abandonedJobId = jobId;
    handleRegenerate();
    if (abandonedJobId) {
      invoke("purgeJob", { jobId: abandonedJobId }).catch((e) =>
        console.error("Start-over purge failed (non-fatal):", e),
      );
    }
  }, [jobId, handleRegenerate]);

  // handleNewPage — clear page binding, return to picker. Used от
  // PushedScreen "Generate Another" (post-push, user wants different
  // spec).
  const handleNewPage = useCallback(() => {
    clearInterval(pollRef.current);
    clearInterval(pushPollRef.current);
    // Fix 4: stop in-flight TC + regen polls (interval-leak on SPA navigation)
    clearInterval(tcPollRef.current);
    Object.values(regenPollRefs.current).forEach(clearInterval);
    // Fix 6: reset TC UI state so the reviewing screen doesn't show a stuck "⏳ Generating…"
    setTcGenerating(false);
    setRegenStates({});
    setTcJobStatus(null);
    setError(null);
    setErrorRefId(null); // [diag Phase 3] page unbound — drop any error ref
    setPageId(null);
    setPageData(null);
    setJobId(null);
    setJobStatus(null);
    setResults(null);
    setTestCaseResults(null);
    setPushResult(null);
    setDryRunResult(null);
    setPendingBreakdown(null);
    setPersistFailed(false); // [deep-audit F6] clear wherever results is nulled
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

  // In-app Settings open/close. handleOpenSettings is the ONLY place that flips
  // settingsFromApp → TRUE (so AdminSettings gets a "← Back" button); the globalSettings
  // admin surface routes to "admin" via the init gate with settingsFromApp left FALSE
  // (standalone, no Back). handleCloseSettings re-runs the init/config gate (reinitNonce)
  // so a just-configured app routes straight to the picker instead of back to Setup.
  const handleOpenSettings = useCallback(() => {
    setSettingsInitialTab("settings"); // [diag Phase 5] the Settings entry keeps its historical behavior
    setSettingsDiagRefFilter(null);
    setSettingsFromApp(true);
    setScreen("admin");
  }, []);
  // [diag Phase 5, design §5] In-app click-nav to Settings → Diagnostics, pre-filtered
  // by the failure's diagnostic ref (≤2 clicks from any failure). Used by
  // DiagnosticRefLine's [Open Diagnostics] on BOTH render sites (ErrorScreen + the
  // Ready failure card). A null/absent ref opens the tab unfiltered.
  const handleOpenDiagnostics = useCallback((ref) => {
    // [deep-audit P5 LOW-1] snapshot the screen we leave — closing Diagnostics used to
    // reinit to the picker, and for 'pushed' that DESTROYED the (purged-job) push
    // summary the banner annotates: the partial-failure list + created-issue links
    // were unrecoverable. 'pushed' is pure client state → restore it on close.
    settingsReturnScreenRef.current = screenRef.current === "pushed" ? "pushed" : null;
    setSettingsInitialTab("diagnostics");
    setSettingsDiagRefFilter(typeof ref === "string" && ref ? ref : null);
    setSettingsFromApp(true);
    setScreen("admin");
  }, []);
  const handleCloseSettings = useCallback(() => {
    setSettingsFromApp(false);
    setSettingsInitialTab("settings"); // [diag Phase 5] leaving admin — reset the entry tab + ref filter
    setSettingsDiagRefFilter(null);
    if (settingsReturnScreenRef.current === "pushed" && pushResult) {
      // [P5 LOW-1] return to the still-in-state push summary instead of reinit.
      settingsReturnScreenRef.current = null;
      setScreen("pushed");
      return;
    }
    settingsReturnScreenRef.current = null;
    setScreen("loading");
    setReinitNonce((n) => n + 1);
  }, [pushResult]);

  // ── Render ────────────────────────────────────────────────────
  // Admin page has its own full-screen component.
  //   • Opened from WITHIN the app (settingsFromApp) → wrap with a "← Back" button so
  //     the user can return to where they were (the only in-app way back to the app,
  //     since the globalSettings Configure page is unreachable in the centralized admin).
  //   • The globalSettings admin module (settingsFromApp === false) renders standalone,
  //     no Back button — it IS the dedicated settings surface.
  if (screen === "admin") {
    if (!settingsFromApp)
      return (
        <AdminSettings
          initialTab={settingsInitialTab}
          diagRefFilter={settingsDiagRefFilter}
        />
      );
    // Opened from within the app: AdminSettings is maxWidth:640 + p-8 but NOT
    // centered, so on the wide globalPage it floated left ("flies in the air") and
    // the Back button sat detached. Wrap both in a centered 640px frame (matching
    // AdminSettings' own width) and give the Back button px-8 (= AdminSettings' p-8
    // left inset) so it aligns with the settings content.
    return (
      <div style={{ maxWidth: "640px", margin: "0 auto" }}>
        <div className="px-8 pt-6">
          <button
            type="button"
            onClick={handleCloseSettings}
            style={{
              background: "none",
              border: "none",
              color: "var(--s2j-blue)",
              cursor: "pointer",
              fontSize: "0.8125rem",
              padding: 0,
            }}
          >
            ← Back
          </button>
        </div>
        <AdminSettings
          initialTab={settingsInitialTab}
          diagRefFilter={settingsDiagRefFilter}
        />
      </div>
    );
  }
  if (screen === "setup")
    return (
      <SetupScreen
        message={error}
        isManaged={usage?.edition === "advanced"}
        onOpenSettings={handleOpenSettings}
      />
    );

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
          {/* Test-case entry moved to the Review screen (ConfirmScreen) — single lift point (#1 fix). */}
          {/* Regenerate (2026-06-02) — the must-have path back to generation. A
              reopened completed page lands here on the OLD breakdown (routeByPageStatus
              bypasses Ready), so without this a user who edited the spec page had no
              discoverable way to re-run. Routes to Ready (handleRegenerate) — NOT
              auto-generate — so the user can re-pick the Project Context profile + see
              their usage first. Always present; the stale banner below just makes it
              salient when the page changed. Mirrors BackButton's muted-with-hover style;
              marginRight: -8px pins it to the far end of this flex-row top-bar. */}
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
          {/* Persist-failed banner (diagnostics Phase 0, §3.1) — the completed breakdown
              could not be written to Forge storage (typically the ~240KB KVS value cap on
              very large pages); pollJobStatus handed the results forward inline and they
              exist ONLY in this tab. ADDITIVE sibling of the stale-page banner (same amber
              style); no existing copy changed. */}
          {persistFailed && (
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
                  This breakdown could not be saved to storage (too large).
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--s2j-text-light)" }}>
                  It is loaded in this tab only — review and push it now, or it will be
                  lost when you leave. Consider splitting very large pages.
                </p>
              </div>
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

  // Edit-after-generate staleness (#1 honest-signal): the BA edited the breakdown AFTER generating
  // test cases → the cases (stamped against the OLD ACs) are outdated. Compare the current breakdown's
  // AC-signature to what the LOADED cases were generated against (perStory[].story.acceptance_criteria =
  // the stamped ACs the push will hash). Frontend-only; surfaces a WARNING — NO auto-regen (the BA's
  // call whether to push as-is or regenerate, per the cost/agency decision). Normalized EXACTLY like the
  // backend normAC (curly quotes / NBSP / "AC1:" prefix / backslash folds) so the warning fires precisely
  // when the push would skip the embed — and the matching idempotency check re-generates on the same
  // signal. Order-independent across stories + ACs.
  const tcStaleInfo = (() => {
    if (!testCaseResults || !Array.isArray(testCaseResults.perStory)) return { any: false, staleIdxs: [], removedIdxs: [] };
    const sig = (stories) => {
      const acs = [];
      for (const s of Array.isArray(stories) ? stories : []) {
        for (const ac of Array.isArray(s && s.acceptance_criteria) ? s.acceptance_criteria : []) {
          const n = String(ac == null ? "" : ac)
            .replace(/^\s*AC\s*\d+\s*[:.]\s*/i, "").replace(/\\/g, "")
            .replace(/[‘’‛′]/g, "'").replace(/[“”‟″]/g, '"')
            .replace(/ /g, " ").replace(/\s+/g, " ").trim().toLowerCase();
          if (n) acs.push(n);
        }
      }
      return acs.sort().join("|");
    };
    const cur = pendingBreakdown || results?.breakdown;
    const currentStories = cur && Array.isArray(cur.capabilities) ? cur.capabilities.flatMap((c) => c.features || []) : [];
    if (!currentStories.length) return { any: false, staleIdxs: [], removedIdxs: [] }; // no current breakdown to compare → never false-warn
    // (a) per-story staleness bound to the STABLE _uid (POLICY §3.5) → robust to reorder / rename /
    // restructure in the editor, where index- or name-matching mis-targets. Falls back to unique-name,
    // then positional index, for old breakdowns/regens that predate _uid (backward-compatible).
    // findCur returns the matching current story, or undefined if the stamped story is GONE from the
    // breakdown (uid + unique-name both absent = removed in the editor).
    const findCur = (p) => {
      const s = p.story || {};
      if (s._uid) { const byUid = currentStories.find((c) => c && c._uid === s._uid); if (byUid) return byUid; }
      if (s.name) { const named = currentStories.filter((c) => c && c.name === s.name); if (named.length === 1) return named[0]; }
      return undefined;
    };
    const staleIdxs = [];
    const removedIdxs = [];
    for (const p of testCaseResults.perStory) {
      if (!p || !p.story) continue;
      const cur = findCur(p);
      if (cur === undefined) {
        // a uid-bearing stamp with no current match → the story was REMOVED → an ORPHAN card (not "stale").
        // Legacy stamps (no _uid) keep the old positional comparison rather than false-flagging removed.
        if (p.story._uid) { removedIdxs.push(p.storyIdx); continue; }
        if (sig([currentStories[p.storyIdx]]) !== sig([p.story])) staleIdxs.push(p.storyIdx);
        continue;
      }
      if (sig([cur]) !== sig([p.story])) staleIdxs.push(p.storyIdx);
    }
    // (#2 fix, Attack 8) drive the GLOBAL banner/ConfirmScreen-amber from the per-story result — ONE
    // identity model. Prevents a green "✓ generated" while stories are actually stale (e.g. an AC moved
    // between two stories leaves the global AC multiset unchanged but both stories drifted).
    const any = staleIdxs.length > 0 || removedIdxs.length > 0;
    return { any, staleIdxs, removedIdxs };
  })();
  const tcStaleVsEdits = tcStaleInfo.any;
  const tcStaleStoryIdxs = tcStaleInfo.staleIdxs;
  const tcRemovedStoryIdxs = tcStaleInfo.removedIdxs;

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
      // Settings affordance lives in PagePicker's header (top-right, opposite the
      // title). WHY in-app at all: the globalSettings Configure page is unreachable in
      // the centralized "Connected apps" admin, so the picker (the default entry point)
      // must offer its own way into Settings.
      return (
        <PagePickerScreen
          onSelect={handlePageSelected}
          onOpenSettings={handleOpenSettings}
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
          onOpenSettings={handleOpenSettings}
          onOpenDiagnostics={handleOpenDiagnostics}
          genFailureNotice={genFailureNotice}
        />
      );
    case "generating":
      return (
        <GeneratingScreen
          pageTitle={pageData?.title}
          jobStatus={jobStatus}
          elapsed={elapsed}
          onBack={handleNewPage}
          onStartOver={handleStartOver}
        />
      );
    case "generatingTests":
      return (
        <GeneratingTestsScreen
          pageTitle={pageData?.title}
          tcElapsed={tcElapsed}
          onBack={handleBackFromTestCases}
        />
      );
    case "testcases":
      return (
        <TestCasesScreen
          testCaseResults={testCaseResults}
          breakdown={pendingBreakdown || results?.breakdown}
          pageTitle={pageData?.title}
          jobId={jobId}
          currentVersion={pageData?.version}
          onBack={handleBackFromTestCases}
          onPush={handlePush}
          onGenerate={handleGenerateTestCases}
          tcStale={tcStaleVsEdits}
          tcStaleStoryIdxs={tcStaleStoryIdxs}
          tcRemovedStoryIdxs={tcRemovedStoryIdxs}
          onRegenerate={handleRegenerateTestCase}
          onSaveTestCase={handleSaveTestCase}
          regenStates={regenStates}
        />
      );
    case "confirming":
      return (
        <ConfirmScreen
          dryRunResult={dryRunResult}
          breakdown={pendingBreakdown}
          truncationNote={results?.truncation_note}
          persistFailed={persistFailed}
          isPushing={isPushing}
          onConfirm={handleConfirmedPush}
          onBack={handleBackToReview}
          onBackToPicker={handleNewPage}
          onRemoveDependency={handleRemoveDependency}
          onRestoreDependency={handleRestoreDependency}
          testCaseResults={testCaseResults}
          onGenerateTestCases={handleGenerateTestCases}
          onOpenTestCases={handleOpenTestCases}
          tcGenerating={tcGenerating}
          tcStale={tcStaleVsEdits}
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
          jobId={jobId}
          onOpenDiagnostics={handleOpenDiagnostics}
          tcDiscarded={tcDiscardedAtPush}
        />
      );
    case "limit_reached":
      return <LimitReachedScreen quota={quotaInfo} onBack={handleNewPage} />;
    case "error":
      return (
        <ErrorScreen
          error={error}
          jobId={errorRefId}
          onRetry={handleRetry}
          onBackToPicker={pageData ? handleNewPage : null}
          onOpenDiagnostics={handleOpenDiagnostics}
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

// [diag Phase 3+5, design §5] Diagnostic-ref line — "Diagnostic ref: <ref> [Copy]" + the
// "Full report" pointer, now with a LIVE [Open Diagnostics] link-button (Phase 5) that
// navigates in-app to Settings → Diagnostics pre-filtered by this ref (onOpenDiagnostics
// → App's handleOpenDiagnostics).
// Shared by the Ready failure card and ErrorScreen — BOTH render sites get the click-nav
// through this one component. Renders NOTHING when refId is absent
// (never an "undefined" ref). Copy mirrors the app's existing clipboard pattern
// (StoryTestCaseCard/TestCasesScreen): navigator.clipboard + discriminated
// "✓ Copied"/"Copy failed" feedback with a timed reset — no data-URI download fallback
// for a short ref string (that fallback exists for large export payloads).
function DiagnosticRefLine({ refId, onOpenDiagnostics }) {
  const [copyState, setCopyState] = useState("idle"); // 'idle' | 'copied' | 'failed'
  // [diag Phase 5, gate fix — null-ref affordance] failures without a correlation id
  // (page-fetch, managed-unavailable…) still WRITE null-ref ledger records — give them
  // a path to Diagnostics too: "Recorded in Diagnostics" + an unfiltered open. Render
  // nothing only when there is neither a ref NOR a navigation handler.
  if (!refId && !onOpenDiagnostics) return null;
  if (!refId) {
    return (
      <div className="mt-2 text-xs" style={{ color: "var(--s2j-text-muted)" }}>
        Recorded in Diagnostics
        <button
          type="button"
          onClick={() => onOpenDiagnostics(null)}
          className="text-xs"
          style={{
            background: "none",
            border: "none",
            color: "var(--s2j-blue)",
            textDecoration: "underline",
            cursor: "pointer",
            padding: 0,
            marginLeft: "8px",
          }}
          title="Open the Diagnostics tab"
        >
          Open Diagnostics
        </button>
      </div>
    );
  }
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(String(refId));
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch (_) {
      setCopyState("failed");
      setTimeout(() => setCopyState("idle"), 2500);
    }
  };
  return (
    <div className="mt-2 text-xs" style={{ color: "var(--s2j-text-light)" }}>
      <span style={{ fontFamily: "monospace" }}>Diagnostic ref: {refId}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="text-xs"
        style={{
          background: "var(--s2j-bg)",
          border: "1px solid var(--s2j-border)",
          color: "var(--s2j-text)",
          cursor: "pointer",
          padding: "1px 8px",
          borderRadius: "4px",
          marginLeft: "8px",
        }}
        title="Copy the diagnostic reference (include it when contacting support)"
      >
        {copyState === "copied"
          ? "✓ Copied"
          : copyState === "failed"
            ? "Copy failed — check browser permissions"
            : "Copy"}
      </button>
      <div className="mt-1" style={{ color: "var(--s2j-text-muted)" }}>
        Full report: Settings → Diagnostics
        {/* [diag Phase 5] live in-app navigation — lands on the Diagnostics tab
            pre-filtered by this ref (the pointer text above stays as the fallback
            wayfinding when the handler isn't threaded). */}
        {onOpenDiagnostics && (
          <button
            type="button"
            onClick={() => onOpenDiagnostics(refId)}
            className="text-xs"
            style={{
              background: "none",
              border: "none",
              color: "var(--s2j-blue)",
              textDecoration: "underline",
              cursor: "pointer",
              padding: 0,
              marginLeft: "8px",
            }}
            title="Open the Diagnostics tab filtered to this reference"
          >
            Open Diagnostics
          </button>
        )}
      </div>
    </div>
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
  onOpenSettings,
  onOpenDiagnostics,
  genFailureNotice = null,
}) {
  // Prices come from getUsage's pricing[] (single source of truth — no hardcoded
  // USD prices in the UI). The hybrid has two paid editions: byokPro (unlimited, own
  // key) + managedPro (we run it). Only byokProPrice is surfaced on this badge (the
  // Managed → unlimited upsell); there is no Free tier to upsell from.
  const byokProPrice = findPrice(usage, "byokPro");
  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      <div className="flex items-center justify-between">
        {onBack ? (
          <BackButton
            onClick={onBack}
            title="Return to page picker (clears page selection; you can pick a different page)"
          />
        ) : (
          <span />
        )}
        {/* In-app Settings access — the centralized admin has no Configure link, so the
            app surfaces its own entry point here (manage Anthropic key, JIRA project,
            Project Context profiles). */}
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="text-xs"
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
            ⚙ Settings
          </button>
        )}
      </div>
      <h2
        className="text-lg font-semibold mb-1"
        style={{ color: "var(--s2j-text)" }}
      >
        {pageData.title}
      </h2>
      <p className="text-sm mb-4" style={{ color: "var(--s2j-text-light)" }}>
        {(pageData.body_length || 0).toLocaleString()} characters
      </p>

      {/* [diag Phase 3, S4] Last-generation-failed card — the dashboard ⚠ "Needs
          attention" click / failed-job reconnect lands HERE instead of a context-free
          Ready screen. ADDITIVE: everything below (usage badge, context picker,
          Generate) is unchanged; the Generate button doubles as the retry. */}
      {genFailureNotice && (
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
            ⚠ The last generation for this page failed
          </p>
          <p className="text-xs" style={{ color: "var(--s2j-text)" }}>
            {/* [diag Phase 5] When the stored user-facing detail is absent, humanize the
                stored error CODE via the diagnosticsView map (Phase-3 stored it un-rendered);
                the original generic sentence remains the final fallback when neither exists. */}
            {genFailureNotice.detail ||
              (genFailureNotice.code
                ? classText(genFailureNotice.code).title
                : "The generation could not complete. You can generate again below.")}
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--s2j-text-light)" }}>
            Generating again will start a fresh run.
          </p>
          <DiagnosticRefLine
            refId={genFailureNotice.refId}
            onOpenDiagnostics={onOpenDiagnostics}
          />
        </div>
      )}

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
            // describe it as the monthly fair-use allowance, not a raw cap number.
            <span>
              <strong style={{ color: "var(--s2j-text)" }}>
                {usage.tierLabel} plan
              </strong>{" "}
              · {usage.used} breakdowns this month · resets{" "}
              {usage.resetsAtLabel}
              {usage.remaining === 0 && byokProPrice && (
                <span style={{ color: "var(--s2j-text)" }}>
                  {" "}
                  · for unlimited, switch to BYOK Pro — bring your own Anthropic key
                  ({byokProPrice})
                </span>
              )}
            </span>
          ) : null}
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
        this Confluence page and produce a structured Jira breakdown —
        Stories, Subtasks, cross-feature dependencies, and quality signals.
        Typical runtime: a few minutes, depending on the size of your page.
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
            <option value="none">None — no project context</option>
            {contextProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="text-xs mt-1" style={{ color: "var(--s2j-text-muted)" }}>
            Applies your project's domain &amp; glossary to this breakdown. Pick the
            profile matching this page's project; manage profiles in Settings.
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

function GeneratingScreen({ pageTitle, elapsed, onBack, onStartOver }) {
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
      {/* Centered status — a big INDETERMINATE spinner with the LIVE elapsed time in
          the center. Generation runs on Anthropic's async Batch API, which gives NO
          granular progress for a single breakdown (one opaque call: submit → process
          → ended), so the old determinate bar sat near 0% then jumped to 100% — it
          read as "broken". An honest spinner + timer conveys "working, here's how
          long" without faking a percentage. */}
      <div className="flex flex-col items-center text-center py-6">
        <div className="relative mb-5" style={{ width: 96, height: 96 }}>
          <div
            className="absolute inset-0 rounded-full animate-spin"
            style={{
              border: "3px solid var(--s2j-border)",
              borderTopColor: "var(--s2j-blue)",
              animationDuration: "1.1s",
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className="text-xl font-mono font-semibold"
              style={{ color: "var(--s2j-text)" }}
            >
              {fmtTime(elapsed)}
            </span>
          </div>
        </div>
        <h2
          className="text-base font-semibold"
          style={{ color: "var(--s2j-text)" }}
        >
          Your Confluence page is being analyzed
        </h2>
        {pageTitle && (
          <p className="text-sm mt-0.5" style={{ color: "var(--s2j-text-light)" }}>
            {pageTitle}
          </p>
        )}
        <p
          className="text-xs mt-2.5"
          style={{ color: "var(--s2j-text-muted)", maxWidth: "26rem" }}
        >
          Building a structured Jira breakdown — Stories, Subtasks, cross-feature
          dependencies, and quality signals. This usually takes a few minutes; large
          pages and busy periods take longer.
        </p>
      </div>

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
          ☕ You can safely leave — we'll keep working
        </p>
        <p className="text-xs" style={{ color: "var(--s2j-text-light)" }}>
          Close this tab, switch tasks, or come back tomorrow — your breakdown keeps
          generating. Reopen this page (Apps → Spec2Tickets) and it will be waiting
          for you, even if it took a while.
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
          title="Abandon this run and start over from the current page (e.g. you edited the page after starting this generation)"
        >
          Edited the page after starting? Start over
        </button>
      )}
    </div>
  );
}

// ── GeneratingTestsScreen (P5) ──────────────────────────────────
// Clones GeneratingScreen for test-case bulk generation.
// Generation runs on Anthropic's async Batch API (same as the breakdown
// batch); the same "you can leave" and "taking longer" UX applies.
function GeneratingTestsScreen({ pageTitle, tcElapsed, onBack }) {
  // #3 (2026-06-07): NO determinate "% complete". Test-case generation is one async Anthropic BATCH
  // (N per-story requests that all finish together at the end), so progress sits at 0 the whole run
  // then jumps to 100 — the old "0% complete" read as BROKEN, most acutely right after a user-clicked
  // regenerate. An honest INDETERMINATE spinner + the live timer conveys "working, here's how long"
  // without faking a percentage (mirrors the breakdown GeneratingScreen fix).
  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      {onBack && (
        <BackButton
          onClick={onBack}
          label="Back to Review"
          title="Return to the breakdown editor. Test-case generation continues in the background — return to this breakdown to see progress."
        />
      )}
      <div className="flex flex-col items-center text-center py-6">
        <div className="relative mb-5" style={{ width: 96, height: 96 }}>
          <div
            className="absolute inset-0 rounded-full animate-spin"
            style={{
              border: "3px solid var(--s2j-border)",
              borderTopColor: "var(--s2j-blue)",
              animationDuration: "1.1s",
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className="text-xl font-mono font-semibold"
              style={{ color: "var(--s2j-text)" }}
            >
              {fmtTime(tcElapsed)}
            </span>
          </div>
        </div>
        <h2
          className="text-base font-semibold"
          style={{ color: "var(--s2j-text)" }}
        >
          Generating test cases…
        </h2>
        {pageTitle && (
          <p className="text-sm mt-0.5" style={{ color: "var(--s2j-text-light)" }}>
            {pageTitle}
          </p>
        )}
        <p
          className="text-xs mt-2.5"
          style={{ color: "var(--s2j-text-muted)", maxWidth: "26rem" }}
        >
          Building BA-grade acceptance scenarios for every story — Gherkin and CSV
          export included. Typically a few minutes; large breakdowns take longer.
        </p>
      </div>

      {tcElapsed >= 600 && (
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
              Test-case generation runs on Anthropic's Batch API; it can slow down under
              heavy load. Your request is still processing.
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
          ☕ You can safely leave — we'll keep working
        </p>
        <p className="text-xs" style={{ color: "var(--s2j-text-light)" }}>
          Close this tab or switch tasks — test-case generation continues in the
          background. Reopen the breakdown (Apps → Spec2Tickets) and the results
          will be waiting for you.
        </p>
      </div>
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
  persistFailed,
  isPushing,
  onConfirm,
  onBack,
  onBackToPicker,
  onRemoveDependency,
  onRestoreDependency,
  testCaseResults,
  onGenerateTestCases,
  onOpenTestCases,
  tcGenerating,
  tcStale,
}) {
  const total = dryRunResult?.total_items || 0;
  const epics = dryRunResult?.total_epics || 0;
  const stories = dryRunResult?.total_stories || 0;
  const tasks = dryRunResult?.total_subtasks || 0;
  const links = dryRunResult?.dependency_links || 0;
  const project = dryRunResult?.project_key || "(Settings)";
  const tcStaleNow = !!testCaseResults && !!tcStale; // edited-since-generation → amber warning (not green ✓)
  // 2-step armed confirm for the EXPENSIVE re-run-all (Phase-1 cost fix): a stale re-generate re-runs
  // ALL stories (full Anthropic cost), so the BA must click twice + see the scope — never a surprise
  // spend. (Targeted per-story / per-case regeneration is the separate follow-up feature.)
  const [regenArmed, setRegenArmed] = useState(false);
  const regenArmTimer = useRef(null);
  // Clear the arm timer on unmount so a pending setRegenArmed(false) never fires on an unmounted
  // ConfirmScreen (e.g. the BA arms Re-run then clicks "View / edit →" within the 4s window).
  useEffect(() => () => clearTimeout(regenArmTimer.current), []);

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
        Review and Push to Jira
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

      {/* Persist-failed warning (diagnostics Phase 0, §3.1) — the breakdown exists ONLY in
          this tab (it could not be written to Forge storage); repeated at the push decision
          point because pushing now is the way to keep it. ADDITIVE sibling of the truncation
          banner above (same pattern); no existing copy changed. */}
      {persistFailed && (
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
              This breakdown could not be saved to storage (too large).
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--s2j-text-light)" }}>
              It is loaded in this tab only — review and push it now, or it will be
              lost when you leave. Consider splitting very large pages.
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

      {/* Test-case summary line — shown when test cases have been generated */}
      {testCaseResults && typeof testCaseResults.total === "number" && (
        <div
          className="rounded-lg p-3 mb-4 text-xs"
          style={{
            background: "var(--s2j-bg-section)",
            border: "1px solid var(--s2j-border)",
            color: "var(--s2j-text-muted)",
          }}
        >
          <strong style={{ color: "var(--s2j-text)" }}>
            Test cases: {testCaseResults.total} generated
          </strong>{" "}
          — a summary will be added to each Story.
        </div>
      )}

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
            Document-level concerns surfaced by AI analysis. Address before push when severity is high.
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

      {/* Optional pre-push step (P5) — generate acceptance test cases for these stories. This is
          THE single entry point to test-case generation (moved here from the editor + top-bar so
          the BA's edits are always lifted into pendingBreakdown before generating — #1 fix). */}
      <div
        className="rounded-lg p-3 mb-3 flex items-center justify-between gap-3"
        style={{
          background: tcStaleNow ? "var(--s2j-orange-bg)" : testCaseResults ? "var(--s2j-green-bg)" : "var(--s2j-blue-bg)",
          border: `1px solid ${tcStaleNow ? "var(--s2j-orange-border)" : testCaseResults ? "var(--s2j-green-border)" : "var(--s2j-blue-border)"}`,
        }}
      >
        <div>
          <p className="text-xs font-medium" style={{ color: "var(--s2j-text)" }}>
            {tcStaleNow
              ? "⚠ Test cases may be outdated"
              : testCaseResults
              ? "✓ Acceptance test cases generated"
              : "Optional: acceptance test cases"}
          </p>
          <p className="text-xs" style={{ color: "var(--s2j-text-muted)" }}>
            {tcStaleNow
              ? "You edited the breakdown since generating these. Re-running re-generates ALL stories (takes a few minutes, uses compute) — or push as-is; the edited stories simply won't get a test-case summary. Your call."
              : "BA-grade Gherkin / CSV export + a summary embedded in each Jira Story."}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {/* Navigate to the Test Cases screen — available whenever test cases exist, INCLUDING the
              stale state (the screen carries its own stale banner). This is the always-free view/edit
              path; it NEVER regenerates. Fixes the trap where editing the breakdown left "Re-run all"
              as the ONLY affordance, blocking access to the existing cases + targeted per-story regen. */}
          {testCaseResults && (
            <button
              type="button"
              onClick={() => onOpenTestCases?.()}
              disabled={isPushing || tcGenerating}
              style={{
                background: "var(--s2j-green-bg)",
                border: "1px solid var(--s2j-green-border)",
                color: "var(--s2j-green-dark)",
                padding: "6px 12px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: 500,
                cursor: isPushing || tcGenerating ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              View / edit →
            </button>
          )}
          {/* Generate (no cases yet, blue) OR Re-run-all (stale → expensive; 2-step armed confirm,
              orange). NOT shown when fresh — the cases already match the breakdown, so re-running
              would be a pointless re-spend. NOT shown when persistFailed (gate M1): test-gen reads
              the stored job.breakdown, which in degraded mode is a small 'failed' stub → the call
              can only dead-end on the Error screen and strand the unsaved breakdown. */}
          {persistFailed && !testCaseResults && (
            <span
              style={{
                fontSize: "12px",
                color: "var(--s2j-text-muted)",
                whiteSpace: "nowrap",
              }}
              title="This breakdown could not be saved to Forge storage, so test-case generation (which reads the saved copy) is unavailable. Push to Jira now to keep your work."
            >
              🧪 Test cases unavailable — breakdown not saved
            </span>
          )}
          {!persistFailed && (!testCaseResults || tcStaleNow) && (
            <button
              type="button"
              onClick={() => {
                // Stale re-run-all is expensive (every story re-billed) → arm a 2-step confirm so the BA
                // consciously consents (Phase-1 cost fix). First click arms; second (within 4s) fires.
                if (tcStaleNow && !regenArmed) {
                  setRegenArmed(true);
                  clearTimeout(regenArmTimer.current);
                  regenArmTimer.current = setTimeout(() => setRegenArmed(false), 4000);
                  return;
                }
                setRegenArmed(false);
                onGenerateTestCases?.();
              }}
              disabled={isPushing || tcGenerating}
              style={{
                background: tcStaleNow ? "var(--s2j-orange-bg)" : "var(--s2j-blue-bg)",
                border: `1px solid ${tcStaleNow ? "var(--s2j-orange-border)" : "var(--s2j-blue-border)"}`,
                color: tcStaleNow ? "var(--s2j-text)" : "var(--s2j-blue)",
                padding: "6px 12px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: 500,
                cursor: isPushing || tcGenerating ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {tcGenerating
                ? "⏳ Generating tests…"
                : tcStaleNow
                ? regenArmed
                  ? `⚠ Re-runs all ${stories} stories — confirm?`
                  : "🔄 Re-run all"
                : "🧪 Generate Test Cases"}
            </button>
          )}
        </div>
      </div>

      {/* Final action */}
      <div
        className="rounded-lg p-3 mb-4"
        style={{
          background: "var(--s2j-orange-bg)",
          border: "1px solid var(--s2j-orange-border)",
        }}
      >
        <p className="text-xs" style={{ color: "var(--s2j-text)" }}>
          This will create real Jira issues. The action cannot be undone from within Spec2Tickets.
        </p>
      </div>

      {/* [seams-audit HIGH (b)] honest consent: pushing now PURGES the in-flight
          TC batch (post-push purge deletes the tcjob) — the user must know the
          generating test cases will be discarded and not embedded. */}
      {tcGenerating && (
        <p className="text-xs mb-2" style={{ color: "var(--s2j-orange)" }}>
          ⚠ Test cases are still generating — pushing now discards that run (they
          will not be embedded in the Jira stories).
        </p>
      )}
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
            `Create ${total} Items in Jira`
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
// Data: edges = signals.dependencyEdges = [{source, target, targetDisplay}] where `source` is
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

  // Task #4: the target string is the FROZEN dep name (the depended-on feature's
  // generation name) — it stays the mutation/tracking key everywhere (remove/restore
  // filter dependencies[] by it). labelOf resolves it to that feature's CURRENT name
  // for DISPLAY only, so after a rename the Review shows the current name, not the
  // stale original. Fallback to the raw string (legacy / paraphrase / deleted dep).
  const displayOf = new Map();
  for (const e of edges || []) {
    if (e && e.target != null) displayOf.set(e.target, e.targetDisplay || e.target);
  }
  const labelOf = (t) => displayOf.get(t) || t;

  const handleRemove = (source, target) => {
    onRemove?.(source, target);
    setRemoved((prev) =>
      prev.some((r) => r.source === source && r.target === target)
        ? prev
        : [...prev, { source, target, display: labelOf(target) }],
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
            Each becomes a Story-blocks-Story link in Jira — the feature it depends on
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
                          <span style={{ color: "var(--s2j-text-light)" }}>{labelOf(t)}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemove(source, t)}
                          title={`Remove this dependency — "${source}" will no longer be blocked by "${labelOf(t)}" in Jira`}
                          aria-label={`Remove dependency: ${source} depends on ${labelOf(t)}`}
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
            Removed — won't be pushed to Jira ({removed.length})
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
                  {r.source} → {r.display || r.target}
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
      ? "Creating Stories..."
      : phase === "subtasks"
        ? "Creating Subtasks..."
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
          Creating issues in Jira
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

function PushedScreen({ result, onBack, onNew, jobId = null, onOpenDiagnostics, tcDiscarded = false }) {
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
            Pushed to Jira
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
        {(result?.tc_embedded > 0 || result?.tc_skipped > 0) && (
          <p className="text-xs mt-1" style={{ color: "var(--s2j-text-light)" }}>
            {result.tc_embedded > 0
              ? `Test cases summarized in ${result.tc_embedded} Stor${result.tc_embedded === 1 ? "y" : "ies"}`
              : "Test cases were not attached to any Story"}
            {result.tc_skipped > 0
              ? ` (${result.tc_skipped} skipped — ACs changed since generation; regenerate on the Test Cases screen)`
              : ""}
          </p>
        )}
        {/* [polish] a test-case run was in flight when the user pushed → it was
            discarded (the Create-button warning consented to this). Confirm it here
            so they don't have to open Diagnostics to learn what happened. */}
        {tcDiscarded && (
          <p className="text-xs mt-1" style={{ color: "var(--s2j-orange)" }}>
            ℹ The in-progress test-case generation was discarded — regenerate from the
            editor after the push if you want them embedded.
          </p>
        )}
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
            Open in Jira
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
            This Jira project has no Subtask issue type, so the task breakdown
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
        // Truncate the banner reason at a WORD boundary + ellipsis (it was a hard
        // mid-word substring(0,200) → "…Required custom fie"); the full reason is
        // always in Settings → Diagnostics (Copy report).
        const reasonText = (() => {
          const full = String(firstDetail || "");
          if (full.length <= 220) return full;
          const cut = full.slice(0, 220);
          const sp = cut.lastIndexOf(" ");
          return (sp > 160 ? cut.slice(0, sp) : cut) + "…";
        })();
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
                Reason: {reasonText}
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
            {/* [diag Phase 5, gate MED-3] the partial-push class (the S1 paraphrased-link
                case) is the feature's highest-value diagnostics class — give the banner
                the ref + the in-app path to the pre-filtered Diagnostics tab. */}
            <DiagnosticRefLine refId={jobId} onOpenDiagnostics={onOpenDiagnostics} />
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
// A NORMAL state (not an error) — friendly framing, no "Something went wrong", no
// pointless "Try again", no support-as-primary. There is no in-app Free tier (the
// 30-day Atlassian trial covers evaluation; after it, an unsubscribed user is
// blocked natively by Atlassian and never reaches the app). So this screen drives
// just two situations (the routing sets `quota`):
//
//   1. Managed Pro fair-use cap hit (quota_exceeded, fairUse=true) — we run Claude
//      and pay compute, so the monthly allowance is fair-use, not a trial wall. Path
//      forward: switch to BYOK Pro (unlimited with the customer's own key).
//   2. license_required (DEFENSIVE — shouldn't normally occur) — the backend reports
//      no active license. Show its composed `detail`; the path forward is to manage
//      the subscription in the Atlassian admin hub.
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
  // Mode from the routing payload. license_required (defensive) → no active license;
  // otherwise a quota_exceeded payload, which can only be the Managed Pro fair-use
  // cap (there is no Free tier). Default to the fair-use framing.
  const isLicenseRequired = quota?.error === "license_required";
  const isFairUse = !isLicenseRequired;

  const limit = quota?.limit;
  const resetsAt =
    quota?.resetsAtLabel ||
    (quota?.resetsAt ? String(quota.resetsAt).slice(0, 10) : null);
  const byokProPrice = findPrice(quota, "byokPro");
  // Only surfaced in the license_required (no-plan) branch — fair-use already has a plan.
  const managedProPrice = findPrice(quota, "managedPro");

  // Headline + intro. Prefer the backend-composed `detail` for the body (it is
  // already tier-correct and mentions the reset date / prices); fall back to a
  // mode-specific sentence if it is ever absent.
  const heading = isLicenseRequired
    ? "Subscription required"
    : "You've used this month's breakdowns";
  const fallbackBody = isLicenseRequired
    ? "An active subscription is required to use Spec2Tickets. Manage your subscription from your Atlassian site admin."
    : limit
      ? `You've used all ${limit} breakdowns included this month${
          resetsAt ? ` — they reset on ${resetsAt}.` : "."
        }`
      : "You've used this month's breakdowns.";

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
        {/* Reset date is the actionable info for a Managed user waiting out the
            fair-use month rather than switching to BYOK. license_required has no
            monthly reset (it's an account/subscription state, not a quota). */}
        {isFairUse && !quota?.detail && resetsAt && (
          <p className="text-sm mt-1" style={{ color: "var(--s2j-text-light)" }}>
            Your monthly breakdowns reset on <strong>{resetsAt}</strong>.
          </p>
        )}
      </div>

      {/* Subscription card. Fair-use (Managed) routes to BYOK Pro ONLY (unlimited);
          license_required (no plan) offers both editions to choose from. */}
      {(byokProPrice || (isLicenseRequired && managedProPrice)) && (
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

function ErrorScreen({ error, jobId = null, onRetry, onBackToPicker, onOpenDiagnostics }) {
  // EH1 polish part 27 (2026-05-09) — last-resort defensive HTML strip.
  // Most error paths now route through `_classifyBackendError` which
  // discards HTML detail bodies, but legacy paths (mid-pipeline polling
  // errors / unanticipated shapes) may still leak HTML into the error
  // string. Detect "<html>" prefix → replace с friendly fallback so
  // ErrorScreen never shows raw markup to the user.
  const rawError = typeof error === "string" ? error : JSON.stringify(error);
  const hasHtml = /<html|<!doctype/i.test(rawError);
  const displayError = hasHtml
    ? "Spec2Tickets received an unexpected response. The service may be temporarily unreachable — please try again, or open Settings (top-right) to check your configuration."
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
        {/* [diag Phase 3, design §5] ADDITIVE diagnostic ref under the verbatim error
            text — the existing message above is never shortened or replaced. Renders
            nothing when no jobId is in scope for this failure (jobId null). */}
        <DiagnosticRefLine refId={jobId} onOpenDiagnostics={onOpenDiagnostics} />
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
 * SetupScreen — shown when Spec2Tickets is not yet configured. Complements
 * AdminSettings (does not repeat its content). TIER-AWARE (hybrid 2026-06-03):
 * Managed Pro (Advanced) runs Claude on our key, so it asks ONLY for a JIRA
 * project key; BYOK Pro (Standard) also needs the customer's own Anthropic key.
 *
 * Surfaces to customer:
 *   - Prerequisite: a JIRA project key (+ an Anthropic API key for BYOK only)
 *   - Navigation path: how to reach Settings to configure them
 */
function SetupScreen({ message, isManaged = false, onOpenSettings }) {
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

        {/* Prerequisite — TIER-AWARE (hybrid 2026-06-03). Managed Pro (Advanced)
            runs Claude on OUR key → only the JIRA project key is needed; BYOK Pro
            (Standard) also needs the customer's own Anthropic key. */}
        {isManaged ? (
          <p className="text-sm mb-3" style={{ color: "var(--s2j-text)" }}>
            <strong>You will need:</strong>
            <br />• A Jira project key where the breakdown will be created
            <br />
            <span style={{ color: "var(--s2j-text-light)" }}>
              No Anthropic API key needed — Managed Pro runs Claude with our key.
            </span>
          </p>
        ) : (
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
            <br />• A Jira project key where the breakdown will be created
          </p>
        )}

        {/* Primary call-to-action — open the app's OWN in-app Settings. This is the
            reliable path: the globalSettings "Configure" page is unreachable in the
            centralized admin (see App-level note). The "How to configure" steps below
            remain as a secondary fallback for users who prefer the admin route. */}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="btn-primary justify-center mb-3"
          >
            Open Settings
          </button>
        )}

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
            4.{" "}
            {isManaged
              ? "Set your Jira Project Key, then Save"
              : "Paste your Anthropic API key + Jira Project Key, then Test & Save"}
          </p>
          <p style={{ marginTop: "6px", fontStyle: "italic" }}>
            {isManaged
              ? "Powered by Claude Sonnet 4.6 — Managed Pro runs it for you (no API key needed). Your page content flows from Forge to the Anthropic API; nothing is stored on Spec2Tickets servers."
              : "Powered by Claude Sonnet 4.6 — your page content flows directly from Forge to the Anthropic API using your own key. No data on Spec2Tickets servers."}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Util ────────────────────────────────────────────────────────

// Look up a tier's display price from a getUsage/quota pricing[] array. The
// pricing table is the SINGLE source of USD prices (composed server-side) — the UI
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
