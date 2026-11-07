# NOTES-F6 — Fugue ticket F-6, chunk 1/3: the live-loop research digest

F-1..F-5 CLOSED. F-6 = THE LIVE LOOP: drive the PWA against the REAL
engine on 127.0.0.1:3030 — create a routine through the compose UI,
run-now it, assert the run + the session note land back in the console.
PLAN laws: >=3 consecutive runs, >=1 cold boot.

## 1. THE LIVE SURFACE

- Node edge (`runner/engine-client.ts`): base URL `http://127.0.0.1:3030`
  with `FUGUE_ENGINE_URL` override (constructor, ~line 80); token
  discovery `opts.token` > `FUGUE_ENGINE_TOKEN` > `$UNOWN_HOME/engine.token`
  (~line 55); 401/403 -> EngineLocked, transport failure -> EngineDown
  (~line 95). Pinned routes: `POST /api/automations`,
  `POST /api/automations/:id/run`, `GET /api/automations/:id/runs`,
  `GET /api/notes`, `DELETE /api/automations/:id`.
- Browser side (`src/ui/app.ts` ~550-562): the base URL is HARDCODED to
  the fixture server — `createFetchClient("http://127.0.0.1:4130")`
  for both `appAdapter` and the boot probe. 4130 is F-3's
  fixture-server port; nothing today points the browser at 3030, and
  no token is sent (the createFetchClient `token` param is unused).
- CORS posture: the real engine echoes the loopback origin + a
  preflight (`server.ts` `corsHeadersFor` ~259; `UNOWN_ENGINE_CORS`
  default is "loopback only"). `runner/fixture-server.ts` mirrors it
  (origin-echo + 204 OPTIONS preflight), so the browser's direct-call
  path to 3030 is already CORS-shaped; only the URL + bearer differ.

## 2. THE TOKEN QUESTION

The browser needs the engine bearer for live calls. Three mechanisms:

- A: serve.mjs injects token/URL into the page at boot (env-driven
  template). Pros: browser code stays clean. Cons: token leaks into
  page source (served, inspectable); serve.mjs grows a template lane.
- B: a tiny authenticated `/engine-config` endpoint on serve.mjs.
  Pros: token delivered on-demand. Cons: still a browser-visible
  token; adds an auth surface to a dev/test server.
- C (RECOMMENDED): the spec sets them via `page.addInitScript`
  (e2e lane only). The spec runs on the same machine as the engine,
  can read `$UNOWN_HOME/engine.token` itself, and injects
  `window.__FUGUE_ENGINE__ = { url, token }` before app scripts run.
  No token in served files, no new endpoint, the PWA code stays
  fixture-default; the live lane is e2e-only by the PRD anyway.
  (app.ts's hardcoded 4130 must read `window.__FUGUE_ENGINE__`
  when present — one small seam read, F-6 chunk 2.)

## 3. THE LIVE SPEC PLAN (`e2e/fugue-live.spec.ts`)

- Marker: extend the existing pattern — the fugue config already arms
  `FUGUE_E2E` (playwright.fugue.config.ts). The live spec self-skips
  unless `FUGUE_LIVE=1` (module-scope `test.skip(process.env.FUGUE_LIVE
  !== "1")`, mirroring fugue-smoke.spec.ts's FUGUE_E2E guard). The SAME
  config + in-spec env check suffices: `testMatch` picks up the new
  `fugue-live.spec.ts`, no second config; `FUGUE_LIVE` is a strict
  subset of `FUGUE_E2E`.
- Preconditions inside the spec: probe `http://127.0.0.1:3030/api/health`
  (or /api/overview) from Node with the token; if unreachable, skip with
  an honest log line (the PLAN's live-lane skip).
- Flow: boot the app (page.goto "/") → `addInitScript` points the
  browser client at 3030 → compose UI: fill title/prompt, submit
  (createAutomation) → select the new row → Ctrl+K → run-now →
  await the run row appearing in the runs view (V-15: expect
  `.fugue-run-row` visible, NO bare sleep; the run record is the
  observable effect). Then assert the session note: `GET /api/notes`
  from Node returns `{ notes: [{id, text, at, ...}] }` (server.ts:1083);
  the terminal note lands there after the run's session ends — the
  spec polls for a note whose text matches the routine's marker.
- >=3 consecutive runs: loop run-now 3x (each is a real model call,
  RPM budget is real — space them, no parallel workers).
- >=1 cold boot: mid-flow, `page.goto("/")` (full reload) → the app
  re-bootstraps from the engine (boot() probes /api/overview, lists
  automations) → the previously created routine + its runs must be
  present in the jobs/runs views after reload.

## 4. EDGE PINS

- E-03 (engine restart mid-flow, re-sync by routine id, no duplicates):
  the spec CAN simulate this — restart the fixture lane's store, or in
  live scope simply re-load the page and assert the routine id from the
  engine's create response still resolves via `GET /api/automations/:id`
  exactly once in the job list. Full engine-restart simulation is OUT
  of live scope (we don't kill the operator's engine); the re-sync
  pin is the duplicate-free job-row count after a cold boot.
- E-02 on the live lane: a real engine-down moment is NOT simulated
  (stopping the operator's engine is forbidden). The spec stays
  honest: it probes at start and SKIPS with a logged reason when the
  engine is absent (never fakes a down-state), and the existing
  degraded-lane e2e (fugue-smoke/flow) already pins the EngineDown
  panel — live spec asserts only the live path, no simulated down.
- Cleanup law: `DELETE /api/automations/:id` (engine-client.ts pinned)
  in a `test.afterEach`/finally — the routine the test creates is
  deleted after, even on assertion failure. Verify the delete with a
  Node-side GET that returns 404/empty.

## 5. OPEN QUESTIONS

1. Does `page.addInitScript` run BEFORE the app module executes (it
   does — Playwright injects before the page's own scripts; verify in
   chunk 2 that `window.__FUGUE_ENGINE__` is visible at boot()).
2. The engine's run-now is a REAL agent session — how long until the
   terminal note lands in /api/notes? If it outlives the 60s test
   timeout, the note assertion may need a longer wait or an async
   receipt (operator decides in chunk 2).
3. Cold-boot "what must survive": the localStorage fugue.v1 document
   or only the engine state? Spec asserts engine-sourced rows survive
   (local shadow jobs are a separate concern, F-8).



## Chunk 2 receipt (live loop)

- app.ts: the seam read landed — `FugueEngineConfig` interface +
  `window.__FUGUE_ENGINE__` global declaration + `engineConfig()`;
  both client constructions (appAdapter + boot probe) now use
  `cfg.url ?? "http://127.0.0.1:4130"` / `cfg.token` (fixture default
  unchanged). Minimal diff, ~15 lines.
- e2e/fugue-live.spec.ts: module-scope FUGUE_LIVE=1 guard (extends the
  FUGUE_E2E smoke pattern; strict subset — the plain lane NEVER runs
  live code); Node-side token discovery mirrors engine-client.ts
  (FUGUE_ENGINE_TOKEN > $UNOWN_HOME/engine.token); addInitScript
  injects `__FUGUE_ENGINE__` BEFORE goto; compose-create (title
  "Fugue live loop probe", prompt "Reply with exactly: FUGUE_LIVE_OK",
  every/1d, read-only); run-now x3 via the palette with run-row
  awaits (V-15, no bare sleeps); cold boot (page.goto("/") reload) +
  E-03 duplicate-free pin (exactly one row); 120s Node-side poll of
  /api/notes for the marker; cleanup DELETE + Node verify in finally
  (RULING 3: hard-fail when the engine is down — probeEngine throws,
  never a silent skip). test.setTimeout(300_000).
- Gates: typecheck 0; Lane A 155/0/20; the plain e2e lane (FUGUE_E2E=1,
  no FUGUE_LIVE): 7 passed + the live spec SKIPPED.
- Hand forward: the operator witness run of the live lane (chunk 3).

## Fix chunk receipt (30th-lineage law, 2026-11-08)

Operator-verified root cause: on the live lane the real engine's boot
resolves slowly, and doBoot() landed AFTER the user opened the compose
dialog, wiping it (detached-DOM + form reset to No-jobs). The fixture
lane never showed it (its boot resolves in ~10ms).

Cure (draft-in-state, per operator ruling):
- FugueState gains `composeDraft: JobEditorDraft | null` (initialState
  null); renderComposeDialog now renders FROM state.composeDraft when
  non-null (not the default).
- openCompose(): seeds composeDraft before rerender; the input handler
  reads/writes state.composeDraft so any rerender re-renders live values.
- Submit/cancel/Escape all clear composeDraft (null) alongside dialog.
- doBoot(): preserves s.route/dialog/composeDraft from app.state BEFORE
  overwriting — a background refresh never closes the dialog, drops the
  draft, or flips the route.

Gates: Lane A 155/0/20; typecheck 0; plain e2e 7 passed + live spec
SKIPPED. No existing compose pin asserted the old dialog shape, so no
pin update was needed (the change is backward-compatible for the
fixture lane). Hand forward: operator witness re-run of the live lane.

## Micro-fix receipt (off-viewport compose submit, 2026-11-08)

Probe: the live lane's Create button sat outside the viewport
('element is outside of the viewport' x58, click retried forever).
Root cause: `.fugue-dialog` is `position:fixed; inset:0` with no
overflow — the 10-field form (margin 8vh) extends past the viewport
bottom on short viewports and the fixed container can't scroll; a real
a11y bug (keyboard + small-viewport users can't submit either). The
fixture lane never noticed: its content was short enough to fit
Playwright's default viewport. Ruling: `apps/fugue/src/ui/fugue.css` —
`.fugue-dialog.is-open` gains `overflow-y: auto` (one declaration,
commented), making the open overlay scrollable so the form (and its
Create/Cancel row) is always reachable; the dialog remains a fixed
inset overlay, unchanged otherwise.

## Cycle-2 receipt (id-model mismatch, 2026-11-08)

Operator-verified root cause: app.ts's job-row click did `Number(jobEl.dataset.job)` —
the engine's automation ids are strings ('auto-mw6bfa7k-5lgq74'), so the coercion NaN'd
and selection silently fell to the local numeric id; run-now POSTed to
`/api/automations/1/run` and no run ever started for the real routine. The fixture lane
masked it (CONTRACT_FIXTURES automations use numeric ids 1/2).

Cure (operator ruling — the widening applies ONLY to the seam + selection surface):
- `AutomationRecord.id: number | string` (engine-adapter.ts); the seam methods
  (runNow/pause/resume/skip/snooze/history) widen to `id: number | string` across
  engine-adapter.ts, rest-adapter.ts (URL interpolation `${id}` already worked for
  strings — verified), and fake-engine-adapter.ts (now compares
  `String(a) === String(b)` so the fixture's numeric ids keep working; the fake's
  synthetic run's taskId stays numeric per the domain grammar).
- `FugueState.selectedJobId: number | string | null`; the click handler stores
  `dataset.job` RAW (numeric fallback ONLY when the dataset is numeric — a string id
  is never dropped); the history fetch passes the id through unchanged; `jobLifecycle`
  compares with String() equality.
- `RunRecordView.taskId` stays `number` (the operator's scope ruling) — no domain
  widening; run-history's jobs input widens to `{ id: number | string }` with
  String()-equality joins (a missed title falls back to "Job <id>", never a crash).
- No pin asserted numeric-only selection, so no test edits were needed (honest).

Gates: Lane A 155/0/20; root typecheck 0; plain e2e 7 passed + live spec skipped.
Hand forward: the operator witness re-run of the live lane.

## Spec-calibration receipt (live-scale run-row await, 2026-11-08)

Operator ruling: the run-row await used the default 6s expect, but a REAL
engine session (bwrap sandbox + a model call) records the run and lands the
refresh in 10-60s. `e2e/fugue-live.spec.ts` only: (1) runNowAndAwaitRunRow's
run-row expect now carries `timeout: 90_000` (a live run's honest ceiling —
exceeding it FAILS honestly); (2) the test timeout widened 300_000 ->
600_000 (3 live runs x up to 90s + the 120s note poll + the cold boot);
(3) the cold-boot run-survival expects keep their default timeouts (the
data is already there — fast). No app code changed.

Gates: Lane A 155/0/20; root typecheck 0; plain e2e 7 passed + live spec
skipped.

## Cycle-3 receipt (final fix: run-row re-render + note wire shape, 2026-11-08)

Operator-probe-verified: the manual run works and is fast (~1.6s, status
succeeded, recorded in automation_runs served by GET /api/automations/:id/runs).
Two defects remained, both fixed:

DEFECT 1 (app): after run-now, dispatchJobCommand's doBoot() refresh replaced
app.state — the fresh boot state's runs field holds the global lane, not the
selected job's history, so the run row never re-rendered (the spec's 90s await
timed out; 3 failed awaits consumed the 600s budget). Cure: refactored the
job-selection history load into a `loadJobRuns(id)` helper (the honest catch
lane the click handler already had); the click handler now calls it; doBoot
calls it at its end WHEN route === "runs" && selectedJobId !== null (after
re-pointing selectedJobId/route/dialog/composeDraft from the pre-boot state
per the earlier preservation ruling), so a refresh lands the fresh history
in view.

DEFECT 2 (spec): the note poll read the WRONG wire fields — the fixture's
text/at shape drifts from the real engine. The live engine's notes are
{ id, run_id, content, created_at }. `awaitLiveNote` now polls
GET /api/notes and matches a note whose `content` contains the LIVE marker
(FUGUE_LIVE_OK), deadline 120s (the honest ceiling; the run completes in
~2s so the note lands quickly).

Gates: Lane A 155/0/20; root typecheck 0; plain e2e 7 passed + live spec
skipped. No pin shape changed (the helper refactor kept the catch-lane
behavior, so app.test.ts needed no edits).

## Cycle-4 receipt (compose-create refresh + engine-lane-pinned spec, 2026-11-08)

Operator probe reproduced the stall: compose-create added the LOCAL shadow
job (id 1) AND created the engine automation (auto-xxx), but NEVER refreshed
— the engine row never rendered, so the spec's click selected the shadow row
and run-now POSTed to /api/automations/1/run (a nonexistent routine).

Cure (operator ruling):
- app.ts compose submit handler: after the successful live createAutomation
  await, `void doBoot()` — the engine row (data-lane="engine", the engine's
  string id) renders in the Engine jobs group; the offline shadow group stays
  (F-1 local-first). The catch lane (outbox honesty, E-02) is unchanged.
- e2e/fugue-live.spec.ts: every job-row selector pins the engine lane
  explicitly — `.fugue-job-row[data-lane="engine"]` with the title filter
  (createRoutineViaUi's post-create row await, the selection click, and BOTH
  cold-boot row assertions). A comment notes that job-scoped commands act
  on ENGINE routines; a shadow-row selection is out of scope for the live
  lane (the enable-rule refinement rides F-7).

Gates: Lane A 155/0/20; root typecheck 0; plain e2e 7 passed + live spec
skipped. No pin shape changed.

## Cycle-5 receipt (contract-layer id-model cure + honest E-02 catch, 2026-11-08)

Operator-proven: assertContract('single-automation', <real create response>)
threw EngineDrift 'automation.id: expected number, got string' — the F-2
contract pins encoded the FIXTURE's numeric ids, but the real engine's
automation ids are STRINGS ('auto-xxx'). The compose submit's empty catch
swallowed the drift silently (an E-02 law violation); the automations
LIST assert drifted the same way per item.

Cure (operator ruling, minimal diff):
- contract.ts: added a `number-or-string` pin kind to the pin() switch;
  the automation id pins (assertSingleAutomation's automation.id, and the
  per-item pinAutomation's automations[i].id) now accept number OR string
  (reject anything else — drift stays drift). Also widened two MORE
  hard-failing pins against the REAL wire shape (per RULING #1 "fix that
  pin the same way"): (a) the schedule field — the fixture lane sends a
  camelCase domain object ({ kind, ... }); the engine-native wire carries
  it as a STRING descriptor (describeRoutineSchedule, e.g. "every 1 day").
  Added an `object-or-string` pin kind and pinned the kind enum ONLY for
  the object form. (b) the state lane — the engine-native wire carries
  "lifecycle" instead of a camelCase "state"; the pin now accepts exactly
  one of { state, lifecycle } (an active|paused string). (c) the optional
  model/timezone fields — the engine-native wire sends null; the fixture
  lane omits them. Widened to string-or-null. Both the single-automation
  assert AND the per-item list assert were fixed consistently.
- app.ts: the compose submit's catch is no longer empty — it renders a
  .fugue-panel.fugue-panel-error div with 'create failed: <message>'
  (the E-02 honest-panel law, matching dispatchJobCommand's pattern).
- adapter-contract.test.ts: added ONE pin test — a string-id automation
  response (the real engine wire shape) PASSES assertSingleAutomation,
  a numeric-id one (the fixture lane) still passes, and a non-numeric/
  non-string id is drift.

Verified against the real wire: /tmp/real-create.json now PASSES both
assertSingleAutomation and assertAutomations (the "real create: PASS /
real in list: PASS" probe). The fixture lane keeps working (its numeric
ids + camelCase rows are the numeric/object form, accepted by the same
pins).

Gates: Lane A 156/0/20 (the new pin test +1); root typecheck 0; plain
e2e 7 passed + live spec skipped.

## Final spec-calibration (live-scale post-create + cold-boot awaits, 2026-11-08)

Operator ruling: the live surface is now proven end-to-end (create -> engine
row renders -> run-now -> the run records). The spec's last fixture-scale
assumption: the post-create engine-row await and the cold-boot row await used
the default 6s expect, but the live engine's create + full boot chain (4
sequential round-trips on a busy engine) needs more.

Cure (e2e/fugue-live.spec.ts only, minimal diff): (1) createRoutineViaUi's
final engine-row expect now carries `timeout: 30_000`; (2) the cold-boot
engine-row expect now carries `timeout: 30_000` (the reload's boot chain is
the same scale). The two run-row expects after run-nows keep their 90s live
scale (unchanged). Nothing else changed.

Gates: Lane A 156/0/20 (the contract pin test rides); root typecheck 0;
plain e2e 7 passed + live spec skipped.

## Cycle-6 receipt (automation-run wire-shape mapping + history pin, 2026-11-08)

Operator-proven: after run-now, the selected job's history load drifted —
GET /api/automations/:id/runs returns the automation_runs wire shape
{ id: "auto-xxx:manual:yyy", automation_id, trigger_kind,
scheduled_at, status: succeeded|failed|running|stopped, started_at,
ended_at, ... } — NOT the generic runs shape the F-2 contract pinned
(task_id, status ok/failed/...). The fixture's history lane serves the
generic fixtures, so the mapping was built against the wrong shape;
against the real engine the assert drifted, the catch flipped the route
back to jobs, and the run row never rendered.

Cure (operator ruling, mapping normalizes at the adapter boundary —
the F-1 law, the closed RunStatus set stands):
- rest-adapter.ts mapRuns now accepts BOTH shapes: taskId <-
  automation_id ?? task_id ?? taskId; status map succeeded->ok,
  failed->failed, stopped->capped, running->ok; endedAt null when
  running (the '…' duration label); trigger_kind -> kind (fallback to
  r.kind ?? "manual"); started_at/startedAt -> epoch ms via toEpochMs
  (number stays, ISO parses, bare numeric string coerces, missing -> 0).
  The generic runs lane (GET /api/runs) keeps its existing behavior
  through the same mapper.
- contract.ts assertRunRecord accepts the automation-run wire form: the
  task reference is task_id OR automation_id OR taskId (exactly one
  required); id is number-or-string; startedAt/started_at (either
  spelling) is number-or-string; status enum widened to the automation
  statuses (succeeded/failed/running/stopped) PLUS the generic set;
  trigger_kind is an optional string; tokensIn/tokensOut/toolCalls/turns
  stay number (the existing F-2 pin). The fixture's generic shape still
  passes (the "a missing run startedAt is drift" pin keeps working —
  the message now starts with "startedAt").
- contract test lane: one new pin test — a canned automation-run history
  response (a succeeded row + a running row, string ids, trigger_kind
  "manual") passes assertRuns and maps correctly (status "ok"; the
  running row's endedAt is null).

Gates: Lane A 157/0/20; the contract lane 9/0; root typecheck 0; plain
e2e 7 passed + live spec skipped.

## Cycle-7 receipt (fake-fallback-id root cause, 2026-11-08)

Operator probe-proven: mapAutomationRow (rest-adapter.ts) destroyed the
engine's string ids — 'id: Number.isFinite(numId) && numId > 0 ? numId :
fallbackId'. For the real engine's 'auto-xxx' string ids, Number() is
NaN, so EVERY engine row got the FAKE fallbackId (1, 2, 3...). The
engine row then rendered data-job="1" and run-now POSTed to
/api/automations/1/run — a phantom routine. The fixture masked it: its
ids are numeric.

Cure (operator ruling): the id now passes through RAW for non-numeric
strings — '... ? numId : (typeof r.id === "string" && r.id !== "" ? r.id
: fallbackId)'. The AutomationRecord.id type was already widened to
number|string in cycle 2 (the id-model widening precedent), so no
engine-adapter.ts change was needed; FakeEngineAdapter + every consumer
(job-list render, palette enable rules, selection passthrough, history
fetch) already accept string ids — typecheck clean, no pin updates
required (the fixture's numeric ids keep the numeric path; the new
string path is additive).

Gates: Lane A 157/0/20; root typecheck 0; plain e2e 7 passed + live
spec skipped.

## Cycle-8 receipt (doBoot preservation of selectedJobId/selectedRunId, 2026-11-08)

Operator network trace proved the full live chain works (create -> engine
row with the real string id -> selection history GET -> run-now POST ->
the run completes in ~1.6s -> the doBoot refresh) except one gap: doBoot()
preserved route/dialog/composeDraft but NOT selectedJobId — the fresh boot
state nulls it, so the post-run-now refresh's loadJobRuns condition
(route === "runs" && selectedJobId !== null) never fired and the run row
never re-rendered. Cure (operator ruling): doBoot's preservation block now
carries s.selectedJobId = app.state.selectedJobId and
s.selectedRunId = app.state.selectedRunId (a refresh must never drop the
user's selection surface, the same law as the 30th-lineage dialog/draft
preservation).

Gates: Lane A 157/0/20; root typecheck 0; plain e2e 7 passed + live spec
skipped.

## Cycle-9 receipt (dispatchJobCommand's global-runs overwrite cure, 2026-11-08)

Operator network-trace-proven: dispatchJobCommand's success branch set
app.state.runs = res.runs, where res.runs is runJobCommand's re-read of
the GLOBAL runs lane (GET /api/runs — the learning-loop runs), NOT the
selected job's automation history. The run-now refresh therefore never
landed the automation's run row in the runs view. Cure (operator ruling):
when the user is on the runs route with a selected job, re-load that job's
own history (loadJobRuns) right before the final render and return — the
non-runs routes keep the global-runs effect (the spend/jobs panels
consume it). The typed-error else branch was preserved alongside.

Gates: Lane A 157/0/20; root typecheck 0; plain e2e 7 passed + live spec
skipped.

## Cycle-10 receipt (dialog-DOM-stability guard, 2026-11-08 — FINAL)

The remaining flake (the live compose intermittently disabled + one
fixture E-04 flake): doBoot's rerender() replaced container.innerHTML
WHILE the compose dialog was open — the draft survives in STATE, but
Playwright's fill was mid-flight on the OLD input nodes; the re-rendered
form restored the draft values, but the in-flight fill on the detached
nodes broke the validation sequence.

Cure (operator ruling, the last): a dialog-DOM-stability guard at the
top of rerender() — while the compose dialog is open (state.dialog ===
"compose" && the [data-compose-form] node is present), a background
rerender does NOT swap the form nodes out: it runs persistAll (keeping
the every-transition law) and returns. The route sections refresh on
the next dialog-less rerender (the refresh command / palette close /
dialog submit all rerender). Two consecutive e2e runs both green — the
E-04 flake did not recur.

Gates: Lane A 157/0/20; root typecheck 0; plain e2e 7 passed + live
spec skipped — TWICE (the flake check).
