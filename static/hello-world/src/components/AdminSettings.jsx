import { useState, useEffect } from "react";
import { invoke } from "@forge/bridge";

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
};

function getErrorText(result) {
  const mapped = ERROR_MESSAGES[result?.code];
  if (mapped) return mapped;
  return result?.detail || "Connection test failed";
}

export default function AdminSettings() {
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [defaultProjectKey, setDefaultProjectKey] = useState("");
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
      setMessage({ type: "error", text: "JIRA Project Key is required" });
      return;
    }
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(cleanProjectKey)) {
      setMessage({
        type: "error",
        text: "JIRA Project Key must be 2–10 characters, start with a letter, only uppercase letters + digits (e.g., PROJ, SCRUM2).",
      });
      return;
    }

    // Block save ako neither а key nor а pre-configured key exist
    if (!trimmedKey && !apiKeyConfigured) {
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

  if (loading) {
    return (
      <div
        className="p-8 flex items-center gap-2"
        style={{ color: "var(--s2j-text-muted)" }}
      >
        <Spinner /> Loading settings...
      </div>
    );
  }

  return (
    <div className="p-8" style={{ maxWidth: "640px" }}>
      <h1
        className="text-xl font-semibold mb-1"
        style={{ color: "var(--s2j-text)" }}
      >
        Spec2Tickets Settings
      </h1>
      <p className="text-sm mb-5" style={{ color: "var(--s2j-text-muted)" }}>
        Configure Spec2Tickets to generate JIRA breakdowns from your Confluence specifications using Claude AI.
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
                {account.tierLabel || "Free"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: "var(--s2j-text-muted)" }}>
                Breakdowns this month
              </span>
              <span className="font-medium" style={{ color: "var(--s2j-text)" }}>
                {account.unlimited
                  ? "Unlimited"
                  : `${account.used ?? 0} / ${account.limit ?? 3}`}
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
          {account.tier !== "pro" && (
            <p className="text-xs mt-3" style={{ color: "var(--s2j-text-muted)" }}>
              Free includes 3 breakdowns per month. Upgrade to Pro for unlimited breakdowns.
            </p>
          )}
        </div>
      )}

      {/* v3.0.0 BYOK info callout */}
      <div
        className="rounded-lg p-4 mb-6 text-sm"
        style={{
          background: "var(--s2j-blue-bg)",
          border: "1px solid var(--s2j-blue-border)",
          color: "var(--s2j-text)",
        }}
      >
        <p className="mb-2">
          <strong>Powered by Claude:</strong> Spec2Tickets uses Anthropic's Claude Sonnet 4.6 to analyze your specs. You provide your own Anthropic API key (BYOK); breakdowns run on Anthropic's infrastructure, never on Spec2Tickets servers.
        </p>
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
          <strong>Privacy:</strong> Your spec content flows directly from Forge to the Anthropic API using your key. Data falls under{" "}
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

      {/* Form */}
      <div className="space-y-5">
        <Field
          label="Anthropic API Key"
          description={
            apiKeyConfigured
              ? `API key configured${apiKeyLastSetAt ? ` (last set ${new Date(apiKeyLastSetAt).toLocaleDateString()})` : ""}. Paste a new value to replace, or leave blank to keep current.`
              : "Paste your Anthropic API key (sk-ant-...). Stored encrypted in Forge KVS, never visible to the UI after save."
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

        <Field
          label="Default JIRA Project Key"
          description="2–10 uppercase letters/digits, starting with a letter. Used as the default destination when pushing breakdowns to JIRA."
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
                description="OPTIONAL — only needed if your JIRA project requires custom fields on issue creation (e.g., a mandatory 'Team', 'Story Points', or 'Sprint' field). Without them, push fails with 'field is required'. Enter a JSON object mapping each field's ID to its value. Leave blank if your project doesn't require any."
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
                  <strong>How to find a field ID:</strong> in JIRA go to Settings → Issues → Custom fields, click the field → the URL contains <code>customfield_XXXXX</code>. The <em>value shape</em> depends on the field type:
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
