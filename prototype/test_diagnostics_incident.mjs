/**
 * Offline test for the Diagnostics incident-story composer
 * (static/hello-world/src/lib/diagnosticsView.js — composeIncident + friendlyCounts).
 *
 * Plain-Node ESM, self-contained. Run:
 *   node prototype/test_diagnostics_incident.mjs
 *
 * Guards the load-bearing lever of the Diagnostics tab redesign (screen 8): each diagnostic record
 * must read as a plain-English INCIDENT STORY (the partner rejected the first attempt as "the old log").
 * Covers every templated class + the classText fallback for an unknown class, and proves zeros never
 * become friendly chips.
 */
import {
  composeIncident,
  friendlyCounts,
  classText,
} from '../static/hello-world/src/lib/diagnosticsView.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  PASS  ' + msg); }
  else { fail++; console.error('  FAIL  ' + msg); }
}
function eq(a, b, msg) {
  ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}
function has(hay, needle, msg) {
  ok(typeof hay === 'string' && hay.includes(needle), `${msg} (got ${JSON.stringify(hay)}, want substr ${JSON.stringify(needle)})`);
}
const chipLabels = (inc) => inc.chips.map((c) => c.label);

// ── push_completed — everything landed ────────────────────────────────────────
let inc = composeIncident({
  error_class: 'push_completed', level: 'info',
  subject: { kind: 'issue', id: 'MOBILE-100' },
  counts: { stories_created: 12, subtasks_created: 34, links_created: 8, tc_embedded: 0, tc_skipped: 0, tasks_embedded: 0 },
});
eq(inc.title, 'Pushed to Jira — everything landed', 'push_completed title');
eq(inc.sentence, 'Pushed 12 stories, 34 sub-tasks and 8 links. All landed.', 'push_completed sentence exact');
eq(inc.level, 'info', 'push_completed level info');
eq(inc.destination, 'MOBILE-100', 'push_completed destination = subject issue key');
ok(chipLabels(inc).includes('12 stories') && chipLabels(inc).includes('8 links'), 'push_completed friendly chips');
ok(!chipLabels(inc).some((l) => /test cases|checklist|stale/.test(l)), 'push_completed zeros not chipped (tc/tasks all 0)');

// push_completed with the two silent-degradation tails
inc = composeIncident({
  error_class: 'push_completed', level: 'info',
  counts: { stories_created: 5, subtasks_created: 0, links_created: 0, tasks_embedded: 3, tc_skipped: 2 },
});
has(inc.sentence, 'Pushed 5 stories, 0 sub-tasks and 0 links. All landed.', 'push_completed lead sentence');
has(inc.sentence, 'Some sub-tasks became checklist items', 'push_completed tasks_embedded tail');
has(inc.sentence, 'Some test cases were stale and skipped.', 'push_completed tc_skipped tail');
eq(inc.destination, null, 'push_completed no subject -> destination null');

// ── partial_push — dominant-failure variants ──────────────────────────────────
// (A) stories_failed + jira rejected fields
inc = composeIncident({
  error_class: 'partial_push', level: 'error',
  subject: { kind: 'issue', id: 'MOBILE-100' },
  subject_keys: ['MOBILE-101', 'MOBILE-102'],
  jira: [{ status: 400, field_names: ['customfield_10042'] }],
  counts: { stories_created: 8, stories_failed: 2, links_created: 3 },
});
eq(inc.title, 'Some items failed to push to Jira', 'partial_push title');
has(inc.sentence, 'Everything landed except 2 stories', 'partial_push stories_failed lead');
has(inc.sentence, "a required custom field wasn't set", 'partial_push stories_failed cause');
eq(inc.fixChips.length, 1, 'partial_push one fixChip');
eq(inc.fixChips[0].field, 'customfield_10042', 'partial_push fixChip field id');
eq(inc.affected.length, 2, 'partial_push affected keys from subject_keys');
ok(inc.affected.includes('MOBILE-101'), 'partial_push affected key value');
eq(inc.destination, 'MOBILE-100', 'partial_push destination = epic');

// (B) links_unresolved_name_unknown = 1 (the report exemplar)
inc = composeIncident({
  error_class: 'partial_push', level: 'error',
  counts: { stories_created: 10, links_created: 4, links_unresolved_name_unknown: 1 },
});
eq(
  inc.sentence,
  "Everything landed except 1 dependency link — the AI paraphrased a story name that didn't match, so the link couldn't resolve.",
  'partial_push name_unknown=1 sentence exact (singular, no trailing)',
);

// name_unknown plural
inc = composeIncident({ error_class: 'partial_push', level: 'error', counts: { links_unresolved_name_unknown: 3 } });
has(inc.sentence, 'except 3 dependency links', 'partial_push name_unknown plural link->links');

// (C) subtasks_orphaned
inc = composeIncident({ error_class: 'partial_push', level: 'error', counts: { subtasks_orphaned: 5 } });
has(inc.sentence, "5 sub-tasks didn't land", 'partial_push subtasks_orphaned lead');
has(inc.sentence, 'no Sub-task type', 'partial_push subtasks_orphaned cause');

// (D) links_unresolved_story_failed
inc = composeIncident({ error_class: 'partial_push', level: 'error', counts: { links_unresolved_story_failed: 2 } });
has(inc.sentence, "2 dependency links couldn't be created", 'partial_push story_failed lead');
has(inc.sentence, 'a linked story failed to push', 'partial_push story_failed cause');

// (E) links_api_failed
inc = composeIncident({ error_class: 'partial_push', level: 'error', counts: { links_api_failed: 1 } });
has(inc.sentence, '1 dependency link failed at the Jira API', 'partial_push api_failed lead');

// (F) several non-zero -> first + trailing "...and other issues"
inc = composeIncident({
  error_class: 'partial_push', level: 'error',
  counts: { stories_failed: 1, subtasks_orphaned: 2, links_api_failed: 1 },
});
has(inc.sentence, 'Everything landed except 1 story', 'partial_push multi leads with stories_failed (first in order)');
has(inc.sentence, '...and other issues — see the counts.', 'partial_push multi trailing note');

// (F2) stories_failed guard — the custom-field cause is asserted ONLY when the record carries a rejected field.
inc = composeIncident({ error_class: 'partial_push', level: 'error', counts: { stories_failed: 2 } });
has(inc.sentence, 'open the raw counts for the exact reason', 'partial_push stories_failed WITHOUT field_names -> generic reason (F2)');
inc = composeIncident({ error_class: 'partial_push', level: 'error', counts: { stories_failed: 2 }, jira: [{ field_names: ['customfield_10042'] }] });
has(inc.sentence, "a required custom field wasn't set", 'partial_push stories_failed WITH field_names -> custom-field cause (F2)');
// (F3) singular grammar agrees with the pluralized chips.
inc = composeIncident({ error_class: 'push_completed', level: 'info', counts: { stories_created: 1, subtasks_created: 1, links_created: 1 } });
has(inc.sentence, 'Pushed 1 story, 1 sub-task and 1 link. All landed.', 'push_completed singular grammar (F3)');

// ── generation_completed ──────────────────────────────────────────────────────
inc = composeIncident({ error_class: 'generation_completed', level: 'info', counts: { features: 37, cost_usd: 0.118 } });
eq(inc.title, 'A breakdown completed', 'generation_completed title');
eq(inc.sentence, 'Generated 37 features, cost ~$0.12 on your Anthropic key.', 'generation_completed sentence (cost 2dp)');
ok(chipLabels(inc).includes('37 features'), 'generation_completed features chip');
ok(chipLabels(inc).some((l) => l.startsWith('~$0.12')), 'generation_completed cost chip (always)');

// ── testgen_completed — the count key is `stories` (NOT stories_created) ───────
inc = composeIncident({ error_class: 'testgen_completed', level: 'info', counts: { stories: 13 } });
eq(inc.title, 'Test cases generated', 'testgen_completed title');
eq(inc.sentence, 'Generated test cases across 13 stories.', 'testgen_completed sentence uses `stories` key');
ok(chipLabels(inc).includes('13 stories covered'), 'testgen_completed `stories` chip label');

// ── health_ok ─────────────────────────────────────────────────────────────────
inc = composeIncident({ error_class: 'health_ok', level: 'info' });
eq(inc.title, 'Health check passed', 'health_ok title');
has(inc.sentence, 'All four production checks passed', 'health_ok sentence');

// ── push_exception — aborted push, "so far" chips ─────────────────────────────
inc = composeIncident({
  error_class: 'push_exception', level: 'error',
  counts: { stories_created: 4, subtasks_created: 6 },
});
eq(inc.title, "A push didn't finish", 'push_exception title');
has(inc.sentence, 'A push stopped partway', 'push_exception sentence');
has(inc.sentence, 'Nothing was rolled back', 'push_exception reassurance');
ok(chipLabels(inc).includes('4 stories so far'), 'push_exception stories "so far" chip');
ok(chipLabels(inc).includes('6 sub-tasks so far'), 'push_exception sub-tasks "so far" chip');

// ── session_not_found ─────────────────────────────────────────────────────────
inc = composeIncident({ error_class: 'session_not_found', level: 'warn' });
eq(inc.title, "A push couldn't resume", 'session_not_found title');
has(inc.sentence, 'The push session expired', 'session_not_found sentence');
eq(inc.level, 'warn', 'session_not_found level warn');

// ── unknown class -> classText fallback ───────────────────────────────────────
inc = composeIncident({ error_class: 'kvs_write_failed', level: 'warn' });
const ct = classText('kvs_write_failed');
eq(inc.title, ct.title, 'unknown-to-template class falls back to classText title');
eq(inc.sentence, ct.hint, 'unknown-to-template class falls back to classText hint');

// a truly unregistered class -> UNKNOWN_TEXT via classText
inc = composeIncident({ error_class: 'totally_made_up_class', level: 'error' });
eq(inc.title, classText('totally_made_up_class').title, 'unregistered class -> classText UNKNOWN_TEXT title');

// ── seen (occurrences > 1) ────────────────────────────────────────────────────
inc = composeIncident({
  error_class: 'partial_push', level: 'error',
  counts: { stories_failed: 1 },
  occurrences: { count: 3, firstTs: Date.now() - 10000, lastTs: Date.now() - 1000 },
});
has(inc.seen, 'Seen 3 times', 'seen line when occurrences.count > 1');
// count == 1 -> no seen
inc = composeIncident({ error_class: 'partial_push', level: 'error', counts: { stories_failed: 1 }, occurrences: { count: 1, firstTs: 1, lastTs: 1 } });
eq(inc.seen, null, 'no seen line when occurrences.count == 1');

// ── friendlyCounts directly — zeros dropped, soFar override ────────────────────
let fc = friendlyCounts(Object.entries({ stories_created: 0, links_created: 5 }));
ok(!fc.some((c) => c.key === 'stories_created'), 'friendlyCounts drops the zero');
ok(fc.some((c) => c.key === 'links_created' && c.label === '5 links'), 'friendlyCounts keeps the non-zero');
fc = friendlyCounts(Object.entries({ stories_created: 2 }), { soFar: true });
eq(fc[0].label, '2 stories so far', 'friendlyCounts soFar override');
// cost_usd is `always` -> chips even at 0
fc = friendlyCounts(Object.entries({ cost_usd: 0 }));
ok(fc.some((c) => c.key === 'cost_usd'), 'friendlyCounts keeps cost_usd even at 0 (always)');

// ── malformed record never throws ─────────────────────────────────────────────
ok((() => { try { composeIncident(null); return true; } catch (_) { return false; } })(), 'composeIncident(null) does not throw');
ok((() => { try { composeIncident({}); return true; } catch (_) { return false; } })(), 'composeIncident({}) does not throw');

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
