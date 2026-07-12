/**
 * Spec2Tickets v3.0.0 schema helpers.
 *
 * Bridges new flat-features schema (от Anthropic Sonnet 4.6) к the
 * v2.x-shaped consumers (BreakdownEditor + the embedded Dashboard-signal
 * panel in ConfirmScreen) without requiring full UI refactor in this session.
 *
 * Two main responsibilities:
 *   1. adaptToLegacyShape(v3) — wraps flat features в synthetic capability
 *      groups based on feature.category для BreakdownEditor compatibility
 *   2. extractV3Signals(v3) — extracts signals natively от v3 for the
 *      embedded Dashboard-signal panel in ConfirmScreen:
 *      counts, confidence distribution, parsed concerns, dependencies
 *
 * Plus parseConcernPrefix — splits "[TYPE|severity] text" encoding.
 */

// ════════════════════════════════════════════════════════════
// CONCERN PREFIX PARSER
// ════════════════════════════════════════════════════════════

/**
 * Parse the system-prompt-encoded concern format:
 *   "[TYPE|severity] free-form text"
 * Returns {type, severity, text}. Falls back gracefully когато format
 * unexpected (e.g., plain text — treats as type=NOTE, severity=medium).
 */
export function parseConcernPrefix(raw) {
  if (typeof raw !== 'string') {
    return { type: 'NOTE', severity: 'medium', text: String(raw || '') };
  }
  const match = raw.match(/^\s*\[([A-Z_]+)\|(high|medium|low)\]\s*(.+)$/i);
  if (match) {
    return {
      type: match[1].toUpperCase(),
      severity: match[2].toLowerCase(),
      text: match[3].trim(),
    };
  }
  // Fallback — plain text concern; assume medium severity
  return { type: 'NOTE', severity: 'medium', text: raw.trim() };
}

// ════════════════════════════════════════════════════════════
// PLACEHOLDER-NAME GUARD (single source of truth)
// ════════════════════════════════════════════════════════════

/**
 * True iff `name` is still an unedited Add-button placeholder that must never push verbatim:
 * an EMPTY name, the legacy exact "New Feature"/"New Category", OR the uniquified
 * "New Feature <4-char>" that "+ New story" mints. The exact 4-char suffix keeps a legit name
 * like "New Feature Rollout" from being false-flagged. Canonical here so the top caution banner
 * (ReviewReadinessBar) and the per-story flag (FocusedStory) can never diverge — a previous
 * divergence (ReviewReadinessBar lacked the empty-string check) left an empty-named story flagged
 * in the detail pane but uncounted in the banner.
 */
export function isPlaceholderName(name) {
  const n = String(name || '').trim().toLowerCase();
  return n === '' || /^new (feature|category)( [0-9a-z]{4})?$/.test(n);
}

// ════════════════════════════════════════════════════════════
// LEGACY-SHAPE ADAPTER (для BreakdownEditor backward compat)
// ════════════════════════════════════════════════════════════

/**
 * Convert v3.0.0 breakdown (flat features) к v2.x-shape с synthetic
 * capabilities derived от feature.category.
 *
 * When all features share single category OR no categories — single
 * synthetic capability bucket.
 * When multiple categories — one synthetic capability per category.
 *
 * Preserves все feature fields as-is + attaches _v3_original reference
 * на the root for downstream Dashboard signal extraction.
 */
export function adaptToLegacyShape(v3) {
  if (!v3 || typeof v3 !== 'object') return v3;

  // (POLICY §3.5 simplicity-over-complexity) mint a stable _uid on every feature once
  // (frontend-first identity) so the test-case staleness + per-card regen bind to IT — surviving
  // reorder / rename / restructure where index- or name-matching mis-targets. Idempotent: an
  // already-uid'd feature (reloaded from a persisted breakdown) is left untouched → uid is stable.
  // Task #3 (name→uid links): ALSO freeze _orig_name = the GENERATION name (canonical HERE —
  // this runs at load, BEFORE any editor rename). Dependency strings stay frozen generation names
  // too, so the push (flattenBreakdown) maps a frozen dep-name → _orig_name → _uid and a rename can
  // never break the link. Both fields are captured in the SAME idempotent pass and ride edits via spread.
  // Also mint a stable task._uid in the SAME pass (POLICY §3.5): tasks are mutable (add/delete) and
  // each wraps a portaled SelectBadge with internal state, so an index-key reconciliation shift can
  // misalign dropdown state. The uid is editor-only — the push (flattenBreakdown) ignores it.
  const mintTaskUids = (tasks) =>
    Array.isArray(tasks)
      ? tasks.map((t) =>
          t && typeof t === 'object' ? { ...t, _uid: t._uid || newStoryUid() } : t
        )
      : tasks;
  // (A2) DEDUPE each feature's dependencies[] at the ROOT (load/adapt), dropping duplicate
  // target strings. A duplicated blocks-link is meaningless in Jira, AND a duplicate is the one
  // real way the Review remove/restore drops a link: removeFeatureDependency filters ALL matches
  // while addFeatureDependency re-adds ONE, so a Remove->Restore round-trip on a duplicated dep
  // silently collapses two entries to one (a genuine -1 link). Removing duplicates here makes
  // remove-all === remove-one (the mutation becomes symmetric). Exact-string dedupe.
  const dedupeDeps = (deps) =>
    Array.isArray(deps) ? deps.filter((d, i) => deps.indexOf(d) === i) : deps;
  const features = (Array.isArray(v3.features) ? v3.features : []).map((f) => {
    if (!f || typeof f !== 'object') return f;
    // Feature identity may already be minted (reloaded breakdown), but a NEW task added upstream
    // could still lack a _uid — so run the task pass unconditionally, cheaply idempotent.
    return {
      ...f,
      _uid: f._uid || newStoryUid(),
      _orig_name: f._orig_name || f.name,
      tasks: mintTaskUids(f.tasks),
      dependencies: dedupeDeps(f.dependencies),
    };
  });

  // Group by category
  const categoryMap = new Map();
  const noCategory = [];
  for (const f of features) {
    if (f.category && f.category.trim()) {
      const key = f.category.trim();
      if (!categoryMap.has(key)) categoryMap.set(key, []);
      categoryMap.get(key).push(f);
    } else {
      noCategory.push(f);
    }
  }

  let capabilities;
  if (categoryMap.size === 0) {
    // No categories at all — single bucket
    capabilities = [
      {
        name: v3.epic?.summary || v3.metadata?.spec_summary || 'Features',
        features,
      },
    ];
  } else {
    capabilities = [];
    for (const [name, feats] of categoryMap) {
      capabilities.push({ name, features: feats });
    }
    if (noCategory.length > 0) {
      capabilities.push({ name: 'Uncategorized', features: noCategory });
    }
  }

  // Convert shared_acceptance_criteria от string array к {items:[{text}]} shape
  let sharedAC;
  if (Array.isArray(v3.shared_acceptance_criteria) && v3.shared_acceptance_criteria.length > 0) {
    sharedAC = {
      items: v3.shared_acceptance_criteria.map((text, idx) => ({
        text,
        id: `shared-${idx}`,
      })),
    };
  }

  return {
    epic: v3.epic || {
      summary: v3.metadata?.spec_summary?.substring(0, 100) || 'Untitled Breakdown',
      description: v3.metadata?.spec_summary || '',
    },
    capabilities,
    shared_acceptance_criteria: sharedAC,
    metadata: v3.metadata,
    spec_concerns: v3.spec_concerns,
    _v3_original: { ...v3, features },
  };
}

// Stable per-story identity (POLICY §3.5). Minted once on the frontend when a breakdown loads
// (adaptToLegacyShape above) or a feature is added in the editor, then threaded through edits (the
// editor spreads feature objects → _uid survives), test-case stamping, and the per-story staleness /
// per-card regen binding — so identity is robust to reorder / rename / restructure. Function
// declaration → hoisted, so adaptToLegacyShape may call it above. Prefixed 's_' for readable logs.
export function newStoryUid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return 's_' + crypto.randomUUID();
  } catch (_) {}
  return 's_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

// ════════════════════════════════════════════════════════════
// SIGNAL EXTRACTION (для Dashboard panel embedded в ConfirmScreen)
// ════════════════════════════════════════════════════════════

/**
 * Derive Dashboard signals от v3.0.0 breakdown.
 *
 * Returns:
 *   {
 *     counts: { features, tasks, totalFeatureACs, sharedACs, dependencies, concerns },
 *     confidence: { high, medium, low, missing, total, averageScore? },
 *     overallQuality: 'high' | 'medium' | 'low' | null,
 *     specSummary: string | null,
 *     ambiguityNote: string | null,
 *     parsedSpecConcerns: [{type, severity, text}],
 *     parsedFeatureConcerns: [{featureName, type, severity, text}],
 *     categories: [{name, featureCount}],
 *     dependencyEdges: [{source, target, targetDisplay, unresolved}], // target = FROZEN dep string (mutation key); targetDisplay = current name (display); unresolved = true when the dep string matches no feature (name_unknown at push)
 *     epicSummary: string | null,
 *     hasEpic: boolean,
 *   }
 */
export function extractV3Signals(breakdown) {
  // Accept both legacy-shaped (с _v3_original) and native v3
  const v3 = breakdown?._v3_original || breakdown || {};
  // Per-feature signals MUST read the CURRENT edited shape, not the frozen
  // _v3_original snapshot — else editor deletions/edits don't reflect in the Review
  // "AI self-check" (a staleness bug found 2026-06-04). The editor mutates
  // breakdown.capabilities (the adapter preserves every feature field, incl.
  // concerns/confidence), so read that FIRST; native-v3 features next; the frozen
  // _v3_original.features only as a last resort. This mirrors flattenBreakdown's
  // precedence (push_handler.js) so the displayed signals and the actual push agree
  // by construction. Top-level fields (metadata / spec_concerns / epic, read via `v3`
  // below) are NOT per-feature — they stay on the frozen snapshot (the model's
  // self-assessment of the generated breakdown, which the editor cannot change).
  const features = Array.isArray(breakdown?.capabilities)
    ? breakdown.capabilities.flatMap((c) => c.features || [])
    : Array.isArray(breakdown?.features)
      ? breakdown.features
      : Array.isArray(v3.features)
        ? v3.features
        : [];

  // Counts
  let totalTasks = 0;
  let totalFeatureACs = 0;
  let totalDependencies = 0;
  let totalFeatureConcerns = 0;
  const confidence = { '✓': 0, '⚠': 0, '✗': 0, missing: 0 };
  const categoryCounts = new Map();
  const dependencyEdges = [];
  const parsedFeatureConcerns = [];
  let scoreSum = 0;
  let scoreCount = 0;

  // Task #4: frozen _orig_name → CURRENT name, so a dependency edge (whose target is
  // the depended-on feature's FROZEN generation name) can DISPLAY the current name
  // after a rename. Display-only — the frozen string stays the remove/restore mutation
  // key. First-match on a duplicate _orig_name (rare; the mutation is unaffected).
  const origToCurrent = new Map();
  for (const f of features) {
    const k = f && (f._orig_name || f.name);
    if (k != null && !origToCurrent.has(k)) origToCurrent.set(k, f.name);
  }

  for (const f of features) {
    totalTasks += (f.tasks || []).length;
    totalFeatureACs += (f.acceptance_criteria || []).length;
    totalDependencies += (f.dependencies || []).length;
    totalFeatureConcerns += (f.concerns || []).length;

    const ind = f.confidence_indicator;
    if (ind && confidence[ind] !== undefined) {
      confidence[ind]++;
    } else {
      confidence.missing++;
    }
    if (typeof f.confidence_score === 'number') {
      scoreSum += f.confidence_score;
      scoreCount++;
    }

    if (f.category) {
      categoryCounts.set(
        f.category,
        (categoryCounts.get(f.category) || 0) + 1
      );
    }

    for (const depTarget of f.dependencies || []) {
      // target = the FROZEN dep string (the remove/restore mutation key); targetDisplay
      // = the depended-on feature's CURRENT name for the Review display (Task #4).
      // (A1) unresolved = the dep string matches NO feature's frozen _orig_name, so origToCurrent
      // has no entry for it → at push this edge silently fails as name_unknown (the AI paraphrased
      // the target so it maps to no story). Surfaced in the Review dependency editor BEFORE push so
      // the user knows WHY a link won't be created. A resolvable dep (target IS a real feature's
      // _orig_name) is in origToCurrent → NOT flagged. Pure derive.
      dependencyEdges.push({
        source: f.name,
        // sourceUid = the SOURCE feature's stable _uid (survives rename; disambiguates
        // two same-named sources). The remove/restore/add mutation matches the source
        // uid-first, name-fallback (see mapFeatureDependencies). May be absent on a
        // legacy breakdown whose features were never adapted → the mutation falls back
        // to source-name matching (identical to the pre-migration behavior).
        sourceUid: f._uid,
        target: depTarget,
        targetDisplay: origToCurrent.get(depTarget) || depTarget,
        unresolved: !origToCurrent.has(depTarget),
      });
    }

    for (const concernRaw of f.concerns || []) {
      const parsed = parseConcernPrefix(concernRaw);
      parsedFeatureConcerns.push({ featureName: f.name, ...parsed });
    }
  }

  const sharedACs = Array.isArray(v3.shared_acceptance_criteria)
    ? v3.shared_acceptance_criteria
    : Array.isArray(breakdown?.shared_acceptance_criteria?.items)
      ? breakdown.shared_acceptance_criteria.items.map((i) => i.text || '')
      : [];

  const parsedSpecConcerns = (v3.spec_concerns || []).map(parseConcernPrefix);

  // Flagged features (⚠/✗) WITH their names — the worklist behind the TrustCard
  // counts, so a "low-confidence" count is traceable to WHICH feature (the count
  // alone was a dead end). ✗ sorted first (the must-look tier). Pure derive — the
  // names were already in `features`; we just stopped throwing them away.
  const flagged = features
    .filter((f) => f.confidence_indicator === '⚠' || f.confidence_indicator === '✗')
    .map((f) => ({
      name: f.name,
      indicator: f.confidence_indicator,
      score: typeof f.confidence_score === 'number' ? f.confidence_score : null,
    }))
    .sort((a, b) => (a.indicator === '✗' ? 0 : 1) - (b.indicator === '✗' ? 0 : 1));

  return {
    counts: {
      features: features.length,
      tasks: totalTasks,
      totalFeatureACs,
      sharedACs: sharedACs.length,
      dependencies: totalDependencies,
      featureConcerns: totalFeatureConcerns,
      specConcerns: parsedSpecConcerns.length,
    },
    confidence: {
      ...confidence,
      total: features.length,
      averageScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : null,
      flagged,
    },
    overallQuality: v3.metadata?.overall_quality || null,
    specSummary: v3.metadata?.spec_summary || null,
    ambiguityNote: v3.metadata?.ambiguity_note || null,
    parsedSpecConcerns,
    parsedFeatureConcerns,
    categories: Array.from(categoryCounts.entries()).map(([name, count]) => ({
      name,
      featureCount: count,
    })),
    dependencyEdges,
    epicSummary: v3.epic?.summary || null,
    hasEpic: !!v3.epic,
  };
}

// ════════════════════════════════════════════════════════════
// INSIGHTS VIEW (для the post-generation AI Insights orientation screen)
// ════════════════════════════════════════════════════════════
//
// computeInsightsView(breakdown) — a PURE derive over the breakdown that powers
// the 4A "directed triage" InsightsScreen. It reuses extractV3Signals for the
// counts/confidence/category derive (single source of truth — the numbers here
// MUST agree with ConfirmScreen), then adds the triage-specific layer: a
// weight-ranked flagged list, a verdict, the compliance landmine, the concern
// fingerprint, and the sizing spread. NO UI, NO backend — every datum is already
// on the breakdown object.
//
// Feature-read precedence MIRRORS extractV3Signals (capabilities flatMap →
// features → _v3_original.features) so edited features are reflected and the
// two surfaces never disagree.

// ⭐ CALIBRATION 1 — the WEIGHT formula. Named coefficients at the top so they are
// tunable in ONE place. The ORDERING INVARIANT the design depends on: a
// low-confidence(✗) OR high-severity-concern, high-priority, large feature MUST
// outrank a high-confidence, low-priority, small one. (Verified by the offline
// test prototype/test_insights_view.mjs — the ML-Anomaly ✗·13SP·Cx5·High row
// lands at #1.) Keep the invariant if you re-tune.
export const INSIGHTS_WEIGHTS = { W_CONF: 0.4, W_SEV: 0.25, W_PRIO: 0.2, W_SIZE: 0.15 };

// confidence-indicator → band. ✗ (low confidence) is the heaviest; an unrated
// feature is treated as more suspect than a ✓ (0.5 vs a small ✓-derived band);
// a ✓ contributes only a small band scaled by how far its score sits below 100.
function confBandFor(indicator, score) {
  if (indicator === '✗') return 1.0;
  if (indicator === '⚠') return 0.6;
  if (indicator === '✓') {
    return typeof score === 'number' ? ((100 - score) / 100) * 0.3 : 0;
  }
  // unrated / undefined
  return 0.5;
}

function severityBand(severity) {
  if (severity === 'high') return 1.0;
  if (severity === 'medium') return 0.5;
  return 0; // low / none
}

// priorityLabel — the canonical band label for a feature.priority string, SHARED by the weight,
// the sizing histogram, AND the display chip so they can never disagree on a non-canonical value
// (e.g. 'Critical'/'Highest'). null = unknown/absent. (deep-audit fix)
export function priorityLabel(priority) {
  const p = typeof priority === 'string' ? priority.trim().toLowerCase() : '';
  if (p === 'high' || p === 'highest' || p === 'critical' || p === 'blocker') return 'High';
  if (p === 'medium') return 'Medium';
  if (p === 'low' || p === 'lowest' || p === 'trivial' || p === 'minor') return 'Low';
  return null; // unknown / empty
}
function priorityBand(priority) {
  const lbl = priorityLabel(priority);
  return lbl === 'High' ? 1.0 : lbl === 'Medium' ? 0.5 : 0;
}

// sizeBand = (min(SP,13)/13)*0.5 + ((complexity||0)/5)*0.5  → 0..1
function sizeBand(storyPoints, complexity) {
  const sp = typeof storyPoints === 'number' && storyPoints > 0 ? Math.min(storyPoints, 13) : 0;
  const cx = typeof complexity === 'number' && complexity > 0 ? complexity : 0;
  return (sp / 13) * 0.5 + (cx / 5) * 0.5;
}

/**
 * Compute the composite triage weight for a single (already-enriched) feature.
 * Exported for the offline test + potential reuse; pure, deterministic.
 *   enriched = { confidence_indicator, confidence_score, priority, story_points,
 *                complexity_score, concerns:[{severity,...}] }
 */
export function computeFeatureWeight(enriched) {
  const { W_CONF, W_SEV, W_PRIO, W_SIZE } = INSIGHTS_WEIGHTS;
  const concerns = Array.isArray(enriched.concerns) ? enriched.concerns : [];
  const maxSev = concerns.reduce((acc, c) => Math.max(acc, severityBand(c && c.severity)), 0);
  return (
    W_CONF * confBandFor(enriched.confidence_indicator, enriched.confidence_score) +
    W_SEV * maxSev +
    W_PRIO * priorityBand(enriched.priority) +
    W_SIZE * sizeBand(enriched.story_points, enriched.complexity_score)
  );
}

/**
 * Read features with the SAME precedence extractV3Signals uses, so edited
 * features are reflected and the two surfaces agree by construction.
 */
function readFeatures(breakdown) {
  const v3 = breakdown?._v3_original || breakdown || {};
  return Array.isArray(breakdown?.capabilities)
    ? breakdown.capabilities.flatMap((c) => c.features || [])
    : Array.isArray(breakdown?.features)
      ? breakdown.features
      : Array.isArray(v3.features)
        ? v3.features
        : [];
}

/**
 * computeInsightsView(breakdown) — the CONTRACT the InsightsScreen consumes.
 * See the return-shape doc in the AI-Insights impl spec. Pure; safe on
 * missing/legacy input (returns isLegacy:true with graceful empties).
 */
export function computeInsightsView(breakdown) {
  const sig = extractV3Signals(breakdown);
  const features = readFeatures(breakdown);
  const v3 = breakdown?._v3_original || breakdown || {};

  // ── shape counts (reuse the single-source-of-truth extractV3Signals counts) ──
  const shape = {
    epics: sig.hasEpic ? 1 : 0,
    features: sig.counts.features,
    tasks: sig.counts.tasks,
    acceptanceCriteria: sig.counts.totalFeatureACs,
    sharedACs: sig.counts.sharedACs,
    dependencies: sig.counts.dependencies,
  };

  const categories = sig.categories; // [{name, featureCount}]

  // ── quality (from metadata.overall_quality) ──
  const qualityKey = sig.overallQuality || null;
  const quality = {
    key: qualityKey,
    label: qualityKey ? (QUALITY_PALETTE[qualityKey]?.label || String(qualityKey).toUpperCase()) : null,
    palette: qualityKey ? (QUALITY_PALETTE[qualityKey] || null) : null,
  };

  // ── confidence bins (✓ / ⚠ / ✗ / missing) from extractV3Signals ──
  const confidence = {
    confident: sig.confidence['✓'] || 0,
    unsure: sig.confidence['⚠'] || 0,
    lowConf: sig.confidence['✗'] || 0,
    unrated: sig.confidence.missing || 0,
    total: sig.confidence.total || 0,
    averageScore: sig.confidence.averageScore, // number | null
  };

  // ── legacy detection: NO v3 signals at all (no quality, no indicator, no concerns) ──
  const anyIndicator = features.some(
    (f) => f && (f.confidence_indicator === '✓' || f.confidence_indicator === '⚠' || f.confidence_indicator === '✗')
  );
  const anyConcern =
    sig.parsedFeatureConcerns.length > 0 || sig.parsedSpecConcerns.length > 0;
  const isLegacy = !qualityKey && !anyIndicator && !anyConcern;

  // ── enrich every feature (parse its concerns, compute weight) ──
  const enriched = features.map((f) => {
    const concerns = (Array.isArray(f?.concerns) ? f.concerns : []).map(parseConcernPrefix);
    const e = {
      name: f?.name,
      category: f?.category,
      story_points: typeof f?.story_points === 'number' ? f.story_points : undefined,
      complexity_score: typeof f?.complexity_score === 'number' ? f.complexity_score : undefined,
      priority: f?.priority,
      confidence_score: typeof f?.confidence_score === 'number' ? f.confidence_score : undefined,
      confidence_indicator: f?.confidence_indicator,
      concerns,
      _uid: f?._uid,
      source_heading: f?.source_heading,
    };
    e.weight = computeFeatureWeight(e);
    return e;
  });

  // ── flagged: ⚠/✗ OR ≥1 concern; weight-sorted desc; ALL of them (no slice) ──
  const flagged = enriched
    .filter(
      (e) =>
        e.confidence_indicator === '⚠' ||
        e.confidence_indicator === '✗' ||
        (e.concerns && e.concerns.length > 0)
    )
    .sort((a, b) => b.weight - a.weight);

  // confident = the rest (not flagged); the "skim, don't dwell" list.
  const flaggedUids = new Set(flagged.map((e) => e._uid));
  // Fall back to identity-by-reference-index when _uid absent (legacy): use a
  // membership Set of the enriched objects instead so we never mis-classify.
  const flaggedSet = new Set(flagged);
  // confident = the SKIMMABLE features: a ✓ indicator AND not flagged (a ✓-with-concern IS flagged).
  // An UNRATED feature is NEITHER flagged NOR confident — never paint an unreviewed feature as
  // "confident" (that was the false-reassurance the deep audit caught, esp. in the all-unrated state). (deep-audit fix)
  const confident = enriched
    .filter((e) => e.confidence_indicator === '✓' && (e._uid ? !flaggedUids.has(e._uid) : !flaggedSet.has(e)))
    .map((e) => ({ name: e.name, confidence_score: e.confidence_score }));

  // ── the ONE landmine (compliance-first; else a high-severity spec concern) — computed BEFORE the
  //    verdict so the verdict can reflect it (never a green "nothing flagged" above a red landmine). ──
  const complianceLandmine = findComplianceLandmine(sig, enriched);

  // ── verdict (reflects low-confidence, high-severity concerns — feature AND spec — AND the landmine) ──
  const verdict = buildVerdict({ isLegacy, confidence, flagged, complianceLandmine, specConcerns: sig.parsedSpecConcerns });

  // ── concern fingerprint (spec-level + feature-level) ──
  const concernFingerprint = buildConcernFingerprint(sig);

  // ── sizing spread ──
  const sizingSpread = buildSizingSpread(features);

  return {
    isLegacy,
    shape,
    categories,
    quality,
    confidence,
    verdict,
    complianceLandmine,
    flagged,
    confident,
    concernFingerprint,
    sizingSpread,
    ambiguityNote: sig.ambiguityNote || null,
  };
}

/**
 * Build the verdict {tone, headline, sub}. tone:
 *   'legacy'   — pre-v3 breakdown (no signals captured)
 *   'unrated'  — every feature is unrated (the model rated nothing)
 *   'caution'  — has a ✗ or a high-severity concern (the "look here" state)
 *   'trust'    — mostly-confident, nothing high-risk
 */
function buildVerdict({ isLegacy, confidence, flagged, complianceLandmine, specConcerns }) {
  if (isLegacy) {
    return {
      tone: 'legacy',
      headline: 'Predates AI self-check',
      sub: 'No confidence or concern signals were captured — review it as you would any draft.',
    };
  }

  const { confident, lowConf, unrated, total } = confidence;

  // All-unrated: the model returned a breakdown but rated nothing.
  if (total > 0 && unrated === total) {
    return {
      tone: 'unrated',
      headline: `No confidence signals — ${total} of ${total} features unrated`,
      sub: 'The model returned the breakdown but rated nothing. This is NOT "all clear" — treat every feature as unreviewed; the weight map and concern fingerprint still apply.',
    };
  }

  // Caution when: a low-confidence feature, OR a high-severity concern ANYWHERE (feature OR spec),
  // OR the landmine. The verdict must NEVER read "trust / nothing flagged" above a red landmine or a
  // high spec-level concern (a per-feature `flagged` check alone missed spec-level concerns). (deep-audit fix)
  const specs = Array.isArray(specConcerns) ? specConcerns : [];
  const flaggedHasHigh = flagged.some((e) => (e.concerns || []).some((c) => c && c.severity === 'high'));
  const specHasHigh = specs.some((c) => c && c.severity === 'high');
  const hasHighConcern = flaggedHasHigh || specHasHigh;
  const caution = lowConf > 0 || hasHighConcern || !!complianceLandmine;

  // The quality label + average render as their own chip / line on the card — do NOT bake them into
  // `sub` (that duplicated them on screen). `sub` carries ONLY the honest caveat. (deep-audit fix)
  const guide =
    'These are the model\'s own signals — a guide for where to look, not a guarantee. Nothing here blocks editing; the list below is your triage order.';

  if (caution) {
    const reasons = [];
    if (lowConf > 0) reasons.push(`${lowConf} low-confidence feature${lowConf === 1 ? '' : 's'}`);
    if (complianceLandmine && complianceLandmine.type === 'COMPLIANCE') reasons.push('a compliance landmine');
    else if (hasHighConcern || complianceLandmine) reasons.push('a high-severity concern');
    return {
      tone: 'caution',
      headline: `Look before you build — ${reasons.join(' and ')}`,
      sub: guide,
    };
  }

  // Not caution (no ✗ / high concern / landmine), but the green "trust" tone must require the model to
  // be genuinely MOSTLY confident — a strict majority of ALL features. Otherwise (mostly ⚠ unsure, or
  // many unrated) it is a NEUTRAL "mixed" read (steel), never a green "Trustworthy". (deep-audit fix)
  const confidentMajority = confident * 2 > total;
  if (!confidentMajority) {
    return {
      tone: 'mixed',
      headline: `Mixed confidence — ${confident} of ${total} features high-confidence`,
      sub: 'The model was unsure or silent on many features — review the list before you trust this. ' + guide,
    };
  }

  // trust — mostly-confident, nothing high-risk. Only claim "nothing flagged" when there are genuinely
  // no per-feature flags AND no spec-level concerns at all.
  const noConcernsAtAll = flagged.length === 0 && specs.length === 0;
  if (total > 0 && confident === total && noConcernsAtAll) {
    return { tone: 'trust', headline: `All ${total} features high-confidence — nothing flagged`, sub: guide };
  }
  return { tone: 'trust', headline: `Trustworthy overall — ${confident} of ${total} features high-confidence`, sub: guide };
}

const _SEV_RANK = { high: 3, medium: 2, low: 1 };

/**
 * Find the ONE compliance landmine: the highest-severity COMPLIANCE concern
 * anywhere (spec-level OR feature-level). Feature-level carries the related
 * feature name + uid for the deep-link. null when there is no COMPLIANCE concern.
 */
function findComplianceLandmine(sig, enriched) {
  // 1) highest-severity COMPLIANCE concern. FEATURE-level is processed FIRST so it wins a severity
  //    TIE (it carries the actionable deep-link); a STRICTLY-higher spec-level compliance still wins. (deep-audit fix)
  let best = null;
  let bestRank = 0;
  for (const e of enriched) {
    for (const c of e.concerns || []) {
      if (c.type === 'COMPLIANCE') {
        const rank = _SEV_RANK[c.severity] || 0;
        if (rank > bestRank) {
          bestRank = rank;
          best = { type: 'COMPLIANCE', severity: c.severity, text: c.text, relatedFeatureName: e.name, relatedFeatureUid: e._uid };
        }
      }
    }
  }
  for (const c of sig.parsedSpecConcerns) {
    if (c.type === 'COMPLIANCE') {
      const rank = _SEV_RANK[c.severity] || 0;
      if (rank > bestRank) { bestRank = rank; best = { type: 'COMPLIANCE', severity: c.severity, text: c.text }; }
    }
  }
  if (best) return best;

  // 2) no compliance concern → promote the highest-severity HIGH, non-compliance SPEC-level concern
  //    as the "one landmine". A feature-level high concern already tops the flagged list; a spec-level
  //    one would otherwise hide in the fingerprint. Makes the callout cover a high RISK/EXTERNAL_DEP too
  //    (and makes the UI's non-compliance label branch reachable). (deep-audit fix)
  for (const c of sig.parsedSpecConcerns) {
    if (c.severity === 'high') return { type: c.type, severity: 'high', text: c.text };
  }
  return null;
}

/**
 * Concern fingerprint over spec-level + feature-level concerns:
 *   items: [{type, label, count, isCompliance}] sorted count desc, total, narrative.
 */
function buildConcernFingerprint(sig) {
  const counts = new Map();
  const all = [...sig.parsedSpecConcerns, ...sig.parsedFeatureConcerns];
  for (const c of all) {
    counts.set(c.type, (counts.get(c.type) || 0) + 1);
  }
  const items = Array.from(counts.entries())
    .map(([type, count]) => ({
      type,
      label: CONCERN_TYPE_LABEL[type] || type,
      count,
      isCompliance: type === 'COMPLIANCE',
    }))
    .sort((a, b) => b.count - a.count);

  const total = all.length;

  let narrative = null;
  if (total > 0) {
    const top = items.slice(0, 2).map((i) => i.label);
    const lead = top.join(' + ');
    if (items.some((i) => i.isCompliance)) {
      narrative = `Mostly ${lead} — and a compliance flag that crosses a regulatory boundary; clear it before you build.`;
    } else if (items[0] && (items[0].type === 'AMBIGUITY' || items[0].type === 'ASSUMPTION')) {
      narrative = `Mostly ${lead} — a spec that leans on examples over rules; nail down the ambiguous edges before estimating.`;
    } else {
      narrative = `Mostly ${lead} — the pattern of what the model flagged across the breakdown.`;
    }
  }

  return { items, total, narrative };
}

/**
 * Sizing spread — the "did the model size honestly" proof.
 *   storyPoints: [{sp, count}] (only the SP values that occur, ascending),
 *   complexity: {min, max}, priority: {high, medium, low}, healthy (bool).
 */
function buildSizingSpread(features) {
  const spCounts = new Map();
  let cxMin = null;
  let cxMax = null;
  const prio = { high: 0, medium: 0, low: 0 };

  for (const f of features) {
    if (typeof f?.story_points === 'number') {
      spCounts.set(f.story_points, (spCounts.get(f.story_points) || 0) + 1);
    }
    if (typeof f?.complexity_score === 'number') {
      cxMin = cxMin === null ? f.complexity_score : Math.min(cxMin, f.complexity_score);
      cxMax = cxMax === null ? f.complexity_score : Math.max(cxMax, f.complexity_score);
    }
    const lbl = priorityLabel(f?.priority);
    if (lbl === 'High') prio.high++;
    else if (lbl === 'Medium') prio.medium++;
    else if (lbl === 'Low') prio.low++;
    // unknown / absent → uncounted (never miscategorised as low). (deep-audit fix)
  }

  const storyPoints = Array.from(spCounts.entries())
    .map(([sp, count]) => ({ sp, count }))
    .sort((a, b) => a.sp - b.sp);

  // healthy = the SP distribution is a SPREAD, not uniform ("all 5s"). Two+
  // distinct SP values that actually occur ⇒ healthy. A single distinct value
  // (or none) ⇒ not a spread.
  const healthy = storyPoints.length >= 2;

  return {
    storyPoints,
    complexity: { min: cxMin, max: cxMax },
    priority: prio,
    healthy,
  };
}

// ════════════════════════════════════════════════════════════
// DEPENDENCY EDITING (Review-screen remove / restore)
// ════════════════════════════════════════════════════════════
//
// Removing a cross-feature dependency on the Review screen must mutate the
// breakdown JSON the JIRA push reads — NOT just the display. The push
// (push_handler.flattenBreakdown) reads feature.dependencies from
// breakdown.capabilities[].features (legacy-adapted) OR breakdown.features (v3
// native); the Review display (extractV3Signals) reads breakdown._v3_original
// .features. adaptToLegacyShape puts the SAME feature object references in both
// capabilities[] and _v3_original — but an immutable (React-safe) update
// replaces those references, so to reach BOTH the push and the display we must
// rebuild EVERY array that could hold the feature. Pure structural edit — no LLM.

/**
 * Internal: return a NEW breakdown with `fn(dependencies[])` applied to the
 * SOURCE feature, wherever that feature lives (capabilities[].features — push
 * legacy; features — push v3 native; _v3_original.features — display). Immutable;
 * untouched features kept by ref.
 *
 * SOURCE identity (uid-first, name-fallback): when `sourceUid` is given the source
 * is matched by the stable `_uid` — this is the fix for DUPLICATE-named features
 * (two unrenamed "New Feature" adds would otherwise both match by name and a
 * mutation on one would corrupt both). When `sourceUid` is ABSENT (legacy callers,
 * or a legacy breakdown whose features carry no _uid) the match falls back to the
 * feature name — byte-identical to the pre-migration behavior. The TARGET is NOT
 * migrated: the dep string stays the frozen _orig_name (resolved uid-first at push).
 */
function mapFeatureDependencies(breakdown, sourceFeatureName, fn, sourceUid) {
  if (!breakdown || typeof breakdown !== 'object') return breakdown;
  const editFeature = (f) => {
    const matches = sourceUid ? (f && f._uid === sourceUid) : (f && f.name === sourceFeatureName);
    return matches
      ? { ...f, dependencies: fn(Array.isArray(f.dependencies) ? f.dependencies : []) }
      : f;
  };
  const next = { ...breakdown };
  if (Array.isArray(breakdown.capabilities)) {
    next.capabilities = breakdown.capabilities.map((c) => ({
      ...c,
      features: Array.isArray(c.features) ? c.features.map(editFeature) : c.features,
    }));
  }
  if (Array.isArray(breakdown.features)) {
    next.features = breakdown.features.map(editFeature);
  }
  if (breakdown._v3_original && Array.isArray(breakdown._v3_original.features)) {
    next._v3_original = {
      ...breakdown._v3_original,
      features: breakdown._v3_original.features.map(editFeature),
    };
  }
  return next;
}

/**
 * Remove `targetName` from the dependencies of the source feature, across every
 * shape the push/display read. Returns a NEW breakdown. `sourceUid` (optional)
 * matches the source uid-first; absent → name-fallback (unchanged behavior).
 */
export function removeFeatureDependency(breakdown, sourceFeatureName, targetName, sourceUid) {
  return mapFeatureDependencies(
    breakdown,
    sourceFeatureName,
    (deps) => deps.filter((d) => d !== targetName),
    sourceUid
  );
}

/**
 * Inverse of removeFeatureDependency — re-add `targetName` (idempotent: never
 * duplicates). Backs the Review-screen "restore" + "add" affordances. `sourceUid`
 * (optional) matches the source uid-first; absent → name-fallback (unchanged).
 */
export function addFeatureDependency(breakdown, sourceFeatureName, targetName, sourceUid) {
  return mapFeatureDependencies(
    breakdown,
    sourceFeatureName,
    (deps) => (deps.includes(targetName) ? deps : [...deps, targetName]),
    sourceUid
  );
}

// ════════════════════════════════════════════════════════════
// DEPENDENCY CYCLE GUARD (Editor "+ dependency" — E5)
// ════════════════════════════════════════════════════════════
//
// Adding a cross-feature dependency in the editor must not close a circular
// blocks-loop (the generation-time cycle Verify/Repair only runs at generate;
// an editor-added edge bypasses it). This is a PURE structural check over the
// SAME edge model the push reads: feature.dependencies[] holds FROZEN _orig_name
// target strings (adaptToLegacyShape freezes _orig_name = the generation name),
// so we build adjacency by each feature's _orig_name -> its dependencies[] and
// ask: can targetOrigName already reach sourceOrigName? If so, adding
// source -> target closes a loop. No LLM — deterministic graph reachability.

/**
 * True iff adding a dependency source -> target would create a cycle, i.e.
 * targetOrigName can already (transitively) reach sourceOrigName via
 * feature.dependencies[], OR source === target (a self-edge). Both names are
 * FROZEN _orig_name strings (the edge model). Guards against pre-existing cycles
 * in the data with a visited set. O(V+E). Pure — reads only the breakdown graph.
 */
export function wouldCreateCycle(breakdown, sourceOrigName, targetOrigName) {
  if (!breakdown || typeof breakdown !== 'object') return false;
  if (sourceOrigName == null || targetOrigName == null) return false;
  // A self-edge is always a cycle.
  if (sourceOrigName === targetOrigName) return true;

  // Read features with the SAME precedence extractV3Signals / readFeatures use,
  // so the graph reflects the edited breakdown.
  const v3 = breakdown._v3_original || breakdown || {};
  const features = Array.isArray(breakdown.capabilities)
    ? breakdown.capabilities.flatMap((c) => c.features || [])
    : Array.isArray(breakdown.features)
      ? breakdown.features
      : Array.isArray(v3.features)
        ? v3.features
        : [];

  // adjacency: _orig_name (fallback name) -> [dep _orig_name strings]. First
  // match wins on a duplicate _orig_name (matches origToCurrent in extractV3Signals);
  // duplicate targets from multiple features are merged so reachability is complete.
  const adjacency = new Map();
  for (const f of features) {
    if (!f || typeof f !== 'object') continue;
    const key = f._orig_name || f.name;
    if (key == null) continue;
    const deps = Array.isArray(f.dependencies) ? f.dependencies : [];
    if (!adjacency.has(key)) adjacency.set(key, []);
    const bucket = adjacency.get(key);
    for (const d of deps) {
      if (d != null && !bucket.includes(d)) bucket.push(d);
    }
  }

  // DFS from targetOrigName; if we reach sourceOrigName, target already depends
  // (transitively) on source, so source -> target closes a loop. The visited set
  // both bounds the search and tolerates pre-existing cycles in the data.
  const visited = new Set();
  const stack = [targetOrigName];
  while (stack.length) {
    const node = stack.pop();
    if (node === sourceOrigName) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    const next = adjacency.get(node);
    if (next) {
      for (const n of next) {
        if (!visited.has(n)) stack.push(n);
      }
    }
  }
  return false;
}

// ════════════════════════════════════════════════════════════
// CONCERN DISPOSITION (editor-side review tracking; NEVER pushed to Jira)
// ════════════════════════════════════════════════════════════
//
// The editor lets a reviewer TRIAGE each AI-flagged concern (open / edited /
// accepted / dismissed[+reason]). This lives ON the breakdown as
//   breakdown._concern_dispositions = { [concernId]: { state, reason? } }
// so it rides the SAME immutable breakdown object through editorBreakdownRef
// (survives the screen remount) and naturally RESETS on regenerate (a fresh
// breakdown has no _concern_dispositions map). It is editor-only — flattenBreakdown
// (push_handler) never reads _concern_dispositions, so nothing reaches Jira.
//
// concernId = `${featureUid}#${concernIndex}`. concerns[] are read-only (the model
// authored them; the editor does not add/remove per-concern strings), so the index
// is a STABLE key within a session. Binding to the feature's _uid (not its name)
// keeps the disposition attached across a rename.

/** Stable id for a single feature concern. Pure. */
export function concernIdFor(featureUid, concernIndex) {
  return `${featureUid}#${concernIndex}`;
}

/**
 * Read the disposition for a concernId. Missing ⇒ the default open state.
 * Returns {state, reason?}. Pure — never mutates.
 */
export function getConcernDisposition(breakdown, concernId) {
  const map = breakdown && breakdown._concern_dispositions;
  const entry = map && typeof map === 'object' ? map[concernId] : null;
  if (entry && typeof entry === 'object' && entry.state) {
    return entry.reason != null
      ? { state: entry.state, reason: entry.reason }
      : { state: entry.state };
  }
  return { state: 'open' };
}

/**
 * Set (or clear) the disposition for a concernId. Returns a NEW breakdown
 * (immutable): shallow-clones the breakdown + the _concern_dispositions map ONLY
 * — features are kept by reference (React-safe; the concern strings are read-only).
 *   state === 'open'      -> DELETES the entry (open is the default absence state)
 *   state === 'dismissed' -> stores { state, reason } (reason is the one-line why)
 *   any other state       -> stores { state } (reason ignored)
 */
export function setConcernDisposition(breakdown, concernId, state, reason) {
  if (!breakdown || typeof breakdown !== 'object') return breakdown;
  const prev =
    breakdown._concern_dispositions && typeof breakdown._concern_dispositions === 'object'
      ? breakdown._concern_dispositions
      : {};
  const nextMap = { ...prev };
  if (state === 'open' || !state) {
    delete nextMap[concernId];
  } else if (state === 'dismissed') {
    nextMap[concernId] = { state: 'dismissed', reason: reason != null ? reason : '' };
  } else {
    nextMap[concernId] = { state };
  }
  return { ...breakdown, _concern_dispositions: nextMap };
}

// ════════════════════════════════════════════════════════════
// REVIEW READINESS ROLLUP (editor top bar + worklist badges)
// ════════════════════════════════════════════════════════════
//
// The disposition-aware counterpart to computeInsightsView: same features, same
// weight/landmine derive (single source of truth — REUSE extractV3Signals +
// computeInsightsView + computeFeatureWeight), PLUS the open/resolved concern
// counts the disposition map drives. Open concerns NEVER block the Continue CTA
// (the top bar is informational). Orphaned disposition entries (concernIds for a
// feature that was deleted, or an index beyond the feature's current concerns)
// are IGNORED — the counts derive from the CURRENT features, not the raw map.

/**
 * computeReviewReadiness(breakdown) — the editor top-bar + worklist contract.
 * Returns {
 *   totalConcerns, openConcerns, resolvedConcerns,
 *   perFeature: [{ uid, name, category, openCount, totalCount, indicator, weight, reviewed }] (weight desc),
 *   storiesNeedingReview,
 *   landmine   // = computeInsightsView(breakdown).complianceLandmine (may be null)
 * }. Pure derive; ignores orphaned disposition entries.
 */
export function computeReviewReadiness(breakdown) {
  const features = readFeatures(breakdown);
  const insights = computeInsightsView(breakdown);

  let totalConcerns = 0;
  let openConcerns = 0;
  let storiesNeedingReview = 0;
  const perFeature = [];

  for (const f of features) {
    const uid = f && f._uid;
    const concerns = Array.isArray(f && f.concerns) ? f.concerns : [];
    const totalCount = concerns.length;
    let openCount = 0;
    // A null/undefined uid would make concernIdFor produce a "null#0" id — never a real
    // disposition key. Guard defensively: without a uid all concerns read as open (their
    // default), and the story still surfaces in the worklist as unrated/needs-review.
    if (uid != null) {
      for (let i = 0; i < totalCount; i++) {
        const disp = getConcernDisposition(breakdown, concernIdFor(uid, i));
        if (disp.state === 'open') openCount++;
      }
    } else {
      openCount = totalCount;
    }
    totalConcerns += totalCount;
    openConcerns += openCount;

    const indicator = f && f.confidence_indicator;
    // Reuse computeFeatureWeight — do NOT re-derive; parse the raw concern strings
    // to the {severity,...} shape the weight formula reads.
    const weight = computeFeatureWeight({
      confidence_indicator: indicator,
      confidence_score: typeof (f && f.confidence_score) === 'number' ? f.confidence_score : undefined,
      priority: f && f.priority,
      story_points: typeof (f && f.story_points) === 'number' ? f.story_points : undefined,
      complexity_score: typeof (f && f.complexity_score) === 'number' ? f.complexity_score : undefined,
      concerns: concerns.map(parseConcernPrefix),
    });

    // "Reviewed" = a FLAGGED story (✗/⚠) whose concerns are ALL resolved. This is the ONLY honest
    // way a flagged story becomes clear: the human addressed every AI concern. A ✗/⚠ story with NO
    // concerns has nothing to resolve → NOT reviewed (stays flagged, honest); an unrated story has no
    // indicator → NOT reviewed (stays unrated); a ✓ story is already confident. The AI's original
    // indicator/score is preserved everywhere — this flag only flips the worklist icon + this count.
    const reviewed = (indicator === '✗' || indicator === '⚠') && totalCount > 0 && openCount === 0;

    // Unrated (no confidence_indicator) counts as needing review — never let the readiness bar
    // read "all clear" while the worklist shows an "Unrated" badge (fresh-army false-reassurance fix).
    // A `reviewed` story drops from the count (its concerns are all addressed).
    const needsReview = openCount > 0 || (!reviewed && (indicator === '✗' || indicator === '⚠' || !indicator));
    if (needsReview) storiesNeedingReview++;

    perFeature.push({
      uid,
      name: f && f.name,
      category: f && f.category,
      openCount,
      totalCount,
      indicator,
      weight,
      reviewed,
    });
  }

  perFeature.sort((a, b) => b.weight - a.weight);

  return {
    totalConcerns,
    openConcerns,
    resolvedConcerns: totalConcerns - openConcerns,
    perFeature,
    storiesNeedingReview,
    landmine: insights.complianceLandmine || null,
  };
}

// ════════════════════════════════════════════════════════════
// SHARED-AC SAFE INJECTION / REMOVAL (kills the substring data-loss bug)
// ════════════════════════════════════════════════════════════
//
// A shared acceptance criterion assigned to a story is injected into that story's
// AC list as a canonical `${id}: ${text}` string. The OLD removal keyed on the
// AC TEXT (substring), so a hand-written AC that happened to share the text was
// wrongly matched + deleted, and a rename orphaned the binding. The fix: inject
// with an id PREFIX and match by that EXACT `${id}: ` prefix (never a substring),
// and bind the assignment to the feature's _uid (survives a rename). Pure helpers;
// the UI uses them so inject + remove agree by construction.

/** The canonical injected string for a shared AC item. Pure. */
export function sharedAcInjected(item) {
  return `${item.id}: ${item.text}`;
}

/**
 * True iff acString is the injected form of this shared item — an EXACT
 * `${item.id}: ` prefix match (NOT a substring of the text). A hand-written AC
 * with the same text but no `id: ` prefix is NOT matched (the data-loss bug we kill).
 */
export function acIsSharedFor(acString, item) {
  if (typeof acString !== 'string' || !item || item.id == null) return false;
  return acString.startsWith(`${item.id}: `);
}

/**
 * Find a feature by its stable _uid across capabilities[].features. Returns the
 * feature object or null. (Binding shared-AC assignment by _uid survives a rename.)
 */
export function findFeatureByUid(breakdown, uid) {
  if (!breakdown || typeof breakdown !== 'object' || uid == null) return null;
  const caps = Array.isArray(breakdown.capabilities) ? breakdown.capabilities : [];
  for (const c of caps) {
    const feats = Array.isArray(c && c.features) ? c.features : [];
    for (const f of feats) {
      if (f && f._uid === uid) return f;
    }
  }
  // Fallback: native-v3 features (no capabilities wrapper).
  const flat = Array.isArray(breakdown.features) ? breakdown.features : [];
  for (const f of flat) {
    if (f && f._uid === uid) return f;
  }
  return null;
}

// ════════════════════════════════════════════════════════════
// CONCERN SEVERITY SORTING / GROUPING
// ════════════════════════════════════════════════════════════

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * Sort parsed concerns by severity (high → medium → low).
 */
export function sortConcernsBySeverity(concerns) {
  return [...concerns].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
  );
}

/**
 * Color tokens для severity badges (matches existing s2j-* palette).
 */
export const SEVERITY_PALETTE = {
  high: {
    bg: 'var(--s2j-red-bg)',
    border: 'var(--s2j-red-border)',
    text: 'var(--s2j-red)',
  },
  medium: {
    bg: 'var(--s2j-orange-bg)',
    border: 'var(--s2j-orange-border)',
    text: 'var(--s2j-orange)',
  },
  low: {
    bg: 'var(--s2j-bg-section)',
    border: 'var(--s2j-border)',
    text: 'var(--s2j-text-muted)',
  },
};

/**
 * Display label для type prefix.
 */
export const CONCERN_TYPE_LABEL = {
  AMBIGUITY: 'Ambiguity',
  RISK: 'Risk',
  ASSUMPTION: 'Assumption',
  TECH_DEBT: 'Tech Debt',
  EXTERNAL_DEPENDENCY: 'External Dep',
  COMPLIANCE: 'Compliance',
  NOTE: 'Note',
};

/**
 * Overall quality color palette (для TrustCard rating badge).
 */
export const QUALITY_PALETTE = {
  high: {
    bg: 'var(--s2j-green-bg)',
    border: 'var(--s2j-green-border)',
    text: 'var(--s2j-green-dark)',
    label: 'HIGH',
  },
  medium: {
    bg: 'var(--s2j-orange-bg)',
    border: 'var(--s2j-orange-border)',
    text: 'var(--s2j-orange)',
    label: 'MEDIUM',
  },
  low: {
    bg: 'var(--s2j-red-bg)',
    border: 'var(--s2j-red-border)',
    text: 'var(--s2j-red)',
    label: 'LOW',
  },
};
