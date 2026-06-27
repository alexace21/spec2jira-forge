import React, { useState } from "react";
import { SignalIcon } from "./Signal";

// ── Wizard kit — shared moodboard wizard primitives ───────────────────────────────────────────────
// Extracted (2026-06-27) from PlanScreen.jsx (the FIRST moodboard surface) so a second wizard (the Test
// Cases per-story editor) reuses the SAME Stepper / glass surfaces / palette instead of diverging. This
// move is behavior-neutral for PlanScreen — the definitions are byte-identical to its former inline ones,
// with ONE additive generalization on Stepper (see below). See docs/DESIGN-SYSTEM-MOODBOARD.md.
//
// Deep premium blues for headings + glassy step surfaces, layered ON TOP of the Swagger button system
// (green=commit / blue=nav / red=danger unchanged). Legibility never depends on backdrop-filter (the fills
// are near-opaque) — the Forge-iframe rule.
export const MOOD = { navy: "#021024", blueDeep: "#052659", steel: "#5483B3", skySteel: "#7DA0CA", ice: "#C1E8FF" };
export const WIZARD_WRAP = { maxWidth: "880px", margin: "0 auto", width: "100%" };
export const stepSurface = {
  borderRadius: 16,
  border: "1px solid rgba(125,160,202,0.32)",
  background: "linear-gradient(160deg, rgba(193,232,255,0.34) 0%, rgba(255,255,255,0) 55%), #ffffff",
  boxShadow: "0 8px 28px rgba(5,38,89,0.08)",
  padding: 24,
};
export const stepTitleStyle = { fontSize: 20, fontWeight: 700, color: MOOD.navy, letterSpacing: "-0.01em", margin: "0 0 6px", lineHeight: 1.25 };
export const stepSubStyle = { fontSize: 13.5, color: "var(--s2j-text-muted)", margin: "0 0 18px", lineHeight: 1.55 };

// The wizard progress header. Reached steps are clickable (jump back to edit); steps not yet reached are
// locked. a11y: aria-current on the active step; the number/✓ carries a label, never colour-alone.
//
// ⭐ ADDITIVE GENERALIZATION (the only difference from PlanScreen's former inline Stepper): a `labels` entry
// may be a plain STRING (PlanScreen — back-compat) OR an object { label, count, warn }. `count` appends
// " · N" to the label (e.g. "Negative · 3"); `warn` true puts a warning icon on the dot (a §11 marker so a
// problem in a not-yet-opened step is visible). String labels render exactly as before.
export function Stepper({ labels, step, maxStep, onJump, busy, ariaLabel = "Steps" }) {
  return (
    <nav aria-label={ariaLabel} className="flex items-center" style={{ gap: 10, flexWrap: "wrap", margin: "0 0 20px" }}>
      {labels.map((raw, i) => {
        const L = typeof raw === "string" ? { label: raw } : (raw || {});
        const labelText = L.label || ""; // defensive: a malformed object never renders `undefined`
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        const reachable = n <= maxStep;
        // No step-jumping while busy — it would race an auto-advance and strand the user (deep-audit).
        const clickable = reachable && !active && !busy;
        return (
          <button
            key={n}
            type="button"
            onClick={() => { if (clickable) onJump(n); }}
            disabled={!clickable}
            aria-current={active ? "step" : undefined}
            className="flex items-center"
            style={{ gap: 8, background: "none", border: "none", padding: 2, cursor: clickable ? "pointer" : "default" }}
          >
            <span style={{
              width: 26, height: 26, borderRadius: "50%", flexShrink: 0, display: "inline-flex",
              alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 700,
              background: active ? "var(--s2j-blue)" : done ? MOOD.ice : "var(--s2j-bg)",
              color: active ? "#fff" : done ? MOOD.blueDeep : "var(--s2j-text-muted)",
              border: active ? "none" : `1px solid ${done ? MOOD.skySteel : "var(--s2j-border)"}`,
            }}>{done ? "✓" : n}</span>
            <span style={{
              fontSize: 12.5, fontWeight: active ? 700 : 500, whiteSpace: "nowrap",
              color: active ? MOOD.navy : reachable ? "var(--s2j-text-muted)" : "var(--s2j-text-light)",
            }}>
              {labelText}{L.count != null ? ` · ${L.count}` : ""}
            </span>
            {L.warn ? <span style={{ display: "inline-flex", marginLeft: -2 }} title="This step has items that need attention"><SignalIcon kind="warning" size={12} title="Needs attention" /></span> : null}
          </button>
        );
      })}
    </nav>
  );
}

// A collapsed secondary section — demotes always-on detail WITHOUT hiding anything (the §11 rule: demote,
// never drop).
export function Accordion({ title, count, kind, defaultOpen, children }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div style={{ border: "1px solid var(--s2j-border)", borderRadius: 10, background: "var(--s2j-bg)", marginBottom: 10 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--s2j-text)" }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
          {kind ? <SignalIcon kind={kind} size={13} /> : null}
          {title}{count != null ? <span style={{ color: "var(--s2j-text-muted)", fontWeight: 500 }}>{" "}({count})</span> : null}
        </span>
        <span style={{ color: "var(--s2j-text-muted)", fontSize: 12 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open ? <div style={{ padding: "0 12px 12px" }}>{children}</div> : null}
    </div>
  );
}

// The wizard's forward button — BLUE (the nav convention; commit actions like Generate stay green).
export function WizardNext({ onClick, children, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="btn-nav" style={{ fontSize: 13.5, padding: "9px 18px" }}>
      {children} <span aria-hidden="true">→</span>
    </button>
  );
}
