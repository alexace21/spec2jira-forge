/**
 * diagnosticsView — the SINGLE frontend humanize authority for the diagnostic
 * ledger (diagnostics Phase 5, design §2.9 / §5).
 *
 * Backend↔frontend code-sync is a NAMED review check: the CLASS_TEXT map below
 * mirrors src/diagnostics.js DIAG_CLASSES 1:1 (every class in that closed
 * registry has an entry here; adding a class there REQUIRES adding its text
 * here). The OP_LABELS map mirrors DIAG_OPS the same way. Unknown codes never
 * render blank — they fall back to UNKNOWN_TEXT, and interpolated legacy
 * families (anthropic_529, confluence_404, results_fetch_500, …) are
 * normalized to their family class for display only.
 *
 * PRESENTATION ONLY — no fetching, no state, no diagnostics logic. Pure
 * functions consumed by App.js (S4 failure card, ErrorScreen) and
 * AdminSettings.jsx (the Diagnostics tab).
 */

// ── classText ────────────────────────────────────────────────────────────
// Plain-English one-liners per error_class: `title` leads the row/card;
// `hint` is the tooltip ("what this means / what to do").

const CLASS_TEXT = {
  // ── KVS / persistence ──────────────────────────────────────────────────
  kvs_write_failed: {
    title: "A storage write failed",
    hint: "The app could not write a bookkeeping record to Forge storage. Usually transient — retry the action; contact support if it keeps happening.",
  },
  // Health-probe-only token (not a ledger class): the kvs_rw round-trip failed.
  kvs_failed: {
    title: "Storage round-trip failed",
    hint: "The health check could not write and read back a probe value in Forge storage. Retry; if it persists, Forge storage is having trouble.",
  },
  kvs_read_failed: {
    title: "A storage read failed",
    hint: "The app could not read a record from Forge storage. Usually transient — reload and try again.",
  },
  kvs_persist_failed: {
    title: "The breakdown was too large to store",
    hint: "The completed breakdown could not be saved to Forge storage (typically the value-size limit on very large pages). Review and push it in the same tab; consider splitting very large pages.",
  },
  edited_persist_failed: {
    title: "Edited content could not be saved to storage",
    hint: "The edited breakdown failed to persist — follow-up steps may have used the original (unedited) stories. Retry the action.",
  },
  pagesnap_write_failed: {
    title: "The page snapshot could not be stored",
    hint: "The source-page snapshot failed to save. Test-case generation may run without the page text and produce shallower cases.",
  },
  pagesnap_missing: {
    title: "The page snapshot was missing",
    hint: "Test cases were generated without the stored page text — cases may be less grounded in the source page. Regenerating the breakdown restores the snapshot.",
  },
  key_storage_failed: {
    title: "The stored API key could not be read",
    hint: "A storage fault prevented reading your saved Anthropic key (different from 'no key set'). Re-save the key in Settings; contact support if it recurs.",
  },
  purge_incomplete: {
    title: "Stored data was not fully removed",
    hint: "A post-push cleanup could not delete every stored record. The leftovers stay inside your Atlassian instance; pushing again clears them, or contact support.",
  },
  // ── Push to Jira ───────────────────────────────────────────────────────
  partial_push: {
    title: "Some items failed to push to Jira",
    hint: "One or more Stories, Subtasks or links could not be created. The counts on this record show what failed; the items that succeeded are in Jira.",
  },
  orphaned_subtasks: {
    title: "Subtasks were skipped because their Story failed",
    hint: "A Story failed to create, so its Subtasks were skipped. Fix the Story failure (see the related push record) and push again.",
  },
  link_unresolved: {
    title: "A dependency link did not match any Story",
    hint: "A 'blocks' link named a Story that could not be found among the created issues (often a renamed or paraphrased name). Create the link manually in Jira.",
  },
  links_api_failed: {
    title: "Jira rejected a dependency link",
    hint: "The issue-link create call failed in Jira. Check that issue linking is enabled for the project.",
  },
  step_exception: {
    title: "A push step failed unexpectedly",
    hint: "One chunk of the push threw an error mid-flight. Some items may already exist in Jira — check the project before retrying to avoid duplicates.",
  },
  session_not_found: {
    title: "The push session expired or was missing",
    hint: "The push could not find its session or job record (it may have expired or been purged). Re-open the breakdown and push again.",
  },
  subtask_type_unresolved: {
    title: "No Subtask type — tasks embedded as checklists",
    hint: "The Jira project has no Subtask issue type, so tasks were embedded into Story descriptions as checklists. Enable the Subtask type in project settings to create real Subtasks.",
  },
  duplicate_work: {
    title: "The same work may have run twice",
    hint: "A retried step may have re-created items (for example after a timeout). Check Jira for duplicates of the affected issues.",
  },
  project_not_found: {
    title: "The Jira project was not found",
    hint: "The configured project key does not exist or your account cannot browse it. Check the Default Jira Project Key in Settings.",
  },
  permission_denied: {
    title: "Jira denied access",
    hint: "Jira returned a permission error — your account may lack permission to create issues in this project. Ask a Jira admin.",
  },
  no_project_key: {
    title: "No Jira project key configured",
    hint: "A push was attempted without a default Jira project key. Set one in Settings.",
  },
  no_breakdown: {
    title: "The push had no breakdown payload",
    hint: "A push was attempted without a breakdown (an app-side issue). Re-open the breakdown and try again; contact support if it recurs.",
  },
  push_exception: {
    title: "The push failed to start",
    hint: "The push start threw outside its structured error paths. Retry; contact support with this record if it persists.",
  },
  // ── Anthropic / batch lifecycle ────────────────────────────────────────
  auth_rejected: {
    title: "Anthropic rejected the API key",
    hint: "The key is invalid or revoked (401). Verify it at console.anthropic.com → API Keys, then update Settings.",
  },
  insufficient_credits: {
    title: "The Anthropic account is out of credits",
    hint: "Anthropic returned 402. Add credits at console.anthropic.com → Billing, then retry.",
  },
  rate_limited: {
    title: "Anthropic rate limit reached",
    hint: "Anthropic returned 429. Wait a moment and retry; review your limits at console.anthropic.com.",
  },
  anthropic_http: {
    title: "Anthropic returned an error",
    hint: "An Anthropic API call failed (the status rides on this record). Usually transient — retry in a few minutes.",
  },
  batch_expired: {
    title: "The generation results expired",
    hint: "Anthropic batch results are retrievable for a limited window (~24h) and this job's window passed before they were fetched. Generate again.",
  },
  batch_stuck: {
    title: "A generation batch appears stuck",
    hint: "The batch stayed in a non-final state beyond the expected window. Start a fresh generation; the stuck one expires on Anthropic's side.",
  },
  batch_unknown_status: {
    title: "The batch reported an unknown status",
    hint: "Anthropic returned a status outside the known set, so polling cannot finish. Start a fresh generation; contact support with this record.",
  },
  no_results_url: {
    title: "The finished batch carried no results",
    hint: "The batch ended without a results link — an Anthropic-side anomaly. Generate again.",
  },
  result_row_missing: {
    title: "An expected result row was missing",
    hint: "The batch results were missing an expected entry. Re-run the affected generation or story.",
  },
  refused: {
    title: "The model declined to process the content",
    hint: "Claude refused this request. Review the page content and try again.",
  },
  parse_failed: {
    title: "The model response could not be parsed",
    hint: "The response was not valid JSON for the expected schema. Usually a one-off — retry; if it repeats on the same page, contact support.",
  },
  truncated: {
    title: "The output hit the size limit",
    hint: "The response was cut off at the token cap and could not be recovered. Try a smaller page, or regenerate.",
  },
  truncation_salvaged: {
    title: "A cut-off output was partially recovered",
    hint: "The output hit the token cap; complete items were salvaged but the tail may be missing. Review the affected stories (marked 'may be truncated').",
  },
  // ── Product HTTP / network ─────────────────────────────────────────────
  confluence_http: {
    title: "Confluence returned an error",
    hint: "A Confluence API call failed (the status rides on this record). Try reopening the page; if it persists, check the app's access with your admin.",
  },
  jira_http: {
    title: "Jira returned an error",
    hint: "A Jira API call failed (status and field names ride on this record). Check the project's required fields and settings.",
  },
  network_failure: {
    title: "A network request failed",
    hint: "The call never received an HTTP response (network problem or timeout). Check connectivity and retry.",
  },
  egress_blocked: {
    title: "A request was blocked by Forge",
    hint: "Forge blocked an outbound request (egress permissions). This is an app-configuration issue — contact support.",
  },
  // ── Config / licensing / quota gates ───────────────────────────────────
  not_configured: {
    title: "A required setting is missing",
    hint: "A needed setting (for example the Anthropic API key) is not set. Open Settings and complete the configuration.",
  },
  // v6 value-split: both live editions are BYOK (no managed key, no cap), so these two
  // classes are DORMANT for Marketplace customers — they only fire on the off-Marketplace
  // Managed fallback / legacy jobs. Copy kept generic so it never misleads a BYOK user.
  managed_unavailable: {
    title: "The AI service was unavailable",
    hint: "An Anthropic key was not available. Both editions use your own Anthropic key — open Settings and add it if it is missing, or contact support.",
  },
  quota_exceeded: {
    title: "The monthly allowance was reached",
    hint: "A metered fair-use allowance ran out — an intended block, recorded for the timeline. It resets monthly. Both Marketplace editions are unlimited on your own Anthropic key.",
  },
  license_required: {
    title: "No active license was found",
    hint: "The defensive license check fired. Manage the subscription from your Atlassian admin; contact support if you believe this is wrong.",
  },
  gate_fail_open: {
    title: "A safety check failed open",
    hint: "A license/quota check threw an error and the app proceeded rather than blocking. Nothing for you to fix — this record helps support spot metering gaps.",
  },
  config_invalid: {
    title: "A stored setting could not be parsed",
    hint: "A saved configuration value (for example the required-custom-fields JSON) is invalid. Fix it in Settings → Advanced.",
  },
  context_profile_failed: {
    title: "The Project Context could not be loaded",
    hint: "The selected context profile failed to resolve, so generation ran without it. Re-select the profile and regenerate if the context matters for this page.",
  },
  distill_category_dropped: {
    title: "A distill category came back empty",
    hint: "One or more categories were missing from the summarized project context. Re-run Summarize with Claude to fill them.",
  },
  // ── Generation post-processing ─────────────────────────────────────────
  cycle_repair_failed: {
    title: "Dependency-cycle cleanup failed",
    hint: "The automatic circular-dependency resolution failed; the breakdown may keep a cycle. Review the dependencies on the Review screen.",
  },
  // ── Test-gen / export ──────────────────────────────────────────────────
  partial_testgen: {
    title: "Test cases failed for some stories",
    hint: "One or more stories failed in the test-case batch (the cause split rides on this record's counts). Use the per-story Regenerate on the Test Cases screen.",
  },
  story_removed: {
    title: "The story is no longer in the breakdown",
    hint: "A regenerate targeted a story that was removed in the editor. Remove the orphaned card or re-add the story.",
  },
  regen_overwrote_good: {
    title: "A failed regenerate replaced good cases",
    hint: "A regeneration failed and overwrote previously good test cases. Regenerate the story again to restore them.",
  },
  export_partial: {
    title: "The export skipped some stories",
    hint: "The exported file was missing failed or empty stories while looking complete. Regenerate the skipped stories and export again.",
  },
  export_failed: {
    title: "The export could not be rendered",
    hint: "The Gherkin/CSV render failed for this request. Retry; contact support if it persists.",
  },
  // ── Tracking / dashboard ───────────────────────────────────────────────
  tracking_degraded: {
    title: "Job tracking was degraded",
    hint: "The generation started, but its dashboard bookkeeping failed — the job may not show on the picker dashboard. The job itself still runs; reopen the page to reconnect.",
  },
  // ── Client-side fallback ───────────────────────────────────────────────
  invoke_rejected: {
    title: "An app request failed before completing",
    hint: "The browser-to-app call was rejected (the resolver may have been stopped at the platform's 25-second limit). This client-side record may be the only trace — retry the action.",
  },
  invoke_timeout: {
    title: "An app request never returned",
    hint: "The call hit the platform's hard time limit with no response. This client-side record may be the only trace — retry the action.",
  },
  // ── Health & success breadcrumbs ───────────────────────────────────────
  health_ok: {
    title: "Health check passed",
    hint: "All probes (API key, Confluence read, Jira project, storage) passed at this time.",
  },
  health_degraded: {
    title: "Health check found problems",
    hint: "One or more probes failed — see the probe codes on this record and fix the failing configuration.",
  },
  generation_completed: {
    title: "A breakdown completed",
    hint: "Success breadcrumb (counts only) — a timeline marker showing the app was working at this time.",
  },
  push_completed: {
    title: "A push to Jira completed",
    hint: "Success breadcrumb (counts only) — a timeline marker showing the app was working at this time.",
  },
  testgen_completed: {
    title: "Test-case generation completed",
    hint: "Success breadcrumb (counts only) — a timeline marker showing the app was working at this time.",
  },
  // ── Sentinel ───────────────────────────────────────────────────────────
  unknown_error: {
    title: "An unrecognized problem was recorded",
    hint: "The event did not match a known class. Copy the full report and contact support@spec2jira.com.",
  },
};

// Generic fallback — a FUTURE class (backend registry grew before this map)
// must never render blank.
const UNKNOWN_TEXT = {
  title: "A problem was recorded",
  hint: "No description is available for this code yet. Copy the full report and contact support@spec2jira.com.",
};

// Interpolated legacy families (S4 failure card feeds RAW job error codes such
// as 'anthropic_529' / 'confluence_404' / 'results_fetch_500' — the ledger
// itself never stores these). Normalize to the family class for DISPLAY only.
function normalizeFamily(code) {
  if (/^anthropic_\d{3}$/.test(code)) return "anthropic_http";
  if (/^results_fetch_\d{3}$/.test(code)) return "anthropic_http";
  if (/^confluence_\d{3}$/.test(code)) return "confluence_http";
  if (/^jira_\d{3}$/.test(code)) return "jira_http";
  if (code === "batch_request_expired") return "batch_expired";
  // the other batch_request_* raw codes (errored/canceled/unknown) — same family
  // text as the backend mapper assigns them (deep-audit P3 view-map polish)
  if (/^batch_request_/.test(code)) return "anthropic_http";
  return code;
}

/**
 * Humanized text for an error class (or a raw backend error code).
 * Always returns { title, hint } — never blank.
 */
export function classText(errorClass) {
  const code = typeof errorClass === "string" ? errorClass : "";
  return CLASS_TEXT[code] || CLASS_TEXT[normalizeFamily(code)] || UNKNOWN_TEXT;
}

// ── opLabel ──────────────────────────────────────────────────────────────
// Short display labels per DIAG_OPS (mirrors src/diagnostics.js).

const OP_LABELS = {
  "generation.start": "Generation start",
  "generation.poll": "Generation polling",
  "generation.complete": "Generation completion",
  "push.final": "Push to Jira",
  "push.step": "Push step",
  "push.resume": "Resume push",
  "push.resume.final": "Resume push (final)",
  "testgen.batch": "Test-case generation",
  "testgen.poll": "Test-case poll", // [seams-audit J5] the TC poll flow leg
  "testgen.regen": "Test-case regenerate",
  "testgen.save": "Test-case save",
  "testgen.export": "Test-case export",
  "settings.key": "API key settings",
  "settings.save": "Settings save",
  "distill.step": "Context summarize",
  "confluence.fetch": "Confluence page read",
  "confluence.search": "Confluence search",
  "dashboard.read": "Dashboard read",
  "invoke.failed": "App request",
  "health.check": "Health check",
  purge: "Data cleanup",
  unknown_op: "Unknown operation",
};

/** Short label for an op code. Unknown ops fall back to the raw code (never blank). */
export function opLabel(op) {
  return OP_LABELS[op] || String(op || "unknown");
}

// ── levelColor ───────────────────────────────────────────────────────────
// Severity → the app's CSS palette vars. Red ONLY for the error level;
// warn → orange; info → muted (design §5).

const LEVEL_COLORS = {
  error: {
    bg: "var(--s2j-red-bg)",
    border: "var(--s2j-red)",
    text: "var(--s2j-red)",
  },
  warn: {
    bg: "var(--s2j-orange-bg)",
    border: "var(--s2j-orange)",
    text: "var(--s2j-orange)",
  },
  info: {
    bg: "var(--s2j-bg-section)",
    border: "var(--s2j-border)",
    text: "var(--s2j-text-muted)",
  },
};

/** {bg, border, text} for a record level. Unknown levels render as error (the backend defaults levels the same way). */
export function levelColor(level) {
  return LEVEL_COLORS[level] || LEVEL_COLORS.error;
}

// ── relTime ──────────────────────────────────────────────────────────────

/** Compact relative time: 'just now' / '5m ago' / '2h ago' / '3d ago'. '' for a missing/invalid ts. */
export function relTime(ts) {
  if (!Number.isFinite(ts)) return "";
  const deltaSec = Math.floor((Date.now() - ts) / 1000);
  if (deltaSec < 60) return "just now";
  const m = Math.floor(deltaSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
