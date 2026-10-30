# PLM competitor research — how the field manages process, tool and failure lifecycles

> The research pass behind the Process Lifecycle Management (PLM) round
> (2026-10-30): **nine systems** studied specifically on the dimensions the
> round builds — task/process lifecycle states, tool-call governance and
> telemetry, context lifecycle, human governance, and failure recovery —
> distilled into the design decisions `src/plm/` implements and the pitfalls
> it guards against. This complements the field-level comparison
> ([competitor comparison](competitor-comparison-report.md), 24 systems);
> here the lens is lifecycle MACHINERY, not learning loops. Claims carry
> the house tiers: `[V]` verified at the cited source, `[U]` unverified.

- [Method](#method)
- [The corpus](#the-corpus)
- [Findings by dimension](#findings-by-dimension)
- [What Unown adopted — the ledger](#what-unown-adopted--the-ledger)
- [Remaining gaps](#remaining-gaps)
- [The verdict](#the-verdict)

Related: [competitor comparison](competitor-comparison-report.md) ·
[PLM round session log](plm-round-session.md) ·
[Process lifecycle report](process-lifecycle-report.md) ·
[Tool lifecycle report](tool-lifecycle-report.md) ·
[PLM usage](plm.md)

## Method

Primary sources only — official documentation and repository code, fetched
and read directly (developer docs pages, GitHub docs at pinned tags). Each
system was probed on the same five dimensions the mission names: task
lifecycle, tool lifecycle, context lifecycle, human governance, failure
recovery. Where a system publishes no explicit state model, the finding is
the ABSENCE of one (a `[V]` absence — the hooks/events that exist instead
are listed). `developers.openai.com` was network-blocked from the research
environment; Codex CLI claims are pinned to the `openai/codex` repository
docs at tag `rust-v0.42.0`.

## The corpus

| System | What it is | Read on |
| --- | --- | --- |
| Claude Code | Anthropic's terminal agent | code.claude.com docs (hooks, sub-agents, permissions, checkpointing, CLI reference) |
| OpenHands | All Hands AI's agent platform + SDK | docs.openhands.dev SDK architecture pages |
| Cline | VS Code agent | docs.cline.bot (plan/act, auto-approve, checkpoints, subagents) |
| Roo Code | VS Code agent fork | roocodeinc.github.io (modes, boomerang tasks, checkpoints) |
| Codex CLI | OpenAI's terminal agent | github.com/openai/codex docs @ rust-v0.42.0 |
| LangGraph | graph agent framework | docs.langchain.com (checkpointers, persistence, fault tolerance, interrupts) |
| AutoGen 0.4 | Microsoft's agent runtime | microsoft.github.io/autogen + the repo's framework docs |
| Temporal.io | durable workflow engine (the reference standard) | docs.temporal.io (workflow execution, activities, retry policies, replay) |
| OTel GenAI semconv | the telemetry vocabulary | github.com/open-telemetry/semantic-conventions-genai |

## Findings by dimension

### Task lifecycle

- **Claude Code** has no published state enum; the lifecycle is exposed
  through hook events (`SessionStart` on begin *or resume*, `Stop`,
  `StopFailure`, `TaskCreated/TaskCompleted`, `SubagentStart/Stop`,
  `PreCompact/PostCompact`) — points, not states `[V]`.
- **OpenHands** is explicit: `Conversation` manages initialize → run →
  pause → terminate; `step()` is a single-step state machine with a
  `WAITING_FOR_CONFIRMATION` state; a Stuck Detector uses sliding-window
  pattern matching against loops `[V]`.
- **LangGraph** encodes completion structurally: a `StateSnapshot`'s `next`
  is an empty tuple iff the graph is complete; each super-step boundary
  checkpoints `[V]`.
- **Temporal** is the reference: statuses split Open (`Running`, `Paused`)
  vs Closed (`Completed`, `Failed`, `Cancelled`, `Terminated`,
  `Continued-As-New`), each execution owning exclusive local state, all
  commands recorded as an Event History `[V]`.
- **AutoGen 0.4** runtime manages agent lifecycles with composable
  termination conditions (MaxMessage, Timeout, Handoff for
  pause-for-user, External for stop buttons) that auto-reset after each
  run `[V]`.

### Tool lifecycle

- **Claude Code** gates every call through `PreToolUse` (block or
  `permissionDecision: allow|deny`), fires `PostToolUse` /
  `PostToolUseFailure` / `PostToolBatch`, and supports
  `hookSpecificOutput.retry: true` so a denied call can be retried `[V]`.
- **OpenHands** routes ActionEvents → Tool Executor → ObservationEvents
  with a `SecurityAnalyzer` assessing risk *before* execution `[V]`.
- **Cline** assigns every tool use a model-decided `requires_approval`
  flag (no fixed allowlist) evaluated per call `[V]`.
- **OTel GenAI semconv** defines the telemetry vocabulary: `execute_tool`
  spans with `gen_ai.tool.name`, `gen_ai.tool.call.id`,
  `gen_ai.tool.description`, `error.type` on failure; agent spans
  (`create_agent`/`invoke_agent`) with stable `gen_ai.agent.id`; token
  counters and operation-duration histograms `[V]`.

### Context lifecycle

- **Claude Code**: subagents run in their own context window; compaction
  is itself a lifecycle event (`PreCompact/PostCompact`); `/rewind` can
  "summarize from here" as well as restore `[V]`.
- **OpenHands**: the Condenser system (NoOp, LLMSummarizing with
  keep-first-N + last-M, Pipeline, Rolling) emits typed `Condensation`
  events `[V]`.
- **Cline**: "Restore Task Only" deletes messages to reset context —
  recovery and context management are the same lever `[V]`.
- **Roo Code**: subtasks run in complete isolation; only the summary
  returns to the parent — a deliberate defense against context poisoning
  `[V]`.

### Human governance

- **Claude Code** permission modes (`default/acceptEdits/plan/auto/
  dontAsk/bypassPermissions`) with `deny` > `ask` > `allow` precedence,
  enforced by the tool not the model `[V]`.
- **Codex CLI** keeps two orthogonal axes: `approval_policy`
  (`untrusted|on-failure|on-request|never`) × `sandbox_mode`
  (`read-only|workspace-write|danger-full-access`) `[V]`.
- **LangGraph** `interrupt(payload)` pauses anywhere indefinitely;
  `Command(resume=…)` becomes the return value; side effects before an
  interrupt must be idempotent `[V]`.
- **Roo Code** requires approval on subtask creation and completion
  (the boomerang gates) `[V]`.

### Failure recovery

- **Temporal** (the gold standard): activities must be idempotent so
  retries have no duplicate side effects; retry policies carry
  non-retryable error types; heartbeats let the next attempt continue
  where the last left off; on resume the engine REPLAYS the event
  history deterministically rather than restoring a snapshot `[V]`.
- **LangGraph**: retry → timeout → error handler in fixed order; default
  `RetryPolicy` max 3 attempts, exponential with jitter; per-task
  **pending writes** mean successful nodes in a failed super-step are
  not re-run; time travel = replay + fork `[V]`.
- **Claude Code**: checkpoints before each turn-starting prompt, 100
  most recent kept, ~30-day retention sweep; documented gaps —
  Bash-only edits untracked, most subagent edits not restored `[V]`.
- **Cline / Roo Code**: shadow-git commits after each tool use (Roo:
  not before commands — a documented gap); restore files / task / both `[V]`.
- **AutoGen**: `CancellationToken` cancels pending async work;
  versioned `save_state()/load_state()` blobs built for stateless
  endpoints `[V]`.
- **Codex CLI**: rollout files under `~/.codex/sessions/` +
  `codex resume` (`--last` or by id) `[V]`.

## What Unown adopted — the ledger

| # | Pattern | From | Where it landed in Unown |
| --- | --- | --- | --- |
| 1 | Small closed status set, mutually exclusive terminals, one absorbing state | Temporal | `plm/states.ts` — 12 states, `ARCHIVED` absorbing, `TERMINAL_STATES` |
| 2 | Transitions are events, never in-place mutations | Temporal / OpenHands EventLog | `process_events` append-only journal |
| 3 | WAITING as a first-class state | OpenHands / LangGraph interrupts | `WAITING` + `BLOCKED` in the machine |
| 4 | RETRYING explicit, never a blind repeat | Temporal retry policies | `RETRYING` + the attempt counter + `isRetryable` |
| 5 | VALIDATING gates SUCCEEDED | Unown's own harness ship-gate | `VALIDATING` state; runs checkpoint at verify |
| 6 | Idempotent / sticky finalize (late zombie writes are no-ops) | Unown F2 + LangGraph super-step commits | sticky `finishProcess`; boot orphan heal |
| 7 | State-aware orphan healing at boot | Temporal replay + Unown recoverOrphans | `recoverOrphanProcesses` (running→FAILED, parked→ABANDONED) |
| 8 | Tool-call telemetry with OTel-aligned fields | OTel GenAI semconv | `tool_invocations` (name/category/duration/success/error.type, lanes) |
| 9 | Pre-execution risk gates + per-call approval flags | OpenHands / Cline / Claude Code | Unown's existing hooks layer — now ALSO logged as governed invocations |
| 10 | Snapshot checkpoints with bounded retention | Claude Code / LangGraph | `checkpoints` + `UNOWN_PLM_MAX_CHECKPOINTS` + day windows |
| 11 | Replay verification (matched/diverged) | Temporal determinism discipline | `replay_runs` + `compareReplay` |
| 12 | Failure taxonomy before recovery planning | Temporal non-retryable types | `failure-taxonomy.ts` — 9 categories, retryability, action |
| 13 | Heartbeat/watchdog + crash-loop circuit | Temporal heartbeats / Unown's own | the existing router watchdog now feeds `recovery_events` |
| 14 | Bounded history growth (windows + caps) | Prometheus time-OR-size / Claude Code retention | the retention registry gains the six PLM tables |
| 15 | Governance snapshot on every execution | Codex approval_policy × sandbox_mode | process rows carry owner/parent/objective — the audit spine |

## Remaining gaps

1. **Replay is verification, not deterministic re-execution** — Temporal
   replays the event history; Unown's replay compares a re-run against a
   checkpoint. A true event-sourced re-execution engine is future work.
2. **No cross-process lease/heartbeat column yet** — orphan healing is
   boot-time only; a live watchdog would catch hung processes sooner.
3. **Tool cost attribution is aggregate** — the bridge knows per-request
   cost; per-invocation cost rollups are not yet joined into
   `tool_invocations`.
4. **The recovery engine's LLM-assisted root-cause mining** is
   deterministic-only today (markers + taxonomy); transcript mining for
   deeper root causes is the harness's job, not yet wired into the ledger.
5. **No distributed/process-registry federation** — one engine per data
   root; the terminal lane reports over HTTP, which is the detachment
   contract, but there is no multi-engine rollup.

## The verdict

The field's lifecycle machinery is converging on the same shape — explicit
states, append-only histories, gated tools, bounded checkpoints, classify-
before-retry — but almost nobody ships the WHOLE shape (Claude Code ships
checkpoints without a state model; OpenHands ships the state machine
without tool-level telemetry; LangGraph ships both but leaves recovery
policy to the app). The PLM round's bet, validated by this corpus: the
pieces compose, and the composition is the product.
