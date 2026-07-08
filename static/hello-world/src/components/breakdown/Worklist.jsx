import { glassSurface } from '../moodboard';
import { IconLink, IconLayers } from '../Icon';
import { confidenceToken, StatusDot, ConfidenceGlyph } from './signalTokens.jsx';

/**
 * Worklist — the LEFT "BREAKDOWN" pane of the 6A three-pane editor. TWO pinned entries at top
 * (EPIC · Edit summary · and · Shared acceptance criteria with an unallocated-count badge) that drive
 * the CENTER pane's mode, then a category-grouped, flag-sorted STORY list. Click any entry to drive the
 * center; every left click is the single source of "what the center shows".
 *
 * ⚠ INVARIANT (Forge iframe): this is `position: sticky` (index.css .s2j-worklist-sticky) — NOT an overflow
 * scroll pane. It sticks under the top bar and the page scrolls; a long list simply stops sticking near the
 * bottom (acceptable). NO 100vh, NO overflow:auto.
 *
 * Sort (must-never-miss first): within a category — open-concern count desc, then confidence
 * (✗ > ⚠ > unrated > ✓), then spec order. Categories are ordered by their most-urgent story.
 *
 * Props:
 *   groups            — [{ category, rows:[row] }] where row = { uid, name, category, indicator, score,
 *                        storyPoints, complexity, priority, openCount, totalConcerns }
 *   mode              — 'story' | 'shared' | 'epic' (which pinned/story entry is active)
 *   selectedUid       — the currently focused story uid (only relevant when mode==='story')
 *   unallocatedCount  — shared ACs not yet assigned to a story (badge on the Shared-AC pinned entry)
 *   onSelectStory(uid)  — focus a story (mode -> 'story')
 *   onSelectEpic()      — select the Epic pinned entry (mode -> 'epic')
 *   onSelectShared()    — select the Shared-AC pinned entry (mode -> 'shared')
 *   onNewStory()        — open the new-story wizard
 *   stickyTop           — the sticky offset (px)
 */
export default function Worklist({
  groups,
  mode = 'story',
  selectedUid,
  unallocatedCount = 0,
  onSelectStory,
  onSelectEpic,
  onSelectShared,
  onNewStory,
  stickyTop = 8,
}) {
  const storyCount = (groups || []).reduce((n, g) => n + g.rows.length, 0);

  return (
    <div
      className="s2j-worklist-sticky"
      style={{ '--s2j-worklist-top': `${stickyTop}px`, alignSelf: 'flex-start' }}
    >
      <div className="rounded-lg" style={{ ...glassSurface('minor'), padding: 10 }}>
        <div className="px-1 pb-2 mb-1" style={{ borderBottom: '1px solid var(--s2j-border)' }}>
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--s2j-text-muted)' }}>
            Breakdown
          </span>
        </div>

        {/* ── Pinned entries: Epic + Shared AC (drive the center; NOT stories) ── */}
        <div className="space-y-1 mb-2">
          {onSelectEpic && (
            <PinnedEntry
              label="Epic"
              sub="Edit summary"
              active={mode === 'epic'}
              onClick={onSelectEpic}
              icon={<IconLayers size={13} />}
            />
          )}
          {onSelectShared && (
            <PinnedEntry
              label="Shared acceptance criteria"
              sub="Cross-cutting · allocate to a story"
              active={mode === 'shared'}
              onClick={onSelectShared}
              icon={<IconLink size={13} />}
              badge={unallocatedCount > 0 ? unallocatedCount : null}
            />
          )}
        </div>

        {/* ── Stories ── */}
        <div className="px-1 pt-1 pb-1 flex items-center justify-between"
          style={{ borderTop: '1px solid var(--s2j-border)' }}>
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--s2j-text-muted)' }}>
            Stories ({storyCount})
          </span>
          <span className="text-[10px]" style={{ color: 'var(--s2j-text-muted)' }}>Risky first</span>
        </div>

        <div className="space-y-2.5 mt-1">
          {groups.map((g) => (
            <div key={g.category}>
              {/* Category header — a rule + weight so it never blurs into the rows (the live complaint). */}
              <div className="flex items-center gap-2 px-1 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-widest truncate"
                  style={{ color: 'var(--s2j-text-light)', letterSpacing: '0.08em' }} title={g.category}>
                  {g.category}
                </span>
                <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--s2j-text-muted)' }}>
                  {g.rows.length}
                </span>
                <span className="flex-1 h-px" style={{ background: 'var(--s2j-border)' }} />
              </div>
              <div className="space-y-1">
                {g.rows.map((row) => (
                  <WorklistRow
                    key={row.uid}
                    row={row}
                    selected={mode === 'story' && row.uid === selectedUid}
                    onSelect={() => onSelectStory(row.uid)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer: + New story. Blue nav-style — it NAVIGATES you into the new-story wizard. */}
        {onNewStory && (
          <div className="pt-2 mt-2" style={{ borderTop: '1px solid var(--s2j-border)' }}>
            <button
              type="button"
              onClick={onNewStory}
              className="w-full text-left rounded-md text-[11px] font-medium transition-colors"
              style={{ color: 'var(--s2j-blue)', background: 'transparent', padding: '5px 8px' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--s2j-bg-section)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              + New story
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PinnedEntry — the Epic / Shared-AC top entries (distinct from story rows). ──
function PinnedEntry({ label, sub, active, onClick, icon, badge }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="w-full text-left rounded-md transition-colors"
      style={{
        border: active ? '1px solid var(--s2j-blue)' : '1px solid var(--s2j-border)',
        background: active ? 'var(--s2j-blue-bg)' : 'var(--s2j-bg-section)',
        padding: '7px 9px',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--s2j-bg)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'var(--s2j-bg-section)'; }}
    >
      <div className="flex items-center gap-2">
        {icon && <span className="shrink-0 inline-flex items-center" style={{ color: active ? 'var(--s2j-blue)' : 'var(--s2j-text-muted)' }} aria-hidden="true">{icon}</span>}
        <span className="flex-1 truncate text-xs font-semibold" style={{ color: 'var(--s2j-text)' }}>{label}</span>
        {badge != null && (
          <span
            className="shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ background: 'var(--s2j-info-bg)', border: '1px solid var(--s2j-info-border)', color: 'var(--s2j-text)' }}
            title={`${badge} shared acceptance criter${badge === 1 ? 'ion is' : 'ia are'} not yet allocated to a story`}
          >
            <StatusDot color="var(--s2j-info)" size={6} />
            {badge}
          </span>
        )}
      </div>
      {sub && (
        <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--s2j-text-muted)' }}>{sub}</div>
      )}
    </button>
  );
}

function WorklistRow({ row, selected, onSelect }) {
  const conf = confidenceToken(row.indicator, row.score);
  const isRated = row.indicator === '✓' || row.indicator === '⚠' || row.indicator === '✗';
  // effectiveIndicator — a REVIEWED story (a flagged ✗/⚠ whose concerns are all addressed) shows the
  // ✓ check glyph + badge, though the AI's ORIGINAL row.indicator/score is untouched (the machine's
  // read). This is the ONLY place the displayed glyph diverges from the raw indicator. Sort/urgency
  // still uses row.indicator (openCount already de-prioritises a resolved row).
  const effectiveIndicator = row.reviewed ? '✓' : row.indicator;
  // A row is "clear" only when it has NO open concerns AND is confident (effectively ✓ — either a real
  // ✓ or a flagged story the human fully reviewed). Unrated / ⚠ / ✗-with-concerns-open is NOT clear.
  const clear = row.openCount === 0 && effectiveIndicator === '✓';
  // An UNRATED row (no ✓/⚠/✗) with no open concerns is NOT signed-off — surface it explicitly.
  const unratedSilent = row.openCount === 0 && !isRated;
  const compact = clear;

  // Meta line: SP · Cx · priority (only the parts we have).
  const metaBits = [];
  if (row.storyPoints != null) metaBits.push(`${row.storyPoints} SP`);
  if (row.complexity != null) metaBits.push(`C${row.complexity}`);
  if (row.priority) metaBits.push(row.priority);

  return (
    <button
      type="button"
      onClick={onSelect}
      data-worklist-uid={row.uid}
      aria-pressed={selected}
      aria-controls="s2j-focused-story"
      aria-label={`Select story: ${row.name}`}
      className="w-full text-left rounded-md transition-colors"
      style={{
        border: selected ? '1px solid var(--s2j-blue)' : '1px solid transparent',
        background: selected ? 'var(--s2j-blue-bg)' : 'transparent',
        padding: compact ? '5px 8px' : '7px 8px',
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = 'var(--s2j-bg-section)'; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
    >
      <div className="flex items-center gap-2">
        {/* Confidence glyph — COLOUR on the icon, the word (name) stays dark. A reviewed story shows the
            ✓ check glyph (effectiveIndicator) with a "you addressed the concerns" title; the AI's
            original indicator/score is unchanged (see FocusedStory + the AI SCORE). */}
        <span
          className="shrink-0 inline-flex items-center justify-center"
          style={{ width: 18 }}
          title={row.reviewed
            ? 'Reviewed — you addressed all the AI concerns on this story (the AI\'s original score is unchanged).'
            : conf.explain}
        >
          <ConfidenceGlyph indicator={effectiveIndicator} size={16} />
        </span>
        <span className="flex-1 truncate text-xs font-medium" style={{ color: 'var(--s2j-text)' }}>
          {row.name}
        </span>
        {row.openCount > 0 ? (
          <span
            className="shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ background: 'var(--s2j-info-bg)', border: '1px solid var(--s2j-info-border)', color: 'var(--s2j-text)' }}
            title={`${row.openCount} AI-flagged concern${row.openCount === 1 ? '' : 's'} still open on this story`}
          >
            <StatusDot color="var(--s2j-info)" size={6} />
            {row.openCount}
          </span>
        ) : clear ? (
          <span className="shrink-0 inline-flex items-center text-[11px] font-bold leading-none"
            style={{ color: 'var(--s2j-trust)' }}
            aria-label="Reviewed" title="No open concerns and high-confidence — reviewed.">
            ✓
          </span>
        ) : unratedSilent ? (
          <span
            className="shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ background: 'var(--s2j-info-bg)', border: '1px solid var(--s2j-info-border)', color: 'var(--s2j-text)' }}
            title="The AI gave this story no confidence rating — review it before you push.">
            <StatusDot color="var(--s2j-info)" size={6} />
            Unrated
          </span>
        ) : null}
      </div>
      {/* Meta line — SP · Cx · priority on EVERY row. */}
      {metaBits.length > 0 && (
        <div className={`${compact ? 'mt-0' : 'mt-0.5'} pl-6 text-[10px] font-mono`} style={{ color: 'var(--s2j-text-muted)' }}>
          {metaBits.join('  ·  ')}
        </div>
      )}
    </button>
  );
}

/**
 * buildWorklistGroups — pure: turn the breakdown's capabilities + the readiness perFeature map into
 * category-grouped, flag-sorted rows. Exported so the orchestrator + an offline test can share it.
 *
 * openByUid  — Map<uid, {openCount, totalCount}> from computeReviewReadiness().perFeature.
 */
export function buildWorklistGroups(capabilities, openByUid) {
  const groups = [];
  for (const cap of capabilities || []) {
    const rows = (cap.features || []).map((f, specIndex) => {
      const disp = openByUid.get(f._uid) || { openCount: 0, totalCount: (f.concerns || []).length };
      return {
        uid: f._uid,
        name: f.name || '(unnamed)',
        category: cap.name,
        indicator: f.confidence_indicator,
        score: typeof f.confidence_score === 'number' ? f.confidence_score : (f.confidence ?? null),
        storyPoints: typeof f.story_points === 'number' ? f.story_points : null,
        complexity: typeof f.complexity_score === 'number' ? f.complexity_score : null,
        priority: f.priority || null,
        openCount: disp.openCount,
        totalConcerns: disp.totalCount,
        // "reviewed" = a flagged (✗/⚠) story whose AI concerns are ALL resolved (from
        // computeReviewReadiness). The AI's original indicator/score is preserved; only the
        // worklist glyph + the readiness count treat it as ✓ (see WorklistRow's effectiveIndicator).
        reviewed: openByUid.get(f._uid)?.reviewed || false,
        _specIndex: specIndex,
      };
    });
    rows.sort(flagCompare);
    if (rows.length > 0) groups.push({ category: cap.name, rows });
  }
  // Order categories by their most-urgent row (the first row after the within-category sort).
  groups.sort((a, b) => rowUrgency(b.rows[0]) - rowUrgency(a.rows[0]));
  return groups;
}

// confidence rank: ✗ (most urgent) -> ⚠ -> unrated -> ✓ (least).
function confRank(indicator) {
  if (indicator === '✗') return 3;
  if (indicator === '⚠') return 2;
  if (indicator === '✓') return 0;
  return 1; // unrated sits above ✓ (an unreviewed row must not read as clean)
}

// A single scalar for "how urgent is this row" — open concerns dominate, then confidence.
function rowUrgency(row) {
  if (!row) return -1;
  return (row.openCount || 0) * 10 + confRank(row.indicator);
}

// Within-category sort: open concerns desc, then confidence, then spec order.
function flagCompare(a, b) {
  if ((b.openCount || 0) !== (a.openCount || 0)) return (b.openCount || 0) - (a.openCount || 0);
  const cr = confRank(b.indicator) - confRank(a.indicator);
  if (cr !== 0) return cr;
  return a._specIndex - b._specIndex;
}
