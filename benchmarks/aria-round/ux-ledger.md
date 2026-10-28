# The aria round — end-user experience ledger

One row per real agent session the aria round runs, measuring what the
mission calls the end-user experience: interventions required, clarifications
asked, completion, efficiency and consistency. All sessions are real headless
`bin/unown -p "..."` runs in this repository (the controlled environment),
model `agnes-3.0-flash` through the bundled bridge. Rows are numbered A1,
A2, ... in chronological order; the CRM-build sessions are the round's meat —
the stack-verification probes that preceded CP0 are receipted in the
validation round's ledger (its machine-2 CP0′), not here.

Column key:

- **session** — the round's session id (A1, A2, ...), chronological
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

## Sessions

| session | kind | phase | task | turns | tokens in/out | wall | interventions | clarifications | outcome | memory used |
|---|---|---|---|---|---|---|---|---|---|---|

Notes on the rows:

- Envelope receipts land in this lane's `sessions/` directory as the round
  runs (the `--output-format json` final objects with session id, turns,
  usage, duration), per the gallery convention.
- **Interventions stay 0 by construction** in headless runs with bounded
  prompts — that is itself the UX finding: the mission's "user intervention
  frequency" metric only becomes non-zero when a session needs rescue.
- Repeat rows (same-shape phase tasks) against their cold predecessors are
  the round's efficiency-improvement receipts — the numbers come from the
  envelopes, never from memory.
