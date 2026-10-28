# Validation round benchmarks

The receipt lane for the validation round (2026-10-29) — the Memory &
Learning System Validation Programme: a cold-start, from-zero validation of
Unown's five learning mechanisms on a fresh clone of this very repository.
The repo is the controlled environment (a real developer tool with repeated
workflows, long-running history, and 38 prior release rounds); the engine's
database starts empty; the tracked `.unown/memory/project.md` (the
file-is-truth terminal memory, v12 at open, 79 rendered bullets) is the only
learning that carries over — which makes cross-session/cross-install
continuity itself a measured variable rather than an assumption.

Three snapshots are taken of the engine's full learning state
(baseline / midpoint / final), each after the dream queue drains, plus a
per-session UX ledger (`ux-ledger.md`) filled from the real headless agent
sessions the round runs.

## What each snapshot receipts

- `memoryMetrics` — engine memory version rows per tier; the terminal
  memory's provenance version / bullet count / skill trees; the semantic
  recall surface (probe results are recorded in the UX ledger and the
  reports, the field stays `null` in the driver — the driver makes zero LLM
  calls)
- `learningMetrics.tasks` — every benchmark task with pass/fail counts,
  status, origin (seed vs minted)
- `learningMetrics.cycles` — every harness cycle with terminal status +
  summary
- `learningMetrics.improvements` — memory patches the harness proposed
  (shipped or not)
- `learningMetrics.dreams` / `skills` — AutoDream consolidations
  (entries merged/pruned/added) and minted agent skills
- `learningMetrics.runs` — token/tool-call totals and pass rate
- `learningMetrics.governor` / `hooks` / `notesPending` — the autonomy and
  guard-rail state

## Method notes (grounded in the round's competitor research,
`docs/validation-round-competitor-research.md`)

1. **Drain-before-snapshot** (the ZCode `--memory-bench` pattern): every
   snapshot is taken with no live cycles or in-flight dreams, so counts are
   completed-work counts.
2. **Cold-start discipline**: the engine DB is never seeded from a previous
   install's dump — the round measures what the systems build from zero
   plus the tracked memory artifact, not what a backup restored.
3. **Holdout discipline** (the Codewhale skill-eval pattern): retention
   checks re-run previously-shipped patches' tasks; an improvement that
   only shows on the task a patch was mined from is not retained learning.
4. **Cost columns** (the Goose Harbor pattern): every pass-rate figure
   carries its token totals; every agent session in the UX ledger carries
   turns/tokens/wall-time.
5. **Runs go through the real engine** (`:3030`) — fresh sandbox per run,
   tiered memory injected, hooks attached — against the Agnes AI upstream
   through the bundled bridge (`:3031`). No direct model calls.

## The mission's metrics and where they live

| Mission metric family | Where receipted |
|---|---|
| Memory entries created | snapshot `memoryMetrics` (versions per tier, terminal bullets) |
| Memory entries retrieved / retrieval success / relevance | `ux-ledger.md` probe rows + `docs/memory-effectiveness-report.md` |
| Cross-session continuity accuracy | `ux-ledger.md` (cold-probe rows answered from tracked memory) |
| Failures discovered / lessons extracted | `validation-log.md` (F-numbered ledger) |
| Memory patches generated / improvements retained | snapshot `learningMetrics.improvements` |
| Regressions introduced / prevented | snapshot `learningMetrics.cycles` + retention checks |
| Tasks generated (minting) | snapshot `learningMetrics.tasks` (origin: minted) |
| User intervention frequency / clarifications | `ux-ledger.md` per-session rows |
| Task completion efficiency / time-to-solution | `ux-ledger.md` (turns, tokens, wall-time) |
| Consistency across sessions | repeat-probe rows in `ux-ledger.md` |

The snapshots are captured by the round's driver (`snapshot.mjs`); the
receipts are committed, never regenerated. The round's narrative and
findings live in `docs/validation-round-session.md`; the mission's reports
live in `docs/learning-system-validation-report.md`,
`docs/memory-effectiveness-report.md`, `docs/learning-progress-report.md`
and `docs/end-user-experience-report.md`.
