# Troubleshooting

Symptom-first fixes for the unown stack: run `unown doctor` first, work the table, then check the logs. Covers the chat path (bridge, credentials, model config), the learning path (engine, notes) and the CLI itself.

Related pages: [usage](usage.md) · [providers](providers.md) · [Memory](memory.md) · [configuration](configuration.md)

- [Start here: unown doctor](#start-here-unown-doctor)
- [Symptoms and fixes](#symptoms-and-fixes)
  - [The chat path](#the-chat-path)
  - [The learning path](#the-learning-path)
  - [The CLI itself](#the-cli-itself)
  - [Windows](#windows)
- [Where the logs are](#where-the-logs-are)
- [Resetting cleanly](#resetting-cleanly)
- [Getting help](#getting-help)

## Start here: unown doctor

Run it in the project you are trying to use:

```bash
unown doctor
```

The exit code (1 on any ✗) makes it scriptable — `unown doctor && unown -p "ship it"` refuses to start a session on a known-broken chat path.

It checks the agent dir and `models.json`, the memory stack, the model endpoint (with a live probe), bridge specifics when the endpoint is the bundled bridge (upstream key, upstream health, default model routable), the OS sandbox, and engine health. Every line is one of:

| Mark | Meaning | Exit code |
|------|---------|-----------|
| `✓` | check passed | 0 |
| `✗` | **chat is broken** — fix these before anything else | 1 |
| `⚠` | learning features only — chat works fine without it | 0 |

The closing line says it outright: `✗ unown cannot chat yet — fix the ✗ items above` versus `✓ unown is ready to chat in <dir> (⚠ items affect learning features only)`. A missing `BRIDGE_UPSTREAM_KEY` is a ✗ (every chat would 401); an unreachable engine or a missing bubblewrap is a ⚠.

Item by item, this is what doctor looks at:

| Check | Level | What it verifies |
|-------|-------|------------------|
| `agent dir` | ✗ | `~/.unown/agent/` exists with a `models.json` |
| `models.json parses` / `model provider configured` | ✗ | the file is valid JSON with at least one provider |
| `project memory` / `user memory` | ✗ | the current project's `.unown/memory/project.md` and the global `user.md` exist (auto-created on demand) |
| `model endpoint reachable` | ✗ | live probe of the configured provider; distinguishes `credentials rejected (HTTP 401/403)` from plain unreachability |
| `bridge upstream key` | ✗ | (bridge provider only) `BRIDGE_UPSTREAM_KEY` is set — otherwise "chats will fail with 401" |
| `bridge upstream health` | ✗ | (bridge provider only) the upstream actually answers — check `BRIDGE_UPSTREAM_URL` |
| `default model routable` | ⚠ | (bridge provider only) your model id is in the bridge allow-list; unknown ids still work, they just route to the default |
| `OS sandbox (bubblewrap)` | ⚠ | bubblewrap is present; engine runs fall back to the path jail when it is not |
| `self-learning engine` | ⚠ | the engine answers `/api/overview` — notes and dreams, not chat |

Related behavior worth knowing: before every session the CLI pre-flights the model endpoint. In TUI mode a failure prints a warning and continues (pi's retries cover the window where you start the stack in another terminal); in print mode (`unown -p`) it exits non-zero with the same hint. `UNOWN_NO_PREFLIGHT=1` skips the check entirely.

Two more read-only diagnostics round it out:

- `unown models` — the providers configured in `~/.unown/agent/models.json`, plus a live list of what a local bridge serves right now (and a warning when your default model is not in that list).
- `unown memory` — the effective 4-tier stack for the current directory; a quick sanity check that `.unown/memory/project.md` is being read at all ([Memory](memory.md)).

## Symptoms and fixes

The stack has three failure domains and they rarely interact: the **chat path** (terminal agent → bridge → upstream; broken chats), the **learning path** (engine, notes, dreams; chat keeps working), and the **CLI itself**. Find your symptom's domain first.

### The chat path

```text
unown session ──► ~/.unown/agent/models.json ──► the endpoint it names
                                                    ├── loopback :3031 ──► bundled bridge ──► BRIDGE_UPSTREAM_KEY ──► upstream
                                                    └── anything else  ──► direct provider ──► auth.json key ──► provider
```

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Raw `Connection error.` inside the TUI | The model endpoint — usually the bundled bridge — is not running | `bun run agent:start` in the unown repo; or stop needing the stack entirely: `unown setup` with a direct provider ([providers](providers.md)) |
| `llm-bridge: upstream 401: …` in chat errors | `BRIDGE_UPSTREAM_KEY` missing or wrong in the repo's `.env` | Edit `.env`, set the key, then `bun run agent:stop && bun run agent:start` ([configuration](configuration.md#the-one-required-thing)) |
| `unauthorized: missing or invalid bearer token (BRIDGE_API_KEY is set)` | The bridge requires a shared secret, but the terminal agent's `~/.unown/agent/models.json` still carries the placeholder key (it is only read at file-creation time) | Re-run `unown setup` **from the unown repo root** so the wizard sees `BRIDGE_API_KEY` via `.env` — or hand-edit the `apiKey` field in `~/.unown/agent/models.json` to the same value |
| Pre-flight: `cannot reach the model endpoint at …` | Dead endpoint or wrong URL | Loopback URL → start the stack (`bun run agent:start`); remote URL → check it, then re-run `unown setup` |
| Pre-flight / doctor: `credentials rejected (HTTP 401/403)` | Bad API key in `~/.unown/agent/auth.json` (or `models.json`) | Re-run `unown setup` with the correct key |
| Footer shows `glm-4-plus` (or another unexpected model) | Stale `~/.unown/agent/models.json` from an earlier configuration; the bootstrap never clobbers it, and the bridge silently routes unknown ids to its default | `unown setup --force` with the model you want — or delete `~/.unown/agent/models.json` and let the next run re-create it |
| A service fails to start with `EADDRINUSE` | Something else owns the port (stale process without a pidfile, or another supervisor) | `bun run agent:stop`, then check what still listens (`ss -tlnp` / `lsof -i :3030`) and kill it — note `start.sh` reuses an already-healthy bridge on `:3031` by design |

Two of these deserve a sentence more:

- **The PATH shim.** `scripts/link.ts` (via `bun run agent:link`) writes a small shim that always executes *this checkout's* `bin/unown` with bun — default `~/.local/bin/unown` on macOS/Linux, `%USERPROFILE%\.local\bin\unown.cmd` + `unown.ps1` on Windows (the dir is appended to your user PATH; restart your terminal after a fresh install). A global `bun install -g .` is **not** the supported route — the shim keeps subagent spawning, the vendored `pi-repo/` workspace deps and `git pull` updates working with zero maintenance. If the shim's target dir is not on your `PATH`, the script prints the exact line to add (`export PATH=…` on macOS/Linux; on Windows it updates the registry PATH for you).
- **The stale-model case.** `models.json` is written once and then deliberately left alone (your hand edits are never clobbered). That is the right default — until the "once" was written by an older setup. `unown setup --force` overwrites it; deleting the file works too because the next run re-creates it from current env/defaults.

### The learning path

Chat works; memory / dreams / dashboard do not. All of these are ⚠-class problems:

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Doctor: `self-learning engine — unreachable` | Engine down. **Not fatal** — chat is unaffected; session notes queue in `~/.unown/notes/outbox` and sync when it returns | `bun run agent:start` when you want learning back; nothing else required |
| Doctor: `default model routable` shows ⚠ | Your model id is not in `BRIDGE_KNOWN_MODELS`, so the bridge routes it onto `BRIDGE_ROUTE_DEFAULT` | Requests still work. Add the id to `BRIDGE_KNOWN_MODELS` in `.env` (restart the stack), or `unown setup --model` an allow-listed one |
| Dashboard loads but shows no data / cannot fetch | `NEXT_PUBLIC_AGENT_API_BASE` unset in a direct deployment, or pointing at the wrong prefix | Set it to `http://localhost:3030` (or your API-gateway prefix) in `.env`, then `bun run agent:stop && bun run agent:start` ([configuration](configuration.md)) |
| Triggering a router job fails with `engine is busy with another job` | By design — the busy-mutex serializes background work so the sandbox is never double-driven | Wait for the running job to finish; the Router tab shows run counts and next-fire times |
| Notes never become memory | Engine not running at dream time (notes pile up in the outbox), or dreams failing | Start the engine (`bun run agent:start`), check the Dreams tab for errors, and confirm the outbox is draining: `ls ~/.unown/notes/outbox` |

#### Notes are not becoming memory

The learning path has three moving parts — capture, delivery, dreaming — and each fails differently. Walk them in order:

1. **Capture**: exit notes only fire on a real quit (`/quit`, Ctrl+C, Ctrl+D), and only when the session did something; `/new`-style reloads keep the session alive and do not count. Mid-session notes via the `note` tool or `/note` are the reliable path.
2. **Delivery**: check `~/.unown/notes/outbox/` — a growing pile means the engine is down (or `UNOWN_ENGINE_URL` points at the wrong host). `unown note "test"` tells you which way it went.
3. **Dreaming**: the engine runs `auto-dream` every 10 minutes and `note-sync` every 5. Terminal notes are dreamed per-project whenever any are pending; the engine's own dream needs at least 3 undreamed benchmark notes. Watch the [Dreams tab](http://localhost:3000/dashboard) — a dream row with status `error` carries the reason.

### The CLI itself

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `unown: command not found` | The PATH shim is missing (or you moved the repo) | `bun run agent:link` (or `bash scripts/link.sh` on macOS/Linux) from the repo — see the PATH-shim note above |
| `bun: command not found` | bun is not installed | Install it from <https://bun.sh> (≥ 1.2 — macOS/Linux: `curl -fsSL https://bun.sh/install \| bash`; Windows: `powershell -c "irm bun.sh/install.ps1 \| iex"`), then re-run `bun run agent:link` if you had a shim pointing at a stale bun path |
| Doctor: `OS sandbox (bubblewrap)` shows ⚠ | No bubblewrap on this host (macOS, or a Linux box without it) | Nothing to fix for chat. Engine runs fall back to the in-process path jail — OS-level isolation is Linux/bubblewrap only |

### Windows

The Windows-specific failure modes (the general rows above still apply). Full guide: [windows guide](windows.md).

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `'unown' is not recognized…` right after installing | The installer appended `%USERPROFILE%\.local\bin` to your **User PATH via the registry** (never `setx`), but the terminal you're typing in predates the change | Open a **new** terminal (cmd or PowerShell), then `unown doctor`. Still nothing? `bun run agent:link` from the repo and read its hint |
| PowerShell: `…running scripts is disabled on this system` | The default execution policy blocks the `unown.ps1` shim | Once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` — or just call `unown.cmd` (cmd users never see this; from PowerShell `unown.cmd` works too) |
| `'bun' is not recognized` / `bun: command not found` | bun not installed (or installed after the shim was written — the shims embed bun's path at link time) | `powershell -c "irm bun.sh/install.ps1 | iex"`, open a new terminal, then re-run `bun run agent:link` so the shim points at the new bun |
| Dashboard: `Could not locate the bindings file` / `ERR_DLOPEN_FAILED` mentioning better-sqlite3 | better-sqlite3 13 ships **prebuilds for win32 x64/arm64 inside the package** — nothing compiles and there is no postinstall — so this means a broken install extract, not a missing toolchain | `rm -rf node_modules; bun install`. Note the engine never uses better-sqlite3 (it uses `bun:sqlite`): chat and learning are unaffected — this row is dashboard-only. If typecheck then misses `src/generated/prisma`, run `bun run db:generate` (that's what CI does) |
| You want bwrap-grade sandbox isolation | Native Windows has no OS sandbox — engine runs use the in-process path jail there (the same degradation Claude Code ships on native Windows) | Use **WSL2**: install bun inside WSL2 (`curl -fsSL https://bun.sh/install | bash`), clone the repo there (keep it in the Linux filesystem, `~/…`, not `/mnt/c`) — on Linux the engine picks up the vendored bwrap automatically. Details: [windows guide § sandbox](windows.md#the-sandbox-story-on-windows) |

The same logs apply as everywhere (`.run\bridge.log`, `.run\engine.log`, `.run\dashboard.log` inside the repo); `unown doctor` prints platform-aware rows (`OS sandbox (Windows)` ⚠ is *expected*, not a defect).

## Where the logs are

| Location | What it holds |
|----------|---------------|
| `.run/bridge.log`, `.run/engine.log`, `.run/dashboard.log` | The three services as started by `scripts/start.ts` (pidfiles sit next to them in `.run/`; stop with `bun run agent:stop`) |
| `.zscripts/mini-service-<name>.log` | Services started via the dev supervisor (`.zscripts/dev.sh`) instead of `start.sh` |
| `~/.unown/notes/outbox/` | Terminal notes queued because the engine was unreachable — the queue draining is itself a health signal |
| `curl -s localhost:3031/health` | Live bridge state: `upstream {ok, status}`, `upstreamKeyIsSet`, `authRequired`, served `models` |
| `curl -s localhost:3031/v1/log` | The bridge's request log ring buffer — per-request model, tokens, durations, errors |
| `curl -s localhost:3030/api/overview` | Engine health + KPIs (runs, dreams) |
| `~/.unown/crashes/*.json` | Local crash records — if the `unown` CLI itself dies, a sanitized record (error, version, platform; never your prompts or environment) lands here. Nothing is ever sent anywhere: attach the file yourself when you report, and delete freely. |

While reproducing a chat problem, a second terminal with `tail -f .run/bridge.log .run/engine.log` in the unown repo covers most of it: the bridge logs every upstream attempt and the engine logs router activity.

### Verifying a fix

One command per domain, fastest first:

- **Chat path**: `unown -p "reply with ok"` — a one-shot session that exercises the full chain (pre-flight, models.json, bridge, upstream) and exits non-zero with a hint when anything is broken.
- **Full doctor pass**: `unown doctor` — expect `✓ unown is ready in <dir>` or, with ⚠ items only, `✓ unown is ready to chat in <dir>`.
- **Learning path**: `unown note "diagnostic test note"` (delivers or queues, and tells you which), then watch the [Dreams tab](http://localhost:3000/dashboard) — the note should appear as pending and disappear into the next dream. There is no note deletion — the diagnostic note is real and will be consolidated like any other, so keep it boring ("diagnostic test note") or skip this check if your project memory is precious.

## Resetting cleanly

Three independent state trees — delete the one that is actually misbehaving:

| Reset | Kills | Survives |
|-------|-------|----------|
| `rm -rf ~/.unown` | agent config (`models.json`, `auth.json`, `settings.json` — re-created on the next run; re-run `unown setup` for a direct provider), global memory (`policy.md`, `user.md` — `user.md` re-seeds), terminal sessions, note outbox + archive | every project's `.unown/`, the engine and its DB, your repo's `.env` |
| `rm -rf <project>/.unown` | that project's memory (re-scaffolded empty on the next session there), local overrides, minted skills, `.unown/agents/` definitions | `~/.unown`, other projects, the engine DB — the dream history (including that project's recorded versions) stays |
| delete `data/self-learning/` + `db/selflearning.db` (repo root) | runs, cycles, dreams, memory versions, skill records — the engine re-seeds default memory, the five benchmark tasks and the router jobs on next boot | all terminal-agent state, all projects' `.unown/`, `.env` — the factory reset for the engine only |

Before the first one, **check `~/.unown/notes/outbox`** — undelivered notes there are lost with it. See [Memory](memory.md) for what each of these files does before you delete anything.

## Getting help

- [README](../README.md) — quickstart, architecture, the learning loop, security model.
- The other docs pages: [usage](usage.md), [providers](providers.md), [skills](skills.md), [Memory](memory.md), [configuration](configuration.md).
- `unown --help` for the command surface; `unown doctor` for a live end-to-end check.
- For the underlying pi TUI itself (keybindings, sessions, themes, `models.json` format), see the vendored docs under `pi-repo/packages/coding-agent/docs/`.
- On the dashboard: Learning Lab holds full run transcripts, Hooks holds every guardrail decision, Router shows job health and next-fire times — all three are diagnostic surfaces, not just eye candy.

When you ask for help, attach the output of `unown doctor`, the relevant slice of `.run/*.log`, and (for chat problems) the JSON from `curl -s localhost:3031/health` — that triple covers nearly every failure mode above. Never paste your real API keys.
