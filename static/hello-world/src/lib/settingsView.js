// ── settingsView.js — the Admin Settings verdict state machine (Claude-Design arc, screen 5) ──
//
// The SINGLE SOURCE OF TRUTH for the Settings tab's go/no-go read. Two ORTHOGONAL signals
// (proven across all 13 mockup states — never interleave them):
//   1. LICENSE GATE  (computeLicenseGate)  — "can this instance generate at all" (from getUsage.allowed).
//   2. CONFIG VERDICT (computeConfigVerdict) — "is the config correct & verified" (key+project+runHealthCheck).
//
// The hero banner, the answer tiles, the verification-detail panel, AND the "Verify & hand off" hand-off copy
// ALL derive from these functions — no element re-derives the verdict inline (the Review/Insights lesson: a
// tile and a strip that each compute the same fact drift into a contradiction). Pure, no React, no resolvers —
// testable offline (prototype/test_settings_view.mjs).

// Honest per-breakdown cost anchor (bill-shock fear). Sourced from usage.js comments (~$0.118 avg / ~$0.24
// max per breakdown; corroborated ~$0.14/22-feat in anthropic_client.js). A static honest FE constant — NOT
// the customer's actual recent spend (that is post-run only, T3).
export const COST_ANCHOR = { typical: "~$0.12", max: "~$0.24" };

// ── 1. License gate ─────────────────────────────────────────────────────────
// getUsage returns { allowed, ... } or { error:'usage_unavailable' }. allowed is FALSE only for the
// Unlicensed backstop (limit 0); a 30-day Atlassian trial reads as an ACTIVE paid tier (allowed true).
export function computeLicenseGate(account) {
  if (!account || account.error) return { state: "unknown" }; // getUsage failed — do NOT assert licensed
  if (account.allowed === false) return { state: "blocked" }; // Unlicensed — generation blocked for everyone
  return { state: "licensed" };
}

// ── 2. Config verdict ───────────────────────────────────────────────────────
// keyConfigured/projectKey from getSettings; keyStorageFault = FE flag set when a key-read storage fault was
// detected (distinct from "no key"); health = last runHealthCheck { ok, probes } | null (not run).
export function computeConfigVerdict({ keyConfigured, projectKey, keyStorageFault, health, trialActive } = {}) {
  const key = keyStorageFault ? "storage_fault" : keyConfigured ? "configured" : "not_set";
  const project = projectKey && String(projectKey).trim() ? "set" : "not_set";
  // 'unavailable' = the check COULD NOT complete (Forge-bridge/resolver error → health.failed or no probes) —
  // this is NOT a config defect, so it must never read as a counted "failed" verify (finding A3).
  const verified = !health
    ? "not_run"
    : (health.failed || !Array.isArray(health.probes) || health.probes.length === 0)
      ? "unavailable"
      : health.ok
        ? "verified"
        : "failed";
  // ⭐ 2026-07-11 trial-credit onboarding: while a trial user still has free MANAGED credit (trialActive),
  // the Anthropic KEY is OPTIONAL — the app runs on OUR key, so the ONLY required config is the Project Key.
  // A missing/absent key must NOT read as an error, must NOT block "ready", and must NOT scare the user with
  // BYOK setup. Once the $5 is spent (trialActive false), the key becomes required as before.
  const keyRequired = !trialActive;
  const configComplete = project === "set" && (keyRequired ? key === "configured" : true);

  // Ordered severity resolution. The key blockers (storage-fault + no-key) only apply when a key is REQUIRED
  // (a trial user on our credit has no key and that is fine); a missing project is a warning; a failed verify
  // is an error; a check-that-could-not-run is a warning; a green verify is ok; complete-but-unverified neutral.
  let level;
  if (keyRequired && key === "storage_fault") level = "error";
  else if (keyRequired && key === "not_set") level = "error";
  else if (project === "not_set") level = "warning";
  else if (verified === "failed") level = "error";
  else if (verified === "unavailable") level = "warning";
  else if (verified === "verified") level = "ok";
  else level = "neutral";

  const requiredDone = (project === "set" ? 1 : 0) + (keyRequired && key === "configured" ? 1 : 0);
  return { level, key, project, verified, configComplete, requiredDone, requiredTotal: keyRequired ? 2 : 1, keyRequired, trialActive: !!trialActive };
}

// ── 2b. Fully-ready / "done" — a FUNCTION of BOTH signals ─────────────────────
// "Done" (the stepper hand-off + the 'All set' header) requires the instance to be NOT blocked (licensed or
// license-unknown) AND config-complete AND verified. The two signals stay orthogonal in COMPUTATION, but the
// display of readiness is genuinely a function of both — so a blocked instance never reads "You're done"
// (finding A1). Keyed on `!== 'blocked'` (not `=== 'licensed'`) so the getUsage-unknown state still allows a
// ready read (we do not assert blocked when we could not read the plan — §5.10).
export function computeReady({ licenseGate, verdict } = {}) {
  const lg = licenseGate || {};
  const v = verdict || {};
  if (lg.state === "blocked" || v.configComplete !== true) return false;
  // A trial user on our free managed credit has NO key to verify — config-complete (= project set) IS ready
  // WITHOUT a green check... BUT a verify that actually RAN and FAILED (or could-not-run) must still block
  // "ready" (fresh-army fix: a trial user who runs Verify against a nonexistent project must NOT read "All set"
  // while the hero/tile show the red failure). not_run/verified both pass; only failed/unavailable block.
  if (v.keyRequired === false) return v.verified !== "failed" && v.verified !== "unavailable";
  // A non-trial (BYOK) user still needs a green health check.
  return v.verified === "verified";
}

// ── 2c. Setup-guidance line — the calm sentence under the "Set up in order" heading ──────────────
// Honest across EVERY not-ready sub-state. ⚠ It MUST branch on what is actually outstanding, not just
// `ready`/`trialActive`: once the project IS set, it must never say "just set your Jira project … you're
// ready to push" — that both tells the user to redo a done step AND falsely claims readiness while a verify
// failure shows red in the hero (the honesty invariant a 2-lens audit caught a regression against, 2026-07-12).
// Pure + exported so the invariant is guarded offline (a future edit can't silently re-collapse the branches).
export function computeSetupGuidance({ ready, trialActive, verdict } = {}) {
  if (ready) return null;
  const v = verdict || {};
  if (!v.configComplete) {
    return trialActive
      ? "You're on your free trial — just set your Jira project below and you're ready to push."
      : "Two required steps (key + project), then two optional.";
  }
  // configComplete but not ready ⇒ the health check failed / couldn't run (or, non-trial, isn't run yet).
  if (v.verified === "failed") return "Almost there — the verification found a problem. Check the detail above and re-verify.";
  if (v.verified === "unavailable") return "Almost there — the check couldn't run. Re-verify in a moment.";
  return "Both required steps are done — run the check to finish.";
}

// ── 3. Answer tiles ─────────────────────────────────────────────────────────
// Five tiles; status ∈ ok|warn|error|neutral → the UI paints the icon/tint (neutral = a hollow grey circle,
// so OPTIONALS never read as an amber gap). `req ∈ 'required'|'optional'|null` → the UI renders a moodboard
// status chip (Required amber / Optional grey), which replaced the bare faint "required"/"optional" sub-words
// that read poorly. `sub` is now a short DESCRIPTIVE hint only (never a bare requirement word). ⭐ 2026-07-12:
// the internal data-source tier tags (T0 / T0-T1) were REMOVED — they leaked meaningless engineering jargon
// onto a PO/BA screen (the mockup carried them; they were never meant to ship).
export function computeTiles({ verdict, apiKeyLastSetAt, health, profilesCount = 0, hasCustomFields = false, licenseBlocked = false, trialActive = false } = {}) {
  const v = verdict || {};
  const probes = health && Array.isArray(health.probes) ? health.probes : [];
  const probeCount = probes.length;
  const failCount = probes.filter((p) => p && p.ok === false).length;

  const apiKey =
    v.key === "storage_fault"
      ? { status: "error", value: "Storage fault", req: null, sub: "can't read secret" }
      : v.key === "configured"
        ? { status: "ok", value: "Configured", req: null, sub: apiKeyLastSetAt ? `last set ${formatDate(apiKeyLastSetAt)}` : "connected" }
        : trialActive
          // While on the $5 free trial the key is OPTIONAL — a NEUTRAL tile (never a red "Not set" gap).
          ? { status: "neutral", value: "On free trial", req: "optional", sub: "key not needed yet" }
          : { status: "error", value: "Not set", req: "required", sub: "paste to connect" };

  const project =
    v.project === "set"
      ? { status: "ok", value: v.projectKey || "Set", req: null, sub: "push destination" }
      : { status: "warn", value: "Not set", req: "required", sub: "your push target" };

  const context = {
    status: "neutral",
    value: profilesCount > 0 ? `${profilesCount} ${profilesCount === 1 ? "profile" : "profiles"}` : "None",
    req: "optional",
    sub: null,
  };

  const customFields = {
    status: "neutral",
    value: hasCustomFields ? "Configured" : "None",
    req: "optional",
    sub: null,
  };

  const verified =
    licenseBlocked
      ? { status: "neutral", value: "Not verified", req: null, sub: "plan inactive" } // §5.9 — verification is moot while blocked
      : v.verified === "verified"
        ? { status: "ok", value: "Verified", req: null, sub: `${probeCount || 4} checks · just now` }
        : v.verified === "failed"
          ? { status: "error", value: `${failCount || 1} failed`, req: null, sub: "see detail" }
          : v.verified === "unavailable"
            ? { status: "warn", value: "Could not run", req: null, sub: "re-verify" }
            : { status: "neutral", value: "Not verified", req: null, sub: "run the check" };

  return [
    { id: "apiKey", label: "API KEY", ...apiKey },
    { id: "project", label: "PROJECT", ...project },
    { id: "context", label: "CONTEXT", ...context },
    { id: "customFields", label: "CUSTOM FIELDS", ...customFields },
    { id: "verified", label: "VERIFIED", ...verified },
  ];
}

// ── 4. Probe classification (severity + field deep-link) ─────────────────────
// Field-fixable failures (key/project) → severity 'error' + a fixField the row deep-links to. NOT-field-fixable
// (billing / permission / network / storage) → 'warning' + an honest hint + fixField null (never a wrong jump).
const PROBE_CLASS = {
  not_configured: { severity: "error", fixField: "apiKey", hint: "The Anthropic API key is not set. Paste it in step 1 and Test." },
  key_storage_failed: { severity: "error", fixField: "apiKey", hint: "Forge could not read the stored key. Re-enter it and Test again." },
  auth_rejected: { severity: "error", fixField: "apiKey", hint: "Anthropic rejected the key (401). Verify it at console.anthropic.com, then update it." },
  no_project_key: { severity: "error", fixField: "projectKey", hint: "No default Jira project key. Set one in step 2." },
  project_not_found: { severity: "error", fixField: "projectKey", hint: "No Jira project with that key exists. Check the Default Jira Project Key." },
  insufficient_credits: { severity: "warning", fixField: null, hint: "Your Anthropic account is out of credits (402). Top up at console.anthropic.com — the key itself is fine." },
  rate_limited: { severity: "warning", fixField: null, hint: "Anthropic rate limit hit (429). Wait a moment and Re-verify." },
  permission_denied: { severity: "warning", fixField: null, hint: "Your Jira/Confluence account lacks access. The key is fine — this probe checks YOUR session, so fixing a field here would be wrong." },
  egress_blocked: { severity: "warning", fixField: null, hint: "Forge blocked an outbound request (app config). Contact support@spec2jira.com." },
  managed_unavailable: { severity: "warning", fixField: "apiKey", hint: "No Anthropic key was available for this run. Add your own Anthropic key in step 1 (if you're on the free trial, our key was briefly unavailable — try again, or add your own to continue)." },
  confluence_http: { severity: "warning", fixField: null, hint: "A live Confluence call failed. Usually transient — Re-verify in a moment." },
  jira_http: { severity: "warning", fixField: null, hint: "A live Jira call failed. Usually transient — Re-verify in a moment." },
  network_failure: { severity: "warning", fixField: null, hint: "A network call never got a response. Check connectivity and Re-verify." },
  kvs_failed: { severity: "warning", fixField: null, hint: "A storage round-trip failed. Usually transient — Re-verify." },
};
const PROBE_DEFAULT = { severity: "warning", fixField: null, hint: "An unexpected check error. Re-verify; if it persists, copy the report in Diagnostics." };

// Fold anthropic_503 / jira_404 / confluence_500 families to their *_http bucket (mirrors
// diagnosticsView.normalizeFamily) before lookup.
function normalizeProbeCode(code) {
  const c = String(code || "");
  if (/^anthropic_\d{3}$/.test(c)) return "anthropic_http";
  if (/^jira_\d{3}$/.test(c)) return "jira_http";
  if (/^confluence_\d{3}$/.test(c)) return "confluence_http";
  return c;
}

export function classifyProbe(probe) {
  const raw = probe && probe.code ? probe.code : "";
  const code = normalizeProbeCode(raw);
  // anthropic_http is not distinctly listed — treat like a transient http warning.
  if (code === "anthropic_http") return { severity: "warning", fixField: null, hint: "An Anthropic API call failed. Usually transient — Re-verify in a moment." };
  return PROBE_CLASS[code] || PROBE_DEFAULT;
}

// ── 5. Probe name → human label ──────────────────────────────────────────────
const PROBE_LABEL = {
  anthropic_key: "Anthropic API key",
  confluence_read: "Confluence access",
  jira_project: "Jira project",
  kvs_rw: "App storage",
};
export function probeLabel(name) {
  return PROBE_LABEL[name] || String(name || "check");
}

// ── date helper (local, dependency-free) ──────────────────────────────────────
function formatDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString();
  } catch (_) {
    return "";
  }
}
