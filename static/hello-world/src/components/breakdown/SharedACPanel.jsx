import { useState } from 'react';

/**
 * SharedACPanel — Displays source acceptance criteria from shared sections
 * for human assignment to features.
 *
 * Track 2 (Audit-X UI editorial control, 2026-05-09):
 *   - Items с quality_warning="possible_noise" (от Track 1 panel-noise critic)
 *     render под separate collapsible "Possible noise" subsection. BA can
 *     review flagged items, restore back to AC list (false-positive recovery),
 *     OR remove permanently.
 *   - "Remove this item" button per regular AC + flagged item → soft-delete
 *     (item moves to "Removed" collapsible subsection; restorable).
 *   - "Restore" button on flagged items returns them to regular AC list
 *     (clears quality_warning); on removed items returns to original section.
 *
 * Light theme (Swagger palette).
 */
export default function SharedACPanel({
  sharedAC,
  availableFeatures = [],
  onAssign,
  onUnassign,
  onRemove,
  onRestore,
  onRestoreFromNoise,
}) {
  const [collapsed, setCollapsed] = useState(false);
  // Track 2 (2026-05-09): default collapsed для secondary sections — keeps
  // panel scannable за primary review; flagged / removed accessible by 1 click.
  const [noiseCollapsed, setNoiseCollapsed] = useState(true);
  const [removedCollapsed, setRemovedCollapsed] = useState(true);

  if (!sharedAC?.items?.length) return null;

  // Track 2 — partition items into 3 groups:
  //   - regular: standard ACs (no flag, not removed)
  //   - flagged: quality_warning="possible_noise" (Track 1 critic flagged)
  //   - removed: removed_by_user=true (soft-deleted by user)
  // M-1 self-review fix (2026-05-09): public field names (no underscore prefix)
  // because state must survive JSON serialization for downstream consumers
  // (forensic cross-spec measurement; future re-import flows; jira_client
  // defensive filter axis).
  const regular = [];
  const flagged = [];
  const removed = [];
  for (const item of sharedAC.items) {
    if (item.removed_by_user) removed.push(item);
    else if (item.quality_warning === 'possible_noise') flagged.push(item);
    else regular.push(item);
  }

  // Assignable total = regular + flagged (BA can assign both; flagged stay
  // assignable in case they're false-positives the BA wants to keep).
  // Removed items excluded from progress (user explicitly deferred them).
  const assignableItems = regular.length + flagged.length;
  const assignedCount = [...regular, ...flagged].filter(
    (i) => i.assigned_feature,
  ).length;
  const allAssigned =
    assignableItems > 0 && assignedCount === assignableItems;
  const totalCount = sharedAC.items.length;
  const sourceLabel = sharedAC.source_sections?.join(', ') || 'Document';

  return (
    <div className="rounded-lg overflow-hidden" style={{
      border: '1px solid var(--s2j-orange-border)',
      background: 'var(--s2j-orange-bg)',
    }}>
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(252,161,48,0.1)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <svg
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`}
          style={{ color: 'var(--s2j-orange)' }}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" />
        </svg>

        <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ background: 'var(--s2j-orange-border)', color: '#92400e' }}>
          Source AC
        </span>

        <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--s2j-text)' }}>
          Acceptance Criteria from Specification
        </span>

        <span className="text-[11px]" style={{ color: 'var(--s2j-text-muted)' }}>
          {assignedCount}/{assignableItems} assigned
          {(flagged.length > 0 || removed.length > 0) && (
            <span style={{ color: 'var(--s2j-text-muted)', marginLeft: '6px' }}>
              · {totalCount} total
            </span>
          )}
        </span>

        {/* Progress bar */}
        <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--s2j-border)' }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${assignableItems > 0 ? (assignedCount / assignableItems) * 100 : 0}%`,
              background: allAssigned ? 'var(--s2j-green)' : 'var(--s2j-orange)',
            }}
          />
        </div>
      </button>

      {/* Content */}
      {!collapsed && (
        <div className="px-4 pb-4 pt-3 space-y-3" style={{ borderTop: '1px solid var(--s2j-orange-border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-[11px]" style={{ color: 'var(--s2j-text-muted)' }}>
              From: <span style={{ color: 'var(--s2j-text-light)' }}>{sourceLabel}</span>
            </span>
            {/* "Accept all suggestions" removed — it relied on a per-AC
                suggested_feature that v3 does not produce (shared ACs are
                cross-cutting strings). Assign each via the dropdown below. */}
          </div>

          {/* Regular ACs */}
          <div className="space-y-2">
            {regular.map((item) => (
              <SharedACItem
                key={item.id}
                item={item}
                availableFeatures={availableFeatures}
                onAssign={(featureName) => onAssign(item.id, featureName)}
                onUnassign={() => onUnassign(item.id)}
                onRemove={onRemove ? () => onRemove(item.id) : null}
              />
            ))}
          </div>

          {/* Track 2 — "Possible noise" collapsible subsection */}
          {flagged.length > 0 && (
            <NoiseSubsection
              items={flagged}
              availableFeatures={availableFeatures}
              collapsed={noiseCollapsed}
              onToggle={() => setNoiseCollapsed(!noiseCollapsed)}
              onAssign={onAssign}
              onUnassign={onUnassign}
              onRemove={onRemove}
              onRestoreFromNoise={onRestoreFromNoise}
            />
          )}

          {/* Track 2 — "Removed" collapsible subsection */}
          {removed.length > 0 && (
            <RemovedSubsection
              items={removed}
              collapsed={removedCollapsed}
              onToggle={() => setRemovedCollapsed(!removedCollapsed)}
              onRestore={onRestore}
            />
          )}

          {allAssigned && regular.length + flagged.length > 0 && (
            <p className="text-[11px] text-center pt-1" style={{ color: 'var(--s2j-green)' }}>
              All assignable acceptance criteria have been assigned to features.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * NoiseSubsection — collapsible group для Track 1 panel-noise critic flagged
 * items. Visually distinct from regular ACs; user can review flagged-as-noise
 * items, restore false-positives back to AC list, OR remove permanently.
 */
function NoiseSubsection({
  items,
  availableFeatures,
  collapsed,
  onToggle,
  onAssign,
  onUnassign,
  onRemove,
  onRestoreFromNoise,
}) {
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        border: '1px dashed var(--s2j-text-muted)',
        background: 'var(--s2j-bg)',
      }}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors"
        onMouseEnter={e => e.currentTarget.style.background = 'var(--s2j-bg-section)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <svg
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`}
          style={{ color: 'var(--s2j-text-muted)' }}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" />
        </svg>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
          style={{
            background: 'var(--s2j-bg-section)',
            color: 'var(--s2j-text-muted)',
            border: '1px solid var(--s2j-border)',
          }}
        >
          Possible noise
        </span>
        <span
          className="flex-1 text-[11px]"
          style={{ color: 'var(--s2j-text-light)' }}
        >
          {items.length} {items.length === 1 ? 'item' : 'items'} flagged by critic
          (review + restore OR remove)
        </span>
      </button>

      {!collapsed && (
        <div
          className="px-3 pb-3 pt-2 space-y-2"
          style={{ borderTop: '1px dashed var(--s2j-border)' }}
        >
          {items.map((item) => (
            <SharedACItem
              key={item.id}
              item={item}
              availableFeatures={availableFeatures}
              onAssign={(featureName) => onAssign(item.id, featureName)}
              onUnassign={() => onUnassign(item.id)}
              onRemove={onRemove ? () => onRemove(item.id) : null}
              onRestoreFromNoise={
                onRestoreFromNoise ? () => onRestoreFromNoise(item.id) : null
              }
              isFlagged
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * RemovedSubsection — collapsible group для items soft-deleted by user.
 * Items still в breakdown JSON (с removed_by_user=true flag); not pushed to
 * JIRA. User can restore items back to original section if removal was
 * accidental.
 */
function RemovedSubsection({ items, collapsed, onToggle, onRestore }) {
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        border: '1px dashed var(--s2j-border)',
        background: 'var(--s2j-bg-section)',
      }}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors"
        onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
        onMouseLeave={e => e.currentTarget.style.opacity = '1'}
      >
        <svg
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`}
          style={{ color: 'var(--s2j-text-muted)' }}
          viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" />
        </svg>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
          style={{
            background: 'var(--s2j-bg)',
            color: 'var(--s2j-text-muted)',
            border: '1px solid var(--s2j-border)',
          }}
        >
          Removed
        </span>
        <span
          className="flex-1 text-[11px]"
          style={{ color: 'var(--s2j-text-muted)' }}
        >
          {items.length} {items.length === 1 ? 'item' : 'items'} excluded from JIRA push
          (restorable)
        </span>
      </button>

      {!collapsed && (
        <div
          className="px-3 pb-3 pt-2 space-y-1.5"
          style={{ borderTop: '1px dashed var(--s2j-border)' }}
        >
          {items.map((item) => (
            <RemovedACItem
              key={item.id}
              item={item}
              onRestore={onRestore ? () => onRestore(item.id) : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * RemovedACItem — compact greyed-out display for soft-deleted items.
 * Restore button returns item to its original section (regular OR flagged).
 */
function RemovedACItem({ item, onRestore }) {
  return (
    <div
      className="flex items-start gap-2 rounded px-2 py-1.5"
      style={{
        background: 'var(--s2j-bg)',
        border: '1px solid var(--s2j-border)',
        opacity: 0.65,
      }}
    >
      <span
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono font-medium"
        style={{
          background: 'var(--s2j-bg-section)',
          color: 'var(--s2j-text-muted)',
        }}
      >
        {item.id}
      </span>
      <p
        className="flex-1 text-xs leading-relaxed"
        style={{
          color: 'var(--s2j-text-light)',
          textDecoration: 'line-through',
          textDecorationColor: 'var(--s2j-text-muted)',
        }}
      >
        {item.text}
      </p>
      {onRestore && (
        <button
          onClick={onRestore}
          className="shrink-0 text-[10px] transition-colors"
          style={{ color: 'var(--s2j-blue)' }}
          onMouseEnter={e => e.target.style.textDecoration = 'underline'}
          onMouseLeave={e => e.target.style.textDecoration = 'none'}
          title="Restore item to its original section"
        >
          Restore
        </button>
      )}
    </div>
  );
}

function SharedACItem({
  item,
  availableFeatures,
  onAssign,
  onUnassign,
  onRemove,
  onRestoreFromNoise,
  isFlagged = false,
}) {
  const isAssigned = !!item.assigned_feature;

  function truncate(str, max = 50) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '...' : str;
  }

  // Flagged items use neutral-grey accent (clear visual distinction от regular
  // green-when-assigned); the restore button sits в the action row.
  const borderColor = isFlagged
    ? 'var(--s2j-border)'
    : isAssigned
    ? 'var(--s2j-green-border)'
    : 'var(--s2j-border)';
  const bgColor = isFlagged
    ? 'var(--s2j-bg)'
    : isAssigned
    ? 'var(--s2j-green-bg)'
    : 'var(--s2j-bg)';

  return (
    <div
      className="rounded-lg px-3 py-2.5 transition-colors"
      style={{
        border: `1px solid ${borderColor}`,
        background: bgColor,
      }}
    >
      <div className="flex items-start gap-2 mb-2">
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono font-medium"
          style={{
            background: isAssigned && !isFlagged ? 'var(--s2j-green-border)' : 'var(--s2j-bg-section)',
            color: isAssigned && !isFlagged ? '#065f46' : 'var(--s2j-text-light)',
          }}>
          {item.id}
        </span>
        <p className="text-xs leading-relaxed flex-1" style={{ color: 'var(--s2j-text)' }}>
          {item.text}
        </p>
        {/* Track 2 — Remove button per item */}
        {onRemove && (
          <button
            onClick={onRemove}
            className="shrink-0 text-[10px] transition-colors"
            style={{ color: 'var(--s2j-text-muted)' }}
            onMouseEnter={e => e.target.style.color = 'var(--s2j-red)'}
            onMouseLeave={e => e.target.style.color = 'var(--s2j-text-muted)'}
            title="Remove this item from breakdown (soft-delete; restorable)"
          >
            Remove
          </button>
        )}
      </div>

      {/* Track 2 — Critic reason surfaced for flagged items so BA understands
          why item was flagged + can decide to restore or remove. */}
      {isFlagged && item.quality_warning_reason && (
        <p
          className="text-[10px] mb-2 ml-6"
          style={{
            color: 'var(--s2j-text-muted)',
            fontStyle: 'italic',
          }}
        >
          Critic: {item.quality_warning_reason}
        </p>
      )}

      <div className="flex items-center gap-2 ml-6">
        <span className="text-[10px] shrink-0" style={{ color: 'var(--s2j-text-muted)' }}>Assign to:</span>

        <select
          value={item.assigned_feature || ''}
          onChange={(e) => e.target.value ? onAssign(e.target.value) : onUnassign()}
          className="flex-1 rounded px-2 py-1.5 text-[11px] outline-none transition-colors"
          style={{
            border: isAssigned && !isFlagged ? '1px solid var(--s2j-green-border)' : '1px solid var(--s2j-border)',
            color: isAssigned && !isFlagged ? '#065f46' : 'var(--s2j-text)',
            background: 'var(--s2j-bg)',
          }}
        >
          <option value="">— Not assigned —</option>
          {availableFeatures.map((f) => (
            <option key={`${f.capIndex}-${f.featIndex}`} value={f.featName}>
              [{f.capName}] {truncate(f.featName)}
            </option>
          ))}
        </select>

        {/* Track 2 — Restore button on flagged items: clears quality_warning,
            moves item back to regular AC section. False-positive recovery
            path per Track 1 soft-drop architecture. */}
        {isFlagged && onRestoreFromNoise && (
          <button
            onClick={onRestoreFromNoise}
            className="shrink-0 rounded px-2 py-1 text-[10px] font-medium transition-colors"
            style={{
              border: '1px solid var(--s2j-blue-border)',
              background: 'var(--s2j-blue-bg)',
              color: 'var(--s2j-blue)',
            }}
            title="Restore as regular AC (clear noise flag — false-positive recovery)"
          >
            Restore as AC
          </button>
        )}

        {isAssigned && !isFlagged && (
          <span className="shrink-0 text-xs" style={{ color: 'var(--s2j-green)' }}>✓</span>
        )}
      </div>
    </div>
  );
}
