import React from "react";

// ── Signal.jsx — traffic-light severity system (v6 UI/UX pass, 2026-06-18) ──
//
// Partner-defined vocabulary (one consistent severity language across the app):
//   error   → RED triangle      — something failed / blocks the user
//   warning → AMBER triangle     — proceed with care (this is irreversible, ACs changed…)
//   info    → BLUE circle-i      — neutral guidance; full verbatim text in the hover tooltip
//   success → GREEN check-circle  — a positive terminal state (kept minimal)
//
// Replaces ad-hoc emoji (⚠ ⓘ ℹ ✓ ⊘ …) so the UI reads professional to a senior
// BA/PO. Two shapes:
//   <SignalIcon kind title/>          — an inline colored glyph to sit before short status text.
//   <SignalCallout kind title>…</…>   — a boxed notice (tinted bg + border + icon + body).
//
// ⚠ PALETTE NOTE (load-bearing): the Swagger palette's severity colors are LIGHT
// (--s2j-blue #61affe, --s2j-orange #fca130). Light-on-light-tint is unreadable, so a
// SignalCallout keeps its BODY TEXT dark (--s2j-text) and lets the ICON + border carry the
// colour. (This is exactly the Picker-notice readability fix.) Inline SignalIcon sits on the
// white surface, so there the glyph itself is the severity colour.

const TONE = {
  error: { fg: "var(--s2j-red)", bg: "var(--s2j-red-bg)", border: "var(--s2j-red-border)" },
  warning: { fg: "var(--s2j-orange)", bg: "var(--s2j-orange-bg)", border: "var(--s2j-orange-border)" },
  info: { fg: "var(--s2j-blue)", bg: "var(--s2j-blue-bg)", border: "var(--s2j-blue-border)" },
  success: { fg: "var(--s2j-green)", bg: "var(--s2j-green-bg)", border: "var(--s2j-green-border)" },
};

// The raw glyph — inherits color via currentColor (the wrapper sets the color).
function Glyph({ kind, size = 16, title }) {
  const a11y = title
    ? { role: "img", "aria-label": title }
    : { "aria-hidden": true, focusable: false };
  let body;
  if (kind === "info") {
    body = (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </>
    );
  } else if (kind === "success") {
    body = (
      <>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </>
    );
  } else {
    // error | warning — the same triangle; COLOUR is the differentiator (partner's spec).
    body = (
      <>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block" }}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      {body}
    </svg>
  );
}

// Inline severity marker — a colored glyph to place before short status text.
// `title` gives the hover tooltip (the "verbatim for users" info pattern).
export function SignalIcon({ kind = "info", title, size = 16, style }) {
  const c = TONE[kind] || TONE.info;
  return (
    <span
      style={{
        color: c.fg,
        display: "inline-flex",
        verticalAlign: "-0.15em",
        flexShrink: 0,
        ...style,
      }}
    >
      <Glyph kind={kind} size={size} title={title} />
    </span>
  );
}

// Boxed notice — tinted bg + border + severity icon + dark readable body.
// `title` = an optional bold lead line; `iconTitle` = the icon's hover tooltip.
export function SignalCallout({ kind = "info", title, children, style, iconTitle, fontSize = 13 }) {
  const c = TONE[kind] || TONE.info;
  return (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        ...style,
      }}
    >
      <span style={{ color: c.fg, display: "inline-flex", flexShrink: 0, marginTop: 1 }}>
        <Glyph kind={kind} size={18} title={iconTitle} />
      </span>
      <div style={{ color: "var(--s2j-text)", fontSize, lineHeight: 1.5, minWidth: 0 }}>
        {title ? (
          <div style={{ fontWeight: 500, marginBottom: children ? 2 : 0 }}>{title}</div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
