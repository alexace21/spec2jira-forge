/**
 * Spec2Tickets v3.0.0 — Forge resolver entry point.
 *
 * Architecture (post-pivot 2026-05-28):
 *   - BYOK: customer's Anthropic API key stored in Forge KVS secret storage
 *   - Direct asUser() to Confluence (page content fetch) — no backend roundtrip
 *   - Async event consumer for Anthropic generateBreakdown (runtime constraint)
 *   - Direct asUser() to JIRA for push (Step 8 — currently stubbed)
 *
 * v2.x → v3.0.0 resolver changes:
 *   PRESERVED (Forge-native, no backend dependency):
 *     - searchPages, getRecentPages, getLastSelectedPage, recordPageSelection
 *     - setPendingDeepLink, consumePendingDeepLink
 *
 *   REWRITTEN:
 *     - getSettings, saveSettings, resetSettings (BYOK API key model)
 *     - testConnection (calls Anthropic /v1/messages with minimal payload)
 *     - fetchPage (direct asUser() to Confluence; no backend roundtrip)
 *     - startGeneration (enqueues async event, returns jobId)
 *     - pollJobStatus, getResults (read KVS by jobId)
 *
 *   REMOVED:
 *     - startPreview (v3.0.0 single Anthropic call IS the breakdown)
 *     - healthCheck (no backend к probe)
 *
 *   JIRA push (Step 8 — synchronous asUser() via executePush; 2026-05-30):
 *     - dryRun (pre-flight project verify), pushToJira (full synchronous push)
 *     - pollPushStatus REMOVED — push е synchronous now, no polling
 */

import Resolver from '@forge/resolver';
import { kvs } from '@forge/kvs';
import api, { route } from '@forge/api';

import {
  setStoredApiKey,
  clearStoredApiKey,
  getStoredApiKey,
  testConnection as anthropicTestConnection,
  submitBreakdownBatch,
  pollBatchStatus,
  fetchBatchResults,
  estimateCost,
  MODEL_PRIMARY,
  MODEL_FALLBACK,
} from './anthropic_client.js';
import { startPushSession, pushSessionStep } from './push_handler.js';

const resolver = new Resolver();

// ── Constants ──────────────────────────────────────────────

const SETTINGS_KEY = 'spec2jira_settings';

// KVS prefix for generation job state (Anthropic batch lifecycle).
const JOB_KEY_PREFIX = 'job:';

// NOTE: generation uses Anthropic Message Batches API (polled via
// pollJobStatus); push runs synchronously in the pushToJira resolver via
// executePush(). Neither uses @forge/events queues anymore — asUser() е
// unavailable in async consumers (AUTH_TYPE_UNAVAILABLE 2026-05-30).


// ── Settings helpers ────────────────────────────────────────

async function loadSettings() {
  const s = await kvs.get(SETTINGS_KEY);
  return s || {};
}

async function getProjectKey(payloadKey) {
  if (payloadKey) return payloadKey;
  const s = await loadSettings();
  return s.defaultProjectKey || null;
}

// ════════════════════════════════════════════════════════════
// SETTINGS RESOLVERS — BYOK Anthropic API key + JIRA project key
// ════════════════════════════════════════════════════════════

/**
 * Load settings for the Settings UI.
 * Returns project key + boolean indicating whether API key е stored.
 * Does NOT return the actual API key value (Forge KVS secrets are
 * resolver-only and we don't echo them back к the UI for security).
 */
resolver.define('getSettings', async () => {
  const s = await loadSettings();
  const storedKey = await getStoredApiKey();
  return {
    defaultProjectKey: s.defaultProjectKey || '',
    apiKeyConfigured: !!storedKey,
    apiKeyLastSetAt: s.apiKeyLastSetAt || null,
    // Optional advanced config — required custom fields JSON (raw string for
    // round-trip editing). Empty когато the project doesn't require custom fields.
    requiredCustomFieldsJson: s.requiredCustomFieldsJson || '',
  };
});

/**
 * Parse the admin-configured required-custom-fields JSON string into an object.
 * Returns { ok, value } or { ok: false, error }. Empty/blank → ok with null.
 */
function parseRequiredCustomFields(raw) {
  const text = (raw || '').trim();
  if (!text) return { ok: true, value: null };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: 'Custom fields must be valid JSON (e.g. {"customfield_10042": {"value": "Team A"}}).' };
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
    return { ok: false, error: 'Custom fields must be а JSON object mapping field IDs к values.' };
  }
  return { ok: true, value: parsed };
}

/**
 * Save settings от Settings UI.
 *
 * Payload: { anthropicApiKey?: string, defaultProjectKey: string }
 *
 * If anthropicApiKey provided + non-empty, stores it via Forge secret KVS.
 * If omitted/empty, existing key (if any) е preserved.
 * defaultProjectKey е always validated + saved.
 */
resolver.define('saveSettings', async ({ payload }) => {
  const { anthropicApiKey, defaultProjectKey, requiredCustomFieldsJson } = payload || {};

  // Validate project key
  const cleanProjectKey = (defaultProjectKey || '').trim().toUpperCase();
  if (!cleanProjectKey) {
    return { error: 'JIRA Project Key е required' };
  }
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(cleanProjectKey)) {
    return {
      error:
        'JIRA Project Key must be 2–10 characters, start with а letter, only uppercase letters and digits (e.g., PROJ, SCRUM2)',
    };
  }

  // Validate optional custom-fields JSON (fail fast so the admin fixes it now,
  // не discovers it as а push failure later).
  const cfRaw = (requiredCustomFieldsJson || '').trim();
  const cfParse = parseRequiredCustomFields(cfRaw);
  if (!cfParse.ok) {
    return { error: cfParse.error };
  }

  // Conditionally update API key
  let apiKeyUpdated = false;
  const incomingKey = (anthropicApiKey || '').trim();
  if (incomingKey) {
    const result = await setStoredApiKey(incomingKey);
    if (!result.success) {
      return { error: result.error };
    }
    apiKeyUpdated = true;
  }

  // Update non-secret settings (project key + custom fields + metadata)
  const current = await loadSettings();
  const next = {
    ...current,
    defaultProjectKey: cleanProjectKey,
    requiredCustomFieldsJson: cfRaw, // store raw string for UI round-trip
  };
  if (apiKeyUpdated) {
    next.apiKeyLastSetAt = new Date().toISOString();
  }
  await kvs.set(SETTINGS_KEY, next);

  return { success: true, apiKeyUpdated };
});

/**
 * Clear Anthropic API key only (preserves project key).
 * Useful когато admin wants к rotate keys или disconnect Spec2Tickets.
 */
resolver.define('clearAnthropicApiKey', async () => {
  const result = await clearStoredApiKey();
  if (result.success) {
    // Remove timestamp от settings
    const current = await loadSettings();
    if (current.apiKeyLastSetAt) {
      delete current.apiKeyLastSetAt;
      await kvs.set(SETTINGS_KEY, current);
    }
  }
  return result;
});

/**
 * Reset all settings (clears API key AND project key + KVS metadata).
 * Confirmation prompt should be shown in UI BEFORE calling this.
 */
resolver.define('resetSettings', async () => {
  await clearStoredApiKey();
  await kvs.delete(SETTINGS_KEY);
  return { success: true };
});

/**
 * Test the customer's stored Anthropic API key (or override from UI).
 * Returns { status: 'ok', model } on success or { status: 'error', code, detail }.
 * Compatible с existing AdminSettings.jsx error code mapping.
 */
resolver.define('testConnection', async ({ payload }) => {
  // payload may include { anthropicApiKey } when testing a key BEFORE save
  const candidateKey = (payload?.anthropicApiKey || '').trim() || null;
  const result = await anthropicTestConnection(candidateKey);

  if (result.ok) {
    return {
      status: 'ok',
      message: `Connected к Anthropic API (${result.model})`,
    };
  }

  // Map к error codes (some preserved от v2.x format)
  const codeMap = {
    not_configured: 'NOT_CONFIGURED',
    network_failure: 'BACKEND_UNREACHABLE',
    auth_rejected: 'BACKEND_AUTH_FAILED',
    insufficient_credits: 'INSUFFICIENT_CREDITS',
    rate_limited: 'RATE_LIMITED',
  };
  return {
    status: 'error',
    code: codeMap[result.error] || 'UNEXPECTED',
    detail: result.detail,
  };
});

// ════════════════════════════════════════════════════════════
// CONFLUENCE PAGE PICKER — preserved от v2.x (Forge-native)
// ════════════════════════════════════════════════════════════

const RECENT_PAGES_KEY = 'spec2jira_recent_pages';
const LAST_SELECTED_KEY = 'spec2jira_last_selected_page';
const MAX_RECENT_PAGES = 10;
const PENDING_DEEP_LINK_KEY = 'spec2jira_pending_deep_link';
const PENDING_DEEP_LINK_MAX_AGE_MS = 5 * 60 * 1000;
const SEARCH_MIN_QUERY_LEN = 2;
const SEARCH_RESULT_LIMIT = 20;

resolver.define('searchPages', async ({ payload }) => {
  const query = (payload?.query || '').trim();
  if (query.length < SEARCH_MIN_QUERY_LEN) {
    return { results: [] };
  }

  const safeQuery = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const cql = `type=page AND title ~ "${safeQuery}"`;

  // v1 /wiki/rest/api/content/search → 410 Gone (deprecated 2026-05);
  // /wiki/rest/api/search (no /content/ prefix) е the dedicated CQL search
  // endpoint, still supported. Different response envelope — results
  // wrap each match в {content: {...}} object.
  let response;
  try {
    response = await api
      .asUser()
      .requestConfluence(
        route`/wiki/rest/api/search?cql=${cql}&limit=${SEARCH_RESULT_LIMIT}`,
      );
  } catch (e) {
    console.error(`[searchPages] threw: ${String(e?.message || e)}`);
    return { error: 'Search failed', detail: String(e?.message || e) };
  }

  if (response.headers.get('forge-proxy-error') === 'BLOCKED_EGRESS') {
    return {
      error: 'FORGE_FETCH_BLOCKED',
      detail: 'Egress blocked. Verify scopes + reinstall the app.',
    };
  }
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 403) {
      return {
        error: 'Confluence 403 — scope mismatch?',
        detail: `Verify search:confluence + read:confluence-content.summary scopes. Body: ${text.substring(0, 200)}`,
      };
    }
    return {
      error: `Confluence ${response.status}`,
      detail: text.substring(0, 300),
    };
  }

  try {
    const data = await response.json();
    const results = (data.results || []).map((r) => {
      const c = r.content || {};
      return {
        id: String(c.id || ''),
        title: c.title || r.title || '(untitled)',
        spaceKey: c.space?.key || r.resultGlobalContainer?.key || '',
        spaceName: c.space?.name || r.resultGlobalContainer?.title || '',
      };
    }).filter((r) => r.id);
    return { results };
  } catch (e) {
    return { error: 'Parse failed', detail: String(e?.message || e) };
  }
});

resolver.define('getRecentPages', async () => {
  const list = await kvs.get(RECENT_PAGES_KEY);
  return { recent: Array.isArray(list) ? list : [] };
});

resolver.define('getLastSelectedPage', async () => {
  const last = await kvs.get(LAST_SELECTED_KEY);
  return { lastSelected: last || null };
});

resolver.define('recordPageSelection', async ({ payload }) => {
  const { id, title, spaceKey, spaceName } = payload || {};
  if (!id || !title) return { error: 'Missing page id or title' };
  const stringId = String(id);
  const entry = {
    id: stringId,
    title,
    spaceKey: spaceKey || '',
    spaceName: spaceName || '',
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

resolver.define('setPendingDeepLink', async ({ payload }) => {
  const { pageId, title, spaceKey, spaceName } = payload || {};
  if (!pageId) return { error: 'Missing pageId' };
  await kvs.set(PENDING_DEEP_LINK_KEY, {
    pageId: String(pageId),
    title: title || '',
    spaceKey: spaceKey || '',
    spaceName: spaceName || '',
    setAt: Date.now(),
  });
  return { success: true };
});

resolver.define('consumePendingDeepLink', async () => {
  const pending = await kvs.get(PENDING_DEEP_LINK_KEY);
  if (!pending || !pending.pageId) return { pending: null };
  await kvs.delete(PENDING_DEEP_LINK_KEY);
  const ageMs = Date.now() - (pending.setAt || 0);
  if (ageMs > PENDING_DEEP_LINK_MAX_AGE_MS) return { pending: null };
  return {
    pending: {
      pageId: pending.pageId,
      title: pending.title || '',
      spaceKey: pending.spaceKey || '',
      spaceName: pending.spaceName || '',
    },
  };
});

// ════════════════════════════════════════════════════════════
// CONFLUENCE PAGE METADATA + CONTENT — direct asUser()
// (v2.x routed via customer backend; v3.0.0 calls Confluence directly)
// ════════════════════════════════════════════════════════════

/**
 * Fetch Confluence page metadata + body content via asUser().
 * Returns:
 *   { pageId, title, spaceKey, spaceName, version, body, bodyLength }
 *   OR { error, detail }
 *
 * v2 Confluence API (2026-05-29 migration — v1 /wiki/rest/api/content/{id}
 * returned 410 Gone). v2 endpoint е /wiki/api/v2/pages/{id}; response shape
 * differs (spaceId instead of nested space object — space key/name require
 * separate lookup; omitted here for simplicity since they're display-only).
 */
resolver.define('fetchPage', async ({ payload }) => {
  const pageId = payload?.pageId;
  if (!pageId) return { error: 'No page ID' };

  let response;
  try {
    response = await api
      .asUser()
      .requestConfluence(
        route`/wiki/api/v2/pages/${pageId}?body-format=storage`,
      );
  } catch (e) {
    return { error: 'Fetch failed', detail: String(e?.message || e) };
  }

  if (response.status === 404) {
    return { error: 'page_not_found', detail: `Page ${pageId} does not exist or you don't have access` };
  }
  if (response.status === 403) {
    return { error: 'permission_denied', detail: 'You do not have permission к view this page' };
  }
  if (!response.ok) {
    const text = await response.text();
    return { error: `confluence_${response.status}`, detail: text.substring(0, 300) };
  }

  const data = await response.json();
  const bodyStorage = data.body?.storage?.value || '';

  // snake_case field names — matches App.js UI expectations (preserved
  // от v2.x backend response shape). Frontend reads pageData.page_id,
  // pageData.space_name, pageData.body_length etc.
  return {
    page_id: String(data.id),
    title: data.title,
    space_key: '',  // v2 API returns spaceId only; separate /spaces/{spaceId} call needed за key/name
    space_name: '',
    version: data.version?.number || 1,
    body: bodyStorage,
    body_length: bodyStorage.length,
  };
});

// ════════════════════════════════════════════════════════════
// GENERATION — Anthropic Message Batches API pattern
//
// Why batches: Forge async events have а 55-sec hard timeout per invocation.
// Sync generateBreakdown runs 60-150 sec. Batches submit instantly + Anthropic
// processes async (typically 2-10 min). UI polls pollJobStatus which polls
// Anthropic batch status. 50% cheaper than sync calls. Bonus.
//
// Job lifecycle в KVS:
//   pending (just created) → batched (submitted к Anthropic) →
//   completed (results fetched + breakdown stored)
//   OR failed (any error along the way)
// ════════════════════════════════════════════════════════════

function newJobId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Start a breakdown generation job using Anthropic Message Batches API.
 * Returns immediately с jobId after submitting batch (~1-2 sec total).
 * Forge UI polls pollJobStatus за batch lifecycle progress + results.
 *
 * Payload: { pageId, modelMode?, bypassCache? }
 *   modelMode: 'primary' (Sonnet 4.6, default) | 'fallback' (Haiku 4.5)
 *   bypassCache: boolean (disable prompt caching — useful за testing)
 */
resolver.define('startGeneration', async ({ payload }) => {
  const { pageId, modelMode, bypassCache } = payload || {};
  if (!pageId) return { error: 'No page ID' };

  // Verify API key configured BEFORE fetching content (fail fast)
  const apiKey = await getStoredApiKey();
  if (!apiKey) {
    return {
      error: 'not_configured',
      detail:
        'Anthropic API key not configured. Ask your Confluence admin к open Settings → Spec2Tickets and provide an Anthropic API key.',
    };
  }

  // Fetch page content (asUser so customer permissions apply).
  let pageFetch;
  try {
    pageFetch = await api
      .asUser()
      .requestConfluence(
        route`/wiki/api/v2/pages/${pageId}?body-format=storage`,
      );
  } catch (e) {
    return { error: 'fetch_threw', detail: String(e?.message || e) };
  }
  if (!pageFetch.ok) {
    const text = await pageFetch.text();
    return {
      error: `confluence_${pageFetch.status}`,
      detail: text.substring(0, 300),
    };
  }
  const pageData = await pageFetch.json();
  const pageContent = pageData.body?.storage?.value || '';
  if (pageContent.length < 50) {
    return {
      error: 'page_too_small',
      detail: `Page content е too short к extract a meaningful breakdown (${pageContent.length} chars)`,
    };
  }

  const jobId = newJobId();
  const pageTitle = pageData.title || 'Untitled';
  const model = modelMode === 'fallback' ? MODEL_FALLBACK : MODEL_PRIMARY;

  // Persist initial job state
  await kvs.set(`${JOB_KEY_PREFIX}${jobId}`, {
    jobId,
    pageId: String(pageId),
    pageTitle,
    status: 'pending',
    model,
    createdAt: new Date().toISOString(),
  });

  // Submit batch к Anthropic (returns batch_id immediately)
  const submitResult = await submitBreakdownBatch({
    pageTitle,
    pageContent,
    customId: jobId,
    model,
    useCaching: bypassCache !== true,
  });

  if (submitResult.error) {
    console.error(
      `[startGeneration] batch submit failed: ${submitResult.error} | ${submitResult.detail}`,
    );
    await kvs.set(`${JOB_KEY_PREFIX}${jobId}`, {
      jobId,
      pageId: String(pageId),
      pageTitle,
      status: 'failed',
      createdAt: new Date().toISOString(),
      error: submitResult.error,
      detail: submitResult.detail,
    });
    return {
      error: submitResult.error,
      detail: submitResult.detail,
    };
  }

  // Successfully submitted — store batchId с job state
  await kvs.set(`${JOB_KEY_PREFIX}${jobId}`, {
    jobId,
    pageId: String(pageId),
    pageTitle,
    status: 'batched',
    model,
    batchId: submitResult.batchId,
    batchStatus: submitResult.status, // 'in_progress'
    createdAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    expiresAt: submitResult.expiresAt,
  });

  console.log(
    `[startGeneration] jobId=${jobId} batchId=${submitResult.batchId} status=submitted`,
  );
  return {
    jobId,
    job_id: jobId,
    status: 'batched',
    batchId: submitResult.batchId,
  };
});

/**
 * Poll the status of an active generation job.
 * Returns the current job state stored в KVS.
 * Use after startGeneration; UI polls every 3-5 seconds.
 */
resolver.define('pollJobStatus', async ({ payload }) => {
  const jobId = payload?.jobId;
  if (!jobId) return { error: 'No job ID' };
  const job = await kvs.get(`${JOB_KEY_PREFIX}${jobId}`);
  if (!job) {
    return { error: 'not_found', detail: `Job ${jobId} not found (may have been purged)` };
  }

  // Terminal states return immediately
  if (job.status === 'completed' || job.status === 'failed') {
    return job;
  }

  // Active batch states — poll Anthropic for current status
  if (job.status === 'batched' && job.batchId) {
    const pollResult = await pollBatchStatus(job.batchId);

    if (pollResult.error) {
      console.error(
        `[pollJobStatus] jobId=${jobId} batchId=${job.batchId} poll failed: ${pollResult.error}`,
      );
      // Soft fail — return current job state; next poll cycle will retry.
      return {
        ...job,
        phase: `Batch poll error: ${pollResult.error}`,
      };
    }

    const counts = pollResult.requestCounts || {};
    const totalRequests =
      (counts.processing || 0) +
      (counts.succeeded || 0) +
      (counts.errored || 0) +
      (counts.canceled || 0) +
      (counts.expired || 0);

    // Batch still processing — return progress info
    if (pollResult.status === 'in_progress' || pollResult.status === 'canceling') {
      return {
        ...job,
        batchStatus: pollResult.status,
        phase: 'Anthropic processing batch...',
        progress: totalRequests > 0 ? (counts.succeeded || 0) / totalRequests : 0,
        request_counts: counts,
      };
    }

    // Batch ended — fetch + parse results
    if (pollResult.status === 'ended') {
      if (!pollResult.resultsUrl) {
        const failed = {
          ...job,
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: 'no_results_url',
          detail: 'Batch ended но Anthropic returned no results_url.',
        };
        await kvs.set(`${JOB_KEY_PREFIX}${jobId}`, failed);
        return failed;
      }

      const fetchResult = await fetchBatchResults(
        pollResult.resultsUrl,
        jobId, // custom_id ≡ jobId
      );

      if (fetchResult.error) {
        const failed = {
          ...job,
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: fetchResult.error,
          detail: fetchResult.detail,
          usage: fetchResult.usage || null,
        };
        await kvs.set(`${JOB_KEY_PREFIX}${jobId}`, failed);
        return failed;
      }

      // Success — compute cost + persist completed state
      const costEstimate = estimateCost(fetchResult.usage, fetchResult.model);
      const elapsedMs =
        Date.now() - new Date(job.submittedAt || job.createdAt).getTime();

      // Synthesize Epic от Confluence page title + spec summary.
      // v3 schema doesn't emit а top-level `epic` field; Option A push pattern
      // (1 Epic + N Stories) requires we manufacture it here. push_handler.js
      // reads `breakdown.epic.{summary, description}` directly.
      const breakdown = fetchResult.breakdown || {};
      const specSummary = breakdown?.metadata?.spec_summary || '';
      if (!breakdown.epic) {
        breakdown.epic = {
          summary: job.pageTitle || 'Spec Breakdown',
          description: specSummary,
        };
      }

      const completed = {
        ...job,
        status: 'completed',
        completedAt: new Date().toISOString(),
        breakdown,
        usage: fetchResult.usage,
        model: fetchResult.model,
        cost_estimate_usd: costEstimate.total_usd,
        cache_hit: costEstimate.cache_hit,
        elapsedMs,
        stop_reason: fetchResult.stop_reason,
        // Partial-recovery flag когато output hit max_tokens but features salvaged.
        ...(fetchResult.truncated
          ? { truncated: true, truncation_note: fetchResult.truncation_note }
          : {}),
      };
      await kvs.set(`${JOB_KEY_PREFIX}${jobId}`, completed);

      console.log(
        `[pollJobStatus] jobId=${jobId} batchId=${job.batchId} COMPLETED features=${(breakdown.features || []).length} elapsed=${elapsedMs}ms cost=$${costEstimate.total_usd.toFixed(4)}${fetchResult.truncated ? ' [TRUNCATED-PARTIAL]' : ''}`,
      );
      return completed;
    }

    // Unknown batch status
    return {
      ...job,
      batchStatus: pollResult.status,
      phase: `Unknown batch status: ${pollResult.status}`,
    };
  }

  // pending / unknown state — just return as-is
  return job;
});

/**
 * Fetch the completed breakdown result for a job.
 * Returns the breakdown object directly, OR error if job not complete.
 */
resolver.define('getResults', async ({ payload }) => {
  const jobId = payload?.jobId;
  if (!jobId) return { error: 'No job ID' };
  const job = await kvs.get(`${JOB_KEY_PREFIX}${jobId}`);
  if (!job) return { error: 'not_found' };
  if (job.status === 'failed') {
    return { error: job.error || 'failed', detail: job.detail || 'Job failed' };
  }
  if (job.status !== 'completed') {
    return { error: 'not_ready', detail: `Job status: ${job.status}` };
  }
  return {
    breakdown: job.breakdown,
    usage: job.usage,
    model: job.model,
    cost_estimate_usd: job.cost_estimate_usd,
    elapsedMs: job.elapsedMs,
  };
});

/**
 * Get the current/most-recent generation job state for a page.
 * Used by Dashboard к see whether page has been processed recently.
 *
 * NOTE: v3.0.0 does NOT maintain a global page→jobId index by default.
 * For now this returns 'idle' status. Future enhancement: index latest
 * jobId per page-id в KVS.
 */
resolver.define('getGenerationStatus', async ({ payload }) => {
  // TODO: implement page→latest-jobId index в KVS if Dashboard requires it
  return { status: 'idle' };
});

// ════════════════════════════════════════════════════════════
// JIRA PUSH — asUser() via async queue (Step 8 SHIPPED 2026-05-29)
// ════════════════════════════════════════════════════════════

/**
 * dryRun — synchronous pre-flight validation.
 * Verifies project exists + user has access via asUser(). Counts come от
 * the client-side computation done by App.js handlePush (no longer needs
 * roundtrip just для counts).
 *
 * v3.0.0 simplification: this е now primarily а "verify project + return
 * project metadata" check. Counts already в payload. Called from App.js
 * BEFORE actual push к fail fast on misconfigured project key.
 */
resolver.define('dryRun', async ({ payload }) => {
  const requestedKey = (payload?.project_key || '').trim().toUpperCase();
  const settings = await loadSettings();
  const projectKey = requestedKey || settings.defaultProjectKey || '';

  if (!projectKey) {
    return {
      error: 'no_project_key',
      detail:
        'No JIRA project key configured. Open Settings → Spec2Tickets and set Default JIRA Project Key.',
    };
  }

  // Verify project exists + user has access
  let response;
  try {
    response = await api
      .asUser()
      .requestJira(route`/rest/api/3/project/${projectKey}`);
  } catch (e) {
    return { error: 'jira_fetch_failed', detail: String(e?.message || e) };
  }
  if (response.status === 404) {
    return {
      error: 'project_not_found',
      detail: `JIRA project "${projectKey}" does not exist OR you don't have access.`,
    };
  }
  if (response.status === 403) {
    return {
      error: 'permission_denied',
      detail: `You lack permission к view project "${projectKey}".`,
    };
  }
  if (!response.ok) {
    const text = await response.text();
    return {
      error: `jira_${response.status}`,
      detail: text.substring(0, 300),
    };
  }
  const project = await response.json();
  return {
    ok: true,
    project_key: projectKey,
    project_name: project.name,
    project_id: project.id,
    // Counts pre-computed by App.js handlePush (client-side от edited breakdown)
    items: payload?.items || [],
    total_items: payload?.total_items || 0,
    total_epics: payload?.total_epics || 0,
    total_stories: payload?.total_stories || 0,
    total_subtasks: payload?.total_subtasks || 0,
    dependency_links: payload?.dependency_links || 0,
  };
});

/**
 * startPush — begin a chunked JIRA push session.
 *
 * ⚠ 2026-05-30: chunked-resolver pattern. JIRA bulk create е slow (~0.85
 * sec/issue); a single synchronous push of 200 items exceeds the 25-sec
 * resolver timeout. asUser() е unavailable in async consumers, so we chunk:
 * startPush does project lookup + Epic create + stores а session; the UI then
 * loops pushStep until done, each step doing one bounded JIRA batch.
 *
 * Returns { ok, sessionId, phase, totals } OR { error, detail }.
 */
resolver.define('startPush', async ({ payload }) => {
  const { breakdown, projectKey: payloadProjectKey } = payload || {};
  if (!breakdown) {
    return { error: 'no_breakdown', detail: 'No breakdown payload provided' };
  }

  const projectKey = await getProjectKey(payloadProjectKey);
  if (!projectKey) {
    return {
      error: 'no_project_key',
      detail:
        'No JIRA project key configured. Open Settings → Spec2Tickets and set Default JIRA Project Key.',
    };
  }

  // Optional admin-configured required custom fields (advanced).
  const settings = await loadSettings();
  const cfParse = parseRequiredCustomFields(settings.requiredCustomFieldsJson);
  const customFields = cfParse.ok ? cfParse.value : null;

  let outcome;
  try {
    outcome = await startPushSession(breakdown, projectKey, customFields);
  } catch (e) {
    console.error(`[startPush] threw: ${String(e?.message || e)}`);
    return { error: 'push_exception', detail: String(e?.message || e) };
  }
  if (!outcome.ok) {
    return { error: outcome.error, detail: outcome.detail };
  }
  return {
    session_id: outcome.sessionId,
    phase: outcome.phase,
    totals: outcome.totals,
    epic_key: outcome.epicKey,
    progress: 0,
  };
});

/**
 * pushStep — advance a push session by one bounded chunk. UI loops this until
 * { done: true }. Each call stays under the 25-sec resolver timeout.
 * Returns { done, phase, progress, counts } OR { done:true, result, partial }
 * OR { error, detail }.
 */
resolver.define('pushStep', async ({ payload }) => {
  const sessionId = payload?.sessionId;
  if (!sessionId) return { error: 'no_session', detail: 'No session id provided.' };

  let outcome;
  try {
    outcome = await pushSessionStep(sessionId);
  } catch (e) {
    console.error(`[pushStep] threw: ${String(e?.message || e)}`);
    return { error: 'push_exception', detail: String(e?.message || e) };
  }
  if (!outcome.ok) {
    return { error: outcome.error, detail: outcome.detail };
  }
  if (outcome.done) {
    return {
      done: true,
      status: 'completed',
      result: outcome.result,
      partial: outcome.partial || false,
    };
  }
  return {
    done: false,
    phase: outcome.phase,
    progress: outcome.progress,
    counts: outcome.counts,
  };
});

// ── Export handler bound к manifest function key "resolver" ──

export const handler = resolver.getDefinitions();
