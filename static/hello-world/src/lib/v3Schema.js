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
  const features = (Array.isArray(v3.features) ? v3.features : []).map((f) => {
    if (!f || typeof f !== 'object') return f;
    if (f._uid && f._orig_name) return f; // both already minted → stable, untouched
    return { ...f, _uid: f._uid || newStoryUid(), _orig_name: f._orig_name || f.name };
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
 *     dependencyEdges: [{source, target}],
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
      dependencyEdges.push({ source: f.name, target: depTarget });
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
 * feature named `sourceFeatureName`, wherever that feature lives
 * (capabilities[].features — push legacy; features — push v3 native;
 * _v3_original.features — display). Immutable; untouched features kept by ref.
 */
function mapFeatureDependencies(breakdown, sourceFeatureName, fn) {
  if (!breakdown || typeof breakdown !== 'object') return breakdown;
  const editFeature = (f) =>
    f && f.name === sourceFeatureName
      ? { ...f, dependencies: fn(Array.isArray(f.dependencies) ? f.dependencies : []) }
      : f;
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
 * Remove `targetName` from the dependencies of the feature `sourceFeatureName`,
 * across every shape the push/display read. Returns a NEW breakdown.
 */
export function removeFeatureDependency(breakdown, sourceFeatureName, targetName) {
  return mapFeatureDependencies(breakdown, sourceFeatureName, (deps) =>
    deps.filter((d) => d !== targetName)
  );
}

/**
 * Inverse of removeFeatureDependency — re-add `targetName` (idempotent: never
 * duplicates). Backs the Review-screen "restore" affordance.
 */
export function addFeatureDependency(breakdown, sourceFeatureName, targetName) {
  return mapFeatureDependencies(breakdown, sourceFeatureName, (deps) =>
    deps.includes(targetName) ? deps : [...deps, targetName]
  );
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
