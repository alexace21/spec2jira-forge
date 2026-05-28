import { useState, useRef, useEffect } from 'react';

/**
 * EditableField — Inline text editor with click-to-edit behavior.
 * Light theme (Swagger palette).
 */
export default function EditableField({
  value,
  onChange,
  multiline = false,
  placeholder = 'Click to edit...',
  className = '',
  inputClassName = '',
  maxLength,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (!multiline) inputRef.current.select();
    }
  }, [editing, multiline]);

  function save() {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed !== value) onChange(trimmed);
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      cancel();
    } else if (e.key === 'Enter') {
      if (multiline) {
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); save(); }
      } else {
        e.preventDefault(); save();
      }
    }
  }

  if (editing) {
    const sharedStyle = {
      width: '100%',
      borderRadius: '4px',
      border: '1px solid var(--s2j-blue)',
      background: 'var(--s2j-bg)',
      padding: '4px 8px',
      fontSize: '0.875rem',
      color: 'var(--s2j-text)',
      outline: 'none',
      boxShadow: '0 0 0 2px rgba(97, 175, 254, 0.2)',
    };

    if (multiline) {
      return (
        <div className="relative">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={handleKeyDown}
            style={{ ...sharedStyle, minHeight: '60px', resize: 'vertical' }}
            className={inputClassName}
            maxLength={maxLength}
            rows={3}
          />
          <span className="absolute bottom-1 right-2 text-[10px]"
            style={{ color: 'var(--s2j-text-muted)' }}>
            Ctrl+Enter to save · Esc to cancel
          </span>
        </div>
      );
    }

    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        style={sharedStyle}
        className={inputClassName}
        maxLength={maxLength}
      />
    );
  }

  const isEmpty = !value || value.trim() === '';

  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-pointer rounded px-1 -mx-1 transition-colors duration-100 ${className}`}
      style={{
        ...(isEmpty ? { color: 'var(--s2j-text-muted)', fontStyle: 'italic' } : {}),
      }}
      onMouseEnter={e => e.target.style.background = 'rgba(0,0,0,0.04)'}
      onMouseLeave={e => e.target.style.background = 'transparent'}
      title="Click to edit"
    >
      {isEmpty ? placeholder : value}
    </span>
  );
}
