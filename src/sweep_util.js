/**
 * Spec2Tickets — pure helpers for the never-pushed-orphan sweep (Task #13).
 *
 * Lives in its own module (NO Forge runtime deps) so the staleness decision is
 * unit-testable under plain node — index.js itself is not node-importable
 * (`new Resolver()` from @forge/resolver throws outside the Forge runtime).
 * Offline test: prototype/test_orphan_sweep.js.
 */

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
