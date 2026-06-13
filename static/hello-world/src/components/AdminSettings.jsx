import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@forge/bridge";
import { classText, opLabel, levelColor, relTime } from "../lib/diagnosticsView";

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
  const [contextProfiles, setContextProfiles] = useState([]);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyLastSetAt, setApiKeyLastSetAt] = useState(null);
  const [requiredCustomFieldsJson, setRequiredCustomFieldsJson] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [account, setAccount] = useState(null); // Plan / usage / member-since (getUsage)

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'success'|'error', text }

  useEffect(() => {
    (async () => {
      try {
        const settings = await invoke("getSettings");
        if (settings?.defaultProjectKey)
          setDefaultProjectKey(settings.defaultProjectKey);
        if (Array.isArray(settings?.contextProfiles))
          setContextProfiles(settings.contextProfiles);
        setApiKeyConfigured(!!settings?.apiKeyConfigured);
        setApiKeyLastSetAt(settings?.apiKeyLastSetAt || null);
        if (settings?.requiredCustomFieldsJson) {
          setRequiredCustomFieldsJson(settings.requiredCustomFieldsJson);
          setShowAdvanced(true); // auto-expand ako а value already exists
        }
      } catch (e) {
        setMessage({ type: "error", text: "Failed to load settings" });
      } finally {
        setLoading(false);
      }
      // Account/Plan status (best-effort — the panel just hides on failure).
      try {
        const u = await invoke("getUsage");
        if (u && !u.error) setAccount(u);
      } catch (_) {
        /* non-fatal */
      }
    })();
  }, []);

  function handleApiKeyChange(e) {
    setAnthropicApiKey(e.target.value);
    if (message?.type === "error") setMessage(null);
  }

  async function handleSave() {
    // Validate Anthropic key format ako entered
    const trimmedKey = (anthropicApiKey || "").trim();
    if (trimmedKey && !trimmedKey.startsWith("sk-ant-")) {
      setMessage({
        type: "error",
        text: "Anthropic API key should start with 'sk-ant-'. Verify the value from console.anthropic.com.",
      });
      return;
    }
    if (trimmedKey && trimmedKey.length < 20) {
      setMessage({
        type: "error",
        text: "Anthropic API key appears too short — verify the value.",
      });
      return;
    }

    const cleanProjectKey = (defaultProjectKey || "").trim().toUpperCase();
    if (!cleanProjectKey) {
      setMessage({ type: "error", text: "Jira Project Key is required" });
      return;
    }
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(cleanProjectKey)) {
      setMessage({
        type: "error",
        text: "Jira Project Key must be 2–10 characters, start with a letter, only uppercase letters + digits (e.g., PROJ, SCRUM2).",
      });
      return;
    }

    // Block save ako neither а key nor а pre-configured key exist — UNLESS this is a
    // Managed Pro (Advanced) install, where we run Claude with our key and the
    // customer is not expected to provide one (they're only saving the project key
    // + context here). isManaged is derived from getUsage's edition.
    const isManaged = account?.edition === "advanced";
    if (!isManaged && !trimmedKey && !apiKeyConfigured) {
      setMessage({
        type: "error",
        text: "Please paste your Anthropic API key. Get one from console.anthropic.com → API Keys.",
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
        setMessage({
          type: "error",
          text: 'Required custom fields must be valid JSON, e.g. {"customfield_10042": {"value": "Team A"}}.',
        });
        return;
      }
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
        setMessage({
          type: "error",
          text: "Required custom fields must be a JSON object mapping field IDs to values.",
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
        setMessage({ type: "error", text: result.error });
      } else {
        setMessage({ type: "success", text: "Settings saved" });
        if (result.apiKeyUpdated) {
          setApiKeyConfigured(true);
          setApiKeyLastSetAt(new Date().toISOString());
          setAnthropicApiKey(""); // clear input field so it shows configured state
        }
      }
    } catch (e) {
      setMessage({ type: "error", text: "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  }

  async function handleClearKey() {
    if (
      !confirm(
        "Clear stored Anthropic API key? Spec2Tickets will not be able to generate breakdowns until a new key is provided.",
      )
    ) {
      return;
    }
    setClearing(true);
    setMessage(null);
    try {
      const result = await invoke("clearAnthropicApiKey");
      if (result?.success) {
        setApiKeyConfigured(false);
        setApiKeyLastSetAt(null);
        setAnthropicApiKey("");
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

  async function handleReset() {
    if (
      !confirm(
        "Reset ALL settings (clear API key + project key)? This cannot be undone.",
      )
    ) {
      return;
    }
    try {
      await invoke("resetSettings");
      setAnthropicApiKey("");
      setDefaultProjectKey("");
      setContextProfiles([]);
      setApiKeyConfigured(false);
      setApiKeyLastSetAt(null);
      setRequiredCustomFieldsJson("");
      setShowAdvanced(false);
      setMessage({ type: "success", text: "Settings reset" });
    } catch (e) {
      setMessage({ type: "error", text: "Failed to reset settings" });
    }
  }

  async function handleTest() {
    const trimmedKey = (anthropicApiKey || "").trim();
    if (!trimmedKey && !apiKeyConfigured) {
      setMessage({
        type: "error",
        text: "Paste your Anthropic API key first OR click Save Settings if you've previously stored one.",
      });
      return;
    }

    setTesting(true);
    setMessage(null);
    try {
      // If а new key е typed in the input, test that. Otherwise test stored.
      const payload = trimmedKey ? { anthropicApiKey: trimmedKey } : {};
      const result = await invoke("testConnection", payload);
      if (result?.status === "ok") {
        setMessage({
          type: "success",
          text: result.message || "Connected to Anthropic API",
        });
      } else {
        setMessage({ type: "error", text: getErrorText(result) });
      }
    } catch (e) {
      setMessage({
        type: "error",
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
        <DiagnosticsTab refFilter={diagFilter} onRefFilterChange={setDiagFilter} />
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

  // Managed Pro (Advanced edition) ⇒ WE run Claude with our key, so the customer
  // needs NO Anthropic key. Hide the BYOK key input in that case + show a Managed
  // notice. Only true when getUsage explicitly resolved 'advanced' — if account is
  // null (best-effort load failed/unlicensed) we default to showing the BYOK input
  // (the safe, today's behaviour). Distill also routes through the managed key then.
  const isManaged = account?.edition === "advanced";

  return (
    <div>
      {tabBar}
    <div className="p-8" style={{ maxWidth: "640px" }}>
      <h1
        className="text-xl font-semibold mb-1"
        style={{ color: "var(--s2j-text)" }}
      >
        Spec2Tickets Settings
      </h1>
      <p className="text-sm mb-5" style={{ color: "var(--s2j-text-muted)" }}>
        Configure Spec2Tickets to generate Jira breakdowns from your Confluence pages using Claude AI.
      </p>

      {/* Account / Plan — read-only status for the customer's admin */}
      {account && (
        <div
          className="rounded-lg p-4 mb-6"
          style={{
            background: "var(--s2j-bg-section)",
            border: "1px solid var(--s2j-border)",
          }}
        >
          <p
            className="text-xs font-medium uppercase tracking-wider mb-3"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            Account
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span style={{ color: "var(--s2j-text-muted)" }}>Plan</span>
              <span className="font-medium" style={{ color: "var(--s2j-text)" }}>
                {account.tierLabel || "—"}
                {/* Price for the active PAID edition (from pricing[] — single source).
                    Both BYOK Pro and Managed Pro show their price. */}
                {accountPrice(account) ? (
                  <span
                    className="font-normal ml-1"
                    style={{ color: "var(--s2j-text-muted)" }}
                  >
                    · {accountPrice(account)}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: "var(--s2j-text-muted)" }}>
                Breakdowns this month
              </span>
              <span className="font-medium" style={{ color: "var(--s2j-text)" }}>
                {account.unlimited
                  ? "Unlimited"
                  : `${account.used ?? 0}`}
              </span>
            </div>
            {!account.unlimited && account.resetsAtLabel && (
              <div className="flex items-center justify-between">
                <span style={{ color: "var(--s2j-text-muted)" }}>Resets on</span>
                <span className="font-medium" style={{ color: "var(--s2j-text)" }}>
                  {account.resetsAtLabel}
                </span>
              </div>
            )}
            {account.memberSinceLabel && (
              <div className="flex items-center justify-between">
                <span style={{ color: "var(--s2j-text-muted)" }}>Member since</span>
                <span className="font-medium" style={{ color: "var(--s2j-text)" }}>
                  {account.memberSinceLabel}
                </span>
              </div>
            )}
          </div>
          {/* Tier-aware footnote. Managed Pro: the cap is fair-use, and BYOK Pro is
              the unlimited option. BYOK Pro (unlimited): nothing to add. */}
          {account.tier === "managedPro" && (
            <p className="text-xs mt-3" style={{ color: "var(--s2j-text-muted)" }}>
              Managed Pro runs Claude for you (no API key needed). Your plan includes a monthly
              breakdown allowance{account.resetsAtLabel ? ` that resets on ${account.resetsAtLabel}` : ""}.{" "}
              {accountPriceFor(account, "byokPro")
                ? `For unlimited breakdowns, switch to BYOK Pro (${accountPriceFor(account, "byokPro")}) and use your own Anthropic key.`
                : "For unlimited breakdowns, switch to BYOK Pro and use your own Anthropic key."}
            </p>
          )}
        </div>
      )}

      {/* Info callout — edition-aware. Managed Pro: we run Claude (no key needed).
          Otherwise (BYOK Pro): the BYOK explainer + the two ways to use the app, so
          an admin choosing how to run it understands both paths. */}
      {isManaged ? (
        <div
          className="rounded-lg p-4 mb-6 text-sm"
          style={{
            background: "var(--s2j-green-bg)",
            border: "1px solid var(--s2j-green-border)",
            color: "var(--s2j-text)",
          }}
        >
          <p className="mb-2">
            <strong>Managed Pro — we run Claude for you.</strong> Your{" "}
            {accountPriceFor(account, "managedPro") || "Managed Pro"} subscription
            runs every breakdown on our Anthropic key, so there is{" "}
            <strong>no API key to configure</strong>. Just set your default Jira
            project below and you're ready to generate.
          </p>
          <p>
            Your plan includes a generous monthly breakdown allowance. Want unlimited breakdowns and
            to use your own Anthropic agreement? Switch to BYOK Pro
            {accountPriceFor(account, "byokPro")
              ? ` (${accountPriceFor(account, "byokPro")})`
              : ""}{" "}
            and paste your own key here.
          </p>
        </div>
      ) : (
        <div
          className="rounded-lg p-4 mb-6 text-sm"
          style={{
            background: "var(--s2j-blue-bg)",
            border: "1px solid var(--s2j-blue-border)",
            color: "var(--s2j-text)",
          }}
        >
          <p className="mb-2">
            <strong>Powered by Claude:</strong> Spec2Tickets uses Anthropic's Claude
            Sonnet 4.6 to analyze your Confluence pages. There are two ways to run it:
          </p>
          <ul className="mb-2" style={{ marginLeft: "16px", listStyle: "disc" }}>
            <li className="mb-1">
              <strong>Bring your own key (BYOK)</strong> — paste your Anthropic API
              key below. BYOK Pro
              {accountPriceFor(account, "byokPro")
                ? ` (${accountPriceFor(account, "byokPro")})`
                : ""}{" "}
              gives unlimited breakdowns. Breakdowns run on your own Anthropic
              account, never on Spec2Tickets servers.
            </li>
            <li>
              <strong>Managed</strong> — no key needed; we run Claude for you.
              Subscribe to Managed Pro
              {accountPriceFor(account, "managedPro")
                ? ` (${accountPriceFor(account, "managedPro")})`
                : ""}{" "}
              (the Advanced edition) from your Atlassian site admin.
            </li>
          </ul>
          <p className="mb-2">
            <strong>Get an API key:</strong>{" "}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--s2j-blue)", textDecoration: "underline" }}
            >
              console.anthropic.com → Settings → API Keys
            </a>{" "}
            (sign up free; billed pay-as-you-go to your own Anthropic account).
          </p>
          <p>
            <strong>Privacy:</strong> Under BYOK, your page content flows directly
            from Forge to the Anthropic API using your key. Data falls under{" "}
            <a
              href="https://www.anthropic.com/legal/aup"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--s2j-blue)", textDecoration: "underline" }}
            >
              Anthropic's Usage Policy
            </a>
            {" "}+ your own data processing agreement with Anthropic.
          </p>
        </div>
      )}

      {/* Form */}
      <div className="space-y-5">
        {/* BYOK key input — shown for BYOK Pro. HIDDEN for Managed Pro (we run Claude
            with our key; the customer has no key to enter). A Managed admin still
            configures the JIRA project below. */}
        {isManaged ? (
          <div
            className="rounded-lg p-3 text-sm"
            style={{
              background: "var(--s2j-bg-section)",
              border: "1px solid var(--s2j-border)",
              color: "var(--s2j-text-muted)",
            }}
          >
            <p style={{ color: "var(--s2j-text)" }} className="font-medium mb-1">
              No Anthropic API key needed
            </p>
            <p>
              On Managed Pro we run Claude for you, so there is no key to configure.
              To use your own key (and unlimited breakdowns) instead, switch to BYOK
              Pro and this field will appear.
            </p>
          </div>
        ) : (
          <Field
            label="Anthropic API Key"
            description={
              apiKeyConfigured
                ? `API key configured${apiKeyLastSetAt ? ` (last set ${new Date(apiKeyLastSetAt).toLocaleDateString()})` : ""}. Paste a new value to replace, or leave blank to keep current.`
                : "Paste your Anthropic API key (sk-ant-...). Stored encrypted in Atlassian Forge storage, never visible to the UI after save."
            }
            required={!apiKeyConfigured}
          >
            <div className="flex gap-2">
              <input
                type="password"
                value={anthropicApiKey}
                onChange={handleApiKeyChange}
                placeholder={apiKeyConfigured ? "•••••••• (configured)" : "sk-ant-api03-..."}
                className="flex-1"
                style={inputStyle}
                autoComplete="off"
              />
              <button
                onClick={handleTest}
                disabled={testing || (!anthropicApiKey && !apiKeyConfigured)}
                className="btn-secondary shrink-0"
                style={{
                  opacity:
                    testing || (!anthropicApiKey && !apiKeyConfigured)
                      ? 0.5
                      : 1,
                }}
              >
                {testing ? "Testing..." : "Test Connection"}
              </button>
            </div>
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
                {clearing ? "Clearing..." : "Clear stored API key"}
              </button>
            )}
          </Field>
        )}

        <Field
          label="Default Jira Project Key"
          description="2–10 uppercase letters/digits, starting with a letter. Used as the default destination when pushing breakdowns to Jira."
          required
        >
          <input
            type="text"
            value={defaultProjectKey}
            onChange={(e) => setDefaultProjectKey(e.target.value.toUpperCase())}
            placeholder="PROJ"
            style={{
              ...inputStyle,
              maxWidth: "160px",
              fontFamily: "monospace",
            }}
            maxLength={10}
          />
        </Field>

        {/* Project Context profiles — pick the right one at generation time (a
            workspace may span multiple projects, so a single global context would
            misapply across them). Each profile enriches terminology/interpretation;
            it never changes scope or rewrites the spec's acceptance criteria. */}
        <ContextProfilesEditor
          profiles={contextProfiles}
          setProfiles={setContextProfiles}
          apiKeyConfigured={apiKeyConfigured || isManaged}
          onMessage={setMessage}
        />

        {/* Advanced — optional required custom fields */}
        <div style={{ borderTop: "1px solid var(--s2j-border)", paddingTop: "16px" }}>
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-sm font-medium flex items-center gap-1.5"
            style={{
              color: "var(--s2j-text-muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            <span style={{ display: "inline-block", transform: showAdvanced ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
            Advanced — Required custom fields (optional)
          </button>

          {showAdvanced && (
            <div className="mt-3">
              <Field
                label="Required custom fields"
                description="OPTIONAL — only needed if your Jira project requires custom fields on issue creation (e.g., a mandatory 'Team', 'Story Points', or 'Sprint' field). Without them, push fails with 'field is required'. Enter a JSON object mapping each field's ID to its value. Leave blank if your project doesn't require any."
              >
                <textarea
                  value={requiredCustomFieldsJson}
                  onChange={(e) => {
                    setRequiredCustomFieldsJson(e.target.value);
                    if (message?.type === "error") setMessage(null);
                  }}
                  placeholder={'{\n  "customfield_10042": { "value": "Platform" },\n  "customfield_10016": 3\n}'}
                  rows={6}
                  style={{
                    ...inputStyle,
                    fontFamily: "monospace",
                    fontSize: "0.8rem",
                    resize: "vertical",
                  }}
                  spellCheck={false}
                />
              </Field>
              <div
                className="rounded-lg p-3 mt-2 text-xs"
                style={{
                  background: "var(--s2j-blue-bg)",
                  border: "1px solid var(--s2j-blue-border)",
                  color: "var(--s2j-text)",
                }}
              >
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
              </div>
            </div>
          )}
        </div>
      </div>

      {message && (
        <div
          role="alert"
          aria-live="polite"
          className="mt-4 rounded-lg p-3 text-sm"
          style={{
            background:
              message.type === "success"
                ? "var(--s2j-green-bg)"
                : "var(--s2j-red-bg)",
            border: `1px solid ${
              message.type === "success"
                ? "var(--s2j-green-border)"
                : "var(--s2j-red-border)"
            }`,
            color: "var(--s2j-text)",
          }}
        >
          {message.text}
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? "Saving..." : "Save Settings"}
        </button>
        <span className="text-xs" style={{ color: "var(--s2j-text-muted)" }}>
          Settings apply to all users in this Confluence instance
        </span>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={handleReset}
          disabled={saving}
          className="btn-secondary"
        >
          Reset All Settings
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

// One ledger row: colored left border by level; line 1 = humanized title +
// relative time; line 2 = mono op · class · ref (+ ×N occurrences); line 3 =
// counts chips + durable Jira issue keys. The class hint is the row tooltip.
function DiagnosticRow({ record }) {
  const text = classText(record?.error_class);
  const colors = levelColor(record?.level);
  const occCount =
    record?.occurrences && Number(record.occurrences.count) > 1
      ? Number(record.occurrences.count)
      : null;
  const counts =
    record?.counts && typeof record.counts === "object" && !Array.isArray(record.counts)
      ? Object.entries(record.counts)
      : [];
  const issueKeys = Array.isArray(record?.subject_keys) ? record.subject_keys : [];
  const titleColor =
    record?.level === "error"
      ? "var(--s2j-red)" // red ONLY for error-level rows (design §5)
      : record?.level === "info"
        ? "var(--s2j-text-muted)"
        : "var(--s2j-text)";
  return (
    <div
      className="px-3 py-2 mb-2 rounded-md"
      style={{
        background: "var(--s2j-bg)",
        border: "1px solid var(--s2j-border)",
        borderLeft: `3px solid ${colors.border}`,
      }}
      title={text.hint}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium" style={{ color: titleColor }}>
          {text.title}
        </span>
        <span
          className="text-[11px] shrink-0"
          style={{ color: "var(--s2j-text-muted)" }}
        >
          {/* [seams-audit LOW] display the SAME recency the sort uses — a merged row
              that recurred 5 min ago used to sort first yet read "3d ago". */}
          {relTime(record?.occurrences?.lastTs || record?.ts)}
        </span>
      </div>
      <div
        className="text-[11px] mt-0.5"
        style={{ fontFamily: "monospace", color: "var(--s2j-text-muted)", wordBreak: "break-all" }}
      >
        {opLabel(record?.op)} · {record?.error_class}
        {record?.ref ? ` · ${record.ref}` : ""}
        {/* the aborted-push classes correlate ONLY by session_ref (ref may be null) */}
        {!record?.ref && record?.session_ref ? ` · session:${record.session_ref}` : ""}
        {occCount ? ` · ×${occCount}` : ""}
      </div>
      {(counts.length > 0 || issueKeys.length > 0) && (
        <div className="flex flex-wrap gap-1 mt-1">
          {counts.map(([k, v]) => (
            <span
              key={k}
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{
                background: "var(--s2j-bg-section)",
                border: "1px solid var(--s2j-border)",
                color: "var(--s2j-text-light)",
              }}
            >
              {k}: {String(v)}
            </span>
          ))}
          {issueKeys.map((k) => (
            <span
              key={k}
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{
                background: "var(--s2j-bg-section)",
                border: "1px solid var(--s2j-border)",
                color: "var(--s2j-text-light)",
                fontFamily: "monospace",
              }}
            >
              {k}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function DiagnosticsTab({ refFilter = "", onRefFilterChange }) {
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
  // [deep-audit P2] match session_ref too — the aborted-push classes correlate by
  // it (their ref may be null); ref-only made them unfindable by search.
  const matchesFilter = (r) =>
    !filterText ||
    String(r?.ref || "").toLowerCase().includes(filterText) ||
    String(r?.session_ref || "").toLowerCase().includes(filterText);
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
  const shownCount = groups.reduce((n, g) => n + g.records.length, 0);

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

  return (
    <div className="p-8" style={{ maxWidth: "640px" }}>
      <h1
        className="text-xl font-semibold mb-1"
        style={{ color: "var(--s2j-text)" }}
      >
        Diagnostics
      </h1>
      <p className="text-sm mb-5" style={{ color: "var(--s2j-text-muted)" }}>
        Shows your Spec2Tickets activity on this site
      </p>

      {/* Toolbar — ref filter + (admin-only) site-wide scope toggle */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <input
          type="text"
          value={refFilter}
          onChange={(e) => onRefFilterChange && onRefFilterChange(e.target.value)}
          placeholder="Filter by diagnostic ref…"
          style={{
            ...inputStyle,
            maxWidth: "280px",
            fontFamily: "monospace",
            fontSize: "0.8rem",
          }}
          spellCheck={false}
        />
        {/* Enterprise admin view — rendered ONLY when the backend confirmed Jira
            ADMINISTER (isAdmin). The backend re-gates every 'all' request server-side. */}
        {data?.isAdmin === true && (
          <label
            className="flex items-center gap-2 text-xs"
            style={{ color: "var(--s2j-text)", cursor: "pointer" }}
            title="Show every user's diagnostics on this site (admins only) — search by the ref the affected user gives you"
          >
            <input
              type="checkbox"
              checked={scope === "all"}
              disabled={diagLoading}
              onChange={(e) => toggleScope(e.target.checked ? "all" : "mine")}
            />
            All users on this site
          </label>
        )}
      </div>

      {/* The list — loading / error / records / empty. Never a blank surface. */}
      {diagLoading ? (
        <div
          className="flex items-center gap-2 py-6"
          style={{ color: "var(--s2j-text-muted)" }}
        >
          <Spinner /> <span className="text-sm">Loading diagnostics…</span>
        </div>
      ) : loadFailed ? (
        <div
          className="rounded-md p-3 text-sm flex items-center justify-between gap-3 flex-wrap"
          style={{
            background: "var(--s2j-bg-section)",
            border: "1px solid var(--s2j-border)",
            color: "var(--s2j-text)",
          }}
        >
          <span>Couldn't load diagnostics — try again.</span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => load(scope)}
          >
            Retry
          </button>
        </div>
      ) : totalUnfiltered === 0 ? (
        <p
          className="text-sm rounded-md p-3"
          style={{
            background: "var(--s2j-bg-section)",
            border: "1px solid var(--s2j-border)",
            color: "var(--s2j-text-muted)",
          }}
        >
          No problems recorded.
        </p>
      ) : shownCount === 0 ? (
        <p className="text-sm py-2" style={{ color: "var(--s2j-text-muted)" }}>
          No records match this ref filter.
        </p>
      ) : (
        <div>
          {groups.map((g) => (
            <div key={g.accountId === null ? "mine" : g.accountId}>
              {/* Muted per-user group header — 'all' (admin) scope only */}
              {g.accountId !== null && (
                <p
                  className="text-[11px] mt-3 mb-1"
                  style={{
                    fontFamily: "monospace",
                    color: "var(--s2j-text-muted)",
                    wordBreak: "break-all",
                  }}
                >
                  User {g.accountId}
                </p>
              )}
              {g.records.map((r, i) => (
                // (ts, op) is the record's DISPLAY identity (design §1)
                <DiagnosticRow key={`${r?.ts}-${r?.op}-${i}`} record={r} />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Site-wide aggregate counters (the :agg sidecar — codes and counts only) */}
      {aggregateEntries.length > 0 && (
        <div className="mt-5">
          <p
            className="text-xs font-medium uppercase tracking-wider mb-2"
            style={{ color: "var(--s2j-text-muted)" }}
          >
            Site-wide signal counters
          </p>
          <div
            className="rounded-md"
            style={{ border: "1px solid var(--s2j-border)" }}
          >
            {aggregateEntries.map(([cls, info], i) => (
              <div
                key={cls}
                className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
                style={{
                  borderBottom:
                    i < aggregateEntries.length - 1
                      ? "1px solid var(--s2j-border)"
                      : "none",
                }}
                title={classText(cls).hint}
              >
                <span style={{ color: "var(--s2j-text)", minWidth: 0 }}>
                  {classText(cls).title}
                  <span
                    className="ml-1"
                    style={{ fontFamily: "monospace", color: "var(--s2j-text-muted)" }}
                  >
                    ({cls})
                  </span>
                </span>
                <span
                  className="shrink-0"
                  style={{ color: "var(--s2j-text-light)" }}
                >
                  {Number(info?.count) || 0}
                  {relTime(info?.lastTs) ? ` · ${relTime(info?.lastTs)}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
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
              ? "✓ Copied"
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
                ? "⚠ Click again to confirm"
                : "Clear diagnostics"}
          </button>
        </div>

        {/* Health-check probe results — ✓/✗ + code + a humanized hint for failures */}
        {healthResult && (
          <div
            className="rounded-md p-3 mt-3"
            style={{
              background: "var(--s2j-bg-section)",
              border: "1px solid var(--s2j-border)",
            }}
          >
            {healthResult.failed ? (
              <p className="text-xs" style={{ color: "var(--s2j-text-muted)" }}>
                The health check could not run — try again.
              </p>
            ) : (
              <div>
                <p
                  className="text-xs font-medium mb-1"
                  style={{
                    color: healthResult.ok
                      ? "var(--s2j-green-dark)"
                      : "var(--s2j-text)",
                  }}
                >
                  {healthResult.ok
                    ? "All checks passed"
                    : "Some checks failed"}
                </p>
                {(healthResult.probes || []).map((p, i) => (
                  <div
                    key={`${p?.name || "probe"}-${i}`}
                    className="flex items-start gap-2 text-xs py-0.5"
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        color: p?.ok ? "var(--s2j-green-dark)" : "var(--s2j-red)",
                      }}
                    >
                      {p?.ok ? "✓" : "✗"}
                    </span>
                    <span style={{ color: "var(--s2j-text)", minWidth: 0 }}>
                      {p?.name || "probe"}
                      {p?.code ? (
                        <span
                          className="ml-1"
                          style={{
                            fontFamily: "monospace",
                            color: "var(--s2j-text-muted)",
                          }}
                        >
                          ({p.code})
                        </span>
                      ) : null}
                      {!p?.ok && p?.code ? (
                        <span
                          className="block"
                          style={{ color: "var(--s2j-text-light)" }}
                        >
                          {classText(p.code).title}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Project Context profiles editor ─────────────────────────────────────────
// Manage N named contexts (domain/glossary/personas/conventions per project). Each
// row: name + context textarea + "Distill with Claude" (condense a long paste) + live
// counter + remove. The user later picks which profile applies per generation
// (ReadyScreen), so a multi-project workspace never gets the wrong project's context.
// NOTE: `apiKeyConfigured` here is overloaded to mean "MAY DISTILL" — the parent
// passes `apiKeyConfigured || isManaged`, because a Managed install has no BYOK key
// but CAN distill (the backend calls Claude with our key). Every distill gate below
// honours that. (§13 review fix — a future cleanup may rename the prop to canDistill.)
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
        } else {
          setDistillDropped(null);
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
        text: "Add your project context text first, then Claude can condense it.",
      });
      return;
    }
    setDistillingId(id);
    setDistillFailure(null);
    setDistillDropped(null); // [diag Phase 5 (I)] a fresh run supersedes the dropped-categories note
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
    if (!busy) return "✨ Summarize with Claude";
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
      <label
        className="text-sm font-medium block mb-1"
        style={{ color: "var(--s2j-text)" }}
      >
        Project context (optional)
      </label>
      <p className="text-xs mb-3" style={{ color: "var(--s2j-text-muted)" }}>
        Standing background that helps Claude understand a project's pages the way your
        team does — domain, glossary, personas, systems, tech, naming conventions. You
        pick which context applies each time you generate, so pages from different
        projects get the right background. It enriches terminology and interpretation — it
        never changes what gets built or rewrites your page's acceptance criteria.
        Because one context is reused across ALL of a project's pages, keep only durable
        facts — leave out anything true of a single page (specific timings, limits,
        counts, or scope). A concise brief condenses more cleanly than a full document.
      </p>

      {profiles.length === 0 && (
        <p
          className="text-xs mb-3 rounded-md p-3"
          style={{
            background: "var(--s2j-bg-section)",
            border: "1px solid var(--s2j-border)",
            color: "var(--s2j-text-muted)",
          }}
        >
          No project context yet. Add one per project to tailor breakdowns to its domain,
          glossary, and conventions.
        </p>
      )}

      <div className="space-y-4">
        {profiles.map((p) => {
          const len = (p.context || "").length;
          const over = (p.context || "").trim().length > PROJECT_CONTEXT_MAX_CHARS;
          const busy = distillingId === p.id;
          return (
            <div
              key={p.id}
              className="rounded-lg p-3"
              style={{ border: "1px solid var(--s2j-border)", background: "var(--s2j-bg)" }}
            >
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={p.name}
                  onChange={(e) => update(p.id, { name: e.target.value })}
                  placeholder="Context name (e.g. Logistics Platform)"
                  maxLength={CONTEXT_PROFILE_NAME_MAX}
                  disabled={busy}
                  style={{ ...inputStyle, fontWeight: 600 }}
                />
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  className="text-xs shrink-0"
                  style={{
                    color: "var(--s2j-red)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px 6px",
                  }}
                  title="Remove this context"
                >
                  Remove
                </button>
              </div>
              <textarea
                value={p.context}
                onChange={(e) => update(p.id, { context: e.target.value })}
                placeholder={
                  "Domain: B2B logistics platform for freight forwarders.\n" +
                  'Glossary: "shipment" = a booked freight order; "consignee" = the receiving party.\n' +
                  "Personas: Ops Coordinator, Customs Broker, Account Manager.\n" +
                  "Conventions: UK English; refer to services by their internal names."
                }
                rows={6}
                disabled={busy}
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5, opacity: busy ? 0.6 : 1 }}
                spellCheck={true}
              />
              <div className="flex items-center justify-between gap-3 mt-2">
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
                        ? "Add your project context text first, then Claude can condense it"
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
                  <button
                    type="button"
                    onClick={() => setExpandedId(p.id)}
                    className="text-xs"
                    style={{
                      color: "var(--s2j-text-muted)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                    }}
                    title="Open a larger editor"
                  >
                    ⤢ Expand
                  </button>
                  <span
                    className="text-xs"
                    style={{ color: over ? "var(--s2j-red)" : "var(--s2j-text-muted)" }}
                  >
                    {len.toLocaleString()}/{PROJECT_CONTEXT_MAX_CHARS.toLocaleString()}
                  </span>
                </div>
              </div>
              {over && (
                <p className="text-xs mt-2" style={{ color: "var(--s2j-text-muted)" }}>
                  Over the {PROJECT_CONTEXT_MAX_CHARS.toLocaleString()}-character limit —
                  pasted a whole page? Click <strong>Summarize with Claude</strong> to
                  condense it (you can edit the result before saving).
                </p>
              )}
              {/* [diag Phase 5 (I)] Distill category-drop note — the final merge was
                  missing these categories (the §8 starvation marker). ADDITIVE. */}
              {distillDropped && distillDropped.id === p.id && (
                <p
                  className="text-xs mt-2 rounded-md p-2"
                  style={{
                    background: "var(--s2j-orange-bg)",
                    border: "1px solid var(--s2j-orange-border)",
                    color: "var(--s2j-text)",
                  }}
                >
                  Categories not extracted: {distillDropped.labels.join(", ")} —
                  re-run Summarize with Claude to fill them.
                </p>
              )}
            </div>
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
                  <span className="text-sm font-semibold" style={{ color: "var(--s2j-text)" }}>
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
                    ✕
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
                  <p
                    className="text-xs mt-2 rounded-md p-2"
                    style={{
                      background: "var(--s2j-orange-bg)",
                      border: "1px solid var(--s2j-orange-border)",
                      color: "var(--s2j-text)",
                    }}
                  >
                    Categories not extracted: {distillDropped.labels.join(", ")} —
                    re-run Summarize with Claude to fill them.
                  </p>
                )}
              </div>
            </div>
          );
        })()}
    </div>
  );
}

function Field({ label, description, required, children }) {
  return (
    <div>
      <label
        className="text-sm font-medium block mb-1"
        style={{ color: "var(--s2j-text)" }}
      >
        {label}
        {required && <span style={{ color: "var(--s2j-red)" }}> *</span>}
      </label>
      {description && (
        <p className="text-xs mb-2" style={{ color: "var(--s2j-text-muted)" }}>
          {description}
        </p>
      )}
      {children}
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
  borderRadius: "6px",
  border: "1px solid var(--s2j-border)",
  background: "var(--s2j-bg)",
  color: "var(--s2j-text)",
  outline: "none",
  transition: "border-color 0.15s",
};
