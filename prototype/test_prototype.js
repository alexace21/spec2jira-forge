#!/usr/bin/env node
/**
 * Spec2Tickets v3.0.0 prototype — CLI test harness.
 *
 * Reads a Confluence spec (plain text or markdown) от a file, calls
 * Anthropic API с Sonnet 4.6 structured outputs, prints the breakdown
 * + summary stats + cost estimate, optionally saves output JSON для
 * comparison vs v2.x Qwen baseline.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node test_prototype.js <spec-file-path>
 *
 *   # With page title:
 *   ANTHROPIC_API_KEY=sk-... node test_prototype.js <spec-file> --title "My Spec"
 *
 *   # Use Haiku fallback (3x cheaper):
 *   ANTHROPIC_API_KEY=sk-... node test_prototype.js <spec-file> --model claude-haiku-4-5
 *
 *   # Disable prompt caching (use during prompt iteration):
 *   ANTHROPIC_API_KEY=sk-... node test_prototype.js <spec-file> --no-cache
 *
 *   # Save full output JSON:
 *   ANTHROPIC_API_KEY=sk-... node test_prototype.js <spec-file> --save output.json
 *
 * Requires Node.js 18+ (native fetch). Run от prototype/ directory:
 *   cd prototype && node test_prototype.js fixtures/sample_spec.md
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';

import {
  generateBreakdown,
  estimateCost,
  MODEL_PRIMARY,
  MODEL_FALLBACK,
} from './anthropic_client.js';

// ── CLI arg parsing (minimal) ─────────────────────────────

function parseArgs(argv) {
  const args = { specFile: null, title: null, model: MODEL_PRIMARY, useCaching: true, savePath: null };
  const positional = [];

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title') args.title = argv[++i];
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--no-cache') args.useCaching = false;
    else if (a === '--save') args.savePath = argv[++i];
    else if (a === '--haiku') args.model = MODEL_FALLBACK;
    else if (a.startsWith('--')) {
      console.warn(`Unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }

  args.specFile = positional[0];
  return args;
}

// ── Pretty-print helpers ───────────────────────────────────

function fmt(num, decimals = 4) {
  return typeof num === 'number' ? num.toFixed(decimals) : '-';
}

function bar(width = 60, char = '═') {
  return char.repeat(width);
}

// ── Summary stats ──────────────────────────────────────────

function summarizeBreakdown(breakdown) {
  const features = breakdown.features || [];

  let totalTasks = 0;
  let totalACs = 0;
  let totalDeps = 0;
  let totalConcerns = 0;
  const confidenceTier = { '✓': 0, '⚠': 0, '✗': 0, missing: 0 };
  const categories = new Set();

  for (const f of features) {
    totalTasks += (f.tasks || []).length;
    totalACs += (f.acceptance_criteria || []).length;
    totalDeps += (f.dependencies || []).length;
    totalConcerns += (f.concerns || []).length;
    // FLATTENED schema (post-grammar-timeout fix): confidence_indicator
    // е scalar field directly on feature, не nested object
    const ind = f.confidence_indicator;
    if (ind && confidenceTier[ind] !== undefined) confidenceTier[ind]++;
    else confidenceTier.missing++;
    if (f.category) categories.add(f.category);
  }

  // FLATTENED schema: shared_acceptance_criteria е string array directly,
  // not object с .items[]
  const sharedACs = (breakdown.shared_acceptance_criteria || []).length;
  const specConcerns = (breakdown.spec_concerns || []).length;
  const hasEpic = !!breakdown.epic;

  return {
    has_epic: hasEpic,
    epic_summary: breakdown.epic?.summary || null,
    feature_count: features.length,
    category_count: categories.size,
    categories: Array.from(categories),
    total_tasks: totalTasks,
    total_feature_acs: totalACs,
    total_shared_acs: sharedACs,
    total_dependencies: totalDeps,
    total_feature_concerns: totalConcerns,
    total_spec_concerns: specConcerns,
    confidence_distribution: confidenceTier,
    overall_quality: breakdown.metadata?.overall_quality || null,
    spec_summary: breakdown.metadata?.spec_summary || null,
    ambiguity_note: breakdown.metadata?.ambiguity_note || null,
  };
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (!args.specFile) {
    console.error('Usage: node test_prototype.js <spec-file-path> [--title "Page Title"] [--model claude-haiku-4-5] [--no-cache] [--save output.json]');
    process.exit(1);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Missing ANTHROPIC_API_KEY env var. Set it before running:\n  export ANTHROPIC_API_KEY=sk-ant-...');
    process.exit(1);
  }

  const specPath = resolve(args.specFile);
  let specContent;
  try {
    specContent = readFileSync(specPath, 'utf8');
  } catch (e) {
    console.error(`Failed к read spec file ${specPath}: ${e.message}`);
    process.exit(1);
  }

  const pageTitle = args.title || basename(specPath).replace(/\.[^.]+$/, '');

  console.log(bar());
  console.log('  Spec2Tickets v3.0.0 prototype — Sonnet 4.6 structured output');
  console.log(bar());
  console.log(`  Spec file:    ${specPath}`);
  console.log(`  Page title:   "${pageTitle}"`);
  console.log(`  Spec length:  ${specContent.length} chars`);
  console.log(`  Model:        ${args.model}`);
  console.log(`  Caching:      ${args.useCaching ? 'ENABLED' : 'DISABLED (no cache)'}`);
  console.log(bar());
  console.log('');

  console.log('🚀 Calling Anthropic API...');
  console.log('');

  const result = await generateBreakdown({
    apiKey,
    pageTitle,
    pageContent: specContent,
    model: args.model,
    useCaching: args.useCaching,
  });

  if (result.error) {
    console.error(`❌ Error: ${result.error}`);
    console.error(`   Detail: ${result.detail || '(no detail)'}`);
    if (result.usage) {
      console.error(`   Usage at failure:`, result.usage);
    }
    process.exit(2);
  }

  const { breakdown, usage, model, elapsedMs, stop_reason } = result;

  console.log('');
  console.log(bar());
  console.log('  Response received');
  console.log(bar());
  console.log(`  Model returned:  ${model}`);
  console.log(`  Stop reason:     ${stop_reason}`);
  console.log(`  Wall-clock:      ${(elapsedMs / 1000).toFixed(1)} sec`);
  console.log('');
  console.log('  Token usage:');
  console.log(`    Input (uncached):       ${usage.input_tokens || 0}`);
  console.log(`    Cache creation:         ${usage.cache_creation_input_tokens || 0}`);
  console.log(`    Cache read:             ${usage.cache_read_input_tokens || 0}`);
  console.log(`    Output:                 ${usage.output_tokens || 0}`);
  console.log('');

  // Cost estimate
  const cost = estimateCost(usage, model);
  console.log('  Cost estimate (USD):');
  console.log(`    Input (uncached):       $${fmt(cost.breakdown.input_uncached)}`);
  console.log(`    Cache write:            $${fmt(cost.breakdown.cache_write)}`);
  console.log(`    Cache read:             $${fmt(cost.breakdown.cache_read)}`);
  console.log(`    Output:                 $${fmt(cost.breakdown.output)}`);
  console.log(`    TOTAL:                  $${fmt(cost.total_usd)}`);
  console.log(`    Cache hit?              ${cost.cache_hit ? 'YES (90% saving on cached portion)' : 'NO (first call OR no caching)'}`);
  console.log('');

  // Breakdown summary
  const summary = summarizeBreakdown(breakdown);
  console.log(bar());
  console.log('  Breakdown summary');
  console.log(bar());
  console.log(`  Epic generated?         ${summary.has_epic ? `YES — "${summary.epic_summary}"` : 'NO (flat features array)'}`);
  console.log(`  Feature count:          ${summary.feature_count}`);
  console.log(`  Categories surfaced:    ${summary.category_count} ${summary.categories.length ? `(${summary.categories.join(', ')})` : ''}`);
  console.log(`  Total tasks:            ${summary.total_tasks}`);
  console.log(`  Total feature ACs:      ${summary.total_feature_acs}`);
  console.log(`  Shared ACs:             ${summary.total_shared_acs}`);
  console.log(`  Dependencies surfaced:  ${summary.total_dependencies}`);
  console.log(`  Feature concerns:       ${summary.total_feature_concerns}`);
  console.log(`  Spec-level concerns:    ${summary.total_spec_concerns}`);
  console.log('');
  console.log('  Confidence distribution:');
  console.log(`    ✓ high:               ${summary.confidence_distribution['✓']}`);
  console.log(`    ⚠ medium:             ${summary.confidence_distribution['⚠']}`);
  console.log(`    ✗ low:                ${summary.confidence_distribution['✗']}`);
  console.log(`    (missing field):      ${summary.confidence_distribution.missing}`);
  console.log('');
  console.log(`  Overall quality:        ${summary.overall_quality || '(not set)'}`);
  console.log(`  Spec summary:           ${summary.spec_summary || '(not set)'}`);
  if (summary.ambiguity_note) {
    console.log(`  Ambiguity note:         ${summary.ambiguity_note}`);
  }
  console.log('');

  // Save full output
  if (args.savePath) {
    const outputPath = resolve(args.savePath);
    const payload = {
      meta: {
        spec_file: specPath,
        page_title: pageTitle,
        model_requested: args.model,
        model_returned: model,
        timestamp: new Date().toISOString(),
        elapsed_ms: elapsedMs,
        caching_enabled: args.useCaching,
      },
      usage,
      cost_estimate_usd: cost,
      summary,
      breakdown,
    };
    writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`✅ Full output saved к: ${outputPath}`);
  } else {
    console.log('💡 Pass --save path/to/output.json к persist full breakdown JSON.');
  }

  console.log('');
  console.log(bar());
  console.log('  Done. С усмивка ✨');
  console.log(bar());
}

main().catch((e) => {
  console.error('Unhandled error:', e);
  process.exit(99);
});
