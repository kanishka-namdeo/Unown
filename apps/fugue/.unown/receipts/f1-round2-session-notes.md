# Fugue Round 2 (F-1 closing) — Session Notes

## What happened
Operator MECHANISM RULING replaced the retired UTC-offset approach in
`apps/fugue/src/domain/schedule.ts` with local-timezone Date arithmetic
(OS tzdb as the honest zero-dep path) + foreign-zone
"engine-authoritative" fallback. All F-1 domain test files were
completed/aligned: io.test.ts, storage.test.ts, model.test.ts,
boundary.test.ts (plus ids/invariants/types tests aligned).

## Key decisions (verified by green lanes)
- schedule.ts: `nextCronAfter` field-advance bounded to 366-day
  horizon; `firstIntervalSlotAfter` / `advanceIntervalSlot` use
  `setMinutes(hh*60+mm)` + local calendar stepping; `projectSchedule`
  returns `{due, skip, nextAt, preview}` where preview is
  "local" | "engine-authoritative" | "trigger-only". Foreign-zone
  detection: `Intl.DateTimeFormat().resolvedOptions().timeZone`
  (detect-once, cached in LOCAL_TZ).
- Cron `due` semantics: a slot is due when now is within its
  one-minute window — a just-fired slot (found via
  nextCronAfter(now - MIN_MS - 1)) counts, and the active slot is
  returned as `nextAt`. 30s past → due; 30min past → not due.
- `every` misfire: `while (next < nowMs)` marks slots strictly past
  as behind; within 5-min GRACE_MS a missed slot still fires
  (catch-up) with skip:false; beyond grace → skip:true (exactly one
  recorded skip, E-09). A slot landing exactly at now (next == nowMs)
  is due, not behind.
- parseIntervalSpec regex has 4 capture groups: n / unit / hh / mm;
  "at" is stored as `m[3].padStart(2,"0") + ":" + m[4]` → "09:00".
- ids.ts: `nextFreeId(mark)` = mark===0 ? 1 : mark (the stored mark
  IS the next allocation; fresh doc carries 0). `bumpNextFree(mark,id)`
  = max(mark,id)+1. `nextIdFromBoth` = empty ? 0 : maxTaken+1.
- invariants.ts: high-water law is MONOTONIC — `nextId >= maxTaken+1`
  (removals preserve the mark; deleted ids never re-used). Empty doc
  stays at nextId 0. Timestamp fields accept ISO-8601 string OR epoch
  ms (plain-JSON law); `isTimestampString` + `tsParse` normalize.
- model.ts: addJob/addRun use bumpNextFree; removeRun preserves
  data.nextId (monotonic); recomputeNextId uses nextIdFromBoth.
- model.ts addRun: `startedAt` optional (stamps now when omitted),
  `endedAt` defaults to null (an in-progress run never invents a
  finish).

## Both acceptance lanes green (quoted verbatim)
- `cd apps/fugue && bun test` → " 64 pass / 0 fail / 206 expect()
  calls / Ran 64 tests across 8 files."
- `bun test apps/fugue` (repo root) → " 64 pass / 0 fail / 206
  expect() calls / Ran 64 tests across 8 files."

## Deviations from PLAN §1/§2 literal text (documented, not silent)
- PLAN §2 shows `Schedule` with `timezone?: string` on the spec; the
  implemented grammar (house-consistent) carries `timezone` on the
  Job, not the spec.
- PLAN §2 verbatim `Job.createdAt: string` / epoch-vs-ISO: the
  implemented domain accepts both (ISO string OR epoch ms) — the
  Ostinato plain-JSON law; invariants enforce it.
- `FugueData.engineStatus` field from PLAN §2 is NOT persisted in the
  document (recordEngine is a pure observation lane returning the
  unchanged store) — documented in model.ts comment.
- cron "minute-granularity scan bounded to 366 days" ruling satisfied
  by the field-advance algorithm (bounded, no unbounded loops).

## Pitfalls / guardrails for future sessions
- The `unit` duplicate-declaration bug (two `const unit:` lines) came
  from an edit that matched a half-line; after any multi-line edit to
  schedule.ts's parseIntervalSpec, re-grep for `const unit` to catch
  dupes.
- bun test runs files in parallel-ish; a stale `fx.tmp.ts` left in
  apps/fugue/ gets picked up as a test root — always `rm -f fx.tmp.ts`
  after scratch runs (done here; tree is clean).
- nextCronAfter's month-advance branch: when the target month rolls
  the year, `d.setMonth(...)` alone does NOT advance the year —
  the explicit `d.setFullYear(targetYear)` is required (guard exists
  in schedule.ts).
- Lane B (`bun test apps/fugue` from root) uses the root
  bunfig.toml happy-dom preload — the boundary test is
  masked-by-design there but still enforces the import graph; Lane A
  (`cd apps/fugue && bun test`, no app bunfig) is the DOM-free
  enforcement lane.

## File line counts (wc -l, at close)
- src/domain/boundary.test.ts: 92
- src/domain/ids.test.ts: 53
- src/domain/ids.ts: 88
- src/domain/invariants.test.ts: 164
- src/domain/invariants.ts: 307
- src/domain/io.test.ts: 137
- src/domain/io.ts: 107
- src/domain/model.test.ts: 165
- src/domain/model.ts: 162
- src/domain/schedule.test.ts: 255
- src/domain/schedule.ts: 443
- src/domain/storage.test.ts: 116
- src/domain/storage.ts: 70
- src/domain/types.test.ts: 36
- src/domain/types.ts: 110
- package.json: 7; tsconfig.json: 7
