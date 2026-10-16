# Configuration reference

Every knob unown has: the one variable you actually must set, the full environment reference (kept in sync with [`.env.example`](../.env.example)), where state lives on disk, and which files are safe to hand-edit.

- [The one required thing](#the-one-required-thing)
- [Environment variables](#environment-variables)
- [How `.env` gets loaded](#how-env-gets-loaded)
- [State and files](#state-and-files)
- [Agent config files](#agent-config-files-modelsjson--authjson--settingsjson)
- [Common setups](#common-setups)
- [Production notes](#production-notes)

## The one required thing

**`BRIDGE_UPSTREAM_KEY`** in the repo's `.env`. The bundled llm-bridge forwards every chat to your upstream provider (Dashscope, OpenAI, OpenRouter, vLLM, …) and needs that key to authenticate. Without it, the bridge itself starts fine — and then **every chat fails with 401**. The installer, `scripts/start.sh` and `unown doctor` all flag this loudly precisely because the failure mode is otherwise silent.

```bash
cp .env.example .env
# edit .env: BRIDGE_UPSTREAM_KEY=<your upstream key>
bun run agent:stop && bun run agent:start
```

The alternative is to bypass the bridge entirely and connect a direct provider — then nothing in `.env` is required and the stack becomes optional. See [providers](providers.md):

```bash
unown setup --provider openai --api-key sk-... --model gpt-4o
```

Everything else on this page is optional; each table shows the default.

## Environment variables

Author `.env` in the repo root from [`.env.example`](../.env.example). This table mirrors that file — when in doubt, `.env.example` is the source of truth.

### Dashboard (Next.js)

| Variable | Default | Meaning |
|----------|---------|---------|
| `NEXT_PUBLIC_AGENT_API_BASE` | unset | Where the dashboard finds the engine API. Unset keeps the sandbox gateway mode (requests route through the gateway with `?XTransformPort=3030`); set it to `http://localhost:3030` for a direct/local deployment, or to an API-gateway prefix such as `https://example.com/agent-api`. |
| `DATABASE_URL` | `file:./db/custom.db` | Prisma datasource for the dashboard scaffold only. The engine keeps its own SQLite store at `db/selflearning.db` and ignores this. |

### Self-learning engine (agent-service)

| Variable | Default | Meaning |
|----------|---------|---------|
| `PI_AGENT_PORT` | `3030` | Port for the REST+SSE API the dashboard (and the `unown` CLI's note delivery) talks to. |
| `PI_BRIDGE_URL` | `http://127.0.0.1:3031` | The OpenAI-compatible LLM endpoint the engine's agent talks to. Point it at the bundled bridge or any direct endpoint. |
| `PI_MODEL_ID` | `kimi-k2.5` | Model id registered with pi's `models.json`. Any id works through the bridge — unknown ids are routed onto its default. |
| `PI_PROVIDER` | `zai-bridge` | Provider name registered with pi. |
| `PI_SELFLEARNING_DATA` | `data/self-learning` (repo-relative) | Runtime data dir for the engine: sandboxes, sessions, memory. |
| `PI_SELFLEARNING_DB` | `db/selflearning.db` (repo-relative) | SQLite store for runs, dreams, memory versions, skills. |

### LLM bridge (mini-services/llm-bridge)

| Variable | Default | Meaning |
|----------|---------|---------|
| `BRIDGE_PORT` | `3031` | Listen port. |
| `BRIDGE_MODEL` | `kimi-k2.5` | The model the bridge advertises as its default. |
| `BRIDGE_UPSTREAM_URL` | `https://coding-intl.dashscope.aliyuncs.com/v1` | Upstream OpenAI-compatible base URL, no trailing slash. Any OpenAI-compatible server works. |
| `BRIDGE_UPSTREAM_KEY` | (empty) | Upstream bearer key. **The one required secret** — see above. |
| `BRIDGE_ROUTE_DEFAULT` | `kimi-k2.5` | Model used when a request names an unknown or legacy model id. |
| `BRIDGE_KNOWN_MODELS` | `kimi-k2.5,qwen3.7-plus,qwen3.6-plus` | Comma-separated allow-list of model ids that pass through unrouted; anything else maps onto `BRIDGE_ROUTE_DEFAULT`. |
| `BRIDGE_QWEN_THINKING` | off | `1` leaves qwen thinking models in thinking mode; the default disables thinking for snappier agent turns. |
| `BRIDGE_MIN_SPACING_MS` | `400` | Minimum spacing between upstream requests (serialized throttle). |
| `BRIDGE_UPSTREAM_TIMEOUT_MS` | `180000` | Cap on time-to-response-headers per upstream attempt, in ms. Streaming bodies stay uncapped once headers arrive; a stalled upstream fails fast instead of wedging callers. |
| `BRIDGE_API_KEY` | unset | Optional shared secret. When set, every request to the bridge must carry `Authorization: Bearer <key>`. Recommended whenever the bridge is reachable beyond localhost. |

### Terminal agent (`unown` CLI)

| Variable | Default | Meaning |
|----------|---------|---------|
| `UNOWN_HOME` | `~/.unown` | State dir for the CLI: agent config, global memory, note outbox. Per-project memory lives in `<project>/.unown/` regardless. |
| `UNOWN_ENGINE_URL` | `http://127.0.0.1:3030` | Where the CLI delivers terminal session notes (and reads engine health from). |
| `UNOWN_STRICT_HOOKS` | unset | `1` = sandbox-grade hooks in terminal sessions (blocks network, `git push`, `sudo`); the default allows normal developer operations. |
| `UNOWN_NO_PREFLIGHT` | unset | `1` skips the model-endpoint reachability check before each session. Print mode exits non-zero when the endpoint is down — see [troubleshooting](troubleshooting.md). |
| `PI_DREAM_GATE` | on | Dream canary gate: re-run the last-passing benchmark task under freshly dreamed project memory and roll the dream back if it fails. `0` disables. Read by the engine. |

### OS-level sandbox (bubblewrap)

| Variable | Default | Meaning |
|----------|---------|---------|
| `UNOWN_OS_SANDBOX` | `1` | Runs every engine sandbox command (verify scripts + the agent's bash calls) under bubblewrap: read-only root filesystem, private `/home` `/tmp` `/run`, network namespace killed. `0` disables OS isolation (falls back to the in-process path jail). |
| `UNOWN_SANDBOX_NET` | `0` | `1` keeps the network namespace shared for sandboxed commands — not recommended: sandboxed code could then reach the LLM bridge and the LAN. |
| `UNOWN_BWRAP` | vendored binary, then `PATH` | Explicit path to a bwrap binary. Defaults to the vendored copy at `pi-repo/packages/self-learning/native/bin/bwrap`, then `/usr/bin/bwrap`, `/usr/local/bin/bwrap`. |

Quick sanity check of the chat path once the stack is up:

```bash
curl -s http://127.0.0.1:3031/health   # → upstream.ok, upstreamKeyIsSet, authRequired, models
curl -s http://127.0.0.1:3030/api/overview
```

One engine knob exists in code but not yet in `.env.example`: `UNOWN_MAX_MINTED_TASKS` (cap on active minted tasks before the `task-mint` job skips, default 8). Set it in `.env` if you need it — the services read the whole file, not just the documented keys.

## How `.env` gets loaded

Three services run, each on its own port, each reading its own slice of the environment:

| Service | Default port | Health check | Reads |
|---------|--------------|--------------|-------|
| llm-bridge | `3031` (`BRIDGE_PORT`) | `GET /health` | all `BRIDGE_*` |
| self-learning engine | `3030` (`PI_AGENT_PORT`) | `GET /api/overview` | `PI_*`, `UNOWN_OS_SANDBOX` / `UNOWN_SANDBOX_NET` / `UNOWN_BWRAP`, `PI_DREAM_GATE` |
| dashboard | `3000` | `http://localhost:3000/dashboard` | `NEXT_PUBLIC_AGENT_API_BASE`, `DATABASE_URL` |

The `unown` CLI (a fourth process, running wherever you are) reads `UNOWN_HOME`, `UNOWN_ENGINE_URL`, `UNOWN_STRICT_HOOKS` and `UNOWN_NO_PREFLIGHT` — and its durable model config from `~/.unown/agent/`.

The variables reach those processes through three different mechanisms, and one common trap:

1. **`scripts/start.sh` sources `.env`** (`set -a; . ./.env; set +a`) before spawning the bridge, engine and dashboard — so all three services inherit every variable.
2. **bun auto-loads `.env` from the cwd of each service.** `mini-services/llm-bridge/.env` and `mini-services/agent-service/.env` are symlinks to the repo root `.env`, so running a service by hand from its own directory (`cd mini-services/llm-bridge && bun index.ts`) still picks the file up.
3. **The `unown` CLI does *not* see the repo's `.env` when you run it from another project.** bun loads `.env` from the process cwd — your project, not the unown repo — and the CLI's durable config comes from `~/.unown/agent/` (see below). If you want `UNOWN_ENGINE_URL`, `UNOWN_STRICT_HOOKS` or `UNOWN_HOME` to apply to terminal sessions everywhere, export them in your shell profile. The one exception: run `unown setup` from the unown repo root and it *will* see `.env` (handy for the `BRIDGE_API_KEY` coupling below).

## State and files

Where everything lives — all of it deletable, none of it required to pre-exist:

```text
~/.unown/                        terminal-agent state (UNOWN_HOME)
  agent/
    models.json                  provider + model registry — what unown setup writes
    auth.json                    API keys, file mode 0600
    settings.json                defaultProvider + defaultModel
    sessions/                    terminal session trees
    skills/                      starter skills + your global skills
    agents/                      your global subagent definitions (*.md)
  memory/
    policy.md                    tier 0 — optional, you author it
    user.md                      tier 2 — global preferences
  notes/
    outbox/                      notes queued while the engine was down
    done/                        ingested notes (archive)

<project>/.unown/
  memory/project.md              tier 1 — commit this one
  memory/local.md                tier 3 — gitignored by the scaffold
  .gitignore                     ignores local.md / *.local.md
  skills/<name>/SKILL.md         AutoDream-minted + your project skills
  agents/*.md                    project-level subagent definitions

unown repo (runtime state, gitignored)
  data/self-learning/            engine data: sandboxes, sessions, memory (PI_SELFLEARNING_DATA)
  db/selflearning.db             engine SQLite: runs, cycles, dreams, versions, skills (PI_SELFLEARNING_DB)
  .run/                          pidfiles + logs for the three services (bridge.log, engine.log, dashboard.log)
```

What is safe to delete and what that costs is covered in [troubleshooting](troubleshooting.md#resetting-cleanly).

## Agent config files (models.json / auth.json / settings.json)

`unown setup` writes three files under `~/.unown/agent/`:

| File | Written how | Safe to hand-edit? |
|------|-------------|--------------------|
| `models.json` | full rewrite on setup (setup is an explicit reconfigure action) | yes — point it at any OpenAI-compatible endpoint; the first-run bootstrap never clobbers an existing file |
| `auth.json` | merges your provider key, mode 0600 | yes — secrets only; keep it out of any repo |
| `settings.json` | merges `defaultProvider` + `defaultModel` | yes — pins the model sessions start on (switch mid-session with `/model`) |

The first run of `unown` bootstraps the same trio with bridge defaults (`zai-bridge` / `kimi-k2.5` / `http://127.0.0.1:3031/v1`) and seeds the starter skills — so the out-of-the-box path works as soon as the stack and `BRIDGE_UPSTREAM_KEY` are in place.

**The `BRIDGE_API_KEY` coupling.** The bridge-mode key stored in `models.json` is read from `BRIDGE_API_KEY` (falling back to the `bridge-local` placeholder) *only when the file is created*. If you later set `BRIDGE_API_KEY` in the repo's `.env`, the bridge now demands a bearer token — but the terminal agent still sends the old placeholder, and every chat dies with `unauthorized: missing or invalid bearer token (BRIDGE_API_KEY is set)`. Fix: re-run `unown setup` **from the unown repo root** (where bun loads `.env`, so the wizard sees the key), or hand-edit the `apiKey` field in `~/.unown/agent/models.json` to match. Details in [troubleshooting](troubleshooting.md).

## Common setups

Three shapes cover almost everyone:

**1. The bundled stack (default).** Everything on one machine, chats routed through the bridge:

```bash
cp .env.example .env      # set BRIDGE_UPSTREAM_KEY
bun run agent:start       # bridge :3031 + engine :3030 + dashboard :3000
unown                     # first run auto-configures the bridge provider
```

**2. Direct provider, no stack.** You just want the terminal agent with memory and guardrails, no engine running (notes queue in the outbox until you start one):

```bash
unown setup --provider openai --api-key sk-... --model gpt-4o
unown
```

The stack stays optional for chat; start it whenever you want AutoDream to chew through the queued notes. See [providers](providers.md).

**3. Terminal agents pointing at a remote engine.** The CLI can deliver notes to any reachable engine:

```bash
export UNOWN_ENGINE_URL=http://engine-host:3030   # in your shell profile
```

Notes flow there and show up in that engine's dashboard. One caveat: AutoDream writes a project's consolidated memory back to the recorded project path **on the engine's host** — so this works best when both sides share a filesystem (NFS home, or you simply run `unown` and the engine on the same box you SSH into). Put `BRIDGE_API_KEY` on the bridge and a TLS terminator in front of anything exposed beyond localhost (see [production notes](#production-notes)).

## Production notes

- **Run the engine without hot reload**: `cd mini-services/agent-service && bun index.ts`. The dev scripts use `bun --hot`, which is convenient but can detach in-flight cycles from the router mutex when engine sources change mid-run.
- **Put `BRIDGE_API_KEY` on the bridge** whenever it is reachable beyond localhost, and front the engine/dashboard with the TLS terminator / reverse proxy of your choice.
- **The engine is single-tenant by design** (a busy-mutex serializes background work so the sandbox is never double-driven). Scale by running more engine instances against separate data dirs — one pair of `PI_SELFLEARNING_DATA` / `PI_SELFLEARNING_DB` per instance.
