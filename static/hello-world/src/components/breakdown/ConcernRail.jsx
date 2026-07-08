import { useState } from 'react';
import { SignalIcon } from '../Signal';
import { IconUndo } from '../Icon';
import { glassSurface, MOOD } from '../moodboard';
import {
  parseConcernPrefix,
  SEVERITY_PALETTE,
  CONCERN_TYPE_LABEL,
  concernIdFor,
  getConcernDisposition,
} from '../../lib/v3Schema';
import { confidenceToken, StatusDot } from './signalTokens.jsx';

/**
 * ConcernRail — the RIGHT pane of the 6A three-pane editor. The story's AI-flagged concerns
 * MOVED OUT of FocusedStory's body live here. When a STORY is focused it shows "N open · N resolved"
 * + one "AI FLAGGED" card per concern (severity dot + type label + text + Edit-to-fix / Accept /
 * Dismiss / Undo) + a "WHY THIS SCORE" confidence explainer. When Shared-AC or Epic is selected it
 * shows a short context note. The disposition mutate rides the SAME breakdown (via onSetConcern ->
 * setConcernDisposition upstream) so the top readiness bar + worklist badges update.
 *
 * INVARIANT: this is a STICKY column in Agent A's grid, NOT an internally-scrolling pane — it flows
 * in the page (no overflow:auto, no 100vh).
 *
 * Props:
 *   feature      — the focused feature (story mode) or null (shared/epic mode)
 *   breakdown    — the whole working breakdown (disposition reads)
 *   onSetConcern(concernId, state, reason) — disposition mutate (BreakdownEditor's setConcern)
 *   mode         — 'story' | 'shared' | 'epic'
 */
export default function ConcernRail({ feature, breakdown, onSetConcern, mode }) {
  // Non-story modes (shared-AC allocation / epic edit) — a short context note, no concern cards.
  if (mode !== 'story' || !feature) {
    return (
      <aside aria-label="AI concern rail" className="rounded-lg" style={{ ...glassSurface('minor'), padding: 16 }}>
        <RailHeader />
        <p role="note" className="text-[11px] leading-relaxed mt-2" style={{ color: 'var(--s2j-text-light)' }}>
          AI concerns are story-level. They appear here when you select a story. Shared-AC and epic edits
          have no scored concerns.
        </p>
      </aside>
    );
  }

  const concerns = Array.isArray(feature.concerns) ? feature.concerns : [];

  // Open/resolved rollup — derived from the CURRENT concerns + their dispositions (single source of
  // truth with computeReviewReadiness upstream). An empty concern list reads "nothing flagged", NOT
  // "all clear" — that distinction is honest and keeps the empty state truthful.
  let open = 0;
  let resolved = 0;
  for (let i = 0; i < concerns.length; i++) {
    const disp = getConcernDisposition(breakdown, concernIdFor(feature._uid, i));
    if (disp.state === 'open') open += 1;
    else resolved += 1;
  }

  const conf = confidenceToken(feature.confidence_indicator, feature.confidence_score ?? feature.confidence);

  return (
    <aside aria-label="AI concern rail" className="rounded-lg" style={{ ...glassSurface('minor'), padding: 16 }}>
      <RailHeader />

      {/* Open / resolved rollup for THIS story. Numbers dark; the small dots carry the tone. */}
      <div className="flex items-center gap-3 mt-2 mb-3 text-[11px]" style={{ color: 'var(--s2j-text)' }}>
        {concerns.length === 0 ? (
          <span style={{ color: 'var(--s2j-text-muted)' }}>Nothing flagged on this story.</span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5">
              <StatusDot color={open > 0 ? 'var(--s2j-orange)' : 'var(--s2j-text-muted)'} size={7} />
              <span className="font-medium">{open}</span> open
            </span>
            <span className="inline-flex items-center gap-1.5">
              <StatusDot color={resolved > 0 ? 'var(--s2j-trust)' : 'var(--s2j-text-muted)'} size={7} />
              <span className="font-medium">{resolved}</span> resolved
            </span>
          </>
        )}
      </div>

      {/* Resolution banner — the USER's action is the visible change (the AI score is fixed by design). */}
      {concerns.length > 0 && open === 0 && (
        <div className="rounded p-2 mb-3 flex items-center gap-1.5" style={{ background: 'var(--s2j-trust-bg)', border: '1px solid var(--s2j-trust-border)' }}>
          <StatusDot color="var(--s2j-trust)" size={7} />
          <span className="text-[11px] font-medium" style={{ color: 'var(--s2j-text)' }}>All {resolved} concern{resolved === 1 ? '' : 's'} addressed — you have reviewed this story.</span>
        </div>
      )}

      {/* AI FLAGGED cards. */}
      {concerns.length > 0 && (
        <div className="space-y-2 mb-3">
          {concerns.map((raw, i) => {
            const concernId = concernIdFor(feature._uid, i);
            return (
              <ConcernCard
                key={concernId}
                raw={raw}
                concernId={concernId}
                breakdown={breakdown}
                onSetConcern={onSetConcern}
              />
            );
          })}
        </div>
      )}

      {/* WHY THIS SCORE — the confidence explainer (from the machine's own read). */}
      <div className="rounded-lg p-3" style={{ background: 'var(--s2j-bg-section)', border: '1px solid var(--s2j-border)' }}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--s2j-text-muted)' }}>
            Why this score
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs mb-1.5" style={{ color: 'var(--s2j-text)' }}>
          <StatusDot color={conf.fg} size={7} />
          <span className="font-medium">{conf.label}</span>
          {conf.score != null && (
            <span className="font-mono" style={{ color: 'var(--s2j-text-light)' }}>{conf.score}/100</span>
          )}
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--s2j-text-light)' }}>{conf.explain}</p>
        <p className="text-[10px] mt-1.5" style={{ color: 'var(--s2j-text-muted)' }}>This is the AI's original read of extraction quality — it does not change as you resolve concerns.</p>
      </div>
    </aside>
  );
}

function RailHeader() {
  return (
    <div className="flex items-center gap-1.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: MOOD.navy, margin: 0 }}>
        AI concerns
      </h3>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ConcernCard — one AI FLAGGED concern (Accept / Dismiss / Edit-to-fix / Undo)
// ════════════════════════════════════════════════════════════
function ConcernCard({ raw, concernId, breakdown, onSetConcern }) {
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState('');
  const { type, severity, text } = parseConcernPrefix(raw);
  const palette = SEVERITY_PALETTE[severity] || SEVERITY_PALETTE.medium;
  const typeLabel = CONCERN_TYPE_LABEL[type] || type;
  const disp = getConcernDisposition(breakdown, concernId);
  const resolved = disp.state !== 'open';

  // Resolved cards drop to the calm TRUST tone; open cards keep their severity tint (a true signal).
  const cardStyle = resolved
    ? { background: 'var(--s2j-trust-bg)', border: '1px solid var(--s2j-trust-border)' }
    : { background: palette.bg, border: `1px solid ${palette.border}` };

  const stateLabel =
    disp.state === 'accepted' ? "Accepted — the AI's read stands"
      : disp.state === 'edited' ? 'Marked as edited — you addressed it in the fields'
        : disp.state === 'dismissed' ? 'Dismissed' : null;

  // Severity word for the "High · Risk" header (words dark; the DOT carries colour).
  const sevWord = severity ? severity.charAt(0).toUpperCase() + severity.slice(1) : '';

  return (
    <div className="rounded p-2" style={cardStyle}>
      {/* AI FLAGGED lead — a small flag/star + the machine attribution. */}
      <div className="flex items-center gap-1 mb-1">
        <span aria-hidden="true" className="inline-flex" style={{ color: resolved ? 'var(--s2j-trust)' : palette.text }}>
          <FlagGlyph size={11} />
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--s2j-text-muted)' }}>
          AI flagged
        </span>
      </div>

      {/* "High · Risk" — colour on the dot, both WORDS dark (WCAG on the glass tint). */}
      <div className="flex items-center gap-1.5 mb-1">
        <StatusDot color={resolved ? 'var(--s2j-trust)' : palette.text} size={7} />
        <span className="text-[11px] font-semibold" style={{ color: 'var(--s2j-text)' }}>
          {sevWord}{sevWord && typeLabel ? ' · ' : ''}{typeLabel}
        </span>
      </div>

      <p className="text-xs leading-relaxed mb-1.5" style={{ color: 'var(--s2j-text)' }}>{text}</p>

      {resolved ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[11px]">
            <SignalIcon kind="success" size={13} style={{ color: 'var(--s2j-trust)' }} />
            <span style={{ color: 'var(--s2j-text-light)' }}>{stateLabel}</span>
          </span>
          {disp.state === 'dismissed' && disp.reason && (
            <span className="text-[11px] italic" style={{ color: 'var(--s2j-text-muted)' }}>"{disp.reason}"</span>
          )}
          <button
            onClick={() => onSetConcern(concernId, 'open')}
            className="ml-auto inline-flex items-center gap-1 text-[11px]"
            style={{ background: 'none', border: 'none', color: 'var(--s2j-blue)', cursor: 'pointer', padding: 0 }}
            title="Reopen this concern">
            <IconUndo size={12} /> Undo
          </button>
        </div>
      ) : dismissing ? (
        <div className="flex items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Reason this concern is not a problem"
            placeholder="Why is this not a problem?"
            className="flex-1 text-[11px] rounded px-2 py-1 s2j-field"
            style={{ background: 'var(--s2j-bg)', color: 'var(--s2j-text)', border: '1px solid var(--s2j-border)' }}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && reason.trim()) onSetConcern(concernId, 'dismissed', reason.trim());
              if (e.key === 'Escape') { setDismissing(false); setReason(''); }
            }}
          />
          <button
            onClick={() => reason.trim() && onSetConcern(concernId, 'dismissed', reason.trim())}
            disabled={!reason.trim()}
            className="text-[11px] font-medium"
            style={{ background: 'none', border: 'none', color: reason.trim() ? 'var(--s2j-text)' : 'var(--s2j-text-muted)', cursor: reason.trim() ? 'pointer' : 'not-allowed', padding: '2px 4px' }}>
            Save
          </button>
          <button
            onClick={() => { setDismissing(false); setReason(''); }}
            className="text-[11px]"
            style={{ background: 'none', border: 'none', color: 'var(--s2j-text-muted)', cursor: 'pointer', padding: '2px 4px' }}>
            Cancel
          </button>
        </div>
      ) : (
        // Open — the three review actions. Edit-to-fix = BLUE (nav intent: go work the fields);
        // Accept / Dismiss = STATE changes (trust / neutral tones + icons, NOT action buttons).
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              onSetConcern(concernId, 'edited');
              // Move the reviewer to the acceptance-criteria section (where most fixes land) — best-effort.
              const ac = document.getElementById('s2j-focused-ac');
              if (ac && ac.scrollIntoView) ac.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }}
            className="inline-flex items-center gap-1 text-[11px] font-medium"
            style={{ background: 'none', border: 'none', color: 'var(--s2j-blue)', cursor: 'pointer', padding: 0 }}
            title="You will fix this in the story fields — mark it addressed">
            Edit to fix
          </button>
          <button
            onClick={() => onSetConcern(concernId, 'accepted')}
            className="inline-flex items-center gap-1 text-[11px] font-medium"
            style={{ background: 'none', border: 'none', color: 'var(--s2j-trust)', cursor: 'pointer', padding: 0 }}
            title="The AI's read stands — note it on the story and move on">
            <SignalIcon kind="success" size={13} style={{ color: 'var(--s2j-trust)' }} /> Accept
          </button>
          <button
            onClick={() => setDismissing(true)}
            className="inline-flex items-center gap-1 text-[11px]"
            style={{ background: 'none', border: 'none', color: 'var(--s2j-text-muted)', cursor: 'pointer', padding: 0 }}
            title="Not a problem — record a reason">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

// A small flag glyph (the "AI flagged" marker). Inline SVG, inherits currentColor.
function FlagGlyph({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }} aria-hidden="true">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}
