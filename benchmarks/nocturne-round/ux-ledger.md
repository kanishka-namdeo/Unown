# The nocturne round — end-user experience ledger

One row per real agent session the nocturne round runs, measuring what the
mission calls the end-user experience: interventions required, clarifications
asked, completion, efficiency and consistency. All sessions are real headless
`bin/unown -p "..."` runs in this repository (the controlled environment),
model `agnes-3.0-flash` through the bundled bridge. Rows are numbered N1,
N2, ... in chronological order.

Column key:

- **session** — the round's session id (N1, N2, ...), chronological
- **kind** — cold (no relevant memory) / recall (answer lives in tracked
  project memory) / repeat (same-shape task re-run after consolidation) /
  plan (a `--plan` session)
- **phase** — the build phase the session belongs to
- **task** — one line, the actual user request
- **turns** — model calls (from the session envelope `num_turns`)
- **tokens in/out** — from the envelope / engine ledger
- **wall** — wall-clock seconds for the whole session
- **interventions** — times the operator had to step in (headless sessions
  start at 0 by construction; any non-zero row is itself a finding)
- **clarifications** — `ask`-tool questions the agent raised (headless
  sessions cannot be answered; a question is a failed-turn signal)
- **outcome** — completed / partial / failed, judged by the objective
  acceptance check stated in the task
- **memory used** — did tracked project memory demonstrably carry the
  answer or speed the work: yes / no / n-a

| session | kind | phase | task | turns | tokens in/out | wall | interventions | clarifications | outcome | memory used |
|---|---|---|---|---|---|---|---|---|---|---|
| N1 | plan | Plan | read-only exploration for the nocturne build contract (`--plan`, capped) | 40 (capped) | 149,939 / 2,272 (+1.91M cache reads) | 79s | 0 | 0 | partial — exploration of aria/parley/fugue/cadence patterns + round conventions; cap hit mid-exploration, resumed per the gallery convention | yes |
| N2 | plan (resume) | Plan | write the complete numbered build contract | 5 | 219,754 / 16,901 | 195s | 0 | 0 | completed — 52,587-char plan, all 8 sections ([plan.md](plan.md)); every pattern grounded in the sibling lanes it explored | yes |
| N3 | cold (build) | Lib | execute Phase 1: lib modules per contract §2 (capped mid-exploration) | 40 (capped) | 304,966 / 3,979 | 466s | 0 | 0 | partial — contract + sibling-pattern exploration; zero writes yet (heavier read phase than aria's A3 — the 21-module contract is deeper) | yes |
| N4 | repeat (resume) | Lib | continue: start writing modules | ~28 (killed) | unreceipted | ~590s | 1 (operator) | 0 | partial — 20 files written (12 modules + tests) before the OPERATOR's blocking shell call timed out and killed the run; the launcher-contract deviation (no detached F0/F2 launcher yet) is the operator's defect, logged as F8 | yes |
| N5 | repeat (resume) | Lib | continue: engine modules + fix loop | 40 (capped) | 243,952 / 32,806 | 589s | 0 | 0 | partial — rotation.ts + sla.ts landed, 174/181; nextHandoff period-anchoring bug mid-fix, resumed | yes |
| N6 | repeat (resume) | Lib | continue: store.ts + remaining modules | 40 (capped) | 521,420 / 32,954 | 694s | 0 | 0 | partial — store.ts landed, 181/181 green again; context drag visible (521K cumulative in — the aria A9 signal); operator folded to a fresh session per the fold-not-fanout convention | yes |
| N7 | cold (build) | Lib | fresh session: the 8 remaining engine modules + PBT invariants | 40 (capped) | 210,087 / 58,247 | 766s | 0 | 0 | partial — all 8 engine modules + invariant tests written in one session (346/358), fix loop pending | yes |
| N8 | repeat (resume) | Lib | the fix loop to green | 40 (capped) | 190,392 / 15,146 | 361s | 0 | 0 | partial — 356/360; found + was fixing a real seed-invariant bug (escalation-after-ack) | yes |
| N9 | repeat (resume) | Lib | finish: green suite + clean typecheck | 40 (capped) | 47,706 / 11,900 | 285s | 0 | 0 | completed — 360/360 green, `bun run typecheck` clean, 40 files, zero human edits to app code | yes |
