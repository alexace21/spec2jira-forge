import { useState, useMemo, useEffect } from 'react';
import EditableField from './EditableField.jsx';
import CapabilityCard from './CapabilityCard.jsx';
import SharedACPanel from './SharedACPanel.jsx';

export default function BreakdownEditor({ initialBreakdown, onPush, isPushing = false }) {
  const [breakdown, setBreakdown] = useState(() => JSON.parse(JSON.stringify(initialBreakdown)));

  useEffect(() => {
    setBreakdown(JSON.parse(JSON.stringify(initialBreakdown)));
  }, [initialBreakdown]);

  const stats = useMemo(() => {
    const caps = breakdown.capabilities || [];
    const features = caps.flatMap((c) => c.features || []);
    const tasks = features.flatMap((f) => f.tasks || []);
    const totalSP = tasks.reduce((s, t) => s + (t.estimate_story_points || 0), 0);
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
      name: 'New Capability', features: [{ name: 'New Feature', user_story: 'As a user, I want [goal], so that [benefit].',
        acceptance_criteria: ['Acceptance criterion'], tasks: [{ type: 'API', summary: 'New task', estimate_story_points: 3, dependencies: [], priority: 'MEDIUM' }] }]
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
  function assignAllSuggestions() {
    setBreakdown((p) => {
      const u = JSON.parse(JSON.stringify(p));
      for (const item of u.shared_acceptance_criteria?.items || []) {
        // Skip flagged + removed items — only auto-assign clean regular ACs.
        if (item.removed_by_user || item.quality_warning === 'possible_noise') continue;
        if (!item.assigned_feature && item.suggested_feature) {
          item.assigned_feature = item.suggested_feature;
          _addACToFeature(u, item.suggested_feature, `${item.id}: ${item.text}`);
        }
      }
      return u;
    });
  }

  // Track 2 (Audit-X UI editorial control, 2026-05-09).
  // Soft-delete: stamp removed_by_user=true; if item was assigned to a feature,
  // unassign + remove from feature.AC (avoids ghost AC remaining in feature
  // after item soft-deleted from panel). Restorable via "Restore" button
  // в RemovedSubsection. State persists в breakdown JSON; на JIRA push,
  // jira_client should skip removed_by_user items (defense-in-depth —
  // currently they still exist as panel items so jira_client behavior depends
  // on its current panel-item handling. Future axis: add `removed_by_user`
  // filter to jira_client.push_breakdown if items leak through).
  // M-1 self-review fix (2026-05-09): renamed от `_removed` (underscore =
  // transient/internal convention) to `removed_by_user` (public — must
  // survive JSON serialization for downstream consumers + future re-import
  // flows).
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
      // Note: item returns to its original section (regular OR flagged) based
      // on whether quality_warning is still set. assigned_feature was cleared
      // on remove; user reassigns if desired.
      return u;
    });
  }

  // Track 2 — restore from "Possible noise" subsection back to regular AC
  // list. Clears Track 1 critic's quality_warning flag (false-positive
  // recovery path — BA confirms item IS a real testable AC despite critic
  // flag). Item moves visually from "Possible noise" group to regular AC
  // list. Critic-decided drop record в Theme A dropped_items remains for
  // forensic audit (BA override doesn't rewrite history).
  function restoreSharedACFromNoise(sacId) {
    setBreakdown((p) => {
      const u = JSON.parse(JSON.stringify(p));
      const item = u.shared_acceptance_criteria?.items?.find((i) => i.id === sacId);
      if (!item) return p;
      delete item.quality_warning;
      delete item.quality_warning_reason;
      // BA-override marker — useful in case downstream consumers (cross-spec
      // measurement / Track 1 calibration analysis) want to count BA flips
      // as critic false-positive signal.
      // M-1 self-review fix (2026-05-09): renamed от `_ba_restored_from_noise`
      // (underscore = transient/internal convention) to `restored_from_noise_flag`
      // (public — must survive JSON serialization for cross-spec FP-rate
      // measurement scripts to read it).
      item.restored_from_noise_flag = true;
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
            <StatChip label="Epics"  value={stats.capCount}     color="var(--s2j-blue)" />
            <StatChip label="Stories" value={stats.featureCount} color="var(--s2j-green)" />
            <StatChip label="Tasks"  value={stats.taskCount}    color="var(--s2j-orange)" />
            <StatChip label="Total SP" value={stats.totalSP}    color="var(--s2j-text)" highlight />
            <span className="text-[11px]" style={{ color: 'var(--s2j-text-muted)' }}>
              {stats.totalItems} JIRA items
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
          </div>
        )}

        {/* Shared AC */}
        {breakdown.shared_acceptance_criteria?.items?.length > 0 && (
          <SharedACPanel
            sharedAC={breakdown.shared_acceptance_criteria}
            availableFeatures={availableFeatures}
            onAssign={assignSharedAC}
            onUnassign={unassignSharedAC}
            onAssignAll={assignAllSuggestions}
            onRemove={removeSharedACItem}
            onRestore={restoreSharedACItem}
            onRestoreFromNoise={restoreSharedACFromNoise}
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
            <CapabilityCard key={cap._uid || i} capability={cap} index={i}
              onUpdate={(u) => updateCapability(i, u)} onDelete={() => deleteCapability(i)} />
          ))}
        </div>
      </div>

      {/* Push bar */}
      <div className="shrink-0 px-4 py-3" style={{
        borderTop: '1px solid var(--s2j-border)',
        background: 'var(--s2j-bg-section)',
      }}>
        <div className="flex items-center justify-between">
          <p className="text-xs" style={{ color: 'var(--s2j-text-light)' }}>
            {stats.totalItems} items will be created
          </p>
          <button onClick={() => onPush(breakdown)} disabled={isPushing} className="btn-primary">
            {isPushing ? (
              <>
                <SpinnerInline />
                Validating...
              </>
            ) : (
              'Push to JIRA →'
            )}
          </button>
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
