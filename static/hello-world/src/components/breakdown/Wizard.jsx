import { useState, useMemo, useRef, useEffect } from 'react';
import { IconX, IconSearch } from '../Icon';
import { MOOD } from '../moodboard';

const SP_OPTIONS = [1, 2, 3, 5, 8, 13];

/**
 * Wizard — ONE focused-overlay shell, two kinds, for the 6A editor:
 *   kind='assign'   — allocate a shared acceptance criterion to a story: shows the SAC text + a
 *                     searchable, category-grouped story RADIO list; commit ("Assign to this story")
 *                     is disabled until a story is picked. Submit -> { uid }.
 *   kind='newstory' — create a story: CATEGORY (segmented, from the breakdown's existing categories,
 *                     with the current selection's category pre-picked) + NAME (text) + optional SP
 *                     (segmented Fibonacci). Commit ("Create story"). Submit -> { category, name, storyPoints }.
 *
 * A FIXED-position modal (index.css .s2j-wizard-backdrop / -panel) so it overlays WITHOUT displacing the
 * editor (the Forge page-scroll invariant — the editor beneath never gets a bounded height). Esc / the
 * backdrop / Cancel close it. Green commit (commit intent), ghost Cancel.
 *
 * Props:
 *   kind         — 'assign' | 'newstory'
 *   breakdown    — the working breakdown (for the SAC text + the existing categories)
 *   allFeatures  — [{ uid, name, category }] (the assign story list; current names)
 *   sacId        — (assign) the shared-AC item id being allocated
 *   defaultCategory — (newstory) the category to pre-select (the current selection's category)
 *   onClose()    — dismiss without committing
 *   onSubmit(payload) — commit: assign -> { uid }; newstory -> { category, name, storyPoints }
 */
export default function Wizard({ kind, breakdown, allFeatures = [], sacId, defaultCategory, onClose, onSubmit }) {
  const panelRef = useRef(null);

  // Esc-to-close + focus the panel on open (SR lands inside the modal, not the page behind).
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    if (panelRef.current && typeof panelRef.current.focus === 'function') {
      try { panelRef.current.focus(); } catch (_) {}
    }
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isAssign = kind === 'assign';
  const title = isAssign ? 'Assign shared acceptance criterion' : 'Create a new story';
  const subtitle = isAssign
    ? 'Allocate this criterion to the one story it governs.'
    : 'Add a story to the breakdown. Rename it and flesh it out after.';

  return (
    <div
      className="s2j-wizard-backdrop"
      // Click the backdrop (not the panel) to dismiss.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="s2j-wizard-panel"
        style={{ outline: 'none' }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--s2j-border)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 className="text-base font-semibold" style={{ color: MOOD.navy, margin: 0 }}>{title}</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--s2j-text-muted)', margin: '2px 0 0' }}>{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 transition-colors"
            style={{ color: 'var(--s2j-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--s2j-bg-section)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <IconX size={18} />
          </button>
        </div>

        {isAssign ? (
          <AssignBody breakdown={breakdown} allFeatures={allFeatures} sacId={sacId} onClose={onClose} onSubmit={onSubmit} />
        ) : (
          <NewStoryBody breakdown={breakdown} defaultCategory={defaultCategory} onClose={onClose} onSubmit={onSubmit} />
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ASSIGN — SAC text + searchable, category-grouped story radio list
// ════════════════════════════════════════════════════════════
function AssignBody({ breakdown, allFeatures, sacId, onClose, onSubmit }) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null); // the chosen story uid

  const sacItem = useMemo(
    () => (breakdown?.shared_acceptance_criteria?.items || []).find((i) => i.id === sacId) || null,
    [breakdown, sacId]
  );

  // The story currently holding this SAC (so the modal can show "already assigned to X").
  const currentUid = sacItem?.assigned_feature || null;

  // On a REASSIGN (the SAC already has an assigned story), pre-select it so the current story is
  // pre-checked — one fewer click. A first-time assign stays null (nothing pre-picked).
  useEffect(() => { if (currentUid) setPicked(currentUid); }, [currentUid]);

  // Filter by name/category (case-insensitive), then group by category (preserve first-seen order).
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = allFeatures.filter((f) => {
      if (!q) return true;
      return (f.name || '').toLowerCase().includes(q) || (f.category || '').toLowerCase().includes(q);
    });
    const byCat = new Map();
    for (const f of filtered) {
      const cat = f.category || 'Uncategorised';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(f);
    }
    return Array.from(byCat.entries()).map(([category, rows]) => ({ category, rows }));
  }, [allFeatures, query]);

  const noneMatch = groups.length === 0;

  return (
    <>
      <div className="s2j-wizard-body space-y-3">
        {/* The SAC text being allocated */}
        {sacItem && (
          <div className="rounded-lg px-3 py-2.5" style={{ background: 'var(--s2j-info-bg)', border: '1px solid var(--s2j-info-border)' }}>
            <div className="flex items-start gap-2">
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono font-medium"
                style={{ background: 'var(--s2j-bg)', color: 'var(--s2j-text-light)', border: '1px solid var(--s2j-border)' }}>
                {sacItem.id}
              </span>
              <p className="text-xs leading-relaxed flex-1" style={{ color: 'var(--s2j-text)' }}>{sacItem.text}</p>
            </div>
          </div>
        )}

        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--s2j-text-muted)' }}>
            Assign to which story?
          </span>
          {/* Search box */}
          <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 mb-2"
            style={{ border: '1px solid var(--s2j-border)', background: 'var(--s2j-bg)' }}>
            <span style={{ color: 'var(--s2j-text-muted)' }}><IconSearch size={14} /></span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search stories or categories..."
              className="flex-1 text-xs outline-none"
              style={{ background: 'transparent', color: 'var(--s2j-text)', border: 'none' }}
              aria-label="Search stories"
              autoFocus
            />
          </div>

          {/* Grouped radio list */}
          {noneMatch ? (
            <p className="text-xs italic px-1 py-3" style={{ color: 'var(--s2j-text-muted)' }}>
              No stories match "{query}".
            </p>
          ) : (
            <div className="space-y-2" role="radiogroup" aria-label="Assign to which story">
              {groups.map((g) => (
                <div key={g.category}>
                  <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--s2j-text-muted)' }}>
                    {g.category}
                  </div>
                  <div className="space-y-1">
                    {g.rows.map((f) => {
                      const selected = picked === f.uid;
                      const isCurrent = currentUid === f.uid;
                      return (
                        <button
                          key={f.uid}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setPicked(f.uid)}
                          className="w-full text-left rounded-md px-2.5 py-2 flex items-center gap-2.5 transition-colors"
                          style={{
                            border: selected ? '1px solid var(--s2j-blue)' : '1px solid var(--s2j-border)',
                            background: selected ? 'var(--s2j-blue-bg)' : 'var(--s2j-bg)',
                          }}
                          onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'var(--s2j-bg-section)'; }}
                          onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'var(--s2j-bg)'; }}
                        >
                          <span aria-hidden="true" className="shrink-0 inline-flex items-center justify-center rounded-full"
                            style={{
                              width: 15, height: 15,
                              border: `1.5px solid ${selected ? 'var(--s2j-blue)' : 'var(--s2j-text-muted)'}`,
                            }}>
                            {selected && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--s2j-blue)' }} />}
                          </span>
                          <span className="flex-1 truncate text-xs font-medium" style={{ color: 'var(--s2j-text)' }}>
                            {f.name}
                          </span>
                          {isCurrent && (
                            <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                              style={{ background: 'var(--s2j-trust-bg)', color: 'var(--s2j-trust)', border: '1px solid var(--s2j-trust-border)' }}>
                              Current
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <WizardFooter
        onClose={onClose}
        onSubmit={() => picked && onSubmit({ uid: picked })}
        commitLabel="Assign to this story"
        commitDisabled={!picked}
      />
    </>
  );
}

// ════════════════════════════════════════════════════════════
// NEW STORY — category segmented + name + optional Fibonacci SP
// ════════════════════════════════════════════════════════════
function NewStoryBody({ breakdown, defaultCategory, onClose, onSubmit }) {
  // Existing categories, de-duplicated in first-seen order.
  const categories = useMemo(() => {
    const seen = [];
    for (const cap of breakdown?.capabilities || []) {
      const n = cap && cap.name;
      if (n && !seen.includes(n)) seen.push(n);
    }
    return seen;
  }, [breakdown]);

  const [category, setCategory] = useState(
    defaultCategory && categories.includes(defaultCategory) ? defaultCategory : (categories[0] || '')
  );
  const [name, setName] = useState('');
  const [sp, setSp] = useState(3); // Fibonacci default

  const nameRef = useRef(null);
  useEffect(() => { if (nameRef.current) { try { nameRef.current.focus(); } catch (_) {} } }, []);

  const canSubmit = !!name.trim();

  function submit() {
    if (!canSubmit) return;
    onSubmit({ category: category || (categories[0] || ''), name: name.trim(), storyPoints: sp });
  }

  return (
    <>
      <div className="s2j-wizard-body space-y-4">
        {/* CATEGORY (segmented) — only when there is >1 category to choose from. */}
        {categories.length > 0 && (
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--s2j-text-muted)' }}>
              Category
            </span>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((c) => {
                const on = c === category;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    aria-pressed={on}
                    className="rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      border: on ? '1px solid var(--s2j-blue)' : '1px solid var(--s2j-border)',
                      background: on ? 'var(--s2j-blue-bg)' : 'var(--s2j-bg)',
                      color: 'var(--s2j-text)',
                    }}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* NAME */}
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--s2j-text-muted)' }}>
            Story name
          </label>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) submit(); }}
            placeholder="e.g. Rate-limit the export endpoint"
            className="w-full rounded-lg px-3 py-2 text-sm s2j-field"
            style={{ background: 'var(--s2j-bg)', color: 'var(--s2j-text)', border: '1px solid var(--s2j-border)' }}
            aria-label="Story name"
          />
        </div>

        {/* SP (optional Fibonacci segmented) */}
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--s2j-text-muted)' }}>
            Story points <span className="font-normal normal-case" style={{ color: 'var(--s2j-text-muted)' }}>(optional)</span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {SP_OPTIONS.map((v) => {
              const on = sp === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSp(v)}
                  aria-pressed={on}
                  className="rounded-md text-xs font-mono font-medium transition-colors"
                  style={{
                    minWidth: 34, padding: '6px 0',
                    border: on ? '1px solid var(--s2j-blue)' : '1px solid var(--s2j-border)',
                    background: on ? 'var(--s2j-blue-bg)' : 'var(--s2j-bg)',
                    color: 'var(--s2j-text)',
                  }}
                >
                  {v}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <WizardFooter
        onClose={onClose}
        onSubmit={submit}
        commitLabel="Create story"
        commitDisabled={!canSubmit}
      />
    </>
  );
}

// ── Shared footer: ghost Cancel + GREEN commit ──
function WizardFooter({ onClose, onSubmit, commitLabel, commitDisabled }) {
  return (
    <div className="flex items-center justify-end gap-2 px-5 py-3" style={{ borderTop: '1px solid var(--s2j-border)' }}>
      <button
        type="button"
        onClick={onClose}
        className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
        style={{ background: 'transparent', border: '1px solid var(--s2j-border)', color: 'var(--s2j-text-light)', cursor: 'pointer' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--s2j-bg-section)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={commitDisabled}
        className="btn-primary text-xs"
      >
        {commitLabel}
      </button>
    </div>
  );
}
