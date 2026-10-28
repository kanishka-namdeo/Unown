# The validation round — end-user experience ledger

One row per real agent session the round runs, measuring what the mission
calls the end-user experience: interventions required, clarifications
asked, completion, efficiency and consistency. All sessions are real
headless `bin/unown -p "..."` runs in this repository (the controlled
environment), model `agnes-3.0-flash` through the bundled bridge.

Column key:

- **session** — the round's session id (V1, V2, ...), chronological
- **kind** — cold (no relevant memory) / recall (answer lives in tracked
  project memory) / repeat (same-shape task re-run after consolidation)
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
  answer (recall probes) or speed the work (repeat tasks): yes / no / n-a

## Sessions

| session | kind | task | turns | tokens in/out | wall | interventions | clarifications | outcome | memory used |
|---|---|---|---|---|---|---|---|---|---|

(The ledger fills as the round's sessions run; every row cites its
envelope receipt path under `.unown/receipts/` — gitignored runtime state,
counted and summarised here, never committed raw.)
