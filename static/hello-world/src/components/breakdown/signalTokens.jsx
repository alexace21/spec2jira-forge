// signalTokens.jsx — the shared severity/status visual language for the review workbench.
//
// INVARIANT (from the design brief): severity/status stays a TRUE signal, WCAG on the near-white glass
// → the status WORD stays dark (var(--s2j-text) / -light), the COLOUR rides the ICON or a small badge
// dot. A coloured word on white fails AA (it bit the last two screens). So these helpers return a
// { fg, bg, border, label, glyph, explain } cluster: `fg` is for the icon/dot only; the caller renders
// the word in a dark colour.

// confidence indicator -> the icon colour + a persistent explanation (NOT hover-only).
export function confidenceToken(indicator, score) {
  if (indicator === '✓') return {
    fg: 'var(--s2j-trust)', glyph: '✓', label: 'Confident',
    explain: 'Confident — clean extraction, little or no guesswork. A quick check is still worth it.',
    score,
  };
  if (indicator === '⚠') return {
    fg: 'var(--s2j-orange)', glyph: '⚠', label: 'Unsure',
    explain: 'Unsure — the AI inferred or assumed some details. Review this story.',
    score,
  };
  if (indicator === '✗') return {
    fg: 'var(--s2j-red)', glyph: '✗', label: 'Low confidence',
    explain: 'Low confidence — the page was vague or contradictory here. Manual review essential.',
    score,
  };
  // Unrated — a legacy / partial-stamp feature. Visible, NOT silent, and NEVER "all clear".
  return {
    fg: 'var(--s2j-text-muted)', glyph: '?', label: 'Unrated',
    explain: 'Unrated — the AI did not record a confidence signal for this story. Treat it as unreviewed.',
    score: null,
  };
}

// complexity_score 1-5 -> icon colour + label. Low (1-2) trust, mid (3) neutral, high (4-5) caution.
export function complexityToken(score) {
  if (typeof score !== 'number') return null;
  if (score <= 2) return { fg: 'var(--s2j-trust)' };
  if (score === 3) return { fg: 'var(--s2j-text-light)' };
  return { fg: 'var(--s2j-orange)' };
}

// priority string -> icon colour. High = caution-red dot, Medium neutral, Low muted.
export function priorityToken(priority) {
  const k = String(priority || '').toLowerCase();
  if (k === 'high') return { fg: 'var(--s2j-red)' };
  if (k === 'medium') return { fg: 'var(--s2j-text-light)' };
  if (k === 'low') return { fg: 'var(--s2j-text-muted)' };
  return null;
}

// A small coloured dot (severity/status colour) that sits BEFORE a dark word — the WCAG-safe pattern.
export function StatusDot({ color, size = 8, style }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

// ConfidenceGlyph — the worklist confidence icon (check-circle / triangle / diamond / question-circle),
// COLOUR on the icon (via the confidence token's fg), the caller keeps the word dark. Indicators match
// confidenceToken exactly: check ('✓') -> Confident, warning-triangle ('⚠') -> Needs attention,
// ballot-X ('✗') -> Anomaly/low, anything else -> Unrated.
export function ConfidenceGlyph({ indicator, size = 16, title }) {
  const tok = confidenceToken(indicator);
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true, focusable: false };
  let body;
  if (indicator === '✓') { // check-circle -> Confident (trust)
    body = (<><circle cx="12" cy="12" r="9" /><polyline points="8.5 12.5 11 15 15.5 9.5" /></>);
  } else if (indicator === '⚠') { // triangle -> Needs attention (amber)
    body = (<><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="14" /><line x1="12" y1="17.5" x2="12.01" y2="17.5" /></>);
  } else if (indicator === '✗') { // diamond -> Anomaly / low confidence (red)
    body = (<><path d="M12 2.5 L21.5 12 L12 21.5 L2.5 12 Z" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /></>);
  } else { // question-circle -> Unrated (muted)
    body = (<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" /><line x1="12" y1="16.5" x2="12.01" y2="16.5" /></>);
  }
  return (
    <span style={{ color: tok.fg, display: 'inline-flex', flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }} {...a11y}>
        {title ? <title>{title}</title> : null}
        {body}
      </svg>
    </span>
  );
}
