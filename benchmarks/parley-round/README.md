# Parley round benchmarks

The receipt lane for the Parley round (2026-10-28) — the multi-tenant
support-inbox SaaS build that doubles as the round's learning-loop
measurement. Three snapshots are taken of the engine's full learning state
(baseline / midpoint / final), each after the dream queue drains:

- `tasks` — every benchmark task with pass/fail counts, status, origin
  (seed vs minted)
- `cycles` — every harness cycle with terminal status + summary
- `improvements` — memory patches the harness proposed (shipped or not)
- `dreams` / `skills` / `memory` — AutoDream consolidations, minted agent
  skills, tier versions
- `runs` — token/tool-call totals and pass rate

Method notes (grounded in the round's competitor research,
`docs/parley-round-competitor-research.md`):

1. **Drain-before-snapshot** (the ZCode `--memory-bench` pattern): every
   snapshot is taken with no live cycles or in-flight dreams, so counts are
   completed-work counts.
2. **Holdout discipline** (the Codewhale skill-eval pattern): the final
   re-run covers the seed suite AND any minted tasks — an improvement that
   only shows on the tasks a patch was mined from is not retained learning.
3. **Cost columns** (the Goose Harbor pattern): every pass-rate figure
   carries its token totals.
4. Runs go through the real engine (`:3030`) — fresh bubblewrap sandbox per
   run, tiered memory injected, hooks attached — against the Agnes AI
   upstream through the bundled bridge (`:3031`). No direct model calls.

The snapshots are captured by the round's driver tooling; the receipts are
committed, never regenerated. The round's narrative and findings live in
`docs/parley-demo-session.md`.
