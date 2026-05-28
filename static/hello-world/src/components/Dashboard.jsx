/**
 * DashboardScreen — manager-summary dashboard (CG-12, 2026-05-09).
 *
 * D7.B architecture: ZERO backend changes. Frontend computes derived
 * signals от existing getResults result_payload via deriveDashboardSignals.
 *
 * D8.A single-job view: one page → one dashboard (latest completed
 * generate-kind job). Cross-spec aggregation deferred (future axis).
 *
 * D2.C user picks page → dashboard renders that page's latest result.
 * D9.A empty-state surfaces когато page has no completed job.
 *
 * Composition (per D3.C / D4.B / D5.B / D6.A):
 *   - TrustCard               — completeness rating + CG-2 ✓/⚠/✗ + broken
 *                               + avg + dropped + dep-links
 *   - QualityFlagsGrid        — derived severity-grouped concerns (only
 *                               when flags non-empty)
 *   - CapabilitySummaryTable  — sortable per-cap row table
 *
 * Backend schema reference (verified 2026-05-09 via Theme E grep-
 * discipline; design memory drifted from actual emit shape):
 *   - breakdown.completeness_scorecard — CG-6 stamped at output_adapter.py
 *     - .summary {total_capabilities, total_features, total_tasks}
 *     - .ac_distribution {feature_ac_count, cap_ac_count, cap_dod_count,
 *                          shared_ac_panel_count, total_surfaced}
 *     - .dropped_by_phase {phase: {count: int, details: {category: count}}}
 *       — shape is per-phase OBJECT не array; sum .count across phases
 *     - .confidence_breakdown {auto_approve, review, manual_edit,
 *                              broken_stories, avg_score}
 *       — keys are auto_approve/review/manual_edit (NOT checkmark_count
 *       /warning_count/cross_count from design draft)
 *     - .completeness_rating ("HIGH" | "MEDIUM" | "LOW")
 *     - .completeness_rationale list[str] (NOT string)
 *   - feature.confidence — int 0-100 (NOT object)
 *   - feature.confidence_indicator — "✓" | "⚠" | "✗"
 *   - task.dependencies — list[str] (Phase 3.8 cross-feature ship 2026-05-08)
 */
import React, { useState, useMemo } from "react";
import BackButton from "./BackButton";

// BE1 part 29 (2026-05-09) — universal max-width style for Dashboard
// states (loading / error / main / empty). Mirrors App.js screens
// SCREEN_MAX_WIDTH_STYLE for consistency. 1200px matches industry-
// standard editing width; bounded на ultra-wide globalPage displays.
const SCREEN_MAX_WIDTH_STYLE = {
  maxWidth: "1200px",
  margin: "0 auto",
  width: "100%",
};

// ════════════════════════════════════════════════════════════════
// Pure helper — derive signals from result_payload
// ════════════════════════════════════════════════════════════════

/**
 * deriveDashboardSignals — single source of truth for what the
 * dashboard renders. Pure function: same input → same output;
 * defensive against missing fields (legacy result_payloads без
 * CG-6 scorecard render gracefully с zeros).
 *
 * Returns null когато result_payload is null/undefined (caller
 * routes to DashboardEmptyState).
 */
export function deriveDashboardSignals(result_payload) {
  if (!result_payload || typeof result_payload !== "object") return null;

  const breakdown = result_payload.breakdown || {};
  const sc = breakdown.completeness_scorecard || {};
  const cg2 = sc.confidence_breakdown || {};
  const summary = sc.summary || {};
  const acDist = sc.ac_distribution || {};

  // Completeness rating + rationale (rationale is list[str] per backend).
  const completenessRating = sc.completeness_rating || "UNKNOWN";
  const rationaleRaw = sc.completeness_rationale;
  const completenessRationale = Array.isArray(rationaleRaw)
    ? rationaleRaw
    : rationaleRaw
    ? [String(rationaleRaw)]
    : [];

  // CG-2 confidence aggregate — actual backend keys:
  const autoApprove = cg2.auto_approve || 0;
  const review = cg2.review || 0;
  const manualEdit = cg2.manual_edit || 0;
  const brokenStories = cg2.broken_stories || 0;
  const avgScore = cg2.avg_score || 0;

  // Total dropped — sum .count across phases. Backend shape per-phase:
  // {count: int, details: {category: count}}. Defense against legacy
  // shapes (раньше was {category: count} flat OR list of records).
  const dropped = sc.dropped_by_phase || {};
  let totalDropped = 0;
  Object.values(dropped).forEach((perPhase) => {
    if (perPhase && typeof perPhase === "object") {
      if (typeof perPhase.count === "number") {
        totalDropped += perPhase.count;
      } else if (Array.isArray(perPhase)) {
        // Legacy shape (list of records) — fall through
        totalDropped += perPhase.length;
      }
    }
  });

  // Pre-push dep-link count (D6.A) — sum BOTH task.dependencies AND
  // feature.dependencies arrays cross all features cross all caps.
  //
  // Phase 3.8 v2 task-level (legacy, NOT WIRED post 2026-05-10 part 45):
  //   populates task.dependencies = ["target task summary", ...]
  // Phase 3.8 v3 feature-level (ACTIVE post Round 5 axis 2026-05-10):
  //   populates feature.dependencies = ['Target Feature (in capability "Cap")']
  //   (✓ auto-approve tier; ⚠ tier lives separately в dependency_review_queue)
  //
  // Sum both layers for backward-compat; legacy breakdowns have empty
  // arrays (zero count is correct shape). v3-only breakdowns sum
  // feature deps; v2-legacy sums task deps; mixed possible during
  // transition windows.
  //
  // Active dependencies cap-grouped overview (NEW 2026-05-11 part 57+):
  // collect feature.dependency_metadata (✓ tier с reason+confidence)
  // grouped by source capability for ActiveDependenciesOverview component
  // — Dashboard high-level overview surface mirroring per-feature view in
  // FeatureCard's "Depends on" subsection. Cap-grouped Map preserves
  // insertion order = breakdown.capabilities order (so source cap row
  // ordering matches the CapabilitySummaryTable). Backward compat: legacy
  // breakdowns без the field skip the inner forEach entirely → empty Map.
  let depLinkCount = 0;
  const dependencyReviewQueue = [];
  const activeDependenciesByCap = new Map();
  (breakdown.capabilities || []).forEach((cap) => {
    const capName = cap.name || "(unnamed cap)";
    (cap.features || []).forEach((feat) => {
      // v3 feature-level (✓ auto-approve tier)
      depLinkCount += (feat.dependencies || []).length;
      // v3 ⚠ review tier — flattened cross-spec for Dashboard surface
      const reviewQueue = feat.dependency_review_queue || [];
      reviewQueue.forEach((edgeMeta) => {
        if (edgeMeta && edgeMeta.target) {
          dependencyReviewQueue.push({
            sourceFeature: feat.name || "(unnamed feature)",
            sourceCapability: capName,
            target: edgeMeta.target,
            reason: edgeMeta.reason || "",
            confidence: edgeMeta.confidence || "⚠",
          });
        }
      });
      // v3 ✓ tier active dependencies — cap-grouped for overview surface
      const depMetadata = feat.dependency_metadata || [];
      depMetadata.forEach((meta) => {
        if (meta && meta.target) {
          if (!activeDependenciesByCap.has(capName)) {
            activeDependenciesByCap.set(capName, []);
          }
          activeDependenciesByCap.get(capName).push({
            sourceFeature: feat.name || "(unnamed feature)",
            target: meta.target,
            reason: meta.reason || "",
            confidence: meta.confidence || "✓",
          });
        }
      });
      // v2 task-level (legacy backward-compat)
      (feat.tasks || []).forEach((task) => {
        depLinkCount += (task.dependencies || []).length;
      });
    });
  });

  // Convert Map к array of group objects (preserves cap insertion order).
  // Empty array когато no ✓ tier deps anywhere → component returns null →
  // Dashboard renders unchanged (backward compat with pre-v3 breakdowns).
  const activeDependencies = Array.from(activeDependenciesByCap.entries()).map(
    ([capName, edges]) => ({ capName, edges })
  );

  // ─── Capability coupling overview (NEW 2026-05-12 part 62 follow-up) ───
  // Derived AGGREGATE view от feature.dependency_metadata: counts how many
  // features в each source capability block features в other capabilities.
  // Surfaces Epic-level coupling strength без storing separate schema field
  // (per architectural decision не к infer cap-level deps directly — derive
  // от feature-level instead). Skip intra-cap edges (focus е cross-cap).
  //
  // Strength tiers (educated-guess thresholds, Tier 2 calibration candidate):
  //   strong   ≥50% of source features depend → likely Epic-level ordering
  //   moderate 25-49% → partial Epic-level dependency
  //   light    <25%   → minor coupling (few features bridge caps)
  const couplingMap = new Map();  // sourceCapName -> Map<targetCapName, Set<sourceFeatureName>>
  const capTotalFeatures = new Map();  // capName -> total feature count

  (breakdown.capabilities || []).forEach((cap) => {
    const capName = cap.name || "(unnamed cap)";
    const features = cap.features || [];
    capTotalFeatures.set(capName, features.length);

    features.forEach((feat) => {
      const depMetadata = feat.dependency_metadata || [];
      depMetadata.forEach((meta) => {
        if (!meta || !meta.target) return;
        // Parse target capability от canonical form 'Feature Name (in capability "Cap Name")'
        const targetMatch = /\(in capability "([^"]+)"\)/.exec(meta.target);
        if (!targetMatch) return;
        const targetCap = targetMatch[1];
        if (targetCap === capName) return;  // skip intra-cap (only cross-cap coupling)
        if (!couplingMap.has(capName)) couplingMap.set(capName, new Map());
        const targets = couplingMap.get(capName);
        if (!targets.has(targetCap)) targets.set(targetCap, new Set());
        targets.get(targetCap).add(feat.name || "(unnamed)");
      });
    });
  });

  // Convert к array of group objects sorted by source cap с most outbound coupling
  const capabilityCoupling = [];
  for (const [sourceCapName, targets] of couplingMap.entries()) {
    const totalFeats = capTotalFeatures.get(sourceCapName) || 0;
    const blocks = [];
    for (const [targetCapName, blockingFeats] of targets.entries()) {
      const count = blockingFeats.size;
      const strength = totalFeats > 0 ? count / totalFeats : 0;
      let tier = "light";
      if (strength >= 0.5) tier = "strong";
      else if (strength >= 0.25) tier = "moderate";
      blocks.push({
        targetCapName,
        blockingFeatures: Array.from(blockingFeats),
        count,
        strength,
        tier,
      });
    }
    // Sort blocks by strength desc (strongest coupling first)
    blocks.sort((a, b) => b.strength - a.strength);
    capabilityCoupling.push({
      sourceCapName,
      totalFeatures: totalFeats,
      blocks,
    });
  }
  // Sort source caps by total outbound coupling count desc (biggest source first)
  capabilityCoupling.sort((a, b) => b.blocks.length - a.blocks.length);

  // Capability summary rows (D4.B sortable table).
  // confidence_indicator field на feature is the canonical CG-2 surface
  // ("✓" / "⚠" / "✗" string at top level); confidence is int 0-100.
  const capRows = (breakdown.capabilities || []).map((cap) => {
    const features = cap.features || [];
    let featCheck = 0;
    let featReview = 0;
    let featManual = 0;
    let featAcSum = 0;
    let taskSum = 0;
    features.forEach((f) => {
      const ind = f.confidence_indicator || "";
      if (ind === "✓") featCheck += 1;
      else if (ind === "⚠") featReview += 1;
      else if (ind === "✗") featManual += 1;
      featAcSum += (f.acceptance_criteria || []).length;
      taskSum += (f.tasks || []).length;
    });
    return {
      name: cap.name || "(unnamed)",
      featureCount: features.length,
      capAcCount: (cap.acceptance_criteria || []).length,
      capDodCount: (cap.definition_of_done || []).length,
      featureAcCount: featAcSum,
      taskCount: taskSum,
      autoApprove: featCheck,
      review: featReview,
      manualEdit: featManual,
    };
  });

  // Derived quality flags (D5.B). Severity rubric — Tier 2 calibration
  // candidate (S-5-shape): thresholds are educated guesses awaiting
  // cross-spec measurement empirical data. Order within severity matters
  // visually; rule order chosen so highest-impact signal surfaces first.
  const qualityFlags = [];
  if (completenessRating === "LOW") {
    const reason =
      completenessRationale.length > 0
        ? completenessRationale.join("; ")
        : "see breakdown details";
    qualityFlags.push({
      severity: "high",
      message: `Completeness rating: LOW — ${reason}`,
    });
  }
  if (brokenStories > 2) {
    qualityFlags.push({
      severity: "high",
      message: `${brokenStories} broken stories (zero-AC features)`,
    });
  } else if (brokenStories > 0) {
    qualityFlags.push({
      severity: "medium",
      message: `${brokenStories} broken story (zero-AC feature)`,
    });
  }
  if (totalDropped > 10) {
    qualityFlags.push({
      severity: "high",
      message: `${totalDropped} items dropped during pipeline`,
    });
  } else if (totalDropped > 3) {
    qualityFlags.push({
      severity: "medium",
      message: `${totalDropped} items dropped`,
    });
  } else if (totalDropped > 0) {
    qualityFlags.push({
      severity: "low",
      message: `${totalDropped} item${totalDropped === 1 ? "" : "s"} dropped`,
    });
  }
  if (manualEdit > 0) {
    qualityFlags.push({
      severity: "high",
      message: `${manualEdit} stor${
        manualEdit === 1 ? "y requires" : "ies require"
      } manual editing (✗)`,
    });
  }
  if (review > 0) {
    qualityFlags.push({
      severity: "medium",
      message: `${review} stor${
        review === 1 ? "y has" : "ies have"
      } confidence concerns (⚠ review)`,
    });
  }

  return {
    completenessRating,
    completenessRationale,
    autoApprove,
    review,
    manualEdit,
    brokenStories,
    avgScore,
    totalDropped,
    depLinkCount,
    dependencyReviewQueue,  // v3 ⚠ tier — Phase 3.8 v3 axis Round 5 2026-05-10
    activeDependencies,     // v3 ✓ tier cap-grouped — Round 5 axis 2026-05-11 part 57+
    capabilityCoupling,     // cap-level aggregate derived от feature deps — part 62 follow-up 2026-05-12
    capRows,
    qualityFlags,
    summary,
    acDist,
  };
}

// ════════════════════════════════════════════════════════════════
// DashboardScreen — top-level component
// ════════════════════════════════════════════════════════════════

function DashboardScreen({ data, sourcePage, loading, error, onBack }) {
  if (loading) {
    return (
      <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
        <BackButton onClick={onBack} />
        <div className="flex items-center gap-2 mt-4">
          <DashboardSpinner size={16} />
          <span
            className="text-sm"
            style={{ color: "var(--s2j-text-light)" }}
          >
            Loading dashboard...
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
        <BackButton onClick={onBack} />
        <div
          className="rounded-lg p-4 mt-4"
          style={{
            background: "var(--s2j-red-bg)",
            border: "1px solid var(--s2j-red-border)",
          }}
        >
          <p
            className="text-sm font-medium mb-1"
            style={{ color: "var(--s2j-red)" }}
          >
            Could not load dashboard
          </p>
          <p className="text-xs" style={{ color: "var(--s2j-text)" }}>
            {typeof error === "string" ? error : JSON.stringify(error)}
          </p>
        </div>
      </div>
    );
  }

  const signals = deriveDashboardSignals(data);

  if (!signals) {
    return <DashboardEmptyState sourcePage={sourcePage} onBack={onBack} />;
  }

  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      {/* Header */}
      <div className="mb-4">
        <BackButton onClick={onBack} />
        <h2
          className="text-lg font-semibold mt-3 mb-1"
          style={{ color: "var(--s2j-text)" }}
        >
          Dashboard
        </h2>
        <p
          className="text-sm"
          style={{ color: "var(--s2j-text-light)" }}
        >
          {sourcePage?.title || "(unknown page)"}
          {sourcePage?.spaceName ? ` · ${sourcePage.spaceName}` : ""}
        </p>
      </div>

      <TrustCard signals={signals} />

      {signals.qualityFlags.length > 0 && (
        <QualityFlagsGrid flags={signals.qualityFlags} />
      )}

      {signals.dependencyReviewQueue.length > 0 && (
        <DependencyReviewQueue queue={signals.dependencyReviewQueue} />
      )}

      {signals.capabilityCoupling.length > 0 && (
        <CapabilityCouplingOverview groups={signals.capabilityCoupling} />
      )}

      {signals.activeDependencies.length > 0 && (
        <ActiveDependenciesOverview groups={signals.activeDependencies} />
      )}

      <CapabilitySummaryTable rows={signals.capRows} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TrustCard — D3.C composition
// ════════════════════════════════════════════════════════════════

function TrustCard({ signals }) {
  const {
    completenessRating,
    completenessRationale,
    autoApprove,
    review,
    manualEdit,
    brokenStories,
    avgScore,
    totalDropped,
    depLinkCount,
    summary,
    acDist,
  } = signals;

  const ratingPalette = ratingColors(completenessRating);

  const totalFeatures = summary.total_features || 0;
  const totalCaps = summary.total_capabilities || 0;
  const totalTasks = summary.total_tasks || 0;
  const totalSurfaced = acDist.total_surfaced || 0;

  return (
    <div
      className="rounded-lg p-4 mb-4"
      style={{
        background: "var(--s2j-bg-section)",
        border: "1px solid var(--s2j-border)",
      }}
    >
      {/* Top row — completeness rating badge + avg confidence */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider"
            style={{
              background: ratingPalette.bg,
              color: ratingPalette.fg,
              border: `1px solid ${ratingPalette.border}`,
            }}
          >
            {completenessRating}
          </span>
          <span
            className="text-xs"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            completeness
          </span>
        </div>
        <div className="text-right">
          <p
            className="text-[10px] font-medium uppercase tracking-wider"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            Avg confidence
          </p>
          <p
            className="text-base font-mono font-semibold"
            style={{ color: "var(--s2j-text)" }}
          >
            {avgScore.toFixed(1)}
            <span
              className="text-xs ml-0.5"
              style={{ color: "var(--s2j-text-muted)" }}
            >
              /100
            </span>
          </p>
        </div>
      </div>

      {/* Confidence stat grid — ✓ / ⚠ / ✗ */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <StatCell
          label="✓ Auto-approve"
          value={autoApprove}
          color="var(--s2j-green)"
        />
        <StatCell
          label="⚠ Review"
          value={review}
          color="var(--s2j-orange)"
        />
        <StatCell
          label="✗ Manual edit"
          value={manualEdit}
          color="var(--s2j-red)"
        />
      </div>

      {/* Counts row — total features / broken / dropped / dep-links */}
      <div
        className="pt-3 grid grid-cols-2 gap-y-1.5 gap-x-3"
        style={{ borderTop: "1px solid var(--s2j-border)" }}
      >
        <CountRow label="Capabilities" value={totalCaps} />
        <CountRow label="Features (stories)" value={totalFeatures} />
        <CountRow label="Tasks" value={totalTasks} />
        <CountRow label="ACs surfaced (total)" value={totalSurfaced} />
        <CountRow
          label="Broken stories"
          value={brokenStories}
          warn={brokenStories > 0}
        />
        <CountRow
          label="Items dropped"
          value={totalDropped}
          warn={totalDropped > 3}
        />
        <CountRow label="Dependency links" value={depLinkCount} />
      </div>

      {/* Rationale (only for LOW rating, max 3 items shown — keeps card
          compact; full rationale lives в quality flags) */}
      {completenessRating === "LOW" && completenessRationale.length > 0 && (
        <div
          className="mt-3 pt-3"
          style={{ borderTop: "1px solid var(--s2j-border)" }}
        >
          <p
            className="text-[10px] font-medium uppercase tracking-wider mb-1"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            Why LOW
          </p>
          <ul
            className="space-y-1"
            style={{ listStyle: "none", margin: 0, padding: 0 }}
          >
            {completenessRationale.slice(0, 3).map((r, i) => (
              <li
                key={i}
                className="text-xs"
                style={{ color: "var(--s2j-text-light)" }}
              >
                • {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ratingColors(rating) {
  switch (rating) {
    case "HIGH":
      return {
        bg: "var(--s2j-green-bg)",
        fg: "var(--s2j-green)",
        border: "var(--s2j-green-border)",
      };
    case "MEDIUM":
      return {
        bg: "var(--s2j-orange-bg)",
        fg: "var(--s2j-orange)",
        border: "var(--s2j-orange-border)",
      };
    case "LOW":
      return {
        bg: "var(--s2j-red-bg)",
        fg: "var(--s2j-red)",
        border: "var(--s2j-red-border)",
      };
    default:
      return {
        bg: "var(--s2j-bg)",
        fg: "var(--s2j-text-muted)",
        border: "var(--s2j-border)",
      };
  }
}

function StatCell({ label, value, color }) {
  return (
    <div
      className="rounded p-2 text-center"
      style={{
        background: "var(--s2j-bg)",
        border: "1px solid var(--s2j-border)",
      }}
    >
      <p
        className="text-[10px] font-medium"
        style={{ color: "var(--s2j-text-muted)" }}
      >
        {label}
      </p>
      <p
        className="text-lg font-mono font-semibold mt-0.5"
        style={{ color }}
      >
        {value}
      </p>
    </div>
  );
}

function CountRow({ label, value, warn }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span style={{ color: "var(--s2j-text-light)" }}>{label}</span>
      <span
        className="font-mono font-semibold"
        style={{ color: warn ? "var(--s2j-orange)" : "var(--s2j-text)" }}
      >
        {value}
      </span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// QualityFlagsGrid — D5.B severity-grouped derived flags
// ════════════════════════════════════════════════════════════════

function QualityFlagsGrid({ flags }) {
  const grouped = { high: [], medium: [], low: [] };
  flags.forEach((f) => {
    const sev = (f.severity || "medium").toLowerCase();
    if (grouped[sev]) grouped[sev].push(f);
    else grouped.medium.push(f);
  });

  return (
    <div className="space-y-2 mb-4">
      <p
        className="text-[11px] font-medium uppercase tracking-wider"
        style={{ color: "var(--s2j-text-muted)" }}
      >
        Quality concerns ({flags.length})
      </p>
      {grouped.high.length > 0 && (
        <FlagBucket
          severity="High"
          flags={grouped.high}
          bg="var(--s2j-red-bg)"
          fg="var(--s2j-red)"
          border="var(--s2j-red-border)"
        />
      )}
      {grouped.medium.length > 0 && (
        <FlagBucket
          severity="Medium"
          flags={grouped.medium}
          bg="var(--s2j-orange-bg)"
          fg="var(--s2j-orange)"
          border="var(--s2j-orange-border)"
        />
      )}
      {grouped.low.length > 0 && (
        <FlagBucket
          severity="Low"
          flags={grouped.low}
          bg="var(--s2j-blue-bg)"
          fg="var(--s2j-blue)"
          border="var(--s2j-blue-border)"
        />
      )}
    </div>
  );
}

function FlagBucket({ severity, flags, bg, fg, border }) {
  return (
    <div
      className="rounded-lg p-3"
      style={{ background: bg, border: `1px solid ${border}` }}
    >
      <p
        className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
        style={{ color: fg }}
      >
        {severity} severity ({flags.length})
      </p>
      <ul
        className="space-y-1"
        style={{ listStyle: "none", margin: 0, padding: 0 }}
      >
        {flags.map((flag, i) => (
          <li
            key={i}
            className="text-xs leading-snug"
            style={{ color: "var(--s2j-text)" }}
          >
            • {flag.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// DependencyReviewQueue — Phase 3.8 v3 axis Round 5 2026-05-10
// Surfaces ⚠ tier feature.dependency_review_queue items как BA-actionable
// review surface. Per design D3.C ratification — confidence-tiered routing
// mirrors CG-2 ✓/⚠/✗ pattern: ✓ tier auto-applied to feature.dependencies
// (active JIRA Story-blocks-Story link); ⚠ tier surfaced here для human-in-
// the-loop review; ✗ tier dropped silently с Theme A audit trail.
// ════════════════════════════════════════════════════════════════

function DependencyReviewQueue({ queue }) {
  if (!queue || queue.length === 0) return null;

  return (
    <div className="mt-4">
      <h3
        className="text-sm font-semibold mb-2"
        style={{ color: "var(--s2j-text)" }}
      >
        Dependency review queue
        <span
          className="ml-2 text-xs font-normal"
          style={{ color: "var(--s2j-text-light)" }}
        >
          ({queue.length} cross-feature ordering edge
          {queue.length === 1 ? "" : "s"} flagged for review)
        </span>
      </h3>
      <p
        className="text-xs mb-2"
        style={{ color: "var(--s2j-text-light)" }}
      >
        Phase 3.8 v3 inferred these workflow ordering candidates, but the
        defense layer's evidence quality was thin (⚠ tier). Review before
        next push; ✓ auto-approved edges are already in feature.dependencies
        + JIRA Story-blocks-Story links.
      </p>
      <div
        className="rounded-md p-3"
        style={{
          background: "var(--s2j-orange-bg)",
          border: "1px solid var(--s2j-orange-border)",
        }}
      >
        <ul
          className="space-y-2"
          style={{ listStyle: "none", margin: 0, padding: 0 }}
        >
          {queue.map((edge, i) => (
            <li
              key={i}
              className="text-xs leading-snug pb-2"
              style={{
                color: "var(--s2j-text)",
                borderBottom:
                  i < queue.length - 1
                    ? "1px dashed var(--s2j-orange-border)"
                    : "none",
              }}
            >
              <div className="font-medium">
                <span style={{ color: "var(--s2j-orange)" }}>
                  {edge.confidence}
                </span>{" "}
                <span>{edge.sourceFeature}</span>
                <span
                  className="mx-1.5"
                  style={{ color: "var(--s2j-text-light)" }}
                >
                  is blocked by
                </span>
                <span>{edge.target}</span>
              </div>
              {edge.sourceCapability && (
                <div
                  className="text-[10px] mt-0.5"
                  style={{ color: "var(--s2j-text-light)" }}
                >
                  source: {edge.sourceCapability}
                </div>
              )}
              {edge.reason && (
                <div
                  className="text-[11px] mt-1 italic"
                  style={{ color: "var(--s2j-text-light)" }}
                >
                  Defense reason: {edge.reason}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// CapabilityCouplingOverview — cap-level aggregate view derived от
// feature.dependency_metadata (NEW 2026-05-12 part 62 follow-up axis).
//
// Surfaces Epic-level coupling strength as derived view: counts how many
// features в each source capability block features в other capabilities.
// Per architectural decision NOT к infer cap-level deps directly (would
// be redundant с feature-level transitively); instead derive aggregate
// view от feature-level data + render с visual strength indicator.
//
// Strength tiers (educated-guess thresholds, Tier 2 calibration candidate):
//   strong   ≥50% of source features depend → likely Epic-level ordering
//   moderate 25-49% → partial Epic-level dependency
//   light    <25%   → minor coupling (few features bridge caps)
//
// Visual: strength bar (60px wide, 6px tall) + percentage badge + tier
// label. Palette: green-dark (strong) / orange (moderate) / text-light
// (light). Matches existing Dashboard component aesthetic (CapabilitySummary
// Table neutral background; ActiveDependenciesOverview green-bg accent).
//
// Backward compat: legacy breakdowns без feature.dependency_metadata →
// empty couplingMap → empty array → component returns null → Dashboard
// renders unchanged.
// ════════════════════════════════════════════════════════════════

function _couplingTierColors(tier) {
  switch (tier) {
    case "strong":
      return {
        fg: "var(--s2j-green-dark)",
        bar: "var(--s2j-green)",
      };
    case "moderate":
      return {
        fg: "var(--s2j-orange)",
        bar: "var(--s2j-orange)",
      };
    case "light":
    default:
      return {
        fg: "var(--s2j-text-light)",
        bar: "var(--s2j-text-muted)",
      };
  }
}

function CapabilityCouplingOverview({ groups }) {
  if (!groups || groups.length === 0) return null;

  const totalCouplings = groups.reduce((sum, g) => sum + g.blocks.length, 0);

  return (
    <div className="mt-4">
      <h3
        className="text-sm font-semibold mb-2"
        style={{ color: "var(--s2j-text)" }}
      >
        Capability coupling overview
        <span
          className="ml-2 text-xs font-normal"
          style={{ color: "var(--s2j-text-light)" }}
        >
          ({totalCouplings} cross-capability coupling
          {totalCouplings === 1 ? "" : "s"} derived от feature dependencies)
        </span>
      </h3>
      <p
        className="text-xs mb-2"
        style={{ color: "var(--s2j-text-light)" }}
      >
        Aggregated Epic-level view: counts features в each source capability
        that block features в other capabilities. Strong (≥50%) suggests
        Epic-level ordering; moderate (25-49%) partial dependency; light
        (&lt;25%) minor coupling.
      </p>
      <div
        className="rounded-md p-3"
        style={{
          background: "var(--s2j-bg-section)",
          border: "1px solid var(--s2j-border)",
        }}
      >
        <ul
          className="space-y-3"
          style={{ listStyle: "none", margin: 0, padding: 0 }}
        >
          {groups.map((group, gIdx) => {
            const isLast = gIdx === groups.length - 1;
            return (
              <li
                key={group.sourceCapName}
                style={{
                  paddingBottom: isLast ? "0" : "10px",
                  borderBottom: isLast
                    ? "none"
                    : "1px dashed var(--s2j-border)",
                }}
              >
                <div
                  className="text-xs font-medium mb-2"
                  style={{ color: "var(--s2j-text)" }}
                >
                  {group.sourceCapName}
                  <span
                    className="ml-1.5 text-[10px] font-normal"
                    style={{ color: "var(--s2j-text-muted)" }}
                  >
                    ({group.totalFeatures} feature
                    {group.totalFeatures === 1 ? "" : "s"})
                  </span>
                </div>
                <ul
                  className="space-y-1.5 ml-2"
                  style={{ listStyle: "none", padding: 0 }}
                >
                  {group.blocks.map((block, bIdx) => {
                    const tierColors = _couplingTierColors(block.tier);
                    const pct = Math.round(block.strength * 100);
                    const pctText = `${pct}%`;
                    return (
                      <li
                        key={bIdx}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span
                          style={{
                            color: "var(--s2j-text-muted)",
                            fontSize: "10px",
                            minWidth: "55px",
                          }}
                        >
                          blocked by
                        </span>
                        <span
                          style={{
                            color: tierColors.fg,
                            flex: "1 1 auto",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={`${block.count} of ${group.totalFeatures} features depend on ${block.targetCapName}`}
                        >
                          {block.targetCapName}
                        </span>
                        <span
                          className="font-mono"
                          style={{
                            color: "var(--s2j-text-muted)",
                            fontSize: "10px",
                            minWidth: "44px",
                            textAlign: "right",
                          }}
                        >
                          {block.count}/{group.totalFeatures}
                        </span>
                        <span
                          aria-hidden="true"
                          style={{
                            display: "inline-block",
                            width: "60px",
                            height: "6px",
                            background: "var(--s2j-bg)",
                            border: "1px solid var(--s2j-border)",
                            borderRadius: "3px",
                            overflow: "hidden",
                          }}
                        >
                          <span
                            style={{
                              display: "block",
                              width: pctText,
                              height: "100%",
                              background: tierColors.bar,
                            }}
                          />
                        </span>
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wider"
                          style={{
                            color: tierColors.fg,
                            minWidth: "60px",
                            textAlign: "right",
                          }}
                        >
                          {block.tier}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// ActiveDependenciesOverview — Phase 3.8 v3 ✓ tier cap-grouped overview
// (Round 5 axis 2026-05-11 part 57+).
//
// Surfaces the auto-approved cross-feature workflow ordering edges (✓
// tier — already active в JIRA Story-blocks-Story links + per-feature
// "Depends on" subsection in FeatureCard). This component IS the high-
// level cross-cap visual partner asked for когато per-feature view
// alone made the dependency landscape hard to scan на 12-cap CLM-scale
// breakdowns.
//
// Design (Option C ratified at 87% confidence per design memory
// `forge-ui-dashboard-dependency-overview-axis-2026-05-11.md`):
//   - Section header с total edge count
//   - Per-source-cap collapsible row с outbound count badge
//   - Cap-collapsed by default — partner clicks ▶ to expand single cap
//     OR multiple caps (independent useState bits per cap)
//   - Expanded: source feature → "✓ → target" + italic reason
//   - Palette: --s2j-green-bg/dark/border (mirror FeatureCard ✓ marker)
//
// Backward compat: legacy breakdowns без feature.dependency_metadata →
// activeDependencies = [] → component returns null → Dashboard renders
// unchanged. ZERO backend changes (D7.B preserved per CG-12 axis).
// ════════════════════════════════════════════════════════════════

function ActiveDependenciesOverview({ groups }) {
  // Per-cap expansion state — object map; cap-collapsed by default
  // (entries default к undefined → falsy → collapsed). Multiple caps
  // expandable simultaneously (independent state per cap).
  const [expandedCaps, setExpandedCaps] = useState({});

  if (!groups || groups.length === 0) return null;

  const totalEdges = groups.reduce((sum, g) => sum + g.edges.length, 0);

  const toggleCap = (capName) => {
    setExpandedCaps((prev) => ({ ...prev, [capName]: !prev[capName] }));
  };

  return (
    <div className="mt-4">
      <h3
        className="text-sm font-semibold mb-2"
        style={{ color: "var(--s2j-text)" }}
      >
        Active dependencies
        <span
          className="ml-2 text-xs font-normal"
          style={{ color: "var(--s2j-text-light)" }}
        >
          ({totalEdges} cross-feature ordering edge
          {totalEdges === 1 ? "" : "s"} auto-approved)
        </span>
      </h3>
      <p
        className="text-xs mb-2"
        style={{ color: "var(--s2j-text-light)" }}
      >
        Phase 3.8 v3 inferred these workflow ordering edges with high-quality
        defense evidence (✓ tier). Active in JIRA Story-blocks-Story links;
        click a capability to inspect its outbound edges.
      </p>
      <div
        className="rounded-md p-3"
        style={{
          background: "var(--s2j-green-bg)",
          border: "1px solid var(--s2j-green-border)",
        }}
      >
        <ul
          className="space-y-1"
          style={{ listStyle: "none", margin: 0, padding: 0 }}
        >
          {groups.map((group, gIdx) => {
            const isExpanded = !!expandedCaps[group.capName];
            const isLast = gIdx === groups.length - 1;
            return (
              <li
                key={group.capName}
                style={{
                  paddingBottom: isLast ? 0 : "4px",
                  borderBottom:
                    isLast || isExpanded
                      ? "none"
                      : "1px dashed var(--s2j-green-border)",
                }}
              >
                {/* Cap-row toggle button — accessible (button role +
                    keyboard activation by default for <button>; aria-
                    expanded surfaces collapse state to assistive tech). */}
                <button
                  type="button"
                  onClick={() => toggleCap(group.capName)}
                  aria-expanded={isExpanded}
                  className="flex items-center gap-2 w-full text-left text-xs font-medium py-1"
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--s2j-text)",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "var(--s2j-green-bg)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span
                    aria-hidden="true"
                    style={{
                      color: "var(--s2j-green-dark)",
                      fontSize: "10px",
                      width: "10px",
                      flexShrink: 0,
                    }}
                  >
                    {isExpanded ? "▼" : "▶"}
                  </span>
                  <span
                    style={{ color: "var(--s2j-green-dark)" }}
                    className="flex-1"
                  >
                    {group.capName}
                  </span>
                  <span
                    className="text-[10px] font-normal"
                    style={{ color: "var(--s2j-text-light)" }}
                  >
                    {group.edges.length} outbound
                  </span>
                </button>
                {isExpanded && (
                  <ul
                    className="mt-1 mb-2 ml-5 space-y-1.5"
                    style={{ listStyle: "none", padding: 0 }}
                  >
                    {group.edges.map((edge, eIdx) => {
                      const isLastEdge = eIdx === group.edges.length - 1;
                      return (
                        <li
                          key={eIdx}
                          className="text-xs leading-snug pb-1.5"
                          style={{
                            color: "var(--s2j-text)",
                            borderBottom: isLastEdge
                              ? "none"
                              : "1px dashed var(--s2j-green-border)",
                          }}
                        >
                          <div style={{ color: "var(--s2j-text-light)" }}>
                            {edge.sourceFeature}
                          </div>
                          <div className="mt-0.5 flex items-start gap-1.5">
                            <span
                              style={{
                                color: "var(--s2j-green)",
                                flexShrink: 0,
                              }}
                            >
                              {edge.confidence} →
                            </span>
                            <span style={{ color: "var(--s2j-text)" }}>
                              {edge.target}
                            </span>
                          </div>
                          {edge.reason && (
                            <div
                              className="text-[11px] mt-0.5 italic"
                              style={{
                                color: "var(--s2j-text-light)",
                                marginLeft: "20px",
                              }}
                            >
                              {edge.reason}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// CapabilitySummaryTable — D4.B sortable
// ════════════════════════════════════════════════════════════════

const TABLE_COLS = [
  { key: "name", label: "Capability", numeric: false, defaultDir: "asc" },
  { key: "featureCount", label: "Stories", numeric: true, defaultDir: "desc" },
  { key: "featureAcCount", label: "Feat ACs", numeric: true, defaultDir: "desc" },
  { key: "capAcCount", label: "Cap ACs", numeric: true, defaultDir: "desc" },
  { key: "capDodCount", label: "DoD", numeric: true, defaultDir: "desc" },
  { key: "taskCount", label: "Tasks", numeric: true, defaultDir: "desc" },
  { key: "autoApprove", label: "✓", numeric: true, defaultDir: "desc" },
  { key: "review", label: "⚠", numeric: true, defaultDir: "desc" },
  { key: "manualEdit", label: "✗", numeric: true, defaultDir: "desc" },
];

function CapabilitySummaryTable({ rows }) {
  // Default sort — feature count desc (largest cap surfaces first;
  // managers reading top-down see meatiest caps first).
  const [sortKey, setSortKey] = useState("featureCount");
  const [sortDir, setSortDir] = useState("desc");

  const sortedRows = useMemo(() => {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const col = TABLE_COLS.find((c) => c.key === sortKey);
    const numeric = col?.numeric ?? true;
    const dirSign = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (numeric) {
        return ((av || 0) - (bv || 0)) * dirSign;
      }
      // String comparison — locale-aware, case-insensitive
      const as = String(av || "").toLowerCase();
      const bs = String(bv || "").toLowerCase();
      if (as < bs) return -1 * dirSign;
      if (as > bs) return 1 * dirSign;
      return 0;
    });
  }, [rows, sortKey, sortDir]);

  const handleSort = (col) => {
    if (sortKey === col.key) {
      // Toggle direction
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir(col.defaultDir);
    }
  };

  if (!rows || rows.length === 0) {
    return (
      <div
        className="rounded-lg p-3 text-xs"
        style={{
          background: "var(--s2j-bg-section)",
          border: "1px solid var(--s2j-border)",
          color: "var(--s2j-text-muted)",
        }}
      >
        No capabilities in this breakdown.
      </div>
    );
  }

  return (
    <div className="mb-4">
      <p
        className="text-[11px] font-medium uppercase tracking-wider mb-2"
        style={{ color: "var(--s2j-text-muted)" }}
      >
        Capabilities ({rows.length})
      </p>
      <div
        className="rounded-lg overflow-hidden"
        style={{
          background: "var(--s2j-bg-section)",
          border: "1px solid var(--s2j-border)",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "12px",
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--s2j-border)",
                  background: "var(--s2j-bg)",
                }}
              >
                {TABLE_COLS.map((col) => {
                  const active = sortKey === col.key;
                  const arrow = active ? (sortDir === "asc" ? "▲" : "▼") : "";
                  // M-3 self-review fix 2026-05-09 — WCAG 2.1 AA keyboard
                  // navigation. tabIndex={0} makes TH focusable via Tab;
                  // onKeyDown handles Enter/Space activation (mirror onClick);
                  // aria-sort surfaces sort state to assistive technology
                  // (screen readers announce "ascending/descending sort").
                  // role="button" reinforces clickable semantics (TH default
                  // role is "columnheader" — adding "button" не replaces;
                  // AT announces both).
                  const ariaSort = active
                    ? sortDir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none";
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      role="button"
                      tabIndex={0}
                      aria-sort={ariaSort}
                      style={{
                        textAlign: col.numeric ? "right" : "left",
                        padding: "6px 8px",
                        fontWeight: 600,
                        color: active
                          ? "var(--s2j-text)"
                          : "var(--s2j-text-light)",
                        cursor: "pointer",
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                      onClick={() => handleSort(col)}
                      onKeyDown={(e) => {
                        // Enter + Space activate sort. preventDefault on
                        // Space avoids page-scroll (default browser behavior
                        // когато focus е on a non-form-control element).
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleSort(col);
                        }
                      }}
                    >
                      {col.label}
                      {arrow ? (
                        <span
                          style={{
                            marginLeft: "4px",
                            fontSize: "9px",
                            color: "var(--s2j-blue)",
                          }}
                          aria-hidden="true"
                        >
                          {arrow}
                        </span>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => (
                // M-2 self-review fix 2026-05-09 — row.name as stable
                // key (was idx, anti-pattern when list sorts: same idx
                // gets different content → reconciler may stamp wrong
                // DOM). Capability names are unique within a breakdown
                // by Phase 2.5 dedup invariant; в edge case на duplicate
                // names, React warns but rendering still works.
                <tr
                  key={row.name}
                  style={{
                    borderBottom:
                      idx === sortedRows.length - 1
                        ? "none"
                        : "1px solid var(--s2j-border)",
                  }}
                >
                  {TABLE_COLS.map((col) => {
                    const v = row[col.key];
                    const isName = col.key === "name";
                    return (
                      <td
                        key={col.key}
                        style={{
                          padding: "6px 8px",
                          textAlign: col.numeric ? "right" : "left",
                          color: "var(--s2j-text)",
                          fontFamily: col.numeric
                            ? "var(--s2j-mono, monospace)"
                            : "inherit",
                          maxWidth: isName ? "240px" : undefined,
                          overflow: isName ? "hidden" : undefined,
                          textOverflow: isName ? "ellipsis" : undefined,
                          whiteSpace: isName ? "nowrap" : undefined,
                        }}
                        title={isName ? String(v) : undefined}
                      >
                        {isName ? v : v || 0}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// DashboardEmptyState — D9.A
// ════════════════════════════════════════════════════════════════

function DashboardEmptyState({ sourcePage, onBack }) {
  return (
    <div className="p-6" style={SCREEN_MAX_WIDTH_STYLE}>
      <BackButton onClick={onBack} />
      <h2
        className="text-lg font-semibold mt-3 mb-1"
        style={{ color: "var(--s2j-text)" }}
      >
        Dashboard
      </h2>
      <p
        className="text-sm mb-4"
        style={{ color: "var(--s2j-text-light)" }}
      >
        {sourcePage?.title || "(unknown page)"}
      </p>
      <div
        className="rounded-lg p-5"
        style={{
          background: "var(--s2j-blue-bg)",
          border: "1px solid var(--s2j-blue-border)",
        }}
      >
        <p
          className="text-sm font-medium mb-2"
          style={{ color: "var(--s2j-text)" }}
        >
          No results yet
        </p>
        {/* Empty-state copy explains the three possible causes —
            page never processed / TTL expired (>8h since completion) /
            backend restart wiped in-memory job_store.
            Architectural reality: dashboard reads from in-memory
            job_store (8h TTL post 2026-05-09 part 25 fix); phase_cache
            on disk persists across restarts but NOT yet wired to
            dashboard surface (separate axis: "Dashboard reads
            phase_cache fallback" — gated by GDPR review). Honest
            framing avoids "cache exists, why no dashboard?" mental-
            model divergence; user gets clear next-step (re-run Generate). */}
        <p
          className="text-xs mb-2"
          style={{ color: "var(--s2j-text-light)" }}
        >
          This dashboard reads from recently-completed jobs (8h retention
          window). Possible reasons no results are showing:
        </p>
        <ul
          className="text-xs mb-3 ml-4 space-y-1"
          style={{
            color: "var(--s2j-text-light)",
            listStyle: "disc",
          }}
        >
          <li>This page has never been processed — run Generate first</li>
          <li>Previous run finished more than 8 hours ago (retention window expired)</li>
          <li>Backend restarted since last run (in-memory state cleared)</li>
          <li>Last run was a Preview only — Dashboard requires a full Generate run</li>
        </ul>
        <p
          className="text-xs mb-3"
          style={{ color: "var(--s2j-text-light)" }}
        >
          Re-running Generate from the page picker repopulates the dashboard.
          Phase-level computation cache on disk persists across restarts, so
          re-runs typically complete in seconds when nothing has changed.
        </p>
        <button onClick={onBack} className="btn-secondary">
          ← Back to picker
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Local helpers (Spinner)
// ════════════════════════════════════════════════════════════════
// BackButton extracted to shared `./BackButton` component (U2 part 33,
// 2026-05-09) — was previously а local impl с blue-underline style;
// now visually harmonized с App.js's muted-hover pattern across all
// screens.
//
// Spinner shape mirrors App.js's inline Spinner — SHOULD stay в
// visual sync. Future axis: extract to shared component if a third
// consumer surfaces (YAGNI for MVP).

function DashboardSpinner({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      style={{ animation: "spin 0.8s linear infinite" }}
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="var(--s2j-border)"
        strokeWidth="2.5"
      />
      <path
        d="M14.5 8a6.5 6.5 0 00-6.5-6.5"
        stroke="var(--s2j-green)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Defensive @keyframes registration — App.js's Spinner already
          registers the same keyframe on app boot, but если future
          refactor skips the "loading" gate, this ensures animation
          works on fresh-mount of DashboardSpinner. Idempotent (re-
          registering same keyframe is a no-op in CSSOM). */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

export default DashboardScreen;
