/**
 * Spec2Tickets v3.0.0 prototype — Anthropic API client.
 *
 * Pure Node.js implementation (NOT Forge-specific yet) для Phase 1
 * prototype validation. Once Sonnet 4.6 output quality validates vs
 * v2.x Qwen baseline (Phase 1.5 gate), this module gets adapted к
 * Forge resolver runtime (process.env → kvs.getSecret for BYOK key).
 *
 * Verified against current Anthropic API docs (2026-05-27):
 *   - Endpoint: POST https://api.anthropic.com/v1/messages
 *   - Header: anthropic-version: 2023-06-01 (stable)
 *   - Model: claude-sonnet-4-6 (primary), claude-haiku-4-5 (fallback)
 *   - Structured outputs: output_config.format = json_schema (GA on 4.6)
 *   - Prompt caching: cache_control.type = ephemeral (5min default / 1h opt)
 *   - Sonnet 4.6: 1M context, 64k max output, $3/$15 per MTok
 */

import { BREAKDOWN_SCHEMA, SYSTEM_PROMPT } from './prompts.js';

// ── Constants ──────────────────────────────────────────────

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export const MODEL_PRIMARY = 'claude-sonnet-4-6';
export const MODEL_FALLBACK = 'claude-haiku-4-5';

// Generous output cap — structured breakdown of medium spec typically
// produces 4-12K output tokens. 16K leaves comfortable headroom.
const MAX_OUTPUT_TOKENS = 16000;

// ── User prompt template ────────────────────────────────────

/**
 * Build the dynamic per-call user prompt. Not cached (different
 * spec content each invocation).
 *
 * @param {string} pageTitle - Confluence page title
 * @param {string} pageContent - Confluence page content (plain text
 *   or markdown — Sonnet handles either well)
 * @returns {string}
 */
export function buildUserPrompt(pageTitle, pageContent) {
  return `Extract a JIRA-ready breakdown от the following Confluence specification page.

# Source page: "${pageTitle}"

# Source content:

${pageContent}

# Output

Return the breakdown strictly conforming к the provided JSON schema. Apply the rules and Agile lens от your system instructions. Surface any structural ambiguity, risks, assumptions, or external dependencies в feature.concerns[] / spec_concerns[]. Self-assess confidence per feature (✓/⚠/✗). Use feature.category for natural grouping когато domain clusters emerge от the spec.`;
}

// ── Main API call ──────────────────────────────────────────

/**
 * Generate a structured breakdown от Confluence spec content.
 *
 * @param {object} args
 * @param {string} args.apiKey - Anthropic API key (BYOK)
 * @param {string} args.pageTitle - Confluence page title
 * @param {string} args.pageContent - Confluence page content
 * @param {string} [args.model] - Model ID (default: Sonnet 4.6)
 * @param {boolean} [args.useCaching=true] - Enable prompt caching
 *   (set false during prompt iteration to avoid cache hits while
 *   tuning system prompt)
 * @returns {Promise<{breakdown?: object, usage?: object, model?: string, error?: string, detail?: string}>}
 */
export async function generateBreakdown({
  apiKey,
  pageTitle,
  pageContent,
  model = MODEL_PRIMARY,
  useCaching = true,
}) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 20) {
    return {
      error: 'auth_missing',
      detail: 'Anthropic API key not provided OR appears invalid. Pass apiKey arg explicitly.',
    };
  }
  if (!pageContent || pageContent.trim().length < 50) {
    return {
      error: 'input_too_small',
      detail: `Page content е too short к extract meaningful breakdown (${pageContent?.length || 0} chars).`,
    };
  }

  // System prompt as cacheable block (~1500-2000 tokens — well above
  // Sonnet 4.6 minimum of 1024 tokens for cache eligibility)
  const systemContent = useCaching
    ? [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ]
    : SYSTEM_PROMPT; // plain string когато caching disabled

  const requestBody = {
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
  };

  let response;
  const startTime = Date.now();
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (e) {
    return {
      error: 'network_failure',
      detail: `Fetch threw before response: ${String(e?.message || e)}`,
    };
  }

  const elapsedMs = Date.now() - startTime;

  // Error classification
  if (response.status === 401) {
    return {
      error: 'auth_rejected',
      detail: 'Anthropic rejected the API key. Verify key validity at console.anthropic.com.',
    };
  }
  if (response.status === 429) {
    return {
      error: 'rate_limited',
      detail: 'Anthropic rate limit exceeded. Retry after a moment OR upgrade usage tier.',
    };
  }
  if (response.status === 529) {
    return {
      error: 'overloaded',
      detail: 'Anthropic API е overloaded. Retry с exponential backoff.',
    };
  }
  if (!response.ok) {
    const text = await response.text();
    return {
      error: `anthropic_${response.status}`,
      detail: text.substring(0, 500),
    };
  }

  const data = await response.json();

  // Stop reason handling
  if (data.stop_reason === 'refusal') {
    return {
      error: 'refused',
      detail: 'Anthropic refused к process this spec (safety filter triggered). Try simplifying spec content.',
      usage: data.usage,
    };
  }
  if (data.stop_reason === 'max_tokens') {
    return {
      error: 'truncated',
      detail: `Output truncated at ${MAX_OUTPUT_TOKENS} tokens. Spec may be too large; try Haiku fallback OR increase max_tokens.`,
      usage: data.usage,
    };
  }

  // Structured outputs guarantee: content[0].text е valid JSON conforming к schema
  let breakdown;
  try {
    breakdown = JSON.parse(data.content[0].text);
  } catch (e) {
    return {
      error: 'parse_failed',
      detail: `Unexpected: structured output returned invalid JSON. Raw: ${data.content[0]?.text?.substring(0, 300)}`,
      usage: data.usage,
    };
  }

  return {
    breakdown,
    usage: data.usage,
    model: data.model,
    elapsedMs,
    stop_reason: data.stop_reason,
  };
}

// ── Cost estimator ──────────────────────────────────────────

/**
 * Estimate cost of a generateBreakdown call в USD.
 *
 * Sonnet 4.6 pricing (verified 2026-05-27):
 *   Base input:        $3.00 / MTok
 *   Cache write (5m):  $3.75 / MTok (1.25x)
 *   Cache read:        $0.30 / MTok (0.10x base — 90% discount)
 *   Output:           $15.00 / MTok
 *
 * Haiku 4.5 pricing:
 *   Base input:        $1.00 / MTok
 *   Cache write (5m):  $1.25 / MTok
 *   Cache read:        $0.10 / MTok
 *   Output:            $5.00 / MTok
 *
 * @param {object} usage - usage object от Anthropic response
 * @param {string} model - model ID
 * @returns {{total_usd: number, breakdown: object}}
 */
export function estimateCost(usage, model = MODEL_PRIMARY) {
  const rates = model.startsWith('claude-haiku')
    ? { input: 1.0, cache_write: 1.25, cache_read: 0.10, output: 5.0 }
    : { input: 3.0, cache_write: 3.75, cache_read: 0.30, output: 15.0 };

  const inputTokens = usage.input_tokens || 0;
  const cacheCreateTokens = usage.cache_creation_input_tokens || 0;
  const cacheReadTokens = usage.cache_read_input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;

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
