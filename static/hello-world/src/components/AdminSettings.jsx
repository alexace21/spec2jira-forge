import { useState, useEffect, useCallback, useRef } from "react";
import { invoke, router } from "@forge/bridge";
import { classText, opLabel, relTime, composeIncident, classTone } from "../lib/diagnosticsView";
import {
  computeLicenseGate,
  computeConfigVerdict,
  computeReady,
  computeTiles,
  classifyProbe,
  probeLabel,
  COST_ANCHOR,
} from "../lib/settingsView";
import {
  IconX,
  IconMaximize,
  IconRefresh,
  IconClock,
  IconExternalLink,
  IconShield,
  IconFolder,
  IconCopy,
  IconUsers,
  IconChevronDown,
  IconChevronUp,
} from "./Icon";
import { SignalIcon, SignalCallout } from "./Signal";
import { MoodCard, TYPE, MOOD, glassSurface } from "./moodboard";

// Where the "Not licensed" CTA sends the admin (mirrors App.js UPGRADE_URL — the
// Atlassian admin hub until a per-listing Marketplace URL is wired at launch).
const UPGRADE_URL = "https://admin.atlassian.com/";

const tileKind = (status) =>
  status === "ok" ? "success" : status === "warn" ? "warning" : status === "error" ? "error" : "info";

/**
 * AdminSettings — v3.0.0 BYOK configuration page.
 * Accessible от Confluence Admin → Apps → Spec2Tickets Settings.
 *
 * v3.0.0 changes (post-pivot 2026-05-28):
 *   - REMOVED: Backend URL field (no more self-hosted backend)
 *   - REMOVED: Backend API Key field (no more shared secret к backend)
 *   - ADDED:   Anthropic API Key field (BYOK — customer provides)
 *   - PRESERVED: Default JIRA Project Key field
 *   - UPDATED: testConnection now calls Anthropic /v1/messages directly
 *
 * Settings API contract (resolvers in src/index.js):
 *   getSettings() → { defaultProjectKey, apiKeyConfigured, apiKeyLastSetAt, requiredCustomFieldsJson }
 *   saveSettings({ anthropicApiKey?, defaultProjectKey, requiredCustomFieldsJson? }) → { success } | { error }
 *   testConnection({ anthropicApiKey? }) → { status: 'ok', message } | { status: 'error', code, detail }
 *   clearAnthropicApiKey() → { success } | { error }
 *   resetSettings() → { success }
 */

// Mirrors of the server-authoritative caps in src/index.js — kept here only for the
// live character counter + fail-fast UX on the Project Context profiles editor.
// ⚠ Keep in sync with PROJECT_CONTEXT_MAX_CHARS in src/index.js (raised 12000→20000 2026-06-06;
// the frontend mirror was missed → the counter + "over the limit" warning + the Save-blocking
// over-check still showed 12000, more restrictive than the backend).
const PROJECT_CONTEXT_MAX_CHARS = 20000;
const MAX_CONTEXT_PROFILES = 20;
const CONTEXT_PROFILE_NAME_MAX = 60;

const ERROR_MESSAGES = {
  NOT_CONFIGURED:
    "No API key configured. Paste your Anthropic API key above + click Save Settings first.",
  BACKEND_UNREACHABLE:
    "Anthropic API is unreachable. Check your network and Anthropic's status, then retry.",
  BACKEND_AUTH_FAILED:
    "Anthropic rejected the API key. Verify validity at console.anthropic.com → Settings → API Keys.",
  INSUFFICIENT_CREDITS:
    "Anthropic account has insufficient credits. Add credits at console.anthropic.com → Billing.",
  RATE_LIMITED:
    "Anthropic rate limit reached. Wait a moment and retry.",
  // Managed (Advanced) server key not configured. Distill returns code
  // NOT_CONFIGURED with error 'managed_unavailable' — for a Managed user the
  // generic NOT_CONFIGURED text ("paste your key") is wrong, so handlers prefer
  // the backend detail and fall back to this Managed-correct message.
  MANAGED_UNAVAILABLE:
    "The Managed service is temporarily unavailable (server key not configured). Contact support, or switch to BYOK and save your own Anthropic API key.",
};

function getErrorText(result) {
  const mapped = ERROR_MESSAGES[result?.code];
  if (mapped) return mapped;
  return result?.detail || "Connection test failed";
}

// Price lookups off the getUsage `pricing[]` array (single source of USD prices — the
// UI never hardcodes prices). accountPriceFor → a named tier's price; accountPrice →
// the customer's OWN active tier price (null when absent).
function accountPriceFor(account, key) {
  return (account?.pricing || []).find((t) => t.key === key)?.price || null;
}
function accountPrice(account) {
  return account?.tier ? accountPriceFor(account, account.tier) : null;
}

// Props (diagnostics Phase 5, design §5):
//   initialTab    — 'settings' | 'diagnostics' (default 'settings'). App.js's
//                   handleOpenDiagnostics opens straight onto the Diagnostics tab.
//   diagRefFilter — string|null; pre-fills the Diagnostics ref filter (the
//                   [Open Diagnostics] click-nav from a failure carries its ref).
export default function AdminSettings({ initialTab = "settings", diagRefFilter = null }) {
  // Two-tab header: 'settings' | 'diagnostics'. The Settings tab renders ALL the
  // pre-existing settings content unchanged; Diagnostics is a sibling surface.
  const [activeTab, setActiveTab] = useState(
    initialTab === "diagnostics" ? "diagnostics" : "settings",
  );
  // [P5 audit LOW-3] the Diagnostics ref filter lives in THIS parent (it survives
  // Settings↔Diagnostics tab toggles; the tab itself remounts per toggle) and
  // re-seeds from the click-nav prop on each fresh admin-screen entry.
  const [diagFilter, setDiagFilter] = useState(diagRefFilter || "");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [defaultProjectKey, setDefaultProjectKey] = useState("");
  // The PERSISTED project key (last saved) — distinct from the live `defaultProjectKey`
  // input. The verdict/hero/tiles/auto-verify key on THIS (the check probes the saved
  // project); the input + its inline hint stay on the live value (edit-time). [A2/A4/A5]
  const [savedProjectKey, setSavedProjectKey] = useState("");
  const [contextProfiles, setContextProfiles] = useState([]);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyLastSetAt, setApiKeyLastSetAt] = useState(null);
  const [requiredCustomFieldsJson, setRequiredCustomFieldsJson] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [account, setAccount] = useState(null); // Plan / usage / member-since (getUsage) — may be { error }
  const [usageLoaded, setUsageLoaded] = useState(false); // distinguishes "still loading" from "load failed"

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'success'|'error', text } — Save/Clear/Reset outcomes
  // Per-field save-validation errors { apiKey?, project?, customFields? } — rendered INLINE
  // at each field (§4.6/§4.8), NOT in the shared bottom message region. [C1]
  const [fieldErrors, setFieldErrors] = useState({});

  // ── Verify lifecycle + the two-signal wiring (impl-spec §3) ────────────────
  const [health, setHealth] = useState(null); // last runHealthCheck { ok, probes, model } | null (not run)
  const [verifying, setVerifying] = useState(false);
  const [verifiedOnce, setVerifiedOnce] = useState(false);
  const [autoVerifyNote, setAutoVerifyNote] = useState(false); // §5.3 note shows right after an auto-run
  const [model, setModel] = useState(null); // real model name from Test Connection / runHealthCheck
  const [keyStorageFault, setKeyStorageFault] = useState(false); // key-read storage fault (distinct from "no key")
  const [testResult, setTestResult] = useState(null); // inline Test Connection result { status, model, text }

  // Deep-link scroll targets for the verification-detail "Fix in {field}" buttons (refs, not ids).
  const apiKeyRef = useRef(null);
  const projectKeyRef = useRef(null);
  // Led-setup step expansion: a done (REQUIRED) step collapses to a summary; "Edit" / "Fix" re-expands it.
  const [editingKey, setEditingKey] = useState(false);
  const [editingProject, setEditingProject] = useState(false);
  // Armed two-step (Clear key + Reset) — confirm() can be inert in the Forge iframe.
  const [clearKeyArmed, setClearKeyArmed] = useState(false);
  const clearKeyTimer = useRef(null);
  const [resetArmed, setResetArmed] = useState(false);
  const resetTimer = useRef(null);
  // Auto-verify transition guard: only fire when config first becomes complete DURING the session.
  const loadedBaselineRef = useRef(false);
  const wasCompleteRef = useRef(false);

  const loadUsage = useCallback(async () => {
    try {
      const u = await invoke("getUsage");
      // Store the response WHETHER OR NOT it is an error — computeLicenseGate reads
      // account.error to resolve the honest 'unknown' state (never claim licensed).
      setAccount(u || { error: "usage_unavailable" });
    } catch (_) {
      setAccount({ error: "usage_unavailable" });
    } finally {
      setUsageLoaded(true);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const settings = await invoke("getSettings");
        if (settings?.defaultProjectKey)
          setDefaultProjectKey(settings.defaultProjectKey);
        setSavedProjectKey(settings?.defaultProjectKey || ""); // [A2] the persisted destination
        if (Array.isArray(settings?.contextProfiles))
          setContextProfiles(settings.contextProfiles);
        setApiKeyConfigured(!!settings?.apiKeyConfigured);
        setApiKeyLastSetAt(settings?.apiKeyLastSetAt || null);
        if (settings?.requiredCustomFieldsJson) {
          setRequiredCustomFieldsJson(settings.requiredCustomFieldsJson);
          setShowAdvanced(true); // auto-expand when a value already exists
        }
      } catch (e) {
        setMessage({ type: "error", text: "Failed to load settings" });
      } finally {
        setLoading(false);
      }
      // Account/Plan status (best-effort — the plan card degrades on failure).
      await loadUsage();
    })();
  }, [loadUsage]);

  // runVerify — the manual/auto health probe. Stores health + model, sets/clears the
  // storage-fault flag from the anthropic_key probe (impl-spec §3).
  const runVerify = useCallback(async (isAuto = false) => {
    setVerifying(true);
    if (!isAuto) setAutoVerifyNote(false);
    try {
      const resp = await invoke("runHealthCheck", {});
      if (resp && Array.isArray(resp.probes)) {
        setHealth(resp);
        if (resp.model) setModel(resp.model);
        const keyProbe = resp.probes.find((p) => p && p.name === "anthropic_key");
        if (keyProbe && keyProbe.code === "key_storage_failed") setKeyStorageFault(true);
        // Clear the storage-fault flag on ANY key-probe result that isn't a storage fault
        // (not only ok) — else a later verify failing for a NON-storage reason keeps the
        // stale "Can't read your API key" hero. [A6]
        else if (keyProbe && keyProbe.code !== "key_storage_failed") setKeyStorageFault(false);
      } else {
        setHealth({ ok: false, probes: [], failed: true });
      }
    } catch (_) {
      setHealth({ ok: false, probes: [], failed: true });
    } finally {
      setVerifiedOnce(true);
      setVerifying(false);
    }
  }, []);

  // Auto-verify ONCE the moment key + project first become complete DURING this session
  // (never on a fresh open of an already-complete config — the baseline is captured post-load).
  useEffect(() => {
    if (loading) return;
    // Gate on the SAVED project (what runHealthCheck actually probes), not the live
    // input — else typing an unsaved key auto-verifies against a project the check
    // never ran. [A5] (equivalent to !!savedProjectClean.)
    const complete =
      apiKeyConfigured && !keyStorageFault && !!(savedProjectKey || "").trim();
    if (!loadedBaselineRef.current) {
      loadedBaselineRef.current = true;
      wasCompleteRef.current = complete;
      return;
    }
    if (complete && !wasCompleteRef.current && !verifiedOnce && !verifying) {
      setAutoVerifyNote(true);
      runVerify(true);
    }
    wasCompleteRef.current = complete;
  }, [loading, apiKeyConfigured, keyStorageFault, savedProjectKey, verifiedOnce, verifying, runVerify]);

  // Clear the armed two-step timers (Clear key + Reset) on unmount — a stray timer
  // firing after unmount would setState on a gone component. [E1]
  useEffect(
    () => () => {
      clearTimeout(clearKeyTimer.current);
      clearTimeout(resetTimer.current);
    },
    [],
  );

  // Deep-link: expand the target step, then scroll + focus its field (ref, not id).
  const scrollToRef = (ref) => {
    const el = ref.current;
    if (!el) return;
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (_) {
      /* jsdom / older iframe */
    }
    try {
      el.focus({ preventScroll: true });
    } catch (_) {
      try {
        el.focus();
      } catch (__) {
        /* non-focusable */
      }
    }
  };
  const onFixField = (field) => {
    if (field === "apiKey") {
      setEditingKey(true);
      setTimeout(() => scrollToRef(apiKeyRef), 60);
    } else if (field === "projectKey") {
      setEditingProject(true);
      setTimeout(() => scrollToRef(projectKeyRef), 60);
    }
  };

  // Diagnostics -> Settings deep-link (impl-spec §8). A tab-switch ONLY — never a re-implementation of the
  // Settings verdict. Passed down to DiagnosticsTab (probe "Fix in Settings ->" + the Jira-rejected-field
  // "Add this field in Settings ->" chip). After switching, focus the relevant field on the Settings tab.
  const onFixInSettings = (field) => {
    setActiveTab("settings");
    if (field === "apiKey" || field === "projectKey") {
      setTimeout(() => onFixField(field), 80);
    } else if (field === "customFields") {
      setShowAdvanced(true); // reveal Advanced -> Required custom fields (the deep-link target)
    }
  };

  function handleApiKeyChange(e) {
    setAnthropicApiKey(e.target.value);
    if (message) setMessage(null); // [R1] a field edit supersedes any prior Save banner (success or error)
    if (testResult) setTestResult(null);
    setFieldErrors((fe) => (fe.apiKey ? { ...fe, apiKey: undefined } : fe)); // [C1]
  }

  async function handleSave() {
    // Field-level validation renders INLINE at each field (§4.6/§4.8) via fieldErrors —
    // the shared bottom `message` region is reserved for Save/Clear/Reset outcomes. [C1]
    setFieldErrors({});
    setMessage(null); // [R1] clear any prior Save banner so a blocked save never shows a stale green "saved" under a fresh inline error
    // Validate Anthropic key format ako entered
    const trimmedKey = (anthropicApiKey || "").trim();
    if (trimmedKey && !trimmedKey.startsWith("sk-ant-")) {
      setFieldErrors({
        apiKey: "Anthropic API key should start with 'sk-ant-'. Verify the value from console.anthropic.com.",
      });
      return;
    }
    if (trimmedKey && trimmedKey.length < 20) {
      setFieldErrors({ apiKey: "Anthropic API key appears too short — verify the value." });
      return;
    }

    const cleanProjectKey = (defaultProjectKey || "").trim().toUpperCase();
    if (!cleanProjectKey) {
      setFieldErrors({ project: "Jira Project Key is required" });
      return;
    }
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(cleanProjectKey)) {
      setFieldErrors({
        project: "Jira Project Key must be 2–10 characters, start with a letter, only uppercase letters + digits (e.g., PROJ, SCRUM2).",
      });
      return;
    }

    // v6 value-split: BOTH editions are BYOK → a key is always required. The old Managed
    // (edition==='advanced') "no key needed" exemption is GONE — under v6 'advanced' is a
    // BYOK edition (byokAdvanced), so exempting it would let a paying Advanced customer save
    // with no key and then dead-end at generate-time.
    if (!trimmedKey && !apiKeyConfigured) {
      setFieldErrors({
        apiKey: "Please paste your Anthropic API key. Get one from console.anthropic.com → API Keys.",
      });
      return;
    }

    // Validate optional custom-fields JSON client-side (fail fast).
    const cfRaw = (requiredCustomFieldsJson || "").trim();
    if (cfRaw) {
      let parsed;
      try {
        parsed = JSON.parse(cfRaw);
      } catch (e) {
        setFieldErrors({
          customFields: 'Required custom fields must be valid JSON, e.g. {"customfield_10042": {"value": "Team A"}}.',
        });
        return;
      }
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
        setFieldErrors({
          customFields: "Required custom fields must be a JSON object mapping field IDs to values.",
        });
        return;
      }
    }

    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        defaultProjectKey: cleanProjectKey,
        contextProfiles,
        requiredCustomFieldsJson: cfRaw,
      };
      if (trimmedKey) payload.anthropicApiKey = trimmedKey;
      const result = await invoke("saveSettings", payload);
      if (result?.error) {
        // §5.13 partial commit: the backend now returns apiKeyUpdated on the error
        // return when the KEY committed but the settings record (incl. project) did
        // NOT. Reflect that the key IS now stored; do NOT touch savedProjectKey (the
        // project did not persist). The honest backend message explains the rest. [C2]
        if (result.apiKeyUpdated) {
          setApiKeyConfigured(true);
          setApiKeyLastSetAt(new Date().toISOString());
          setAnthropicApiKey("");
          setKeyStorageFault(false);
        }
        setMessage({ type: "error", text: result.error });
      } else {
        setMessage({ type: "success", text: "Settings saved" });
        setSavedProjectKey(cleanProjectKey); // [A2] the persisted destination the verdict/hero/tiles key on
        if (result.apiKeyUpdated) {
          setApiKeyConfigured(true);
          setApiKeyLastSetAt(new Date().toISOString());
          setAnthropicApiKey(""); // clear input field so it shows configured state
          setKeyStorageFault(false); // a fresh save supersedes a prior key-read fault
        }
        // The config just changed — a prior verify is now stale. Drop it so the hero
        // honestly reads "run the check" (and the auto-verify can re-fire on a first-time
        // completion) rather than showing a stale green.
        setHealth(null);
        setVerifiedOnce(false);
        setEditingKey(false);
        setEditingProject(false);
      }
    } catch (e) {
      setMessage({ type: "error", text: "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  }

  // Clear stored key — ARMED two-step (confirm() can be inert in the Forge iframe;
  // mirrors the Diagnostics-clear pattern). First click arms + auto-disarms in 4s.
  async function handleClearKey() {
    if (!clearKeyArmed) {
      setClearKeyArmed(true);
      clearTimeout(clearKeyTimer.current);
      clearKeyTimer.current = setTimeout(() => setClearKeyArmed(false), 4000);
      return;
    }
    clearTimeout(clearKeyTimer.current);
    setClearKeyArmed(false);
    setClearing(true);
    setMessage(null);
    setFieldErrors({}); // [R2] a Clear supersedes any stale inline field error
    try {
      const result = await invoke("clearAnthropicApiKey");
      if (result?.success) {
        setApiKeyConfigured(false);
        setApiKeyLastSetAt(null);
        setAnthropicApiKey("");
        setKeyStorageFault(false);
        setTestResult(null);
        setModel(null);
        setHealth(null); // config changed -> a prior verify is stale
        setVerifiedOnce(false);
        setMessage({ type: "success", text: "API key cleared" });
      } else {
        setMessage({
          type: "error",
          text: result?.error || "Failed to clear API key",
        });
      }
    } catch (e) {
      setMessage({ type: "error", text: "Failed to clear API key" });
    } finally {
      setClearing(false);
    }
  }

  // Reset ALL settings — ARMED two-step (not confirm()).
  async function handleReset() {
    if (!resetArmed) {
      setResetArmed(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setResetArmed(false), 4000);
      return;
    }
    clearTimeout(resetTimer.current);
    setResetArmed(false);
    try {
      await invoke("resetSettings");
      setFieldErrors({}); // [R2] a Reset supersedes any stale inline field error
      setAnthropicApiKey("");
      setDefaultProjectKey("");
      setSavedProjectKey(""); // keep savedProjectKey == persisted state (verdict/tiles/projectStepDone key on it) [A2]
      setContextProfiles([]);
      setApiKeyConfigured(false);
      setApiKeyLastSetAt(null);
      setRequiredCustomFieldsJson("");
      setShowAdvanced(false);
      setKeyStorageFault(false);
      setTestResult(null);
      setModel(null);
      setHealth(null);
      setVerifiedOnce(false);
      setEditingKey(false);
      setEditingProject(false);
      setMessage({ type: "success", text: "Settings reset" });
    } catch (e) {
      setMessage({ type: "error", text: "Failed to reset settings" });
    }
  }

  async function handleTest() {
    const trimmedKey = (anthropicApiKey || "").trim();
    if (!trimmedKey && !apiKeyConfigured) {
      setTestResult({
        status: "error",
        text: "Paste your Anthropic API key first, or Save one you've previously stored.",
      });
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      // If a new key is typed in the input, test that. Otherwise test stored.
      const payload = trimmedKey ? { anthropicApiKey: trimmedKey } : {};
      const result = await invoke("testConnection", payload);
      if (result?.status === "ok") {
        if (result.model) setModel(result.model);
        setTestResult({
          status: "ok",
          model: result.model || null,
          text: result.message || "Connected to Anthropic API",
        });
      } else {
        setTestResult({ status: "error", text: getErrorText(result) });
      }
    } catch (e) {
      setTestResult({
        status: "error",
        text: e?.message || "Connection test failed",
      });
    } finally {
      setTesting(false);
    }
  }

  // ── Two-tab header (diagnostics Phase 5, design §5) ────────────────────────
  // Settings | Diagnostics. Rendered ABOVE both branches so the Diagnostics tab is
  // reachable without waiting on the settings load; the Settings branch keeps its
  // original loading spinner + content unchanged.
  const tabBar = (
    <div className="px-8 pt-6" style={{ maxWidth: "640px" }}>
      <div
        className="flex items-center gap-4"
        style={{ borderBottom: "1px solid var(--s2j-border)" }}
        role="tablist"
      >
        {[
          ["settings", "Settings"],
          ["diagnostics", "Diagnostics"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => setActiveTab(key)}
            className="text-sm"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0 2px 8px",
              fontWeight: activeTab === key ? 600 : 400,
              color: activeTab === key ? "var(--s2j-text)" : "var(--s2j-text-muted)",
              borderBottom:
                activeTab === key
                  ? "2px solid var(--s2j-green)"
                  : "2px solid transparent",
              marginBottom: "-1px",
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  if (activeTab === "diagnostics") {
    return (
      <div>
        {tabBar}
        {/* [P5 audit LOW-3] filter state lives HERE (the parent survives tab
            toggles) — seeding it inside the per-toggle-remounted tab resurrected a
            CLEARED filter on every Settings↔Diagnostics switch. */}
        <DiagnosticsTab
          refFilter={diagFilter}
          onRefFilterChange={setDiagFilter}
          onFixInSettings={onFixInSettings}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        {tabBar}
        <div
          className="p-8 flex items-center gap-2"
          style={{ color: "var(--s2j-text-muted)" }}
        >
          <Spinner /> Loading settings...
        </div>
      </div>
    );
  }

  // v6 value-split: BOTH editions are BYOK -> the API-key field shows for EVERY edition
  // (impl-spec §0 #1). Feature access gates on capability flags, never the edition label.
  const hasTestCases = account?.hasTestCases === true;
  const hasPlanner = account?.hasPlanner === true;

  // ── The two orthogonal signals (impl-spec §1). computeConfigVerdict/computeTiles own
  // the verdict; nothing below re-derives it inline. ──
  const licenseGate = computeLicenseGate(account);
  const blocked = licenseGate.state === "blocked"; // [A1] folded into readiness display, tiles
  const projectKeyClean = (defaultProjectKey || "").trim().toUpperCase(); // LIVE input (edit-time hint)
  const savedProjectClean = (savedProjectKey || "").trim().toUpperCase(); // SAVED destination (verdict/hero/tiles) [A2]
  const verdict = computeConfigVerdict({
    keyConfigured: apiKeyConfigured,
    projectKey: savedProjectKey, // [A4] verdict keys on the SAVED project the check probes
    keyStorageFault,
    health,
  });
  const tiles = computeTiles({
    verdict: { ...verdict, projectKey: savedProjectClean }, // [A2] PROJECT tile = SAVED destination
    apiKeyLastSetAt,
    health,
    profilesCount: contextProfiles.length,
    hasCustomFields: !!(requiredCustomFieldsJson || "").trim(),
    licenseBlocked: blocked, // [A1] blocked → VERIFIED tile neutral "plan inactive", not stale-verified
  });
  const hero = heroBanner({ verdict, licenseGate, verifying, health, projectKey: savedProjectClean }); // [A5] hero interpolates SAVED key
  const keyStepDone = apiKeyConfigured && !keyStorageFault;
  const projectStepDone = !!savedProjectClean; // [A2] step 2 done keys on the SAVED project
  const projectValid = /^[A-Z][A-Z0-9]{1,9}$/.test(projectKeyClean);
  const advancedPrice = accountPriceFor(account, "byokAdvanced");
  // [A1] "done" is a function of BOTH signals — a blocked instance never reads "You're done".
  const ready = computeReady({ licenseGate, verdict });

  return (
    <div>
      {tabBar}
      <div className="p-8" style={{ maxWidth: "640px" }}>
        {/* 4.1 Header */}
        <h1 className="mb-1" style={{ ...TYPE.title, fontSize: 22, color: MOOD.navy }}>
          Spec2Tickets Settings
        </h1>
        <p className="text-sm" style={{ color: "var(--s2j-text-muted)", marginBottom: 20, lineHeight: 1.5 }}>
          Configure Spec2Tickets for <strong>everyone on this Confluence instance</strong>. Your real job
          isn't filling in fields — it's proving it works before you walk away.
        </p>

        {/* 4.2 Configuration status card — the pre-flight verdict hero */}
        <MoodCard density="major" style={{ marginBottom: 16 }}>
          <div className="flex items-center justify-between" style={{ gap: 8, marginBottom: 12 }}>
            <h3 style={{ ...TYPE.heading, color: MOOD.navy }}>Configuration status</h3>
            <span style={{ ...TYPE.micro }}>instance-wide · applies to every BA on this site</span>
          </div>

          <SignalCallout kind={hero.kind} title={hero.title}>
            {hero.spinner ? (
              <span className="flex items-center gap-2"><Spinner /> {hero.body}</span>
            ) : (
              hero.body
            )}
          </SignalCallout>

          {/* Verify / Re-verify — available whenever the config is complete (§4.2). */}
          {!verifying && verdict.configComplete && (
            <div className="mt-3">
              <button type="button" className="btn-nav" onClick={() => runVerify(false)}>
                <IconRefresh size={14} /> {health ? "Re-verify" : "Verify configuration"}
              </button>
            </div>
          )}

          {/* §5.3 auto-verify note — only right after the auto-run settled. */}
          {autoVerifyNote && !verifying && health && (
            <p className="mt-2 flex items-start gap-1.5" style={{ ...TYPE.micro }}>
              <span style={{ color: "var(--s2j-text-muted)", marginTop: 1, display: "inline-flex" }}><IconClock size={12} /></span>
              <span>
                Ran automatically the moment key + project first became complete. It won't re-probe every time
                you open Settings.
              </span>
            </p>
          )}

          {/* 5 answer tiles — from computeTiles (optionals stay NEUTRAL). */}
          <div
            className="mt-3"
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))", gap: 10 }}
          >
            {tiles.map((t) => (
              <SettingTile key={t.id} tile={t} />
            ))}
          </div>

          {/* Verification detail panel — one row per probe (esp. on verify-failed). */}
          {health && (
            <div className="mt-4">
              <p style={{ ...TYPE.label, fontSize: 10.5, letterSpacing: "0.04em", marginBottom: 8 }}>
                VERIFICATION DETAIL · 4 LIVE CHECKS AGAINST YOUR OWN SESSION
              </p>
              {health.failed ? (
                <SignalCallout kind="warning" fontSize={12.5}>
                  The health check could not run — Re-verify in a moment.
                </SignalCallout>
              ) : (
                (health.probes || []).map((p, i) => (
                  <ProbeRow key={`${p?.name || "probe"}-${i}`} probe={p} onFixField={onFixField} />
                ))
              )}
            </div>
          )}
        </MoodCard>

        {/* 4.3 Cost + trust row */}
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 16 }}
        >
          <MoodCard density="minor">
            <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
              <span style={{ ...TYPE.label }}>COST ON YOUR KEY</span>
              <span style={{ fontSize: 9, color: "var(--s2j-text-muted)" }}>T2</span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "var(--s2j-text)", lineHeight: 1.1 }}>
              {COST_ANCHOR.typical}
            </div>
            <div style={{ ...TYPE.micro, marginTop: 2 }}>
              typical · up to <strong>{COST_ANCHOR.max}</strong> per breakdown
            </div>
            <p style={{ ...TYPE.micro, marginTop: 8 }}>
              Billed straight to your own Anthropic account, pay-as-you-go, <strong>no markup from us</strong>.
              A whole team running this bills per breakdown, not per seat.
            </p>
          </MoodCard>

          <MoodCard density="minor">
            <div className="flex items-center justify-between" style={{ marginBottom: 8, gap: 8 }}>
              <span className="flex items-center gap-1.5" style={{ ...TYPE.label }}>
                <span style={{ color: "var(--s2j-text-muted)", display: "inline-flex" }}><IconShield size={13} /></span>
                YOUR DATA PATH
              </span>
              <span style={{ fontSize: 9, color: "var(--s2j-text-muted)" }}>show this to security</span>
            </div>
            <div className="flex items-center gap-1 flex-wrap" style={{ marginBottom: 8 }}>
              <PathChip>Confluence page</PathChip>
              <PathArrow />
              <PathChip>Forge</PathChip>
              <PathArrow />
              <PathChip green>Anthropic · your key</PathChip>
            </div>
            <p style={{ ...TYPE.micro }}>
              <strong>BYOK. There is no Spec2Tickets backend</strong> — page content never touches a vendor
              server. Falls under your own DPA with Anthropic.
            </p>
          </MoodCard>
        </div>

        {/* 4.4 Plan / model card — or degraded (unknown) / not-licensed (blocked). */}
        {!usageLoaded ? (
          <MoodCard density="minor" style={{ marginBottom: 16 }}>
            <p className="flex items-center gap-2" style={{ ...TYPE.micro }}>
              <Spinner /> Loading plan...
            </p>
          </MoodCard>
        ) : licenseGate.state === "unknown" ? (
          <SignalCallout kind="warning" title="Plan details couldn't load" style={{ marginBottom: 16 }} fontSize={13}>
            <p className="mb-2">
              getUsage failed on the server, so plan, price and member-since aren't available right now.
              <strong> This is different from having no account — your settings below still save and work as
              normal.</strong>
            </p>
            <button type="button" className="btn-nav" onClick={loadUsage}>
              <IconRefresh size={14} /> Retry
            </button>
          </SignalCallout>
        ) : (
          <PlanModelCard
            account={account}
            model={model}
            hasTestCases={hasTestCases}
            hasPlanner={hasPlanner}
            advancedPrice={advancedPrice}
          />
        )}

        {/* §5.9 — Not licensed (license gate blocked): dominates, shown in addition. */}
        {licenseGate.state === "blocked" && (
          <SignalCallout kind="error" title="Not licensed" style={{ marginBottom: 16 }} fontSize={13}>
            <p className="mb-2">
              No active subscription or Atlassian trial on this site, so generation is blocked for everyone.
              Your Anthropic key stays configured and starts working the moment a plan is active — this isn't
              a broken account, it's an unlicensed one.
            </p>
            <button
              type="button"
              className="btn-nav"
              onClick={() => {
                try {
                  router.open(UPGRADE_URL);
                } catch (_) {
                  /* router unavailable outside the Forge iframe */
                }
              }}
            >
              See plans / start a trial <IconExternalLink size={13} />
            </button>
          </SignalCallout>
        )}

        {/* 4.5 Set up in order — the led spine */}
        <div style={{ marginTop: 8 }}>
          <div className="flex items-center justify-between flex-wrap" style={{ gap: 8, marginBottom: 14 }}>
            <h3 style={{ ...TYPE.heading, color: MOOD.navy }}>Set up in order</h3>
            <span style={{ ...TYPE.micro }}>
              {ready ? (
                <strong>All set · verified</strong>
              ) : (
                <>
                  Two required steps, then two optional. <strong>{verdict.requiredDone} of 2 required done</strong>
                </>
              )}
            </span>
          </div>

          {/* Step 1 — Connect Anthropic */}
          <Step n={1} done={keyStepDone} title="Connect Anthropic" tag="REQUIRED">
            {keyStepDone && !editingKey ? (
              <StepSummary
                text={`Key configured${
                  apiKeyLastSetAt ? ` · last set ${new Date(apiKeyLastSetAt).toLocaleDateString()}` : ""
                }${model ? ` · model ${model}` : ""}`}
                onEdit={() => setEditingKey(true)}
              />
            ) : (
              <div>
                <p style={{ ...TYPE.micro, marginBottom: 8 }}>
                  Paste your Anthropic API key. It's stored write-only for the whole instance — we never show
                  it back. New here? Get a key at{" "}
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    console.anthropic.com
                  </a>
                  {" · "}
                  <a href="https://spec2jira.com/get-api-key" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    plain-English walkthrough
                  </a>{" "}
                  (covers the billing step).
                </p>
                <div className="flex gap-2">
                  <input
                    ref={apiKeyRef}
                    type="password"
                    value={anthropicApiKey}
                    onChange={handleApiKeyChange}
                    placeholder={apiKeyConfigured ? "•••••••• (configured — paste to replace)" : "sk-ant-api03-..."}
                    className="flex-1 s2j-field"
                    style={inputStyle}
                    autoComplete="off"
                  />
                  <button
                    onClick={handleTest}
                    disabled={testing || (!anthropicApiKey && !apiKeyConfigured)}
                    className="btn-nav shrink-0"
                  >
                    {testing ? "Testing..." : "Test Connection"}
                  </button>
                </div>

                {/* [C1] inline key-format validation — at the field, not the shared bottom message. */}
                {fieldErrors.apiKey && (
                  <div className="mt-2">
                    <SignalCallout kind="error" fontSize={12.5}>{fieldErrors.apiKey}</SignalCallout>
                  </div>
                )}

                {testResult && (
                  <div className="mt-2">
                    {testResult.status === "ok" ? (
                      <SignalCallout kind="success" fontSize={12.5}>
                        Connected — billing model <code>{testResult.model || "resolved"}</code>. This is the
                        real model name from the API, not a hard-coded label.
                      </SignalCallout>
                    ) : (
                      <SignalCallout kind="error" fontSize={12.5}>{testResult.text}</SignalCallout>
                    )}
                  </div>
                )}

                {apiKeyConfigured && (
                  <button
                    onClick={handleClearKey}
                    disabled={clearing}
                    className="text-xs mt-2"
                    style={{
                      color: "var(--s2j-red)",
                      textDecoration: "underline",
                      background: "none",
                      border: "none",
                      cursor: clearing ? "default" : "pointer",
                      padding: 0,
                    }}
                  >
                    {clearing ? "Clearing..." : clearKeyArmed ? "Click again to confirm" : "Clear stored API key"}
                  </button>
                )}
              </div>
            )}
          </Step>

          {/* Step 2 — Choose the default Jira project */}
          <Step n={2} done={projectStepDone} title="Choose the default Jira project" tag="REQUIRED">
            {projectStepDone && !editingProject ? (
              <StepSummary
                text={`Pushes to project ${projectKeyClean} by default`}
                onEdit={() => setEditingProject(true)}
              />
            ) : (
              <div>
                <input
                  ref={projectKeyRef}
                  type="text"
                  value={defaultProjectKey}
                  onChange={(e) => {
                    setDefaultProjectKey(e.target.value.toUpperCase());
                    if (message) setMessage(null); // [R1] edit supersedes a prior Save banner
                    setFieldErrors((fe) => (fe.project ? { ...fe, project: undefined } : fe)); // [C1]
                  }}
                  placeholder="PROJ"
                  className="s2j-field"
                  style={{ ...inputStyle, maxWidth: "160px", fontFamily: "monospace" }}
                  maxLength={10}
                />
                {projectKeyClean ? (
                  projectValid ? (
                    <p className="mt-2 flex items-start gap-1.5" style={{ ...TYPE.micro, color: "var(--s2j-text)" }}>
                      <SignalIcon kind="success" size={13} />
                      <span>Looks valid — Verify below will confirm the project actually exists.</span>
                    </p>
                  ) : (
                    <p className="mt-2 flex items-start gap-1.5" style={{ ...TYPE.micro, color: "var(--s2j-text)" }}>
                      <SignalIcon kind="warning" size={13} />
                      <span>2-10 characters, start with a letter, only uppercase letters and digits (e.g. PROJ, SCRUM2).</span>
                    </p>
                  )
                ) : null}
                {/* [C1] inline save-validation for the project key — beneath the live hint. */}
                {fieldErrors.project && (
                  <p className="mt-2 flex items-start gap-1.5" style={{ ...TYPE.micro, color: "var(--s2j-text)" }}>
                    <SignalIcon kind="error" size={13} />
                    <span>{fieldErrors.project}</span>
                  </p>
                )}
              </div>
            )}
          </Step>

          {/* Step 3 — Add project context (OPTIONAL, never collapses to done) */}
          <Step n={3} done={false} title="Add project context" tag="OPTIONAL" tag2="T0·T3" optional>
            <p style={{ ...TYPE.micro, marginBottom: 10 }}>
              Standing background — domain, glossary, personas — Claude reuses on every breakdown for a
              project. Durable facts only; leave out anything true of a single page. <strong>You're fully
              configured without this.</strong>
            </p>
            <ContextProfilesEditor
              profiles={contextProfiles}
              setProfiles={setContextProfiles}
              apiKeyConfigured={apiKeyConfigured}
              onMessage={setMessage}
            />
          </Step>

          {/* Step 4 — Required custom fields (OPTIONAL · ADVANCED) */}
          <Step n={4} done={false} title="Required custom fields" tag="OPTIONAL · ADVANCED" optional>
            <p style={{ ...TYPE.micro, marginBottom: 8 }}>
              Only needed if your Jira project rejects issues created without a custom field (e.g. a mandatory
              Team, Story Points or Sprint). Map each field ID to its value as JSON — otherwise the push fails
              with 'field is required'. Leave blank if your project doesn't need any.
            </p>
            {!showAdvanced ? (
              <button
                type="button"
                onClick={() => setShowAdvanced(true)}
                className="text-sm font-medium"
                style={{ color: "var(--s2j-blue)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                + Add custom-field mapping
              </button>
            ) : (
              <div>
                <textarea
                  value={requiredCustomFieldsJson}
                  onChange={(e) => {
                    setRequiredCustomFieldsJson(e.target.value);
                    if (message) setMessage(null); // [R1] edit supersedes a prior Save banner
                    setFieldErrors((fe) => (fe.customFields ? { ...fe, customFields: undefined } : fe)); // [C1]
                  }}
                  placeholder={'{\n  "customfield_10042": { "value": "Platform" },\n  "customfield_10016": 3\n}'}
                  rows={6}
                  className="s2j-field"
                  style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.8rem", resize: "vertical" }}
                  spellCheck={false}
                />
                {/* [C1] inline custom-fields JSON validation — at the field, not the shared bottom message. */}
                {fieldErrors.customFields && (
                  <SignalCallout kind="error" style={{ marginTop: 8 }} fontSize={12.5}>{fieldErrors.customFields}</SignalCallout>
                )}
                <SignalCallout kind="info" style={{ marginTop: 8 }} fontSize={12}>
                  <p className="mb-1">
                    <strong>How to find a field ID:</strong> in Jira go to Settings → Issues → Custom fields, click the field → the URL contains <code>customfield_XXXXX</code>. The <em>value shape</em> depends on the field type:
                  </p>
                  <ul style={{ marginLeft: "16px", listStyle: "disc" }}>
                    <li>Select/dropdown → <code>{'{ "value": "Option name" }'}</code></li>
                    <li>Number (e.g. Story Points) → <code>3</code></li>
                    <li>Text → <code>"some text"</code></li>
                    <li>User → <code>{'{ "id": "<accountId>" }'}</code></li>
                  </ul>
                  <p className="mt-1">
                    Not sure what your project needs? Contact{" "}
                    <a href="mailto:support@spec2jira.com" style={{ color: "var(--s2j-blue)", textDecoration: "underline" }}>
                      support@spec2jira.com
                    </a>{" "}
                    — paste your push error and we'll help map the fields.
                  </p>
                </SignalCallout>
              </div>
            )}
          </Step>

          {/* Step 5 — Verify & hand off — THREE-way (§5.9/A1): ready / blocked / run-the-check.
              A blocked (unlicensed) instance must NEVER read "You're done", even with passing probes. */}
          <Step n={5} done={ready} title="Verify & hand off">
            {ready ? (
              <p style={{ ...TYPE.micro, color: "var(--s2j-text)" }}>
                <strong>You're done.</strong> All four checks passed against your session. <strong>Verified
                from here — the key and project apply to everyone; each BA still needs their own
                Confluence/Jira access.</strong>
              </p>
            ) : blocked ? (
              <p style={{ ...TYPE.micro }}>
                Generation is blocked — see the <strong>Not licensed</strong> notice above.{" "}
                {verdict.configComplete
                  ? "Your key and project are saved and will work the moment a plan is active."
                  : "Once a plan is active, finish the required steps above to start generating."}
              </p>
            ) : (
              <div>
                <p style={{ ...TYPE.micro, marginBottom: 8 }}>
                  Run the check to finish — it confirms the four production paths respond from your session.
                </p>
                <button
                  type="button"
                  className="btn-nav"
                  onClick={() => runVerify(false)}
                  disabled={verifying || !verdict.configComplete}
                >
                  <IconRefresh size={14} /> {verifying ? "Verifying..." : "Verify configuration"}
                </button>
              </div>
            )}
          </Step>
        </div>

        {/* Shared message region — Save/Clear/Reset outcomes (Test feedback is inline above). */}
        {message && (
          <div role="alert" aria-live="polite" className="mt-4">
            <SignalCallout kind={message.type === "success" ? "success" : "error"} fontSize={14}>
              {message.text}
            </SignalCallout>
          </div>
        )}

        {/* 4.8 Footer — Save (green) + armed Reset (secondary). */}
        <div className="mt-6 flex items-center gap-3 flex-wrap">
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? "Saving..." : "Save settings"}
          </button>
          <span className="text-xs" style={{ color: "var(--s2j-text-muted)" }}>
            Applies to all users in this Confluence instance
          </span>
          <span className="flex-1" />
          <button onClick={handleReset} disabled={saving} className="btn-secondary">
            {resetArmed ? "Click again to confirm" : "Reset all settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Diagnostics tab (diagnostics Phase 5, design §5) ─────────────────────────
// Per-user diagnostic ledger viewer + site-wide aggregate counters + consented
// export + health check + clear. Humanized texts come from lib/diagnosticsView
// (the single humanize authority — backend↔frontend code-sync is a NAMED review
// check). The surface itself must never look broken: load failures render a
// friendly retry state, never a blank screen.

// COUNT_FRIENDLY + friendlyCounts were MOVED to lib/diagnosticsView.js so composeIncident + the card share
// ONE source (they are imported at the top of this file). CHIP_TONE + CountChip stay here (React paint).
const CHIP_TONE = {
  ok: { bg: "var(--s2j-green-bg)", border: "var(--s2j-green-border)", dot: "var(--s2j-green)" },
  warn: { bg: "var(--s2j-orange-bg)", border: "var(--s2j-orange-border)", dot: "var(--s2j-orange)" },
  err: { bg: "var(--s2j-red-bg)", border: "var(--s2j-red-border)", dot: "var(--s2j-red)" },
  info: { bg: "var(--s2j-bg-section)", border: "var(--s2j-border)", dot: "var(--s2j-text-muted)" },
};
function CountChip({ label, tone }) {
  const c = CHIP_TONE[tone] || CHIP_TONE.info;
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1.5"
      style={{ background: c.bg, border: `1px solid ${c.border}`, color: "var(--s2j-text)" }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
      {label}
    </span>
  );
}

// The red "YOU NEVER SAW THIS" pill on a silent-failure card (impl-spec §4).
function SilentPill() {
  return (
    <span
      className="inline-flex items-center"
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        // [F4/WCAG] words stay DARK on the red tint (navy-on-red-bg ~13:1); the red is carried by the
        // border + the card's red border/icon (the words-dark-on-tint rule — red text on red-bg was ~3.1:1).
        color: "var(--s2j-text)",
        background: "var(--s2j-red-bg)",
        border: "1px solid var(--s2j-red-border)",
        borderRadius: 6,
        padding: "1px 6px",
        whiteSpace: "nowrap",
      }}
    >
      You never saw this
    </span>
  );
}

// IncidentCard — a diagnostic record rendered as a plain-English INCIDENT STORY (impl-spec §2/§3). The
// humanized title + composed sentence read like an incident, never a log line; the raw op/class/ref +
// key:value counts hide behind "Show raw counts (for the report)". `silent` = a must-never-miss silent
// failure (§4): red tint + the "You never saw this" pill. `onFixInSettings` deep-links the
// Jira-rejected-field chip to the Settings tab (NOT a Settings re-verdict — a tab-switch only).
function IncidentCard({ record, silent, onFixInSettings }) {
  const [showRaw, setShowRaw] = useState(false);
  const [copyState, setCopyState] = useState("idle"); // 'idle'|'copied'|'failed'
  const inc = composeIncident(record);

  // Severity rides the ICON / left border ONLY — the title text stays DARK (WCAG; a silent error row is
  // NOT red-text-on-red). info breadcrumbs get a green check (a positive terminal state).
  const iconKind = inc.level === "error" ? "error" : inc.level === "warn" ? "warning" : "success";
  const accent =
    silent || inc.level === "error"
      ? "var(--s2j-red)"
      : inc.level === "warn"
        ? "var(--s2j-orange)"
        : "var(--s2j-green)";

  const counts =
    record?.counts && typeof record.counts === "object" && !Array.isArray(record.counts)
      ? Object.entries(record.counts)
      : [];
  const issueKeys = Array.isArray(record?.subject_keys) ? record.subject_keys : [];
  const refToCopy = record?.ref || record?.session_ref || "";

  const copyReference = async () => {
    if (!refToCopy) return;
    try {
      await navigator.clipboard.writeText(refToCopy);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch (_) {
      setCopyState("failed");
      setTimeout(() => setCopyState("idle"), 2500);
    }
  };

  return (
    <div
      className="mb-2"
      style={{
        background: silent ? "var(--s2j-red-bg)" : "var(--s2j-bg)",
        border: "1px solid var(--s2j-border)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: 8,
        padding: "10px 12px",
      }}
    >
      {/* Header — humanized title (dark, bold; colour on the icon/border) + muted class · relTime */}
      <div className="flex items-start justify-between gap-2">
        <span
          className="inline-flex items-center gap-1.5 flex-wrap"
          style={{ fontSize: 14, fontWeight: 600, color: "var(--s2j-text)", minWidth: 0 }}
        >
          <SignalIcon kind={silent ? "error" : iconKind} size={14} />
          {inc.title}
          {silent ? <SilentPill /> : null}
        </span>
        <span className="text-[11px] shrink-0" style={{ color: "var(--s2j-text-muted)" }}>
          <span style={{ fontFamily: "monospace" }}>{record?.error_class}</span>
          {" · "}
          {relTime(record?.occurrences?.lastTs || record?.ts)}
        </span>
      </div>

      {/* Into {destination} — the push Epic (no [T2] tag) */}
      {inc.destination ? (
        <p className="text-xs mt-1" style={{ color: "var(--s2j-text-muted)" }}>
          Into{" "}
          <span
            style={{
              fontFamily: "monospace",
              color: "var(--s2j-text)",
              background: "var(--s2j-bg-section)",
              border: "1px solid var(--s2j-border)",
              borderRadius: 4,
              padding: "0 5px",
            }}
          >
            {inc.destination}
          </span>
        </p>
      ) : null}

      {/* The plain-English incident sentence */}
      {inc.sentence ? (
        <p className="text-xs mt-1" style={{ color: "var(--s2j-text-light)", lineHeight: 1.5 }}>
          {inc.sentence}
        </p>
      ) : null}

      {/* Affected: {keys} — the FAILURE keys (partial/failed only) */}
      {inc.affected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          <span className="text-[11px]" style={{ color: "var(--s2j-text-muted)" }}>
            Affected:
          </span>
          {inc.affected.map((k) => (
            <span
              key={k}
              className="text-[11px] px-1.5 py-0.5 rounded"
              style={{
                fontFamily: "monospace",
                background: "var(--s2j-bg-section)",
                border: "1px solid var(--s2j-border)",
                color: "var(--s2j-text)",
              }}
            >
              {k}
            </span>
          ))}
        </div>
      ) : null}

      {/* Friendly "what landed / what didn't" chips (zeros already excluded) */}
      {inc.chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {inc.chips.map((f) => (
            <CountChip key={f.key} label={f.label} tone={f.tone} />
          ))}
        </div>
      ) : null}

      {/* Fix-chip — Jira rejected a custom field; deep-link into Settings */}
      {inc.fixChips.length > 0 ? (
        <div className="mt-2">
          <SignalCallout kind="warning" fontSize={12}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span>
                Jira rejected{" "}
                {inc.fixChips.map((fc, i) => (
                  <span key={`${fc.field}-${i}`}>
                    {i > 0 ? ", " : ""}
                    <code style={{ fontFamily: "monospace" }}>{fc.field}</code>
                  </span>
                ))}{" "}
                — add the field so the next push succeeds.
              </span>
              {onFixInSettings ? (
                <button
                  type="button"
                  className="btn-nav shrink-0"
                  style={{ fontSize: 12, whiteSpace: "nowrap" }}
                  onClick={() => onFixInSettings("customFields")}
                >
                  Add this field in Settings <IconExternalLink size={12} />
                </button>
              ) : null}
            </div>
          </SignalCallout>
        </div>
      ) : null}

      {/* Seen N times (occurrences > 1) */}
      {inc.seen ? (
        <p className="text-[11px] mt-1.5" style={{ color: "var(--s2j-text-muted)" }}>
          {inc.seen}
        </p>
      ) : null}

      {/* Footer — raw-counts toggle + Copy reference */}
      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => setShowRaw((s) => !s)}
          className="text-[11px]"
          style={{ color: "var(--s2j-blue)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          {showRaw ? "Hide raw counts" : "Show raw counts (for the report)"}
        </button>
        {refToCopy ? (
          <button
            type="button"
            onClick={copyReference}
            className="text-[11px] inline-flex items-center gap-1"
            style={{ color: "var(--s2j-blue)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            title="Copy this record's reference to paste into a support email"
          >
            <IconCopy size={12} />
            {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy reference"}
          </button>
        ) : null}
      </div>

      {showRaw ? (
        <div className="mt-1">
          <div
            className="text-[11px]"
            style={{ fontFamily: "monospace", color: "var(--s2j-text-muted)", wordBreak: "break-all" }}
          >
            {opLabel(record?.op)} · {record?.error_class}
            {record?.ref ? ` · ${record.ref}` : ""}
            {record?.session_ref ? ` · session:${record.session_ref}` : ""}
            {record?.occurrences?.count > 1 ? ` · ×${record.occurrences.count}` : ""}
          </div>
          {(counts.length > 0 || issueKeys.length > 0) && (
            <div className="flex flex-wrap gap-1 mt-1">
              {counts.map(([k, v]) => (
                <span
                  key={k}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: "var(--s2j-bg-section)", border: "1px solid var(--s2j-border)", color: "var(--s2j-text-light)" }}
                >
                  {k}: {String(v)}
                </span>
              ))}
              {issueKeys.map((k) => (
                <span
                  key={k}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: "var(--s2j-bg-section)", border: "1px solid var(--s2j-border)", color: "var(--s2j-text-light)", fontFamily: "monospace" }}
                >
                  {k}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DiagnosticsTab({ refFilter = "", onRefFilterChange, onFixInSettings }) {
  const [diagLoading, setDiagLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [data, setData] = useState(null); // getDiagnostics response
  const [scope, setScope] = useState("mine"); // 'mine' | 'all' (admin)
  // refFilter is CONTROLLED by AdminSettings (survives tab toggles; re-seeds on
  // every fresh admin-screen entry via the parent's useState init).
  const [includeDetails, setIncludeDetails] = useState(false); // §2b consent
  const [copyState, setCopyState] = useState("idle"); // 'idle'|'copied'|'failed'
  const [healthRunning, setHealthRunning] = useState(false);
  const [healthResult, setHealthResult] = useState(null); // { ok, probes } | { failed: true }
  const [clearing, setClearing] = useState(false);
  // §5 triage filters + §7 windowing.
  const [levelFilter, setLevelFilter] = useState("all"); // 'all' | 'problems' (error) | 'warnings' (warn)
  const [areaFilter, setAreaFilter] = useState("all"); // 'all' | subsystem (Push/Generation/…)
  const [visibleCount, setVisibleCount] = useState(20); // §7 window — grows by 20 on "Load more"
  const [bgOpen, setBgOpen] = useState(false); // §4 collapsed "Background events" group

  const load = useCallback(async (scopeArg) => {
    setDiagLoading(true);
    setLoadFailed(false);
    try {
      const resp = await invoke("getDiagnostics", { scope: scopeArg });
      if (resp && !resp.error) {
        setData(resp);
        // The backend gates 'all' per request (Jira ADMINISTER) and may silently
        // fall back to 'mine' — trust the RESPONSE scope, never the client toggle.
        if (resp.scope === "mine" || resp.scope === "all") setScope(resp.scope);
      } else {
        setLoadFailed(true);
      }
    } catch (_) {
      setLoadFailed(true);
    } finally {
      setDiagLoading(false);
    }
  }, []);

  useEffect(() => {
    load("mine");
  }, [load]);

  const toggleScope = (next) => {
    setScope(next);
    load(next);
  };

  // Filter by ref — case-insensitive substring. In 'all' scope the filter searches
  // ACROSS every bucket's records (the admin pastes the ref the affected user gave
  // them and finds the right bucket).
  // [P5 audit] strip a leading 'session:' — the row text renders `session:<id>` for
  // null-ref rows; pasting that copied token must still match. Cap for hygiene.
  const filterText = (refFilter || "").trim().slice(0, 200).replace(/^session:/i, "").toLowerCase();
  // §7 — a fresh filter/scope narrows the set, so the 20-row window resets (else a "Load more" from a wider
  // view would carry over and hide the top of the newly-filtered feed). Declared AFTER `filterText` (a
  // const) so its deps array does not hit a temporal-dead-zone ReferenceError on render. [F1]
  useEffect(() => {
    setVisibleCount(20);
  }, [levelFilter, areaFilter, filterText, scope]);

  // [deep-audit P2] match session_ref too — the aborted-push classes correlate by
  // it (their ref may be null); ref-only made them unfindable by search.
  // §5 — the field is relabeled "reference or issue key", so ALSO match subject_keys (the admin pastes
  // the affected issue key MOBILE-101 as readily as a diagnostic ref).
  const matchesFilter = (r) =>
    !filterText ||
    String(r?.ref || "").toLowerCase().includes(filterText) ||
    String(r?.session_ref || "").toLowerCase().includes(filterText) ||
    (Array.isArray(r?.subject_keys) &&
      r.subject_keys.some((k) => String(k || "").toLowerCase().includes(filterText)));
  // Sort by RECENCY of the last occurrence — a dedupe-merged record keeps its
  // original ts (design §2.5) but occurrences.lastTs carries the latest event;
  // ts-only sorting sank a just-recurred error below newer one-offs.
  const sortNewestFirst = (arr) =>
    arr.slice().sort(
      (a, b) =>
        (Number(b?.occurrences?.lastTs) || Number(b?.ts) || 0) -
        (Number(a?.occurrences?.lastTs) || Number(a?.ts) || 0),
    );

  const isAllScope = data?.scope === "all" && Array.isArray(data?.buckets);
  const groups = (() => {
    if (!data) return [];
    if (isAllScope) {
      return data.buckets
        .map((b) => ({
          accountId: b?.accountId || "unknown",
          records: sortNewestFirst(
            (Array.isArray(b?.records) ? b.records : []).filter(matchesFilter),
          ),
        }))
        .filter((g) => g.records.length > 0);
    }
    const recs = sortNewestFirst(
      (Array.isArray(data.records) ? data.records : []).filter(matchesFilter),
    );
    return recs.length ? [{ accountId: null, records: recs }] : [];
  })();
  const totalUnfiltered = !data
    ? 0
    : isAllScope
      ? data.buckets.reduce(
          (n, b) => n + (Array.isArray(b?.records) ? b.records.length : 0),
          0,
        )
      : Array.isArray(data.records)
        ? data.records.length
        : 0;

  const aggregateEntries =
    data?.aggregate && typeof data.aggregate === "object" && !Array.isArray(data.aggregate)
      ? Object.entries(data.aggregate).sort(
          (a, b) => (Number(b[1]?.lastTs) || 0) - (Number(a[1]?.lastTs) || 0),
        )
      : [];

  // [Copy full report] — clipboard, mirroring the app's established copy pattern
  // (DiagnosticRefLine in App.js): navigator.clipboard + discriminated
  // "✓ Copied"/"Copy failed" feedback with a timed reset.
  const handleCopyReport = async () => {
    try {
      const resp = await invoke("getDiagnosticsExport", {
        scope,
        includeDetails,
        refFilter: filterText ? refFilter.trim() : undefined,
      });
      if (!resp || resp.error || typeof resp.report !== "string") {
        setCopyState("failed");
        setTimeout(() => setCopyState("idle"), 2500);
        return;
      }
      await navigator.clipboard.writeText(resp.report);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch (_) {
      setCopyState("failed");
      setTimeout(() => setCopyState("idle"), 2500);
    }
  };

  const handleHealthCheck = async () => {
    setHealthRunning(true);
    setHealthResult(null);
    try {
      const resp = await invoke("runHealthCheck", {});
      if (resp && Array.isArray(resp.probes)) {
        setHealthResult(resp);
      } else {
        setHealthResult({ failed: true });
      }
    } catch (_) {
      setHealthResult({ failed: true });
    } finally {
      setHealthRunning(false);
      // [P5 audit NIT-3] the check just WROTE a health.check record — refresh the
      // list/aggregate so the run is immediately visible, not on the next open.
      load(scope);
    }
  };

  // [deep-audit P5 MED-3] two-step ARMED confirm — window.confirm may be blocked in
  // the Forge sandboxed iframe (the codebase's own established doubt: the test-case
  // re-run/delete affordances avoid it for exactly this reason). A blocked confirm()
  // returns false silently → the GDPR-erasure control would be permanently inert.
  const [clearArmed, setClearArmed] = useState(false);
  const clearArmTimer = useRef(null);
  const handleClearDiagnostics = async () => {
    if (!clearArmed) {
      setClearArmed(true);
      clearTimeout(clearArmTimer.current);
      clearArmTimer.current = setTimeout(() => setClearArmed(false), 4000);
      return;
    }
    clearTimeout(clearArmTimer.current);
    setClearArmed(false);
    setClearing(true);
    try {
      await invoke("clearDiagnostics", {});
    } catch (_) {
      /* the reload below shows the truth either way */
    }
    setClearing(false);
    load(scope);
  };

  // Clear the armed clear-diagnostics timer on unmount (survives Settings<->Diagnostics
  // tab toggles, which remount this component). [E1]
  useEffect(
    () => () => {
      clearTimeout(clearArmTimer.current);
    },
    [],
  );

  // ── §5/§6/§8 derived views (render-only; every hook/handler above is unchanged) ────
  const allRecs = isAllScope
    ? data.buckets.flatMap((b) => (Array.isArray(b?.records) ? b.records : []))
    : Array.isArray(data?.records)
      ? data.records
      : [];
  // [B1] Pushes read the install-wide, MONOTONIC aggregate sidecar — NOT the 50-record ledger.
  const aggPush = data?.aggregate || {};
  const cleanPushes = Number(aggPush.push_completed?.count) || 0;
  const partialPushes = Number(aggPush.partial_push?.count) || 0;
  const openIncidents = allRecs.filter((r) => r?.level === "error" || r?.level === "warn").length;

  // Aggregate health-breadcrumb timestamps — feed BOTH the tile AND the §8 "not verified recently" banner.
  const aggHealth = data?.aggregate || {};
  const okTs = Number(aggHealth.health_ok?.lastTs) || 0;
  const badTs = Number(aggHealth.health_degraded?.lastTs) || 0;
  const lastHealthTs = Math.max(okTs, badTs);

  // §8 — the plain-English System-health verdict banner. Never-run (no in-session result) reads the aggregate
  // breadcrumb: a prior pass/fail becomes "not verified recently", a truly-never-run becomes "run a check".
  const hrProbes = healthResult && Array.isArray(healthResult.probes) ? healthResult.probes : [];
  const hrFail = hrProbes.filter((p) => p && p.ok === false).length;
  const healthBanner = !healthResult
    ? lastHealthTs
      ? {
          kind: "info",
          title: "Health not verified recently",
          body:
            (okTs >= badTs ? `Last passed ${relTime(okTs)}.` : `Last check found problems ${relTime(badTs)}.`) +
            " Run a fresh check to confirm the instance is healthy right now.",
        }
      : { kind: "info", title: "Run a health check", body: "Probe the four production paths — Anthropic, Confluence, Jira and storage — against your own session." }
    : healthResult.failed
      ? { kind: "warning", title: "The health check could not run", body: "Try again in a moment." }
      : healthResult.ok
        ? { kind: "success", title: "All systems healthy", body: "The four production paths — Anthropic key, Confluence, Jira and storage — all responded from your session. Last checked recently." }
        : {
            kind: "error",
            title: `${hrFail || 1} check${(hrFail || 1) === 1 ? "" : "s"} failing right now`,
            body: "A production path is down. The raw probe and code are below; a field-fixable one links straight into Settings.",
          };

  // System-health tiles (unchanged logic).
  const lastHealthTile =
    healthResult && !healthResult.failed
      ? { label: "LAST HEALTH CHECK", value: healthResult.ok ? "Passed" : "Failed", sub: "just now", status: healthResult.ok ? "ok" : "error" }
      : okTs || badTs
        ? { label: "LAST HEALTH CHECK", value: okTs >= badTs ? "Passed" : "Failed", sub: relTime(okTs >= badTs ? okTs : badTs), status: okTs >= badTs ? "ok" : "warn" }
        : { label: "LAST HEALTH CHECK", value: "Not run", sub: "run below", status: "neutral" };
  const pushesTile = {
    label: "PUSHES · ALL TIME",
    value: `${cleanPushes} clean · ${partialPushes} partial`,
    sub: "site-wide",
    status: partialPushes > 0 ? "warn" : cleanPushes > 0 ? "ok" : "neutral",
  };
  const incidentsTile = {
    label: "OPEN INCIDENTS",
    value: `${openIncidents}`,
    sub: openIncidents ? "to review" : "all clear",
    status: openIncidents > 0 ? "warn" : "ok",
  };
  const sweep = data?.sweepHeartbeat;
  const sweepBad = sweep && sweep.present && (sweep.stale || sweep.ok === false || sweep.degraded > 0);
  const sweepTile = !sweep
    ? { label: "ORPHAN SWEEP", value: "—", sub: "admin only", status: "neutral" }
    : !sweep.present
      ? { label: "ORPHAN SWEEP", value: "No run yet", sub: "runs daily", status: "neutral" }
      : { label: "ORPHAN SWEEP", value: relTime(sweep.at) || "recently", sub: sweepBad ? "needs a look" : "clean", status: sweepBad ? "warn" : "ok" };
  const healthTiles = [lastHealthTile, pushesTile, incidentsTile, sweepTile];

  // ── §5 triage + §4 partition + §6 grouping + §7 windowing ──────────────────────
  // Subsystem for the "All areas" dropdown — from the op family (error_class as fallback).
  const deriveArea = (r) => {
    const op = String(r?.op || "");
    if (op.startsWith("push")) return "Push";
    if (op.startsWith("generation")) return "Generation";
    if (op.startsWith("testgen")) return "Test cases";
    if (op.startsWith("health")) return "Health";
    if (op.startsWith("settings") || op.startsWith("distill")) return "Settings";
    if (op === "purge") return "Storage";
    const cls = String(r?.error_class || "");
    if (/kvs_|persist|pagesnap|purge/.test(cls)) return "Storage";
    if (/testgen|export|regen|story_removed/.test(cls)) return "Test cases";
    if (/push|orphan|link|subtask|session|project|jira|permission/.test(cls)) return "Push";
    if (/batch|anthropic|truncat|refused|parse|result|cycle|distill|context|rate_limited|insufficient/.test(cls)) return "Generation";
    if (/health/.test(cls)) return "Health";
    if (/config|licen|quota|not_configured|managed|gate|network|egress/.test(cls)) return "Settings";
    return "Other";
  };

  // scope+ref filtered rows (groups already applied both). Order preserved (per-bucket, newest-first).
  const scopedRows = [];
  groups.forEach((g) => g.records.forEach((r) => scopedRows.push({ r, accountId: g.accountId })));
  const areaOptions = Array.from(new Set(scopedRows.map(({ r }) => deriveArea(r)))).sort();
  const passesArea = ({ r }) => areaFilter === "all" || deriveArea(r) === areaFilter;
  const passesLevel = ({ r }) =>
    levelFilter === "all" || (levelFilter === "problems" ? r?.level === "error" : r?.level === "warn");

  // Triage summary counts over the AREA-scoped set (the level segment is the legend, not a reducer).
  const areaScoped = scopedRows.filter(passesArea);
  const triageProblems = areaScoped.filter(({ r }) => r?.level === "error").length;
  const triageWarnings = areaScoped.filter(({ r }) => r?.level === "warn").length;
  const triageHealthy = areaScoped.filter(({ r }) => r?.level === "info").length;
  const mostRecentTs = areaScoped.reduce(
    (mx, { r }) => Math.max(mx, Number(r?.occurrences?.lastTs) || Number(r?.ts) || 0),
    0,
  );

  const filteredRows = areaScoped.filter(passesLevel);
  const shownCountFiltered = filteredRows.length; // §5 "showing {shown} of {total}"
  const noneAfterFilter = filteredRows.length === 0;

  // §4 partition. Silent = surfaced===false AND ERROR-level (must-never-miss). Background = surfaced===false
  // AND WARN-level (benign breadcrumbs → collapsed bottom group). A missing `surfaced` is treated as seen.
  const silentRows = filteredRows.filter(({ r }) => r?.surfaced === false && r?.level === "error");
  const backgroundRows = filteredRows.filter(({ r }) => r?.surfaced === false && r?.level === "warn");
  const silentSet = new Set(silentRows.map((x) => x.r));
  const bgSet = new Set(backgroundRows.map((x) => x.r));
  const normalRows = filteredRows.filter(({ r }) => !silentSet.has(r) && !bgSet.has(r));

  // §7 window over the NORMAL feed.
  const visibleNormal = normalRows.slice(0, visibleCount);
  const hasMore = normalRows.length > visibleCount;

  // §6 per-account TOTALS for the all-scope group header "{N} events" (full normal feed, not the window).
  const accountTotals = new Map();
  normalRows.forEach(({ accountId }) => accountTotals.set(accountId, (accountTotals.get(accountId) || 0) + 1));
  // Group the VISIBLE slice by consecutive accountId (buckets are contiguous per account in all-scope).
  const displayGroups = [];
  visibleNormal.forEach(({ r, accountId }) => {
    const last = displayGroups[displayGroups.length - 1];
    if (last && last.accountId === accountId) last.records.push(r);
    else displayGroups.push({ accountId, records: [r] });
  });
  const nameFor = (accountId) => {
    if (!isAllScope || accountId === null) return "User";
    const b = (data.buckets || []).find((x) => (x?.accountId || "unknown") === accountId);
    return (b && typeof b.displayName === "string" && b.displayName) || "User";
  };
  const shortId = (id) => {
    const s = String(id || "");
    return s.length > 10 ? "..." + s.slice(-8) : s;
  };

  return (
    <div className="p-8" style={{ maxWidth: "640px" }}>
      {/* moodboard (Phase 5) — navy diagnostics title. */}
      <h1 className="mb-1" style={{ ...TYPE.title, fontSize: 22, color: MOOD.navy }}>
        Diagnostics
      </h1>
      <p className="text-sm mb-5" style={{ color: "var(--s2j-text-muted)" }}>
        A plain-English incident log of your Spec2Tickets activity on this site.
      </p>

      {/* Admin-only site-wide scope toggle. The reference filter lives in the §5 filter strip below.
          Rendered ONLY when the backend confirmed Jira ADMINISTER (isAdmin); it re-gates every 'all'
          request server-side. */}
      {data?.isAdmin === true && (
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <label
            className="flex items-center gap-2 text-xs"
            style={{ color: "var(--s2j-text)", cursor: "pointer" }}
            title="Show every user's diagnostics on this site (admins only) — search by the reference the affected user gives you"
          >
            <input
              type="checkbox"
              checked={scope === "all"}
              disabled={diagLoading}
              onChange={(e) => toggleScope(e.target.checked ? "all" : "mine")}
            />
            All users on this site
          </label>
        </div>
      )}

      {/* System health card (§8) — the plain-English verdict banner + Run/Re-run + 4 tiles + the sweep
          heartbeat (unchanged 3-way logic) + the raw probe rows, all in one place. */}
      <MoodCard density="major" style={{ marginBottom: 16 }}>
        <div className="flex items-center justify-between flex-wrap" style={{ gap: 8, marginBottom: 12 }}>
          <h3 style={{ ...TYPE.heading, color: MOOD.navy }}>System health</h3>
          <span style={{ ...TYPE.micro }}>the same 4 production paths the app uses · runHealthCheck</span>
        </div>

        <SignalCallout kind={healthBanner.kind} title={healthBanner.title} fontSize={13}>
          {healthBanner.body}
        </SignalCallout>

        <div className="mt-3">
          <button type="button" className="btn-nav" onClick={handleHealthCheck} disabled={healthRunning}>
            <IconRefresh size={14} /> {healthRunning ? "Running..." : healthResult ? "Re-run" : "Run health check"}
          </button>
        </div>

        <div
          className="mt-3"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}
        >
          {healthTiles.map((t) => (
            <SettingTile key={t.label} tile={t} />
          ))}
        </div>

      {/* Vendor sweep heartbeat — admin-only (the backend returns it only when isAdmin). The "did the
          daily orphan-sweep fire" signal (strategy §4.1): a PULL status, no push alert. Counts + a
          timestamp only — no page/document content. */}
      {data?.sweepHeartbeat && (
        <div
          className="mt-3 flex items-center gap-2 text-xs"
          style={{
            ...glassSurface("utility"),
            padding: 12,
            color: "var(--s2j-text)",
          }}
          title="Vendor maintenance: the daily background job that removes never-pushed breakdowns 7 days after last access. Counts only — no page or document content."
        >
          {!data.sweepHeartbeat.present ? (
            <>
              <SignalIcon kind="info" size={14} />
              <span style={{ color: "var(--s2j-text-muted)" }}>
                Orphan sweep: no run recorded yet (runs daily).
              </span>
            </>
          ) : data.sweepHeartbeat.stale ||
            data.sweepHeartbeat.ok === false ||
            data.sweepHeartbeat.degraded > 0 ? (
            <>
              {/* Amber for ANY unhealthy state — stale (didn't fire), errored, or degraded. The icon color
                  must NOT read green/"healthy" on a failed-or-degraded run (the signal this surface exists for). */}
              <SignalIcon kind="warning" size={14} />
              <span>
                {data.sweepHeartbeat.stale
                  ? `Orphan sweep last ran ${relTime(data.sweepHeartbeat.at)} — expected daily.`
                  : `Orphan sweep ran ${relTime(data.sweepHeartbeat.at)}.`}{" "}
                scanned {data.sweepHeartbeat.scanned} · deleted {data.sweepHeartbeat.deleted}
                {data.sweepHeartbeat.degraded ? ` · ${data.sweepHeartbeat.degraded} degraded` : ""}
                {data.sweepHeartbeat.ok === false ? " · last run errored" : ""}
              </span>
            </>
          ) : (
            <>
              <SignalIcon kind="success" size={14} />
              <span>
                Orphan sweep ran {relTime(data.sweepHeartbeat.at)} · scanned{" "}
                {data.sweepHeartbeat.scanned} · deleted {data.sweepHeartbeat.deleted}
              </span>
            </>
          )}
        </div>
      )}

        {/* RAW PROBES · NAME · CODE · RESULT — from the last in-session health run. A failed field-fixable
            probe deep-links into Settings (§8). */}
        {healthResult && !healthResult.failed && Array.isArray(healthResult.probes) && (
          <div className="mt-3">
            <p style={{ ...TYPE.label, fontSize: 10.5, letterSpacing: "0.04em", marginBottom: 8 }}>
              RAW PROBES · NAME · CODE · RESULT
            </p>
            {healthResult.probes.map((p, i) => (
              <ProbeRow key={`${p?.name || "probe"}-${i}`} probe={p} onFixInSettings={onFixInSettings} />
            ))}
          </div>
        )}
      </MoodCard>

      {/* ── Incident triage feed (§4–§7) ─────────────────────────────────────── */}
      {diagLoading ? (
        <div className="flex items-center gap-2 py-6" style={{ color: "var(--s2j-text-muted)" }}>
          <Spinner /> <span className="text-sm">Loading diagnostics...</span>
        </div>
      ) : loadFailed ? (
        <div
          className="rounded-md p-3 text-sm flex items-center justify-between gap-3 flex-wrap"
          style={{ background: "var(--s2j-bg-section)", border: "1px solid var(--s2j-border)", color: "var(--s2j-text)" }}
        >
          <span>Couldn't load diagnostics — try again.</span>
          <button type="button" className="btn-secondary" onClick={() => load(scope)}>
            Retry
          </button>
        </div>
      ) : totalUnfiltered === 0 ? (
        <p
          className="text-sm rounded-md p-3"
          style={{ background: "var(--s2j-bg-section)", border: "1px solid var(--s2j-border)", color: "var(--s2j-text-muted)" }}
        >
          No problems recorded.
        </p>
      ) : (
        <div>
          {/* §5 triage summary bar */}
          <div
            className="flex items-center justify-between gap-2 flex-wrap mb-3"
            style={{ ...glassSurface("utility"), padding: "8px 12px" }}
          >
            <div className="flex items-center gap-3 flex-wrap text-xs" style={{ color: "var(--s2j-text)" }}>
              <span className="inline-flex items-center gap-1.5">
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--s2j-red)", display: "inline-block", flexShrink: 0 }} />
                {triageProblems} problem{triageProblems === 1 ? "" : "s"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--s2j-orange)", display: "inline-block", flexShrink: 0 }} />
                {triageWarnings} warning{triageWarnings === 1 ? "" : "s"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--s2j-green)", display: "inline-block", flexShrink: 0 }} />
                {triageHealthy} healthy event{triageHealthy === 1 ? "" : "s"}
              </span>
            </div>
            {mostRecentTs ? (
              <span className="text-[11px]" style={{ color: "var(--s2j-text-muted)" }}>
                most recent {relTime(mostRecentTs)}
              </span>
            ) : null}
          </div>

          {/* §5 filter strip — segmented level + area dropdown + reference/issue-key search */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <div
              className="inline-flex"
              style={{ border: "1px solid var(--s2j-border)", borderRadius: 8, overflow: "hidden" }}
              role="tablist"
              aria-label="Filter by severity"
            >
              {[
                ["all", "All"],
                ["problems", "Problems"],
                ["warnings", "Warnings"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={levelFilter === key}
                  onClick={() => setLevelFilter(key)}
                  style={{
                    fontSize: 12,
                    padding: "5px 12px",
                    border: "none",
                    borderLeft: key !== "all" ? "1px solid var(--s2j-border)" : "none",
                    cursor: "pointer",
                    background: levelFilter === key ? "var(--s2j-blue-bg)" : "transparent",
                    color: levelFilter === key ? "var(--s2j-text)" : "var(--s2j-text-muted)",
                    fontWeight: levelFilter === key ? 600 : 400,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              value={areaFilter}
              onChange={(e) => setAreaFilter(e.target.value)}
              className="s2j-field"
              style={{ ...inputStyle, width: "auto", maxWidth: 170, fontSize: "0.8rem", padding: "6px 10px" }}
              aria-label="Filter by area"
            >
              <option value="all">All areas</option>
              {areaOptions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={refFilter}
              onChange={(e) => onRefFilterChange && onRefFilterChange(e.target.value)}
              placeholder="Filter by reference or issue key..."
              className="s2j-field"
              style={{ ...inputStyle, flex: 1, minWidth: 180, maxWidth: 280, fontFamily: "monospace", fontSize: "0.8rem" }}
              spellCheck={false}
            />
          </div>
          <p className="text-xs mb-3" style={{ color: "var(--s2j-text-muted)" }}>
            {data?.scope === "all" ? "across all users on this site" : "for this admin"} · showing{" "}
            {silentRows.length + visibleNormal.length} of {silentRows.length + normalRows.length} · newest first
          </p>

          {noneAfterFilter ? (
            <p className="text-sm py-2" style={{ color: "var(--s2j-text-muted)" }}>
              No records match this filter.
            </p>
          ) : (
            <div>
              {/* §4 silent-failure partition — must-never-miss, red-tinted, FIRST. */}
              {silentRows.length > 0 && (
                <div
                  className="mb-3"
                  style={{
                    background: "var(--s2j-red-bg)",
                    border: "1px solid var(--s2j-red-border)",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <p className="text-xs font-semibold flex items-center gap-1.5" style={{ color: "var(--s2j-text)", marginBottom: 2 }}>
                    <SignalIcon kind="error" size={14} /> Silent failures — you never saw these
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--s2j-text-light)", marginBottom: 10 }}>
                    These finished in the background and lost data without an on-screen error. Handle these first.
                  </p>
                  {silentRows.map(({ r, accountId }, i) => (
                    <div key={`silent-${r?.ts}-${r?.op}-${i}`}>
                      {accountId !== null ? (
                        <p className="text-[11px] mb-1 inline-flex items-center gap-1" style={{ color: "var(--s2j-text-muted)" }}>
                          <IconUsers size={12} /> {nameFor(accountId)} · {shortId(accountId)}
                        </p>
                      ) : null}
                      <IncidentCard record={r} silent onFixInSettings={onFixInSettings} />
                    </div>
                  ))}
                </div>
              )}

              {/* §6 normal feed — grouped by user in all-scope, §7 windowed to 20. */}
              {displayGroups.map((g) => (
                <div key={g.accountId === null ? "mine" : g.accountId}>
                  {g.accountId !== null && (
                    <p className="text-[11px] mt-3 mb-1 inline-flex items-center gap-1" style={{ color: "var(--s2j-text-muted)" }}>
                      <IconUsers size={12} /> {nameFor(g.accountId)} · {shortId(g.accountId)} ·{" "}
                      {accountTotals.get(g.accountId) || g.records.length} events
                    </p>
                  )}
                  {g.records.map((r, i) => (
                    <IncidentCard key={`${r?.ts}-${r?.op}-${i}`} record={r} onFixInSettings={onFixInSettings} />
                  ))}
                </div>
              ))}

              {/* §7 windowing — reveal the next 20. */}
              {hasMore && (
                <button type="button" className="btn-nav" onClick={() => setVisibleCount((c) => c + 20)} style={{ marginTop: 6 }}>
                  Load more
                </button>
              )}

              {/* §4 collapsed "Background events" — benign silent warns, nothing to fix. */}
              {backgroundRows.length > 0 && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setBgOpen((o) => !o)}
                    className="text-xs inline-flex items-center gap-1.5"
                    style={{ color: "var(--s2j-text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    aria-expanded={bgOpen}
                  >
                    {bgOpen ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
                    Background events ({backgroundRows.length}) — routine, nothing to fix
                  </button>
                  {bgOpen && (
                    <div className="mt-2">
                      {backgroundRows.map(({ r, accountId }, i) => (
                        <div key={`bg-${r?.ts}-${r?.op}-${i}`}>
                          {accountId !== null ? (
                            <p className="text-[11px] mb-1 inline-flex items-center gap-1" style={{ color: "var(--s2j-text-muted)" }}>
                              <IconUsers size={12} /> {nameFor(accountId)} · {shortId(accountId)}
                            </p>
                          ) : null}
                          <IncidentCard record={r} onFixInSettings={onFixInSettings} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Site-wide aggregate counters (the :agg sidecar — codes and counts only) */}
      {aggregateEntries.length > 0 && (
        <MoodCard density="major" style={{ marginTop: 20 }}>
          <div className="flex items-center justify-between flex-wrap" style={{ gap: 8, marginBottom: 10 }}>
            <p style={{ ...TYPE.label, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              Site-wide signal counters
            </p>
            <span style={{ ...TYPE.micro }}>all-time · never evicted</span>
          </div>
          {aggregateEntries.map(([cls, info], i) => {
            const dot = classTone(cls) === "warn" ? "var(--s2j-orange)" : "var(--s2j-green)";
            return (
              <div
                key={cls}
                className="flex items-center gap-2.5 py-2"
                style={{
                  borderBottom: i < aggregateEntries.length - 1 ? "1px solid var(--s2j-border)" : "none",
                }}
                title={classText(cls).hint}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />
                <span className="text-sm" style={{ color: "var(--s2j-text)", minWidth: 0, flex: 1 }}>
                  {classText(cls).title}
                  <span
                    className="ml-1.5"
                    style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--s2j-text-muted)" }}
                  >
                    {cls}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold" style={{ color: "var(--s2j-text)" }}>
                  {Number(info?.count) || 0}
                </span>
                <span
                  className="shrink-0 text-xs"
                  style={{ color: "var(--s2j-text-muted)", minWidth: 54, textAlign: "right" }}
                >
                  {relTime(info?.lastTs) || ""}
                </span>
              </div>
            );
          })}
        </MoodCard>
      )}

      {/* Export + health check + clear */}
      <div
        className="mt-6 pt-4"
        style={{ borderTop: "1px solid var(--s2j-border)" }}
      >
        <p className="text-xs mb-2" style={{ color: "var(--s2j-text-muted)" }}>
          The report contains operation codes, IDs and counts — no page or
          document content
          {includeDetails ? " + the failure details you chose to include" : ""}.
        </p>
        <label
          className="flex items-center gap-2 text-xs mb-3"
          style={{ color: "var(--s2j-text)", cursor: "pointer" }}
          title="Appends the short stored failure details (verbatim error text, kept up to ~30 days) to THIS copy of the report"
        >
          <input
            type="checkbox"
            checked={includeDetails}
            onChange={(e) => setIncludeDetails(e.target.checked)}
          />
          Include full error details (may quote item names)
        </label>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleCopyReport}
            className="btn-primary"
            title="Copy the diagnostic report to your clipboard (paste it into an email to support@spec2jira.com)"
          >
            {copyState === "copied"
              ? "Copied"
              : copyState === "failed"
                ? "Copy failed — check browser permissions"
                : "Copy full report"}
          </button>
          <button
            type="button"
            onClick={handleHealthCheck}
            disabled={healthRunning}
            className="btn-secondary"
            title="Probe your configuration (API key, Confluence read, Jira project, storage) in one click"
          >
            {healthRunning ? "Running…" : "Run health check"}
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={handleClearDiagnostics}
            disabled={clearing || diagLoading}
            className="text-xs"
            style={{
              color: "var(--s2j-text-muted)",
              background: "none",
              border: "none",
              cursor: clearing ? "default" : "pointer",
              textDecoration: "underline",
              padding: 0,
            }}
            title="Delete your own diagnostic history on this site"
          >
            {clearing
              ? "Clearing…"
              : clearArmed
                ? "Click again to confirm"
                : "Clear diagnostics"}
          </button>
        </div>

        {/* (Health-check probe results now render as RAW PROBES inside the System
            health card above — this footer keeps only the export/health/clear controls.) */}
      </div>
    </div>
  );
}

// ── Project Context profiles editor ─────────────────────────────────────────
// Manage N named contexts (domain/glossary/personas/conventions per project). Each
// row: name + context textarea + "Distill with Claude" (condense a long paste) + live
// counter + remove. The user later picks which profile applies per generation
// (ReadyScreen), so a multi-project workspace never gets the wrong project's context.
// NOTE: `apiKeyConfigured` here means "MAY DISTILL". v6 value-split: both editions are
// BYOK, so distill needs the customer's own key for everyone — the parent passes plain
// `apiKeyConfigured` (the old `|| isManaged` term was removed; there is no managed key now).
function ContextProfilesEditor({ profiles, setProfiles, apiKeyConfigured, onMessage }) {
  const [distillingId, setDistillingId] = useState(null);
  const [distillProgress, setDistillProgress] = useState(null); // { label, current, total } while a 6-step distill runs
  const [distillFailure, setDistillFailure] = useState(null); // { id, sessionId, step, total } when a step errored (enables Retry)
  // [diag Phase 5 (I)] { id, labels } when the FINAL distill step reported categories
  // that came back absent/empty (droppedCategories on the done response) — the §8
  // starvation marker surfaces as a small amber note on that profile's card. Cleared
  // when a new distill/retry starts. ADDITIVE — the success message is unchanged.
  const [distillDropped, setDistillDropped] = useState(null);
  const [expandedId, setExpandedId] = useState(null); // profile open in the focus-mode editor
  // [settings redesign §4.7] display-only: the profile whose LAST distill finished clean
  // (no dropped categories, no failure) -> a green "Distilled" status pill. Set in the
  // done branch, cleared when a new distill/retry starts. No behaviour change.
  const [lastDistilledId, setLastDistilledId] = useState(null);

  // Close the expanded editor on Escape.
  useEffect(() => {
    if (!expandedId) return;
    const onKey = (e) => {
      if (e.key === "Escape") setExpandedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId]);

  const update = (id, patch) =>
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const add = () => {
    if (profiles.length >= MAX_CONTEXT_PROFILES) return;
    const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    setProfiles((prev) => [...prev, { id, name: "", context: "" }]);
  };

  const remove = (id) => setProfiles((prev) => prev.filter((p) => p.id !== id));

  // Distill is a 6-call CHUNKED pipeline (startDistillSession → distillStep ×6, looped
  // here): each call extracts ONE category from the same full input with its own token
  // budget, so no category is starved by another — the fix for the prior single call's
  // depth-first category drops (8/8 vs 5/8 in a 2026-06-02 Haiku bake-off). Each call is
  // small (~3-13s), well under the 25-sec resolver limit. It produces a strong DRAFT; the
  // user reviews + deletes any residual spec-specifics before save (human-in-the-loop, §7).

  // Run distillStep from `fromStep`..total-1 for an existing session. Used by both the
  // initial run (fromStep=0) and a retry (fromStep=the step that failed). On a step error
  // it stores a retry handle (the session survives server-side) and stops.
  async function runDistillSteps(id, sessionId, fromStep, total) {
    for (let step = fromStep; step < total; step++) {
      let result;
      try {
        result = await invoke("distillStep", { sessionId, step });
      } catch (e) {
        setDistillFailure({ id, sessionId, step, total });
        onMessage({ type: "error", text: e?.message || "Summarize step failed" });
        return;
      }
      if (result?.error) {
        const label = result.label || `step ${step + 1}`;
        // Managed-unavailable: prefer the backend detail (it says "switch to BYOK"),
        // NOT the generic NOT_CONFIGURED "paste your key" text — wrong for a Managed
        // user who has no key by design.
        const baseMsg =
          result.error === "managed_unavailable"
            ? result.detail || ERROR_MESSAGES.MANAGED_UNAVAILABLE
            : ERROR_MESSAGES[result.code] ||
              result.detail ||
              `Couldn't summarize ${label}.`;
        setDistillFailure({ id, sessionId, step, total });
        onMessage({
          type: "error",
          text: `${baseMsg} You can retry from where it stopped, or start over.`,
        });
        return;
      }
      // Update the progress line. After a successful non-final step the NEXT category is
      // about to run, so show that; on the final step we're done.
      if (result?.done) {
        update(id, { context: result.profile || "" });
        // [diag Phase 5 (I)] the final step reports categories that were absent/empty
        // at the merge (droppedCategories, additive) — surface the amber note for THIS
        // profile so the gap is visible, not silent.
        if (Array.isArray(result.droppedCategories) && result.droppedCategories.length > 0) {
          setDistillDropped({ id, labels: result.droppedCategories });
          setLastDistilledId(null); // dropped -> amber pill, not the green "Distilled"
        } else {
          setDistillDropped(null);
          setLastDistilledId(id); // clean distill -> green "Distilled" status pill
        }
        const len = (result.profile || "").length;
        onMessage({
          type: "success",
          text: `Condensed to ${len.toLocaleString()} characters${result.overflowTrimmed ? " (the draft ran long and its end was trimmed to fit the size limit — review the earlier sections and trim any single-page detail, then expand the end if needed)" : result.truncated ? " (kept intentionally concise — open the editor to expand if you want more detail)" : ""}. Review the draft and remove anything specific to a single page (exact timings, limits, counts), then click Save Settings — this context is reused for all your pages.`,
        });
      } else {
        setDistillProgress({
          label: result?.nextLabel || result?.label || "",
          current: step + 2, // the next step (1-indexed) that is about to run
          total,
        });
      }
    }
  }

  async function distill(id, text) {
    const t = (text || "").trim();
    if (!t) return;
    if (!apiKeyConfigured) {
      onMessage({
        type: "error",
        text: "Save your Anthropic API key first, then Claude can condense it.",
      });
      return;
    }
    setDistillingId(id);
    setDistillFailure(null);
    setDistillDropped(null); // [diag Phase 5 (I)] a fresh run supersedes the dropped-categories note
    setLastDistilledId(null); // a fresh run supersedes the prior "Distilled" pill
    onMessage(null);
    try {
      let start;
      try {
        start = await invoke("startDistillSession", { text: t });
      } catch (e) {
        onMessage({ type: "error", text: e?.message || "Summarize failed" });
        return;
      }
      if (start?.error || !start?.sessionId) {
        onMessage({
          type: "error",
          text:
            start?.error === "managed_unavailable"
              ? start.detail || ERROR_MESSAGES.MANAGED_UNAVAILABLE
              : ERROR_MESSAGES[start?.code] ||
                start?.detail ||
                "Couldn't start summarizing. Try again.",
        });
        return;
      }
      const total = start.totalSteps || 6;
      const firstLabel = Array.isArray(start.categories) ? start.categories[0] : "";
      setDistillProgress({ label: firstLabel, current: 1, total });
      await runDistillSteps(id, start.sessionId, 0, total);
    } finally {
      setDistillingId(null);
      setDistillProgress(null);
    }
  }

  // Retry a distill that failed mid-pipeline: resume from the failed step with the SAME
  // server-side session (already-completed sections are preserved there).
  async function retryDistill() {
    const f = distillFailure;
    if (!f) return;
    setDistillingId(f.id);
    setDistillFailure(null);
    setDistillDropped(null); // [diag Phase 5 (I)] a retry supersedes the dropped-categories note
    setLastDistilledId(null);
    onMessage(null);
    setDistillProgress({ label: "", current: f.step + 1, total: f.total });
    try {
      await runDistillSteps(f.id, f.sessionId, f.step, f.total);
    } finally {
      setDistillingId(null);
      setDistillProgress(null);
    }
  }

  // Distill button label — shows live "{Category} (k/6)" progress while the 6-step
  // pipeline runs (shared by the inline card + the focus-mode modal so they stay in sync).
  const renderDistillLabel = (busy) => {
    if (!busy) return "Summarize with Claude";
    const p = distillProgress;
    const text =
      p && p.label
        ? `Summarizing… ${p.label} (${p.current}/${p.total})`
        : p
          ? `Summarizing… (${p.current}/${p.total})`
          : "Summarizing…";
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Spinner /> {text}
      </span>
    );
  };

  return (
    <div>
      {profiles.length === 0 && (
        <MoodCard density="utility" style={{ marginBottom: 12 }}>
          <p style={{ ...TYPE.micro }}>
            No project context yet. Add one per project to tailor breakdowns to its domain, glossary and
            conventions — open Expand to paste or edit the text.
          </p>
        </MoodCard>
      )}

      {/* Collapsed-summary rows (§4.7): folder + name + counter + status pill; the textarea +
          Summarize live in the Expand focus-editor. */}
      <div className="space-y-2">
        {profiles.map((p) => {
          const len = (p.context || "").length;
          const over = (p.context || "").trim().length > PROJECT_CONTEXT_MAX_CHARS;
          const busy = distillingId === p.id;
          const failed = distillFailure && distillFailure.id === p.id && distillingId === null;
          const dropped = distillDropped && distillDropped.id === p.id;
          const distilledOk = lastDistilledId === p.id && !dropped && !failed && !busy;
          return (
            <MoodCard key={p.id} density="minor">
              <div className="flex items-center gap-2">
                <span style={{ color: "var(--s2j-text-muted)", flexShrink: 0, display: "inline-flex" }}>
                  <IconFolder size={15} />
                </span>
                <input
                  type="text"
                  value={p.name}
                  onChange={(e) => update(p.id, { name: e.target.value })}
                  placeholder="Context name (e.g. Logistics Platform)"
                  maxLength={CONTEXT_PROFILE_NAME_MAX}
                  disabled={busy}
                  className="flex-1 s2j-field"
                  style={{ ...inputStyle, fontWeight: 600 }}
                />
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  className="text-xs shrink-0"
                  style={{ color: "var(--s2j-red)", background: "none", border: "none", cursor: "pointer", padding: "4px 6px" }}
                  title="Remove this context"
                >
                  Remove
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap" style={{ minWidth: 0 }}>
                  <span className="text-xs" style={{ color: over ? "var(--s2j-red)" : "var(--s2j-text-muted)" }}>
                    {len.toLocaleString()}/{PROJECT_CONTEXT_MAX_CHARS.toLocaleString()}
                  </span>
                  {busy ? (
                    <ContextPill tone="info">
                      {distillProgress
                        ? `Distilling ${distillProgress.current}/${distillProgress.total}${distillProgress.label ? ` · ${distillProgress.label}` : ""}`
                        : "Distilling..."}
                    </ContextPill>
                  ) : failed ? (
                    <>
                      <ContextPill tone="error">
                        Failed at {distillFailure.step + 1}/{distillFailure.total}
                      </ContextPill>
                      <button
                        type="button"
                        onClick={retryDistill}
                        className="text-xs"
                        style={{ color: "var(--s2j-blue)", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 500 }}
                        title="Resume summarizing from the step that failed"
                      >
                        Retry from {distillFailure.step + 1}
                      </button>
                    </>
                  ) : dropped ? (
                    <ContextPill tone="warning">{distillDropped.labels.length} categories dropped</ContextPill>
                  ) : distilledOk ? (
                    <ContextPill tone="success">Distilled</ContextPill>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedId(p.id)}
                  className="text-xs"
                  style={{ color: "var(--s2j-blue)", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 500 }}
                  title="Open the editor to paste, edit or Summarize this context"
                >
                  <IconMaximize size={12} /> Expand
                </button>
              </div>

              {busy && distillProgress && (
                <div className="mt-2" style={{ height: 4, borderRadius: 999, background: "var(--s2j-border)", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.round((distillProgress.current / distillProgress.total) * 100)}%`,
                      background: "var(--s2j-blue)",
                      transition: "width 0.3s",
                    }}
                  />
                </div>
              )}

              {over && (
                <p className="text-xs mt-2" style={{ color: "var(--s2j-text-muted)" }}>
                  Over the {PROJECT_CONTEXT_MAX_CHARS.toLocaleString()}-character limit — pasted a whole
                  page? Open Expand and click <strong>Summarize with Claude</strong> to condense it.
                </p>
              )}
              {/* [diag Phase 5 (I)] Distill category-drop note — the final merge was
                  missing these categories (the §8 starvation marker). ADDITIVE. */}
              {dropped && (
                <SignalCallout kind="warning" style={{ marginTop: 8 }} fontSize={12}>
                  Categories not extracted: {distillDropped.labels.join(", ")} —
                  re-run Summarize with Claude to fill them.
                </SignalCallout>
              )}
            </MoodCard>
          );
        })}
      </div>

      {profiles.length < MAX_CONTEXT_PROFILES && (
        <button
          type="button"
          onClick={add}
          className="text-sm mt-3"
          style={{
            color: "var(--s2j-blue)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            fontWeight: 500,
          }}
        >
          + Add a project context
        </button>
      )}

      {/* Focus-mode editor — a larger, centered surface over a blurred backdrop so a
          long context is easier to read + edit (the post-distill review moment). */}
      {expandedId &&
        (() => {
          const p = profiles.find((x) => x.id === expandedId);
          if (!p) return null;
          const len = (p.context || "").length;
          const over = (p.context || "").trim().length > PROJECT_CONTEXT_MAX_CHARS;
          const busy = distillingId === p.id;
          return (
            <div
              onClick={() => setExpandedId(null)}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 1000,
                background: "rgba(15, 23, 42, 0.55)",
                backdropFilter: "blur(3px)",
                WebkitBackdropFilter: "blur(3px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "24px",
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "var(--s2j-bg)",
                  border: "1px solid var(--s2j-border)",
                  borderRadius: "10px",
                  width: "100%",
                  maxWidth: "820px",
                  maxHeight: "85vh",
                  display: "flex",
                  flexDirection: "column",
                  boxShadow: "0 16px 48px rgba(0,0,0,0.35)",
                  padding: "18px 20px",
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold" style={{ color: MOOD.navy }}>
                    {p.name || "Project context"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setExpandedId(null)}
                    title="Close (Esc)"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--s2j-text-muted)",
                      fontSize: "1.1rem",
                      lineHeight: 1,
                      padding: "2px 6px",
                    }}
                  >
                    <IconX size={18} />
                  </button>
                </div>
                <textarea
                  value={p.context}
                  onChange={(e) => update(p.id, { context: e.target.value })}
                  disabled={busy}
                  autoFocus
                  placeholder={
                    "Domain: B2B logistics platform for freight forwarders.\n" +
                    'Glossary: "shipment" = a booked freight order; "consignee" = the receiving party.\n' +
                    "Personas: Ops Coordinator, Customs Broker, Account Manager.\n" +
                    "Conventions: UK English; refer to services by their internal names."
                  }
                  className="s2j-field"
                  style={{
                    ...inputStyle,
                    flex: 1,
                    minHeight: "55vh",
                    resize: "none",
                    lineHeight: 1.6,
                    opacity: busy ? 0.6 : 1,
                  }}
                  spellCheck={true}
                />
                <div className="flex items-center justify-between gap-3 mt-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => distill(p.id, p.context)}
                      disabled={distillingId !== null || !p.context.trim() || !apiKeyConfigured}
                      className="btn-secondary"
                      style={{
                        fontSize: "0.8rem",
                        opacity:
                          distillingId !== null || !p.context.trim() || !apiKeyConfigured ? 0.5 : 1,
                      }}
                      title={
                        !apiKeyConfigured
                          ? "Save your Anthropic API key first, then Claude can shape this for you"
                          : "Let Claude condense and structure this into a concise project context"
                      }
                    >
                      {renderDistillLabel(busy)}
                    </button>
                    {distillFailure && distillFailure.id === p.id && distillingId === null && (
                      <button
                        type="button"
                        onClick={retryDistill}
                        className="text-xs"
                        style={{
                          color: "var(--s2j-blue)",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                          fontWeight: 500,
                        }}
                        title="Resume summarizing from the step that failed"
                      >
                        Retry from step {distillFailure.step + 1}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className="text-xs"
                      style={{ color: over ? "var(--s2j-red)" : "var(--s2j-text-muted)" }}
                    >
                      {len.toLocaleString()}/{PROJECT_CONTEXT_MAX_CHARS.toLocaleString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedId(null)}
                      className="btn-primary"
                      style={{ fontSize: "0.8rem" }}
                    >
                      Done
                    </button>
                  </div>
                </div>
                {/* [diag Phase 5 (I)] Distill category-drop note — mirrored in the
                    focus-mode editor (a distill run from here must surface it too). */}
                {distillDropped && distillDropped.id === p.id && (
                  <SignalCallout kind="warning" style={{ marginTop: 8 }} fontSize={12}>
                    Categories not extracted: {distillDropped.labels.join(", ")} —
                    re-run Summarize with Claude to fill them.
                  </SignalCallout>
                )}
              </div>
            </div>
          );
        })()}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      style={{ animation: "spin 0.8s linear infinite" }}
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="var(--s2j-border)"
        strokeWidth="2.5"
      />
      <path
        d="M14.5 8a6.5 6.5 0 00-6.5-6.5"
        stroke="var(--s2j-green)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

const inputStyle = {
  width: "100%",
  padding: "8px 12px",
  fontSize: "0.875rem",
  borderRadius: "10px",
  border: "1px solid var(--s2j-border)",
  background: "var(--s2j-bg)",
  color: "var(--s2j-text)",
  outline: "none",
  transition: "border-color 0.15s",
};

// Inline anchor style (blue underline) reused in the led-setup key panel.
const linkStyle = { color: "var(--s2j-blue)", textDecoration: "underline" };

// ── Settings-redesign presentation helpers (impl-spec §4/§5) ──────────────────
// Function declarations (hoisted) so the render above can reference them freely.

// The hero verdict banner content — derives ONLY from the two orthogonal signals; the
// blocked license gate dominates. Nothing else re-derives the verdict (single source).
function heroBanner({ verdict, licenseGate, verifying, health, projectKey }) {
  if (verifying) {
    return { kind: "info", title: "Verifying...", body: "Running the 4 live checks against your own session.", spinner: true };
  }
  if (licenseGate.state === "blocked") {
    return {
      kind: "error",
      title: "Not licensed — generation is blocked",
      body: "No active subscription or trial on this site. Spec2Tickets can't generate for anyone until a plan is active. Your BYOK key still works once licensed.",
    };
  }
  const v = verdict;
  if (v.key === "storage_fault") {
    return {
      kind: "error",
      title: "Can't read your API key",
      body: "Forge returned a storage fault reading the stored secret — this is not the same as 'no key'. Re-enter the key in step 1 and Test.",
    };
  }
  if (v.key === "not_set") {
    return {
      kind: "error",
      title: "API key required — nothing can generate yet",
      body: "Spec2Tickets is BYOK. Connect an Anthropic key to switch generation on for the whole instance.",
    };
  }
  if (v.project === "not_set") {
    return {
      kind: "warning",
      title: "One required step left — set a default project",
      body: "Your key is connected. Add a default Jira project key and you're configured; then verify.",
    };
  }
  if (v.verified === "unavailable") {
    // [A3] the check COULD NOT run (Forge-bridge/resolver error) — this is NOT a counted
    // failure, so it must never read "1 failed".
    return {
      kind: "warning",
      title: "Verification could not run",
      body: "The health check did not complete against your session — Re-verify in a moment.",
    };
  }
  if (v.verified === "failed") {
    const n = health && Array.isArray(health.probes) ? health.probes.filter((p) => p && p.ok === false).length : 1;
    const count = n || 1;
    return {
      kind: "error",
      title: `Verification found ${count} problem${count === 1 ? "" : "s"}`,
      body: "Field-fixable issues link to their field below; the rest show an honest hint.",
    };
  }
  if (v.verified === "verified") {
    return {
      kind: "success",
      title: "Configured and verified",
      body: `Key valid · project ${projectKey || "set"} reachable · Confluence & Jira verified from here · storage OK. Verified from your session — 2 of the 4 checks use your own access, so this is 'verified,' not 'guaranteed for every user.'`,
    };
  }
  return {
    kind: "info",
    title: "Configured — run the check to verify",
    body: "Key and project are set. Run the verification to confirm the four production paths respond before you hand off.",
  };
}

// A single answer tile (also reused for the Diagnostics System-health tiles — tier is optional).
function SettingTile({ tile }) {
  return (
    <div style={{ ...glassSurface("utility"), padding: "9px 10px" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 5, gap: 4 }}>
        <span style={{ ...TYPE.label, fontSize: 9.5, letterSpacing: "0.03em" }}>{tile.label}</span>
        {tile.tier ? <span style={{ fontSize: 9, color: "var(--s2j-text-muted)" }}>{tile.tier}</span> : null}
      </div>
      <div className="flex items-center gap-1.5" style={{ marginBottom: 2, minWidth: 0 }}>
        {tile.status === "neutral" ? <NeutralDot /> : <SignalIcon kind={tileKind(tile.status)} size={15} />}
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--s2j-text)", wordBreak: "break-word", minWidth: 0 }}>
          {tile.value}
        </span>
      </div>
      <div style={{ ...TYPE.micro, fontSize: 10.5 }}>{tile.sub}</div>
    </div>
  );
}

// Neutral status marker — a hollow grey circle so OPTIONALS never read as a coloured gap.
function NeutralDot() {
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", border: "1.5px solid var(--s2j-text-muted)", flexShrink: 0 }}
    />
  );
}

// A verification-detail / raw-probe row. Field-fixable failures deep-link; hints are honest.
// Two deep-link modes: `onFixField` (Settings tab — scroll DOWN to the field) or, when the row lives on the
// Diagnostics tab, `onFixInSettings` (a "Fix in Settings ->" tab-switch, impl-spec §8). onFixInSettings wins
// when both are passed (a Diagnostics ProbeRow never scrolls a field that is on the OTHER tab).
function ProbeRow({ probe, onFixField, onFixInSettings }) {
  const ok = probe?.ok === true;
  const cls = classifyProbe(probe);
  const sev = ok ? "success" : cls.severity === "error" ? "error" : "warning";
  const bg = ok ? "var(--s2j-green-bg)" : sev === "error" ? "var(--s2j-red-bg)" : "var(--s2j-orange-bg)";
  const border = ok ? "var(--s2j-green-border)" : sev === "error" ? "var(--s2j-red-border)" : "var(--s2j-orange-border)";
  const fixable = !ok && cls.fixField;
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "8px 10px", marginBottom: 6 }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2" style={{ minWidth: 0 }}>
          <SignalIcon kind={sev} size={16} style={{ marginTop: 1 }} />
          <div style={{ minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--s2j-text)" }}>{probeLabel(probe?.name)}</span>
            {ok ? (
              <span style={{ fontSize: 12, color: "var(--s2j-text-muted)", marginLeft: 6 }}>ok</span>
            ) : probe?.code ? (
              <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--s2j-text-muted)", marginLeft: 6 }}>({probe.code})</span>
            ) : null}
            {!ok && <p style={{ fontSize: 12, color: "var(--s2j-text)", marginTop: 2, lineHeight: 1.45 }}>{cls.hint}</p>}
          </div>
        </div>
        {fixable && onFixInSettings ? (
          <button
            type="button"
            onClick={() => onFixInSettings(cls.fixField)}
            className="btn-nav shrink-0"
            style={{ fontSize: 12, whiteSpace: "nowrap" }}
          >
            Fix in Settings <IconExternalLink size={12} />
          </button>
        ) : fixable && onFixField ? (
          <button
            type="button"
            onClick={() => onFixField(cls.fixField)}
            className="btn-secondary shrink-0"
            style={{ fontSize: 12, whiteSpace: "nowrap", color: "var(--s2j-blue)" }}
          >
            Fix in {cls.fixField === "apiKey" ? "API key" : "Project key"} ↓
          </button>
        ) : null}
      </div>
    </div>
  );
}

// A pill in the "Your data path" flow.
function PathChip({ children, green }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        color: "var(--s2j-text)",
        background: green ? "var(--s2j-green-bg)" : "var(--s2j-bg-section)",
        border: `1px solid ${green ? "var(--s2j-green-border)" : "var(--s2j-border)"}`,
        borderRadius: 999,
        padding: "3px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
function PathArrow() {
  return <span aria-hidden="true" style={{ color: "var(--s2j-text-muted)", fontSize: 13 }}>→</span>;
}

// Plan / model card (§4.4). Price comes from pricing[] (single source), model from Test/verify.
function PlanModelCard({ account, model, hasTestCases, hasPlanner, advancedPrice }) {
  const price = accountPrice(account);
  const breakdowns = account?.unlimited
    ? "Unlimited"
    : `${account?.used ?? 0}${account?.limit ? ` / ${account.limit}` : ""}`;
  return (
    <MoodCard density="minor" style={{ marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        <PlanCol label="PLAN" value={account?.tierLabel || "—"} sub={price ? `· ${price}` : null} />
        <PlanCol label="BREAKDOWNS" value={breakdowns} />
        <PlanCol label="AI MODEL" value={model || "not tested"} mono />
        <PlanCol label="MEMBER SINCE" value={account?.memberSinceLabel || "—"} />
      </div>
      <p style={{ ...TYPE.micro, marginTop: 10 }}>
        {hasTestCases
          ? "Everything in Standard, plus AI test-case generation and the capacity planner."
          : `Your Standard plan includes unlimited breakdowns on your own Anthropic key.${
              advancedPrice
                ? ` Upgrade to Advanced (${advancedPrice}) for test-case generation.`
                : " Upgrade to Advanced for test-case generation."
            }`}
      </p>
      {hasTestCases && (
        <div className="flex gap-2 flex-wrap" style={{ marginTop: 8 }}>
          <FeatureChip>Test-case generation</FeatureChip>
          {hasPlanner && <FeatureChip>Capacity planner</FeatureChip>}
        </div>
      )}
    </MoodCard>
  );
}
function PlanCol({ label, value, sub, mono }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...TYPE.label, fontSize: 9.5, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--s2j-text)", fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-word" }}>
        {value}
        {sub ? <span style={{ fontWeight: 400, color: "var(--s2j-text-muted)", fontSize: 12, marginLeft: 4 }}>{sub}</span> : null}
      </div>
    </div>
  );
}
function FeatureChip({ children }) {
  return (
    <span
      className="flex items-center gap-1"
      style={{ fontSize: 11.5, color: "var(--s2j-text)", background: "var(--s2j-green-bg)", border: "1px solid var(--s2j-green-border)", borderRadius: 999, padding: "2px 9px" }}
    >
      <SignalIcon kind="success" size={12} /> {children}
    </span>
  );
}

// A led-setup step (numbered/checked node + title + body). Done REQUIRED steps collapse.
function Step({ n, done, title, tag, tag2, optional, children }) {
  return (
    <div className="flex" style={{ gap: 12, marginBottom: 18 }}>
      <div style={{ flexShrink: 0, width: 24, display: "flex", justifyContent: "center", paddingTop: 1 }}>
        <StepNode n={n} done={done} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center flex-wrap" style={{ gap: 8, marginBottom: 6 }}>
          <span style={{ ...TYPE.heading }}>{title}</span>
          {tag ? <StepTag tone={optional ? "opt" : "req"}>{tag}</StepTag> : null}
          {tag2 ? <span style={{ fontSize: 9, color: "var(--s2j-text-muted)" }}>{tag2}</span> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
function StepNode({ n, done }) {
  if (done) return <SignalIcon kind="success" size={22} />;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: "50%",
        border: "1.5px solid var(--s2j-border)",
        color: "var(--s2j-text-muted)",
        fontSize: 12,
        fontWeight: 600,
        background: "var(--s2j-bg)",
      }}
    >
      {n}
    </span>
  );
}
function StepTag({ children, tone }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: tone === "req" ? "var(--s2j-text-light)" : "var(--s2j-text-muted)",
        border: "1px solid var(--s2j-border)",
        borderRadius: 6,
        padding: "1px 6px",
      }}
    >
      {children}
    </span>
  );
}
function StepSummary({ text, onEdit }) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <span style={{ ...TYPE.micro, color: "var(--s2j-text)" }}>{text}</span>
      <button
        type="button"
        onClick={onEdit}
        className="text-xs"
        style={{ color: "var(--s2j-blue)", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 500 }}
      >
        Edit
      </button>
    </div>
  );
}

// Small status pill on a project-context row (§4.7).
function ContextPill({ tone, children }) {
  const map = {
    success: { fg: "var(--s2j-text)", bg: "var(--s2j-green-bg)", border: "var(--s2j-green-border)" },
    warning: { fg: "var(--s2j-text)", bg: "var(--s2j-orange-bg)", border: "var(--s2j-orange-border)" },
    error: { fg: "var(--s2j-text)", bg: "var(--s2j-red-bg)", border: "var(--s2j-red-border)" },
    info: { fg: "var(--s2j-text)", bg: "var(--s2j-blue-bg)", border: "var(--s2j-blue-border)" },
  };
  const c = map[tone] || map.info;
  return (
    <span
      className="flex items-center gap-1"
      style={{ fontSize: 11, color: c.fg, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}
    >
      {tone !== "info" ? <SignalIcon kind={tone} size={11} /> : null}
      {children}
    </span>
  );
}
