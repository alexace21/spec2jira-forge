import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  computeReviewReadiness,
  setConcernDisposition,
  addFeatureDependency,
  removeFeatureDependency,
  sharedAcInjected,
  acIsSharedFor,
  findFeatureByUid,
  newStoryUid,
} from '../../lib/v3Schema';
import EpicEditView from './EpicEditView.jsx';
import SharedACView from './SharedACView.jsx';
import ReviewReadinessBar from './ReviewReadinessBar.jsx';
import ComplianceLandmine from './ComplianceLandmine.jsx';
import Worklist, { buildWorklistGroups } from './Worklist.jsx';
import FocusedStory from './FocusedStory.jsx';
import ConcernRail from './ConcernRail.jsx';
import Wizard from './Wizard.jsx';
import { glassSurface } from '../moodboard';

/**
 * BreakdownEditor — the 6A THREE-PANE review-and-sign-off WORKBENCH.
 *
 * The BA's job is to FIND AND FIX the ~10-20% the AI got wrong, not re-author every card. So the editor
 * leads with a review-readiness read + a pinned compliance landmine (span the width), then a THREE-PANE
 * body: a LEFT "BREAKDOWN" worklist (2 pinned entries — Epic + Shared-AC — above a flag-sorted story list),
 * a CENTER pane switched by the left selection (story / shared-AC / epic), and a RIGHT concern rail. The
 * worklist + rail are `position: sticky` and the center FLOWS — everything is one page-scroll (NO 100vh, NO
 * internal-scroll trap; a prior vh collapsed the editor to ~0 live). Wizards are FIXED-position overlays.
 *
 * The breakdown is the SINGLE immutable object: field edits, concern dispositions (editor-only, never
 * pushed), and dependency edits all ride it, and it is mirrored up via breakdownRef so "Back to AI insights"
 * lifts unsaved edits across the key="screen-reviewing" remount.
 */
export default function BreakdownEditor({ initialBreakdown, onPush, isPushing = false, breakdownRef, defaultProjectKey = null }) {
  const [breakdown, setBreakdown] = useState(() => JSON.parse(JSON.stringify(initialBreakdown)));

  // ── 6A selection + wizard state ──
  //   mode: which entry drives the center ('story' | 'shared' | 'epic')
  //   selectedUid: the focused story's _uid (only meaningful when mode==='story')
  //   wizard: null | { kind:'assign', sacId } | { kind:'newstory' }
  const [mode, setMode] = useState('story');
  const [selectedUid, setSelectedUid] = useState(null);
  const [wizard, setWizard] = useState(null);

  useEffect(() => {
    setBreakdown(JSON.parse(JSON.stringify(initialBreakdown)));
  }, [initialBreakdown]);

  // Mirror the current working copy up to App via the ref (2026-06-26) so "Back to AI insights" lifts
  // these unsaved edits to pendingBreakdown before the remount. A ref-write, not state (no re-render).
  useEffect(() => {
    if (breakdownRef) breakdownRef.current = breakdown;
  }, [breakdown, breakdownRef]);

  // ── readiness rollup (top bar + worklist badges + landmine) ──
  const readiness = useMemo(() => computeReviewReadiness(breakdown), [breakdown]);

  // openByUid: uid -> {openCount, totalCount, reviewed} for the worklist row badges.
  const openByUid = useMemo(() => {
    const m = new Map();
    for (const pf of readiness.perFeature || []) m.set(pf.uid, { openCount: pf.openCount, totalCount: pf.totalCount, reviewed: pf.reviewed });
    return m;
  }, [readiness]);

  const worklistGroups = useMemo(
    () => buildWorklistGroups(breakdown.capabilities || [], openByUid),
    [breakdown.capabilities, openByUid]
  );

  // Default focus: the highest-weight story that needs review (readiness.perFeature is weight-sorted
  // desc), else the first story. Re-anchor if the selected story was deleted.
  useEffect(() => {
    const allUids = (breakdown.capabilities || []).flatMap((c) => (c.features || []).map((f) => f._uid));
    if (selectedUid && allUids.includes(selectedUid)) return;
    const firstFlagged = (readiness.perFeature || []).find(
      (pf) => pf.openCount > 0 || pf.indicator === '✗' || pf.indicator === '⚠'
    );
    const fallback = (readiness.perFeature && readiness.perFeature[0]) || null;
    setSelectedUid((firstFlagged && firstFlagged.uid) || (fallback && fallback.uid) || allUids[0] || null);
  }, [breakdown.capabilities, readiness.perFeature, selectedUid]);

  // When the selection changes (esp. via the ComplianceLandmine "jump to story"), scroll the matching
  // sticky worklist row into view so the focused story is visible in the left pane (best-effort).
  useEffect(() => {
    if (mode === 'story' && selectedUid) {
      const el = document.querySelector('[data-worklist-uid="' + selectedUid + '"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedUid, mode]);

  const focusedFeature = useMemo(
    () => (selectedUid ? findFeatureByUid(breakdown, selectedUid) : null),
    [breakdown, selectedUid]
  );

  // Category of the focused feature (for read-only context in the detail).
  const focusedCategory = useMemo(() => {
    if (!selectedUid) return '';
    for (const cap of breakdown.capabilities || []) {
      if ((cap.features || []).some((f) => f._uid === selectedUid)) return cap.name;
    }
    return '';
  }, [breakdown.capabilities, selectedUid]);

  // ── item tally (for the push bar copy) ──
  const totalItems = useMemo(() => {
    const caps = breakdown.capabilities || [];
    const features = caps.flatMap((c) => c.features || []);
    const tasks = features.flatMap((f) => f.tasks || []);
    return caps.length + features.length + tasks.length;
  }, [breakdown]);

  // ── Epic stats tiles (read-only): stories / sub-tasks / acceptance criteria / target project ──
  const epicStats = useMemo(() => {
    const caps = breakdown.capabilities || [];
    const features = caps.flatMap((c) => c.features || []);
    const subtasks = features.reduce((n, f) => n + (f.tasks || []).length, 0);
    const acs = features.reduce((n, f) => n + (f.acceptance_criteria || []).length, 0);
    const project =
      breakdown.project_key || breakdown.projectKey || (breakdown.epic && breakdown.epic.project_key) || defaultProjectKey || null;
    return { stories: features.length, subtasks, acs, project };
  }, [breakdown, defaultProjectKey]);

  // ── all-features list for the dependency picker + shared-AC assign (current name + frozen orig + uid) ──
  const allFeatures = useMemo(() => {
    const r = [];
    for (const cap of breakdown.capabilities || []) {
      for (const f of cap.features || []) {
        r.push({ uid: f._uid, name: f.name, origName: f._orig_name || f.name, category: cap.name });
      }
    }
    return r;
  }, [breakdown.capabilities]);

  // ── unallocated shared-AC count (the Worklist pinned-entry badge) ──
  const unallocatedSharedAC = useMemo(() => {
    const items = breakdown.shared_acceptance_criteria?.items || [];
    return items.filter((i) => !i.removed_by_user && !i.assigned_feature).length;
  }, [breakdown.shared_acceptance_criteria]);

  // ════════════════════════════════════════════════════════════
  // SELECTION handlers (drive the center pane)
  // ════════════════════════════════════════════════════════════
  const selectStory = useCallback((uid) => { setSelectedUid(uid); setMode('story'); }, []);
  const selectEpic = useCallback(() => setMode('epic'), []);
  const selectShared = useCallback(() => setMode('shared'), []);

  // ════════════════════════════════════════════════════════════
  // MUTATORS
  // ════════════════════════════════════════════════════════════

  // Epic
  const updateEpic = useCallback((field, value) => {
    setBreakdown((p) => ({ ...p, epic: { ...p.epic, [field]: value } }));
  }, []);

  // Update a single feature (by uid) with a shallow field patch. Immutable: rebuild the containing
  // capability + features array so React sees a new reference and every derived read re-runs.
  const updateFeatureByUid = useCallback((uid, patch) => {
    setBreakdown((p) => ({
      ...p,
      capabilities: (p.capabilities || []).map((cap) => {
        if (!(cap.features || []).some((f) => f._uid === uid)) return cap;
        return {
          ...cap,
          features: cap.features.map((f) => (f._uid === uid ? { ...f, ...patch } : f)),
        };
      }),
    }));
  }, []);

  // Concern disposition — editor-side only, NEVER pushed. setConcernDisposition returns a NEW breakdown.
  const setConcern = useCallback((concernId, state, reason) => {
    setBreakdown((p) => setConcernDisposition(p, concernId, state, reason));
  }, []);

  // Reset — revert the working copy to the pristine initialBreakdown (fresh deep clone).
  const resetBreakdown = useCallback(() => {
    const clean = JSON.parse(JSON.stringify(initialBreakdown));
    delete clean._concern_dispositions;
    for (const cap of clean.capabilities || []) {
      for (const f of cap.features || []) { if (f) delete f._removed_dependencies; }
    }
    setBreakdown(clean);
  }, [initialBreakdown]);

  // Dependency add / remove — apply the immutable helpers (they rebuild every shape the push reads).
  // sourceName MUST be the CURRENT feature name (mapFeatureDependencies matches by f.name).
  const addDependency = useCallback((sourceName, targetName) => {
    setBreakdown((p) => addFeatureDependency(p, sourceName, targetName));
  }, []);

  // Durable trimmed-dependency restore (survives a story switch / FocusedStory remount): the trimmed
  // target's frozen _orig_name is recorded on the feature as the editor-only `_removed_dependencies`
  // array. ⚠ Editor-only: never sent to Jira.
  const trimDependency = useCallback((uid, sourceName, targetOrig) => {
    setBreakdown((p) => {
      let next = removeFeatureDependency(p, sourceName, targetOrig);
      next = {
        ...next,
        capabilities: (next.capabilities || []).map((cap) => {
          if (!(cap.features || []).some((f) => f._uid === uid)) return cap;
          return {
            ...cap,
            features: cap.features.map((f) => {
              if (f._uid !== uid) return f;
              const prev = Array.isArray(f._removed_dependencies) ? f._removed_dependencies : [];
              return prev.includes(targetOrig) ? f : { ...f, _removed_dependencies: [...prev, targetOrig] };
            }),
          };
        }),
      };
      return next;
    });
  }, []);

  const restoreDependency = useCallback((uid, sourceName, targetOrig) => {
    setBreakdown((p) => {
      let next = addFeatureDependency(p, sourceName, targetOrig);
      next = {
        ...next,
        capabilities: (next.capabilities || []).map((cap) => {
          if (!(cap.features || []).some((f) => f._uid === uid)) return cap;
          return {
            ...cap,
            features: cap.features.map((f) => {
              if (f._uid !== uid) return f;
              const prev = Array.isArray(f._removed_dependencies) ? f._removed_dependencies : [];
              if (!prev.includes(targetOrig)) return f;
              return { ...f, _removed_dependencies: prev.filter((t) => t !== targetOrig) };
            }),
          };
        }),
      };
      return next;
    });
  }, []);

  // ── Shared-AC assign / unassign / remove / restore (bind by _uid; inject/remove prefix-exact) ──
  const assignSharedAC = useCallback((sacId, uid) => {
    setBreakdown((p) => {
      const u = JSON.parse(JSON.stringify(p));
      const item = u.shared_acceptance_criteria?.items?.find((i) => i.id === sacId);
      if (!item) return p;
      // Guard: bail unchanged if the target story no longer exists (a stale uid would otherwise
      // set assigned_feature but inject no AC — an orphaned assignment).
      if (!findFeatureByUid(u, uid)) return p;
      if (item.assigned_feature) _removeInjectedAC(u, item.assigned_feature, item);
      item.assigned_feature = uid;
      _addInjectedAC(u, uid, item);
      return u;
    });
  }, []);

  const unassignSharedAC = useCallback((sacId) => {
    setBreakdown((p) => {
      const u = JSON.parse(JSON.stringify(p));
      const item = u.shared_acceptance_criteria?.items?.find((i) => i.id === sacId);
      if (!item?.assigned_feature) return p;
      _removeInjectedAC(u, item.assigned_feature, item);
      item.assigned_feature = null;
      return u;
    });
  }, []);

  const removeSharedACItem = useCallback((sacId) => {
    setBreakdown((p) => {
      const u = JSON.parse(JSON.stringify(p));
      const item = u.shared_acceptance_criteria?.items?.find((i) => i.id === sacId);
      if (!item) return p;
      if (item.assigned_feature) {
        _removeInjectedAC(u, item.assigned_feature, item);
        item.assigned_feature = null;
      }
      item.removed_by_user = true;
      return u;
    });
  }, []);

  const restoreSharedACItem = useCallback((sacId) => {
    setBreakdown((p) => {
      const u = JSON.parse(JSON.stringify(p));
      const item = u.shared_acceptance_criteria?.items?.find((i) => i.id === sacId);
      if (!item) return p;
      delete item.removed_by_user;
      return u;
    });
  }, []);

  const jumpToFeature = useCallback((uid) => selectStory(uid), [selectStory]);

  // ── Add a new placeholder story into a target category (the newstory wizard passes it). Mints
  //    _uid + _orig_name via newStoryUid so the dep-name->uid binding invariant holds. Focuses it. ──
  const addStory = useCallback((category, name, storyPoints) => {
    const uid = newStoryUid();
    // A user-typed name is used verbatim; a blank one falls back to a UNIQUE placeholder (two unrenamed
    // additions must NOT share a name/_orig_name, or the dep-name->uid binding goes ambiguous). The
    // "New Feature" prefix keeps isPlaceholderName catching a blank-named add until it's renamed.
    const trimmed = String(name || '').trim();
    const finalName = trimmed || `New Feature ${uid.slice(2, 6)}`;
    const sp = typeof storyPoints === 'number' ? storyPoints : 3;
    const newFeature = {
      _uid: uid,
      _orig_name: finalName,
      name: finalName,
      user_story: 'As a user, I want [goal], so that [benefit].',
      description: '',
      acceptance_criteria: ['Acceptance criterion'],
      priority: 'Medium',
      story_points: sp,
      complexity_score: 3,
      labels: [],
      dependencies: [],
      concerns: [],
      tasks: [{ _uid: newStoryUid(), type: 'API', summary: 'New task', description: '' }],
    };
    setBreakdown((p) => {
      const caps = p.capabilities || [];
      if (caps.length === 0) {
        newFeature.category = category || 'Uncategorised';
        return { ...p, capabilities: [{ name: newFeature.category, features: [newFeature] }] };
      }
      // Target the requested category, else the category holding the current selection, else the first.
      let targetIdx = -1;
      if (category) targetIdx = caps.findIndex((c) => c.name === category);
      if (targetIdx < 0 && selectedUid) {
        targetIdx = caps.findIndex((c) => (c.features || []).some((f) => f._uid === selectedUid));
      }
      if (targetIdx < 0) targetIdx = 0;
      newFeature.category = caps[targetIdx].name;
      return {
        ...p,
        capabilities: caps.map((cap, i) =>
          i === targetIdx ? { ...cap, features: [...(cap.features || []), newFeature] } : cap
        ),
      };
    });
    setSelectedUid(uid);
    setMode('story');
  }, [selectedUid]);

  // ── Wizard open/close/submit ──
  const openAssignWizard = useCallback((sacId) => setWizard({ kind: 'assign', sacId }), []);
  const openNewStoryWizard = useCallback(() => setWizard({ kind: 'newstory' }), []);
  const closeWizard = useCallback(() => setWizard(null), []);

  const submitWizard = useCallback((payload) => {
    setWizard((w) => {
      if (!w) return null;
      if (w.kind === 'assign' && payload && payload.uid) {
        assignSharedAC(w.sacId, payload.uid);
      } else if (w.kind === 'newstory' && payload) {
        addStory(payload.category, payload.name, payload.storyPoints);
      }
      return null;
    });
  }, [assignSharedAC, addStory]);

  // Default category for the newstory wizard = the current selection's category.
  const defaultNewStoryCategory = focusedCategory || '';

  const epicTitle = breakdown.epic?.summary || 'Your breakdown';

  return (
    <div className="px-4 py-4 space-y-4" style={{ background: 'transparent' }}>
      {/* ── Top: review readiness (spans width) ── */}
      <ReviewReadinessBar
        readiness={readiness}
        epicTitle={epicTitle}
        itemCount={totalItems}
        breakdown={breakdown}
        onPush={() => onPush(breakdown)}
        onReset={resetBreakdown}
        isPushing={isPushing}
      />

      {/* ── Pinned compliance landmine (always visually first among content; red, informational) ── */}
      {readiness.landmine && (
        <ComplianceLandmine landmine={readiness.landmine} onJumpToFeature={jumpToFeature} />
      )}

      {/* ── THREE-PANE body: worklist (left, sticky) · center (mode-switched) · concern rail (right, sticky).
          s2j-editor-3pane (index.css) is a 3-col grid that drops the rail below center under 1080px and
          stacks fully under 900px. Page-scroll only — no column is an overflow container. ── */}
      <div className="s2j-editor-3pane">
        {/* LEFT */}
        <Worklist
          groups={worklistGroups}
          mode={mode}
          selectedUid={selectedUid}
          unallocatedCount={unallocatedSharedAC}
          onSelectStory={selectStory}
          onSelectEpic={breakdown.epic ? selectEpic : null}
          onSelectShared={selectShared}
          onNewStory={openNewStoryWizard}
        />

        {/* CENTER — mode-switched */}
        <div style={{ minWidth: 0 }}>
          {mode === 'epic' && breakdown.epic ? (
            <EpicEditView epic={breakdown.epic} onUpdate={updateEpic} stats={epicStats} />
          ) : mode === 'shared' ? (
            <SharedACView
              sharedAC={breakdown.shared_acceptance_criteria}
              availableFeatures={allFeatures}
              onAssign={openAssignWizard}
              onUnassign={unassignSharedAC}
              onRemove={removeSharedACItem}
              onRestore={restoreSharedACItem}
            />
          ) : focusedFeature ? (
            <FocusedStory
              // key on _uid so the detail REMOUNTS per story — no DependsOn "removed this session" state
              // leaks across a story switch. The whole breakdown object still carries edits/disposition.
              key={selectedUid}
              feature={focusedFeature}
              categoryName={focusedCategory}
              breakdown={breakdown}
              allFeatures={allFeatures}
              onUpdateFeature={(patch) => updateFeatureByUid(selectedUid, patch)}
              onAddDependency={addDependency}
              onTrimDependency={(sourceName, targetOrig) => trimDependency(selectedUid, sourceName, targetOrig)}
              onRestoreDependency={(sourceName, targetOrig) => restoreDependency(selectedUid, sourceName, targetOrig)}
            />
          ) : (
            <div className="rounded-lg" style={{ ...glassSurface('minor'), padding: 24, textAlign: 'center' }}>
              <p className="text-sm" style={{ color: 'var(--s2j-text-muted)' }}>
                Select a story on the left to review it.
              </p>
            </div>
          )}
        </div>

        {/* RIGHT — concern rail (sticky). s2j-rail-col lets the grid drop it under center on narrow widths. */}
        <div className="s2j-rail-col s2j-rail-sticky" style={{ '--s2j-rail-top': '8px', alignSelf: 'flex-start' }}>
          <ConcernRail
            feature={mode === 'story' ? focusedFeature : null}
            breakdown={breakdown}
            onSetConcern={setConcern}
            mode={mode}
          />
        </div>
      </div>

      {/* ── Wizard overlay (assign shared-AC / new story) — fixed modal; does NOT displace the editor. ── */}
      {wizard && (
        <Wizard
          kind={wizard.kind}
          breakdown={breakdown}
          allFeatures={allFeatures}
          sacId={wizard.sacId}
          defaultCategory={defaultNewStoryCategory}
          onClose={closeWizard}
          onSubmit={submitWizard}
        />
      )}
    </div>
  );
}

// ── prefix-exact injected-AC helpers (bind the shared AC to a story by _uid) ──
function _addInjectedAC(bd, uid, item) {
  const f = findFeatureByUid(bd, uid);
  if (!f) return;
  if (!Array.isArray(f.acceptance_criteria)) f.acceptance_criteria = [];
  if (!f.acceptance_criteria.some((ac) => acIsSharedFor(ac, item))) {
    f.acceptance_criteria.push(sharedAcInjected(item));
  }
}

function _removeInjectedAC(bd, uid, item) {
  const f = findFeatureByUid(bd, uid);
  if (!f || !Array.isArray(f.acceptance_criteria)) return;
  f.acceptance_criteria = f.acceptance_criteria.filter((ac) => !acIsSharedFor(ac, item));
}
