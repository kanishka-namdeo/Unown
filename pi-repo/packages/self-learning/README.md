# @earendil-works/pi-self-learning

The self-learning layer for the [pi coding agent](https://github.com/badlogic/pi-mono):
a single package that turns pi into an agent that **finds its own weaknesses,
fixes them, and remembers what worked**.

Implementations:

1. **Tiered memory** (`memory.ts`) — `policy → project → user → local`,
   most-specific-wins, versioned + rollback-able, injected into every pi
   session via `agentsFilesOverride`.
2. **Self-improving harness** (`harness.ts`) — baseline → mine failure →
   propose memory patch → candidate run → ship/reject → regression sweep.
   Ships record their memory version; a later baseline failure auto-unships
   the patch (retention check).
3. **Routing** (`router.ts`) — interval + event jobs with a busy-mutex.
4. **AutoDreaming** (`dream.ts`) — consolidate session notes into memory.
   Benchmark dreams are gated by a canary run (rolled back if the
   last-passing task breaks); terminal notes are dreamed into their own
   project's `.unown/memory/project.md`.
5. **Hooks** (`hooks.ts`, `termhooks.ts`) — SessionStart / UserPromptSubmit /
   PreToolUse / PostToolUse / Stop / SubagentStop guardrails, fully logged.

Plus the **terminal agent** (`cli.ts`, `term.ts`) — the `unown` command boots
the real pi TUI (or `-p` headless mode) in the user's project with tiered
memory, terminal-scoped guardrails and session-note capture. Notes reach the
engine via `POST /api/notes` or the offline outbox (`~/.unown/notes/outbox/`,
synced by the `note-sync` job / `outbox.ts`).

Supporting modules: `sandbox.ts` (isolated workspaces, jailed exec, sha256
tamper-proof verification), `bwrap.ts` (OS-level bubblewrap isolation: verify
scripts and agent bash commands run with a read-only rootfs, private
`/home` `/tmp` `/run`, no network namespace — see `native/README.md`),
`runner.ts` (headless pi deployment + transcripts),
`notes.ts` (session-note capture, benchmark + terminal kinds), `tasks.ts`
(seeded benchmark tasks), `store.ts` (SQLite persistence with schema
migrations), `server.ts` (REST + SSE API), `llm.ts` (bridge client),
`bus.ts` (in-process event bus).

## Running

The engine is booted by `mini-services/agent-service` at the repository root:

```bash
bun run agent:start      # or: cd mini-services/agent-service && bun index.ts
```

The terminal agent is booted by the repository root `bin/unown`:

```bash
bin/unown                # interactive TUI in the current directory
bin/unown -p "prompt"    # one-shot headless
bin/unown doctor         # configuration diagnostics
bin/unown memory         # print the effective memory stack
bin/unown note "text"    # deliver a note to the engine
```

Both require the sibling pi packages to be built (`cd ../../.. && bun run build`)
and an OpenAI-compatible endpoint reachable at `PI_BRIDGE_URL` (default
`http://127.0.0.1:3031`, served by `mini-services/llm-bridge`).

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `PI_AGENT_PORT` | 3030 | REST + SSE API port |
| `PI_BRIDGE_URL` | http://127.0.0.1:3031 | LLM endpoint base |
| `PI_MODEL_ID` | glm-4-plus | Model id registered with pi |
| `PI_PROVIDER` | zai-bridge | Provider name registered with pi |
| `PI_SELFLEARNING_DATA` | `<repo>/data/self-learning` | Runtime data dir |
| `PI_SELFLEARNING_DB` | `<repo>/db/selflearning.db` | SQLite file |
| `PI_DREAM_GATE` | on | `0` disables the dream canary gate |
| `UNOWN_HOME` | `~/.unown` | Terminal-agent state dir (agent config, global memory, note outbox) |
| `UNOWN_ENGINE_URL` | http://127.0.0.1:3030 | Where the terminal agent delivers notes |
| `UNOWN_STRICT_HOOKS` | off | `1` = sandbox-grade hooks in terminal sessions |

## API surface (port 3030)

`GET /api/overview` · `GET /api/tasks` · `GET|POST /api/runs` ·
`GET /api/runs/:id` · `GET|POST /api/cycles` · `GET /api/improvements` ·
`GET /api/memory` · `GET /api/memory/history` · `POST /api/memory/rollback` ·
`GET /api/dreams` · `POST /api/dreams/run` · `GET|POST /api/notes` ·
`POST /api/notes/sync` · `GET /api/hooks` · `GET /api/jobs` ·
`POST /api/jobs/:id/toggle` · `POST /api/jobs/:id/trigger` ·
`POST /api/prompt` · `GET /api/events` (SSE)

Everything the dashboard consumes is here — the package is UI-free and can be
embedded in any host process.
