import { useState, useEffect } from "react";
import { invoke } from "@forge/bridge";

/**
 * AdminSettings — Configuration page for Spec2Tickets.
 * Accessible from Confluence Admin → Apps → Spec2Tickets Settings.
 * Stores config in Forge Storage (per installation).
 *
 * Error UX contract (testConnection resolver):
 *   success → { status: "ok", message: "..." }
 *   error   → { status: "error", code: <ErrorCode>, detail: "<raw>" }
 *
 * ErrorCode ∈ {FORGE_FETCH_BLOCKED, BACKEND_UNREACHABLE,
 *              BACKEND_AUTH_FAILED, BACKEND_NOT_HEALTHY, UNEXPECTED}
 */

// ── Error code → customer-facing message ────────────────────
// Keep these strings in sync with the resolver's emitted codes.
// If a new code is introduced in the resolver, add a row here;
// missing codes fall back to raw `detail` (see getErrorText).

const ERROR_MESSAGES = {
  FORGE_FETCH_BLOCKED:
    "Connection blocked. Your backend domain may not be whitelisted yet — " +
    "email support@spec2jira.com with your backend domain and Atlassian site URL. " +
    "We respond within one business day.",
  BACKEND_UNREACHABLE:
    "Backend unreachable. Check that your backend is running " +
    "(curl https://your-domain/health) and that DNS resolves to the correct server.",
  BACKEND_AUTH_FAILED:
    "Backend rejected the request as unauthorized. " +
    "Check your Backend API Key below, then test again.",
  BACKEND_NOT_HEALTHY:
    "Backend reachable but returned an unhealthy response. " +
    "Check your backend logs for errors.",
};

function getErrorText(result) {
  const mapped = ERROR_MESSAGES[result?.code];
  if (mapped) return mapped;
  return result?.detail || "Connection test failed";
}

export default function AdminSettings() {
  const [backendUrl, setBackendUrl] = useState("");
  const [backendApiKey, setBackendApiKey] = useState("");
  const [defaultProjectKey, setDefaultProjectKey] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'success'|'error', text }

  // Load existing settings
  useEffect(() => {
    (async () => {
      try {
        const settings = await invoke("getSettings");
        if (settings?.backendUrl) setBackendUrl(settings.backendUrl);
        if (settings?.backendApiKey) setBackendApiKey(settings.backendApiKey);
        if (settings?.defaultProjectKey)
          setDefaultProjectKey(settings.defaultProjectKey);
      } catch (e) {
        setMessage({ type: "error", text: "Failed to load settings" });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Clear stale error when user edits the URL after a failed test.
  // Prevents the "I fixed the URL but it still says blocked" confusion.
  function handleBackendUrlChange(e) {
    setBackendUrl(e.target.value);
    if (message?.type === "error") setMessage(null);
  }

  // Save settings
  async function handleSave() {
    if (!backendUrl) {
      setMessage({ type: "error", text: "Backend URL is required" });
      return;
    }

    // API key validation — must be present, reasonable length.
    // Backend rejects shorter tokens; surfacing validation client-side
    // prevents a round-trip and gives immediate feedback.
    const trimmedApiKey = (backendApiKey || "").trim();
    if (!trimmedApiKey) {
      setMessage({ type: "error", text: "Backend API Key is required" });
      return;
    }
    if (trimmedApiKey.length < 16) {
      setMessage({
        type: "error",
        text: "Backend API Key must be at least 16 characters. Generate a stronger token with `openssl rand -base64 32`.",
      });
      return;
    }
    if (trimmedApiKey.length > 256) {
      setMessage({
        type: "error",
        text: "Backend API Key is unexpectedly long (>256 chars). Check that you pasted a token, not a file or certificate.",
      });
      return;
    }

    // Normalize projectKey: trim whitespace, uppercase (defensive — onChange
    // already uppercases, but paste operations can bypass that briefly).
    const cleanProjectKey = (defaultProjectKey || "").trim().toUpperCase();

    if (!cleanProjectKey) {
      setMessage({ type: "error", text: "JIRA Project Key is required" });
      return;
    }

    // JIRA project keys: start with letter, only uppercase letters + digits,
    // 2-10 chars total. Matches Atlassian's documented format.
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(cleanProjectKey)) {
      setMessage({
        type: "error",
        text: "JIRA Project Key must be 2–10 characters, start with a letter, and contain only uppercase letters and digits (e.g., PROJ, SCRUM2).",
      });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const result = await invoke("saveSettings", {
        backendUrl,
        backendApiKey: trimmedApiKey,
        defaultProjectKey: cleanProjectKey,
      });
      if (result?.error) {
        setMessage({ type: "error", text: result.error });
      } else {
        setMessage({ type: "success", text: "Settings saved" });
      }
    } catch (e) {
      setMessage({ type: "error", text: "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  }

  // Reset settings to defaults (delete from storage)
  async function handleReset() {
    if (!confirm("Are you sure you want to reset all settings? This cannot be undone.")) {
      return;
    }
    try {
      await invoke("resetSettings");
      setBackendUrl("");
      setBackendApiKey("");
      setDefaultProjectKey("");
      setMessage({ type: "success", text: "Settings reset" });
    } catch (e) {
      setMessage({ type: "error", text: "Failed to reset settings" });
    }
  }
  // Test connection
  async function handleTest() {
    if (!backendUrl) {
      setMessage({ type: "error", text: "Enter a Backend URL first" });
      return;
    }

     if (!backendApiKey || backendApiKey.trim().length < 16) {
      setMessage({
        type: "error",
        text: "Enter a Backend API Key (at least 16 characters) first",
      });
      return;
    }

    setTesting(true);
    setMessage(null);
    try {
      const result = await invoke("testConnection", {
        backendUrl,
        backendApiKey,
      });

      if (result?.status === "ok") {
        setMessage({
          type: "success",
          text: `Connected — ${result.message || "Backend is healthy"}`,
        });
      } else {
        setMessage({ type: "error", text: getErrorText(result) });
      }
    } catch (e) {
      // Resolver itself threw (shouldn't happen if resolver follows contract,
      // but handle gracefully).
      setMessage({
        type: "error",
        text: getErrorText({ code: "UNEXPECTED", detail: e?.message }),
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
        Configure the connection to your self-hosted Spec2Tickets backend.
      </p>

      {/* Early Access info callout */}
      <div
        className="rounded-lg p-4 mb-6 text-sm"
        style={{
          background: "var(--s2j-blue-bg)",
          border: "1px solid var(--s2j-blue-border)",
          color: "var(--s2j-text)",
        }}
      >
        <p className="mb-2">
          <strong>Self-hosted backend setup:</strong> Spec2Tickets connects to
          an AI backend you deploy on your own server. If you haven't deployed
          the backend yet, follow the{" "}
          <a
            href="https://spec2jira.com/docs"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--s2j-blue)", textDecoration: "underline" }}
          >
            setup guide
          </a>
          .
        </p>
        <p>
          <strong>Whitelist required (Early Access):</strong> Before "Test
          Connection" can succeed, your backend domain must be approved. See{" "}
          <a
            href="https://spec2jira.com/docs#step-7"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--s2j-blue)", textDecoration: "underline" }}
          >
            Step 7 of the setup guide
          </a>{" "}
          or email{" "}
          <a
            href="mailto:support@spec2jira.com"
            style={{ color: "var(--s2j-blue)", textDecoration: "underline" }}
          >
            support@spec2jira.com
          </a>{" "}
          with your backend domain and Atlassian site URL. We respond within one
          business day.
        </p>
      </div>

      {/* Form */}
      <div className="space-y-5">
        {/* Backend URL */}
        <Field
          label="Backend URL"
          description="HTTPS endpoint of your Spec2Tickets backend. Domain must be whitelisted — see info above."
          required
        >
          <div className="flex gap-2">
            <input
              type="url"
              value={backendUrl}
              onChange={handleBackendUrlChange}
              placeholder="https://api.yourcompany.com"
              className="flex-1"
              style={inputStyle}
            />
            <button
              onClick={handleTest}
              disabled={testing || !backendUrl || !backendApiKey || backendApiKey.trim().length < 16}
              className="btn-secondary shrink-0"
              style={{ opacity: testing || !backendUrl || !backendApiKey || backendApiKey.trim().length < 16 ? 0.5 : 1 }}
            >
              {testing ? "Testing..." : "Test Connection"}
            </button>
          </div>
        </Field>

        {/* API Key */}
        <Field
          label="Backend API Key"
          description="Optional. If your backend requires authentication."
          required
        >
          <input
            type="password"
            value={backendApiKey}
            onChange={(e) => {
              setBackendApiKey(e.target.value);
              if (message?.type === "error") setMessage(null);
            }}
            placeholder="Paste your backend API token"
            style={inputStyle}
            maxLength={256}
          />
        </Field>

        {/* Default Project Key */}
        <Field
          label="Default JIRA Project Key"
          description="2–10 uppercase letters/digits, starting with a letter. Used as the default when creating tickets. Required."
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
      </div>

      {/* Message — role=alert + aria-live so screen readers announce it */}
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

      {/* Save */}
      <div className="mt-6 flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="btn-primary">
          {saving ? "Saving..." : "Save Settings"}
        </button>
        <span className="text-xs" style={{ color: "var(--s2j-text-muted)" }}>
          Settings apply to all users in this Confluence instance
        </span>
      </div>

      {/* Reset Settings */}
      <div className="mt-6 flex items-center gap-3">
        <button onClick={handleReset} disabled={saving} className="btn-secondary">
          Reset Settings
        </button>
        <span className="text-xs" style={{ color: "var(--s2j-text-muted)" }}>
          Settings apply to all users in this Confluence instance
        </span>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

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
