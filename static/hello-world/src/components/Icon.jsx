import React from "react";

// ── Icon.jsx — professional inline-SVG icon set (v6 UI/UX pass, 2026-06-18) ──
//
// WHY inline SVG (not an icon font / library): this is a CRA app whose
// react-scripts toolchain is fragile (CLAUDE.md: do NOT `npm audit fix --force`),
// node_modules is tracked in git, and the Forge Custom UI runs in a sandboxed
// iframe. A self-contained inline-SVG set adds ZERO dependencies, ZERO build
// risk, and renders identically in the sandbox. The set is small + curated: the
// emoji it replaces repeat across ~12 files, so ~16 icons cover ~all usages.
//
// CONTRACT (uniform across every icon):
//   - 24×24 viewBox, stroke = currentColor (inherits the parent's color), no fill
//     → a caller sets color via `style={{ color: "var(--s2j-blue)" }}` or inherits.
//   - `size` (px) sets width AND height (default 16 → inline-with-text).
//   - `title` → an accessible label + a native hover tooltip; without it the icon
//     is decorative (aria-hidden) so screen readers skip it (the adjacent text carries meaning).
//   - `style` merges onto the svg (callers pass color / vertical-align / margin).
//
// SEVERITY icons (alert-triangle / info-circle / check-circle) live in Signal.jsx —
// this file is the FUNCTIONAL/action set (copy, refresh, cost, …). Keep that split:
// severity = meaning (traffic-lights), functional = actions.

function S({ size = 16, title, style, children, viewBox = "0 0 24 24" }) {
  const a11y = title
    ? { role: "img", "aria-label": title }
    : { "aria-hidden": true, focusable: false };
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "inline-block", verticalAlign: "-0.15em", flexShrink: 0, ...style }}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

// ── Actions / objects ───────────────────────────────────────────────
export const IconCopy = (p) => (
  <S {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </S>
);

export const IconCheck = (p) => (
  <S {...p}>
    <polyline points="20 6 9 17 4 12" />
  </S>
);

export const IconRefresh = (p) => (
  <S {...p}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </S>
);

export const IconClock = (p) => (
  <S {...p}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </S>
);

export const IconCost = (p) => (
  <S {...p}>
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </S>
);

// Test cases / generation — a beaker (acceptance scenarios, BDD culture).
export const IconBeaker = (p) => (
  <S {...p}>
    <path d="M9 2v6l-5.6 9.3A2 2 0 0 0 5.1 21h13.8a2 2 0 0 0 1.7-3.7L15 8V2" />
    <line x1="8" y1="2" x2="16" y2="2" />
    <line x1="7" y1="14" x2="17" y2="14" />
  </S>
);

export const IconUndo = (p) => (
  <S {...p}>
    <polyline points="9 14 4 9 9 4" />
    <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
  </S>
);

export const IconDownload = (p) => (
  <S {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </S>
);

export const IconSearch = (p) => (
  <S {...p}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </S>
);

export const IconExternalLink = (p) => (
  <S {...p}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </S>
);

export const IconX = (p) => (
  <S {...p}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </S>
);

// Removed / blocked (⊘) — a circle with a slash.
export const IconBan = (p) => (
  <S {...p}>
    <circle cx="12" cy="12" r="10" />
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
  </S>
);

export const IconTrash = (p) => (
  <S {...p}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </S>
);

export const IconEdit = (p) => (
  <S {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </S>
);

export const IconPlus = (p) => (
  <S {...p}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </S>
);

export const IconArrowLeft = (p) => (
  <S {...p}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </S>
);

export const IconArrowRight = (p) => (
  <S {...p}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </S>
);

// ── Added in the v6 icon-sweep cleanup (leftover-glyph fixes) ────────
export const IconSettings = (p) => (
  <S {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </S>
);

export const IconLink = (p) => (
  <S {...p}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </S>
);

// Epic — a stacked-layers glyph (the Epic groups the stories beneath it).
export const IconLayers = (p) => (
  <S {...p}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </S>
);

export const IconMaximize = (p) => (
  <S {...p}>
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </S>
);

export const IconChevronRight = (p) => (
  <S {...p}>
    <polyline points="9 18 15 12 9 6" />
  </S>
);

// Capacity-Sheet Planner — a calendar (sprint planning).
export const IconCalendar = (p) => (
  <S {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </S>
);

// Team / capacity — a small users glyph for the roster section.
export const IconUsers = (p) => (
  <S {...p}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </S>
);

// Backlog / Kanban — an ordered list glyph (the pull-ready backlog, no time-boxes).
export const IconList = (p) => (
  <S {...p}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </S>
);
