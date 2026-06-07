import { useState, useRef, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import EditableField from './EditableField.jsx';
import { TASK_TYPES, TASK_TYPE_COLORS } from './constants.js';

/**
 * SelectBadge — Badge that doubles as a dropdown selector.
 * Light theme.
 *
 * The open menu is rendered through a React portal to document.body and
 * positioned `fixed` from the trigger's bounding rect. This is REQUIRED, not
 * cosmetic: the badge lives inside TaskCard, whose ancestors (FeatureCard and
 * CapabilityCard roots) carry `rounded-lg overflow-hidden` and the editor's
 * scroll container carries `overflow-y-auto`. An absolutely-positioned menu
 * (the previous approach) is CLIPPED by any such ancestor regardless of
 * z-index, so for tasks lower in a feature the options were cut off behind the
 * next row / next card. A portal removes the menu from those clipping subtrees
 * entirely; `fixed` + viewport coordinates keep it anchored under the trigger
 * and immune to ancestor transforms. We also flip the menu upward when there
 * isn't room below (e.g. a task near the viewport bottom).
 */
function SelectBadge({ value, options, colorMap, labelMap, onChange }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const [menuPos, setMenuPos] = useState(null);
  const display = labelMap ? (labelMap[value] || value) : value;
  const colorClass = colorMap[value] || 'bg-gray-100 text-gray-600 ring-gray-200';

  // Estimated menu height (rows × ~30px + vertical padding) — used only to
  // decide flip direction; final size is content-driven.
  const estMenuHeight = options.length * 30 + 8;

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const flipUp = spaceBelow < estMenuHeight + 8 && r.top > spaceBelow;
    setMenuPos({
      left: r.left,
      // When flipping up we anchor the menu's bottom to the trigger's top.
      top: flipUp ? undefined : r.bottom + 4,
      bottom: flipUp ? window.innerHeight - r.top + 4 : undefined,
      minWidth: Math.max(r.width, 120),
    });
  }, [estMenuHeight]);

  // Measure synchronously before paint so the menu never flashes at (0,0), and
  // keep it pinned to the trigger while open as the user scrolls/resizes. The
  // scroll listener is on the capture phase so it also fires for the editor's
  // inner overflow-y-auto scroll container, not just the window.
  useLayoutEffect(() => {
    if (!open) return undefined;
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
          ring-1 ring-inset cursor-pointer transition-opacity hover:opacity-80 ${colorClass}`}
      >
        {display}
        <svg className="ml-1 h-3 w-3 opacity-50" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" />
        </svg>
      </button>

      {open && menuPos && createPortal(
        <>
          {/* Click-away backdrop. z-index sits just under the menu; both are
              portaled to body so no card overflow can clip them. z-index is set
              inline (not a Tailwind class) so it never depends on the JIT
              picking up an arbitrary value. */}
          <div className="fixed inset-0" style={{ zIndex: 2000 }} onClick={() => setOpen(false)} />
          <div className="fixed rounded-lg py-1"
            style={{
              zIndex: 2001,
              left: menuPos.left,
              top: menuPos.top,
              bottom: menuPos.bottom,
              minWidth: menuPos.minWidth,
              border: '1px solid var(--s2j-border)',
              background: 'var(--s2j-bg)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}>
            {options.map((opt) => {
              const optColor = colorMap[opt] || '';
              const optLabel = labelMap ? (labelMap[opt] || opt) : opt;
              const isSelected = opt === value;
              return (
                <button key={opt}
                  onClick={() => { onChange(opt); setOpen(false); }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors`}
                  style={{ color: isSelected ? 'var(--s2j-text)' : 'var(--s2j-text-light)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--s2j-bg-section)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span className={`inline-block h-2 w-2 rounded-full ring-1 ring-inset ${optColor}`} />
                  {optLabel}
                  {isSelected && <span className="ml-auto" style={{ color: 'var(--s2j-green)' }}>✓</span>}
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

/**
 * TaskCard — Full inline editor for a single task (→ JIRA Subtask).
 * Light theme (Swagger palette).
 */
export default function TaskCard({ task, index, onUpdate, onDelete }) {
  function updateField(field, value) { onUpdate({ ...task, [field]: value }); }

  return (
    <div className="group/task rounded-lg p-3 transition-colors" style={{
      border: '1px solid var(--s2j-border)',
      borderLeft: '3px solid var(--s2j-orange)',
      background: 'var(--s2j-bg)',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--s2j-orange-border)'}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--s2j-border)'; e.currentTarget.style.borderLeftColor = 'var(--s2j-orange)'; }}
    >
      {/* Header Row */}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-mono"
          style={{ background: 'var(--s2j-bg-section)', color: 'var(--s2j-text-muted)' }}>
          {index + 1}
        </span>

        <SelectBadge value={task.type} options={TASK_TYPES} colorMap={TASK_TYPE_COLORS}
          onChange={(val) => updateField('type', val)} />

        <div className="flex-1 min-w-0">
          <EditableField value={task.summary} onChange={(val) => updateField('summary', val)}
            className="text-sm font-medium" maxLength={200} />
        </div>

        {/* Subtask priority + story points removed — sizing lives at the Story
            (feature) level in v3, not per-subtask. */}
        <button onClick={onDelete}
          className="shrink-0 rounded p-1 opacity-0 group-hover/task:opacity-100 transition-all"
          style={{ color: 'var(--s2j-text-muted)' }}
          onMouseEnter={e => { e.target.style.background = 'var(--s2j-red-bg)'; e.target.style.color = 'var(--s2j-red)'; }}
          onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--s2j-text-muted)'; }}
          title="Delete task"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" />
          </svg>
        </button>
      </div>

      {/* Details */}
      <div className="mt-2.5 ml-7 space-y-2.5">
        {/* Always render so a NEW or description-less subtask can get a description (the old
            `task.description &&` guard hid the editor → no way to add one). EditableField shows the
            placeholder in muted italic when empty. */}
        <div>
          <span className="text-[11px] font-medium uppercase tracking-wider block mb-1"
            style={{ color: 'var(--s2j-text-muted)' }}>Description</span>
          <EditableField value={task.description || ''} onChange={(val) => updateField('description', val)}
            multiline placeholder="Click to add a description…" className="text-xs leading-relaxed mt-1" style={{ color: 'var(--s2j-text-light)' }} />
        </div>
      </div>
    </div>
  );
}
