import { SignalCallout } from '../Signal';
import { CONCERN_TYPE_LABEL } from '../../lib/v3Schema';

/**
 * ComplianceLandmine — the pinned, always-visually-first callout for the single most important concern
 * the AI raised: a compliance (or high-severity spec-level) landmine. INFORMATIONAL, not resolvable:
 * there is no in-editor sign-off workflow, so the copy is honest — it points the BA to legal/DPO, it
 * never offers a promise-y "assign" or "resolve" action.
 *
 * `landmine` = computeReviewReadiness(breakdown).landmine (may be null). Shape:
 *   { type, severity, text, relatedFeatureName?, relatedFeatureUid? }
 *
 * onJumpToFeature(uid) — optional: when the landmine is feature-level, offer a blue "Open the story"
 * jump (navigate/open = blue). Spec-level landmines have no target, so no jump is shown.
 */
export default function ComplianceLandmine({ landmine, onJumpToFeature }) {
  if (!landmine) return null;

  const isCompliance = landmine.type === 'COMPLIANCE';
  const typeLabel = CONCERN_TYPE_LABEL[landmine.type] || landmine.type;
  const lead = isCompliance
    ? 'Compliance landmine — needs legal / DPO sign-off'
    : `High-severity ${typeLabel.toLowerCase()} concern`;

  return (
    <SignalCallout kind="error" title={lead} iconTitle={lead} fontSize={13}>
      <p style={{ margin: 0, color: 'var(--s2j-text)' }}>{landmine.text}</p>
      {landmine.relatedFeatureName && (
        <p className="text-xs" style={{ margin: '4px 0 0', color: 'var(--s2j-text-light)' }}>
          Raised on: <span style={{ fontWeight: 600, color: 'var(--s2j-text)' }}>{landmine.relatedFeatureName}</span>
        </p>
      )}
      <p className="text-xs" style={{ margin: '6px 0 0', color: 'var(--s2j-text-light)' }}>
        {isCompliance
          ? 'This cannot be resolved in the editor — it needs a legal / DPO sign-off before these issues become work.'
          : 'This is a spec-level flag the AI could not resolve — confirm it with the right owner before you build.'}
      </p>
      {landmine.relatedFeatureUid && onJumpToFeature && (
        <button
          onClick={() => onJumpToFeature(landmine.relatedFeatureUid)}
          className="text-xs mt-1.5"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--s2j-blue)',
            cursor: 'pointer',
            padding: 0,
            fontWeight: 600,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
          onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
          title="Open the story this concern was raised on"
        >
          Open the story →
        </button>
      )}
    </SignalCallout>
  );
}
