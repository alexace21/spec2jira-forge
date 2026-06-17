/**
 * Spec2Tickets v3.0.0 — Anthropic API client (Forge resolver runtime).
 *
 * Forge-adapted version of prototype/anthropic_client.js. Differences:
 *   - Reads customer's Anthropic API key from Forge KVS secret storage
 *     (BYOK pattern — Phase 1 architecture per CLAUDE.md HANDOVER v3.0.0)
 *   - Returns Forge-friendly result shape consumable by resolver
 *   - Console.log/error wrap для Forge logs visibility
 *
 * Anthropic API verified surface (2026-05-27):
 *   - Endpoint: POST https://api.anthropic.com/v1/messages
 *   - anthropic-version header: 2023-06-01 (stable)
 *   - Sonnet 4.6: 1M context, 64k max output, $3/$15 per MTok
 *   - Haiku 4.5 fallback: 200k context, $1/$5 per MTok
 *   - Structured outputs: output_config.format = json_schema (GA on 4.6)
 *   - Prompt caching: cache_control.type = ephemeral (1024 token min on 4.6)
 *
 * Phase 1.5 empirical validation gate PASSED 2026-05-28:
 *   DocApproval: 22 features / 16 deps / 50 concerns / 151 sec / $0.14
 */

import { kvs } from '@forge/kvs';

import { BREAKDOWN_SCHEMA, SYSTEM_PROMPT, buildProjectContextSystemText, TEST_CASE_SCHEMA, TEST_CASE_SYSTEM_PROMPT, buildTestCaseUserPrompt, buildSpecSourceSystemText } from './prompts.js';
import { parseTestCaseResult } from './testcases.js';

// ── Constants ──────────────────────────────────────────────

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_BATCHES_URL = 'https://api.anthropic.com/v1/messages/batches';
const ANTHROPIC_VERSION = '2023-06-01';

export const MODEL_PRIMARY = 'claude-sonnet-4-6';
export const MODEL_FALLBACK = 'claude-haiku-4-5';

// Output cap for the per-Story test-case Sonnet batch. 8000 tokens: headroom for the
// richest/monster stories. Batch is async so the 25s resolver limit binds ONLY on the
// POLL resolver (fetch+parse of the already-complete JSONL), NOT on Sonnet's generation
// time — so a generous cap is free insurance against truncating a dense Story. The
// reactive sub-chunk was dropped (Sonnet single-call covers ~100% on validated dense
// stories), so this cap IS the worst-case safety margin. Engineering owns this cap (§4).
// 24000 (8000→16000→24000, 2026-06-06): per-story output is bounded by the 20-case CEILING (raised
// from 15 so a full decision-table story fits its whole matrix without compressing/hedging). This
// cap tracks the densest SINGLE story (≤20 verbose cases with long verbatim ac_text + §7 rule-
// derived cells ≈ ~20K worst case; 24K = headroom so the 20-case CEILING — not the token cap — is
// what bounds output, never a mid-case truncation), NOT the spec size (a bigger spec = more stories
// = more batch requests, each independently capped). CEILING, not a target — normal stories cost the
// same; tracks the case ceiling (raise together). Poll-scale: docs §5 #4 — chunked poll is the
// >50-dense-story follow-up.
export const TC_MAX_OUTPUT_TOKENS = 24000;

// Feed-side char cap for the shared SOURCE SPECIFICATION block injected into the test-case
// batch (one cache-write + N-1 cache-reads). Exported so the v6 cost PROJECTOR clamps the
// spec-source input identically to what submitTestCaseBatch actually sends — no estimate drift.
export const TC_SPEC_SOURCE_MAX_CHARS = 80000;

// Output cap. Sonnet 4.6's max output is 64K tokens — we use ALL of it for
// maximum headroom (it is a CEILING, not a target: a small spec still emits a
// small breakdown, so the larger cap costs nothing on normal specs). Sizing:
//   - CLM spec: 28K chars input → 9K output
//   - Spec2jira spec: 101K chars (~17K words) → ~32.5K output
// Empirically ~1.9K output tokens per 1K spec words. Real-world specs run
// ~3K–11K words → ~6K–21K output — comfortably under this cap; a single
// breakdown covers the largest specs seen in practice. A spec dense enough to
// STILL exceed 64K is salvaged (complete features recovered) and the user is
// warned via truncation_note (split the spec per the message). Batch pricing
// (~50% off) keeps the larger ceiling cheap.
const MAX_OUTPUT_TOKENS = 64000;

// KVS secret key для customer's BYOK Anthropic API key.
// Set via kvs.setSecret(KVS_API_KEY_NAME, ...) от Settings UI resolver.
// Retrieved via kvs.getSecret(KVS_API_KEY_NAME) on every generate call.
export const KVS_API_KEY_NAME = 'anthropic_api_key';

// ── BYOK key management ────────────────────────────────────

/**
 * [diag Phase 4, A4 — worst offender #2] Stored-key read WITH fault visibility.
 * Returns { key: string|null, fault: boolean }: fault=true ONLY when the secret
 * READ threw (a Forge storage fault — the key may still be saved); a clean read
 * that finds nothing is { key: null, fault: false } (the honest "never set").
 * Gate sites that map !key → not_configured MUST check fault FIRST, else a
 * storage fault is misdiagnosed as "no key" and support chases the wrong cause.
 */
export async function getStoredApiKeyInfo() {
  try {
    const key = await kvs.getSecret(KVS_API_KEY_NAME);
    return { key: key || null, fault: false };
  } catch (e) {
    console.warn(`[anthropic] kvs.getSecret failed: ${String(e?.message || e)}`);
    return { key: null, fault: true };
  }
}

/**
 * Retrieve customer's stored Anthropic API key от Forge KVS secret storage.
 * Returns null когато not configured (Settings UI not completed yet).
 * [diag Phase 4, A4] Delegates to getStoredApiKeyInfo — the fault flag collapses
 * to null here, so every caller that doesn't need the distinction is unchanged.
 */
export async function getStoredApiKey() {
  const { key } = await getStoredApiKeyInfo();
  return key;
}

// [diag Phase 4, A4] Honest user-facing text for the storage-FAULT case, shared by every
// gate site (testConnection below + the index.js resolvers import it) so the wording can
// never diverge. VERBATIM RULE: not_configured's existing text is UNCHANGED everywhere —
// this is a NEW code+detail pair, never a replacement.
export const KEY_STORAGE_FAILED_DETAIL =
  'We could not READ your stored Anthropic key from Forge storage (a storage fault — your key may still be saved). Try again in a moment; if it persists, contact support@spec2jira.com.';

/**
 * Persist customer's Anthropic API key to Forge KVS secret storage.
 * Called от saveSettings resolver когато admin updates the field в Settings UI.
 *
 * Forge KVS Secrets are:
 *   - Encrypted at rest (managed by Atlassian)
 *   - Per-installation scoped
 *   - Not readable от Custom UI directly (resolver-only access)
 *   - Persist across upgrades (unless customer uninstalls)
 *
 * @param {string} apiKey - customer's Anthropic API key (sk-ant-api03-...)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function setStoredApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    return { success: false, error: 'API key is required and must be a string' };
  }
  const trimmed = apiKey.trim();
  if (trimmed.length < 20) {
    return { success: false, error: 'API key appears too short — verify the value' };
  }
  if (!trimmed.startsWith('sk-ant-')) {
    return {
      success: false,
      error: 'API key must start with "sk-ant-" (Anthropic format)',
    };
  }
  try {
    await kvs.setSecret(KVS_API_KEY_NAME, trimmed);
    console.log('[anthropic] API key stored via kvs.setSecret');
    return { success: true };
  } catch (e) {
    console.error(`[anthropic] kvs.setSecret failed: ${String(e?.message || e)}`);
    return { success: false, error: `Storage failed: ${String(e?.message || e)}` };
  }
}

/**
 * Remove stored Anthropic API key от Forge KVS.
 * Customer admin may call this к rotate keys или disconnect Spec2Tickets.
 */
export async function clearStoredApiKey() {
  try {
    await kvs.deleteSecret(KVS_API_KEY_NAME);
    console.log('[anthropic] API key cleared');
    return { success: true };
  } catch (e) {
    console.error(`[anthropic] kvs.deleteSecret failed: ${String(e?.message || e)}`);
    return { success: false, error: String(e?.message || e) };
  }
}

// ── User prompt template ────────────────────────────────────

/**
 * Build the dynamic per-call user prompt. Not cached (different
 * spec content each invocation).
 */
export function buildUserPrompt(pageTitle, pageContent) {
  return `Extract a JIRA-ready breakdown от the following Confluence specification page.

# Source page: "${pageTitle}"

# Source content:

${pageContent}

# Output

Return the breakdown strictly conforming к the provided JSON schema. Apply the rules and Agile lens от your system instructions. Surface any structural ambiguity, risks, assumptions, or external dependencies в feature.concerns[] / spec_concerns[]. Self-assess confidence per feature (✓/⚠/✗). Use feature.category for natural grouping когато domain clusters emerge от the spec.`;
}

// ── Test connection (used by Settings UI test button) ──────

/**
 * Test the customer's Anthropic API key with a minimal call.
 * Used by Settings UI "Test Connection" button to verify the key
 * works BEFORE the customer tries а full breakdown.
 *
 * Returns {ok: true, model: '...'} on success, or
 * {ok: false, error: '...', detail: '...'} on failure.
 */
export async function testConnection(apiKey = null) {
  // [diag Phase 4, A4] When no override key was passed, read the stored key WITH fault
  // visibility: a thrown secret read surfaces as key_storage_failed (the honest cause),
  // never as not_configured. No recordDiagnostic here — this module has no resolver
  // context; the index.js testConnection resolver records op 'settings.key' when it
  // sees this error code.
  let key = apiKey;
  if (!key) {
    const info = await getStoredApiKeyInfo();
    if (!info.key && info.fault) {
      return { ok: false, error: 'key_storage_failed', detail: KEY_STORAGE_FAILED_DETAIL };
    }
    key = info.key;
  }
  if (!key) {
    return {
      ok: false,
      error: 'not_configured',
      detail: 'No API key configured. Enter your Anthropic API key in the Settings UI first.',
    };
  }

  // Minimal call — 5 token output, no caching, no schema
  let response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'X-Api-Key': key,
      },
      body: JSON.stringify({
        model: MODEL_PRIMARY,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Reply с the single word OK.' }],
      }),
    });
  } catch (e) {
    return {
      ok: false,
      error: 'network_failure',
      detail: `Fetch threw: ${String(e?.message || e)}`,
    };
  }

  if (response.status === 401) {
    return {
      ok: false,
      error: 'auth_rejected',
      detail: 'Anthropic rejected the API key. Verify validity at console.anthropic.com.',
    };
  }
  if (response.status === 402 || response.status === 429) {
    // 402 = insufficient credits, 429 = rate limit
    const text = await response.text();
    console.error(`[anthropic] testConnection HTTP ${response.status}: ${text.substring(0, 300)}`);
    return {
      ok: false,
      error: response.status === 402 ? 'insufficient_credits' : 'rate_limited',
      detail:
        response.status === 402
          ? 'Your Anthropic account has insufficient credits. Add credits at console.anthropic.com, then try again.'
          : 'Anthropic is rate-limiting requests right now. Please try again in a moment.',
    };
  }
  if (!response.ok) {
    const text = await response.text();
    console.error(`[anthropic] testConnection HTTP ${response.status}: ${text.substring(0, 300)}`);
    return {
      ok: false,
      error: `anthropic_${response.status}`,
      detail: 'The AI service returned an error. Please try again in a moment; if it persists, contact support@spec2jira.com.',
    };
  }

  const data = await response.json();
  return { ok: true, model: data.model || MODEL_PRIMARY };
}

// ── Cost estimator ──────────────────────────────────────────

/**
 * Estimate cost of a Claude call в USD от its token usage.
 * Used by tier enforcement + (v6) the customer-facing cost-transparency surface.
 *
 * Sonnet 4.6 pricing (verified 2026-05-27, standard/sync rates):
 *   Base input: $3.00 / MTok | Cache write 5m: $3.75 | Cache read: $0.30
 *   Output: $15.00
 *
 * Haiku 4.5 pricing:
 *   Base input: $1.00 / MTok | Cache write: $1.25 | Cache read: $0.10
 *   Output: $5.00
 *
 * ⭐ v6 — `opts.batch`: the Message Batches API is 50% of standard prices on ALL
 * token usage (confirmed Anthropic API ref). BOTH breakdown AND test-case generation
 * run via Batches, so their REAL cost is half what the sync rates above give. Pass
 * `{ batch: true }` for any batch-submitted usage (default false preserves the default-rate
 * math for any caller that omits the flag — byte-identical to pre-v6). Omitting it OVER-STATES
 * the bill 2×, which on a customer-facing echo is its own trust failure.
 */
export function estimateCost(usage, model = MODEL_PRIMARY, { batch = false } = {}) {
  const f = batch ? 0.5 : 1; // Batches API = 50% of standard prices, on every bucket
  const base = model.startsWith('claude-haiku')
    ? { input: 1.0, cache_write: 1.25, cache_read: 0.1, output: 5.0 }
    : { input: 3.0, cache_write: 3.75, cache_read: 0.3, output: 15.0 };
  const rates = {
    input: base.input * f,
    cache_write: base.cache_write * f,
    cache_read: base.cache_read * f,
    output: base.output * f,
  };

  const inputTokens = usage?.input_tokens || 0;
  const cacheCreateTokens = usage?.cache_creation_input_tokens || 0;
  const cacheReadTokens = usage?.cache_read_input_tokens || 0;
  const outputTokens = usage?.output_tokens || 0;

  const breakdown = {
    input_uncached: (inputTokens / 1_000_000) * rates.input,
    cache_write: (cacheCreateTokens / 1_000_000) * rates.cache_write,
    cache_read: (cacheReadTokens / 1_000_000) * rates.cache_read,
    output: (outputTokens / 1_000_000) * rates.output,
  };

  const total_usd = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

  return {
    total_usd,
    breakdown,
    cache_hit: cacheReadTokens > 0,
    tokens: {
      input_uncached: inputTokens,
      cache_creation: cacheCreateTokens,
      cache_read: cacheReadTokens,
      output: outputTokens,
    },
  };
}

/**
 * Null-safe sum of N Anthropic usage blocks into one (for the batch-wide post-run echo).
 * A test-case batch returns one usage block per Story (per request); the customer's bill
 * is the SUM across the run. Pure.
 */
export function sumUsage(usages) {
  const acc = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  for (const u of usages || []) {
    if (!u) continue;
    acc.input_tokens += u.input_tokens || 0;
    acc.output_tokens += u.output_tokens || 0;
    acc.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
    acc.cache_read_input_tokens += u.cache_read_input_tokens || 0;
  }
  return acc;
}

// ── v6 cost-transparency: pre-flight PROJECTOR for a test-case run ──────────────
// PURE, deterministic (POLICY §4) — projects an HONEST batch-priced cost RANGE from the
// breakdown shape BEFORE spending, so the customer consents against the worst realistic case.
// It does NOT call count_tokens: the bill-driving axis is OUTPUT (16× variance) which is
// UNCOUNTABLE ahead of time, so count_tokens would only make the cheap INPUT half precise
// while charging an extra BYOK call + Confirm-step latency — false confidence. char/4 heuristic
// on input + an AC-scaled output heuristic is the honest shape for a 16×-variance quantity.
//
// ⚠ The per-AC / per-story constants below are UNCALIBRATED heuristics (no production echo data
// yet). They MUST be calibrated against a handful of REAL echoed runs before relying on the
// EXPECTED figure — the post-run echo (sumUsage → estimateCost) is the ground truth that feeds
// that calibration. Until then the UPPER bound is deliberately generous so the echo rarely
// exceeds it (under-stating then echoing higher is a worse trust failure than over-stating).
const CHARS_PER_TOKEN = 4; // standard rough English approximation; exact counts come from the echo
const TC_USER_BASE_TOKENS = 500; // per-story user-prompt scaffold (buildTestCaseUserPrompt fixed parts)
const TC_INPUT_TOKENS_PER_AC = 120; // per-AC input text in the user block
const TC_OUTPUT_BASE_TOKENS = 400; // per-story output floor scaffold
const TC_OUTPUT_TOKENS_PER_AC = 700; // ~one scenario cluster of output per AC
const TC_OUTPUT_FLOOR_TOKENS = 600; // a story always emits at least this much
const TC_UPPER_MULTIPLIER = 2.6; // high-side factor on OUTPUT (the variance axis) for the "up to ~$X" bound (raised from 2.2 — the upper must genuinely bracket the right tail of a 16× quantity)
// Cap the EXPECTED per-story output strictly BELOW the ceiling so expected < upper ALWAYS holds
// (even an extreme-AC story never quotes the 24K ceiling as its expected value). The UPPER bound
// still reaches the full ceiling.
const TC_EXPECTED_OUTPUT_CAP = Math.floor(TC_MAX_OUTPUT_TOKENS * 0.85);

/**
 * Project a test-case run's cost. The shared system + source-spec block is cache-amortized
 * (1 cache-write + N-1 cache-reads — NOT N× full price, which would over-state ~10×). Output
 * is heuristic, clamped to the per-story TC_MAX_OUTPUT_TOKENS ceiling but NEVER quoting the
 * ceiling as the expected value. Returns batch-priced USD.
 * @param {object} args
 * @param {number[]} args.storyACcounts - per-story acceptance-criteria counts (length = story count)
 * @param {number} [args.specSourceChars] - chars of the cached SOURCE SPECIFICATION block (0 if none)
 * @param {string} [args.model]
 * @returns {{expected_usd:number, upper_usd:number, story_count:number, ac_total:number}}
 */
export function projectTestCaseCost({ storyACcounts = [], specSourceChars = 0, model = MODEL_PRIMARY } = {}) {
  const counts = Array.isArray(storyACcounts) ? storyACcounts : [];
  const N = counts.length;
  if (N === 0) return { expected_usd: 0, upper_usd: 0, story_count: 0, ac_total: 0 };

  const clampedSourceChars = Math.min(Math.max(0, Number(specSourceChars) || 0), TC_SPEC_SOURCE_MAX_CHARS);
  // Shared ephemeral block (system prompt + optional source spec): written ONCE, read N-1 times.
  const sharedTokens = Math.ceil((TEST_CASE_SYSTEM_PROMPT.length + clampedSourceChars) / CHARS_PER_TOKEN);

  let userInputTokens = 0;
  let expectedOutputTokens = 0;
  let upperOutputTokens = 0;
  let acTotal = 0;
  for (const raw of counts) {
    const ac = Math.max(0, Number(raw) || 0);
    acTotal += ac;
    userInputTokens += TC_USER_BASE_TOKENS + ac * TC_INPUT_TOKENS_PER_AC;
    const expOut = Math.min(
      Math.max(TC_OUTPUT_BASE_TOKENS + ac * TC_OUTPUT_TOKENS_PER_AC, TC_OUTPUT_FLOOR_TOKENS),
      TC_EXPECTED_OUTPUT_CAP, // expected stays below the ceiling so expected < upper always
    );
    expectedOutputTokens += expOut;
    // Upper reaches the full per-story ceiling; based on the UNCAPPED expected to bracket the tail.
    const uncappedExp = Math.max(TC_OUTPUT_BASE_TOKENS + ac * TC_OUTPUT_TOKENS_PER_AC, TC_OUTPUT_FLOOR_TOKENS);
    upperOutputTokens += Math.min(Math.round(uncappedExp * TC_UPPER_MULTIPLIER), TC_MAX_OUTPUT_TOKENS);
  }

  const sharedUsage = {
    cache_creation_input_tokens: sharedTokens, // written once (story 0)
    cache_read_input_tokens: sharedTokens * (N - 1), // read by the other N-1
    input_tokens: userInputTokens, // per-story user blocks, uncached
  };
  const expected = estimateCost({ ...sharedUsage, output_tokens: expectedOutputTokens }, model, { batch: true });
  const upper = estimateCost({ ...sharedUsage, output_tokens: upperOutputTokens }, model, { batch: true });
  return {
    expected_usd: expected.total_usd,
    upper_usd: upper.total_usd,
    story_count: N,
    ac_total: acTotal,
  };
}

// ── Message Batches API (async pattern для Forge 55-sec timeout) ──
//
// Forge async events have а 55-sec hard timeout per invocation. Anthropic
// generateBreakdown runs 60-150 sec (longer for big specs). Mismatch caused
// runaway retry loops + burned tokens (2026-05-29 incident).
//
// Solution: Anthropic Message Batches API — submit batch (~1-2 sec), poll
// status periodically (~1 sec each), fetch results when ready. Batch
// processing typically completes в 2-10 minutes; fits Forge polling UX.
// Bonus: batch pricing е 50% cheaper than sync API.
//
// API reference: https://docs.anthropic.com/en/api/creating-message-batches

/**
 * Assemble the `system` parameter for a breakdown call.
 *
 * Block 1 = the stable, shared SYSTEM_PROMPT (identical across every install →
 * maximal prompt-cache reuse on the customer's key). Block 2 (only when the admin
 * configured a Project Context) = the per-install house style. TWO cache
 * breakpoints (POLICY §12): editing Project Context invalidates only the small
 * second block; the large stable prompt keeps hitting cache. The model's handling
 * rule for block 2 lives inside SYSTEM_PROMPT (stable), so block 2 carries data only.
 *
 * @param {string} projectContext - admin's raw context text ('' when unconfigured)
 * @param {boolean} useCaching
 * @returns {string|Array<object>} a plain string (no context) or a content-block array
 */
function buildSystemContent(projectContext, useCaching) {
  const ctx = (projectContext || '').trim();

  if (!useCaching) {
    return ctx ? `${SYSTEM_PROMPT}\n\n${buildProjectContextSystemText(ctx)}` : SYSTEM_PROMPT;
  }

  const blocks = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];
  if (ctx) {
    blocks.push({
      type: 'text',
      text: buildProjectContextSystemText(ctx),
      cache_control: { type: 'ephemeral' },
    });
  }
  return blocks;
}

/**
 * Submit а 1-request batch to Anthropic. Returns batch_id immediately.
 *
 * @param {object} args - pageTitle, pageContent, model, useCaching, apiKeyOverride, projectContext (the breakdown generation inputs)
 * @param {string} args.customId - custom_id for the request (typically our jobId)
 * @param {string} [args.projectContext] - optional per-install house style injected as a 2nd cached system block
 * @returns {Promise<{batchId?, customId?, error?, detail?}>}
 */
export async function submitBreakdownBatch({
  pageTitle,
  pageContent,
  customId,
  model = MODEL_PRIMARY,
  useCaching = true,
  apiKeyOverride = null,
  projectContext = '',
}) {
  const apiKey = apiKeyOverride || (await getStoredApiKey());
  if (!apiKey) {
    return {
      error: 'not_configured',
      detail:
        'Anthropic API key not configured. Ask your Confluence admin to open Settings → Spec2Tickets and provide an Anthropic API key.',
    };
  }
  if (!pageContent || pageContent.trim().length < 50) {
    return {
      error: 'input_too_small',
      detail: `Page content is too short to extract meaningful breakdown (${pageContent?.length || 0} chars).`,
    };
  }
  if (!customId) {
    return { error: 'no_custom_id', detail: 'customId is required to identify the batch request.' };
  }

  const systemContent = buildSystemContent(projectContext, useCaching);

  const requestBody = {
    requests: [
      {
        custom_id: customId,
        params: {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: systemContent,
          messages: [
            {
              role: 'user',
              content: buildUserPrompt(pageTitle, pageContent),
            },
          ],
          output_config: {
            format: {
              type: 'json_schema',
              schema: BREAKDOWN_SCHEMA,
            },
          },
        },
      },
    ],
  };

  let response;
  try {
    response = await fetch(ANTHROPIC_BATCHES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (e) {
    console.error(`[anthropic-batch] submit fetch threw: ${String(e?.message || e)}`);
    return {
      error: 'network_failure',
      detail: `Fetch threw before response: ${String(e?.message || e)}`,
    };
  }

  if (response.status === 401) {
    return { error: 'auth_rejected', detail: 'Anthropic rejected the API key.' };
  }
  if (response.status === 402) {
    return { error: 'insufficient_credits', detail: 'Anthropic account has insufficient credits.' };
  }
  if (response.status === 429) {
    return { error: 'rate_limited', detail: 'Anthropic rate limit exceeded.' };
  }
  if (!response.ok) {
    const text = await response.text();
    console.warn(`[anthropic-batch] submit HTTP ${response.status}: ${text.substring(0, 500)}`);
    return { error: `anthropic_${response.status}`, detail: 'The AI service returned an error. Please try again in a moment; if it persists, contact support@spec2jira.com.' };
  }

  const data = await response.json();
  if (!data.id) {
    return { error: 'no_batch_id', detail: `Batch submit returned no id. Raw: ${JSON.stringify(data).substring(0, 300)}` };
  }

  console.log(
    `[anthropic-batch] submitted batchId=${data.id} customId=${customId} status=${data.processing_status}`,
  );
  return {
    batchId: data.id,
    customId,
    status: data.processing_status,
    createdAt: data.created_at,
    expiresAt: data.expires_at,
  };
}

/**
 * Poll status of an existing batch.
 *
 * @param {string} batchId
 * @param {string} [apiKeyOverride]
 * @returns {Promise<{status?, resultsUrl?, requestCounts?, endedAt?, error?, detail?}>}
 */
export async function pollBatchStatus(batchId, apiKeyOverride = null) {
  const apiKey = apiKeyOverride || (await getStoredApiKey());
  if (!apiKey) return { error: 'not_configured', detail: 'API key not configured.' };
  if (!batchId) return { error: 'no_batch_id', detail: 'batchId is required.' };

  let response;
  try {
    response = await fetch(`${ANTHROPIC_BATCHES_URL}/${batchId}`, {
      method: 'GET',
      headers: {
        'anthropic-version': ANTHROPIC_VERSION,
        'X-Api-Key': apiKey,
      },
    });
  } catch (e) {
    return { error: 'network_failure', detail: String(e?.message || e) };
  }

  if (response.status === 401) return { error: 'auth_rejected', detail: 'API key rejected.' };
  if (response.status === 404) return { error: 'batch_not_found', detail: `Batch ${batchId} not found.` };
  if (!response.ok) {
    const text = await response.text();
    console.error(`[anthropic-batch] poll HTTP ${response.status}: ${text.substring(0, 300)}`);
    return { error: `anthropic_${response.status}`, detail: 'The AI service returned an error. Please try again in a moment; if it persists, contact support@spec2jira.com.' };
  }

  const data = await response.json();
  return {
    status: data.processing_status, // 'in_progress' | 'canceling' | 'ended'
    resultsUrl: data.results_url || null,
    requestCounts: data.request_counts,
    endedAt: data.ended_at,
  };
}

/**
 * Fetch + parse batch results. Returns the single request's breakdown.
 * Caller MUST have verified pollBatchStatus returned status='ended' + resultsUrl.
 *
 * @param {string} resultsUrl
 * @param {string} customId
 * @param {string} [apiKeyOverride]
 * @returns {Promise<{breakdown?, usage?, model?, stop_reason?, error?, detail?}>}
 */
export async function fetchBatchResults(resultsUrl, customId, apiKeyOverride = null) {
  const apiKey = apiKeyOverride || (await getStoredApiKey());
  if (!apiKey) return { error: 'not_configured', detail: 'API key not configured.' };
  if (!resultsUrl) return { error: 'no_results_url', detail: 'resultsUrl is required.' };

  let response;
  try {
    response = await fetch(resultsUrl, {
      method: 'GET',
      headers: {
        'anthropic-version': ANTHROPIC_VERSION,
        'X-Api-Key': apiKey,
      },
    });
  } catch (e) {
    return { error: 'network_failure', detail: String(e?.message || e) };
  }

  if (!response.ok) {
    const text = await response.text();
    console.error(`[anthropic-batch] results fetch HTTP ${response.status}: ${text.substring(0, 300)}`);
    return { error: `results_fetch_${response.status}`, detail: "Couldn't retrieve the generated result — please try Generate again." };
  }

  // Results are JSONL — one line per request in the batch (we have 1).
  const rawText = await response.text();
  const lines = rawText.split('\n').filter((l) => l.trim().length > 0);
  let targetRow = null;
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (row.custom_id === customId) {
        targetRow = row;
        break;
      }
    } catch (_) {
      // skip malformed line
    }
  }
  if (!targetRow) {
    return {
      error: 'result_row_missing',
      detail: `Batch returned ${lines.length} rows but none with custom_id=${customId}.`,
    };
  }

  const result = targetRow.result || {};
  if (result.type !== 'succeeded') {
    return {
      error: `batch_request_${result.type || 'unknown'}`,
      detail:
        result.error?.error?.message ||
        result.error?.message ||
        JSON.stringify(result).substring(0, 300),
    };
  }

  const message = result.message;
  if (!message) {
    return { error: 'no_message', detail: 'Result row missing message field.' };
  }

  if (message.stop_reason === 'refusal') {
    return { error: 'refused', detail: 'Anthropic declined to process this page. Review the page content and try again.', usage: message.usage };
  }

  const truncated = message.stop_reason === 'max_tokens';
  const outputText = message.content?.[0]?.text || '';

  let breakdown;
  try {
    breakdown = JSON.parse(outputText);
  } catch (e) {
    // On truncation, structured output JSON е incomplete (unterminated) → parse
    // fails. Try к salvage the largest valid prefix so the user gets а partial
    // breakdown rather than nothing. If salvage also fails → honest truncated error.
    if (truncated) {
      const salvaged = salvageTruncatedBreakdown(outputText);
      if (salvaged && Array.isArray(salvaged.features) && salvaged.features.length > 0) {
        console.warn(
          `[anthropic-batch] customId=${customId} TRUNCATED at ${MAX_OUTPUT_TOKENS} tokens — salvaged ${salvaged.features.length} complete features от partial JSON.`,
        );
        return {
          breakdown: salvaged,
          usage: message.usage,
          model: message.model,
          stop_reason: message.stop_reason,
          truncated: true,
          truncation_note: `Output exceeded ${MAX_OUTPUT_TOKENS} tokens. Recovered ${salvaged.features.length} complete features; later features may be missing. Consider splitting the page.`,
        };
      }
      return {
        error: 'truncated',
        detail: `Output exceeded ${MAX_OUTPUT_TOKENS} tokens and could not be recovered. The page is too large for a single breakdown — split it into smaller pages (e.g., per major capability area) and run each separately.`,
        usage: message.usage,
      };
    }
    return {
      error: 'parse_failed',
      detail: `Structured output returned invalid JSON. Raw: ${outputText.substring(0, 300)}`,
      usage: message.usage,
    };
  }

  console.log(
    `[anthropic-batch] results customId=${customId} OK features=${(breakdown.features || []).length} input=${message.usage?.input_tokens || 0} output=${message.usage?.output_tokens || 0}${truncated ? ' (stop_reason=max_tokens but JSON parsed clean)' : ''}`,
  );

  return {
    breakdown,
    usage: message.usage,
    model: message.model,
    stop_reason: message.stop_reason,
    ...(truncated ? { truncated: true, truncation_note: `Output reached ${MAX_OUTPUT_TOKENS} tokens but parsed completely.` } : {}),
  };
}

// ── Test-case batch lifecycle (cloned from submitBreakdownBatch / pollBatchStatus /
//    fetchBatchResults). One Anthropic Batches API batch per startTestCaseGeneration
//    call, carrying N requests — one per Story (custom_id = story array index). The
//    batch transport is identical; what changes is the prompt, schema, and parse.
// ────────────────────────────────────────────────────────────────────────────────────

/**
 * Build the per-Story cross-feature dependency-context resolver for a test-gen batch.
 * Resolves a Story's IMMEDIATE edges (its dependsOn + the reverse "blocks") to the peer's
 * CURRENT name + one-line, keyed by the FROZEN _orig_name so a peer (or this Story) renamed
 * in the editor STILL resolves instead of being silently dropped as dangling (Task #4 #2,
 * mirrors the Review-display fix). dependencies[] stays frozen name strings; _orig_name
 * (frozen at adaptToLegacyShape) is the stable key; the LLM then reads the CURRENT name.
 * Self-edges + genuinely-dangling edges (a deleted peer) are still dropped. Pure function,
 * exported for the offline test. Returns (story) => {dependsOn, blocks}.
 * @param {Array<object>} peerStories the FULL breakdown feature list (NOT a 1-Story regen batch)
 */
export function buildDependencyResolver(peerStories) {
  const peers = Array.isArray(peerStories) ? peerStories : [];
  const oneLineOf = (st) => String((st && (st.user_story || st.description)) || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const keyOf = (st) => (st && ((typeof st._orig_name === 'string' && st._orig_name) || st.name)) || '';
  const summaryByName = new Map();    // CURRENT name → one-line
  const currentByOrig = new Map();    // FROZEN _orig_name → CURRENT name (resolve a frozen dep string)
  const dependentsByOrig = new Map(); // FROZEN dep string → [CURRENT dependent names]
  for (const st of peers) {
    if (st && typeof st.name === 'string' && st.name) summaryByName.set(st.name, oneLineOf(st));
    const k = keyOf(st);
    if (k && !currentByOrig.has(k)) currentByOrig.set(k, (st && st.name) || k); // first-match on a duplicate _orig_name
  }
  for (const st of peers) {
    const nm = st && st.name;
    if (typeof nm !== 'string' || !nm) continue;
    for (const dn of (Array.isArray(st.dependencies) ? st.dependencies : [])) {
      if (typeof dn !== 'string' || !dn) continue;
      if (!dependentsByOrig.has(dn)) dependentsByOrig.set(dn, []);
      dependentsByOrig.get(dn).push(nm);
    }
  }
  // Resolve names → {name: CURRENT, oneLine}. frozen=true first maps a FROZEN dep string to
  // its current name (currentByOrig) so a renamed peer resolves; a paraphrase/deleted peer
  // falls through summaryByName.has and is DROPPED (dangling). frozen=false = the names are
  // already current (the reverse "blocks" dependents). A self-edge is dropped.
  const resolve = (names, selfCurrentName, frozen) => {
    const out = [];
    for (const raw of (Array.isArray(names) ? names : [])) {
      if (typeof raw !== 'string' || !raw) continue;
      const cur = frozen ? (currentByOrig.get(raw) || raw) : raw;
      if (!cur || cur === selfCurrentName || !summaryByName.has(cur)) continue;
      out.push({ name: cur, oneLine: summaryByName.get(cur) || '' });
    }
    return out;
  };
  return (story) => ({
    dependsOn: resolve(story && story.dependencies, (story && story.name) || '', true),
    blocks: resolve(dependentsByOrig.get(keyOf(story)), (story && story.name) || '', false),
  });
}

/**
 * Submit an N-request test-case batch. One request per Story; custom_id = String(index).
 * The system block is SHARED across all N requests (ephemeral cache → one cache-write
 * cost, N-1 cache-reads). Each request's user block is per-Story (not cached).
 *
 * @param {object} args
 * @param {Array<object>} args.stories               the Story objects to generate for (bulk: all; regen: a 1-element batch)
 * @param {Array<object>} [args.allStories]          the FULL breakdown feature list — dependency peers (§8 #2) resolve against this, NOT the (possibly 1-element regen) `stories` batch; defaults to `stories`
 * @param {string[]} [args.sharedAcceptanceCriteria] from breakdown.shared_acceptance_criteria
 * @param {string} [args.specSummary]                from breakdown.metadata.spec_summary
 * @param {string} args.apiKey                       caller MUST pass the resolved key (Managed or BYOK)
 * @returns {Promise<{batchId?, status?, createdAt?, expiresAt?, error?, detail?}>}
 */
export async function submitTestCaseBatch({ stories, allStories, siblingNames, sharedAcceptanceCriteria, specConcerns, specSummary, specSourceText, apiKey }) {
  if (!apiKey) {
    return { error: 'not_configured', detail: 'Anthropic API key not configured.' };
  }
  if (!Array.isArray(stories) || stories.length === 0) {
    return { error: 'no_stories', detail: 'No stories to generate test cases for.' };
  }

  // Shared ephemeral system block — identical for all N requests → maximal cache reuse.
  const systemBlock = [{ type: 'text', text: TEST_CASE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

  // §8 fix (2026-06-06): when the breakdown's source page was snapshotted at generation, feed it
  // as a SECOND shared ephemeral-cached block (the SOURCE SPECIFICATION) so the model can assert
  // concrete threshold VALUES + one case per decision-table CELL (Rule 6). Shared across all N
  // requests → the page is a single cache-write + N-1 cache-reads (~10%), not N× full price.
  // Feed-side char cap (a pathological page can't blow the input budget; the snapshot was already
  // byte-capped at capture). Absent snapshot → omit the block → today's behaviour (backward-compat).
  // (TC_SPEC_SOURCE_MAX_CHARS is module-level + exported so the cost projector clamps identically.)
  const specSource = typeof specSourceText === 'string' ? specSourceText.trim().slice(0, TC_SPEC_SOURCE_MAX_CHARS) : '';
  const hasSpecSource = specSource.length > 0;
  if (hasSpecSource) {
    systemBlock.push({ type: 'text', text: buildSpecSourceSystemText(specSource), cache_control: { type: 'ephemeral' } });
  }

  // §8 scope fence. Callers MAY pass the full breakdown's story names — the single-story
  // regen path submits stories=[oneStory], which would otherwise starve the model of its
  // siblings (the worst §8 failure: it could test a sibling Story's behaviour). Default to
  // the batch's own story names for the bulk path.
  const resolvedSiblingNames = (Array.isArray(siblingNames) && siblingNames.length)
    ? siblingNames
    : stories.map((s) => s && (s.name || ''));

  // §8 (#2): resolve each Story's IMMEDIATE cross-feature dependency edges (NOT the transitive
  // graph) to the peer's one-line, for input-state / integration context. Resolve peers from
  // allStories (the FULL breakdown feature list) — NOT `stories`, which on the single-Story
  // regenerate path is a 1-element batch that would otherwise starve EVERY edge (§8 silent miss).
  const peerStories = (Array.isArray(allStories) && allStories.length) ? allStories : stories;
  // Resolve each Story's edges by the FROZEN _orig_name → CURRENT name, so a peer renamed in
  // the editor is NOT dropped as dangling (Task #4 #2). Built ONCE for the batch; pure +
  // offline-tested (prototype/test_dep_context.js).
  const dependencyContextFor = buildDependencyResolver(peerStories);

  const requests = stories.map((story, index) => ({
    custom_id: String(index),
    params: {
      model: MODEL_PRIMARY,
      max_tokens: TC_MAX_OUTPUT_TOKENS,
      system: systemBlock,
      messages: [
        {
          role: 'user',
          content: buildTestCaseUserPrompt({
            story,
            siblingNames: resolvedSiblingNames,
            sharedAcceptanceCriteria: sharedAcceptanceCriteria || [],
            specConcerns: specConcerns || [],
            specSummary: specSummary || '',
            category: story && story.category,
            hasSpecSource,
            dependencyContext: dependencyContextFor(story),
          }),
        },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          schema: TEST_CASE_SCHEMA,
        },
      },
    },
  }));

  const requestBody = { requests };

  let response;
  try {
    response = await fetch(ANTHROPIC_BATCHES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (e) {
    console.error(`[tc-batch] submit fetch threw: ${String(e?.message || e)}`);
    return { error: 'network_failure', detail: `Fetch threw before response: ${String(e?.message || e)}` };
  }

  if (response.status === 401) return { error: 'auth_rejected', detail: 'Anthropic rejected the API key.' };
  if (response.status === 402) return { error: 'insufficient_credits', detail: 'Anthropic account has insufficient credits.' };
  if (response.status === 429) return { error: 'rate_limited', detail: 'Anthropic rate limit exceeded.' };
  if (!response.ok) {
    const text = await response.text();
    console.warn(`[tc-batch] submit HTTP ${response.status}: ${text.substring(0, 500)}`);
    return { error: `anthropic_${response.status}`, detail: 'The AI service returned an error. Please try again in a moment; if it persists, contact support@spec2jira.com.' };
  }

  const data = await response.json();
  if (!data.id) {
    return { error: 'no_batch_id', detail: `Batch submit returned no id. Raw: ${JSON.stringify(data).substring(0, 300)}` };
  }

  console.log(`[tc-batch] submitted batchId=${data.id} stories=${stories.length} status=${data.processing_status}`);
  return {
    batchId: data.id,
    status: data.processing_status,
    createdAt: data.created_at,
    expiresAt: data.expires_at,
  };
}

/**
 * Poll the status of a test-case batch. This is an ALIAS of pollBatchStatus — the
 * endpoint and response shape are identical; we expose a named export so callers
 * in index.js never import the breakdown-named function for test-case work.
 *
 * @param {string} batchId
 * @param {string} [apiKeyOverride]
 * @returns {Promise<{status?, resultsUrl?, requestCounts?, endedAt?, error?, detail?}>}
 */
export const pollTestCaseBatch = pollBatchStatus;

/**
 * Fetch + parse test-case batch results. Scans ALL N JSONL rows (unlike fetchBatchResults
 * which looks for one custom_id). Non-succeeded rows store an explicit error sentinel.
 * The perStory array is SORTED by storyIdx so callers can index into it safely.
 *
 * @param {string} resultsUrl
 * @param {Array<{idx:number,name:string}>} stampedStories   the tcjob.stampedStories list
 * @param {string} apiKey                                    caller MUST pass the resolved key
 * @returns {Promise<{perStory:[{storyIdx,result?,coverage?,error?,detail?}], error?, detail?}>}
 */
export async function fetchTestCaseResults(resultsUrl, stampedStories, apiKey) {
  if (!apiKey) return { error: 'not_configured', detail: 'API key not configured.' };
  if (!resultsUrl) return { error: 'no_results_url', detail: 'resultsUrl is required.' };

  let response;
  try {
    response = await fetch(resultsUrl, {
      method: 'GET',
      headers: {
        'anthropic-version': ANTHROPIC_VERSION,
        'X-Api-Key': apiKey,
      },
    });
  } catch (e) {
    return { error: 'network_failure', detail: String(e?.message || e) };
  }

  if (!response.ok) {
    const text = await response.text();
    console.error(`[tc-batch] results fetch HTTP ${response.status}: ${text.substring(0, 300)}`);
    return { error: `results_fetch_${response.status}`, detail: "Couldn't retrieve the generated test cases — please try generating again." };
  }

  const rawText = await response.text();
  const lines = rawText.split('\n').filter((l) => l.trim().length > 0);

  // Parse ALL N JSONL rows — unlike the breakdown (1 row), we scan the whole file.
  // Key: custom_id → Integer(idx); per-row lookup is O(1) via a Map.
  const rowsByIdx = new Map();
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      const idx = parseInt(row.custom_id, 10);
      if (!Number.isNaN(idx)) rowsByIdx.set(idx, row);
    } catch (_) {
      // skip malformed JSONL line
    }
  }

  const perStory = [];
  const stamped = Array.isArray(stampedStories) ? stampedStories : [];

  for (const stamped_entry of stamped) {
    const storyIdx = stamped_entry.idx;
    const row = rowsByIdx.get(storyIdx);

    if (!row) {
      // Row entirely missing from JSONL — explicit error sentinel (#3: never drop)
      perStory.push({ storyIdx, error: 'row_missing', detail: `No JSONL row for story index ${storyIdx}.` });
      continue;
    }

    const result = row.result || {};
    if (result.type !== 'succeeded') {
      // Errored/expired/canceled — explicit error sentinel (#3)
      perStory.push({
        storyIdx,
        error: `batch_request_${result.type || 'unknown'}`,
        detail: result.error?.error?.message || result.error?.message || JSON.stringify(result).substring(0, 300),
      });
      continue;
    }

    const message = result.message;
    if (!message) {
      perStory.push({ storyIdx, error: 'no_message', detail: 'Result row missing message field.' });
      continue;
    }

    // ⭐ v6 cost-transparency: a message-bearing row consumed tokens even when its OUTPUT is
    // unusable (refusal / max_tokens truncation / parse failure / coverage reject). Capture usage
    // ONCE here and attach it to EVERY downstream push — dropping it on the error branches
    // under-counts the echo, and the costliest failure (max_tokens) is the one most worth counting.
    const usage = message.usage || null;

    if (message.stop_reason === 'refusal') {
      perStory.push({ storyIdx, error: 'refused', detail: 'Anthropic declined to process this story.', usage });
      continue;
    }

    // [diag Phase 4, A5 — worst offender #6] The stop_reason guard the breakdown path has
    // always had (fetchBatchResults) but the TC path lacked. A story that hit the
    // TC_MAX_OUTPUT_TOKENS cap used to be misfiled: JSON closed by luck → persisted as a
    // CLEAN success (silently incomplete cases); JSON unterminated → 'parse_failed' (wrong
    // cause). Honest split: parse OK + max_tokens → keep the cases, mark `truncated: true`
    // (additive — the poll resolvers thread it onto the stored per-story value and
    // pollTestCaseStatus aggregates a truncation_salvaged record); parse FAIL + max_tokens
    // → sentinel { error: 'truncated' } ('parse_failed' stays for NON-truncated failures).
    const truncated = message.stop_reason === 'max_tokens';

    const outputText = message.content?.[0]?.text || '';
    let parsed;
    try {
      parsed = typeof outputText === 'string' ? JSON.parse(outputText) : outputText;
    } catch (_) {
      // Privacy ("Log End-User Data: No"): the raw model output is content-derived — never
      // persist it (this detail is written to KVS). Keep the failure signal generic.
      perStory.push(
        truncated
          ? { storyIdx, error: 'truncated', detail: `Output for story index ${storyIdx} hit the ${TC_MAX_OUTPUT_TOKENS}-token cap mid-JSON and could not be recovered. Regenerate this story.`, usage }
          : { storyIdx, error: 'parse_failed', detail: `Invalid JSON returned for story index ${storyIdx} (raw output omitted for privacy).`, usage },
      );
      continue;
    }

    // INVARIANT: stampedStories carries {idx, name, acceptance_criteria} (the lean coverage
    // inputs, stamped by start/regen at submit time — mitigation #7) so coverage is computed
    // against the FROZEN ACs the model actually saw, surviving any editor edit mid-batch.
    const storyRef = { name: stamped_entry.name, acceptance_criteria: stamped_entry.acceptance_criteria || [] };

    const parseOutcome = parseTestCaseResult(parsed, storyRef);
    if (parseOutcome.error) {
      perStory.push({ storyIdx, error: parseOutcome.error, detail: parseOutcome.detail, usage });
    } else {
      // [diag Phase 4, A5] truncated-but-parsed: the cases are KEPT (the pure coverage strip
      // stays authoritative) with an honest additive flag — never a silent clean success.
      // ⭐ v6 cost-transparency: carry the per-request usage (input/output/cache tokens) so the
      // poll resolver can sum a batch-wide total and price the EXACT post-run echo (captured once above).
      perStory.push({ storyIdx, result: parseOutcome.result, coverage: parseOutcome.coverage, usage, ...(truncated ? { truncated: true } : {}) });
    }
  }

  // Sort by storyIdx (JSONL order is not guaranteed — §design §2).
  perStory.sort((a, b) => a.storyIdx - b.storyIdx);

  // [diag Phase 4, A5] truncated count surfaced in the dev log (the record lands at the poll resolver).
  const truncatedOk = perStory.filter((s) => !s.error && s.truncated).length;
  console.log(`[tc-batch] results parsed: ${perStory.length} stories, ${perStory.filter((s) => !s.error).length} OK, ${perStory.filter((s) => s.error).length} errors${truncatedOk ? `, ${truncatedOk} truncated-salvaged` : ''}`);
  return { perStory };
}

// ── Dependency-cycle resolution (tiny sync call) ───────────────────────
// Detection is a pure function (src/graph.js). Choosing WHICH edge of a cycle to
// cut is meaning-reading (§4) — it needs to understand the features — so it is a
// small, focused, universal LLM call, bounded by the caller (the 25-sec resolver
// budget). Structured output → a deterministic { cut_from, cut_to, ... } verdict.

const CYCLE_RESOLVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cut_from', 'cut_to', 'uncertain', 'reason'],
  properties: {
    cut_from: { type: 'string' }, // the dependent feature
    cut_to: { type: 'string' }, // the dependency to remove from cut_from.dependencies
    uncertain: { type: 'boolean' }, // true only when both directions are hard prerequisites
    reason: { type: 'string' },
  },
};

const CYCLE_RESOLVE_SYSTEM = `You are a senior delivery architect resolving a circular dependency in a sprint dependency graph.

RULES (cost asymmetry): a silent circular dependency BREAKS downstream sprint-sequencing tools and creates false confidence — that is the expensive error. Cutting a slightly-wrong edge only creates a mildly off ordering a human can fix. So when one edge is clearly the softer coupling, cut it confidently; set uncertain=true ONLY when both directions are genuine hard prerequisites (a real design conflict the spec author must resolve).

DECISIVE TEST (holds across any domain, vendor, or technology): for each edge "A depends on B", ask — is B a HARD prerequisite (A cannot be built, tested, or function at all until B exists), or a SOFT coupling (A can be built first against a stub / mock / agreed contract, or the dependency is merely preferred ordering)? Cut the SOFTEST edge so the graph becomes acyclic. The true blocker is the one whose consumer literally cannot operate without the producer's output.

OUTPUT CONTRACT: cut_from depends on cut_to; removing cut_to from cut_from's dependency list is what breaks the cycle. Both names MUST be taken verbatim from the cycle given to you.

WORKED EXAMPLE (shows the reasoning, not a pattern to match):
Cycle: "Subscription Management" depends on "Payment Processing"; "Payment Processing" depends on "Subscription Management".
You cannot charge a subscription without payment rails (Subscription→Payment is HARD). Payment can be built and tested against a stubbed plan/price contract (Payment→Subscription is SOFT). → cut_from = "Payment Processing", cut_to = "Subscription Management", uncertain = false.`;

/**
 * Resolve one dependency cycle: decide which (soft) edge to cut.
 *
 * @param {{cyclePath: string[], features: Array<object>, apiKey: string, model?: string}} args
 * @returns {Promise<{cut_from?, cut_to?, uncertain?, reason?, error?, detail?}>}
 */
export async function resolveDependencyCycle({ cyclePath, features, apiKey, model }) {
  if (!apiKey) return { error: 'not_configured' };
  if (!Array.isArray(cyclePath) || cyclePath.length < 2) return { error: 'bad_cycle' };

  const ctx = (features || [])
    .map(
      (f) =>
        `- ${f.name}: ${String(f.user_story || f.description || '').slice(0, 240)} [depends on: ${(f.dependencies || []).join(', ') || 'none'}]`,
    )
    .join('\n');

  const userPrompt = `Circular dependency to resolve (each "X → Y" means X depends on Y):
${cyclePath.join(' → ')} → ${cyclePath[0]}

Features involved:
${ctx}

Identify the single softest edge to cut so the cycle is broken.`;

  let response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        model: model || MODEL_PRIMARY,
        max_tokens: 500,
        system: CYCLE_RESOLVE_SYSTEM,
        messages: [{ role: 'user', content: userPrompt }],
        output_config: { format: { type: 'json_schema', schema: CYCLE_RESOLVE_SCHEMA } },
      }),
    });
  } catch (e) {
    return { error: 'network_failure', detail: String(e?.message || e) };
  }

  if (!response.ok) {
    return { error: `http_${response.status}`, detail: String(await response.text()).slice(0, 200) };
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    return { error: 'parse_failed', detail: String(e?.message || e) };
  }

  const text = data?.content?.[0]?.text || '';
  try {
    return JSON.parse(text);
  } catch (_) {
    return { error: 'parse_failed', detail: String(text).slice(0, 200) };
  }
}

// ── Project Context distillation (tiny sync helper for Settings) ────────────────
// A setup-time convenience: condense a user's raw paste (e.g. a long Confluence
// page) or rough notes into a concise, bounded PROJECT CONTEXT profile. Distilling
// meaning from free text is meaning-reading (§4) → an LLM call. It is small + fast
// (well under the 25-sec resolver budget), runs on the customer's BYOK key, and does
// NOT consume breakdown quota (it is not a generation). Output is bounded; the user
// reviews/edits before saving (human-in-the-loop). The content is NEVER logged.

export const DISTILL_MAX_INPUT_CHARS = 40000; // ~10K tokens — generous for a pasted page; bounds latency + cost (§12)

// ── 6-call CHUNKED distill (replaces the single depth-first Haiku call) ──────────
//
// WHY chunked: a single Haiku call went depth-first and DROPPED whole categories on
// rich inputs (it exhausted its budget elaborating the first few terms and never
// reached Personas/Tech/Conventions — the silent, expensive miss). The fix, validated
// in an 8/8-vs-5/8 empirical bake-off on a real Haiku model (2026-06-02): 6 sequential
// FOCUSED calls, each extracting ONE category from the SAME full input. Each call is
// small (~3-13s, well under the 25-sec resolver limit per gotcha #4) and gets its own
// generous per-category token budget, so no category is starved by another. The UI
// loops one resolver invocation per category (mirroring the chunked JIRA push:
// startPushSession/pushSessionStep), accumulating sections in KVS, merged at the end.
// trimToBudget enforces the final char bound; the content is NEVER logged.

// Shared system preamble — prepended to EVERY category call (system = this + "\n\n" +
// category.instruction). Carries the cross-category discipline (decisive test, no
// invention, plain-text output) so each focused call still applies the durable-vs-scope
// lens. The per-category instruction adds only what THAT category extracts.
const DISTILL_SHARED_PREAMBLE = `You extract ONE category for a reusable PROJECT CONTEXT profile — a vocabulary/reference card later given to an automated spec-to-backlog engine so it speaks the team's language. It is REFERENCE only: NO requirements, NO scope, NO acceptance criteria.
Capture each item as NAME + ROLE (one short clause) plus, ONLY when one exists, the single CRITICAL DISAMBIGUATING RULE the engine could not infer — a scope carve-out (applies to X, never Y), a unit trap / conversion factor, an abbreviation collision (one acronym, two meanings), or a lineage/ownership boundary.
DECISIVE TEST: keep a fact only if it would still be true in a DIFFERENT spec of this same project (the domain, regulation, vocabulary, personas, conventions, systems, standing rules). DROP anything THIS spec merely chose (a cut-point, deadline, count, feature, step). Strip a spec-CHOSEN threshold; KEEP a number that IS the durable rule (a conversion factor, a fixed constant the spec does not restate).
NEVER invent facts not in the input. Plain text only — NO markdown (no #, **, backticks, or - / * bullets). Output ONLY your one labelled line(s); no preamble, no closing remarks, no other labels.
For any STANDARDIZED metric the domain refers to by name — a score, index, scale, rating, classification, code, grade, or tier (whatever the field calls it) — keep its NAME, a one-clause ROLE, and at most one critical disambiguating rule; COMPRESS AWAY the component criteria, sub-variables, point values, and cut-points it is computed from (the source document already carries those, and the downstream engine never needs them to name work).`;

// The 6 categories, IN ORDER. Each call: system = DISTILL_SHARED_PREAMBLE + "\n\n" +
// instruction; user = userAsk + the clipped input; max_tokens = maxTokens. The 6-call
// CHUNKED STRUCTURE is the bake-off-validated win (8/8 vs 5/8) — that is what transfers.
// The instructions are DOMAIN-AGNOSTIC by design (POLICY §5: abstract decisive-tests +
// distinct-lesson few-shots, never a domain corpus / answer key); each says what KIND of
// thing to extract so the pipeline works for ANY domain (CRM, logistics, fintech, clinical).
export const DISTILL_CATEGORIES = [
  {
    key: 'domain',
    label: 'Domain',
    maxTokens: 500,
    instruction: `Extract the DOMAIN section ONLY (3-5 sentences, end cleanly — never stop mid-sentence). Output starts with "Domain:". Give: the domain and what the system does, in one breath. Then fold in, ONLY where the input actually establishes them, the durable cross-cutting facts as short clauses — (a) any design tension the input EXPLICITLY names as deliberate and ongoing: state the two poles in the input's own words and that the source treats it as an intentional, unresolved balance — nothing more; do NOT assert what the engine must or must not do with it, and do NOT add a tension the input does not name; (b) any durable CROSS-CUTTING fact the input EXPLICITLY states that shapes everything downstream — e.g. that several mechanisms run in parallel and are each independently configurable: state it plainly in the input's OWN terms; do NOT add editorial the input does not state (such as that they 'must all be honoured' or are 'never collapsed' / 'never override one another') — restate only what the source asserts. Capture only the tensions/facts the input genuinely states; if the input establishes none, give just the domain and what the system does. Do NOT list individual terms, personas, systems, regulations, or rules here — those belong to their own sections. Keep it tight.`,
    userAsk: `Produce the Domain section only — concise, ending on a complete sentence.`,
  },
  {
    key: 'glossary',
    label: 'Glossary',
    maxTokens: 800,
    instruction: `Extract the GLOSSARY ONLY. Output starts with "Glossary:". List the load-bearing domain terms, named entities, and named standardized metrics, each as one short line: NAME = one-clause role + (where one exists) the ONE critical disambiguating rule the engine could not infer. Do NOT list human roles/personas here — they are captured in a separate Personas section; cover only terms, entities, and metrics.

ABSOLUTE COMPRESSION RULE — this is the core of the job. Whenever the input refers to a STANDARDIZED metric by name — a score, index, scale, rating, classification, grade, code, or tier (whatever the domain calls it) — you are FORBIDDEN from reproducing the criteria it is computed from. Do NOT write the list of inputs/sub-variables it aggregates, the per-input weights or point values, the "≥N of …" trigger phrasing, the sub-scores, axes, dimensions, or subsystems it SPANS (e.g. "across six organ systems", "on each of N sub-dimensions"), its trigger or confirmation cut-point ("score >=N", "any single parameter at N", "aggregate change >=N for confirmation"), the threshold/cut-point numbers, or its internal scale structure. Those are reference criteria the source document already carries; the downstream engine never needs them to name a feature, and they exhaust the budget. Keep ONLY the metric's NAME, a one-clause ROLE, and at most one critical rule (when one exists). The same compression applies to any bundle, checklist, or protocol the input names: name it and give its role — never list its constituent elements as criteria.

This is the SINGLE most important rule of this section: a glossary line that reproduces a metric's component variables, sub-scores, weights, or cut-point numbers is WRONG — even when they appear verbatim in the source. Compress to name + role + one critical rule. Four illustrations show the SAME lesson across DIFFERENT fields (they are illustrations of the lesson, NOT a list of terms to match):
  - A non-clinical standardized metric: WRONG: "Risk Grade = weighted sum of credit-bureau score (35%), debt-to-income (30%), tenure (20%), prior defaults (15%); A/B/C/D/F bands." RIGHT: "Risk Grade = standardized creditworthiness tier driving the approval path; computed at application and re-pulled on material change, so a grade can move after submission."
  - A clinical score (the SAME lesson — strip the criteria): WRONG: "SIRS = >=2 of temp <36 or >38, HR >90, RR >20, WBC abnormal; high sensitivity." RIGHT: "SIRS = inflammatory-response screen; high sensitivity / low specificity, superseded by a newer standard but still used at one site by local preference."
  - A durable UNIT TRAP with a conversion CONSTANT (keep the constant; drop spec-chosen thresholds): "Lactate = blood lactate measure; UNIT TRAP — one legacy feed reports mg/dL, normalized at ingestion via mg/dL × 0.111 = mmol/L (keep the factor; the alert thresholds are spec-chosen, omit them)."
  - A COMPOSITE score that spans several axes (do NOT enumerate the axes or the confirmation cut-point): WRONG: "Severity Index = 0-4 on each of six sub-dimensions (A, B, C, D, E, F); confirmed when the aggregate change is >=2." RIGHT: "Severity Index = composite severity rating used for confirmation; computed when downstream data lands, so it can re-grade an item retrospectively."

Also preserve, when present: any ABBREVIATION COLLISION where one acronym means two different things in this domain — keep BOTH expansions and note any retirement/scope boundary so they are never conflated. Cover the genuinely load-bearing terms the input establishes — as many or as few as exist; do not pad to a target count, do not invent terms, and do not stop early while real terms remain. One terse line each.`,
    userAsk: `Produce the Glossary section only, compressing every named standardized metric to name + role + one critical rule. Do not reproduce any metric's component criteria, weights, or cut-points.`,
  },
  {
    key: 'personas',
    label: 'Personas',
    maxTokens: 450,
    instruction: `Extract the PERSONAS ONLY. Output is a single line starting "Personas:" then EVERY distinct human ROLE named in the input, by its real name, semicolon-separated, each with one short role clause. Include operational staff, escalation/approval roles, any named leadership roles (give the role plus the area each owns), and any specialist or compliance/data-protection role the input names. Do not merge two distinct roles into one; do not stop early; do not invent roles the input does not name. Emit exactly as many as the input establishes.`,
    userAsk: `Produce the Personas section only — every distinct named role.`,
  },
  {
    key: 'tech',
    label: 'Tech',
    maxTokens: 500,
    instruction: `Extract the TECH / SYSTEMS ONLY. Output starts with "Tech:". List EVERY named external system, product, vendor, platform, service, or integration in the input by its REAL proper name, semicolon-separated, and give EACH a short role clause in parentheses (what it is / what it feeds or consumes). Include every named source system, data feed, downstream consumer, third-party service, and reporting or regulatory interface the input names. Never replace a proper product/system name with a generic word, and never omit one. Do not infer or assume systems the input does not name. Exclude glossary terms, personas, and step-by-step data rates.`,
    userAsk: `Produce the Tech section only — every named system/product/vendor by its real name, each with a one-clause role.`,
  },
  {
    key: 'regulatory',
    label: 'Regulatory',
    maxTokens: 400,
    instruction: `Extract the REGULATORY ONLY. Output starts with "Regulatory:". In one tight set of clauses, capture only what the input establishes: any product/regulatory CLASSIFICATION framing the system falls under (state it as the input frames it — do not assume a regime); the DATA-PROTECTION posture (access controls on sensitive/audit data, and any named data-protection or subject-rights role/process); any STATUTORY RETENTION rule (state the durable rule, KEEPING any fixed constant such as a mandated retention period); and the regulator or authority the system reports compliance to. Keep durable legal/compliance constants; drop procedural detail. If the input establishes no regulatory framing, output "Regulatory: none stated in the input."`,
    userAsk: `Produce the Regulatory section only.`,
  },
  {
    key: 'conventions',
    label: 'Conventions',
    maxTokens: 800,
    instruction: `Extract the CONVENTIONS ONLY — the durable DELIVERY conventions and the STANDING counterintuitive rules the engine must always respect (NOT one-off procedure, timers, or data-rates). Output starts with "Conventions:". Do NOT repeat any term, score, metric, system, or persona already covered by the Glossary / Tech / Personas sections. You are EXTRACTING + COMPRESSING what the input states — you NEVER author a rule, invariant, or emphasis the input does not state. Capture, compactly, only what the input establishes:
(1) STRUCTURAL DELIVERY CONVENTIONS — HIGHEST-PRIORITY to keep because they cannot be recovered from the feature spec alone: how work items are typed (epic / story / subtask definitions and the distinction between them), component and label taxonomy, any explicit ANTI-TEMPLATING guidance (e.g. "subtasks should reflect the actual work the story needs, not a fixed template" — capture such guidance verbatim, it is the single most valuable convention), and team composition / how the team treats a generated breakdown. THEN house-style that persists across specs: working languages, operational terms used verbatim in a particular language, spelling/naming conventions, and fixed state/status vocabularies. Do NOT reproduce canonical reference-data tables (numeric thresholds, band ranges, pricing parameters, time windows) — those live in the spec, not the context card. Prefer content UNIQUE to this project's conventions over anything the spec already carries.
(2) STANDING COUNTERINTUITIVE rules — the rules most likely to be lost and cause silent errors downstream. DECISIVE TEST before emitting ANY rule: can you point to a specific sentence in the input that asserts this exact rule? If you cannot, DO NOT emit it — a rule inferred or generalized from a nearby pattern is FABRICATION (the most dangerous distill error: it can contradict the very spec this context accompanies). Emit ONLY rules the input states explicitly, in the input's own terms; if the input contains no rule of a given kind below, omit that kind entirely — never fill a slot to be complete:
  - a rule that REVERSES a default or a prior behaviour — something that, against the obvious expectation, is NOT auto-undone, NOT auto-cancelled, or still applies despite a later contradicting signal;
  - a DUAL-CONTROL or second-approval requirement (an action that needs a second person to confirm or co-sign);
  - a SURFACE-vs-BLOCK policy (the system warns/cautions and logs but does NOT hard-block, leaving final judgment to a human);
  - a LINEAGE / SUPERSESSION carve-out (this version replaces a prior one only IN PART, with specific elements deliberately RETAINED — never flatten to "replaces X").
State each rule the input actually contains as one short clause. Do not generalize a rule to an adjacent case the input does not mention.`,
    userAsk: `Produce the Conventions section only — durable house-style plus any standing counterintuitive or lineage/supersession rules the input establishes.`,
  },
];

/**
 * Deterministically trim text to a hard character budget at a CLEAN boundary so the
 * result never ends mid-word or mid-sentence (no meaningless half-finished fragment).
 * Pure function — engineering's guarantee of the bound (POLICY §4: the model owns
 * compression, we own the deterministic limit). Prefers the latest line break (a
 * profile is one point per line), then a sentence end, then a word break; hard-cut
 * only if none of those exists in the kept half (pathological separator-less text).
 */
export function trimToBudget(text, max) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const nl = slice.lastIndexOf('\n');
  if (nl >= max * 0.5) return slice.slice(0, nl).trimEnd(); // drop the partial trailing line
  const sentence = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('! '),
  );
  if (sentence >= max * 0.5) return slice.slice(0, sentence + 1).trimEnd(); // keep terminal punctuation
  const sp = slice.lastIndexOf(' ');
  if (sp >= max * 0.5) return slice.slice(0, sp).trimEnd(); // never mid-word
  return slice.trimEnd();
}

/**
 * Run ONE focused distill call for a single category. The whole 6-call pipeline is
 * orchestrated by the resolvers (startDistillSession/distillStep, mirroring the chunked
 * JIRA push) — this is the per-category unit of work. system = the shared preamble + the
 * category's instruction; user = the category's userAsk + the (clipped) full input. Runs
 * on HAIKU (not Sonnet) + SYNC (not the async Batches API): a focused call is small
 * (~3-13s) and fits comfortably inside the 25-sec resolver budget (gotcha #4), where sync
 * Sonnet on the full input exceeded it and the Batches API was too slow (~11 min) for an
 * interactive button. The result is a strong DRAFT — the user reviews + edits before save
 * (human-in-the-loop, §7). The content is NEVER logged (keeps "Log End-User Data: No" true).
 *
 * @param {{text:string, category:object, apiKey:string, model?:string}} args
 *   category = one DISTILL_CATEGORIES entry { key, label, maxTokens, instruction, userAsk }
 * @returns {Promise<{section?:string, truncated?:boolean, error?:string, detail?:string}>}
 */
export async function distillCategory({ text, category, apiKey, model }) {
  if (!apiKey) return { error: 'not_configured', detail: 'API key not configured.' };
  if (!category || !category.instruction) return { error: 'bad_category', detail: 'No distill category provided.' };
  const input = String(text || '').trim();
  if (!input) return { error: 'empty', detail: 'No text to distill.' };

  const clippedInput =
    input.length > DISTILL_MAX_INPUT_CHARS ? input.slice(0, DISTILL_MAX_INPUT_CHARS) : input;

  let response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        // Haiku (not Sonnet): a single focused category call fits well inside the 25-sec
        // resolver budget (gotcha #4); sync Sonnet on the full input exceeded it and the
        // async batch was too slow (~11 min) for a button. Each result is a human-reviewed
        // DRAFT (§7), so Haiku's quality suffices. Single revert lever if ever needed: model.
        model: model || MODEL_FALLBACK,
        max_tokens: category.maxTokens,
        system: `${DISTILL_SHARED_PREAMBLE}\n\n${category.instruction}`,
        messages: [
          { role: 'user', content: `${category.userAsk}\n\nText:\n---\n${clippedInput}\n---` },
        ],
      }),
    });
  } catch (e) {
    return { error: 'network_failure', detail: String(e?.message || e) };
  }

  if (response.status === 401) return { error: 'auth_rejected', detail: 'Anthropic rejected the API key.' };
  if (response.status === 402) return { error: 'insufficient_credits', detail: 'Anthropic account has insufficient credits.' };
  if (response.status === 429) return { error: 'rate_limited', detail: 'Anthropic rate limit exceeded.' };
  if (!response.ok) {
    const t = await response.text();
    console.error(`[distill] category=${category.key} HTTP ${response.status}: ${t.substring(0, 300)}`);
    return { error: `anthropic_${response.status}`, detail: 'The AI service returned an error. Please try again in a moment; if it persists, contact support@spec2jira.com.' };
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    return { error: 'parse_failed', detail: String(e?.message || e) };
  }

  let section = (data?.content?.[0]?.text || '').trim();
  if (!section) return { error: 'empty_result', detail: `Distill returned no text for ${category.label}.` };
  const truncated = data?.stop_reason === 'max_tokens';
  if (truncated) {
    // Hit the per-call token cap → the text ends mid-word/mid-sentence. Drop the partial
    // trailing fragment so the section ends at a CLEAN boundary (POLICY §11 — never a
    // half-finished line). Each section leads with its highest-value items, so only a
    // marginal tail entry is lost. Domain-agnostic: prefer the last line break (list-style
    // sections), else the last sentence end (prose sections).
    const nl = section.lastIndexOf('\n');
    if (nl > section.length * 0.5) {
      section = section.slice(0, nl).trimEnd();
    } else {
      const s = Math.max(
        section.lastIndexOf('. '), section.lastIndexOf('; '),
        section.lastIndexOf('? '), section.lastIndexOf('! '),
      );
      if (s > section.length * 0.5) section = section.slice(0, s + 1).trimEnd();
    }
  }
  // Length only — NEVER the content (privacy; keeps "Log End-User Data: No" true).
  console.log(`[distill] category=${category.key} extracted (${section.length} chars${truncated ? ', hit token cap → trimmed to clean boundary' : ''})`);
  return { section, truncated };
}

/**
 * Salvage а usable breakdown от truncated JSON.
 *
 * Structured output truncated mid-stream leaves an unterminated JSON object,
 * typically inside the `features` array. Strategy: extract complete feature
 * objects from the features array by bracket-depth scanning, drop the final
 * incomplete one, и rebuild а minimal valid breakdown.
 *
 * @param {string} rawText - the truncated JSON string
 * @returns {object|null} - { features: [...], metadata?, shared_acceptance_criteria?, spec_concerns? } OR null
 */
function salvageTruncatedBreakdown(rawText) {
  try {
    const featuresKey = '"features"';
    const fkIdx = rawText.indexOf(featuresKey);
    if (fkIdx === -1) return null;
    const arrStart = rawText.indexOf('[', fkIdx);
    if (arrStart === -1) return null;

    // Scan for complete top-level objects within the features array.
    const features = [];
    let depth = 0;
    let objStart = -1;
    let inString = false;
    let escaped = false;

    for (let i = arrStart + 1; i < rawText.length; i++) {
      const ch = rawText[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        if (depth === 0) objStart = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && objStart !== -1) {
          const objText = rawText.substring(objStart, i + 1);
          try {
            features.push(JSON.parse(objText));
          } catch (_) {
            // skip unparseable object (shouldn't happen for complete ones)
          }
          objStart = -1;
        }
      } else if (ch === ']' && depth === 0) {
        break; // end of features array reached cleanly
      }
    }

    if (features.length === 0) return null;

    const out = { features };

    // Try к recover trailing top-level fields ako they survived truncation.
    // These appear AFTER the features array in the schema order. Best-effort.
    for (const key of ['metadata', 'shared_acceptance_criteria', 'spec_concerns']) {
      const recovered = tryExtractTopLevelField(rawText, key);
      if (recovered !== undefined) out[key] = recovered;
    }

    return out;
  } catch (_) {
    return null;
  }
}

/**
 * Best-effort extraction of а complete top-level JSON field value by key.
 * Returns the parsed value OR undefined ако the field е absent/incomplete.
 */
function tryExtractTopLevelField(rawText, key) {
  try {
    const keyStr = `"${key}"`;
    const kIdx = rawText.indexOf(keyStr);
    if (kIdx === -1) return undefined;
    let i = rawText.indexOf(':', kIdx);
    if (i === -1) return undefined;
    i++;
    while (i < rawText.length && /\s/.test(rawText[i])) i++;
    const open = rawText[i];
    if (open !== '{' && open !== '[' && open !== '"') return undefined;

    const close = open === '{' ? '}' : open === '[' ? ']' : '"';
    let depth = 0;
    let inString = open === '"';
    let escaped = false;
    const start = i;

    if (open === '"') {
      // string value
      for (i = start + 1; i < rawText.length; i++) {
        const ch = rawText[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') return JSON.parse(rawText.substring(start, i + 1));
      }
      return undefined;
    }

    for (i = start; i < rawText.length; i++) {
      const ch = rawText[i];
      if (inString) {
        if (escaped) { escaped = false; }
        else if (ch === '\\') { escaped = true; }
        else if (ch === '"') { inString = false; }
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return JSON.parse(rawText.substring(start, i + 1));
      }
    }
    return undefined; // never closed → incomplete
  } catch (_) {
    return undefined;
  }
}
