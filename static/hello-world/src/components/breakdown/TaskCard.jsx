import { useState } from 'react';
import EditableField from './EditableField.jsx';
import {
  TASK_TYPES, TASK_TYPE_COLORS,
  PRIORITIES, PRIORITY_COLORS,
  STORY_POINTS, SP_LABELS, SP_COLORS,
} from './constants.js';

/**
 * SelectBadge — Badge that doubles as a dropdown selector.
 * Light theme.
 */
function SelectBadge({ value, options, colorMap, labelMap, onChange }) {
  const [open, setOpen] = useState(false);
  const display = labelMap ? (labelMap[value] || value) : value;
  const colorClass = colorMap[value] || 'bg-gray-100 text-gray-600 ring-gray-200';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
          ring-1 ring-inset cursor-pointer transition-opacity hover:opacity-80 ${colorClass}`}
      >
        {display}
        <svg className="ml-1 h-3 w-3 opacity-50" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 rounded-lg py-1 min-w-[120px]"
            style={{
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
                  onMouseEnter={e => e.target.style.background = 'var(--s2j-bg-section)'}
                  onMouseLeave={e => e.target.style.background = 'transparent'}
                >
                  <span className={`inline-block h-2 w-2 rounded-full ring-1 ring-inset ${optColor}`} />
                  {optLabel}
                  {isSelected && <span className="ml-auto" style={{ color: 'var(--s2j-green)' }}>✓</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * AcceptanceCriteriaList — Editable list of acceptance criteria.
 */
function AcceptanceCriteriaList({ criteria, onChange }) {
  function updateItem(index, newValue) { const u = [...criteria]; u[index] = newValue; onChange(u); }
  function deleteItem(index) { if (criteria.length <= 1) return; onChange(criteria.filter((_, i) => i !== index)); }
  function addItem() { onChange([...criteria, 'New acceptance criterion']); }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider"
          style={{ color: 'var(--s2j-text-muted)' }}>Acceptance Criteria</span>
        <button onClick={addItem} className="text-[11px] transition-colors"
          style={{ color: 'var(--s2j-green)' }}>+ Add</button>
      </div>
      {criteria.map((ac, i) => (
        <div key={i} className="group flex items-start gap-2">
          <span className="mt-1 text-[10px] select-none" style={{ color: 'var(--s2j-text-muted)' }}>{i + 1}.</span>
          <div className="flex-1 min-w-0">
            <EditableField value={ac} onChange={(v) => updateItem(i, v)} multiline
              className="text-xs leading-relaxed" style={{ color: 'var(--s2j-text-light)' }} />
          </div>
          {criteria.length > 1 && (
            <button onClick={() => deleteItem(i)}
              className="mt-0.5 opacity-0 group-hover:opacity-100 transition-all text-xs px-1"
              style={{ color: 'var(--s2j-red)' }}>✕</button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * DependencyList — Editable list of task dependencies.
 */
function DependencyList({ deps, onChange }) {
  function updateItem(i, v) { const u = [...deps]; u[i] = v; onChange(u); }
  function deleteItem(i) { onChange(deps.filter((_, idx) => idx !== i)); }
  function addItem() { onChange([...deps, 'New dependency']); }

  if (deps.length === 0) {
    return (
      <button onClick={addItem} className="text-[11px] transition-colors"
        style={{ color: 'var(--s2j-text-muted)' }}
        onMouseEnter={e => e.target.style.color = 'var(--s2j-text-light)'}
        onMouseLeave={e => e.target.style.color = 'var(--s2j-text-muted)'}>
        + Add dependency
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider"
          style={{ color: 'var(--s2j-text-muted)' }}>Dependencies</span>
        <button onClick={addItem} className="text-[11px] transition-colors"
          style={{ color: 'var(--s2j-green)' }}>+ Add</button>
      </div>
      {deps.map((dep, i) => (
        <div key={i} className="group flex items-center gap-2">
          <span className="text-[10px]" style={{ color: 'var(--s2j-text-muted)' }}>→</span>
          <div className="flex-1 min-w-0">
            <EditableField value={dep} onChange={(v) => updateItem(i, v)}
              className="text-xs" style={{ color: 'var(--s2j-text-light)' }} />
          </div>
          <button onClick={() => deleteItem(i)}
            className="opacity-0 group-hover:opacity-100 transition-all text-xs px-1"
            style={{ color: 'var(--s2j-red)' }}>✕</button>
        </div>
      ))}
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

        <SelectBadge value={task.estimate_story_points} options={STORY_POINTS}
          colorMap={SP_COLORS} labelMap={SP_LABELS}
          onChange={(val) => updateField('estimate_story_points', val)} />

        <SelectBadge value={task.priority} options={PRIORITIES} colorMap={PRIORITY_COLORS}
          onChange={(val) => updateField('priority', val)} />

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
        {task.description && (
          <div>
            <span className="text-[11px] font-medium uppercase tracking-wider block mb-1"
              style={{ color: 'var(--s2j-text-muted)' }}>Description</span>
            <EditableField value={task.description} onChange={(val) => updateField('description', val)}
              multiline className="text-xs leading-relaxed mt-1" style={{ color: 'var(--s2j-text-light)' }} />
          </div>
        )}
        {task.acceptance_criteria && task.acceptance_criteria.length > 0 && (
          <AcceptanceCriteriaList criteria={task.acceptance_criteria}
            onChange={(val) => updateField('acceptance_criteria', val)} />
        )}
        <DependencyList deps={task.dependencies || []}
          onChange={(val) => updateField('dependencies', val)} />
      </div>
    </div>
  );
}
