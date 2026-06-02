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

// Mirrors of the server-authoritative caps in src/index.js — kept here only for the
// live character counter + fail-fast UX on the Project Context profiles editor.
const PROJECT_CONTEXT_MAX_CHARS = 12000;
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
};

function getErrorText(result) {
  const mapped = ERROR_MESSAGES[result?.code];
  if (mapped) return mapped;
  return result?.detail || "Connection test failed";
}

export default function AdminSettings() {
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

        {/* Project Context profiles — pick the right one at generation time (a
            workspace may span multiple projects, so a single global context would
            misapply across them). Each profile enriches terminology/interpretation;
            it never changes scope or rewrites the spec's acceptance criteria. */}
        <ContextProfilesEditor
          profiles={contextProfiles}
          setProfiles={setContextProfiles}
          apiKeyConfigured={apiKeyConfigured}
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

// ── Project Context profiles editor ─────────────────────────────────────────
// Manage N named contexts (domain/glossary/personas/conventions per project). Each
// row: name + context textarea + "Distill with Claude" (condense a long paste) + live
// counter + remove. The user later picks which profile applies per generation
// (ReadyScreen), so a multi-project workspace never gets the wrong project's context.
function ContextProfilesEditor({ profiles, setProfiles, apiKeyConfigured, onMessage }) {
  const [distillingId, setDistillingId] = useState(null);
  const [distillProgress, setDistillProgress] = useState(null); // { label, current, total } while a 6-step distill runs
  const [distillFailure, setDistillFailure] = useState(null); // { id, sessionId, step, total } when a step errored (enables Retry)
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
        onMessage({ type: "error", text: e?.message || "Distill step failed" });
        return;
      }
      if (result?.error) {
        const label = result.label || `step ${step + 1}`;
        setDistillFailure({ id, sessionId, step, total });
        onMessage({
          type: "error",
          text: `${ERROR_MESSAGES[result.code] || result.detail || `Couldn't distill ${label}.`} You can retry from where it stopped, or start over.`,
        });
        return;
      }
      // Update the progress line. After a successful non-final step the NEXT category is
      // about to run, so show that; on the final step we're done.
      if (result?.done) {
        update(id, { context: result.profile || "" });
        const len = (result.profile || "").length;
        onMessage({
          type: "success",
          text: `Distilled across ${total} passes to ${len.toLocaleString()} characters${result.overflowTrimmed ? " (the profile ran long and its end was trimmed to fit the size limit — review the earlier sections and trim any single-spec detail, then expand the end if needed)" : result.truncated ? " (kept intentionally concise — open the editor to expand if you want more detail)" : ""}. Review and delete any line true of only ONE spec (specific timings, limits, counts, or scope) — this profile is reused for ALL your specs — then click Save Settings.`,
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
        text: "Save your Anthropic API key first — then Claude can help shape your project context.",
      });
      return;
    }
    setDistillingId(id);
    setDistillFailure(null);
    onMessage(null);
    try {
      let start;
      try {
        start = await invoke("startDistillSession", { text: t });
      } catch (e) {
        onMessage({ type: "error", text: e?.message || "Distill failed" });
        return;
      }
      if (start?.error || !start?.sessionId) {
        onMessage({
          type: "error",
          text:
            ERROR_MESSAGES[start?.code] ||
            start?.detail ||
            "Couldn't start the distill. Try again.",
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
    if (!busy) return "✨ Distill with Claude";
    const p = distillProgress;
    const text =
      p && p.label
        ? `Distilling… ${p.label} (${p.current}/${p.total})`
        : p
          ? `Distilling… (${p.current}/${p.total})`
          : "Distilling…";
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
        Project Context profiles (optional)
      </label>
      <p className="text-xs mb-3" style={{ color: "var(--s2j-text-muted)" }}>
        Standing background that helps Claude understand a project's specs the way your
        team does — domain, glossary, personas, systems, tech, naming conventions. You
        pick which profile applies each time you generate, so specs from different
        projects get the right context. It enriches terminology and interpretation — it
        never changes what gets built or rewrites your spec's acceptance criteria.
        Because one profile is reused across ALL of a project's specs, keep only durable
        facts — leave out anything true of a single spec (specific timings, limits,
        counts, or scope). A concise brief distills more cleanly than a full spec.
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
          No profiles yet. Add one per project to tailor breakdowns to its domain,
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
                  placeholder="Profile name (e.g. Logistics Platform)"
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
                  title="Remove this profile"
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
                      title="Resume the distill from the step that failed"
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
                  pasted a whole page? Click <strong>Distill with Claude</strong> to
                  condense it (you can edit the result before saving).
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
                        title="Resume the distill from the step that failed"
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
