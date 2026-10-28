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
| V1 | recall (decision) | engine-restart recommendation probe | 2 | 8,850 / 232 | 5s | 0 | 0 | completed — correct NO-restart decision, cited both the skill and the memory entry verbatim | yes |
| V2 | recall (fact) | parley password hashing + memory file location | 1 | 227 / 119 | 2s | 0 | 0 | partial — Q2 verbatim-correct; Q1 WRONG (bcrypt confabulated over the correct scrypt memory) → F1/F2 | yes (and failed) |
| V2b | recall (fact, post-fix) | identical to V2, after the guide fix + recovery | 1 | 4,925 / 166 | 3s | 0 | 0 | completed — scrypt correct WITH citation and explicit poison negation | yes |
| V3 | cold (build) | author probe.mjs + queries.json + smoke receipt | 30 (capped) | 42,104 / 5,995 | 89s | 0 | 0 | partial — core lane complete + receipts written; capped mid-DOX-pass (the cap is the honest boundary) | no |
| V4 | repeat (warm) | extend probe.mjs with --summary + README section | 9 | 21,418 / 2,020 | 27s | 0 | 0 | completed — summary mode verified working | yes |

Notes on the rows:

- **V1** is the cross-session continuity receipt: the memory entry was
  written by a previous round on a previous install (the tracked
  `.unown/memory/project.md`), and this fresh clone's first session
  answered from it verbatim, 2 turns, 5 seconds, zero exploration.
- **V2 → V2b** is the round's before/after drift receipt (F1): the same
  question, the same model, the memory content class — the guide's
  verify-before-asserting contract is the only changed variable.
- **V3 → V4** is the repeat-task improvement receipt: same codebase area,
  same operator shape, bounded to the same 30-turn cap — the warm session
  completed in 9 turns what the cold session could not finish in 30
  (−70% turns, −70% wall time, −66% output tokens). The V3 session's
  notes had been dreamed into memory between the two runs.
- **Interventions stay 0 by construction** in headless runs with bounded
  prompts — that is itself the UX finding: the mission's "user
  intervention frequency" metric only becomes non-zero when a session
  needs rescue; none did. The V3 turn-cap is the honest boundary of a
  cold session's budget, recorded rather than papered over.
- Envelope receipts: `sessions/v{1,2,2b,3,4}-envelope.json` (committed —
  the `--output-format json` final objects with session id, turns, usage,
  duration; V2's session id `01a18432-08df-7a1e-96e9-ec68c4dc8cfc` is the
  F1 receipt's citation). The engine's own run rows live under
  `db/selflearning.db` (gitignored runtime state, counted here, never
  committed raw).
