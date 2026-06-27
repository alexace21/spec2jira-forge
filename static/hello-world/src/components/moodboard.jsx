import React from "react";
import BackButton from "./BackButton";
import { MOOD, WIZARD_WRAP, stepSurface, stepTitleStyle, stepSubStyle, Stepper, Accordion, WizardNext } from "./WizardKit";

// ── moodboard.jsx — the shared MOODBOARD KIT (app-wide design system) ────────────────────────────────────
// Phase 0 of the 6.5.0 app-wide rollout (docs/DESIGN-SYSTEM-MOODBOARD.md). This is the ONE canonical import
// for NEW screens — it RE-EXPORTS the wizard primitives that already live in ./WizardKit (so PlanScreen +
// the Test Cases wizard keep importing ./WizardKit UNCHANGED — zero churn, pixel-identical, behaviour-neutral)
// AND adds the surface/header/type primitives the rest of the app needs. Importing from "./moodboard" (not
// "./WizardKit") keeps the "wizard" smell off the non-wizard screens.
//
// INVARIANTS (every consumer): the Swagger buttons are OFF-LIMITS (green=commit / blue=nav / red=danger);
// glass fills are near-opaque (legibility NEVER depends on backdrop-filter); soft BLUE-tinted shadows, never
// gray; tokens only (note the camelCase --s2j-skySteel); Forge iframe = page-scroll, no 100vh, no internal
// scroll trap; no paid fonts (system stack, heavier/larger/navy headings).

// Re-export the wizard primitives so "./moodboard" is the single canonical kit surface.
export { MOOD, WIZARD_WRAP, stepSurface, stepTitleStyle, stepSubStyle, Stepper, Accordion, WizardNext };

// ── Type scale (codifies docs/DESIGN-SYSTEM-MOODBOARD.md §4 so inline-style drift dies) ──
export const TYPE = {
  title: { fontSize: 20, fontWeight: 700, color: MOOD.navy, letterSpacing: "-0.01em", lineHeight: 1.25, margin: 0 },
  heading: { fontSize: 14, fontWeight: 600, color: "var(--s2j-text)", margin: 0 },
  sub: { fontSize: 13.5, color: "var(--s2j-text-muted)", lineHeight: 1.55, margin: 0 },
  body: { fontSize: 14, color: "var(--s2j-text)", lineHeight: 1.55 },
  label: { fontSize: 12, fontWeight: 600, color: "var(--s2j-text-muted)" },
  micro: { fontSize: 11.5, color: "var(--s2j-text-light)", lineHeight: 1.5 },
};

// ── Spacing rhythm (16 inside cards, 24 between sections — the "whitespace is a feature" rule) ──
export const GAP = { tight: 8, row: 10, card: 16, section: 24 };

// ── Shared form-field style (Settings / Picker / selects). Pair with className="s2j-field" for the ice-tint
// focus ring (index.css) — a glassy field must NEVER read as inactive. ──
export const formFieldStyle = {
  width: "100%", padding: "9px 11px", fontSize: 13.5, boxSizing: "border-box",
  border: "1px solid var(--s2j-border)", borderRadius: 10,
  background: "var(--s2j-bg)", color: "var(--s2j-text)",
};

// ── glassSurface(density) — the canonical glass recipe in 3 densities. MAJOR reuses the proven wizard
// stepSurface (ice→white wash + glass + soft deep-blue shadow); MINOR/UTILITY are lighter for rows/list-items. ──
export function glassSurface(density = "major") {
  if (density === "utility") {
    return { background: "rgba(255,255,255,0.72)", border: "1px solid rgba(125,160,202,0.26)", borderRadius: 12, boxShadow: "0 2px 10px rgba(5,38,89,0.05)" };
  }
  if (density === "minor") {
    return { background: "rgba(255,255,255,0.72)", border: "1px solid rgba(125,160,202,0.30)", borderRadius: 14, boxShadow: "0 4px 16px rgba(5,38,89,0.06)" };
  }
  return { ...stepSurface }; // MAJOR
}

const DENSITY_PAD = { major: 24, minor: 16, utility: "10px 14px" };

// ── MoodCard — the glass surface as a component (replaces ~10+ ad-hoc inline glass blocks). Three densities:
// MAJOR (section cards), MINOR (profile/AC rows), UTILITY (list rows). Neutral by default; pass `accent`
// (a CSS color) for a left status bar. A TONED notice (warning/error) should use <SignalCallout>, not this. ──
export function MoodCard({ title, subtitle, badge, children, footer, density = "major", accent, onClick, className, style }) {
  const pad = DENSITY_PAD[density] != null ? DENSITY_PAD[density] : DENSITY_PAD.major;
  const base = {
    ...glassSurface(density),
    padding: pad,
    ...(accent ? { borderLeft: `4px solid ${accent}` } : {}),
    ...(onClick ? { cursor: "pointer", width: "100%", textAlign: "left" } : {}),
    ...style,
  };
  const inner = (
    <>
      {(title || badge) ? (
        <div className="flex items-center" style={{ justifyContent: "space-between", gap: 8, marginBottom: subtitle ? 2 : (children ? 10 : 0) }}>
          {title ? <span style={{ ...TYPE.heading, color: MOOD.navy }}>{title}</span> : <span />}
          {badge || null}
        </div>
      ) : null}
      {subtitle ? <p style={{ ...TYPE.micro, margin: "0 0 10px" }}>{subtitle}</p> : null}
      {children}
      {footer ? <div style={{ marginTop: 12 }}>{footer}</div> : null}
    </>
  );
  if (onClick) return <button type="button" onClick={onClick} className={className} style={base}>{inner}</button>;
  return <div className={className} style={base}>{inner}</div>;
}

// ── ScreenHeader — navy title + optional blue BackButton + optional action (e.g. a settings gear). Centralizes
// the Ready/Picker/Insights/Confirm header pattern. STATIC (the Forge page-scroll rule — never sticky). ──
export function ScreenHeader({ title, subtitle, icon, onBack, backLabel = "Back", backTitle, action }) {
  return (
    <div style={{ marginBottom: subtitle ? 14 : 16 }}>
      {onBack ? <BackButton onClick={onBack} label={backLabel} title={backTitle} className="mb-2" /> : null}
      <div className="flex items-center" style={{ gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
        <h2 style={{ ...TYPE.title, fontSize: 22, display: "inline-flex", alignItems: "center", gap: 10 }}>
          {icon ? <span style={{ color: "var(--s2j-blue)", display: "inline-flex" }}>{icon}</span> : null}
          {title}
        </h2>
        {action || null}
      </div>
      {subtitle ? <p style={{ ...TYPE.sub, marginTop: 4 }}>{subtitle}</p> : null}
    </div>
  );
}
