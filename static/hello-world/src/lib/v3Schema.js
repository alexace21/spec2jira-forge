/**
 * Spec2Tickets v3.0.0 schema helpers.
 *
 * Bridges new flat-features schema (от Anthropic Sonnet 4.6) к the
 * v2.x-shaped consumers (BreakdownEditor, Dashboard) without requiring
 * full UI refactor in this session.
 *
 * Two main responsibilities:
 *   1. adaptToLegacyShape(v3) — wraps flat features в synthetic capability
 *      groups based on feature.category для BreakdownEditor compatibility
 *   2. extractV3Signals(v3) — extracts Dashboard signals natively от v3:
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

  // If breakdown already has v2.x capabilities[] structure, pass through
  if (Array.isArray(v3.capabilities) && v3.capabilities.length > 0) {
    return v3;
  }

  const features = Array.isArray(v3.features) ? v3.features : [];

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
      summary: v3.metadata?.spec_summary?.substring(0, 100) || 'Spec Breakdown',
      description: v3.metadata?.spec_summary || '',
    },
    capabilities,
    shared_acceptance_criteria: sharedAC,
    metadata: v3.metadata,
    spec_concerns: v3.spec_concerns,
    _v3_original: v3,
  };
}

/**
 * Inverse — convert legacy-shaped (post-edit) back к v3 native shape.
 * Used когато BreakdownEditor commits edits + we want к persist v3 form.
 *
 * Flattens capabilities back к features array, preserves все other
 * v3-native fields (spec_concerns, metadata, etc.) от _v3_original.
 */
export function unadaptToV3(adapted) {
  if (!adapted || typeof adapted !== 'object') return adapted;
  if (!Array.isArray(adapted.capabilities)) return adapted;

  const features = adapted.capabilities.flatMap((cap) => cap.features || []);

  // Flatten shared AC items back к string array
  let sharedAC;
  if (adapted.shared_acceptance_criteria?.items?.length > 0) {
    sharedAC = adapted.shared_acceptance_criteria.items.map(
      (i) => i.text || ''
    ).filter(Boolean);
  }

  const original = adapted._v3_original || {};

  const result = {
    ...original,
    features,
  };
  if (adapted.epic && (adapted.epic.summary || adapted.epic.description)) {
    result.epic = adapted.epic;
  }
  if (sharedAC && sharedAC.length > 0) {
    result.shared_acceptance_criteria = sharedAC;
  }
  if (adapted.metadata) {
    result.metadata = adapted.metadata;
  }
  return result;
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
  const features = Array.isArray(v3.features)
    ? v3.features
    : Array.isArray(breakdown?.capabilities)
      ? breakdown.capabilities.flatMap((c) => c.features || [])
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
