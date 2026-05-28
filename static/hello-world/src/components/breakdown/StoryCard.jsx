import { useState } from 'react';
import EditableField from './EditableField.jsx';
import { PRIORITIES, PRIORITY_COLORS, STORY_POINTS, SP_COLORS, SP_LABELS } from './constants.js';

/**
 * SelectBadge — Compact dropdown-styled badge for enums.
 * Light theme.
 */
function SelectBadge({ value, options, colorMap, labelMap, onChange }) {
  const display = labelMap?.[value] ?? value;
  const color = colorMap?.[value] ?? 'bg-gray-100 text-gray-600';
  return (
    <select
      value={value}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(isNaN(raw) ? raw : Number(raw));
      }}
      className={`appearance-none cursor-pointer rounded-full px-2.5 py-0.5
        text-[11px] font-semibold ring-1 ring-inset transition-colors
        focus:outline-none focus:ring-2 ${color}`}
      style={{ '--tw-ring-color': 'var(--s2j-blue)' }}
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>{labelMap?.[opt] ?? opt}</option>
      ))}
    </select>
  );
}

/**
 * StoryCard — Editor for a single User Story (→ JIRA Story).
 * Light theme (Swagger palette).
 */
export default function StoryCard({ story, index, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false);

  function updateField(field, value) { onUpdate({ ...story, [field]: value }); }

  function updateAC(newAC) { onUpdate({ ...story, acceptance_criteria: newAC }); }
  function addAC() { updateAC([...(story.acceptance_criteria || []), 'Given [precondition], when [action], then [result]']); }
  function deleteAC(i) { if ((story.acceptance_criteria || []).length <= 1) return; updateAC(story.acceptance_criteria.filter((_, idx) => idx !== i)); }

  function addDep() { updateField('dependencies', [...(story.dependencies || []), 'Story title']); }
  function deleteDep(i) { updateField('dependencies', (story.dependencies || []).filter((_, idx) => idx !== i)); }

  const sp = story.story_points || story.estimate_story_points || 0;
  const isMvp = story.mvp !== false;

  return (
    <div className="rounded-lg overflow-hidden transition-colors" style={{
      border: '1px solid var(--s2j-border)',
      borderLeft: isMvp ? '3px solid var(--s2j-green)' : '3px solid var(--s2j-border)',
      background: 'var(--s2j-bg)',
    }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors group"
        onMouseEnter={e => e.currentTarget.style.background = 'var(--s2j-bg-section)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <svg className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          style={{ color: 'var(--s2j-text-muted)' }} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" />
        </svg>

        <span className="flex items-center gap-1.5">
          <span className="rounded px-1.5 py-0.5 text-[10px] font-mono"
            style={{ background: 'var(--s2j-green-bg)', color: 'var(--s2j-green-dark)' }}>
            S-{index + 1}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--s2j-text-muted)' }}>Story</span>
        </span>

        {isMvp && (
          <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{ background: 'var(--s2j-green-bg)', color: 'var(--s2j-green-dark)' }}>MVP</span>
        )}

        <span className="flex-1 truncate text-sm font-medium" style={{ color: 'var(--s2j-text)' }}>
          {story.title || story.name || 'Untitled story'}
        </span>

        <SelectBadge value={sp} options={STORY_POINTS} colorMap={SP_COLORS} labelMap={SP_LABELS}
          onChange={(val) => updateField('story_points', val)} />
        <SelectBadge value={story.priority || 'MEDIUM'} options={PRIORITIES} colorMap={PRIORITY_COLORS}
          onChange={(val) => updateField('priority', val)} />

        <span onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="rounded p-1 transition-all opacity-0 group-hover:opacity-100"
          style={{ color: 'var(--s2j-text-muted)' }}
          onMouseEnter={e => { e.target.style.background = 'var(--s2j-red-bg)'; e.target.style.color = 'var(--s2j-red)'; }}
          onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--s2j-text-muted)'; }}
          title="Delete story" role="button">
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </span>
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="px-3 pb-3 pt-2.5 space-y-3" style={{ borderTop: '1px solid var(--s2j-border)' }}>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block"
              style={{ color: 'var(--s2j-text-muted)' }}>Story Title</label>
            <EditableField value={story.title || story.name || ''} onChange={(val) => updateField('title', val)}
              className="text-sm font-medium" />
          </div>

          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider mb-1 block"
              style={{ color: 'var(--s2j-text-muted)' }}>User Story</label>
            <EditableField value={story.user_story || ''} onChange={(val) => updateField('user_story', val)}
              multiline className="text-xs leading-relaxed italic" style={{ color: 'var(--s2j-text-light)' }} />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[11px] font-medium uppercase tracking-wider"
              style={{ color: 'var(--s2j-text-muted)' }}>MVP</label>
            <button onClick={() => updateField('mvp', !isMvp)}
              className="rounded-full px-3 py-0.5 text-[11px] font-semibold transition-colors"
              style={{
                background: isMvp ? 'var(--s2j-green-bg)' : 'var(--s2j-bg-section)',
                color: isMvp ? 'var(--s2j-green-dark)' : 'var(--s2j-text-muted)',
              }}>
              {isMvp ? 'Yes — MVP' : 'No — Phase 2+'}
            </button>
          </div>

          {/* AC */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--s2j-text-muted)' }}>Acceptance Criteria</span>
              <button onClick={addAC} className="text-[11px]" style={{ color: 'var(--s2j-green)' }}>+ Add</button>
            </div>
            {(story.acceptance_criteria || []).map((ac, i) => (
              <div key={i} className="group/ac flex items-start gap-2">
                <span className="mt-1 text-[10px]" style={{ color: 'var(--s2j-text-muted)' }}>{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <EditableField value={ac} multiline className="text-xs leading-relaxed"
                    style={{ color: 'var(--s2j-text-light)' }}
                    onChange={(v) => { const u = [...story.acceptance_criteria]; u[i] = v; updateAC(u); }} />
                </div>
                {(story.acceptance_criteria || []).length > 1 && (
                  <button onClick={() => deleteAC(i)}
                    className="mt-0.5 opacity-0 group-hover/ac:opacity-100 transition-all text-xs px-1"
                    style={{ color: 'var(--s2j-red)' }}>✕</button>
                )}
              </div>
            ))}
          </div>

          {/* Dependencies */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--s2j-text-muted)' }}>Dependencies</span>
              <button onClick={addDep} className="text-[11px]" style={{ color: 'var(--s2j-green)' }}>+ Add</button>
            </div>
            {(story.dependencies || []).length === 0 ? (
              <p className="text-[11px] italic" style={{ color: 'var(--s2j-text-muted)' }}>No dependencies</p>
            ) : (
              (story.dependencies || []).map((dep, i) => (
                <div key={i} className="group flex items-center gap-2">
                  <span className="text-[10px]" style={{ color: 'var(--s2j-text-muted)' }}>→</span>
                  <div className="flex-1 min-w-0">
                    <EditableField value={dep} className="text-xs" style={{ color: 'var(--s2j-text-light)' }}
                      onChange={(v) => { const u = [...story.dependencies]; u[i] = v; updateField('dependencies', u); }} />
                  </div>
                  <button onClick={() => deleteDep(i)}
                    className="opacity-0 group-hover:opacity-100 transition-all text-xs px-1"
                    style={{ color: 'var(--s2j-red)' }}>✕</button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
