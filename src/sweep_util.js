/**
 * Spec2Tickets — pure helpers for the never-pushed-orphan sweep (Task #13).
 *
 * Lives in its own module (NO Forge runtime deps) so the staleness decision is
 * unit-testable under plain node — index.js itself is not node-importable
 * (`new Resolver()` from @forge/resolver throws outside the Forge runtime).
 * Offline test: prototype/test_orphan_sweep.js.
 */

/**
 * ⭐ Is an abandoned `distill_session:` record past its retention window? (privacy fix 2026-07-25)
 *
 * `startDistillSession` writes up to DISTILL_MAX_INPUT_CHARS of the CUSTOMER'S PASTED TEXT to KVS, and
 * ONLY a run that reaches its final step deletes it. Every session abandoned in between — a closed tab,
 * a failed step never retried, a mid-pipeline credit block — left that content in storage INDEFINITELY,
 * contradicting the retention posture the site publishes. The daily sweep now enumerates the prefix and
 * deletes anything past this window.
 *
 * @param {object} session the distill session value ({ input, clipped, sections, createdAt, keySource })
 * @param {number} nowMs current time, ms epoch
 * @param {number} maxAgeMs the retention window in ms
 * @returns {boolean} true if the session should be swept (deleted)
 */
export function isDistillSessionStale(session, nowMs, maxAgeMs) {
  if (!session || typeof session !== 'object') return true; // unreadable/garbage record → sweep (see below)
  const toMs = (v) =>
    typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  const createdAt = toMs(session.createdAt);
  // ⚠ DELIBERATELY THE OPPOSITE POLARITY TO isOrphanStale. A jobmeta with no usable timestamp is KEPT
  // because a breakdown is the user's DELIVERABLE and a wrong delete loses their work. A distill session
  // is neither: it is a MINUTES-LONG scratch buffer holding the customer's PASTED TEXT verbatim, and its
  // only loss on a wrong delete is re-running Summarize. A record with no readable createdAt is corrupt
  // or pre-dates the field — exactly the kind that would otherwise sit in storage with customer content
  // in it forever. For content we promised not to retain, "delete when in doubt" is the honest polarity.
  if (!Number.isFinite(createdAt)) return true;
  return nowMs - createdAt > maxAgeMs;
}

/**
 * Is a job's lean jobmeta past the inactivity window? Prefers `lastAccessedAt`
 * (a ms-epoch number, stamped by setJob + renewed by touchJobAccess); falls back
 * to `startedAt` (an ISO string on the mirror) for pre-Task-#13 metas. A meta with
 * NO usable timestamp is KEPT — never delete on missing data (fail-safe).
 *
 * @param {object} meta the jobmeta value ({ status, pageTitle, startedAt, lastAccessedAt })
 * @param {number} nowMs current time, ms epoch
 * @param {number} inactivityMs the inactivity window in ms
 * @returns {boolean} true if the job should be swept (deleted)
 */
export function isOrphanStale(meta, nowMs, inactivityMs) {
  if (!meta || typeof meta !== 'object') return false;
  const toMs = (v) =>
    typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  let lastAt = toMs(meta.lastAccessedAt);
  if (!Number.isFinite(lastAt)) lastAt = toMs(meta.startedAt); // pre-Task-#13 fallback
  if (!Number.isFinite(lastAt)) return false; // unknown age → keep (fail-safe)
  return nowMs - lastAt > inactivityMs;
}
