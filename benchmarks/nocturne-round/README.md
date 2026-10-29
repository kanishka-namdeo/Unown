# Nocturne round benchmarks

The receipt lane for the nocturne round (2026-10-29) — the AI-native incident
operations platform build that doubles as the Evolution Programme's second
live proving ground (the aria CRM round was the first): every agent session
is a UX-ledger row, every failure a validation-log entry with the
failure→benchmark→improvement→rerun chain, and the engine's learning state is
snapshotted at baseline / midpoint / final after the dream queue drains.

The lane reuses the validation round's snapshot driver (the most complete
schema, `validation-round/1`) via its `--out` flag — receipts land in this
directory, the driver lives with its round
([`../validation-round/snapshot.mjs`](../validation-round/snapshot.mjs)):
`bun validation-round/snapshot.mjs --label baseline --out nocturne-round/snapshots/nocturne-baseline-<ts>.json`
(run from `benchmarks/`).

## What each snapshot receipts

- `memoryMetrics` — engine memory version rows per tier; the terminal
  memory's provenance version / bullet count / skill trees
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
[docs/aria-round-competitor-research.md](../../docs/aria-round-competitor-research.md)
and the aria round's own receipts)

1. **Drain-before-snapshot** (the ZCode `--memory-bench` pattern): every
   snapshot is taken with no live cycles or in-flight dreams, so counts are
   completed-work counts.
2. **Holdout discipline** (the Codewhale skill-eval pattern): the final
   re-run covers the seed suite AND any minted tasks — an improvement that
   only shows on the tasks a patch was mined from is not retained learning.
3. **Cost columns** (the Goose Harbor pattern): every pass-rate figure
   carries its token totals; every agent session in the UX ledger carries
   turns/tokens/wall-time.
4. **Per-session budgets** (the OpenHands SDK pattern): long build sessions
   run with `--max-turns` caps and their turns/tokens are receipted per
   phase — cost columns are the guardrail, not an afterthought.
5. **PBT/invariant gates** (the Kiro pattern): the platform's domain
   invariants (ack-before-resolve, escalation fires only while unacked,
   rotation handoffs contiguous, MTTA/MTTR only over resolved incidents)
   must hold before a phase ships.
6. Runs go through the real engine (`:3030`) — fresh bubblewrap sandbox per
   run, tiered memory injected, hooks attached — against the Agnes AI
   upstream through the bundled bridge (`:3031`). No direct model calls.

## The baseline this round opens from

- **Engine cold-start state** — the round-open snapshot
  ([`snapshots/nocturne-baseline-20261029-093457.json`](snapshots/nocturne-baseline-20261029-093457.json)):
  6/6 seed tasks passing, 0 cycles, 0 improvements, 0 dreams, 0 minted
  skills, 0 sandbox runs, 1 session note (the round's stack-verification
  session); terminal memory **v4, 73 bullets** — the retained learning of
  every prior round (focus → bazaar → cadence → parley → fugue → aria)
  carried forward through the tracked `.unown/memory/project.md`.
- **Pinned model-mechanics receipts** (same model `agnes-3.0-flash`, same
  bridge, same code path — re-run only if the learning core changes):
  memory recall QA ([`../memory-eval/recall-qa/results/agnes-3.0-flash/`](../memory-eval/recall-qa/results/agnes-3.0-flash/summary.json)),
  repeat-task memory lift ([`../selfimprove/results/v2-notes/summary.agnes-3.0-flash.json`](../selfimprove/results/v2-notes/summary.agnes-3.0-flash.json) —
  cold 9/10 @ 107K in / 106 s avg → warm 9/10 @ 79 s avg),
  codegen ([`../evalplus/results/rerun-2026-10-21/`](../evalplus/results/rerun-2026-10-21/),
  [`../livecodebench/results/`](../livecodebench/results/RESULTS.md)).
- **Longitudinal axes the round itself measures** — per-session turns /
  tokens / wall-time in the UX ledger (cold vs repeat rows), intervention
  count (0 by construction; any non-zero row is itself a finding), memory
  reuse, and the failure-ledger chain.

The receipts are committed, never regenerated. The round's narrative lives
in [docs/nocturne-demo-session.md](../../docs/nocturne-demo-session.md); the
failure ledger continues the gallery-round lineage (SOTA F0–F5, Parley
F3–F7, aria reserved-but-unused F8) starting at **F8** in
[`validation-log.md`](validation-log.md); per-session UX rows are
[`ux-ledger.md`](ux-ledger.md) (N1, N2, …).
