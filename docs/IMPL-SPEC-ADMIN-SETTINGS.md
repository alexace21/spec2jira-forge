# Impl-Spec — Admin Settings redesign (Claude-Design arc, screen 5)

> **For the implementer agent(s).** You CANNOT see the Claude Design mockup images — this spec fully
> encodes them. Build the **Settings tab 1:1** from the "Led setup" direction + **refresh the Diagnostics
> tab** to the sketch, folding in 2 §8 honesty levers. Respect the moodboard kit. Branch
> `feature/UI-UX-improvements`. File: `static/hello-world/src/components/AdminSettings.jsx` (+ a new
> `static/hello-world/src/lib/settingsView.js` + small icon adds + 2 tiny backend fields).

---

## 0. Scope + invariants (NON-NEGOTIABLE)

- Rewrite the **Settings tab** content of `AdminSettings.jsx` to the Led-setup layout (§4). **Refresh the
  Diagnostics tab** (§6). Keep the **two-tab shell** (`Settings | Diagnostics`) exactly where it is.
- **DO NOT** add a Back button inside AdminSettings — App.js injects "← Back" above it (verified
  App.js:2358-2381). Keep the component's outer structure `<div>{tabBar}{content}</div>`.
- **Keep ALL resolvers + the ContextProfilesEditor distill pipeline** (startDistillSession/distillStep,
  retry-from-step, dropped-categories, the focus-editor modal) — behaviour-preserving; only its *presentation*
  moves into the led "Add project context" step.
- **The API-key field shows for EVERY edition** (both BYOK). Never hide/collapse it. #1 non-negotiable.
- Feature gating keys on capability flags (`hasTestCases`/`hasPlanner`), NEVER the edition label.
- **Config-complete = key + project ONLY** (required). Profiles + custom-fields are OPTIONAL — never gate
  the verdict on them; their tiles render a NEUTRAL ○, never an amber gap.
- Button colours: **green** `.btn-primary` = Save/commit · **blue** `.btn-nav` = links/open/verify-nav ·
  **red** `.btn-danger` = destructive. Clear-key + Reset use an **armed two-step** (not `confirm()` — it can
  be inert in the Forge iframe; mirror the existing Diagnostics-clear armed pattern).
- **Severity = colour on the ICON; the words stay dark** (`--s2j-text`) on glass (WCAG). Use
  `SignalIcon`/`SignalCallout`; a red/amber/green tile paints the icon + the tile's status line, not the label.
- **Forge iframe = page-scroll only.** No `100vh`, no internal scroll trap. The profile focus-editor modal
  (`position:fixed; inset:0`) is the ONE allowed fixed overlay (keep it; watch its inner scroll at live-accept).
- **ALL string literals use ASCII quotes/apostrophes** (`'` `"` — NEVER `'` `'` `"` `"` `´`). Smart-quote
  guard: after edits run a byte-sed sweep + a REAL build (`npm run build > log 2>&1; echo NPM_EXIT=$?; grep
  Compiled` — NEVER `| tail`).
- Moodboard: reuse `MoodCard`/`glassSurface`/`SignalCallout`/`SignalIcon`/`TYPE`/`MOOD` — do NOT hand-roll
  flat near-white fills (invisible on white). Tokens only (`var(--s2j-*)`).

---

## 1. The two-signal state machine — the load-bearing correctness (new `lib/settingsView.js`)

The verdict is **two ORTHOGONAL signals** (proven across all 13 mockup states — never interleave them):

### A. License gate — `computeLicenseGate(account)`
Reads `getUsage`. Returns one of:
- `{ state: 'licensed' }` — `account.allowed === true` (BYOK/trial: normal). No banner.
- `{ state: 'blocked' }` — `account && account.allowed === false` (Unlicensed backstop, `limit===0`).
  Dominates everything → the red "Not licensed" state (§5.9).
- `{ state: 'unknown' }` — `!account || account.error` (getUsage failed). Do NOT assert licensed; show the
  config verdict + a "plan details couldn't load" degraded card (§5.10). **Never claim "licensed" when unknown.**

### B. Config verdict — `computeConfigVerdict({ keyConfigured, projectKey, keyStorageFault, health })`
`health` = the last `runHealthCheck` result (`{ok, probes}`) or `null` (not run). `keyStorageFault` = a boolean
the FE sets when a key-read storage fault is detected (see §3). Returns `{ level, key, project, verified }`:
- `key`: `'configured'` | `'not_set'` | `'storage_fault'`.
- `project`: `'set'` | `'not_set'`.
- `verified`: `'verified'` (health && health.ok) | `'failed'` (health && !health.ok) | `'not_run'` (no health).
- **`level`** (the hero severity) resolves in THIS order:
  1. `key==='storage_fault'` → `'error'` ("Can't read your API key", §5.8).
  2. `key==='not_set'` → `'error'` ("API key required — nothing can generate yet", §5.5/first-time).
  3. `project==='not_set'` → `'warning'` ("One required step left — set a default project", §5.4).
  4. `verified==='failed'` → `'error'` ("Verification found 1 problem", §5.2/5.6/5.7).
  5. `verified==='verified'` → `'ok'` ("Configured and verified", §5.1).
  6. else (complete, not yet verified) → `'neutral'` ("Configured — run the check to verify").
- `configComplete = key==='configured' && project==='set'` (drives auto-verify eligibility + "N of 2 required
  done").

### C. Tile states — `computeTiles(verdict, account, apiKeyLastSetAt, health)`
Five tiles, each `{ id, label, status, value, sub }`. `status` ∈ `ok`|`warn`|`error`|`neutral` → icon+tint:
- **API KEY**: configured→`ok` "Configured" / sub "last set {date}"; not_set→ (error if it's the hard blocker,
  else warn) "Not set" / "paste to connect"; storage_fault→`error` "Storage fault" / "can't read secret".
- **PROJECT**: set→`ok` "{KEY}" / "push destination"; not_set→`warn` "Not set" / "required".
- **CONTEXT**: always `neutral` ○ — "{n} profiles" or "None" / "optional". (n = profiles.length.)
- **CUSTOM FIELDS**: always `neutral` ○ — "None" or "Configured" / "optional".
- **VERIFIED**: verified→`ok` "Verified" / "{probeCount} checks · just now"; failed→`error` "1 failed" (or
  "{k} failed") / "see detail"; not_run→`neutral` ○ "Not verified" / "run the check".

### D. Probe severity + deep-link — `classifyProbe(probe)`
Returns `{ severity: 'error'|'warning', fixField: 'apiKey'|'projectKey'|null, hint }`. **Field-fixable →
`error` + a fixField (deep-link); not-field-fixable → `warning` + honest hint + fixField=null.** Mapping by
`probe.code` (from `runHealthCheck`):
| code | severity | fixField | hint (verbatim, ASCII) |
|---|---|---|---|
| `not_configured` | error | apiKey | "The Anthropic API key is not set. Paste it in step 1 and Test." |
| `key_storage_failed` | error | apiKey | "Forge could not read the stored key. Re-enter it and Test again." |
| `auth_rejected` | error | apiKey | "Anthropic rejected the key (401). Verify it at console.anthropic.com, then update it." |
| `no_project_key` | error | projectKey | "No default Jira project key. Set one in step 2." |
| `project_not_found` | error | projectKey | "No Jira project with that key exists. Check the Default Jira Project Key." |
| `insufficient_credits` | warning | null | "Your Anthropic account is out of credits (402). Top up at console.anthropic.com — the key itself is fine." |
| `rate_limited` | warning | null | "Anthropic rate limit hit (429). Wait a moment and Re-verify." |
| `permission_denied` | warning | null | "Your Jira/Confluence account lacks access. The key is fine — this probe checks YOUR session, so fixing a field here would be wrong." |
| `egress_blocked` | warning | null | "Forge blocked an outbound request (app config). Contact support@spec2jira.com." |
| `confluence_http` / `jira_http` / `network_failure` | warning | null | "A live call failed. Usually transient — Re-verify in a moment." |
| `kvs_failed` | warning | null | "A storage round-trip failed. Usually transient — Re-verify." |
| `managed_unavailable` | warning | apiKey | "No Anthropic key was available. Both editions use your own key — add it in step 1." |
| (anything else) | warning | null | "An unexpected check error. Re-verify; if it persists, copy the report in Diagnostics." |

### E. Probe name → label — `probeLabel(name)`
`anthropic_key`→"Anthropic API key" · `confluence_read`→"Confluence access" · `jira_project`→"Jira project"
· `kvs_rw`→"App storage" · (fallback) the raw name.

### F. Cost anchor constant
`export const COST_ANCHOR = { typical: '~$0.12', max: '~$0.24' };` — sourced from `usage.js` comments
(~$0.118 avg / ~$0.24 max per breakdown; corroborated by anthropic_client.js ~$0.14/22-feat). Honest FE
constant, NOT customer actuals.

**Ship `lib/settingsView.js` with an offline test `prototype/test_settings_view.mjs`** covering: each of the
13 states → correct `{level, key, project, verified}` + tiles + probe classification (field-fixable vs hint) +
the `unknown` (getUsage-failed) path never claiming licensed. The conductor authors this module + test.

---

## 2. Data contract (resolvers — mostly unchanged; 2 tiny additive backend fields)

- `getSettings()` → `{ defaultProjectKey, apiKeyConfigured, apiKeyLastSetAt, contextProfiles[], requiredCustomFieldsJson }` — unchanged.
- `getUsage()` → `{ allowed, tier, tierLabel, edition, keySource, hasTestCases, hasPlanner, limit, unlimited,
  used, remaining, resetsAtLabel, overLimit, fairUse, pricing[], memberSince, memberSinceLabel }` OR
  `{ error:'usage_unavailable' }`. Unchanged. (FE: `computeLicenseGate` + degraded card handle the error.)
- `testConnection({anthropicApiKey?})` → **ADD `model` to the success return**: `{ status:'ok', message, model }`
  (the client already returns `model`; the resolver currently drops it — index.js ~845-850). 1-line additive.
- `runHealthCheck()` → **ADD `model`**: `{ ok, probes[], model }` where `model` = the resolved model from the
  successful `anthropic_key` probe's testConnection (index.js ~5704-5726), else omitted. Additive.
- Distill resolvers, getDiagnostics, getDiagnosticsExport, clearDiagnostics, saveSettings, clearAnthropicApiKey,
  resetSettings — unchanged.
- **For the folded §8 Diagnostics levers (§6):** `getDiagnostics` records already carry `record.surfaced`
  (bool) and `record.jira[].field_names` (array) — verify these ride the response; if `surfaced` is absent on
  the record, treat missing as `true` (seen) — the split is best-effort, never a crash.

---

## 3. Verify lifecycle (the auto-verify + the two-signal wiring)

New FE state in AdminSettings: `health` (`{ok,probes,model}`|null), `verifying` (bool), `verifiedOnce` (bool),
`model` (string|null), `keyStorageFault` (bool).

- **`runVerify()`**: sets `verifying=true`, calls `runHealthCheck`, stores `health` + `model` (if present),
  sets `verifiedOnce=true`, `verifying=false`. On a probe `key_storage_failed` → set `keyStorageFault=true`;
  clear it when a subsequent verify's key probe is ok OR the key is re-saved.
- **Auto-verify ONCE on config-complete:** a `useEffect` keyed on `configComplete` — when it transitions
  false→true AND `!verifiedOnce`, call `runVerify()` once. **Guard:** never re-fire on every mount/open. On a
  fresh open of an already-complete config, `health` is null → the hero shows `neutral` "run the check", NOT a
  stale green (honest: we didn't re-probe). The "auto-verifying" note (§5.3) shows only right after the
  auto-run fires.
- **Manual "Verify configuration" / "Re-verify" button** (blue `.btn-nav`) always available; runs `runVerify()`.
- While `verifying`: the hero shows a "Verifying… running the 4 checks" state (Spinner + text) — the transient
  visual (do NOT show only the settled result).
- **Model display:** `model` populates from `testConnection` (step-1 Test) OR `runHealthCheck` (verify). Before
  any → the plan card + step-1 show "not tested" / "run Test Connection".

---

## 4. Settings tab layout — 1:1 (top → bottom)

All within the existing `<div className="p-8" style={{maxWidth:640}}>` (page-scroll). Use MoodCard density
`major` for the big cards unless noted.

### 4.1 Header
- `<h1>` `{...TYPE.title, fontSize:22, color:MOOD.navy}` "Spec2Tickets Settings".
- Subtitle `text-sm`, `--s2j-text-muted`: "Configure Spec2Tickets for **everyone on this Confluence instance**.
  Your real job isn't filling in fields — it's proving it works before you walk away." (bold the middle clause).

### 4.2 Configuration status card (the pre-flight verdict hero) — `MoodCard density="major"`
- Card header row: left `TYPE.heading` navy "Configuration status"; right `TYPE.micro` `--s2j-text-muted`
  "instance-wide · applies to every BA on this site".
- **Verdict banner** = a `SignalCallout` whose `kind` maps from `verdict.level`: ok→`success`,
  neutral→`info`, warning→`warning`, error→`error`. Content by state (§5). For the OK state the banner text:
  "**Configured and verified** — Key valid · project {KEY} reachable · Confluence & Jira verified from here ·
  storage OK. Verified from your session — 2 of the 4 checks use your own access, so this is 'verified,' not
  'guaranteed for every user.'" When `verified==='failed'` the banner is `error` with a **Re-verify** blue
  button on the right (§5.2).
- **Auto-verify note** (only right after an auto-run, §5.3): a small `TYPE.micro` line under the banner with a
  clock icon: "Ran automatically the moment key + project first became complete. It won't re-probe every time
  you open Settings."
- **5 answer tiles** — a responsive grid (`display:grid; gridTemplateColumns:repeat(5,1fr); gap:12` desktop;
  wrap/stack on narrow). Each tile = a small bordered panel (`glassSurface('utility')`-style or a light
  `--s2j-bg` box with `--s2j-border`): a top row = label (`TYPE.label` uppercase, `--s2j-text-muted`) + a tiny
  tier tag on the right (`T0` in `--s2j-text-muted`, `fontSize:9`); then a status row = `SignalIcon` (or a
  neutral hollow ○ for neutral status) + a bold value (`--s2j-text`); then a `sub` line (`TYPE.micro`,
  `--s2j-text-muted`). Tiles come from `computeTiles`. **Neutral status uses a hollow grey ○** (a
  `<span>` circle outline, NOT a coloured SignalIcon) so optionals never read as a gap. VERIFIED tile's "see
  detail"/"run the check" sub is a real affordance where applicable.
- **Verification detail panel** — rendered when `health` exists (esp. on `verified==='failed'`): a section
  titled `TYPE.label` "VERIFICATION DETAIL · 4 LIVE CHECKS AGAINST YOUR OWN SESSION", then one row per probe.
  Each probe row = a light panel; ok → green check + `probeLabel` + muted "ok"; failed → the `classifyProbe`
  severity icon (red triangle for error / amber triangle for warning) + `probeLabel` + a mono `(code)` +
  the hint on the next line; if `fixField` is set, a right-aligned **"Fix in {API key|Project key} ↓"** button
  (blue text/`.btn-secondary`) that scrolls to + focuses that field (via a ref, NOT an id — normal React ref).
  Field-fixable rows get a red-tinted panel; hint-only rows get an amber-tinted panel; ok rows a green-tinted
  panel. (Matches §5.2/5.6/5.7/5.8.)
- On the `neutral`/complete-but-unverified state, show a primary **"Verify configuration"** blue `.btn-nav`
  button in/under the banner.

### 4.3 Cost + trust row — two `MoodCard density="minor"` side by side (grid 2col, stack on narrow)
- **COST ON YOUR KEY** (`T2` tag): `TYPE.label` "COST ON YOUR KEY"; a big `~$0.12` (`fontSize:26,
  fontWeight:700, --s2j-text`) then muted "typical · up to **~$0.24** per breakdown"; then `TYPE.micro`:
  "Billed straight to your own Anthropic account, pay-as-you-go, **no markup from us**. A whole team running
  this bills per breakdown, not per seat." (Use `COST_ANCHOR`.)
- **Your data path** (`shield` icon + "show this to security"): a horizontal chip flow — `[Confluence page]`
  → `[Forge]` → `[Anthropic · your key]` (small pill chips, arrows between; the Anthropic chip green-tinted).
  Then `TYPE.micro`: "**BYOK. There is no Spec2Tickets backend** — page content never touches a vendor server.
  Falls under your own DPA with Anthropic." (`shield` = new `IconShield`, §7.)

### 4.4 Plan / model card — `MoodCard density="minor"` (T0) — the consolidated plan card
Four columns (grid, wrap): **PLAN** `{tierLabel}` + muted "· {price}" (price from `pricing[]`, single source);
**BREAKDOWNS** "Unlimited" (or the quota); **AI MODEL** `{model||'not tested'}` (mono); **MEMBER SINCE**
`{memberSinceLabel}`. Then a `TYPE.micro` line: for Advanced "Everything in Standard, plus AI test-case
generation and the capacity planner." + two green-check chips "Test-case generation" / "Capacity planner"
(gate the chips on `hasTestCases`/`hasPlanner`). For Standard: the value-framing + a gentle Advanced upsell
(keep the existing copy logic). **Degraded (getUsage unknown):** replace this whole card with the "Plan details
couldn't load" amber card (§5.10). **Blocked (unlicensed):** ALSO render the "Not licensed" card (§5.9).
> Label it **"AI MODEL"** not "BILLING MODEL". Show the real model from Test Connection/verify (§3), not a
> hard-coded string.

### 4.5 "Set up in order" — the led spine
- Section header row: left `TYPE.heading` "Set up in order"; right `TYPE.micro`: "Two required steps, then two
  optional. **{N} of 2 required done**" (N = (key?1:0)+(project?1:0)) OR "**All set · verified**" when
  configComplete && verified.
- A vertical stepper: each step = a numbered/checked node on the left (green check-circle when done, else a
  hollow grey numbered circle) + a title row + a body. **Done steps COLLAPSE** to a one-line summary + an
  **"Edit"** link (blue) that expands them. Steps:
  1. **Connect Anthropic** `[REQUIRED]` — collapsed: "Key configured · last set {date} · model {model}" + Edit.
     Expanded: the full key panel (§4.6).
  2. **Choose the default Jira project** `[REQUIRED]` — collapsed: "Pushes to project `{KEY}` by default" +
     Edit. Expanded: the project-key input (§4.6).
  3. **Add project context** `[OPTIONAL]` (T0·T3) — never collapses to done (optional). Intro copy (keep the
     existing long guidance, condensed): "Standing background — domain, glossary, personas — Claude reuses on
     every breakdown for a project. Durable facts only; leave out anything true of a single page. **You're
     fully configured without this.**" Then the profile rows (§4.7).
  4. **Required custom fields** `[OPTIONAL · ADVANCED]` — copy: "Only needed if your Jira project rejects
     issues created without a custom field (e.g. a mandatory Team, Story Points or Sprint). Map each field ID
     to its value as JSON — otherwise the push fails with 'field is required'. Leave blank if your project
     doesn't need any." + "+ Add custom-field mapping" (blue) → reveals the existing JSON textarea + the
     existing how-to `SignalCallout`.
  5. **Verify & hand off** — done (green) when verified: "**You're done.** All four checks passed against your
     session. **Verified from here — the key and project apply to everyone; each BA still needs their own
     Confluence/Jira access.**" ⚠ THIS IS THE FIX — do NOT write "every BA can generate and push". Not-verified:
     an amber/neutral "Run the check to finish" with a **Verify configuration** blue button (same handler as
     4.2). Derive this copy from the SAME verdict helper (one source of truth).

### 4.6 The key + project inputs (inside the expanded steps)
- **Key panel:** intro "Paste your Anthropic API key. It's stored write-only for the whole instance — we never
  show it back. New here? Get a key at console.anthropic.com · plain-English walkthrough (covers the billing
  step)." (link to spec2jira.com/get-api-key). The password input (placeholder "•••••••• (configured — paste
  to replace)" when configured) + a **Test Connection** blue `.btn-nav` button. On ok → a green `SignalCallout`:
  "Connected — billing model `{model}`. This is the real model name from the API, not a hard-coded label."
  On error → a `SignalCallout error` with `getErrorText`. Below: **"Clear stored API key"** — a red text link
  that becomes an **armed two-step** ("Click again to confirm") — NOT `confirm()`.
- **Project panel:** the project-key input (uppercase, monospace, maxLength 10). Inline validation as they
  type: valid pattern → a green `SignalIcon` + "Looks valid — Verify below will confirm the project actually
  exists."; invalid → an amber hint. (Inline, NOT the shared bottom message.)

### 4.7 Project context rows (the lighter editor)
Keep ContextProfilesEditor's behaviour. Present each profile as a **collapsed-summary row** (MoodCard minor):
folder icon + name + a muted `{len}/20,000` counter + a **status pill** on the right — `Distilled` (green),
`{n} categories dropped` (amber), or `Failed at {k}/6` (red) + a **Retry from {k}** link; + **Expand** (opens
the focus-editor modal) + **Remove** (red). Distill-in-progress shows "Distilling {k}/6 · {Category}" + a
progress bar (in the row or the modal). "+ Add a project context" (blue). The focus-editor modal = the existing
overlay (keep). ⚠ The distill disabled tooltip must say "**Save your Anthropic API key first**" (NOT "add your
context text") — fix the inline-card tooltip to match the modal's correct copy.

### 4.8 Footer
- **Save settings** green `.btn-primary` + muted "Applies to all users in this Confluence instance".
- **Reset all settings** — a lower-emphasis `.btn-secondary` on the right, **armed two-step** (Click again to
  confirm), NOT `confirm()`.
- Keep the shared `message` region (role=alert) for Save/Test/global errors, BUT move field-specific validation
  inline (key format, project pattern, custom-fields JSON) so the bottom region is for Save-level outcomes.

---

## 5. The 13 states — exact treatment (the harness proves these; build all)

1. **Configured & verified (green)** — verdict OK banner (§4.2); tiles all ok/neutral; VERIFIED ok; steps all
   done+collapsed; step-5 done (honest scope). Plan card normal.
2. **Verify failed · out of credits** — verdict `error` "Verification found 1 problem · Field-fixable issues
   link to their field below; the rest show an honest hint" + Re-verify. VERIFIED tile error "1 failed". Detail:
   Anthropic key **amber** `insufficient_credits` + hint (NO fix button); other 3 ok.
3. **Configured, auto-verifying** — same as OK green + the auto-verify note (§4.2). (After the auto-run settles.)
   Also cover the transient `verifying` spinner state.
4. **Key set · project missing** — verdict `warning` "One required step left — set a default project. Your key
   is connected. Add a default Jira project key and you're configured; then verify." PROJECT tile amber "Not set
   (required)"; VERIFIED neutral "Not verified (run the check)". "1 of 2 required done".
5. **First-time setup (empty)** — verdict `error` "API key required — nothing can generate yet. Spec2Tickets is
   BYOK. Connect an Anthropic key to switch generation on for the whole instance." API KEY tile **error** "Not
   set (paste to connect)"; PROJECT amber; optionals neutral; VERIFIED neutral. Plan card model "not tested".
   "0 of 2 required done". Steps 1+2 not-done (expanded/actionable).
6. **Verify failed · bad project key** — verdict `error` + Re-verify. Detail: Jira project **red**
   `project_not_found` + hint + **"Fix in Project key ↓"** button; others ok.
7. **Verify failed · permission denied** — verdict `error` + Re-verify. Detail: Confluence access **amber**
   `permission_denied` + hint "The key is fine — this probe checks YOUR session, so fixing a field here would
   be wrong." (NO fix button); others ok.
8. **API key storage fault** — verdict `error` "Can't read your API key — Forge returned a storage fault
   reading the stored secret — this is not the same as 'no key'. Re-enter the key in step 1 and Test." API KEY
   tile **error** "Storage fault (can't read secret)". Detail: Anthropic key **red** `key_storage_failed` +
   **"Fix in API key ↓"**; others ok.
9. **Not licensed** (license gate `blocked`) — verdict `error` "Not licensed — generation is blocked. No active
   subscription or trial on this site. Spec2Tickets can't generate for anyone until a plan is active. Your BYOK
   key still works once licensed." Tiles: key/project may be ok; VERIFIED neutral. A dedicated **"Not licensed"**
   `SignalCallout error`-style card lower: "No active subscription or Atlassian trial on this site, so generation
   is blocked for everyone. Your Anthropic key stays configured and starts working the moment a plan is active —
   this isn't a broken account, it's an unlicensed one." + **"See plans / start a trial ↗"** blue `.btn-nav`
   (external, `router.open` to the Marketplace/upgrade URL — reuse the app's existing upgrade URL if present,
   else the Marketplace listing).
10. **Account details unavailable** (license gate `unknown`) — verdict stays the CONFIG verdict (green if
    verified) — do NOT block on the missing plan. Replace the plan card with an amber card: "**Plan details
    couldn't load** — getUsage failed on the server, so plan, price and member-since aren't available right now.
    **This is different from having no account — your settings below still save and work as normal. Retry.**"
    (Retry re-calls getUsage.)
11. **Project context · distilling** — the profile row/modal shows "Distilling {k}/6 · {Category}" + progress
    bar (§4.7).
12. **Distill outcomes** — the 3 pills on profile rows: Distilled (green) / {n} categories dropped (amber) /
    Failed at {k}/6 (red) + Retry (§4.7).
13. **Save · inline validation** + **Save · partial-commit** — inline field errors (key format / project
    pattern / bad JSON) render at the field; a Save partial-commit (key stored but settings write threw) shows
    an honest `SignalCallout error` at the footer noting the key saved but other settings didn't — Retry Save.

---

## 6. Diagnostics tab refresh (§6) — the sketch + 2 folded §8 levers

Rebuild `DiagnosticsTab`'s render into a **System health** card + **Recent activity** ledger + **Site-wide
counters** + the export/health/clear footer. Keep ALL existing logic (getDiagnostics, scope toggle, ref filter,
sweep heartbeat, armed clear, export consent). Reuse MoodCard/SignalCallout.

- **System health card** (`MoodCard major`): header "System health" + right micro "the same 4 production paths
  the app uses · runHealthCheck". A verdict banner (green "All systems healthy — The four production paths —
  Anthropic, Confluence, Jira and storage — all responded from your session. Last checked recently." / amber or
  red when a probe failed) + a **Re-run** blue button. Then 4 tiles: **LAST HEALTH CHECK** (Passed/Failed ·
  reltime) · **PUSHES · 7 DAYS** ("{clean} clean · {partial} partial" from the aggregate) · **OPEN INCIDENTS**
  ("{n} to review") · **ORPHAN SWEEP** (reltime + amber dot if stale/degraded/errored). Then the sweep-heartbeat
  amber callout (KEEP the existing 3-way logic: stale vs ok===false vs degraded). Then **RAW PROBES · NAME ·
  CODE · RESULT** — one row per probe (reuse §4.2's probe-row rendering + `probeLabel` + `classifyProbe`).
- **Recent activity** ledger (`for {this admin|all users} · newest first`): each record = a plain-English
  incident card. Reuse the humanized `classText`. A failed/partial record shows the honest breakdown + count
  chips (e.g. "✓ 12 stories · ✓ 47 sub-tasks · ✓ 16 links · ● 1 link unresolved (name unknown)") + "Show raw
  counts (for the report)". Cost breadcrumbs show real cost ("12 features · cost ~$0.07 on your Anthropic key").
  - ⭐ **FOLD §8 LEVER 1 — surfaced vs silent split.** Partition the ledger into **"Silent failures (you never
    saw these)"** (records where `surfaced===false` AND level is error/warn) shown FIRST under a distinct
    header + an amber/red accent, then **"Recent activity"** (the rest, newest-first). A silent, error-level,
    data-loss record is the must-never-miss. If `surfaced` is missing on all records, skip the split gracefully
    (single "Recent activity" list).
  - ⭐ **FOLD §8 LEVER 2 — field_names fix-chip.** On any record carrying `record.jira[].field_names`, render a
    **"Jira rejected: `{customfield_id}`"** chip (mono, amber) — the exact rejected custom-field the admin must
    add. (Raw id; a friendly name is a deferred T2 lookup.)
- **Site-wide signal counters** — KEEP the existing aggregate table (humanized title + `(class)` + count +
  reltime).
- **Footer** — KEEP: "operation codes, IDs and counts — no page or document content · safe to paste to
  support" + the consent checkbox + **Copy full report** (blue) / **Run health check** (secondary) / **Clear
  diagnostics** (red armed). (These already exist — keep verbatim.)
- ⚠ Deeper §8 (client filter/group by level/subsystem, 10k-record virtualization, the full incident-card state
  matrix) = a DOCUMENTED fast-follow (do NOT build now; note it in the handover).

---

## 7. Icons to add (`Icon.jsx`)
- **`IconShield`** — for "Your data path" (a shield outline). `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`.
- **`IconKey`** (optional, for the key field/step-1 marker) — a key glyph. Use IconSettings if you prefer not
  to add. (Not load-bearing.)
- Reuse existing: IconCheck, IconX, IconChevronRight/Down/Up, IconMaximize, IconRefresh, IconClock, IconCost,
  IconExternalLink, IconLayers, IconLink. Severity icons come from `SignalIcon`.

---

## 8. Build + verify checklist (the implementer runs)
- `node --check` any touched `src/*.js` (the 2 backend field adds).
- `cd static/hello-world && npm run build > /tmp/b.log 2>&1; echo NPM_EXIT=$?; grep -c Compiled /tmp/b.log` —
  NEVER `| tail`. Green = "Compiled" present + NPM_EXIT=0.
- Byte-sed smart-quote sweep on AdminSettings.jsx + settingsView.js + Icon.jsx (curly→ASCII) then re-build.
- `node prototype/test_settings_view.mjs` green (the state-machine unit tests).
- `npm test` (the existing suite) + `npm run check` (version-drift lockstep) stay green.
- Trace: the API-key field renders for BOTH editions; no `100vh`/internal-scroll added; Reset/Clear are armed
  (no `confirm()`); step-5 copy is the honest-scope version; the two signals never interleave.
```
