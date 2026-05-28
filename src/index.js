/**
 * Forge resolver functions — Phase B.
 * Settings stored in Forge Storage (per installation).
 * Backend URL is dynamic: reads from Storage, falls back to default.
 *
 * KVS schema for 'spec2jira_settings':
 *   {
 *     backendUrl: string,
 *     backendApiKey: string,
 *     defaultProjectKey: string,
 *     lastTestOk?: boolean    // true = testConnection succeeded with CURRENT config
 *                             //        (undefined/false = requires pre-flight at app mount)
 *   }
 */
import Resolver from "@forge/resolver";
import { kvs } from "@forge/kvs";
import api, { route } from "@forge/api";

const resolver = new Resolver();

// ── Settings helpers ────────────────────────────────────────

async function loadSettings() {
  const s = await kvs.get("spec2jira_settings");
  return s || {};
}

async function getApiKey() {
  const s = await loadSettings();
  return s.backendApiKey || null;
}

async function getBackendUrl() {
  const s = await loadSettings();
  return s.backendUrl || null;
}

async function getProjectKey(payloadKey) {
  if (payloadKey) return payloadKey;
  const s = await loadSettings();
  return s.defaultProjectKey || null;
}

// ── Backend HTTP helpers ────────────────────────────────────

const NOT_CONFIGURED = {
  error: "not_configured",
  detail:
    "Spec2Tickets is not configured yet. Ask your Confluence admin to set the Backend URL in Settings → Manage Apps → Spec2Tickets → Configure.",
};

async function backendGet(path) {
  const url = await getBackendUrl();
  if (!url) return NOT_CONFIGURED;
  const apiKey = await getApiKey();
  if (!apiKey) {
    return {
      error: "not_configured",
      detail:
        "Backend API Key is not configured. Ask your Confluence admin to set it in Settings → Manage Apps → Spec2Tickets → Configure.",
    };
  }
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  // if (apiKey) headers["X-API-Key"] = apiKey;

  // B2 part 26 (2026-05-09) diagnostic logging — partner manual-entry
  // case: backend curl returns 200 OK on same page ID (3964939) but
  // Forge UI manual entry fails. Logging captures the actual fetch
  // outcome so partner can paste console output for diagnosis.
  // Visible via `forge logs --since 5m` after sandbox reproduction.
  let r;
  try {
    r = await fetch(`${url}${path}`, { method: "GET", headers });
  } catch (e) {
    console.error(
      `[backendGet] FETCH THREW for ${path} — ${String(e?.message || e)}`,
    );
    return {
      error: "Backend unreachable",
      detail: `fetch threw: ${String(e?.message || e)}`,
    };
  }
  if (!r.ok) {
    const b = await r.text();
    console.warn(
      `[backendGet] ${path} → HTTP ${r.status}: ${b.substring(0, 300)}`,
    );
    return { error: `Backend ${r.status}`, detail: b.substring(0, 300) };
  }
  // Successful response — log path + status only (avoid leaking body).
  console.log(`[backendGet] ${path} → HTTP ${r.status} OK`);
  return await r.json();
}

async function backendPost(path, body) {
  const url = await getBackendUrl();
  if (!url) return NOT_CONFIGURED;
  const apiKey = await getApiKey();
  if (!apiKey) {
    return {
      error: "not_configured",
      detail:
        "Backend API Key is not configured. Ask your Confluence admin to set it in Settings → Manage Apps → Spec2Tickets → Configure.",
    };
  }
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  // const headers = {
  //   Accept: "application/json",
  //   "Content-Type": "application/json",
  // };
  // if (apiKey) headers["X-API-Key"] = apiKey;
  const r = await fetch(`${url}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (r.status === 423) {
    const d = await r.json();
    return { busy: true, ...d.detail };
  }
  if (!r.ok) {
    const t = await r.text();
    return { error: `Backend ${r.status}`, detail: t.substring(0, 300) };
  }
  return await r.json();
}

// ── Settings resolvers ──────────────────────────────────────

resolver.define("getSettings", async () => {
  return await loadSettings();
});

resolver.define("resetSettings", async () => {
  await kvs.delete("spec2jira_settings");
  return { success: true };
});

resolver.define("saveSettings", async ({ payload }) => {
  const { backendUrl, backendApiKey, defaultProjectKey } = payload;

  // Server-side validation (defense in depth — client validates too, but
  // resolver must guard against direct calls or UI bypasses).

  // Validate URL format
  if (!backendUrl) {
    return { error: "Backend URL is required" };
  }
  if (!backendUrl.startsWith("https://")) {
    return { error: "Backend URL must start with https://" };
  }

  // Validate API key — required, reasonable length.
  // Server-side enforcement (defense in depth — client validates too,
  // but resolver must guard against direct calls or UI bypasses).
  const trimmedApiKey = (backendApiKey || "").trim();
  if (!trimmedApiKey) {
    return { error: "Backend API Key is required" };
  }
  if (trimmedApiKey.length < 16) {
    return { error: "Backend API Key must be at least 16 characters" };
  }
  if (trimmedApiKey.length > 256) {
    return { error: "Backend API Key must be at most 256 characters" };
  }

  const cleanProjectKey = (defaultProjectKey || "").trim().toUpperCase();
  if (!cleanProjectKey) {
    return { error: "JIRA Project Key is required" };
  }
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(cleanProjectKey)) {
    return {
      error:
        "JIRA Project Key must be 2–10 characters (letter first, then letters/digits).",
    };
  }

  // Strip trailing slash
  const cleanUrl = backendUrl ? backendUrl.replace(/\/+$/, "") : "";

  // Load existing settings to determine if connectivity-affecting fields changed.
  // If url/apiKey unchanged, preserve lastTestOk (avoid forcing unnecessary
  // re-test when user just updates projectKey).
  const current = await loadSettings();
  const urlChanged = current.backendUrl !== cleanUrl;
  const keyChanged = (current.backendApiKey || "") !== (backendApiKey || "");
  const preserveLastTestOk =
    !urlChanged && !keyChanged && current.lastTestOk === true;

  const next = {
    backendUrl: cleanUrl,
    backendApiKey: backendApiKey || "",
    defaultProjectKey: cleanProjectKey,
  };
  if (preserveLastTestOk) next.lastTestOk = true;

  await kvs.set("spec2jira_settings", next);

  return { success: true };
});

/**
 * testConnection — verifies backend reachability + classifies failures
 * using Forge egress proxy headers (empirically validated Apr 18 2026):
 *
 *   forge-proxy-error: BLOCKED_EGRESS  → domain not whitelisted
 *   x-squid-error: <code>              → proxy couldn't reach backend
 *   (no Forge headers) + status        → real passthrough from backend
 *
 * Side-effect: persists `lastTestOk` in KVS when tested config matches
 * stored config. This enables App.js to skip pre-flight on mount when
 * a recent successful test exists.
 *
 * Expects the backend to have a /health endpoint returning 200 when healthy.
 */
resolver.define("testConnection", async ({ payload }) => {
  const result = await runTestConnection(payload);
  await persistTestStatusIfMatching(payload, result.status === "ok");
  return result;
});

async function runTestConnection(payload) {
  const { backendUrl, backendApiKey } = payload || {};

  if (!backendUrl) {
    return {
      status: "error",
      code: "UNEXPECTED",
      detail: "Backend URL is required",
    };
  }

  // Normalize URL (strip trailing slash to avoid "//health")
  const base = backendUrl.replace(/\/+$/, "");
  const healthUrl = `${base}/health`;

  let res;
  try {
    const headers = { Accept: "application/json" };
    if (backendApiKey) {
      headers["Authorization"] = `Bearer ${backendApiKey}`;
    }
    res = await fetch(healthUrl, { method: "GET", headers });
  } catch (e) {
    // Forge egress proxy synthesizes HTTP responses for egress failures,
    // so this catch block should only fire for resolver-level bugs.
    return {
      status: "error",
      code: "UNEXPECTED",
      detail: String(e?.message || e),
    };
  }

  // ─── Classification by Forge proxy headers FIRST ─────────────

  if (res.headers.get("forge-proxy-error") === "BLOCKED_EGRESS") {
    return {
      status: "error",
      code: "FORGE_FETCH_BLOCKED",
      detail: `HTTP ${res.status} — forge-proxy-error: BLOCKED_EGRESS`,
    };
  }

  const squidError = res.headers.get("x-squid-error");
  if (squidError) {
    return {
      status: "error",
      code: "BACKEND_UNREACHABLE",
      detail: `HTTP ${res.status} — x-squid-error: ${squidError}`,
    };
  }

  // ─── From here on, response is a real passthrough from backend ──

  if (res.status === 401 || res.status === 403) {
    return {
      status: "error",
      code: "BACKEND_AUTH_FAILED",
      detail: `HTTP ${res.status} from backend`,
    };
  }

  if (!res.ok) {
    return {
      status: "error",
      code: "BACKEND_NOT_HEALTHY",
      detail: `HTTP ${res.status} from backend`,
    };
  }

  // 2xx — try to parse body for a friendlier message.
  let bodyMessage;
  try {
    const body = await res.json();
    bodyMessage = body?.message || body?.status;
  } catch {
    // Body not JSON or empty — fine.
  }

  return { status: "ok", message: bodyMessage || "Backend is healthy" };
}

/**
 * Persist lastTestOk to KVS — but ONLY if the tested URL+apiKey match
 * what's currently stored. Prevents mismatch where user types a different
 * URL in the form, tests it, gets success, but saved config still has old URL.
 */
async function persistTestStatusIfMatching(payload, isOk) {
  const { backendUrl, backendApiKey } = payload || {};
  if (!backendUrl) return;

  const current = await loadSettings();
  const cleanTestedUrl = backendUrl.replace(/\/+$/, "");

  const urlMatches = current.backendUrl === cleanTestedUrl;
  const keyMatches = (current.backendApiKey || "") === (backendApiKey || "");

  if (urlMatches && keyMatches) {
    await kvs.set("spec2jira_settings", { ...current, lastTestOk: isOk });
  }
  // If no match, do nothing — we don't know if this test result applies
  // to the saved config. App.js will pre-flight at next mount.
}

// ── Page metadata ───────────────────────────────────────────

resolver.define("fetchPage", async ({ payload }) => {
  const { pageId } = payload;
  if (!pageId) return { error: "No page ID" };
  return backendGet(`/api/v1/pages/${pageId}`);
});

// ── Page picker (globalPage migration 2026-05-08) ───────────
// Editor flow no longer auto-binds via ctx.extension.content.id (this
// affordance is contentAction-specific). Users now select a page through
// PagePickerScreen which combines:
//   - Recent list (last MAX_RECENT_PAGES selections, persisted in KVS)
//   - Title search across user's accessible pages (cross-space, CQL ~)
//   - Manual page-ID input fallback (for empty results / permission gaps)
//
// KVS schema:
//   spec2jira_recent_pages    : [{id, title, spaceKey, spaceName,
//                                 lastSelectedAt}, ...]  (newest-first)
//   spec2jira_last_selected_page : {id, title, ...}      (single entry)
//
// Scope: requires `search:confluence` (granted in manifest.yml 2026-05-08).
//        Forge linter empirically confirmed this scope name 2026-05-08
//        (initial draft used `read:page:confluence` which was insufficient
//        for /wiki/rest/api/content/search v1 CQL endpoint — H-1 self-
//        review risk caught BEFORE sandbox deploy via lint gate).
//        Triggers re-authorization on upgrade for existing installations.

const RECENT_PAGES_KEY = "spec2jira_recent_pages";
const LAST_SELECTED_KEY = "spec2jira_last_selected_page";
const MAX_RECENT_PAGES = 10;
// U3 part 33 (2026-05-09) — deep-link relay between contentAction module
// and globalPage. contentAction sets pending_deep_link с page context;
// globalPage init() consumes it. Stale entries (>5 min old) auto-cleared
// to prevent zombie state if user аборт-ва navigation mid-flight.
const PENDING_DEEP_LINK_KEY = "spec2jira_pending_deep_link";
const PENDING_DEEP_LINK_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const SEARCH_MIN_QUERY_LEN = 2;
const SEARCH_RESULT_LIMIT = 20;

/**
 * searchPages — title-substring search across user's accessible pages.
 *
 * Uses CQL v1 endpoint (`/wiki/rest/api/content/search`) because v2 API's
 * /pages endpoint only supports exact-match `title` parameter, not
 * substring search. CQL `title ~ "query"` is case-insensitive partial.
 *
 * Returns: { results: [{id, title, spaceKey, spaceName}] } | { error, detail }
 */
resolver.define("searchPages", async ({ payload }) => {
  const query = (payload?.query || "").trim();
  if (query.length < SEARCH_MIN_QUERY_LEN) {
    return { results: [] };
  }

  // CQL escape: backslashes FIRST (so quote-escapes added below не
  // double-escape), then quotes. M-1 self-review fix 2026-05-08 —
  // original code only escaped quotes; user typing `\` followed by
  // anything broke CQL parser.
  const safeQuery = query
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  const cql = `type=page AND title ~ "${safeQuery}"`;

  let response;
  try {
    response = await api
      .asUser()
      .requestConfluence(
        route`/wiki/rest/api/content/search?cql=${cql}&limit=${SEARCH_RESULT_LIMIT}&expand=space`,
      );
  } catch (e) {
    console.error(
      `[searchPages] requestConfluence THREW for query="${query}" — ${String(
        e?.message || e,
      )}`,
    );
    return { error: "Search failed", detail: String(e?.message || e) };
  }

  // B2 part 26 (2026-05-09) diagnostic logging — partner sandbox case:
  // search broken despite scope granted. Logging captures actual HTTP
  // status + Forge proxy headers so failure mode is visible via
  // `forge logs --since 5m` after sandbox reproduction.
  console.log(
    `[searchPages] query="${query}" → HTTP ${response.status} ${
      response.ok ? "OK" : "FAIL"
    }`,
  );

  // M-4 self-review fix 2026-05-08 — Forge-proxy diagnostic headers
  // (mirror testConnection pattern). Egress proxy synthesizes responses
  // for blocked domains / unreachable backends; classifying via headers
  // makes scope-mismatch / proxy-blocked failures debuggable instead of
  // an opaque "403". Critical for sandbox validation of H-1 (scope
  // sufficiency for v1 CQL endpoint not yet empirically verified).
  if (response.headers.get("forge-proxy-error") === "BLOCKED_EGRESS") {
    return {
      error: "FORGE_FETCH_BLOCKED",
      detail: `HTTP ${response.status} — forge-proxy-error: BLOCKED_EGRESS (likely missing scope OR app-config issue)`,
    };
  }
  const squidError = response.headers.get("x-squid-error");
  if (squidError) {
    return {
      error: "BACKEND_UNREACHABLE",
      detail: `HTTP ${response.status} — x-squid-error: ${squidError}`,
    };
  }

  if (!response.ok) {
    const text = await response.text();
    console.warn(
      `[searchPages] Confluence ${response.status} body: ${text.substring(
        0,
        300,
      )}`,
    );
    // 403 specifically — most common scope-mismatch outcome on first deploy.
    if (response.status === 403) {
      return {
        error: "Confluence 403 — scope mismatch?",
        detail: `Granted scopes (search:confluence + read:confluence-content.summary post part 26 fix) may be insufficient OR app needs reinstall to grant new scopes. Run 'forge install --upgrade' and re-authorize. Body: ${text.substring(0, 200)}`,
      };
    }
    return {
      error: `Confluence ${response.status}`,
      detail: text.substring(0, 300),
    };
  }

  try {
    const data = await response.json();
    const results = (data.results || []).map((p) => ({
      id: String(p.id),
      title: p.title || "(untitled)",
      spaceKey: p.space?.key || "",
      spaceName: p.space?.name || "",
    }));
    return { results };
  } catch (e) {
    return { error: "Parse failed", detail: String(e?.message || e) };
  }
});

/**
 * getRecentPages — reads KVS recent list (newest-first per recordPageSelection
 * contract). Returns empty array когато KVS empty or schema-shape unexpected.
 */
resolver.define("getRecentPages", async () => {
  const list = await kvs.get(RECENT_PAGES_KEY);
  return { recent: Array.isArray(list) ? list : [] };
});

/**
 * getLastSelectedPage — reload continuity surface. App.js can pre-populate
 * the picker с last-selected page, OR auto-route to editor flow if user
 * intends to continue. Returns null когато no prior selection exists.
 */
resolver.define("getLastSelectedPage", async () => {
  const last = await kvs.get(LAST_SELECTED_KEY);
  return { lastSelected: last || null };
});

/**
 * recordPageSelection — invoked when user confirms a page choice.
 * Side effects:
 *   1. Recent list — dedupe by id, prepend new entry, truncate to MAX_RECENT_PAGES
 *   2. last_selected_page — replace с new entry (single-value)
 *
 * Both writes are best-effort sequential; failure between them leaves recent
 * list updated but last_selected stale. Acceptable trade-off (low-frequency
 * write path; KVS reliability per Forge SLA).
 */
resolver.define("recordPageSelection", async ({ payload }) => {
  const { id, title, spaceKey, spaceName } = payload || {};
  if (!id || !title) {
    return { error: "Missing page id or title" };
  }

  const stringId = String(id);
  const entry = {
    id: stringId,
    title,
    spaceKey: spaceKey || "",
    spaceName: spaceName || "",
    lastSelectedAt: new Date().toISOString(),
  };

  const current = await kvs.get(RECENT_PAGES_KEY);
  const list = Array.isArray(current) ? current : [];
  const filtered = list.filter((p) => p.id !== stringId);
  const next = [entry, ...filtered].slice(0, MAX_RECENT_PAGES);

  await kvs.set(RECENT_PAGES_KEY, next);
  await kvs.set(LAST_SELECTED_KEY, entry);

  return { success: true, recent: next };
});

/**
 * setPendingDeepLink (U3 part 33, 2026-05-09) — contentAction module
 * writes pending page reference here, then navigates to globalPage.
 * globalPage init() reads via consumePendingDeepLink as its FIRST gate
 * after settings/connection checks; if present, pre-binds the page +
 * routes по job status (skips picker entirely).
 *
 * Closes "Apps menu navigation friction" partner UX insight 2026-05-08
 * part 18 — user clicks contentAction byline button on a Confluence
 * page → globalPage opens с that page already bound. ZERO picker steps.
 *
 * Payload: { pageId, title, spaceKey, spaceName }
 */
resolver.define("setPendingDeepLink", async ({ payload }) => {
  const { pageId, title, spaceKey, spaceName } = payload || {};
  if (!pageId) return { error: "Missing pageId" };
  await kvs.set(PENDING_DEEP_LINK_KEY, {
    pageId: String(pageId),
    title: title || "",
    spaceKey: spaceKey || "",
    spaceName: spaceName || "",
    setAt: Date.now(),
  });
  return { success: true };
});

/**
 * consumePendingDeepLink (U3 part 33, 2026-05-09) — globalPage init
 * reads pending deep-link, deletes it (single-use), and pre-binds the
 * page. Stale entries (>5 min old) are silently dropped without
 * consumption — guards against zombie KVS state if contentAction set
 * a deep-link but user аборт-ва before reaching globalPage (e.g.,
 * closed tab mid-navigation; deep-link should not silently re-bind
 * stale page on next session).
 *
 * Returns: { pending: { pageId, title, spaceKey, spaceName } | null }
 */
resolver.define("consumePendingDeepLink", async () => {
  const pending = await kvs.get(PENDING_DEEP_LINK_KEY);
  if (!pending || !pending.pageId) {
    return { pending: null };
  }
  // Always clear KVS — single-use semantic regardless of staleness.
  await kvs.delete(PENDING_DEEP_LINK_KEY);
  const ageMs = Date.now() - (pending.setAt || 0);
  if (ageMs > PENDING_DEEP_LINK_MAX_AGE_MS) {
    return { pending: null }; // stale → discard
  }
  return {
    pending: {
      pageId: pending.pageId,
      title: pending.title || "",
      spaceKey: pending.spaceKey || "",
      spaceName: pending.spaceName || "",
    },
  };
});

// ── Generation ──────────────────────────────────────────────

resolver.define("getGenerationStatus", async ({ payload }) => {
  const { pageId } = payload;
  if (!pageId) return { status: "idle" };
  return backendGet(`/api/v1/generate/status?page_id=${pageId}`);
});

resolver.define("startGeneration", async ({ payload }) => {
  const { pageId, documentType, modelMode, projectKey, bypassCache } = payload;
  if (!pageId) return { error: "No page ID" };
  const pk = await getProjectKey(projectKey);
  // Slice 3 (Layer 1 Session 4 — CG-9 cache bypass, 2026-05-08).
  // Forge UI ReadyScreen "Bypass cache" checkbox passes bypassCache=true
  // когато user wants fresh re-run без cache lookups. Default false →
  // legacy clients не sending field behave exactly как before.
  return backendPost("/api/v1/generate", {
    page_id: pageId,
    document_type: documentType || "MODULE",
    model_mode: modelMode || "dual",
    project_key: pk,
    bypass_cache: bypassCache === true,
  });
});

// CG-7 spec linter pre-flight (Layer 1 Session 2, 2026-05-07).
// Runs Phase 0 + Phase 0b only (~30-90 sec). Backend route accepts
// page_id as path param. Slice 3 (2026-05-08): backend now accepts
// optional body с `bypass_cache` field for symmetry с /generate;
// legacy `{}` body still routes bypass_cache=False (backward-compat).
// Concurrency: shares GPU lock с /generate — backend returns 423
// если pipeline busy. Polling reuses pollJobStatus + getResults
// (job_store routes payload by kind="preview" → preview_result key).
resolver.define("startPreview", async ({ payload }) => {
  const { pageId, bypassCache } = payload;
  if (!pageId) return { error: "No page ID" };
  return backendPost(`/api/v1/specs/preview/${pageId}`, {
    bypass_cache: bypassCache === true,
  });
});

resolver.define("pollJobStatus", async ({ payload }) => {
  const { jobId } = payload;
  if (!jobId) return { error: "No job ID" };
  return backendGet(`/api/v1/jobs/${jobId}`);
});

resolver.define("getResults", async ({ payload }) => {
  const { jobId } = payload;
  if (!jobId) return { error: "No job ID" };
  return backendGet(`/api/v1/results/${jobId}`);
});

// ── JIRA push ───────────────────────────────────────────────

resolver.define("dryRun", async ({ payload }) => {
  const { breakdown, projectKey } = payload;
  if (!breakdown) return { error: "No breakdown data" };
  const pk = await getProjectKey(projectKey);
  return backendPost("/api/v1/jira/dry-run", { breakdown, project_key: pk });
});

resolver.define("pushToJira", async ({ payload }) => {
  const { breakdown, projectKey } = payload;
  if (!breakdown) return { error: "No breakdown data" };
  const pk = await getProjectKey(projectKey);
  return backendPost("/api/v1/jira/push/start", { breakdown, project_key: pk });
});

resolver.define("pollPushStatus", async ({ payload }) => {
  const { jobId } = payload;
  if (!jobId) return { error: "No job ID" };
  return backendGet(`/api/v1/jira/push/status/${jobId}`);
});

// ── Health ──────────────────────────────────────────────────

resolver.define("healthCheck", async () => backendGet("/health"));

export const handler = resolver.getDefinitions();
