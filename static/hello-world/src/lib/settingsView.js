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
export function computeConfigVerdict({ keyConfigured, projectKey, keyStorageFault, health } = {}) {
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
  const configComplete = key === "configured" && project === "set";

  // Ordered severity resolution (storage-fault + no-key are the hard blockers; a missing project is a
  // warning; a failed verify is an error; a check-that-could-not-run is a warning; a green verify is ok;
  // complete-but-unverified is neutral).
  let level;
  if (key === "storage_fault") level = "error";
  else if (key === "not_set") level = "error";
  else if (project === "not_set") level = "warning";
  else if (verified === "failed") level = "error";
  else if (verified === "unavailable") level = "warning";
  else if (verified === "verified") level = "ok";
  else level = "neutral";

  const requiredDone = (key === "configured" ? 1 : 0) + (project === "set" ? 1 : 0);
  return { level, key, project, verified, configComplete, requiredDone, requiredTotal: 2 };
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
  return lg.state !== "blocked" && v.configComplete === true && v.verified === "verified";
}

// ── 3. Answer tiles ─────────────────────────────────────────────────────────
// Five tiles; status ∈ ok|warn|error|neutral → the UI paints the icon/tint (neutral = a hollow grey circle,
// so OPTIONALS never read as an amber gap). value/sub are display strings.
export function computeTiles({ verdict, apiKeyLastSetAt, health, profilesCount = 0, hasCustomFields = false, licenseBlocked = false } = {}) {
  const v = verdict || {};
  const probes = health && Array.isArray(health.probes) ? health.probes : [];
  const probeCount = probes.length;
  const failCount = probes.filter((p) => p && p.ok === false).length;

  const apiKey =
    v.key === "storage_fault"
      ? { status: "error", value: "Storage fault", sub: "can't read secret" }
      : v.key === "configured"
        ? { status: "ok", value: "Configured", sub: apiKeyLastSetAt ? `last set ${formatDate(apiKeyLastSetAt)}` : "configured" }
        : { status: "error", value: "Not set", sub: "paste to connect" };

  const project =
    v.project === "set"
      ? { status: "ok", value: v.projectKey || "Set", sub: "push destination" }
      : { status: "warn", value: "Not set", sub: "required" };

  const context = {
    status: "neutral",
    value: profilesCount > 0 ? `${profilesCount} ${profilesCount === 1 ? "profile" : "profiles"}` : "None",
    sub: "optional",
  };

  const customFields = {
    status: "neutral",
    value: hasCustomFields ? "Configured" : "None",
    sub: "optional",
  };

  const verified =
    licenseBlocked
      ? { status: "neutral", value: "Not verified", sub: "plan inactive" } // §5.9 — verification is moot while blocked
      : v.verified === "verified"
        ? { status: "ok", value: "Verified", sub: `${probeCount || 4} checks · just now` }
        : v.verified === "failed"
          ? { status: "error", value: `${failCount || 1} failed`, sub: "see detail" }
          : v.verified === "unavailable"
            ? { status: "warn", value: "Could not run", sub: "re-verify" }
            : { status: "neutral", value: "Not verified", sub: "run the check" };

  return [
    { id: "apiKey", label: "API KEY", tier: "T0", ...apiKey },
    { id: "project", label: "PROJECT", tier: "T0", ...project },
    { id: "context", label: "CONTEXT", tier: "T0", ...context },
    { id: "customFields", label: "CUSTOM FIELDS", tier: "T0", ...customFields },
    { id: "verified", label: "VERIFIED", tier: "T0-T1", ...verified },
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
  managed_unavailable: { severity: "warning", fixField: "apiKey", hint: "No Anthropic key was available. Both editions use your own key — add it in step 1." },
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
