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
