import EditableField from './EditableField.jsx';
import LabelsEditor from './LabelsEditor.jsx';
import { glassSurface, MOOD } from '../moodboard';

/**
 * EpicEditView — the CENTER pane when the "EPIC · Edit summary" left entry is selected (mode='epic').
 *
 * The breakdown's top-level scope (pushed as the JIRA Epic): editable Summary + Description + Labels
 * (kebab chips), plus a read-only stats tile row (Stories / Sub-tasks / Acceptance criteria / Target
 * project). Reworked from the old inline EpicCard so it lives in the 3-pane center. Flows in the page
 * (NO internal scroll).
 *
 * Props:
 *   epic          — breakdown.epic (summary/description/labels)
 *   onUpdate(field, value)  — patch a single epic field
 *   stats         — { stories, subtasks, acs, project } (read-only tiles)
 */
export default function EpicEditView({ epic, onUpdate, stats = {} }) {
  const tiles = [
    { label: 'Stories', value: stats.stories != null ? stats.stories : '—' },
    { label: 'Sub-tasks', value: stats.subtasks != null ? stats.subtasks : '—' },
    { label: 'Acceptance criteria', value: stats.acs != null ? stats.acs : '—' },
    { label: 'Target project', value: stats.project || 'From Settings' },
  ];

  return (
    <div className="rounded-lg space-y-4" style={{ ...glassSurface('minor'), borderLeft: '4px solid var(--s2j-blue)', padding: 20 }}>
      <div className="flex items-center gap-2">
        <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ background: 'var(--s2j-blue-bg)', color: 'var(--s2j-blue)' }}>
          Epic
        </span>
        <span className="text-[11px]" style={{ color: 'var(--s2j-text-muted)' }}>
          Parent of all {stats.stories != null ? stats.stories : ''} stories
        </span>
      </div>

      {/* Summary (editable) */}
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--s2j-text-muted)' }}>
          Epic summary
        </label>
        <EditableField value={epic.summary}
          onChange={(v) => onUpdate('summary', v)}
          className="text-lg font-semibold"
          style={{ color: MOOD.navy }} />
      </div>

      {/* Labels (kebab chips) */}
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--s2j-text-muted)' }}>
          Labels <span className="font-normal normal-case" style={{ color: 'var(--s2j-text-muted)' }}>(pushed to the Epic)</span>
        </label>
        <LabelsEditor labels={epic.labels || []} onChange={(v) => onUpdate('labels', v)} />
      </div>

      {/* Description (outlined, editable) */}
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--s2j-text-muted)' }}>
          Description
        </label>
        <div className="rounded-lg px-3 py-2" style={{ border: '1px solid var(--s2j-border)', background: 'var(--s2j-bg)' }}>
          <EditableField value={epic.description}
            onChange={(v) => onUpdate('description', v)}
            multiline placeholder="Click to add a description..."
            className="text-sm leading-relaxed"
            style={{ color: 'var(--s2j-text-light)' }} />
        </div>
      </div>

      {/* Stats tile row */}
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg px-3 py-2.5"
            style={{ background: 'var(--s2j-bg-section)', border: '1px solid var(--s2j-border)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--s2j-text-muted)' }}>
              {t.label}
            </div>
            <div className="text-base font-semibold mt-0.5 truncate" style={{ color: 'var(--s2j-text)' }} title={String(t.value)}>
              {t.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
