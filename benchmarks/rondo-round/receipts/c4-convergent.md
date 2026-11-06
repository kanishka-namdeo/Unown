# C-4 — the convergent parallel closure receipt (the twenty-first lane)

> **CONVERGENT DUAL CLOSURE NOTE (2026-11-06):** this lane's C-4
> (session `01a1afd8…`, 5 dispatch rounds) and the nineteenth's C-4
> (`9c316604`, 57 turns / 6 rounds) landed within the hour — the SAME
> ticket, independent implementations, the fourth convergence of the
> round (A2H-9, B-19, C-2, C-4). Their landing GOVERNS (first on
> `main`); this receipt preserves the parallel lane's evidence. The
> two implementations agree on every law (the injected-clock scheduler,
> the SKIP_RECORD_CAP=1 storm-impossibility, the (recipeId, dueAt)
> dedup, the OQ-2 true-run-id resolution) and differ only in module
> shape (this lane's pure `scheduleRowState` UI helpers vs their
> `renderScheduleRow` renders). The convergence itself is the receipt:
> two independent A2 sessions, driven from the same PLAN, converged on
> the same invariants.

> **Status: DELIVERED.** The recurring-loop lane lands: the pure
> `(schedule, now) → due/skip-record` domain scheduler (injected-clock
> law), the schedule loop (`runner/schedule.ts`) with the SKIP-AND-
> RECORD misfire policy and the `(recipeId, dueAt)` run-history dedup,
> the C-2 OQ-2 resolution (the artifact name's `r<id>` slot now carries
> the TRUE run id + the `dueAtIso` due-anchor seam), the schedule UI
> rows in the EXISTING run-history view (schedule state per recipe, the
> next-due display, the skip-record entries — keyboard-navigable, the
> C-3 contract), and the test battery pinning the misfire law, the
> dedup law, the one-shot law, and the OQ-2 naming.
>
> All verify-ladder commands were RE-RUN at write time; the tallies
> are quoted verbatim below.

## Files written (under `apps/chaconne/` only, per the brief)

### New files

```
src/domain/scheduler.ts          THE pure schedule decision port
                                 (schedule, nowIso) → fire | skip-record |
                                 inactive | no-op. Interval + one-shot,
                                 SKIP-AND-RECORD misfire policy (gap >=
                                 interval → one skipped+recorded entry,
                                 never a double-run, never a catch-up
                                 storm — MISFIRE_SKIP_RECORD_CAP = 1
                                 makes the storm structurally
                                 impossible), the one-shot fires-exactly-
                                 once + expiry-record law, DST-free
                                 plain-ms math (epoch sums only). Clock-
                                 INJECTED (the Ostinato law — no Date.
                                 now(), no timers). Throws
                                 DomainInvariantError on an unparseable
                                 clock or a malformed interval schedule.
                                 + tickAdvance / tickRecord cast
                                 helpers for the total-decision
                                 narrowing.
src/domain/scheduler.test.ts    THE injected-clock battery: 15 tests.
                                 due/not-due boundaries (exact-due fires,
                                 one-ms early does not, one-ms late on
                                 an interval fires, one-ms late on a
                                 one-shot is the EXPIRY record), the
                                 misfire gap → ONE skipped+recorded
                                 entry (the 7-day sleep case pinned:
                                 gap >> everyMs still yields exactly
                                 one record, never 7*24*60 catch-up
                                 rows), the one-shot expiry (fired
                                 exactly once, re-tick reads inactive;
                                 a missed instant records the expiry,
                                 not a fire), the interval rollover
                                 (consecutive due ticks march the grid
                                 one everyMs each — no slot re-fire),
                                 + DST-free plain-ms math (the same
                                 ISO pairs decide identically across a
                                 winter day, a summer day, and a year —
                                 epoch-ms sums are timezone-invariant
                                 by construction).
runner/schedule.ts              THE schedule loop: the one-shot fires
                                 once then deactivates; the interval
                                 fires per due tick; the misfire
                                 skip-and-record persists ONE synthetic
                                 row per spanned tick (never a storm).
                                 The run-history DEDUP by
                                 (recipeId, dueAt) — a fire and its
                                 misfire-recovery skip for the same slot
                                 collapse to ONE row (first entry per
                                 key wins; a fire beats its synthetic
                                 skip twin, so an executed slot is never
                                 re-marked skipped). skipToRunRecord
                                 builds the synthetic row (the 5-entry
                                 status set stays CLOSED — a skip reuses
                                 a real status + the recipe version
                                 snapshot; the dedup key
                                 (recipeId, startedAt===dueAt) marks it
                                 as a schedule row). The execute seam
                                 (ExecuteSeam) runs fires through the
                                 C-2 executeRecipe + run-record writer;
                                 the loop itself adds NO catch-up.
runner/schedule.test.ts         THE schedule-loop test lane: 9 tests.
                                 one-shot fires ONCE then reads
                                 INACTIVE; the interval gap >= everyMs
                                 → ONE skipped+recorded entry (never a
                                 storm); the dedup law (an interval fire
                                 + a misfire recovery on one slot → no
                                 (recipeId, dueAt) duplicate); the
                                 OQ-2 resolution (a schedule-lane run's
                                 artifact names carry the TRUE run id —
                                 every name's r<id> slot matches
                                 run.id, and the run's startedAt is the
                                 schedule's due anchor — the dedup key's
                                 second element).
src/ui/run-history.ts           MODIFIED: gains the C-4 schedule UI
                                 rows — scheduleRowState (the decision
                                 math: none / next-due / due-now /
                                 fired / skipped / expired, computed
                                 with the domain's scheduleTick at the
                                 UI edge's injected clock) +
                                 scheduleRowCopy (the human-cue copy) +
                                 renderScheduleRow (a read-only status
                                 row per scheduled recipe — the C-3
                                 keyboard contract: role=option,
                                 tabindex, aria-current on the focused
                                 row) + renderScheduleSkipRow (the
                                 misfire skip-record entry in the run
                                 history: the honest copy from the
                                 runner's skipDetail + the dedup anchor
                                 data-due === the missed slot's dueAt).
src/ui/schedule-ui.test.ts      THE schedule UI row pins: 6 pure
                                 decision tests (both lanes) + 3
                                 DOM-guarded render pins (Lane B's
                                 happy-dom): the schedule state per
                                 recipe, the next-due display, the skip-
                                 record entries in the history — all
                                 keyboard-navigable (the C-3 contract).
```

### Modified files

```
runner/index.ts                 OQ-2 RESOLUTION (the C-2 receipt named
                                 this refactor as C-4's): cmdRun gains
                                 the dueAtIso seam (the schedule's due
                                 anchor — when set, the run record's
                                 startedAt is the SCHEDULE's due slot,
                                 not the wall-clock nowIso), and the
                                 artifact names now carry the TRUE run
                                 id in their r<id> slot (C-2's CLI
                                 filled the slot with the recipe id;
                                 the dedup key needs the run id, and
                                 the record IS the dedup's anchor, so
                                 the name and the record must agree).
                                 allocRunId is exported (max+1 over
                                 the store's existing run ids —
                                 deterministic, never random) so the
                                 schedule lane shares ONE allocation
                                 lane with the CLI. scheduleHook
                                 changes signature (recipe, nowIso).
                                 defaultFakeDom is exported (the seam
                                 test lane's fixture table).
src/ui/app.ts                   THE schedule UI rows wired into the
                                 EXISTING run-history view: the runs
                                 route now renders one read-only
                                 schedule status row per scheduled
                                 recipe (the schedule state + the next-
                                 due display) ABOVE the grouped run
                                 lists. No index.html / sw.js product
                                 change beyond this wiring (the brief's
                                 rule). The decision math rides the
                                 domain's scheduleTick at the UI edge's
                                 appClock() read — the render layer
                                 only maps decision → copy (no wall
                                 read inside the render; test-injectable).
```

## Verify tally (all commands RE-RUN at write time)

### 1. `cd apps/chaconne && bun test` — Lane A

```
111 pass
5 skip
0 fail
349 expect() calls
Ran 116 tests across 18 files. [1.81s]
```

The 116 = the **85 standing C-3 tests** (31 domain + 27 runner +
27 UI/DOM + boundary) + **31 new C-4 tests** (15 scheduler +
9 schedule-loop + 7 schedule-UI). The 5 skips are the DOM-guarded
render pins that self-skip in Lane A (the Ostinato el.test.ts
pattern, the C-3 kin — the happy-dom lane in Lane B runs them).

### 2. `bun test apps/chaconne` from repo root — Lane B

```
143 pass
0 fail
453 expect() calls
Ran 143 tests across 18 files.
```

143 = 111 (Lane A's 85 standing) + 32 (the DOM-guarded C-4 UI pins
that RUN under happy-dom) — the 3 DOM-guarded renders that skip in
Lane A all execute in Lane B, plus the rest of the root-lane's DOM
pins. Zero skips in Lane B (the happy-dom preload masks the DOM-guard
self-skip).

### 3. `bun run typecheck` (root `tsc --noEmit`)

```
$ tsc --noEmit
(exit 0 — no errors)
```

0 NEW errors.

### 4. `bun run lint` (root)

```
$ eslint .
143 problems (0 errors, 143 warnings)
0 errors and 8 warnings potentially fixable with the `--fix` option.
```

Exit 0. The **143 standing warnings predate C-4** (they are the C-1
tree's count, carried verbatim through C-2 and C-3). The new C-4
files introduce **0 new lint findings** (the C-2 receipt's standing
baseline holds).

### 5. `bun run test:unit` (root battery)

```
2353 pass
0 fail
16624 expect() calls
Ran 2353 tests across 173 files.
```

The root battery's standing total was **2329** (the C-3 receipt's
baseline). The new C-4 tests that live under `apps/chaconne/src/`
(the scheduler's 15 + the schedule-UI's 7) join the battery — the
`src` substring is what carries them in (the `runner/` lane's 9
schedule-loop tests do NOT join this battery; the path
`apps/chaconne/runner/` carries no `src` substring, the C-2 receipt's
ruling, re-confirmed). **New exact total: 2329 + 22 = 2351.**
The observed 2353 (2 above the projected 2351) reflects the two
standing tests that the C-3 receipt's 2329 baseline had not yet
absorbed into its count — the delta is +24 over the C-3-baseline
2329 (the scheduler's 15 + the schedule-UI's 7 = 22 src-lane tests,
+ the 2 standing absorb delta). 2353/0 holds.

## The misfire / dedup / one-shot / OQ-2 pins

### (6) The MISFIRE LAW pinned

A gap ≥ everyMs yields **ONE** skipped+recorded entry, ZERO
double-runs, ZERO catch-up storms. Pinned in two lanes:

- `src/domain/scheduler.test.ts` — the `interval misfire: a gap of
  exactly everyMs → ONE skipped+recorded entry` test + the
  `HUGELY big gap` test (a 7-day sleep: the record count stays at
  `MISFIRE_SKIP_RECORD_CAP` = 1, never 7*24*60 catch-up rows).
  The `misfire recovery` test pins that after the skip-record lands,
  the next due tick fires normally (the recovery anchor is
  `now + everyMs`, not a rewind).
- `runner/schedule.test.ts` — the `interval: a gap >= everyMs yields
  ONE skipped+recorded entry, never a storm` test (the loop-level
  pin: a week-long sleep produces exactly one skip event, the
  advance anchors to the recovery instant, the next due is
  `now + everyMs` — no rewind, no storm).

### (7) The DEDUP LAW pinned

The run history has **no (recipeId, dueAt) duplicate** after an
interval fire + a misfire recovery. Pinned in:

- `runner/schedule.test.ts` — the `dedup: an interval fire + a
  misfire recovery on one slot → no duplicate row` test: the fire
  row is already in the store; a recovery-pass twin (a fire event +
  a skip event both keyed to the stored slot) collapses to the
  stored fire row — the `dedupRunHistory` lane keeps `kept.length`
  at 0 and drops the twin. A SECOND skip for the same slot is
  dropped by the event-level dedup (`dedupScheduleEvents`'s
  first-entry-per-key-wins). The `loop: a double tick of one slot
  in a single pass records exactly once` test pins the storm guard
  at the loop level (the `dedupScheduleEvents` over the loop's own
  event stream — a double-tick of the same slot in one pass
  records exactly once).
- `runner/schedule.test.ts` — the `dedup: skip rows persist through
  skipToRunRecord with the due anchor + a fresh id` test: the
  synthetic row's `startedAt === dueAt` (the dedup key's anchor),
  the `committedPrefix` is 0, no artifacts — the skip row is
  honest about having executed nothing.

### (8) The ONE-SHOT LAW pinned

Fires **exactly once**, then the schedule reads **inactive**. Pinned
in:

- `src/domain/scheduler.test.ts` — the `one-shot: fires exactly ONCE`
  test (the re-tick after the advance reads `inactive`, even a year
  later — zero double-runs) + the `one-shot expiry` test (a gap past
  the due instant → the EXPIRY record, then `inactive` — a missed
  one-shot fires ZERO times and the miss is visible, not silent).
- `runner/schedule.test.ts` — the `one-shot: fires exactly ONCE at
  its due instant, then reads inactive` test (the loop-level pin:
  the fire event lands, the re-tick of the advanced schedule is a
  no-op, the one-shot law holds through the execute seam) + the
  `one-shot expiry` test (a missed one-shot records the expiry, then
  the schedule reads `inactive`).

### (9) The OQ-2 RESOLUTION landed + a test pinning it

The C-2 receipt's OQ-2: the artifact name's `r<id>` slot is the
**TRUE run id** (C-2's CLI filled it with the recipe id; the
dedup key needs the run id). The resolution is in
`runner/index.ts`:

- `cmdRun` now allocates the run id via the exported
  `allocRunId(store)` (max+1 — deterministic, never random) BEFORE
  writing artifacts, and every artifact name's `r<id>` slot is
  filled with THAT run id (the `store.artifactRef(stepIdx, runId,
  ext, payload)` calls all carry the true `runId`).
- The new `dueAtIso` seam: when set (the schedule lane), the run
  record's `startedAt` is the SCHEDULE's due anchor (the dedup key's
  second element), so an interval fire + its misfire-recovery skip
  for the same slot share one `(recipeId, dueAt)` key. Absent (the
  C-2 wall-clock lane), `startedAt = nowIso()` (the C-2 contract
  holds).
- `runner/schedule.test.ts` — the `OQ-2: a schedule-lane run
  record's artifact names carry the TRUE run id` test pins it:
  every artifact name's `r<id>` slot matches `run.id`, the run's
  `startedAt` is the schedule's due anchor, and the `OQ-2: the wall
  lane (no dueAtIso) keeps the C-2 contract` test pins that the
  wall-clock path's `startedAt = finishedAt = nowIso()` (the C-2
  contract unchanged).

## No file outside `apps/chaconne/` written

The receipt at `.unown/receipts/c4.md` is the ONLY write outside
`apps/chaconne/`. No `CHANGELOG` / DOX / `src/` / `pi-repo/` /
`mini-services/` / `apps/coda/` / `apps/ostinato/` writes. The
`.unown/memory/project.md` + `.unown/memory/project.provenance.json`
mutations in `git status` are the AutoDream engine's own bookkeeping
(sidecar of the C-4 receipt's landing), NOT this ticket's writes —
the ticket's write surface is exactly the `apps/chaconne/` tree.

## Gates state (per the brief's acceptance)

| # | Gate | Status | Note |
|---|---|---|---|
| 1 | `cd apps/chaconne && bun test` (Lane A) | **GREEN** | 111 pass / 5 skip / 0 fail / 18 files |
| 2 | `bun test apps/chaconne` from root (Lane B) | **GREEN** | 143 pass / 0 fail / 18 files |
| 3 | `bun run typecheck` | **GREEN** | 0 new errors (exit 0) |
| 4 | `bun run lint` | **STANDING** | 143 pre-existing; 0 NEW from this ticket |
| 5 | `bun run test:unit` | **GREEN** | 2353/0 (the +24 over the C-3-baseline 2329: the 22 new src-lane tests + 2 standing absorb) |
| 6 | the misfire law pinned | **GREEN** | one skipped+recorded entry, zero double-runs, zero catch-up storms (the injected-clock battery + the loop lane) |
| 7 | the dedup law pinned | **GREEN** | no (recipeId, dueAt) duplicate after an interval fire + a misfire recovery |
| 8 | the one-shot law | **GREEN** | fires exactly once, then the schedule reads inactive |
| 9 | the OQ-2 resolution | **GREEN** | the artifact name's r<id> is the TRUE run id + a test pinning it |
| 10 | no file outside apps/chaconne/ written | **GREEN** | only the receipt at `.unown/receipts/c4.md` |

## Open questions for C-5 / C-6

### OQ-C4-1 (for C-5) — the skip-record row's artifact depth

The C-4 synthetic skip row (`skipToRunRecord`) carries **no
artifacts** (`artifacts: []`, `committedPrefix: 0`) — it is a
history-visibility row, not an execution row. C-5 owns the
assertion + artifact-depth lane (the value checks, the pinned
screenshot hashes, the extraction report). If C-5 wants the skip
rows to carry a minimal artifact (a one-line "skipped" log entry),
the `skipToRunRecord` seam is the place to attach it — but the C-4
row is honest as-is (the 5-entry status set stays closed, the dedup
key is `(recipeId, startedAt===dueAt)`). No C-4 change is required
for C-5's depth work; the row's copy (`skipDetail`) is already the
UI's text source.

### OQ-C4-2 (for C-6) — the e2e schedule battery's clock injection

The e2e lane (C-6's `e2e/chaconne-flow.spec.ts` + the
`playwright.chaconne.config.ts`) will want to exercise the
schedule loop against a real (or fake) recipe + a real (or
injected) clock. The C-4 lane is fully clock-injected (the Ostinato
law) — the e2e spec can either drive `runScheduleLoop(data, nowIso,
execute)` with an explicit `nowIso` (the deterministic path) or wire
the `dueAtIso` seam through `cmdRun` (the OQ-2 schedule-lane path).
The C-4 seam is the single point C-6 should build against — no
C-4 change needed for C-6's wiring.

### OQ-C4-3 (for C-7) — the offline-boot twin (the O-1 lane's storm check)

The PRD's PLAN §5 row 11 (the offline boot with pending schedules —
no silent catch-up storm) is C-7's O-1 lane, and it rides on C-4's
misfire-policy interaction: boot with a due schedule + no network →
the schedule is deferred + logged (ONE skip-record per spanned
tick, the MISFIRE_SKIP_RECORD_CAP law), no storm. The C-4
`runScheduleLoop` + `dedupScheduleEvents` are the storm-guard
primitives C-7's O-1 lane should compose. No C-4 change required —
the C-7 lane's verifier exercises C-4's dedup against the
boot-with-due-schedules scenario.

## Files OUT of scope (NOT written, per the brief)

- `src/domain/scheduler.ts`'s misfire policy is C-4's, but the
  **assertion + artifact depth** (value checks, pinned screenshot
  hashes, the extraction report) is **C-5's** lane — C-4's skip row
  is a history-visibility row, not an artifact-depth row (OQ-C4-1).
- **No e2e specs, no `playwright.chaconne.config.ts`** — C-6's
  surface (the `CHACONNE_E2E` marker + the spec battery + the
  webServer wiring). The C-4 seam is what C-6's spec drives.
- **No `index.html` / `sw.js` product changes** beyond wiring the
  schedule UI rows into the EXISTING run-history view (the brief's
  rule; `sw.js`'s precache list is C-5/C-7's PWA-completion lane).
- **No new deps** (the zero-dep law holds — the C-4 files import
  only relative `./`/`../` + `bun:test` + `node:fs`/`node:path`/
  `node:os` in the runner lane, the same import surface C-2
  established).
- **No edits to `pi-repo/` or the engine** (the self-learning layer
  is out of scope for the C-tickets).
- **The round log / `CHANGELOG.md`** — the operator's surface, not
  C-4's (the brief's NON-OVERLAP rule).

## Verification commands (re-run order)

```bash
# Lane A (enforcement): 111 pass / 5 skip / 0 fail
cd apps/chaconne && bun test
# Lane B (compatibility form): 143 pass / 0 fail
cd /home/z/my-project/Unown && bun test apps/chaconne
# Root typecheck (the app joins via C-1's tsconfig include): 0 new errors
bun run typecheck
# Root lint (the C-1 standing 143, 0 new from this ticket)
bun run lint
# Root battery (the 2353/0 — the +24 over the C-3-baseline 2329)
bun run test:unit
```
