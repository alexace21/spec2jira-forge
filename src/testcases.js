/**
 * Spec2Tickets — test-case PURE LIBRARY (P2).
 *
 * POLICY §4: these are DETERMINISTIC pure functions over the per-Story TEST_CASE
 * result (the rich schema in prompts.js). Zero LLM, zero model tokens. The single
 * source of truth for:
 *   - computeCoverage  — the AC-coverage strip (also the P3 reactive-sub-chunk trigger
 *                        + the P5 screen signal). AC-trace by VERBATIM text, never index.
 *   - renderGherkin    — the BDD-world export (Octane BDD-Spec / Xray Cucumber / Zephyr
 *                        BDD / Cucumber-Studio / SpiraTest / Polarion). ONE Feature per
 *                        Story, ONE Scenario per case.
 *   - renderManualTable— the manual/enterprise-world export (ADO / Jama / IBM-ETM /
 *                        codeBeamer / TestLink / manual Xray-Zephyr-TestRail), incl. CSV.
 *
 * Strategy locked 2026-06-05 from a 14-tool research sweep (see CLAUDE.md handover +
 * the testcase-generation-feature memory). Field mapping: type→@tag (never the tool's
 * "Type" field); ac_trace→`# Covers:` / References; confidence→internal-only (NOT exported);
 * given[]→Background/Preconditions; expected_result→the case's single falsifiable assertion.
 *
 * ⚠ MUST NOT emit Octane `@TID`/`@REV` tags (Octane generates them on inject; emitting
 *    them breaks Octane's identity mapping).
 * ⚠ CSV is HARDENED against spreadsheet formula-injection (leading = + @ - ).
 * Carry-forward (P1 §13 gate): a concern may arrive WITHOUT the `[TYPE|severity]` prefix
 *    (the P3 parse defaults it to `[ASSUMPTION|medium]`); the renderers emit the concern
 *    text AS-IS, so any concern type renders gracefully — no breakdown-vocabulary assumption.
 *
 * DUAL-USE (P5 forward-note): pure functions, NO Node-only APIs → the SAME code runs in the
 *    Forge backend (push embed + reactive sub-chunk) and can serve the CRA frontend screen.
 *    Recommended P5 arch: the backend pre-renders both formats + returns the strings to the
 *    frontend (cleanest); a frontend copy is also viable (no Node deps to port).
 */

// ════════════════════════════════════════════════════════════════
// parseTestCaseResult — defensive parse of the raw Anthropic structured-output
// response for one Story's test cases. Engineering owns ALL caps and coercions
// here (§4): the schema has NO numeric constraints (Anthropic rejects them), so
// every ceiling/clamp/filter lives in this function, never in the schema.
// ════════════════════════════════════════════════════════════════

/**
 * Parse and defensively sanitize the raw model output for one Story's test cases.
 * Overwrites story_name from the real story object (the model echoes its own
 * prompt text — the KVS key is the authoritative binding, not the echoed name).
 * Applies the following engineering-owned invariants:
 *   - String JSON input is parsed (catch → error shape)
 *   - story_name always overwritten with story.name
 *   - no_acs coerced to Boolean
 *   - test_cases: DROP cases with empty when/then or missing/empty ac_trace
 *   - ac_trace: an empty trace is repaired to [{kind:'inferred'}]
 *   - confidence_score: clamped 0-100
 *   - priority: if not in ['Critical','High','Medium','Low'] it is deleted
 *   - test_data: empty-string entries filtered; capped at 5 entries
 *   - concern: left as-is (any concern type is valid — no breakdown-vocab assumption)
 *   - test_cases: AC-covering cases (tracing a real AC by ac_text) stably partitioned
 *     BEFORE inferred-only depth, THEN sliced to ≤15 — so the cap never drops AC coverage
 *     (cost-asymmetry: an uncovered AC is expensive; an extra depth case is a cheap delete)
 * Then computes coverage via computeCoverage.
 *
 * @param {string|object} raw   the raw output text or already-parsed object
 * @param {object} story        the Story (name, acceptance_criteria[])
 * @returns {{ result: object, coverage: object } | { error: string, detail: string }}
 */
export function parseTestCaseResult(raw, story) {
  let obj;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      return { error: 'parse_failed', detail: `JSON parse failed: ${String(e?.message || e).slice(0, 200)}` };
    }
  } else if (raw && typeof raw === 'object') {
    obj = raw;
  } else {
    return { error: 'parse_failed', detail: 'Expected a string or object; got neither.' };
  }

  // OVERWRITE story_name with the authoritative story name (the model echoes its
  // prompt text which may differ from the live story name in the editor — the
  // storyIdx is the binding; the name is a convenience label).
  obj.story_name = (story && story.name) || obj.story_name || '';

  // Coerce no_acs to Boolean (schema says boolean but coerce defensively)
  obj.no_acs = !!obj.no_acs;

  // Normalize test_cases array
  const rawCases = Array.isArray(obj.test_cases) ? obj.test_cases : [];
  const VALID_PRIORITIES = new Set(['Critical', 'High', 'Medium', 'Low']);

  const cleaned = rawCases
    .filter((c) => c && typeof c === 'object')
    .map((c) => {
      // Drop case if when[] or then[] is empty/absent (the decisive-test clause (a)
      // requires at least one observable action and one observable outcome)
      const when = Array.isArray(c.when) ? c.when.filter((s) => String(s || '').trim()) : [];
      const then = Array.isArray(c.then) ? c.then.filter((s) => String(s || '').trim()) : [];
      if (when.length === 0 || then.length === 0) return null; // DROP

      // Repair empty ac_trace → [{kind:'inferred'}] (the honest-degradation channel)
      let acTrace = Array.isArray(c.ac_trace) ? c.ac_trace.filter((t) => t && typeof t === 'object') : [];
      if (acTrace.length === 0) acTrace = [{ kind: 'inferred' }];

      // Clamp confidence_score to 0-100
      let cs = c.confidence_score;
      if (typeof cs === 'number') {
        cs = Math.max(0, Math.min(100, Math.round(cs)));
      }

      // Drop invalid priority (absent → clean omission; never a wrong value)
      let priority = c.priority;
      if (priority !== undefined && !VALID_PRIORITIES.has(priority)) {
        priority = undefined;
      }

      // Filter empty test_data strings; cap at 5
      let testData = Array.isArray(c.test_data)
        ? c.test_data.filter((s) => String(s || '').trim()).slice(0, 5)
        : undefined;
      if (testData && testData.length === 0) testData = undefined;

      const out = {
        title: c.title || '',
        type: c.type || 'happy-path',
        given: Array.isArray(c.given) ? c.given : [],
        when,
        then,
        expected_result: c.expected_result || '',
        ac_trace: acTrace,
      };
      // Attach optional fields only when present
      if (priority !== undefined) out.priority = priority;
      if (testData !== undefined) out.test_data = testData;
      if (typeof cs === 'number') out.confidence_score = cs;
      if (c.confidence_indicator) out.confidence_indicator = c.confidence_indicator;
      if (c.concern) out.concern = c.concern; // leave as-is — any concern type renders gracefully

      return out;
    })
    .filter(Boolean); // remove DROPped nulls

  // Cap at 15 AFTER cleaning — but PARTITION AC-covering cases (those tracing a real AC
  // by ac_text) BEFORE inferred-only depth, so the cap never drops AC coverage. The system
  // prompt's breadth-first rule is SOFT (empirically the model occasionally places an
  // AC-covering case late: a 16-case story lost 1 AC at a pure slice(0,12)); this stable
  // partition makes the cap provably coverage-safe regardless. Cost-asymmetry (POLICY): an
  // uncovered AC is expensive; an extra depth case is a cheap one-click delete — so when the
  // cap must drop a case, it drops inferred depth, never an oracle-backed case.
  const tracesAC = (c) => Array.isArray(c.ac_trace) && c.ac_trace.some((t) => t && t.ac_text && String(t.ac_text).trim());
  const covering = cleaned.filter(tracesAC);
  const depth = cleaned.filter((c) => !tracesAC(c));
  obj.test_cases = [...covering, ...depth].slice(0, 15);

  // Compute coverage against the live Story ACs
  const coverage = computeCoverage(story, obj);

  return { result: obj, coverage };
}

// ════════════════════════════════════════════════════════════════
// computeCoverage — the PURE AC-coverage strip (ported verbatim from the
// validated prototype harness; AC-trace by normalized VERBATIM text, never index)
// ════════════════════════════════════════════════════════════════

/**
 * Normalize an acceptance-criterion string for hashing. Folds curly/prime quotes +
 * NBSP, collapses whitespace, lowercases. Deliberately does NOT strip semantic
 * punctuation or fold digits↔words — a meaningfully reworded AC must read STALE
 * (→ regenerate), never fuzzy-match and silently mis-attribute coverage.
 */
export function normAC(s) {
  return String(s == null ? '' : s)
    // Real-spec bake-off fix (2026-06-06): strip a model-added "AC1:"/"AC 2." label prefix
    // (real AC content never starts so; symmetric on both sides) + strip backslashes
    // (Markdown-escape artifacts in source ACs, e.g. We\'re). These two were 73% of the
    // false-uncovered on real LONG/labeled/escaped ACs — invisible on the short synthetic fixtures.
    .replace(/^\s*AC\s*\d+\s*[:.]\s*/i, '')
    .replace(/\\/g, '')
    .replace(/[‘’‛′]/g, "'")   // curly / prime single quotes → '
    .replace(/[“”‟″]/g, '"')   // curly double quotes → "
    .replace(/ /g, ' ')                        // NBSP → space
    .replace(/\s+/g, ' ')                            // collapse whitespace
    .trim()
    .toLowerCase();
}

/**
 * Compute AC coverage of a parsed test-case result against the LIVE Story ACs.
 * Keys ac_trace[].ac_text (normalized) against the live acceptance_criteria so coverage
 * stays auditable as ACs are edited. Returns covered / uncovered / stale / inferred, and
 * coverage_pct = null (never a vacuous 100%) when the Story has no ACs.
 *
 * @param {object} story  the feature/Story object (acceptance_criteria[])
 * @param {object} result the parsed TEST_CASE result (test_cases[])
 */
export function computeCoverage(story, result) {
  const liveACs = Array.isArray(story && story.acceptance_criteria) ? story.acceptance_criteria : [];
  const liveNorm = liveACs.map(normAC);
  const liveSet = new Set(liveNorm);
  const cases = result && Array.isArray(result.test_cases) ? result.test_cases : [];

  const coveredSet = new Set();
  const staleRefs = [];
  let inferred = 0;
  let sharedRefs = 0;

  for (const tc of cases) {
    const trace = Array.isArray(tc && tc.ac_trace) ? tc.ac_trace : [];
    for (const t of trace) {
      if (!t || typeof t !== 'object') continue;
      if (t.kind === 'inferred') { inferred++; continue; }
      if (t.kind === 'shared-ac') { sharedRefs++; continue; }   // not in THIS Story's AC list — counted, not coverage
      const n = normAC(t.ac_text);
      if (!n) { staleRefs.push('(grounded entry with empty ac_text)'); continue; } // honest: reads uncovered, never false-green
      if (liveSet.has(n)) coveredSet.add(n);
      else staleRefs.push(t.ac_text);                            // matches no live AC → AC edited/deleted since generation
    }
  }

  const total = liveACs.length;
  const covered = liveNorm.filter((n) => coveredSet.has(n)).length;
  const uncovered = liveACs.filter((_, i) => !coveredSet.has(liveNorm[i]));
  return {
    no_acs: total === 0,
    total_acs: total,
    covered_acs: covered,
    uncovered_acs: uncovered,
    coverage_pct: total ? Math.round((covered / total) * 100) : null, // null (NOT 100) when no ACs — never vacuous
    complete: uncovered.length === 0, // no AUTHORED AC left uncovered — true for no-acs AND fully-covered. P3 reactive-sub-chunk trigger = (truncated && !complete)
    inferred_cases: inferred,
    shared_ac_refs: sharedRefs,
    stale_refs: staleRefs,
  };
}

// ════════════════════════════════════════════════════════════════
// renderGherkin — BDD `.feature` text (one Feature per Story, one Scenario per case)
// ════════════════════════════════════════════════════════════════

// A Gherkin STEP is single-line: collapse newlines. Do NOT escape '|' — it is a
// delimiter ONLY inside data-table rows; in a regular step '|' is literal text, so
// escaping it to '\|' would corrupt the step (§13 code-review HIGH, 2026-06-05).
function gStep(s) {
  return String(s == null ? '' : s).replace(/\r?\n/g, ' / ').trim();
}
// A Gherkin COMMENT / title: single-line, no pipe-escaping needed (not a step).
function gText(s) {
  return String(s == null ? '' : s).replace(/\r?\n/g, ' ').trim();
}

// Emit Gherkin step lines, SKIPPING empty steps (an empty step is invalid Gherkin —
// Cucumber rejects "Step text must not be empty"). The first non-empty step gets firstKw.
function gStepLines(arr, firstKw) {
  const lines = [];
  (Array.isArray(arr) ? arr : []).forEach((x) => {
    const t = gStep(x);
    if (t) lines.push(`    ${lines.length === 0 ? firstKw : 'And'} ${t}`);
  });
  return lines;
}

/**
 * Render one Story's parsed result as a Gherkin `.feature` string.
 * @param {object} result parsed TEST_CASE result (test_cases[], no_acs, story_name)
 * @param {object} story  the Story (name)
 * @param {object} [opts] { includeConfidence?: boolean }
 * @returns {string}
 */
export function renderGherkin(result, story, opts = {}) {
  const o = opts || {};
  const r = result || {};
  const cases = (Array.isArray(r.test_cases) ? r.test_cases : []).filter((c) => c && typeof c === 'object');
  const out = [];

  out.push(`Feature: ${gText((story && story.name) || r.story_name || 'Untitled Story')}`);
  if (r.no_acs) out.push('  # NOTE: this Story had NO acceptance criteria — every scenario is INFERRED. Review before relying.');
  out.push('');

  // Background only when EVERY case shares an identical, non-empty given[] (≥2 cases).
  const givens = cases.map((c) => (Array.isArray(c.given) ? c.given : []));
  const allSameGiven =
    cases.length > 1 &&
    givens.every((g) => g.length > 0 && JSON.stringify(g) === JSON.stringify(givens[0]));
  const bgLines = allSameGiven ? gStepLines(givens[0], 'Given') : [];
  const hasBackground = bgLines.length > 0;
  if (hasBackground) {
    out.push('  Background:');
    bgLines.forEach((l) => out.push(l));
    out.push('');
  }

  cases.forEach((c) => {
    const tags = [`@${gText(c.type) || 'unspecified'}`];
    if (c.priority) tags.push(`@priority-${String(c.priority).toLowerCase()}`);
    out.push(`  ${tags.join(' ')}`);
    out.push(`  Scenario: ${gText(c.title) || 'Untitled scenario'}`);

    // # Covers: one line per ac_trace entry (the AC text lives ONLY here — bookkeeping, not the test)
    (Array.isArray(c.ac_trace) ? c.ac_trace : []).forEach((t) => {
      if (!t || typeof t !== 'object') return;
      if (t.kind === 'inferred') out.push('    # Covers: [inferred — no authored AC]');
      else out.push(`    # Covers: [${gText(t.kind)}] ${gText(t.ac_text)}`);
    });
    // # Test data
    if (Array.isArray(c.test_data) && c.test_data.length) {
      const td = c.test_data.map(gText).filter(Boolean).join(', ');
      if (td) out.push(`    # Test data: ${td}`);
    }
    // Given (inline only when there is no shared Background) · empty steps are skipped (invalid Gherkin)
    if (!hasBackground) gStepLines(c.given, 'Given').forEach((l) => out.push(l));
    // When
    gStepLines(c.when, 'When').forEach((l) => out.push(l));
    // Then (observable outcomes) + the single falsifiable expected_result as the decisive
    // final Then/And STEP — NOT a comment: BDD runners read Then steps as the assertions,
    // so a `# Expected:` comment would be invisible on import (§13 format-fidelity HIGH).
    const thenLines = gStepLines(c.then, 'Then');
    thenLines.forEach((l) => out.push(l));
    if (gStep(c.expected_result)) out.push(`    ${thenLines.length ? 'And' : 'Then'} ${gStep(c.expected_result)}`);
    // # Note: the honest assumption / concern (emitted AS-IS — any concern type renders gracefully)
    if (c.concern) out.push(`    # Note: ${gText(c.concern)}`);
    if (o.includeConfidence && c.confidence_indicator) {
      out.push(`    # Confidence: ${gText(c.confidence_indicator)}${Number.isFinite(c.confidence_score) ? ` (${c.confidence_score})` : ''}`);
    }
    out.push('');
  });

  return out.join('\n').replace(/\n{2,}$/, '\n');
}

// ════════════════════════════════════════════════════════════════
// renderManualTable — universal step-table rows + a HARDENED CSV string
// ════════════════════════════════════════════════════════════════

// 'Suite' = the Story (TestRail/qTest expect a Suite/Section, else a flat root dump).
// 'Test Category' (NOT 'Type') — the tools' own "Type" field means Functional/Manual/Regression;
// our happy-path/edge/negative is a design lens, so it gets a distinct column (§13 format-fidelity).
export const TABLE_COLUMNS = [
  'Suite', 'Title', 'Priority', 'Test Category', 'Preconditions', 'Step #', 'Action', 'Test Data', 'Expected Result', 'References', 'Notes',
];

function refsSummary(c, storyRef) {
  const parts = [];
  if (storyRef) parts.push(String(storyRef).trim());
  (Array.isArray(c.ac_trace) ? c.ac_trace : []).forEach((t) => {
    if (!t || typeof t !== 'object') return;
    if (t.kind === 'inferred') parts.push('[inferred]');
    else parts.push(`[${String(t.kind || '').trim()}] ${String(t.ac_text || '').trim()}`);
  });
  return parts.join('; ');
}

/**
 * Render one Story's parsed result as universal manual-test step rows (+ CSV).
 * Multi-row per case: one row per when[] step; case-level fields only on row 1.
 * @param {object} result parsed TEST_CASE result
 * @param {object} story  the Story — story.name becomes the default 'Suite' (TestRail/qTest section)
 * @param {object} [opts] { storyRef?: string, suite?: string, delimiter?: string (',' default; '\t' = ADO TSV), headerRow?: boolean (false omits the header) }
 * @returns {{ columns: string[], rows: object[], csv: string }}
 */
export function renderManualTable(result, story, opts = {}) {
  const o = opts || {};
  const r = result || {};
  const storyRef = o.storyRef || '';
  const suite = o.suite || (story && story.name) || '';
  const cases = (Array.isArray(r.test_cases) ? r.test_cases : []).filter((c) => c && typeof c === 'object');
  const rows = [];

  if (r.no_acs) {
    rows.push(blankRow({ Suite: suite, Title: '[NO ACCEPTANCE CRITERIA] every scenario below is inferred — review before relying.' }));
  }

  cases.forEach((c) => {
    const when = Array.isArray(c.when) ? c.when : [];
    const then = Array.isArray(c.then) ? c.then : [];
    const td = Array.isArray(c.test_data) ? c.test_data : [];
    const stepCount = Math.max(when.length, then.length);
    const preconditions = (Array.isArray(c.given) ? c.given : []).join(' | ');

    // One row per when/then pair, then the single falsifiable expected_result as its OWN
    // final "verify" row (never concatenated into a step's outcome — §13 format-fidelity).
    const caseRows = [];
    for (let i = 0; i < stepCount; i++) {
      caseRows.push({ Action: when[i] || '', 'Test Data': td[i] || '', 'Expected Result': then[i] || '' });
    }
    if (c.expected_result) {
      if (stepCount === 0) caseRows.push({ Action: '', 'Test Data': td[0] || '', 'Expected Result': c.expected_result });
      else caseRows.push({ Action: 'Verify the expected result', 'Test Data': '', 'Expected Result': c.expected_result });
    }
    if (caseRows.length === 0) caseRows.push({ Action: '', 'Test Data': '', 'Expected Result': '' });

    caseRows.forEach((cr, i) => {
      const isFirst = i === 0;
      rows.push({
        Suite: isFirst ? suite : '',
        Title: isFirst ? (c.title || '') : '',
        Priority: isFirst ? (c.priority || '') : '',
        'Test Category': isFirst ? (c.type || '') : '',
        Preconditions: isFirst ? preconditions : '',
        'Step #': i + 1,
        Action: cr.Action,
        'Test Data': cr['Test Data'],
        'Expected Result': cr['Expected Result'],
        References: isFirst ? refsSummary(c, storyRef) : '',
        Notes: isFirst ? (c.concern || '') : '',
      });
    });
  });

  return { columns: TABLE_COLUMNS, rows, csv: toCSV(TABLE_COLUMNS, rows, o) };
}

function blankRow(overrides) {
  const row = {};
  TABLE_COLUMNS.forEach((c) => { row[c] = ''; });
  return Object.assign(row, overrides || {});
}

// HARDENED CSV cell: neutralize spreadsheet formula-injection + RFC-4180 quote.
function csvCell(v) {
  let s = v == null ? '' : String(v);
  s = s.replace(/\r?\n/g, ' / ').replace(/\t/g, ' ');
  // Excel/Sheets execute a cell whose FIRST NON-SPACE char is = + @ - . Test the leading
  // non-space char (so ` =cmd` after a stripped tab is still caught). Preserve genuine
  // negative numbers (-5000, -0.5); neutralize everything else with a leading apostrophe.
  const lead = s.replace(/^\s+/, '');
  const isNegativeNumber = /^-\d+(\.\d+)?$/.test(lead);
  if (!isNegativeNumber && /^[=+@-]/.test(lead)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function toCSV(columns, rows, opts = {}) {
  const delim = opts.delimiter || ',';
  const lines = [];
  if (opts.headerRow !== false) lines.push(columns.map(csvCell).join(delim));
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(delim));
  return lines.join('\n');
}
