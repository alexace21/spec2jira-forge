# Diagnostic Ledger — Design v2.2 (implementation contract)

> **Status:** v2.2 — partner GO (2026-06-11). Ratified: purge **Option A**. ADDED by
> partner directive: enterprise **admin view** (all per-seat diagnostics), **verbatim-
> preserved** error messages + ref + **click-nav** to Diagnostics, the **rich-detail
> sibling** (§2b), health check, success breadcrumbs. SOLID + simplicity-over-
> over-engineering now binding in POLICY §3.5. Ancestry: v1 → 4 independent audits
> (support 7/10·surface 5/10 / privacy 5/10 / simplicity 6/10·cost 5/10 / pitfalls ×8) → v2
> → **3 independent v2 audits** (compliance **8/10** / hidden-risks **4/10 as-specified →
> ~8/10 with these amendments** / end-to-end **6.5/10 → ~8.5/10**). v2.1 = v2 + every
> forced amendment. Companion: `docs/DIAGNOSTICS-FAILURE-SURFACE.md` (the wiring checklist).
>
> ⚠ **The v2 audits found that v2's own prereq wraps were WRONG as worded** (would orphan a
> billed batch / spin an infinite billed retry loop). This file is the corrected contract —
> implement THIS, not the chat history.

---

## 0. Frame (binding, unchanged)

- **NO egress.** Forge KVS inside the customer's instance. Export = the human copies JSON
  and emails support@spec2jira.com themselves (not app egress; manifest untouched).
- **NO end-user content** — enforced structurally (see §1 MUST-NOT), not by discipline.
- Survives `purgeJob` (that's the point). **NO TTL** (KVS TTL is sliding-on-write — would
  silently expire rarely-written diagnostics; the hard-won TTL lesson).
- Forge `console.*` stays dev-debug only (14-day retention, customer can disable sharing).
- **Deployment guard: DEV ONLY until the v5.3.0 Marketplace verdict** — `forge deploy -e
  production` auto-creates a Marketplace version and could entangle the in-flight review.

Compliance verdict (audit, grounded in the declared texts): **no declared answer is
violated.** The ledger is KVS storage (not a Forge log → "Log End-User Data: No" untouched,
and stricter than the status quo since Jira message text is dropped); residency = declared
"stores within Atlassian"; purge claims are content-scoped at all three declaration layers;
per-accountId keying matches the in-review usage-metering precedent (same artifact). The
existential FIT/no-backend posture is structurally untouched.

---

## 1. Record schema `v:1` (typed; the helper enforces it)

```js
{
  v: 1,
  ts: number,                    // Date.now() at write
  ref: string|null,              // jobId | distill sessionId | null (settings/confluence ops)
                                 //   null-ref records DEDUPE by (op, error_class) — flood
                                 //   absorption per §2.5; (ts, op) is the DISPLAY identity
                                 //   (reconciled to the implementation at the §13 gate)
  session_ref?: string,          // push sessionId (UUID-shape validated)
  op: <enum>,                    // CLOSED registry: 'generation.start'|'generation.poll'|
                                 //   'generation.complete'|'push.final'|'push.step'|
                                 //   'testgen.batch'|'testgen.regen'|'export'|'settings.key'|
                                 //   'distill.step'|'confluence.fetch'|'dashboard.read'|
                                 //   'invoke.failed'|...
  error_class: <enum>,           // CLOSED registry: 'partial_push'|'link_unresolved'|
                                 //   'kvs_persist_failed'|'kvs_write_failed'|'auth_rejected'|
                                 //   'insufficient_credits'|'rate_limited'|'managed_unavailable'|
                                 //   'truncated'|'parse_failed'|'quota_exceeded'|'refused'|
                                 //   'orphaned_subtasks'|'edited_persist_failed'|...
                                 //   interpolated families normalized to family + status int
                                 //   (e.g. 'confluence_http' + jira[0].status), unknown →
                                 //   'unknown_error' — NEVER the raw string
  level: 'error'|'warn'|'info',
  subject?: { kind: 'issue'|'page'|'story_uid'|'idx', id: string|number },
                                 // per-kind STRUCTURAL validation: issue ^[A-Z][A-Z0-9_]+-\d+$,
                                 // page = numeric id, uid = minted-uid shape, idx = int.
                                 // Fails validation → field dropped, record still written.
  subject_idxs?: number[],       // failed story/task indices, cap 20 (ints only)
  subject_keys?: string[],       // durable Jira issue keys (survive purge), cap 20, key-shape
  jira?: [{ status: number, field_names: string[] }],
                                 // deduped array, cap 5 (per-element statuses differ in one
                                 // push); field_names ONLY from Object.keys(errors) (the
                                 // push_handler.js:955 pattern), length-capped
  counts?: { [k]: number },      // CAUSE-SPLIT, not lump: links_unresolved / links_api_failed /
                                 //   subtasks_orphaned / stories_failed / per-class testgen
                                 //   (parse_failed/refused/...) / approx_bytes (persist-fail)
  occurrences?: { count: number, firstTs: number, lastTs: number },  // dedupe-in-place
  surfaced: boolean              // was a user-facing error shown
}
```

**HARD MUST-NOT (helper-enforced + a named review check; each was a real creep vector the
audits located):** no free-text `detail`/`message`/`reason`/`phase`/`errorMessages`; no
`pageTitle` (it sits in `job:`/`jobmeta:`/tracked-list — a UI label join is DISPLAY-ONLY,
never stored/exported); no feature/story/task/profile **names**; no `taskSummary`; no link
`source`/`target` names; no stamped ACs; no `browseBase`/site URL; no accountId/displayName/
email in the **body**. Human-readable text is rendered at display time from `error_class`
constants. **Deliberately sanctioned:** Jira issue keys (embed the project key — already
declared as processed "Jira project metadata" in privacy policy §3).

---

## 2. Helper contract — `recordDiagnostic(context, record)`

1. **Fail-open** — internal try/catch, never throws into the caller; malformed → dropped.
2. **Whitelist-serialize** — unknown keys dropped by construction (no `...spread` of caller
   objects); enums validated against the closed registries.
3. **Bucket** = `spec2jira_diag:u:<accountId>` from `context.accountId` ONLY (server-trusted,
   never payload). **Falsy accountId → SKIP the write entirely** — no shared `'unknown'`
   bucket (a jobId is a read capability via owner-checkless `getResults`; a shared bucket
   would leak it cross-user).
4. **Owner-bucketing:** job-scoped events write to the JOB OWNER's bucket — stamp
   `ownerAccountId` on `job:` at `startGeneration` and `tcjob:` at `startTestCaseGeneration`
   (both have `context`); polls are payload-only and may be driven by ANOTHER user's client
   (shared `pageJob:` index → cross-user poll is reachable), so bucket-by-invoker would file
   the failure under the wrong user. Fallback when no owner stamped (legacy jobs): invoker.
   *(Privacy delta of the stamp ≈ 0 — `job:` already holds full page-derived content; the
   diag record body stays identity-free.)*
5. **Dedupe-in-place:** same `(ref, op, error_class)` → update `occurrences{count++, lastTs}`
   instead of append. RULE: retrying soft-fail sites (poll errors, key-vanish, unknown batch
   status — they fire every 5s/15s tick) record on FIRST occurrence and on terminalization,
   never per tick. Without this a single stuck job floods all 50 slots in ~4-12 min.
6. **Ring:** prepend + cap 50 — **eviction drops the oldest `info`-level entries first,
   then oldest overall** (a success-breadcrumb stream can never evict an error record);
   one get+set per (rare, coalesced) event. Residual same-user RMW race after dedupe = a
   lost `count++` — cosmetic, accepted.
7. **Aggregate sidecar:** `spec2jira_diag:agg` → `{ [error_class]: {count, lastTs} }` — NO
   refs/ids/content. Install-wide visibility for SILENT-class failures whose owner never
   looks (consumeQuota/recordTrackedJob/purge fail-open/distill drop). Shown to everyone in
   the tab; restores v1's per-install support signal without its blast radius.
8. **Export reuses this serializer** — it cannot re-hydrate richer structures
   (`failureDetails`, `job.breakdown`, stamped ACs). Envelope: `{app_version, exported_at,
   tier/edition}` (tier flips the `managed_unavailable` support path: our ops vs their key).
9. **Module layout (SOLID, POLICY §3.5):** `src/diagnostics.js` is the SINGLE owner of
   registries, validation, serialization, ring-merge, agg, the KVS writes, **and the
   structured-code→class mapper (`classifyDiagGenerationError` — moved here from index.js
   at the 2026-06-12 Phase-3 contract audit, pinned by the prototype table-test §16)** —
   the pure core (validate/merge/evict/classify) is import-free and offline-testable; the
   IO shell is thin (lazy `@forge/kvs` import inside the functions). Resolvers in index.js
   stay thin shells.
   Frontend humanized texts live in ONE map (`static/.../lib/diagnosticsView.js`) keyed by
   the same codes — backend↔frontend code-sync is a NAMED review check. No diagnostics
   logic in components.
10. **Read API — `getDiagnostics({scope:'mine'|'all'})`:** `'mine'` = own bucket. `'all'`
   (the enterprise ADMIN view) is **backend-gated per request**: live Jira `ADMINISTER`
   check via `asUser().requestJira('/rest/api/3/mypermissions?permissions=ADMINISTER')`
   (covered by the already-held classic `read:jira-work` — **NO manifest delta
   mid-review**); non-admin / no-Jira-access / check-error → silently falls back to
   `'mine'` (never trust the client toggle). Cross-bucket enumeration: prefer `kvs.query`
   beginsWith `spec2jira_diag:u:` if the installed @forge/kvs supports it (VERIFY
   empirically against node_modules); else maintain `spec2jira_diag:index` (accountId
   list, idempotent add on a user's first write). Documented edge: a Confluence-admin-
   without-Jira-admin sees only their own bucket → the runbook fallback (affected user
   exports their own report) always works.

`recordClientDiagnostic` resolver (frontend fallback — the 25s resolver kill leaves NO
backend write; the hardest failures otherwise have no record): bucket from context only;
payload whitelist `op∈{invoke_rejected, invoke_timeout}` ∪ client enum, `ref`/`session_ref`
UUID-shape validated, `subject_idxs` ints cap 20; everything else rejected. Abuse surface =
a user spamming their OWN 50-ring (dedupe absorbs); no cross-user radius.

---

## 2b. Rich-detail sibling — `spec2jira_diagdetail:<ref>` (partner directive 2026-06-11)

**The question it answers:** the verbatim error message usually carries the highest-value
"what went wrong" — can we keep it client-side without breaking the declarations? **Yes —
in a SEPARATE zone with a bounded lifecycle, never inside the ledger record.** Grounding
(compliance audit): "Log End-User Data: No" governs Forge LOGS, not KVS — the customer's
KVS already legitimately holds the FULL page content. The real constraints are (a) the
ledger survives purge by design, so content fragments inside it would outlive the declared
content removal, and (b) what OUR mailbox receives. Zoning solves both:

- **Zone 1 — the ledger record:** codes/ids/counts ONLY. The §1 MUST-NOT wall stays
  ABSOLUTE (one invariant, no per-field judgment calls — §3.5 simplicity).
- **Zone 2 — the detail sibling:** `spec2jira_diagdetail:<ref>` holds the verbatim failure
  detail (Jira rejection messages, the unresolved link's names, exception text), capped
  4 KB, **TTL ~30 days** (native KVS TTL if available — VERIFY against node_modules — else
  `expiresAt` in the value + lazy trim on read). TTL on TRANSIENT diagnostic data is
  exactly what the TTL lesson permits (write-once, never the deliverable). Not touched by
  purgeJob (its lifecycle is the TTL).
- **Consent gate:** the DEFAULT export is zone-1-only (the Copy button's "no content"
  reassurance stays true). An explicit checkbox — *"Include full error details (may quote
  item names)"* — appends zone 2 to THIS export; the report header flags the inclusion.
  The customer controls what support receives — exactly the support-channel framing.
- **Compliance rider:** ships with one §8 wording line at the next policy edit. No
  questionnaire delta (no logs, no egress, stores within Atlassian).

---

## 3. Phase 0 — prereq wraps (per-CALL-SITE contracts; **`setJob` itself keeps throwing**)

> ⚠ v2 said "wrap setJob's kvs.set". The hidden-risks audit proved that's the wrong
> altitude: call sites have OPPOSITE correct semantics, and a blanket swallow makes 3 of 6
> sites WORSE (incl. submitting a BILLED batch with no job record). Wrap the call sites:

| Site (src/index.js) | Moment | Contract on catch |
|---|---|---|
| :1273 initial `job:` write | **BEFORE** the billed Anthropic submit | record(`generation.start`, `kvs_write_failed`) → return structured `{error:'kvs_write_failed'}` — **fail-fast preserved** (today's throw at least aborts before money is spent; keep that, make it structured) |
| :1283 `pageJob:` index | after job write | record → proceed degraded (job still reachable via the per-user dashboard) |
| :1361 / :1545 / :1564 failure bookkeeping | persisting a FAILED state | record → **still return the ORIGINAL structured error** (never mask it with the write problem) |
| :1377 `batched` write | **AFTER** the billed submit | record → return jobId + `tracking_degraded` warning (money is spent; do not abort) |
| :1605-1619 completed write | the ~240KB KVS value-size loss | **the §3.1 degraded path below** |

### 3.1 The 'ended' wrap MUST terminalize + hand the breakdown forward

On catch: (a) classify size-vs-other (pure function; ledger stores the enum +
`counts.approx_bytes` — a number, content-free, the decisive support signal); (b) write a
**SMALL terminal** record `{...job, status:'failed', error:'kvs_persist_failed'}` —
**spread `job`, NEVER `completed`** (~1KB, succeeds in the size case; `setJob` mirrors
jobmeta → the dashboard row flips ⚠ and reconcile stop-idle works); (c) recordDiagnostic;
(d) **return `{...completed, persistFailed:true}`** — the breakdown rides the response.
Frontend: on `completed && persistFailed` use `st.breakdown` DIRECTLY (skip `getResults`,
which would read the failed job and throw the breakdown away) + banner *"The breakdown was
too large to store — review and push it NOW; don't close this tab. Next time split the
page."* Push already consumes the frontend copy → review→push works fully in-memory.
If the small write ALSO fails (KVS outage, not size): still return `persistFailed`;
documented residual = reconcile retry during the outage (rare repeat cycle-repair billing).

> **Bonus truth the audit surfaced: this fixes an EXISTING live bug.** Today the unwrapped
> throw → the FE poll catch swallows → the interval keeps polling → every 5s tick re-runs
> fetchBatchResults (~240KB download) **+ the BILLED cycle-repair LLM when the breakdown has
> a cycle** + re-throws — an infinite spinner that re-bills. Terminalization bounds it.

Also Phase 0: stamp `ownerAccountId` (§2.4) · unmask `getGenerationStatus` failed→`'idle'`
(index.js:1717) so reconnect/dashboard can SHOW a failure instead of a fresh Ready.

---

## 4. Write model — coalesced per EVENT (never per item)

One record per failed flow-step: a partial push = ONE record at `buildFinalResult` (counts
cause-split + jira[] + idxs/keys); `step_exception` and an aborted push coalesce to their
own record (a push killed mid-flight never reaches buildFinalResult); generation = one
record at the catch/terminal site; silent-class sites record where the condition is
DETECTED. Wiring inventory = the **→L rows** in `docs/DIAGNOSTICS-FAILURE-SURFACE.md` §2.

**Success breadcrumbs (INCLUDED, info-level):** `generation_completed` / `push_completed`
with counts only — makes "worked until Tuesday" inferable and gives support a timeline;
the §2.6 eviction rule guarantees they never displace error records. **Zone-2 rider:**
error-level events that hold rich detail at hand (push failureDetails strings, exception
messages) also `writeDiagnosticDetail({ref, text})` (§2b). **Console correlation:** every
wired site appends `ref=<ref>` to its existing `console.*` line — the 14-day Forge logs
become correlatable when available (dev-debug bonus, never the support record).

**Capture corrections the audit forced (push):** `failureDetails` today holds ONLY banned
fields (names + free-text batchError) and NO idx — so capture at the SOURCE: stories idx =
`start + j` (push_handler.js:889-893); subtasks → thread the feature idx through
`buildFlatTasks` (:916-927) + **count orphaned subtasks** (parent-failed skips at :919 are
currently uncounted anywhere); links → resolve endpoints to feature idxs where matchable +
an `unmatched_source|unmatched_target` flag when the model-paraphrased name matches nothing
(the flag IS the diagnosis; full edge identity arrives with the §4.1 uid work). Fix the
links chunk-log miscount (A2, :1011) in the same file pass.

**Purge stance (partner-ratified option A):** keep the auto-purge exactly as is on
`done` — even `partial:true` (the declared claim "removes them when you push" stays
literal). The durable handles in the record = `subject_keys` (Jira issue keys) + idxs; the
on-banner **[Copy support report]** (§5) is the user-consented carrier for name-level
detail. *(Option B — skip auto-purge on partial behind an explicit "Purge stored copy"
button — REJECTED 2026-06-11: better instance-detail post-hoc, but deviates from the
declared literal and adds a state the user must remember to clean.)*

---

## 5. Surfaces

- **Error/failure messages: VERBATIM-PRESERVED + ENRICHED (partner directive 2026-06-11).**
  Never shorten or replace the current user-facing text — only ADD beneath it:
  `Diagnostic ref: <ref> [Copy]` + an **[Open Diagnostics] button navigating IN-APP** to
  Settings → Diagnostics **pre-filtered by the ref** (`handleOpenSettings({initialTab:
  'diagnostics', refFilter})` — App-internal state navigation; fully possible, no platform
  limitation; ≤2 clicks from any failure). Ref `null` → "Recorded in Diagnostics" +
  unfiltered open. ErrorScreen needs `jobId` threaded as a prop (App.js:3581 takes only
  `error` today — mechanical).
- **S4 — MANDATORY dashboard fix:** `routeByPageStatus` (App.js:809) has **no `failed`
  branch** — a ⚠ "Needs attention" row click falls through to a pristine Ready screen
  (App.js:889): zero failure info, no ref — the EXACT confusion this feature exists to
  prevent (live bug today; T7 was never live-triggerable so the click-through was never
  walked). Add the branch → Ready + a **failure card**: humanized error_class + verbatim
  error detail where available + ref [Copy] + [Open Diagnostics] + Generate-as-retry; mark
  the record `surfaced:true` on render.
- **[Copy support report] on the failure banner itself** (PushedScreen amber + ErrorScreen):
  sanitized zone-1 record by default; the §2b checkbox *"Include full error details (may
  quote item names)"* appends zone-2 verbatim detail — **user-consented at click-time** —
  collapses the screenshot-dependency for the S1 (paraphrased-link) class.
- **Diagnostics tab** (in AdminSettings; reachable by every user via the in-app entry —
  App.js:1463 — so no "ask your admin" copy): rows lead with the humanized sentence +
  relative time (codes secondary/mono); red ONLY for data-loss classes; empty state "No
  problems recorded"; caption **"Shows your Spec2Tickets activity on this site"** (else an
  admin reads their empty tab as 'broken too'); the Copy button carries the reassurance
  *"contains operation codes, IDs and counts — no page or document content"* (+ the §2b
  detail checkbox where zone-2 exists). Primary action = **Copy full report** (all 50,
  ~8KB JSON, envelope {app_version, exported_at, tier}); per-row copy secondary.
  Aggregate-counters section (from `:agg`). Success breadcrumbs visible (info styling).
- **Enterprise ADMIN view (partner directive 2026-06-11):** an "All users on this site"
  toggle, rendered only when the backend confirms **Jira ADMINISTER** (§2.10) — lists
  every per-seat bucket's records (grouped per user, searchable by ref/time/op), so the
  admin who LEADS the support conversation can find + export the affected user's
  diagnostics without involving them: the user's error screen shows the ref → the user
  hands the admin the ref (or just the time) → admin searches → Copy. Per-seat buckets
  stay the storage shape; the admin view is a READ aggregation, backend-gated per request.
- **Health check (proactive support):** a "Run health check" button in the tab — probes
  key validity (`testConnection`), Confluence read, Jira project resolution (project +
  subtask type + SP/priority fields via `lookupProject`), KVS write/read. Writes an
  info record `health.check` with per-probe result CODES. Most support tickets are config
  issues — this closes them in one click without waiting for a failure. Reuses existing
  functions only (SOLID — no new deep logic).
- **[Clear diagnostics]** (own bucket; GDPR-erasure self-service — audit recommendation).
- **Support runbook (two lines):** (1) reporter = affected user → "Settings → Diagnostics
  → Copy full report (tick 'include details' if you're comfortable)". (2) reporter =
  admin → "Diagnostics → All users → search the ref/time the user gives you → Copy".
  The `:agg` sidecar covers install-wide silent classes either way.

---

## 6. Phasing (conductor + implementer agents; verify EVERY box against the checklist before ticking)

| Phase | Scope | Key boxes |
|---|---|---|
| **0** | Prereq wraps (backend + minimal FE) | §3 call-site contracts · §3.1 degraded path + FE persistFailed branch · ownerAccountId stamps (job: + tcjob:) · getGenerationStatus unmask |
| **1** | Diagnostics module + tests | `src/diagnostics.js` (registries · validation · ring-merge/eviction · agg · §2b diagdetail writer · readers) — pure core import-free, thin lazy-kvs IO shell · offline unit tests (MUST-NOT drops, dedupe, info-first eviction, caps, subject shapes, unknown→`unknown_error`) |
| **2** | Push wiring | buildFinalResult coalesce + zone-2 detail write · step_exception record · counts cause-split · idx/keys capture at source · orphan-subtask counting · A2 miscount fix · success breadcrumb |
| **3** | Generation wiring + S4 | →L rows §2.1 + zone-2 writes · S4 routing fix + failure card · ErrorScreen ref prop + [Open Diagnostics] click-nav · success breadcrumb |
| **4** | Test-gen wiring + detection halves | →L rows §2.2 · **A5** TC stop_reason guard · **A7** export skip-marker · **A4** key-fault-vs-never-set split · distill category-drop marker |
| **5** | Surfaces | Diagnostics tab + agg section + **admin "All users" (ADMINISTER gate, §2.10)** + health check + [Clear diagnostics] + click-nav/refFilter + §2b consent-detail export + recordClientDiagnostic |
| **6** | Gate + ship | §13 audit-review + code-review (content-leak = NAMED check; humanize-map↔registry sync = NAMED check) · build · **dev** deploy · Live-E2E walkthrough of S1/S2/S4/S6-admin/S7 |

**Phasing law (from the end-to-end mapping):** 8/14 worst offenders are ledger-recordable
immediately; **5 (#A4 key mis-attribution, orphaned subtasks, 25s-dup, A5 silent TC
truncation, A7 silent partial export) produce NO record — or a FALSE one — until their
detection half lands.** The detection halves ship WITH the ledger (Phases 2/4) or the tab
lies by omission for exactly the silent classes that motivated it. Behavioral halves (A6
push idempotency, A3 full recovery, A1 name→uid linking) follow as Layer-1 tasks.

---

## 7. Accepted residuals (documented, deliberate)

- Last-writer-wins RMW after dedupe → a lost `count++` (cosmetic).
- Link edge identity (names) unrecoverable from the record until §4.1 uid lands — the
  `unmatched_*` flag + [Copy support report] cover the gap.
- KVS-outage retry loop may re-bill cycle-repair until the outage ends (terminalization
  bounds the common case).
- ~~Admin cannot export another user's bucket (runbook + `:agg`)~~ — **SUPERSEDED by the
  Phase-5 admin surfaces (re-verified 2026-06-13 audit):** with Jira ADMINISTER the
  'all'-scope export carries EVERY bucket's records (flattened; bodies are identity-free
  by §1, so per-user attribution lives on screen, not in the report — use the ref filter
  for a per-incident export). The runbook + `:agg` remain the fallback for the
  Confluence-admin-without-Jira-admin edge.
- S3 (key mis-attribution) records the truth only after A4 — phased together by design.
- Admin "All users" view requires Jira ADMINISTER; a Confluence-admin-without-Jira-admin
  falls back to own-bucket + the runbook line (documented edge).
- Zone-2 detail expires (~30d) → older incidents are codes-only (deliberate retention bound).
- A persistFailed completion observed by a BACKGROUND driver (dashboard reconcile / stale
  poll) discards the inline breakdown — only the foreground tab can hold the in-memory
  copy; the row flips ⚠ + the diagnostic records. Strictly better than the pre-fix
  infinite re-bill loop; named here (gate finding).
- FOUR generation.start KVS-failure sites (init / pageJob / failed-bookkeeping /
  consumeQuota) share one dedupe identity (ref, generation.start, kvs_write_failed) →
  coalesce into one record with occurrences — coherent with §4 coalescing, no intra-step
  site discriminator (accepted; the console `ref=` lines disambiguate in the 14-day window).
  Same for `tracking_degraded` ×2 (batched-write fail vs tracked-list fail) — materially
  different severity, merged; the response-level `tracking_degraded:true` flag exists only
  for the severe (batched-write) site.
- Degraded-mode test-gen is BLOCKED with an honest note (gate M1): test-gen reads the
  stored job.breakdown, which in persistFailed mode is the small terminal stub — the
  affordance is hidden + a handler guard; push-first is the recovery.

**Phase 2 residuals (push wiring, §13-gated; deliberate):**
- SP / priority-field resolution miss (push_handler `lookupProject`) — NAMED DEFERRED
  (cosmetic field-drop; inferable from Jira itself; no record).
- `no_session` (FE-bug edge in pushStep) — no record, no new class (its twin
  `no_breakdown` IS recorded at startPush; asymmetry accepted over class proliferation).
- Pure-network partial pushes carry EMPTY `jira[]` (the fetch-threw bulk shape has no
  content-free evidence to keep) — correct per the wall; an empty `jira[]` does NOT mean
  "no Jira involvement".
- A pre-deploy in-flight session resuming mid-links post-deploy skips the cursor-0
  preflight once → that one push's cause-split counts read 0 (UI totals stay correct;
  self-heals with the session).
- The :1066-area console.warn reads `elementErrors` on a spread-lifted shape (latent dud,
  always `{}`) — non-normative console line, candidate cleanup; `diagAddJiraErrors` reads
  BOTH shapes and is the normative capture.
- F2 (subtask-type-unresolved checklist fallback): recorded via the **`tasks_embedded`
  counts proxy** on BOTH push records (a `tasks_embedded > 0` on a project with no
  subtask type IS the fallback signature) — no extra session flag (§3.5).
- Generation soft-fail poll rows (poll error / managed-key-vanish / stuck-canceling) are
  NOT per-tick recorded (a 5s/15s loop × 4 KVS ops would re-open the read-meter leak);
  terminal records cover the common end-state. `batch_unknown_status` (polls FOREVER, no
  terminal) gets a ONE-TIME flagged record in Phase 3. The `batch_not_found` sub-case of
  the poll-error branch (BYOK key deleted mid-batch / batch gone) shares the same accepted
  residual — no terminal, no record (named here per the Phase-3 audit).

**Phase 3 residuals (generation wiring, §13-gated; deliberate):**
- INTENDED-BLOCK rows (license_required / not_configured / quota_exceeded / getResults
  not_found) are NOT recorded — type-A returned-to-UI blocks the user acts on; timeline
  value only. *(2026-06-13 Phase-5 audit: Phase 5 did NOT add them — conditional unmet,
  no support-data demand yet; a LATER pass may still add info-level intended-block
  records if support data wants them — the registry classes exist.)*
- **Row 21 — clean-parse schema-invalid breakdown (ac:560,599): NAMED detection-half
  deferral** → belongs to the Layer-1 "silent data-loss offenders" task (a minimal
  features-shape decisive test at the completed path), same family as A4/A5/A7. Until it
  lands, the class is undetectable and therefore unrecordable — the tab must not imply
  coverage of it.
- Poll job-not-found (`not_found` at the poll top) is not recorded → the FE error screen
  may show a diagnostic ref for which NO ledger record exists (the record died with the
  purge/expiry that caused the error). The ref still correlates console logs + zone-2.
- Inner cycle-resolve failures surface as a `[RISK|medium]` concern IN the breakdown
  (durable until purge) but not in the ledger; only the whole-pass throw records
  (`cycle_repair_failed`). Accepted split.
- ~~Submit-failure errors show NO ref on the ErrorScreen~~ — **CLOSED (Phase-5 MED-1 + F5;
  re-verified at the 2026-06-12 contract audit):** the submit-failure error return AND the
  initial-`job:`-write failure return now carry `job_id`, and handleGenerate threads
  `result.job_id` into errorRefId — the on-screen ref matches the backend record + zone-2
  detail. genFailureNotice.code is also now RENDERED (classText humanize map) when no
  stored detail exists. The remaining TRUE residual: start failures BEFORE a jobId exists
  (license / key gates / quota check / Confluence fetch / managed_unavailable) legitimately
  carry no ref — their ledger records are null-ref by design ("Recorded in Diagnostics" +
  unfiltered open is the affordance).

**Phase 4 residuals (test-gen wiring + detection halves, §13-gated; deliberate):**
- The idempotency mis-skip row (normAC signature collision skipping a needed regen) is
  UNDETECTABLE BY CONSTRUCTION — the signature IS the idempotency mechanism; no record.
- TC soft-fail poll rows (key-vanish / poll error incl. the never-terminalizing
  `batch_not_found` / stuck canceling / unknown status) are NOT recorded — same per-tick
  KVS-cost rule as generation. ASYMMETRY accepted: generation got the one-time
  `batch_unknown_status` flagged record (Phase 3); the TC poll did not (rarer surface,
  same self-heal paths; revisit if support data shows stuck TC batches).
- A truncated-but-salvaged REGEN stores `truncated:true` on the per-story value but emits
  no `truncation_salvaged` record (frozen scope: that aggregation lives in the BULK poll);
  Phase 5 renders the stored flag — **DELIVERED (re-verified 2026-06-13 Phase-5 audit):**
  the per-story "⚠ may be truncated" chip (StoryTestCaseCard) + the export-bar truncated
  count + the Gherkin in-file marker all consume it.
- Defensive-parse case drops + the ceiling slice(0,20) ride NO parent counts (by-design
  rows; the coverage strip is the user-facing honesty for coverage, depth loss is the
  documented cost of the cap).
- Zone-2 is one sibling per ref: an intra-TC sequence (partial_testgen detail → a later
  regen-failure detail under the same jobId) is last-writer-wins — the ledger records keep
  idxs + cause-split either way. ~~Phase-5 polish candidate~~ **post-ship polish
  candidate (re-deferred at the 2026-06-13 Phase-5 audit — NOT taken in Phase 5;
  the sibling stays keyed by ref alone):** key details by ref+op.
- `managed_unavailable` is recorded at startGeneration but NOT at TC-start/distill (their
  blocks return the same honest text; the generation record covers the ops-outage signal —
  add the 3-line copies if support data wants per-flow counts).
- ~~`tcregenjob:` purge-leak (`purge_incomplete` class registered) + cross-cutting purge
  fail-open wiring → Phase 5~~ — **CLOSED (Phase 5; re-verified 2026-06-13 audit):**
  purgeJob enumerates `tcregenjob:<jobId>:<i>` to the F5 high-water mark and deletes
  them BEFORE `tcjob:`; ANY degraded purge (tracked-list filter, per-story/regen key
  delete, tc-purge catch, outer catch) files ONE coalesced `purge_incomplete`
  (warn, ref=jobId — at most one record per invocation; dedupe absorbs retries).
- getTestCases `key_missing` stays type-A fail-loud, unrecorded. ~~saveTestCases
  `save_failed` unrecorded; `testgen.save` writer deferred to Phase 5~~ — **CLOSED
  (Phase-5 gate fix; re-verified at the 2026-06-12 F1 contract audit):** a KVS-failed
  save now records op `testgen.save` / `kvs_write_failed` (warn, subject idx) alongside
  its fail-loud `save_failed` return.
- `getSettings.apiKeyConfigured` stays fault-blind (a display flag; the A4 split covers
  every gate that ACTS on the key).
- ~~A7's `surfaced:true` is slightly optimistic for csv-only partial exports (the marker is
  Gherkin-only; the additive `skipped` field is unrendered until Phase 5)~~ — **RE-JUDGED
  ACCURATE (2026-06-12 F1 contract audit):** the FE now renders the additive `skipped`
  count as a "⚠ N stories not included" badge next to the Copy buttons for BOTH formats
  (TestCasesScreen.jsx), so csv-only exports are surfaced too. Remaining sliver: the badge
  appears in the same breath as the copy itself (a fast paste can precede noticing it) —
  cosmetic.
- The (F) per-story-write wrap records once per retry tick during a KVS outage — the
  (ref,op,class) dedupe absorbs it into occurrences (bounded, accepted).
- A bogus single-story export request for a missing/errored story can record a defensive
  `export_failed` (not FE-reachable today; dedupe bounds it).
- The A7 Gherkin marker text points at "Settings → Diagnostics" — a Phase-5 surface;
  acceptable ONLY because Phases 0-6 deploy together (named re-check at the Phase-6 gate).
- ~~The TC/regen CONTROL-RECORD bookkeeping writes (`tcjob:`/`tcregenjob:`) stayed
  UNWRAPPED (the generation twins got the §3 per-site wraps in Phase 0) — a KVS throw
  there was an opaque resolver death with no backend record, and the 'batched' sites
  threw AFTER the billed batch submit~~ — **CLOSED (F1, 2026-06-12):** all 13 writes
  (12 wraps) now carry the §3 per-site contracts mirrored 1:1 — initial writes
  fail-fast-structured BEFORE money (`kvs_write_failed` + `job_id` ref); failed-state
  bookkeeping records but never masks the original error; post-billed `batched` writes
  record `tracking_degraded` + proceed (additive `tracking_degraded:true` on the success
  response); the bulk completed-flip and the regen result+completed persist step soft-
  return `phase:'Storing results failed — retrying on the next poll…'` with status left
  'batched' (idempotent re-fetch retry, no re-bill, NO degraded inline path — test cases
  are re-runnable). Residual (same family as Phase 0's): a `tracking_degraded` control
  record stays 'pending' and will not self-heal — a user re-click re-submits a fresh
  billed batch; the record IS the support signal.

**Phase 5 residuals + §5 reconciliations (surfaces, §13-gated; deliberate):**
- **§5 reconcile (a):** "[Copy support report] on the failure banner" is COLLAPSED into the
  prefiltered-tab export — one export path, one second wall, one consent point: every
  failure surface (ErrorScreen, S4 card, PushedScreen amber) carries ref + [Copy] +
  [Open Diagnostics] → the tab opens pre-filtered → [Copy full report] (+ §2b consent
  checkbox). The per-row-copy §5 line collapses into the same flow (filter = the per-
  incident report). Supersedes the banner-side-copy and per-row-copy bullets.
- **§5 reconcile (b):** admin search = ref **or session_ref** substring (case-insensitive)
  across buckets + newest-first time-sorted groups (sorted by `occurrences.lastTs` falling
  back to `ts`); op-text search not shipped (rows show op labels — scan + ref/time cover
  the runbook flows). *(session_ref added at the deep-audit P2 pass — the aborted-push
  classes correlate only by it; the export filter mirrors the same two-field matcher,
  re-verified 2026-06-13.)*
- **§5 reconcile (c):** the consent inclusion is flagged by the appended
  `--- detail ref= ---` sections themselves (the frozen JSON envelope carries no flag).
- **§5 reconcile (d):** "red ONLY for data-loss classes" shipped as red = error-LEVEL
  (level is the single severity source; a parallel data-loss class list in the view
  would drift from the registry).
- **§5 reconcile (e) (named at the 2026-06-13 Phase-5 audit):** the health.check ledger
  record stores per-probe **ok/fail bits** in `counts` (`{anthropic_key: 0|1, …}`), NOT
  the §5 wording's "per-probe result CODES" — `counts` is structurally numbers-only (the
  wall), so the failure CODES ride the live response render (probe list + humanized
  hint) instead; a degraded run records level `warn` (info only when all probes pass).
  The probe-only token `kvs_failed` exists in the FE humanize map as a DOCUMENTED
  exception (never a ledger class; the registry-sync check excludes it by name).
- Zone-2 planted-ref disclosure (LOW, capability-bounded): a user can plant another
  user's jobId as a client-fallback ref and consent-export that ref's zone-2 detail —
  adds no NEW reach over the documented jobId-capability posture (getResults), but
  extends the window past purge by the ~30d TTL. Hardening candidate: owner-stamp the
  detail sibling.
- Health kvs probe: shared key → a concurrent health check can race a false-negative
  `kvs_rw ✗` (rare; re-run resolves; orphan-key risk closed via try/finally).
- The push client-fallback catch encloses the whole step loop → a non-invoke client-side
  exception files as `invoke_rejected` (slight class mislabel, same surfacing).
- Client-fallback self-spam can inflate the shared `:agg` counters (cosmetic; the ring
  itself is per-user).
- 'all'-scope export at the 200-bucket extreme is a multi-MB clipboard payload + ≤50
  sequential detail reads (bounded; fine for realistic installs; no virtualization on
  the admin list — bounded by the cap).
- STILL-unrecorded §2.4 rows (named, deliberate): standalone fetchPage/searchPages
  resolver failures (type-A returned-to-UI; fetchPage's BLOCKED_EGRESS mis-report also
  unfixed — candidate alongside a future wire); firstSeen capture-fail ×2 (vendor
  grandfathering signal, not user-facing support); saveTC/regenTC license fail-opens;
  testConnection OK-body JSON parse (unwrapped, rare); ~~the §2.4 "distill-cap" gate row
  is STALE (distill no longer consumes quota)~~ — *this clause was WRONG (corrected at
  the Phase-4 re-audit, re-affirmed 2026-06-13): the Managed distill quota gate EXISTS
  (gated-but-not-consumed) and its fail-open now records `gate_fail_open`
  (op distill.step, once per startDistillSession — never per step).*
- "Recorded in Diagnostics" (the null-ref affordance) can slightly overstate for the
  few unrecorded type-A errors (e.g. poll job-not-found) — accepted; the tab simply
  shows nothing for them.
- (named at the 2026-06-13 Phase-5 audit) the FOREGROUND breakdown-poll failure path
  still renders the RAW terminal code on ErrorScreen (App.js startPolling failed-branch
  `setError(st.error)`) — the in-code Phase-3 comment deferred its "friendly-detail
  rendering polish" to Phase 5, but the §6 Phase-5 row never scoped it and Phase 5 did
  not deliver it (the S4/reconnect card + the TC poll DO humanize). Post-ship polish
  candidate: fold `classText(code).title` at that one site (ref line unchanged); also
  retire the stale comment.
- (named at the 2026-06-13 Phase-5 audit) the null-ref row renders `session:<id>` but
  the tab/export filters match the BARE session_ref — a user who copies the ROW token
  (with the `session:` prefix) into the filter gets "No records match" (tab and export
  miss IDENTICALLY, so the MED-2 screen-vs-export invariant holds). LOW UX seam;
  candidate: strip a leading `session:` in both matchers.

**Deep-audit pass residuals (Phases 1+0 re-audit, post-§13; deliberate):**
- Mock-only test gaps remain on the IO shell (aggregate merge math, TTL-option
  fallback, owner-precedence) — verified by reading; Live E2E exercises them.
- counts KEYS + jira field_names stay a single-token ASCII channel by design (the
  wall cannot distinguish `stories_failed` from `Roadmap`); call-site discipline +
  review hold the line; an allowlist was REFUSED (over-engineering, keys grow per phase).
- The concurrent-'ended' divergence is now guarded at the WIDE window (post-fetch
  re-read before the failed write; the flag write re-reads too). The same
  success-vs-failure clobber pattern in the TC/regen polls is LOW (per-story results
  persist separately; a re-run is cheap) — accepted unguarded.
- The 'ended' worst case (~22-27s with 2-3 cycles + slow LLM tail) PRE-DATES the
  diagnostics (fetch+repair dominate); ledger records run AFTER the persist, so they
  do not widen the dangerous re-bill window. A resolver kill BEFORE the persist is
  ledger-blind (the FE poll catch deliberately does not file client records per tick)
  — visible as a stuck-⏳ dashboard row; accepted.
- surfaced:true is asserted at WRITE time for terminal records (no mark-on-render
  resolver); same optimism family as the A7 csv note — accepted.
- The S4 card's stored detail can say "push it now" after the tab (and the in-memory
  breakdown) is gone — stale-copy cosmetic; the card's Generate-as-retry is the
  recovery.

**Deep-audit pass residuals (Phase 2 re-audit; deliberate):**
- Dedupe-in-place means a RETRY push's record REPLACES the older push's evidence
  (counts/jira/subject/session_ref all freshness-ruled now — no more chimera); the
  OLDER push's distinct cause-split survives only in occurrences.count + the
  overwritten zone-2. Inherent to §2.5 dedupe-in-place; documented, accepted.
- Embed-mode (no subtask type) task accounting inherits the name-keyed storyKeyMap
  blindness: dup-named features can over-count tasks_embedded, and a failed story's
  checklist content is counted nowhere — the Layer-1 A1 (name→uid) work is the real
  fix; accepted until then.
- The done-path deletes the session BEFORE the resolver writes the coalesced record
  (sub-second window; a kill there loses the record — the client invoke_rejected
  fallback still marks the incident). Accepted.
- Mixed-endpoint unresolved links (one endpoint failed-story + one paraphrase)
  classify as name_unknown (the more actionable bucket) — documented tie-break.
- A raced duplicate pushStep after completion files a surfaced session_not_found
  warn though the user saw success — dedupe-absorbed, cosmetic.
- jira[] cap eviction now protects an UNSEEN status (replaces a duplicate-status
  entry); a new SHAPE of an already-seen status still drops — the status signal is
  what support routes on.

**Deep-audit pass residuals (Phase 3 re-audit; deliberate):**
- The zone-2 single-sibling-per-ref clobber has a CROSS-FLOW flavor: a generation
  truncation_note (the only durable record of which features were salvaged) can be
  overwritten by a later TC-failure detail under the same jobId — extra justification
  for the named "key details by ref+op" polish candidate (NOT taken in Phase 5 —
  re-deferred post-ship, 2026-06-13 audit).
- persistLikelySize's 200KB threshold leaves a 200-240KB gray band where a transient
  outage reads as "too large" — deliberate one-sided heuristic (stringify bytes
  undercount the KVS wire envelope; both wordings lead with the same recovery).
- Failed-bookkeeping/flag writes can resurrect a just-purged job: kvs.get → undefined
  → spread of the stale top-read re-creates job:+jobmeta: (~1KB no-TTL orphan,
  invisible to all surfaces — tracked list filtered, pageJob deleted). Pre-existing
  pattern, rarity-bounded; accepted.
- The classifier's `not_configured` case is defensive-only on the generation path
  (jobApiKey is resolved once per invocation and passed through) — kept because it is
  the honest mapping if a future path ever feeds the code.
- TC-start `managed_unavailable` shows a ref with no record for that incident (the
  per-flow record copies remain a §7 Phase-4 conditional) — slightly more visible now
  that submit-failure refs render; unchanged decision.

**Deep-audit pass residuals (Phase 4 re-audit; deliberate):**
- The TC/regen poll terminal guards now mirror the generation yield-to-any-terminal
  rule (the old "re-run is cheap" rationale was WRONG for the bulk: a clobbered
  'completed' made the per-story results status-gated unreachable and the natural
  retry RE-BILLED the full TC batch, ~$1-3.67).
- A5 truncated semantics finalized: the flag rides the LIVE regen response + FE
  patch; SAVE clears it on screen AND in storage (clear-on-save = the BA's review
  act); the export carries "may be TRUNCATED" markers (Gherkin in-file + FE note;
  counts/idxs additive on the response).
- The regen per-entry cause record has no zone-2 (per-story sentinels carry codes
  only, no detail text — nothing meaningful to write); the bulk path's per-story
  zone-2 summary covers the batch view.
- The §2.4 "distill-cap gate row is STALE" residual line was itself WRONG — the gate
  exists (gated-but-not-consumed); its fail-open now records `gate_fail_open`
  (op distill.step), completing the fail-open trio.
- Old-tail orphans closed via the tcjob `maxTotal` high-water mark (re-stamp after an
  editor delete used to orphan testcases:/tcregenjob: tails past the new total).
- counts spread-order rule: a future per-story sentinel literally named `ok`/`failed`
  would shadow the totals in causeCounts — naming rule, registry review catches it.
- Per-card CSV copy of a render-thrown story silently no-ops; Gherkin copies
  marker-only text with "✓ Copied" — cosmetic, FE-unreachable for errored stories.

**Final seams-audit residuals (cross-phase pass, 2026-06-13; deliberate):**
- FIXED at the pass: the push-purge × in-flight-TC-poll yank (HIGH — background TC
  error/failed branches now screen-gated like completed; Create button warns when
  tcGenerating; purge records a `tracking_degraded` warn with `tc_run_discarded` when
  it deletes a batched/pending tcjob) · the 7-site testgen.batch/kvs_write_failed
  junk-drawer tuple (split via the new `testgen.poll` op — batch-outcome records stay
  testgen.batch) · row recency display = sort recency (lastTs) · the J7 tripwires
  (FE-map sync + call-site literal scanner) are now offline tests.
- J2: a CROSS-USER job's per-user export is half the truth (generation records in the
  owner's ring, push records in the pusher's) — the push record is self-sufficient
  for the "my push failed" flow; the admin 'all' export stitches both. Named here so
  support never reads the owner's half as "the push never happened".
- J3: during a KVS outage the ledger itself is fail-open-blind (console only); an
  outage-window error screen can show a ref with NO record behind it (the never-
  written flavor of the known purge flavor). The product surfaces carry the outage
  narrative loudly; no in-band tripwire is possible without the same down KVS.
- J4: the `:agg` sidecar is CLASS-keyed — `kvs_write_failed: N` cannot say which
  subsystem (the rings + op labels carry that); deliberate triage-only scope.
  Doc-enum drift: §1's op example list says 'export' (shipped: testgen.export);
  startPush-time failures file under op push.step though no step ran — naming only.
  `story_removed` is registered+mapped but type-A unrecorded (orphan-card chip is
  the surface) — consistent with the intended-block policy.
- J5: regen tuples merge ACROSS storyIdx (subject is not in the dedupe key) — a
  merged row's subject shows the newest story only, occurrences count all; the
  per-card ⚠ carries per-story truth. The 3 client-fallback sites share
  (jobId, invoke.failed, invoke_rejected) — identical surfacing, accepted.
- J6: the Diagnostics tab does not auto-refresh while open (load on mount/scope/
  health/clear); a persistFailed completion observed while ON the admin screen
  discards the inline breakdown (the named background-driver residual extends here).
- J1: the zone-2 consent-export section is labeled by ref only — under one jobId the
  surviving detail is the LAST writer's (usually the push detail); the re-deferred
  ref+op keying would also fix the label.

## 8. Compliance touch-ups for the NEXT policy/listing edit (non-blocking)

Privacy §5: + "Operational records — usage counters and per-user diagnostic entries
(operation codes, identifiers, timestamps, counts — never page content), kept in your
instance until uninstall." · Privacy §6: soften the absolutist "no user identities" line
(already imprecise for the in-review per-user metering). · A "Support & diagnostics"
paragraph with the feature release (sender-email handling, report contents). · Scope
justification: `storage:app` + "operational records". · Optional "Clear diagnostics"
button (GDPR erasure self-service). · §2b retention line: *"short failure
diagnostics (which may quote the failing item's name) are kept up to 30 days in your
instance to support troubleshooting; they never leave your instance unless you choose to
send them."*
