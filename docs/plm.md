# PLM — Process Lifecycle Management

> What the PLM round (2026-10-30) added to the engine: every significant
> activity — router jobs, sandboxed agent runs, dreams, mints, automations,
> terminal sessions, delegations, recoveries — is a first-class **tracked
> process** with an explicit state machine, an append-only transition
> journal, governed tool invocations, a classified recovery ledger,
> milestone checkpoints with replay verification, and a learning
> attribution ledger that refuses a claim without its proof chain. The
> round's receipts: [session log](plm-round-session.md) ·
> [process lifecycle report](process-lifecycle-report.md) ·
> [tool lifecycle report](tool-lifecycle-report.md).

- [The state machine](#the-state-machine)
- [Where telemetry comes from](#where-telemetry-comes-from)
- [The HTTP surface](#the-http-surface)
- [The dashboard views](#the-dashboard-views)
- [Retention and the kill switch](#retention-and-the-kill-switch)

Related: [configuration](configuration.md) ·
[PLM round session log](plm-round-session.md) ·
[detached engine architecture](detached-engine-architecture.md) ·
[routines](routines.md)

## The state machine

Twelve states, every legal edge in one table (`src/plm/states.ts`):

```
CREATED → PLANNED → QUEUED → RUNNING → VALIDATING → SUCCEEDED
                   ↘ WAITING ↗          ↘ RETRYING → FAILED
                     BLOCKED ↗              (every terminal) → ARCHIVED
                                     ABANDONED ↗
```

- Transitions are **events** — each edge appends a `process_events` row;
  history is never edited in place.
- `WAITING` is first-class (parked on a human/external gate); `BLOCKED`
  needs intervention; `RETRYING` is explicit and counted (`attempt`).
- Terminals are sticky: a late finalize after external recovery is a
  no-op; boot-time orphan healing is state-aware (running work → FAILED,
  parked work → ABANDONED) and lands in the recovery ledger as a
  validated heal.
- Nothing bypasses the machine — the first dogfooding run proved it
  bites its own wiring (see the session log's validation log).

## Where telemetry comes from

| Lane | What's recorded | How it reaches the engine |
| --- | --- | --- |
| Engine | job executions, agent runs, their tool calls, checkpoints at run finalize | direct store writes (`router.ts`, `runner.ts`) |
| Terminal | every tool_call/tool_result pair, the session itself as a process | fire-and-forget HTTP reports (`POST /api/tools/report`, `POST /api/processes/report`) — the detachment contract: files + HTTP only, never the engine DB |

Tool invocations carry OTel GenAI-aligned fields (name, category,
purpose, duration, success, failure class) plus lane/process/session
identifiers. Failures are classified by the nine-category taxonomy
(`tool | planning | context | logic | memory | dependency | model |
infrastructure | workflow`) into a recovery ledger row with root cause,
planned action and validation status — never a blind retry.

## The HTTP surface

```
GET  /api/plm                       the KPI rollup (processes + tools + recovery + learning + replay)
GET  /api/processes[?status=&kind=] the registry + census analytics
GET  /api/processes/:id             the process + its full transition history + children
POST /api/processes/report          the terminal lane's session report
GET  /api/tools                     per-tool stats + recommendations + totals
GET  /api/tools/invocations         the recent invocation feed
POST /api/tools/report              the terminal lane's batched tool reports
GET  /api/recovery                  recovery events + analytics (attempts, success rate, recurring)
GET  /api/checkpoints[?limit=]      milestone snapshots
GET  /api/checkpoints/:id           one checkpoint's replayable state
GET  /api/learning/attribution      the proof-chain ledger + analytics
```

Every mutation emits a bus event (`process:created`, `process:transition`,
`tool:invocation`, `recovery:planned`, `checkpoint:created`,
`learning:attributed`, …) — the SSE stream forwards them to the
dashboard automatically.

## The dashboard views

`unown dashboard` (or `/dashboard` inside a session):

- **Processes** (accelerator `0`) — the registry census, transition
  analytics, per-kind rollup, recent processes with owner/duration/usage;
  Enter drills into the selected process's full transition history.
- **Tools** — per-tool reliability rows (success, avg/p95, retries, lane
  split, failure classes) and the recommendation list with fix lines.
- **Recovery** — the existing triage rows plus the recovery engine's
  scorecard (recovery score, recurring categories, recent ledger rows
  with validated/planned glyphs).
- **Learning Lab** — the harness surfaces plus the attribution footer
  (claimed / retained / regressed / proof coverage).

## Retention and the kill switch

- `UNOWN_PLM=0` disables the whole round (registry, tool telemetry,
  recovery ledger, checkpoints, attribution, terminal reporting) —
  telemetry only; agent behavior is unchanged. Default on.
- Telemetry windows: `UNOWN_RETENTION_PLM_DAYS` (30) for
  `tool_invocations` / `recovery_events` / orphaned `process_events`;
  `UNOWN_RETENTION_PLM_HISTORY_DAYS` (90) for terminal-state processes /
  checkpoints / replay runs. `learning_attribution` is precious — never
  pruned.
- `UNOWN_PLM_MAX_CHECKPOINTS` (2,000) caps the checkpoint store
  (oldest-first, never a checkpoint a replay run references).
