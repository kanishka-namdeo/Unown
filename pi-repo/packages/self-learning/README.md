# @earendil-works/pi-self-learning

The self-learning layer for the [pi coding agent](https://github.com/badlogic/pi-mono):
a single package that turns pi into an agent that **finds its own weaknesses,
fixes them, and remembers what worked**.

Implements the five patterns from Anthropic's practice of improving Claude Code
with Claude Code:

1. **Tiered memory** (`memory.ts`) — `policy → project → user → local`,
   most-specific-wins, versioned + rollback-able, injected into every pi
   session via `agentsFilesOverride`.
2. **Self-improving harness** (`harness.ts`) — baseline → mine failure →
   propose memory patch → candidate run → ship/reject → regression sweep.
3. **Routing** (`router.ts`) — interval + event jobs with a busy-mutex.
4. **AutoDreaming** (`dream.ts`) — consolidate session notes into a cleaner
   project memory.
5. **Hooks** (`hooks.ts`) — SessionStart / UserPromptSubmit / PreToolUse /
   PostToolUse / Stop / SubagentStop guardrails, fully logged.

Supporting modules: `sandbox.ts` (isolated workspaces, jailed exec, sha256
tamper-proof verification), `runner.ts` (headless pi deployment + transcripts),
`notes.ts` (session-note capture), `tasks.ts` (seeded benchmark tasks),
`store.ts` (SQLite persistence), `server.ts` (REST + SSE API), `llm.ts`
(bridge client), `bus.ts` (in-process event bus).

## Running

The package is booted by `mini-services/agent-service` at the repository root:

```bash
bun run agent:start      # or: cd mini-services/agent-service && bun index.ts
```

Requires the sibling pi packages to be built (`cd ../../.. && bun run build`)
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

## API surface (port 3030)

`GET /api/overview` · `GET /api/tasks` · `GET|POST /api/runs` ·
`GET /api/runs/:id` · `GET|POST /api/cycles` · `GET /api/improvements` ·
`GET /api/memory` · `GET /api/memory/history` · `POST /api/memory/rollback` ·
`GET /api/dreams` · `POST /api/dreams/run` · `GET /api/notes` ·
`GET /api/hooks` · `GET /api/jobs` · `POST /api/jobs/:id/toggle` ·
`POST /api/jobs/:id/trigger` · `POST /api/prompt` · `GET /api/events` (SSE)

Everything the dashboard consumes is here — the package is UI-free and can be
embedded in any host process.
