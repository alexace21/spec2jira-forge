# Release 7.2.0 — hardening release (no new features)

> Prepared 2026-07-26 on branch `release/7.2.0`. **No new scopes** (`manifest.yml` diff = comments
> only) → **no customer re-consent, minor version, no new Marketplace review.**
> This deploy also **activates** the production env vars set 2026-07-26:
> `MANAGED_ANTHROPIC_KEY` (issued from the capped Anthropic workspace, $100/month spend limit) ·
> `MANAGED_TRIAL_CREDIT_USD=5` · `MANAGED_HARD_CEILING_USD=6` — Forge env vars take effect only on
> the next deploy of the environment.

---

## Marketplace release summary (≤80 chars — paste into the portal)

```
Safer trial-credit metering, clearer pricing info, automatic draft cleanup.
```

## Marketplace release notes (≤1000 chars — paste into the portal)

```
A reliability and clarity release. No new features, no new permissions, and no action required.

• Hardened trial-credit metering — every AI step on the managed trial path now verifies the remaining allowance before it runs, including each step of Project Context distillation, so the included trial credit is enforced consistently on every surface.

• Clearer pricing information in the app — the Account panel now explains how pricing works: free while your whole Confluence site has 10 users or fewer, priced per user above that, with your exact price always shown on the Atlassian Marketplace listing before you subscribe.

• Automatic cleanup of abandoned drafts — unfinished Project Context distillation sessions are now removed by the daily maintenance sweep, in line with the app's data-retention approach.

• Expanded automated test coverage around billing and cleanup paths.
```

*(Both blocks pass the claims firewall: no price figure, no credit amount, the free-tier claim
carries the whole-instance qualifier — `docs/marketing-kb/13-claims-register.md` A2.1 shape.)*

---

## Internal changelog

### 1. Billing safety (the reason this release exists)
- **`distillStep` per-step credit gate** (`src/index.js`) — the surface previously had NO admission
  control past the one $0.10 whole-pipeline check at `startDistillSession`; a user admitted once
  could keep spending on the managed key step after step. Now every step runs `managedRunBlocker`
  (the same shape as breakdown / test-gen / plan / regen) before the Anthropic call.
- **Admission guarantees completion** — `DISTILL_STEP_EST_USD` re-derived from a worst-case TOKEN
  bound (not a chars/4 assumption), and the session-level admission covers steps × per-step
  estimate, so a run admitted at start cannot be blocked mid-pipeline in the normal case; a
  concurrent-drain block keeps the session (no paid work lost) and reports the true cause.
- **Fail-closed + honest routing** — credit-read errors block (never spend on a glitch); BYOK is
  never gated; defensive license gates on the distill legs (+ `gate_fail_open` diagnostics,
  `license_required` code so the FE routes honestly instead of a generic retry hint).
- **Distill-session sweep** (`src/index.js`, `src/sweep_util.js`) — `distill_session:` records
  (customer-pasted text!) were never cleaned for abandoned runs; now enumerated by the daily sweep.
- **Ledger-before-fragile-write ordering** — a billed call is recorded even if the subsequent KVS
  write fails (an unrecorded spend silently raised real exposure above the ceiling).

### 2. Honest in-app pricing copy
- `src/usage.js` — `price` no longer asserts a rate (`'See Marketplace pricing'`); new `priceNote`
  carries the qualified shape (free while the WHOLE Confluence site has ≤10 users — every user on
  the site counts; per-user above, declining with size; exact price on the Marketplace listing).
  The runtime cannot know an install's band (License object exposes no seat count — live-verified
  2026-07-25), so the app never claims one.
- `App.js` + `AdminSettings.jsx` — render `priceNote`; retired `$6.70/user · $57 ≤10 flat` strings
  are gone from every customer-visible surface.
- `manifest.yml` — pricing documentation comments re-written to the portal-verified graduated
  bands (comments only; zero functional change).

### 3. Docs / marketing infrastructure (no runtime impact)
- `docs/marketing-kb/` — the 18-file marketing knowledge base (claims register = the honesty
  firewall with ONE canonical pricing wording; enterprise use-case framing UC1–UC5; personas,
  positioning, competitive, use cases, product tour, brand, trust, FAQ, strategy; editorial
  calendar; blog architecture draft; site-copy draft [superseded by the applied site edits]).
- `docs/IMPL-SPEC-PER-USER-WELCOME-CREDIT.md` — the per-user $5 grant + $50 install-ceiling design
  (DECIDED, **not implemented**; 20 named leak vectors; its own future release arc).
- `.claude/skills/marketing-content/` — the drafts-only marketing assistant.
- `CLAUDE.md` — handover updated.

### Explicitly NOT in this release
- The per-user welcome credit (still per-install, trial-only — the spec above is design only).
- Any site change (spec2jira.com is a separate repo; its corrected pricing copy is staged there,
  unpushed).

## Verification (all run on this branch, 2026-07-26)
- `npm run check` — syntax 12/12 ESM + version-drift-guard: package.json + `DIAG_APP_VERSION`
  both **7.2.0**, lockstep.
- `npm test` — **20/20 offline suites** (trial_credit 77 incl. the distill leak-regression block ·
  orphan_sweep +13 sweep cases · tiers updated).
- `CI=true npm run build` (static/hello-world) — Compiled successfully.

## Rollout runbook (the §11 ritual)
1. ⚠ **LIVE-accept the distill gate on dev first** (`forge deploy` → distill with exhausted credit
   → blocks honestly, session kept, BYOK untouched). The one step offline tests cannot prove.
2. Partner reviews + pushes `release/7.2.0` → merge to `main`.
3. `cd static/hello-world && npm run build` → `forge deploy -e production` (activates the env vars
   + auto-creates Marketplace version 7.2.0; **no `forge install` on prod** — licensed app).
4. Portal: paste the summary + notes above; verify the manifest diff shows **0 new scopes**.
5. Same-day (independent): push the corrected site pricing pages — that is also the trigger that
   unblocks exact price figures in marketing content (claims-register publication gate).
