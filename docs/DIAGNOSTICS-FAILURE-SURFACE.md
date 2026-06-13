# Diagnostics & Support — Failure-Surface Map

> **Status:** checklist BEFORE we build (partner directive 2026-06-11). Read this before
> designing the client-side diagnostic ledger or touching any failure path.
>
> **Method:** 4 isolated mapping agents (generation · test-cases · push · cross-cutting),
> read-only, over `src/index.js`, `src/anthropic_client.js`, `src/push_handler.js`,
> `src/testcases.js`, `src/usage.js`, `src/graph.js`, `src/prompts.js`. File:line cited
> per row; spot-verify load-bearing rows before acting on them (POLICY §9/§10).

---

## 0. Purpose & privacy frame (binding)

We are building a **client-side diagnostic ledger** so that when a customer hits a failure
and contacts support, there is a **persistent, exportable** record to troubleshoot from.

- **NO egress.** The ledger lives in **Forge KVS inside the customer's own Atlassian
  instance**. Nothing leaves it. This preserves the no-backend moat AND the Marketplace
  declaration **"Log End-User Data: No"** (which is in active review — do not jeopardize).
- **NO end-user content.** Record only: operation, status/error-class, Jira field-names,
  issue-keys, timestamps, a correlation-id, counts. **Never** spec text, AC text, page
  content, generated breakdown/test content.
- The customer controls what they share. They export the diagnostic pack; we read it.
- **Forge `console.*` logs are NOT a support tool:** 14-day retention, customer can opt out
  of log sharing. They are a developer-debug aid, never the support record of truth.

---

## 1. How failures are handled TODAY — the taxonomy

Every failure in the codebase falls into one of four handling types. The ledger exists to
move the bad ones (B/C/D) toward a durable, client-visible record.

| Type | Meaning | Visible to client? | Durable? |
|---|---|---|---|
| **A — returned-to-UI** | structured `{error, detail}` the screen renders | yes, but **transient** (gone on reload) | **no** |
| **B — console-only** | `console.log/warn/error`, nothing else | no (only Forge logs) | 14 days, opt-out |
| **C — silent** | swallowed (`catch(_){}`) or fail-open; no signal at all | **no** | no |
| **D — persisted-then-purged** | written to `job:`/session, deleted by `purgeJob`/session-end | only until purge | **no after push** |

### ⭐ The core finding

**There is no durable diagnostic record anywhere in the app.** Type-A errors vanish on
reload. The push `failureDetails` struct lives only inside the transient push-session value,
is returned **once** in the final `pushStep` response, and the session is **deleted
immediately** (`push_handler.js:799`). Generation/test diagnostics live in `job:` and are
**purged after a successful push** (`index.js:1775-1816`). After a push, the diagnostic trail
is **zero**. This is the gap. Everything below is detail.

---

## 2. Failure-surface checklist (by subsystem)

Handling column uses the A/B/C/D taxonomy above. **→L** = the ledger should capture this row.
Rows marked **intended** (fail-fast, returned-to-UI, client acts) are correct as-is; the
ledger only needs them for a complete timeline, not as defects.

### 2.1 Generation pipeline

| Operation | file:line | Trigger | Handling | Self/Ext | Severity | →L |
|---|---|---|---|---|---|---|
| License gate (unlicensed) | index.js:1173 | no active license/trial | A (intended) | ext | blocking | ✓ |
| License read throws | index.js:1177 | getActiveTier throws | **C fail-open** | self | hidden | ✓ |
| Key not configured (BYOK) | index.js:1186 | no stored key | A (intended) | ext | blocking | ✓ |
| Managed key unavailable | index.js:1188 | `MANAGED_ANTHROPIC_KEY` unset | A + B | **self (ops)** | blocking | ✓ |
| Quota exceeded | index.js:1222 | Managed cap reached | A (intended) | ext | blocking | ✓ |
| Quota check throws | index.js:1228 | checkQuota throws | **C fail-open** | self | hidden | ✓ |
| Confluence fetch throws / non-OK | index.js:1234-1250 | network / 403/404/410/5xx | A + B | ext | blocking | ✓ |
| **Initial `job:` / `pageJob:` write** | index.js:1273,1283 | `kvs.set` throws | **unwrapped → opaque resolver error** | self | blocking | ✓ |
| **`pagesnap:` write fail** | index.js:1312-1323 | KVS / byte-cap miscalc | **C** (console.warn) → test-gen silently §7-starved later | self | **data-loss (quality, deferred)** | ✓ |
| Context-profile resolve fail | index.js:1330-1344 | settings/KVS throw | C (console.warn) → empty context | self | quality | ✓ |
| Batch submit (401/402/429/5xx/network/no-id) | anthropic_client.js:400-426 | Anthropic / network | A (job→failed) | ext | blocking | ✓ |
| **`recordTrackedJob` write fail** | index.js:1399 | KVS throws | **C** (console.warn) → job absent from dashboard | self | UX-blocking | ✓ |
| `consumeQuota` write fail / race | index.js:1410; usage.js:296 | KVS / no atomic incr | **C** | self | revenue (Managed) | ✓ |
| Poll: job not found | index.js:1444 | purged/expired | A | self (purge) | blocking | ✓ |
| Poll: managed key vanished mid-flight | index.js:1479 | env rotated | A + B soft-fail-retry (self-heals) | self (ops) | blocking-until-restored | ✓ |
| Poll: batch status error | index.js:1487 | Anthropic/network | **B + soft-fail** (phase text only) | ext | blocking if persistent | ✓ |
| **Poll: unknown batch status** | index.js:1632 | status ∉ known set | **D-none** (phase text, no terminal write) → **polls forever** | ext | blocking (stuck) | ✓ |
| Poll: concurrent double cycle-repair | index.js:1520 | two pollers race | C (idempotent; double LLM charge) | self | cost | ✓ |
| fetchBatchResults (fetch/row/refusal/expired) | anthropic_client.js:505-555 | Anthropic | A (job→failed) | ext | blocking | ✓ |
| **Truncation → salvage** | anthropic_client.js:557-587 | output > 64K cap | A (`truncated` flag → banner) or job→failed | ext + self (cap) | data-loss (flagged) | ✓ |
| **Clean-parse, schema-invalid breakdown** | anthropic_client.js:560,599 | model drift, `{}` / bad `features` | **C — no post-parse validation** (unlike test-cases) | ext/self | **data-loss (silent)** | ✓ |
| Cycle-repair LLM throws / non-OK | index.js:1082; ac:962 | network/Anthropic | B → surfaced as `[RISK]` concern (or not) | ext | flagged | ✓ |
| **`verifyAndRepairCycles` whole pass throws** | index.js:1590 | unexpected throw | **C** (console.error) → **silent cycle survives** | self | **data-loss (§11)** | ✓ |
| **Completed-state `job:` write** | index.js:1605-1619 | ~240KB breakdown hits **KVS value-size limit** | **unwrapped → throws → breakdown PERMANENTLY LOST** (batch already billed) | **self** | **data-loss (highest)** | ✓ |
| getResults: not_found / failed | index.js:1651 | purged / job failed | A | self/ext | blocking | ✓ |
| getGenerationStatus: failed→`idle` | index.js:1705 | reconnect on a failed job | **C** — reads as fresh Ready, masks failure | self | blocking (lost reconnect) | ✓ |
| **`estimateCost` computed, never persisted** | index.js:1569,1626 | always | B (console.log only) → cost vanishes | self | diagnostic-loss | ✓ |

### 2.2 Test-case pipeline

| Operation | file:line | Trigger | Handling | Self/Ext | Severity | →L |
|---|---|---|---|---|---|---|
| Key/quota/job gates (startTCGen) | index.js:1957-1986 | config / cap / job state | A (mostly) + C fail-open on license/quota throw | self/ext | blocking | ✓ |
| **Edited-breakdown persist fail** | index.js:1998-2010 | flattenBreakdown/setJob throws | **C** (console.warn) → **test-gen runs on pristine, not edited ACs** (the #1 edited-state bug, silently) | self | **data-loss** | ✓ |
| Idempotency mis-skip | index.js:2019 | normAC signature collision | C (by design) | self | edge data-loss | ✓ |
| TC batch submit error | index.js:2076; ac:741 | Anthropic/network | A (tcjob→failed) | ext | blocking | ✓ |
| Key vanish / poll error mid-flight | index.js:2146-2161 | env/network/404 | **B + soft-fail** (phase only); **404 never terminalizes → infinite spinner** | ext/self | blocking (silent hang) | ✓ |
| Stuck canceling/in_progress | index.js:2169 | batch wedged | **D-none** (spinner forever) | ext | blocking | ✓ |
| Whole-batch expired (24h) / partial | ac:827-845; index.js:2201 | per-story `result.type≠succeeded` | A — per-story `{error}` + `failedCount`; **screen IS honest** ("N failed" + regen) | ext | data-loss (surfaced) | ✓ |
| Per-story refusal / parse_failed | ac:854-868 | model / drift | A (per-card "failed") | ext/self | data-loss (per story) | ✓ |
| **Silent truncation** | ac:859-868 | story hits 24K cap, JSON happens to close | **C — no `stop_reason` check** (unlike breakdown salvage) → truncated set persisted as success | **self** | **data-loss (silent)** | ✓ |
| Defensive parse drops a case | testcases.js:89-138 | empty when/then, bad priority | C (by design) | self | edge data-loss | ✓ |
| Ceiling slice(0,20) | testcases.js:140 | >20 cases | C (coverage-safe by design) | self | depth-loss | ✓ |
| Per-story KVS write throws (bulk) | index.js:2201 | `Promise.all` no per-item catch | **C → whole completion lost**, tcjob stuck `batched` | self/KVS | blocking | ✓ |
| **Failed regen overwrites prior-good** | index.js:2607-2612 | regen errors | **C → destroys a story's prior good cases** (no undo) | **self** | **data-loss** | ✓ |
| regen stampedStories sync fail | index.js:2620 | KVS throws | C (console.error) → push-embed/staleness drift | self | signal-loss | ✓ |
| **Silent partial export** | index.js:2702,2709 | missing/errored story | **C — `continue`, no "N skipped" marker** → 8-story file looks complete | **self** | **data-loss (silent)** | ✓ |
| Export render throws | index.js:2712 | malformed entry | **C → whole export fails** (not caught per-story) | self | blocking | ✓ |
| **pagesnap missing → §7 starved** | index.js:248-269 | snapshot absent/mismatch/purged | **C fail-soft** → weaker tests, **only a console.log** | self | **data-loss (quality, silent)** | ✓ |
| `tcregenjob:` never purged | index.js:1811 (TODO) | no wildcard key | **D-leak** → lingers post-push (stamped ACs = content-adjacent) | self | storage + privacy creep | ✓ |

### 2.3 Push-to-Jira pipeline (highest-value for diagnostics)

| Operation | file:line | Trigger | Handling | Self/Ext | Severity | →L |
|---|---|---|---|---|---|---|
| Project lookup (throw/404/403/other) | push_handler.js:249-277 | network/config | A + B (raw status console-only on "other") | ext | blocking | ✓ |
| **Subtask type unresolved** | push_handler.js:286,642-648 | no `subtask:true` type | **B fallback** (console.warn) → silently embeds checklist instead of issues | ext + design | deliverable degraded | ✓ |
| SP / priority field miss | push_handler.js:293-320 | field absent / name unmatched | **C** (console.log) → field silently dropped | ext | cosmetic | ✓ |
| Required-custom-field rejection (Epic) | push_handler.js:347 | mandatory field missing | A (whole push aborts; message names field) | ext (config) | blocking | ✓ |
| Story/Subtask bulk-create partial/total | push_handler.js:413-462,937 | network / per-row config | A (count + first-10 details) + B (raw body) | ext | data-loss (partial) | ✓ |
| **Orphaned subtasks (parent Story failed)** | push_handler.js:918-920 | parent missing in storyKeyMap | **C — skipped, never counted, never in failureDetails** | **self (cascade)** | **data-loss (zero trace)** | ✓ |
| **Link unresolved (name not in map)** | push_handler.js:964-979 | model paraphrased dep name / dup-name collision / parent failed | A (count + first-10), **misleading reason** "X not created" | **self (name-match)** | **data-loss (silent edges)** | ✓ |
| Link create API failure | push_handler.js:484,997 | Jira 4xx/5xx/throw | A (count + first-10) + B | ext | data-loss | ✓ |
| **Link chunk log MISCOUNT** | push_handler.js:1011 | every link chunk | **B — `ok+failed` ≠ chunk size** (failed inflated by preflight unresolved) | **self (count bug)** | cosmetic (corrupts the one debug log) | ✓ |
| Test-case embed drop (ambiguous hash) | push_handler.js:677-690 | two stories share AC-hash | C — dropped; only `tc_skipped` total, not which | self (hash identity) | data-loss (per-story) | ✓ |
| **25-sec timeout mid-chunk** | push_handler.js:774-811 | chunk overruns; `kvs.set` never runs | **C — cursor not advanced → retry DUPLICATES Jira issues**; no record | ext + self (non-idempotent) | **data-loss / duplication** | ✓ |
| Step exception (any phase) | push_handler.js:792 | unexpected throw | A (session kept; retry re-runs chunk → dup risk) | mixed | blocking | ✓ |
| Invalid required-CF JSON at push | index.js:1863 | unparseable | **C — `customFields=null` silently** → deferred per-row rejection | self | blocking (deferred, confusing) | ✓ |
| Session not found / expired | push_handler.js:776; index.js:1908 | KVS gone / forged | A ("restart push"; partial writes orphaned) | mixed | blocking | ✓ |
| **`failureDetails` survives nothing** | push_handler.js:799,1054 | session deleted at completion | **D — returned once, then GONE** | self | **diagnostic data-loss** | ✓ |
| Per-item detail capped at 10 | push_handler.js:891,942,1001 | >10 failures | counts shown, names truncated | self | partial-blind | ✓ |
| Rich diag (status+messages+**field names**) | push_handler.js:953-957 | first subtask failure only | **B — console-only**, the single most useful signal | self | diagnostic-loss | ✓ |

### 2.4 Cross-cutting (settings · key · Confluence · dashboard · quota · distill)

| Operation | file:line | Trigger | Handling | Self/Ext | Severity | →L |
|---|---|---|---|---|---|---|
| saveSettings validations | index.js:403-425 | bad key/CF/profile | A (intended fail-fast) | self | blocking | — |
| **saveSettings partial-commit** | index.js:430-436,465-470 | key saved, settings write throws | **no rollback** → key/timestamp diverge | self | cosmetic→confusing | ✓ |
| **`getStoredApiKey` swallows storage fault → null** | anthropic_client.js:76-84 | setSecret failed / read error / rotated | **C → every caller reports `not_configured`** (mis-attributes storage failure as "no key") | **self (swallow)** | **blocking (mis-diagnosed)** | ✓ (highest cross-cut) |
| testConnection (401/402/429/network) | anthropic_client.js:194-230 | key/credits/network | A (intended) | ext | cosmetic | ✓ |
| testConnection OK-body JSON parse | anthropic_client.js:232 | non-JSON 200 | **C unwrapped throw** → opaque | ext | rare | ✓ |
| **fetchPage: no BLOCKED_EGRESS check** | index.js:972-997 | egress/scope blocked | **C — mis-reported** as generic `confluence_<status>` (searchPages:785 DOES check) | self (inconsistent) | blocking (wrong cause) | ✓ |
| fetchPage / searchPages errors | index.js:983-997,780-822 | Confluence/network/scope | A + B | ext | blocking/cosmetic | ✓ |
| **getDashboardJobs top-list read throws** | index.js:889 | KVS throws | **C unwrapped** — contradicts its own "never an error" docstring | ext | dashboard fails | ✓ |
| getDashboardJobs stale-ref drop | index.js:911 | job+jobmeta gone | C (self-heal) — row vanishes unexplained | self (design) | cosmetic | ✓ |
| **recordTrackedJob write fail** | index.js:1399; helper 871 | KVS throws | **C (console.warn)** → fired job never on dashboard | self | UX-blocking | ✓ |
| **purgeJob fail-open** | index.js:1795-1823 | any KVS op throws | **C/B → page content + pagesnap may PERSIST** (undercuts "removed after processing" privacy claim) | self | **privacy/retention (silent)** | ✓ |
| 3× fail-open gates (license/quota/distill-cap) | index.js:1177,1228,591 | KVS/license read throws | **C (console.error)** → admits work + bypasses cap silently | self | hidden policy bypass | ✓ |
| **Distill category drop in merged profile** | index.js:658-686 | 1 of 6 category calls fails + step skipped | **C — merged profile omits a category, no marker** (e.g. missing Conventions) | ext | **§8 starvation (silent)** | ✓ |
| distill truncation / overflow-trim | index.js:670-707 | max_tokens / >20K | A (honest flags) | ext/self | cosmetic | — |
| Several unwrapped `kvs`/`json()` | index.js:611,672,717,999 | KVS / non-JSON | **C unwrapped** → opaque resolver error | ext | cosmetic | ✓ |
| firstSeen capture fail (×2) | index.js:1730,1207 | KVS throws on new install | **C (console.error)** → **irreplaceable grandfather signal lost** | self | unrecoverable | ✓ |

---

## 3. Worst offenders — silent / data-loss (ledger priority order)

These are Type-C/D with **data-loss or mis-diagnosis** — the ones that make us look helpless.
Ordered by support pain:

1. **Completed breakdown lost at KVS ~240KB limit** — `index.js:1619`, unwrapped write; batch
   already billed → the whole deliverable vanishes with a generic error. *Self-inflicted, highest severity.*
2. **`getStoredApiKey` mis-attributes a storage fault as "no key"** — `anthropic_client.js:76`.
   Support chases the wrong cause every time.
3. **Push `failureDetails` is returned once then deleted** — `push_handler.js:799`. The richest
   failure record in the app evaporates on reload.
4. **Orphaned subtasks vanish with zero trace** — `push_handler.js:918`. Counts don't even reconcile.
5. **25-sec timeout → silent duplicate Jira issues on retry** — `push_handler.js:774`. Non-idempotent.
6. **Silent test-case truncation** — `anthropic_client.js:859`. No `stop_reason` guard.
7. **Silent partial export** — `index.js:2702`. A failed-story file looks complete.
8. **Failed regen destroys prior-good cases** — `index.js:2607`. No undo.
9. **Silent cycle survives a `verifyAndRepairCycles` throw** — `index.js:1590`. The §11 worst bug.
10. **§7 quality silently degraded on any pagesnap miss** — `index.js:248`. Weaker tests, no signal.
11. **Edited-breakdown soft-fall-back to pristine (×2)** — `index.js:1998,2450`. Re-opens the #1 bug silently.
12. **Distill drops a whole category with no marker** — `index.js:686`. §8 starvation.
13. **purgeJob fail-open leaves page content / pagesnap behind** — `index.js:1795`. Privacy-claim risk.
14. **Rich Jira diagnostic (field names) is console-only** — `push_handler.js:953`. The one useful signal, unreachable.

---

## 4. Self-inflicted root-causes (Layer 1 — reduce failures at the source)

Highest-value (§3): fewer failures beats better failure reporting. These are OUR bugs, not
Anthropic/Jira/network:

- **A1 — Name-keyed linking → ID/UUID (the partner's strong-design ask, §3.5).** See §4.1.
- **A2 — Link chunk log miscount** (`push_handler.js:1011`) — fix the counting so the one
  debug log reconciles.
- **A3 — Completed-state write not guarded** (`index.js:1619`) — wrap + handle the KVS
  size limit (chunk the breakdown, or fail loudly with the breakdown preserved/retryable).
- **A4 — `getStoredApiKey` collapses storage faults to null** (`anthropic_client.js:76`) —
  distinguish "never set" from "read/write failed" so the error is honest.
- **A5 — Silent test-case truncation** (`anthropic_client.js:859`) — add the `stop_reason`
  guard the breakdown path already has.
- **A6 — Non-idempotent push retry** (`push_handler.js:774`) — cursor/idempotency so a
  retried chunk can't duplicate Jira issues.
- **A7 — Silent partial export** (`index.js:2702`) — render a "N stories skipped" marker.

### 4.1 Name→ID linking — every site to thread a stable `uid`

A stable `uid` is already minted on the frontend (`lib/v3Schema.js` `newStoryUid`, threaded
into `stampedStories._uid` for test-cases). Push linking still keys by **name**. Every site:

| Site | file:line | Current (name-based) |
|---|---|---|
| flattenBreakdown — dep edges | push_handler.js:228-229 | `{source: depName, target: f.name}` (model paraphrases `depName` = the break) |
| storyKeyMap init | push_handler.js:737 | `{}` keyed name→Jira-key |
| storyKeyMap write | push_handler.js:883 | `[slice[j].name] = key` (**dup-name last-writer-wins**) |
| storyKeyMap reads | push_handler.js:906,919 | tasks-embed count; **buildFlatTasks parent (miss → orphaned subtask)** |
| link preflight resolve | push_handler.js:968-969 | `[source]`/`[target]` (**core unresolved site**) |
| createdStories | push_handler.js:887 | `{name, key}` append-only |
| test-case embed | push_handler.js:677-688,826-850 | binds by AC-set hash (name-substitute) |

> **⚠ Mentor caveat (honest):** threading `uid` removes name-fragility BETWEEN our steps
> (generation→push), dup-name collisions, and orphaned-subtask silent loss. But the dependency
> edges originate in the model's output as **names** (the model thinks in names, not uids). So
> there is still ONE `name → uid` resolution — it just moves to a single controlled point
> (normalization, with the full feature list in hand) where a miss can be **surfaced
> immediately as a diagnostic/concern** instead of silently at push, capped at 10, with a
> misleading reason. That is the real win: not "no matching ever," but "match once, in the
> right place, and never fail silently." Per §4, that single name→uid match reads paraphrase →
> it should be a normalized/robust match, not exact-string.

---

## 5. What the ledger must capture (input to the A→D→S)

A single append helper called from every failure path, recording (NO end-user content):

- `ts` (timestamp), `correlation_id` (the jobId/sessionId/pushId already in logs),
- `op` (e.g. `push.links`, `generation.complete`, `testgen.story`, `settings.key`),
- `status` / `error_class` (the structured code, e.g. `link_unresolved`, `kvs_size_limit`,
  `managed_unavailable`, `truncated`, `partial`),
- `subject_ref` (Jira issue key, story index/uid, page id — identifiers, not content),
- `jira_field_names` / `jira_status` where present (config diagnostics, not data),
- `counts` (created/failed/skipped),
- `severity` and whether it was surfaced to the user.

Design questions for the A→D→S (next phase): retention/cap of the ledger itself (we just cut
KVS read/storage cost — do not reintroduce a leak); one ledger key vs per-correlation; what
survives `purgeJob` (the ledger must NOT be purged — that is its whole point); the export
format; the Settings "Diagnostics" surface.

---

*Next: Analyze → Design → Solve the ledger (Layer 2), then Layer 1 root-causes in priority
order, each through the LENS (§0) and the §13 gate.*
