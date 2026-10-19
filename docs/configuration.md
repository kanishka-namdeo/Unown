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

**`BRIDGE_UPSTREAM_KEY`** in the repo's `.env`. The bundled llm-bridge forwards every chat to your upstream provider (Dashscope, OpenAI, OpenRouter, vLLM, …) and needs that key to authenticate. Without it, the bridge itself starts fine — and then **every chat fails with 401**. The installer, `scripts/start.ts` and `unown doctor` all flag this loudly precisely because the failure mode is otherwise silent.

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
| `PI_MINER_MODEL_ID` | unset | Pins the harness's failure-mining calls to a different model id (e.g. a `local-*` id on the bridge's local lane). Unset = `PI_MODEL_ID`. |
| `PI_DREAM_MODEL_ID` | unset | Same override for AutoDream consolidation calls. |
| `PI_SKILLS_MODEL_ID` | unset | Same override for skill-minting calls. |
| `PI_MINT_MODEL_ID` | unset | Same override for task-minting calls. |
| `PI_MINT_CASCADE` | unset | `1` enables the task-minting cascade (verified [E8/H10](../benchmarks/local-llm/results/REPORT.md#e8--local-draft--remote-repair-mint-cascade-h10)): a small local model authors the draft grammar-constrained, the existing validator gates it, and only an invalid draft costs one remote repair call on the regular mint model. A valid local draft never touches the remote API. Unset = remote authoring, unchanged. |
| `PI_MINT_DRAFT_MODEL_ID` | `local-qwen3-0.6b` | The local-lane model that authors cascade drafts (only with `PI_MINT_CASCADE=1`). Any `local-*` id routes to the bridge's local lane; the default is the E8-verified triage-class model. |
| `PI_LOCAL_ML` | unset | Master switch for the local-ML dream lanes (verified [H9–H15](../benchmarks/nonllm/results/REPORT.md)): `shadow` computes and reports the lanes without changing the dream prompt; `1`/`live` lets them alter it. Unset = everything off, prompts byte-identical. |
| `PI_NOTE_DEDUP` | unset | `union` — near-duplicate dream-input notes collapse before the prompt: MinHash structural tier always, cosine tier when the optional `local-ml` embedding package is installed ([H11/N2](../benchmarks/nonllm/results/REPORT.md): 100% recall on structural dups at 0.18ms/doc). |
| `PI_MEMORY_RANK` | unset | `activation` — dream-input notes ordered by the no-recency activation recipe (relevance × log-frequency × structural, recency as tiebreaker; [H13/N4](../benchmarks/nonllm/results/REPORT.md): recency decay measured ANTI-correlated with consolidation value). |
| `PI_DREAM_CURATE` | unset | `hybrid` — top-30% activation-ranked notes pass through full, the tail is LexRank-compressed (first line + floor always kept, guard banners untouched; [H14/N5](../benchmarks/nonllm/results/REPORT.md): 19.9% prompt-token cut, judge prefers the curated output). |
| `PI_LOCAL_ML_DIR` | `pi-repo/packages/self-learning/local-ml` | Where the engine looks for the optional ONNX embedding sub-package (guarded dynamic import; absent = symbolic-only lanes). |
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
| `BRIDGE_LOCAL_URL` | unset | Optional second upstream: a LOCAL OpenAI-compatible server (llama.cpp `llama-server`, Ollama, LM Studio), e.g. `http://127.0.0.1:8080/v1`. When set, `local-*` model ids (or `BRIDGE_LOCAL_MODELS`) are forwarded there — keyless by default, no spacing throttle. Start one with `node benchmarks/local-llm/runner.mjs serve --model qwen3-0.6b`. |
| `BRIDGE_LOCAL_KEY` | unset | Bearer key for the local upstream (llama.cpp runs keyless — leave empty). |
| `BRIDGE_LOCAL_MODELS` | unset | Comma-separated local model ids; empty = the `local-*` prefix convention routes locally. |

### Terminal agent (`unown` CLI)

| Variable | Default | Meaning |
|----------|---------|---------|
| `UNOWN_HOME` | `~/.unown` | State dir for the CLI: agent config, global memory, note outbox. Per-project memory lives in `<project>/.unown/` regardless. |
| `UNOWN_ENGINE_URL` | `http://127.0.0.1:3030` | Where the CLI delivers terminal session notes (and reads engine health from). |
| `UNOWN_ENGINE_HOST` | `127.0.0.1` | What network interface the engine server binds. The engine API is unauthenticated, so it stays on loopback by default; set `0.0.0.0` deliberately (e.g. a dedicated LAN box running the dashboard from another machine) — you are exposing note ingestion, memory rollback and sandboxed agent runs to everyone who can reach that interface. |
| `UNOWN_STRICT_HOOKS` | unset | `1` = sandbox-grade hooks in terminal sessions (blocks network, `git push`, `sudo`); the default allows normal developer operations. |
| `UNOWN_INJECTION_SHIELD` | `1` | `0` disables the live tool-result injection shield — the deterministic scanner that annotates suspect `bash`/`powershell` stdout, `webfetch` pages, `web_search` snippets and MCP tool results with a `[unown-injection-shield]` banner (see [BEHAVIOR: injection shield](BEHAVIOR.md#injection-shield)). Fail-open: a scanner error never breaks a tool call. |
| `UNOWN_PERMISSIONS` | `1` | `0` disables the granular permissions layer entirely (the hard-coded deny-list + path jail are unaffected — they run first regardless). See [permissions](permissions.md). |
| `UNOWN_PERMISSIONS_LEARN` | unset | `1` persists learned allow rules: when a bash command passes with no matching rule, an allow rule for its leading command is appended to the **user** config (idempotent, capped at 1000 learned rules). |
| `UNOWN_AUTO_COMMIT` | unset | `1` snapshots pending project-dir work as a `unown(auto): session end snapshot` commit when a session truly ends (opt-in; default OFF — `/commit` is the interactive form). See [usage: git-native commits](usage.md#git-native-commits-commit). |
| `UNOWN_PRICE_<MODEL>_IN/_OUT` | estimates | Pin per-model prices (USD per 1M tokens) for `unown usage` cost math; model id upper-cased with `.`/`-` → `_` (e.g. `UNOWN_PRICE_KIMI_K2_5_IN`). Unset = shipped `~$` estimates. See [usage tracking](usage-tracking.md). |
| `UNOWN_BRIDGE_STATE_DIR` | auto | Where the bridge writes its persistent state (usage log). Default: the unown repo's `.run/` when running from the checkout, else `$UNOWN_HOME/bridge`. |
| `UNOWN_NO_PREFLIGHT` | unset | `1` skips the model-endpoint reachability check before each session. Print mode exits non-zero when the endpoint is down — see [troubleshooting](troubleshooting.md). |
| `UNOWN_LSP` | `1` | `0` disables the `lsp` tool and the PostToolUse diagnostics feedback loop in terminal sessions. |
| `UNOWN_LSP_WAIT_MS` | `10000` | Max wait for fresh language-server diagnostics after a `write`/`edit` before the tool result continues without them. |
| `UNOWN_LSP_TIMEOUT_MS` | `15000` | Per-request timeout for LSP JSON-RPC calls (initialize, hover, definition, ...). |
| `UNOWN_LSP_MAX_MSG_BYTES` | `33554432` | Cap on a single LSP message's `Content-Length`; a violation recycles the connection instead of buffering it. |
| `UNOWN_LSP_CRASH_COOLDOWN_MS` | `30000` | After a language-server crash, how long before a restart is attempted (max 3 restarts per server per session). |
| `UNOWN_MCP` | `1` | `0` disables the MCP client surface (no servers connect, no `mcp__*` tools register). |
| `UNOWN_MCP_TIMEOUT_MS` | `120000` | Per-request timeout for MCP JSON-RPC calls (tools/call, tools/list). |
| `UNOWN_MCP_CONNECT_TIMEOUT_MS` | `20000` | Timeout for the MCP initialize handshake. |
| `UNOWN_MCP_RECONNECT_COOLDOWN_MS` | `30000` | After an MCP server dies or fails to connect, how long before reconnect attempts resume (`/mcp` force-throughs). |
| `UNOWN_MCP_PING_INTERVAL_MS` | `60000` | MCP keepalive ping interval (a failed ping marks the server errored and starts the reconnect cooldown). |
| `UNOWN_CHECKPOINT_MAX_BLOB_BYTES` | `67108864` | Files larger than this are not checkpointed (the turn still reverts its other files; the ledger notes the exception). |
| `UNOWN_WORKTREE_ISOLATION` | `1` | `0`/`false`/`no` disables the task tool's worktree-isolation lane (`worktree_isolation: true` spawns are rejected with a typed failure instead of running in the shared tree; see [subagents](subagents.md#worktree-isolation)). |
| `UNOWN_AUTOMATION` | unset | Set to `1` by the engine's scheduler on every [automation](usage.md#automations-unown-automations) run: hides the automation mutation tools inside the unattended session (an automation cannot schedule automations; subagents inherit the flag). You normally never set it by hand. |
| `UNOWN_LSP_MAX_SYNC_BYTES` | `4194304` | Files larger than this skip LSP document sync (didOpen/didChange) — the server cannot help on huge files; logged once per file. |
| `UNOWN_TRUST_PROJECT_CONFIG` | unset | `1`/`true` bypasses the project-config trust gate (`.unown/mcp.json` / `.unown/lsp.json` load without approval — CI/headless). Any other value keeps the gate on; approve interactively with `/mcp trust`. |
| `UNOWN_STATE_WARN_BYTES` | `536870912` | `unown doctor`'s unown-state check warns when the project's `.unown/` runtime state (checkpoints + receipts + reviews) exceeds this. |
| `UNOWN_WEB_SEARCH` | `1` | `0` disables the `web_search` tool. |
| `UNOWN_WEBFETCH` | `1` | `0` disables the `webfetch` tool. |
| `UNOWN_WEB_SEARCH_PROVIDER` | auto | Explicit provider id or comma-separated chain (e.g. `tavily,duckduckgo`); unset = keyed providers first, then the keyless chain. |
| `UNOWN_WEB_SEARCH_TIMEOUT_MS` | `20000` | Per-provider search timeout. |
| `UNOWN_WEB_SEARCH_MAX_RESULTS` | `8` | Default result cap per search (max 20; the tool's `max_results` parameter overrides per call). |
| `UNOWN_WEBFETCH_TIMEOUT_MS` | `30000` | Per-request timeout for `webfetch` (and the `fetch_url` alias). |
| `UNOWN_WEBFETCH_MAX_CHARS` | `20000` | Default returned-character cap (clamped 500–200000; the tool's `max_chars` parameter overrides per call). |
| `UNOWN_WEBFETCH_ROBOTS` | on | `0` disables robots.txt honoring in `webfetch`/`fetch_url`. |
| `UNOWN_WEBFETCH_ALLOW_PRIVATE` | unset | `1` allows `webfetch` to reach private/LAN hosts and non-standard ports (internal docs mirrors; the http(s)-only check always applies). |
| `UNOWN_SEARXNG_URL` | unset | SearXNG instance URL for the `searxng` provider (self-hosted with `formats: [html, json]` — see `scripts/searxng-test/settings.yml`). |
| `UNOWN_STACKEXCHANGE_KEY` | unset | Optional free stackapps.com key; lifts the keyless 300 req/day per-IP limit to 10000/day. |
| `UNOWN_DASHSCOPE_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI-compatible base for the `dashscope` (Qwen enable_search) provider; intl users set `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`. |
| `UNOWN_DASHSCOPE_MODEL` | `qwen-plus` | Model for the `dashscope` provider. |
| `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` / `SERPER_API_KEY` / `EXA_API_KEY` / `PERPLEXITY_API_KEY` / `JINA_API_KEY` / `ZHIPU_API_KEY` / `DASHSCOPE_API_KEY` / `KAGI_API_KEY` / `SERPAPI_API_KEY` / `FIRECRAWL_API_KEY` | unset | Paid web-search provider keys — any that are set join the search chain ahead of the keyless fallbacks (see [usage: web tools](usage.md#web-search--webfetch)). `DASHSCOPE_API_KEY` accepts **standard keys only** (`sk-…`): coding-plan keys (`sk-sp-…`) are refused up front with an actionable note (the coding endpoints silently ignore `enable_search`, the standard endpoints reject them — verified live 2026-10-19); the chain then cascades to the next provider. |
| `GITHUB_TOKEN` | unset | Optional token for the keyless `github` search provider (lifts the 10 req/min per-IP search cap; never required). |
| `NO_UPDATE_NOTIFIER` | unset | Any value silences the startup update notice and its background check (ecosystem-standard name). Manual `unown update` still works — see [updating](updating.md). |
| `UNOWN_DISABLE_AUTOUPDATE` | unset | `1` — same as `NO_UPDATE_NOTIFIER`, the Unown-native spelling. |
| `DO_NOT_TRACK` | unset | `1` — the standard nonessential-traffic opt-out; suppresses the background update check. |
| `UNOWN_DISABLE_UPDATES` | unset | `1` blocks **all** update paths (`unown update`, `--check`, background check) — the org/CI kill switch. |
| `PI_DREAM_GATE` | on | Dream canary gate: re-run the last-passing benchmark task under freshly dreamed project memory and roll the dream back if it fails. `0` disables. Read by the engine. |
| `UNOWN_MAX_MINTED_TASKS` | `8` | Cap on ACTIVE minted tasks before the engine's task-mint job skips authoring new curriculum variants (minting resumes as tasks are archived/graduated). Read by the engine. |

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

All env knobs shown above are also documented (commented) in `.env.example` — the services read the whole file, not just the uncommented keys.

## How `.env` gets loaded

Three services run, each on its own port, each reading its own slice of the environment:

| Service | Default port | Health check | Reads |
|---------|--------------|--------------|-------|
| llm-bridge | `3031` (`BRIDGE_PORT`) | `GET /health` | all `BRIDGE_*` |
| self-learning engine | `3030` (`PI_AGENT_PORT`) | `GET /api/overview` | `PI_*`, `UNOWN_OS_SANDBOX` / `UNOWN_SANDBOX_NET` / `UNOWN_BWRAP`, `PI_DREAM_GATE` |
| dashboard | `3000` | `http://localhost:3000/dashboard` | `NEXT_PUBLIC_AGENT_API_BASE`, `DATABASE_URL` |

The `unown` CLI (a fourth process, running wherever you are) reads `UNOWN_HOME`, `UNOWN_ENGINE_URL`, `UNOWN_STRICT_HOOKS` and `UNOWN_NO_PREFLIGHT` — and its durable model config from `~/.unown/agent/`.

The variables reach those processes through three different mechanisms, and one common trap:

1. **`scripts/start.ts` parses `.env`** (same `set -a; . ./.env; set +a` semantics) before spawning the bridge, engine and dashboard — so all three services inherit every variable (bun does not read the repo-root `.env` from a mini-services cwd, so the launcher exports it into each child).
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
  update-check.json              update-notifier cache — 24h TTL, remote URL stored credential-free
  update-state.json              last `unown update` record (from/to/fromSha/ok) — what --rollback restores
  migrations.json                user-state schema version + migration history (forward-only; see [updating](updating.md))
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
