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

import { BREAKDOWN_SCHEMA, SYSTEM_PROMPT, buildProjectContextSystemText } from './prompts.js';

// ── Constants ──────────────────────────────────────────────

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_BATCHES_URL = 'https://api.anthropic.com/v1/messages/batches';
const ANTHROPIC_VERSION = '2023-06-01';

export const MODEL_PRIMARY = 'claude-sonnet-4-6';
export const MODEL_FALLBACK = 'claude-haiku-4-5';

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
 * Retrieve customer's stored Anthropic API key от Forge KVS secret storage.
 * Returns null когато not configured (Settings UI not completed yet).
 */
export async function getStoredApiKey() {
  try {
    const key = await kvs.getSecret(KVS_API_KEY_NAME);
    return key || null;
  } catch (e) {
    console.warn(`[anthropic] kvs.getSecret failed: ${String(e?.message || e)}`);
    return null;
  }
}

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
  const key = apiKey || (await getStoredApiKey());
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
 * Estimate cost of a breakdown generation call в USD от its token usage.
 * Used by tier enforcement к decide когато customer hits subscription cap.
 *
 * Sonnet 4.6 pricing (verified 2026-05-27):
 *   Base input: $3.00 / MTok | Cache write 5m: $3.75 | Cache read: $0.30
 *   Output: $15.00
 *
 * Haiku 4.5 pricing:
 *   Base input: $1.00 / MTok | Cache write: $1.25 | Cache read: $0.10
 *   Output: $5.00
 */
export function estimateCost(usage, model = MODEL_PRIMARY) {
  const rates = model.startsWith('claude-haiku')
    ? { input: 1.0, cache_write: 1.25, cache_read: 0.1, output: 5.0 }
    : { input: 3.0, cache_write: 3.75, cache_read: 0.3, output: 15.0 };

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
    instruction: `Extract the DOMAIN section ONLY (3-5 sentences, end cleanly — never stop mid-sentence). Output starts with "Domain:". Give: the domain and what the system does, in one breath. Then fold in, ONLY where the input actually establishes them, the durable cross-cutting facts as short clauses — (a) any STANDING DESIGN TENSION the team deliberately balances: name BOTH poles, and that it is intentional, unresolved, and must never be collapsed to one side (it is a constraint the engine inherits, not a problem to solve); (b) any durable CROSS-CUTTING fact that shapes everything downstream — most often that SEVERAL parallel mechanisms run side by side, are independently configurable, and must ALL be honoured, never silently collapsed to a single canonical one. Capture only the tensions/facts the input genuinely states; if the input establishes none, give just the domain and what the system does. Do NOT list individual terms, personas, systems, regulations, or rules here — those belong to their own sections. Keep it tight.`,
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
    maxTokens: 600,
    instruction: `Extract the CONVENTIONS ONLY — the durable house-style and the STANDING counterintuitive rules the engine must always respect (NOT one-off procedure, timers, or data-rates). Output starts with "Conventions:". Do NOT repeat any term, score, metric, system, or persona already covered by the Glossary / Tech / Personas sections — this section is ONLY house-style and standing action-rules. Capture, compactly, only what the input establishes:
(1) HOUSE-STYLE that persists across specs: working languages, any operational terms used verbatim in a particular language, spelling/naming conventions, and fixed state/status vocabularies.
(2) STANDING COUNTERINTUITIVE rules — these are easy to miss and are the HIGHEST-VALUE rules to preserve, so hunt the input specifically for each KIND below and state EVERY one it contains (in the input's own terms):
  - a rule that REVERSES a default or a prior behaviour — something that, against the obvious expectation, is NOT auto-undone, NOT auto-cancelled, or still applies despite a later contradicting signal (e.g. a scheduled re-check or hold that a subsequent normal/contradicting reading does NOT cancel);
  - a DUAL-CONTROL or second-approval requirement (an action that needs a second person to confirm or co-sign);
  - a SURFACE-vs-BLOCK policy (the system warns/cautions and logs but does NOT hard-block, leaving final judgment to a human);
  - a LINEAGE / SUPERSESSION carve-out (this version replaces a prior one only IN PART, with specific elements deliberately RETAINED — never flatten to "replaces X"; capture this carve-out even when the only in-text trace of the prior version is a single retained or reversed rule — the "replaces only IN PART / these elements retained" boundary is itself the durable fact).
State each rule the input actually contains as one short clause. Do not invent rules of a kind the input does not contain, and do not enumerate kinds that are absent.`,
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
