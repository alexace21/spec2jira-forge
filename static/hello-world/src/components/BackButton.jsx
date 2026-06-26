import React from "react";

/**
 * BackButton — universal top-of-content "← {label}" affordance.
 *
 * U2 part 33 (2026-05-09) — extracted to harmonize navigation across
 * all non-terminal screens. Replaces 4× duplicated inline style block
 * в App.js (ready / generating / previewing / reviewing) + Dashboard's
 * own divergent BackButton (was blue underline style).
 *
 * Unified style: BLUE text (the "blue = navigation / go-to-a-screen" convention,
 * 2026-06-26 — back navigation is wayfinding) → on hover a subtle blue-tint
 * background + darker blue. Left-aligned via negative margin so the visual left
 * edge sits flush with content edge, despite button padding.
 *
 * Skipped intentionally on:
 *   - Pushed (terminal — explicit context-specific nav buttons cover this)
 *   - Picker / Setup / Admin (terminal/initial states)
 *
 * Props:
 *   - onClick (required) — handler that navigates back
 *   - label (default "Back to picker") — button text after arrow
 *   - title (optional) — hover tooltip; screen-specific framing
 *   - className (default "mb-3") — wrapper className override; pass ""
 *     for no margin (e.g., when wrapping в custom flex-row layout
 *     like reviewing screen's top-bar)
 */
function BackButton({
  onClick,
  label = "Back to picker",
  title,
  className = "mb-3",
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs flex items-center gap-1.5 ${className}`.trim()}
      style={{
        background: "none",
        border: "none",
        color: "var(--s2j-blue)",
        cursor: "pointer",
        padding: "4px 8px",
        borderRadius: "4px",
        transition: "all 0.15s",
        marginLeft: "-8px",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--s2j-blue-bg)";
        e.currentTarget.style.color = "var(--s2j-blue-dark)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "none";
        e.currentTarget.style.color = "var(--s2j-blue)";
      }}
      title={title}
    >
      ← {label}
    </button>
  );
}

export default BackButton;
