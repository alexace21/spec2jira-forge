import { useState } from 'react';
import FeatureCard from './FeatureCard.jsx';

/**
 * CapabilityCard — Editor for a single Capability (→ JIRA Epic).
 * Light theme (Swagger palette).
 */
export default function CapabilityCard({ capability, index, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(true);

  const featureCount = capability.features?.length || 0;
  const taskCount = (capability.features || []).reduce(
    (sum, f) => sum + (f.tasks?.length || 0), 0
  );
  // Sum the feature-level suggested story points (v3). The old task-SP sum was
  // always 0 — v3 tasks carry no story points (sizing lives on the feature).
  const totalSP = (capability.features || []).reduce(
    (sum, f) => sum + (f.story_points || 0), 0
  );

  // Read-only category profile — at-a-glance effort + risk for PO / SM / manager.
  const feats = capability.features || [];
  const highPriority = feats.filter((f) => String(f.priority || '').toLowerCase() === 'high').length;
  const needsReview = feats.filter((f) => f.confidence_indicator === '⚠' || f.confidence_indicator === '✗').length;
  const cHigh = feats.filter((f) => (f.complexity_score || 0) >= 4).length;
  const cMed = feats.filter((f) => f.complexity_score === 3).length;
  const cLow = feats.filter((f) => (f.complexity_score || 0) >= 1 && (f.complexity_score || 0) <= 2).length;

  function updateFeature(featureIndex, updatedFeature) {
    const newFeatures = [...capability.features];
    newFeatures[featureIndex] = updatedFeature;
    onUpdate({ ...capability, features: newFeatures });
  }

  function deleteFeature(featureIndex) {
    if (capability.features.length <= 1) return;
    const newFeatures = capability.features.filter((_, i) => i !== featureIndex);
    onUpdate({ ...capability, features: newFeatures });
  }

  function addFeature() {
    const newFeature = {
      name: 'New Feature',
      user_story: 'As a user, I want [goal], so that [benefit].',
      acceptance_criteria: ['Acceptance criterion'],
      priority: 'Medium',
      story_points: 3,
      complexity_score: 3,
      tasks: [{ type: 'API', summary: 'New task' }],
    };
    onUpdate({ ...capability, features: [...capability.features, newFeature] });
    if (!expanded) setExpanded(true);
  }

  return (
    <div className="rounded-lg overflow-hidden" style={{
      border: '1px solid var(--s2j-border)',
      borderLeft: '4px solid var(--s2j-blue)',
      background: 'var(--s2j-bg)',
    }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors group"
        onMouseEnter={e => e.currentTarget.style.background = 'var(--s2j-bg-section)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <svg
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          style={{ color: 'var(--s2j-text-muted)' }}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" />
        </svg>

        <span className="flex items-center gap-1.5">
          <span className="rounded px-2 py-0.5 text-xs font-semibold"
            style={{ background: 'var(--s2j-blue-bg)', color: 'var(--s2j-blue)' }}>
            CAP-{index + 1}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--s2j-text-muted)' }}>Category</span>
        </span>

        <span className="flex-1 truncate text-sm font-semibold" style={{ color: 'var(--s2j-text)' }}>
          {capability.name}
        </span>

        <span className="flex items-center gap-3 text-[11px] shrink-0" style={{ color: 'var(--s2j-text-muted)' }}>
          <span>{featureCount} feature{featureCount !== 1 ? 's' : ''}</span>
          <span>{taskCount} task{taskCount !== 1 ? 's' : ''}</span>
          <span className="rounded px-2 py-0.5 font-mono font-medium"
            style={{ background: 'var(--s2j-bg-section)', color: 'var(--s2j-text)' }}>
            {totalSP} SP
          </span>
        </span>

        <span
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="rounded p-1 transition-all opacity-0 group-hover:opacity-100"
          style={{ color: 'var(--s2j-text-muted)' }}
          onMouseEnter={e => { e.target.style.background = 'var(--s2j-red-bg)'; e.target.style.color = 'var(--s2j-red)'; }}
          onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--s2j-text-muted)'; }}
          title="Delete capability"
          role="button"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </span>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-4 pb-4 pt-3 space-y-3" style={{ borderTop: '1px solid var(--s2j-border)' }}>
          {/* Category is a READ-ONLY grouping in v3: the name is the JIRA label
              (derived from each feature's `category`, not editable here), and v3
              has no per-category Epic to push. So instead of editable fields that
              wouldn't reach JIRA (confusing, and the empty description looked
              broken), we surface a useful at-a-glance profile: effort + priority +
              review load + complexity mix. The name is read-only in the header. */}
          <div className="rounded-lg p-3" style={{ background: 'var(--s2j-bg-section)', border: '1px solid var(--s2j-border)' }}>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: 'Features', value: featureCount, accent: false },
                { label: 'Story Points', value: totalSP, accent: false },
                { label: 'High priority', value: highPriority, accent: false },
                { label: 'Need review', value: needsReview, accent: needsReview > 0 },
              ].map((s) => (
                <div key={s.label}>
                  <div className="text-base font-semibold"
                    style={{ color: s.accent ? 'var(--s2j-orange)' : 'var(--s2j-text)' }}>
                    {s.value}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider"
                    style={{ color: 'var(--s2j-text-muted)' }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
            {cHigh + cMed + cLow > 0 && (
              <div className="mt-2 pt-2 flex items-center gap-3 text-[11px]"
                style={{ borderTop: '1px solid var(--s2j-border)', color: 'var(--s2j-text-light)' }}>
                <span className="font-medium uppercase tracking-wider text-[10px]"
                  style={{ color: 'var(--s2j-text-muted)' }}>Complexity</span>
                {cHigh > 0 && <span style={{ color: 'var(--s2j-orange)' }}>{cHigh} high</span>}
                {cMed > 0 && <span>{cMed} medium</span>}
                {cLow > 0 && <span style={{ color: 'var(--s2j-green-dark)' }}>{cLow} low</span>}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--s2j-text-muted)' }}>Features ({featureCount})</span>
              <button onClick={addFeature}
                className="text-[11px] transition-colors"
                style={{ color: 'var(--s2j-green)' }}
                onMouseEnter={e => e.target.style.color = 'var(--s2j-green-dark)'}
                onMouseLeave={e => e.target.style.color = 'var(--s2j-green)'}>
                + Add Feature
              </button>
            </div>
            {capability.features.map((feature, fIdx) => (
              <FeatureCard
                key={feature._uid || fIdx}
                feature={feature}
                index={fIdx}
                onUpdate={(updated) => updateFeature(fIdx, updated)}
                onDelete={() => deleteFeature(fIdx)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
