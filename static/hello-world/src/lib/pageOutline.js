// pageOutline.js — client-side page-preflight extraction (design-army synthesis +
// verdict-logic army, 2026-07-01). Pure, browser-only functions (DOMParser + TreeWalker)
// over the Confluence storage-format body ALREADY fetched into pageData.body — ZERO new
// backend call, ZERO Anthropic call, ZERO new scope. Feeds ReadyScreen's "Pre-flight
// check" card so a wrong / half-empty / unfinished page is caught before the user spends
// 2-10 min + their own Anthropic-billed money.
//
// GOVERNING RULE (verdict-logic army, unanimous 3/3 = "structural purist"): surface ONLY
// DETERMINISTIC STRUCTURAL facts with near-zero false-positive risk over ordinary spec
// prose. A repeat PO who catches ONE wrong "3 open TODOs" ignores the whole card forever,
// so a wrong number costs far more than showing nothing. We therefore DROPPED (do not add):
// free-text TODO/TBD/DRAFT prose scanning (misfires on "the UI shows a TODO list"), a
// shall/must hard count (false precision), and a per-section word-density bar (weak proxy:
// words != importance). We KEEP only structural facts: the real <h*> outline, EMPTY LEAF
// sections, <ac:task> complete/total, and per-section presence of tables/images/diagrams/code.
//
// Confluence storage format wraps rich content in namespaced macro tags (e.g.
// <ac:structured-macro>, <ac:task>). Browser text/html parsing keeps these as elements with
// their colon-tag-name, traversable here. A macro-heavy page may under-detect — and that is
// the SAFE failure direction we deliberately bias to: an UNDER-counted empty is a silent miss
// (never a false caution); an OVER-counted empty would be the trust-eroding false amber.

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
const HEADING_ANCESTOR_SELECTOR = "h1,h2,h3,h4,h5,h6";
const HEADING_LEVEL = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
// 25 — a compromise between "comprehensive" (most real specs run well under this) and
// keeping the card scannable; the overflow tail ("+N more sections") never silently drops a
// page's true structure, it just stops enumerating it inline.
const MAX_HEADINGS_SHOWN = 25;
// 150 words with zero real <h*> tags reads as "not really a spec yet" (a stub / placeholder /
// still-drafting doc) — an intuitive, not calibrated, threshold. Known trade-off: a page using
// bold pseudo-headings instead of real <h*> tags can trip this; accepted (never blocks Generate).
const THIN_WORD_COUNT_THRESHOLD = 150;
// tags whose PRESENCE in a section counts as "this section has real content" (so a leaf holding
// only, say, a table or a task-list is NOT flagged empty). Whitelisting any <ac:*> macro as
// content is the deliberate under-count bias above.
const CONTENT_TAGS = new Set(["table", "img", "pre", "code", "blockquote"]);
const DIAGRAM_MACRO_HINT = /drawio|gliffy|mermaid|diagram|plantuml/;

const EMPTY_OUTLINE = {
  headings: [],
  headingCount: 0,
  moreHeadingsCount: 0,
  topSections: [],
  wordCount: 0,
  listItemCount: 0,
  tableCount: 0,
  isThin: true,
  emptyLeafCount: 0,
  tasksTotal: 0,
  tasksComplete: 0,
};

// closest heading ancestor (an element inside a heading's own title markup must never be
// mistaken for section body content). For a text node, look from its parent element.
function insideHeading(node) {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !!(el && el.closest && el.closest(HEADING_ANCESTOR_SELECTOR));
}

export function extractPageOutline(bodyHtml) {
  const html = String(bodyHtml || "");
  if (!html.trim()) return EMPTY_OUTLINE;

  let doc;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch (_) {
    return EMPTY_OUTLINE;
  }
  if (!doc || !doc.body) return EMPTY_OUTLINE;

  // ── one document-order pass: build per-section content facts + per-section task counts ──
  const sections = []; // { level, text, hasContent, hasTable, hasImage, hasCode, hasDiagram, taskTotal, taskComplete }
  let cur = null;
  // Count ac:layout-cell — a MULTI-COLUMN layout (>1 cell) decouples DOM document order from
  // reading order: a heading in the left cell and its body in the right cell are visited in
  // separate cell-blocks, so this single-pass "content follows the last heading" attribution
  // mis-assigns the body and can flag a full section as EMPTY. That is the trust-eroding FALSE
  // amber the structural-purist rule forbids, on an ordinary layout — so on a multi-column page
  // we SUPPRESS the empty-leaf signal entirely (the safe under-count direction; presence chips
  // + the outline still render, just no "empty" flags / no amber-from-empties).
  let layoutCellCount = 0;
  let walker;
  try {
    // SHOW_ELEMENT (1) | SHOW_TEXT (4)
    walker = doc.createTreeWalker(doc.body, 1 | 4);
  } catch (_) {
    walker = null;
  }
  if (walker) {
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 1) {
        const tag = (node.tagName || "").toLowerCase();
        const level = HEADING_LEVEL[tag];
        if (level) {
          cur = { level, text: (node.textContent || "").trim(), hasContent: false, hasTable: false, hasImage: false, hasCode: false, hasDiagram: false, taskTotal: 0, taskComplete: 0 };
          sections.push(cur);
          continue;
        }
        // count Confluence task checkboxes PER SECTION (structural, near-zero false positive) — the
        // per-section counts roll up into the outline pills' TODO tags AND the headline task totals
        // (both derived from the sections below), so every counted task is attributable to a visible
        // pill. A task BEFORE the first heading (cur null) is intentionally NOT counted — it would be
        // an unlocatable amber (the safe under-count direction the structural-purist rule wants).
        if (tag === "ac:task") {
          if (cur) cur.taskTotal += 1;
        } else if (tag === "ac:task-status") {
          if ((node.textContent || "").trim().toLowerCase() === "complete") {
            if (cur) cur.taskComplete += 1;
          }
        } else if (tag === "ac:layout-cell") layoutCellCount += 1;
        if (insideHeading(node)) continue; // heading-internal markup, not section body
        if (!cur) continue; // content before the first heading belongs to no section
        cur.hasContent = true;
        if (tag === "table") cur.hasTable = true;
        else if (tag === "img" || tag === "ac:image") cur.hasImage = true;
        else if (tag === "pre" || tag === "code") cur.hasCode = true;
        else if (tag === "ac:structured-macro") {
          const name = (node.getAttribute && node.getAttribute("ac:name") || "").toLowerCase();
          if (DIAGRAM_MACRO_HINT.test(name)) cur.hasDiagram = true;
          if (name === "code") cur.hasCode = true;
        } else if (CONTENT_TAGS.has(tag)) {
          // already marked hasContent; specific flags handled above
        }
      } else if (node.nodeType === 3) {
        if (!cur) continue;
        const t = (node.textContent || "").trim();
        if (t && !insideHeading(node)) cur.hasContent = true;
      }
    }
  }

  // grouping header = its NEXT heading is DEEPER (its "body" is its children) → never empty.
  // leaf = next heading is same-or-shallower (or it's the last heading). empty-LEAF = leaf with
  // no content. This is the ONLY signal that drives the amber "worth a glance" verdict.
  const multiColumn = layoutCellCount > 1; // suppress empty-leaf on multi-column pages (see above)
  const enriched = sections.map((s, i) => {
    const next = sections[i + 1];
    const isGrouping = !!next && next.level > s.level;
    // isEmpty requires: not a grouping header, no content, a NON-EMPTY title (an empty-title
    // heading like a stray <h2></h2> is filtered from the display below, so it must not drive the
    // count either), and NOT a multi-column page (where content/heading document order is unreliable).
    const isEmpty = !multiColumn && !isGrouping && !s.hasContent && s.text.length > 0;
    return {
      level: s.level, text: s.text, isGrouping, isEmpty,
      hasTable: s.hasTable, hasImage: s.hasImage, hasCode: s.hasCode, hasDiagram: s.hasDiagram,
      taskTotal: s.taskTotal || 0, taskComplete: s.taskComplete || 0,
    };
  });
  const withText = enriched.filter((h) => h.text.length > 0);

  const headingCount = withText.length;
  const headings = withText.slice(0, MAX_HEADINGS_SHOWN);
  const moreHeadingsCount = Math.max(0, headingCount - headings.length);

  // ── TOP-LEVEL section rollup (feeds the outline "pills") + the headline counts ──
  // EXHAUSTIVE grouping: walk the flat heading list; a heading at level <= the current top head
  // starts a NEW top section, a deeper one is a CHILD of it — so EVERY heading is either a pill head
  // or folded into exactly one pill (no orphan is ever dropped, incl. a heading shallower OR deeper
  // than the first one). Each pill rolls up its subtree: child count, empty-leaf count, and per-
  // section task totals. A "TODO" is an unchecked <ac:task> checkbox (structural) — NOT prose.
  const topRaw = [];
  let curTop = null;
  for (let k = 0; k < withText.length; k++) {
    const h = withText[k];
    if (!curTop || h.level <= curTop.level) {
      curTop = { text: h.text, level: h.level, childCount: 0, emptyCount: h.isEmpty ? 1 : 0, taskTotal: h.taskTotal, taskComplete: h.taskComplete };
      topRaw.push(curTop);
    } else {
      curTop.childCount += 1;
      if (h.isEmpty) curTop.emptyCount += 1;
      curTop.taskTotal += h.taskTotal;
      curTop.taskComplete += h.taskComplete;
    }
  }
  const topSections = topRaw.map((s) => ({
    text: s.text,
    childCount: s.childCount,
    emptyCount: s.emptyCount,
    openTodos: Math.max(0, s.taskTotal - s.taskComplete),
  }));

  // ⚠ SINGLE SOURCE OF TRUTH: the headline counts are the SUM over the pill rollups, so the verdict
  // banner + COMPLETE tile can NEVER contradict a pill tag (the cross-surface consistency the
  // correctness army flagged: previously emptyLeafCount was clamped to the first 25 headings while
  // the pills rolled up ALL of them). Every empty leaf / unchecked task counted here is attributed to
  // exactly one pill, so it is always locatable (a visible pill's tag, or the "+N more sections"
  // aggregate the card renders for pills past the display cap). Per section tc<=tt, so
  // sum(openTodos) === tasksTotal - tasksComplete by construction — the banner and tile agree.
  const emptyLeafCount = topRaw.reduce((n, s) => n + s.emptyCount, 0);
  const tasksTotal = topRaw.reduce((n, s) => n + s.taskTotal, 0);
  const tasksComplete = topRaw.reduce((n, s) => n + s.taskComplete, 0);

  const bodyText = (doc.body.textContent || "").trim();
  const wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  const listItemCount = doc.body.querySelectorAll("li").length;
  const tableCount = doc.body.querySelectorAll("table").length;

  const isThin = headingCount === 0 && wordCount < THIN_WORD_COUNT_THRESHOLD;

  return {
    headings,
    headingCount,
    moreHeadingsCount,
    topSections,
    wordCount,
    listItemCount,
    tableCount,
    isThin,
    emptyLeafCount,
    tasksTotal,
    tasksComplete,
  };
}

// ── verdict (tri-state) — the go/no-go banner. NEVER blocks Generate (the PO owns the spec).
//   red-thin : isThin (a stub — double-check the page)
//   amber    : real spec, but amberCount >= 1 structural facts worth a glance
//   green    : real spec, amberCount === 0
// amberCount = (# empty LEAF sections) + (# unchecked tasks / "open TODOs") — the COMPLETE set,
// counted per-item so the banner number matches what the tiles enumerate ("1 empty + 3 open TODOs
// = 4 items worth a glance"). Deliberately NOT gated on word count (a small-but-complete spec is
// fine; the empty-leaf signal already catches a headed-but-hollow skeleton better than a word floor).
export function preflightAmberCount(outline) {
  const empties = Number(outline?.emptyLeafCount) || 0;
  const total = Number(outline?.tasksTotal) || 0;
  const done = Number(outline?.tasksComplete) || 0;
  const unchecked = Math.max(0, total - done);
  return empties + unchecked;
}

export function preflightVerdict(outline) {
  if (!outline || outline.isThin) return "thin";
  return preflightAmberCount(outline) === 0 ? "green" : "amber";
}

// Coarse, cheap generation-time band off the raw character count — no Anthropic call, no
// calibration risk (the design-army round explicitly rejected a $ estimate here). The bands
// are an UNCALIBRATED, deliberately wide expectation-setter (real runtime depends on output
// tokens + Anthropic batch queue load — CLAUDE.md gotcha #5), never a promise.
export function estimateGenerationTimeBand(charCount) {
  const n = Number(charCount) || 0;
  if (n < 20000) return "~2-4 min";
  if (n < 60000) return "~4-7 min";
  return "~7-10+ min";
}
