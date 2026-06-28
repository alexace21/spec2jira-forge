import { useState } from 'react';
import EditableField from './EditableField.jsx';
import TaskCard from './TaskCard.jsx';
import LabelsEditor from './LabelsEditor.jsx';
import { parseConcernPrefix, SEVERITY_PALETTE, CONCERN_TYPE_LABEL } from '../../lib/v3Schema.js';
import { IconX } from '../Icon';
import { glassSurface, MOOD } from '../moodboard';

/**
 * FeatureCard — Editor for a single Feature (→ JIRA Story).
 * Light theme (Swagger palette).
 *
 * CG-2 confidence + CG-4 source_heading inline rendering (Layer 2 Trust
 * UX integration, 2026-05-07): when the breakdown carries CG-2 confidence
 * fields (per-Story trust score 0-100 + indicator ✓/⚠/✗) or CG-4
 * source_heading (provenance), this card surfaces them inline:
 *   - Collapsed header: confidence badge (indicator + score) с palette-
 *     mapped color cluster + native browser tooltip explaining the stance.
 *   - Expanded: "Source:" line under a dashed separator before the
 *     editable fields.
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

// complexity_score 1-5 → color cluster. Low (1-2) green, mid (3) neutral,
// high (4-5) orange — the honest "these cards are not equal" signal.
function _complexityVisuals(score) {
  if (typeof score !== 'number') return null;
  if (score <= 2) return { fg: 'var(--s2j-green-dark)', bg: 'var(--s2j-green-bg)', border: 'var(--s2j-green-border)' };
  if (score === 3) return { fg: 'var(--s2j-text-light)', bg: 'var(--s2j-bg-section)', border: 'var(--s2j-border)' };
  return { fg: 'var(--s2j-orange)', bg: 'var(--s2j-orange-bg)', border: 'var(--s2j-orange-border)' };
}

// priority High/Medium/Low → color cluster.
function _priorityVisuals(priority) {
  const k = String(priority || '').toLowerCase();
  if (k === 'high') return { fg: 'var(--s2j-red)', bg: 'var(--s2j-red-bg)', border: 'var(--s2j-red-border)' };
  if (k === 'medium') return { fg: 'var(--s2j-text-light)', bg: 'var(--s2j-bg-section)', border: 'var(--s2j-border)' };
  if (k === 'low') return { fg: 'var(--s2j-text-muted)', bg: 'var(--s2j-bg-section)', border: 'var(--s2j-border)' };
  return null;
}

// The Story card is a moodboard GLASS surface (the partner chose "Glass" over flat in the 6.5.0 A/B
// review). Its green left-accent + overflow-hidden (the SelectBadge type dropdown is portaled and relies
// on the clip) carry over from the editor's other cards.
export default function FeatureCard({ feature, index, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false);

  const taskCount = feature.tasks?.length || 0;

  // Feature-level sizing signals (v3 — model-suggested, editable below). Replaces
  // the old task story-point sum, which was always 0 in v3 (tasks carry no SP).
  const complexity = feature.complexity_score;
  const priority = feature.priority;
  const storyPoints = feature.story_points;
  const complexityVisuals = _complexityVisuals(complexity);
  const priorityVisuals = _priorityVisuals(priority);

  // Story points are constrained to Fibonacci (story-sized). Include the current
  // value if it falls outside the set (legacy/edge) so it is never silently lost.
  const SP_OPTIONS = [3, 5, 8, 13];
  const spOptions =
    typeof storyPoints === "number" && !SP_OPTIONS.includes(storyPoints)
      ? [...SP_OPTIONS, storyPoints].sort((a, b) => a - b)
      : SP_OPTIONS;

  // ── CG-2 confidence + CG-4 source_heading extraction ──
  // All three fields are optional; legacy breakdowns without them render
  // unchanged. `hasConfidence` requires BOTH a numeric score AND a valid
  // indicator (defensive against partial-stamp scenarios).
  //
  // BUG FIX 2026-05-31: v3 emits `confidence_score` (src/prompts.js rule 9);
  // v2.x used `confidence`. This read `feature.confidence` only, so in v3 it was
  // always undefined -> hasConfidence false -> the per-feature ✓/⚠/✗ badge NEVER
  // rendered, leaving the Review-screen "Manual/Review" counts untraceable to a
  // feature. Read score-first with a legacy fallback.
  const confidence = feature.confidence_score ?? feature.confidence;
  const confidenceIndicator = feature.confidence_indicator;
  const confidenceVisuals = _confidenceVisuals(confidenceIndicator);
  const hasConfidence =
    confidence != null && confidenceIndicator && confidenceVisuals;
  const sourceHeading = (
    feature.source_heading || feature._source_heading || ''
  ).trim();

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
    const newTask = { type: 'API', summary: 'New task', description: '' };
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
    <div className="rounded-lg overflow-hidden" style={{ ...glassSurface('utility'), borderLeft: '3px solid var(--s2j-green)' }}>
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

        <span className="flex-1 truncate text-sm font-semibold" style={{ color: MOOD.navy }}>
          {feature.name}
        </span>

        <span className="flex items-center gap-2 text-[11px] shrink-0" style={{ color: 'var(--s2j-text-muted)' }}>
          {/* CG-2 confidence badge — leads the right-side status cluster
              so BA's eye lands here first when scanning a long feature
              list for ⚠/✗ items needing attention. Native title tooltip
              explains the stance on hover (no extra UI library). */}
          {hasConfidence && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none"
              title={
                confidenceIndicator === '✓'
                  ? 'Confident — clean extraction, little or no guesswork. A quick check is still worth it.'
                  : confidenceIndicator === '⚠'
                    ? 'Unsure — the AI inferred or assumed some details. Review this feature.'
                    : 'Low confidence — the page was vague or contradictory here. Manual review essential.'
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
          {complexityVisuals && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none"
              title={`Complexity ${complexity}/5 — 1 = trivial, 5 = very complex (inherent difficulty/risk, relative to this page)`}
              style={{ background: complexityVisuals.bg, color: complexityVisuals.fg, border: `1px solid ${complexityVisuals.border}` }}
            >
              C{complexity}
            </span>
          )}
          {priorityVisuals && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none"
              title="Suggested delivery priority — adjust in the card"
              style={{ background: priorityVisuals.bg, color: priorityVisuals.fg, border: `1px solid ${priorityVisuals.border}` }}
            >
              {priority}
            </span>
          )}
          <span>{taskCount} task{taskCount !== 1 ? 's' : ''}</span>
          {storyPoints != null && (
            <span className="rounded px-1.5 py-0.5 font-mono"
              title="Suggested story points — a starting estimate for the team to calibrate"
              style={{ background: 'var(--s2j-bg-section)', color: 'var(--s2j-text-light)' }}>
              {storyPoints} SP
            </span>
          )}
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
          {/* CG-4 source provenance — appears ABOVE the editable fields so
              BA reading-order is: where did this Story come from? → now edit
              the fields. Renders only when source_heading has content; legacy
              breakdowns без it skip this block entirely. The dashed bottom
              border separates non-editable metadata от editable fields below. */}
          {sourceHeading && (
            <div className="space-y-2 pb-2.5"
              style={{ borderBottom: '1px dashed var(--s2j-border)' }}>
              <div className="flex items-start gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wider shrink-0 pt-0.5"
                  style={{ color: 'var(--s2j-text-muted)' }}>Source</span>
                <span className="text-[11px] leading-relaxed"
                  style={{ color: 'var(--s2j-text-light)' }}>{sourceHeading}</span>
              </div>
            </div>
          )}
          {/* AI-flagged concerns for THIS feature — the "review in the editor"
              target the Review screen's feature-concern count points to. Read-only,
              verbatim, severity-colored (the per-feature analogue of the spec-level
              concern cards). feature.concerns are "[TYPE|severity] text" strings
              (parseConcernPrefix decodes them). Renders only when the feature has
              concerns; clean features skip it. */}
          {(feature.concerns || []).length > 0 && (
            <div className="space-y-1.5 pb-1">
              <span className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--s2j-text-muted)' }}>
                AI-flagged concerns ({feature.concerns.length})
              </span>
              {feature.concerns.map((raw, i) => {
                const { type, severity, text } = parseConcernPrefix(raw);
                const palette = SEVERITY_PALETTE[severity] || SEVERITY_PALETTE.medium;
                const typeLabel = CONCERN_TYPE_LABEL[type] || type;
                return (
                  <div key={i} className="rounded p-2"
                    style={{ background: palette.bg, border: `1px solid ${palette.border}` }}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
                        style={{ background: palette.text, color: 'white' }}>
                        {severity}
                      </span>
                      <span className="text-[11px] font-semibold" style={{ color: palette.text }}>
                        {typeLabel}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--s2j-text)' }}>{text}</p>
                  </div>
                );
              })}
            </div>
          )}
          {/* Sizing — model-suggested, editable. complexity_score is the model's
              honest INHERENT-difficulty rating (1-5, display-only); priority +
              story points are starting suggestions the team calibrates before push. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-1">
            <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--s2j-text-muted)' }}>
              <span className="font-medium uppercase tracking-wider">Priority</span>
              <select
                value={priority || 'Medium'}
                onChange={(e) => updateField('priority', e.target.value)}
                className="text-xs rounded px-1.5 py-0.5 s2j-field"
                style={{ background: 'var(--s2j-bg)', color: 'var(--s2j-text)', border: '1px solid var(--s2j-border)' }}
              >
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--s2j-text-muted)' }}>
              <span className="font-medium uppercase tracking-wider">Story Points</span>
              <select
                value={storyPoints ?? ''}
                onChange={(e) => updateField('story_points', e.target.value === '' ? null : Number(e.target.value))}
                className="text-xs rounded px-1.5 py-0.5 s2j-field"
                style={{ background: 'var(--s2j-bg)', color: 'var(--s2j-text)', border: '1px solid var(--s2j-border)' }}
              >
                <option value="">—</option>
                {spOptions.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
            <span
              className="text-[11px]"
              style={{ color: 'var(--s2j-text-muted)' }}
              title="Model's inherent-complexity rating. Scale: 1 = trivial · 2 = small · 3 = moderate · 4 = complex · 5 = very complex."
            >
              <span className="font-medium uppercase tracking-wider">Complexity</span>{' '}
              <span style={{ color: 'var(--s2j-text)' }}>{complexity != null ? `${complexity}/5` : '—'}</span>
            </span>
          </div>

          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block"
              style={{ color: 'var(--s2j-text-muted)' }}>Labels</label>
            <LabelsEditor labels={feature.labels || []}
              onChange={(val) => updateField('labels', val)} />
          </div>

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

          {/* Always render so a description-less Story can get one (parity with subtasks). */}
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block"
              style={{ color: 'var(--s2j-text-muted)' }}>Description</label>
            <EditableField value={feature.description || ''} onChange={(val) => updateField('description', val)}
              multiline placeholder="Click to add a description…" className="text-xs leading-relaxed" style={{ color: 'var(--s2j-text-light)' }} />
          </div>

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
                    style={{ color: 'var(--s2j-red)' }}><IconX size={14} /></button>
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
              <TaskCard key={tIdx} task={task} index={tIdx}
                onUpdate={(updated) => updateTask(tIdx, updated)}
                onDelete={() => deleteTask(tIdx)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
