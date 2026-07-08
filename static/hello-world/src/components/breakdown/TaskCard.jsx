import { useState } from 'react';
import EditableField from './EditableField.jsx';
import { TASK_TYPES, TASK_TYPE_COLORS } from './constants.js';
import { IconTrash, IconChevronRight } from '../Icon';

/**
 * TaskCard — one sub-task (-> JIRA Subtask) as a COLLAPSIBLE row in the 6A editor.
 *
 * Collapsed (default): [checkbox] name  [type chip]  [expand chevron]. Click the row (or the
 * chevron) to expand -> edit NAME (outlined) + DESCRIPTION (outlined) + TYPE.
 *
 * TYPE is an INLINE SEGMENTED enum (API/UI/DB/ML/OPS/DOC/TEST) — NOT a portaled dropdown. The old
 * SelectBadge menu was portaled to document.body specifically to escape the card's `overflow-hidden`
 * clipping; the segmented control sidesteps the clipping problem entirely (nothing overflows), so it
 * is both simpler and more robust in the Forge iframe (no fixed-position menu to keep pinned on
 * scroll). Keeps the task `_uid` React key upstream.
 *
 * The leading "checkbox" is a decorative completion marker (sub-tasks have no completion state in the
 * v3 schema) — it is aria-hidden and non-interactive; the row's expand affordance is the real control.
 */
export default function TaskCard({ task, index, onUpdate, onDelete, deleteDisabled = false }) {
  const [expanded, setExpanded] = useState(false);
  function updateField(field, value) { onUpdate({ ...task, [field]: value }); }

  const typeChipColor = TASK_TYPE_COLORS[task.type] || 'bg-gray-100 text-gray-600 ring-gray-200';

  return (
    <div className="group/task rounded-lg transition-colors" style={{
      border: '1px solid var(--s2j-border)',
      borderLeft: '3px solid var(--s2j-orange)',
      background: 'var(--s2j-bg)',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--s2j-orange-border)'}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--s2j-border)'; e.currentTarget.style.borderLeftColor = 'var(--s2j-orange)'; }}
    >
      {/* ── Collapsed header row: expand toggle + index + checkbox + name + type chip + delete ── */}
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Expand toggle — a real button (a11y + keyboard). Chevron rotates when open. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse sub-task ${index + 1}` : `Expand sub-task ${index + 1}`}
          className="shrink-0 rounded p-0.5 inline-flex items-center justify-center"
          style={{ color: 'var(--s2j-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <span style={{ display: 'inline-flex', transition: 'transform 120ms', transform: expanded ? 'rotate(90deg)' : 'none' }}>
            <IconChevronRight size={14} />
          </span>
        </button>

        <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded text-[10px] font-mono"
          style={{ background: 'var(--s2j-bg-section)', color: 'var(--s2j-text-muted)' }}>
          {index + 1}
        </span>

        {/* Decorative completion marker (no completion state in v3) — non-interactive, aria-hidden. */}
        <span aria-hidden="true" className="shrink-0 inline-flex items-center justify-center rounded"
          style={{ width: 14, height: 14, border: '1.5px solid var(--s2j-border)', background: 'var(--s2j-bg-section)' }} />

        {/* Name — inline-editable even when collapsed (click-to-edit does not toggle the row). */}
        <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
          <EditableField value={task.summary} onChange={(val) => updateField('summary', val)}
            className="text-sm font-medium" maxLength={200} />
        </div>

        {/* Type chip — a compact read-only tag in the collapsed row (edit it in the expanded panel). */}
        <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${typeChipColor}`}>
          {task.type}
        </span>

        <button onClick={deleteDisabled ? undefined : onDelete}
          disabled={deleteDisabled}
          className="shrink-0 rounded p-1 opacity-0 group-hover/task:opacity-100 transition-all"
          style={{ color: 'var(--s2j-text-muted)', background: 'none', border: 'none', cursor: deleteDisabled ? 'not-allowed' : 'pointer' }}
          onMouseEnter={e => { if (!deleteDisabled) { e.currentTarget.style.background = 'var(--s2j-red-bg)'; e.currentTarget.style.color = 'var(--s2j-red)'; } }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--s2j-text-muted)'; }}
          title={deleteDisabled ? 'A story needs at least one sub-task' : 'Delete sub-task'}
        >
          <IconTrash size={14} />
        </button>
      </div>

      {/* ── Expanded editor: NAME (outlined, above) + DESCRIPTION (outlined) + TYPE (segmented) ── */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 ml-[68px] space-y-2.5">
          {/* Description — an outlined editable box. */}
          <div>
            <span className="text-[11px] font-medium uppercase tracking-wider block mb-1"
              style={{ color: 'var(--s2j-text-muted)' }}>Description</span>
            <div className="rounded-lg px-2 py-1.5" style={{ border: '1px solid var(--s2j-border)', background: 'var(--s2j-bg)' }}>
              <EditableField value={task.description || ''} onChange={(val) => updateField('description', val)}
                multiline placeholder="Click to add a description…" className="text-xs leading-relaxed" style={{ color: 'var(--s2j-text-light)' }} />
            </div>
          </div>

          {/* Type — an inline SEGMENTED enum. No portal, no clipping. */}
          <div>
            <span className="text-[11px] font-medium uppercase tracking-wider block mb-1"
              style={{ color: 'var(--s2j-text-muted)' }}>Type</span>
            <div role="group" aria-label="Sub-task type" className="inline-flex flex-wrap gap-1">
              {TASK_TYPES.map((t) => {
                const active = t === task.type;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => updateField('type', t)}
                    aria-pressed={active}
                    className="rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors"
                    style={{
                      border: active ? '1px solid var(--s2j-blue)' : '1px solid var(--s2j-border)',
                      background: active ? 'var(--s2j-blue-bg)' : 'var(--s2j-bg)',
                      color: active ? 'var(--s2j-blue-dark)' : 'var(--s2j-text-light)',
                      cursor: 'pointer',
                    }}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
