/**
 * Spec2Tickets — Forge Custom UI
 *
 * Flow: loading → ready → generating → insights → reviewing → confirming → pushed
 * Includes: reconnect on mount, non-blocking generation, confirmation step.
 *
 * Palette: Swagger/OpenAPI-inspired (#3b4151, #61affe, #49cc90, #fca130, #f93e3e)
 */
import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { invoke, view, router } from "@forge/bridge";
import BreakdownEditor from "./components/breakdown";
import AdminSettings from "./components/AdminSettings";
import PagePickerScreen from "./components/PagePicker";
import BackButton from "./components/BackButton";
import TestCasesScreen from "./components/TestCasesScreen";
import PlanScreen from "./components/PlanScreen";
import { SignalCallout, SignalIcon } from "./components/Signal";
import { ScreenHeader, MoodCard, TYPE, MOOD, glassSurface } from "./components/moodboard";
import {
  IconRefresh,
  IconClock,
  IconCost,
  IconBeaker,
  IconX,
  IconUndo,
  IconExternalLink,
  IconSettings,
  IconLink,
  IconCalendar,
  IconList,
  IconCheck,
  IconChevronRight,
} from "./components/Icon";
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
import {
  extractPageOutline,
  estimateGenerationTimeBand,
  preflightVerdict,
  preflightAmberCount,
} from "./lib/pageOutline";
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
// ── Capacity-Sheet Planner: the default capacity form + the slim-feature projection ──
// The form holds RAW strings (the backend computeCapacity coerces + validates fail-loud, so '' is a
// blocker not a silent 0). availableDays is PER SPRINT (the pinned contract). Empty multipliers →
// the backend applies its honest defaults and ECHOES them in `assumptions`.
const DEFAULT_PLAN_FORM = {
  methodology: "scrum", // Kanban v1: 'scrum' (sprint boxes, default) | 'kanban' (Now/Next/Later reach band)
  people: [{ _rid: "r0", name: "", availableDays: "8" }],
  sprintCount: "4",
  sprintLengthDays: "10",
  sprintStartDate: "",
  hoursPerDay: "",
  focusFactor: "",
  hoursPerPoint: "",
  pointsPerSprintOverride: "",
  pointsPerQuarterOverride: "", // Kanban: a direct points-per-QUARTER override (the kanban analogue of pointsPerSprintOverride)
  objective: "balanced", // P12: goal-directed re-rank — balanced (default) / mvp / min_risk / max_value
};

// Bounds for the per-feature concern projection (SLIM-1): a feature carries a few typed concerns, each a
// sentence — forward enough to compute risk, never the whole prose (the planner re-derives risk from these).
const PLAN_FEATURE_CONCERN_CAP = 8;
const PLAN_CONCERN_CHAR_CAP = 240;
const PLAN_TASK_TYPE_CAP = 40; // Tier-2: bound the per-feature task-type token list (a feature has a handful of tasks)

// Slim per-feature projection sent to the planner (bounded payload; the planner only needs sizing +
// the uid-keyed dependency identity + the risk signals). Reads the EDITED breakdown (capabilities →
// features, or v3 flat). concerns + confidence_indicator drive the Tier-1 risk layer (computeRiskSignals).
function buildSlimFeatures(bd) {
  const caps = bd && Array.isArray(bd.capabilities) ? bd.capabilities : null;
  const feats = caps ? caps.flatMap((c) => (c && c.features) || []) : (bd && Array.isArray(bd.features) ? bd.features : []);
  return feats.map((f) => ({
    _uid: f._uid,
    _orig_name: f._orig_name,
    name: f.name,
    story_points: f.story_points,
    complexity_score: f.complexity_score,
    priority: f.priority,
    user_story: typeof f.user_story === "string" ? f.user_story.slice(0, 240) : undefined, // §8 enrichment for the ranking
    confidence_indicator: f.confidence_indicator, // ✓/⚠/✗ — low confidence is a Tier-1 risk signal
    concerns: Array.isArray(f.concerns)
      ? f.concerns.filter((c) => typeof c === "string" && c.trim()).slice(0, PLAN_FEATURE_CONCERN_CAP).map((c) => c.slice(0, PLAN_CONCERN_CHAR_CAP))
      : [],
    // Tier-2: the per-task discipline tokens (API/UI/DB/…) — the ONLY signal the skill-aware packer needs.
    // Compact (just the enum tokens, bounded); the planner maps them 7→3 (BE/FE/QA). Light enough to persist.
    task_types: Array.isArray(f.tasks) ? [...new Set(f.tasks.map((t) => t && t.type).filter((t) => typeof t === "string" && t))].slice(0, PLAN_TASK_TYPE_CAP) : [], // deduped — requiredSkillsOf only needs the SET
    dependencies: Array.isArray(f.dependencies) ? f.dependencies : [],
  }));
}

// Spec-WIDE concerns (SN-3) — passed ONCE to the ranker as plan-level context, never per-feature. Lives at
// the top-level spec_concerns (adapted shape) or _v3_original.spec_concerns (native v3). Backend re-bounds.
function extractSpecConcerns(bd) {
  const arr = (bd && Array.isArray(bd.spec_concerns) && bd.spec_concerns)
    || (bd && bd._v3_original && Array.isArray(bd._v3_original.spec_concerns) && bd._v3_original.spec_concerns)
    || [];
  return arr.filter((c) => typeof c === "string" && c.trim());
}

// The breakdown's executive summary — fed to the ranking model as PRODUCT CONTEXT (§8). Lives on
// metadata.spec_summary (native v3) or _v3_original.metadata (legacy-adapted shape).
function extractSpecSummary(bd) {
  const v3 = (bd && bd._v3_original) || bd || {};
  const s = (v3 && v3.metadata && v3.metadata.spec_summary) || (bd && bd.metadata && bd.metadata.spec_summary);
  return typeof s === "string" ? s.slice(0, 800) : "";
}

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
  // Page-preflight (design-army synthesis, 2026-07-01) — the default Jira project key
  // is already fetched by getSettings() at mount for the setup gate below, but was
  // previously discarded; retained here (mirrors the existing contextProfiles state
  // pattern) so ReadyScreen can name the ACTUAL push target before the user commits.
  const [defaultProjectKey, setDefaultProjectKey] = useState(null);
  const loadUsage = useCallback(async () => {
    try {
      const u = await invoke("getUsage");
      if (u && !u.error) setUsage(u);
    } catch (_) {
      /* badge is best-effort — hide on failure */
    }
  }, []);

  // Reset scroll + focus to the top on every screen change (UX). Without this,
  // navigating away from a screen scrolled to the bottom (e.g. BreakdownEditor)
  // lands the next screen at the bottom on blank space, forcing a scroll-up.
  // Also refresh the usage badge whenever the user returns to the Ready screen.
  useEffect(() => {
    // 2026-06-26 UX: now that html/body/#root are no longer pinned to 100vh, the
    // iframe shrinks to content on every screen — so navigating to a SHORTER screen
    // self-corrects (no empty band to be stranded in). window.scrollTo(0,0) resets
    // the iframe's OWN scroll. The PARENT product-page scroll is cross-origin and
    // CANNOT be reset from a sandboxed Custom UI iframe (no @forge/bridge view API
    // exists) — so the tall->tall land-at-bottom case is a documented Forge residual.
    // Moving focus to #root (a -1 skip-target, outline suppressed in index.css) resets
    // keyboard/screen-reader position to the top of the new screen — an accessibility
    // win and the strongest in-iframe lever available — with preventScroll so it never
    // fights the scrollTo above.
    try {
      window.scrollTo(0, 0);
    } catch (_) {}
    try {
      const root = document.getElementById("root");
      if (root) {
        root.setAttribute("tabindex", "-1");
        root.focus({ preventScroll: true });
      }
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
  // P15 — plan-push (assign sprints in Jira) state, held separately from the breakdown push.
  const [planPush, setPlanPush] = useState({ status: "idle" }); // idle | running | done | error
  const planPushInFlightRef = useRef(false); // synchronous re-entrancy guard (double-click → one loop)
  // P15 (kanban) — backlog-rank state, the sibling of planPush for a KANBAN plan (no sprints; we rank
  // the Jira backlog Now→Next→Later + tag reach-tier labels). Held separately so the two panels never
  // share state (a plan is either scrum or kanban → only one panel ever shows, but separate state keeps
  // them fully independent).
  const [kanbanRank, setKanbanRank] = useState({ status: "idle" }); // idle | running | done | error
  const kanbanRankInFlightRef = useRef(false); // synchronous re-entrancy guard (double-click → one loop)
  // Chunked-push progress (2026-05-30) — UI loops pushStep, updates these.
  const [pushProgress, setPushProgress] = useState(0);
  const [pushPhase, setPushPhase] = useState("");

  // CG-7 spec linter pre-flight (Layer 1 Session 2, 2026-05-07)

  // Confirmation flow
  const [dryRunResult, setDryRunResult] = useState(null);
  const [pendingBreakdown, setPendingBreakdown] = useState(null);

  // ── Capacity-Sheet Planner state ──
  const [planForm, setPlanForm] = useState(null); // the capacity form (lifted so Plan↔Confirm survives)
  const [planSlim, setPlanSlim] = useState([]); // slim features sent to the planner (uid→display map source)
  const [planResult, setPlanResult] = useState(null); // last startPlan/repackPlan/getPlan response
  const [planBusy, setPlanBusy] = useState(false); // a plan/re-pack call is in flight
  const [planEstimate, setPlanEstimate] = useState(null); // pre-flight cost {expected_usd, upper_usd}
  const [planArmed, setPlanArmed] = useState(false); // 2-step armed confirm for the billed re-rank
  const [planElapsed, setPlanElapsed] = useState(0); // seconds the ranking BATCH has been running (live timer + server echo)
  const planPollRef = useRef(null); // pollPlanStatus interval (the ranking batch runs async, like generation)
  const currentPlanPollJobIdRef = useRef(null); // stale-tick guard (mirrors the breakdown poll's currentPollJobIdRef)

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
  // ⭐ v6 (2026-06-18): Gherkin/CSV export strings captured into memory BEFORE the
  // post-push purge so the terminal success screen can still offer Copy (the KVS copy is
  // gone post-purge). Null until a push WITH test cases captures them; cleared per push.
  const [capturedExports, setCapturedExports] = useState(null);

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
  // Mirrors the BreakdownEditor's current (unsaved) working copy so the reviewing
  // top-bar "Back to AI insights" can lift it to pendingBreakdown before navigating —
  // the editor's local edits would otherwise be dropped on its key="screen-reviewing"
  // remount. The editor writes to this ref on every change (2026-06-26).
  const editorBreakdownRef = useRef(null);

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

        // ═══ Gate 1 — Settings (v6 value-split: both editions BYOK) ═══
        // v6 (2026-06-17): BOTH Marketplace editions are BYOK → every user needs their
        // own Anthropic key + a default JIRA project key. The old tier-aware exemption
        // (Managed/Advanced skipped the key requirement because we ran Claude on our key)
        // was REMOVED — under v6 'advanced' is the BYOK Advanced edition, so exempting it
        // would strand a paying customer keyless and dead-end them at generate-time.
        // getUsage is still fetched in PARALLEL with getSettings (no added latency) for the
        // usage badge + feature capability (hasTestCases); the setup gate no longer branches
        // on edition. Anthropic-health staleness stays deferred to generate-time.
        const [settings, mountUsage] = await Promise.all([
          invoke("getSettings"),
          invoke("getUsage").catch(() => null),
        ]);
        if (mountUsage && !mountUsage.error) setUsage(mountUsage);
        if (settings?.defaultProjectKey) setDefaultProjectKey(settings.defaultProjectKey);

        // v6 value-split: BOTH editions are BYOK → every user needs an Anthropic key. The
        // old `isManaged` (edition==='advanced') exemption that let Managed users past setup
        // with no key is GONE — it would now strand a paying Advanced (BYOK) user keyless and
        // dead-end them at generate-time. Require the key + the default project for everyone.
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
      clearInterval(planPollRef.current); // parity: the plan-batch poll must tear down like every other poll
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

  // ── 2026-06-26 UX — reviewing is now content-driven (page-scroll), like every other
  // screen: NO vh height pin anywhere on it. The old Bug-F1 synthetic-resize guard
  // existed only to re-sync the vh-based wrapper after a stale-small GeneratingScreen;
  // with no vh it is obsolete and was removed. The maxHeight:vh CEILING that briefly
  // replaced the minHeight FLOOR broke the editor LIVE (the flex-1 overflow-y-auto pane
  // collapsed to ~0 — a vh ceiling gives the flex chain no DEFINITE height to distribute),
  // so reviewing was switched to plain content flow. The Forge auto-resizer measures the
  // editor's natural height directly; `key="screen-reviewing"` still forces a fresh mount.

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
              // 2026-06-26: land on the AI-insights screen first (it carries the
              // persistFailed banner too, so the tab-only warning is shown immediately).
              setScreen("insights");
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
                // 2026-06-26: AI-insights screen first (signals before the editor).
                setScreen("insights");
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
          // 2026-06-26: reopening a completed breakdown also lands on the AI-insights
          // screen first (signals before the editor), same as a fresh generation.
          setScreen("insights");
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

  // "Back to AI insights" — the editor's BACK navigation (top-left) AND the
  // non-destructive way to re-read the AI's document-level insights mid-edit (UX-2).
  // Lifts the editor's CURRENT working copy (from editorBreakdownRef) to pendingBreakdown
  // BEFORE navigating, so returning via "Edit the breakdown →" restores the edits — the
  // editor's key="screen-reviewing" remount would otherwise drop unsaved local edits. The
  // doc-level aggregate (overall quality, spec_concerns, ambiguity) reads from the frozen
  // _v3_original, so it is edit-independent. 2026-06-26.
  const handleBackToInsights = useCallback(() => {
    if (editorBreakdownRef.current) setPendingBreakdown(editorBreakdownRef.current);
    setScreen("insights");
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
  // Add a NEW cross-feature dependency the AI didn't infer (partner 2026-06-26). Opens a
  // dedicated screen (large selectors) from the Review screen's DependencyStructure. Same
  // mutation as restore (addFeatureDependency is idempotent); the AddDependencyScreen
  // guards self / duplicate / cycle, so the +1 link count is always a real new edge.
  const handleOpenAddDependency = useCallback(() => setScreen("addDependency"), []);
  const handleAddDependency = useCallback((source, target) => {
    setPendingBreakdown((prev) => addFeatureDependency(prev, source, target));
    setDryRunResult((dr) =>
      dr ? { ...dr, dependency_links: (dr.dependency_links || 0) + 1 } : dr,
    );
    setScreen("confirming");
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
    setCapturedExports(null); // v6: clear any prior capture; this push re-captures if it has test cases
    setPlanPush({ status: "idle" }); // P15: a fresh push → fresh plan-push state
    setKanbanRank({ status: "idle" }); // P15 (kanban): a fresh push → fresh backlog-rank state
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
          // ⭐ v6: if this run produced test cases, CAPTURE the rendered Gherkin/CSV into
          // FE memory FIRST (getTestCaseExports reads KVS → 404s post-purge), so the terminal
          // success screen can still offer Copy. Privacy-safe: nothing is kept in KVS — just
          // two strings in memory, gone on reload. THEN purge. A capture failure degrades
          // silently to "no Copy on the success screen"; it never blocks the purge.
          if (jobId) {
            if (testCaseResults && testCaseResults.total > 0) {
              (async () => {
                let exp = null;
                try {
                  const [g, c] = await Promise.all([
                    invoke("getTestCaseExports", { jobId, format: "gherkin" }),
                    invoke("getTestCaseExports", { jobId, format: "csv" }),
                  ]);
                  exp = {
                    gherkin: g && !g.error ? g.gherkin : null,
                    csv: c && !c.error ? c.csv : null,
                    skipped: g && Number.isFinite(g.skipped) ? g.skipped : 0,
                  };
                } catch (_) {
                  exp = null;
                } finally {
                  invoke("purgeJob", { jobId }).catch(() => {});
                }
                if (exp && (exp.gherkin || exp.csv)) setCapturedExports(exp);
              })();
            } else {
              invoke("purgeJob", { jobId }).catch(() => {});
            }
          }
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
  }, [pendingBreakdown, jobId, tcGenerating, testCaseResults]);

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
    if (result.error === "edition_required") {
      // v6 value-split: test-cases are an Advanced feature; the user is licensed but on
      // Standard. Route to the upgrade screen (NOT the generic Error screen — that reads as
      // "broken" rather than "upgrade"). Defense-in-depth: the ConfirmScreen button is gated
      // on usage.hasTestCases, so a Standard user normally never reaches this.
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
          if (submitResult.error === "edition_required") {
            // v6 value-split: regen is an Advanced feature; route a Standard user to the
            // upgrade screen, NOT an opaque red error card (pitfall #4). Normally
            // unreachable — the test-case UI is hidden for Standard.
            setRegenStates((prev) => {
              const next = { ...prev };
              delete next[storyIdx];
              return next;
            });
            setQuotaInfo(submitResult);
            setScreen("limit_reached");
            return;
          }
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
              // ⭐ v6 cost-transparency: the backend accumulated this regen's spend into the bulk run
              // total; re-read the freshly batch-priced cost so the echo (SummaryBar / ConfirmScreen)
              // stays honest in-session — the delta-patch above preserves the OLD cost. Best-effort,
              // cheap, reuses the single pricing source (getTestCases). Cost-only patch keeps perStory.
              invoke("getTestCases", { jobId })
                .then((tc) => {
                  if (tc && !tc.error) {
                    setTestCaseResults((prev) => (prev ? { ...prev, cost: tc.cost, usage: tc.usage } : prev));
                  }
                })
                .catch(() => {});
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
      if (resp && resp.error === "edition_required") {
        // v6 value-split: editing test cases is an Advanced action (fail-closed backend gate).
        // Route a downgraded user to the upgrade screen — parity with generate/regenerate —
        // instead of surfacing a generic red "save failed" on the card.
        setQuotaInfo(resp);
        setScreen("limit_reached");
        return resp;
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

  // ── Capacity-Sheet Planner handlers ──
  // Reached from the Confirm/Review screen (the single lift point, like test-cases) so the planner
  // consumes the EDITED breakdown (pendingBreakdown). Restores a persisted plan + detects staleness.
  // The ranking runs on the Batches API (async, like generation) — poll until it completes. On
  // completion the resolver has ALREADY assembled + persisted the plan; we just render its result.
  const PLAN_POLL_MS = 5000;
  const startPlanPolling = useCallback((jid) => {
    clearInterval(planPollRef.current);
    currentPlanPollJobIdRef.current = jid; // mark this job current; a stale tick from an abandoned job is ignored
    planPollRef.current = setInterval(async () => {
      try {
        const st = await invoke("pollPlanStatus", { jobId: jid });
        const isCurrent = jid === currentPlanPollJobIdRef.current; // gate every side effect (mirrors startPolling)
        if (!st) return;
        // {error}-shaped payload (e.g. license_required from the resolver guard) has NO status — without
        // this branch the loop would spin forever (gate finding). Surface it + stop, like startPolling.
        if (st.error) {
          if (isCurrent) {
            clearInterval(planPollRef.current);
            setPlanBusy(false);
            setPlanResult({ ok: false, stage: "plan", error: st.error, detail: st.detail || "Planning could not continue — please try again." });
          }
          return;
        }
        if (st.status === "completed") {
          if (isCurrent) { clearInterval(planPollRef.current); setPlanBusy(false); setPlanResult(st); }
        } else if (st.status === "idle") {
          if (isCurrent) { clearInterval(planPollRef.current); setPlanBusy(false); }
        } else if (st.status === "batched" && typeof st.elapsed === "number") {
          if (isCurrent) setPlanElapsed(st.elapsed); // server-authoritative (survives a reconnect mid-batch)
        }
      } catch (_) { /* transient — keep polling */ }
    }, PLAN_POLL_MS);
  }, []);

  const handleOpenPlan = useCallback(async () => {
    const bd = pendingBreakdown || results?.breakdown;
    const slim = buildSlimFeatures(bd);
    clearInterval(planPollRef.current); // drop any prior poll
    // Synchronously CLEAR any prior page's plan + estimate BEFORE showing the screen (cross-page stale render).
    setPlanResult(null);
    setPlanEstimate(null);
    setPlanBusy(false);
    setPlanElapsed(0);
    setPlanSlim(slim);
    setPlanArmed(false);
    if (!planForm) setPlanForm(DEFAULT_PLAN_FORM);
    setScreen("plan");
    invoke("estimatePlanCost", { featureCount: slim.length })
      .then((r) => { if (r && !r.error) setPlanEstimate(r); })
      .catch(() => {});
    // restore a COMPLETED plan OR resume an IN-FLIGHT ranking batch (reconnect) + report staleness
    try {
      const existing = await invoke("getPlan", { jobId, features: slim });
      if (existing && existing.status === "completed" && existing.plan) {
        setPlanResult(existing);
        if (existing.capacityForm) setPlanForm(existing.capacityForm);
      } else if (existing && existing.status === "batched") {
        if (existing.capacityForm) setPlanForm(existing.capacityForm);
        setPlanElapsed(existing.elapsed || 0);
        setPlanBusy(true);
        startPlanPolling(jobId); // a plan batch is still running → resume polling
      }
      // else idle → the fresh form (already cleared above)
    } catch (_) {
      setPlanResult(null); // a transient getPlan failure must NOT leave a prior page's plan rendered
    }
  }, [pendingBreakdown, results, planForm, jobId, startPlanPolling]);

  const handleCapacityFormChange = useCallback((patch) => {
    setPlanArmed(false); // editing capacity disarms the billed re-rank confirm
    setPlanForm((prev) => {
      const base = prev || DEFAULT_PLAN_FORM;
      const next = { ...base, ...patch };
      // L1 (live-acceptance 2026-06-21): a methodology toggle CHANGES the availableDays UNIT — Kanban counts
      // PER QUARTER, Scrum counts PER SPRINT. Carrying the old values silently mis-scales (e.g. 40/quarter →
      // clamped to 10/sprint = a ~4× drop, invisible in the preview). Clear ONLY availableDays (keep names /
      // skill / focus / hours) so the user re-enters for the new unit — fail-loud (empty → INVALID_AVAILABLE_DAYS),
      // never a silent carry. Partner-chosen fix direction (clear-on-toggle over surface-the-clamp).
      if (patch && patch.methodology && patch.methodology !== base.methodology && Array.isArray(next.people)) {
        next.people = next.people.map((p) => ({ ...p, availableDays: "" }));
      }
      return next;
    });
  }, []);

  // Generate / re-rank — SUBMITS the ranking batch (async). On 'batched' we poll; on 'completed'
  // (empty backlog or a submit-failure fallback) we render immediately. Never hard-fails the plan.
  const handleStartPlan = useCallback(async () => {
    if (planBusy) return;
    setPlanArmed(false);
    setPlanBusy(true);
    setPlanElapsed(0);
    try {
      const bd = pendingBreakdown || results?.breakdown;
      const slim = planSlim.length ? planSlim : buildSlimFeatures(bd);
      const specSummary = extractSpecSummary(bd);
      const specConcerns = extractSpecConcerns(bd); // spec-wide risk/compliance band for the ranker (SN-3)
      const res = await invoke("startPlan", { jobId, features: slim, capacityForm: planForm, specSummary, specConcerns });
      if (res && res.status === "batched") {
        startPlanPolling(jobId); // poll until completed (planBusy stays true)
      } else {
        setPlanBusy(false);
        setPlanResult(res); // completed (fallback/empty) or a capacity/key blocker (ok:false)
      }
    } catch (err) {
      invoke("recordClientDiagnostic", { error_class: "invoke_rejected", ref: jobId || undefined }).catch(() => {});
      setPlanBusy(false);
      setPlanResult({ ok: false, stage: "plan", error: "invoke_failed", detail: "Planning failed — please try again." });
    }
  }, [planBusy, planSlim, pendingBreakdown, results, jobId, planForm, startPlanPolling]);

  // Re-pack — FREE (no LLM): an assumption-only capacity edit re-runs the deterministic packer over
  // the CACHED ranking (ledger UX-4).
  const handleRepackPlan = useCallback(async () => {
    if (planBusy) return;
    setPlanBusy(true);
    try {
      const res = await invoke("repackPlan", { jobId, capacityForm: planForm });
      // PLAN-03: a FREE re-pack uses the CACHED breakdown — it never consumed the edited breakdown, so it
      // cannot legitimately CLEAR a staleness banner. Carry the prior `stale` flag forward.
      // Reload fix (gate HIGH 2026-06-20): also carry `features` forward — repackPlan returns them now, but
      // belt-and-suspenders so a future return that drops them can't re-break the reload name source.
      setPlanResult((prev) => (res && res.ok ? { ...res, features: res.features || (prev && prev.features), stale: !!(prev && prev.stale) } : res));
    } catch (err) {
      setPlanResult({ ok: false, stage: "plan", error: "invoke_failed", detail: "Re-pack failed — please try again." });
    } finally {
      setPlanBusy(false);
    }
  }, [planBusy, jobId, planForm]);

  // Apply a what-if's CAPACITY change (±sprint / focus) to the real form + free re-pack. Re-packs with the
  // MERGED form directly (not via state) so it can't race the async setPlanForm. Deferrals are preview-only
  // (a real scope change → routed to the editor in the panel), so they never reach here.
  const handleApplyScenario = useCallback(async (formPatch) => {
    if (planBusy) return;
    const merged = { ...(planForm || DEFAULT_PLAN_FORM), ...(formPatch || {}) };
    setPlanForm(merged);
    setPlanBusy(true);
    try {
      const res = await invoke("repackPlan", { jobId, capacityForm: merged });
      // carry `features` forward too (reload name source) — same belt-and-suspenders as handleRepackPlan.
      setPlanResult((prev) => (res && res.ok ? { ...res, features: res.features || (prev && prev.features), stale: !!(prev && prev.stale) } : res));
    } catch (err) {
      setPlanResult({ ok: false, stage: "plan", error: "invoke_failed", detail: "Re-pack failed — please try again." });
    } finally {
      setPlanBusy(false);
    }
  }, [planBusy, jobId, planForm]);

  const handleBackFromPlan = useCallback(() => { setScreen("confirming"); }, []);

  // P15 — assign the plan's sprints in Jira. Loops the chunked planPushStep (mirrors handleConfirmedPush).
  // Uses the breakdown push's created_issues (uid→Jira key) — so it runs from the post-push success screen.
  const handleAssignSprints = useCallback(async () => {
    if (planPushInFlightRef.current || !pushResult) return; // synchronous guard — survives a same-frame double-click
    planPushInFlightRef.current = true;
    setPlanPush({ status: "running", progress: 0 });
    try {
      // pass the project the BACKLOG was pushed to (gate MED) — never the live Settings default, which may
      // have changed → board/sprint writes would target a different project than the created issues.
      // capture-before-purge: the post-push purge already deleted plan:<jobId>, so SEND the in-memory plan +
      // form (the panel is gated on planResult.plan, so it's present). startPlanPush falls back to KVS otherwise.
      const start = await invoke("startPlanPush", { jobId, createdIssues: pushResult.created_issues, projectKey: pushResult.project_key, namePrefix: pageData?.title, plan: planResult?.plan, capacityForm: planResult?.capacityForm || planForm });
      if (!start || !start.ok) { setPlanPush({ status: "error", error: start || { detail: "Could not start the sprint push." } }); return; }
      const sessionId = start.sessionId;
      for (let i = 0; i < 600; i++) { // generous bound; each step is one bounded chunk
        const step = await invoke("planPushStep", { sessionId });
        if (!step || !step.ok) { setPlanPush({ status: "error", error: step || { detail: "Sprint push failed." } }); return; }
        if (step.done) { setPlanPush({ status: "done", result: step }); return; }
        setPlanPush({ status: "running", progress: step.progress || 0 });
      }
      setPlanPush({ status: "error", error: { detail: "Sprint push took too long — check Jira and retry." } });
    } catch (e) {
      setPlanPush({ status: "error", error: { detail: "Sprint push failed — please try again." } });
    } finally {
      planPushInFlightRef.current = false;
    }
  }, [pushResult, jobId, pageData, planResult, planForm]);

  // P15 (kanban) — rank the Jira backlog Now→Next→Later + tag reach-tier labels (the kanban sibling of
  // handleAssignSprints; there are no sprints on a Kanban board). Mirrors the same state machine:
  // startPlanPush (the SAME resolver — it branches on plan.methodology and returns kind:'rank' for a
  // kanban plan) → loop kanbanRankStep until done. The panel is kanban-gated so we loop the rank step
  // directly; we still GUARD that the start returned kind:'rank' (else surface the error).
  const handleRankBacklog = useCallback(async () => {
    if (kanbanRankInFlightRef.current || !pushResult) return; // synchronous guard — survives a same-frame double-click
    kanbanRankInFlightRef.current = true;
    setKanbanRank({ status: "running", progress: 0 });
    try {
      // pass the project the BACKLOG was pushed to (never the live Settings default — same gate as the
      // scrum push). capture-before-purge: the post-push purge already deleted plan:<jobId>, so SEND the
      // in-memory plan + form (the panel is gated on planResult.plan, so it's present).
      const start = await invoke("startPlanPush", { jobId, createdIssues: pushResult.created_issues, projectKey: pushResult.project_key, namePrefix: pageData?.title, plan: planResult?.plan, capacityForm: planResult?.capacityForm || planForm });
      if (!start || !start.ok || start.kind !== "rank") {
        // not ok, or the backend didn't branch into rank mode (e.g. a non-kanban plan slipped through) →
        // surface whatever the backend returned (error/detail), or a generic fallback.
        setKanbanRank({ status: "error", error: (start && !start.ok ? start : null) || { detail: "Could not start the backlog ranking." } });
        return;
      }
      const sessionId = start.sessionId;
      for (let i = 0; i < 600; i++) { // generous bound; each step is one bounded chunk
        const step = await invoke("kanbanRankStep", { sessionId });
        if (!step || !step.ok) { setKanbanRank({ status: "error", error: step || { detail: "Backlog ranking failed." } }); return; }
        if (step.done) { setKanbanRank({ status: "done", result: step }); return; }
        setKanbanRank({ status: "running", progress: step.progress || 0 });
      }
      setKanbanRank({ status: "error", error: { detail: "Backlog ranking took too long — check Jira and retry." } });
    } catch (e) {
      setKanbanRank({ status: "error", error: { detail: "Backlog ranking failed — please try again." } });
    } finally {
      kanbanRankInFlightRef.current = false;
    }
  }, [pushResult, jobId, pageData, planResult, planForm]);

  // Live 1-second timer while a ranking batch is in flight (smooth count between the 5s polls; the
  // poll's server `elapsed` re-syncs it). Stops when planBusy clears (on completion / fallback).
  useEffect(() => {
    if (!planBusy) return undefined;
    const t = setInterval(() => setPlanElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [planBusy]);

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
    clearInterval(planPollRef.current); // stop the plan-batch poll too (interval-leak parity — gate finding)
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
    clearInterval(planPollRef.current); // stop the plan-batch poll too (interval-leak parity — gate finding)
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
    clearInterval(planPollRef.current); // stop the plan-batch poll too (interval-leak parity — gate finding)
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
    // Planner: clear the PAGE-specific plan state (the plan/slim/estimate belong to the old jobId);
    // KEEP planForm — the team capacity is stable + reusable across pages (the user can still edit it).
    clearInterval(planPollRef.current);
    setPlanResult(null);
    setPlanSlim([]);
    setPlanEstimate(null);
    setPlanArmed(false);
    setPlanBusy(false);
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
        // Bug F1 fix (2026-05-10 part 44) — `key` forces React to unmount any prior
        // screen's wrapper and mount a fresh DOM node for reviewing, so it never reuses
        // a stale layout context.
        // 2026-06-26 UX (live-validated): NO height pin — reviewing is content-driven and
        // page-scrolls like every other screen. The earlier maxHeight:vh CEILING broke the
        // editor live (its flex-1 overflow-y-auto pane collapsed to ~0 because a vh ceiling
        // gives the flex chain no DEFINITE height to distribute), and vh is self-referential
        // under the Forge auto-resizer. Dropping the cap lets the resizer measure the editor's
        // natural content height: short breakdowns → small iframe (no empty band), long ones →
        // the host page scrolls. The "Continue to Review" CTA sits at the editor's natural
        // bottom (consistent with Confirm/Plan/Pushed). display:flex column just stacks the
        // top bar above the content.
        key="screen-reviewing"
        style={{
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
            onClick={handleBackToInsights}
            label="Back to AI insights"
            className=""
            title="Re-read the AI insights (self-check, concerns, ambiguity) — your edits are kept. From there you can return to the editor, or to the page picker."
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
            <IconRefresh size={14} /> Regenerate
          </button>
        </div>
        {/* 2026-06-26 UX: plain content-flow block (was flex:1/minHeight:0). Holds the
            optional shrink-0 banners + the BreakdownEditor, all flowing to natural height
            so the Forge resizer fits the iframe to content. */}
        <div>
          {/* Stale-page banner (2026-06-02) — the page's Confluence version advanced
              since this breakdown was generated (set in routeByPageStatus). Non-blocking,
              orange warning style matching the truncation banner (ConfirmScreen). Makes
              the always-present Regenerate button salient + explains WHY. Only shows when
              both versions are known and the page genuinely changed (never on missing
              data). */}
          {staleBreakdown && (
            <div
              className="mx-3 mt-3 rounded-lg p-3 flex items-start gap-2"
              style={{
                background: "var(--s2j-orange-bg)",
                border: "1px solid var(--s2j-orange-border)",
              }}
            >
              <SignalIcon kind="warning" size={16} style={{ marginTop: 1 }} />
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
                <IconRefresh size={14} /> Regenerate
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
              className="mx-3 mt-3 rounded-lg p-3 flex items-start gap-2"
              style={{
                background: "var(--s2j-orange-bg)",
                border: "1px solid var(--s2j-orange-border)",
              }}
            >
              <SignalIcon kind="warning" size={16} style={{ marginTop: 1 }} />
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
            breakdownRef={editorBreakdownRef}
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
          defaultProjectKey={defaultProjectKey}
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
          hasTestCases={usage?.hasTestCases === true}
        />
      );
    case "insights":
      // The first screen after a breakdown is generated (or reopened): the AI's
      // self-check + flagged concerns, BEFORE the editor (2026-06-26). breakdown is
      // present at every entry point (poll-complete / persistFailed / reconnect) —
      // passed explicitly. onProceed → the editor (reviewing). No back-to-insights path.
      return (
        <InsightsScreen
          breakdown={pendingBreakdown || results?.breakdown}
          pageTitle={pageData?.title}
          truncationNote={results?.truncation_note}
          persistFailed={persistFailed}
          staleBreakdown={staleBreakdown}
          onProceed={() => setScreen("reviewing")}
          onBack={handleNewPage}
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
          usage={usage}
          jobId={jobId}
          onOpenPlan={handleOpenPlan}
          onOpenAddDependency={handleOpenAddDependency}
        />
      );
    case "addDependency":
      // Add a cross-feature dependency the AI didn't infer (2026-06-26). Reads the CURRENT
      // edited breakdown (pendingBreakdown) for the feature list; onAdd mutates it + returns
      // to Review. Reached only from the Review screen, where pendingBreakdown is always set.
      return (
        <AddDependencyScreen
          breakdown={pendingBreakdown}
          onAdd={handleAddDependency}
          onBack={() => setScreen("confirming")}
        />
      );
    case "plan":
      return (
        <PlanScreen
          featureCount={planSlim.length}
          slimFeatures={planSlim}
          form={planForm}
          result={planResult}
          busy={planBusy}
          estimate={planEstimate}
          armed={planArmed}
          elapsed={planElapsed}
          pageTitle={pageData?.title}
          jobId={jobId}
          onArmToggle={setPlanArmed}
          onFormChange={handleCapacityFormChange}
          onGenerate={handleStartPlan}
          onRepack={handleRepackPlan}
          onApplyScenario={handleApplyScenario}
          onBack={handleBackFromPlan}
        />
      );
    case "pushing":
      return <PushingScreen progress={pushProgress} phase={pushPhase} />;
    case "pushed":
      return (
        <PushedScreen
          result={pushResult}
          onNew={handleNewPage}
          jobId={jobId}
          onOpenDiagnostics={handleOpenDiagnostics}
          tcDiscarded={tcDiscardedAtPush}
          capturedExports={capturedExports}
          hasPlan={!!(planResult && planResult.ok && planResult.plan && (planResult.plan.methodology || "scrum") !== "kanban")}
          hasKanbanPlan={!!(planResult && planResult.ok && planResult.plan && (planResult.plan.methodology) === "kanban")}
          planStale={!!(planResult && planResult.stale)}
          planPush={planPush}
          onAssignSprints={handleAssignSprints}
          kanbanRank={kanbanRank}
          onRankBacklog={handleRankBacklog}
        />
      );
    case "limit_reached":
      // ⭐ [deep-audit B/E-#5] edition_required can fire MID-FLOW (a Standard/downgraded user
      // attempted a test-case action on an in-flight breakdown). Returning via handleNewPage would
      // DISCARD the breakdown + edits under review. For that case Back returns to the Review/Confirm
      // screen (the breakdown lives in pendingBreakdown) — non-destructive. Other modes
      // (license_required / fair-use, no work in flight) keep the page-picker return.
      return (
        <LimitReachedScreen
          quota={quotaInfo}
          onBack={
            quotaInfo?.error === "edition_required" && pendingBreakdown
              ? () => setScreen("confirming")
              : handleNewPage
          }
          backToReview={quotaInfo?.error === "edition_required" && !!pendingBreakdown}
        />
      );
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
          ? "Copied"
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
  defaultProjectKey = null,
}) {
  // Prices come from getUsage's pricing[] (single source of truth — no hardcoded
  // USD prices in the UI). v6 value-split: both paid editions (Standard + Advanced)
  // are BYOK + unlimited, so the badge shows "<edition> plan · unlimited" for both,
  // plus a "includes test cases" value-signal for Advanced. The managedPro branch
  // below is DORMANT (off-Marketplace only; both live editions are unlimited).
  const byokProPrice = findPrice(usage, "byokPro");
  // Page-preflight (design-army synthesis, 2026-07-01) — pure client-side extraction
  // over data already fetched (pageData.body); see lib/pageOutline.js.
  const outline = useMemo(() => extractPageOutline(pageData.body), [pageData.body]);
  const timeBand = useMemo(
    () => estimateGenerationTimeBand(pageData.body_length),
    [pageData.body_length],
  );
  const selectedProfile = contextProfiles.find((p) => p.id === selectedContextProfileId);
  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      {/* moodboard (Phase 1) — the Ready header is the app's primary landing surface:
          navy page title + char-count subtitle, blue Back affordance, Settings as the
          right-aligned utility action. The centralized admin has no Configure link, so
          the app surfaces its own Settings entry here (Anthropic key, JIRA project,
          Project Context profiles). */}
      <ScreenHeader
        title={pageData.title}
        subtitle={`${(pageData.body_length || 0).toLocaleString()} characters`}
        onBack={onBack || undefined}
        backLabel="Back to pages"
        backTitle="Return to page picker (clears page selection; you can pick a different page)"
        action={
          onOpenSettings ? (
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
              <IconSettings size={14} /> Settings
            </button>
          ) : null
        }
      />

      {/* [diag Phase 3, S4] Last-generation-failed card — the dashboard ⚠ "Needs
          attention" click / failed-job reconnect lands HERE instead of a context-free
          Ready screen. ADDITIVE: everything below (usage badge, context picker,
          Generate) is unchanged; the Generate button doubles as the retry. */}
      {genFailureNotice && (
        <SignalCallout
          kind="error"
          title="The last generation for this page failed"
          style={{ marginBottom: 16 }}
          fontSize={13}
        >
          {/* [diag Phase 5] When the stored user-facing detail is absent, humanize the
              stored error CODE via the diagnosticsView map (Phase-3 stored it un-rendered);
              the original generic sentence remains the final fallback when neither exists. */}
          <div>
            {genFailureNotice.detail ||
              (genFailureNotice.code
                ? classText(genFailureNotice.code).title
                : "The generation could not complete. You can generate again below.")}
          </div>
          <div style={{ ...TYPE.micro, marginTop: 4 }}>
            Generating again will start a fresh run.
          </div>
          <DiagnosticRefLine
            refId={genFailureNotice.refId}
            onOpenDiagnostics={onOpenDiagnostics}
          />
        </SignalCallout>
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
              {(usage.hasTestCases || usage.hasPlanner) &&
                ` · includes ${[usage.hasTestCases && "test cases", usage.hasPlanner && "capacity planner"].filter(Boolean).join(" + ")}`}
            </span>
          ) : usage.tier === "managedPro" ? (
            // DORMANT under v6 — resolveTier never returns managedPro for a live customer
            // (both editions are BYOK + unlimited → the `usage.unlimited` branch above always
            // wins). Kept only for the off-Marketplace Managed fallback. Capped fair-use copy.
            <span>
              <strong style={{ color: "var(--s2j-text)" }}>
                {usage.tierLabel} plan
              </strong>{" "}
              · {usage.used} breakdowns this month · resets{" "}
              {usage.resetsAtLabel}
              {usage.remaining === 0 && byokProPrice && (
                <span style={{ color: "var(--s2j-text)" }}>
                  {" "}
                  · for unlimited, switch to a BYOK edition — bring your own Anthropic key
                  ({byokProPrice})
                </span>
              )}
            </span>
          ) : null}
        </div>
      )}

      {/* Pre-flight check (design-army + verdict-logic army, 2026-07-01) — replaces the
          static "Ready to generate" boilerplate with a go/no-go card built for the PO/BA
          who owns the spec: a tri-state VERDICT + four "answer tiles" (right page? complete?
          right project? how long?) + a collapsed annotated outline. Every signal is a
          deterministic STRUCTURAL fact (empty leaf sections, task-list state, presence
          flags, edit metadata) — no free-text guessing — so a repeat user never sees a wrong
          number. It NEVER blocks Generate; the PO owns the call. */}
      <PreflightCard
        key={pageData.page_id}
        outline={outline}
        timeBand={timeBand}
        defaultProjectKey={defaultProjectKey}
        selectedProfile={selectedProfile}
        pageData={pageData}
      />

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
            className="s2j-field"
            value={selectedContextProfileId}
            onChange={(e) => onSelectContextProfile?.(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              fontSize: "0.875rem",
              borderRadius: "10px",
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

// ── Pre-flight check card (design-army synthesis "2A verdict + 2B annotated outline" +
// verdict-logic army STRUCTURAL-PURIST ruling, 2026-07-01) ─────────────────────────────
// The go/no-go card the PO/BA sees right before spending 2-10 min + their own Anthropic
// money: a tri-state VERDICT banner, four "answer tiles" (right page? complete? goes
// where? how long?), and a collapsed annotated outline. Every signal is a DETERMINISTIC
// STRUCTURAL fact from lib/pageOutline.js — no free-text guessing (a wrong "3 TODOs" once
// makes a repeat user distrust the card forever). It NEVER blocks Generate; the PO owns
// the spec, we just surface what we can see.

// Tone map. AMBER = --s2j-orange (caution) — matches the design-mockup's warning banner + the
// orange empty/TODO markers. This is a semantic caution use (not an action button), so it does not
// touch the green/blue/red action-button convention.
const PREFLIGHT_TONE = {
  green: { fg: "var(--s2j-green)", bg: "var(--s2j-green-bg)", border: "var(--s2j-green-border)" },
  amber: { fg: "var(--s2j-orange)", bg: "var(--s2j-orange-bg)", border: "var(--s2j-orange-border)" },
  thin:  { fg: "var(--s2j-red)", bg: "var(--s2j-red-bg)", border: "var(--s2j-red-border)" },
};

// relative "edited N days/weeks ago" — a factual staleness/ownership cue, NEVER a verdict
// gate (an old-but-complete page is fine). Returns null when the resolver couldn't supply a
// timestamp (older Confluence payloads / privacy), and the tile degrades gracefully.
function fmtEditedAgo(iso) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "edited today";
  if (days === 1) return "edited yesterday";
  if (days < 7) return `edited ${days} days ago`;
  if (days < 14) return "edited last week";
  if (days < 60) return `edited ${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `edited ${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? "" : "s"} ago`;
  return `edited over a year ago`;
}

const PREFLIGHT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// absolute "Jun 24, 2026" (header meta) — null when the resolver had no timestamp.
function fmtEditedDate(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${PREFLIGHT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
// short "Jun 24" (RIGHT PAGE tile line 3).
function fmtEditedDateShort(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${PREFLIGHT_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

const plur = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const cap1 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// The verdict icon carries the tone colour + a redundant SHAPE (colour is never the only signal),
// mirroring the design mockup: green check = ready, orange warning-triangle = worth a glance,
// red warning-triangle = stub.
function PreflightVerdictIcon({ verdict, size = 20 }) {
  const kind = verdict === "green" ? "success" : verdict === "amber" ? "warning" : "error";
  return <SignalIcon kind={kind} size={size} />;
}

// One "answer tile" — a small glass utility surface: an icon + UPPERCASE micro question,
// then the fact(s). `tone` optionally colours the icon (used for the COMPLETE verdict).
function PreflightTile({ icon: Ico, label, tone, children }) {
  return (
    <div style={{ ...glassSurface("utility"), padding: "10px 12px" }}>
      <div className="flex items-center gap-1.5" style={{ marginBottom: 5 }}>
        <span style={{ color: tone || "var(--s2j-text-muted)", display: "inline-flex" }}>
          <Ico size={13} />
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "var(--s2j-text-muted)" }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.4, color: "var(--s2j-text)" }}>{children}</div>
    </div>
  );
}

// One status line in the COMPLETE? tile — a coloured MARKER (distinct shape) + dark readable text
// (colour never the only signal): empty = orange hollow square, todo = orange filled dot, ok =
// green check. Mirrors the design mockup's completion breakdown.
function PreflightStatusLine({ kind, children }) {
  let marker;
  if (kind === "empty") {
    marker = <span style={{ width: 9, height: 9, border: "1.5px solid var(--s2j-orange)", borderRadius: 2, display: "inline-block", flexShrink: 0 }} />;
  } else if (kind === "todo") {
    marker = <span style={{ width: 8, height: 8, background: "var(--s2j-orange)", borderRadius: 999, display: "inline-block", flexShrink: 0 }} />;
  } else {
    marker = <span style={{ color: "var(--s2j-green)", display: "inline-flex", flexShrink: 0 }}><IconCheck size={12} /></span>;
  }
  return (
    <div className="flex items-center gap-1.5" style={{ fontSize: 12.5, color: "var(--s2j-text)", marginTop: 3 }}>
      {marker}
      <span>{children}</span>
    </div>
  );
}

// Segmented task-completion bar (COMPLETE? tile) — segments proportional to tasks-checked, matching
// the mockup's thin-segment progress bar. Purely a visual proportion; the exact "N/M tasks checked"
// number is the authoritative figure on the line below it.
function TaskProgressBar({ total, complete }) {
  if (!total) return null;
  const segs = Math.min(total, 24);
  const filled = Math.round((Math.max(0, Math.min(complete, total)) / total) * segs);
  return (
    <div className="flex" style={{ gap: 2, marginBottom: 2, marginTop: 1 }}>
      {Array.from({ length: segs }).map((_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: 8,
            borderRadius: 2,
            background: i < filled ? "var(--s2j-blue)" : "var(--s2j-blue-bg)",
          }}
        />
      ))}
    </div>
  );
}

// A top-level section "pill" (the outline row in the mockup): section title + a muted child-count
// badge + orange rollup tags for unchecked TODOs / empty sub-sections in its subtree.
function OutlinePill({ section }) {
  const { text, childCount, emptyCount, openTodos } = section;
  const tag = {
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: "0.02em",
    color: "var(--s2j-orange)",
    background: "var(--s2j-orange-bg)",
    border: "1px solid var(--s2j-orange-border)",
    borderRadius: 999,
    padding: "0 6px",
    lineHeight: "16px",
    flexShrink: 0,
  };
  return (
    <span
      className="inline-flex items-center"
      style={{
        gap: 6,
        padding: "4px 9px",
        borderRadius: 8,
        background: "var(--s2j-bg)",
        border: "1px solid var(--s2j-border)",
        fontSize: 12.5,
        fontWeight: 500,
        color: "var(--s2j-text)",
        maxWidth: "100%",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{text}</span>
      {childCount > 0 && (
        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--s2j-text-muted)", background: "var(--s2j-bg-section)", borderRadius: 999, padding: "0 5px", lineHeight: "15px", flexShrink: 0 }}>
          {childCount}
        </span>
      )}
      {openTodos > 0 && <span style={tag}>{openTodos === 1 ? "TODO" : `${openTodos} TODO`}</span>}
      {emptyCount > 0 && <span style={tag}>{emptyCount} empty</span>}
    </span>
  );
}

// Guidance shown in place of the outline pills when the page has NO headings (thin / prose-only) —
// keeps the card substantial (the brief required parity of volume, not a bare warning line).
function PreflightGuidance() {
  return (
    <div>
      <p style={{ ...TYPE.micro, margin: 0 }}>
        No headings detected — Claude will still read the full page text.
      </p>
      <p style={{ ...TYPE.micro, margin: "4px 0 0" }}>
        For the richest breakdown, give each feature or requirement its own heading — that is what
        Claude maps into Epics, Stories, and dependencies.
      </p>
    </div>
  );
}

// A small text chip on a detailed-outline row. `attention` = the orange caution accent (empty
// leaf); otherwise a muted neutral (a content-presence fact like "table" / "diagram"). The WORD
// carries the meaning — colour is only reinforcement (colourblind-safe).
function OutlineChip({ attention, children }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        color: attention ? "var(--s2j-orange)" : "var(--s2j-text-muted)",
        background: attention ? "var(--s2j-orange-bg)" : "var(--s2j-bg-section)",
        border: `1px solid ${attention ? "var(--s2j-orange-border)" : "var(--s2j-border)"}`,
      }}
    >
      {children}
    </span>
  );
}

// The DETAILED annotated outline (the "2B" value) — the full <h*> hierarchy, indented by level,
// each row flagged with its content-presence chips (empty / table / image / diagram / code). Shown
// on demand behind the "Show detailed outline" toggle, BELOW the top-level pill summary. Only
// rendered when the page has headings (structure-less pages get PreflightGuidance instead).
function PreflightOutline({ outline }) {
  return (
    <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
      {outline.headings.map((h, i) => {
        const depth = Math.min(h.level, 4) - 1;
        const top = h.level <= 2;
        return (
          <li
            key={`${i}-${h.level}-${h.text}`}
            className="flex items-center gap-1.5"
            style={{
              marginLeft: depth * 14,
              padding: "2px 0",
              fontSize: 12,
              lineHeight: 1.4,
              color: top ? "var(--s2j-text)" : "var(--s2j-text-light)",
              fontWeight: top ? 600 : 400,
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
                flexShrink: 1,
              }}
            >
              {h.text}
            </span>
            <span className="flex items-center gap-1" style={{ flexShrink: 0 }}>
              {h.isEmpty && <OutlineChip attention>empty</OutlineChip>}
              {h.hasTable && <OutlineChip>table</OutlineChip>}
              {h.hasImage && <OutlineChip>image</OutlineChip>}
              {h.hasDiagram && <OutlineChip>diagram</OutlineChip>}
              {h.hasCode && <OutlineChip>code</OutlineChip>}
            </span>
          </li>
        );
      })}
      {outline.moreHeadingsCount > 0 && (
        <li style={{ ...TYPE.micro, fontStyle: "italic", padding: "2px 0" }}>
          +{plur(outline.moreHeadingsCount, "more section")}
        </li>
      )}
    </ul>
  );
}

// how many top-level section pills to show inline before collapsing the rest into "+N more".
const OUTLINE_PILL_CAP = 9;

function PreflightCard({ outline, timeBand, defaultProjectKey, selectedProfile, pageData }) {
  const verdict = preflightVerdict(outline);
  const amberCount = preflightAmberCount(outline);
  const tone = PREFLIGHT_TONE[verdict] || PREFLIGHT_TONE.green;
  // detailed per-heading outline (the "2B" value) is on-demand behind a toggle, BELOW the pill
  // summary. Collapsed by default (the pills give the at-a-glance); the toggle reveals the full
  // hierarchy with content chips.
  const [detailOpen, setDetailOpen] = React.useState(false);

  const editedAgo = fmtEditedAgo(pageData && pageData.version_edited_at);
  const editedDate = fmtEditedDate(pageData && pageData.version_edited_at);
  const editedDateShort = fmtEditedDateShort(pageData && pageData.version_edited_at);
  const author = pageData && pageData.version_author;
  const version = pageData && pageData.version;
  const noHeadings = outline.headingCount === 0;
  const openTodos = Math.max(0, (outline.tasksTotal || 0) - (outline.tasksComplete || 0));

  // Card-header meta (top-right), matching the design mockup: "v14 · edited Jun 24, 2026 · A. Kowalski".
  // Version is always present; the date/author drop out gracefully when unavailable.
  const headerMeta = [
    version != null ? `v${version}` : null,
    editedDate ? `edited ${editedDate}` : null,
    author || null,
  ].filter(Boolean).join(" · ");

  // Verdict copy (honest, never alarmist, always "you can still generate"). The amber body
  // enumerates the actual causes ("1 empty section · 3 open TODOs"), matching the mockup.
  const causeBits = [];
  if (outline.emptyLeafCount > 0) causeBits.push(plur(outline.emptyLeafCount, "empty section"));
  if (openTodos > 0) causeBits.push(`${openTodos} open TODO${openTodos === 1 ? "" : "s"}`);

  let lead;
  let body;
  if (verdict === "green") {
    lead = "Ready to generate";
    body = noHeadings
      ? "No headings detected — Claude will read the full page text. Generate when ready."
      : "Structured and complete — no structural gaps found. Generate to build the Jira breakdown.";
  } else if (verdict === "amber") {
    lead = `Structured — but ${plur(amberCount, "item")} worth a glance first`;
    body = `${causeBits.join(" · ")}. Nothing blocks generation; this is your call.`;
  } else {
    lead = "This page looks like a stub";
    body = "Very short or unstructured. Double-check you picked the right page — you can still generate.";
  }

  const hasComplete = amberCount === 0 && !outline.isThin;
  const shownPills = (outline.topSections || []).slice(0, OUTLINE_PILL_CAP);
  const morePills = Math.max(0, (outline.topSections || []).length - shownPills.length);

  return (
    <MoodCard
      density="minor"
      title="Pre-flight check"
      badge={
        headerMeta ? (
          <span style={{ ...TYPE.micro, textAlign: "right" }}>{headerMeta}</span>
        ) : undefined
      }
      style={{ marginBottom: 16 }}
    >
      {/* Verdict banner — icon + copy, with the amber "N items" count on the right (mockup). */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          background: tone.bg,
          border: `1px solid ${tone.border}`,
          borderRadius: 10,
          padding: "12px 14px",
          marginBottom: 14,
        }}
      >
        <span style={{ alignSelf: "flex-start", display: "inline-flex", flexShrink: 0 }}>
          <PreflightVerdictIcon verdict={verdict} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--s2j-text)" }}>{lead}</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--s2j-text)", marginTop: 2 }}>
            {body}
          </div>
        </div>
        {verdict === "amber" && (
          <div style={{ fontSize: 30, fontWeight: 700, color: "var(--s2j-orange)", lineHeight: 1, flexShrink: 0, alignSelf: "center", paddingLeft: 6 }}>
            {amberCount}
          </div>
        )}
      </div>

      {/* Four answer tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <PreflightTile icon={IconCalendar} label="RIGHT PAGE?">
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--s2j-text)" }}>
            {version != null ? `Version ${version}` : "This page"}
          </div>
          {editedAgo && <div style={{ marginTop: 2 }}>{cap1(editedAgo)}</div>}
          {(editedDateShort || author) && (
            <div style={{ ...TYPE.micro, marginTop: 1 }}>
              {[editedDateShort, author].filter(Boolean).join(" · ")}
            </div>
          )}
        </PreflightTile>

        <PreflightTile
          icon={hasComplete ? IconCheck : IconList}
          label="COMPLETE?"
          tone={hasComplete ? "var(--s2j-green)" : outline.isThin ? "var(--s2j-red)" : "var(--s2j-orange)"}
        >
          {outline.tasksTotal > 0 && (
            <TaskProgressBar total={outline.tasksTotal} complete={outline.tasksComplete} />
          )}
          {hasComplete ? (
            <PreflightStatusLine kind="ok">No structural gaps</PreflightStatusLine>
          ) : outline.isThin ? (
            <div style={{ color: "var(--s2j-text-muted)" }}>Too little structure to tell</div>
          ) : (
            <>
              {outline.emptyLeafCount > 0 && (
                <PreflightStatusLine kind="empty">
                  {plur(outline.emptyLeafCount, "empty section")}
                </PreflightStatusLine>
              )}
              {openTodos > 0 && (
                <PreflightStatusLine kind="todo">
                  {openTodos} open TODO{openTodos === 1 ? "" : "s"}
                </PreflightStatusLine>
              )}
              {outline.tasksTotal > 0 && (
                <PreflightStatusLine kind="ok">
                  {outline.tasksComplete}/{outline.tasksTotal} tasks checked
                </PreflightStatusLine>
              )}
            </>
          )}
        </PreflightTile>

        <PreflightTile icon={IconExternalLink} label="RIGHT PROJECT?">
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--s2j-text)" }}>
            Project {defaultProjectKey || "—"}
          </div>
          <div style={{ ...TYPE.micro, marginTop: 2 }}>
            Creates 1 epic + backlog here. Verify before push.
            {selectedProfile ? ` Context: ${selectedProfile.name}.` : ""}
          </div>
        </PreflightTile>

        <PreflightTile icon={IconClock} label="THIS RUN">
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--s2j-text)" }}>{timeBand}</div>
          <div style={{ marginTop: 2 }}>On your Anthropic key</div>
          <div style={{ ...TYPE.micro, marginTop: 1 }}>
            {(pageData.body_length || 0).toLocaleString()} chars in
          </div>
        </PreflightTile>
      </div>

      {/* Structure summary line (mockup: "STRUCTURE · N SECTIONS · N WORDS · N LISTS · N TABLES"). */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: "var(--s2j-text-muted)",
          padding: "10px 0 9px",
          marginTop: 2,
          borderTop: "1px solid var(--s2j-border)",
        }}
      >
        STRUCTURE · {outline.headingCount} SECTIONS · {outline.wordCount.toLocaleString()} WORDS ·{" "}
        {outline.listItemCount} LISTS · {outline.tableCount} TABLES
      </div>

      {/* Outline pills — top-level sections with child count + orange TODO/empty rollup tags.
          Structure-less pages get guidance of comparable weight instead. */}
      {outline.headingCount > 0 ? (
        <div className="flex flex-wrap" style={{ gap: 6 }}>
          {shownPills.map((sec, i) => (
            <OutlinePill key={`${i}-${sec.text}`} section={sec} />
          ))}
          {morePills > 0 && (
            <span
              className="inline-flex items-center"
              style={{
                padding: "4px 9px",
                borderRadius: 8,
                background: "var(--s2j-bg-section)",
                border: "1px solid var(--s2j-border)",
                fontSize: 12.5,
                fontWeight: 500,
                color: "var(--s2j-text-muted)",
              }}
            >
              +{morePills} more section{morePills === 1 ? "" : "s"}
            </span>
          )}
        </div>
      ) : (
        <PreflightGuidance />
      )}

      {/* Detailed outline (the "2B" value) — the full per-heading hierarchy with content chips,
          on demand below the pill summary. The toggle keeps the default view scannable while
          preserving the deep structure the accepted 2A+2B synthesis called for. */}
      {outline.headingCount > 0 && (
        <>
          <button
            type="button"
            onClick={() => setDetailOpen((v) => !v)}
            aria-expanded={detailOpen}
            className="flex items-center gap-1.5"
            style={{
              background: "none",
              border: "none",
              padding: "8px 0 2px",
              marginTop: 4,
              cursor: "pointer",
              color: "var(--s2j-text-light)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                transform: detailOpen ? "rotate(90deg)" : "none",
                transition: "transform 0.15s ease",
              }}
            >
              <IconChevronRight size={13} />
            </span>
            {detailOpen
              ? "Hide detailed outline"
              : `Show detailed outline (${plur(outline.headingCount, "section")})`}
          </button>
          {detailOpen && <PreflightOutline outline={outline} />}
        </>
      )}
    </MoodCard>
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
        <h2 style={{ fontSize: 18, fontWeight: 700, color: MOOD.navy, letterSpacing: "-0.01em" }}>
          Your Confluence page is being analyzed
        </h2>
        {pageTitle && (
          <p className="text-sm mt-0.5" style={{ color: "var(--s2j-text-light)" }}>
            {pageTitle}
          </p>
        )}
        <p
          className="mt-2.5"
          style={{ fontSize: 13, lineHeight: 1.55, color: "var(--s2j-text-muted)", maxWidth: "26rem" }}
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
        <SignalCallout kind="warning" title="Taking longer than usual — this is normal, nothing is broken" style={{ marginBottom: 16 }} fontSize={13}>
          <span style={{ color: "var(--s2j-text-light)" }}>
            Generation runs on Anthropic's Batch API, which can slow down when Claude is under heavy load.
            Your request is still processing and your breakdown will finish on its own — it is not lost.
          </span>
        </SignalCallout>
      )}

      <SignalCallout kind="info" title="You can safely leave — we'll keep working" fontSize={13}>
        <span style={{ color: "var(--s2j-text-light)" }}>
          Close this tab, switch tasks, or come back tomorrow — your breakdown keeps generating.
          Reopen this page (Apps → Spec2Tickets) and it will be waiting for you, even if it took a while.
        </span>
      </SignalCallout>
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
        <h2 style={{ fontSize: 18, fontWeight: 700, color: MOOD.navy, letterSpacing: "-0.01em" }}>
          Generating test cases…
        </h2>
        {pageTitle && (
          <p className="text-sm mt-0.5" style={{ color: "var(--s2j-text-light)" }}>
            {pageTitle}
          </p>
        )}
        <p
          className="mt-2.5"
          style={{ fontSize: 13, lineHeight: 1.55, color: "var(--s2j-text-muted)", maxWidth: "26rem" }}
        >
          Building BA-grade acceptance scenarios for every story — Gherkin and CSV
          export included. Typically a few minutes; large breakdowns take longer.
        </p>
      </div>

      {tcElapsed >= 600 && (
        <SignalCallout kind="warning" title="Taking longer than usual — this is normal, nothing is broken" style={{ marginBottom: 16 }} fontSize={13}>
          <span style={{ color: "var(--s2j-text-light)" }}>
            Test-case generation runs on Anthropic's Batch API; it can slow down under heavy load.
            Your request is still processing.
          </span>
        </SignalCallout>
      )}

      <SignalCallout kind="info" title="You can safely leave — we'll keep working" fontSize={13}>
        <span style={{ color: "var(--s2j-text-light)" }}>
          Close this tab or switch tasks — test-case generation continues in the background.
          Reopen the breakdown (Apps → Spec2Tickets) and the results will be waiting for you.
        </span>
      </SignalCallout>
    </div>
  );
}

// ── AI Insights — the FIRST landing after a breakdown is generated (or reopened),
// BEFORE the editor (2026-06-26, partner). Surfaces the AI's self-assessment + the
// concerns it flagged so the BA knows where to focus while editing. These AI-judgment
// sections were MOVED here out of ConfirmScreen (now the slim "Review and Push" step),
// removing a 3-way duplicate of the spec summary (it was also the Epic description).
// Reads breakdown = pendingBreakdown || results.breakdown — present at all 3 entry
// points (poll-complete, persistFailed-inline, reconnect). One-way forward: there is
// NO back-to-insights path — it is a generation snapshot, not live-updated; the
// editor's Regenerate produces fresh analysis. Reuses the App.js helpers
// (ConfidenceBadge, ConcernRow) via function-declaration hoisting.
function InsightsScreen({
  breakdown,
  pageTitle,
  truncationNote,
  persistFailed,
  staleBreakdown,
  onProceed,
  onBack,
}) {
  const signals = extractV3Signals(breakdown || {});
  const sortedSpecConcerns = sortConcernsBySeverity(signals.parsedSpecConcerns);
  const qualityPalette = signals.overallQuality
    ? QUALITY_PALETTE[signals.overallQuality]
    : null;
  const fc = signals.parsedFeatureConcerns;
  const featHigh = fc.filter((c) => c.severity === "high").length;
  const featMed = fc.filter((c) => c.severity === "medium").length;
  const featLow = fc.filter((c) => c.severity === "low").length;
  // Nothing flagged → a positive empty-state instead of a near-blank screen. The
  // TrustCard still renders the confidence summary; this just adds reassuring closure.
  const nothingFlagged =
    sortedSpecConcerns.length === 0 &&
    fc.length === 0 &&
    !signals.ambiguityNote &&
    (signals.confidence.flagged?.length || 0) === 0;

  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      {/* moodboard (Phase 2) — navy "AI insights" title + the page name as subtitle. */}
      <ScreenHeader
        title="AI insights"
        subtitle={pageTitle || undefined}
        onBack={onBack}
        backLabel="Back to pages"
        backTitle="Discard this breakdown and return to the page picker"
      />
      <p style={{ ...TYPE.sub, marginTop: -6, marginBottom: 20 }}>
        The AI has completed the breakdown and flagged areas to review before you edit.
      </p>

      {/* (Spec summary intentionally NOT shown here — 2026-06-26 partner: it is the
          Epic description, edited in the BreakdownEditor's Epic block, the single
          source. The intro line above frames this screen; the signals carry the value.) */}

      {/* Partial-breakdown + tab-only warnings — surfaced on the FIRST screen so the
          user knows the data is incomplete / unsaved before investing time editing. */}
      {/* moodboard (Phase 2) — the data-quality banners share the warning vocabulary. */}
      {truncationNote && (
        <SignalCallout
          kind="warning"
          title="Partial breakdown — some features may be missing"
          style={{ marginBottom: 16 }}
        >
          {truncationNote}
        </SignalCallout>
      )}
      {persistFailed && (
        <SignalCallout
          kind="warning"
          title="This breakdown could not be saved to storage (too large)."
          style={{ marginBottom: 16 }}
        >
          It is loaded in this tab only — edit and push it now, or it will be lost
          when you leave. Consider splitting very large pages.
        </SignalCallout>
      )}
      {/* Stale-page warning (forwarded like truncation/persistFailed — UX-1 deep-audit
          fix): the page changed in Confluence since this breakdown was generated. Shown
          here for consistency with the other data-quality banners; the actionable
          Regenerate lives in the editor, one click forward via "Edit the breakdown →". */}
      {staleBreakdown && (
        <SignalCallout
          kind="warning"
          title="This page was edited since this breakdown was generated"
          style={{ marginBottom: 16 }}
        >
          Page version {staleBreakdown.generatedAt} → {staleBreakdown.current}. Open the
          editor and use Regenerate to include your changes.
        </SignalCallout>
      )}

      {/* AI self-check (overall quality + confidence + where to focus) */}
      {(qualityPalette || signals.confidence.total > 0) && (
        <MoodCard density="minor" style={{ marginBottom: 16 }}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: "var(--s2j-text-muted)" }}>
                AI self-check
              </p>
              {qualityPalette && (
                <p className="text-base font-semibold" style={{ color: qualityPalette.text }}>
                  {qualityPalette.label}
                </p>
              )}
              <p className="text-xs mt-1" style={{ color: "var(--s2j-text-muted)", maxWidth: "34ch" }}>
                The AI's own confidence in this breakdown — a guide for where to look, not a guarantee.
              </p>
              {signals.confidence.averageScore !== null && (
                <p className="text-xs mt-1" style={{ color: "var(--s2j-text-muted)" }}>
                  Average self-rated confidence: {signals.confidence.averageScore}/100
                </p>
              )}
            </div>
            <div className="flex gap-4 text-sm">
              <ConfidenceBadge indicator="✓" count={signals.confidence["✓"]} color="var(--s2j-green)" label="Confident" />
              <ConfidenceBadge indicator="⚠" count={signals.confidence["⚠"]} color="var(--s2j-orange)" label="Unsure" />
              <ConfidenceBadge indicator="✗" count={signals.confidence["✗"]} color="var(--s2j-red)" label="Low confidence" />
            </div>
          </div>
          {signals.confidence.flagged?.length > 0 && (
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--s2j-border)" }}>
              <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: "var(--s2j-text-muted)" }}>
                Needs your attention
              </p>
              <ul className="space-y-1" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {signals.confidence.flagged.slice(0, 6).map((f, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <span style={{ color: f.indicator === "✗" ? "var(--s2j-red)" : "var(--s2j-orange)", flexShrink: 0 }}>
                      {f.indicator}
                    </span>
                    <span className="truncate" style={{ color: "var(--s2j-text)" }}>{f.name}</span>
                    {typeof f.score === "number" && (
                      <span style={{ color: "var(--s2j-text-muted)", flexShrink: 0 }}>{f.score}/100</span>
                    )}
                  </li>
                ))}
              </ul>
              {signals.confidence.flagged.length > 6 && (
                <p className="text-xs mt-1" style={{ color: "var(--s2j-text-muted)" }}>
                  +{signals.confidence.flagged.length - 6} more — find them in the editor
                </p>
              )}
            </div>
          )}
        </MoodCard>
      )}

      {/* Document-level concerns — risks / compliance / ambiguity ranked by severity */}
      {sortedSpecConcerns.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2" style={{ color: "var(--s2j-text)" }}>
            <SignalIcon kind="warning" size={14} />
            <span>Document-level concerns ({sortedSpecConcerns.length})</span>
          </h3>
          <p className="text-xs mb-3" style={{ color: "var(--s2j-text-muted)" }}>
            Potential risks, ambiguities, or compliance gaps surfaced by AI analysis. Address high-severity items as you edit.
          </p>
          <div className="space-y-2">
            {sortedSpecConcerns.map((concern, idx) => (
              <ConcernRow key={idx} concern={concern} />
            ))}
          </div>
        </div>
      )}

      {/* Feature-level concerns summary (the detail lives on each feature in the editor) */}
      {fc.length > 0 && (
        <div
          className="rounded-lg p-3 mb-4 text-xs"
          style={{ background: "var(--s2j-bg-section)", border: "1px solid var(--s2j-border)", color: "var(--s2j-text-muted)" }}
        >
          <strong style={{ color: "var(--s2j-text)" }}>
            +{fc.length} feature-level concerns
          </strong>{" "}
          attached to individual features (review in the editor). High-severity {featHigh} · Medium {featMed} · Low {featLow}
        </div>
      )}

      {/* AI ambiguity note — Sonnet self-disclosed assumption boundary */}
      {signals.ambiguityNote && (
        <details
          className="mb-4 rounded-lg"
          style={{ border: "1px solid var(--s2j-border)", background: "var(--s2j-bg-section)" }}
        >
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider p-3" style={{ color: "var(--s2j-text-muted)" }}>
            AI ambiguity note
          </summary>
          {/* readability fix (partner) — the note is a long, clause-dense paragraph; bump it off
              text-xs to 13px with an airy 1.7 line-height + full padding so it isn't a cramped wall. */}
          <div
            className="px-3 pb-3 pt-3"
            style={{
              color: "var(--s2j-text)",
              borderTop: "1px solid var(--s2j-border)",
              fontSize: 13,
              lineHeight: 1.7,
            }}
          >
            {signals.ambiguityNote}
          </div>
        </details>
      )}

      {/* Nothing flagged → positive closure (manages the "why so little guidance?" gap). */}
      {nothingFlagged && (
        <SignalCallout kind="success" fontSize={12} style={{ marginBottom: 16 }}>
          No concerns flagged — the AI is confident in this breakdown. Open the editor to refine and push.
        </SignalCallout>
      )}

      {/* Forward CTA → the editor. Green (btn-primary), matching the flow's other
          forward step "Continue to Review →". */}
      <div className="mt-2 flex justify-end">
        <button onClick={onProceed} className="btn-primary">
          Edit the breakdown →
        </button>
      </div>
    </div>
  );
}

// ── Add a cross-feature dependency (2026-06-26, partner) ─────────────────────────
// A dedicated, comfortable screen to add a Story-blocks-Story link the AI didn't infer
// (the Review screen already lets the user REMOVE/restore edges — this adds the missing
// ADD). Opened from DependencyStructure's "+ Add dependency"; mutates pendingBreakdown via
// handleAddDependency, returns to Review. Guards: source≠target, no duplicate, and BLOCKS a
// cycle (a dependency loop can't push as clean Jira blocks-links). Features come from the
// CURRENT (edited) breakdown.
function AddDependencyScreen({ breakdown, onAdd, onBack }) {
  const caps = breakdown?.capabilities || [];
  const byCategory = useMemo(() => {
    const m = new Map();
    caps.forEach((cap) => {
      (cap.features || []).forEach((f) => {
        if (!f || !f.name) return;
        if (!m.has(cap.name)) m.set(cap.name, []);
        m.get(cap.name).push(f.name);
      });
    });
    return Array.from(m.entries());
  }, [breakdown]);
  // source name → Set(target names) it already depends on (duplicate + cycle checks).
  const depMap = useMemo(() => {
    const m = new Map();
    caps.forEach((cap) => {
      (cap.features || []).forEach((f) => {
        if (f && f.name) m.set(f.name, new Set(f.dependencies || []));
      });
    });
    return m;
  }, [breakdown]);

  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");

  const sameFeature = !!source && source === target;
  const alreadyExists = !!source && !!target && (depMap.get(source)?.has(target) || false);
  // Would source → target create a cycle? (target already reaches source via deps.)
  const createsCycle = useMemo(() => {
    if (!source || !target || sameFeature) return false;
    const seen = new Set();
    const stack = [target];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === source) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const d of depMap.get(cur) || []) stack.push(d);
    }
    return false;
  }, [source, target, sameFeature, depMap]);

  const canAdd = !!source && !!target && !sameFeature && !alreadyExists && !createsCycle;

  const selectStyle = {
    width: "100%",
    padding: "12px 14px",
    fontSize: "15px",
    borderRadius: "10px",
    border: "1px solid var(--s2j-border)",
    background: "var(--s2j-bg)",
    color: "var(--s2j-text)",
    outline: "none",
    cursor: "pointer",
  };
  const options = byCategory.map(([cat, names]) => (
    <optgroup key={cat} label={cat}>
      {names.map((n) => (
        <option key={n} value={n}>{n}</option>
      ))}
    </optgroup>
  ));

  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      {/* moodboard (Phase 2) — navy header + a glass form card; the SignalCallout
          guard messages below already speak the moodboard severity vocabulary. */}
      <ScreenHeader
        title="Add a cross-feature dependency"
        subtitle="Link two features so one is blocked by another. It becomes a Story-blocks-Story link in Jira — the feature it depends on must be completed first."
        onBack={onBack}
        backLabel="Back to Review"
        backTitle="Return to the Review & Push screen without adding"
      />

      <MoodCard density="minor" style={{ marginBottom: 16 }}>
        <label className="block text-sm font-semibold mb-2" style={{ color: "var(--s2j-text)" }}>
          This feature…
        </label>
        <select className="s2j-field" style={selectStyle} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Select a feature…</option>
          {options}
        </select>

        <div
          className="flex items-center gap-2 my-4 text-sm font-medium"
          style={{ color: "var(--s2j-blue)" }}
        >
          <IconLink size={16} /> depends on / is blocked by ↓
        </div>

        <label className="block text-sm font-semibold mb-2" style={{ color: "var(--s2j-text)" }}>
          …this feature
        </label>
        <select className="s2j-field" style={selectStyle} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Select a feature…</option>
          {options}
        </select>
      </MoodCard>

      {sameFeature && (
        <SignalCallout kind="warning" style={{ marginBottom: 16 }}>
          Pick two different features — a feature can't depend on itself.
        </SignalCallout>
      )}
      {alreadyExists && (
        <SignalCallout kind="info" style={{ marginBottom: 16 }}>
          This dependency already exists in the breakdown.
        </SignalCallout>
      )}
      {createsCycle && (
        <SignalCallout kind="error" style={{ marginBottom: 16 }}>
          This would create a circular dependency — “{target}” already depends (directly or
          indirectly) on “{source}”. Jira blocks-links can't form a loop, so this can't be added.
        </SignalCallout>
      )}
      {canAdd && (
        <SignalCallout kind="info" style={{ marginBottom: 16 }}>
          <strong style={{ color: "var(--s2j-text)" }}>{source}</strong> will depend on{" "}
          <strong style={{ color: "var(--s2j-text)" }}>{target}</strong> — “{target}” must be
          completed first.
        </SignalCallout>
      )}

      <div className="flex items-center gap-3">
        <button onClick={() => onAdd(source, target)} disabled={!canAdd} className="btn-primary">
          Add dependency
        </button>
        <button onClick={onBack} className="btn-secondary">
          Cancel
        </button>
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
  onOpenPlan,
  onOpenAddDependency,
  tcGenerating,
  tcStale,
  usage,
  jobId,
}) {
  // v6 value-split: test-case generation is an Advanced-edition feature. Gate the UI on the
  // capability the backend sends (usage.hasTestCases). Default-FALSE on an absent field
  // (back-compat: a cached pre-v6 getUsage payload has no hasTestCases → treat as no-access,
  // never leak the premium feature). The backend remains the authority (fail-closed gate).
  const hasTestCases = usage?.hasTestCases === true;
  // v6.1 value-split: the Capacity-Sheet Planner is an Advanced-edition feature too (bundled with
  // test-cases). Same capability-driven gate (usage.hasPlanner), default-FALSE on an absent field
  // (back-compat / never leak). The backend startPlan/repackPlan/startPlanPush gates are the authority;
  // this only hides the entry button + shows a conversion-driving "Advanced" teaser for Standard users.
  const hasPlanner = usage?.hasPlanner === true;
  // v6 cost-transparency: pre-flight Anthropic-usage estimate for a test-case run. Fetched
  // (read-only resolver, NO spend) only when test-cases are offered and not already fresh-generated;
  // re-fetched when the breakdown goes stale (edited ACs → new estimate). Best-effort: on any error
  // the UI falls back to the qualitative "uses compute" copy (no $), never blocks.
  const [tcEstimate, setTcEstimate] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!hasTestCases || !jobId || (testCaseResults && !tcStale)) {
      setTcEstimate(null);
      return undefined;
    }
    invoke("estimateTestCaseCost", { jobId, breakdown })
      .then((r) => { if (!cancelled && r && !r.error) setTcEstimate(r); })
      .catch(() => {});
    return () => { cancelled = true; };
    // `breakdown` is a stable state reference (pendingBreakdown) for the confirm screen's lifetime;
    // it changes only on an edit, which is exactly when a re-estimate is warranted.
  }, [hasTestCases, jobId, testCaseResults, tcStale, breakdown]);
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
  // `signals` is kept here ONLY for the push-essential bits below (counts.sharedACs,
  // categories, dependencyEdges). The AI-judgment signals (spec summary, self-check
  // confidence + flagged worklist, spec/feature concerns, ambiguity) MOVED to
  // InsightsScreen — the first screen after generation — 2026-06-26.
  const signals = extractV3Signals(breakdown || {});

  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      {/* moodboard (Phase 2) — navy push-decision header; the stateful planner /
          test-case action rows below keep their tinted state-colours (they signal
          available / done / stale), and the green/secondary push buttons are untouched. */}
      <ScreenHeader
        title="Review and Push to Jira"
        onBack={onBackToPicker || undefined}
        backLabel="Back to pages"
        backTitle="Discard edits and return to page picker (use 'Back to Editor' below to keep edits)"
      />
      {/* (Spec summary + AI self-check + concerns + ambiguity moved to InsightsScreen,
          the first screen after generation — 2026-06-26. ConfirmScreen is now the slim
          push-decision step: what-will-be-created, dependencies, capacity, test cases.) */}

      {/* Partial-breakdown warning — generation output hit the token cap and was
          salvaged, so later features may be missing. Surfaced at the push
          decision point so the user doesn't create an incomplete JIRA set
          unknowingly (truncation_note forwarded by getResults). */}
      {truncationNote && (
        <SignalCallout
          kind="warning"
          title="Partial breakdown — some features may be missing"
          style={{ marginBottom: 16 }}
        >
          {truncationNote}
        </SignalCallout>
      )}

      {/* Persist-failed warning (diagnostics Phase 0, §3.1) — the breakdown exists ONLY in
          this tab (it could not be written to Forge storage); repeated at the push decision
          point because pushing now is the way to keep it. ADDITIVE sibling of the truncation
          banner above (same pattern); no existing copy changed. */}
      {persistFailed && (
        <SignalCallout
          kind="warning"
          title="This breakdown could not be saved to storage (too large)."
          style={{ marginBottom: 16 }}
        >
          It is loaded in this tab only — review and push it now, or it will be
          lost when you leave. Consider splitting very large pages.
        </SignalCallout>
      )}

      {/* (AI self-check — overall quality + ✓/⚠/✗ confidence + the "Needs your
          attention" worklist — moved to InsightsScreen, the first screen after
          generation — 2026-06-26.) */}

      {/* Count summary — what will be created в JIRA */}
      <MoodCard density="minor" style={{ marginBottom: 16 }}>
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
      </MoodCard>

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
        onOpenAdd={onOpenAddDependency}
      />

      {/* (Document-level concerns, the feature-level concerns summary, and the AI
          ambiguity note moved to InsightsScreen — the first screen after generation —
          2026-06-26.) */}

      {/* Capacity-Sheet Planner — its OWN dedicated section (partner: it deserves a section, not a
          button crammed into the test-case action row). Review-only; consumes the EDITED breakdown
          (single lift point). Placed before the test-case section so the spec→backlog→PLAN step reads
          as a distinct, first-class option. */}
      {onOpenPlan && (
        <div
          className="rounded-lg p-3 mb-3 flex items-center justify-between gap-3"
          style={{ background: "var(--s2j-blue-bg)", border: "1px solid var(--s2j-blue-border)" }}
        >
          <div style={{ minWidth: 0 }}>
            <p className="text-xs font-medium" style={{ color: "var(--s2j-text)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <IconCalendar size={13} /> {hasPlanner ? "Capacity plan from your team" : "Capacity plan from your team — Advanced"}
            </p>
            <p className="text-xs" style={{ color: "var(--s2j-text-muted)" }}>
              {hasPlanner
                ? "Turn these stories into a plan from your team's capacity — Scrum sprints or a Kanban Now / Next / Later backlog. Claude orders the work; the math is deterministic. Review-only; nothing is written to Jira."
                : "Turn your stories into a plan from your team's capacity — Scrum sprints or a Kanban Now / Next / Later backlog, pushed to Jira. Available on the Advanced edition."}
            </p>
          </div>
          {hasPlanner ? (
            <button
              type="button"
              onClick={() => onOpenPlan()}
              disabled={isPushing}
              className="shrink-0"
              style={{
                background: "var(--s2j-blue)",
                border: "none",
                color: "#fff",
                padding: "7px 14px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: 500,
                cursor: isPushing ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <IconCalendar size={14} /> Plan capacity
            </button>
          ) : (
            <span className="shrink-0 text-xs font-medium" title="The Capacity-Sheet Planner is included in the Advanced edition. Upgrade in your Atlassian site admin to plan your backlog." style={{ color: "var(--s2j-blue)", whiteSpace: "nowrap", padding: "7px 10px" }}>Advanced</span>
          )}
        </div>
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
            {!hasTestCases && !testCaseResults
              ? "Acceptance test cases — Advanced"
              : tcStaleNow
              ? "Test cases may be outdated"
              : testCaseResults
              ? "Acceptance test cases generated"
              : "Optional: acceptance test cases"}
          </p>
          <p className="text-xs" style={{ color: "var(--s2j-text-muted)" }}>
            {!hasTestCases && !testCaseResults
              ? "Generate BA-grade Gherkin / CSV acceptance scenarios for every story — available on the Advanced edition."
              : tcStaleNow
              ? "You edited the breakdown since generating these. Re-running re-generates ALL stories (takes a few minutes, uses compute) — or push as-is; the edited stories simply won't get a test-case summary. Your call."
              : "BA-grade Gherkin / CSV export + a summary embedded in each Jira Story."}
          </p>
          {/* ⭐ v6 cost-transparency: POST-RUN actual echo (green, exact) takes priority; else the
              PRE-RUN estimate (an honest upper-bound + typical). Both are framed "your own API key,
              no markup" to disambiguate from the Marketplace subscription price. */}
          {(() => {
            const actual = testCaseResults?.cost?.total_usd;
            // Show the EXACT post-run echo only when the cases are FRESH. On the stale path the BA is
            // about to pay for a re-run, so the upcoming-run ESTIMATE is the relevant number — fall
            // through to it (it is already fetched).
            if (testCaseResults && !tcStaleNow && typeof actual === "number") {
              return (
                <p className="text-xs mt-1" style={{ color: "var(--s2j-green-dark)" }}>
                  <IconCost size={12} /> This run used <strong>{fmtUsd(actual)}</strong> of Anthropic usage —
                  billed to your own API key, no markup.
                </p>
              );
            }
            if (hasTestCases && tcEstimate && (!testCaseResults || tcStaleNow)) {
              return (
                <p className="text-xs mt-1" style={{ color: "var(--s2j-text-muted)" }}>
                  <IconCost size={12} /> Estimated Anthropic usage:{" "}
                  <strong>up to ~{fmtUsd(tcEstimate.upper_usd)}</strong>
                  {tcEstimate.expected_usd
                    ? ` (typically ~${fmtUsd(tcEstimate.expected_usd)})`
                    : ""}{" "}
                  — billed to your own API key, no markup. Rough estimate; you'll see the exact
                  amount after the run.
                  {tcEstimate.has_spec_source === false
                    ? " (excludes source-spec context; actual may be lower)"
                    : ""}
                </p>
              );
            }
            return null;
          })()}
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
              <IconBeaker size={12} /> Test cases unavailable — breakdown not saved
            </span>
          )}
          {/* v6 value-split: Generate / Re-run is gated on the Advanced capability (hasTestCases).
              Standard users get the upsell chip below instead (no spend). The backend gate is the
              authority (fail-closed); this is UX. View/edit of EXISTING cases stays available
              (retained paid output). */}
          {!persistFailed && hasTestCases && (!testCaseResults || tcStaleNow) && (
            <button
              type="button"
              onClick={() => {
                // ⭐ v6: confirm-before-spend on BOTH bulk paths — first-time generate AND stale
                // re-run-all are each a paid Anthropic run (the $ estimate sits right above). First
                // click arms (the BA sees the estimate + a "confirm" label); second (within 4s) fires.
                // (Previously only the stale re-run armed; first-time generate spent with no confirm —
                // the main bill-shock vector.)
                if (!regenArmed) {
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
                ? "Generating tests…"
                : regenArmed
                ? tcStaleNow
                  ? `Confirm re-run (${stories} stories)`
                  : "Confirm & generate"
                : tcStaleNow
                ? "Re-run all"
                : "Generate Test Cases"}
            </button>
          )}
          {/* v6 value-split: Standard edition → an upsell chip instead of the Generate button
              (no spend, no dead-end click). Shown when there are no cases yet OR when cases
              exist but are stale (Re-run is gated, so the chip is the actionable affordance —
              avoids a stale warning with no button). A downgraded user with FRESH cases still
              gets the View/edit button above. */}
          {!persistFailed && !hasTestCases && (!testCaseResults || tcStaleNow) && (
            <span
              title="Test-case generation is included in the Advanced edition. Upgrade in your Atlassian site admin to generate BA-grade acceptance test cases for every story."
              style={{
                fontSize: "12px",
                color: "var(--s2j-blue)",
                background: "var(--s2j-blue-bg)",
                border: "1px solid var(--s2j-blue-border)",
                padding: "6px 12px",
                borderRadius: "6px",
                fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              <IconBeaker size={12} /> Advanced feature
            </span>
          )}
        </div>
      </div>

      {/* Final action — irreversible-write caution in the moodboard warning vocabulary. */}
      <SignalCallout kind="warning" style={{ marginBottom: 16 }} fontSize={13}>
        This will create real Jira issues. The action cannot be undone from within Spec2Tickets.
      </SignalCallout>

      {/* [seams-audit HIGH (b)] honest consent: pushing now PURGES the in-flight
          TC batch (post-push purge deletes the tcjob) — the user must know the
          generating test cases will be discarded and not embedded. */}
      {tcGenerating && (
        <p className="text-xs mb-2" style={{ color: "var(--s2j-orange)" }}>
          <SignalIcon kind="warning" size={12} /> Test cases are still generating — pushing now discards that run (they
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
function DependencyStructure({ edges, onRemove, onRestore, onOpenAdd }) {
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

  // Nothing active AND nothing removed AND no add affordance → render nothing. With
  // onOpenAdd present we ALWAYS render (header + "+ Add dependency") so the user can add
  // the FIRST cross-feature dependency even when the AI inferred none (2026-06-26).
  if (groups.length === 0 && removed.length === 0 && !onOpenAdd) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3
          className="text-sm font-semibold flex items-center gap-2"
          style={{ color: "var(--s2j-text)" }}
        >
          <IconLink size={16} style={{ marginRight: 6 }} />
          <span>Cross-feature dependencies ({edges?.length || 0})</span>
        </h3>
        {onOpenAdd && (
          <button
            type="button"
            onClick={onOpenAdd}
            className="text-xs font-medium rounded px-2 py-1 transition-colors shrink-0"
            style={{ color: "var(--s2j-blue)", background: "transparent", border: "1px solid var(--s2j-blue-border)", cursor: "pointer" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--s2j-blue-bg)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            title="Add a cross-feature dependency the AI didn't infer"
          >
            + Add dependency
          </button>
        )}
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--s2j-text-muted)" }}>
        Each becomes a Story-blocks-Story link in Jira — the feature it depends on must be
        completed first. Remove any that don't belong, or add one the AI missed.
      </p>

      {groups.length > 0 ? (
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
                          <IconX size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div
          className="rounded-lg p-3 text-xs"
          style={{ background: "var(--s2j-bg-section)", border: "1px dashed var(--s2j-border)", color: "var(--s2j-text-muted)" }}
        >
          No cross-feature dependencies yet.{onOpenAdd ? ' Use "+ Add dependency" above to link two features.' : ""}
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
                  <IconUndo size={12} /> Restore
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
        <h2
          className="font-semibold"
          style={{ fontSize: 18, color: MOOD.navy, letterSpacing: "-0.01em" }}
        >
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

// ── post-push export (v6, 2026-06-18) ───────────────────────────────
// The success screen is terminal (no Back-to-Editor). If the run had test cases, App
// captured the rendered Gherkin/CSV into memory BEFORE the purge — this is the last place
// the BA can grab the full export (the KVS copy is gone). Tiny local clipboard helper
// (mirrors TestCasesScreen's — duplicated to avoid a shared-module dep in this CRA app;
// both are tiny). Never a silent no-op (clipboard → data-URI download fallback).
async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    try {
      const a = document.createElement("a");
      a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
      a.download = "testcases.txt";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    } catch (_2) {
      return false;
    }
  }
}

function PostPushExport({ captured }) {
  const [gState, setGState] = useState("idle"); // idle | ok | fail
  const [cState, setCState] = useState("idle");
  if (!captured || (!captured.gherkin && !captured.csv)) return null;
  const doCopy = async (text, set) => {
    const ok = await copyTextToClipboard(text || "");
    set(ok ? "ok" : "fail");
    setTimeout(() => set("idle"), 1800);
  };
  const label = (state, base) =>
    state === "ok"
      ? "Copied"
      : state === "fail"
        ? "Copy failed — check browser permissions"
        : base;
  return (
    <SignalCallout
      kind="info"
      style={{ marginBottom: 16 }}
      iconTitle="Export your test cases now — the working copy is cleared on push"
    >
      <div style={{ fontWeight: 500, marginBottom: 4 }}>Acceptance test cases — export now</div>
      <div style={{ marginBottom: 8 }}>
        The working copy is cleared when you push (for privacy), so this is the last place to grab
        the full Gherkin / CSV.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {captured.gherkin && (
          <button className="btn-secondary" onClick={() => doCopy(captured.gherkin, setGState)}>
            {label(gState, "Copy all — Gherkin")}
          </button>
        )}
        {captured.csv && (
          <button className="btn-secondary" onClick={() => doCopy(captured.csv, setCState)}>
            {label(cState, "Copy all — CSV")}
          </button>
        )}
      </div>
      {captured.skipped > 0 && (
        <div style={{ fontSize: 11, color: "var(--s2j-orange)", marginTop: 6 }}>
          {captured.skipped} {captured.skipped === 1 ? "story" : "stories"} not included (no cases or
          generation failed).
        </div>
      )}
    </SignalCallout>
  );
}

// P15 — the post-push "assign sprints in Jira" panel. Idempotent (re-run reuses same-named sprints).
// Surfaces partial outcomes in DISJOINT honesty channels: not-in-Jira / overflowed / failed (never silent).
function AssignSprintsPanel({ planPush, onAssignSprints, planStale = false }) {
  const st = planPush?.status || "idle";
  const sm = planPush?.result?.summary || {};
  const sprints = planPush?.result?.sprintsCreated || [];
  const boardWarning = planPush?.result?.boardWarning;
  // §11: a 207 partial sprint-move bumps no assign_failed counter, so the failed-count callout below won't fire for
  // it — surface the backend's "verify" nudge on its own channel (mirrors RankBacklogPanel's unverifiedPartial).
  const unverifiedPartial = (planPush?.result?.failureDetails || []).find((f) => f && f.error === "partial_assign_unverified") || null;
  return (
    <div style={{ ...glassSurface("minor"), padding: 16, marginBottom: 16 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
        <span style={{ color: "var(--s2j-blue)" }}><IconCalendar size={16} /></span>
        <strong style={{ fontSize: 14, color: MOOD.navy }}>Assign sprints in Jira</strong>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--s2j-text-muted)", margin: "0 0 10px", lineHeight: 1.5 }}>
        Create the planned sprints on your Scrum board and move each Story into its sprint, per your plan.
        Re-running is safe — it reuses sprints of the same name.
      </p>
      {st === "running" ? (
        <div style={{ fontSize: 13, color: "var(--s2j-text-muted)" }}>Creating sprints + assigning issues… {Math.round((planPush.progress || 0) * 100)}%</div>
      ) : st === "error" ? (
        <SignalCallout kind="error" title="Couldn’t assign sprints">{planPush.error?.detail || "Please try again."}</SignalCallout>
      ) : st === "done" ? (
        <div>
          <SignalCallout kind="success" title={`Assigned ${sm.issues_assigned || 0} issue${sm.issues_assigned === 1 ? "" : "s"} across ${sm.sprints || sprints.length} sprint${(sm.sprints || sprints.length) === 1 ? "" : "s"}`} style={{ marginBottom: 8 }}>
            {sprints.map((g) => `${g.name} (${g.assigned})`).join(" · ")}
          </SignalCallout>
          {boardWarning ? <SignalCallout kind="info" title="Multiple Scrum boards" style={{ marginBottom: 6 }}>{boardWarning}</SignalCallout> : null}
          {sm.no_jira_key > 0 ? <SignalCallout kind="info" title={`${sm.no_jira_key} planned feature${sm.no_jira_key === 1 ? "" : "s"} not in Jira`} style={{ marginBottom: 6 }}>Not part of the pushed backlog, so they couldn’t be assigned.</SignalCallout> : null}
          {sm.overflowed > 0 ? <SignalCallout kind="info" title={`${sm.overflowed} overflowed feature${sm.overflowed === 1 ? "" : "s"}`} style={{ marginBottom: 6 }}>Didn’t fit any sprint in the plan, so they weren’t assigned.</SignalCallout> : null}
          {(sm.assign_failed > 0 || sm.sprint_failures > 0) ? <SignalCallout kind="warning" title="Some assignments failed">{sm.sprint_failures || 0} sprint(s) + {sm.assign_failed || 0} issue(s) failed — check your Jira board permissions and retry (it’s idempotent).</SignalCallout> : null}
          {unverifiedPartial ? <SignalCallout kind="warning" title="Verify the sprint assignment" style={{ marginBottom: 6 }}>{unverifiedPartial.detail || "Jira reported a partial result (207) — open your board and verify each Story landed in its sprint."}</SignalCallout> : null}
        </div>
      ) : (
        <>
          {planStale ? (
            <SignalCallout kind="warning" title="This plan may be out of date" style={{ marginBottom: 10 }}>
              The breakdown changed since this plan was generated. Re-rank the plan before assigning sprints, or any edited features won’t match.
            </SignalCallout>
          ) : null}
          <button type="button" className="btn-primary" onClick={onAssignSprints}>Assign sprints in Jira</button>
          <div style={{ fontSize: 10.5, color: "var(--s2j-text-light)", marginTop: 8, lineHeight: 1.5 }}>
            Needs a Scrum board in this project. The first run may prompt your Jira admin to approve the new board/sprint permission in Manage Apps.
          </div>
        </>
      )}
    </div>
  );
}

// P15 (kanban) — the post-push "rank backlog in Jira" panel. The Kanban sibling of AssignSprintsPanel:
// a Kanban board has no sprints, so instead we RANK the project's backlog to the plan's Now→Next→Later
// order + tag each issue with a plan-now/plan-next/plan-later reach-tier label. Idempotent (re-run is
// safe). Surfaces partial outcomes in DISJOINT honesty channels (§11): not-in-Jira / rank-failed /
// label-failed — never silent. The boardNote caveat is the company-managed visible-order honesty: we
// NEVER promise the board visibly shows the new order beyond exactly what boardNote says.
function RankBacklogPanel({ kanbanRank, onRankBacklog, planStale = false }) {
  const st = kanbanRank?.status || "idle";
  const r = kanbanRank?.result || {};
  // counts is the authoritative shape; summary is its alias at completion — accept either.
  const c = r.counts || r.summary || {};
  const boardNote = r.boardNote; // company-managed visible-order caveat (string|null) — render as INFO
  const boardWarning = r.boardWarning; // >1 Kanban board warning (string|null)
  const failureDetails = r.failureDetails || []; // §11 honesty: the specific failed issues
  const ranked = c.ranked || 0;
  const labeled = c.labeled || 0;
  const noJiraKey = c.no_jira_key || 0;
  const rankFailed = c.rank_failed || 0;
  const labelFailed = c.label_failed || 0;
  const total = c.total || 0;
  // First failure reason (most actionable) — surfaced under the failed-count callout.
  const firstFailure = (() => {
    const f = failureDetails[0];
    if (!f) return null;
    if (typeof f === "string") return f;
    // Read the ACTUAL backend failureDetails shapes (gate C10): rank-fail {error,detail}; partial-rank {error,count};
    // label-fail {key,error}. Surface the most-actionable reason, falling back to the error code + the issue key so a
    // label or partial-rank failure isn't silently reduced to the generic line.
    return f.reason || f.detail || f.message || (f.error ? `${f.key || f.issue || "an issue"}: ${f.error}` : ((f.key || f.issue) ? `${f.key || f.issue}: could not be updated` : null));
  })();
  // §11 (pre-prod gate finding #3): a 207 "partial-unverified" rank bumps NO counter (rank_failed stays 0), so the
  // failed-count callout below never fires for it — the backend's "verify the order" instruction would be silently
  // dropped and a Jira-reported PARTIAL would read as a clean full success. Surface it on its own honesty channel.
  // Additive: never hides a count; the success line still renders alongside as a separate, disjoint signal.
  const unverifiedPartial = failureDetails.find((f) => f && f.error === "partial_rank_unverified") || null;
  return (
    <div style={{ ...glassSurface("minor"), padding: 16, marginBottom: 16 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
        <span style={{ color: "var(--s2j-blue)" }}><IconList size={16} /></span>
        <strong style={{ fontSize: 14, color: MOOD.navy }}>Rank backlog in Jira</strong>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--s2j-text-muted)", margin: "0 0 10px", lineHeight: 1.5 }}>
        Order this project’s backlog Now → Next → Later to match the plan, and tag each issue with a
        plan-now / plan-next / plan-later label. Re-running is safe.
      </p>
      {st === "running" ? (
        <div style={{ fontSize: 13, color: "var(--s2j-text-muted)" }}>Ranking backlog + tagging labels… {Math.round((kanbanRank.progress || 0) * 100)}%</div>
      ) : st === "error" ? (
        <SignalCallout kind="error" title="Couldn’t rank the backlog">{kanbanRank.error?.detail || "Please try again."}</SignalCallout>
      ) : st === "done" ? (
        <div>
          <SignalCallout kind="success" title={ranked === 0 && rankFailed === 0 && total >= 1 ? `Backlog already in plan order (${total} item${total === 1 ? "" : "s"})` : `Ranked ${ranked} issue${ranked === 1 ? "" : "s"} to match the plan (Now → Next → Later)`} style={{ marginBottom: 8 }}>
            Tagged {labeled} issue{labeled === 1 ? "" : "s"} with plan-now / plan-next / plan-later labels.
          </SignalCallout>
          {boardNote ? <SignalCallout kind="info" title="Backlog rank updated" style={{ marginBottom: 6 }}>{boardNote}</SignalCallout> : null}
          {boardWarning ? <SignalCallout kind="warning" title="Multiple Kanban boards" style={{ marginBottom: 6 }}>{boardWarning}</SignalCallout> : null}
          {noJiraKey > 0 ? <SignalCallout kind="warning" title={`${noJiraKey} planned item${noJiraKey === 1 ? "" : "s"} not in Jira yet`} style={{ marginBottom: 6 }}>Push the backlog to Jira first so they can be ranked.</SignalCallout> : null}
          {(rankFailed > 0 || labelFailed > 0) ? (
            <SignalCallout kind={rankFailed > 0 ? "error" : "warning"} title={`${rankFailed} rank${rankFailed === 1 ? "" : "s"} + ${labelFailed} label${labelFailed === 1 ? "" : "s"} failed`} style={{ marginBottom: 6 }}>
              {firstFailure ? <>Reason: {firstFailure} — </> : null}check your Jira board permissions and retry (it’s idempotent).
            </SignalCallout>
          ) : null}
          {unverifiedPartial ? (
            <SignalCallout kind="warning" title="Verify the backlog order" style={{ marginBottom: 6 }}>
              {unverifiedPartial.detail || "Jira reported a partial result (207) — open your board (sorted by Rank) and verify the Now → Next → Later order."}
            </SignalCallout>
          ) : null}
        </div>
      ) : (
        <>
          {planStale ? (
            <SignalCallout kind="warning" title="This plan may be out of date" style={{ marginBottom: 10 }}>
              The breakdown changed since this plan was generated. Re-rank the plan before ranking the backlog, or any edited features won’t match.
            </SignalCallout>
          ) : null}
          <button type="button" className="btn-primary" onClick={onRankBacklog}>Rank backlog in Jira</button>
          <div style={{ fontSize: 10.5, color: "var(--s2j-text-light)", marginTop: 8, lineHeight: 1.5 }}>
            Needs a Kanban board in this project. The backlog shows the new order when the board is sorted by Rank (board settings → filter ORDER BY Rank).
          </div>
        </>
      )}
    </div>
  );
}

function PushedScreen({ result, onNew, jobId = null, onOpenDiagnostics, tcDiscarded = false, capturedExports = null, hasPlan = false, hasKanbanPlan = false, planStale = false, planPush = { status: "idle" }, onAssignSprints = null, kanbanRank = { status: "idle" }, onRankBacklog = null }) {
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
      {/* moodboard (Phase 2) — the terminal success climax in the green success
          vocabulary (green check + navy headline + counts). */}
      <SignalCallout kind="success" style={{ marginBottom: 16 }} fontSize={14}>
        {/* keep the success climax as a real <h2> — it is the screen's primary
            statement, so it must hold heading semantics for the document outline. */}
        <h2 style={{ ...TYPE.heading, color: MOOD.navy, fontSize: 16, marginBottom: 4 }}>
          Pushed to Jira
        </h2>
        <p style={{ color: "var(--s2j-text)", marginBottom: 2 }}>
          {total} items created in project {result?.project_key || "unknown"}
        </p>
        <p style={{ ...TYPE.micro }}>
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
          <p style={{ ...TYPE.micro, marginTop: 4 }}>
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
          <p style={{ ...TYPE.micro, marginTop: 4, color: "var(--s2j-orange)" }}>
            <SignalIcon kind="warning" size={12} /> The in-progress test-case generation was discarded — regenerate from the
            editor after the push if you want them embedded.
          </p>
        )}
      </SignalCallout>

      {(result?.epic_key || stories.length > 0) && (
        <MoodCard density="minor" style={{ marginBottom: 16 }}>
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
              Open Epic {result.epic_key} <IconExternalLink size={14} />
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
        </MoodCard>
      )}

      {/* Graceful-fallback note — project has no subtask type, tasks embedded
          as checklists in Story descriptions. Explains "0 Subtasks" honestly. */}
      {result?.subtasks_embedded && (result?.tasks_embedded || 0) > 0 && (
        <SignalCallout
          kind="info"
          title={`Tasks added as checklists (${result.tasks_embedded})`}
          style={{ marginBottom: 16 }}
          fontSize={12}
        >
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
        </SignalCallout>
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
          <SignalCallout
            kind="warning"
            title={`${parts.join(" · ")} could not be created`}
            style={{ marginBottom: 16 }}
            fontSize={12}
          >
            {firstDetail && (
              <p style={{ ...TYPE.micro, marginBottom: 4 }}>
                Reason: {reasonText}
              </p>
            )}
            <p style={{ ...TYPE.micro }}>
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
          </SignalCallout>
        );
      })()}

      <PostPushExport captured={capturedExports} />

      {/* P15 — assign the plan's sprints in Jira (only when a SCRUM plan exists for this push) */}
      {hasPlan && onAssignSprints ? <AssignSprintsPanel planPush={planPush} onAssignSprints={onAssignSprints} planStale={planStale} /> : null}

      {/* P15 (kanban) — rank the project's backlog Now→Next→Later (only when a KANBAN plan exists).
          Mutually exclusive with AssignSprintsPanel above (a plan is either scrum or kanban). */}
      {hasKanbanPlan && onRankBacklog ? <RankBacklogPanel kanbanRank={kanbanRank} onRankBacklog={onRankBacklog} planStale={planStale} /> : null}

      {/* F3 misplacement fix part 32 (2026-05-09) — "Run again on this
          page" was removed because re-running на same page POST-PUSH
          would create duplicate JIRA tickets (semantically wrong post-
          push context). "Generate Another" renamed → "Generate on new
          page" для clarity (explicitly indicates picker-route to a
          different page, avoiding "another what?" ambiguity).
          ⭐ v6 (2026-06-18): "Back to Editor" REMOVED — post-push the breakdown
          is purged (purgeJob), so returning to the editor showed a stale/empty
          state = a regression door. The success screen is now terminal:
          forward-only (Open in Jira · export the captured test cases · new page). */}
      <div className="flex gap-3">
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

function LimitReachedScreen({ quota, onBack, backToReview = false }) {
  // ⭐ [deep-audit fix] when onBack returns to the in-flight breakdown (edition_required mid-flow),
  // the back affordances must say so — not the default "page picker" (which would be misleading copy
  // for a non-destructive return-to-Review).
  const backTitle = backToReview ? "Return to your breakdown" : "Return to the page picker";
  const backLabel = backToReview ? "← Back to your breakdown" : "← Back to pages";
  // v6 value-split modes from the routing payload:
  //   edition_required → a Standard user reached an Advanced-only feature (test-cases) → upsell Advanced.
  //   license_required (defensive) → no active license → subscribe (both editions).
  //   quota_exceeded/fairUse → the DORMANT Managed per-user cap (off-Marketplace only; both
  //     LIVE editions are BYOK + unlimited, so this never fires for a Marketplace customer).
  const isEditionRequired = quota?.error === "edition_required";
  const isLicenseRequired = quota?.error === "license_required";
  const isFairUse = !isEditionRequired && !isLicenseRequired;

  const limit = quota?.limit;
  const resetsAt =
    quota?.resetsAtLabel ||
    (quota?.resetsAt ? String(quota.resetsAt).slice(0, 10) : null);
  const standardPrice = findPrice(quota, "byokPro"); // Standard edition
  const advancedPrice = findPrice(quota, "byokAdvanced"); // v6: Advanced (was 'managedPro' → that key is dormant → blank-price bug)

  // Headline + intro. Prefer the backend-composed `detail` for the body (it is
  // already tier-correct and mentions the reset date / prices); fall back to a
  // mode-specific sentence if it is ever absent.
  const heading = isEditionRequired
    ? "Advanced feature"
    : isLicenseRequired
      ? "Subscription required"
      : "You've used this month's breakdowns";
  const fallbackBody = isEditionRequired
    ? "The Advanced edition includes test-case generation and the Capacity-Sheet Planner. Upgrade to generate BA-grade acceptance test cases and turn your backlog into a Scrum or Kanban delivery plan."
    : isLicenseRequired
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
      {/* moodboard (Phase 1) — navy headline + a light accented MoodCard (clarity, not
          premium glass: this is an upsell/limit moment, keep it calm and legible). The
          green subscription card below is deliberately left in the commit-colour. */}
      <ScreenHeader
        title={heading}
        onBack={onBack || undefined}
        backLabel={backToReview ? "Back to your breakdown" : "Back to pages"}
        backTitle={backTitle}
      />

      <MoodCard density="minor" accent="var(--s2j-blue)" style={{ marginBottom: 16 }}>
        <p style={TYPE.body}>{quota?.detail || fallbackBody}</p>
        {/* Reset date is the actionable info for a Managed user waiting out the
            fair-use month rather than switching to BYOK. license_required has no
            monthly reset (it's an account/subscription state, not a quota). */}
        {isFairUse && !quota?.detail && resetsAt && (
          <p style={{ ...TYPE.sub, marginTop: 6 }}>
            Your monthly breakdowns reset on <strong>{resetsAt}</strong>.
          </p>
        )}
      </MoodCard>

      {/* Subscription card (v6 value framing). edition_required → upsell Advanced;
          license_required (no plan) → both editions; fair-use (dormant Managed) → Standard. */}
      {(standardPrice || advancedPrice) && (
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
            {isEditionRequired ? "Upgrade" : isFairUse ? "For unlimited" : "Choose a plan"}
          </p>

          {isEditionRequired ? (
            <EditionRow
              name="Advanced"
              price={advancedPrice}
              blurb="+ test-case generation + capacity planner"
            />
          ) : isFairUse ? (
            <EditionRow
              name="Standard"
              price={standardPrice}
              blurb="unlimited — use your own Anthropic key"
            />
          ) : (
            <>
              <EditionRow
                name="Standard"
                price={standardPrice}
                blurb="core breakdown + push + Project Context"
              />
              <EditionRow
                name="Advanced"
                price={advancedPrice}
                blurb="+ test-case generation + capacity planner"
              />
            </>
          )}

          {UPGRADE_URL && (
            <>
              <button onClick={openUpgrade} className="btn-primary mt-3">
                {isEditionRequired ? "Upgrade to Advanced" : isFairUse ? "Switch to Standard" : "Subscribe"}
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
        {backLabel}
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
      {/* moodboard (Phase 1; deep-audit fix) — a crisis screen earns clarity, not glass.
          ScreenHeader gives the screen a real navy <h2> (consistent with every other
          screen + the document outline); the SignalCallout below carries the error tone
          (red icon + border, dark readable body) and the verbatim detail. */}
      <ScreenHeader
        title="Something went wrong"
        onBack={onBackToPicker || undefined}
        backLabel="Back to pages"
        backTitle="Abandon this page and return to picker (use 'Try again' below to retry the same page)"
      />
      <SignalCallout kind="error" style={{ marginBottom: 16 }} fontSize={13}>
        <div>{displayError}</div>
        {/* [diag Phase 3, design §5] ADDITIVE diagnostic ref under the verbatim error
            text — the existing message above is never shortened or replaced. Renders
            nothing when no jobId is in scope for this failure (jobId null). */}
        <DiagnosticRefLine refId={jobId} onOpenDiagnostics={onOpenDiagnostics} />
      </SignalCallout>

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
 * v6 value-split: BOTH editions are BYOK → every user needs their own Anthropic key.
 * The old Managed/Advanced "no key needed" branch was REMOVED (it would mis-onboard a
 * paying Advanced BYOK customer who DOES need a key). Setup asks for the Anthropic key
 * + a JIRA project key for everyone.
 *
 * Surfaces to customer:
 *   - Prerequisite: an Anthropic API key + a JIRA project key
 *   - Navigation path: how to reach Settings to configure them
 */
function SetupScreen({ message, onOpenSettings }) {
  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      {/* moodboard (Phase 1) — onboarding earns clarity: navy header + a light glass
          prerequisites card with the green "Open Settings" commit CTA, then a quieter
          utility card for the secondary admin-route steps. */}
      <ScreenHeader
        title="Setup required"
        subtitle="Spec2Tickets needs to be configured before first use."
        icon={
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="2" />
            <path
              d="M10 6v5M10 13.5v.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        }
      />

      {/* v6 value-split: both editions are BYOK → always show the Anthropic-key
          prerequisite (the old "no key needed" Managed branch was removed). */}
      <MoodCard density="minor" style={{ marginBottom: 16 }}>
        <p style={{ ...TYPE.body, fontWeight: 600, marginBottom: 8 }}>
          You will need:
        </p>
        <ul
          style={{ ...TYPE.body, margin: 0, paddingLeft: 18, listStyle: "disc" }}
        >
          <li style={{ marginBottom: 6 }}>
            An Anthropic API key (sign up at{" "}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--s2j-blue)", textDecoration: "underline" }}
            >
              console.anthropic.com → API Keys
            </a>
            ; billed pay-as-you-go to your own Anthropic account)
          </li>
          <li>A Jira project key where the breakdown will be created</li>
        </ul>
        <p style={{ ...TYPE.sub, marginTop: 10 }}>
          New to API keys? Our plain-English walkthrough (no technical background
          needed) covers it step by step:{" "}
          <a
            href="https://spec2jira.com/get-api-key"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--s2j-blue)", textDecoration: "underline" }}
          >
            spec2jira.com/get-api-key
          </a>
        </p>

        {/* Primary call-to-action — open the app's OWN in-app Settings. This is the
            reliable path: the globalSettings "Configure" page is unreachable in the
            centralized admin (see App-level note). The "How to configure" steps below
            remain as a secondary fallback for users who prefer the admin route. */}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="btn-primary justify-center"
            style={{ marginTop: 14 }}
          >
            Open Settings
          </button>
        )}
      </MoodCard>

      <MoodCard density="utility">
        <p style={{ ...TYPE.label, color: "var(--s2j-text)", marginBottom: 6 }}>
          How to configure:
        </p>
        <ol style={{ ...TYPE.sub, margin: 0, paddingLeft: 18 }}>
          <li>
            Go to <strong>Confluence Settings</strong> (gear icon, top right)
          </li>
          <li>
            Click <strong>Apps → Manage Apps</strong>
          </li>
          <li>
            Find <strong>Spec2Tickets Settings</strong> in the left sidebar
          </li>
          <li>
            Paste your Anthropic API key + Jira Project Key, then Test &amp; Save
          </li>
        </ol>
        <p style={{ ...TYPE.micro, marginTop: 8, fontStyle: "italic" }}>
          Powered by Claude Sonnet 4.6 — your page content flows directly from
          Forge to the Anthropic API using your own key. No data on Spec2Tickets
          servers.
        </p>
      </MoodCard>
    </div>
  );
}

// ── Util ────────────────────────────────────────────────────────

// v6 cost-transparency: format a COMPUTE-cost dollar amount (Anthropic usage on the customer's
// own key — distinct from the Marketplace subscription price rendered via findPrice). Non-zero
// amounts under a cent floor to $0.01 so a tiny figure still reads as a real (small) cost.
function fmtUsd(usd) {
  if (typeof usd !== "number" || !isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return "$0.01";
  return `$${usd.toFixed(2)}`;
}

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
