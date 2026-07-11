# Claude Design Brief — Admin Settings (screen 5 of 8)

> **How to use this.** Hand this whole document + screenshots of the current Settings tab (and the
> Diagnostics tab, for the shared shell) to Claude Design and ask for 1–3 on-brand redesign proposals.
> This is the same method + quality bar as the pre-flight card and the four screens already redesigned
> (Page Picker · AI Insights · Breakdown Editor · Review & Push). **You already see the current UI from
> the screenshots** — so this brief spends its words on what a screenshot *can't* tell you: the goal, the
> audience's real fears, the ONE decision, and the high-value data the screen already computes but throws
> away. Design from what we HAVE + what the admin CARES ABOUT, not from what's on the screen today.

---

## THE PRODUCT (one paragraph)

**Spec2Tickets** is an Atlassian **Forge** app (Confluence Custom UI, React) that turns a Confluence spec
page into a structured **Jira breakdown** (1 Epic → Stories → Subtasks, with cross-feature dependencies,
sizing, labels) using **Anthropic Claude**. It is **BYOK** — the customer pastes their **own** Anthropic API
key and pays Anthropic pay-as-you-go directly. There is **no Spec2Tickets-operated backend** — everything
runs inside Forge + the customer's own Atlassian + their own Anthropic account. The **Advanced** edition
adds AI **test-case generation** + a **capacity planner**; **Standard** is the core breakdown+push. Both
editions are BYOK.

---

## THE SCREEN + THE ONE INSIGHT THAT SHOULD DRIVE THE REDESIGN

**Admin Settings** is the instance-wide configuration console: connect Anthropic (paste the BYOK key + Test
Connection), set the default Jira project key, define reusable **Project Context** profiles (a Claude-powered
"distill" that summarises a domain doc into a glossary the generator reuses), optionally declare required
Jira custom fields, and view the Account/Plan card. It is an **off-flow utility screen** reached from a
Settings entry-point in the app home + a Back button. Upstream: nothing. **Downstream: EVERYTHING** — a wrong
project key or a missing key breaks generation + push for *every* BA on the whole instance.

> ⭐ **THE REFRAME (the ONE insight): Settings is not a flat form — it is a PRE-FLIGHT CHECK FOR THE WHOLE
> INSTANCE.** The admin's real job isn't "fill in fields," it's **"prove Spec2Tickets is configured AND
> actually works for everyone before I walk away."** And the app already computes that exact verdict:
> **`runHealthCheck.ok`** — four probes that reuse the REAL production code paths (the same Anthropic call
> Test Connection makes, the same Confluence search CQL the app uses, the same `lookupProject` the push
> uses, a KVS round-trip) — so a green check is a **genuine end-to-end guarantee, not a mock.** It IS "what
> good looks like." **But today it's buried on the OTHER tab (Diagnostics).** *(Honest scope: `anthropic_key`
> + `kvs_rw` are install-wide, but `confluence_read` + `jira_project` run **`asUser()` = the ADMIN's own**
> Confluence/Jira access — so a green check proves "configured & verified from here," not literally every
> BA's permissions. Word the verdict **"verified,"** not "guaranteed for everyone.")* The redesign turns a flat form
> into a *verifiable configuration*: the pre-flight-card verdict pattern (which you already love from the
> ReadyScreen) applied to setup — "you're configured AND it works for everyone" or exactly what's missing,
> with each failed probe deep-linking to the field that fixes it.

---

## THE AUDIENCE + THEIR REAL FEARS

**The site admin, configuring once for the WHOLE instance.** Not the primary BA/PO who runs breakdowns —
a different person, with different stakes:

1. **Accountability.** A wrong project key or missing key breaks the flow for **every BA on the site**, and
   the admin gets blamed. So their win isn't "I configured it," it's **"I proved it works for everyone
   before I walk away."**
2. **Bill-shock by proxy.** They paste a key that bills **their own** Anthropic account pay-as-you-go, and
   worry *"will my whole company running this drain my credits?"* — yet the screen shows the app's plan
   price but **never an Anthropic-side cost anchor.** A concrete "~$X per breakdown on your key" number
   converts that fear into a fact.
3. **Non-expert anxiety.** The copy repeatedly reassures "no technical background needed" → the deepest win
   is being **LED** ("do this, now this, you're done"), not handed a flat form of six inputs.
4. **Privacy / trust.** They must be able to **defend the data path** to their security team ("page content
   flows Forge → Anthropic on your own key; there is no vendor backend"). A trust badge they can point at.

**A win FEELS like:** the calm certainty of *"the key is valid, the project exists, Confluence and Jira are
reachable, I know roughly what this costs, and I can hand this off — it works for the whole team."*

---

## THE ONE DECISION + WHAT "GOOD" LOOKS LIKE

**The decision:** *"Is Spec2Tickets fully configured to generate + push right now — and if not, exactly
what's missing?"*

**"Good" (machine-readable, already computed):** **all 4 health probes green + a valid project key + a
configured key** — i.e. `runHealthCheck.ok === true`. That single boolean **is the go/no-go verdict** — it
just lives on the wrong tab today. (A related authoritative boolean, **`getUsage.allowed`**, answers "can
this instance generate *right now*" — `true` for BYOK/trial, `false` only for the Unlicensed backstop; the
verdict hero should read `allowed`, not re-derive from `overLimit`.) Config completeness = **key + project (REQUIRED)**; **profiles +
custom-fields are OPTIONAL** (an admin with zero context profiles is still "fully configured" — do NOT
`AND` the optionals into the verdict).

---

## THE SCREEN TODAY (what the screenshots can't tell you)

- It is a **two-tab console**: `Settings | Diagnostics`. **Both tabs live in ONE file** and share the header
  — Diagnostics is not a separate screen in code (it is `DiagnosticsTab`, rendered inline). *This redesign
  is the **Settings tab**; keep the two-tab shell — Diagnostics is a separate future brief.*
- The Settings tab is a **flat form** at `max-width:640`: a title, an **Account/Plan card**, a **"Powered by
  Claude" card**, then six stacked inputs (API key + inline Test Connection + Clear-key link · default
  project key · Project Context profiles editor · a collapsed Advanced "required custom fields" JSON
  textarea), then **one shared message region** near the bottom, then Save + Reset.
- **The health check is on the OTHER tab.** `runHealthCheck` (the real end-to-end verifier) is invoked only
  from Diagnostics, never from Settings. The Settings tab has **no verify affordance at all** — you save and
  hope.
- **The Account card is all-or-nothing.** It is fed by `getUsage`, which returns `{error:'usage_unavailable'}`
  on *any* internal throw → the **entire plan/price/member-since hero silently vanishes** with no error
  shown. A degraded read looks identical to "no account."
- **One shared message region** is written by Save, Test Connection, Clear, Reset, AND the Distill pipeline —
  so a distill error and a save success **cannot coexist**, and **distill feedback for profile #5 flashes at
  the bottom of the form**, far from the profile it belongs to.
- **Clear-key and Reset use the native blocking `confirm()`** — which the codebase itself distrusts in the
  Forge sandbox (the Diagnostics "Clear" was deliberately hardened to an **armed two-step** *because*
  `confirm()` can be inert in the iframe). Inconsistent: the two instance-wide **irreversible** actions on
  Settings rely on the weaker pattern.
- The model name **"Claude Sonnet 4.6" is hard-coded** in the "Powered by Claude" card (a staleness risk).
  The **actual** billing model is available from Test Connection but only buried inside a message string.

---

## ⭐ THE FULL DATA PALETTE — by tier, EXHAUSTIVE

> Tier legend: **T0** = already in a resolver response the FE receives · **T1** = client-derivable pure JS ·
> **T2** = one small backend addition (a field / bounded call) · **T3** = needs an AI call. **Corrections
> vs the earlier seed brief are marked `[was T0 → T2]` etc. — they change what's cheap vs expensive.**

**From `getSettings` (key + project + profiles + custom-fields) — all T0:**
- `apiKeyConfigured` (bool — key stored yes/no) · `apiKeyLastSetAt` (ISO or null → "last set on …", T1 to
  format) · `defaultProjectKey` (string) · `contextProfiles` (`[{id,name,context}]`, full text) ·
  `requiredCustomFieldsJson` (raw JSON string, round-trip). **`saveSettings` also returns `apiKeyUpdated`
  (T0)** — the exact NOT→CONFIGURED transition a "led checklist" can animate.

**From `getUsage` (plan / quota / grandfathering) — all T0, but the whole object vanishes on any throw
(`{error:'usage_unavailable'}`):**
- `tierLabel` (**the plan name** — "Standard"/"Advanced") · `edition` (lowercase label, **currently unread**)
  · `keySource` (`'byok'` for every live customer, **unread**) · `hasTestCases` + **`hasPlanner`** (the two
  paid **capability flags** — `hasTestCases` is read, **`hasPlanner` is never read**) · `pricing[]` (the
  per-edition price strings — **there is no top-level `price` field; price lives only inside `pricing[]`**;
  price CAN be null for dormant/unlicensed tiers) · `memberSince` + `memberSinceLabel` (**= install
  first-seen — the grandfathering signal, not a vanity date**) · quota block — **`allowed`** (the
  authoritative "can generate right now" boolean: `true` for BYOK/trial, `false` only for Unlicensed) ·
  **`tier`** (the stable machine key — `byokPro`/`byokAdvanced`/`unlicensed` — the ONLY field that actually
  distinguishes blocked-Unlicensed from a paid/trial tier; `tierLabel`/`edition` are display labels) ·
  `limit` null=unlimited / 0=blocked · `unlimited` · `used` · `remaining` · `resetsAtLabel` · `overLimit` ·
  `enforcementMode` · `fairUse` — **currently the `!unlimited` rows are DORMANT** (both live editions are
  unlimited BYOK), so `used`/`limit` render nothing today.

**From `testConnection` — T0 status, T1/T2 model:**
- `status` ok/error · on error a normalized `code` + `detail` (NOT_CONFIGURED / BACKEND_AUTH_FAILED (401) /
  INSUFFICIENT_CREDITS (402) / RATE_LIMITED (429) / BACKEND_UNREACHABLE / UNEXPECTED) · **the actual Claude
  model** `[was T0 → T1]` — it is returned by the client but the resolver **discards the structured field
  and only interpolates it into the success message string** ("Connected to Anthropic API (claude-sonnet-4-6)").
  Parsing it out is T1; exposing it as a clean field is a trivial T2. NOTE: a **storage-fault on the key read**
  already surfaces here honestly (as `UNEXPECTED` + a `KEY_STORAGE_FAILED_DETAIL` message) — so the third
  key-state is *partly* surfaced today; make it a distinct **visual** state, don't reinvent the text.

**From `runHealthCheck` — T0, but on the Diagnostics tab (promoting to Settings = call the same resolver, no
new backend):**
- `{ ok, probes:[{name, ok, code}] }` — **4 probes in order**: `anthropic_key` (reuses the real Test
  Connection path) · `confluence_read` (the real search CQL + scope, **`asUser`**) · `jira_project` (the real
  `lookupProject` on the configured default key, **`asUser`**) · `kvs_rw` (a content-free storage round-trip).
  `ok` = every probe ok. ⚠ **The probe `name` is raw snake_case** (`anthropic_key`…) with NO humanize map —
  a name→label map is a small NEW T1. Each failed `code` already maps (via `classText(code)` in
  `lib/diagnosticsView.js`) to a humanized **`{title, hint}`** (e.g. `no_project_key` → "Set one in
  Settings", `project_not_found` → "Check the Default Jira Project Key", `egress_blocked` → "Forge blocked
  an outbound request… contact support").
- ⚠ **The probe-code → field deep-link is PARTIAL, not a clean lookup** — only the **field-fixable** codes
  jump to a field: `not_configured` / `auth_rejected` / `key_storage_failed` → **API Key**; `no_project_key`
  / `project_not_found` → **Default Jira Project Key**. The rest are **NOT field-fixable** (show the hint, no
  jump): `permission_denied` (Jira ACL — the key is fine; jumping to project-key would be **WRONG**),
  `insufficient_credits` / `rate_limited` (Anthropic billing / wait), `network_failure` / `confluence_http` /
  `egress_blocked` (connectivity / app-config / support), `kvs_failed` (transient storage),
  `managed_unavailable` (add a key). ⚠ `jira_project` only does a project GET, so its `jira_http` has
  **nothing to do with custom fields** — do NOT deep-link it to the custom-fields textarea.

**Cost anchor `[was T0 → T2]` — the correction that matters:**
- The figures **~$0.118 avg / ~$0.24 max per breakdown** (and test-cases ~$1–3.67) exist **only as
  non-exported code comments** (`usage.js`), NOT as data any resolver returns. (A second, independently
  derived figure — ~$0.14 for a 22-feature breakdown — corroborates in `anthropic_client.js`, which
  strengthens the case for a hard-coded honest anchor.) Surfacing a "~$X per breakdown
  on your key" anchor is therefore a **small T2** (add a constant/field) — or simply a **hard-coded honest FE
  string** ("typically ~$0.12, up to ~$0.24 per breakdown on your own Anthropic key"). The real
  `estimateCost` is **post-run only** (T3 — needs a completed job's token usage), so it can't power a static
  Settings anchor.

**Caps — T0, but the FE mirror is PARTIAL (a real correction):**
- Per-profile **20 000 chars** → FE mirror is a **visual-only** red counter, **NOT save-blocked** (the
  backend rejects on Save) · **max 20 profiles** → FE **IS** client-blocked ("+ Add" hides at 20) · profile
  name **60 chars** → a hard `maxLength` · aggregate settings record **~200 KB** → **BACKEND-ONLY, no FE
  mirror** (the client never pre-empts it; it can ONLY arrive as a post-Save error, worded "~195 KB"). ⇒ do
  NOT design an inline 200 KB counter assuming the constant is shared client-side — **it isn't.**

**The Distill pipeline (Project Context "Summarize with Claude") — T3 (AI):**
- `startDistillSession` → `{sessionId, totalSteps:6, categories[labels]}`; the UI loops `distillStep(0..5)`
  over **6 fixed categories** (Domain · Glossary · Personas · Tech · Regulatory · Conventions), one sync
  Haiku call each. Progress `{done:false, step, label, nextLabel}`; final `{done:true, profile, truncated,
  overflowTrimmed, droppedCategories}`. **Retry resumes from the failed step** (same session).
  `droppedCategories` = an amber "these categories weren't extracted" signal; `overflowTrimmed`/`truncated`
  = the merged profile hit the char budget. **These are correctness features — keep them.**

---

## OPEN DESIGN QUESTIONS (give us your take; recommendations included)

1. **How does the health check run on Settings — auto or on demand?** It's a live probe that hits Anthropic
   + Confluence + Jira + KVS (a few seconds, a near-zero-cost Anthropic ping). **Recommendation:** a
   prominent **"Verify configuration"** button that populates the verdict hero; the hero's default (unrun)
   state reads "Not verified yet — run the check" rather than a fake green. Optionally auto-run **once** the
   moment config first becomes complete (key + project both set). Don't silently re-probe on every open.
2. **Does the Settings verdict duplicate the Diagnostics health panel?** **Recommendation:** no — split the
   jobs. **Settings** = the *configuration* checklist/verdict (Key ✓ · Project ✓ · Context ○ · Custom-fields
   ○ + a "Verify" that runs the 4 probes and **deep-links each failure to its field**). **Diagnostics** keeps
   the raw probe panel + the incident ledger. They share the same `runHealthCheck` underneath.
3. **Cost anchor precision.** A static honest "typically ~$0.12, up to ~$0.24 per breakdown on your own key"
   (T2/hard-coded) vs the customer's actual recent spend (T3/aggregate). **Recommendation:** the static
   typical/max anchor — it resolves the bill-shock fear cheaply and honestly; per-customer actuals are a
   later, dearer add.
4. **The Account panel silent-vanish.** Should the plan/price/member-since **degrade gracefully** (show what
   loaded + a "couldn't load plan details" note) instead of the whole hero silently disappearing on a
   `getUsage` throw? **Recommendation:** yes — make the silent-failure visibly distinct from "no account."
5. **Density.** Context profiles cap at 20; a typical workspace is likely **1–5**. **Recommendation:** design
   the profiles list for 1–5 (a lightweight collapsed-summary row per profile with an expand-to-edit), and
   let it degrade gracefully toward 20 — but keep the distill **retry** + **dropped-category** signals
   visible.

---

## THE DESIGN SYSTEM (moodboard — non-negotiable)

Blue-on-white monochrome + glassmorphism. Navy `#0a2440` (text/headings), steel `#5483B3`, sky-steel
`#7DA0CA`, ice `#C1E8FF` (borders/section fills); page on a faint ice wash `#f7faff`. System font stack (no
paid fonts) — headings heavier/larger/tight navy; body 1.5–1.6 line-height. Primitives already in code:
**`ScreenHeader`**, **`MoodCard`** (glass, 3 densities), **`SignalCallout`/`SignalIcon`** (traffic-light),
`glassSurface`, the `Stepper` (from the wizard kit). **The pre-flight card is the house pattern** — a
tri-state verdict + answer tiles + on-demand detail from already-computed facts.

**Fixed rules (do not break):**
- **Action-button colours are semantic — pick by INTENT:** **green** = commit/submit (**Save**), **blue** =
  navigate/open (external links, "Get an API key"), **red** = destructive (**Clear key**, **Reset**).
- **Severity is a true signal:** the WORDS stay dark (`--s2j-text`) for WCAG on the near-white glass; **the
  colour rides the ICON/tint** (red triangle / amber triangle / blue info-circle / green check).
- **Faint ice tints are invisible on white** — make glass visible via the ice→white gradient (the moodboard
  is imposed at the token/kit level; reuse `MoodCard`/`glassSurface`, don't hand-roll flat near-white fills).
- **Forge iframe sizes to CONTENT → page-scroll only.** **Never** `100vh`, **never** an internal scroll trap
  (`max-height` + `overflow:auto`). The profile focus-editor is a **fixed overlay** (acceptable), but watch
  its `vh` heights. Centre loading via padding, not `100vh`.
- **English** copy; **system font stack** only.
- **A11y:** colour never the only signal; real `<button>`s + `aria`; keyboard + SR parity; **no actionable
  hint hidden only in a hover `title` tooltip** (a recurring gap here — the distill/retry/expand hints are
  hover-only today).

---

## STATES THE DESIGN MUST HANDLE (exhaustive — incl. the silent-failure traps)

- **API key: CONFIGURED vs NOT vs STORAGE-FAULT.** Today there is **no distinct storage-fault UI** — a
  failed secret read looks identical to "not configured." Make the third state visible (the health check's
  `key_storage_failed` code exists for exactly this).
- **Account panel PRESENT vs ABSENT (silent).** `getUsage` throws → whole hero gone, no error (see Q4).
- **Standard vs Advanced.** Only `hasTestCases`/`hasPlanner` should gate anything — **never the edition
  label**. (The **API key field must show for BOTH** — see Fixed.)
- **Trial vs Unlicensed — DISTINCT, do NOT conflate.** A 30-day Atlassian **trial reads as an ACTIVE
  license → a PAID tier** (unlimited, `allowed:true`) — NOT limit-0. The **Unlicensed** backstop (`limit:0`,
  `allowed:false`) is ONLY "no subscription AND no trial." Today Unlicensed renders a **half-broken** Account
  card ("Plan: Unlicensed · 0 breakdowns this month" — **no price, no CTA, no explanation you're blocked**) →
  design a graceful, honest "not licensed / evaluate" state; keep the trial as a normal paid tier.
- **Distill:** idle · **"can't distill yet"** (Distill is gated on the **STORED** key, not the typed input —
  a user who pasted + Tested but hasn't **Saved** cannot distill; ⚠ one entry point's disabled tooltip states
  the WRONG reason — "add your context text" instead of "save your API key" — fix in the rework) ·
  in-progress (1/6…6/6) · **failed mid-pipeline → "Retry from step N"** · **dropped-categories** (amber, on
  the profile) · overflow-trimmed / truncated.
- **Save rejection (some ALREADY inline-validated):** malformed key (wrong `sk-ant-` prefix / < 20 chars —
  **these two ARE already client-validated pre-Save**, the closest existing thing to inline validation) ·
  missing/invalid project key · invalid custom-fields JSON · over-char (per-profile > 20 000, backend) ·
  over-aggregate-bytes (~200 KB, backend-only). Today all surface through the ONE shared bottom region —
  **inline per-field validation** is the win.
- **Save PARTIAL-COMMIT (silent divergence).** If the new key stores but the settings-record write then
  throws, the **secret is committed while project-key/profiles are NOT**, and the FE's `apiKeyConfigured`
  silently diverges from what persisted (generic "storage error"). The one case where screen state ≠ reality.
- **Health check:** not-run (default) · running · all-passed (green verdict) · **some-failed** (each shows its
  humanized hint; the **field-fixable** codes deep-link to a field, the rest show the hint only — never
  deep-link `permission_denied` / billing / network / storage to a field) · could-not-run (fail-open — the
  resolver may return partial probes).
- **Clear key / Reset:** irreversible, instance-wide (a co-admin can wipe the shared key for everyone) →
  armed two-step, never a maybe-inert `confirm()`.

---

## FIXED — DO NOT REDESIGN

- The **two-tab shell** (`Settings | Diagnostics`) — Diagnostics is a separate brief; keep the header.
- **The API-key field shows for EVERY edition** (both editions are BYOK). A redesign that hides/collapses it
  for Advanced re-introduces the exact dead-end the v6 edition-decouple fixed — **the #1 non-negotiable.**
- **Feature gating keys on capability FLAGS (`hasTestCases`/`hasPlanner`), NEVER the edition label.**
- **Config completeness = key + project (REQUIRED); profiles + custom-fields are OPTIONAL.** Don't AND the
  optionals into the verdict.
- **Distill stays a 6-call chunked pipeline** with progress / retry / dropped-category signals (correctness).
- The stored **API key is resolver-only** — never echo the key value back; the field is write-only + a
  "configured" indicator.
- **Green = Save · blue = links/open · red = Clear/Reset.** Clear/Reset use the **armed two-step**.
- Frontend caps mirror server caps **only partially** — 20 000 (visual) / 20 (blocked) / 60 (`maxLength`);
  the **~200 KB aggregate is backend-only** (no FE mirror). Keep the three shared ones in sync.
- **Page-scroll, no `100vh`, no internal scroll trap.**

---

## WHAT WE WANT BACK

1–3 on-brand redesign proposals of the **Settings tab** (within the existing two-tab shell), each a fast
glance, reusing the **pre-flight card verdict + answer-tiles + on-demand-detail** pattern. Label each element
with its data tier (T0/T1/T2/T3). Specifically show us:

- **A "Configuration status" hero** = the pre-flight card applied to setup: a tri-state verdict + answer
  tiles (**Key ✓ · Project ✓ · Context ○ · Custom-fields ○ · Verified ✓/○**), all T0/T1, with a **"Verify
  configuration"** action that runs the 4 real probes and, on failure, **deep-links the field-fixable probes
  (key/project) to their field and shows an honest hint for the rest** (billing / permission / network /
  storage — never a wrong field jump).
- **A cost anchor** ("~$0.12 typical / up to ~$0.24 per breakdown on your own Anthropic key") that answers
  the bill-shock fear (T2/hard-coded).
- **A "your data path" trust badge** the admin can show security (BYOK · page content → Forge → Anthropic on
  your key · no vendor backend).
- **A led, checklist-style setup** for the non-expert admin ("do this → now this → you're done"), not a flat
  form.
- **Consolidation:** fold the two top cards + de-duplicate the price (it renders in several places from one
  source); **inline per-field validation** instead of one shared bottom message region; a **lighter Project
  Context editor** (collapsed-summary rows + expand-to-edit, keeping the distill retry/dropped signals);
  **Clear/Reset unified onto the armed two-step**; the real model name from Test Connection instead of the
  hard-coded string.

The north star: a setup console that says **"you're configured AND it's verified working"** (or exactly
what's missing) at a glance — a **pre-flight for configuration**, with the health check + a cost anchor built
in. *(Word the verdict "verified," not "guaranteed for everyone" — 2 of the 4 probes check the admin's own
Confluence/Jira session, not every BA's.)*
