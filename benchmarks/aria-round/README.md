# Aria round benchmarks

The receipt lane for the aria round (2026-10-29) — the Enterprise CRM build
that doubles as the Evolution Programme's live proving ground: every agent
session is a UX-ledger row, every failure a validation-log entry with the
failure→benchmark→improvement→rerun chain, and the engine's learning state is
snapshotted at baseline / midpoint / final after the dream queue drains.

The lane reuses the validation round's snapshot driver (the most complete
schema, `validation-round/1`) via its `--out` flag — receipts land in this
directory, the driver lives with its round
([`../validation-round/snapshot.mjs`](../validation-round/snapshot.mjs)):
`bun ../validation-round/snapshot.mjs --label baseline --out aria-round/snapshots/aria-baseline-<ts>.json`
(run from `benchmarks/`). The engine snapshot for the round's open was
receipted by the validation round's driver directly
([`../validation-round/snapshots/baseline-20261028-224309.json`](../validation-round/snapshots/baseline-20261028-224309.json)
— the shared cold-start state both rounds started from).

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
[docs/aria-round-competitor-research.md](../../docs/aria-round-competitor-research.md))

1. **Drain-before-snapshot** (the ZCode `--memory-bench` pattern): every
   snapshot is taken with no live cycles or in-flight dreams, so counts are
   completed-work counts.
2. **Holdout discipline** (the Codewhale skill-eval pattern): the final
   re-run covers the seed suite AND any minted tasks — an improvement that
   only shows on the tasks a patch was mined from is not retained learning.
3. **Cost columns** (the Goose Harbor pattern): every pass-rate figure
   carries its token totals; every agent session in the UX ledger carries
   turns/tokens/wall-time.
4. **Per-session budgets** (the OpenHands SDK pattern, adopted this round):
   long build sessions run with `--max-turns` caps and their turns/tokens
   are receipted per phase — cost columns are the guardrail, not an
   afterthought.
5. **PBT/invariant gates** (the Kiro pattern, adopted this round): the CRM's
   domain invariants (stage transitions monotonic, contacts unique by
   email, totals recomputable from events) must hold before a phase ships.
6. Runs go through the real engine (`:3030`) — fresh bubblewrap sandbox per
   run, tiered memory injected, hooks attached — against the Agnes AI
   upstream through the bundled bridge (`:3031`). No direct model calls.

The receipts are committed, never regenerated. The round's narrative lives
in [docs/aria-demo-session.md](../../docs/aria-demo-session.md); the
failure ledger continues the gallery-round lineage (SOTA F0–F5, Parley
F3–F7) at **F8** in
[`validation-log.md`](validation-log.md); per-session UX rows are
[`ux-ledger.md`](ux-ledger.md) (A1, A2, …).
