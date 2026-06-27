# Spec2Tickets — Web Design Moodboard & Design System

> **Source of truth for the project's VISUAL direction.** Authored from the partner's
> `Spec2Tickets_MoodboardWebDesign.pdf` (the "SPEC2JIRA — Web Design Moodboard" board),
> 2026-06-27. This is the durable reference every UI change should align to. It records
> WHAT the look is and — critically — HOW to express it inside the **Forge Custom UI
> iframe** (a sandboxed CRA React app), where the constraints are real.
>
> ⚠ This documents the DIRECTION. Rolling it across the whole app is a deliberate,
> screen-by-screen task (partner: "после може да опитаме да го наложим върху целия
> Application но това ще бъде отделен таск"). The PlanScreen wizard is the first surface
> built natively to it.

---

## 1. The mood in one line

**Premium, calm, trustworthy, tech-forward — a blue-on-white monochrome with glass.**
Lots of breathing room. Big confident headings. Frosted translucent "glass" cards over
soft blue→white gradient washes. Abstract liquid/wave forms as quiet background accents.
The feeling is an enterprise SaaS that is modern and *light*, not dense and corporate.

The board's reference set: glassmorphism UI cards, 3D frosted-glass icons (chat bubbles,
cloud, search, box, bar-chart), soft radial blue glows, flowing liquid-metal ribbons, and
bold display lockups ("WORLD WIDE WEB", "SHARE", "2026"). All monochrome blue + white.

---

## 2. Palette (the five swatches — authoritative)

The moodboard's color column, darkest → lightest:

| Token (new) | Hex | Role |
|---|---|---|
| `--s2j-navy` | `#021024` | Midnight navy — display headings on light, deepest text, darkest gradient stop |
| `--s2j-blue-deep` | `#052659` | Deep blue — secondary headings, strong accents, gradient mid-dark |
| `--s2j-steel` | `#5483B3` | Steel blue — mid accents, muted active states, icon bodies |
| `--s2j-sky-steel`| `#7DA0CA` | Sky steel — soft accents, borders on blue, gradient light-mid |
| `--s2j-ice` | `#C1E8FF` | Ice blue — lightest fills, glass tints, gradient light stop, hairlines |

**Gradient signatures** (the board's recurring move):
- **Surface wash** — `linear-gradient(160deg, rgba(193,232,255,.35) 0%, rgba(255,255,255,0) 60%)`
  (ice → transparent): a barely-there top-left tint that makes a card feel lit.
- **Hero / deep panel** — `linear-gradient(135deg, #021024 0%, #052659 55%, #5483B3 100%)`
  (navy → steel): for dark feature bands / hero blocks (white text on top).
- **Glow** — a soft radial `rgba(125,160,202,.25)` behind a focal element.

### Relationship to the existing Swagger tokens (do NOT rip these out)

The app already ships a **Swagger-inspired** palette (`index.css` `:root`) — most notably
the **button system** which the partner explicitly ratified (`ui-button-color-convention`):
- `--s2j-blue #61affe` = **navigation** (`.btn-nav`, Back) ·
- `--s2j-green #49cc90` = **commit/submit** (`.btn-primary`, Generate/Push) ·
- `--s2j-red #f93e3e` = **destructive/important** (`.btn-danger`).

The moodboard palette is **DEEPER/more premium** than the Swagger blue (`#61affe`). The
rule: the moodboard tokens are an **accent + surface layer LAYERED ON TOP** of the working
Swagger system — they govern **headings, gradient washes, glass cards, decorative accents**.
They do **NOT** repaint the semantic buttons (green=commit / blue=nav / red=danger stays).
This keeps the shipped, partner-approved interaction colors intact while making surfaces
feel like the board.

---

## 3. Visual language → concrete recipes (Forge-safe)

### Glassmorphism card
The board's signature. In the iframe, express it as a translucent fill + light border +
soft shadow, with `backdrop-filter` as a **progressive enhancement only**:
```
background: rgba(255,255,255,.72);
border: 1px solid rgba(125,160,202,.30);      /* sky-steel hairline */
border-radius: 16px;
box-shadow: 0 8px 28px rgba(5,38,89,.08);     /* deep-blue soft shadow */
backdrop-filter: blur(10px);                  /* enhancement; degrade gracefully */
```
⚠ `backdrop-filter` is **not guaranteed** in the Forge sandbox/all browsers → the card MUST
read correctly WITHOUT it (hence the opaque-ish `.72` white fill, not a near-transparent
one that relies on blur). Never make legibility depend on the blur.

### Soft surface wash (steps / sections)
Lay the ice→transparent gradient over a white/near-white base; keep content on top fully
opaque for legibility:
```
background:
  linear-gradient(160deg, rgba(193,232,255,.35), rgba(255,255,255,0) 55%),
  #ffffff;
```

### Rounded geometry & depth
- Radii: cards **16px**, inner controls **10–12px**, pills **999px**.
- Shadows are **blue-tinted and soft** (`rgba(5,38,89,.06–.12)`), never hard gray.
- Generous padding: **16–24px** inside cards; **24–32px** between major sections.

### Accent / decorative
- Quiet radial glow behind a focal icon or heading (sky-steel at low alpha).
- A single thin gradient ribbon/line as a section divider (navy→ice), used sparingly.
- 3D glassy icons are aspirational; we ship flat inline-SVG (`Icon.jsx` / `Signal.jsx`).
  Evoke depth with a soft shadow + an ice-tinted circular backdrop, not skeuomorphism.

---

## 4. Typography

**Board's primary fonts:** **AKONY** (bold geometric display) + **Surgena** (soft rounded
sans). Both are **paid / non-system**.

⚠ **DECISION — do NOT import the paid webfonts into the Forge iframe.** Reasons: licensing
for an embedded distributed app, extra blocking font loads in a sandboxed iframe, and FOUT/
layout-shift risk on a live product. **Evoke the feel instead** with the existing system
sans stack:
- **Display / headings** — heavier weight (700–800), **larger sizes**, slightly **tight
  letter-spacing** (`-0.01em`→`-0.02em`), navy color. This captures AKONY's bold geometric
  presence without the font.
- **Body** — normal weight, **comfortable size + line-height 1.5–1.6** for the "easy to
  read, easy to grasp" goal the partner asked for. This stands in for Surgena's softness.

**Type scale (the wizard adopts this; roll outward later):**
| Use | Size | Weight | Notes |
|---|---|---|---|
| Step / screen title | 18–20px | 700 | navy `#021024`, tight tracking |
| Section header | 14px | 600 | deep-blue or text |
| Body / values | 14px | 400–500 | line-height 1.5–1.6 |
| Labels / meta | 12px | 600 | up from the old 11px (legibility) |
| Micro / footnote | 11–12px | 400 | muted |

The old screens ran labels at 11px and body at 13px — the moodboard direction nudges these
**up** for comfort. Bigger, calmer, more whitespace is the point.

---

## 5. Layout & spacing principles

- **One idea per region.** The board is airy because each block does one thing. Favor a
  step/section that states a single focus over a dense multi-panel wall (the exact problem
  the PlanScreen wizard solves).
- **Whitespace is a feature**, not wasted space. 16–24px inside, 24–32px between sections.
- **Progressive disclosure** — secondary detail (advanced math, diagnostics, full
  assumptions) lives in collapsed accordions, not always-on panels.
- **Max content width** ~1100–1180px, centered, so lines don't sprawl on wide screens.
- ⚠ **Forge iframe sizing still rules** (`forge-customui-iframe-sizing` memory): content
  drives height; never pin `100vh`; internal-scroll is incompatible — every screen
  PAGE-scrolls with its CTA at the natural bottom. The moodboard's airiness must respect
  this (no full-viewport hero that creates an empty band).

---

## 6. How to apply (checklist for any screen)

1. Surfaces → glass cards over a soft ice wash; blue-tinted soft shadows; 16px radii.
2. Headings → navy, bold, larger, tight tracking (AKONY-evoking).
3. Body/labels → bumped up a notch, line-height 1.5–1.6 (Surgena-evoking comfort).
4. Buttons → **unchanged** semantic system (green commit / blue nav / red danger).
5. Accents → ice/sky-steel tints, one quiet gradient or glow per region, used sparingly.
6. Respect Forge iframe sizing (page-scroll, no `100vh`, no internal-scroll traps).
7. No paid font imports; no legibility that depends on `backdrop-filter`.

---

## 7. Implementation note (tokens)

When formalized in `index.css`, add the five moodboard tokens alongside the Swagger ones
(additive — nothing removed):
```css
:root {
  /* Moodboard accent/surface layer (2026-06-27) — see DESIGN-SYSTEM-MOODBOARD.md */
  --s2j-navy:       #021024;
  --s2j-blue-deep:  #052659;
  --s2j-steel:      #5483B3;
  --s2j-sky-steel:  #7DA0CA;
  --s2j-ice:        #C1E8FF;
}
```
Until they are centralized, screens built to the moodboard (starting with PlanScreen) may
inline these hexes; fold them into `:root` during the app-wide rollout task.
