# Fix-Spec — AdminSettings redesign audit fixes (screen 5)

> Apply these 10 fixes to `static/hello-world/src/components/AdminSettings.jsx`. The deep-audit + fresh-army
> (9 lenses, skeptic-verified) found them — all HONESTY / CONSISTENCY / SPEC-FIDELITY defects in the display
> layer (0 crash, 0 data-loss, 0 broken wiring). The load-bearing state machine (`lib/settingsView.js`) + the
> backend (`src/index.js` saveSettings partial-commit) are ALREADY fixed — DO NOT touch them. Build the RIGHT
> way (`npm run build > log 2>&1; echo NPM_EXIT=$?; grep Compiled` — never `| tail`; ASCII quotes only).

## The new `lib/settingsView.js` API you must use (already shipped + tested 74/74)
- `computeConfigVerdict({...})` now returns `verified: 'not_run' | 'verified' | 'failed' | 'unavailable'`
  (`'unavailable'` = the check could not complete → level `'warning'`, NOT a counted failure).
- NEW `computeReady({ licenseGate, verdict })` → boolean (`licenseGate.state !== 'blocked' && verdict.configComplete && verdict.verified === 'verified'`).
- `computeTiles({..., licenseBlocked })` — when `licenseBlocked` true the VERIFIED tile is neutral "Not verified · plan inactive"; a `verified: 'unavailable'` verdict → VERIFIED tile warn "Could not run · re-verify".
- The backend `saveSettings` now returns `apiKeyUpdated` on the partial-commit ERROR return too (+ an honest message).

---

## FIX A1 (HIGH) — a blocked/unlicensed instance must NOT read "done/verified/all set"
The license gate is folded into the hero + the Not-licensed card but NOT the stepper header, the VERIFIED
tile, or step-5 → a blocked instance with passing (license-independent) probes shows "All set · verified" +
green "You're done".
- Import `computeReady` from `../lib/settingsView`.
- Add near the other derived signals (around line 562-567): `const blocked = licenseGate.state === "blocked";`
  and REPLACE `const handoffVerified = verdict.verified === "verified";` with
  `const ready = computeReady({ licenseGate, verdict });`
- `computeTiles(...)` call (line 555): add `licenseBlocked: blocked,` to the argument object.
- Stepper header (line ~746): change `{verdict.configComplete && handoffVerified ? (<strong>All set · verified</strong>) : (...)}` to key off `ready` instead of `verdict.configComplete && handoffVerified`.
- Step 5 (line ~937) becomes THREE-way. `done={ready}`. Body:
  - `ready` → the existing "You're done ... each BA still needs their own Confluence/Jira access." copy.
  - else if `blocked` → a NON-green neutral note (use plain `TYPE.micro` text, NO green, NO verify button):
    "Generation is blocked — see the **Not licensed** notice above. Your key and project are saved and will
    work the moment a plan is active."
  - else → the existing "Run the check to finish" + Verify button branch.

## FIX A2 + A4 + A5 (MED) — verdict/hero/auto-verify must key on the SAVED project, not the live input
`computeConfigVerdict`, the hero's interpolated project name, the auto-verify `complete` gate, and the Verify
gate all read the LIVE `defaultProjectKey` input (updated on every keystroke), while `runHealthCheck` probes
the PERSISTED project → typing an unsaved project reads "complete/verified" against a project the check never
ran; and the green hero interpolates the live (unsaved) key.
- Add state: `const [savedProjectKey, setSavedProjectKey] = useState("");`
- In the getSettings load effect (~line 168): after `setDefaultProjectKey`, also `setSavedProjectKey(settings?.defaultProjectKey || "");`
- In `handleSave` success branch (~line 343): add `setSavedProjectKey(cleanProjectKey);`
- Add derived: `const savedProjectClean = (savedProjectKey || "").trim().toUpperCase();`
- `computeConfigVerdict(...)` (line 549): change `projectKey: defaultProjectKey` → `projectKey: savedProjectKey`.
- `computeTiles(...)` (line 556): change `projectKey: projectKeyClean` → `projectKey: savedProjectClean` (the
  PROJECT tile shows the SAVED destination).
- `heroBanner(...)` (line 562): change `projectKey: projectKeyClean` → `projectKey: savedProjectClean`.
- `projectStepDone` (line 564): change to `const projectStepDone = !!savedProjectClean;`
- Auto-verify `complete` (line 217): change `!!(defaultProjectKey || "").trim()` → `!!savedProjectClean`.
- KEEP the project INPUT bound to the live `defaultProjectKey` + its live `projectKeyClean`/`projectValid`
  inline hint (that is the edit-time hint — correct as-is). Only the VERDICT/HERO/TILE/AUTO-VERIFY move to saved.
- (handleSave already `setHealth(null); setVerifiedOnce(false)` on save, so a saved project change re-verifies.)

## FIX A3 (MED) — a health check that COULD NOT RUN must not read "1 failed"
`runHealthCheck` throw / non-array → `health={ok:false,probes:[],failed:true}`. settingsView now maps that to
`verified: 'unavailable'` (done). Add the hero branch:
- In `heroBanner` (line ~2216), BEFORE the `if (v.verified === "failed")` branch, add:
  ```
  if (v.verified === "unavailable") {
    return { kind: "warning", title: "Verification could not run",
      body: "The health check did not complete against your session — Re-verify in a moment." };
  }
  ```
- (The VERIFIED tile already reads "Could not run" via computeTiles; the detail panel already special-cases
  `health.failed`. No other change.)

## FIX A6 (MED) — keyStorageFault is sticky
`runVerify` clears the flag only when the key probe is `ok`; a later verify that fails for a NON-storage reason
leaves it set, so the hero keeps showing "Can't read your API key".
- In `runVerify` (line ~200): change `else if (keyProbe && keyProbe.ok) setKeyStorageFault(false);` to
  `else if (keyProbe && keyProbe.code !== "key_storage_failed") setKeyStorageFault(false);`

## FIX B1 (MED) — the "PUSHES" tile must read the aggregate, not the capped ledger
`push_completed` is info-level with a unique ref → evicted FIRST by the 50-record ring, so `cleanPushes`
collapses toward 0 while `partial_push` (error) survives → a healthy instance reads "0 clean · N partial".
- Replace the `cleanPushes`/`partialPushes` computed from `allRecs` (lines ~1290-1291) with the install-wide,
  monotonic aggregate sidecar:
  ```
  const aggPush = data?.aggregate || {};
  const cleanPushes = Number(aggPush.push_completed?.count) || 0;
  const partialPushes = Number(aggPush.partial_push?.count) || 0;
  ```
  (`partial_push` is the real emitted partial CLASS; orphaned_subtasks/link_unresolved/links_api_failed ride as
  counts, not classes, so they are not aggregate keys — do not sum them.)
- The `pushesTile` (line ~1313): relabel + honest sub + a 3-way status:
  ```
  const pushesTile = {
    label: "PUSHES · ALL TIME",
    value: `${cleanPushes} clean · ${partialPushes} partial`,
    sub: "site-wide",
    status: partialPushes > 0 ? "warn" : cleanPushes > 0 ? "ok" : "neutral",
  };
  ```
- Remove the now-unused `PARTIAL_PUSH_CLASSES` array (lines ~1282-1289) IF nothing else references it. KEEP
  `openIncidents` (it honestly counts error/warn rows in the current view).

## FIX B2 (LOW) — silent error-row title is red-on-red-bg (WCAG ~3.1:1)
For a `silent` (surfaced===false) error row, DiagnosticRow paints the title `--s2j-red` on the new
`--s2j-red-bg` tint — below WCAG AA, and it violates "severity = colour on the ICON, words stay dark on a tint".
- In `DiagnosticRow`, when `silent` is true: keep the title DARK (`var(--s2j-text)`) and put the red on an
  ICON + the border. Change the `titleColor` (line ~1016) so a silent row uses `var(--s2j-text)` (not red),
  and render a `<SignalIcon kind="error" size={13} />` immediately before the title text (line ~1033) when
  `silent`. Keep `background: red-bg` + `borderLeft: red`. (Non-silent rows unchanged.)

## FIX C1 (MED) — field validation must render inline, not in the shared bottom message
§4.6/§4.8: key-format, project-pattern, and custom-fields-JSON validation must appear AT the field.
- Add state `const [fieldErrors, setFieldErrors] = useState({});` (shape `{ apiKey?, project?, customFields? }`).
- In `handleSave`, at the top set `setFieldErrors({});`. Then REPLACE the three `setMessage({type:'error',...}); return;`
  for (a) the `sk-ant-` prefix + too-short key checks → `setFieldErrors({ apiKey: <that text> }); return;`
  (b) the project-pattern check → `setFieldErrors({ project: <that text> }); return;`
  (c) the custom-fields JSON parse + non-object checks → `setFieldErrors({ customFields: <that text> }); return;`
  (The "Jira Project Key is required" empty check + the no-key `NOT_CONFIGURED` check may stay as fieldErrors on
  project / apiKey respectively for consistency.)
- Render inline: under the key input (step 1) show `fieldErrors.apiKey` as a `SignalCallout kind="error" fontSize={12.5}`; under the custom-fields textarea (step 4) show `fieldErrors.customFields`; under the project input (step 2) show `fieldErrors.project` (a red `TYPE.micro` line beneath the existing live hint, or reuse the hint slot).
- Clear each on edit: `handleApiKeyChange` → also clear `fieldErrors.apiKey`; the project `onChange` → clear `fieldErrors.project`; the custom-fields `onChange` → clear `fieldErrors.customFields`. (Keep the shared `message` region ONLY for Save-level success/failure + Clear/Reset.)

## FIX C2 (LOW) — surface the §5.13 partial-commit honest state
The backend now returns `apiKeyUpdated` on the partial-commit error return (+ an honest message).
- In `handleSave`'s error branch (line ~340), before `setMessage`, add:
  ```
  if (result.apiKeyUpdated) {
    // Partial commit: the KEY committed but the settings record (incl. project) did NOT. Reflect that the
    // key IS now stored; do NOT touch savedProjectKey (the project did not persist).
    setApiKeyConfigured(true);
    setApiKeyLastSetAt(new Date().toISOString());
    setAnthropicApiKey("");
    setKeyStorageFault(false);
  }
  setMessage({ type: "error", text: result.error });
  ```
  The honest backend message already explains the partial commit; the FE just reflects that the key is stored.

## FIX D2 (LOW) — delete dead `VERDICT_KIND`
`const VERDICT_KIND = {...}` (line ~29) is declared but never referenced (heroBanner returns bespoke kinds per
state). Delete the constant (POLICY §3.5 — dead code).

## FIX E1 (LOW) — armed-timers not cleared on unmount
Add an unmount cleanup in `AdminSettings`:
`useEffect(() => () => { clearTimeout(clearKeyTimer.current); clearTimeout(resetTimer.current); }, []);`
And in `DiagnosticsTab` add `useEffect(() => () => { clearTimeout(clearArmTimer.current); }, []);`

## DO NOT
- Do NOT touch `lib/settingsView.js` (already fixed + tested) or the `src/index.js` saveSettings (already
  fixed). Do NOT dedup UPGRADE_URL (accepted residual — a placeholder that changes at launch). Do NOT commit
  or `forge deploy`.

## VERIFY
- `cd static/hello-world && npm run build > /tmp/fixbuild.log 2>&1; echo NPM_EXIT=$?; grep -c "Compiled" /tmp/fixbuild.log; grep -iE "error|failed" /tmp/fixbuild.log | head` (never `| tail`). Must be Compiled + NPM_EXIT=0.
- Smart-quote sweep on AdminSettings.jsx must be empty (ASCII only).
- `node prototype/test_settings_view.mjs` stays 74/74; `npm run check` 11/11; `npm test` green.
- Report each fix applied + any deviation/judgment call.
