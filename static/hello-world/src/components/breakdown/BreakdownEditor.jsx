import { useState, useMemo, useEffect } from 'react';
import EditableField from './EditableField.jsx';
import CapabilityCard from './CapabilityCard.jsx';
import SharedACPanel from './SharedACPanel.jsx';
import LabelsEditor from './LabelsEditor.jsx';

export default function BreakdownEditor({ initialBreakdown, onPush, isPushing = false }) {
  const [breakdown, setBreakdown] = useState(() => JSON.parse(JSON.stringify(initialBreakdown)));

  useEffect(() => {
    setBreakdown(JSON.parse(JSON.stringify(initialBreakdown)));
  }, [initialBreakdown]);

  const stats = useMemo(() => {
    const caps = breakdown.capabilities || [];
    const features = caps.flatMap((c) => c.features || []);
    const tasks = features.flatMap((f) => f.tasks || []);
    // Story points live on the feature in v3 (tasks carry none); mirror
    // CapabilityCard's feature-level sum. Tasks are kept only for the count.
    const totalSP = features.reduce((s, f) => s + (f.story_points || 0), 0);
    return {
      capCount: caps.length, featureCount: features.length,
      taskCount: tasks.length, totalSP,
      totalItems: caps.length + features.length + tasks.length,
    };
  }, [breakdown]);

  function updateEpic(f, v) { setBreakdown((p) => ({ ...p, epic: { ...p.epic, [f]: v } })); }
  function updateCapability(i, u) { setBreakdown((p) => { const c = [...p.capabilities]; c[i] = u; return { ...p, capabilities: c }; }); }
  function deleteCapability(i) { if (breakdown.capabilities.length <= 1) return; setBreakdown((p) => ({ ...p, capabilities: p.capabilities.filter((_, idx) => idx !== i) })); }
  function addCapability() {
    setBreakdown((p) => ({ ...p, capabilities: [...p.capabilities, {
      name: 'New Category', features: [{ name: 'New Feature', user_story: 'As a user, I want [goal], so that [benefit].',
        acceptance_criteria: ['Acceptance criterion'], priority: 'Medium', story_points: 3, complexity_score: 3,
        tasks: [{ type: 'API', summary: 'New task' }] }]
    }] }));
  }
  function resetBreakdown() { setBreakdown(JSON.parse(JSON.stringify(initialBreakdown))); }

  // Shared AC
  const availableFeatures = useMemo(() => {
    const r = [];
    (breakdown.capabilities || []).forEach((cap, ci) => {
      (cap.features || []).forEach((f, fi) => { r.push({ capName: cap.name, featName: f.name, capIndex: ci, featIndex: fi }); });
    });
    return r;
  }, [breakdown.capabilities]);

  function assignSharedAC(sacId, featureName) {
    setBreakdown((p) => {
      const u = JSON.parse(JSON.stringify(p));
      const item = u.shared_acceptance_criteria?.items?.find((i) => i.id === sacId);
      if (!item) return p;
      if (item.assigned_feature) _removeACFromFeature(u, item.assigned_feature, item.text);
      item.assigned_feature = featureName;
      _addACToFeature(u, featureName, `${item.id}: ${item.text}`);
      return u;
    });
  }
  function unassignSharedAC(sacId) {
    setBreakdown((p) => {
      const u = JSON.parse(JSON.stringify(p));
      const item = u.shared_acceptance_criteria?.items?.find((i) => i.id === sacId);
      if (!item?.assigned_feature) return p;
      _removeACFromFeature(u, item.assigned_feature, item.text);
      item.assigned_feature = null;
      return u;
    });
  }

  // Soft-delete a shared AC: stamp removed_by_user=true; if it was assigned to a
  // feature, unassign + remove it from that feature.acceptance_criteria (so no
  // ghost AC lingers). The item stays in the breakdown JSON (restorable from the
  // "Removed" subsection) but, being unassigned, is part of no feature and so is
  // never pushed to JIRA. `removed_by_user` is a public field so it survives JSON
  // serialization.
  function removeSharedACItem(sacId) {
    setBreakdown((p) => {
      const u = JSON.parse(JSON.stringify(p));
      const item = u.shared_acceptance_criteria?.items?.find((i) => i.id === sacId);
      if (!item) return p;
      // If assigned, remove from feature.AC + clear assigned_feature so
      // restoration starts clean. (User reassigns после restore if needed.)
      if (item.assigned_feature) {
        _removeACFromFeature(u, item.assigned_feature, item.text);
        item.assigned_feature = null;
      }
      item.removed_by_user = true;
      return u;
    });
  }

  function restoreSharedACItem(sacId) {
    setBreakdown((p) => {
      const u = JSON.parse(JSON.stringify(p));
      const item = u.shared_acceptance_criteria?.items?.find((i) => i.id === sacId);
      if (!item) return p;
      delete item.removed_by_user;
      // Item returns to the regular AC list. assigned_feature was cleared on
      // remove; the user reassigns it if desired.
      return u;
    });
  }

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--s2j-bg)' }}>
      {/* Stats bar */}
      <div className="shrink-0 px-4 py-2.5" style={{
        borderBottom: '1px solid var(--s2j-border)',
        background: 'var(--s2j-bg-section)',
      }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs">
            <StatChip label="Categories"  value={stats.capCount}     color="var(--s2j-blue)" />
            <StatChip label="Stories" value={stats.featureCount} color="var(--s2j-green)" />
            <StatChip label="Tasks"  value={stats.taskCount}    color="var(--s2j-orange)" />
            <StatChip label="Total SP" value={stats.totalSP}    color="var(--s2j-text)" highlight />
            <span className="text-[11px]" style={{ color: 'var(--s2j-text-muted)' }}>
              {stats.totalItems} Jira items
            </span>
          </div>
          <button onClick={resetBreakdown}
            className="rounded px-2 py-1 text-[11px] transition-colors"
            style={{ color: 'var(--s2j-text-muted)' }}
            onMouseEnter={e => { e.target.style.background = 'var(--s2j-border)'; e.target.style.color = 'var(--s2j-text)'; }}
            onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--s2j-text-muted)'; }}>
            Reset
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Epic metadata */}
        {breakdown.epic && (
          <div className="rounded-lg p-4 space-y-3" style={{
            background: 'var(--s2j-bg)',
            border: '1px solid var(--s2j-border)',
            borderLeft: '4px solid var(--s2j-blue)',
          }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                style={{ background: 'var(--s2j-blue-bg)', color: 'var(--s2j-blue)' }}>
                Epic
              </span>
              <span className="text-[10px]" style={{ color: 'var(--s2j-text-muted)' }}>
                Top-level scope
              </span>
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block"
                style={{ color: 'var(--s2j-text-muted)' }}>Summary</label>
              <EditableField value={breakdown.epic.summary}
                onChange={(v) => updateEpic('summary', v)}
                className="text-base font-semibold"
                style={{ color: 'var(--s2j-text)' }} />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block"
                style={{ color: 'var(--s2j-text-muted)' }}>Description</label>
              <EditableField value={breakdown.epic.description}
                onChange={(v) => updateEpic('description', v)}
                multiline className="text-sm leading-relaxed"
                style={{ color: 'var(--s2j-text-light)' }} />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block"
                style={{ color: 'var(--s2j-text-muted)' }}>Labels (pushed to the Epic)</label>
              <LabelsEditor labels={breakdown.epic.labels || []}
                onChange={(v) => updateEpic('labels', v)} />
            </div>
          </div>
        )}

        {/* Shared AC */}
        {breakdown.shared_acceptance_criteria?.items?.length > 0 && (
          <SharedACPanel
            sharedAC={breakdown.shared_acceptance_criteria}
            availableFeatures={availableFeatures}
            onAssign={assignSharedAC}
            onUnassign={unassignSharedAC}
            onRemove={removeSharedACItem}
            onRestore={restoreSharedACItem}
          />
        )}

        {/* Categories (each groups Stories; pushes as а single root JIRA Epic per Spec2Tickets v3.0.0) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--s2j-text-muted)' }}>
              Categories ({stats.capCount})
            </h3>
            <button onClick={addCapability} className="text-xs transition-colors"
              style={{ color: 'var(--s2j-green)' }}
              onMouseEnter={e => e.target.style.color = 'var(--s2j-green-dark)'}
              onMouseLeave={e => e.target.style.color = 'var(--s2j-green)'}>
              + Add Category
            </button>
          </div>
          {breakdown.capabilities.map((cap, i) => (
            <CapabilityCard key={i} capability={cap} index={i}
              onUpdate={(u) => updateCapability(i, u)} onDelete={() => deleteCapability(i)} />
          ))}
        </div>
      </div>

      {/* Push bar */}
      <div className="shrink-0 px-4 py-3" style={{
        borderTop: '1px solid var(--s2j-border)',
        background: 'var(--s2j-bg-section)',
      }}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs" style={{ color: 'var(--s2j-text-light)' }}>
            {stats.totalItems} items will be created
          </p>
          <div className="flex items-center gap-2">
            {/* Test-case generation moved to the Review screen (ConfirmScreen) — the SINGLE
                entry point, so the BA's edits are always lifted into pendingBreakdown (via this
                Push→Review step) before generating. Removes the edits-trapped-in-editor bug (#1). */}
            <button onClick={() => onPush(breakdown)} disabled={isPushing} className="btn-primary">
              {isPushing ? (
                <>
                  <SpinnerInline />
                  Creating in Jira...
                </>
              ) : (
                'Continue to Review →'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatChip({ label, value, color, highlight = false }) {
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ color: 'var(--s2j-text-muted)' }}>{label}</span>
      <span className={`font-mono font-semibold ${highlight ? 'rounded px-1.5 py-0.5' : ''}`}
        style={{
          color,
          ...(highlight ? { background: 'var(--s2j-blue-bg)' } : {}),
        }}>
        {value}
      </span>
    </div>
  );
}

function SpinnerInline() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
      style={{ animation: 'spin 0.8s linear infinite' }}>
      <circle cx="8" cy="8" r="6.5" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" />
      <path d="M14.5 8a6.5 6.5 0 00-6.5-6.5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

function _addACToFeature(bd, featName, acText) {
  for (const cap of bd.capabilities || []) {
    for (const f of cap.features || []) {
      if (f.name === featName) {
        if (!f.acceptance_criteria) f.acceptance_criteria = [];
        if (!f.acceptance_criteria.some((ac) => ac.includes(acText.split(': ').pop()))) f.acceptance_criteria.push(acText);
        return;
      }
    }
  }
}

function _removeACFromFeature(bd, featName, acText) {
  for (const cap of bd.capabilities || []) {
    for (const f of cap.features || []) {
      if (f.name === featName && f.acceptance_criteria) {
        f.acceptance_criteria = f.acceptance_criteria.filter((ac) => !ac.includes(acText));
        return;
      }
    }
  }
}
