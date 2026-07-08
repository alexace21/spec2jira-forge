import { useMemo, useRef, useState, useEffect } from 'react';
import { glassSurface } from '../moodboard';
import { SignalCallout } from '../Signal';
import { isPlaceholderName } from '../../lib/v3Schema';

/**
 * ReviewReadinessBar — the top "review readiness" read (pre-flight-card go/no-go mould), spanning
 * the full editor width. It is a GUIDE, never a gate: open concerns NEVER block Continue.
 *
 * Shows: a resolved/total concern progress + "N stories need your eyes" + the Epic title, and the
 * green Continue-to-Review CTA (commit intent). The tone leads with the risk — if stories still need
 * eyes it reads as attention (info/steel), only fully "clear" when nothing is outstanding.
 *
 * Props:
 *   readiness  — computeReviewReadiness(breakdown) result
 *   epicTitle  — the Epic summary (or a fallback)
 *   itemCount  — "N items will be created" tally
 *   breakdown  — the working breakdown (for the placeholder-name caution derive)
 *   onPush     — commit handler (green Continue)
 *   onReset    — revert to the pristine breakdown (armed two-step; optional)
 *   isPushing  — spinner state
 */
export default function ReviewReadinessBar({ readiness, epicTitle, itemCount, breakdown, onPush, onReset, isPushing }) {
  const total = readiness.totalConcerns || 0;
  const resolved = readiness.resolvedConcerns || 0;
  const needEyes = readiness.storiesNeedingReview || 0;
  const hasLandmine = !!readiness.landmine;
  const pct = total > 0 ? Math.round((resolved / total) * 100) : 100;

  // Placeholder-name caution (fix #8) — non-blocking: count stories still named "New Feature" /
  // "New Category" and surface it at the top (the per-story warning stays in FocusedStory).
  const placeholderCount = useMemo(() => {
    let n = 0;
    for (const cap of (breakdown && breakdown.capabilities) || []) {
      for (const f of cap.features || []) {
        if (isPlaceholderName(f && f.name)) n++;
      }
    }
    return n;
  }, [breakdown]);

  // Armed two-step Reset (window.confirm may be inert in the Forge sandbox). First click arms +
  // relabels; second (within 4s) resets; auto-disarm on blur/timeout.
  const [resetArmed, setResetArmed] = useState(false);
  const resetTimer = useRef(null);
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  // Tone: attention (steel) while stories need eyes; trust (teal) only when the review load is clear
  // AND there is no pinned landmine. The bar must NEVER read fully "all clear" over a red landmine.
  const clear = needEyes === 0 && !hasLandmine;
  const accent = clear ? 'var(--s2j-trust)' : 'var(--s2j-info)';

  return (
    <div className="rounded-lg" style={{
      ...glassSurface('minor'),
      borderLeft: `4px solid ${accent}`,
      padding: 16,
    }}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--s2j-text-muted)' }}>Review readiness</span>
          </div>
          {/* The headline read — a fast glance for the BA. Dark words; the count carries weight. */}
          <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--s2j-text)' }}>
            {epicTitle}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--s2j-text-light)' }}>
            {needEyes > 0 ? (
              <>
                <span style={{ fontWeight: 600, color: 'var(--s2j-text)' }}>
                  {needEyes} stor{needEyes === 1 ? 'y' : 'ies'} need your eyes
                </span>
                {' '}before this becomes real Jira issues.
                {hasLandmine && <> There is also a flag that needs sign-off (below).</>}
              </>
            ) : hasLandmine ? (
              <>Stories look reviewed, but there is a flag below that still needs sign-off before you push.</>
            ) : (
              <>Every flagged story has been reviewed. Give it a final look, then continue.</>
            )}
          </p>
          {/* Concern-resolution progress (only when there ARE per-story concerns to resolve). */}
          {total > 0 && (
            <div className="mt-2 flex items-center gap-2" style={{ maxWidth: 320 }}>
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--s2j-border)' }}>
                <div className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${pct}%`,
                    background: resolved === total ? 'var(--s2j-trust)' : 'var(--s2j-info)',
                  }} />
              </div>
              <span className="text-[11px] font-mono shrink-0" style={{ color: 'var(--s2j-text-light)' }}>
                {resolved}/{total} concerns handled
              </span>
            </div>
          )}
          {/* Placeholder-name caution (non-blocking) — surfaced up top so an unedited "New Feature"
              isn't only visible once you open the story. Does NOT disable Continue. */}
          {placeholderCount > 0 && (
            <div className="mt-2" style={{ maxWidth: 420 }}>
              <SignalCallout kind="warning" fontSize={11}>
                <span>
                  {placeholderCount} stor{placeholderCount === 1 ? 'y is' : 'ies are'} still named "New Feature" — rename {placeholderCount === 1 ? 'it' : 'them'} before you push.
                </span>
              </SignalCallout>
            </div>
          )}
        </div>

        {/* Continue — commit (green). Non-blocking: always enabled (except while pushing). */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <button onClick={onPush} disabled={isPushing} className="btn-primary">
            {isPushing ? (
              <>
                <SpinnerInline />
                Creating in Jira...
              </>
            ) : (
              'Continue to Review →'
            )}
          </button>
          <span className="text-[11px]" style={{ color: 'var(--s2j-text-muted)' }}>
            {itemCount} items will be created
          </span>
          {/* Low-prominence, destructive Reset — armed two-step (Forge sandbox may ignore
              window.confirm). First click relabels to "Discard all edits?", second reverts. */}
          {onReset && (
            <button
              type="button"
              onClick={() => {
                if (!resetArmed) {
                  setResetArmed(true);
                  clearTimeout(resetTimer.current);
                  resetTimer.current = setTimeout(() => setResetArmed(false), 4000);
                  return;
                }
                clearTimeout(resetTimer.current);
                setResetArmed(false);
                onReset();
              }}
              onBlur={() => setResetArmed(false)}
              disabled={isPushing}
              className="text-[11px] transition-colors"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--s2j-red)',
                cursor: isPushing ? 'not-allowed' : 'pointer',
                padding: '2px 0',
                fontWeight: resetArmed ? 600 : 400,
              }}
              title={resetArmed ? 'Click again to confirm and discard all edits' : "Revert every edit back to the AI's generated breakdown"}
            >
              {resetArmed ? 'Discard all edits?' : 'Reset'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SpinnerInline() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
      aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" />
      <path d="M14.5 8a6.5 6.5 0 00-6.5-6.5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate"
          from="0 8 8" to="360 8 8" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}
