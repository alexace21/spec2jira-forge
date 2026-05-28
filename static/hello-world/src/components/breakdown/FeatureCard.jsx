import { useState } from 'react';
import EditableField from './EditableField.jsx';
import TaskCard from './TaskCard.jsx';

/**
 * FeatureCard — Editor for a single Feature (→ JIRA Story).
 * Light theme (Swagger palette).
 *
 * CG-2 confidence + CG-4 source_heading inline rendering (Layer 2 Trust
 * UX integration, 2026-05-07): when the breakdown carries CG-2 confidence
 * fields (per-Story trust score 0-100 + indicator ✓/⚠/✗ + concern reasons)
 * or CG-4 source_heading (provenance), this card surfaces them inline:
 *   - Collapsed header: confidence badge (indicator + score) с palette-
 *     mapped color cluster + native browser tooltip listing concerns.
 *   - Expanded: "Source:" line + "Confidence concerns:" bullet list under
 *     a dashed separator before the editable fields.
 *
 * Backward compat: legacy breakdowns без these fields render exactly как
 * before — guarded by `hasConfidence` + truthy `sourceHeading` checks.
 * Reads BOTH `feature.source_heading` (public, post output_adapter CG-4)
 * AND `feature._source_heading` (pipeline-internal fallback) for defense-
 * in-depth.
 */

// Maps CG-2 indicator symbol → palette token cluster. Returns null if the
// indicator isn't one of the documented three; that null short-circuits
// badge rendering (defensive against schema drift).
function _confidenceVisuals(indicator) {
  if (indicator === '✓') return {
    fg: 'var(--s2j-green-dark)',
    bg: 'var(--s2j-green-bg)',
    border: 'var(--s2j-green-border)',
  };
  if (indicator === '⚠') return {
    fg: 'var(--s2j-orange)',
    bg: 'var(--s2j-orange-bg)',
    border: 'var(--s2j-orange-border)',
  };
  if (indicator === '✗') return {
    fg: 'var(--s2j-red)',
    bg: 'var(--s2j-red-bg)',
    border: 'var(--s2j-red-border)',
  };
  return null;
}

export default function FeatureCard({ feature, index, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false);

  const taskCount = feature.tasks?.length || 0;
  const totalSP = (feature.tasks || []).reduce(
    (sum, t) => sum + (t.estimate_story_points || 0), 0
  );

  // ── CG-2 confidence + CG-4 source_heading extraction ──
  // All three fields are optional; legacy breakdowns без them render
  // unchanged. `hasConfidence` requires BOTH a numeric score AND a
  // valid indicator (defensive against partial-stamp scenarios).
  const confidence = feature.confidence;
  const confidenceIndicator = feature.confidence_indicator;
  const confidenceConcerns = feature.confidence_reasons || [];
  const confidenceVisuals = _confidenceVisuals(confidenceIndicator);
  const hasConfidence =
    confidence != null && confidenceIndicator && confidenceVisuals;
  const sourceHeading = (
    feature.source_heading || feature._source_heading || ''
  ).trim();

  // ── Phase 3.8 v3 dep-tracking extraction (Round 5 axis 2026-05-10) ──
  // dependency_metadata stamped by _apply_v3_edges_to_breakdown ✓ tier
  // (active feature.dependencies + parallel structured metadata). ⚠ tier
  // edges live в feature.dependency_review_queue surfaced separately в
  // Dashboard's DependencyReviewQueue component; this card surfaces only
  // ✓ tier (auto-applied JIRA Story-blocks-Story link provenance).
  // Legacy breakdowns без the field render unchanged (empty array shape
  // skips the rendering block entirely).
  const dependencyMetadata = feature.dependency_metadata || [];

  function updateField(field, value) { onUpdate({ ...feature, [field]: value }); }

  function updateTask(taskIndex, updatedTask) {
    const newTasks = [...feature.tasks];
    newTasks[taskIndex] = updatedTask;
    onUpdate({ ...feature, tasks: newTasks });
  }

  function deleteTask(taskIndex) {
    if (feature.tasks.length <= 1) return;
    onUpdate({ ...feature, tasks: feature.tasks.filter((_, i) => i !== taskIndex) });
  }

  function addTask() {
    const newTask = {
      type: 'API', summary: 'New task', description: 'Describe the unit of work.',
      estimate_story_points: 3, dependencies: [], priority: 'MEDIUM',
    };
    onUpdate({ ...feature, tasks: [...feature.tasks, newTask] });
    if (!expanded) setExpanded(true);
  }

  function updateAC(newAC) { onUpdate({ ...feature, acceptance_criteria: newAC }); }
  function addAC() { onUpdate({ ...feature, acceptance_criteria: [...(feature.acceptance_criteria || []), 'New acceptance criterion'] }); }
  function deleteAC(acIndex) {
    if ((feature.acceptance_criteria || []).length <= 1) return;
    onUpdate({ ...feature, acceptance_criteria: (feature.acceptance_criteria || []).filter((_, i) => i !== acIndex) });
  }

  return (
    <div className="rounded-lg overflow-hidden" style={{
      border: '1px solid var(--s2j-border)',
      borderLeft: '3px solid var(--s2j-green)',
      background: 'var(--s2j-bg)',
    }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors group"
        onMouseEnter={e => e.currentTarget.style.background = 'var(--s2j-bg-section)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <svg
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          style={{ color: 'var(--s2j-text-muted)' }}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" />
        </svg>

        <span className="flex items-center gap-1.5">
          <span className="rounded px-1.5 py-0.5 text-[10px] font-mono"
            style={{ background: 'var(--s2j-green-bg)', color: 'var(--s2j-green-dark)' }}>
            F-{index + 1}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--s2j-text-muted)' }}>Story</span>
        </span>

        <span className="flex-1 truncate text-sm font-medium" style={{ color: 'var(--s2j-text)' }}>
          {feature.name}
        </span>

        <span className="flex items-center gap-2 text-[11px] shrink-0" style={{ color: 'var(--s2j-text-muted)' }}>
          {/* CG-2 confidence badge — leads the right-side status cluster
              so BA's eye lands here first when scanning a long feature
              list for ⚠/✗ items needing attention. Native title tooltip
              surfaces concerns on hover (no extra UI library). */}
          {hasConfidence && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none"
              title={
                confidenceConcerns.length > 0
                  ? `Concerns: ${confidenceConcerns.join('; ')}`
                  : 'Auto-approve — no concerns flagged'
              }
              style={{
                background: confidenceVisuals.bg,
                color: confidenceVisuals.fg,
                border: `1px solid ${confidenceVisuals.border}`,
              }}
            >
              {confidenceIndicator} {confidence}
            </span>
          )}
          <span>{taskCount} task{taskCount !== 1 ? 's' : ''}</span>
          <span className="rounded px-1.5 py-0.5 font-mono"
            style={{ background: 'var(--s2j-bg-section)', color: 'var(--s2j-text-light)' }}>
            {totalSP} SP
          </span>
        </span>

        <span
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="rounded p-1 transition-all opacity-0 group-hover:opacity-100"
          style={{ color: 'var(--s2j-text-muted)' }}
          onMouseEnter={e => { e.target.style.background = 'var(--s2j-red-bg)'; e.target.style.color = 'var(--s2j-red)'; }}
          onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--s2j-text-muted)'; }}
          title="Delete feature"
          role="button"
        >
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </span>
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="px-3 pb-3 pt-2.5 space-y-3" style={{ borderTop: '1px solid var(--s2j-border)' }}>
          {/* CG-4 source provenance + CG-2 confidence concerns — appears
              ABOVE the editable fields so BA reading-order is:
                1. Where did this Story come from? (provenance)
                2. Why might it need attention? (concerns)
                3. Now edit the fields.
              Renders only when ≥1 of the two has content; legacy
              breakdowns без both fields skip this block entirely. The
              dashed bottom border separates non-editable metadata от
              editable fields below. */}
          {(sourceHeading || (hasConfidence && confidenceConcerns.length > 0) || dependencyMetadata.length > 0) && (
            <div className="space-y-2 pb-2.5"
              style={{ borderBottom: '1px dashed var(--s2j-border)' }}>
              {sourceHeading && (
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider shrink-0 pt-0.5"
                    style={{ color: 'var(--s2j-text-muted)' }}>Source</span>
                  <span className="text-[11px] leading-relaxed"
                    style={{ color: 'var(--s2j-text-light)' }}>{sourceHeading}</span>
                </div>
              )}
              {hasConfidence && confidenceConcerns.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider shrink-0 pt-0.5"
                    style={{ color: 'var(--s2j-text-muted)' }}>Concerns</span>
                  <ul className="flex-1 space-y-0.5"
                    style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {confidenceConcerns.map((reason, i) => (
                      <li key={i} className="text-[11px] leading-relaxed flex items-start gap-1.5"
                        style={{ color: 'var(--s2j-text-light)' }}>
                        <span className="shrink-0 pt-0.5"
                          style={{ color: 'var(--s2j-text-muted)' }}>•</span>
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {dependencyMetadata.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider shrink-0 pt-0.5"
                    style={{ color: 'var(--s2j-text-muted)' }}
                    title="Phase 3.8 v3 cross-feature workflow ordering — ✓ auto-approved (active JIRA Story-blocks-Story link)">
                    Depends on
                  </span>
                  <ul className="flex-1 space-y-0.5"
                    style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {dependencyMetadata.map((dep, i) => (
                      <li key={i} className="text-[11px] leading-relaxed flex items-start gap-1.5"
                        style={{ color: 'var(--s2j-text-light)' }}>
                        <span className="shrink-0 pt-0.5"
                          style={{ color: 'var(--s2j-green)' }}>{dep.confidence || '✓'}</span>
                        <span className="flex-1">
                          <span style={{ color: 'var(--s2j-text)' }}>{dep.target}</span>
                          {dep.reason && (
                            <span className="block text-[10px] italic mt-0.5"
                              style={{ color: 'var(--s2j-text-muted)' }}>{dep.reason}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block"
              style={{ color: 'var(--s2j-text-muted)' }}>Feature Name</label>
            <EditableField value={feature.name} onChange={(val) => updateField('name', val)}
              className="text-sm font-medium" />
          </div>

          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block"
              style={{ color: 'var(--s2j-text-muted)' }}>User Story</label>
            <EditableField value={feature.user_story} onChange={(val) => updateField('user_story', val)}
              multiline className="text-xs leading-relaxed italic" style={{ color: 'var(--s2j-text-light)' }} />
          </div>

          {feature.description && (
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block"
                style={{ color: 'var(--s2j-text-muted)' }}>Description</label>
              <EditableField value={feature.description} onChange={(val) => updateField('description', val)}
                multiline className="text-xs leading-relaxed" style={{ color: 'var(--s2j-text-light)' }} />
            </div>
          )}

          {/* Story Acceptance Criteria */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--s2j-text-muted)' }}>Story Acceptance Criteria</span>
              <button onClick={addAC} className="text-[11px] transition-colors"
                style={{ color: 'var(--s2j-green)' }}>+ Add</button>
            </div>
            {(feature.acceptance_criteria || []).map((ac, i) => (
              <div key={i} className="group/ac flex items-start gap-2">
                <span className="mt-1 text-[10px]" style={{ color: 'var(--s2j-text-muted)' }}>{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <EditableField value={ac} multiline className="text-xs leading-relaxed"
                    style={{ color: 'var(--s2j-text-light)' }}
                    onChange={(newVal) => {
                      const updated = [...(feature.acceptance_criteria || [])];
                      updated[i] = newVal;
                      updateAC(updated);
                    }} />
                </div>
                {(feature.acceptance_criteria || []).length > 1 && (
                  <button onClick={() => deleteAC(i)}
                    className="mt-0.5 opacity-0 group-hover/ac:opacity-100 transition-all text-xs px-1"
                    style={{ color: 'var(--s2j-red)' }}>✕</button>
                )}
              </div>
            ))}
          </div>

          {/* Tasks */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--s2j-text-muted)' }}>Tasks ({taskCount})</span>
              <button onClick={addTask} className="text-[11px] transition-colors"
                style={{ color: 'var(--s2j-green)' }}>+ Add Task</button>
            </div>
            {feature.tasks.map((task, tIdx) => (
              <TaskCard key={task._uid || tIdx} task={task} index={tIdx}
                onUpdate={(updated) => updateTask(tIdx, updated)}
                onDelete={() => deleteTask(tIdx)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
