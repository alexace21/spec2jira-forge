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

import { BREAKDOWN_SCHEMA, SYSTEM_PROMPT } from './prompts.js';

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
    return { success: false, error: 'API key е required and must be a string' };
  }
  const trimmed = apiKey.trim();
  if (trimmed.length < 20) {
    return { success: false, error: 'API key appears too short — verify the value' };
  }
  if (!trimmed.startsWith('sk-ant-')) {
    return {
      success: false,
      error: 'API key должен start with "sk-ant-" (Anthropic format)',
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
      detail: 'No API key configured. Enter your Anthropic API key в the Settings UI first.',
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
    return {
      ok: false,
      error: response.status === 402 ? 'insufficient_credits' : 'rate_limited',
      detail: text.substring(0, 300),
    };
  }
  if (!response.ok) {
    const text = await response.text();
    return {
      ok: false,
      error: `anthropic_${response.status}`,
      detail: text.substring(0, 300),
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
 * Submit а 1-request batch to Anthropic. Returns batch_id immediately.
 *
 * @param {object} args - pageTitle, pageContent, model, useCaching, apiKeyOverride (the breakdown generation inputs)
 * @param {string} args.customId - custom_id for the request (typically our jobId)
 * @returns {Promise<{batchId?, customId?, error?, detail?}>}
 */
export async function submitBreakdownBatch({
  pageTitle,
  pageContent,
  customId,
  model = MODEL_PRIMARY,
  useCaching = true,
  apiKeyOverride = null,
}) {
  const apiKey = apiKeyOverride || (await getStoredApiKey());
  if (!apiKey) {
    return {
      error: 'not_configured',
      detail:
        'Anthropic API key not configured. Ask your Confluence admin к open Settings → Spec2Tickets and provide an Anthropic API key.',
    };
  }
  if (!pageContent || pageContent.trim().length < 50) {
    return {
      error: 'input_too_small',
      detail: `Page content е too short к extract meaningful breakdown (${pageContent?.length || 0} chars).`,
    };
  }
  if (!customId) {
    return { error: 'no_custom_id', detail: 'customId е required to identify the batch request.' };
  }

  const systemContent = useCaching
    ? [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ]
    : SYSTEM_PROMPT;

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
    console.warn(`[anthropic-batch] submit HTTP ${response.status}: ${text.substring(0, 300)}`);
    return { error: `anthropic_${response.status}`, detail: text.substring(0, 500) };
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
  if (!batchId) return { error: 'no_batch_id', detail: 'batchId е required.' };

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
    return { error: `anthropic_${response.status}`, detail: text.substring(0, 300) };
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
  if (!resultsUrl) return { error: 'no_results_url', detail: 'resultsUrl е required.' };

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
    return { error: `results_fetch_${response.status}`, detail: text.substring(0, 300) };
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
      detail: `Batch returned ${lines.length} rows but none с custom_id=${customId}.`,
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
    return { error: 'refused', detail: 'Anthropic refused к process this spec.', usage: message.usage };
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
          truncation_note: `Output exceeded ${MAX_OUTPUT_TOKENS} tokens. Recovered ${salvaged.features.length} complete features; later features may be missing. Consider splitting the spec.`,
        };
      }
      return {
        error: 'truncated',
        detail: `Output exceeded ${MAX_OUTPUT_TOKENS} tokens and could not be recovered. The spec е too large for а single breakdown — split it into smaller specs (e.g., per major capability area) and run each separately.`,
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
