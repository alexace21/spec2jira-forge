import { useState } from 'react';

/**
 * LabelsEditor — human-in-the-loop label editor for the review step.
 *
 * The reviewer adds their own JIRA labels to the Epic or a Story before push.
 * Inputs are normalized to valid JIRA labels (no spaces — lowercase kebab, the
 * same shape as the auto category label) so the push never fails on a bad label.
 * Type + Enter/comma (or blur) to add; × to remove. Duplicates are ignored.
 *
 * @param {{ labels?: string[], onChange: (labels: string[]) => void, placeholder?: string }} props
 */
export default function LabelsEditor({ labels = [], onChange, placeholder = 'add label…' }) {
  const [draft, setDraft] = useState('');

  function normalize(raw) {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function addLabel(raw) {
    const v = normalize(raw);
    setDraft('');
    if (!v || labels.includes(v)) return;
    onChange([...labels, v]);
  }

  function removeLabel(l) {
    onChange(labels.filter((x) => x !== l));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map((l) => (
        <span
          key={l}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
          style={{
            background: 'var(--s2j-bg-section)',
            color: 'var(--s2j-text-light)',
            border: '1px solid var(--s2j-border)',
          }}
        >
          {l}
          <button
            onClick={() => removeLabel(l)}
            title="Remove label"
            style={{ color: 'var(--s2j-text-muted)', lineHeight: 1 }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addLabel(draft);
          }
        }}
        onBlur={() => addLabel(draft)}
        placeholder={placeholder}
        className="text-[11px] rounded px-1.5 py-0.5"
        style={{
          background: 'var(--s2j-bg)',
          color: 'var(--s2j-text)',
          border: '1px solid var(--s2j-border)',
          minWidth: 90,
        }}
      />
    </div>
  );
}
