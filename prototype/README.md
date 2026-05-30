# Spec2Tickets v3.0.0 — Phase 1 Prototype

Standalone Node.js prototype validating Anthropic API (Claude Sonnet 4.6) structured-output breakdown generation. **Not Forge-deployed yet** — pure CLI test harness to empirically validate output quality before committing to full MVP build.

## Phase context

Per CLAUDE.md HANDOVER v3.0.0 (2026-05-27) — Path C Hybrid pivot:

- **Phase 0** ✅ Strategic decisions ratified (BYOK now, vendor-pays later)
- **Phase 0.5** ✅ CLAUDE.md Stage 1 HANDOVER landed
- **Phase 0.6** ✅ `feature/v3-pivot` branch created
- **Phase 1** 🔄 ← YOU ARE HERE — Prototype resolver (this directory)
- **Phase 1.5** 📋 Quality validation gate — compare к v2.x Qwen baseline
- **Phase 2** 📋 Full v3.0.0 MVP build (post quality gate)
- **Phase 3** 📋 Marketplace resubmission

## What's в this directory

| File | Purpose |
|---|---|
| `prompts.js` | `SYSTEM_PROMPT` (cacheable, ~2k tokens) + `BREAKDOWN_SCHEMA` (strict JSON Schema, 23 optional params under 24 limit) |
| `anthropic_client.js` | `generateBreakdown()` async function — wraps Anthropic API call с structured outputs + prompt caching + cost estimator |
| `test_prototype.js` | CLI harness — reads spec file, calls API, prints breakdown summary + token usage + cost |
| `fixtures/` | Sample spec content for smoke testing (replace с real DocApproval source for Phase 1.5 validation) |
| `README.md` | This file |

## Setup

Requires Node.js 18+ (native `fetch` API).

```bash
# Verify Node version
node --version    # Should be v18.x or higher

# Set your Anthropic API key (get one от console.anthropic.com)
# Linux/Mac:
export ANTHROPIC_API_KEY=sk-ant-api03-...

# Windows PowerShell:
$env:ANTHROPIC_API_KEY = "sk-ant-api03-..."

# Windows cmd:
set ANTHROPIC_API_KEY=sk-ant-api03-...
```

## Running the prototype

```bash
cd prototype

# Smoke test с sample fixture (small spec, validates pipeline works)
node test_prototype.js fixtures/sample_spec.md

# Run on real DocApproval spec
node test_prototype.js path/to/docapproval_spec.txt --title "Document Approval Workflow" --save out_docapproval_sonnet.json

# Use Haiku 4.5 (3x cheaper; quality check на smaller model)
node test_prototype.js path/to/docapproval_spec.txt --haiku --save out_docapproval_haiku.json

# Disable prompt caching (useful during prompt iteration к ensure fresh runs)
node test_prototype.js path/to/spec.md --no-cache
```

## CLI flags

| Flag | Effect |
|---|---|
| `--title "..."` | Page title (defaults к filename) |
| `--model claude-haiku-4-5` | Use Haiku instead of Sonnet |
| `--haiku` | Shortcut за `--model claude-haiku-4-5` |
| `--no-cache` | Disable prompt caching (fresh call) |
| `--save path.json` | Save full output (breakdown + usage + cost + summary) к JSON file |

## Expected output

```
════════════════════════════════════════════════════════════
  Spec2Tickets v3.0.0 prototype — Sonnet 4.6 structured output
════════════════════════════════════════════════════════════
  Spec file:    /path/to/docapproval_spec.txt
  Page title:   "Document Approval Workflow"
  Spec length:  3245 chars
  Model:        claude-sonnet-4-6
  Caching:      ENABLED

🚀 Calling Anthropic API...

════════════════════════════════════════════════════════════
  Response received
════════════════════════════════════════════════════════════
  Model returned:  claude-sonnet-4-6
  Stop reason:     end_turn
  Wall-clock:      28.4 sec

  Token usage:
    Input (uncached):       845
    Cache creation:         1923
    Cache read:             0
    Output:                 4156

  Cost estimate (USD):
    Input (uncached):       $0.0025
    Cache write:            $0.0072
    Cache read:             $0.0000
    Output:                 $0.0623
    TOTAL:                  $0.0720
    Cache hit?              NO (first call — system prompt cached for next run)

════════════════════════════════════════════════════════════
  Breakdown summary
════════════════════════════════════════════════════════════
  Epic generated?         NO (flat features array)
  Feature count:          12
  Categories surfaced:    3 (Document Submission, Approval Workflow, Notification)
  Total tasks:            34
  Total feature ACs:      48
  Shared ACs:             5
  Dependencies surfaced:  7
  Feature concerns:       4
  Spec-level concerns:    2

  Confidence distribution:
    ✓ high:               9
    ⚠ medium:             3
    ✗ low:                0
    (missing field):      0

  Overall quality:        high
  Spec summary:           Document approval workflow с multi-stage review, delegation,
                          and notification.
  Ambiguity note:         Retention period for archived documents not specified;
                          assumed 7-year default per typical regulatory baseline.

✅ Full output saved к: /path/to/out_docapproval_sonnet.json
```

## What success looks like (Phase 1.5 gate criteria)

Per CLAUDE.md HANDOVER v3.0.0 validation gate:

| Metric | v2.x Qwen baseline | v3.0.0 Sonnet target | Pass criteria |
|---|---|---|---|
| Feature count | 25-63 typical | ±20% от baseline | ≥80% match |
| AC fidelity (verbatim preservation) | ~85% | ≥85% | Sonnet ≥ Qwen |
| Dependency hints | rare (~6 ✓ avg) | ≥3 per medium spec | Sonnet better at semantic inference |
| Hallucinated features | rare после Bug Y POLICY | ≤1 per spec | Zero tolerance |
| Concerns surfaced (NEW) | not present в v2.x | ≥3 per spec | Sonnet adds value над Qwen |
| Wall-clock per spec | 10-30 min cold | 30-60 sec | 20-30× faster |
| Cost per spec | $0 customer (their GPU) | ~€0.05-0.10 customer | 4000× cheaper infrastructure |

If 4-of-5 representative specs pass → empirical validation green → proceed Phase 2.

## Recommended spec corpus for validation

Per HANDOVER plan, run on these 5 specs (preserved в v2.x repo `pages/breakdown-05.10.2026/`):

1. **DocApproval** — workflow-heavy, ~36 features
2. **E-commerce** — payment-heavy, ~47 features
3. **AML-fintech** — compliance-heavy, ~28 features
4. **App-notification** — UI-heavy, ~19 features
5. **Stress** — multi-domain, ~63 features

For each, copy the source Confluence page content (NOT the Qwen-generated breakdown) к `prototype/fixtures/` AND run:

```bash
node test_prototype.js fixtures/docapproval_source.md --save out_docapproval.json
# Then compare out_docapproval.json к pages/breakdown-05.10.2026/docapproval/result_payload.json
```

## Architecture notes

**Schema differences vs v2.x**:
- `capabilities[]` REMOVED — flat `features[]` is primary deliverable. Capability grouping was a Qwen-14B cognitive workaround; не needed с Sonnet.
- `epic` made OPTIONAL — generated only когато scope warrants (30+ features OR explicit umbrella scope в spec).
- `category` ADDED как feature-level field — natural domain label (e.g. "User Authentication") replaces forced capability buckets.
- `concerns[]` ADDED first-class (per-feature + spec-level) — Sonnet's reasoning depth makes risk/ambiguity surfacing reliable enough к feed Dashboard.
- `confidence` per-feature ADDED — Sonnet self-assesses ✓/⚠/✗ + score.
- `metadata.overall_quality` ADDED — drives Dashboard TrustCard.

**Forge integration deferred к Phase 2**:
- Currently uses `process.env.ANTHROPIC_API_KEY` (Node.js env var)
- Phase 2 swap: `process.env.X` → `await kvs.getSecret('anthropic_api_key')` (BYOK customer key)
- Otherwise the `generateBreakdown()` function works as-is inside Forge resolver

**Prompt caching**:
- System prompt (~2000 tokens) cached via `cache_control.type: ephemeral` (5-min TTL default)
- First call: cache write (~$0.0072 cost)
- Subsequent calls within 5 min: cache read ($0.0006 — 90% discount on cached portion)
- Disable via `--no-cache` flag когато iterating on system prompt itself

## Quick comparison к v2.x baseline (manual)

After running Sonnet on DocApproval, manually inspect output_sonnet.json side-by-side с v2.x result_payload.json:

- [ ] **Feature names** — match semantic intent? (не need verbatim match)
- [ ] **AC preservation** — testable phrases preserved verbatim?
- [ ] **Task decomposition** — same level of granularity?
- [ ] **Dependencies** — Sonnet surfaces dependencies Qwen missed?
- [ ] **Concerns** — NEW value over v2.x (no equivalent в Qwen output)
- [ ] **Wall-clock** — should be 20-50x faster
- [ ] **Hallucinations** — any features/ACs that don't exist в source spec?
