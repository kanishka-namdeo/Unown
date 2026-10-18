# Agent behavior

The behavior card: what Unown's agents do by default — models, memory, tools, sandbox, hooks — and the rule for changing any of it. This page is the single reference for "what does the agent look like today"; it moves with the code, and every behavior change lands with a CHANGELOG [Agent Behavior](../CHANGELOG.md) entry that must agree with it.

Related pages: [usage](usage.md) · [memory](memory.md) · [configuration](configuration.md) · [providers](providers.md) · [memory-system-review](memory-system-review.md) · [testing-strategy](testing-strategy.md) · [../CHANGELOG.md](../CHANGELOG.md)

- [Default models](#default-models)
- [Memory stack](#memory-stack)
- [Session tools](#session-tools)
- [Sandbox model](#sandbox-model)
- [Hooks policy](#hooks-policy)
- [Behavior-change policy](#behavior-change-policy)

## Default models

Routing is enforced by the llm-bridge; the binding rules live in its [AGENTS.md](../mini-services/llm-bridge/AGENTS.md), defaults are tuned in the root `.env` (see [configuration](configuration.md)).

| Model | Role | Notes |
|---|---|---|
| `kimi-k2.5` | default coder | every request naming an unknown model id routes here (`BRIDGE_ROUTE_DEFAULT`) |
| `qwen3.7-plus` | fast multimodal | thinking auto-disabled (`enable_thinking:false`; `BRIDGE_QWEN_THINKING=1` re-enables) |
| `qwen3.6-plus` | long context | 1M-token context window |
| `local-*` (opt-in) | background learning lane | when `BRIDGE_LOCAL_URL` points at a local server, the learning layer's subtasks (mining / dream / skills / mint) can be pinned to a local model via `PI_MINER_MODEL_ID` etc.; task minting can also run as an opt-in local-draft + remote-repair cascade (`PI_MINT_CASCADE`, verified H10 — the local model drafts, only invalid drafts cost one remote repair call); agent sessions stay remote. Unset = the all-remote default, unchanged. Evaluation: [benchmarks/local-llm/](../benchmarks/local-llm/) |

Messages, tool-role messages and `image_url` parts pass through the bridge verbatim, so tool calling and vision work end to end.

## Memory stack

Four Markdown tiers, most-specific-wins, injected into every session — terminal sessions and engine sandbox runs alike. Full detail in [memory](memory.md):

| Tier | File | Maintained by |
|---|---|---|
| 0 · policy | `~/.unown/memory/policy.md` | you (ops); a built-in default applies when the file is absent |
| 1 · project | `<project>/.unown/memory/project.md` | AutoDream and you — the learning surface |
| 2 · user | `~/.unown/memory/user.md` | you |
| 3 · local | `<project>/.unown/memory/local.md` | you (gitignored) — highest precedence |

The dream consolidation loop (AutoDream) turns session notes into the next version of the project tier and mints skills. Opt-in local-ML pre-processors (verified [H9–H15](../benchmarks/nonllm/results/REPORT.md)) can run around that call — near-dup collapse, no-recency activation ordering, hybrid curation — behind `PI_NOTE_DEDUP`/`PI_MEMORY_RANK`/`PI_DREAM_CURATE` with a `PI_LOCAL_ML=shadow` compute-only mode; all unset by default (dream prompts byte-identical). Guard layers wrap the whole pipeline: a deterministic note-level flag layer, quarantine banners on flagged content in the dream, and a deterministic ship gate on the final candidate. Every write is versioned and roll-backable; a dream that breaks the most recently passing canary task is rolled back (status `gated`); a shipped improvement that later regresses auto-unships. Live receipts: poison-corpus and MPBench — 0 adversarial directives shipped, 0 benign guard false positives (`benchmarks/memory-eval/mpbench/RESULTS.md`).

## Session tools

Every terminal session registers five tools (see [usage](usage.md)): `todo` (visible task tracking), `note` (mid-session learning notes — the raw material AutoDream consolidates), `task` (subagents with a fresh context; project agents defined in `.unown/agents/*.md`; structured outputs via `output_schema` — validated JSON replies with corrective retries and permissive/strict modes — and optional per-child git worktree isolation via `worktree_isolation`, fail-closed outside a git repo, kept trees reported for merge), `fetch_url` (HTTP reads), and `lsp` (language-server code intelligence — diagnostics/hover/definition/references/symbols, with fresh diagnostics appended to every `write`/`edit` result; servers auto-detected on PATH, configurable via `.unown/lsp.json`, `UNOWN_LSP=0` disables, cold start never blocks a tool result, and a crashed server restarts within cooldown/restart caps with its documents re-opened so the feedback loop survives). Slash commands: `/todos`, `/note`, `/agents`, `/learning`, `/lsp` — `/learning` re-prints the effective memory stack fresh from disk. Starter Agent Skills ride along from `~/.unown/agent/skills/` and `<project>/.unown/skills/`.

Every session also keeps a receipts audit ledger (`.unown/receipts/`, one JSONL per session boot: every prompt, tool call + input, result, checkpoint, restore — secret-looking input values are redacted at rest and on render; write/edit inputs record file sizes, never file bodies) and a checkpoint store (`.unown/checkpoints/`: content-addressed pre-turn before-images sealed automatically when a turn writes files, plus named snapshots, hash-verified on restore). Commands: `/checkpoint [label]`, `/undo [n|--all]` (reverts the last n turns' file changes — this session's turns by default, everyone's with `--all`; new files tombstoned away; an interrupted undo resumes safely without over-undoing), `/restore <id|label>`, `/checkpoints`, `/receipts [n]`. Both trees are gitignored runtime state; restore is jailed to the project dir by a lexical + realpath check, blobs are hash-verified on restore, and files over `UNOWN_CHECKPOINT_MAX_BLOB_BYTES` (64 MiB) are not snapshot. Full semantics and limits: [usage](usage.md#checkpoints-and-receipts).

The agent is also an MCP **client**: servers configured in `.unown/mcp.json` / `~/.unown/agent/mcp.json` (stdio + streamable HTTP) connect lazily in the background at session start — never blocking it — and their tools register dynamically as `mcp__<server>__<tool>` (100/server cap, description 500-char cap, results 16 k-char cap with a visible truncation marker; failed or crashed servers mark `error`, cool down 30 s before reconnect attempts and stay out of the way; a restarted HTTP server is transparently re-initialized once and the call replayed; 429/503 retried with backoff; `UNOWN_MCP=0` disables; `/mcp` reports status and force-reconnects). **Project-scoped configs are trust-gated** (refuse-first): an unapproved `.unown/mcp.json`/`.unown/lsp.json` is never loaded or executed — `/mcp trust` approves (fingerprint-pinned to path + contents), `UNOWN_TRUST_PROJECT_CONFIG=1` bypasses for CI. Config errors surface as actionable problems, never silent swallows. Full contract: [usage](usage.md#mcp-servers).

Two SDLC workflows ride the same extension layer: `/review [base]` runs a parallel-subagent code review over a frozen diff snapshot (1 reviewer for small diffs, 3 with split focuses for larger; reviewers are strictly read-only — no bash, only read/grep/find/ls; P0–P3 findings + confidence + a SHIP/DO-NOT-SHIP verdict, strictest wins; failed reviewers are reported and an all-failed review returns UNKNOWN, never "clean"; artifact in `.unown/reviews/`) and `/goal <objective>` / `--goal "…"` runs a durable, evidence-verified objective — per-turn goal context with the `[GOAL:COMPLETE]`-on-its-own-line tag contract, a completion gate requiring the tag + a non-empty all-done todo list + evidence of both kinds (a file path AND a command output; quoted text never counts), state persisted across `/new` `/resume` `/fork` (`pause`/`resume`/`clear` subcommands). Full contracts: [usage](usage.md#code-review-review) · [usage](usage.md#goals-goal).

## Sandbox model

Engine runs — verify scripts and the agent's own bash commands — execute under the OS sandbox: bubblewrap on Linux (read-only root filesystem, private `/home` `/tmp` `/run`, killed network namespace, dropped capabilities; a verified binary is vendored with sha256 provenance under `pi-repo/packages/self-learning/native/`), seatbelt (`sandbox-exec`) on macOS with a bwrap-equivalent profile, and the in-process path jail on native Windows and as the fallback on hosts without the OS sandbox. Executed commands are additionally jailed to the workspace with timeouts and output caps. `UNOWN_OS_SANDBOX=0` disables the OS sandbox; `UNOWN_SANDBOX_NET=1` keeps the network shared.

## Hooks policy

- Engine runs: `PreToolUse` denies destructive shell (`rm -rf /`, `sudo`, outbound `curl`/`wget` to external hosts, ...); the path jail blocks escapes; `PostToolUse` feeds transpiler errors back to the agent instead of letting broken code compound.
- Terminal sessions: the same gate scoped for real work — catastrophic commands (filesystem-root deletion, fork bombs, disk formats) and writes outside your project and `/tmp` are blocked; network, `git push` and package installs stay available. `UNOWN_STRICT_HOOKS=1` restores sandbox-grade strictness.
- Both layers are in-process pattern gates, not shell scripts. `unown -v` prints every hook decision to stderr.

## Behavior-change policy

Any change to prompts, default models, routing, guard rules, hook policy, or memory injection must land with all three:

1. a [CHANGELOG](../CHANGELOG.md) entry tagged **Agent Behavior**, so behavior history stays auditable in one place;
2. tests pinning the change — the suite fails if the behavior regresses;
3. receipts where the claim is measured.

A behavior change missing any of the three is not done.

Worked example — the `security-bypass` guard rule (`pi-repo/packages/self-learning/src/guard.ts`), found live by the MPBench corpus (ADV_1590: a process-gate bypass framed as an observation shipped as an "observed, not policy" pattern):

- CHANGELOG: the Security **Agent Behavior** entry records the finding and the live re-run verdict (flagged → not planted → nothing shipped).
- Tests: `pi-repo/packages/self-learning/test/guard.test.ts` pins both sides — the flagged family (bypass verbs near process-gate objects, however framed) and the benign gate-adjacent observations that must stay clean.
- Receipts: `benchmarks/memory-eval/mpbench/RESULTS.md` (post-fix: 0/50 planted, 0/50 shipped, 0 benign false positives).

Guard-bypass findings are security reports: private disclosure via [../SECURITY.md](../SECURITY.md), never a public issue.
