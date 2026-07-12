import React from "react";

/**
 * BackButton — universal top-of-content "← {label}" affordance.
 *
 * U2 part 33 (2026-05-09) — extracted to harmonize navigation across
 * all non-terminal screens. Replaces 4× duplicated inline style block
 * в App.js (ready / generating / previewing / reviewing) + Dashboard's
 * own divergent BackButton (was blue underline style).
 *
 * Unified style: a SOLID dark-blue box with white text (the .btn-nav class —
 * the "blue = navigation / go-to-a-screen" convention, 2026-06-26; back
 * navigation is wayfinding), compact sized to match the Picker "Open" row
 * buttons. btn-nav's CSS carries the box + white text + hover (darker blue).
 *
 * Skipped intentionally on:
 *   - Pushed (terminal — explicit context-specific nav buttons cover this)
 *   - Picker / Setup / Admin (terminal/initial states)
 *
 * Props:
 *   - onClick (required) — handler that navigates back
 *   - label (default "Back to picker") — button text after arrow
 *   - title (optional) — hover tooltip; screen-specific framing
 *   - ariaLabel (optional) — accessible name for keyboard/touch/screen-reader users
 *     when a consequence (e.g. "discards edits") must not be hover-only
 *   - className (default "mb-3") — wrapper className override; pass ""
 *     for no margin (e.g., when wrapping в custom flex-row layout
 *     like reviewing screen's top-bar)
 */
function BackButton({
  onClick,
  label = "Back to picker",
  title,
  ariaLabel,
  className = "mb-3",
}) {
  return (
    <button
      onClick={onClick}
      className={`btn-nav ${className}`.trim()}
      style={{ fontSize: "12.5px", padding: "6px 14px" }}
      title={title}
      aria-label={ariaLabel || undefined}
    >
      ← {label}
    </button>
  );
}

export default BackButton;
