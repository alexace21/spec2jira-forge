import React from "react";
import { ConfidenceGlyph } from "./breakdown/signalTokens";
import { parseConcernPrefix, CONCERN_TYPE_LABEL, SEVERITY_PALETTE } from "../lib/v3Schema";

// --- moodChips.jsx --- the shared presentational chip primitives for the Test Cases surface. ------------
// SINGLE SOURCE OF TRUTH: BOTH EditableCaseRow (the card) and StoryWizard / TestCasesScreen (the
// containers) import from here, so a tone / label can never diverge between the collapsed chip and the
// expanded panel. Dependency-light: SignalIcon (Signal.jsx) + the concern decoders (lib/v3Schema.js).
// Text is ALWAYS var(--s2j-text) (dark navy) on the tinted background; colour rides the icon / dot /
// border (the WCAG-on-near-white-glass rule). Purely presentational -- no data / logic here.
// Dependency-light: ConfidenceGlyph (breakdown/signalTokens.jsx, the app-wide confidence primitive)
// + the concern decoders (lib/v3Schema.js).

// The ONE place tones are defined: neutral | info | warning | error | success | trust -> { bg, border, fg }.
export const TONE = {
  neutral: { bg: "var(--s2j-bg-section)", border: "var(--s2j-border)", fg: "var(--s2j-text-muted)" },
  info: { bg: "var(--s2j-blue-bg)", border: "var(--s2j-blue-border)", fg: "var(--s2j-blue)" },
  warning: { bg: "var(--s2j-orange-bg)", border: "var(--s2j-orange-border)", fg: "var(--s2j-orange)" },
  error: { bg: "var(--s2j-red-bg)", border: "var(--s2j-red-border)", fg: "var(--s2j-red)" },
  success: { bg: "var(--s2j-green-bg)", border: "var(--s2j-green-border)", fg: "var(--s2j-green-dark)" },
  trust: { bg: "var(--s2j-trust-bg)", border: "var(--s2j-trust-border)", fg: "var(--s2j-trust)" },
};

// A small solid dot in the tone's fg colour -- the low-weight leading marker for a Chip.
export function Dot({ tone = "neutral", size = 6 }) {
  const t = TONE[tone] || TONE.neutral;
  return <span style={{ width: size, height: size, borderRadius: "50%", background: t.fg, display: "inline-block", flexShrink: 0 }} />;
}

// A pill. `icon` sits first (an icon node, e.g. a ConfidenceGlyph or a Dot); text stays dark; tone tints bg + border.
export function Chip({ tone = "neutral", icon, title, children, style }) {
  const t = TONE[tone] || TONE.neutral;
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        padding: "2px 9px",
        fontSize: 11,
        fontWeight: 500,
        background: t.bg,
        border: `1px solid ${t.border}`,
        color: "var(--s2j-text)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {icon != null ? icon : null}
      {children != null ? <span>{children}</span> : null}
    </span>
  );
}

// confidence_indicator DATA glyphs (the schema enum values, matched literally exactly as v3Schema.js /
// App.js / Worklist.jsx do). check = high band, warning = medium band, cross = low band.
const CONF_OK = "✓";
const CONF_WARN = "⚠";
const CONF_BAD = "✗";

// Per-band presentation. `label` is the human name; `word` is a short token shown when there is NO numeric
// score, so the badge is never icon-colour-alone (the a11y rule); `glyph` is the DERIVED shape used when
// no indicator was recorded (score-only case).
const BAND_LABEL = { high: "Confident", medium: "Unsure", low: "Low confidence" };
const BAND_WORD = { high: "High", medium: "Medium", low: "Low" };
const BAND_GLYPH = { high: CONF_OK, medium: CONF_WARN, low: CONF_BAD };

// Resolve { kind, band, hasScore, score } from the OPTIONAL, INDEPENDENT indicator + score. Returns null
// when NEITHER exists. Used by ConfidenceBadge (collapsed) AND the expanded read-only panel, so both read
// the same band by construction. HIGH -> `trust` (teal) so it matches the app-wide confidence signal.
export function resolveConfidence(indicator, score) {
  const hasInd = indicator != null && String(indicator).trim() !== "";
  const hasScore = typeof score === "number" && isFinite(score);
  if (!hasInd && !hasScore) return null;
  let band;
  if (hasInd) {
    const ind = String(indicator).trim();
    band = ind === CONF_OK ? "high" : ind === CONF_BAD ? "low" : "medium";
  } else {
    band = score >= 80 ? "high" : score >= 50 ? "medium" : "low";
  }
  const kind = band === "high" ? "trust" : band === "medium" ? "warning" : "error";
  return { kind, band, hasScore, score: hasScore ? score : null };
}

// The model's per-case self-rating -- renders ONLY when indicator OR score is present (else null). Teal
// check / amber triangle / red diamond via ConfidenceGlyph (DISTINCT shapes per level, not colour alone);
// the child is the numeric score when present, else a band word, so the pill never reads by icon-colour.
export function ConfidenceBadge({ indicator, score, size = 14 }) {
  const r = resolveConfidence(indicator, score);
  if (!r) return null;
  const hasInd = indicator != null && String(indicator).trim() !== "";
  const glyph = hasInd ? String(indicator).trim() : BAND_GLYPH[r.band];
  const label = BAND_LABEL[r.band] || "Confidence";
  return (
    <Chip
      tone={r.kind}
      title={`Model self-rated confidence for this case: ${label} (${r.band} band)`}
      icon={<ConfidenceGlyph indicator={glyph} size={size} title={`Confidence: ${label}`} />}
    >
      {r.hasScore ? r.score : BAND_WORD[r.band]}
    </Chip>
  );
}

// The warning-tone concern TYPES; every other type reads neutral.
const WARN_CONCERN_TYPES = ["COMPLIANCE", "RISK", "EXTERNAL_DEPENDENCY"];
function concernTone(type) {
  return WARN_CONCERN_TYPES.indexOf(type) >= 0 ? "warning" : "neutral";
}

// The COLLAPSED compact concern chip -- the TYPE label only; the full concern text lives in the tooltip.
// An empty / whitespace concern renders null.
export function ConcernChip({ concern }) {
  if (!concern || !String(concern).trim()) return null;
  const { type, text } = parseConcernPrefix(concern);
  const tone = concernTone(type);
  return (
    <Chip tone={tone} title={text || String(concern)} icon={<Dot tone={tone} />}>
      {CONCERN_TYPE_LABEL[type] || type}
    </Chip>
  );
}

// The EXPANDED decoded strip -- a tinted box: the type chip + a severity chip (SEVERITY_PALETTE colour on
// the dot) + the concern text (dark). Renders null when there is no concern.
export function ConcernStrip({ concern, style }) {
  if (!concern || !String(concern).trim()) return null;
  const { type, severity, text } = parseConcernPrefix(concern);
  const tone = concernTone(type);
  const t = TONE[tone];
  const sev = SEVERITY_PALETTE[severity] || SEVERITY_PALETTE.medium;
  const sevLabel = severity === "high" ? "High severity" : severity === "low" ? "Low" : "Medium";
  return (
    <div style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 12, padding: "8px 12px", ...style }}>
      <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: text ? 6 : 0 }}>
        <Chip tone={tone} icon={<Dot tone={tone} />}>{CONCERN_TYPE_LABEL[type] || type}</Chip>
        <span
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 500, color: "var(--s2j-text)" }}
          title="Model-assigned severity"
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: sev.text, display: "inline-block", flexShrink: 0 }} />
          {sevLabel}
        </span>
      </div>
      {text ? <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--s2j-text)" }}>{text}</div> : null}
    </div>
  );
}

// Tone key for the editable priority select. absent / unknown -> null (a low-emphasis placeholder select).
export function priorityTone(priority) {
  switch (priority) {
    case "Critical":
      return "error";
    case "High":
      return "warning";
    case "Medium":
      return "info";
    case "Low":
      return "neutral";
    default:
      return null;
  }
}
