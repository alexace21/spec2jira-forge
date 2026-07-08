import { useState, useMemo, useRef, useEffect } from 'react';
import EditableField from './EditableField.jsx';
import TaskCard from './TaskCard.jsx';
import LabelsEditor from './LabelsEditor.jsx';
import { SignalCallout } from '../Signal';
import { IconX, IconLink, IconUndo, IconPlus, IconCheck } from '../Icon';
import { glassSurface, MOOD } from '../moodboard';
import {
  wouldCreateCycle,
  acIsSharedFor,
  isPlaceholderName,
  newStoryUid,
} from '../../lib/v3Schema';
import { confidenceToken, complexityToken, StatusDot } from './signalTokens.jsx';

const SP_OPTIONS = [1, 2, 3, 5, 8, 13];
const PRIORITY_OPTIONS = ['High', 'Medium', 'Low'];

/**
 * FocusedStory — the CENTER pane of the 6A three-pane editor: ONE story, always-open + fully
 * editable, at mockup fidelity. The AI-flagged concern cards MOVED OUT of this body into the RIGHT
 * ConcernRail (owned by the orchestrator); this pane keeps the story fields, the sizing controls,
 * the acceptance criteria (native + locked shared-AC rows), the DEPENDS-ON section (see / trim /
 * restore / add with a cycle guard), and the sub-tasks. Flows in the page (NO internal scroll).
 *
 * Props (per the shared 6A contract — note: NO onSetConcern; the rail owns disposition):
 *   feature       — the focused feature object (from breakdown.capabilities[].features)
 *   categoryName  — its category (read-only context)
 *   breakdown     — the whole working breakdown (for shared-AC markers, deps)
 *   allFeatures   — [{ uid, name, origName, category }] for the dependency picker (current names)
 *   onUpdateFeature(patch)                       — shallow field patch on this feature
 *   onAddDependency(sourceName, targetOrigName)  — sourceName = the CURRENT feature name
 *   onTrimDependency(sourceName, targetOrig)     — durable trim (removes edge + records on the feature)
 *   onRestoreDependency(sourceName, targetOrig)  — durable restore (re-adds edge + clears the record)
 */
export default function FocusedStory({
  feature,
  categoryName,
  breakdown,
  allFeatures,
  onUpdateFeature,
  onAddDependency,
  onTrimDependency,
  onRestoreDependency,
}) {
  const rootRef = useRef(null);

  // ── sizing signals ──
  const complexity = feature.complexity_score;
  const priority = feature.priority;
  const storyPoints = feature.story_points;
  const conf = confidenceToken(feature.confidence_indicator, feature.confidence_score ?? feature.confidence);
  const cxTok = complexityToken(complexity);
  const sourceHeading = (feature.source_heading || feature._source_heading || '').trim();
  const placeholder = isPlaceholderName(feature.name);

  // Left-accent by confidence (green is reserved for commit): a low-confidence story reads red,
  // a warning amber, a confident one the calm trust tone, and unrated/none a neutral hairline.
  const borderAccent =
    feature.confidence_indicator === '✗' ? 'var(--s2j-red)'
      : feature.confidence_indicator === '⚠' ? 'var(--s2j-orange)'
        : feature.confidence_indicator === '✓' ? 'var(--s2j-trust)'
          : 'var(--s2j-border)';

  // SP segmented options — include an out-of-set legacy value so it stays visible + selectable.
  const spOptions =
    typeof storyPoints === 'number' && !SP_OPTIONS.includes(storyPoints)
      ? [...SP_OPTIONS, storyPoints].sort((a, b) => a - b)
      : SP_OPTIONS;

  // On focus change, reset the scroll/focus to the top of the detail so a jumped-to story reads from
  // its title (best-effort; the whole page scrolls). Keyed on _uid so it fires per story.
  useEffect(() => {
    if (rootRef.current && typeof rootRef.current.scrollIntoView === 'function') {
      try { rootRef.current.scrollIntoView({ block: 'nearest' }); } catch (_) {}
    }
  }, [feature._uid]);

  // ── field mutators (shallow patch; the orchestrator lifts it into the breakdown by uid) ──
  const updateField = (field, value) => onUpdateFeature({ [field]: value });

  const updateTask = (taskIndex, updatedTask) => {
    const newTasks = [...(feature.tasks || [])];
    newTasks[taskIndex] = updatedTask;
    onUpdateFeature({ tasks: newTasks });
  };
  const deleteTask = (taskIndex) => {
    if ((feature.tasks || []).length <= 1) return;
    onUpdateFeature({ tasks: (feature.tasks || []).filter((_, i) => i !== taskIndex) });
  };
  const addTask = () => {
    onUpdateFeature({ tasks: [...(feature.tasks || []), { _uid: newStoryUid(), type: 'API', summary: 'New task', description: '' }] });
  };

  const updateAC = (newAC) => onUpdateFeature({ acceptance_criteria: newAC });
  const addAC = () => onUpdateFeature({ acceptance_criteria: [...(feature.acceptance_criteria || []), 'New acceptance criterion'] });
  const deleteAC = (i) => {
    if ((feature.acceptance_criteria || []).length <= 1) return;
    onUpdateFeature({ acceptance_criteria: (feature.acceptance_criteria || []).filter((_, idx) => idx !== i) });
  };

  const taskCount = (feature.tasks || []).length;
  const acFloor = (feature.acceptance_criteria || []).length <= 1;
  const taskFloor = (feature.tasks || []).length <= 1;

  return (
    <div ref={rootRef} id="s2j-focused-story" className="rounded-lg" style={{ ...glassSurface('minor'), borderLeft: `4px solid ${borderAccent}`, padding: 16 }}>
      {/* ── STORY TITLE: small category context + label, then the name in large bold ── */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="rounded px-1.5 py-0.5 text-[10px] font-mono shrink-0"
            style={{ background: 'var(--s2j-green-bg)', color: 'var(--s2j-green-dark)' }}>
            Story
          </span>
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--s2j-text-muted)' }}>
            {categoryName}
          </span>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wider block mb-0.5" style={{ color: 'var(--s2j-text-muted)' }}>
          Story title
        </span>
        <div className="text-lg font-bold leading-snug" style={{ color: MOOD.navy }}>
          <EditableField value={feature.name} onChange={(v) => updateField('name', v)}
            className="text-lg font-bold" />
        </div>
      </div>

      {/* Placeholder-name flag — never let "New Feature" push verbatim. */}
      {placeholder && (
        <div className="mb-3">
          <SignalCallout kind="warning" fontSize={12}
            title="This story still has a placeholder name — rename it before you push." />
        </div>
      )}

      {/* ── Sizing row: STORY POINTS (segmented Fibonacci) · COMPLEXITY (read-only dots) · PRIORITY (segmented) ── */}
      <div className="flex flex-wrap gap-x-6 gap-y-3 mb-4">
        {/* Story points — segmented Fibonacci selector (replaces the dropdown). */}
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--s2j-text-muted)' }}>
            Story points · Fibonacci
          </span>
          <div role="group" aria-label="Story points" className="inline-flex flex-wrap gap-1">
            {spOptions.map((v) => {
              const active = storyPoints === v;
              return (
                <button key={v} type="button" onClick={() => updateField('story_points', v)}
                  aria-pressed={active}
                  className="rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors min-w-[26px]"
                  style={{
                    border: active ? '1px solid var(--s2j-blue)' : '1px solid var(--s2j-border)',
                    background: active ? 'var(--s2j-blue-bg)' : 'var(--s2j-bg)',
                    color: active ? 'var(--s2j-blue-dark)' : 'var(--s2j-text-light)',
                    cursor: 'pointer',
                  }}>
                  {v}
                </button>
              );
            })}
          </div>
        </div>

        {/* Complexity — filled dots (n/5), READ-ONLY (the AI's inherent-difficulty read). */}
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--s2j-text-muted)' }}>
            Complexity
          </span>
          {typeof complexity === 'number' ? (
            <div className="inline-flex items-center gap-1" title={`Complexity ${complexity}/5 (AI read, read-only)`}
              role="img" aria-label={`Complexity ${complexity} out of 5`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} aria-hidden="true" style={{
                  display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
                  background: n <= complexity ? (cxTok ? cxTok.fg : 'var(--s2j-text-light)') : 'transparent',
                  border: `1px solid ${n <= complexity ? (cxTok ? cxTok.fg : 'var(--s2j-text-light)') : 'var(--s2j-border)'}`,
                }} />
              ))}
              <span className="text-[10px] font-mono ml-1" style={{ color: 'var(--s2j-text-muted)' }}>{complexity}/5</span>
            </div>
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--s2j-text-muted)' }}>—</span>
          )}
        </div>

        {/* Priority — High / Med / Low segmented toggle. */}
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--s2j-text-muted)' }}>
            Priority
          </span>
          <div role="group" aria-label="Priority" className="inline-flex gap-1">
            {PRIORITY_OPTIONS.map((p) => {
              const active = (priority || 'Medium') === p;
              return (
                <button key={p} type="button" onClick={() => updateField('priority', p)}
                  aria-pressed={active}
                  className="rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors"
                  style={{
                    border: active ? '1px solid var(--s2j-blue)' : '1px solid var(--s2j-border)',
                    background: active ? 'var(--s2j-blue-bg)' : 'var(--s2j-bg)',
                    color: active ? 'var(--s2j-blue-dark)' : 'var(--s2j-text-light)',
                    cursor: 'pointer',
                  }}>
                  {p === 'Medium' ? 'Med' : p}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── AI source note (read-only context) — the confidence explainer lives in the rail now ── */}
      {sourceHeading && (
        <div className="flex items-start gap-1.5 mb-3 text-[11px]">
          <span className="font-medium uppercase tracking-wider shrink-0" style={{ color: 'var(--s2j-text-muted)' }}>Source</span>
          <span className="leading-relaxed" style={{ color: 'var(--s2j-text-light)' }}>{sourceHeading}</span>
        </div>
      )}

      {/* ── Labels ── */}
      <div className="mb-4">
        <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block" style={{ color: 'var(--s2j-text-muted)' }}>Labels</label>
        <LabelsEditor labels={feature.labels || []} onChange={(v) => updateField('labels', v)} />
      </div>

      {/* ── Description (outlined box) ── */}
      <div className="mb-4">
        <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block" style={{ color: 'var(--s2j-text-muted)' }}>Description</label>
        <div className="rounded-lg px-2.5 py-2" style={{ border: '1px solid var(--s2j-border)', background: 'var(--s2j-bg)' }}>
          <EditableField value={feature.description || ''} onChange={(v) => updateField('description', v)}
            multiline placeholder="Click to add a description…" className="text-xs leading-relaxed" style={{ color: 'var(--s2j-text-light)' }} />
        </div>
      </div>

      {/* ── User story (outlined box) ── */}
      <div className="mb-4">
        <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block" style={{ color: 'var(--s2j-text-muted)' }}>User Story</label>
        <div className="rounded-lg px-2.5 py-2" style={{ border: '1px solid var(--s2j-border)', background: 'var(--s2j-bg)' }}>
          <EditableField value={feature.user_story} onChange={(v) => updateField('user_story', v)}
            multiline placeholder="Click to add a user story…" className="text-xs leading-relaxed italic" style={{ color: 'var(--s2j-text-light)' }} />
        </div>
      </div>

      {/* ── Acceptance criteria (outlined rows w/ checkmark; assigned-shared = LOCKED row) ── */}
      <div id="s2j-focused-ac" role="group" aria-label="Acceptance criteria" className="space-y-1.5 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--s2j-text-muted)' }}>Acceptance Criteria</span>
          <button onClick={addAC} className="text-[11px] inline-flex items-center gap-1 transition-colors" style={{ color: 'var(--s2j-blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <IconPlus size={12} /> Add criterion
          </button>
        </div>
        {(feature.acceptance_criteria || []).map((ac, i) => {
          const sharedItem = sharedItemFor(ac, breakdown);
          if (sharedItem) {
            // LOCKED shared-AC row — a lock icon + provenance; non-editable (managed in the Shared-AC panel).
            return (
              <div key={i} className="flex items-start gap-2 rounded-lg px-2.5 py-2"
                style={{ border: '1px solid var(--s2j-info-border)', background: 'var(--s2j-info-bg)' }}>
                <span className="inline-flex items-center shrink-0 mt-0.5" style={{ color: 'var(--s2j-info)' }} aria-hidden="true">
                  <LockGlyph size={13} />
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-[9px] font-semibold uppercase tracking-wider block mb-0.5" style={{ color: 'var(--s2j-text-muted)' }}>
                    {sharedItem.id} · Shared · from the document — manage in the Shared-AC panel
                  </span>
                  <span className="text-xs leading-relaxed" style={{ color: 'var(--s2j-text)' }}>{sharedItem.text}</span>
                </div>
              </div>
            );
          }
          return (
            <div key={i} className="group/ac flex items-start gap-2 rounded-lg px-2.5 py-1.5"
              style={{ border: '1px solid var(--s2j-border)', background: 'var(--s2j-bg)' }}>
              <span className="inline-flex items-center shrink-0 mt-0.5" style={{ color: 'var(--s2j-trust)' }} aria-hidden="true">
                <IconCheck size={13} />
              </span>
              <div className="flex-1 min-w-0">
                <EditableField value={ac} multiline className="text-xs leading-relaxed"
                  style={{ color: 'var(--s2j-text-light)' }}
                  onChange={(newVal) => {
                    const updated = [...(feature.acceptance_criteria || [])];
                    updated[i] = newVal;
                    updateAC(updated);
                  }} />
              </div>
              {/* Delete: shown but DISABLED at the 1-item floor (not a silent no-op). */}
              <button
                onClick={() => deleteAC(i)}
                disabled={acFloor}
                className="mt-0.5 opacity-0 group-hover/ac:opacity-100 transition-all text-xs px-1"
                style={{ color: acFloor ? 'var(--s2j-text-muted)' : 'var(--s2j-red)', background: 'none', border: 'none', cursor: acFloor ? 'not-allowed' : 'pointer' }}
                title={acFloor ? 'A story needs at least one acceptance criterion' : 'Delete this acceptance criterion'}
              >
                <IconX size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Depends on (see / trim / restore / add + cycle guard) ── */}
      <DependsOnSection
        feature={feature}
        breakdown={breakdown}
        allFeatures={allFeatures}
        onAddDependency={onAddDependency}
        onTrimDependency={onTrimDependency}
        onRestoreDependency={onRestoreDependency}
      />

      {/* ── Sub-tasks ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--s2j-text-muted)' }}>Sub-tasks ({taskCount})</span>
          <button onClick={addTask} className="text-[11px] inline-flex items-center gap-1 transition-colors" style={{ color: 'var(--s2j-blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <IconPlus size={12} /> Add sub-task
          </button>
        </div>
        {(feature.tasks || []).map((task, tIdx) => (
          <TaskCard key={task._uid || tIdx} task={task} index={tIdx}
            onUpdate={(updated) => updateTask(tIdx, updated)}
            onDelete={() => deleteTask(tIdx)}
            deleteDisabled={taskFloor} />
        ))}
      </div>
    </div>
  );
}

// ── sharedItemFor: return the shared-AC item this AC string is the INJECTED form of (prefix-exact
//    "id: text" via the contract helper acIsSharedFor), or null. Returning the ITEM (not a boolean)
//    lets the locked row render the id + the clean text without the "id: " prefix. ──
function sharedItemFor(acString, breakdown) {
  const items = breakdown?.shared_acceptance_criteria?.items || [];
  return items.find((item) => acIsSharedFor(acString, item)) || null;
}

// A small padlock glyph for the locked shared-AC row. Inline SVG, inherits currentColor.
function LockGlyph({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }} aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// ════════════════════════════════════════════════════════════
// DependsOnSection — see / trim / restore / add (with a cycle guard)
// ════════════════════════════════════════════════════════════
function DependsOnSection({ feature, breakdown, allFeatures, onAddDependency, onTrimDependency, onRestoreDependency }) {
  const [adding, setAdding] = useState(false);
  const [pickerVal, setPickerVal] = useState('');
  const [cycleWarn, setCycleWarn] = useState(null);

  // Current dependency strings on this feature (frozen dep names = the mutation keys). Memoized so a
  // fresh [] fallback each render doesn't churn the useMemo hooks below (react-hooks/exhaustive-deps).
  const deps = useMemo(
    () => (Array.isArray(feature.dependencies) ? feature.dependencies : []),
    [feature.dependencies]
  );

  // Trimmed-but-restorable targets — DURABLE on the feature (survives a story switch / remount),
  // mirroring the shared-AC removed_by_user pattern. Only show entries that are NOT currently active deps.
  const removedTargets = useMemo(() => {
    const rm = Array.isArray(feature._removed_dependencies) ? feature._removed_dependencies : [];
    const active = new Set(deps);
    return rm.filter((t) => !active.has(t));
  }, [feature._removed_dependencies, deps]);

  // Map a frozen dep string -> the depended-on feature's CURRENT name for display (rename-resolved).
  const origToCurrent = useMemo(() => {
    const m = new Map();
    for (const f of allFeatures) {
      if (f.origName != null && !m.has(f.origName)) m.set(f.origName, f.name);
    }
    return m;
  }, [allFeatures]);

  const thisOrigName = feature._orig_name || feature.name;

  // Candidates for "+ dependency": every OTHER feature not already a dependency and not this one.
  const candidates = useMemo(() => {
    const already = new Set(deps);
    return allFeatures.filter(
      (f) => (f.origName || f.name) !== thisOrigName && !already.has(f.origName || f.name)
    );
  }, [allFeatures, deps, thisOrigName]);

  // NOTE: the SOURCE arg to add/trim/restore is the CURRENT feature.name (the mutation helpers
  // match by f.name === sourceFeatureName, so a stale _orig_name would silently no-op after a
  // rename). The TARGET arg stays the frozen _orig_name (the edge key).
  function handleRemove(target) {
    onTrimDependency(feature.name, target);
  }
  function handleRestore(target) {
    onRestoreDependency(feature.name, target);
  }
  function handleAdd() {
    setCycleWarn(null);
    const targetOrig = pickerVal;
    if (!targetOrig) return;
    if (wouldCreateCycle(breakdown, thisOrigName, targetOrig)) {
      const disp = origToCurrent.get(targetOrig) || targetOrig;
      setCycleWarn(`That would create a loop: "${disp}" already leads back to this story, so they can't both wait on each other. Pick a different one.`);
      return;
    }
    onAddDependency(feature.name, targetOrig);
    setPickerVal('');
    setAdding(false);
  }

  return (
    <div className="space-y-1.5 mb-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider inline-flex items-center gap-1.5" style={{ color: 'var(--s2j-text-muted)' }}>
          <IconLink size={12} /> Depends on
        </span>
        {!adding && candidates.length > 0 && (
          <button onClick={() => { setAdding(true); setCycleWarn(null); }}
            className="text-[11px] inline-flex items-center gap-1 transition-colors" style={{ color: 'var(--s2j-blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <IconPlus size={12} /> dependency
          </button>
        )}
      </div>

      {deps.length === 0 && removedTargets.length === 0 && !adding && (
        <p className="text-[11px] italic" style={{ color: 'var(--s2j-text-muted)' }}>
          No dependencies — this story is not waiting on any other.
        </p>
      )}

      {/* Active dependency chips (rename-resolved display; frozen string is the remove key). */}
      {deps.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {deps.map((target) => (
            <span key={target}
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]"
              style={{ background: 'var(--s2j-bg-section)', border: '1px solid var(--s2j-border)', color: 'var(--s2j-text)' }}>
              <StatusDot color="var(--s2j-info)" size={6} />
              {origToCurrent.get(target) || target}
              <button onClick={() => handleRemove(target)}
                title="Remove this dependency (restorable below)"
                style={{ color: 'var(--s2j-text-muted)', lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--s2j-red)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--s2j-text-muted)'; }}>
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Trimmed (restorable) — DURABLE across a story switch (feature._removed_dependencies). */}
      {removedTargets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {removedTargets.map((target) => (
            <span key={target}
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]"
              style={{ background: 'var(--s2j-bg-section)', border: '1px dashed var(--s2j-border)', color: 'var(--s2j-text-muted)', textDecoration: 'line-through' }}>
              {origToCurrent.get(target) || target}
              <button onClick={() => handleRestore(target)}
                title="Restore this dependency"
                style={{ color: 'var(--s2j-blue)', lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'none' }}>
                <IconUndo size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Add picker (blocks a cycle with a friendly, non-technical message). */}
      {adding && (
        <div className="rounded-lg p-2 space-y-2" style={{ background: 'var(--s2j-bg-section)', border: '1px solid var(--s2j-border)' }}>
          <div className="flex items-center gap-2">
            <select value={pickerVal} onChange={(e) => { setPickerVal(e.target.value); setCycleWarn(null); }}
              aria-label="Choose a story this one waits on"
              className="flex-1 text-[11px] rounded px-2 py-1 s2j-field"
              style={{ background: 'var(--s2j-bg)', color: 'var(--s2j-text)', border: '1px solid var(--s2j-border)' }}>
              <option value="">Choose a story this one waits on…</option>
              {candidates.map((f) => (
                <option key={f.origName || f.name} value={f.origName || f.name}>{f.name}</option>
              ))}
            </select>
            <button onClick={handleAdd} disabled={!pickerVal}
              className="text-[11px] font-medium"
              style={{ background: 'none', border: 'none', color: pickerVal ? 'var(--s2j-blue)' : 'var(--s2j-text-muted)', cursor: pickerVal ? 'pointer' : 'not-allowed', padding: '2px 4px' }}>
              Add
            </button>
            <button onClick={() => { setAdding(false); setPickerVal(''); setCycleWarn(null); }}
              className="text-[11px]"
              style={{ background: 'none', border: 'none', color: 'var(--s2j-text-muted)', cursor: 'pointer', padding: '2px 4px' }}>
              Cancel
            </button>
          </div>
          {cycleWarn && (
            <SignalCallout kind="warning" fontSize={11}><span>{cycleWarn}</span></SignalCallout>
          )}
        </div>
      )}
    </div>
  );
}
