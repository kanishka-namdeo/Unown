# The SOTA round — the benchmark framework

> **Purpose:** the SOTA round (docs/cascade-demo-session.md) exists to prove
> Unown's learning mechanisms function under real work: a production-shaped
> app (Fugue, an AI workflow automation platform) built **through** unown,
> while a formal benchmark framework measures whether the agent — not the
> model — got better. This directory is that framework: three metric groups,
> three snapshots (baseline / midpoint / final), receipts-first sourcing,
> zero invented numbers.

- [The metric groups](#the-metric-groups)
- [The collectors](#the-collectors)
- [The snapshots](#the-snapshots)
- [The validation log](#the-validation-log)
- [Sourcing rules](#sourcing-rules)

Related pages: [the SOTA round's competitor research](../../docs/sota-round-competitor-research.md)
(the benchmark-design patterns this framework adopted) ·
[benchmarks/edit-bench](../edit-bench) (the harness-capability baseline) ·
[docs/memory.md](../../docs/memory.md) (the learning-integrity gates the
improvement claims are held to).

## The metric groups

| Group | Metric | Evidence source |
|---|---|---|
| SDLC | requirements/plan quality | the build repo's plan-approval receipts (a numbered plan per phase) |
| SDLC | code quality | per-phase test runs (counts + passing), tool success rate on the receipts |
| SDLC | testing effectiveness | unit + E2E counts per phase; bugs found vs bugs shipped |
| SDLC | deployment reliability | app boots unattended; E2E verdict at close |
| SDLC | harness capability | edit-bench pass rate (matched-model: agnes-3.0-flash throughout) |
| Agent | task completion rate | sessions reaching their phase goal / total sessions (receipts) |
| Agent | tool success rate | `tool_result` errors / total (receipts ledger) |
| Agent | human intervention rate | hand-counted manual fixes per phase (validation log) |
| Agent | recovery rate | failures recovered in-session (validation log) |
| Agent | context retention | resume chains across chunked sessions (receipts + build git log) |
| Agent | memory utilisation | notes delivered; memory-driven corrections (engine DB + validation log) |
| Learning | failures discovered | validation-log entries (`### F` headings) |
| Learning | harness cycles + improvements shipped | engine DB `cycles` / `improvements` |
| Learning | task minting | engine DB `tasks` (origin mined/minted) |
| Learning | AutoDream consolidation | engine DB `dreams` (merged/added/pruned), memory versions |
| Learning | skills staged | engine DB `skills` (staged → promoted) |
| Learning | regressions introduced/prevented | regression pins in the repo's test suites |

The mission's requirement — "benchmark-first" — is met by ordering: the
baseline snapshot **must** exist before the first build phase starts.

## The collectors

- `metrics.mjs` — snapshot collector. Reads the engine DB (read-only sqlite),
  the build repo's `.unown/receipts/`, and hand-entered phase facts; writes
  `results/snapshot-<label>.json`. Deterministic, keyless, re-runnable:
  `bun metrics.mjs --label baseline --editbench ../edit-bench/results/rerun-2026-10-21/agnes-3.0-flash/summary.json`
- `report.mjs` — renderer. Reads snapshots, writes `results/REPORT.md` with
  the baseline/midpoint/final table; unmeasured cells print "not measured".
- `validation-log.md` — the failure→benchmark→improvement→rerun ledger (the
  round's core artifact; the mission's continuous-improvement rule lives here).

## The snapshots

- `snapshot-baseline.json` — taken before the first build phase: the engine's
  pre-round state, the matched-model edit-bench baseline, zero build sessions.
- `snapshot-midpoint.json` — taken after the app's core phases (domain +
  API + UI): receipts-so-far, engine state mid-round.
- `snapshot-final.json` — taken at close: full receipts, engine state after
  the learning-validation passes, final E2E verdict.

`results/REPORT.md` is generated from the snapshots — the three-point
trajectory the Benchmark Improvement Report cites.

## The validation log

Every failure the round hits gets an entry with: description, reproduction,
root cause, whether it is a Unown defect, the benchmark/regression created,
the improvement applied (if any), validation evidence (rerun + before/after),
and retention status. The log's discipline is the mission's discipline:
never patch around a failure — root-cause it, decide where the defect lives,
fix it where it lives, rerun the original workflow, and only then move on.

## Sourcing rules

1. Every number in `REPORT.md` renders from a snapshot JSON; the snapshots
   render from ledgers (engine DB, receipts) or explicit phase facts.
2. Improvement deltas are matched-model: the same model (agnes-3.0-flash
   through the bundled bridge) on both sides of every before/after.
3. Unmeasured is "not measured" — never a guess, never a promise.
4. Keyless lanes: collection never calls an LLM; the framework itself costs
   zero tokens.
