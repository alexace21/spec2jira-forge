/**
 * Spec2Tickets v3.0.0 — Forge resolver entry point.
 *
 * Architecture (post-pivot 2026-05-28):
 *   - BYOK: customer's Anthropic API key stored in Forge KVS secret storage
 *   - Direct asUser() to Confluence (page content fetch) — no backend roundtrip
 *   - Anthropic Message Batches API for generation (startGeneration submits,
 *     pollJobStatus polls) — async event consumers retired (55s timeout)
 *   - Chunked asUser() JIRA push (startPush + UI-looped pushStep) — SHIPPED
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
 *   JIRA push (Step 8 — chunked asUser() resolver; 2026-05-30):
 *     - startPush (lookup + Epic + KVS session) → pushStep, looped by the UI,
 *       one bounded chunk per call (stays under the 25s resolver timeout).
 *       No executePush/pushToJira; no queue (asUser() unavailable in consumers).
 */

import Resolver from '@forge/resolver';
import { kvs, WhereConditions } from '@forge/kvs';
import api, { route } from '@forge/api';

import {
  setStoredApiKey,
  clearStoredApiKey,
  getStoredApiKey,
  getStoredApiKeyInfo, // [diag Phase 4, A4] fault-aware stored-key read
  KEY_STORAGE_FAILED_DETAIL, // [diag Phase 4, A4] the one honest storage-fault text (never diverges per site)
  testConnection as anthropicTestConnection,
  submitBreakdownBatch,
  pollBatchStatus,
  fetchBatchResults,
  estimateCost,
  resolveDependencyCycle,
  distillCategory,
  trimToBudget,
  DISTILL_CATEGORIES,
  DISTILL_MAX_INPUT_CHARS,
  MODEL_PRIMARY,
  MODEL_FALLBACK,
  submitTestCaseBatch,
  pollTestCaseBatch,
  fetchTestCaseResults,
  projectTestCaseCost, // v6 cost-transparency: pre-flight projector
  sumUsage, // v6 cost-transparency: batch-wide usage aggregation for the post-run echo
  TC_SPEC_SOURCE_MAX_CHARS, // v6: clamp the projector's spec-source input identically to submit
  submitPlanRankingBatch, // Capacity-Sheet Planner: the advisory ranking call via the Batches API (async)
  fetchPlanRankingResults,
} from './anthropic_client.js';
import { startPushSession, pushSessionStep, flattenBreakdown, lookupProject, startPlanPushSession, planPushSessionStep } from './push_handler.js';
import { isOrphanStale } from './sweep_util.js'; // Task #13: pure staleness decision (unit-tested; index.js isn't node-importable)
import { detectCycles } from './graph.js';
// Capacity-Sheet Planner pure-fn core (src/planner.js — node-testable; prototype/test_planner.mjs).
// The planner's dispatch (POLICY §4): all of capacity math / graph / packing is deterministic here;
// the ONE meaning-judgment is rankFeaturesForPlan (above). assemblePlan composes them given an
// (optional) ranking — the resolver supplies the LLM output or null (deterministic fallback).
import {
  computeCapacity,
  computeThroughput, // Kanban v1: capacity → quarter throughput → Now/Next/Later reach band (methodology fork)
  assemblePlan,
  buildPlannerGraph,
  topoSortAndCycles,
  computeSchedulingSignals,
  buildRankingRows,
  computeRiskSignals,
  summarizeSpecConcerns,
  diffPlans,
  validateSizing,
  featureId,
  priorityRankOf,
  planSourceHash,
  estimatePlanCost,
} from './planner.js';
// P12: the planning-objective allow-list is OWNED by prompts.js (it must stay lock-step with the
// OBJECTIVE_CLAUSES the ranker actually understands). Import it rather than re-hardcoding the set here
// — a second literal list would silently drift the moment a new objective is added (P12-04 audit finding).
import { PLAN_OBJECTIVES } from './prompts.js';
import { renderGherkin, renderManualTable, parseTestCaseResult, normAC } from './testcases.js';
import {
  TIERS,
  checkQuota,
  consumeQuota,
  recordFirstSeen,
  formatResetDate,
  pricingTable,
  getActiveTier,
} from './usage.js';
// Diagnostic ledger (Phase 0 wiring — docs/DIAGNOSTICS-LEDGER-DESIGN.md). Both write helpers
// are FAIL-OPEN by contract (never throw into the caller); records are codes/ids/counts only,
// verbatim detail goes ONLY through writeDiagnosticDetail (the separate §2b zone).
// Phase 5 adds the READ surface: per-user/all-bucket readers + the second-wall
// serializer/validator for the tab + export resolvers (§2.10/§2b/§5).
import {
  recordDiagnostic,
  writeDiagnosticDetail,
  readDiagnostics,
  readAllDiagnostics,
  readAggregate,
  readDiagnosticDetail,
  clearDiagnostics as clearDiagnosticsBucket,
  serializeForExport,
  validateRecord,
  classifyDiagGenerationError,
  DIAG_CLASSES,
  DIAG_APP_VERSION,
} from './diagnostics.js';

// ── Anthropic key resolution (v6 value-split: both editions BYOK) ──
// v6 (2026-06-17): keySource is driven by the EXPLICIT tier.keySource field (see
// resolveAnthropicKey), NOT the edition label. Both live Marketplace editions resolve to
// 'byok' (the customer's own stored key). 'managed' (our MANAGED_ANTHROPIC_KEY, an ENCRYPTED
// Forge env var) is the DORMANT off-Marketplace fallback + legacy pre-v6 stamped jobs only.
// An Anthropic batch is bound to the key that created it, so the SOURCE ('managed'|'byok') is
// recorded on the job at submit and reused at poll — never re-resolved from a license that may
// have changed (e.g. a trial expiring) mid-batch.
// [diag Phase 4, A4 — worst offender #2] fault-aware variant: { key, fault } where
// fault=true ONLY when the BYOK secret READ threw (a Forge storage fault — the key may
// still be saved). The managed env-var read cannot fault. Gate sites check fault FIRST
// so a storage fault stops being misdiagnosed as not_configured ("no key" — wrong cause).
async function anthropicKeyInfoForSource(source) {
  if (source === 'managed') return { key: process.env.MANAGED_ANTHROPIC_KEY || null, fault: false };
  return getStoredApiKeyInfo();
}

// Key-only convenience for the poll legs (they soft-fail on a missing key and retry —
// recording per tick is banned by design §7, so they deliberately don't see `fault`).
async function anthropicKeyForSource(source) {
  const { key } = await anthropicKeyInfoForSource(source);
  return key;
}

/**
 * Resolve { apiKey, keySource, keyFault, tier } for THIS invocation from the license.
 * ⭐ v6 value-split: key-source is read from the EXPLICIT tier.keySource field, no longer
 * INFERRED from edition. BOTH live Marketplace editions (Standard + Advanced) are BYOK →
 * keySource 'byok' (the customer's stored key); 'managed' (our MANAGED_ANTHROPIC_KEY) is
 * the DORMANT off-Marketplace fallback only (resolveTier never returns a managed tier).
 * This is THE decoupling cut: once keySource is data-driven, the whole stamp/reuse chain
 * (job record → anthropicKeyForSource at every poll/fetch/cycle/test-gen leg) follows
 * automatically. The license is backend-trusted; every accessing user is licensed.
 * [diag Phase 4, A4] keyFault (additive): true ONLY when the stored-key read THREW.
 */
async function resolveAnthropicKey(context) {
  const tier = getActiveTier(context);
  const keySource = tier.keySource || 'byok'; // v6: explicit field, default BYOK (was: edition==='advanced'?'managed':'byok')
  const { key: apiKey, fault: keyFault } = await anthropicKeyInfoForSource(keySource);
  return { apiKey, keySource, keyFault, tier };
}

/**
 * Managed-Pro fair-use cap payload. The cap is fair-use (we pay compute), so the
 * user is routed to BYOK (unlimited with their own key) or to higher-volume
 * Managed access — NOT "subscribe to a higher tier". This is the ONLY
 * quota_exceeded case now (the in-app Free 3/mo tier was removed 2026-06-03;
 * BYOK is unlimited and never hits this; Unlicensed is handled by license_required).
 */
function buildQuotaExceeded(quota) {
  return {
    error: 'quota_exceeded',
    tier: quota.tier,
    tierLabel: quota.tierLabel,
    used: quota.used,
    limit: quota.limit,
    resetsAt: quota.resetsAt,
    resetsAtLabel: quota.resetsAtLabel,
    pricing: pricingTable(),
    fairUse: true,
    detail: `You've used all ${quota.limit} breakdowns included this month on ${quota.tierLabel} — they reset ${quota.resetsAtLabel}. Need more this month? Contact us at support@spec2jira.com about higher-volume Managed access, or switch to BYOK Pro (use your own Anthropic key) for unlimited right away.`,
  };
}

/**
 * Defensive license_required payload (tier === 'unlicensed' — no subscription and
 * no active trial). A Paid-via-Atlassian app is licensed-only by default, so this
 * is a backstop that turns the no-license case into a clean "subscribe or start a
 * trial" prompt rather than a raw error. Carries the pricing table so the UI can
 * present the two editions.
 */
function buildLicenseRequired() {
  return {
    error: 'license_required',
    detail:
      'This app requires an active subscription or trial. Subscribe to the Standard or Advanced edition.',
    pricing: pricingTable(),
  };
}

/**
 * v6 value-split: edition_required payload — returned when a user WITHOUT the test-case
 * capability (Standard edition) reaches a test-case WRITE path (generate / regenerate /
 * save). This is an UPGRADE prompt (the user IS licensed, just on the wrong edition), so
 * the frontend routes it to the upgrade screen, NOT the generic error screen. Carries the
 * pricing table so the UI can present the Advanced edition. `feature` lets the UI tailor copy.
 */
function buildUpgradeRequired(feature = 'test_cases') {
  return {
    error: 'edition_required',
    feature,
    detail:
      'Test-case generation is an Advanced feature. Upgrade to the Advanced edition to generate acceptance test cases for your stories.',
    pricing: pricingTable(),
  };
}

const resolver = new Resolver();

// ── Constants ──────────────────────────────────────────────

const SETTINGS_KEY = 'spec2jira_settings';

// Max length of the optional admin-configured Project Context (house style /
// glossary / conventions) injected into every generation (P1). Bounded so it stays
// a concise standing context, not an unbounded document (POLICY §12), and never
// drifts into a growing keyword/cue list (POLICY §5 — keep it ONE bounded field).
// The UI mirrors this for fail-fast feedback; this server check is authoritative.
// 12000: the 6-call decomposed distill produces a COMPLETE multi-category profile, and a
// genuinely rich regulated domain (the bilingual 3-site sepsis CDS) merges to ~7.5K chars
// of pure signal — 8000 left almost no headroom and risked silently trimming the LAST
// category (Conventions: the counterintuitive rules + lineage carve-out). 20000 (raised from
// 12000 2026-06-06) lets a DENSE, high-signal real context pass through RAW rather than be
// condensed: a real FlexiCash lending context (19,775 chars) was distilled and the distill
// INTERPRETED — it fabricated/drifted 2 normative "standing rules" that contradicted the spec
// and dropped high-signal conventions (anti-templating, JIRA structure, team composition).
// For a context that fits 20000, faithful raw text beats a lossy+interpretive condense.
// "Distill with Claude" remains for contexts that genuinely exceed 20000 (and is being
// hardened to extract-not-interpret). Aggregate store size is still guarded in saveSettings.
const PROJECT_CONTEXT_MAX_CHARS = 20000;

// "Distill with Claude" is a 6-call CHUNKED pipeline (startDistillSession → distillStep ×6,
// looped by the UI — mirrors the chunked JIRA push). Each call extracts ONE category from
// the SAME full input with its own generous per-category token budget (DISTILL_CATEGORIES in
// anthropic_client.js), so no category is starved by another — the fix for the single call's
// depth-first category drops (validated 8/8 vs 5/8 in a 2026-06-02 Haiku bake-off). Each call
// is small (~3-13s), well under the 25-sec resolver limit (gotcha #4). The 6 sections are
// accumulated in KVS and merged at the last step, then bounded to PROJECT_CONTEXT_MAX_CHARS
// (PROJECT_CONTEXT_MAX_CHARS, so the user can still hand-edit the draft).
const DISTILL_SESSION_PREFIX = 'distill_session:';

// Named Project Context profiles. A workspace can hold specs from multiple projects,
// so a SINGLE global context would misapply across them (project A's glossary on a
// project B spec = wrong output). Profiles let the user pick the right context per
// generation. Per-profile + count caps bound each entry; the AGGREGATE serialized
// size is guarded in saveSettings — 20 × 20000 chars (plus non-ASCII at 2-4 UTF-8
// bytes/char) can approach the ~240KB KVS value cap, so the write is size-checked.
const MAX_CONTEXT_PROFILES = 20;
const CONTEXT_PROFILE_NAME_MAX = 60;
// Aggregate settings-object byte ceiling (well under the ~240KB KVS value cap, leaving
// headroom for the non-context fields). Checked in saveSettings before the write.
const SETTINGS_MAX_BYTES = 200000;

// KVS prefix for generation job state (Anthropic batch lifecycle).
const JOB_KEY_PREFIX = 'job:';

// Capacity-Sheet Planner: a generated sprint plan, keyed by jobId (ledger UX-2/3). Holds the LLM
// ranking + usage + sourceHash + capacity form + the packed result so a reconnect rehydrates the
// BILLED plan (no re-pay) and an assumption-only re-pack reuses the CACHED ranking (no LLM). Deleted
// by deleteJobKeys on push-purge AND swept after 7-day inactivity (same lifecycle as the breakdown).
const PLAN_KEY_PREFIX = 'plan:';

// The in-flight ranking BATCH lifecycle record (separate from the completed plan: record), keyed by
// jobId. Holds batchId/keySource + the inputs needed to finalize (features/capacityForm/sourceHash) so
// pollPlanStatus can assemble + persist the plan when the batch ends. Deleted on completion + in deleteJobKeys.
const PLAN_BATCH_PREFIX = 'planjob:';

// (KVS-cost optimization 2026-06-10) The heavy job: record holds the full breakdown (~240KB).
// jobmeta: is a tiny SIBLING (~100B: status/pageTitle/startedAt) the dashboard reads instead of
// dereferencing the 240KB job: on every reconcile sweep — KVS has NO field projection, so a lean
// sibling key is the ONLY way to read a subset cheaply (the Atlassian READ-throughput quota fix).
// setJob() centralizes the job: write + the jobmeta mirror so no write site can forget the mirror
// (a missed jobmeta = a silently-stale dashboard group, §11). It derives jobmeta from value.status,
// covering every transition.
// ⚠ NO TTL (deep audit 2026-06-10): an earlier version put a 30-day TTL here, which SILENTLY EXPIRED
// the user's BREAKDOWN deliverable — review/reconnect/PUSH are READS and a native KVS TTL renews only
// on `set`, so a completed-but-unpushed breakdown vanished at completion+30d (§11 silent-data-loss),
// and pagesnap: expired out from under §7-aware test-gen. So job:/jobmeta:/pagesnap: carry NO TTL —
// they persist until the explicit purgeJob (on push) OR, for a NEVER-pushed job, until the Task #13
// orphan sweep removes it 7 days after its last access. That orphan bound is now IMPLEMENTED (Task #13):
// access-renewed (jobmeta.lastAccessedAt, re-set via touchJobAccess on every meaningful access — review/reconnect + the TC/push sub-journeys)
// + a daily scheduled sweep (sweepHandler) — NOT a creation-anchored TTL, which would silently expire
// a deliverable still under review (the trap above).
const JOB_META_PREFIX = 'jobmeta:';
async function setJob(jobId, value) {
  const jobKey = `${JOB_KEY_PREFIX}${jobId}`;
  await kvs.set(jobKey, value);
  // Best-effort lean mirror — a jobmeta failure must never break generation (job: is authoritative).
  // pollJobStatus re-asserts this on its terminal early-return so a failed mirror can't strand a row.
  try {
    await kvs.set(`${JOB_META_PREFIX}${jobId}`, {
      status: value.status,
      pageTitle: value.pageTitle,
      startedAt: value.submittedAt || value.createdAt,
      // Task #13: a setJob IS activity → stamp the inactivity timer. Renewed (leaner)
      // on read-access via touchJobAccess so an actively-reviewed breakdown is never
      // swept; the scheduled orphan sweep deletes a never-pushed job 7 days after this.
      lastAccessedAt: Date.now(),
    });
  } catch (e) {
    console.warn(`[setJob] jobmeta mirror failed (non-fatal): ${String(e?.message || e)}`);
  }
}

// ── Task #13: never-pushed-orphan cleanup (access-renewed + scheduled sweep) ────────
// The user-facing claim (DPA + the picker label) is "removed after 7 days of INACTIVITY
// (or immediately on push)". INACTIVITY, not creation: the timer is renewed on every
// meaningful access, so an actively-reviewed breakdown is NEVER deleted — which is exactly
// why a creation-anchored native KVS TTL was rejected (KVS TTL renews only on `set`, so a
// read-only review/push would silently lose the deliverable, §11). The sweep (a daily
// scheduledTrigger → sweepHandler) deletes a never-pushed job 7 days after its last access.
const ORPHAN_INACTIVITY_MS = 7 * 24 * 60 * 60 * 1000; // 7 calendar days — the working-week equivalent of "5 working days", chosen for simplicity over business-day math
const ORPHAN_RENEW_THROTTLE_MS = 60 * 60 * 1000;      // 1h — skip re-writing jobmeta on a frequent poll (write-amplification guard)
const SWEEP_PAGE_LIMIT = 50;                           // jobmeta keys per query page
const SWEEP_MAX_DELETES = 50;                          // cap deletions per daily run; the daily cadence clears any backlog over a few days

// Renew a job's inactivity timer (lean jobmeta write, throttled). Called on review /
// reconnect access so an actively-used breakdown is preserved. Best-effort: a miss only
// risks sweeping a still-active job, which is rare and recoverable (the user regenerates).
async function touchJobAccess(jobId) {
  if (!jobId) return;
  try {
    const meta = await kvs.get(`${JOB_META_PREFIX}${jobId}`);
    if (!meta || typeof meta !== 'object') return; // no mirror (purged / legacy) → nothing to renew
    const now = Date.now();
    if (Number.isFinite(meta.lastAccessedAt) && now - meta.lastAccessedAt < ORPHAN_RENEW_THROTTLE_MS) return; // recently renewed → skip (no write-amplification)
    await kvs.set(`${JOB_META_PREFIX}${jobId}`, { ...meta, lastAccessedAt: now });
  } catch (_) { /* best-effort — never block the access path */ }
}

// isOrphanStale (the pure staleness decision used by sweepHandler) lives in ./sweep_util.js
// (imported at the top) so it is unit-testable under plain node — index.js itself is not
// node-importable (@forge/resolver's `new Resolver()` throws outside the Forge runtime).

// Shared deletion of a generation job's stored content + ALL sibling keys (the pageJob:
// reconnect index, job:, jobmeta:, pagesnap:, the per-user tracked-list entry, and the
// tcjob:/testcases:/tcregenjob: test-case keys). Used by purgeJob (on push) AND the
// scheduled orphan sweep (after inactivity). Faithful to the original purgeJob deletion:
// core deletes (job/jobmeta/pagesnap) throw on failure (→ the caller's catch); the
// tracked-list + tc sweeps fail-open into `degraded`. Records NO diagnostics — returns
// { degraded, tcInFlight, tcOwner } so the CALLER owns the ledger write (purge-on-push
// records tracking_degraded for an in-flight TC run; the sweep does not).
async function deleteJobKeys(jobId, job, accountId) {
  let degraded = false;
  let tcInFlight = false;
  let tcOwner = null;
  if (job && job.pageId) {
    // Clear the page→job reconnect index ONLY if it still points at THIS job (purging a
    // SUPERSEDED job must NOT blow away a newer job's reconnect index).
    const pageRef = await kvs.get(`${PAGE_JOB_PREFIX}${String(job.pageId)}`).catch(() => null);
    if (pageRef && pageRef.jobId === jobId) {
      await kvs.delete(`${PAGE_JOB_PREFIX}${String(job.pageId)}`);
    }
  }
  await kvs.delete(`${JOB_KEY_PREFIX}${jobId}`);
  // pagesnap: holds a full source-page copy (~180KB) — the privacy-critical item.
  await kvs.delete(`${PAGE_SNAP_PREFIX}${jobId}`);
  // plan: holds a generated sprint plan (feature names + LLM rationale = content) — core privacy
  // tier like pagesnap (throws → caller's catch → purge_incomplete / sweep retry). Ledger UX-3.
  await kvs.delete(`${PLAN_KEY_PREFIX}${jobId}`);
  // planjob: any in-flight ranking-batch record (carries feature names too) — same core tier.
  await kvs.delete(`${PLAN_BATCH_PREFIX}${jobId}`);
  // drop from the per-user tracked list (best-effort; getDashboardJobs also prunes dead refs).
  try {
    if (accountId) {
      const trackedKey = `${TRACKED_JOBS_PREFIX}${accountId}`;
      const tj = await kvs.get(trackedKey);
      if (Array.isArray(tj)) {
        const next = tj.filter((j) => j.jobId !== jobId);
        if (next.length !== tj.length) await kvs.set(trackedKey, next);
      }
    }
  } catch (cjErr) {
    degraded = true;
    console.warn(`[deleteJobKeys] tracked-jobs filter failed (non-fatal): ${String(cjErr?.message || cjErr)} ref=${jobId}`);
  }
  // test-case KVS entries (control + per-story + per-story-regen), bounded by the HIGH-WATER total.
  try {
    const tcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`);
    if (tcJob) {
      tcInFlight = tcJob.status === 'batched' || tcJob.status === 'pending';
      tcOwner = tcJob.ownerAccountId || null;
      const sweepTo = Math.max(
        typeof tcJob.total === 'number' ? tcJob.total : 0,
        Number.isFinite(tcJob.maxTotal) ? tcJob.maxTotal : 0,
      );
      if (sweepTo > 0) {
        const perStoryKeys = Array.from({ length: sweepTo }, (_, i) => `${TC_STORY_KEY_PREFIX}${jobId}:${i}`);
        await Promise.all(perStoryKeys.map((k) => kvs.delete(k).catch(() => { degraded = true; })));
      }
      const regenCount = Math.max(
        Array.isArray(tcJob.stampedStories) ? tcJob.stampedStories.length : 0,
        sweepTo, // old-tail regen control records too
      );
      if (regenCount > 0) {
        const regenKeys = Array.from({ length: regenCount }, (_, i) => `${TC_REGEN_KEY_PREFIX}${jobId}:${i}`);
        await Promise.all(regenKeys.map((k) => kvs.delete(k).catch(() => { degraded = true; })));
      }
    }
    await kvs.delete(`${TC_JOB_KEY_PREFIX}${jobId}`);
  } catch (tcErr) {
    degraded = true;
    console.warn(`[deleteJobKeys] tc KVS purge failed (non-fatal): ${String(tcErr?.message || tcErr)} ref=${jobId}`);
  }
  // ⭐ jobmeta: is the sweep's SOLE enumeration key → delete it LAST and ONLY if everything else
  // succeeded (deep-audit fix). A throwing core delete above aborts before here, and any fail-open
  // miss sets `degraded` → either way jobmeta SURVIVES, so the next daily sweep re-finds the job and
  // retries (self-healing; KVS delete is idempotent). Deleting jobmeta early would orphan a
  // failed-to-delete sibling (e.g. the 180KB pagesnap) un-refindably forever — the exact leak this
  // ordering prevents. purgeJob keeps its diagnostics (purge_incomplete on degraded). NOTE: a degraded
  // purge KEEPS jobmeta → getDashboardJobs (reads jobmeta first) may show a phantom "ready" row until
  // the next sweep (≤7d) or tracked-list cap-eviction; clicking it → not_found → Ready (non-destructive).
  // The bounded cosmetic phantom strictly dominates the un-refindable 180KB pagesnap leak.
  if (!degraded) await kvs.delete(`${JOB_META_PREFIX}${jobId}`);
  return { degraded, tcInFlight, tcOwner };
}

// Index: page id → latest generation jobId. Lets a reopened page reconnect to an
// in-flight batch (getGenerationStatus) instead of showing Ready + spawning a
// duplicate batch. Written by startGeneration; read by getGenerationStatus.
const PAGE_JOB_PREFIX = 'pageJob:';

// Per-page memory of the last-chosen Project Context profile, so re-generating the
// same page pre-selects the same profile (the "easy" half of dynamic context).
// Written by startGeneration (fail-soft); read by getContextProfiles.
const PAGE_CONTEXT_PREFIX = 'pageCtx:';

// NOTE: generation uses the Anthropic Message Batches API (polled via
// pollJobStatus); push is a CHUNKED resolver (startPush + UI-looped pushStep,
// one bounded JIRA batch per call). Neither uses @forge/events queues anymore —
// asUser() is unavailable in async consumers (AUTH_TYPE_UNAVAILABLE 2026-05-30).

// ── Test-case generation KVS key prefixes ─────────────────────
// tcjob:<jobId>               — control record (batch lifecycle + stampedStories)
// testcases:<jobId>:<idx>     — per-story result (result + coverage, or error sentinel)
// tcregenjob:<jobId>:<idx>    — per-story single-regen control (mirrors tcjob)
// KVS sizes: tcjob holds control + lean stampedStories {idx,name,acceptance_criteria};
//   ~1-2KB/story → ~40-80KB at 39 stories, well under 240KB (#10).
//             per-story ~2-4KB, well within 240KB. No TTL (matches breakdown job —
//             test cases must survive reconnect as long as the breakdown does).
const TC_JOB_KEY_PREFIX = 'tcjob:';
const TC_STORY_KEY_PREFIX = 'testcases:';
const TC_REGEN_KEY_PREFIX = 'tcregenjob:';
const PAGE_SNAP_PREFIX = 'pagesnap:'; // §8 fix (2026-06-06): source-page snapshot for test-gen, in a sibling key (keeps the job record lean)

// Load the source-page snapshot for test-case generation (§8 fix). Returns the raw page text when a
// COHERENT snapshot exists (its page version matches the breakdown's, so the rules the tests mine are
// the SAME ones the stamped ACs were authored against), else '' (→ submitTestCaseBatch falls back to
// today's no-source behaviour). Fail-soft — a miss/throw never blocks test-gen.
async function resolveSpecSourceText(jobId, job) {
  try {
    const snap = await kvs.get(`${PAGE_SNAP_PREFIX}${jobId}`);
    if (!snap || !snap.content) {
      // Diagnostic (NOT silent): a breakdown generated BEFORE the §7 fix was deployed has no
      // snapshot, so test-gen falls back to no-source. Re-running test-gen alone on an old
      // breakdown won't enable §7 — the snapshot is written at GENERATION, so REGENERATE the
      // breakdown after deploying the fix. This log makes a Live-E2E run diagnosable.
      console.log(`[tcgen] NO source-page snapshot for job ${jobId} → test-gen runs WITHOUT §7 rules (regenerate the breakdown after deploying the §7 fix to enable concrete-value + decision-table coverage) ref=${jobId}`);
      return '';
    }
    if (job && typeof job.pageVersion === 'number' && typeof snap.pageVersion === 'number' && snap.pageVersion !== job.pageVersion) {
      console.warn(`[tcgen] page snapshot version ${snap.pageVersion} != job ${job.pageVersion} — skipping source (fallback to no-source) ref=${jobId}`);
      return '';
    }
    console.log(`[tcgen] source-page snapshot loaded for job ${jobId} (${String(snap.content).length} chars) → §7 rules fed to test-gen`);
    return String(snap.content || '');
  } catch (e) {
    console.warn(`[tcgen] spec-source load failed (non-fatal): ${String(e?.message || e)} ref=${jobId}`);
    return '';
  }
}


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

/**
 * Normalize stored settings into a clean Project Context profiles array.
 * Migrates a legacy P1 single `projectContext` string (read-time, non-destructive)
 * into one "Default" profile so existing installs keep their context seamlessly.
 * @returns {Array<{id:string,name:string,context:string}>}
 */
function normalizeContextProfiles(settings) {
  const s = settings || {};
  if (Array.isArray(s.contextProfiles)) {
    return s.contextProfiles
      .filter((p) => p && typeof p === 'object')
      .map((p) => ({
        id: String(p.id || ''),
        name: String(p.name || ''),
        context: String(p.context || ''),
      }))
      .filter((p) => p.id && (p.name || p.context));
  }
  const legacy = String(s.projectContext || '').trim();
  if (legacy) return [{ id: 'default', name: 'Default', context: legacy }];
  return [];
}

/**
 * Validate the contextProfiles array from the Settings UI (server-authoritative).
 * Returns { ok, value } where value is the cleaned array, or undefined when the
 * field was not provided at all (leave existing profiles untouched). { ok:false,
 * error } on a bad profile. Drops fully-empty rows; assigns/dedupes stable ids.
 */
function validateContextProfiles(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (!Array.isArray(raw)) return { ok: false, error: 'Project Context profiles must be a list.' };
  if (raw.length > MAX_CONTEXT_PROFILES) {
    return { ok: false, error: `Too many Project Context profiles (max ${MAX_CONTEXT_PROFILES}).` };
  }
  const out = [];
  const seenIds = new Set();
  for (const p of raw) {
    const name = String(p?.name || '').trim();
    const context = String(p?.context || '').trim();
    if (!name && !context) continue; // drop blank rows (e.g. an unfilled "add")
    if (!name) return { ok: false, error: 'Each Project Context profile needs a name.' };
    if (name.length > CONTEXT_PROFILE_NAME_MAX) {
      return { ok: false, error: `Profile name too long (max ${CONTEXT_PROFILE_NAME_MAX} characters).` };
    }
    if (context.length > PROJECT_CONTEXT_MAX_CHARS) {
      return {
        ok: false,
        error: `Profile "${name}" context is too long (${context.length}/${PROJECT_CONTEXT_MAX_CHARS}). Use "Distill with Claude" to condense it.`,
      };
    }
    let id = String(p?.id || '').trim();
    if (!id || seenIds.has(id)) id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    seenIds.add(id);
    out.push({ id, name, context });
  }
  return { ok: true, value: out };
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
    // Named Project Context profiles (full, with text) for the admin editor. Legacy
    // single-field installs are migrated read-time into one "Default" profile.
    contextProfiles: normalizeContextProfiles(s),
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
    return { ok: false, error: 'Custom fields must be a JSON object mapping field IDs to values.' };
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
resolver.define('saveSettings', async ({ payload, context }) => {
  const { anthropicApiKey, defaultProjectKey, requiredCustomFieldsJson, contextProfiles } = payload || {};

  // Validate project key
  const cleanProjectKey = (defaultProjectKey || '').trim().toUpperCase();
  if (!cleanProjectKey) {
    return { error: 'Jira Project Key is required' };
  }
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(cleanProjectKey)) {
    return {
      error:
        'Jira Project Key must be 2–10 characters, start with a letter, only uppercase letters and digits (e.g., PROJ, SCRUM2)',
    };
  }

  // Validate optional custom-fields JSON (fail fast so the admin fixes it now,
  // не discovers it as а push failure later).
  const cfRaw = (requiredCustomFieldsJson || '').trim();
  const cfParse = parseRequiredCustomFields(cfRaw);
  if (!cfParse.ok) {
    return { error: cfParse.error };
  }

  // Validate Project Context profiles (server-authoritative; the UI mirrors the caps).
  const cpParse = validateContextProfiles(contextProfiles);
  if (!cpParse.ok) {
    return { error: cpParse.error };
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
  // Persist profiles only when the UI sent them (undefined = not provided → leave
  // as-is). Drop the legacy single-field once migrated forward into profiles.
  if (cpParse.value !== undefined) {
    next.contextProfiles = cpParse.value;
    delete next.projectContext;
  }
  if (apiKeyUpdated) {
    next.apiKeyLastSetAt = new Date().toISOString();
  }

  // Guard the AGGREGATE serialized size before writing: per-profile caps don't bound
  // the total, and non-ASCII (e.g. Cyrillic/CJK in a multilingual context) is 2-4 UTF-8
  // bytes/char, so a maxed config could exceed the ~240KB KVS value cap. Reject with a
  // clear message rather than letting kvs.set throw and silently lose the edits (§11).
  const sizeBytes = new TextEncoder().encode(JSON.stringify(next)).length;
  if (sizeBytes > SETTINGS_MAX_BYTES) {
    return {
      error: `These settings are too large to store (${Math.round(sizeBytes / 1024)} KB; limit ~${Math.round(SETTINGS_MAX_BYTES / 1024)} KB). Shorten or remove some Project Context profiles and try again.`,
    };
  }
  try {
    await kvs.set(SETTINGS_KEY, next);
  } catch (e) {
    console.error(`[saveSettings] kvs.set failed: ${String(e?.message || e)}`);
    // [diag Phase 5, §7-deferred] the PARTIAL-COMMIT window: when a new API key was just
    // stored above (apiKeyUpdated), this failed settings write leaves the secret committed
    // but the metadata/profiles not — the user retries against a half-applied state.
    // counts.key_updated distinguishes that case from a plain settings-write failure.
    // surfaced:true — the structured error return below IS the user-facing surfacing.
    await recordDiagnostic({
      context,
      record: {
        op: 'settings.save',
        error_class: 'kvs_write_failed',
        level: 'warn',
        ref: null,
        counts: { key_updated: apiKeyUpdated ? 1 : 0 },
        surfaced: true,
      },
    });
    return { error: 'Could not save settings (storage error). Try shortening your Project Context profiles, then save again.' };
  }

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
resolver.define('testConnection', async ({ payload, context }) => {
  // payload may include { anthropicApiKey } when testing a key BEFORE save
  const candidateKey = (payload?.anthropicApiKey || '').trim() || null;
  const result = await anthropicTestConnection(candidateKey);

  if (result.ok) {
    return {
      status: 'ok',
      message: `Connected to Anthropic API (${result.model})`,
    };
  }

  // [diag Phase 4, A4] A storage FAULT on the stored-key read (anthropic_client returns the
  // new key_storage_failed code; it cannot record itself — no resolver context there). OUR
  // class to track: the admin did everything right. The codeMap below intentionally has no
  // entry → falls to UNEXPECTED; the honest detail text is shown verbatim by the UI.
  if (result.error === 'key_storage_failed') {
    console.error('[testConnection] stored-key read FAULTED (storage, not "no key") ref=-');
    await recordDiagnostic({
      context,
      record: { op: 'settings.key', error_class: 'key_storage_failed', level: 'error', ref: null, surfaced: true },
    });
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

// ── "Distill with Claude" — 6-call CHUNKED pipeline ─────────────────────────────
// Mirrors the chunked JIRA push (startPushSession/pushSessionStep): startDistillSession
// validates + persists a KVS session; distillStep runs ONE focused category call per
// invocation (the UI loops it 6×). One call per category gives each its own generous
// token budget, so no category is starved by another — the fix for the single call's
// depth-first category drops (8/8 vs 5/8, 2026-06-02 Haiku bake-off). Each call is small
// (~3-13s), well under the 25-sec resolver limit. Consumes NO breakdown quota. The content
// is NEVER logged (keeps "Log End-User Data: No" true).

// Map a distillCategory backend error code → the UI's friendly ERROR_MESSAGES code.
// Shared by both distill resolvers (same shape the old single-call resolver used).
function mapDistillError(result) {
  const codeMap = {
    not_configured: 'NOT_CONFIGURED',
    network_failure: 'BACKEND_UNREACHABLE',
    auth_rejected: 'BACKEND_AUTH_FAILED',
    insufficient_credits: 'INSUFFICIENT_CREDITS',
    rate_limited: 'RATE_LIMITED',
  };
  return { error: result.error, code: codeMap[result.error] || 'UNEXPECTED', detail: result.detail };
}

/**
 * startDistillSession — begin a 6-step distill. Validates + clips the input, persists a
 * KVS session, and returns the session id + the category labels so the UI can show
 * progress. The UI then loops distillStep(step=0..5) until { done: true }.
 *
 * Returns { sessionId, totalSteps, categories } OR { error, code, detail }.
 */
resolver.define('startDistillSession', async ({ payload, context }) => {
  const text = (payload?.text || '').trim();
  if (!text) return { error: 'empty', code: 'UNEXPECTED', detail: 'Nothing to distill.' };

  // Distill (Project Context) is an Anthropic call too — resolve the key by tier
  // so Managed installs (no BYOK key) distill with OUR key, BYOK with theirs.
  const { apiKey, keySource, keyFault } = await resolveAnthropicKey(context);
  if (!apiKey) {
    // [diag Phase 4, A4] storage-fault FIRST: a thrown secret read must not be misdiagnosed
    // as "no key configured" (keyFault is BYOK-only, so this never masks managed_unavailable).
    // ref:null — no distill sessionId exists yet at this gate.
    if (keyFault) {
      await recordDiagnostic({
        context,
        record: { op: 'distill.step', error_class: 'key_storage_failed', level: 'error', ref: null, surfaced: true },
      });
      return { error: 'key_storage_failed', code: 'UNEXPECTED', detail: KEY_STORAGE_FAILED_DETAIL };
    }
    if (keySource === 'managed') {
      console.error('[distill] managed key unavailable (MANAGED_ANTHROPIC_KEY not configured)');
      return { error: 'managed_unavailable', code: 'NOT_CONFIGURED', detail: 'The Managed service is temporarily unavailable. Please contact support@spec2jira.com, or switch to your own Anthropic API key in Settings.' };
    }
    return { error: 'not_configured', code: 'NOT_CONFIGURED', detail: 'Anthropic API key not configured. Save your key first.' };
  }

  // §13 security-review fix: Managed distill spends OUR key but has no breakdown
  // counter of its own → gate it on the per-USER fair-use cap (MANAGED_USER_CAP) so
  // it cannot run on our key once this user is over their monthly cap. BYOK
  // distill on the customer's own key → no gate. Fail-OPEN on a check glitch (never
  // block a payer). NOTE (accepted 2026-06-03, partner decision): distill UNDER the
  // cap is gated-but-not-consumed — a low-risk residual (cheap Haiku, requires a
  // paid seat); add a dedicated distill cap only if abuse is ever observed.
  if (keySource === 'managed') {
    try {
      const q = await checkQuota(context);
      if (!q.allowed) {
        return { error: 'managed_unavailable', code: 'NOT_CONFIGURED', detail: `You've used this month's Managed breakdowns — summarizing is paused until ${q.resetsAtLabel}. For unlimited, switch to BYOK Pro (your own key).` };
      }
    } catch (e) {
      console.error(`[distill] managed pool check failed (allowing): ${String(e?.message || e)} ref=-`);
      // [deep-audit P4 F4] the THIRD silent fail-open gate (license/quota at the two
      // generation flows already record) — a persistent metering glitch silently
      // admits Managed distill on OUR key; support must be able to see it happened.
      await recordDiagnostic({
        context,
        record: { op: 'distill.step', error_class: 'gate_fail_open', level: 'warn', ref: null, surfaced: false },
      });
    }
  }

  // Clip once, at session start, so every per-category call sees the SAME bounded input
  // (the focused calls re-clip defensively too, but clipping here keeps the KVS session
  // small and the input stable across steps).
  const clipped = text.length > DISTILL_MAX_INPUT_CHARS;
  const input = clipped ? text.slice(0, DISTILL_MAX_INPUT_CHARS) : text;

  // newSessionId pattern mirrors push_handler.newSessionId (crypto.randomUUID with a
  // Date.now()+random fallback — the resolver runtime allows timestamps; push sessions
  // use them).
  const sessionId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const session = { input, clipped, sections: {}, createdAt: Date.now() };
  // [diag Phase 5, §7-deferred] this session write used to throw OPAQUELY out of the
  // resolver (the FE catch showed a raw invoke error). Structured return instead; the
  // AdminSettings distill flow handles {error} returns (shows detail, offers retry).
  try {
    await kvs.set(DISTILL_SESSION_PREFIX + sessionId, session);
  } catch (e) {
    console.error(`[distill] session write failed: ${String(e?.message || e)} ref=${sessionId}`);
    await recordDiagnostic({
      context,
      record: { op: 'distill.step', error_class: 'kvs_write_failed', level: 'warn', ref: sessionId, surfaced: true },
    });
    return { error: 'kvs_write_failed', detail: 'Could not store the distill session in Forge storage. Please try again.' };
  }

  console.log(`[distill] session ${sessionId} started (${input.length} chars${clipped ? ', input clipped' : ''}, ${DISTILL_CATEGORIES.length} steps)`);

  return {
    sessionId,
    totalSteps: DISTILL_CATEGORIES.length,
    categories: DISTILL_CATEGORIES.map((c) => c.label),
  };
});

/**
 * distillStep — run ONE category of a distill session. The UI loops this with
 * step = 0..5. On the LAST step, merges all 6 sections (in category order) into one
 * profile, bounds it to PROJECT_CONTEXT_MAX_CHARS via trimToBudget (so the user can still
 * hand-edit the draft), deletes the session, and returns the profile.
 *
 * Returns one of:
 *   - mid-pipeline: { done:false, step, totalSteps, label, nextLabel }
 *   - final:        { done:true,  step, totalSteps, label, profile, truncated }
 *   - per-step err: { error, code, detail, step, label }  (session kept so the UI can retry)
 */
resolver.define('distillStep', async ({ payload, context }) => {
  const sessionId = payload?.sessionId;
  const step = Number(payload?.step);
  if (!sessionId) return { error: 'no_session', code: 'UNEXPECTED', detail: 'No distill session id.' };
  if (!Number.isInteger(step) || step < 0 || step >= DISTILL_CATEGORIES.length) {
    return { error: 'bad_step', code: 'UNEXPECTED', detail: `Invalid distill step ${payload?.step}.` };
  }

  const key = DISTILL_SESSION_PREFIX + sessionId;
  const s = await kvs.get(key);
  if (!s) {
    return { error: 'session_not_found', code: 'UNEXPECTED', detail: 'Distill session expired or not found. Start over.' };
  }

  const { apiKey, keySource, keyFault } = await resolveAnthropicKey(context);
  if (!apiKey) {
    // [diag Phase 4, A4] storage-fault FIRST (see startDistillSession). ref = the distill
    // sessionId — the §1 schema's distill correlation id (a real minted id: the session
    // was just loaded above). Session is KEPT so the UI can retry this step.
    if (keyFault) {
      await recordDiagnostic({
        context,
        record: { op: 'distill.step', error_class: 'key_storage_failed', level: 'error', ref: sessionId, surfaced: true },
      });
      return { error: 'key_storage_failed', code: 'UNEXPECTED', detail: KEY_STORAGE_FAILED_DETAIL, step, label: DISTILL_CATEGORIES[step].label };
    }
    if (keySource === 'managed') {
      console.error('[distill] managed key unavailable (MANAGED_ANTHROPIC_KEY not configured)');
      return { error: 'managed_unavailable', code: 'NOT_CONFIGURED', detail: 'The Managed service is temporarily unavailable. Please contact support@spec2jira.com, or switch to your own Anthropic API key in Settings.', step, label: DISTILL_CATEGORIES[step].label };
    }
    return { error: 'not_configured', code: 'NOT_CONFIGURED', detail: 'Anthropic API key not configured. Save your key first.', step, label: DISTILL_CATEGORIES[step].label };
  }

  const category = DISTILL_CATEGORIES[step];

  let result;
  try {
    result = await distillCategory({ text: s.input, category, apiKey });
  } catch (e) {
    console.error(`[distill] step ${step} (${category.key}) threw: ${String(e?.message || e)} ref=${sessionId}`);
    // [Q2 fix] the unexpected-throw twin of the API-rejection record below — durable
    // trace for support (we don't know the class → unknown_error; detail → zone-2).
    await recordDiagnostic({
      context,
      record: { op: 'distill.step', error_class: 'unknown_error', level: 'error', ref: sessionId, surfaced: true },
    });
    await writeDiagnosticDetail({ ref: sessionId, text: String(e?.message || e) });
    return { error: 'distill_exception', code: 'UNEXPECTED', detail: String(e?.message || e), step, label: category.label };
  }
  if (result.error) {
    // [Q2 fix — Managed-Pro durability] a per-category Anthropic failure (esp. auth_rejected
    // on OUR Managed key, or insufficient_credits/rate_limited/network) used to be a
    // TRANSIENT FE-only message — nothing in the ledger, gone when the user closed the app.
    // Record it so support has a durable trace. Class via the shared mapper; the verbatim
    // detail rides zone-2 (consent-gated), never the content-free record.
    const { error_class, counts } = classifyDiagGenerationError(result.error);
    await recordDiagnostic({
      context,
      record: { op: 'distill.step', error_class, level: 'error', ref: sessionId, ...(counts ? { counts } : {}), surfaced: true },
    });
    await writeDiagnosticDetail({ ref: sessionId, text: String(result.detail || result.error) });
    // Keep the session so the UI can retry THIS step with the same sessionId.
    return { ...mapDistillError(result), step, label: category.label };
  }

  // Persist this section. Track per-section truncation so the UI can nudge "expand".
  s.sections[category.key] = { text: result.section, truncated: !!result.truncated };
  // [diag Phase 5, §7-deferred] same opaque-throw fix as startDistillSession: the section
  // write failing means THIS step's output was not persisted — structured per-step error
  // (session KEPT, the FE retry handle re-runs this step; one repeated Haiku call, correct
  // semantics — the unsaved section must be re-extracted).
  try {
    await kvs.set(key, s);
  } catch (e) {
    console.error(`[distill] section write failed (step ${step}): ${String(e?.message || e)} ref=${sessionId}`);
    await recordDiagnostic({
      context,
      record: { op: 'distill.step', error_class: 'kvs_write_failed', level: 'warn', ref: sessionId, surfaced: true },
    });
    return { error: 'kvs_write_failed', detail: 'Could not store the distill session in Forge storage. Please try again.', step, label: category.label };
  }

  const isLast = step === DISTILL_CATEGORIES.length - 1;
  if (!isLast) {
    return {
      done: false,
      step,
      totalSteps: DISTILL_CATEGORIES.length,
      label: category.label,
      nextLabel: DISTILL_CATEGORIES[step + 1].label,
    };
  }

  // Last step → merge all sections in category order, bound to the store limit, clean up.
  const ordered = DISTILL_CATEGORIES.map((c) => s.sections[c.key]).filter((x) => x && x.text);
  // [diag Phase 4, (I) — worst offender #12] A category absent/EMPTY at the FINAL MERGE means
  // the merged profile silently lost a whole section (§8 starvation — e.g. missing Conventions)
  // with no marker anywhere. Diff EXPECTED (DISTILL_CATEGORIES) vs PRESENT non-empty sections;
  // record a warn (the ledger carries the COUNT only — codes/counts wall) and return the
  // dropped labels as an ADDITIVE response field for the Phase 5 surface (the labels are OUR
  // OWN fixed category names — Domain/Glossary/… — never user content). The merged profile
  // itself is NEVER marked: it is user-editable content.
  const droppedCategories = DISTILL_CATEGORIES
    .filter((c) => !(s.sections[c.key] && s.sections[c.key].text))
    .map((c) => c.label);
  if (droppedCategories.length > 0) {
    console.warn(`[distill] merged profile is MISSING ${droppedCategories.length}/${DISTILL_CATEGORIES.length} categories (${droppedCategories.join(', ')}) ref=${sessionId}`);
    await recordDiagnostic({
      context,
      record: {
        op: 'distill.step',
        error_class: 'distill_category_dropped',
        level: 'warn',
        ref: sessionId,
        counts: { dropped: droppedCategories.length },
        surfaced: false,
      },
    });
  }
  let profile = ordered.map((x) => x.text).join('\n');
  const anyTruncated = ordered.some((x) => x.truncated);
  let trimmed = false;
  if (profile.length > PROJECT_CONTEXT_MAX_CHARS) {
    profile = trimToBudget(profile, PROJECT_CONTEXT_MAX_CHARS);
    trimmed = true;
  }
  try { await kvs.delete(key); } catch (_) {}

  // Length only — NEVER the content (privacy; keeps "Log End-User Data: No" true).
  console.log(`[distill] session ${sessionId} merged ${ordered.length}/${DISTILL_CATEGORIES.length} sections → ${profile.length} chars${trimmed ? ', trimmed to fit' : ''}${anyTruncated ? ', a section hit its token cap' : ''}`);

  return {
    done: true,
    step,
    totalSteps: DISTILL_CATEGORIES.length,
    label: category.label,
    profile,
    truncated: anyTruncated,    // a section hit its per-call token cap (slightly short, but complete-ish)
    overflowTrimmed: trimmed,   // the MERGED profile exceeded the store bound → its TAIL was cut (honest, not "concise")
    droppedCategories,          // [diag Phase 4 (I)] additive — [] when complete; OUR fixed category labels, for the Phase 5 surface
  };
});

/**
 * List Project Context profiles for the generation-flow selector (lean: id + name
 * only — the context text stays server-side). Page-aware: returns the remembered
 * selection for this page so a re-run pre-selects it. A remembered profile that was
 * since deleted falls back to null (→ "None"); an explicit prior "none" is kept.
 * Returns { profiles: [{id, name}], selectedProfileId: string|null }.
 */
resolver.define('getContextProfiles', async ({ payload }) => {
  const s = await loadSettings();
  const profiles = normalizeContextProfiles(s).map((p) => ({ id: p.id, name: p.name }));

  let selectedProfileId = null;
  const pageId = payload?.pageId;
  if (pageId) {
    try {
      const remembered = await kvs.get(`${PAGE_CONTEXT_PREFIX}${String(pageId)}`);
      const rid = remembered?.profileId;
      if (rid === 'none') selectedProfileId = 'none';
      else if (rid && profiles.some((p) => p.id === rid)) selectedProfileId = rid;
    } catch (_) {
      /* best-effort — selector just defaults to None */
    }
  }
  return { profiles, selectedProfileId };
});

// ════════════════════════════════════════════════════════════
// CONFLUENCE PAGE PICKER — preserved от v2.x (Forge-native)
// ════════════════════════════════════════════════════════════

const RECENT_PAGES_KEY = 'spec2jira_recent_pages';
const LAST_SELECTED_KEY = 'spec2jira_last_selected_page';
const MAX_RECENT_PAGES = 10;
// (multi-batch dashboard) per-USER tracked-jobs list — EVERY job the user fires (not just
// completions), so the picker dashboard shows in-progress + ready + failed after the user
// fires several and leaves. Keyed by accountId (reuse usage.js :u:<accountId>), capped,
// prepend + dedupe-by-page; stores only lightweight refs (never a breakdown — KVS ~240KB).
// The job: record is the source of truth for live status; this list is just the id-set to
// check. (Generalizes the earlier per-install "completed jobs" queue — one list, now written
// at startGeneration instead of only on completion → fire-3-and-leave shows all 3.)
// NOTE (deliberate mixed model): this dashboard list is per-USER (the vision is per-user
// isolation), while RECENT_PAGES_KEY/LAST_SELECTED_KEY stay per-INSTALL (legacy, shared) —
// not an oversight; re-keying the recent list is out of scope.
const TRACKED_JOBS_PREFIX = 'spec2jira_tracked_jobs:u:';
const MAX_TRACKED_JOBS = 10;
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
    return { error: 'Search failed', detail: 'Couldn\'t search Confluence right now. Try again in a moment; if it persists, contact support@spec2jira.com.' };
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
      console.error(`[searchPages] Confluence 403 (scope mismatch?): ${text.substring(0, 200)}`);
      return {
        error: 'Confluence 403 — scope mismatch?',
        detail: 'Couldn\'t search Confluence (permission error). Ask your Confluence admin to re-authorize Spec2Tickets, or contact support@spec2jira.com.',
      };
    }
    console.error(`[searchPages] Confluence HTTP ${response.status}: ${text.substring(0, 300)}`);
    return {
      error: `Confluence ${response.status}`,
      detail: 'Couldn\'t read this Confluence page (Confluence returned an error). Try reopening the page; if it persists, contact support@spec2jira.com.',
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
    console.error(`[searchPages] parse failed: ${String(e?.message || e)}`);
    return { error: 'Parse failed', detail: 'Couldn\'t search Confluence right now. Try again in a moment; if it persists, contact support@spec2jira.com.' };
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

// (multi-batch dashboard) helper — record a FIRED job into the per-USER tracked-jobs list.
// Mirrors recordPageSelection (prepend + dedupe + cap). Dedupe by PAGE (not jobId) so
// re-generating the same page REPLACES its stale row — one latest job per page. Called at
// startGeneration (every fired job is tracked from submit, so a user who fires several and
// leaves sees them all). Caller wraps best-effort/fail-soft. accountId scopes the list per
// user (reuse usage.js :u:<accountId>); 'unknown' is the safe fallback bucket.
async function recordTrackedJob(accountId, { jobId, pageId, pageTitle }) {
  if (!jobId || !pageId) return;
  const key = `${TRACKED_JOBS_PREFIX}${accountId || 'unknown'}`;
  const stringPageId = String(pageId);
  const entry = {
    jobId,
    pageId: stringPageId,
    pageTitle: pageTitle || 'Untitled',
    trackedAt: new Date().toISOString(),
  };
  const current = await kvs.get(key);
  const list = Array.isArray(current) ? current : [];
  const filtered = list.filter((j) => j.pageId !== stringPageId);
  const next = [entry, ...filtered].slice(0, MAX_TRACKED_JOBS);
  await kvs.set(key, next);
}

// getDashboardJobs — the picker's live multi-batch dashboard. A PURE READ of the capped
// per-USER tracked list: each ref is dereferenced (lean jobmeta first, heavy job: as the
// back-compat fallback) for the LIVE status so the frontend can group rows into
// In progress / Ready for review / Needs attention. Rows whose records are gone are
// FILTERED AT READ ONLY — the deep-audit removed both the supersede-prune and the
// self-heal write (they dropped a co-worker's in-flight job via the shared page index).
// A glitch returns an empty dashboard, never an error. The frontend reconcile loop
// advances batched→completed by calling pollJobStatus per in-flight row; this resolver
// just reports the current truth.
resolver.define('getDashboardJobs', async ({ context }) => {
  const accountId = (context && context.accountId) || 'unknown';
  const key = `${TRACKED_JOBS_PREFIX}${accountId}`;
  // [diag Phase 5, §7-deferred] this top-list read was the ONE unwrapped throw behind the
  // docstring's "never an error" claim — now actually true. The record fires ONLY on the
  // THROW path (rare; the null-ref (op, class) dedupe absorbs repeats from the 15s reconcile
  // loop); NO write of any kind on the happy path (the read-meter lesson).
  let list;
  try {
    list = await kvs.get(key);
  } catch (e) {
    console.warn(`[getDashboardJobs] tracked-list read failed (returning empty dashboard): ${String(e?.message || e)}`);
    await recordDiagnostic({
      context,
      record: { op: 'dashboard.read', error_class: 'kvs_read_failed', level: 'warn', ref: null, surfaced: false },
    });
    return { jobs: [] };
  }
  if (!Array.isArray(list) || list.length === 0) return { jobs: [] };
  // PURE READ (deep-audit fix). Dereference each ref against its job: record for LIVE status;
  // drop a ref whose job is gone (purged/lost). Two things this DELIBERATELY no longer does:
  //   1. NO supersede-prune against PAGE_JOB_PREFIX — that index is shared PER-INSTALL, but this
  //      list is per-USER, so pruning against it dropped a user's OWN in-flight job whenever a
  //      co-worker regenerated the same page (deep-audit MED, cross-user coupling). Same-page
  //      supersession for the SAME user is already handled at WRITE time by recordTrackedJob's
  //      dedupe-by-page; a stale/superseded ref here is simply filtered (never shown) and ages
  //      out via the cap, and the click routes by the row's OWN jobId so it can't open the wrong job.
  //   2. NO self-heal write — a read-modify-write here raced a concurrent recordTrackedJob across
  //      the same user's two tabs and could clobber a just-fired job out of the list (deep-audit
  //      LOWs). Keeping this a pure read removes that race entirely; dead refs cost only a filtered
  //      deref per sweep and are evicted by the cap.
  const checked = await Promise.all(
    list.map(async (ref) => {
      // Read the LEAN jobmeta (~100B) instead of dereferencing the full job: record (~240KB) — the
      // KVS read-throughput optimization. Back-compat: a job created before jobmeta existed has no
      // meta → a one-off heavy deref (READ-ONLY, no backfill — preserves the pure-read invariant; it
      // self-extinguishes as old jobs complete (their next setJob writes jobmeta) or age out of the cap).
      let meta = await kvs.get(`${JOB_META_PREFIX}${ref.jobId}`).catch(() => null);
      if (!meta) {
        const job = await kvs.get(`${JOB_KEY_PREFIX}${ref.jobId}`).catch(() => null);
        if (!job) return null; // purged/lost → filtered (never shown)
        meta = { status: job.status, pageTitle: job.pageTitle, startedAt: job.submittedAt || job.createdAt };
      }
      return {
        jobId: ref.jobId,
        pageId: ref.pageId,
        pageTitle: ref.pageTitle || meta.pageTitle || 'Untitled',
        status: meta.status, // live: pending | batched | completed | failed
        startedAt: meta.startedAt || ref.trackedAt,
      };
    }),
  );
  return { jobs: checked.filter(Boolean) };
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
    return { error: 'permission_denied', detail: 'You do not have permission to view this page' };
  }
  if (!response.ok) {
    const text = await response.text();
    console.error(`[fetchPage] Confluence HTTP ${response.status}: ${text.substring(0, 300)}`);
    return { error: `confluence_${response.status}`, detail: 'Couldn\'t read this Confluence page (Confluence returned an error). Try reopening the page; if it persists, contact support@spec2jira.com.' };
  }

  const data = await response.json();
  // [S7 fix] Confluence SOFT-deletes to trash → the v2 GET returns a trashed/archived
  // page with HTTP 200 + content + status:'TRASHED'/'ARCHIVED' (not 404). Without this
  // guard a deleted page opened + generated a breakdown from stale content. Reject
  // anything but a live 'current' page (case-insensitive — the v2 API returns the enum
  // UPPER_CASE despite the lowercase docs). Read is already LIVE (no KVS cache) — this is
  // the missing status check, not a caching fix.
  if (data.status && String(data.status).toLowerCase() !== 'current') {
    return {
      error: 'page_not_available',
      detail: 'This page is no longer available (it may have been moved to the trash or archived in Confluence). Pick another page.',
    };
  }
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

// Bound the per-cycle resolution calls — each is a sync LLM call and pollJobStatus
// runs under the 25-sec resolver limit. Real breakdowns have 0-2 cycles; this is a
// runaway guard, not an expected ceiling. Cycles beyond it (or that the model
// can't confidently resolve) are surfaced as spec_concerns rather than left silent.
const MAX_CYCLE_RESOLVES = 3;

/**
 * Verify the cross-feature dependency graph is acyclic; auto-resolve each cycle by
 * cutting the softest edge (a tiny LLM call), and surface anything unresolved as a
 * spec_concern. Mutates `breakdown.features[].dependencies` + `breakdown.spec_concerns`
 * in place. Fail-safe — the caller wraps it so generation never fails on repair.
 */
async function verifyAndRepairCycles(breakdown, apiKey, model) {
  const features = breakdown?.features;
  if (!Array.isArray(features) || features.length === 0) return;

  let cycles = detectCycles(features); // pure, deterministic, exhaustive
  if (cycles.length === 0) return;
  console.log(`[cycle] detected ${cycles.length} dependency cycle(s)`);

  const byName = new Map(features.map((f) => [f.name, f]));
  const concerns = [];
  const cutEdges = new Set();     // "from→to" already cut — never cut a reverse (would over-cut a mutual pair)
  const unresolvable = new Set(); // node-set signatures already surfaced as NOT auto-resolved (loop guard)
  const sigOf = (p) => [...p].sort().join('|');
  let resolves = 0;

  // Process ONE live cycle at a time, RE-DETECTING after each cut. detectCycles returns every cycle of
  // the CURRENT graph (deduped by node-set), but a single cut can break SEVERAL overlapping cycles (a
  // mutual A↔B pair, or a 3-node knot seen from different entry nodes). Re-detecting after each cut means
  // we only ever cut a STILL-LIVE cycle, and the cutEdges guard refuses to cut a reverse edge — together
  // preventing the over-cutting + contradictory concerns the old stale-list `for` loop produced
  // (deep-audit 2026-06-07: a mutual RBP↔ACD pair had BOTH directions cut and emitted 3 mutually-
  // contradictory [RISK|low] concerns for what was ~1 real resolution — an incoherent audit trail).
  while (resolves < MAX_CYCLE_RESOLVES) {
    const path = cycles.find((c) => !unresolvable.has(sigOf(c)));
    if (!path) break; // no live cycle left that we haven't already judged unresolvable
    const label = `${path.join(' → ')} → ${path[0]}`;

    let cut = null;
    if (apiKey) {
      const involved = path.map((n) => byName.get(n)).filter(Boolean);
      try {
        const r = await resolveDependencyCycle({ cyclePath: path, features: involved, apiKey, model });
        if (r && !r.error && !r.uncertain && r.cut_from && r.cut_to) cut = r;
      } catch (e) {
        console.error(`[cycle] resolve threw: ${String(e?.message || e)}`);
      }
    }

    const f = cut && byName.get(cut.cut_from);
    const edgeLive = f && Array.isArray(f.dependencies) && f.dependencies.includes(cut.cut_to);
    const reverseAlreadyCut = cut && cutEdges.has(`${cut.cut_to}→${cut.cut_from}`);

    if (edgeLive && !reverseAlreadyCut) {
      f.dependencies = f.dependencies.filter((d) => d !== cut.cut_to);
      cutEdges.add(`${cut.cut_from}→${cut.cut_to}`);
      resolves++;
      console.log('[cycle] auto-resolved a dependency cycle (cut the softer edge)');
      // Surface WHAT was cut (deterministic) + hand the JUDGEMENT to the BA. We intentionally do NOT
      // print the LLM's `cut.reason` prose: the edge CHOICE is meaning-reading (legitimately the LLM's),
      // but its free-text rationale can make a checkably-wrong factual claim about a business rule, which
      // an expert BA/PO catches and which then taints trust in the whole breakdown (deep-audit 2026-06-07).
      concerns.push(
        `[RISK|low] Circular dependency auto-resolved: dropped the "${cut.cut_from}" → "${cut.cut_to}" blocker to break a dependency cycle. Review whether this is the right edge to remove.`,
      );
      cycles = detectCycles(features); // the cut may have broken other listed cycles — re-detect
      continue;
    }

    // Couldn't safely auto-resolve THIS cycle (no key / uncertain / invalid edge / cutting it would
    // remove both directions of a mutual pair). Surface it once + mark it so the loop never repeats it.
    concerns.push(
      `[RISK|medium] Circular dependency detected but NOT auto-resolved: ${label}. Break it manually before relying on blocks-links for sprint sequencing.`,
    );
    unresolvable.add(sigOf(path));
  }

  // Budget exhausted (or no apiKey) with cycles still live → surface the remainder honestly (deduped).
  for (const c of cycles) {
    if (!unresolvable.has(sigOf(c))) {
      concerns.push(
        `[RISK|medium] Circular dependency detected but NOT auto-resolved: ${c.join(' → ')} → ${c[0]}. Break it manually before relying on blocks-links for sprint sequencing.`,
      );
      unresolvable.add(sigOf(c));
    }
  }

  if (concerns.length) {
    breakdown.spec_concerns = [...(breakdown.spec_concerns || []), ...concerns];
  }
}

/**
 * Remove shared acceptance criteria that already appear (verbatim, normalized) in
 * a feature's ACs. Such an entry is not a "shared/unassigned" cross-cutting rule —
 * it is a duplicate that shows up redundantly in the Shared-AC assignment panel.
 * Pure + deterministic (exact normalized string match — structure, not meaning);
 * the prompt (rule 12) is the primary defense, this is the safety net. In place.
 */
function dedupeSharedAcceptanceCriteria(breakdown) {
  const shared = breakdown?.shared_acceptance_criteria;
  if (!Array.isArray(shared) || shared.length === 0) return;
  const norm = (s) =>
    String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.;]+$/, '');
  const featureACs = new Set();
  for (const f of breakdown.features || []) {
    for (const ac of f.acceptance_criteria || []) featureACs.add(norm(ac));
  }
  const before = shared.length;
  breakdown.shared_acceptance_criteria = shared.filter((s) => !featureACs.has(norm(s)));
  const removed = before - breakdown.shared_acceptance_criteria.length;
  if (removed > 0) {
    console.log(`[dedupe] removed ${removed} shared AC(s) already present in a feature`);
  }
}

// [diag Phase 3] Generation structured-error code → closed-registry diagnostic class:
// `classifyDiagGenerationError` — MOVED to src/diagnostics.js (Phase-3 contract audit,
// 2026-06-12) so the single owner of class semantics (§2.9) owns the code→class mapping
// and the offline table-test (prototype/test_diagnostics.js §16) can pin every producible
// code. Imported above with the other diagnostics symbols; call sites unchanged (the
// startGeneration submit-failure site, the pollJobStatus terminal sites, and the test-gen
// batch/regen submit + poll-terminal + per-story sites — single mapping authority).

/**
 * Start a breakdown generation job using Anthropic Message Batches API.
 * Returns immediately с jobId after submitting batch (~1-2 sec total).
 * Forge UI polls pollJobStatus за batch lifecycle progress + results.
 *
 * Payload: { pageId, modelMode? }
 *   modelMode: 'primary' (Sonnet 4.6, default) | 'fallback' (Haiku 4.5)
 */
resolver.define('startGeneration', async ({ payload, context }) => {
  const { pageId, modelMode, contextProfileId } = payload || {};
  if (!pageId) return { error: 'No page ID' };

  // Defensive license gate (NEW 2026-06-03). A Paid-via-Atlassian app admits only
  // licensed users by default, so this should never fire in practice — but if a
  // truly-unlicensed invocation reaches the backend (no subscription, no trial),
  // return a clean license_required prompt instead of a misleading not_configured
  // ("no BYOK key" — wrong; the real issue is no license). Fail-open: a license-read
  // glitch must not block a paying user (the key check + Atlassian's platform gate
  // are the backstops).
  try {
    if (getActiveTier(context).key === 'unlicensed') {
      return buildLicenseRequired();
    }
  } catch (e) {
    console.error(`[startGeneration] license check failed (failing open): ${String(e?.message || e)} ref=-`);
    // [diag Phase 3, gate MUST-1] a silent fail-open gate: a persistent license-read
    // fault admits work with only a console trace. ref:null (pre-jobId) — the
    // (op, error_class) null-ref dedupe absorbs repeats into occurrences.
    await recordDiagnostic({
      context,
      record: { op: 'generation.start', error_class: 'gate_fail_open', level: 'warn', ref: null, surfaced: false },
    });
  }

  // Resolve the Anthropic key by tier (Managed/Advanced ⇒ our key; else the
  // customer's BYOK key). Done BEFORE the content fetch (fail fast) AND before the
  // quota gate, so a Managed user — who has no BYOK key by design — is never
  // wrongly told to "configure a key". keySource is stored on the job below so
  // the poll leg reuses the SAME key the batch was created with.
  const { apiKey, keySource, keyFault } = await resolveAnthropicKey(context);
  if (!apiKey) {
    // [diag Phase 4, A4 — worst offender #2] storage-fault FIRST: the stored-key READ threw,
    // so "not configured" would be a misdiagnosis (the key may still be saved — support used
    // to chase the wrong cause). keyFault is BYOK-only → never masks managed_unavailable.
    // ref:null — pre-jobId, same as the other start gates.
    if (keyFault) {
      console.error('[startGeneration] stored-key read FAULTED (storage, not "no key") ref=-');
      await recordDiagnostic({
        context,
        record: { op: 'generation.start', error_class: 'key_storage_failed', level: 'error', ref: null, surfaced: true },
      });
      return { error: 'key_storage_failed', detail: KEY_STORAGE_FAILED_DETAIL };
    }
    if (keySource === 'managed') {
      console.error('[startGeneration] managed key unavailable (MANAGED_ANTHROPIC_KEY not configured) ref=-');
      // [diag Phase 3, gate SHOULD] OUR-ops outage signal (the env var is ours to
      // keep configured) — the one Managed failure class where support must act,
      // so the ledger must carry it.
      await recordDiagnostic({
        context,
        record: { op: 'generation.start', error_class: 'managed_unavailable', level: 'error', ref: null, surfaced: true },
      });
      return {
        error: 'managed_unavailable',
        detail:
          'The Managed service is temporarily unavailable. Please contact support@spec2jira.com, or switch to your own Anthropic API key in Settings.',
      };
    }
    return {
      error: 'not_configured',
      detail:
        'Anthropic API key not configured. Ask your Confluence admin to open Settings → Spec2Tickets and provide an Anthropic API key.',
    };
  }

  // Record install provenance (grandfathering signal — see usage.js
  // recordFirstSeen). A second durable capture point besides getUsage: it
  // survives any future UI refactor that drops the usage badge. Idempotent
  // (earliest wins) and fail-open — never block a generation over a metering glitch.
  try {
    const seen = await recordFirstSeen();
    if (seen?.created) {
      console.log(`[install] first seen at ${seen.firstSeenAt} (grandfathering signal recorded via startGeneration)`);
    }
  } catch (e) {
    console.error(`[startGeneration] firstSeen record failed (non-fatal): ${String(e?.message || e)}`);
  }

  // Tier/usage gate (P3a). Fail OPEN — a metering glitch must never block a user.
  // BYOK Pro → unlimited; Managed Pro → per-user fair-use cap (quota_exceeded when
  // over, governed by ENFORCEMENT_MODE — 'meter' never blocks). Unlicensed is
  // already short-circuited above (license_required), so a !allowed here is the
  // Managed cap. The counter is consumed AFTER a successful batch submit below, so
  // a failed submit never burns quota.
  let quota = null;
  try {
    quota = await checkQuota(context);
    if (!quota.allowed) {
      return buildQuotaExceeded(quota);
    }
  } catch (e) {
    console.error(`[startGeneration] quota check failed (failing open): ${String(e?.message || e)} ref=-`);
    // [diag Phase 3, gate MUST-1] the second silent fail-open gate (Managed cap
    // can be silently bypassed on a metering glitch — customer-favourable, but
    // support must be able to see it happened).
    await recordDiagnostic({
      context,
      record: { op: 'generation.start', error_class: 'gate_fail_open', level: 'warn', ref: null, surfaced: false },
    });
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
    // [diag Phase 3, gate SHOULD] op confluence.fetch — pre-jobId (ref:null);
    // network/auth throw on the page read.
    await recordDiagnostic({
      context,
      record: { op: 'confluence.fetch', error_class: 'network_failure', level: 'error', ref: null, surfaced: true },
    });
    return { error: 'fetch_threw', detail: String(e?.message || e) };
  }
  if (!pageFetch.ok) {
    const text = await pageFetch.text();
    console.error(`[startGeneration] Confluence HTTP ${pageFetch.status}: ${text.substring(0, 300)} ref=-`);
    // [diag Phase 3, gate SHOULD] a recurring 403/410 on the page read is a real
    // support class (scope/egress/permissions) — content-free status only.
    await recordDiagnostic({
      context,
      record: {
        op: 'confluence.fetch',
        error_class: 'confluence_http',
        level: 'error',
        ref: null,
        counts: { http_status: pageFetch.status },
        surfaced: true,
      },
    });
    return {
      error: `confluence_${pageFetch.status}`,
      detail: 'Couldn\'t read this Confluence page (Confluence returned an error). Try reopening the page; if it persists, contact support@spec2jira.com.',
    };
  }
  const pageData = await pageFetch.json();
  // [S7 fix — defense-in-depth] same trashed/archived guard as fetchPage: refuse to
  // generate (and submit a billed batch + write a pagesnap) against a soft-deleted page
  // that Confluence still serves with HTTP 200. Covers the trash-between-open-and-generate
  // window too. Live read; status check, not a cache fix.
  if (pageData.status && String(pageData.status).toLowerCase() !== 'current') {
    return {
      error: 'page_not_available',
      detail: 'This page is no longer available (it may have been moved to the trash or archived in Confluence). Pick another page.',
    };
  }
  const pageContent = pageData.body?.storage?.value || '';
  // Capture the Confluence page version at generation time (v2 returns
  // version: { number }). Threaded onto the job record → getResults so the UI can
  // detect a breakdown generated against an older page version and offer Regenerate
  // (stale-page banner). Number only — never content (keeps "Log End-User Data: No").
  // Fail-soft: an absent/unparseable version yields undefined → the UI shows NO
  // false "edited" banner on missing data (never breaks generation).
  const pageVersion =
    typeof pageData.version?.number === 'number' ? pageData.version.number : undefined;
  if (pageContent.length < 50) {
    return {
      error: 'page_too_small',
      detail: `Page content is too short to extract a meaningful breakdown (${pageContent.length} chars)`,
    };
  }

  const jobId = newJobId();
  const pageTitle = pageData.title || 'Untitled';
  const model = modelMode === 'fallback' ? MODEL_FALLBACK : MODEL_PRIMARY;
  // Diagnostics owner stamp (Phase 0, design §2.4): job-scoped diagnostic events bucket to
  // the JOB OWNER's ledger — polls are payload-only and may be driven by ANOTHER user's
  // client (shared pageJob: index), so bucket-by-invoker would file failures under the wrong
  // user. Stamped on EVERY full job-record rewrite in this resolver (the 'failed'/'batched'
  // writes below are fresh literals, not spreads — a stamp only on the initial write would be
  // erased). Nothing reads it yet (Phase 5 will); it must simply persist.
  const ownerAccountId = (context && context.accountId) || null;

  // Persist initial job state.
  // [diag Phase 0, §3 site :1273] This write runs BEFORE the billed Anthropic submit — a KVS
  // failure must stay FAIL-FAST (no money spent yet; today's throw at least aborted first),
  // but STRUCTURED instead of an opaque resolver death.
  try {
    await setJob(jobId,{
      jobId,
      pageId: String(pageId),
      pageTitle,
      pageVersion,
      ownerAccountId,
      status: 'pending',
      model,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[diag] initial job write failed ref=' + jobId, e);
    await recordDiagnostic({
      context,
      record: { op: 'generation.start', error_class: 'kvs_write_failed', level: 'error', ref: jobId, surfaced: true },
    });
    return {
      error: 'kvs_write_failed',
      detail:
        'Could not store the generation job in Forge storage. Please try again — if it persists, contact support@spec2jira.com.',
      // (deep-audit F5, both lenses) the ledger record above is filed under this
      // jobId — give the ErrorScreen the ref to correlate (App.js consumes job_id).
      job_id: jobId,
    };
  }
  // Index page → this job so reopening mid-generation reconnects (not a new batch).
  // [diag Phase 0, §3 site :1283] Fail-soft: on a KVS failure the job still works via the
  // per-user dashboard — only page-reconnect degrades. Record + continue.
  try {
    await kvs.set(`${PAGE_JOB_PREFIX}${String(pageId)}`, { jobId });
  } catch (e) {
    console.error('[diag] pageJob index write failed ref=' + jobId, e);
    await recordDiagnostic({
      context,
      record: { op: 'generation.start', error_class: 'kvs_write_failed', level: 'warn', ref: jobId, surfaced: false },
    });
  }

  // §8 fix (2026-06-06): snapshot the source page into a SIBLING key so per-Story test-case
  // generation can feed the spec's business-rule tables + decision matrices + concrete thresholds
  // (the values the ACs reference by ID). A sibling key (not the job record) keeps the job lean —
  // the job is read on every poll/reconnect; this snapshot is read once, only at test-gen. Captured
  // in THIS execution from the SAME page object → coherent with the breakdown's stamped ACs (no
  // staleness). Byte-capped under the ~240KB KVS limit. Fail-soft: a snapshot failure must never
  // block generation (test-gen then falls back to today's no-source behaviour).
  try {
    // Cap by BYTES, not chars (§13 gate fix 2026-06-06): KVS limits the serialized value to ~240KB,
    // and a char cap overflows on multi-byte scripts — Cyrillic ~2B, CJK ~3B/char, so 120K chars ≈
    // 240-360KB → kvs.set throws → silent fallback to no-source on exactly the dense/non-ASCII specs
    // this fix targets. 80K chars aligns with the feed cap (TC_SPEC_SOURCE_MAX_CHARS — storing more is
    // unused); the ~180KB byte budget (headroom under 240KB for the wrapper) is the hard guard.
    const TC_SNAP_MAX_CHARS = 80000;
    const TC_SNAP_MAX_BYTES = 180000;
    const enc = new TextEncoder();
    const full = String(pageContent || '');
    let snapContent = full.slice(0, TC_SNAP_MAX_CHARS);
    if (enc.encode(snapContent).length > TC_SNAP_MAX_BYTES) {
      // Binary-search the largest char-prefix whose UTF-8 byte length fits the budget.
      let lo = 0, hi = snapContent.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (enc.encode(snapContent.slice(0, mid)).length <= TC_SNAP_MAX_BYTES) lo = mid; else hi = mid - 1;
      }
      snapContent = snapContent.slice(0, lo);
    }
    await kvs.set(`${PAGE_SNAP_PREFIX}${jobId}`, {
      jobId,
      pageId: String(pageId),
      pageVersion,
      capturedAt: new Date().toISOString(),
      content: snapContent,
      truncatedSnapshot: full.length > snapContent.length,
    }); // NO TTL (deep audit): purgeJob deletes pagesnap on push; a creation-anchored TTL silently dropped the §7 source for a breakdown reviewed/edited >30 days later
    console.log(`[startGeneration] page snapshot written for job ${jobId} (${snapContent.length} chars${full.length > snapContent.length ? ', byte-trimmed' : ''}) → enables §7-aware test generation`);
  } catch (e) {
    console.warn(`[startGeneration] page snapshot failed (non-fatal; test-gen falls back to no-source): ${String(e?.message || e)} ref=${jobId}`);
    // [diag Phase 3, §2.1 :1312] C-class: test-gen later runs §7-starved (no source spec)
    // with zero signal anywhere — record so support can explain "weaker tests" reports.
    await recordDiagnostic({
      context,
      record: { op: 'generation.start', error_class: 'pagesnap_write_failed', level: 'warn', ref: jobId, surfaced: false },
    });
  }

  // Resolve the SELECTED Project Context profile to enrich the generation. A
  // workspace may span multiple projects, so the user picks which context applies —
  // we never apply one silently (a wrong-project context is worse than none).
  // Fail-soft: a settings/profile glitch must never block a BYOK generation; we just
  // generate from the spec alone.
  let projectContext = '';
  try {
    const settings = await loadSettings();
    const profiles = normalizeContextProfiles(settings);
    if (contextProfileId && contextProfileId !== 'none') {
      const match = profiles.find((p) => p.id === contextProfileId);
      if (match) projectContext = match.context || '';
    }
    // Remember the choice for this page so a re-run pre-selects it (the "easy" half).
    if (contextProfileId) {
      await kvs.set(`${PAGE_CONTEXT_PREFIX}${String(pageId)}`, { profileId: contextProfileId });
    }
  } catch (e) {
    console.warn(`[startGeneration] context profile resolve failed (non-fatal): ${String(e?.message || e)} ref=${jobId}`);
    // [diag Phase 3, §2.1 :1330] C-class: the breakdown silently generates with an EMPTY
    // project context — a quality degradation the user chose against and never sees.
    await recordDiagnostic({
      context,
      record: { op: 'generation.start', error_class: 'context_profile_failed', level: 'warn', ref: jobId, surfaced: false },
    });
  }

  // Submit batch к Anthropic (returns batch_id immediately)
  const submitResult = await submitBreakdownBatch({
    pageTitle,
    pageContent,
    customId: jobId,
    model,
    useCaching: true,
    projectContext,
    apiKeyOverride: apiKey, // Managed ⇒ our key; BYOK ⇒ customer's (see resolveAnthropicKey)
  });

  if (submitResult.error) {
    console.error(
      `[startGeneration] batch submit failed: ${submitResult.error} | ${submitResult.detail} ref=${jobId}`,
    );
    // [diag Phase 3] Record the SUBMIT failure ITSELF (the Phase-0 wrap below records only
    // the bookkeeping-WRITE failure — distinct class, same site). input_too_small is a
    // user-actionable validation outcome (page content too thin after extraction), not a
    // support class — deliberately NOT recorded (page_too_small returns even earlier,
    // before a jobId exists, so it never reaches here; listed for symmetry). Zone-2
    // carries the verbatim detail under the jobId ref. Plain {context, record} — the
    // invoker IS the owner at startGeneration time.
    if (submitResult.error !== 'input_too_small' && submitResult.error !== 'page_too_small') {
      const diagClass = classifyDiagGenerationError(submitResult.error);
      await recordDiagnostic({
        context,
        record: {
          op: 'generation.start',
          error_class: diagClass.error_class,
          level: 'error',
          ref: jobId,
          ...(diagClass.counts ? { counts: diagClass.counts } : {}),
          surfaced: true,
        },
      });
      if (submitResult.detail) {
        await writeDiagnosticDetail({ ref: jobId, text: String(submitResult.detail) });
      }
    }
    // [diag Phase 0, §3 site :1361] Bookkeeping write for an ALREADY-failed submit — a KVS
    // failure here must NEVER mask the original error the user needs to see: record + still
    // return the original structured error below.
    try {
      await setJob(jobId,{
        jobId,
        pageId: String(pageId),
        pageTitle,
        ownerAccountId,
        status: 'failed',
        createdAt: new Date().toISOString(),
        error: submitResult.error,
        detail: submitResult.detail,
      });
    } catch (e) {
      console.error('[diag] failed-state bookkeeping write failed ref=' + jobId, e);
      await recordDiagnostic({
        context,
        owner: ownerAccountId,
        record: { op: 'generation.start', error_class: 'kvs_write_failed', level: 'warn', ref: jobId, surfaced: true },
      });
    }
    return {
      error: submitResult.error,
      detail: submitResult.detail,
      // [diag Phase 5, Phase-3 residual] ADDITIVE: the diagnostic ref. The backend record +
      // zone-2 detail above live under this jobId, but this error return used to carry no
      // id → the ErrorScreen showed no ref. The FE pickup is the parallel frontend change.
      job_id: jobId,
    };
  }

  // Successfully submitted — store batchId с job state.
  // [diag Phase 0, §3 site :1377] This write runs AFTER the billed Anthropic submit — money
  // is spent, so NEVER abort on a KVS failure: record tracking_degraded + proceed to the
  // normal success response (the batch is fine; polling/reconnect degrade until the record
  // self-heals, which without a batchId it won't — that is exactly the support signal).
  let trackingDegraded = false;
  try {
    await setJob(jobId,{
      jobId,
      pageId: String(pageId),
      pageTitle,
      pageVersion,
      ownerAccountId,
      status: 'batched',
      model,
      batchId: submitResult.batchId,
      batchStatus: submitResult.status, // 'in_progress'
      createdAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
      expiresAt: submitResult.expiresAt,
      keySource, // 'managed'|'byok' — the poll/fetch/cycle-repair legs MUST reuse
      //            the SAME key the batch was created with (Anthropic batches are
      //            scoped to the creating key). See pollJobStatus.
    });
  } catch (e) {
    trackingDegraded = true;
    console.error('[diag] batched job write failed ref=' + jobId, e);
    await recordDiagnostic({
      context,
      record: { op: 'generation.start', error_class: 'tracking_degraded', level: 'warn', ref: jobId, surfaced: false },
    });
  }

  // (multi-batch dashboard) track this fired job in the per-user dashboard list so it shows
  // as ⏳ In progress IMMEDIATELY — and flips to ✓ Ready once a poll/reconcile observes its
  // completion (getDashboardJobs reads the live job: status). Best-effort/fail-soft: the
  // job: record above is authoritative; this is an additive index. This is the single write
  // point (the old completion-path write is dropped) → every fired job is tracked from submit.
  try {
    await recordTrackedJob((context && context.accountId) || 'unknown', { jobId, pageId, pageTitle });
  } catch (e) {
    console.warn(`[startGeneration] tracked-jobs index write failed (non-fatal): ${String(e?.message || e)} ref=${jobId}`);
    // [diag Phase 3, §2.1 :1399] C-class: the fired job never appears on the per-user
    // dashboard. Phase 0 records this same class at the batched-write catch — different
    // site, same (ref, op, class) → the dedupe coalesces them into one record with
    // occurrences (documented in design §7, acceptable).
    await recordDiagnostic({
      context,
      record: { op: 'generation.start', error_class: 'tracking_degraded', level: 'warn', ref: jobId, surfaced: false },
    });
  }

  // Consume one unit of quota — only now that the batch submitted successfully
  // (a failed submit above returned early and never reaches here). Throw-safe:
  // the generation already succeeded, so a metering write failure must not break
  // the user's response — log it loudly instead (POLICY §11: never silent).
  let usageInfo = null;
  if (quota) {
    try {
      const used = await consumeQuota(quota.usageKey);
      usageInfo = {
        tier: quota.tier,
        used,
        limit: quota.limit,
        remaining: quota.limit === null ? null : Math.max(0, quota.limit - used),
        resetsAt: quota.resetsAt,
      };
    } catch (e) {
      console.error(`[startGeneration] quota consume failed (generation still OK): ${String(e?.message || e)} ref=${jobId}`);
      // [diag Phase 3, §2.1 :1410] C-class: Managed metering silently under-counts (a
      // revenue signal, invisible to everyone). Same class as the Phase-0 job-write
      // catches — different site, same (ref, op, class) → dedupe merges into
      // occurrences (documented in design §7, acceptable).
      await recordDiagnostic({
        context,
        record: { op: 'generation.start', error_class: 'kvs_write_failed', level: 'warn', ref: jobId, surfaced: false },
      });
    }
  }

  console.log(
    `[startGeneration] jobId=${jobId} batchId=${submitResult.batchId} status=submitted${usageInfo ? ` usage=${usageInfo.used}/${usageInfo.limit}(${usageInfo.tier})` : ''}`,
  );
  return {
    jobId,
    job_id: jobId,
    status: 'batched',
    batchId: submitResult.batchId,
    // [diag Phase 0] additive flag (§3 site :1377): the batch submitted fine but the job
    // record could not be updated — the design's "jobId + tracking_degraded warning".
    // The frontend ignores unknown fields today; a later phase may surface it.
    ...(trackingDegraded ? { tracking_degraded: true } : {}),
  };
});

/**
 * Poll the status of an active generation job.
 * Returns the current job state stored в KVS.
 * Use after startGeneration; UI polls every 3-5 seconds.
 */
resolver.define('pollJobStatus', async ({ payload, context }) => {
  // `context` (Phase 0): recordDiagnostic needs the resolver context for its invoker
  // fallback bucket; job-scoped records pass owner: job.ownerAccountId (§2.4) since this
  // poll may be driven by another user's client via the shared pageJob: index.
  const jobId = payload?.jobId;
  if (!jobId) return { error: 'No job ID' };
  const job = await kvs.get(`${JOB_KEY_PREFIX}${jobId}`);
  if (!job) {
    return { error: 'not_found', detail: `Job ${jobId} not found (may have been purged)` };
  }

  // Reuse the SAME key the batch was created with (Anthropic batches are scoped
  // to their creating key): Managed jobs poll/fetch/repair with OUR key, BYOK
  // with the customer's. job.keySource is stamped at submit; jobs created before
  // this change carry no keySource → default to 'byok' (back-compatible).
  const jobApiKey = await anthropicKeyForSource(job.keySource || 'byok');

  // Terminal states return immediately
  if (job.status === 'completed' || job.status === 'failed') {
    // (deep-audit fix) Re-assert the lean jobmeta mirror from the authoritative job.status. If an
    // earlier best-effort jobmeta write failed AT the terminal transition, jobmeta would be stuck
    // 'batched' → the dashboard strands the row under "In progress" AND stop-idle never stops (the
    // read leak returns). Terminal states never re-transition, so this poll is the only re-sync point.
    try {
      // Task #13: PRESERVE the inactivity timer (don't bump it — this re-assert can fire from a
      // reconcile poll, which must NOT count as "access"). Keep the existing lastAccessedAt; fall
      // back to now only if absent, so the setJob invariant (jobmeta always carries lastAccessedAt)
      // holds at every write site and a swept-too-early silent loss can't sneak in via this path.
      const prevMeta = await kvs.get(`${JOB_META_PREFIX}${jobId}`).catch(() => null);
      await kvs.set(`${JOB_META_PREFIX}${jobId}`, {
        status: job.status,
        pageTitle: job.pageTitle,
        startedAt: job.submittedAt || job.createdAt,
        lastAccessedAt: prevMeta && Number.isFinite(prevMeta.lastAccessedAt) ? prevMeta.lastAccessedAt : Date.now(),
      });
    } catch (_) {}
    return job;
  }

  // Active batch states — poll Anthropic for current status
  if (job.status === 'batched' && job.batchId) {
    // §13 review fix: a Managed job whose server key vanished mid-flight
    // (rotated/unset) must NOT fall through to the customer's BYOK key —
    // anthropicKeyForSource('managed') → null, and pollBatchStatus/fetchBatchResults
    // do `apiKeyOverride || getStoredApiKey()`. Soft-fail (stay 'batched', show a
    // message, retry next cycle → self-heals when the key is restored) instead of a
    // silent wrong-key poll. POLICY §11: never a silent wrong-key path.
    if (job.keySource === 'managed' && !jobApiKey) {
      console.error(`[pollJobStatus] jobId=${jobId} managed key unset mid-flight (MANAGED_ANTHROPIC_KEY) — soft-failing, will retry`);
      return {
        ...job,
        phase: 'Managed service temporarily unavailable — retrying. If this persists, please contact support@spec2jira.com.',
      };
    }

    const pollResult = await pollBatchStatus(job.batchId, jobApiKey);

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
      // (concurrency, deep-audit) Two drivers can poll the SAME job — the dashboard reconcile
      // loop AND the foreground generating-screen poll (e.g. the user clicks a still-running
      // dashboard row → routeByPageStatus resumes a foreground poll while a reconcile
      // `await pollJobStatus` is still in flight). This re-read de-dups only the SERIAL case (a
      // second poll that STARTS after the first already wrote 'completed' below): it returns the
      // finalized job and skips the re-fetch/re-repair. It does NOT close the CONCURRENT case —
      // two polls that both reach here before either writes 'completed' (downstream of
      // fetchBatchResults + the verifyAndRepairCycles LLM) will both re-read 'batched' and both
      // proceed, so on a breakdown WITH a dependency cycle the billed cycle-repair LLM can run
      // twice. ACCEPTED: the result is idempotent (the graph is acyclic+buildable under either
      // writer; last-writer-wins on two valid repairs) and the duplicate is a rare, cycle-gated
      // extra call in a seconds-long window — not worth a 'finalizing'-marker state machine here.
      const fresh = await kvs.get(`${JOB_KEY_PREFIX}${jobId}`).catch(() => null);
      if (fresh && (fresh.status === 'completed' || fresh.status === 'failed')) {
        return fresh;
      }
      if (!pollResult.resultsUrl) {
        const failed = {
          ...job,
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: 'no_results_url',
          detail: 'Batch ended but Anthropic returned no results_url.',
        };
        // [diag Phase 0, §3 site :1545] Bookkeeping write for an ALREADY-failed state — a KVS
        // failure must never mask the original error: record + still return the original below.
        try {
          await setJob(jobId,failed);
        } catch (e) {
          console.error('[diag] failed-state bookkeeping write failed ref=' + jobId, e);
          await recordDiagnostic({
            context,
            owner: job && job.ownerAccountId,
            record: { op: 'generation.poll', error_class: 'kvs_write_failed', level: 'warn', ref: jobId, surfaced: true },
          });
        }
        // [diag Phase 3] ONE record per terminal transition — the UNDERLYING failure (the
        // wrap above records only a bookkeeping-WRITE failure; distinct classes). Owner-
        // bucketed (§2.4): this poll may be driven by another user's client. Zone-2
        // carries the verbatim detail.
        await recordDiagnostic({
          context,
          owner: job && job.ownerAccountId,
          record: { op: 'generation.poll', error_class: 'no_results_url', level: 'error', ref: jobId, surfaced: true },
        });
        if (failed.detail) {
          await writeDiagnosticDetail({ ref: jobId, text: String(failed.detail) });
        }
        return failed;
      }

      const fetchResult = await fetchBatchResults(
        pollResult.resultsUrl,
        jobId, // custom_id ≡ jobId
        jobApiKey, // Managed ⇒ our key (same as submit); BYOK ⇒ customer's
      );

      if (fetchResult.error) {
        // [deep-audit F1 — concurrent 'ended' divergence] the :1898 terminal guard ran
        // BEFORE the ~240KB fetchBatchResults await above — the widest window in this
        // file. A SECOND driver (other tab's reconcile / cross-user pageJob reconnect)
        // may have completed+persisted the job while OUR fetch was failing transiently;
        // writing {...job, status:'failed'} here would CLOBBER that completed record —
        // billed work silently destroyed and masked as failure, never re-fetched (the
        // terminal early-return). Success-vs-failure divergence is NOT covered by the
        // accepted two-success residual → re-read and yield to a completed peer.
        const freshAfterFetch = await kvs.get(`${JOB_KEY_PREFIX}${jobId}`).catch(() => null);
        // Yield to ANY terminal peer (deep-audit P3 — mirror the serial guard):
        // completed = billed work preserved; failed = a peer's terminal may be the
        // SPECIAL kvs_persist_failed stub carrying the "push it now" instructions +
        // approx_bytes evidence — overwriting it with a transient fetch error would
        // degrade the support signal. A terminal is a terminal; this guard sits on
        // the ERROR path only, so local-success-wins is untouched.
        if (freshAfterFetch && (freshAfterFetch.status === 'completed' || freshAfterFetch.status === 'failed')) {
          return freshAfterFetch;
        }
        const failed = {
          ...job,
          status: 'failed',
          completedAt: new Date().toISOString(),
          error: fetchResult.error,
          detail: fetchResult.detail,
          usage: fetchResult.usage || null,
        };
        // [diag Phase 0, §3 site :1564] Same contract as :1545 — never mask the original error.
        try {
          await setJob(jobId,failed);
        } catch (e) {
          console.error('[diag] failed-state bookkeeping write failed ref=' + jobId, e);
          await recordDiagnostic({
            context,
            owner: job && job.ownerAccountId,
            record: { op: 'generation.poll', error_class: 'kvs_write_failed', level: 'warn', ref: jobId, surfaced: true },
          });
        }
        // [diag Phase 3] ONE record per terminal transition — the UNDERLYING fetch/parse
        // failure mapped 1:1 onto the closed registry (results_fetch_<NNN> → anthropic_http
        // + counts.http_status; batch_request_expired → batch_expired; refused/truncated/
        // parse_failed/result_row_missing/network_failure → themselves). Zone-2 carries the
        // verbatim detail under the jobId ref.
        {
          const diagClass = classifyDiagGenerationError(failed.error);
          await recordDiagnostic({
            context,
            owner: job && job.ownerAccountId,
            record: {
              op: 'generation.poll',
              error_class: diagClass.error_class,
              level: 'error',
              ref: jobId,
              ...(diagClass.counts ? { counts: diagClass.counts } : {}),
              surfaced: true,
            },
          });
          if (failed.detail) {
            await writeDiagnosticDetail({ ref: jobId, text: String(failed.detail) });
          }
        }
        return failed;
      }

      // Success — compute cost + persist completed state.
      // ⭐ v6: breakdown ALSO runs via the Batches API (50% of sync rates), so price it
      // batch-rate. This corrects the pre-existing ~2× over-statement of the cost_usd
      // diagnostic below (it is a dev-internal breadcrumb, not user-facing — the value will
      // step DOWN ~50% from this deploy onward; expected, documented in the release notes).
      const costEstimate = estimateCost(fetchResult.usage, fetchResult.model, { batch: true });
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

      // Verify/repair the dependency graph BEFORE persisting: detect cycles
      // (pure) + cut the softest edge per cycle (tiny LLM, bounded) + surface
      // unresolved ones as spec_concerns. A silent cycle breaks downstream sprint
      // sequencing and creates false confidence (§11). Fail-safe — non-fatal.
      try {
        // Cycle-repair LLM call reuses the job's key (Managed ⇒ our key, same as submit).
        await verifyAndRepairCycles(breakdown, jobApiKey, fetchResult.model);
      } catch (e) {
        console.error(`[pollJobStatus] cycle repair failed (non-fatal): ${String(e?.message || e)} ref=${jobId}`);
        // [diag Phase 3, §2.1 :1590] C-class (§11 worst bug): the whole verify pass threw,
        // so a silent dependency cycle may survive into the delivered breakdown — record it
        // so a "Jira sequencing looks wrong" ticket has a cause on file.
        await recordDiagnostic({
          context,
          owner: job && job.ownerAccountId,
          record: { op: 'generation.complete', error_class: 'cycle_repair_failed', level: 'warn', ref: jobId, surfaced: false },
        });
      }

      // Drop shared ACs that duplicate a feature's AC (redundant in the assign
      // panel — rule 12). Pure dedupe; non-fatal.
      try {
        dedupeSharedAcceptanceCriteria(breakdown);
      } catch (e) {
        console.error(`[pollJobStatus] shared-AC dedupe failed (non-fatal): ${String(e?.message || e)}`);
      }

      const completed = {
        ...job,
        status: 'completed',
        completedAt: new Date().toISOString(),
        breakdown,
        usage: fetchResult.usage,
        model: fetchResult.model,
        elapsedMs,
        stop_reason: fetchResult.stop_reason,
        // Partial-recovery flag когато output hit max_tokens but features salvaged.
        ...(fetchResult.truncated
          ? { truncated: true, truncation_note: fetchResult.truncation_note }
          : {}),
      };
      // [diag Phase 0, §3 site :1605-1619 — the §3.1 degraded path] The completed value can
      // exceed the ~240KB KVS value cap on very large pages. Before this wrap, the unhandled
      // throw left the job 'batched' forever: the FE poll catch swallowed it and every 5s tick
      // re-ran the ~240KB results download + the BILLED cycle-repair LLM (when the breakdown
      // has a cycle) — an infinite spinner that re-bills. On persist failure: terminalize with
      // a SMALL failed record (spread `job` — the lean pre-completion record — NEVER
      // `completed`, which is what just failed to fit), record the diagnostic, and hand the
      // breakdown forward INLINE (persistFailed: true) so the user can still review + push it
      // from this tab (push consumes the frontend copy — fully in-memory).
      try {
        await setJob(jobId,completed);
      } catch (persistErr) {
        let approxBytes = 0;
        try {
          // BYTES, not UTF-16 chars (deep-audit F8): .length undercounts ~2× on
          // Cyrillic specs — our own market — against a byte-metered KVS cap; the
          // pagesnap writer 500 lines up already measures with TextEncoder.
          approxBytes = new TextEncoder().encode(JSON.stringify(completed)).length;
        } catch (_) { /* size unknown — keep 0 */ }
        console.error('[diag] completed persist failed ref=' + jobId + ' bytes=' + approxBytes, persistErr);
        // Honest wording split (deep-audit, contract-audit LOW): only assert "too
        // large" when the size actually says so — a transient KVS outage on a small
        // value must not tell the user to split their page.
        const persistLikelySize = approxBytes > 200000;
        // Small terminal record — setJob (not raw kvs.set) so the jobmeta mirror flips the
        // dashboard row to ⚠ and the reconcile stop-idle sees a terminal state. Own try/catch:
        // KVS may be down entirely (outage, not size) — the response below still carries the
        // breakdown forward; the documented residual is a reconcile retry during the outage.
        try {
          await setJob(jobId,{
            ...job,
            status: 'failed',
            error: 'kvs_persist_failed',
            detail: persistLikelySize
              ? 'The generated breakdown was too large to store (~' + Math.round(approxBytes / 1024) + ' KB). Review and push it now — and consider splitting the page into smaller sections for next time.'
              : 'The generated breakdown could not be stored (a storage error — not a size problem). Review and push it now; if this repeats, contact support@spec2jira.com.',
          });
        } catch (terminalErr) {
          console.error('[diag] small terminal write ALSO failed ref=' + jobId + ' (KVS may be down)', terminalErr);
        }
        await recordDiagnostic({
          context,
          owner: job && job.ownerAccountId,
          record: {
            op: 'generation.complete',
            error_class: 'kvs_persist_failed',
            level: 'error',
            ref: jobId,
            // truncated:1 (deep-audit F4): the persistFailed early-return skips the
            // truncation_salvaged record — keep the degradation visible on THIS one.
            counts: { approx_bytes: approxBytes, ...(fetchResult.truncated ? { truncated: 1 } : {}) },
            surfaced: true,
          },
        });
        await writeDiagnosticDetail({ ref: jobId, text: String((persistErr && persistErr.message) || persistErr) });
        console.log(
          `[pollJobStatus] jobId=${jobId} batchId=${job.batchId} COMPLETED-BUT-NOT-PERSISTED features=${(breakdown.features || []).length} elapsed=${elapsedMs}ms — returning results inline (persistFailed)`,
        );
        // Same shape as the normal completed return below (the FE adapter consumes it
        // unchanged: breakdown/usage/model/pageVersion/truncated/truncation_note all ride
        // on `completed`) + persistFailed so the FE skips getResults — which would read the
        // small failed record above and throw the breakdown away.
        return { ...completed, persistFailed: true };
      }

      // [diag Phase 3, design §4 + frozen (D)] Success breadcrumb (info, counts only) — runs
      // ONLY after the completed persist above succeeded (the persistFailed catch returned
      // early). Makes "worked until Tuesday" inferable + gives support a timeline; the §2.6
      // info-first eviction guarantees breadcrumbs can never displace error records.
      await recordDiagnostic({
        context,
        owner: job && job.ownerAccountId,
        record: {
          op: 'generation.complete',
          error_class: 'generation_completed',
          level: 'info',
          ref: jobId,
          // cost_usd (gate row-27): the §2.1 →L "estimateCost computed, never
          // persisted" row — a content-free number; the breadcrumb is its
          // natural durable carrier (the console log was its only home).
          counts: {
            features: (breakdown.features || []).length,
            cost_usd: (costEstimate && costEstimate.total_usd) || 0,
          },
          surfaced: true,
        },
      });
      if (fetchResult.truncated) {
        // [diag Phase 3] Distinct WARN for the salvage degradation — a SECOND record by
        // design (the breadcrumb keeps the timeline; this flags the data loss). The FE's
        // orange truncation banner IS the surfacing. Zone-2 keeps the truncation note.
        await recordDiagnostic({
          context,
          owner: job && job.ownerAccountId,
          record: {
            op: 'generation.complete',
            error_class: 'truncation_salvaged',
            level: 'warn',
            ref: jobId,
            counts: { features: (breakdown.features || []).length },
            surfaced: true,
          },
        });
        if (fetchResult.truncation_note) {
          await writeDiagnosticDetail({ ref: jobId, text: String(fetchResult.truncation_note) });
        }
      }

      // (multi-batch dashboard) NO list write here — the job was added to the per-user tracked
      // list at startGeneration, and getDashboardJobs reads its LIVE status from the job:
      // record (now 'completed'), so it surfaces under ✓ Ready for review automatically. (This
      // replaces the earlier completion-path queue write, which only captured foreground polls.)

      console.log(
        `[pollJobStatus] jobId=${jobId} batchId=${job.batchId} COMPLETED features=${(breakdown.features || []).length} elapsed=${elapsedMs}ms cost=$${costEstimate.total_usd.toFixed(4)}${fetchResult.truncated ? ' [TRUNCATED-PARTIAL]' : ''}`,
      );
      return completed;
    }

    // Unknown batch status
    // [diag Phase 3, §2.1 :1632 — frozen (A)] A status outside the known set never
    // terminalizes, so this branch repeats EVERY poll tick FOREVER (the stuck-job class
    // — and the GeneratingScreen ignores `phase`, so nothing surfaces). Record ONCE:
    // flag the job via setJob (try/catch, console-only) and record only while the flag
    // is unset — a 5s/15s loop × KVS ops must never become a per-tick write storm (the
    // read-meter lesson; if the flag write itself fails, the (ref, op, class) dedupe
    // absorbs the retries). The job DELIBERATELY stays 'batched' — no behavior change.
    if (!job.diagUnknownStatusRecorded) {
      console.warn(`[pollJobStatus] unknown batch status '${pollResult.status}' — recorded once, job stays batched ref=${jobId}`);
      // (deep-audit F2) `job` was read at the resolver top — a pollBatchStatus
      // await sits between; a concurrent driver may have terminalized since.
      // Never let the flag write regress a terminal record to 'batched'.
      let freshFlag = null;
      try {
        freshFlag = await kvs.get(`${JOB_KEY_PREFIX}${jobId}`).catch(() => null);
        if (freshFlag && (freshFlag.status === 'completed' || freshFlag.status === 'failed')) {
          return freshFlag;
        }
      } catch (e) {
        console.error('[diag] unknown-status fresh read failed ref=' + jobId, e);
      }
      // RECORD-then-FLAG (deep-audit P3 NIT-4): the inverse order lost the one-time
      // record forever when the flag write succeeded but the record write failed
      // (the flag blocks every retry). This way a record-write failure leaves the
      // flag unset → the next tick retries; a duplicate is dedupe-absorbed.
      await recordDiagnostic({
        context,
        owner: job && job.ownerAccountId,
        record: { op: 'generation.poll', error_class: 'batch_unknown_status', level: 'error', ref: jobId, surfaced: false },
      });
      try {
        await setJob(jobId, { ...(freshFlag || job), diagUnknownStatusRecorded: true });
      } catch (e) {
        console.error('[diag] unknown-status flag write failed ref=' + jobId, e);
      }
    }
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
  await touchJobAccess(jobId); // Task #13: opening a breakdown for review renews its inactivity timer (never sweep an actively-used job)
  if (job.status === 'failed') {
    return { error: job.error || 'failed', detail: job.detail || 'Job failed' };
  }
  if (job.status !== 'completed') {
    return { error: 'not_ready', detail: `Job status: ${job.status}` };
  }
  // tcStatus: lets the reconnecting frontend know test cases exist without a 2nd round-trip.
  const tcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`).catch(() => null);
  return {
    breakdown: job.breakdown,
    usage: job.usage,
    model: job.model,
    // The Confluence page version this breakdown was generated against (captured by
    // startGeneration). The UI compares it to the page's CURRENT version on reconnect
    // to surface a stale-page banner + Regenerate. undefined for breakdowns created
    // before this was added → the UI treats unknown as "not stale" (no false banner).
    pageVersion: job.pageVersion,
    // Forward the partial-recovery signal so the UI can warn the user that the
    // breakdown is incomplete (output hit the cap and was salvaged). Both are
    // undefined on a normal complete run.
    truncated: job.truncated,
    truncation_note: job.truncation_note,
    // tcStatus: 'none' | 'pending' | 'batched' | 'completed' | 'failed'
    tcStatus: tcJob ? tcJob.status : 'none',
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
  // Reconnect support: map page → its latest job (PAGE_JOB_PREFIX index, written
  // by startGeneration) and report its status so reopening a page resumes the
  // right screen instead of offering a fresh Generate (which spawned a duplicate
  // batch — bug 2026-05-30):
  //   - pending/batched → UI reconnects to the generating screen + resumes poll
  //   - completed       → UI reopens the result (BreakdownEditor + Dashboard signals)
  //   - failed          → { status:'failed', job_id, error } (Phase 0 unmask; consumed by
  //                       the Phase 3 failure card — routeByPageStatus's failed branch
  //                       fetches the detail and renders it on Ready with the diag ref)
  //   - unknown         → 'idle' → fresh Ready screen
  const pageId = payload?.pageId ? String(payload.pageId) : null;
  if (!pageId) return { status: 'idle' };

  const ref = await kvs.get(`${PAGE_JOB_PREFIX}${pageId}`);
  if (!ref || !ref.jobId) return { status: 'idle' };

  const job = await kvs.get(`${JOB_KEY_PREFIX}${ref.jobId}`);
  if (!job) return { status: 'idle' };
  await touchJobAccess(ref.jobId); // Task #13: reconnecting/polling a page renews its inactivity timer

  if (job.status === 'completed') {
    // tcStatus: lets the reconnecting frontend know test cases exist without a 2nd round-trip.
    const tcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${ref.jobId}`).catch(() => null);
    return { status: 'completed', job_id: job.jobId, tcStatus: tcJob ? tcJob.status : 'none' };
  }
  if (job.status === 'pending' || job.status === 'batched') {
    const startedAt = job.submittedAt || job.createdAt;
    const elapsed_seconds = startedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
      : 0;
    return { status: job.status, job_id: job.jobId, elapsed_seconds };
  }
  if (job.status === 'failed') {
    // [diag Phase 0 unmask] A failed job used to map to 'idle' → reconnect/dashboard showed a
    // pristine Ready screen with ZERO failure info. Report the truth so the surfaces can show
    // it (FE today: falls through to Ready, same route as 'idle' — verified; Phase 3 adds the
    // failure card).
    return { status: 'failed', job_id: job.jobId, error: job.error || null };
  }
  return { status: 'idle' };
});

/**
 * getUsage — current month's breakdown usage + tier, for the UI badge / upgrade
 * nudge. Read-only (does not consume). Throw-safe: a metering glitch returns a
 * benign null so the UI can simply hide the badge rather than error.
 */
resolver.define('getUsage', async ({ context }) => {
  // Capture the install's first-seen timestamp (grandfathering signal — see
  // usage.js recordFirstSeen). Independent try/catch so a glitch in one never
  // suppresses the other; getUsage runs on app open, the broadest capture point.
  let firstSeenAt = null;
  try {
    const seen = await recordFirstSeen();
    firstSeenAt = seen?.firstSeenAt || null;
    if (seen?.created) {
      console.log(`[install] first seen at ${seen.firstSeenAt} (grandfathering signal recorded via getUsage)`);
    }
  } catch (e) {
    console.error(`[getUsage] firstSeen record failed (non-fatal): ${String(e?.message || e)}`);
  }
  try {
    const quota = await checkQuota(context);
    return {
      ...quota,
      pricing: pricingTable(),
      // Install provenance for the customer-facing Account panel (the
      // grandfathering signal, surfaced). null until the first capture.
      memberSince: firstSeenAt,
      memberSinceLabel: firstSeenAt ? formatResetDate(firstSeenAt) : null,
    };
  } catch (e) {
    console.error(`[getUsage] failed: ${String(e?.message || e)}`);
    return { error: 'usage_unavailable' };
  }
});

/**
 * purgeJob — data minimization: delete a generation job's stored page content +
 * breakdown (and its page→job index) once it is no longer needed (after the user
 * pushes to JIRA). Best-effort, non-fatal. Backs the privacy policy claim that
 * page content is removed after processing rather than retained indefinitely.
 */
resolver.define('purgeJob', async ({ payload, context }) => {
  const jobId = payload?.jobId;
  const diagJobRef = cleanClientRef(jobId); // [P5 LOW-2] payload id -> strict shape for LEDGER refs only
  if (!jobId) return { ok: false };
  try {
    const job = await kvs.get(`${JOB_KEY_PREFIX}${jobId}`);
    // Shared deletion (same set + fail-open contract as before — see deleteJobKeys).
    const { degraded, tcInFlight, tcOwner } = await deleteJobKeys(jobId, job, (context && context.accountId) || 'unknown');
    // [seams-audit HIGH (c)] honesty record: pushing while a TC batch is still in flight
    // discards a BILLED run (the FE warns at the Create button; the background TC poll now
    // stops quietly) — the ledger keeps the durable trace. Purge-on-PUSH only (the scheduled
    // orphan sweep deletes abandoned jobs and does NOT record this — there was no push to bill against).
    if (tcInFlight) {
      await recordDiagnostic({
        context,
        owner: tcOwner,
        record: { op: 'purge', error_class: 'tracking_degraded', level: 'warn', ref: jobId, counts: { tc_run_discarded: 1 }, surfaced: true },
      });
    }
    // [diag Phase 5, §7-deferred] ONE purge_incomplete per invocation that hit ANY fail-open
    // miss (a flag, not per-section spam): a partial purge leaves content behind, silently
    // eroding the "removed when you push" privacy claim — support must see it.
    if (degraded) {
      await recordDiagnostic({
        context,
        record: { op: 'purge', error_class: 'purge_incomplete', level: 'warn', ref: diagJobRef, surfaced: false },
      });
    }
    console.log(`[purgeJob] removed job ${jobId} (page content + breakdown + test cases) post-push`);
    return { ok: true };
  } catch (e) {
    console.error(`[purgeJob] failed (non-fatal): ${String(e?.message || e)} ref=${jobId}`);
    // The outer catch is itself a fail-open miss — same single coalesced record
    // (recordDiagnostic is fail-open by contract, safe inside this catch).
    await recordDiagnostic({
      context,
      record: { op: 'purge', error_class: 'purge_incomplete', level: 'warn', ref: diagJobRef, surfaced: false },
    });
    return { ok: false };
  }
});

// ════════════════════════════════════════════════════════════
// CAPACITY-SHEET PLANNER — review-only sprint plan (2026-06-19)
// ════════════════════════════════════════════════════════════
//
// Flow: the frontend sends the CURRENT edited breakdown (slim features: _uid/_orig_name/name/
// story_points/complexity_score/priority/dependencies) + the in-app capacity form. The pure-fn core
// (src/planner.js) validates the form (fail-loud, no LLM spend on a bad form — ledger CAP-1), builds
// the uid-keyed dependency graph with push parity, and the ONE advisory LLM call orders the backlog;
// packSprints does all the arithmetic. The plan is persisted (plan:<jobId>) so a reconnect rehydrates
// the BILLED plan and an assumption-only edit re-packs over the CACHED ranking for FREE (ledger UX-2/4).
// v1 is REVIEW-ONLY (no Jira write); the planner is licensed but NOT edition-gated (structurally ready
// behind getActiveTier should it become Advanced-only).

const PLAN_FEATURE_CAP = 300; // bound payload / packing loop / KVS size (a breakdown is dozens; ledger CAP-6 spirit)
const PLAN_SPEC_CONCERN_CAP = 25;   // SN-3: bound the spec-wide concern list fed to the ranker (the prompt re-slices to 10)
const PLAN_CONCERN_CHAR_CAP = 240;  // bound each concern string (a typed concern is a sentence, not a paragraph)
const PLAN_TASK_TYPE_CAP = 40;      // Tier-2: bound the per-feature task-type token list in the persisted lean projection

// Map an rankFeaturesForPlan {error} to an HONEST user-facing note. The planner NEVER hard-fails —
// the deterministic fallback ordering (topo + priority + critical-path) still produces a valid plan
// (ledger LLM-3); this note tells the user the AI prioritization was skipped and how to retry.
function planLlmNote(code) {
  if (typeof code === 'string' && (code.startsWith('http_5') || code.startsWith('anthropic_5') || code.startsWith('results_fetch_5'))) return 'Claude is temporarily unavailable, so the plan is ordered by dependencies and priority. Re-rank to retry.';
  switch (code) {
    case 'http_401':
    case 'auth_rejected': return 'Your Anthropic key was rejected, so the plan is ordered by dependencies and priority — check the key in Settings.';
    case 'http_429':
    case 'rate_limited': return 'Claude is rate-limited right now, so the plan is ordered by dependencies and priority. Re-rank in a moment.';
    case 'http_402':
    case 'insufficient_credits': return 'Your Anthropic account is out of credits, so the plan is ordered by dependencies and priority.';
    case 'network_failure': return 'Claude could not be reached, so the plan is ordered by dependencies and priority. Re-rank to retry.';
    case 'parse_failed': return 'Claude’s prioritization could not be read, so the plan is ordered by dependencies and priority. Re-rank to retry.';
    case 'timeout': return 'Claude took too long to respond, so the plan is ordered by dependencies and priority. Re-rank to retry.';
    case 'batch_not_found':
    case 'batch_request_expired': return 'Claude’s batch expired before it finished, so the plan is ordered by dependencies and priority. Re-rank to retry.';
    default: return 'AI prioritization was unavailable, so the plan is ordered by dependencies and priority.';
  }
}

// precomputedRisk for a CACHED plan (re-pack / what-if): a legacy record persisted `risk` separately;
// new records don't (KVS-footprint dedup) — riskByFeature + specConcernSummary are sibling keys on the
// stored plan, so derive from there. A pre-risk-layer plan has neither → undefined → assemblePlan recomputes.
function riskFromRecord(record) {
  if (record && record.risk) return record.risk;
  if (record && record.plan) return { riskByFeature: record.plan.riskByFeature, specConcernSummary: record.plan.specConcernSummary };
  return undefined;
}

// METHODOLOGY DISPATCH (Kanban v1): the capacity form carries `methodology`. Kanban uses computeThroughput (a
// quarter flow total → a Now/Next/Later reach band); Scrum uses computeCapacity (per-sprint boxes). Default
// 'scrum' for back-compat (old forms/records have no methodology field). SANITIZED to the 2-value allow-list —
// never trust a raw client string deciding which capacity model runs (the P12 objective sanitize pattern).
function planMethodology(form) {
  return (form && form.methodology) === 'kanban' ? 'kanban' : 'scrum';
}
function computePlanCapacity(form) {
  return planMethodology(form) === 'kanban' ? computeThroughput(form) : computeCapacity(form);
}

/**
 * finalizePlanJob — the SINGLE plan-completion point (success OR fallback). Given the batch job record
 * + the ranking (null on ANY LLM failure → deterministic ordering), it recomputes capacity, assembles
 * the plan, persists plan:<jobId>, drops the in-flight planjob: record, and returns the completed
 * response. The planner NEVER hard-fails (ledger LLM-3): a missing/failed ranking still yields a plan.
 */
async function finalizePlanJob(planjob, ranking, usage, llmNote) {
  const capacity = computePlanCapacity(planjob.capacityForm);
  if (!capacity.ok) {
    await kvs.delete(`${PLAN_BATCH_PREFIX}${planjob.jobId}`).catch(() => {});
    return { ok: false, status: 'completed', stage: 'capacity', capacityErrors: capacity.errors, assumptions: capacity.assumptions, warnings: capacity.warnings };
  }
  let plan;
  try {
    // precomputedRisk reuses the compact risk from startPlan (concerns are GONE from planjob.features); the
    // specConcerns fallback covers an in-flight job created by pre-fix code during a deploy window (graceful).
    plan = assemblePlan({ features: planjob.features, capacity, ranking, specConcerns: planjob.specConcerns, precomputedRisk: planjob.risk, methodology: planMethodology(planjob.capacityForm) });
    // §11 self-audit: the skill packer's invariant channel must stay empty. If it ever fires (a packer
    // regression: a feature overflowed a bucket that had room), surface it loudly in the logs (gate finding).
    if (plan && Array.isArray(plan.violations) && plan.violations.length) console.warn(`[plan] packer invariant VIOLATIONS (${plan.violations.length}) — should never happen ref=${planjob.jobId}`);
  } catch (e) {
    console.error(`[plan] finalize assemble threw (non-fatal): ${String(e?.message || e)} ref=${planjob.jobId}`);
    await kvs.delete(`${PLAN_BATCH_PREFIX}${planjob.jobId}`).catch(() => {});
    return { ok: false, status: 'completed', stage: 'plan', error: 'plan_failed', detail: 'The plan could not be computed from this breakdown — please try again.' };
  }
  const usedLlm = !!(plan.ranking && plan.ranking.usedLlm);
  if (!usedLlm && Array.isArray(ranking) && ranking.length && !llmNote) {
    llmNote = 'Claude’s prioritization could not be matched to your features, so the plan is ordered by dependencies and priority.';
  }
  const cost = usage ? estimateCost(usage, planjob.model || MODEL_PRIMARY, { batch: true }) : null; // Batches API = 50%
  const warnings = Array.isArray(planjob.warnings) ? planjob.warnings : [];
  // deep-audit KVS-footprint dedup (2026-06-20): do NOT persist `risk` separately — riskByFeature +
  // specConcernSummary are ALREADY sibling keys on `plan`. Storing them twice pushed a 300-feature
  // skill+risk record to ~263KB > the ~240KB cap (silent persist loss). re-pack/what-if derive
  // precomputedRisk from record.plan (riskFromRecord); a legacy record.risk is still honoured.
  const objective = planjob.objective || 'balanced'; // P12: which objective produced this plan (echo for the drift hint + brief)
  const record = { jobId: planjob.jobId, features: planjob.features, capacityForm: planjob.capacityForm, ranking, usage: usage || null, sourceHash: planjob.sourceHash, plan, assumptions: capacity.assumptions, warnings, llmNote, cost, usedLlm, objective, createdAt: Date.now() };
  try { await kvs.set(`${PLAN_KEY_PREFIX}${planjob.jobId}`, record); } catch (e) { console.warn(`[plan] persist failed (non-fatal): ${String(e?.message || e)} ref=${planjob.jobId}`); }
  await kvs.delete(`${PLAN_BATCH_PREFIX}${planjob.jobId}`).catch(() => {}); // batch lifecycle complete
  await touchJobAccess(planjob.jobId);
  // SELF-DESCRIBING PLAN (reload fix 2026-06-20): every completion return carries the lean features so the
  // FE name-source (result.features) survives a reload/re-pack regardless of the live in-memory breakdown.
  return { ok: true, status: 'completed', plan, features: planjob.features, assumptions: capacity.assumptions, warnings, perSprintCapacityPoints: capacity.perSprintCapacityPoints, sourceHash: planjob.sourceHash, usedLlm, llmNote, cost, objective, methodology: planMethodology(planjob.capacityForm) };
}

/**
 * startPlan — SUBMIT the advisory ranking BATCH (the "Generate plan" / "Re-rank with Claude" action).
 * computeCapacity validates BEFORE any spend. Returns {status:'batched'} immediately; the UI then polls
 * pollPlanStatus until {status:'completed'}. TRANSPORT = Batches API — a sync ranking over a rich backlog
 * exceeds Forge's 25s HARD kill (confirmed live; gotcha #5). A submit failure falls back to a plan now.
 */
resolver.define('startPlan', async ({ payload, context }) => {
  if (getActiveTier(context).key === 'unlicensed') return buildLicenseRequired();
  const { jobId, features, capacityForm, specSummary, specConcerns } = payload || {};
  // P12: the planning OBJECTIVE rides capacityForm.objective. SANITIZE against the frozen allow-list (never
  // trust a raw client string into the prompt) — unknown/missing → 'balanced' (no clause; today's behaviour).
  const PLAN_OBJECTIVE_SET = new Set(PLAN_OBJECTIVES);
  const objective = PLAN_OBJECTIVE_SET.has(capacityForm && capacityForm.objective) ? capacityForm.objective : 'balanced';
  // Kanban v1: 'kanban' → computeThroughput + a Now/Next/Later reach band; default 'scrum' (sprint boxes).
  const methodology = planMethodology(capacityForm);
  const isKanban = methodology === 'kanban';
  // spec-WIDE concerns (SN-3): a bounded, string-only list — passed ONCE to the ranker as plan-level
  // context, NEVER attributed per-feature. Also carried on the job so a fallback/poll finalize keeps it.
  const planSpecConcerns = Array.isArray(specConcerns)
    ? specConcerns.filter((c) => typeof c === 'string' && c.trim()).slice(0, PLAN_SPEC_CONCERN_CAP).map((c) => String(c).slice(0, PLAN_CONCERN_CHAR_CAP))
    : [];
  const list = Array.isArray(features) ? features.slice(0, PLAN_FEATURE_CAP) : [];
  // §11: a backlog OVER the cap is surfaced as a warning, never silently dropped (PLAN-07).
  const truncationWarnings = Array.isArray(features) && features.length > PLAN_FEATURE_CAP
    ? [{ code: 'PLAN_FEATURES_TRUNCATED', message: `Only the first ${PLAN_FEATURE_CAP} features were planned (${features.length} total) — split very large breakdowns into smaller ones.` }]
    : [];

  // CAP-1 short-circuit: a bad form is a typed blocker — render it, fire NO batch.
  const capacity = computePlanCapacity(capacityForm);
  if (!capacity.ok) {
    return { ok: false, stage: 'capacity', capacityErrors: capacity.errors, assumptions: capacity.assumptions, warnings: capacity.warnings };
  }
  // GRAPH-6 empty backlog → nothing to plan, no batch.
  if (list.length === 0) {
    // P12-01: every completion path carries `objective` so the completion-shape invariant holds (the
    // FE reads r.objective for the "Ordered for" line; a missing key would silently read as undefined).
    return { ok: true, status: 'completed', empty: true, plan: null, objective, methodology, assumptions: capacity.assumptions, warnings: capacity.warnings };
  }

  const { apiKey, keyFault, keySource } = await resolveAnthropicKey(context);
  if (keyFault) return { ok: false, stage: 'key', error: 'key_fault', detail: KEY_STORAGE_FAILED_DETAIL };
  if (!apiKey) return { ok: false, stage: 'key', error: 'not_configured', detail: 'Add your Anthropic API key in Settings to generate a plan.' };

  // §8 ranking input (pure). Wrapped so a MALFORMED payload can never throw an unhandled resolver 500.
  try {
    const graph = buildPlannerGraph(list);
    // base topo MUST use the SAME priority tiebreak as assemblePlan (PLAN-13) so the signals shown to the
    // advisory LLM match those in the final plan when a cycle's cut-edge choice depends on the tiebreak.
    const prRank = (id) => priorityRankOf(graph.byId.get(id) || {});
    const base = topoSortAndCycles(graph, () => 0, prRank);
    const signals = computeSchedulingSignals(graph, base.order);
    const sizing = validateSizing(list, (f, i) => graph.idByIndex[i]);
    // Tier-1 risk signals: SAME idOf as the graph/sizing (IR-3) so the compact risk_flags on each row
    // line up with the feature the model ranks. Advisory only — the de-risk-early tiebreak input (§8).
    const riskByFeature = computeRiskSignals(list, (f, i) => graph.idByIndex[i]);
    const rows = buildRankingRows(graph, signals, sizing.points, riskByFeature);
    const totalBacklogPoints = Array.from(sizing.points.values()).reduce((a, b) => a + b, 0);
    const globals = isKanban ? {
      // Kanban: no sprint boxes — give the advisory ranker the quarter throughput total vs backlog (what won't
      // fit). The ranking is methodology-agnostic (it only ORDERS); these globals just inform the deferral calls.
      totalCapacity: capacity.expectedPointsQuarter,
      totalBacklogPoints,
      deficitPoints: Math.max(0, totalBacklogPoints - capacity.expectedPointsQuarter),
      objective,
      methodology, // C3 (deep-audit): the prompt's capacity-context label reads "Quarter throughput" (not "across all sprints") for kanban
    } : {
      sprintCount: capacity.perSprintCapacityPoints.length,
      perSprintCapacityPoints: capacity.perSprintCapacityPoints,
      totalCapacity: capacity.totalCapacityPoints,
      totalBacklogPoints,
      deficitPoints: Math.max(0, totalBacklogPoints - capacity.totalCapacityPoints),
      objective, // P12: the ranking prompt reads globals.objective → the abstract goal clause
      methodology, // 'scrum' here → the prompt keeps the existing "Total capacity across all sprints" label (byte-identical)
    };
    const planWarnings = [...capacity.warnings, ...truncationWarnings];
    // deep-audit (2026-06-20): a duplicate _uid makes buildPlannerGraph disambiguate to `uid#i`, which then
    // can't join the push's plain-_uid created_issues → those features land in noJiraKey (surfaced, not
    // silent, but they won't assign to a Jira sprint). _uid is FE-minted-unique, so this is malformed input;
    // warn LOUDLY at the boundary (PlanDiagnostics also shows duplicateUids) so the cause is clear up front.
    if (Array.isArray(graph.duplicateUids) && graph.duplicateUids.length) {
      planWarnings.push({ code: 'DUPLICATE_FEATURE_IDS', message: `${graph.duplicateUids.length} feature(s) share an internal id — they’re planned but may not assign to Jira sprints. Regenerate the breakdown to fix.` });
    }
    // ⭐ KVS-footprint fix (gate HIGH 2026-06-20): risk is computed HERE, once, from the upstream concerns.
    // The persisted job/plan records carry the COMPACT risk (riskByFeature + spec-wide summary) + a LEAN
    // feature projection (heavy concerns / user_story DROPPED) — at the 300-feature cap the full-concern
    // features were ~816KB > the ~240KB KVS value cap → silent persist loss. finalize / re-pack reuse this
    // precomputed risk (assemblePlan never re-reads concerns), so the band stays identical (IR-2).
    const planRisk = { riskByFeature: Object.fromEntries(riskByFeature), specConcernSummary: summarizeSpecConcerns(planSpecConcerns) };
    const leanFeatures = list.map((f) => ({
      _uid: f._uid, _orig_name: f._orig_name, name: f.name,
      story_points: f.story_points, complexity_score: f.complexity_score,
      priority: f.priority, dependencies: Array.isArray(f.dependencies) ? f.dependencies : [],
      // confidence_indicator kept (deep-audit RISK-01): ~1 byte/feature, so the deploy-window risk FALLBACK
      // (when an in-flight pre-fix job has no precomputedRisk) computes the low-confidence signal correctly.
      confidence_indicator: f.confidence_indicator,
      // Tier-2: keep the compact task-type tokens so re-pack / what-if recompute skill demand (light — a
      // few enum tokens/feature; the heavy concerns/user_story are still dropped for the KVS cap).
      task_types: Array.isArray(f.task_types) ? f.task_types.slice(0, PLAN_TASK_TYPE_CAP) : [],
    }));
    const planjob = { jobId, features: leanFeatures, capacityForm, sourceHash: planSourceHash(list), warnings: planWarnings, model: MODEL_PRIMARY, keySource: keySource || 'byok', risk: planRisk, objective, methodology };

    // Submit the ranking batch (advisory). A submit failure → produce the deterministic plan NOW (never block).
    const submit = await submitPlanRankingBatch({ rows, globals, specSummary: specSummary || '', specConcerns: planSpecConcerns, customId: jobId, apiKey, model: MODEL_PRIMARY });
    if (submit.error) {
      console.warn(`[startPlan] batch submit failed (${submit.error}) → deterministic fallback ref=${jobId}`);
      return await finalizePlanJob(planjob, null, null, planLlmNote(submit.error));
    }

    // Store the in-flight batch record (keySource stamped once, reused by poll — gotcha). UI polls pollPlanStatus.
    const batchRecord = { ...planjob, batchId: submit.batchId, status: 'batched', batchStatus: submit.status, submittedAt: Date.now(), expiresAt: submit.expiresAt };
    try { await kvs.set(`${PLAN_BATCH_PREFIX}${jobId}`, batchRecord); } catch (e) { console.warn(`[startPlan] planjob persist failed (non-fatal): ${String(e?.message || e)} ref=${jobId}`); }
    await touchJobAccess(jobId);
    return { ok: true, status: 'batched', planJobId: jobId, sourceHash: planjob.sourceHash, assumptions: capacity.assumptions, warnings: planWarnings, perSprintCapacityPoints: capacity.perSprintCapacityPoints, methodology };
  } catch (e) {
    console.error(`[startPlan] plan pipeline threw (non-fatal): ${String(e?.message || e)} ref=${jobId}`);
    return { ok: false, stage: 'plan', error: 'plan_failed', detail: 'The plan could not be computed from this breakdown — please try again or adjust the breakdown.' };
  }
});

/**
 * pollPlanStatus — the UI loops this after a 'batched' startPlan. Polls the ranking batch; on 'ended'
 * it fetches + finalizes (assemble + persist). On a hard batch error OR a key loss it falls back to the
 * deterministic plan (never-hard-fails). Reuses the same key the batch was created with (keySource).
 */
resolver.define('pollPlanStatus', async ({ payload, context }) => {
  if (getActiveTier(context).key === 'unlicensed') return buildLicenseRequired();
  const { jobId } = payload || {};
  let planjob;
  try { planjob = await kvs.get(`${PLAN_BATCH_PREFIX}${jobId}`); } catch (_) { planjob = null; }

  if (!planjob || !planjob.batchId) {
    // No in-flight batch → maybe it already completed (e.g. a concurrent poll finalized it).
    let done; try { done = await kvs.get(`${PLAN_KEY_PREFIX}${jobId}`); } catch (_) { done = null; }
    if (done && done.plan) {
      await touchJobAccess(jobId);
      return { ok: true, status: 'completed', plan: done.plan, features: done.features, assumptions: done.assumptions, warnings: done.warnings, sourceHash: done.sourceHash, usedLlm: done.usedLlm, llmNote: done.llmNote, cost: done.cost, objective: done.objective || 'balanced', methodology: planMethodology(done.capacityForm) }; // G1 (deep-audit): top-level methodology parity with the other completion paths (latent race-trap close)
    }
    return { ok: true, status: 'idle' };
  }

  const elapsed = Math.round((Date.now() - (planjob.submittedAt || Date.now())) / 1000);
  const jobKey = await anthropicKeyForSource(planjob.keySource || 'byok');
  if (!jobKey) return await finalizePlanJob(planjob, null, null, planLlmNote('not_configured')); // key vanished → fallback

  const poll = await pollBatchStatus(planjob.batchId, jobKey);
  if (poll.error) {
    // a HARD error (gone / key rejected) → fallback now; a transient one → keep polling
    if (poll.error === 'batch_not_found' || poll.error === 'auth_rejected') {
      return await finalizePlanJob(planjob, null, null, planLlmNote(poll.error));
    }
    return { ok: true, status: 'batched', elapsed };
  }
  if (poll.status === 'in_progress' || poll.status === 'canceling') {
    return { ok: true, status: 'batched', elapsed };
  }
  // ended → fetch the ranking + finalize (a fetch error falls back to the deterministic plan)
  const fetched = await fetchPlanRankingResults(poll.resultsUrl, jobId, jobKey);
  if (fetched.error) {
    console.warn(`[pollPlanStatus] fetch failed (${fetched.error}) → deterministic fallback ref=${jobId}`);
    return await finalizePlanJob(planjob, null, null, planLlmNote(fetched.error));
  }
  return await finalizePlanJob(planjob, fetched.ranking, fetched.usage, null);
});

/**
 * repackPlan — assumption-only re-pack (ledger UX-4): a capacity edit re-runs computeCapacity +
 * packSprints over the CACHED ranking. FREE — no LLM, no spend. Requires an existing plan.
 */
resolver.define('repackPlan', async ({ payload, context }) => {
  if (getActiveTier(context).key === 'unlicensed') return buildLicenseRequired();
  const { jobId, capacityForm } = payload || {};
  // Cross-tab race (gate finding): if a re-rank BATCH is in flight (e.g. another tab fired it), refuse the
  // free re-pack — its write over the CACHED ranking could clobber the FRESH ranking finalizePlanJob is
  // about to persist (Forge KVS has no compare-and-set; the per-tab planBusy gate can't serialize tabs).
  let inFlight;
  try { inFlight = await kvs.get(`${PLAN_BATCH_PREFIX}${jobId}`); } catch (_) { inFlight = null; }
  if (inFlight && inFlight.batchId) return { ok: false, stage: 'plan', error: 'rerank_in_flight', detail: 'A re-rank is in progress — wait for it to finish, then re-pack.' };
  let record;
  try { record = await kvs.get(`${PLAN_KEY_PREFIX}${jobId}`); } catch (_) { record = null; }
  if (!record || !Array.isArray(record.features)) return { ok: false, error: 'no_plan', detail: 'Generate a plan first.' };

  const capacity = computePlanCapacity(capacityForm);
  if (!capacity.ok) {
    return { ok: false, stage: 'capacity', capacityErrors: capacity.errors, assumptions: capacity.assumptions, warnings: capacity.warnings };
  }

  let plan;
  try {
    // CACHED ranking + the COMPACT precomputed risk (concerns are gone from record.features) → no LLM, no
    // recompute; only sprintRiskProfiles re-derive for the new packing. record.specConcerns covers old records.
    plan = assemblePlan({ features: record.features, capacity, ranking: record.ranking, specConcerns: record.specConcerns, precomputedRisk: riskFromRecord(record), methodology: planMethodology(capacityForm) });
  } catch (e) {
    console.error(`[repackPlan] re-pack threw (non-fatal): ${String(e?.message || e)} ref=${jobId}`);
    return { ok: false, stage: 'plan', error: 'plan_failed', detail: 'The plan could not be re-packed — please try again.' };
  }
  const updated = { ...record, capacityForm, plan, assumptions: capacity.assumptions, warnings: capacity.warnings, repackedAt: Date.now() };
  try { await kvs.set(`${PLAN_KEY_PREFIX}${jobId}`, updated); } catch (_) { /* best-effort */ }
  await touchJobAccess(jobId);

  // SELF-DESCRIBING PLAN (gate HIGH 2026-06-20): a free re-pack REPLACES the FE planResult, so it MUST
  // re-carry features — else a reload→re-pack drops the name source and the chips re-render raw uids.
  return { ok: true, plan, features: record.features, assumptions: capacity.assumptions, warnings: capacity.warnings, perSprintCapacityPoints: capacity.perSprintCapacityPoints, sourceHash: record.sourceHash, usedLlm: record.usedLlm, llmNote: record.llmNote, cost: record.cost, objective: record.objective || 'balanced', methodology: planMethodology(capacityForm), repacked: true };
});

/**
 * getPlan — rehydrate a persisted plan on reconnect (ledger UX-2). Compares the LIVE breakdown's
 * hash to the stored one server-side (planSourceHash is backend-only) → reports `stale` so the UI
 * fires the "this plan is out of date" banner and forces a re-plan (UX-1).
 */
resolver.define('getPlan', async ({ payload }) => {
  const { jobId, features } = payload || {};
  // 1) a COMPLETED plan?
  let record;
  try { record = await kvs.get(`${PLAN_KEY_PREFIX}${jobId}`); } catch (_) { record = null; }
  if (record && record.plan) {
    await touchJobAccess(jobId);
    let stale = false;
    if (Array.isArray(features) && features.length) {
      stale = planSourceHash(features.slice(0, PLAN_FEATURE_CAP)) !== record.sourceHash;
    }
    // SELF-DESCRIBING PLAN (reload fix 2026-06-20): the persisted plan is uid-keyed (sprints[].ids,
    // riskByFeature) — the human names live in record.features (the lean projection: _uid/name/SP/priority).
    // Return them so the FE can resolve uid→name on RELOAD without the live in-memory breakdown (which is
    // lost on a hard reload → names were rendering as raw uids). Lean + already capped → bounded payload.
    return { ok: true, status: 'completed', plan: record.plan, features: record.features, capacityForm: record.capacityForm, assumptions: record.assumptions, warnings: record.warnings, sourceHash: record.sourceHash, usedLlm: record.usedLlm, llmNote: record.llmNote, cost: record.cost, objective: record.objective || 'balanced', methodology: planMethodology(record.capacityForm), stale };
  }
  // 2) an IN-FLIGHT ranking batch? (reconnect mid-plan → the UI resumes polling)
  let planjob;
  try { planjob = await kvs.get(`${PLAN_BATCH_PREFIX}${jobId}`); } catch (_) { planjob = null; }
  if (planjob && planjob.batchId) {
    return { ok: true, status: 'batched', planJobId: jobId, capacityForm: planjob.capacityForm, elapsed: Math.round((Date.now() - (planjob.submittedAt || Date.now())) / 1000) };
  }
  return { ok: true, status: 'idle', plan: null };
});

/**
 * estimatePlanCost — read-only pre-flight estimate for the ranking call (ledger UX-5). Pure; no key,
 * no spend. The FE shows "up to ~$X" on the Generate button before the user commits.
 */
resolver.define('estimatePlanCost', async ({ payload }) => {
  const featureCount = Number(payload && payload.featureCount) || 0;
  return estimatePlanCost({ featureCount, model: MODEL_PRIMARY });
});

/**
 * previewCapacity — LIVE form-side capacity preview (read-only; NO LLM, NO spend). Runs the SAME pure
 * computeCapacity the plan uses so the user SEES the derived points/sprint as they edit (transparency
 * for the focus-factor sensitivity finding 2026-06-20 — a multiplier change swings capacity a lot, and
 * the user couldn't see why). Single source of truth = computeCapacity, so the preview can never drift.
 */
resolver.define('previewCapacity', async ({ payload, context }) => {
  if (getActiveTier(context).key === 'unlicensed') return buildLicenseRequired();
  const form = payload && payload.capacityForm;
  // Kanban: preview the quarter throughput + reach band (the SAME computeThroughput the plan uses → can't drift).
  if (planMethodology(form) === 'kanban') {
    const t = computeThroughput(form);
    return {
      ok: t.ok,
      methodology: 'kanban',
      expectedPointsQuarter: t.expectedPointsQuarter,
      conservativePoints: t.conservativePoints,
      optimisticPoints: t.optimisticPoints,
      assumptions: t.assumptions,
      warnings: t.warnings,
      errors: t.errors,
    };
  }
  const cap = computeCapacity(form);
  return {
    ok: cap.ok,
    methodology: 'scrum',
    perSprintCapacityPoints: cap.perSprintCapacityPoints,
    totalCapacityPoints: cap.totalCapacityPoints,
    perSprintBucketCapacity: cap.perSprintBucketCapacity, // Tier-2: per-skill breakdown (BE/FE/QA/GEN)
    bucketsActive: cap.bucketsActive,
    assumptions: cap.assumptions,
    warnings: cap.warnings,
    errors: cap.errors,
  };
});

/**
 * previewWhatIf — P20 free what-if scenarios (read-only; NO LLM, NO spend, persists NOTHING). Re-packs the
 * CACHED ranking + CACHED compact risk over a scenario form (±sprint / focus override) and/or a deferred
 * feature SUBSET, then diffs vs the baseline plan. Reuses the EXACT pure code the real plan used (computeCapacity
 * + assemblePlan + diffPlans) so a preview can never drift from reality (the previewCapacity guarantee). A
 * "defer X" scenario removes X from the feature set; normalizeRanking already drops X's now-unknown rank entry,
 * so every other feature keeps its relative order — the frozen ordering is NOT re-optimized (stated in the UI).
 */
resolver.define('previewWhatIf', async ({ payload, context }) => {
  if (getActiveTier(context).key === 'unlicensed') return buildLicenseRequired();
  const { jobId, scenario } = payload || {};
  let record;
  try { record = await kvs.get(`${PLAN_KEY_PREFIX}${jobId}`); } catch (_) { record = null; }
  if (!record || !record.plan || !Array.isArray(record.features)) return { ok: false, error: 'no_plan', detail: 'Generate a plan first.' };
  // Kanban v1 has no sprint-boxed what-if (deferred §3.5); guard so a kanban form never mis-runs the sprint scenario path.
  if (planMethodology(record.capacityForm) === 'kanban') return { ok: false, error: 'whatif_unsupported', detail: 'What-if scenarios are available for sprint plans.' };

  const sc = scenario && typeof scenario === 'object' ? scenario : {};
  const baseForm = record.capacityForm || {};
  const scenarioForm = { ...baseForm };
  const sprintDelta = Number(sc.sprintCountDelta);
  if (Number.isFinite(sprintDelta) && sprintDelta !== 0) {
    scenarioForm.sprintCount = Math.max(1, (Number(baseForm.sprintCount) || 0) + sprintDelta);
  }
  if (sc.focusFactor !== undefined && sc.focusFactor !== null && sc.focusFactor !== '') {
    scenarioForm.focusFactor = sc.focusFactor; // computeCapacity validates it fail-loud (rejects e.g. 70-for-0.7)
  }
  const deferred = new Set(Array.isArray(sc.deferredUids) ? sc.deferredUids : []);
  const scenarioFeatures = record.features.filter((f) => f && !deferred.has(f._uid));

  const capacity = computeCapacity(scenarioForm);
  if (!capacity.ok) {
    // a bad scenario input (e.g. a typo'd focus factor) is surfaced fail-loud, never silently 0/NaN.
    return { ok: false, stage: 'capacity', capacityErrors: capacity.errors, assumptions: capacity.assumptions, warnings: capacity.warnings };
  }
  if (!scenarioFeatures.length) {
    return { ok: true, empty: true, detail: 'This scenario defers every feature — nothing left to plan.' };
  }
  let scenarioPlan, delta;
  try {
    // CACHED ranking + CACHED compact risk → no LLM, no recompute from concerns (which the lean record dropped).
    scenarioPlan = assemblePlan({ features: scenarioFeatures, capacity, ranking: record.ranking, specConcerns: record.specConcerns, precomputedRisk: riskFromRecord(record) });
    delta = diffPlans(record.plan, scenarioPlan);
  } catch (e) {
    console.error(`[previewWhatIf] threw (non-fatal): ${String(e?.message || e)} ref=${jobId}`);
    return { ok: false, error: 'whatif_failed', detail: 'Could not compute this scenario — please try again.' };
  }
  await touchJobAccess(jobId); // a what-if is activity → renews the orphan-sweep clock (read-only otherwise)
  return {
    ok: true,
    scenarioMetrics: scenarioPlan.metrics,
    delta,
    assumptions: capacity.assumptions,
    warnings: capacity.warnings,
    perSprintCapacityPoints: capacity.perSprintCapacityPoints,
    deferredCount: deferred.size,
  };
});

// ════════════════════════════════════════════════════════════
// JIRA PUSH — chunked asUser() resolver (startPush + looped pushStep); 2026-05-30
// ════════════════════════════════════════════════════════════

// Compact, defensive serialization of the push failureDetails struct for the
// zone-2 detail sibling (§2b — the consented verbatim zone; the SAME capped
// per-item names/reasons the success screen shows). The 4KB cap lives in
// writeDiagnosticDetail; this only has to never throw and never invent fields.
function buildPushFailureDetailText(details) {
  try {
    if (!details || typeof details !== 'object') return '';
    const lines = [];
    for (const st of Array.isArray(details.stories) ? details.stories : []) {
      lines.push(`story "${st?.name ?? '?'}": ${st?.batchError?.[0]?.message || 'failed'}`);
    }
    for (const su of Array.isArray(details.subtasks) ? details.subtasks : []) {
      lines.push(
        `subtask "${su?.taskSummary ?? '?'}" (story "${su?.parentFeature ?? '?'}"): ${su?.batchError?.[0]?.message || 'failed'}`,
      );
    }
    for (const li of Array.isArray(details.links) ? details.links : []) {
      lines.push(
        `link "${li?.source ?? '?'}" → "${li?.target ?? '?'}": ${li?.reason || li?.detail || li?.error || 'failed'}`,
      );
    }
    return lines.filter(Boolean).join('\n');
  } catch (_) {
    return ''; // zone-2 is best-effort — a malformed struct must never break the push response
  }
}

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
resolver.define('startPush', async ({ payload, context }) => {
  const { breakdown, projectKey: payloadProjectKey, jobId } = payload || {};
  // [deep-audit P5 LOW-2] payload-sourced id → LEDGER refs only through the strict
  // mint-shape check (UUID / ts-base36): a crafted dotted-ASCII "jobId" must not
  // become pseudo-prose in the admin's view. Business logic keeps the raw jobId.
  const diagJobRef = cleanClientRef(jobId);
  if (jobId) await touchJobAccess(jobId); // Task #13: a push attempt is activity on this breakdown — renew its inactivity timer so a near-stale push can't race the daily sweep
  if (!breakdown) {
    // (diag Phase 2) a missing breakdown payload is a FRONTEND bug, not a user
    // mistake — warn-level, but recorded so support sees it in the timeline.
    await recordDiagnostic({
      context,
      record: { op: 'push.step', error_class: 'no_breakdown', level: 'warn', ref: diagJobRef, surfaced: true },
    });
    return { error: 'no_breakdown', detail: 'No breakdown payload provided' };
  }

  // No license gate here: every accessing user is licensed (the in-app Free /
  // unlicensed-access path was removed 2026-06-03 — evaluation is the 30-day
  // Atlassian trial, which reads as an active license). The JIRA push uses
  // asUser().requestJira (gotcha #3); a truly-unlicensed user can't reach this
  // surface at all (Atlassian's platform gate), and startGeneration already
  // returns license_required defensively upstream.
  const projectKey = await getProjectKey(payloadProjectKey);
  if (!projectKey) {
    await recordDiagnostic({
      context,
      record: { op: 'push.step', error_class: 'no_project_key', level: 'error', ref: diagJobRef, surfaced: true },
    });
    return {
      error: 'no_project_key',
      detail:
        'No Jira project key configured. Open Settings → Spec2Tickets and set Default Jira Project Key.',
    };
  }

  // Optional admin-configured required custom fields (advanced).
  const settings = await loadSettings();
  const cfParse = parseRequiredCustomFields(settings.requiredCustomFieldsJson);
  const customFields = cfParse.ok ? cfParse.value : null;
  if (!cfParse.ok) {
    // (diag, gate F1) a stored-but-unparseable required-custom-fields JSON is
    // silently ignored here, and the push then fails per-row with a confusing
    // jira_http 400 — support would chase Jira config while the real cause is
    // this broken setting. Record the real cause (saveSettings fail-fasts new
    // values, so this is a legacy/manually-edited value — rare but misleading).
    await recordDiagnostic({
      context,
      // ref:null (deep-audit P2 #5): a settings-scoped condition — ref=jobId made
      // EVERY pushed job a fresh ring row + agg bump while the broken config
      // persisted; the (op, class) null-ref dedupe is the designed flood absorber.
      record: { op: 'push.step', error_class: 'config_invalid', level: 'warn', ref: null, surfaced: false },
    });
  }

  let outcome;
  try {
    outcome = await startPushSession(breakdown, projectKey, customFields, jobId || null);
  } catch (e) {
    console.error(`[startPush] threw: ${String(e?.message || e)} ref=${jobId || '-'}`);
    await recordDiagnostic({
      context,
      record: { op: 'push.step', error_class: 'push_exception', level: 'error', ref: diagJobRef, surfaced: true },
    });
    await writeDiagnosticDetail({ ref: diagJobRef, text: String(e?.message || e) });
    return { error: 'push_exception', detail: String(e?.message || e) };
  }
  if (!outcome.ok) {
    // (diag Phase 2) ONE record per startPush-time failure — project lookup AND
    // Epic create both arrive through this return. error_class maps 1:1 onto
    // the structured codes; the interpolated jira_<NNN> family normalizes to
    // 'jira_http' with the status as DATA (never a raw interpolated class).
    let errorClass = 'unknown_error';
    let jira;
    const code = String(outcome.error || '');
    if (code === 'project_not_found') errorClass = 'project_not_found';
    else if (code === 'permission_denied') errorClass = 'permission_denied';
    else if (code === 'jira_fetch_failed') errorClass = 'network_failure';
    else {
      const m = /^jira_(\d+)$/.exec(code);
      if (m) {
        errorClass = 'jira_http';
        jira = [{ status: parseInt(m[1], 10) }];
      }
    }
    await recordDiagnostic({
      context,
      record: {
        op: 'push.step',
        error_class: errorClass,
        level: 'error',
        ref: diagJobRef,
        ...(jira ? { jira } : {}),
        surfaced: true,
      },
    });
    // Zone-2 (§2b): the verbatim detail (Epic summary / Jira message) is
    // consented-export material — it never enters the record body. No jobId →
    // the helper skips (fail-open); there is no sessionId yet at this point.
    if (outcome.detail) {
      await writeDiagnosticDetail({ ref: diagJobRef, text: String(outcome.detail) });
    }
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
resolver.define('pushStep', async ({ payload, context }) => {
  // A pushStep session exists ONLY if startPush created it in KVS, and the app is
  // licensed-only (Paid-via-Atlassian default) so every caller here is a licensed
  // user. A forged sessionId returns session_not_found, and asUser() is the ultimate
  // 401 backstop. Preserve this session-only-from-startPush invariant if a second
  // session creator is ever added (§13 review note).
  const sessionId = payload?.sessionId;
  if (!sessionId) return { error: 'no_session', detail: 'No session id provided.' };
  // (deep-audit P2 ref-correlation) the FE sends its jobId so the CATCH-path
  // records are findable by the ref the error screen shows (the session may be
  // unreadable — no other jobId source exists here). Payload = untrusted →
  // shape-checked with the client-ref rule; the bucket stays context-only (§2).
  const payloadJobRef = cleanClientRef(payload?.jobId);
  const diagSessionRef = cleanClientRef(sessionId); // [P5 LOW-2] session_ref through the same strict shape

  let outcome;
  try {
    outcome = await pushSessionStep(sessionId);
  } catch (e) {
    console.error(`[pushStep] threw: ${String(e?.message || e)} ref=${payloadJobRef || 'session:' + sessionId}`);
    // (diag, gate MED-1) what lands here: a session kvs.get throw OR the per-step
    // kvs.set (push_handler.js — the documented ~240KB session-size risk path on
    // very large specs). The push dies user-visibly mid-flight — exactly the
    // aborted-push class design §4 names — and the session may be unreadable, so
    // this record is the only durable trace.
    await recordDiagnostic({
      context,
      record: { op: 'push.step', error_class: 'push_exception', level: 'error', ref: payloadJobRef, session_ref: diagSessionRef, surfaced: true },
    });
    await writeDiagnosticDetail({ ref: payloadJobRef || sessionId, text: String(e?.message || e) });
    return { error: 'push_exception', detail: String(e?.message || e) };
  }
  if (!outcome.ok) {
    // (diag Phase 2) the two structured step failures. job_id rides the
    // step_exception return (additive — the session is loaded there); a
    // missing/expired session has no jobId to offer → ref stays null.
    if (outcome.error === 'step_exception') {
      await recordDiagnostic({
        context,
        record: {
          op: 'push.step',
          error_class: 'step_exception',
          level: 'error',
          ref: outcome.job_id || null,
          session_ref: diagSessionRef,
          surfaced: true,
        },
      });
      await writeDiagnosticDetail({
        ref: outcome.job_id || sessionId,
        text: String(outcome.detail || ''),
      });
    } else if (outcome.error === 'session_not_found') {
      await recordDiagnostic({
        context,
        record: {
          op: 'push.step',
          error_class: 'session_not_found',
          level: 'warn',
          ref: payloadJobRef, // findable by the ref the user sees (null when absent)
          session_ref: diagSessionRef,
          surfaced: true,
        },
      });
    }
    return { error: outcome.error, detail: outcome.detail };
  }
  if (outcome.done) {
    // (diag Phase 2, design §4) ONE coalesced ledger record per push — never
    // per item. partial → error record with cause-split counts + the durable
    // idx/key handles; clean → an info breadcrumb (timeline; the §2.6 eviction
    // rule means breadcrumbs can never displace error records).
    const res = outcome.result || {};
    const d = res.diag || {};
    const jobRef = outcome.job_id || null;
    if (outcome.partial) {
      await recordDiagnostic({
        context,
        record: {
          op: 'push.final',
          error_class: 'partial_push',
          level: 'error',
          ref: jobRef,
          session_ref: diagSessionRef,
          // Union of failed STORY idxs + failed subtasks' PARENT feature idxs —
          // the same index space (feature idx), per §1 "story/task indices"
          // (gate F3: the subtask idxs were accumulated but write-only). Cap 20
          // here; the validator re-caps defensively.
          subject_idxs: [
            ...new Set([...(d.failedStoryIdxs || []), ...(d.failedSubtaskFeatureIdxs || [])]),
          ].slice(0, 20),
          subject_keys: d.failedKeys,
          jira: d.jira,
          counts: {
            stories_created: res.total_stories || 0,
            stories_failed: (res.failures && res.failures.stories) || 0,
            subtasks_created: res.total_subtasks || 0,
            subtasks_failed: (res.failures && res.failures.subtasks) || 0,
            subtasks_orphaned: d.subtasks_orphaned || 0,
            links_created: res.dependency_links_created || 0,
            links_unresolved_story_failed: d.links_unresolved_story_failed || 0,
            links_unresolved_name_unknown: d.links_unresolved_name_unknown || 0,
            links_api_failed: d.links_api_failed || 0,
            tc_embedded: res.tc_embedded || 0,
            tc_skipped: res.tc_skipped || 0,
            // tasks_embedded > 0 = the subtask-type-unresolved checklist
            // fallback fired (gate F2's inferable proxy — no extra flag).
            tasks_embedded: res.tasks_embedded || 0,
          },
          surfaced: true,
        },
      });
      // Zone-2 (§2b): the capped per-item names/reasons the success screen also
      // shows — the consented verbatim zone, keyed by jobId (fall back to the
      // sessionId so a jobId-less push still gets its detail sibling).
      const detailText = buildPushFailureDetailText(res.failures && res.failures.details);
      if (detailText) {
        await writeDiagnosticDetail({ ref: jobRef || sessionId, text: detailText });
      }
    } else {
      await recordDiagnostic({
        context,
        record: {
          op: 'push.final',
          error_class: 'push_completed',
          level: 'info',
          ref: jobRef,
          session_ref: diagSessionRef,
          counts: {
            stories_created: res.total_stories || 0,
            subtasks_created: res.total_subtasks || 0,
            links_created: res.dependency_links_created || 0,
            tc_embedded: res.tc_embedded || 0,
            // gate F4: a CLEAN push can still carry silent degradations — the
            // tc-embed drop (edited ACs / ambiguous AC-hash) and the checklist
            // fallback (no subtask type). Counts make them ledger-visible.
            tc_skipped: res.tc_skipped || 0,
            tasks_embedded: res.tasks_embedded || 0,
          },
          surfaced: true,
        },
      });
    }
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

// ════════════════════════════════════════════════════════════════
// P15 — PUSH PLAN TO JIRA (real Agile Sprints). Writes the planner's sprint assignment to Jira.
// Mirrors the chunked push (startPlanPush → loop planPushStep). PURE mapping, NO LLM. The plan + its
// capacityForm come from the persisted plan:<jobId>; the uid→Jira-key join comes from the breakdown
// push's created_issues (FE-supplied). Confirm-gated outward write (the FE arms it). ⚠ NEEDS the new
// Agile scopes — LIVE-VERIFY on dev before publish (POLICY §9).
// ════════════════════════════════════════════════════════════════
resolver.define('startPlanPush', async ({ payload, context }) => {
  if (getActiveTier(context).key === 'unlicensed') return buildLicenseRequired();
  const { jobId, createdIssues, projectKey: payloadProjectKey, namePrefix, boardId, plan: payloadPlan, capacityForm: payloadForm } = payload || {};
  // ⭐ POST-PUSH LIFECYCLE FIX (live-acceptance 2026-06-21): "Assign sprints in Jira" runs from the POST-PUSH
  // success screen — but purgeJob (data-min on push) has ALREADY deleted plan:<jobId> by then, so a KVS read
  // returns no_plan ("Generate a plan first"). The plan is still in FE memory (the panel is gated on
  // planResult.plan), so accept it from the PAYLOAD — same capture-before-purge pattern as the post-push
  // export. Fall back to KVS for any pre-purge / non-success-screen caller. ⚠ The FE-plan contract requires a
  // `.sprints` array (planner.js) — if a future plan shape renames it, this guard must move with it.
  // SECURITY (§13 gate): every Jira write runs under asUser, so it is bounded by the END USER'S OWN Jira
  // permissions (NOT to "only the pushed backlog" — that earlier claim was write-time optimism; a tampered
  // client can only touch issues the user can already reach, no cross-user escalation). We additionally scope
  // moves to `projectKey` below so a mismatched/crafted projectKey+keys can't sprint issues in another project.
  let plan = payloadPlan && Array.isArray(payloadPlan.sprints) ? payloadPlan : null;
  let form = payloadForm || null;
  if (!plan) {
    let record;
    try { record = await kvs.get(`${PLAN_KEY_PREFIX}${jobId}`); } catch (_) { record = null; }
    if (record && record.plan) { plan = record.plan; if (!form) form = record.capacityForm; }
  }
  if (!plan) return { ok: false, error: 'no_plan', detail: 'Generate a plan first.' };
  // §13 gate: defensive size bound on the FE-supplied payload (DoS / accidental-giant guard).
  if ((Array.isArray(plan.sprints) && plan.sprints.length > 100) || (Array.isArray(createdIssues) && createdIssues.length > PLAN_FEATURE_CAP)) {
    return { ok: false, error: 'payload_too_large', detail: 'The plan or issue list is unexpectedly large — regenerate the plan and retry.' };
  }
  const projectKey = await getProjectKey(payloadProjectKey);
  if (!projectKey) return { ok: false, error: 'no_project_key', detail: 'Set a default Jira project key in Settings (and push the backlog to Jira first).' };
  // §13 gate (project-scoping): bound the moves to the target project. A Jira key is `<PROJECTKEY>-<n>`; drop
  // any createdIssue whose key isn't in projectKey → a mismatched/crafted projectKey then simply yields no
  // movable issues (surfaced honestly via the noJiraKey channel), never a cross-project sprint+move.
  const keyPrefix = `${String(projectKey).toUpperCase()}-`;
  const scopedIssues = Array.isArray(createdIssues)
    ? createdIssues.filter((ci) => ci && typeof ci.key === 'string' && ci.key.toUpperCase().startsWith(keyPrefix))
    : [];
  form = form || {};
  let outcome;
  try {
    outcome = await startPlanPushSession({
      jobId, plan, createdIssues: scopedIssues, projectKey, boardId,
      sprintStartDate: form.sprintStartDate, sprintLengthDays: form.sprintLengthDays, namePrefix,
    });
  } catch (e) {
    console.error(`[startPlanPush] threw (non-fatal): ${String(e?.message || e)} ref=${jobId}`);
    return { ok: false, error: 'plan_push_failed', detail: 'Could not start the sprint push — please try again.' };
  }
  if (outcome.ok) await touchJobAccess(jobId);
  return outcome;
});

resolver.define('planPushStep', async ({ payload, context }) => {
  if (getActiveTier(context).key === 'unlicensed') return buildLicenseRequired();
  const sessionId = payload && payload.sessionId;
  if (!sessionId) return { ok: false, error: 'no_session', detail: 'No session id provided.' };
  try {
    return await planPushSessionStep(sessionId);
  } catch (e) {
    console.error(`[planPushStep] threw: ${String(e?.message || e)}`);
    return { ok: false, error: 'step_exception', detail: String(e?.message || e) };
  }
});

// ════════════════════════════════════════════════════════════════
// TEST-CASE GENERATION — Sonnet 4.6 + Anthropic Batches API (P3)
//
// Architecture mirrors the breakdown batch lifecycle exactly (startGeneration →
// pollJobStatus → getResults). Cloned per TESTCASE-GENERATION-DESIGN.md §3.
// All 12 §5 mitigations are wired — see inline comments marked #1-#12.
// ════════════════════════════════════════════════════════════════

/**
 * startTestCaseGeneration — submit a test-case batch for all Stories in a job.
 *
 * Payload: { jobId, breakdown? }
 *   jobId: the completed breakdown job whose features[] we generate test cases for.
 *   breakdown: the BA's Review-EDITED breakdown (legacy capabilities shape, as the push
 *     receives it). #1 fix — reverse-adapted via flattenBreakdown and persisted into
 *     job.breakdown so test-gen + per-Story regenerate + reconnect + the push AC-hash embed
 *     all read ONE consistent EDITED list. Absent (old client) → falls back to the stored breakdown.
 *
 * Mitigations wired:
 *   #2 (idempotency): if tcjob already exists in batched/completed state, return it.
 *   #5 (keySource stamp): records keySource on tcjob; poll leg reuses the same key.
 *   #7 (story stamp): records stampedStories {idx,name,acceptance_criteria} (lean coverage inputs) at submit time.
 *   #8 (BYOK quota): consume-on-success; BYOK always allowed; Managed = Phase 2.
 */
resolver.define('startTestCaseGeneration', async ({ payload, context }) => {
  const { jobId } = payload || {};
  if (!jobId) return { error: 'no_job_id', detail: 'jobId is required.' };
  await touchJobAccess(jobId); // Task #13: starting test-case generation is activity on this breakdown — renew its inactivity timer UNCONDITIONALLY (the edited-breakdown branch alone misses the idempotent-return path)

  // Defensive license gate (mirrors startGeneration)
  try {
    if (getActiveTier(context).key === 'unlicensed') return buildLicenseRequired();
  } catch (e) {
    console.error(`[startTCGen] license check failed (failing open): ${String(e?.message || e)} ref=${jobId}`);
    // [diag Phase 4, (E) — mirrors Phase 3's startGeneration gates] silent fail-open: a
    // persistent license-read fault admits work with only a console trace. ref = the
    // breakdown jobId (known here, unlike startGeneration's pre-jobId gate).
    await recordDiagnostic({
      context,
      record: { op: 'testgen.batch', error_class: 'gate_fail_open', level: 'warn', ref: jobId, surfaced: false },
    });
  }

  // v6 value-split FEATURE GATE — test-case generation is an Advanced-edition feature.
  // FAIL-CLOSED (deny on a license-read fault) — the OPPOSITE polarity of the unlicensed
  // gate above (which fails OPEN). Cost asymmetry (POLICY §3): silently leaking the
  // Advanced-only feature to a Standard user is a value leak; a transient denial is merely
  // retriable. Do NOT normalise this to the surrounding fail-open pattern.
  try {
    if (!getActiveTier(context).hasTestCases) return buildUpgradeRequired();
  } catch (e) {
    console.error(`[startTCGen] edition gate read failed (failing CLOSED — deny premium feature) ref=${jobId}: ${String(e?.message || e)}`);
    return buildUpgradeRequired();
  }

  // Resolve the Anthropic key by tier (#5: keySource-stamp enables same-key reuse at poll)
  const { apiKey, keySource, keyFault } = await resolveAnthropicKey(context);
  if (!apiKey) {
    // [diag Phase 4, A4] storage-fault FIRST (BYOK-only; never masks managed_unavailable) —
    // a thrown secret read is NOT "no key configured".
    if (keyFault) {
      console.error(`[startTCGen] stored-key read FAULTED (storage, not "no key") ref=${jobId}`);
      await recordDiagnostic({
        context,
        record: { op: 'testgen.batch', error_class: 'key_storage_failed', level: 'error', ref: jobId, surfaced: true },
      });
      return { error: 'key_storage_failed', detail: KEY_STORAGE_FAILED_DETAIL };
    }
    if (keySource === 'managed') {
      console.error('[startTCGen] managed key unavailable (MANAGED_ANTHROPIC_KEY not configured)');
      return { error: 'managed_unavailable', detail: 'The Managed service is temporarily unavailable. Please contact support@spec2jira.com, or switch to your own Anthropic API key in Settings.' };
    }
    return { error: 'not_configured', detail: 'Anthropic API key not configured. Ask your Confluence admin to open Settings → Spec2Tickets and provide an Anthropic API key.' };
  }

  // Quota gate (mirrors startGeneration; BYOK = unlimited; Managed = per-user cap)
  let quota = null;
  try {
    quota = await checkQuota(context);
    if (!quota.allowed) return buildQuotaExceeded(quota);
  } catch (e) {
    console.error(`[startTCGen] quota check failed (failing open): ${String(e?.message || e)} ref=${jobId}`);
    // [diag Phase 4, (E)] the second silent fail-open gate (Managed cap silently bypassed
    // on a metering glitch — customer-favourable, but support must see it happened).
    await recordDiagnostic({
      context,
      record: { op: 'testgen.batch', error_class: 'gate_fail_open', level: 'warn', ref: jobId, surfaced: false },
    });
  }

  // Load the completed breakdown job
  const job = await kvs.get(`${JOB_KEY_PREFIX}${jobId}`);
  if (!job) return { error: 'not_found', detail: `Breakdown job ${jobId} not found.` };
  if (job.status !== 'completed') {
    return { error: 'breakdown_not_ready', detail: `Breakdown job is in status '${job.status}'; it must be 'completed' before generating test cases.` };
  }

  // ⭐ #1 fix (edited-state) — consume the BA's Review-EDITED breakdown, not the pristine one.
  // The edits arrive in payload.breakdown (the SAME edited, legacy-shaped breakdown the push
  // receives). flattenBreakdown reverse-adapts it to v3-native features[] (the exact function +
  // input the push uses → identical ACs → the push AC-hash embed is guaranteed to match). We
  // persist the edited features back into the canonical job.breakdown so EVERY downstream reader —
  // this resolver, per-Story regenerate (~line 2220), getResults/reconnect, and the push embed —
  // reads ONE consistent edited list (single source of truth). All other job + breakdown fields
  // (metadata, shared_acceptance_criteria — NOT editable via the breakdown JSON — pageVersion,
  // usage, model, truncated, …) are preserved. Fail-SOFT: a missing/empty/malformed edited list
  // never overwrites a good breakdown (POLICY §11 — never silently destroy data); keep the stored one.
  if (payload && payload.breakdown) {
    try {
      const { features: editedFeatures } = flattenBreakdown(payload.breakdown);
      if (Array.isArray(editedFeatures) && editedFeatures.length > 0) {
        job.breakdown = { ...job.breakdown, features: editedFeatures };
        await setJob(jobId,{ ...job });
      } else {
        console.warn(`[startTCGen] edited breakdown flattened to 0 features — keeping stored breakdown for ${jobId} ref=${jobId}`);
        // [diag Phase 4, (E) §2.2 :1998 — worst offender #11] BOTH soft-fallback branches are the
        // same silent class: test-gen proceeds on the PRISTINE (stored) ACs, not the BA's edits —
        // re-opening the #1 edited-state bug with zero signal. Same (ref, op, class) as the catch
        // below → dedupe merges them into one record with occurrences.
        await recordDiagnostic({
          context,
          record: { op: 'testgen.batch', error_class: 'edited_persist_failed', level: 'warn', ref: jobId, surfaced: false },
        });
      }
    } catch (e) {
      console.warn(`[startTCGen] persist edited breakdown failed (keeping stored): ${String(e?.message || e)} ref=${jobId}`);
      // [diag Phase 4, (E)] see the sibling branch above — silent pristine-fallback class.
      await recordDiagnostic({
        context,
        record: { op: 'testgen.batch', error_class: 'edited_persist_failed', level: 'warn', ref: jobId, surfaced: false },
      });
    }
  }

  const stories = (job.breakdown && Array.isArray(job.breakdown.features)) ? job.breakdown.features : [];
  if (stories.length === 0) {
    return { error: 'no_stories', detail: 'The breakdown has no features/stories to generate test cases for.' };
  }

  // #2 — IDEMPOTENCY: if a tcjob already exists and is batched or completed, return it
  // immediately without re-submitting (avoids 2× cost on double-click or UI re-mount).
  const existingTcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`);
  if (existingTcJob && (existingTcJob.status === 'batched' || existingTcJob.status === 'completed')) {
    // Idempotent return ONLY when the breakdown is UNCHANGED since these cases were generated (a
    // double-click / re-mount → avoid 2× cost). If the BA EDITED the breakdown (ACs differ from the
    // stamped set), the existing cases are STALE → fall through and RE-GENERATE: this is the working
    // refresh behind the #1 "edited since generation" warning (user-triggered — the BA clicks Regenerate;
    // never auto). The normAC AC-signature matches the push's embed decision, so a trivial reword the
    // push would still embed does NOT force a costly re-generate. `stories` = the just-persisted EDITED list.
    const acSig = (storyList) => (Array.isArray(storyList) ? storyList : [])
      .flatMap((s) => (Array.isArray(s && s.acceptance_criteria) ? s.acceptance_criteria : []))
      .map(normAC).sort().join('|');
    if (acSig(existingTcJob.stampedStories) === acSig(stories)) {
      console.log(`[startTCGen] idempotent return — tcjob ${jobId} already ${existingTcJob.status} (breakdown unchanged)`);
      return { jobId, status: existingTcJob.status, total: existingTcJob.total };
    }
    console.log(`[startTCGen] breakdown edited since generation — re-generating tcjob ${jobId}`);
    // fall through → re-stamp the edited ACs + submit a fresh batch
  }

  const total = stories.length;
  const createdAt = new Date().toISOString();
  // Diagnostics owner stamp (Phase 0, design §2.4) — mirrors the job: stamp in
  // startGeneration: tcjob-scoped diagnostic events bucket to the OWNER, not the poller.
  // Stamped on all three full-record writes in this resolver (fresh literals); every later
  // tcjob rewrite spreads the loaded record, so it persists. Nothing reads it yet (Phase 5).
  const ownerAccountId = (context && context.accountId) || null;

  // #7 — stamp the story list (idx + name + acceptance_criteria) at submit time. These ACs come
  // from the EDITED breakdown persisted just above (#1 fix), so coverage is computed against the
  // BA's edited ACs — and the push AC-hash embed (which hashes tcjob.stampedStories) matches the
  // pushed (edited) features. P5 reconciles added/deleted stories.
  // LEAN: only {idx, name, acceptance_criteria} — the only fields computeCoverage uses.
  const stampedStories = stories.map((s, i) => ({
    idx: i,
    _uid: s && s._uid, // (POLICY §3.5) stable identity — per-story staleness + per-card regen bind to THIS
    name: s && (s.name || `Story ${i}`),
    acceptance_criteria: Array.isArray(s && s.acceptance_criteria) ? s.acceptance_criteria : [],
  }));

  // Write initial tcjob record (status 'pending' → updated to 'batched' on success).
  // pageVersion is stamped here so getTestCases can read it without a separate job lookup.
  // [diag F1, §3 row-1 mirror] This write runs BEFORE the billed TC batch submit — a KVS
  // failure must stay FAIL-FAST (no money spent yet; the old unwrapped throw at least
  // aborted first), but STRUCTURED instead of an opaque resolver death.
  const pageVersion = job.pageVersion;
  // [deep-audit P4 F5] high-water mark for the purge sweep: a re-generate after an
  // editor DELETE re-stamps a SHORTER total — purging only 0..total-1 then orphans
  // the old tail's per-story keys (stamped names + cases, content-adjacent) forever.
  const maxTotal = Math.max(
    total,
    (existingTcJob && Number.isFinite(existingTcJob.maxTotal) ? existingTcJob.maxTotal : 0),
    (existingTcJob && Number.isFinite(existingTcJob.total) ? existingTcJob.total : 0),
  );
  try {
    await kvs.set(`${TC_JOB_KEY_PREFIX}${jobId}`, {
      jobId,
      status: 'pending',
      total,
      maxTotal,
      keySource,
      ownerAccountId,
      stampedStories,
      pageVersion,
      createdAt,
    });
  } catch (e) {
    console.error('[diag] initial tcjob write failed ref=' + jobId, e);
    await recordDiagnostic({
      context,
      record: { op: 'testgen.batch', error_class: 'kvs_write_failed', level: 'error', ref: jobId, surfaced: true },
    });
    return {
      error: 'kvs_write_failed',
      detail:
        'Could not store the test-generation job in Forge storage. Please try again — if it persists, contact support@spec2jira.com.',
      job_id: jobId,
    };
  }

  const sharedACs = (job.breakdown && Array.isArray(job.breakdown.shared_acceptance_criteria))
    ? job.breakdown.shared_acceptance_criteria
    : [];
  const specSummary = (job.breakdown && job.breakdown.metadata && job.breakdown.metadata.spec_summary) || '';

  // §8 fix: feed the source-page snapshot (the business rules the ACs reference by ID) to test-gen.
  const specSourceText = await resolveSpecSourceText(jobId, job);
  // [diag Phase 4, (E) §2.2 :248-269 — worst offender #10] No coherent snapshot at the TC SUBMIT
  // → this whole batch generates §7-STARVED (weaker tests: no concrete thresholds / decision-table
  // cells) with only a console trace. Recorded ONLY here, the bulk-submit path that decides the
  // batch's quality — NOT inside resolveSpecSourceText (the per-story regen path would flood a
  // record per card click; same miss, same job, dedupe would absorb it but the rule is one site).
  if (!specSourceText) {
    await recordDiagnostic({
      context,
      record: { op: 'testgen.batch', error_class: 'pagesnap_missing', level: 'warn', ref: jobId, surfaced: false },
    });
  }

  // Submit the N-request batch to Anthropic
  const specConcerns = (job.breakdown && Array.isArray(job.breakdown.spec_concerns)) ? job.breakdown.spec_concerns : [];
  const submitResult = await submitTestCaseBatch({ stories, sharedAcceptanceCriteria: sharedACs, specConcerns, specSummary, specSourceText, apiKey });
  if (submitResult.error) {
    console.error(`[startTCGen] batch submit failed: ${submitResult.error} | ${submitResult.detail} ref=${jobId}`);
    // [diag Phase 4, (C)] TC-batch terminal SUBMIT failure — class via the REUSED generation
    // mapper (same Anthropic code families: auth_rejected/402/429/anthropic_<NNN>/no_batch_id/
    // network_failure — single mapping authority, no duplicate table). Zone-2 carries the
    // verbatim detail under the jobId ref. The invoker IS the owner at start time.
    {
      const diagClass = classifyDiagGenerationError(submitResult.error);
      await recordDiagnostic({
        context,
        record: {
          op: 'testgen.batch',
          error_class: diagClass.error_class,
          level: 'error',
          ref: jobId,
          ...(diagClass.counts ? { counts: diagClass.counts } : {}),
          surfaced: true,
        },
      });
      if (submitResult.detail) {
        await writeDiagnosticDetail({ ref: jobId, text: String(submitResult.detail) });
      }
    }
    // [diag F1, §3 row-3 mirror] Bookkeeping write for an ALREADY-failed submit — a KVS
    // failure here must NEVER mask the original error the user needs to see: record + still
    // return the original structured error below.
    try {
      await kvs.set(`${TC_JOB_KEY_PREFIX}${jobId}`, {
        jobId, status: 'failed', total, maxTotal, keySource, ownerAccountId, stampedStories, createdAt,
        error: submitResult.error, detail: submitResult.detail,
      });
    } catch (e) {
      console.error('[diag] failed-state tcjob bookkeeping write failed ref=' + jobId, e);
      await recordDiagnostic({
        context,
        owner: ownerAccountId,
        record: { op: 'testgen.batch', error_class: 'kvs_write_failed', level: 'warn', ref: jobId, surfaced: true },
      });
    }
    return { error: submitResult.error, detail: submitResult.detail };
  }

  // #8 — consume quota on success. BYOK (launch) = no-op (unlimited).
  // Managed Phase 2 MUST decide test-case metering (separate cap vs counts-as-a-unit)
  // — NOT settled; consuming on success here is the loss-safe default.
  if (quota) {
    try {
      await consumeQuota(quota.usageKey);
    } catch (e) {
      console.error(`[startTCGen] quota consume failed (generation still OK): ${String(e?.message || e)} ref=${jobId}`);
      // [diag Phase 4, (E)] Managed metering silently under-counts (a revenue signal,
      // invisible to everyone) — same class+pattern as startGeneration's consume catch.
      await recordDiagnostic({
        context,
        record: { op: 'testgen.batch', error_class: 'kvs_write_failed', level: 'warn', ref: jobId, surfaced: false },
      });
    }
  }

  // #5 — persist keySource + #7 persist stampedStories + batchId + pageVersion
  // [diag F1, §3 row-4 mirror] This write runs AFTER the billed TC batch submit — money is
  // spent, so NEVER abort on a KVS failure: record tracking_degraded + proceed to the normal
  // success response. Without a batchId the tcjob stays 'pending' and won't self-heal (the
  // poll returns it untouched; a re-click re-submits a fresh billed batch) — that is exactly
  // the support signal this record carries.
  let trackingDegraded = false;
  try {
    await kvs.set(`${TC_JOB_KEY_PREFIX}${jobId}`, {
      jobId,
      status: 'batched',
      total,
      maxTotal,
      keySource,
      ownerAccountId,
      stampedStories,
      pageVersion,
      batchId: submitResult.batchId,
      batchStatus: submitResult.status,
      createdAt,
      submittedAt: new Date().toISOString(),
      expiresAt: submitResult.expiresAt,
    });
  } catch (e) {
    trackingDegraded = true;
    console.error('[diag] batched tcjob write failed ref=' + jobId, e);
    await recordDiagnostic({
      context,
      record: { op: 'testgen.batch', error_class: 'tracking_degraded', level: 'warn', ref: jobId, surfaced: false },
    });
  }

  console.log(`[startTCGen] jobId=${jobId} batchId=${submitResult.batchId} stories=${total}`);
  return {
    jobId,
    status: 'batched',
    total,
    // [diag F1] additive flag (§3 row-4): the batch submitted fine but the tcjob record
    // could not be updated. The frontend ignores unknown fields today.
    ...(trackingDegraded ? { tracking_degraded: true } : {}),
  };
});

/**
 * pollTestCaseStatus — poll the Anthropic batch for a test-case generation job.
 * When the batch ends, fetches the JSONL, writes per-story KVS keys via Promise.all,
 * and marks the tcjob completed. Terminal states return immediately.
 *
 * Mitigations wired:
 *   #3 (partial-failure sentinel): non-succeeded rows store an explicit {error} key.
 *   #4 (Promise.all writes): never a sequential loop — all N KVS writes in parallel.
 *   #5 (managed key guard): soft-fail if the managed key vanished mid-flight.
 *   #10 (240KB guard): per-story payloads go to testcases:<jobId>:<idx>, never merged into tcjob.
 */
resolver.define('pollTestCaseStatus', async ({ payload, context }) => {
  // `context` (diag Phase 4): recordDiagnostic's invoker-fallback bucket; tcjob-scoped
  // records pass owner: tcJob.ownerAccountId (§2.4 — the Phase 0 stamp) since this poll
  // may be driven by another user's client.
  const { jobId } = payload || {};
  if (!jobId) return { error: 'no_job_id', detail: 'jobId is required.' };
  await touchJobAccess(jobId); // Task #13: polling a live test-case batch is activity on this breakdown — renew its inactivity timer (cross-phase liveness)

  const tcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`);
  if (!tcJob) return { error: 'not_found', detail: `tcjob ${jobId} not found.` };

  // Terminal states — return immediately (avoid redundant Anthropic polls).
  // [diag Phase 4, (C)] this early-return is ALSO the re-record guard: once 'completed' is
  // persisted below, a re-poll can never reach the transition block again.
  if (tcJob.status === 'completed' || tcJob.status === 'failed') return tcJob;

  // Re-resolve the key via the STAMPED keySource (same key the batch was created with —
  // #5: Anthropic batches are scoped to their creating key; never re-derive from the
  // current license which may have changed since submit, e.g. trial expiring).
  const jobApiKey = await anthropicKeyForSource(tcJob.keySource || 'byok');

  // #5 — Key-vanish guard (generalized for any source): soft-fail so the UI retries on
  // the next poll cycle; self-heals when the key is restored. Managed = admin restores
  // MANAGED_ANTHROPIC_KEY; BYOK = user re-adds their key in Settings. Never hard-fail on
  // a transient absence — the batch is still in-flight at Anthropic.
  if (!jobApiKey) {
    const msg = (tcJob.keySource === 'managed')
      ? 'Managed service temporarily unavailable — retrying. If this persists, please contact support@spec2jira.com.'
      : 'Your Anthropic API key is unavailable — re-add it in Settings; generation will resume.';
    console.error(`[pollTCStatus] jobId=${jobId} keySource=${tcJob.keySource} key unavailable — soft-failing`);
    return { ...tcJob, phase: msg };
  }

  if (tcJob.status !== 'batched' || !tcJob.batchId) return tcJob; // pending or unknown

  const pollResult = await pollTestCaseBatch(tcJob.batchId, jobApiKey);
  if (pollResult.error) {
    console.error(`[pollTCStatus] jobId=${jobId} batchId=${tcJob.batchId} poll failed: ${pollResult.error}`);
    // Soft-fail — return current state; next poll cycle will retry
    return { ...tcJob, phase: `Batch poll error: ${pollResult.error}` };
  }

  const counts = pollResult.requestCounts || {};
  const totalRequests =
    (counts.processing || 0) + (counts.succeeded || 0) + (counts.errored || 0) +
    (counts.canceled || 0) + (counts.expired || 0);

  // Still processing — return progress
  if (pollResult.status === 'in_progress' || pollResult.status === 'canceling') {
    return {
      ...tcJob,
      batchStatus: pollResult.status,
      phase: 'Anthropic processing test cases...',
      progress: totalRequests > 0 ? ((counts.succeeded || 0) + (counts.errored || 0)) / totalRequests : 0,
      request_counts: counts,
    };
  }

  // Batch ended — fetch JSONL + parse all N results
  if (pollResult.status === 'ended') {
    if (!pollResult.resultsUrl) {
      // [deep-audit P4 F2] yield to ANY terminal peer before the failed write — the
      // pollTestCaseBatch await sits between the top terminal guard and here. A
      // clobber of a peer's 'completed' makes the per-story results STATUS-GATED
      // UNREACHABLE (getTestCases/exports require 'completed') and the natural
      // user retry RE-SUBMITS the full billed TC batch (~$1-3.67 — the most
      // expensive call in the product) for work that already succeeded.
      const freshTc1 = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`).catch(() => null);
      if (freshTc1 && (freshTc1.status === 'completed' || freshTc1.status === 'failed')) {
        return freshTc1;
      }
      const failed = { ...tcJob, status: 'failed', completedAt: new Date().toISOString(), error: 'no_results_url', detail: 'Batch ended but Anthropic returned no results_url.' };
      // [diag F1, §3 row-3 mirror] failed-bookkeeping write — never mask the original
      // failure: record + fall through to the terminal record + the original return.
      // (On a write throw the tcjob stays 'batched' in KVS → the next poll re-runs this
      // path and retries the write; the re-fired records dedupe into occurrences.)
      try {
        await kvs.set(`${TC_JOB_KEY_PREFIX}${jobId}`, failed);
      } catch (e) {
        console.error('[diag] failed-state tcjob bookkeeping write failed ref=' + jobId, e);
        await recordDiagnostic({
          context,
          owner: tcJob.ownerAccountId,
          record: { op: 'testgen.poll', error_class: 'kvs_write_failed', level: 'warn', ref: jobId, surfaced: true },
        });
      }
      // [diag Phase 4, (C)] terminal TC-batch failure — ONE record at the batched→failed
      // transition (the top early-return blocks re-records), class via the REUSED mapper,
      // owner-bucketed (§2.4); zone-2 carries the verbatim detail.
      {
        const diagClass = classifyDiagGenerationError(failed.error);
        await recordDiagnostic({
          context,
          owner: tcJob.ownerAccountId,
          record: { op: 'testgen.batch', error_class: diagClass.error_class, level: 'error', ref: jobId, ...(diagClass.counts ? { counts: diagClass.counts } : {}), surfaced: true },
        });
        await writeDiagnosticDetail({ ref: jobId, text: String(failed.detail) });
      }
      return failed;
    }

    const fetchResult = await fetchTestCaseResults(pollResult.resultsUrl, tcJob.stampedStories, jobApiKey);
    if (fetchResult.error) {
      // [deep-audit P4 F2] the widest window — a full results download sits above;
      // same yield-to-any-terminal guard as the generation poll (see the no_results_url
      // site for the cost rationale).
      const freshTc2 = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`).catch(() => null);
      if (freshTc2 && (freshTc2.status === 'completed' || freshTc2.status === 'failed')) {
        return freshTc2;
      }
      const failed = { ...tcJob, status: 'failed', completedAt: new Date().toISOString(), error: fetchResult.error, detail: fetchResult.detail };
      // [diag F1, §3 row-3 mirror] same failed-bookkeeping contract as the no_results_url
      // site above — record + still return the original failed object.
      try {
        await kvs.set(`${TC_JOB_KEY_PREFIX}${jobId}`, failed);
      } catch (e) {
        console.error('[diag] failed-state tcjob bookkeeping write failed ref=' + jobId, e);
        await recordDiagnostic({
          context,
          owner: tcJob.ownerAccountId,
          record: { op: 'testgen.poll', error_class: 'kvs_write_failed', level: 'warn', ref: jobId, surfaced: true },
        });
      }
      // [diag Phase 4, (C)] terminal results-FETCH failure — same contract as above
      // (results_fetch_<NNN> → anthropic_http + counts.http_status via the mapper).
      {
        const diagClass = classifyDiagGenerationError(failed.error);
        await recordDiagnostic({
          context,
          owner: tcJob.ownerAccountId,
          record: { op: 'testgen.batch', error_class: diagClass.error_class, level: 'error', ref: jobId, ...(diagClass.counts ? { counts: diagClass.counts } : {}), surfaced: true },
        });
        if (failed.detail) {
          await writeDiagnosticDetail({ ref: jobId, text: String(failed.detail) });
        }
      }
      return failed;
    }

    const { perStory } = fetchResult;

    // #4 — Promise.all: write all N per-story KVS keys in parallel (never sequential —
    // 25s resolver limit; N ≤ ~50 stories is safe; chunk if spec ever exceeds ~100).
    // #3 — explicit sentinel for error rows: the KVS entry ALWAYS exists (success or error),
    // so the P5 screen can detect "failed — regenerate" rather than rendering blank.
    // #10 — payloads go to testcases:<jobId>:<idx>, never merged into tcjob.
    // [diag Phase 4, (F)] one rejected write used to reject the WHOLE completion → an opaque
    // resolver error with the tcjob stranded 'batched'. The retry semantic already existed
    // (tcjob stays 'batched' → the next poll re-fetches the already-ended batch + re-writes,
    // idempotent); we replace ONLY the opaque throw with a structured soft response.
    try {
      await Promise.all(
        perStory.map((entry) => {
          const stamped = (tcJob.stampedStories || []).find((s) => s && s.idx === entry.storyIdx);
          const storyName = (stamped && stamped.name) || '';
          const kvsValue = entry.error
            ? { storyIdx: entry.storyIdx, storyName, error: entry.error, detail: entry.detail }
            // [diag Phase 4, A5] thread the truncation flag onto the stored per-story value
            // (additive — absent on clean entries; Phase 5 may render it per-card).
            : { storyIdx: entry.storyIdx, storyName, result: entry.result, coverage: entry.coverage, ...(entry.truncated ? { truncated: true } : {}) };
          return kvs.set(`${TC_STORY_KEY_PREFIX}${jobId}:${entry.storyIdx}`, kvsValue);
        }),
      );
    } catch (e) {
      console.error(`[pollTCStatus] per-story KVS write failed (tcjob stays batched; next poll retries): ${String(e?.message || e)} ref=${jobId}`);
      await recordDiagnostic({
        context,
        owner: tcJob.ownerAccountId,
        record: { op: 'testgen.poll', error_class: 'kvs_write_failed', level: 'error', ref: jobId, surfaced: true },
      });
      // Soft-fail shape (matches the poll-error/key-vanish soft-fails above): status stays
      // 'batched' (spread, unmodified) so the UI keeps polling and the next tick retries.
      return { ...tcJob, phase: 'Storing results failed — retrying on the next poll…' };
    }

    const completedAt = new Date().toISOString();
    const failedCount = perStory.filter((e) => e.error).length;
    // ⭐ v6 cost-transparency: sum the per-request usage across the batch (each perStory entry
    // now carries message.usage) → store the raw token totals on the tcjob. The dollar cost is
    // derived on READ (getTestCases), keeping ONE pricing source of truth. 4 integers — rides the
    // existing tcjob write, no per-story KVS bloat. A regen later ACCUMULATES into this (see
    // pollRegenerateTestCase) so the displayed run total stays honest as the BA re-runs stories.
    const batchUsage = sumUsage(perStory.map((e) => e.usage));
    const completed = {
      ...tcJob,
      status: 'completed',
      completedAt,
      batchStatus: 'ended',
      failedCount,
      usage: batchUsage,
    };
    // #10 — do NOT merge perStory payloads into tcjob (240KB KVS value-size guard)
    // [diag F1, (d) completed-flip wrap — same retry contract as (F)] the per-story results
    // are already persisted above; a failed completed-flip used to throw OPAQUELY with the
    // tcjob stranded 'batched'. Keep that retry semantic (status stays 'batched' → the next
    // poll re-fetches the ended batch + re-writes, idempotent, no re-bill) but structured.
    // NO degraded inline path — test cases are re-runnable, unlike the breakdown (§3.1).
    // The coalesced records below stay coupled to the PERSISTED transition: on a soft
    // return they do not fire this tick (nothing was persisted) — the retry writes them.
    try {
      await kvs.set(`${TC_JOB_KEY_PREFIX}${jobId}`, completed);
    } catch (e) {
      console.error('[diag] completed tcjob write failed (stays batched; next poll retries) ref=' + jobId, e);
      await recordDiagnostic({
        context,
        owner: tcJob.ownerAccountId,
        record: { op: 'testgen.poll', error_class: 'kvs_write_failed', level: 'error', ref: jobId, surfaced: true },
      });
      return { ...tcJob, phase: 'Storing results failed — retrying on the next poll…' };
    }

    // [diag Phase 4, (C)] Coalesced TC-batch records — written ONCE, at the batched→completed
    // transition THIS invocation just persisted (§4: one record per flow-step, never per
    // story). Serial re-polls cannot re-record (the terminal early-return at the top); the
    // rare CONCURRENT double-poll (two in flight before either persists 'completed') is
    // absorbed by the (ref, op, class) dedupe into occurrences — same accepted residual as
    // the generation path.
    const failedEntries = perStory.filter((e) => e.error);
    const truncatedEntries = perStory.filter((e) => !e.error && e.truncated);
    if (failedCount > 0) {
      // Some stories failed → ONE error record, counts CAUSE-SPLIT from the per-story error
      // sentinels (row_missing / batch_request_* / no_message / refused / parse_failed /
      // truncated→truncated_failed — kept distinct from the salvaged count below). The TC
      // screen already shows "N failed" + per-card regenerate — that IS the surfacing.
      const causeCounts = {};
      for (const e of failedEntries) {
        const k = e.error === 'truncated' ? 'truncated_failed' : String(e.error).slice(0, 40);
        causeCounts[k] = (causeCounts[k] || 0) + 1;
      }
      await recordDiagnostic({
        context,
        owner: tcJob.ownerAccountId,
        record: {
          op: 'testgen.batch',
          error_class: 'partial_testgen',
          level: 'error',
          ref: jobId,
          subject_idxs: failedEntries.map((e) => e.storyIdx).slice(0, 20),
          counts: { ok: perStory.length - failedCount, failed: failedCount, ...causeCounts },
          surfaced: true,
        },
      });
      // Zone-2 (§2b): compact per-story summary — story NAMES are allowed in the consented
      // verbatim sibling, never in the ledger record.
      const detailText = failedEntries
        .map((e) => {
          const st = (tcJob.stampedStories || []).find((s) => s && s.idx === e.storyIdx);
          return `story ${e.storyIdx} "${(st && st.name) || '?'}": ${e.error}`;
        })
        .join('\n');
      await writeDiagnosticDetail({ ref: jobId, text: detailText });
    } else {
      // Clean completion → info breadcrumb (counts only; §2.6 info-first eviction means
      // breadcrumbs can never displace error records).
      await recordDiagnostic({
        context,
        owner: tcJob.ownerAccountId,
        record: { op: 'testgen.batch', error_class: 'testgen_completed', level: 'info', ref: jobId, counts: { stories: perStory.length }, surfaced: true },
      });
    }
    if (truncatedEntries.length > 0) {
      // [diag Phase 4, A5+(C)] truncated-but-salvaged stories persisted as successes — an
      // ADDITIONAL warn by design (the partial/breadcrumb record keeps the outcome; this one
      // flags the silent depth-loss). surfaced:false — no UI renders the flag until Phase 5.
      await recordDiagnostic({
        context,
        owner: tcJob.ownerAccountId,
        record: {
          op: 'testgen.batch',
          error_class: 'truncation_salvaged',
          level: 'warn',
          ref: jobId,
          subject_idxs: truncatedEntries.map((e) => e.storyIdx).slice(0, 20),
          counts: { truncated_stories: truncatedEntries.length },
          surfaced: false,
        },
      });
    }

    console.log(`[pollTCStatus] jobId=${jobId} COMPLETED stories=${perStory.length} failed=${failedCount}${truncatedEntries.length ? ` truncated=${truncatedEntries.length}` : ''} ref=${jobId}`);
    return completed;
  }

  // Unknown batch status
  return { ...tcJob, batchStatus: pollResult.status, phase: `Unknown batch status: ${pollResult.status}` };
});

/**
 * getTestCases — fetch the completed test-case results for a job. Standalone read —
 * reconnect-safe (#1: the caller can invoke this at any time after completion without
 * a live poll, so test cases survive page reloads and navigation).
 *
 * Returns { perStory, total, completedAt, breakdownPageVersion, failedStories, failedCount }
 *   perStory[]: each entry is { storyIdx, storyName, story:{name,acceptance_criteria}, result?, coverage?, error?, detail? }
 *   breakdownPageVersion: from tcJob.pageVersion (stamped at submit; no extra job KVS read)
 *   failedStories: names of stories that errored in the batch (#3 transparency signal)
 *   failedCount: number of errored stories (P5 all-failed check, mitigation #11)
 *
 * Mitigations wired:
 *   #1 (reconnect safety): standalone read from KVS; no live poll dependency.
 *   #4 (Promise.all): all N per-story reads in parallel.
 */
resolver.define('getTestCases', async ({ payload }) => {
  const { jobId } = payload || {};
  if (!jobId) return { error: 'no_job_id', detail: 'jobId is required.' };
  await touchJobAccess(jobId); // Task #13: viewing test cases is activity on this breakdown — renew its inactivity timer (cross-phase liveness)

  const tcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`);
  if (!tcJob) return { error: 'not_found', detail: `tcjob ${jobId} not found.` };
  if (tcJob.status !== 'completed') {
    return { error: 'not_ready', status: tcJob.status, detail: `Test case generation is in status '${tcJob.status}'.` };
  }

  const total = tcJob.total || 0;

  // #4 — Promise.all: read all N per-story keys in parallel
  const entries = await Promise.all(
    Array.from({ length: total }, (_, i) => kvs.get(`${TC_STORY_KEY_PREFIX}${jobId}:${i}`)),
  );

  const perStory = entries.map((entry, i) => {
    // Build the story reference from the lean stampedStories (no extra job lookup needed).
    // P4's renderGherkin/renderManualTable call needs story.name + acceptance_criteria.
    const stamped = (tcJob.stampedStories || []).find((s) => s && s.idx === i);
    const story = stamped
      ? { name: stamped.name || '', acceptance_criteria: stamped.acceptance_criteria || [], _uid: stamped._uid }
      : { name: '', acceptance_criteria: [] };

    if (!entry) {
      // KVS key missing — should not happen (pollTestCaseStatus writes all N keys),
      // but treat as an error sentinel for robustness (#3 defence-in-depth)
      return { storyIdx: i, storyName: story.name, story, error: 'key_missing', detail: 'Per-story KVS entry missing — regenerate this story.' };
    }
    return { ...entry, story };
  });

  // breakdownPageVersion is stamped on tcjob at submit — no extra KVS job read required.
  const breakdownPageVersion = tcJob.pageVersion;

  const failedStories = perStory
    .filter((e) => e && e.error)
    .map((e) => e.storyName || `Story ${e.storyIdx}`);

  const failedCount = perStory.filter((e) => e && e.error).length;

  // ⭐ v6 cost-transparency: surface the EXACT post-run cost echo. The tcjob stores raw token
  // totals (usage); price them batch-rate on READ so the stored record stays the single source of
  // truth and re-pricing never drifts. null when usage is absent (legacy pre-v6 tcjobs) OR all-zero
  // (a fully-errored run that billed nothing) → the FE hides the cost row rather than showing a
  // misleading "$0.00 used". estimateCost is pure; no extra API call.
  const rawUsage = tcJob.usage || null;
  const usage = (rawUsage && (rawUsage.input_tokens || rawUsage.output_tokens
    || rawUsage.cache_creation_input_tokens || rawUsage.cache_read_input_tokens)) ? rawUsage : null;
  const cost = usage ? estimateCost(usage, MODEL_PRIMARY, { batch: true }) : null;

  return {
    perStory,
    total,
    completedAt: tcJob.completedAt,
    breakdownPageVersion,
    failedStories,
    failedCount,
    usage,
    cost, // { total_usd, breakdown, cache_hit, tokens } — batch-priced; the FE shows total_usd
  };
});

/**
 * estimateTestCaseCost — v6 cost-transparency PRE-FLIGHT. Projects an HONEST batch-priced cost
 * RANGE for a test-case run BEFORE spending, so the customer confirms against the worst realistic
 * case. PURE read + projection: loads NO Anthropic key, submits NOTHING, consumes NO quota.
 * Computed backend-side because only here can we read the cached source-spec size (pagesnap) that
 * materially drives input cost. Accepts the SAME edited `breakdown` payload startTestCaseGeneration
 * does (read-only — never persists), so the estimate tracks the ACs the run will actually use.
 * No hasTestCases gate: it is a harmless number with no spend/output; the frontend only offers it
 * to Advanced (the Generate button is gated), and the real spend gate is on startTestCaseGeneration.
 */
resolver.define('estimateTestCaseCost', async ({ payload }) => {
  const { jobId } = payload || {};
  if (!jobId) return { error: 'no_job_id', detail: 'jobId is required.' };
  await touchJobAccess(jobId); // viewing the estimate is activity on this breakdown

  const job = await kvs.get(`${JOB_KEY_PREFIX}${jobId}`);
  if (!job || !job.breakdown) return { error: 'not_found', detail: `Breakdown job ${jobId} not found.` };

  // Per-story AC counts from the EDITED breakdown (payload.breakdown) when sent — so the estimate
  // matches the run — else the stored breakdown. Read-only: NEVER persists (unlike start's #1 fix).
  let stories = [];
  if (payload && payload.breakdown) {
    try {
      const { features } = flattenBreakdown(payload.breakdown);
      if (Array.isArray(features) && features.length > 0) stories = features;
    } catch (_) { /* fall through to the stored breakdown */ }
  }
  if (stories.length === 0 && Array.isArray(job.breakdown.features)) stories = job.breakdown.features;
  if (stories.length === 0) return { error: 'no_stories', detail: 'No stories to estimate.' };

  const storyACcounts = stories.map((s) =>
    (Array.isArray(s && s.acceptance_criteria) ? s.acceptance_criteria.length : 0));

  // Cached source-spec size (only the backend sees the pagesnap). Fail-soft → 0 (no source block),
  // matching submitTestCaseBatch's no-source fallback so the estimate tracks reality.
  let specSourceChars = 0;
  try {
    const src = await resolveSpecSourceText(jobId, job);
    // .trim() before measuring — submitTestCaseBatch trims then slices, so this matches the bytes
    // the run actually sends (the "identical clamp" invariant).
    specSourceChars = typeof src === 'string' ? Math.min(src.trim().length, TC_SPEC_SOURCE_MAX_CHARS) : 0;
  } catch (_) { /* no source → 0 */ }

  const projection = projectTestCaseCost({ storyACcounts, specSourceChars, model: MODEL_PRIMARY });
  return { ...projection, has_spec_source: specSourceChars > 0 };
});

/**
 * saveTestCases — persist a BA's hand-edits to ONE story's test cases.
 *
 * WHY a backend write (not in-memory like the breakdown editor): unlike the breakdown
 * (which travels in the push payload), test cases are RE-READ from KVS by BOTH the
 * dual-format export (getTestCaseExports) AND the Jira push embed (push_handler reads
 * testcases:<jobId>:<idx>). So an edit only reaches export/push if it is written back to
 * that per-story key, with coverage recomputed. This resolver is that single safe write.
 *
 * SAFETY (design-army verdict, 2026-06-06):
 *   - Re-sanitize the user-edited result through parseTestCaseResult — user input is LESS
 *     trusted than model JSON; the parser owns every bound (drop empty when/then, repair
 *     ac_trace→inferred, priority whitelist, test_data cap, cap-20 AC-covering partition,
 *     computeCoverage). One source of truth for bounds (POLICY §4).
 *   - Recompute coverage against the STAMPED ACs (tcjob.stampedStories) — the SAME ACs the
 *     push-embed AC-hash binds on and the original generation used. Never the live breakdown.
 *   - Write EXACTLY one key; tcjob (stamped ACs = embed key + coverage oracle) stays IMMUTABLE.
 *   - Editing CASES never changes the story's ACs → the AC-hash is unchanged → the push embed
 *     reads the edited entry for free (no push_handler change needed).
 *   - Reject an empty result (would silently erase this story's export + embed) + a regen
 *     in flight (last-writer race). Every failure FAILS LOUD; the frontend keeps the buffer.
 */
resolver.define('saveTestCases', async ({ payload, context }) => {
  const { jobId, storyIdx, result } = payload || {};
  const diagJobRef = cleanClientRef(jobId); // [P5 LOW-2]
  if (!jobId) return { error: 'no_job_id', detail: 'jobId is required.' };
  await touchJobAccess(jobId); // Task #13: saving a test case is activity on this breakdown — renew its inactivity timer (cross-phase liveness)
  if (typeof storyIdx !== 'number' || !Number.isInteger(storyIdx) || storyIdx < 0) {
    return { error: 'bad_story_idx', detail: 'storyIdx must be a non-negative integer.' };
  }
  if (!result || typeof result !== 'object') {
    return { error: 'invalid_result', detail: 'A test-case result object is required.' };
  }

  // Defensive license gate — editing is a licensed action (mirror regenerateTestCase).
  try {
    if (getActiveTier(context).key === 'unlicensed') return buildLicenseRequired();
  } catch (e) {
    console.error(`[saveTC] license check failed (failing open): ${String(e?.message || e)}`);
  }

  // v6 value-split FEATURE GATE (fail-CLOSED) — editing test cases is an active use of the
  // Advanced feature (a downgraded user may still READ/EXPORT prior output, but EDITING
  // requires the entitlement). Fail CLOSED on a license-read fault (see startTestCaseGeneration).
  try {
    if (!getActiveTier(context).hasTestCases) return buildUpgradeRequired();
  } catch (e) {
    console.error(`[saveTC] edition gate read failed (failing CLOSED): ${String(e?.message || e)}`);
    return buildUpgradeRequired();
  }

  const tcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`);
  if (!tcJob) return { error: 'not_found', detail: `Test-case set ${jobId} not found — it may have expired. Regenerate test cases.` };
  if (tcJob.status !== 'completed') {
    return { error: 'not_ready', status: tcJob.status, detail: 'Test cases are still generating — wait for completion before editing.' };
  }

  const total = tcJob.total || 0;
  const stamped = (tcJob.stampedStories || []).find((s) => s && s.idx === storyIdx);
  if (storyIdx >= total || !stamped) {
    return { error: 'story_out_of_range', detail: `No story at index ${storyIdx} in this test-case set (total ${total}).` };
  }

  // Regen-in-flight backstop: never overwrite a story mid-regenerate (last-writer race).
  try {
    const regen = await kvs.get(`${TC_REGEN_KEY_PREFIX}${jobId}:${storyIdx}`);
    if (regen && (regen.status === 'batched' || regen.status === 'pending')) {
      return { error: 'regen_in_progress', detail: 'This story is regenerating — wait for it to finish, then edit.' };
    }
  } catch (_) { /* non-fatal: the backstop is best-effort; the frontend also mutually-excludes */ }

  // Authoritative story = the STAMPED ACs (coverage oracle + the embed-hash basis). Immutable.
  const story = {
    name: stamped.name || '',
    acceptance_criteria: Array.isArray(stamped.acceptance_criteria) ? stamped.acceptance_criteria : [],
  };

  // Re-sanitize the edited result through the canonical parser (bounds + coverage recompute).
  const parsed = parseTestCaseResult(result, story);
  if (parsed.error) {
    return { error: 'invalid_result', detail: parsed.detail || 'The edited test cases could not be saved (invalid format).' };
  }
  // Never silently persist an empty set — it would erase this story's export + push embed.
  if (!Array.isArray(parsed.result.test_cases) || parsed.result.test_cases.length === 0) {
    return { error: 'empty_result', detail: 'A saved story must keep at least one test case (each with a When and a Then). Add a case, or use Regenerate.' };
  }

  // Overwrite the ONE per-story key — same shape the bulk/regen success entry has,
  // so getTestCases / export / push consume it unchanged. DELIBERATE difference
  // (deep-audit P4 F3): the A5 `truncated` flag is NOT carried over — saving is the
  // BA's review act; the FE save patch clears the chip in the same breath, keeping
  // screen and storage aligned (clear-on-save semantics).
  const entry = { storyIdx, storyName: story.name, result: parsed.result, coverage: parsed.coverage };
  try {
    await kvs.set(`${TC_STORY_KEY_PREFIX}${jobId}:${storyIdx}`, entry);
  } catch (e) {
    console.error(`[saveTC] KVS write failed jobId=${jobId} storyIdx=${storyIdx}: ${String(e?.message || e)} ref=${jobId}`);
    // [diag Phase 5, gate fix] the registered-but-unwired testgen.save op gets its
    // writer: the failed save is fail-loud on screen (type-A) but the ledger keeps
    // the durable trace (a REPEATING save failure = a KVS problem support must see).
    await recordDiagnostic({
      context,
      record: { op: 'testgen.save', error_class: 'kvs_write_failed', level: 'warn', ref: diagJobRef, subject: { kind: 'idx', id: storyIdx }, surfaced: true },
    });
    return { error: 'save_failed', detail: 'Could not save your edits (storage error). Your changes are still on screen — try Save again.' };
  }

  console.log(`[saveTC] jobId=${jobId} storyIdx=${storyIdx} cases=${parsed.result.test_cases.length} coverage_pct=${parsed.coverage && parsed.coverage.coverage_pct}`);
  return { ok: true, storyIdx, result: parsed.result, coverage: parsed.coverage };
});

/**
 * regenerateTestCase — submit a 1-request Sonnet batch for a single Story and
 * poll until done.
 *
 * DESIGN DECISION (flagged for the conductor per spec): a single-story regenerate
 * cannot reuse the bulk tcjob because writing to tcjob:<jobId> would clobber the
 * bulk batch's batchId/status. Instead, a SEPARATE control record
 * tcregenjob:<jobId>:<storyIdx> mirrors the tcjob shape. The per-story result key
 * testcases:<jobId>:<storyIdx> IS shared with the bulk path — on completion the
 * regenerate OVERWRITES the existing entry (the most recent generation wins, which
 * is always the intended behaviour: the user clicked Regenerate explicitly).
 *
 * This resolver SUBMITS only; the frontend polls via pollRegenerateTestCase
 * (defined next) using { jobId, storyIdx }. Both are required because the single-
 * story batch is async (Sonnet) — the same 2-10 min window as the bulk batch.
 *
 * Mitigations wired:
 *   #5 (keySource stamp): re-resolves key by source at submit.
 *   #7 (story stamp): stamps the single story on the regen control key.
 *   #9 (1-request Sonnet batch): quality-consistent with the bulk; ~2 min UX.
 */
resolver.define('regenerateTestCase', async ({ payload, context }) => {
  const { jobId, storyIdx } = payload || {};
  if (!jobId) return { error: 'no_job_id', detail: 'jobId is required.' };
  await touchJobAccess(jobId); // Task #13: regenerating a test case is activity on this breakdown — renew its inactivity timer (cross-phase liveness)
  if (typeof storyIdx !== 'number' || !Number.isInteger(storyIdx) || storyIdx < 0) {
    return { error: 'bad_story_idx', detail: 'storyIdx must be a non-negative integer.' };
  }

  // Defensive license gate
  try {
    if (getActiveTier(context).key === 'unlicensed') return buildLicenseRequired();
  } catch (e) {
    console.error(`[regenTC] license check failed (failing open): ${String(e?.message || e)}`);
  }

  // v6 value-split FEATURE GATE (fail-CLOSED) — regenerating a test case is a test-case
  // WRITE/spend path, so it requires the Advanced capability just like the bulk generate.
  // Fail CLOSED on a license-read fault (deny the premium feature; see startTestCaseGeneration).
  try {
    if (!getActiveTier(context).hasTestCases) return buildUpgradeRequired();
  } catch (e) {
    console.error(`[regenTC] edition gate read failed (failing CLOSED): ${String(e?.message || e)}`);
    return buildUpgradeRequired();
  }

  // Resolve the key (#5: regen key must match the bulk batch's keySource for cost/auth consistency)
  const tcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`);
  // [diag Phase 4] owner stamp for the regen control record (mirrors Phase 0's tcjob stamp):
  // pollRegenerateTestCase is payload-only and may be driven by another user's client, so its
  // records must bucket to the OWNER (§2.4) — bulk tcjob owner when stamped, else the invoker.
  const regenOwnerAccountId = (tcJob && tcJob.ownerAccountId) || (context && context.accountId) || null;
  // Use the bulk tcjob's keySource when available (same billing source as the original batch);
  // fall back to resolveAnthropicKey for the first-ever regen on a job with no bulk tcjob.
  // [diag Phase 4, A4] both branches use the fault-aware read — a thrown secret read is a
  // storage fault, NOT "no key configured".
  let apiKey, keySource, keyFault = false;
  if (tcJob && tcJob.keySource) {
    keySource = tcJob.keySource;
    const info = await anthropicKeyInfoForSource(keySource);
    apiKey = info.key;
    keyFault = info.fault;
  } else {
    const resolved = await resolveAnthropicKey(context);
    apiKey = resolved.apiKey;
    keySource = resolved.keySource;
    keyFault = resolved.keyFault;
  }
  if (!apiKey) {
    // [diag Phase 4, A4] storage-fault FIRST (BYOK-only; never masks managed_unavailable).
    if (keyFault) {
      console.error(`[regenTC] stored-key read FAULTED (storage, not "no key") ref=${jobId}`);
      await recordDiagnostic({
        context,
        owner: regenOwnerAccountId,
        record: { op: 'testgen.regen', error_class: 'key_storage_failed', level: 'error', ref: jobId, surfaced: true },
      });
      return { error: 'key_storage_failed', detail: KEY_STORAGE_FAILED_DETAIL };
    }
    if (keySource === 'managed') return { error: 'managed_unavailable', detail: 'The Managed service is temporarily unavailable. Please contact support@spec2jira.com.' };
    return { error: 'not_configured', detail: 'Anthropic API key not configured.' };
  }

  // Load the full story from the breakdown job
  const job = await kvs.get(`${JOB_KEY_PREFIX}${jobId}`);
  if (!job || job.status !== 'completed') {
    return { error: 'breakdown_not_ready', detail: 'Breakdown job must be completed before regenerating test cases.' };
  }
  // (b) Persist the EDITED breakdown (sent from the Test Cases screen) so this single-story regen
  // reads the BA's edited ACs — NOT the generation-time snapshot. Mirrors the #1 fix in
  // startTestCaseGeneration. Without it a per-card regen after an in-app edit reproduces the STALE
  // cases (it reads job.breakdown.features[storyIdx]). Best-effort: fall back to the stored breakdown.
  if (payload && payload.breakdown) {
    try {
      const { features: editedFeatures } = flattenBreakdown(payload.breakdown);
      if (Array.isArray(editedFeatures) && editedFeatures.length > 0) {
        // (#4 skip-if-unchanged) only re-persist when the edited ACs actually differ from the stored
        // breakdown — avoids a redundant full-breakdown KVS write per regen (e.g. the retry-N-failed loop).
        const acSig = (fs) => (Array.isArray(fs) ? fs : []).flatMap((s) => (Array.isArray(s && s.acceptance_criteria) ? s.acceptance_criteria : [])).map(normAC).sort().join('|');
        if (acSig(editedFeatures) !== acSig(job.breakdown && job.breakdown.features)) {
          job.breakdown = { ...job.breakdown, features: editedFeatures };
          await setJob(jobId,job);
        }
      } else {
        // [diag Phase 4, gate symmetry] a 0-features flatten is the SAME silent
        // pristine-fallback as the catch below (startTCGen records both branches).
        console.error(`[regenTC] edited-breakdown flatten produced 0 features (using stored) ref=${jobId}`);
        await recordDiagnostic({
          context,
          owner: regenOwnerAccountId,
          record: { op: 'testgen.regen', error_class: 'edited_persist_failed', level: 'warn', ref: jobId, surfaced: false },
        });
      }
    } catch (e) {
      console.error(`[regenTC] edited-breakdown persist failed (using stored): ${String(e?.message || e)} ref=${jobId}`);
      // [diag Phase 4, (E) §2.2 :2450 — worst offender #11] silent pristine-fallback: this regen
      // reads the STORED (possibly stale) ACs, not the BA's edits. Same class as the
      // startTestCaseGeneration site; op = THIS flow's step (testgen.regen), so the two sites
      // stay distinguishable in the ledger (each site's own retries dedupe-merge).
      await recordDiagnostic({
        context,
        owner: regenOwnerAccountId,
        record: { op: 'testgen.regen', error_class: 'edited_persist_failed', level: 'warn', ref: jobId, surfaced: false },
      });
    }
  }
  const stories = (job.breakdown && Array.isArray(job.breakdown.features)) ? job.breakdown.features : [];
  // (POLICY §3.5) target the story the CARD represents by its STABLE _uid (stamped at generation),
  // robust to reorder/delete in the editor; fall back to unique stamped-name, then positional index.
  const stamped = (tcJob && Array.isArray(tcJob.stampedStories)) ? tcJob.stampedStories.find((s) => s && s.idx === storyIdx) : null;
  let story = null;
  if (stamped && stamped._uid) {
    // uid-bearing stamp → resolve by uid, then unique name. If NEITHER matches, the story was REMOVED
    // from the breakdown (editor delete) → return a clear error rather than positional-falling-back to
    // a NEIGHBOUR (which would mis-target it + write a DUPLICATE-named card — the live bug found 2026-06-08).
    story = stories.find((s) => s && s._uid === stamped._uid) || null;
    if (!story && stamped.name) { const named = stories.filter((s) => s && s.name === stamped.name); if (named.length === 1) story = named[0]; }
    if (!story) {
      return { error: 'story_removed', detail: 'This story was removed from the breakdown — it can no longer be regenerated. Push as-is (it will not embed) or remove its test-case card.' };
    }
  } else {
    // legacy (no _uid): name → positional index — pre-uid breakdowns keep the old behaviour.
    if (stamped && stamped.name) { const named = stories.filter((s) => s && s.name === stamped.name); if (named.length === 1) story = named[0]; }
    if (!story) story = stories[storyIdx];
    if (!story) {
      return { error: 'story_not_found', detail: `No story at index ${storyIdx}.` };
    }
  }

  const sharedACs = (job.breakdown && Array.isArray(job.breakdown.shared_acceptance_criteria))
    ? job.breakdown.shared_acceptance_criteria : [];
  const specSummary = (job.breakdown && job.breakdown.metadata && job.breakdown.metadata.spec_summary) || '';

  const createdAt = new Date().toISOString();

  // Write the regen control key (separate from the bulk tcjob). NOTE: stampedStories uses
  // idx:0 — the batch-LOCAL index matching the 1-request custom_id "0"; the real breakdown
  // position is the payload storyIdx (the KVS key suffix + the testcases:<jobId>:<storyIdx> write).
  // [diag Phase 4] ownerAccountId stamped on all three full-record writes (fresh literals).
  // [diag F1, §3 row-1 mirror] BEFORE the billed 1-request submit — fail-fast (no money
  // spent yet), structured instead of an opaque resolver death.
  try {
    await kvs.set(`${TC_REGEN_KEY_PREFIX}${jobId}:${storyIdx}`, {
      jobId, storyIdx, status: 'pending', keySource, ownerAccountId: regenOwnerAccountId,
      stampedStories: [{ idx: 0, _uid: story._uid, name: story.name || '', acceptance_criteria: Array.isArray(story.acceptance_criteria) ? story.acceptance_criteria : [] }],
      createdAt,
    });
  } catch (e) {
    console.error('[diag] initial tcregenjob write failed ref=' + jobId, e);
    await recordDiagnostic({
      context,
      owner: regenOwnerAccountId,
      record: { op: 'testgen.regen', error_class: 'kvs_write_failed', level: 'error', ref: jobId, subject: { kind: 'idx', id: storyIdx }, surfaced: true },
    });
    return {
      error: 'kvs_write_failed',
      detail:
        'Could not store the regeneration job in Forge storage. Please try again — if it persists, contact support@spec2jira.com.',
      job_id: jobId,
    };
  }

  // Submit a 1-request batch (all siblings passed as context — scope fence is important
  // for a correct regenerate; quality-consistent with the bulk Sonnet call #9)
  // §8 fix: feed the source-page snapshot so a single-story regen mines the same business rules.
  const specSourceText = await resolveSpecSourceText(jobId, job);
  const submitResult = await submitTestCaseBatch({
    stories: [story],
    allStories: stories, // §8 (#2): resolve dependency peers from the FULL feature list, not the 1-element regen batch
    siblingNames: stories.map((s) => s && (s.name || '')),
    sharedAcceptanceCriteria: sharedACs,
    specConcerns: (job.breakdown && Array.isArray(job.breakdown.spec_concerns)) ? job.breakdown.spec_concerns : [],
    specSummary,
    specSourceText,
    apiKey,
  });

  if (submitResult.error) {
    console.error(`[regenTC] submit failed: ${submitResult.error} | ${submitResult.detail} ref=${jobId}`);
    // [diag Phase 4, (C)] regen terminal SUBMIT failure — class via the REUSED generation
    // mapper; subject pins WHICH story's card failed; zone-2 carries the verbatim detail.
    {
      const diagClass = classifyDiagGenerationError(submitResult.error);
      await recordDiagnostic({
        context,
        owner: regenOwnerAccountId,
        record: {
          op: 'testgen.regen',
          error_class: diagClass.error_class,
          level: 'error',
          ref: jobId,
          subject: { kind: 'idx', id: storyIdx },
          ...(diagClass.counts ? { counts: diagClass.counts } : {}),
          surfaced: true,
        },
      });
      if (submitResult.detail) {
        await writeDiagnosticDetail({ ref: jobId, text: String(submitResult.detail) });
      }
    }
    // [diag F1, §3 row-3 mirror] failed-submit bookkeeping — never mask the original error:
    // record + still return the original structured error below.
    try {
      await kvs.set(`${TC_REGEN_KEY_PREFIX}${jobId}:${storyIdx}`, {
        jobId, storyIdx, status: 'failed', keySource, ownerAccountId: regenOwnerAccountId,
        stampedStories: [{ idx: 0, _uid: story._uid, name: story.name || '', acceptance_criteria: Array.isArray(story.acceptance_criteria) ? story.acceptance_criteria : [] }],
        createdAt, error: submitResult.error, detail: submitResult.detail,
      });
    } catch (e) {
      console.error('[diag] failed-state tcregenjob bookkeeping write failed ref=' + jobId, e);
      await recordDiagnostic({
        context,
        owner: regenOwnerAccountId,
        record: { op: 'testgen.regen', error_class: 'kvs_write_failed', level: 'warn', ref: jobId, subject: { kind: 'idx', id: storyIdx }, surfaced: true },
      });
    }
    return { error: submitResult.error, detail: submitResult.detail };
  }

  // [diag F1, §3 row-4 mirror] AFTER the billed submit — money is spent, NEVER abort:
  // record tracking_degraded + proceed to the normal success response. Without a batchId
  // the control record stays 'pending' (the poll returns it untouched; a re-click
  // re-submits a fresh billed batch) — exactly the support signal this record carries.
  let trackingDegraded = false;
  try {
    await kvs.set(`${TC_REGEN_KEY_PREFIX}${jobId}:${storyIdx}`, {
      jobId, storyIdx, status: 'batched', keySource, ownerAccountId: regenOwnerAccountId,
      stampedStories: [{ idx: 0, _uid: story._uid, name: story.name || '', acceptance_criteria: Array.isArray(story.acceptance_criteria) ? story.acceptance_criteria : [] }],
      batchId: submitResult.batchId,
      batchStatus: submitResult.status,
      createdAt, submittedAt: new Date().toISOString(), expiresAt: submitResult.expiresAt,
    });
  } catch (e) {
    trackingDegraded = true;
    console.error('[diag] batched tcregenjob write failed ref=' + jobId, e);
    await recordDiagnostic({
      context,
      owner: regenOwnerAccountId,
      record: { op: 'testgen.regen', error_class: 'tracking_degraded', level: 'warn', ref: jobId, subject: { kind: 'idx', id: storyIdx }, surfaced: false },
    });
  }

  console.log(`[regenTC] jobId=${jobId} storyIdx=${storyIdx} batchId=${submitResult.batchId}`);
  return {
    jobId, storyIdx, status: 'batched', batchId: submitResult.batchId,
    // [diag F1] additive (§3 row-4); the frontend ignores unknown fields today.
    ...(trackingDegraded ? { tracking_degraded: true } : {}),
  };
});

/**
 * pollRegenerateTestCase — poll a single-story regen batch until done.
 * On completion, overwrites testcases:<jobId>:<storyIdx> with the new result.
 * The frontend polls this (same pattern as pollTestCaseStatus for the bulk job).
 *
 * Mitigations wired:
 *   #3 (explicit sentinel): error rows write an explicit error entry, never blank.
 *   #5 (managed key guard): soft-fail if managed key vanished.
 */
resolver.define('pollRegenerateTestCase', async ({ payload, context }) => {
  // `context` (diag Phase 4): recordDiagnostic's invoker-fallback bucket; regen-scoped
  // records pass owner: regenJob.ownerAccountId (stamped by regenerateTestCase this phase;
  // legacy regen records without it fall back to the invoker — design §2.4).
  const { jobId, storyIdx } = payload || {};
  if (!jobId || typeof storyIdx !== 'number') {
    return { error: 'bad_args', detail: 'jobId and numeric storyIdx are required.' };
  }
  await touchJobAccess(jobId); // Task #13: polling a live regen is activity on this breakdown — renew its inactivity timer (cross-phase liveness)

  const regenKey = `${TC_REGEN_KEY_PREFIX}${jobId}:${storyIdx}`;
  const regenJob = await kvs.get(regenKey);
  if (!regenJob) return { error: 'not_found', detail: `Regen job ${jobId}:${storyIdx} not found.` };

  // Terminal states
  if (regenJob.status === 'completed' || regenJob.status === 'failed') return regenJob;
  if (regenJob.status !== 'batched' || !regenJob.batchId) return regenJob;

  // #5 — Key-vanish guard (generalized, same as pollTestCaseStatus)
  const jobApiKey = await anthropicKeyForSource(regenJob.keySource || 'byok');
  if (!jobApiKey) {
    const msg = (regenJob.keySource === 'managed')
      ? 'Managed service temporarily unavailable — retrying. If this persists, please contact support@spec2jira.com.'
      : 'Your Anthropic API key is unavailable — re-add it in Settings; generation will resume.';
    console.error(`[pollRegenTC] jobId=${jobId}:${storyIdx} keySource=${regenJob.keySource} key unavailable — soft-failing`);
    return { ...regenJob, phase: msg };
  }

  const pollResult = await pollTestCaseBatch(regenJob.batchId, jobApiKey);
  if (pollResult.error) {
    console.error(`[pollRegenTC] poll failed: ${pollResult.error}`);
    return { ...regenJob, phase: `Batch poll error: ${pollResult.error}` };
  }

  const counts = pollResult.requestCounts || {};
  const totalRequests = (counts.processing || 0) + (counts.succeeded || 0) + (counts.errored || 0) + (counts.canceled || 0) + (counts.expired || 0);

  if (pollResult.status === 'in_progress' || pollResult.status === 'canceling') {
    return { ...regenJob, batchStatus: pollResult.status, phase: 'Regenerating test cases...', progress: totalRequests > 0 ? ((counts.succeeded || 0) + (counts.errored || 0)) / totalRequests : 0 };
  }

  if (pollResult.status === 'ended') {
    if (!pollResult.resultsUrl) {
      // [deep-audit P4 F2] yield to a terminal peer (the pollTestCaseBatch await sits
      // above) — same guard family as the bulk TC poll; a regen re-run is cheap
      // (~$0.065) but the guard is 3 lines and keeps the terminal-is-terminal rule.
      const freshRg1 = await kvs.get(regenKey).catch(() => null);
      if (freshRg1 && (freshRg1.status === 'completed' || freshRg1.status === 'failed')) {
        return freshRg1;
      }
      const failed = { ...regenJob, status: 'failed', completedAt: new Date().toISOString(), error: 'no_results_url', detail: 'Batch ended but Anthropic returned no results_url.' };
      // [diag F1, §3 row-3 mirror] failed-bookkeeping write — never mask the original
      // failure: record + fall through to the terminal record + the original return.
      try {
        await kvs.set(regenKey, failed);
      } catch (e) {
        console.error('[diag] failed-state tcregenjob bookkeeping write failed ref=' + jobId, e);
        await recordDiagnostic({
          context,
          owner: regenJob.ownerAccountId,
          record: { op: 'testgen.regen', error_class: 'kvs_write_failed', level: 'warn', ref: jobId, subject: { kind: 'idx', id: storyIdx }, surfaced: true },
        });
      }
      // [diag Phase 4, (C)] regen terminal failure — ONE record at the batched→failed
      // transition (the terminal early-return at the top blocks re-records); class via the
      // REUSED mapper; subject pins the story; zone-2 carries the verbatim detail.
      {
        const diagClass = classifyDiagGenerationError(failed.error);
        await recordDiagnostic({
          context,
          owner: regenJob.ownerAccountId,
          record: { op: 'testgen.regen', error_class: diagClass.error_class, level: 'error', ref: jobId, subject: { kind: 'idx', id: storyIdx }, ...(diagClass.counts ? { counts: diagClass.counts } : {}), surfaced: true },
        });
        await writeDiagnosticDetail({ ref: jobId, text: String(failed.detail) });
      }
      return failed;
    }

    const fetchResult = await fetchTestCaseResults(pollResult.resultsUrl, regenJob.stampedStories, jobApiKey);
    if (fetchResult.error) {
      // [deep-audit P4 F2] widest regen window (the results download sits above).
      const freshRg2 = await kvs.get(regenKey).catch(() => null);
      if (freshRg2 && (freshRg2.status === 'completed' || freshRg2.status === 'failed')) {
        return freshRg2;
      }
      const failed = { ...regenJob, status: 'failed', completedAt: new Date().toISOString(), error: fetchResult.error, detail: fetchResult.detail };
      // [diag F1, §3 row-3 mirror] same failed-bookkeeping contract as the no_results_url
      // site above — record + still return the original failed object.
      try {
        await kvs.set(regenKey, failed);
      } catch (e) {
        console.error('[diag] failed-state tcregenjob bookkeeping write failed ref=' + jobId, e);
        await recordDiagnostic({
          context,
          owner: regenJob.ownerAccountId,
          record: { op: 'testgen.regen', error_class: 'kvs_write_failed', level: 'warn', ref: jobId, subject: { kind: 'idx', id: storyIdx }, surfaced: true },
        });
      }
      // [diag Phase 4, (C)] regen terminal results-FETCH failure — same contract as above.
      {
        const diagClass = classifyDiagGenerationError(failed.error);
        await recordDiagnostic({
          context,
          owner: regenJob.ownerAccountId,
          record: { op: 'testgen.regen', error_class: diagClass.error_class, level: 'error', ref: jobId, subject: { kind: 'idx', id: storyIdx }, ...(diagClass.counts ? { counts: diagClass.counts } : {}), surfaced: true },
        });
        if (failed.detail) {
          await writeDiagnosticDetail({ ref: jobId, text: String(failed.detail) });
        }
      }
      return failed;
    }

    const entry = fetchResult.perStory[0];
    const storyName = regenJob.stampedStories[0] && regenJob.stampedStories[0].name || '';
    // The story this regen used = the EDITED story (regenerateTestCase stamped it from the freshly
    // persisted job.breakdown). Returned to the frontend + synced into the bulk tcjob below.
    const editedStory = (regenJob.stampedStories && regenJob.stampedStories[0]) || null;

    // Overwrite the shared per-story KVS key (intentional: user clicked Regenerate)
    // #3 — explicit sentinel even for regen errors
    // [diag Phase 4, A5] truncated flag threaded onto the stored value (same as the bulk path).
    const storyKvsValue = entry && !entry.error
      ? { storyIdx, storyName, result: entry.result, coverage: entry.coverage, ...(entry.truncated ? { truncated: true } : {}) }
      : { storyIdx, storyName, error: (entry && entry.error) || 'regen_failed', detail: (entry && entry.detail) || 'Regen parse failed.' };
    // [diag Phase 4, (G) — worst offender #8, DETECTION half] A failed regen is about to
    // overwrite the SHARED testcases:<jobId>:<idx> key. If that key held GOOD cases, the
    // overwrite DESTROYS them with no undo — read the prior value (1 KVS get, rare error
    // path) and record the destruction. The overwrite behaviour itself is UNCHANGED — the
    // keep-prior-good fix is the Layer-1 behavioral half, not this phase.
    if (storyKvsValue.error) {
      let priorHeldGood = false;
      try {
        const prior = await kvs.get(`${TC_STORY_KEY_PREFIX}${jobId}:${storyIdx}`);
        priorHeldGood = !!(prior && !prior.error && prior.result
          && Array.isArray(prior.result.test_cases) && prior.result.test_cases.length > 0);
      } catch (_) { /* detection is best-effort — never block the write path */ }
      if (priorHeldGood) {
        await recordDiagnostic({
          context,
          owner: regenJob.ownerAccountId,
          record: { op: 'testgen.regen', error_class: 'regen_overwrote_good', level: 'error', ref: jobId, subject: { kind: 'idx', id: storyIdx }, surfaced: true },
        });
      }
      // [diag Phase 4, gate symmetry] the regen ENTRY itself failed (refused /
      // parse_failed / truncated / row_missing / batch_request_*) — mirror the
      // bulk path's per-cause record so a targeted-retry failure leaves a
      // durable trace beyond the transient card ⚠ (the bulk partial_testgen
      // record only covers the ORIGINAL batch, not this regen attempt).
      await recordDiagnostic({
        context,
        owner: regenJob.ownerAccountId,
        record: {
          op: 'testgen.regen',
          ...classifyDiagGenerationError(storyKvsValue.error),
          level: 'error',
          ref: jobId,
          subject: { kind: 'idx', id: storyIdx },
          surfaced: true,
        },
      });
    }
    // [diag F1, (F)/(d)-mirror for the regen flow] the per-story result write + the
    // completed control-flip form ONE persist step with ONE correct catch semantic: the
    // regen stays 'batched' → the next poll re-fetches the ended batch + re-writes
    // (idempotent, no re-bill) — structured soft return instead of an opaque death. NO
    // degraded inline path — a regen is re-runnable. (A throw re-fires the (G)/per-cause
    // records next tick — the (ref, op, class) dedupe absorbs them into occurrences,
    // the accepted (F) pattern.)
    // [deep-audit D-#3] Idempotency guard against a CONCURRENT re-poll: the FE polls on a fixed
    // interval with no in-flight guard, and the ended-batch download+parse above can outlast one
    // tick — so two ticks can both reach here while the regen is still 'batched'. If another tick
    // already flipped this regen to a terminal state, BAIL: re-doing the writes + the bulk-usage
    // accumulate below would DOUBLE-COUNT the cost echo (over-state the bill). Mirrors freshRg2 on
    // the fetch-error path. (Narrows the window to ~ms between this read and the regenKey write;
    // Forge KVS has no compare-and-set, so it is a strong mitigation, not a hard lock.)
    const freshRg3 = await kvs.get(regenKey).catch(() => null);
    if (freshRg3 && (freshRg3.status === 'completed' || freshRg3.status === 'failed')) {
      return freshRg3;
    }

    const completed = { ...regenJob, status: 'completed', completedAt: new Date().toISOString(), batchStatus: 'ended' };
    try {
      await kvs.set(`${TC_STORY_KEY_PREFIX}${jobId}:${storyIdx}`, storyKvsValue);
      await kvs.set(regenKey, completed);
    } catch (e) {
      console.error('[diag] regen result/completed write failed (stays batched; next poll retries) ref=' + jobId, e);
      await recordDiagnostic({
        context,
        owner: regenJob.ownerAccountId,
        record: { op: 'testgen.regen', error_class: 'kvs_write_failed', level: 'error', ref: jobId, subject: { kind: 'idx', id: storyIdx }, surfaced: true },
      });
      return { ...regenJob, phase: 'Storing results failed — retrying on the next poll…' };
    }

    // (c) Sync the bulk tcjob's stamped story for this idx to the EDITED ACs (= what this regen used)
    // so the push-embed AC-hash (it hashes tcjob.stampedStories) matches the regenerated story AND the
    // frontend per-story staleness clears. Non-fatal: the per-story result write above is authoritative.
    // Bulk-tcjob read-modify-write: (1) ACCUMULATE this regen's real usage into the run total —
    // regardless of success/failure; (2) on SUCCESS, sync the stamped story's edited ACs.
    if (entry && (entry.usage || (!entry.error && editedStory))) {
      try {
        const bulkTcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`);
        if (bulkTcJob) {
          let dirty = false;
          // ⭐ v6 cost-transparency (CRITICAL): accumulate THIS regen's real usage into the bulk run
          // total so the echo stays honest as the BA re-runs stories (a regen is additional real spend).
          // ⭐ [deep-audit D-#2] accumulate even on a FAILED regen (entry.error): a max_tokens regen still
          // burned the full output budget, and the BULK poll counts errored rows too (sumUsage over ALL
          // perStory) — so the regen path MUST match or the echo UNDER-counts the costliest failure.
          // Idempotency: the terminal status-guard at the top + the freshRg3 re-read above keep this to
          // exactly once per regen.
          // ⚠ KNOWN RESIDUAL (accepted): a "Regenerate N failed" fan-out fires N PARALLEL regens for
          // DIFFERENT stories that each read-modify-write this one key — Forge KVS has no compare-and-set,
          // so concurrent accumulations can lose-update and the echo under-counts slightly. Customer-
          // favourable direction; self-corrects on the next getTestCases that reads a settled tcjob.
          if (entry.usage) {
            bulkTcJob.usage = sumUsage([bulkTcJob.usage, entry.usage]);
            dirty = true;
          }
          if (!entry.error && editedStory && Array.isArray(bulkTcJob.stampedStories)) {
            const pos = bulkTcJob.stampedStories.findIndex((s) => s && s.idx === storyIdx);
            if (pos >= 0) {
              bulkTcJob.stampedStories[pos] = {
                ...bulkTcJob.stampedStories[pos],
                name: editedStory.name || bulkTcJob.stampedStories[pos].name,
                acceptance_criteria: Array.isArray(editedStory.acceptance_criteria) ? editedStory.acceptance_criteria : [],
              };
              dirty = true;
            }
          }
          if (dirty) await kvs.set(`${TC_JOB_KEY_PREFIX}${jobId}`, bulkTcJob);
        }
      } catch (e) {
        console.error(`[pollRegenTC] stampedStories sync failed (non-fatal): ${String(e?.message || e)} ref=${jobId}`);
        // [diag Phase 4, gate F2 — the one →L row both nets missed] silent stamp
        // drift: the staleness chip never clears + the push-embed AC-hash diverges
        // → the embed silently skips this story at push. Same-tuple retries
        // dedupe-merge into occurrences.
        await recordDiagnostic({
          context,
          owner: regenJob.ownerAccountId,
          record: { op: 'testgen.regen', error_class: 'kvs_write_failed', level: 'warn', ref: jobId, surfaced: false },
        });
      }
    }

    console.log(`[pollRegenTC] jobId=${jobId} storyIdx=${storyIdx} COMPLETED error=${entry && !!entry.error} ref=${jobId}`);
    return {
      ...completed,
      result: storyKvsValue.result,
      coverage: storyKvsValue.coverage,
      error: storyKvsValue.error,
      // [deep-audit P4 F1] the A5 flag must ride the LIVE regen response — without it
      // the FE patch kept a STALE chip (clean regen) or showed NO chip (still-truncated
      // regen) until a remount re-read storage.
      ...(storyKvsValue.truncated ? { truncated: true } : {}),
      // (c) hand the frontend the EDITED story → it patches perStory[idx].story so staleness clears.
      story: (entry && !entry.error && editedStory)
        ? { name: editedStory.name || storyName, acceptance_criteria: Array.isArray(editedStory.acceptance_criteria) ? editedStory.acceptance_criteria : [], _uid: editedStory._uid }
        : undefined,
    };
  }

  return { ...regenJob, batchStatus: pollResult.status, phase: `Unknown batch status: ${pollResult.status}` };
});

/**
 * getTestCaseExports — deterministic pure-render resolver (NO LLM, NO KVS writes).
 * Returns Gherkin and/or CSV for one story (storyIdx = number) or all stories
 * (storyIdx = null / omitted). Reads the same testcases:<jobId>:<idx> entries
 * that getTestCases reads; fails gracefully on missing/error entries.
 *
 * Payload: { jobId, storyIdx?, format? }
 *   jobId     — required; the completed breakdown job id
 *   storyIdx  — number → single story; null/omitted → all stories (concat)
 *   format    — 'gherkin' | 'csv' | 'both' (default 'both')
 *
 * Returns: { gherkin?, csv? } or { error, detail }
 *   confidence is NEVER exported (opts { includeConfidence: false }).
 */
resolver.define('getTestCaseExports', async ({ payload, context }) => {
  // `context` (diag Phase 4, A7): for the export_partial/export_failed records below.
  const { jobId, storyIdx, format = 'both' } = payload || {};
  const diagJobRef = cleanClientRef(jobId); // [P5 LOW-2]
  if (!jobId) return { error: 'no_job_id', detail: 'jobId is required.' };
  await touchJobAccess(jobId); // Task #13: exporting test cases is activity on this breakdown — renew its inactivity timer (cross-phase liveness)

  const tcJob = await kvs.get(`${TC_JOB_KEY_PREFIX}${jobId}`).catch(() => null);
  if (!tcJob) return { error: 'not_found', detail: `tcjob ${jobId} not found.` };
  if (tcJob.status !== 'completed') {
    return { error: 'not_ready', status: tcJob.status, detail: `Test case generation is in status '${tcJob.status}'.` };
  }

  const total = tcJob.total || 0;
  const stampedStories = tcJob.stampedStories || [];

  // Determine which indices to render
  const indices = (typeof storyIdx === 'number' && Number.isInteger(storyIdx) && storyIdx >= 0)
    ? [storyIdx]
    : Array.from({ length: total }, (_, i) => i);

  // Read all required per-story entries in parallel (pure read, no writes)
  const entries = await Promise.all(
    indices.map((idx) => kvs.get(`${TC_STORY_KEY_PREFIX}${jobId}:${idx}`).catch(() => null)),
  );

  const renderOpts = { includeConfidence: false };
  const gherkinParts = [];
  // CSV: first valid story gets headerRow:true (includes column header); subsequent
  // stories get headerRow:false so there is exactly ONE header row in the combined CSV.
  const csvParts = [];
  let csvHeaderEmitted = false;

  // [diag Phase 4, A7 — worst offender #7] Every non-exported story is now COUNTED
  // (missing entry / error sentinel / render threw) instead of a bare `continue` — an
  // 8-story file used to look complete when 2 stories silently failed. A render throw now
  // skips ONLY that story (it used to kill the whole export). Clean exports are
  // byte-identical: same parts, same joins, marker only when something was skipped.
  const skippedIdxs = [];
  const truncatedIdxs = []; // [P4 F6] exported but A5-flagged stories
  let exportedCount = 0;

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    const entry = entries[i];
    if (!entry || entry.error) {
      skippedIdxs.push(idx); // missing / failed-generation entry — counted, no longer silent
      continue;
    }
    // [deep-audit P4 F6] a truncated-but-salvaged story exports NORMALLY — count it so
    // the marker + the FE note can say "may be truncated" (the chip was screen-only;
    // the .feature/CSV shipped possibly-incomplete cases with zero honesty signal).
    if (entry.truncated === true) truncatedIdxs.push(idx);

    const stamped = stampedStories.find((s) => s && s.idx === idx);
    const story = stamped
      ? { name: stamped.name || '', acceptance_criteria: stamped.acceptance_criteria || [] }
      : { name: entry.storyName || '', acceptance_criteria: [] };

    const result = entry.result;
    if (!result) {
      skippedIdxs.push(idx);
      continue;
    }

    try {
      // Render to locals FIRST, push after BOTH succeeded — a throw mid-story can never
      // leave a half-exported story (gherkin pushed, csv missing).
      let g = null;
      let c = null;
      if (format === 'gherkin' || format === 'both') {
        g = renderGherkin(result, story, renderOpts);
      }
      if (format === 'csv' || format === 'both') {
        const { csv } = renderManualTable(result, story, { ...renderOpts, headerRow: !csvHeaderEmitted });
        c = csv;
      }
      if (g) gherkinParts.push(g);
      if (c) {
        csvParts.push(c);
        csvHeaderEmitted = true;
      }
      exportedCount++;
    } catch (e) {
      console.error(`[tcExport] render threw for story ${idx} — story skipped, export continues: ${String(e?.message || e)} ref=${jobId}`);
      skippedIdxs.push(idx);
    }
  }

  const out = {};

  if (format === 'gherkin' || format === 'both') {
    const body = gherkinParts.join('\n\n');
    // [diag Phase 4, A7 + F6] In-file honesty markers — GHERKIN ONLY (`#` comments are
    // valid .feature syntax; CSV gets NO in-data marker — RFC-4180 has no comment concept
    // and an injected row would corrupt tool imports). Absent on a clean export
    // (byte-identical).
    const markers = [];
    if (skippedIdxs.length > 0) {
      markers.push(`# NOTE: ${skippedIdxs.length} of ${indices.length} stories are NOT included (generation failed or data missing) — see Settings → Diagnostics`);
    }
    if (truncatedIdxs.length > 0) {
      markers.push(`# NOTE: ${truncatedIdxs.length} ${truncatedIdxs.length === 1 ? 'story' : 'stories'} may be TRUNCATED (the generation hit its output limit — the case list may be incomplete) — regenerate to be sure`);
    }
    out.gherkin = markers.length > 0 ? `${markers.join('\n')}\n${body}` : body;
  }
  if (format === 'csv' || format === 'both') {
    out.csv = csvParts.join('\n');
  }

  if (skippedIdxs.length > 0) {
    // [diag Phase 4, A7] export_partial (warn) — or export_failed (error) when EVERYTHING
    // was skipped (the file is empty pretense). surfaced:true — the gherkin marker + the
    // additive response fields are the surfacing.
    const allSkipped = exportedCount === 0;
    await recordDiagnostic({
      context,
      owner: tcJob.ownerAccountId,
      record: {
        op: 'testgen.export',
        error_class: allSkipped ? 'export_failed' : 'export_partial',
        level: allSkipped ? 'error' : 'warn',
        ref: diagJobRef,
        subject_idxs: skippedIdxs.slice(0, 20),
        counts: { exported: exportedCount, skipped: skippedIdxs.length },
        surfaced: true,
      },
    });
  }

  // [diag Phase 4, A7] additive response fields — the FE renders "N stories not
  // included" + (F6) "N may be truncated" next to the Copy buttons.
  out.skipped = skippedIdxs.length;
  out.skipped_idxs = skippedIdxs;
  out.truncated = truncatedIdxs.length;
  out.truncated_idxs = truncatedIdxs;

  return out;
});

// ════════════════════════════════════════════════════════════
// DIAGNOSTICS SURFACES — Phase 5 (docs/DIAGNOSTICS-LEDGER-DESIGN.md §2.10/§2b/§5)
// Read / export / health / client-fallback / clear resolvers over the Phase 0-4
// ledger. FROZEN CONTRACTS — the frontend Diagnostics tab is built against
// exactly these shapes; do not change them unilaterally.
// ════════════════════════════════════════════════════════════

/**
 * Live Jira ADMINISTER check (§2.10 admin gate). Per REQUEST, no caching — an
 * admin demoted mid-session loses 'all' scope on their next call. Covered by the
 * already-held classic read:jira-work scope (NO manifest delta). ANY error /
 * non-OK / missing field → false: the caller silently falls back to 'mine'
 * (never trust the client toggle, never surface an error for the check itself —
 * a Confluence-admin-without-Jira-access lands here by design, documented edge).
 */
async function checkJiraAdminister() {
  try {
    const resp = await api
      .asUser()
      .requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
    if (!resp.ok) return false;
    const data = await resp.json();
    return data?.permissions?.ADMINISTER?.havePermission === true;
  } catch (e) {
    return false;
  }
}

/**
 * Sanitize the install-wide aggregate sidecar for serving: keep ONLY closed-
 * registry classes with finite numbers — the same second-wall stance the record
 * path takes (a tampered/legacy :agg value cannot push prose keys to the FE).
 */
function sanitizeAggregate(aggRaw) {
  const agg = aggRaw && typeof aggRaw === 'object' && !Array.isArray(aggRaw) ? aggRaw : {};
  const out = {};
  for (const cls of DIAG_CLASSES) {
    const e = agg[cls];
    if (e && typeof e === 'object' && Number.isFinite(e.count) && Number.isFinite(e.lastTs)) {
      out[cls] = { count: e.count, lastTs: e.lastTs };
    }
  }
  return out;
}

// Re-run a stored ring through validateRecord — the SECOND WALL on the serve
// path (mirrors serializeForExport): a tampered/legacy KVS entry cannot reach
// the frontend with a smuggled free-text field.
function validateRing(ring) {
  return (Array.isArray(ring) ? ring : [])
    .filter((r) => r && typeof r === 'object' && !Array.isArray(r))
    .map((r) => validateRecord(r).record);
}

/**
 * getDiagnostics — the Diagnostics tab read (FROZEN contract).
 *
 *   { scope: 'mine'|'all' } → {
 *     isAdmin,            // live ADMINISTER result (FE shows the toggle on it)
 *     scope,              // the scope actually SERVED (non-admin 'all' → 'mine')
 *     records?,           // scope 'mine': the caller's bucket, validated
 *     buckets?,           // scope 'all': [{ accountId, records }] per user
 *     aggregate,          // the :agg install-wide silent-class counters
 *   }
 *
 * The WHOLE body fails open to an empty 'mine' payload — a diagnostics surface
 * must never itself crash (§5); console.warn is the only trace.
 */
resolver.define('getDiagnostics', async ({ payload, context }) => {
  try {
    const requested = payload && payload.scope === 'all' ? 'all' : 'mine';
    const isAdmin = await checkJiraAdminister();
    const scope = requested === 'all' && isAdmin ? 'all' : 'mine';
    const aggregate = sanitizeAggregate(await readAggregate());
    if (scope === 'all') {
      const buckets = (await readAllDiagnostics()).map((b) => ({
        accountId: b.accountId,
        records: validateRing(b.records),
      }));
      return { isAdmin, scope, buckets, aggregate };
    }
    const accountId = (context && typeof context.accountId === 'string' && context.accountId) || null;
    const records = accountId ? validateRing(await readDiagnostics({ accountId })) : [];
    return { isAdmin, scope, records, aggregate };
  } catch (e) {
    console.warn(`[diag] getDiagnostics failed (fail-open): ${String(e?.message || e)}`);
    return { isAdmin: false, scope: 'mine', records: [], aggregate: {} };
  }
});

/**
 * getDiagnosticsExport — the user-carried support report (FROZEN contract).
 *
 * serializeForExport is THE second wall (every record re-validated; envelope
 * whitelist-built {app_version, exported_at, tier}). refFilter narrows records
 * to ref===refFilter BEFORE serializing (the per-failure copy). includeDetails
 * === true — the §2b EXPLICIT consent, never the default — appends, AFTER the
 * JSON so it stays parseable, one plain-text zone-2 section per distinct ref
 * present in the exported records that has a detail sibling (≤50 reads, an
 * explicit user click each time). Scope rules identical to getDiagnostics
 * (admin may export 'all'; the ADMINISTER check runs only when 'all' is asked).
 */
resolver.define('getDiagnosticsExport', async ({ payload, context }) => {
  const envelope = {
    app_version: DIAG_APP_VERSION,
    exported_at: new Date().toISOString(),
    tier: (() => {
      try {
        return getActiveTier(context).key;
      } catch (_) {
        return null; // a license-read glitch must never block the export
      }
    })(),
  };
  try {
    const requested = payload && payload.scope === 'all' ? 'all' : 'mine';
    const includeDetails = !!(payload && payload.includeDetails === true);
    const refFilter =
      payload && typeof payload.refFilter === 'string' && payload.refFilter ? payload.refFilter : null;

    let scope = 'mine';
    if (requested === 'all' && (await checkJiraAdminister())) scope = 'all';

    let raw;
    if (scope === 'all') {
      // Flat record list: the record body is identity-free by §1 (accountIds are
      // bucket KEYS, never fields), so a flattened admin export leaks nothing new.
      raw = (await readAllDiagnostics()).flatMap((b) => (Array.isArray(b.records) ? b.records : []));
    } else {
      const accountId = (context && typeof context.accountId === 'string' && context.accountId) || null;
      raw = accountId ? await readDiagnostics({ accountId }) : [];
    }
    const validated = validateRing(raw);
    // [gate MED-2] substring/case-insensitive — MIRROR the tab's display filter: a
    // hand-typed partial ref that SHOWS rows on screen must export those same rows
    // (exact-match here silently produced an empty report — a silent miss in the
    // support carrier itself).
    // [P5 audit] cap (hygiene) + strip a leading 'session:' — the row text renders
    // `session:<id>` for null-ref rows; pasting that token must still match.
    const refLc = refFilter ? refFilter.slice(0, 200).replace(/^session:/i, '').toLowerCase() : null;
    const matchesEitherRef = (r) =>
      (typeof r.ref === 'string' && r.ref.toLowerCase().includes(refLc)) ||
      (typeof r.session_ref === 'string' && r.session_ref.toLowerCase().includes(refLc));
    const records = refLc ? validated.filter(matchesEitherRef) : validated;

    // [P5 audit MED-1] the envelope carries the SERVED scope (whitelist-enum'd in the
    // serializer) — a silent admin→mine fallback must be visible in the artifact.
    envelope.scope = scope;
    let report = serializeForExport(records, envelope);

    if (includeDetails) {
      // §2b consent gate passed at click-time: append zone-2 verbatim details OUTSIDE
      // the JSON (clearly delimited plain-text sections) — distinct refs, ≤50 reads.
      // [deep-audit P2 N2] collect BOTH correlation ids — a ref:null record's zone-2
      // lives under its session_ref (the aborted-push class); ref-only made it
      // write-only storage.
      const refs = [
        ...new Set(
          records
            .flatMap((r) => [r.ref, r.session_ref])
            .filter((r) => typeof r === 'string' && r),
        ),
      ].slice(0, 50);
      for (const ref of refs) {
        const text = await readDiagnosticDetail({ ref });
        if (text) report += `\n--- detail ref=${ref} ---\n${text}`;
      }
    }
    return { report };
  } catch (e) {
    console.warn(`[diag] getDiagnosticsExport failed (fail-open): ${String(e?.message || e)}`);
    return { report: serializeForExport([], envelope) }; // still { report } — never an error shape
  }
});

// Health-probe code normalizers — content-free tokens per the frozen contract.
// Interpolated families (anthropic_<NNN> / jira_<NNN> / confluence_<NNN>) normalize
// to the FAMILY token, never a raw interpolated string (the §1 rule applied to codes).
function healthAnthropicCode(error) {
  const c = String(error || '');
  if (
    c === 'not_configured' ||
    c === 'key_storage_failed' ||
    c === 'auth_rejected' ||
    c === 'insufficient_credits' ||
    c === 'rate_limited' ||
    c === 'network_failure'
  ) {
    return c;
  }
  if (/^anthropic_\d+$/.test(c)) return 'anthropic_http';
  return 'unknown_error';
}
function healthJiraCode(error) {
  const c = String(error || '');
  if (c === 'project_not_found' || c === 'permission_denied') return c;
  if (c === 'jira_fetch_failed') return 'network_failure';
  if (/^jira_\d+$/.test(c)) return 'jira_http';
  return 'unknown_error';
}

/**
 * runHealthCheck — proactive config probe (§5; FROZEN contract). Four probes IN
 * ORDER, REUSE-ONLY (testConnection / the searchPages CQL route+scope /
 * push_handler's lookupProject / a kvs round-trip), each inside its own
 * try/catch so a probe failure NEVER throws out, NO retries, one HTTP call per
 * probe (lookupProject adds its two fast field/priority lookups) → well under
 * the 25s resolver limit. Returns { ok, probes:[{name, ok, code}] } and writes
 * ONE ledger record: op 'health.check', health_ok | health_degraded,
 * level info|warn, ref null, counts { <probeName>: 0|1 }, surfaced true.
 * Most support tickets are config issues — this closes them in one click.
 */
resolver.define('runHealthCheck', async ({ context }) => {
  const probes = [];
  try {
    // ── Probe 1: 'anthropic_key' — the key path THIS tier generates with (Managed ⇒
    // OUR env key, BYOK ⇒ the stored secret), tested exactly the way the Settings
    // "Test Connection" does (testConnection with the resolved key). A4 split: a
    // stored-key READ fault is 'key_storage_failed' (the key may still be saved),
    // never misdiagnosed as "not configured".
    try {
      const { apiKey, keySource, keyFault } = await resolveAnthropicKey(context);
      if (keyFault) {
        probes.push({ name: 'anthropic_key', ok: false, code: 'key_storage_failed' });
      } else if (!apiKey) {
        probes.push({
          name: 'anthropic_key',
          ok: false,
          // Managed with our env key unset = OUR ops outage class; BYOK with no
          // stored key = the honest "never set".
          code: keySource === 'managed' ? 'managed_unavailable' : 'not_configured',
        });
      } else {
        const result = await anthropicTestConnection(apiKey);
        probes.push(
          result.ok
            ? { name: 'anthropic_key', ok: true, code: 'ok' }
            : { name: 'anthropic_key', ok: false, code: healthAnthropicCode(result.error) },
        );
      }
    } catch (e) {
      probes.push({ name: 'anthropic_key', ok: false, code: 'network_failure' });
    }

    // ── Probe 2: 'confluence_read' — the SAME CQL search endpoint + scope searchPages
    // uses (search:confluence), bounded to 1 result. Non-OK statuses normalize to the
    // 'confluence_http' family token; the Forge egress block is its own code.
    try {
      const cql = 'type=page';
      const resp = await api
        .asUser()
        .requestConfluence(route`/wiki/rest/api/search?cql=${cql}&limit=1`);
      if (resp.headers.get('forge-proxy-error') === 'BLOCKED_EGRESS') {
        probes.push({ name: 'confluence_read', ok: false, code: 'egress_blocked' });
      } else if (resp.ok) {
        probes.push({ name: 'confluence_read', ok: true, code: 'ok' });
      } else {
        probes.push({ name: 'confluence_read', ok: false, code: 'confluence_http' });
      }
    } catch (e) {
      probes.push({ name: 'confluence_read', ok: false, code: 'network_failure' });
    }

    // ── Probe 3: 'jira_project' — push_handler's lookupProject (the push preflight:
    // project access + dynamic subtask type + SP/priority field resolution) with the
    // CONFIGURED default project key; 'no_project_key' when unset (config gap — the
    // exact class the health check exists to catch before a push fails on it).
    try {
      const projectKey = await getProjectKey(null);
      if (!projectKey) {
        probes.push({ name: 'jira_project', ok: false, code: 'no_project_key' });
      } else {
        const lookup = await lookupProject(projectKey);
        probes.push(
          lookup.ok
            ? { name: 'jira_project', ok: true, code: 'ok' }
            : { name: 'jira_project', ok: false, code: healthJiraCode(lookup.error) },
        );
      }
    } catch (e) {
      probes.push({ name: 'jira_project', ok: false, code: 'network_failure' });
    }

    // ── Probe 4: 'kvs_rw' — write+read+delete a content-free probe key.
    // (gate LOW) the delete rides a finally so a get-throw can't orphan the probe
    // key. The key is shared per install — a concurrent health check can race it
    // into a false-negative (rare; re-run resolves; named residual).
    try {
      const probeKey = 'spec2jira_diag:healthprobe';
      let readBack = null;
      try {
        await kvs.set(probeKey, { ts: Date.now() });
        readBack = await kvs.get(probeKey);
      } finally {
        try { await kvs.delete(probeKey); } catch (_) { /* best-effort cleanup */ }
      }
      probes.push(
        readBack && typeof readBack === 'object'
          ? { name: 'kvs_rw', ok: true, code: 'ok' }
          : { name: 'kvs_rw', ok: false, code: 'kvs_failed' },
      );
    } catch (e) {
      probes.push({ name: 'kvs_rw', ok: false, code: 'kvs_failed' });
    }

    const allOk = probes.every((p) => p.ok);
    const counts = {};
    for (const p of probes) counts[p.name] = p.ok ? 1 : 0;
    await recordDiagnostic({
      context,
      record: {
        op: 'health.check',
        error_class: allOk ? 'health_ok' : 'health_degraded',
        level: allOk ? 'info' : 'warn',
        ref: null,
        counts,
        surfaced: true,
      },
    });
    return { ok: allOk, probes };
  } catch (e) {
    console.warn(`[diag] runHealthCheck failed (fail-open): ${String(e?.message || e)}`);
    return { ok: false, probes }; // whatever completed before the (unexpected) throw
  }
});

// recordClientDiagnostic whitelist (§2 — the abuse surface: ANY user can invoke).
// op is FIXED server-side; only the two client-fallback classes are accepted;
// refs must be id-SHAPED — UUID or `<ts>-<base36>` (both jobId/sessionId mint
// shapes) — never free text. Everything else is dropped or rejected.
const CLIENT_DIAG_CLASSES = new Set(['invoke_rejected', 'invoke_timeout']);
const CLIENT_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CLIENT_TS_BASE36_RE = /^\d{10,16}-[a-z0-9]{1,24}$/;
function cleanClientRef(v) {
  if (typeof v !== 'string' || v.length === 0 || v.length > 80) return null;
  return CLIENT_UUID_RE.test(v) || CLIENT_TS_BASE36_RE.test(v) ? v : null;
}

/**
 * recordClientDiagnostic — the FRONTEND fallback writer (FROZEN contract): a 25s
 * resolver kill / client-side invoke rejection leaves NO backend write, so the
 * hardest failures would otherwise have no record at all. STRICT whitelist:
 * op FIXED to 'invoke.failed'; error_class ONLY from {'invoke_rejected',
 * 'invoke_timeout'} else {ok:false}; ref/session_ref shape-validated (else
 * dropped, record still written); subject_idxs ints cap 20; bucket =
 * context.accountId ONLY (falsy → skip, {ok:false}). recordDiagnostic
 * re-validates everything (the double wall); abuse radius = the caller's OWN
 * 50-ring, and the (ref, op, class) dedupe absorbs spam into occurrences.
 */
resolver.define('recordClientDiagnostic', async ({ payload, context }) => {
  try {
    if (!(context && typeof context.accountId === 'string' && context.accountId)) {
      return { ok: false };
    }
    const errorClass = payload && payload.error_class;
    if (!CLIENT_DIAG_CLASSES.has(errorClass)) return { ok: false };
    const ref = cleanClientRef(payload && payload.ref);
    const sessionRef = cleanClientRef(payload && payload.session_ref);
    const idxs = Array.isArray(payload && payload.subject_idxs)
      ? payload.subject_idxs.filter((n) => Number.isInteger(n) && n >= 0).slice(0, 20)
      : null;
    const res = await recordDiagnostic({
      context,
      record: {
        op: 'invoke.failed', // FIXED server-side — never read from the payload
        error_class: errorClass,
        level: 'error',
        ref, // null when dropped — the record still stands (null-ref dedupe applies)
        ...(sessionRef ? { session_ref: sessionRef } : {}),
        ...(idxs && idxs.length ? { subject_idxs: idxs } : {}),
        surfaced: true, // the client records this precisely because the user SAW the failure
      },
    });
    return { ok: !!(res && res.ok) };
  } catch (e) {
    return { ok: false }; // never throw into the FE's own failure handler
  }
});

/**
 * clearDiagnostics — delete the caller's OWN bucket only (GDPR-erasure
 * self-service, §5; FROZEN contract). The install-wide :agg sidecar is
 * content-free and shared — deliberately untouched. Zone-2 details expire on
 * their own ~30-day TTL (transient by design).
 */
resolver.define('clearDiagnostics', async ({ context }) => {
  const accountId =
    (context && typeof context.accountId === 'string' && context.accountId) || null;
  if (!accountId) return { ok: false };
  const res = await clearDiagnosticsBucket({ accountId });
  return { ok: !!(res && res.ok) };
});

// ── Export handler bound к manifest function key "resolver" ──

// ── Task #13: scheduled orphan sweep ───────────────────────────────────────────────
// A daily scheduledTrigger (manifest: orphan-sweep → this handler) runs PER INSTALLATION
// with NO user context (system trigger → KVS only, asApp via storage:app). It enumerates
// the lean jobmeta: keys and, for any job INACTIVE longer than ORPHAN_INACTIVITY_MS (7 days)
// — i.e. generated-but-never-pushed/-reopened — deletes the job + all siblings. A pushed job
// was already purged; an actively-reviewed job had its timer renewed (touchJobAccess), so
// neither is swept (this is the access-renewed alternative to a creation-anchored TTL, which
// would silently lose a deliverable under review). Bounded (SWEEP_MAX_DELETES/run; the daily
// cadence clears any backlog over a few days) + idempotent. Fail-open — never throws to the platform.
export async function sweepHandler() {
  const now = Date.now();
  let scanned = 0;
  let deleted = 0;
  let degraded = 0;
  let cursor;
  try {
    const maxPages = 500; // hard loop bound on the cursor pagination
    for (let page = 0; page < maxPages && deleted < SWEEP_MAX_DELETES; page++) {
      let q = kvs.query().where('key', WhereConditions.beginsWith(JOB_META_PREFIX)).limit(SWEEP_PAGE_LIMIT);
      if (cursor) q = q.cursor(cursor);
      const res = await q.getMany();
      const results = res && Array.isArray(res.results) ? res.results : [];
      for (const r of results) {
        if (deleted >= SWEEP_MAX_DELETES) break;
        if (!r || typeof r.key !== 'string' || !r.key.startsWith(JOB_META_PREFIX)) continue;
        const jobId = r.key.slice(JOB_META_PREFIX.length);
        if (!jobId) continue;
        scanned++;
        if (!isOrphanStale(r.value, now, ORPHAN_INACTIVITY_MS)) continue; // active per the (eventually-consistent) query index → keep (fail-safe)
        // ⭐ kvs.query() is EVENTUALLY consistent — a just-written touchJobAccess renewal can lag in
        // the query index. Before an IRREVERSIBLE delete, RE-CONFIRM staleness with a STRICTLY-
        // consistent kvs.get (deep-audit fix): closes the renew-then-immediate-sweep race so a
        // just-reopened deliverable is never swept, matching the codebase's re-read-before-
        // destructive-write discipline. Only the few query-stale candidates pay this strict read.
        const freshMeta = await kvs.get(`${JOB_META_PREFIX}${jobId}`).catch(() => null);
        if (!isOrphanStale(freshMeta, now, ORPHAN_INACTIVITY_MS)) continue; // a fresh renewal (or a concurrent delete) won the race → keep/skip
        // Stale (strictly confirmed). Read the heavy job: record ONLY now (for pageId + ownerAccountId).
        const job = await kvs.get(`${JOB_KEY_PREFIX}${jobId}`).catch(() => null);
        const acct = (job && job.ownerAccountId) || null; // null → deleteJobKeys skips the tracked-list filter (getDashboardJobs prunes the dead ref anyway)
        try {
          const { degraded: d } = await deleteJobKeys(jobId, job, acct);
          deleted++;
          if (d) degraded++;
        } catch (delErr) {
          degraded++;
          console.warn(`[sweep] delete failed for ${jobId} (non-fatal): ${String(delErr?.message || delErr)}`);
        }
      }
      cursor = res ? res.nextCursor : undefined;
      if (!cursor || results.length === 0) break;
    }
    console.log(`[sweep] orphan sweep: scanned=${scanned} deleted=${deleted} degraded=${degraded}`);
  } catch (e) {
    console.error(`[sweep] orphan sweep failed (non-fatal): ${String(e?.message || e)}`);
  }
  return { scanned, deleted, degraded };
}

export const handler = resolver.getDefinitions();
