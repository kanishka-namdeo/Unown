# Configuration reference

Every knob unown has: the one variable you actually must set, the full environment reference (kept in sync with [`.env.example`](../.env.example)), where state lives on disk, which files are safe to hand-edit — and the gate files that switch whole behaviors on (adversary mode, injection scanner, user hooks).

- [The one required thing](#the-one-required-thing)
- [Environment variables](#environment-variables)
- [How `.env` gets loaded](#how-env-gets-loaded)
- [State and files](#state-and-files)
- [Agent config files](#agent-config-files-modelsjson--authjson--settingsjson--ui-panelsjson)
- [Addons config](#addons-config-addonsjson)
- [Behavior gate files](#behavior-gate-files)
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

### Self-learning engine (agent-service)

| Variable | Default | Meaning |
|----------|---------|---------|
| `PI_AGENT_PORT` | `3030` | Port for the REST+SSE API the TUI dashboard and CLI clients (the `unown` CLI's note delivery) talk to. |
| `PI_BRIDGE_URL` | `http://127.0.0.1:3031` | The OpenAI-compatible LLM endpoint the engine's agent talks to. Point it at the bundled bridge or any direct endpoint. |
| `PI_MODEL_ID` | `agnes-3.0-flash` | Model id registered with pi's `models.json`. Any id works through the bridge — unknown ids are routed onto its default. |
| `PI_PROVIDER` | `zai-bridge` | Provider name registered with pi. |
| `PI_MINER_MODEL_ID` | unset | Pins the harness's failure-mining calls to a different model id (e.g. a `local-*` id on the bridge's local lane). Unset = `PI_MODEL_ID`. |
| `PI_DREAM_MODEL_ID` | unset | Same override for AutoDream consolidation calls — and, since the learning-core swap, the memory platform's extraction + reconcile model too ([memory-platform swap](memory-platform-swap-assessment.md)). |
| `PI_SKILLS_MODEL_ID` | unset | Same override for skill-minting calls. |
| `PI_MINT_MODEL_ID` | unset | Same override for task-minting calls. |
| `PI_MINT_CASCADE` | unset | `1` enables the task-minting cascade (verified [E8/H10](../benchmarks/local-llm/results/REPORT.md#e8--local-draft--remote-repair-mint-cascade-h10)): a small local model authors the draft grammar-constrained, the existing validator gates it, and only an invalid draft costs one remote repair call on the regular mint model. A valid local draft never touches the remote API. Unset = remote authoring, unchanged. |
| `PI_MINT_DRAFT_MODEL_ID` | `local-qwen3-0.6b` | The local-lane model that authors cascade drafts (only with `PI_MINT_CASCADE=1`). Any `local-*` id routes to the bridge's local lane; the default is the E8-verified triage-class model. |
| `PI_LOCAL_ML` | unset | **Retired by the 2026-10-22 learning-core swap** ([memory-platform swap](memory-platform-swap-assessment.md)): the dream no longer routes notes through the local-ML lanes — mem0's extraction pipeline owns dedup/consolidation — so the shadow/live master switch no longer gates anything on a live path (`localml.ts` still parses it). The lanes' ONNX lane survives as the platform's embedder (`PI_MEM0_EMBEDDER`). |
| `PI_NOTE_DEDUP` | unset | **Retired by the swap** — near-duplicate collapse now happens inside the memory platform (mem0's ADD→DEDUP→UPDATE extraction; the reconcile pass merges survivors). |
| `PI_MEMORY_RANK` | unset | **Retired by the swap** — dream-input ordering is moot when the batch enters as one extraction call, not a serialized prompt. |
| `PI_DREAM_CURATE` | unset | **Retired by the swap** — LexRank compression of the dream prompt has no prompt to compress; the render cap (`PI_MEM0_MAX_RENDERED`) governs output size instead. |
| `PI_LOCAL_ML_DIR` | `pi-repo/packages/self-learning/local-ml` | Where the engine looks for the optional ONNX embedding sub-package (guarded dynamic import) — now the memory platform's semantic embedder (`PI_MEM0_EMBEDDER=auto|onnx`); absent = the deterministic lexical fallback. |
| `PI_SELFLEARNING_DATA` | `data/self-learning` (repo-relative) | Runtime data dir for the engine: sandboxes, sessions, memory. |
| `PI_SELFLEARNING_DB` | `db/selflearning.db` (repo-relative) | SQLite store for runs, dreams, memory versions, skills. |
| `PI_MEM0_DIR` | `DATA_DIR/mem0` (`data/self-learning/mem0`) | Data dir for the memory platform's SQLite stores (`vector_store.db` + `history.db`) — the Mem0-backed learning core behind the project tier. Self-contained: deleting it re-imports the on-disk tier content at next boot. See [memory-platform swap](memory-platform-swap-assessment.md). |
| `PI_MEM0_EMBEDDER` | `auto` | The platform's embedder: `onnx` = the local-ml lane (bge-small-en-v1.5, 384-dim; fails loudly if the lane is absent), `lexical` = the deterministic fallback (same text → same vector, keyword-class recall), `auto` = onnx when the lane imports, else lexical (with a `mem0:embedder-degraded` event + a named backend in the render footer, so degraded is never silent). |
| `PI_MEM0_MAX_RENDERED` | `110` | Render bullet cap for the project-tier markdown — the old "under 120 lines" shape. Oldest bullets drop first; hard-won rules (kind `harness`/`seed`) are immune. |
| `PI_MEM0_RECONCILE` | on | `0` disables the reconcile pass (contradiction resolution, semantic dedup, pruning) — the platform becomes mem0-additive-only. |
| `MEM0_TELEMETRY` | `false` (engine-set) | mem0ai's own kill-switch, read at import time. mem0's boot otherwise awaits an **untimed telemetry POST** (always sent, not sampled) — a boot hang on restricted networks and an un-asked phone-home for a local-first engine. The engine defaults it to `false` before importing mem0ai; set `MEM0_TELEMETRY=true` explicitly to opt in to upstream telemetry. |
| `MEM0_DIR` | `PI_MEM0_DIR/mem0-home` (engine-set) | mem0ai's own local state (the telemetry id). Defaulted under the engine's mem0 dir so nothing writes to `~/.mem0`; user-set values are never overridden. |

### LLM bridge (mini-services/llm-bridge)

| Variable | Default | Meaning |
|----------|---------|---------|
| `BRIDGE_PORT` | `3031` | Listen port. |
| `BRIDGE_MODEL` | `agnes-3.0-flash` | The model the bridge advertises as its default. |
| `BRIDGE_UPSTREAM_URL` | `https://apihub.agnes-ai.com/v1` | Upstream OpenAI-compatible base URL, no trailing slash. Any OpenAI-compatible server works. |
| `BRIDGE_UPSTREAM_KEY` | (empty) | Upstream bearer key. **The one required secret** — see above. |
| `BRIDGE_ROUTE_DEFAULT` | follows `BRIDGE_MODEL` | Model used when a request names an unknown or legacy model id. |
| `BRIDGE_KNOWN_MODELS` | `agnes-3.0-flash,agnes-2.5-flash` | Comma-separated allow-list of model ids that pass through unrouted; anything else maps onto `BRIDGE_ROUTE_DEFAULT`. |
| `BRIDGE_QWEN_THINKING` | off | `1` leaves qwen thinking models in thinking mode; the default disables thinking for snappier agent turns. This is also what feeds the split-view [thinking panel](split-view.md#model-notes-the-thinking-panel) — with the default, qwen streams no reasoning and the panel stays idle; with `1`, `qwen3.7-plus` streams reasoning the panel renders live |
| `BRIDGE_MIN_SPACING_MS` | `400` | Minimum spacing between upstream requests (serialized throttle). |
| `BRIDGE_UPSTREAM_TIMEOUT_MS` | `180000` | Cap on time-to-response-headers per upstream attempt, in ms. Streaming bodies stay uncapped once headers arrive; a stalled upstream fails fast instead of wedging callers. |
| `BRIDGE_API_KEY` | unset | Optional shared secret. When set, every request to the bridge must carry `Authorization: Bearer <key>`. Recommended whenever the bridge is reachable beyond localhost. |
| `BRIDGE_LOCAL_URL` | unset | Optional second upstream: a LOCAL OpenAI-compatible server (llama.cpp `llama-server`, Ollama, LM Studio), e.g. `http://127.0.0.1:8080/v1`. When set, `local-*` model ids (or `BRIDGE_LOCAL_MODELS`) are forwarded there — keyless by default, no spacing throttle. Start one with `node benchmarks/local-llm/runner.mjs serve --model qwen3-0.6b`. |
| `BRIDGE_LOCAL_KEY` | unset | Bearer key for the local upstream (llama.cpp runs keyless — leave empty). |
| `BRIDGE_LOCAL_MODELS` | unset | Comma-separated local model ids; empty = the `local-*` prefix convention routes locally. |
| `BRIDGE_FALLBACK_URL` | unset | Optional FAILOVER upstream: a second REMOTE OpenAI-compatible endpoint (e.g. Agnes AI `https://apihub.agnes-ai.com/v1`, no trailing slash). When the primary fails with a failover-eligible error — 429/quota throttle (Dashscope's "hour allocated quota exceeded" ships as 429), 402/408, 401/403, any 5xx, network — the request is retried once there immediately (no retry-backoff burn) and the client sees a normal 200 or SSE stream. Unset/empty = failover off. |
| `BRIDGE_FALLBACK_KEY` | unset | Bearer key for the fallback upstream. |
| `BRIDGE_FALLBACK_MODEL` | unset | Model id failed-over requests are rewritten onto (e.g. `agnes-3.0-flash`); empty keeps the already-routed id, for fallbacks serving the same catalog. |

### Terminal agent (`unown` CLI)

| Variable | Default | Meaning |
|----------|---------|---------|
| `UNOWN_HOME` | `~/.unown` | State dir for the CLI: agent config, global memory, note outbox. Per-project memory lives in `<project>/.unown/` regardless. Note: three security surfaces (the adversary gate file, the injection scanner config and `doctor-instructions`) resolve their default under `~/.config/unown/` — the XDG-style convention their goose/pi precedents use — while everything else lives directly under `~/.unown`; both honor `UNOWN_HOME` when it is set. |
| `UNOWN_RUNTIME_DIR` | `<state root>/.run` | Where the supervisor writes `engine.log`, `engine.pid`, `engine-spawn-state.json` (the crash-loop circuit + `lastCause`) and the install/update transition marker. Set it to isolate a test or an alternate profile from a live engine — on Windows a running engine can hold `.run/engine.log` exclusively (`EBUSY`). |
| `UNOWN_ENGINE_URL` | `http://127.0.0.1:3030` | Where the CLI delivers terminal session notes (and reads engine health from). |
| `UNOWN_ENGINE_AUTH` | `token` | Engine API authentication (M7). `token` (default): every `/api` request must present the per-boot bearer token from `data/self-learning/engine.token` (0600, regenerated each boot, removed on graceful stop) — same-user clients auto-discover it, so the default costs nothing; `GET /` (liveness) and CORS preflights are exempt. `off`: tokenless — the engine REFUSES to boot if `UNOWN_ENGINE_HOST` leaves loopback (an unauthenticated network bind can never exist). Host-header validation and Origin enforcement are always on, regardless of this setting. |
| `UNOWN_ENGINE_TOKEN` | unset | Engine side: pin the token instead of generating per-boot. Client side: present this token — the token **value**, not the path to the file (for a remote engine or another install's engine reached via `UNOWN_ENGINE_URL`). A 401 from a foreign engine is reported as `BLOCKED` and never triggers a spawn. |
| `UNOWN_ENGINE_HOSTS` | empty | Extra DNS hostnames accepted in the engine's `Host` header (comma-separated, the Vite `allowedHosts` pattern). Default accepts `localhost`, `*.localhost` and IP literals only — same-port DNS rebinding (`evil.com` resolving to `127.0.0.1`) is refused. |
| `UNOWN_ENGINE_HOST` | `127.0.0.1` | What network interface the engine server binds. Loopback is the default; set `0.0.0.0` deliberately (e.g. a dedicated LAN box serving API clients — `unown dashboard` or the CLI — from other machines) — the M7 bearer token then gates the API (mandatory: an `UNOWN_ENGINE_AUTH=off` + non-loopback bind refuses to boot), but loopback remains the safe default. |
| `UNOWN_ENGINE_CORS` | loopback allow-list | Which browser origins may call the engine API. Default: loopback origins only (`http://localhost:*` / `http://127.0.0.1:*`, any port) — random websites are refused, so they cannot drive the tokened engine through your browser. Override with a comma-separated origin list (replaces the default), `*` (any origin — only sane next to `UNOWN_ENGINE_HOST` plus an authenticating reverse proxy), or `off` (no CORS headers at all). In-tree clients (the TUI dashboard, the CLI, the bridge) are not browsers and never send `Origin`, so none of this affects them; the gate exists for a future browser client and for the Origin-enforcement side of M7. |
| `UNOWN_ENGINE_AUTOSTART` | `1` | `0` (also `false`/`off`/`no`) is the engine-off kill switch: no agent-side touchpoint ever spawns the engine (the footer still shows its state; no session-start toast), and the install/update lane does not install the always-on OS service. `unown engine start` and `unown engine install` still work — a manual action always wins. See [resilience](resilience.md#r9--deliberate-engine-off). |
| `UNOWN_NO_ENGINE_SERVICE` | unset | `1` (also `true`/`yes`/`on`) keeps the per-user OS service out of `bun run agent:install` and `unown update` only — agent-side auto-start, `unown engine start` and an explicit `unown engine install` are unaffected. The service is the source-install default because it is what makes memory, AutoDream and routines survive a reboot with no agent invoked; use this when another supervisor owns the process, or run [`unown engine uninstall`](usage.md#command-reference) once (the opt-out is remembered in `UNOWN_HOME` and cleared by a manual install). CI runs skip the service automatically. See [routines · always-on](routines.md#always-on-the-engine-service). |
| `UNOWN_NOTIFY` | `1` | `0` (also `false`/`off`/`no`) disables the OSC-9 answer ping family: the print-mode notification + BEL when a `unown -p` answer lands after a long run ([usage](usage.md#three-ways-to-run)), and the TUI turn-complete ping below. `DO_NOT_TRACK=1` silences them too (a ping is nonessential in exactly that sense). TTY-only by construction. |
| `UNOWN_NOTIFY_MS` | `120000` | How long a run must last before its answer earns the OSC-9 ping — print mode AND the TUI turn-complete ping share this threshold (see `UNOWN_NOTIFY` / `UNOWN_TUI_NOTIFY`); `0` pings on every answer. An unset OR EMPTY value means the default — the repo `.env` ships optional keys as `KEY=` and `Number("")` is `0`, which would otherwise ping on instant answers. |
| `UNOWN_TUI_NOTIFY` | `1` | `0` disables the TUI turn-complete attention ping: after an interactive turn that lasted at least `UNOWN_NOTIFY_MS`, a deferred OSC-9 + BEL ("unown: done — …") lands once the frame settles — the come-back signal for long turns you walked away from. The write is deferred (never mid-frame), a fresh turn cancels a pending ping (they never stack), and quick turns stay silent. |
| `UNOWN_AUTO_TITLES` | `1` | `0` disables session auto-titles: after a turn settles, a cheap background bridge call names the session (3-6 words) so `/resume` is scannable — the every-coding-agent convention. Only fires in interactive sessions, never overwrites a user-set `/name`, and any failure is silent (a title must never cost a turn). |
| `UNOWN_OUTPUT_STYLE` | unset | Force the active output style (see `/output-style` in [usage](usage.md)) regardless of the persisted `.unown/output-style.json` / `~/.unown/agent/output-style.json` — env wins, project file beats user file, built-in `default` when nothing is set. |
| `UNOWN_OUTBOX_MAX` | `200` | Max queued note files in `$UNOWN_HOME/notes/outbox` before the oldest are dropped (every drop counted and surfaced in `/engine` and `unown engine status`); `0` = unlimited. See [resilience](resilience.md#r6--outbox-overflow). |
| `UNOWN_OUTBOX_MAX_ATTEMPTS` | `5` | Ingest attempts an outbox note gets before it is dead-lettered to `$UNOWN_HOME/notes/dead/` with a `.reason.txt` sidecar (the 2026-10-26 hardening round; at the 5-minute note-sync cadence that is ~25 minutes of honest retries). An unparseable file dead-letters on first sight. Dead files are never deleted — read the reason, fix the note, `mv` it back into `outbox/` to retry. The dead count surfaces in `/engine`, `unown doctor` and `unown engine status`. |
| `UNOWN_NOTE_BUDGET_MS` | `2500` | Overall deadline for one session-note delivery attempt (floor 500 ms); on expiry the note lands in the outbox instead. A recent down probe skips the network entirely. A NETWORK-failed POST gets one bounded ~600 ms retry before the outbox (the 2026-10-26 round) — notes landing inside the engine-restart window still deliver directly. Read by the terminal agent. |
| `UNOWN_ENGINE_DRAIN_BUDGET_MS` | `10000` | How long graceful shutdown (SIGTERM / `POST /api/shutdown`) waits for an in-flight router job (an auto-dream or harness cycle holding the busy mutex) before closing the store under it (floor 500 ms; the next boot's orphan recovery heals anything left). `GET /api/health` reports the engine's lifecycle `phase` (`warming` \| `ready` \| `draining`) and this budget — the stopper can wait out the drain instead of racing it. |
| `UNOWN_RETENTION_DAYS` | unset | Global retention override for the engine's operational telemetry (the `db-retention` job): `0` disables ALL pruning (the kill switch); a positive N sets every table's day window to N (per-table knobs below still win). Precious tables (memory versions, skills, tasks, improvements, automations) are never pruned at any setting, and undreamed notes (the dream work queue) are structurally excluded — only dreamed notes age out. See [detached-engine-architecture](detached-engine-architecture.md#failure-modes--mitigations). |
| `UNOWN_RETENTION_HOOK_LOG_DAYS` | `14` | hook_log rows older than this many days are pruned (the table grows ~2 rows per tool call and `/api/overview` COUNTs it on every hit). `0` disables the time rule for this table. |
| `UNOWN_RETENTION_HOOK_LOG_MAX_ROWS` | `250000` | Backstop row cap for hook_log: beyond the newest N rows, older rows are pruned regardless of age — a runaway loop must not grow the table without bound inside the time window (Prometheus' time-OR-size shape). `0` = no cap. |
| `UNOWN_RETENTION_RUNS_DAYS` | `30` | Finished runs older than this are pruned (run rows carry full ~19KB transcripts — the heaviest column in the DB). `running` rows are never pruned. |
| `UNOWN_RETENTION_HISTORY_DAYS` | `90` | Shared history horizon: dreams, ended cycles and finished automation_runs older than this are pruned. |
| `UNOWN_RETENTION_NOTES_DAYS` | `90` | DREAMED notes older than this are pruned (their content is already consolidated into memory versions). Undreamed notes are never pruned. |
| `UNOWN_AUTOMATION_MISFIRE_CATCHUP` | `0` | The **default** missed-run policy for routines without an explicit one ([routines](routines.md) · `--misfire`): `1` opts into launchd-style catch-up — a slot missed while the computer slept or the engine was down (past the grace window, newer than 24h) runs ONCE on wake, coalesced, never N replays. Default `0` keeps the cron-classic behavior: skip + record `computer_asleep_or_engine_not_running`. |
| `PI_AUTOMATION_MISFIRE_GRACE_MS` | `300000` | A due routine slot older than this is treated as missed-by-sleep rather than merely late (skip or catch-up per the routine's own misfire policy, else the knob above). |
| `PI_ENGINE_PROBE_INTERVAL_MS` | `30000` | How often the session's engine-status loop probes the engine for the `memory:` footer (floor 5 s; fast re-probes at 2/5/9/16 s follow a spawn kick). Read by the terminal agent. |
| `PI_ENGINE_PROBE_TIMEOUT_MS` | `700` | Per-probe timeout of the engine-status loop (floor 100 ms) — loopback refusal is instant, so only a hanging port ever sees it, in the background. Read by the terminal agent. |
| `UNOWN_STRICT_HOOKS` | unset | `1` = sandbox-grade hooks in terminal sessions (blocks network, `git push`, `sudo`); the default allows normal developer operations. |
| `UNOWN_INJECTION_SHIELD` | `1` | `0` disables the live tool-result injection shield — the deterministic scanner that annotates suspect `bash`/`powershell` stdout, `webfetch` pages, `web_search` snippets and MCP tool results with a `[unown-injection-shield]` banner (see [BEHAVIOR: injection shield](BEHAVIOR.md#injection-shield)). Fail-open: a scanner error never breaks a tool call. |
| `UNOWN_INJECTION_SCANNER` | `1` | `0` disables the 106-pattern prompt-injection **scanner** — the blocking PreToolUse guard that runs in engine sandbox runs over `bash`/`powershell` commands and `write`/`edit` content (a different layer from the annotate-only shield above; see [BEHAVIOR: prompt-injection scanner](BEHAVIOR.md#prompt-injection-scanner-milestone-15--2026-10-19)). |
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
| `UNOWN_LSP_CRASH_COOLDOWN_MS` | `30000` | After a language-server crash, how long before a restart is attempted (restarts capped by `UNOWN_LSP_MAX_RESTARTS` per server per session). |
| `UNOWN_LSP_MAX_RESTARTS` | `3` | Auto-restart budget per crashed language server per session (integer 0–100; junk values fall back to 3). |
| `UNOWN_MCP` | `1` | `0` disables the MCP client surface (no servers connect, no `mcp__*` tools register). |
| `UNOWN_MCP_TIMEOUT_MS` | `120000` | Per-request timeout for MCP JSON-RPC calls (tools/call, tools/list). |
| `UNOWN_MCP_CONNECT_TIMEOUT_MS` | `20000` | Timeout for the MCP initialize handshake. |
| `UNOWN_MCP_RECONNECT_COOLDOWN_MS` | `30000` | After an MCP server dies or fails to connect, how long before reconnect attempts resume (`/mcp` force-throughs). |
| `UNOWN_MCP_PING_INTERVAL_MS` | `60000` | MCP keepalive ping interval (a failed ping marks the server errored and starts the reconnect cooldown). |
| `UNOWN_CHECKPOINT_MAX_BLOB_BYTES` | `67108864` | Files larger than this are not checkpointed (the turn still reverts its other files; the ledger notes the exception). |
| `UNOWN_WORKTREE_ISOLATION` | `1` | `0`/`false`/`no` disables the task tool's worktree-isolation lane (`worktree_isolation: true` spawns are rejected with a typed failure instead of running in the shared tree; async fleet spawns compose with the lane — see [subagents](subagents.md#worktree-isolation)). |
| `UNOWN_FLEET_TIMEOUT_MS` | `900000` | Hard wall-clock cap on one async fleet child, in ms (watchdog + the print-mode drain wait). Values below 1000 fall back to the default, so a typo can never zero the watchdog. A per-agent `timeoutMs` frontmatter field replaces it for that child (the same 30s–30min clamp the sync lane applies). See [subagents → fleet limits](subagents.md#subagent-state-on-disk-the-fleet-journal). |
| `UNOWN_FLEET_MAX_CONCURRENT` | `8` | Maximum number of LIVE async fleet children per session. The batch cap bounds one call (4); this bounds the stack of async spawns across turns. The overflow is a typed spawn failure that tells the model to wait for results, check `task_control {action:"list"}`, or stop a child first — never a silent drop. `0` = unlimited (the kill-switch escape hatch); junk falls back to the default. See [subagents → fleet limits](subagents.md#subagent-state-on-disk-the-fleet-journal). |
| `UNOWN_FLEET_REAPER` | `1` | The subagent crash sweep at session boot, covering fleet AND sync-lane children: journal entries left open by a crashed parent are checked — live orphans (fresh heartbeat, cmdline-verified on POSIX via the child's session file or prompt file) are tree-killed and journaled `reaped`, dead ones traced `abandoned`, the rotting control/ask channels and orphan heartbeats cleaned, and adopted or isolated worktrees marked `orphaned` (kept on disk). Never runs inside subagents; a live parent always wins; never kills a pid it cannot identify. `0` disables both lanes. See [subagents → subagent state on disk](subagents.md#subagent-state-on-disk-the-fleet-journal). |
| `UNOWN_SUBAGENT_MODEL` | unset | Override `PI_MODEL_ID` for **every** subagent the `task` tool spawns — route all subagents to a cheaper/local model in one line. A per-agent `model` field still wins; the `--model` flag sets the model for one whole session. See [subagents → per-agent routing](subagents.md#per-agent-routing). |
| `UNOWN_SUBAGENT_TIMEOUT_MS` | `300000` | Session-wide wall-clock budget for one **synchronous** subagent spawn. Human durations parse (`10m`, `90s`); values clamp to 30s–30min, junk falls back to the default. A per-agent `timeoutMs` frontmatter field always wins (the `browser` builtin ships 600000). See [subagents → frontmatter contract](subagents.md#authoring-custom-agents). |
| `UNOWN_SUBAGENT_MAX_TURNS` | unset | Session-wide cap on **completed model turns** for one subagent spawn (sync + async fleet lanes), routed to the child as `--max-turns`; a turn is ONE model call. The runaway-fan-out guard: positive integers clamp to 1–500; junk or unset = no turn cap (the wall-clock timeout is the only bound). A per-agent `maxTurns` frontmatter field always wins. See [subagents → frontmatter contract](subagents.md#authoring-custom-agents). |
| `UNOWN_DELEGATION_LEVEL` | `standard` | Delegation policy for subagents: `never` / `rarely` / `standard` / `aggressive`. Shapes the one-sentence delegation instruction in the advertised-subagents block; `never` withdraws the catalog entirely (the `task` tool still works when invoked explicitly). See [subagents → the advertised catalog](subagents.md#the-advertised-catalog). |
| `UNOWN_MCP_SERVERS` | unset | Comma-separated whitelist of MCP server names to load — empty means **load none**, unset means load all. Set by the `--mcp-servers` flag before the session starts (both for whole-session routing and per-subagent frontmatter); the MCP extension filters the merged user+project config accordingly. |
| `UNOWN_NO_AGENTS_MD` | unset | `1` skips AGENTS.md / per-tier memory injection into the session's system prompt (set by the `--no-agents-md` flag; your own `AGENTS.md`/`CLAUDE.md` chain still appends). |
| `UNOWN_AUTOMATION` | unset | Set to `1` by the engine's scheduler on every [automation](usage.md#routines-unown-routines) run: hides the automation mutation tools inside the unattended session (an automation cannot schedule automations; subagents inherit the flag). You normally never set it by hand. |
| `UNOWN_LSP_MAX_SYNC_BYTES` | `4194304` | Files larger than this skip LSP document sync (didOpen/didChange) — the server cannot help on huge files; logged once per file. |
| `UNOWN_AUTO_VERIFY` | `1` | `0` disables the PostToolUse auto-verify gate: after every `write`/`edit` of a non-doc file, the project's own check command (package.json `typecheck` script, else `lint`; Makefile/pyproject fallbacks) runs and a failure is fed back into the tool result as an error — a broken edit is a failed edit. Silent on pass, cooldown-throttled, fail-open; the command passes the same bash-policy denylist the bash tool answers to. See [BEHAVIOR: verify-first defaults](BEHAVIOR.md#verify-first-defaults-2026-10-22). |
| `UNOWN_AUTO_VERIFY_TIMEOUT_MS` | `120000` | Per-check timeout for the auto-verify fast lane. |
| `UNOWN_AUTO_VERIFY_COOLDOWN_MS` | `20000` | Cooldown between auto-verify runs (an edit burst triggers one check, not one per file; `0` = every eligible edit). |
| `UNOWN_AUTO_TEST` | unset | `1` opts the project's TEST command into the same PostToolUse loop (aider's `--auto-test` semantics — off by default because test suites can mutate state and hit the network). |
| `UNOWN_AUTO_TEST_TIMEOUT_MS` | `300000` | Per-run timeout for the opt-in auto-test lane. |
| `UNOWN_AUTO_TEST_COOLDOWN_MS` | `60000` | Cooldown between auto-test runs. |
| `UNOWN_TRUST_PROJECT_CONFIG` | unset | `1`/`true` bypasses the project-config trust gate — `.unown/mcp.json`, `.unown/lsp.json`, `.unown/permissions.json` and `.unown/hooks.json` load without approval (CI/headless). Any other value keeps the gate on; approve interactively with `/mcp trust`, `/lsp trust`, `/permissions trust` or `/hooks trust`. |
| `UNOWN_STATE_WARN_BYTES` | `536870912` | `unown doctor`'s unown-state check warns when the project's `.unown/` runtime state (checkpoints + receipts + reviews) exceeds this. |
| `UNOWN_NO_SPLASH` | unset | `1` (any value but `0`/empty) never plays the [TUI startup mark](usage.md#the-startup-mark-2026-10-24). The mark is already suppressed by the `quietStartup` setting, by `NO_COLOR`, and in every non-TUI mode; this switch is what the TUI capture lane uses for a byte-stable first frame. |
| `UNOWN_WEB_SEARCH` | `1` | `0` disables the `web_search` tool. |
| `UNOWN_WEBFETCH` | `1` | `0` disables the `webfetch` tool. |
| `UNOWN_WEB_SEARCH_PROVIDER` | auto | Explicit provider id or comma-separated chain (e.g. `tavily,duckduckgo`); unset = keyed providers first, then the keyless chain. |
| `UNOWN_WEB_SEARCH_TIMEOUT_MS` | `20000` | Per-provider search timeout. |
| `UNOWN_WEB_SEARCH_MAX_RESULTS` | `8` | Default result cap per search (max 20; the tool's `max_results` parameter overrides per call). |
| `UNOWN_WEBFETCH_TIMEOUT_MS` | `30000` | Per-request timeout for `webfetch` (and the `fetch_url` alias). |
| `UNOWN_WEBFETCH_MAX_CHARS` | `20000` | Default returned-character cap (clamped 500–200000; the tool's `max_chars` parameter overrides per call). |
| `UNOWN_WEBFETCH_ROBOTS` | on | `0` disables robots.txt honoring in `webfetch`/`fetch_url`. |
| `UNOWN_WEBFETCH_ALLOW_PRIVATE` | unset | `1` allows `webfetch` to reach private/LAN hosts and non-standard ports (internal docs mirrors; the http(s)-only check always applies). |
| `UNOWN_WEB_CACHE` | `1` | `0` disables the [web results store](usage.md#web-search--webfetch) — the persistent cache behind `web_search`/`webfetch`/`fetch_url`. Every web call then goes upstream. |
| `UNOWN_WEB_CACHE_DIR` | `$UNOWN_HOME/cache/web` | Where the web results store lives (relocate to keep it off a synced home, e.g. a per-machine tmpfs path). |
| `UNOWN_WEB_SEARCH_CACHE_TTL_MS` | `3600000` | How long a stored `web_search` result set stays fresh (60 min; hit-rate/byte-cap surfaces: `unown webcache`). |
| `UNOWN_WEBFETCH_CACHE_TTL_MS` | `1800000` | Heuristic freshness for fetched pages when the origin sends no Cache-Control (30 min; an origin `max-age`/`Expires` wins, capped at 24 h). |
| `UNOWN_WEB_SEARCH_STALE_MS` | `86400000` | Stale-if-error window for search results — after TTL and within this window, the last good answer serves (flagged as stale) when every provider attempt fails. |
| `UNOWN_WEBFETCH_STALE_MS` | `604800000` | Stale-if-error window for fetched pages (7 d, always flagged). |
| `UNOWN_WEB_CACHE_MAX_BYTES` | `268435456` | Byte cap of the web results store (256 MiB). LRU-pruned at the cap — least-recently-used entries evict first (recency is tracked in RAM; `unown webcache sweep` runs the pass on demand). |
| `UNOWN_WEB_CACHE_INDEX_MS` | `60000` | Max age of the store's in-memory index before stats/eviction rescan the disk. `0` = exact mode (rescan per call — what the TUI dashboard's counts were before the perf layer); counts between rebuilds are per-process approximations, labeled as such in `unown webcache stats` and the dashboard's Web Cache screen. |
| `UNOWN_WEB_CACHE_MEMO` | `1` | `0` disables the hot-entry memo layer (repeat hits then always re-read + re-verify the disk entry). |
| `UNOWN_WEB_CACHE_MEMO_ENTRIES` / `UNOWN_WEB_CACHE_MEMO_BYTES` / `UNOWN_WEB_CACHE_MEMO_MS` | `500` / `52428800` / `180000` | Hot-entry memo budget: entry count, bytes (50 MiB) and freshness clock (3 min) — cacache's own memoization shape. |
| `UNOWN_WEB_CACHE_DURABLE` | unset | `1` restores double-fsync (file + directory) cache writes. Default is the cacache model — tmp+rename without fsync: a lost cache entry is a refetch, and a power-loss-torn entry is caught by the payload checksum. |
| `UNOWN_WEB_CACHE_SWR` | `1` | `0` disables stale-while-revalidate serving (a stale answer then blocks on the provider again; stale-if-error still applies on failure). |
| `UNOWN_WEB_CACHE_SWR_MS` | entry's stale window | Bounds how far past TTL a stale answer may serve instantly (`· stale — refreshing in background`) while a background refresh restores freshness. |
| `UNOWN_BROWSER_PATH` | auto | Explicit Chromium-family executable for the `browser` tool; wins over discovery (which tries system Chrome/Chromium/Edge per-OS, then the Playwright cache). |
| `UNOWN_BROWSER_CDP` | unset | Attach the `browser` tool to a running browser (`ws://…`, `http://host:port`, or `host:port`) instead of launching one — the real, already-logged-in Chrome. Attach never kills it. |
| `UNOWN_BROWSER_HEADLESS` | `1` | `0` runs the `browser` tool's Chromium headed, so you can watch it work. |
| `UNOWN_BROWSER_PROFILE` | `$UNOWN_HOME/browser/profile` | Persistent browser profile — logins survive between runs; a locked profile falls back to a temp one instead of fighting over it. |
| `UNOWN_BROWSER_BLOCK` | unset | Comma-separated host-glob deny list (`*.example.com,internal.corp`) checked before every navigation; localhost stays allowed by default (driving the dev server is a first-class use case). |
| `UNOWN_BROWSER_TIMEOUT_MS` | `30000` | Navigation timeout. |
| `UNOWN_BROWSER_SETTLE_MS` | `300` | Post-action quiet settle. |
| `UNOWN_BROWSER_SNAPSHOT_MAX` | `400` | Max elements per a11y snapshot before truncation. |
| `UNOWN_BROWSER_SNAPSHOT_MAX_CHARS` | `60000` | Max snapshot characters returned to the model. |
| `UNOWN_BROWSER_STEALTH` | `0` | `1` runs every `browser` session in stealth mode — no CDP detection signal (the Runtime domain is never enabled), a coherent fingerprint applied by the browser itself, humanized input, headless-shell binaries excluded from discovery. Per-session: `browser start stealth=true`. |
| `UNOWN_BROWSER_OS` | `windows` | Stealth-mode claimed OS identity (`windows` / `macos` / `linux`), each with a coherent UA / client-hints / screen / locale / timezone set. |
| `UNOWN_BROWSER_USER_AGENT` | per identity | Explicit user-agent override in stealth mode; the rest of the identity still applies. |
| `UNOWN_BROWSER_LOCALE` | `en-US` | Locale (and Accept-Language) in stealth mode. |
| `UNOWN_BROWSER_TIMEZONE` | `America/New_York` | IANA timezone id in stealth mode (validated at resolve time; invalid ids fall back to the default with no silent no-op). |
| `UNOWN_BROWSER_SCREEN` | `1920x1080` | Claimed screen size in stealth mode (`WxH`) — applied via `screenWidth`/`screenHeight`, killing the 800x600 headless default. |
| `UNOWN_BROWSER_HUMANIZE` | `1` in stealth | `0` disables humanized mouse paths and per-character typing. |
| `UNOWN_BROWSER_HUMANIZE_SEED` | random | Fixed PRNG seed for reproducible humanized-input paths (tests pin it). |
| `UNOWN_BROWSER_PROXY` | unset | Proxy for all site traffic — `http://host:port`, `socks5://host:port`, or bare `host:port` (becomes `--proxy-server`); loopback is bypassed so the dev server never goes through it. Credential-bearing proxies need a local relay (Chrome flags cannot carry auth). |
| `UNOWN_CAPTCHA_SOLVER` | auto | `2captcha` / `capsolver` / `none`. Default picks whichever service key is set (2captcha first — broadest type coverage). |
| `UNOWN_CAPTCHA_2CAPTCHA_KEY` | unset | 2Captcha API key for the `browser captcha solve` service tier. |
| `UNOWN_CAPTCHA_CAPSOLVER_KEY` | unset | CapSolver API key for the same. |
| `UNOWN_CAPTCHA_AUTO` | `0` | `1` auto-solves challenges detected right after `navigate` (detection always runs; this gates the paid/LLM tiers). |
| `UNOWN_CAPTCHA_VISION` | `1` with a key | `0` disables the vision-OCR tier for image captchas. |
| `UNOWN_VISION_BASE_URL` | `https://apihub.agnes-ai.com/v1` | OpenAI-compatible vision endpoint for image-captcha OCR. |
| `UNOWN_VISION_API_KEY` | falls back to `AGNES_API_KEY` | Key for the vision endpoint. |
| `UNOWN_VISION_MODEL` | `agnes-3.0-flash` | Vision model that reads image captchas. |
| `UNOWN_SEARXNG_URL` | unset | SearXNG instance URL for the `searxng` provider (self-hosted with `formats: [html, json]` — see `scripts/searxng-test/settings.yml`). |
| `UNOWN_STACKEXCHANGE_KEY` | unset | Optional free stackapps.com key; lifts the keyless 300 req/day per-IP limit to 10000/day. |
| `UNOWN_DASHSCOPE_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI-compatible base for the `dashscope` (Qwen enable_search) provider; intl users set `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`. |
| `UNOWN_DASHSCOPE_MODEL` | `qwen-plus` | Model for the `dashscope` provider. |
| `AGNES_API_KEY` | unset | The Agnes AI provider key (`https://apihub.agnes-ai.com/v1`, `agnes-3.0-flash`) for direct (non-bridge) use — consumed by the `agnes` preset in `unown setup` / `unown providers add --provider agnes --key-env AGNES_API_KEY`, which stores a `$AGNES_API_KEY` reference in `auth.json` (0600). Also usable as the bridge's failover lane: `BRIDGE_FALLBACK_URL=https://apihub.agnes-ai.com/v1` + `BRIDGE_FALLBACK_MODEL=agnes-3.0-flash` (see [providers](providers.md)). |
| `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` / `SERPER_API_KEY` / `EXA_API_KEY` / `PERPLEXITY_API_KEY` / `JINA_API_KEY` / `ZHIPU_API_KEY` / `DASHSCOPE_API_KEY` / `KAGI_API_KEY` / `SERPAPI_API_KEY` / `FIRECRAWL_API_KEY` | unset | Paid web-search provider keys — any that are set join the search chain ahead of the keyless fallbacks (see [usage: web tools](usage.md#web-search--webfetch)). `DASHSCOPE_API_KEY` accepts **standard keys only** (`sk-…`): coding-plan keys (`sk-sp-…`) are refused up front with an actionable note (the coding endpoints silently ignore `enable_search`, the standard endpoints reject them — verified live 2026-10-19); the chain then cascades to the next provider. |
| `GITHUB_TOKEN` | unset | Optional token for the keyless `github` search provider (lifts the 10 req/min per-IP search cap; never required). |
| `NO_UPDATE_NOTIFIER` | unset | Any value silences the startup update notice, the TUI footer chip and the background check (ecosystem-standard name). Manual `unown update` still works — see [updating](updating.md). |
| `UNOWN_DISABLE_AUTOUPDATE` | unset | `1` — same as `NO_UPDATE_NOTIFIER`, the Unown-native spelling. |
| `DO_NOT_TRACK` | unset | `1` — the standard nonessential-traffic opt-out; suppresses the background update check. |
| `UNOWN_DISABLE_UPDATES` | unset | `1` blocks **all** update paths (`unown update`, `--check`, background check) — the org/CI kill switch. |
| `UNOWN_RELEASES_BASE_URL` | `https://github.com/kanishka-namdeo/Unown/releases` | Release feed base for the binary installer/updater and the manifest update check; point it at a mirror for air-gapped installs. The mirror must carry `release.json` (and `version.txt`/`sha256sums.txt` for legacy releases). The manifest is not signed, so the mirror is trusted; every archive is still checked against the manifest's exact size and SHA-256 before activation. `https://` is expected; the installer accepts `http://` only for an explicit mirror/test setup and warns. |
| `UNOWN_INSTALL_ROOT` | POSIX: `$XDG_DATA_HOME/unown`, else `~/.local/share/unown`; Windows: `%LOCALAPPDATA%\unown` | Root of a binary install (`versions/<version>/unown[.exe]`). The binary shim sets it; `unown update`/`uninstall` use it to recognize the install. |
| `UNOWN_BIN_DIR` | POSIX: `~/.local/bin`; Windows: `%USERPROFILE%\.local\bin` | Directory the installers and `scripts/link.ts` write the `unown` shim(s) into. |
| `UNOWN_ALLOW_EXPERIMENTAL` | unset | `1` allows the un-smoked windows-arm64 binary archive (the installer's `-Experimental` / `--experimental` sets the same intent for its run). |
| `UNOWN_INSTALL_ALLOW_ROOT` | unset | `1` lets the one-line installer run as root/Administrator (it refuses by default). |
| `PI_DREAM_GATE` | on | Dream canary gate: re-run the last-passing benchmark task under freshly dreamed project memory and roll the dream back if it fails. `0` disables. Read by the engine. |
| `PI_JOB_TIMEOUT_MS` | `1200000` | Engine job watchdog: any router job exceeding this is aborted, its runs marked `error`, and the busy mutex released (floor 60s). Read by the engine. |
| `PI_DREAM_CHECK_COOLDOWN_MS` | `600000` | At most one dream-check per window, however many `run:finished` events arrive; `0` opts out. Read by the engine. |
| `PI_ENGINE_MAX_CALLS_HOUR` | `60` | Budget governor: learning jobs skip while the engine made more LLM calls than this in the last hour (`0` = unlimited). Read by the engine. |
| `PI_ENGINE_MAX_TOKENS_HOUR` | `200000` | Budget governor: hourly token ceiling (ledger + run tokens; `0` = unlimited). Read by the engine. |
| `PI_ENGINE_MAX_TOKENS_DAY` | `2000000` | Budget governor: daily token ceiling (`0` = unlimited). Read by the engine. |
| `PI_LLM_BREAKER_THRESHOLD` | `3` | Upstream circuit breaker: consecutive engine LLM failures before the backoff window opens. Read by the engine. |
| `PI_LLM_BACKOFF_BASE_MS` | `30000` | Upstream circuit breaker: base backoff (x4 growth, full jitter, 15-min cap). Read by the engine. |
| `PI_PRINT_STALL_MS` | `180000` | Print-mode stall deadline: a session silent for this long force-exits (floor 10s; any session event re-arms it). Read by the terminal agent. |
| `PI_PRINT_EXIT_GRACE_MS` | `15000` | Print-mode hard-exit grace after the agent's final turn: once the answer is written the process leaves after this grace, even if idle keep-alive sockets hold the loop (floor 2s; nothing re-arms it). Read by the terminal agent. |
| `PI_PRINT_STDIN_IDLE_MS` | `500` | Print-mode piped-stdin idle window: stdin is read only while data actively flows; this much silence (after the last chunk) ends the read, detaches every listener and pauses the stream — an open idle stdin (harness/editor driving `unown -p`) is never consumed and cannot hold the event loop. `0` still reads whatever has already arrived. Read by the terminal agent. |
| `PI_PRINT_STDIN_MAX_BYTES` | `1048576` | Print-mode piped-stdin byte cap: an endless pipe (`yes \| unown -p …`) stops draining at this many bytes instead of reading forever. Read by the terminal agent. |
| `UNOWN_MAX_MINTED_TASKS` | `8` | Cap on ACTIVE minted tasks before the engine's task-mint job skips authoring new curriculum variants (minting resumes as tasks are archived/graduated). Read by the engine. |
| `UNOWN_AUTO_COMPACT_THRESHOLD` | `85` | Auto-compact curve, ENGINE runs: percent of the (reserve-aware) context window at which compaction auto-triggers (0–100; a warn receipt starts at a fixed 70%). Read by the engine's runner (`auto-compact.ts`). |
| `UNOWN_AUTO_COMPACT_HARD_LIMIT` | `95` | Auto-compact curve, ENGINE runs: percent at which the next model request is hard-blocked and the session aborted (0–100) — the session must be compacted or restarted. Read by the engine's runner. |
| `UNOWN_TERMINAL_AUTO_COMPACT` | `1` | Terminal mid-exchange auto-compact (the 2026-10-27 long-run round): print-mode runs compact at the same curve's 85% mark — evaluated against the RESERVE-AWARE window (`window − compaction.reserveTokens`, the zone where pi starts clamping the output budget) — and continue on the compacted context with an honest continuation prompt in the same session (cap 8 continuations, then warn-only; TUI sessions are warn-only by design — the user is present). `0` disables the terminal extension entirely. Read by the terminal agent (`terminal-auto-compact.ts`). |
| `UNOWN_IDLE_COMPACT_MINUTES` | `45` | Terminal-session idle compaction (Claude Code v2.1.299 parity): idle minutes at/above which a heavy session is compacted before the next prompt ships; requires usage ≥ `UNOWN_IDLE_COMPACT_MIN_USAGE`. `0` disables idle compaction. Read by the terminal agent (`auto-compact.ts` `shouldIdleCompact`). |
| `UNOWN_IDLE_COMPACT_MIN_USAGE` | `50` | Idle-compaction usage floor: percent of the context window a session must be using before idle compaction may fire (a light session never compacts — it would destroy cheap context for no overflow win). Read by the terminal agent. |
| `UNOWN_TURN_METER` | `1` | The per-turn footer chip (`turn 3.4s · ctx 62% · in 45.2k …`) on every interactive turn_end; `0` hides it. Read by the terminal agent (`turn-meter.ts`). |
| `UNOWN_RECAP_IDLE_MINUTES` | `3` | Auto-brief threshold (the observability round): idle minutes at/above which the next prompt gets the deterministic mission brief — the 60-second returning-user answer (objective / happened / changed / why-pointer / state / conf / risks / learned / metrics / remains); `0` disables the auto brief (`/brief` on demand always works). Read by the terminal agent (`recap.ts` + `mission.ts`). |
| `UNOWN_MISSION_PANEL` | `1` | The observability round's ambient mission panel above the editor (objective from the active `/goal`, else the `/mission` pin, else the session title; derived progress; deterministic confidence from tool errors / verify failures / denials; composed risks; fresh learning events) plus the `conf` / `health` / `feed` footer chips; `0` hides the panel and chips (`/brief`, `/recovery`, `/feed` still answer). Read by the terminal agent (`mission.ts` + `recovery.ts` + `learning-feed.ts`). |
| `PROGRAM_STATUS` | unset | OSC 7501 program-status opt-out (the spec-wide name): `0` stops the session lifecycle emitting terminal-status reports. `UNOWN_OSC7501=0` is the Unown-native alias. Emission is TTY-only regardless. |
| `PI_PRINT_STALL_PROGRESS` | `1` | Print-mode stall-progress lines: one stderr line at 50/75/90% of the stall budget when no session events arrive (silence is never the only signal); `0` silences. Read by the terminal agent. |

### OS-level sandbox (bubblewrap)

| Variable | Default | Meaning |
|----------|---------|---------|
| `UNOWN_OS_SANDBOX` | `1` | Runs every engine sandbox command (verify scripts + the agent's bash calls) under bubblewrap: read-only root filesystem, private `/home` `/tmp` `/run`, network namespace killed. `0` disables OS isolation (falls back to the in-process path jail). |
| `UNOWN_SANDBOX_REQUIRED` | unset | `1` (or `true`) is the fail-closed knob (2026-10-22 hardening): engine runs — verify/exec and the agent bash tool — **refuse to start** with the typed `SandboxRequiredError` when the OS sandbox is unavailable (bwrap missing/broken on Linux, `sandbox-exec` missing on macOS, any native-Windows host, or the `UNOWN_OS_SANDBOX=0` kill-switch) instead of degrading to the path jail. The message names the backend this platform expected, the kill-switch clash, and the native-Windows answer (WSL2 or unset). Unset/`0`: the documented transparent fallback, unchanged. |
| `UNOWN_SANDBOX_NET` | `0` | `1` keeps the network namespace shared for sandboxed commands — not recommended: sandboxed code could then reach the LLM bridge and the LAN. |
| `UNOWN_BWRAP` | vendored binary, then `PATH` | Explicit path to a bwrap binary. Defaults to the vendored copy at `pi-repo/packages/self-learning/native/bin/bwrap`, then `/usr/bin/bwrap`, `/usr/local/bin/bwrap`. |
| `UNOWN_SANDBOX_EXEC` | `/usr/bin/sandbox-exec` | macOS only: explicit path to the seatbelt `sandbox-exec` binary (darwin is gated explicitly — other hosts never resolve a seatbelt path and fall back to the in-process path jail). |

Quick sanity check of the chat path once the stack is up:

```bash
curl -s http://127.0.0.1:3031/health   # → upstream.ok, upstreamKeyIsSet, authRequired, models
curl -s http://127.0.0.1:3030/api/overview
```

All env knobs shown above are also documented (commented) in `.env.example` — the services read the whole file, not just the uncommented keys.

## How `.env` gets loaded

Two services run, each on its own port, each reading its own slice of the environment (mission control is not a service: `unown dashboard` is a TUI client of the engine, started when you want it):

| Service | Default port | Health check | Reads |
|---------|--------------|--------------|-------|
| llm-bridge | `3031` (`BRIDGE_PORT`) | `GET /health` | all `BRIDGE_*` |
| self-learning engine | `3030` (`PI_AGENT_PORT`) | `GET /api/overview` | `PI_*`, `UNOWN_OS_SANDBOX` / `UNOWN_SANDBOX_NET` / `UNOWN_BWRAP`, `PI_DREAM_GATE` |

The `unown` CLI (a third process, running wherever you are) reads `UNOWN_HOME`, `UNOWN_ENGINE_URL`, `UNOWN_STRICT_HOOKS` and `UNOWN_NO_PREFLIGHT` — and its durable model config from `~/.unown/agent/`.

The variables reach those processes through three different mechanisms, and one common trap:

1. **`scripts/start.ts` parses `.env`** (same `set -a; . ./.env; set +a` semantics) before spawning the bridge and engine — so both services inherit every variable (bun does not read the repo-root `.env` from a mini-services cwd, so the launcher exports it into each child).
2. **bun auto-loads `.env` from the cwd of each service.** `mini-services/llm-bridge/.env` and `mini-services/agent-service/.env` are symlinks to the repo root `.env`, so running a service by hand from its own directory (`cd mini-services/llm-bridge && bun index.ts`) still picks the file up.
3. **The `unown` CLI does *not* see the repo's `.env` when you run it from another project.** bun loads `.env` from the process cwd — your project, not the unown repo — and the CLI's durable config comes from `~/.unown/agent/` (see below). If you want `UNOWN_ENGINE_URL`, `UNOWN_STRICT_HOOKS` or `UNOWN_HOME` to apply to terminal sessions everywhere, export them in your shell profile. The one exception: run `unown setup` from the unown repo root and it *will* see `.env` (handy for the `BRIDGE_API_KEY` coupling below).

## State and files

Where everything lives — all of it deletable, none of it required to pre-exist:

```text
~/.unown/                        terminal-agent state (UNOWN_HOME)
  agent/
    models.json                  provider + model registry — what unown setup writes
    auth.json                    API keys, file mode 0600
    settings.json                defaultProvider + defaultModel + tuiMode (interface layout)
    ui-panels.json               split-view startup defaults — written by /split-save only
    addons.json                  TUI addon config — ask_user_question / todo / advisor
                                 (see below; safe to hand-edit, never re-clobbered)
    sessions/                    terminal session trees
    skills/                      starter skills + your global skills
    agents/                      your global subagent definitions (*.md)
    commands/                    your global custom slash commands (*.md)
    mcp.json / permissions.json / hooks.json   your global MCP servers, permission rules, hook handlers
    keybindings.json             keybinding overrides (/hotkeys shows the defaults)
  recipes/                       your global recipes (*.md) — every project
  memory/
    policy.md                    tier 0 — optional, you author it
    user.md                      tier 2 — global preferences
  update-check.json              release-feed cache (schema 2) — 24h TTL, remote URL stored credential-free;
                                 a legacy schema-1 cache is shown as stale and refreshed
  update-prefs.json              skip-this-version, snooze window and notice history — survives cache deletion
  update-check.lock / update-apply.lock   single-flight check/apply locks (reclaimed after 5/30 minutes)
  update-state.json              last `unown update` record (from/to/fromSha/ok, mode/platform, rollback fields) — what --rollback restores
  install.json                   the ACTIVE install: schema 1, mode (checkout|binary), version, platform,
                                 root/bin/shim, previousVersion — written by link.ts, the binary installer
                                 and unown update; drives mode-aware update/uninstall
  migrations.json                user-state schema version + migration history (forward-only; see [updating](updating.md))
  notes/
    outbox/                      notes queued while the engine was down
    done/                        ingested notes (archive)
  cache/web/                     the web results store — persistent web_search + webfetch
                                 results (see below; safe to delete at any time)

~/.config/unown/                 behavior gate files (see [Behavior gate files](#behavior-gate-files))
  adversary.md                   adversary-mode gate — existence activates the LLM reviewer
  injection-scanner.json         scanner risk levels + pattern ID filters

<project>/.unown/
  memory/project.md              tier 1 — commit this one
  memory/local.md                tier 3 — gitignored by the scaffold
  .gitignore                     ignores local.md / *.local.md
  skills/<name>/SKILL.md         AutoDream-minted + your project skills
  agents/*.md                    project-level subagent definitions
  commands/*.md                  project custom slash commands — commit these
  recipes/*.md                   project recipes — project wins on name collision
  mcp.json / lsp.json / permissions.json / hooks.json   project-scoped configs — trust-gated, refuse-first
  wiki/                          generated repo wiki (unown wiki generate)
  sessions/                      session exports (unown sessions export)

unown repo (runtime state, gitignored)
  data/self-learning/            engine data: sandboxes, sessions, memory (PI_SELFLEARNING_DATA)
  data/self-learning/mem0/       the memory platform's SQLite: vector_store.db + history.db (PI_MEM0_DIR)
  db/selflearning.db             engine SQLite: runs, cycles, dreams, versions, skills (PI_SELFLEARNING_DB)
  .run/                          pidfiles + logs for the two services (bridge.log, engine.log)
```

**The web results store** (`~/.unown/cache/web/`, the [usage](usage.md#web-search--webfetch) section has the behavior): content-addressed cache entries at `entries/<xx>/<sha256>.json` plus an append-only `events.jsonl` observability feed (provider/tool tallies, hit-rate — never secrets). It is user-scoped and shared across projects by design (the public web is not project-specific), created `0700`, pruned by LRU at `UNOWN_WEB_CACHE_MAX_BYTES` (default 256 MiB), and safe to delete at any time — `unown webcache stats | clear | sweep` inspects or manages it.

What is safe to delete and what that costs is covered in [troubleshooting](troubleshooting.md#resetting-cleanly).

## Agent config files (models.json / auth.json / settings.json / ui-panels.json)

`unown setup` writes three files under `~/.unown/agent/` (the fourth, `ui-panels.json`, is written only by `/split-save` — see below):

| File | Written how | Safe to hand-edit? |
|------|-------------|--------------------|
| `models.json` | full rewrite on setup (setup is an explicit reconfigure action) | yes — point it at any OpenAI-compatible endpoint; the first-run bootstrap never clobbers an existing file |
| `auth.json` | merges your provider key, mode 0600 | yes — secrets only; keep it out of any repo |
| `settings.json` | merges `defaultProvider` + `defaultModel`; the first-run seed also pins the theme and `tuiMode` | yes — pins the model sessions start on (switch mid-session with `/model`) and the interface layout (see below) |

The first run of `unown` bootstraps the same trio with bridge defaults (`zai-bridge` / `kimi-k2.5` / `http://127.0.0.1:3031/v1`) and seeds the starter skills — so the out-of-the-box path works as soon as the stack and `BRIDGE_UPSTREAM_KEY` are in place.

**`tuiMode` — the interface layout.** `settings.json` also carries `"tuiMode"`: `regular` (scrollback) or `fullscreen` (alt-screen). New installs seed `fullscreen` — the layout engine the [split view](split-view.md) band and files dock are built on; existing installs keep whatever they saved. Switch live with `/settings` (the "TUI mode" entry) or edit the file by hand (picked up on the next launch).

**`ui-panels.json` — split-view startup defaults.** A fourth file in the same directory, never written by setup: a template of startup defaults for the [split view](split-view.md) panels. The toggles themselves stay session-local — only `/split-save` writes the file, so concurrent unown windows never clobber each other's layout. Keys, ranges and defaults: [split view: the config file](split-view.md#the-config-file-ui-panelsjson).

**The `BRIDGE_API_KEY` coupling.** The bridge-mode key stored in `models.json` is read from `BRIDGE_API_KEY` (falling back to the `bridge-local` placeholder) *only when the file is created*. If you later set `BRIDGE_API_KEY` in the repo's `.env`, the bridge now demands a bearer token — but the terminal agent still sends the old placeholder, and every chat dies with `unauthorized: missing or invalid bearer token (BRIDGE_API_KEY is set)`. Fix: re-run `unown setup` **from the unown repo root** (where bun loads `.env`, so the wizard sees the key), or hand-edit the `apiKey` field in `~/.unown/agent/models.json` to match. Details in [troubleshooting](troubleshooting.md).

## Project settings (.unown/settings.json, 2026-10-24)

The per-project session defaults layer — Claude Code's committed
`.claude/settings.json` / Gemini CLI's workspace `.gemini/settings.json`
parity. A repo can pin the model its agents should use, the effort level,
the default permission mode and additional working directories without
every contributor editing `~/.unown`:

```json
{
  "version": 1,
  "model": "agnes-2.5-flash",
  "provider": "agnes",
  "effort": "high",
  "permissionMode": "acceptEdits",
  "addDirs": ["../shared-config"]
}
```

- All keys optional; unknown keys and wrong shapes warn and are ignored — a
  malformed file never blocks the boot.
- **Trust-gated** exactly like `.unown/mcp.json` / `.unown/lsp.json` /
  `.unown/permissions.json` (a cloned repo is attacker-controlled): an
  untrusted file's keys are ignored with one boot notice; approve it with
  `/project-settings trust` in a session (or `UNOWN_TRUST_PROJECT_CONFIG=1`
  for CI). Effective from the next session in that project.
- Precedence: **CLI flags > project settings > user defaults** — a field the
  command line already set is never overwritten.
- `/project-settings` (in-session) shows the live state — file, trust,
  effective keys.
- `addDirs` entries resolve relative to the project root and grant the same
  session-scoped write access as `--add-dir` (see
  [permissions → additional working directories](permissions.md#additional-working-directories---add-dir--add-dir-2026-10-24)).

## Addons config (addons.json)

The TUI addons — `ask_user_question`, `todo`, `advisor` — keep every user-tunable knob in one JSON file, editable by hand or through the in-session `/addons` configurator. Full key-by-key semantics, defaults and the design contracts: [addons](addons.md).

- **Path**: `$UNOWN_HOME/agent/addons.json` (`~/.unown/agent/addons.json` by default), next to `settings.json`. Seeded on first run **only when absent** — hand edits always survive reboots and configurator writes; delete the file to reset to defaults (it re-seeds on the next boot).
- **Writes**: `/addons` and `/advisor on|off` persist through it — atomic (temp file + rename), read-modify-write over the fresh disk state.
- **Parsing**: unknown keys dropped, malformed values reset to their defaults, unparsable JSON falls back to the default config wholesale with a one-line stderr warning — a bad file degrades, never breaks session boot.

| Section | Keys (default) |
|---|---|
| `askUserQuestion` | `enabled` (`true`) · `collapseKey` (`"ctrl+]"`) · `guidance.{description, promptSnippet, promptGuidelines}` (LLM-facing copy overrides) |
| `todo` | `enabled` (`true`) · `maxWidgetLines` (`12`, clamped 3–64 — the one **hot** key, re-read per render) · `collapseKey` (`"ctrl+shift+t"`) · `guidance.*` |
| `advisor` | `enabled` (`false`) · `model` (unset = session model; `"provider/model"` or bare id) · `thinkingLevel` (`medium`) · `reviewMode` (`turn`) · `reviewInterval` (`1`) · `maxNotesPerUpdate` (`4`, 1–32) · `immuneTurns` (`3`) · `continueSeverity` (`concern` — parsed, not yet consumed by the runtime) · `instructions` (unset) · `showStatus` (`true`) |

Everything except `todo.maxWidgetLines` binds when the extension registers — `/reload` applies edits.

## Behavior gate files

Three files switch whole guard behaviors on and off. All are user-authored, none is required to exist, and the two `~/.config/unown/` ones resolve through `UNOWN_HOME` the same way (`${UNOWN_HOME || ~/.config/unown}`).

| File | What it gates | How to switch it |
|---|---|---|
| `~/.config/unown/adversary.md` | **Adversary mode** — the file-gated PreToolUse LLM reviewer over `bash`/`powershell`/`write`/`edit` calls | **Existence is the switch**: with the file present, every qualifying call is LLM-reviewed (the file's `## Disallow` / `## Allow` / `## Notes` sections are the policy hints; secrets are redacted before the call; ambiguous replies allow; LLM errors fail-open). The reviewer runs in engine sandbox runs **and** interactive terminal sessions. Delete the file to turn it off — there is no separate enable env var (the `enabled` kill-switch is a caller-level config, not environment-wired). See [BEHAVIOR: adversary mode](BEHAVIOR.md#adversary-mode-milestone-14--2026-10-19). |
| `~/.config/unown/injection-scanner.json` | The **106-pattern prompt-injection scanner** (engine-run PreToolUse) — `enabled`, `blockOn` risk levels (default `critical`/`high`/`medium`; `low` never blocks), `excludePatternIds` / `includePatternIds`, and an optional `mlClassifier` block (stubbed, not yet wired). Missing file = defaults; loaded mtime-cached so edits apply without a restart | Env kill-switch `UNOWN_INJECTION_SCANNER=0`. Note the split: this is the **blocking** scanner that composes in engine runs — interactive sessions' live tool results are covered by the annotate-only injection shield (`UNOWN_INJECTION_SHIELD` above). See [BEHAVIOR: prompt-injection scanner](BEHAVIOR.md#prompt-injection-scanner-milestone-15--2026-10-19). |
| `.unown/hooks.json` + `~/.unown/agent/hooks.json` | **User-configurable hooks** — your own handlers on the thirteen session events, in five types (`command` / `http` / `mcp` / `prompt` / `agent`). When both exist, the project config wins per event name | The user file is always trusted; the **project file is trust-gated refuse-first** — an unapproved `.unown/hooks.json` contributes nothing until you run `/hooks trust` in a session (fingerprint-pinned, reloads live) or set `UNOWN_TRUST_PROJECT_CONFIG=1` for CI/headless. Handlers run in interactive sessions and engine runs alike, after the built-in policies, fail-open. Full event table + handler contract: [BEHAVIOR: user-configurable hooks](BEHAVIOR.md#user-configurable-hooks-milestone-1--2026-10-19). |

The same refuse-first trust gate covers the other project-scoped configs — `.unown/mcp.json`, `.unown/lsp.json`, `.unown/permissions.json` — each with its own approval command (`/mcp trust`, `/lsp trust`, `/permissions trust`).

### Formatters config (formatters.json, 2026-10-24)

Post-edit **auto-formatters** (OpenCode Formatters / aider auto-lint parity): after every successful `write`/`edit`, the first matching formatter runs on the file and the change is fed back to the agent as a non-error `[PostToolUse:formatter]` block — the agent sees the final on-disk form and can re-read if the reformat moved its anchors. Two scopes, the hooks.json precedent:

- `~/.unown/agent/formatters.json` — user scope, always trusted
- `.unown/formatters.json` — project scope, trust-gated refuse-first (`UNOWN_TRUST_PROJECT_CONFIG=1` bypasses for CI)

```json
{
  "version": 1,
  "formatters": [
    { "pattern": "**/*.ts",  "command": "prettier --write" },
    { "pattern": "**/*.go",  "command": "gofmt -w" },
    { "pattern": "**/*.py",  "command": "ruff format $FILE" }
  ]
}
```

Rules: first match wins (project rules replace user rules with the same pattern); patterns are the permissions layer's globs (a lone `*` never crosses `/`, a double-star does) matched against the project-relative path, the basename and the absolute path — a bare `*.ts` rule therefore covers nested files too; the file path is **appended** to the command unless the command contains the `$FILE` placeholder (full argument-order control); each run gets a 10s timeout (a wedged formatter never wedges the session). Everything is fail-open: a missing formatter, a timeout or a non-zero exit never breaks the edit — the first failure per command is reported once to the agent (`… formatters for this pattern are now silent for the session`) and the edit stands unformatted. A formatter that changes nothing stays silent (no noise on every clean write).

## Common setups

Three shapes cover almost everyone:

**1. The bundled stack (default).** Everything on one machine, chats routed through the bridge:

```bash
cp .env.example .env      # set BRIDGE_UPSTREAM_KEY
bun run agent:start       # bridge :3031 + engine :3030 (mission control: unown dashboard)
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

Notes flow there and show up in that engine's TUI dashboard (`unown dashboard` against the remote `UNOWN_ENGINE_URL`). One caveat: AutoDream writes a project's consolidated memory back to the recorded project path **on the engine's host** — so this works best when both sides share a filesystem (NFS home, or you simply run `unown` and the engine on the same box you SSH into). Put `BRIDGE_API_KEY` on the bridge and a TLS terminator in front of anything exposed beyond localhost (see [production notes](#production-notes)).

## Production notes

- **Run the engine without hot reload**: `cd mini-services/agent-service && bun index.ts`. The dev scripts use `bun --hot`, which is convenient but can detach in-flight cycles from the router mutex when engine sources change mid-run.
- **Put `BRIDGE_API_KEY` on the bridge** whenever it is reachable beyond localhost, and front the engine with the TLS terminator / reverse proxy of your choice.
- **The engine is single-tenant by design** (a busy-mutex serializes background work so the sandbox is never double-driven). Scale by running more engine instances against separate data dirs — one pair of `PI_SELFLEARNING_DATA` / `PI_SELFLEARNING_DB` per instance.
