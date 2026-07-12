# DEV Live-Acceptance — Standard-only + $5 managed trial credit (the "stranger test")

> Goal: play a BRAND-NEW customer end-to-end on `spec2jira-dev.atlassian.net`. A stranger installs the app,
> is offered the frictionless $5 managed trial (no key setup), sees value, spends the $5, and is routed to
> BYOK. Also verify Standard-only (everything included, no Advanced upsells) and the billing correctness the
> offline tests can't (real dollars metered). Commit `8a374db`, branch `feature/UI-UX-improvements`.
>
> ⭐ THE ONE LOAD-BEARING UNKNOWN = does `license.isEvaluation` become true on dev? The empirical proof is the
> **"$X of $5 free trial credit left" badge on the Ready screen** — if it appears, the trial gate fired; if
> not, isEvaluation is false/undefined on this install mode (see Phase 1 fallback). Fail-safe polarity:
> no trial ⇒ no free credit ⇒ BYOK-required (safe), never a leak.

Legend: `[ ]` to do · `[x]` pass · `[!]` fail (note it) · `[~]` pass-with-finding

---

## Phase 0 — Prep DEV to look like a fresh customer

Order matters (vars take effect only on a deploy; a fresh install wipes KVS = fresh $5 + no stored BYOK key).

```powershell
cd "C:\Software Engineer\Success\Spec2Tickets\spec2jira-forge\static\hello-world"
npm run build                     # fresh Custom UI bundle (build/ is gitignored)
cd ..
# 1) our managed key — use a FUNDED but low-budget Anthropic key (spend is bounded by the grant below anyway)
forge variables set --environment development MANAGED_ANTHROPIC_KEY sk-ant-... --encrypt
# 2) a SMALL grant so you can watch exhaustion cheaply (default is 5). 0.30–0.50 = ~1–2 breakdowns.
forge variables set --environment development MANAGED_TRIAL_CREDIT_USD 0.50
forge deploy                      # deploy the new code + make the vars live
# 3) wipe the install (KVS) so the ledger + BYOK key are truly fresh, then reinstall as a TRIAL
forge uninstall                   # pick spec2jira-dev, Confluence (repeat for Jira)
forge install --environment development --site spec2jira-dev.atlassian.net --product confluence --license trial
forge install --environment development --site spec2jira-dev.atlassian.net --product jira       --license trial
forge logs --since 15m            # keep this open in a second terminal during the test
```

- [ ] `MANAGED_ANTHROPIC_KEY` set + funded; `MANAGED_TRIAL_CREDIT_USD=0.50`; `forge variables list -e development` shows both.
- [ ] Deploy succeeded; app uninstalled then re-installed `--license trial` on BOTH products (2 entries in Manage Apps = normal for a cross-product app).
- [ ] ⚠ Do NOT save a BYOK key in Settings yet — the stranger has none.

> Note: `--license trial` is the documented way to simulate the 30-day evaluation. To switch license states
> later you must `forge uninstall` + fresh `forge install --license <value>` (values: `trial`, `active`,
> `standard`, `inactive` — lowercase); `install --upgrade --license` is a no-op (hard-won, CLAUDE.md).

---

## Phase 1 — Frictionless first run (THE headline — no key required)

- [ ] Open the app (Confluence → Spec2Tickets). **You are NOT sent to a "configure your API key" setup wall.** ⭐ This is the whole point — a fresh trial user lands on the picker/ready flow, not a key gate.
- [ ] On the Ready screen after opening a page, the plan badge shows **"$0.50 of $0.50 free trial credit left"** (or your grant). ⭐⭐ **This badge appearing PROVES `isEvaluation` is true and the managed path is live.** If it does NOT appear → see the fallback below.
- [ ] The badge is NOT "unlimited breakdowns" (the trial-credit branch must win over the unlimited branch).

**Fallback if the badge does NOT appear (isEvaluation not true on this install mode):**
- [ ] Check `forge logs` for `[resolveAnthropicKey] managed trial credit resolved` when you Generate. Absent ⇒ the trial gate didn't fire.
- [ ] Try re-installing with a different license value, and confirm `MANAGED_ANTHROPIC_KEY` is actually set (`forge variables list`). If isEvaluation genuinely can't be simulated on dev, you can still test the BYOK + paid paths (Phase 7) and the FE, and rely on a REAL Marketplace trial in production for the managed path — flag it as the one un-dev-testable item.

---

## Phase 2 — Generate + push on the managed key (the value moment)

- [ ] Pick a real spec page → Generate AI Breakdown. It runs WITHOUT a BYOK key. `forge logs` shows `keySource=managed` / `[resolveAnthropicKey] managed trial credit resolved`.
- [ ] Breakdown completes (Epic + Stories + Subtasks). The Ready badge now shows LESS credit left (e.g. "$0.35 of $0.50") — the ledger reconciled to the real cost.
- [ ] Continue to Review → Confirm → **Create in Jira.** Because the stranger set no default project key, expect the **project-key prompt**: you land on a setup screen whose heading reads **"Set your Jira project key to continue"** (NOT "Add your API key") — the message + heading are about the PROJECT key, not an Anthropic key.
- [ ] Open Settings → set the Default Jira Project Key (e.g. `SDTY`) → go back → push succeeds (Epic + Stories + Subtasks land in Jira).

---

## Phase 3 — Standard = EVERYTHING (no Advanced upsells anywhere)

- [ ] On the Confirm/Review screen the **"Generate Test Cases"** action is available (NOT an "Advanced feature" chip). A pre-flight cost estimate shows ("up to ~$X").
- [ ] Generate test cases → they produce (BA-grade Gherkin/CSV). Edit a case + Save works; per-story Regenerate works. No "Read-only — Standard edition" / "Upgrade to Advanced" callout.
- [ ] The **Capacity Planner** ("Plan capacity") is available (NOT "— Advanced"); generate a plan → it works.
- [ ] Sweep for any residual upsell: ConfirmScreen, LimitReachedScreen, the Settings → Account panel (PlanModelCard reads "Your Standard plan includes everything: … test-case generation, and the capacity planner." — NOT a circular "Everything in Standard, plus …"). No "Upgrade to Advanced" / blank-price anywhere.
- [ ] ⚠ Note: each managed test-gen / plan also spends the $5 credit — watch the badge drop after each.

---

## Phase 4 — Metering + exhaustion → the BYOK hand-off

- [ ] Keep generating (breakdowns / test-cases) until the badge reaches ~$0. `forge logs` shows the reconcile charges.
- [ ] On the next Generate after exhaustion → a **friendly** prompt: "You've used your $5 free trial credit — add your own Anthropic API key to keep going (unlimited, you pay Anthropic directly)." (routed to setup — an API-KEY heading this time, correctly).
- [ ] Open Settings → paste your OWN Anthropic API key → Test Connection OK → save.
- [ ] Generate again → it now runs on YOUR key (`forge logs` shows `keySource=byok`); the "$X of $5" badge is GONE (paid/BYOK, no managed credit).
- [ ] (Optional) A trial user who sets a BYOK key BEFORE exhausting → immediately uses their own key (managed is only the no-key onboarding crutch): remove the key, reinstall fresh, this time set the key first, confirm no badge + `keySource=byok`.

---

## Phase 5 — Hard-ceiling gate on the expensive surface (test-gen)

- [ ] Fresh trial install (small grant, e.g. 0.30). Pick a LARGE breakdown (many stories) and try Generate Test Cases on the MANAGED credit.
- [ ] Expect a block: **"This test-case run needs about $X … but only about $Y of your free trial credit is left. Add your own Anthropic API key…"** — the pre-flight gate refused a run that would overshoot. ⭐ This proves the $5/$10 ceiling holds on the one surface whose actual can dwarf its estimate.
- [ ] A SMALL breakdown's test-gen still proceeds (the gate only blocks worst-case-over-ceiling, not big-but-cheap runs).

---

## Phase 6 — Ledger / cost correctness (the authority live-acceptance adds)

- [ ] After a few managed runs, compare the ledger's implied spend (grant − "left" on the badge) against the **Anthropic console** dollar for `MANAGED_ANTHROPIC_KEY` over the test window — they should track within batch-pricing tolerance. ⭐ Offline tests can't verify real-$ metering; this is the point of live-acceptance.
- [ ] `forge logs` — no `[trialCredit] … failed` errors; each finalize shows a reconcile. A managed cycle-repair (a breakdown with a dependency cycle) also charges (`cyc:` — verify via the ledger drop, small).
- [ ] Re-generate test-cases after editing an AC on the SAME breakdown → BOTH runs' cost is metered (the per-attempt marker fix — the 2nd run's actual is NOT dropped).

---

## Phase 7 — Paid customer path (isEvaluation false ⇒ always BYOK)

- [ ] `forge uninstall` → `forge install --license active` (or `standard`) — a PAID, non-trial license.
- [ ] Open the app with NO BYOK key → you ARE asked to add a key (managed is NOT offered to a paid user); no "$X of $5" badge. A paid-no-key user gets the FRIENDLY BYOK prompt, not a raw "not configured" dead-end.
- [ ] Add a BYOK key → everything works on the customer's key (unlimited). All features present (Standard = everything).

---

## Phase 8 — Safety / degradation

- [ ] Unset the managed key: `forge variables unset --environment development MANAGED_ANTHROPIC_KEY` → `forge deploy` → fresh `--license trial` install. Open the app with no BYOK key → the app degrades to BYOK-required (no crash, no leak) — the managed path simply isn't offered when the key is absent.
- [ ] (Re-set `MANAGED_ANTHROPIC_KEY` + `forge deploy` afterwards if you want to keep testing the managed path.)

---

## Sign-off

- Overall verdict: [ ] SHIP · [ ] SHIP-WITH-FINDINGS · [ ] BLOCK
- ⭐ isEvaluation on dev: [ ] confirmed via the badge · [ ] NOT simulatable on dev (managed path deferred to a real prod trial — the one un-dev-testable item)
- Findings / notes:

## ⚠ Reset DEV after testing
- [ ] `forge variables set --environment development MANAGED_TRIAL_CREDIT_USD 5` (or unset to default 5).
- [ ] Decide whether to keep/unset `MANAGED_ANTHROPIC_KEY` on dev.
- [ ] Re-install with your normal dev license if you changed it.

> ⚠ Reminder for PRODUCTION (separate, later): fund + set `MANAGED_ANTHROPIC_KEY` on prod (currently
> recommended UNSET), keep `MANAGED_TRIAL_CREDIT_USD=5`, retire the Advanced edition in the Marketplace
> portal, re-activate the Managed DPA/compliance copy on the site, and verify `isEvaluation` on a real
> Marketplace trial. Bump BOTH `package.json` + `DIAG_APP_VERSION` in the release commit. 0 new scopes
> → no customer re-consent (verify the manifest diff).
