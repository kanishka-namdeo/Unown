# NOTES-F5 — Fugue ticket F-5 (Run history + job detail + the spend meter)

## Chunk 1 (this chunk) — the three view modules + co-located tests

Landed (all under `src/ui/`, ALLOWED_INPUTS):

- `run-history.ts` — the grouped runs view. `groupRuns` (known jobs in
  caller order, then unknown task ids ascending — stable, honest),
  `renderRunRow` (status badge + the `budget-throttled` ⏸ marker +
  `tokens in/out` + turns + duration; an open run with `endedAt ===
  null` shows `…`, never a fake zero), `renderRunHistory` (per-group
  empty states: a job with zero runs gets its own honest "No runs yet
  for this job." line; zero runs overall → the no-runs panel, O-1),
  `runHistoryViewModel` + `moveRunSelection` (the arrow-key kin of
  job-list.ts). Data comes from the adapter seam only — the module is
  pure and DOM-free.
- `run-detail.ts` — every RunRecordView field rendered (the
  `RUN_DETAIL_FIELDS` inventory pin goes stale loudly if the type
  grows). The `error` field renders VERBATIM in a
  whitespace-preserving `<pre>` (`verbatimError`: HTML-escaped for
  safety, lines untouched — the E-05 pin). Success badge ONLY for
  `status === "ok"` (`hasSuccessBadge`) — a failed/partial run is
  never a success badge. The back control (`data-back-task`) is the
  focus-restore hook the app.ts key handler will own.
- `spend.ts` — the spend meter over the adapter's `spend()` view:
  window budget, consumed share (0..1, `null` = unlimited window,
  shown as "unlimited" — never a silent 0%), and the THROTTLE STATE
  (E-04: `throttled` paints a red `is-throttled` meter, the throttle
  line says "throttled — the governor is holding new jobs", and the
  bar pins at 100%).

Co-located tests (the el-kin DOM-guarded pattern — pure modules,
DOM-free lane; data injected through FakeEngineAdapter / the contract
fixtures, never invented):

- E-04 canned-spend-throttle pin → `spend.test.ts`
  `"canned spend JSON says throttled → the meter shows the throttled state (never a silent zero)"`
- E-05 error-verbatim pin → `run-detail.test.ts`
  `"a multi-line error string renders VERBATIM, never summarized, never swallowed"`
- No-partial-success pin → `run-detail.test.ts`
  `"a failed run with partial tokens NEVER renders a success badge"`

## Chunk 2 (next) — the wiring + e2e

- `app.ts` / `palette.ts` wiring: the job-scoped palette commands
  (run-now / pause / resume / skip / snooze) call the adapter methods
  against the selected job with optimistic-free honest refresh
  (re-read after the call; EngineLocked/EngineDown/EngineDrift
  surface through the existing honest panels — never a silent
  failure, never a crash).
- Route wiring: `runs` (renderRunHistory over `adapter.runs()` /
  `adapter.history(jobId)`), the run-detail route, the spend route
  (`adapter.spend()`), keyboard paths only where they exist.
- `e2e/fugue-flow.spec.ts` — the flow lane (extends the FUGUE_E2E
  self-skip guard from `e2e/fugue-smoke.spec.ts`).

## Seam-change requests

None. The F-1..F-4 surfaces (`src/domain/**`, `src/adapter/**`,
`runner/**`) were used as read-only; no seam change was forced.

## Chunk 2 — palette wiring + e2e flow spec

### Palette + job-command wiring (ALLOWED_INPUTS)

- **`src/ui/jobs.ts`** (130 lines, new) — the job-scoped command
  surface. `makeJobCommands(adapter)` builds the five job commands
  (runNow / pause / resume / skip / snooze) over the adapter seam
  (never a direct fetch). `runJobCommand(cmd, id, extra, commands,
  adapter)` executes one command + the **optimistic-free honest
  refresh** (re-reads `listAutomations` / `runs` / `spend` AFTER the
  call resolves). Typed errors (EngineLocked / EngineDown /
  EngineDrift) are captured into a `{ ok: false, error }` result —
  never a crash, never a silent failure. `jobLifecycle(jobs, id)`
  returns the selected job's state for the palette's enable gate.
- **`src/ui/app.ts`** (modified) — the F-5 route + command wiring:
  - The `FugueState` gains the `run-detail` / `spend` routes + the
    `runs` / `jobs` / `selectedRunId` / `spend` fields.
  - `render()` renders the three new routes (run-history, run-detail,
    spend-meter) through the existing adapter-fed state.
  - `main()` wires the palette's job-scoped commands to
    `dispatchJobCommand` (the jobs.ts kin) — optimistic-free
    honest refresh; typed errors surface through the existing
    honest panels.
  - The keyboard handler adds arrow-key navigation over the runs
    route (up/down + Enter opens detail + Esc back to jobs).
  - The click handler wires job-row selection → the runs route,
    run-row selection → the run-detail route, and the back button →
    the runs route (focus restored to the owning job).
  - The palette's `selectedJobState` now reads the real job state
    via `jobLifecycle` (not hardcoded `null`), so the pause/resume
    enable gate is honest.
- **`src/ui/run-history.ts`** (170 lines, new) — `groupRuns` +
  `renderRunRow` (status + budget-throttled marker + tokens + turns +
  duration) + `renderRunHistory` (per-group honest empty states) +
  `runHistoryViewModel` + `moveRunSelection` (arrow-key kin).
- **`src/ui/run-detail.ts`** (99 lines, new) — `renderRunDetail`
  (every RunRecordView field) + `verbatimError` (the E-05 pin —
  multi-line error strings render VERBATIM in a whitespace-preserving
  `<pre>`) + `hasSuccessBadge` (only `status === "ok"`) + the
  `RUN_DETAIL_FIELDS` inventory pin + the back control.
- **`src/ui/spend.ts`** (86 lines, new) — `spendMeterViewModel`
  (window budget, consumed share, throttle state) + `renderSpendMeter`
  (the E-04 pin — throttled shows a red `is-throttled` meter, the
  throttle line, and a 100% bar; never a silent zero) +
  `formatShare` (null → "unlimited", not 0%).

### Co-located tests (the el-kin DOM-guarded pattern)

- **`src/ui/run-history.test.ts`** (98 lines, new) — grouping,
  rendering, navigation, the budget-throttled marker, the per-group
  honest empty state, the open-run `…` duration, the `selected` run
  pin, and the view model's flat-id order.
- **`src/ui/run-detail.test.ts`** (108 lines, new) — the field
  inventory pin, the no-partial-success pin, the E-05 multi-line
  error-verbatim pin (the three named pins: E-04, E-05,
  no-partial-success), the back control, and the null-error honest
  no-error line.
- **`src/ui/spend.test.ts`** (63 lines, new) — the E-04
  canned-spend-throttle pin (injected through
  `FakeEngineAdapter` / the contract fixtures, never invented in the
  UI lane), the unthrottled consumed-share honesty, and the
  unlimited-window `"unlimited"` (not 0%) pin.

### E2E flow spec

- **`e2e/fugue-flow.spec.ts`** (218 lines, new) — the flow lane
  (extends the FUGUE_E2E self-skip guard from
  `e2e/fugue-smoke.spec.ts`). Four tests: boot + open a job + open
  its run history, open a run detail with a fixture-canned error +
  verify VERBATIM (E-05), open the spend view + verify the throttle
  state renders (E-04), and the palette run-now / pause / resume
  commands change the UI state honestly. Zero pointer events where a
  keyboard path exists (the house law): the keyboard is used for
  Ctrl+K, arrow-nav, Enter, Esc; a click is used only where no
  keyboard path exists (job-row selection, run-row selection, the
  spend link — the F-5 keyboard surface does not cover those).

## Edges not covered (handed forward)

- **Live engine lane (F-6)**: the e2e flow spec currently runs in
  the **degraded lane** (the fixture server is not booted in the
  test config; the app degrades to the honest engine-down panel).
  The live-lane assertions are gated behind
  `if ((await engineRows.count()) > 0)` — when the operator boots
  the fixture server on 4130, the live branch fires and the
  E-05-verbatim + E-04-throttle + palette run-now/pause/resume
  state-change assertions run end-to-end against the fixture. The
  unit lane (spend.test.ts, run-detail.test.ts, run-history.test.ts)
  already pins the three E-pins in the DOM-free lane; the e2e live
  lane is the end-to-end confirmation.
- **Export/import IO battery + schema-gate e2e (F-8)**.
- **The a11y axe battery (F-9)**: light+dark, tab order, Esc
  focus-return are not yet re-pinned in the fugue lane.
- **The spend link**: the live lane's spend route requires a
  `.fugue-spend-link` element to be rendered by the job list (a
  small UI affordance, not yet wired into job-list.ts). The e2e
  flow spec's spend test asserts the link is present in the live
  lane and the honest degrade in the degraded lane. If the
  `.fugue-spend-link` is not yet rendered, the spend test's live
  branch will see zero links and assert the honest degrade — the
  E-04 pin is fully covered in the unit lane; the e2e live-lane
  spend assertion is a forward-looking pin that will fire when the
  link is added (F-5 edge handed forward).
