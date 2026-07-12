import { IconLink } from '../Icon';
import { glassSurface, MOOD } from '../moodboard';
import { StatusDot } from './signalTokens.jsx';

/**
 * SharedACView — the CENTER pane when the "Shared acceptance criteria" left entry is selected (mode='shared').
 *
 * The cross-cutting ACs the AI pulled from the document. The BA allocates each to the ONE story it governs
 * (opens the assign wizard), reassigns, soft-removes, or restores. A shared AC injected into a story shows
 * as a LOCKED row in that story's AC list (FocusedStory) so it is never mistaken for a hand-written one.
 *
 * ⚠ SAFETY (the "never silently mutate the BA's ACs" invariant): assignment binds by the story's stable _uid
 * (survives rename) and the inject/remove is prefix-exact (sharedAcInjected / acIsSharedFor) — the orchestrator
 * owns that mutation. This view is the allocation UI; it flows in the page (NO internal scroll).
 *
 * Props:
 *   sharedAC          — breakdown.shared_acceptance_criteria (or null)
 *   availableFeatures — [{ uid, name, category }] (current names; value = uid) — to render the assigned story
 *   onAssign(sacId)   — open the assign wizard for this SAC (the orchestrator commits the pick)
 *   onUnassign(sacId) / onRemove(sacId) / onRestore(sacId)
 */
export default function SharedACView({ sharedAC, availableFeatures = [], onAssign, onUnassign, onRemove, onRestore }) {
  const hasItems = !!sharedAC?.items?.length;

  // Partition: regular (assignable) vs removed (user soft-deleted).
  const regular = [];
  const removed = [];
  for (const item of (sharedAC?.items || [])) {
    if (item.removed_by_user) removed.push(item);
    else regular.push(item);
  }
  const assignedCount = regular.filter((i) => i.assigned_feature).length;
  const unassignedCount = regular.length - assignedCount;
  const sourceLabel = sharedAC?.source_sections?.join(', ') || 'the document';

  // Resolve an assigned story's current display name (uid, or legacy name fallback).
  function storyFor(item) {
    const key = item.assigned_feature;
    if (!key) return null;
    return availableFeatures.find((f) => f.uid === key || f.name === key) || null;
  }

  // ── Honest ABSENCE state ──
  if (!hasItems) {
    return (
      <div className="rounded-lg" style={{ ...glassSurface('minor'), padding: 20 }}>
        <Header />
        <div className="rounded-lg px-4 py-6 text-center mt-3"
          style={{ background: 'var(--s2j-bg-section)', border: '1px dashed var(--s2j-border)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--s2j-text)' }}>No shared acceptance criteria</p>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--s2j-text-muted)', maxWidth: 420, margin: '4px auto 0' }}>
            This document didn't define any cross-cutting acceptance criteria — every criterion lives on its own story.
            Nothing to allocate here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg" style={{ ...glassSurface('minor'), padding: 20 }}>
      <Header />

      {/* Explainer + tally */}
      <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--s2j-text-light)' }}>
        These criteria were pulled from <span style={{ color: 'var(--s2j-text)' }}>{sourceLabel}</span> and cut
        across multiple stories. Allocate each to the ONE story it most governs — it will be injected into that
        story's acceptance criteria (marked as shared).
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]" style={{ color: 'var(--s2j-text)' }}>
        <span className="inline-flex items-center gap-1.5">
          <StatusDot color="var(--s2j-info)" size={7} /> {unassignedCount} unassigned
        </span>
        <span className="inline-flex items-center gap-1.5">
          <StatusDot color="var(--s2j-trust)" size={7} /> {assignedCount} assigned
        </span>
        {removed.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <StatusDot color="var(--s2j-text-muted)" size={7} /> {removed.length} removed
          </span>
        )}
      </div>

      {/* Rows */}
      <div className="space-y-2 mt-4">
        {regular.map((item) => (
          <SharedACRow
            key={item.id}
            item={item}
            story={storyFor(item)}
            onAssign={() => onAssign(item.id)}
            onUnassign={() => onUnassign(item.id)}
            onRemove={onRemove ? () => onRemove(item.id) : null}
          />
        ))}
      </div>

      {regular.length > 0 && unassignedCount === 0 && (
        <p className="text-[11px] text-center mt-3" style={{ color: 'var(--s2j-trust)' }}>
          Every criterion from the document is allocated to a story.
        </p>
      )}

      {/* Removed (soft-deleted, restorable) */}
      {removed.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--s2j-text-muted)' }}>
            Removed ({removed.length}) — excluded from the Jira push
          </div>
          <div className="space-y-1.5">
            {removed.map((item) => (
              <RemovedRow key={item.id} item={item} onRestore={onRestore ? () => onRestore(item.id) : null} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center" style={{ color: 'var(--s2j-info)' }}><IconLink size={16} /></span>
      <h3 className="text-base font-semibold" style={{ color: MOOD.navy, margin: 0 }}>
        Shared acceptance criteria
      </h3>
    </div>
  );
}

function SharedACRow({ item, story, onAssign, onUnassign, onRemove }) {
  const assigned = !!story;
  const borderColor = assigned ? 'var(--s2j-trust-border)' : 'var(--s2j-border)';
  const bgColor = assigned ? 'var(--s2j-trust-bg)' : 'var(--s2j-bg)';

  return (
    <div className="rounded-lg px-3 py-2.5" style={{ border: `1px solid ${borderColor}`, background: bgColor }}>
      <div className="flex items-start gap-2 mb-2">
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono font-medium"
          style={{ background: assigned ? 'var(--s2j-trust-border)' : 'var(--s2j-bg-section)', color: assigned ? 'var(--s2j-text)' : 'var(--s2j-text-light)' }}>
          {item.id}
        </span>
        <p className="text-xs leading-relaxed flex-1" style={{ color: 'var(--s2j-text)' }}>{item.text}</p>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 text-[10px] transition-colors"
            style={{ color: 'var(--s2j-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--s2j-red)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--s2j-text-muted)'; }}
            title="Remove this criterion from the breakdown (soft-delete; restorable)"
          >
            Remove
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pl-6">
        {/* State */}
        {assigned ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] min-w-0" style={{ color: 'var(--s2j-text)' }}>
            <StatusDot color="var(--s2j-trust)" size={7} />
            <span className="shrink-0" style={{ color: 'var(--s2j-text-muted)' }}>In</span>
            <span className="font-medium truncate" title={story.name}>{story.name}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--s2j-text)' }}>
            <StatusDot color="var(--s2j-info)" size={7} />
            <span style={{ color: 'var(--s2j-text-muted)' }}>Unassigned</span>
          </span>
        )}

        {/* Action — Assign (blue nav; opens the wizard) or Reassign + Unassign for an assigned one. */}
        <div className="flex items-center gap-2.5 shrink-0">
          {assigned && (
            <button
              type="button"
              onClick={onUnassign}
              className="text-[11px] transition-colors"
              style={{ color: 'var(--s2j-text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--s2j-text)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--s2j-text-muted)'; }}
              title="Unassign this criterion (leaves it unallocated)"
            >
              Unassign
            </button>
          )}
          <button
            type="button"
            onClick={onAssign}
            className="text-[11px] font-medium transition-colors"
            style={{ color: 'var(--s2j-blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
            onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
          >
            {assigned ? 'Reassign' : 'Assign →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RemovedRow({ item, onRestore }) {
  return (
    <div className="flex items-start gap-2 rounded px-2 py-1.5"
      style={{ background: 'var(--s2j-bg)', border: '1px solid var(--s2j-border)', opacity: 0.7 }}>
      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono font-medium"
        style={{ background: 'var(--s2j-bg-section)', color: 'var(--s2j-text-muted)' }}>
        {item.id}
      </span>
      <p className="flex-1 text-xs leading-relaxed"
        style={{ color: 'var(--s2j-text-light)', textDecoration: 'line-through', textDecorationColor: 'var(--s2j-text-muted)' }}>
        {item.text}
      </p>
      {onRestore && (
        <button
          type="button"
          onClick={onRestore}
          className="shrink-0 text-[10px] transition-colors"
          style={{ color: 'var(--s2j-blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
          onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
          title="Restore this criterion to the list"
        >
          Restore
        </button>
      )}
    </div>
  );
}
