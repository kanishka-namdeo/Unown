# Troubleshooting

Symptom-first fixes for the unown stack: run `unown doctor` first, work the table, then check the logs. Covers the chat path (bridge, credentials, model config), the learning path (engine, notes), the session surface (LSP, MCP, checkpoints, goals, review) and the CLI itself.

Related pages: [usage](usage.md) · [providers](providers.md) · [Memory](memory.md) · [configuration](configuration.md) · [resilience](resilience.md)

- [Start here: unown doctor](#start-here-unown-doctor)
- [Symptoms and fixes](#symptoms-and-fixes)
  - [The chat path](#the-chat-path)
  - [The learning path](#the-learning-path)
  - [The session surface](#the-session-surface)
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

It checks the agent dir and `models.json`, the memory stack, the model endpoint (with a live probe), bridge specifics when the endpoint is the bundled bridge (upstream key, upstream health, default model routable), the OS sandbox, engine health, and the session surfaces: which language servers are on PATH, MCP config health (including the project trust gate), the size of the project's `.unown/` runtime state, the permissions layer's configs, and the instruction-set audit (AGENTS.md freshness, skills, hooks schema, adversary mode, injection scanner). Every line is one of:

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
| `LSP servers` | ⚠ | which language servers are detected on PATH — a warning just means the optional diagnostics loop is inactive (install a server or configure `.unown/lsp.json`) |
| `MCP config` | ⚠ | configured servers, config-validation problems, and the project-config trust state — an untrusted `.unown/mcp.json` warns with the `/mcp trust` action |
| `unown state` | ⚠ | disk usage of the project's `.unown/` runtime state (checkpoints, receipts, reviews); warns past `UNOWN_STATE_WARN_BYTES` (default 512 MiB) with pruning guidance |
| `permissions config` | ⚠ | the granular permissions layer — config files found / valid / trusted, rule counts, mode and learn state; a missing config is the documented default (hard-coded guardrails alone), an untrusted project `.unown/permissions.json` warns with the `/permissions trust` action ([permissions](permissions.md)) |
| `instruction-set audit` | ⚠ | the human-authored artifacts that steer the agent — AGENTS.md freshness, skill coverage, MCP orphan servers, hooks config schema, adversary mode, injection scanner, stale config; the detail line says `clean` or points at `unown doctor-instructions` for the full seven-section report |

Related behavior worth knowing: before every session the CLI pre-flights the model endpoint. In TUI mode a failure prints a warning and continues (pi's retries cover the window where you start the stack in another terminal); in print mode (`unown -p`) it exits non-zero with the same hint. `UNOWN_NO_PREFLIGHT=1` skips the check entirely.

Two more read-only diagnostics round it out:

- `unown models` — the providers configured in `~/.unown/agent/models.json`, plus a live list of what a local bridge serves right now (and a warning when your default model is not in that list).
- `unown memory` — the effective 4-tier stack for the current directory; a quick sanity check that `.unown/memory/project.md` is being read at all ([Memory](memory.md)).

## Symptoms and fixes

The stack has four failure domains and they rarely interact: the **chat path** (terminal agent → bridge → upstream; broken chats), the **learning path** (engine, notes, dreams; chat keeps working), the **session surface** (LSP, MCP, checkpoints, goals, review; chat keeps working, one feature degrades), and the **CLI itself**. Find your symptom's domain first.

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
| A service fails to start with `EADDRINUSE` | Something else owns the port (stale process without a pidfile, or another supervisor) | `bun run agent:stop`, then check what still listens (`ss -tlnp` / `lsof -i :3030`) and kill it — note `bun run agent:start` (scripts/start.ts) reuses an already-healthy bridge on `:3031` by design |

Two of these deserve a sentence more:

- **The PATH shim.** `scripts/link.ts` (via `bun run agent:link`) writes a small shim that always executes *this checkout's* `bin/unown` with bun — default `~/.local/bin/unown` on macOS/Linux, `%USERPROFILE%\.local\bin\unown.cmd` + `unown.ps1` on Windows (the dir is appended to your user PATH; restart your terminal after a fresh install). A global `bun install -g .` is **not** the supported route — the shim keeps subagent spawning, the vendored `pi-repo/` workspace deps and `unown update` working with zero maintenance. If the shim's target dir is not on your `PATH`, the script prints the exact line to add (`export PATH=…` on macOS/Linux; on Windows it updates the registry PATH for you).
- **The stale-model case.** `models.json` is written once and then deliberately left alone (your hand edits are never clobbered). That is the right default — until the "once" was written by an older setup. `unown setup --force` overwrites it; deleting the file works too because the next run re-creates it from current env/defaults.

### The learning path

Chat works; memory / dreams / the TUI dashboard do not. All of these are ⚠-class problems:

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Doctor: `self-learning engine — unreachable` | Engine down. **Not fatal** — chat is unaffected; session notes queue in `~/.unown/notes/outbox` and sync when it returns | `unown engine start` when you want learning back (auto-start usually beats you to it); nothing else required |
| Doctor/status: `self-learning engine — up but rejected this CLI's token` or `engine: BLOCKED — unauthorized` | The engine is **running and healthy**; this CLI presented the wrong bearer token. Auto-discovery reads the token file from the CLI's *own* data dir, and a binary install (`~/.unown/data/self-learning/`) talking to a source-repo engine (the repo's `data/self-learning/`) reads a file the engine never wrote — the M7 discovery contract holds within one install type and breaks across them. Auto-start is **refused**, not retried: a 401 is not a crash | Use a CLI from the same install as the engine, or set `UNOWN_ENGINE_TOKEN` to the token **value** from the **engine's** `data/self-learning/engine.token` (not the path). `unown engine status` names the owner pid and this CLI's token path. Chat is unaffected; only learning sync is paused |
| Doctor/status: `engine: BLOCKED — occupied` / `incompatible` / `unreachable` | The port is held by a non-Unown process, the engine's API is incompatible, or it did not answer within the probe timeout (a hung port). None of these is a crashed engine | `unown engine status` prints the owner pid and the fix; do **not** spawn a second engine. For a non-Unown owner, stop it or point `UNOWN_ENGINE_URL`/`PI_AGENT_PORT` elsewhere. For an incompatible build, restart it from its owning install. A hung port is not fixed by another engine |
| Footer `memory: paused · /engine`, or doctor: `engine auto-start — gave up after N failed start(s)` | The engine crash-loops on boot — usually a corrupt DB. An occupied port or a foreign engine is a **blocked** probe and is deliberately not counted as a failed start | `unown engine status` (pidfile + circuit + outbox diagnosis), inspect `.run/engine.log`; corrupt DB → `unown engine repair`; otherwise `unown engine start` (resets the circuit). Full catalog: [resilience](resilience.md) |
| Doctor: `engine auto-start — auto-start blocked — last probe: unauthorized\|occupied\|incompatible\|unreachable` | Auto-start is refusing because the port is owned by something this CLI cannot use; no child was launched and the backoff did not advance | Run `unown engine status` for the owner; see [R11](resilience.md#r11--engine-blocked-by-another-ownerport). Do not `engine restart` unless you own the engine, or use `--take-ownership` deliberately |
| Doctor: `default model routable` shows ⚠ | Your model id is not in `BRIDGE_KNOWN_MODELS`, so the bridge routes it onto `BRIDGE_ROUTE_DEFAULT` | Requests still work. Add the id to `BRIDGE_KNOWN_MODELS` in `.env` (restart the stack), or `unown setup --model` an allow-listed one |
| `unown dashboard` shows the engine-down banner / empty screens | Engine not running — the TUI dashboard is a *client* of the engine, not a service, so with the engine down there is nothing to render | `unown engine start` (or `bun run agent:start` for bridge + engine together); the dashboard retries on its own once the health endpoint answers. The old web-dashboard row here (`NEXT_PUBLIC_AGENT_API_BASE` mis-pointing) left with the web dashboard — there is no URL knob to get wrong anymore |
| REST calls to the engine answer `401` (`missing or invalid bearer token`) | The M7 token posture: every `/api` request must present the per-boot bearer token from `data/self-learning/engine.token`. Same-user clients (the CLI, the TUI dashboard, the bridge) auto-discover the file; a client running as another user or on another machine cannot read it | Run the client as the same user on the same machine, or pin the token on both sides with `UNOWN_ENGINE_TOKEN` ([configuration](configuration.md)). `UNOWN_ENGINE_AUTH=off` disables tokening entirely but the engine then **refuses to boot** unless `UNOWN_ENGINE_HOST` stays on loopback |
| Triggering a router job fails with `engine is busy with another job` | By design — the busy-mutex serializes background work so the sandbox is never double-driven | Wait for the running job to finish; the Router screen shows run counts and next-fire times |
| Notes never become memory | Engine not running at dream time (notes pile up in the outbox), or dreams failing | Start the engine (`unown engine start`), check the Dreams screen for errors, and confirm the outbox is draining: `ls ~/.unown/notes/outbox` |

#### Notes are not becoming memory

The learning path has three moving parts — capture, delivery, dreaming — and each fails differently. Walk them in order:

1. **Capture**: exit notes only fire on a real quit (`/quit`, Ctrl+C, Ctrl+D), and only when the session did something; `/new`-style reloads keep the session alive and do not count. Mid-session notes via the `note` tool or `/note` are the reliable path.
2. **Delivery**: check `~/.unown/notes/outbox/` — a growing pile means the engine is down (or `UNOWN_ENGINE_URL` points at the wrong host). `unown note "test"` tells you which way it went.
3. **Dreaming**: the engine runs `auto-dream` every 10 minutes and `note-sync` every 5. Terminal notes are dreamed per-project whenever any are pending; the engine's own dream needs at least 3 undreamed benchmark notes. Watch the Dreams screen (`unown dashboard`, or `/dashboard` inside a session) — a dream row with status `error` carries the reason.

### The session surface

The session features — LSP code intelligence, MCP servers, checkpoints/receipts, goals, `/review` — are a fourth domain: chat keeps working while one feature degrades. Every one has a kill-switch (`UNOWN_LSP=0` disables the `lsp` tool and its diagnostics loop, `UNOWN_MCP=0` the whole MCP client; [configuration](configuration.md)) and a status surface of its own: `/lsp`, `/mcp`, `/checkpoints` inside a session, and the `lsp-servers` / `mcp-config` / `unown-state` rows of `unown doctor` from the shell (all warn-class — these features never break chat).

#### LSP — no language server detected, diagnostics never appear

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `lsp` replies `No language server available for <path> (<language>). Install one on PATH … or configure .unown/lsp.json.` | No server for that language is on PATH | Install one (`npm i -g typescript-language-server typescript`, `pip install pyright`, …) or configure `.unown/lsp.json` / `~/.unown/agent/lsp.json`; doctor's `LSP servers` row lists what is detected |
| `/lsp` prints `no language servers detected on PATH (configure .unown/lsp.json)` | Same — or the whole surface is off | If it instead prints `LSP support is disabled (UNOWN_LSP=0 or lsp.json).`, the kill-switch or a `disabled: true` config is set — unset it |
| `/lsp` shows `✗ <language> — <command> (restarts exhausted)` | The server crashed repeatedly — after a 30 s crash cooldown (`UNOWN_LSP_CRASH_COOLDOWN_MS`) and 3 restarts per server per session, unown stops respawning it | Restart the session (the budget is per session), then debug the server itself: run the printed command line by hand and read its stderr |
| Diagnostics ride edits in most files but never in one huge file | Files over `UNOWN_LSP_MAX_SYNC_BYTES` (4 MiB) skip document sync — logged once per file | By design — a multi-megabyte file is past the server's useful range; split it or accept no diagnostics there |

#### MCP — `mcp__*` tools never register

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `/mcp` prints `⚠ a project .unown/mcp.json is UNTRUSTED — its servers are withheld until approved.` | The trust gate: a cloned repo's project config would configure command execution, so unown refuses to load it first | `/mcp trust` in the session, or `UNOWN_TRUST_PROJECT_CONFIG=1` for CI/headless — see the trust-gate rows below |
| `/mcp` shows `✗ <name> [stdio] error — <stderr tail>` | The server failed to spawn or never answered the initialize handshake (`UNOWN_MCP_CONNECT_TIMEOUT_MS`, default 20 s) | Run its command by hand; `unown mcp test <name>` probes it with short timeouts and prints the failure |
| `/mcp` shows a `Config problems:` block (file + key + fix) | Malformed JSON, a bad entry shape, a non-http(s) URL, or a header with line breaks — surfaced, never silently swallowed | Fix the named key in the named file; the offending entry is skipped, never spawned as-is (`unown mcp get <name>` prints what is actually stored) |
| Footer shows `mcp: 2/3 · 8 tools · 1 ✗` and one server's tools never appear | The server died and sits in the 30 s reconnect cooldown (`UNOWN_MCP_RECONNECT_COOLDOWN_MS`) | `/mcp` force-throughs the cooldown and retries every server; a server that keeps dying has a real problem — `unown mcp test <name>` from the shell |

#### MCP — a server died mid-session

A dead server never takes the session down: pending calls reject with error results, the server cools down (30 s) before unown attempts it again, and a keepalive ping (`UNOWN_MCP_PING_INTERVAL_MS`, 60 s) marks silent deaths errored. `/mcp` reconnects immediately — it deliberately pushes through the cooldown — and the footer line (`mcp: <connected>/<total> · <n> tools`) tracks the recovery. HTTP servers additionally self-heal: a 404 from a rotated session id triggers one transparent re-initialize and the call is replayed; 429/503 responses back off honoring `Retry-After`.

#### Checkpoints — `/restore`, `/undo` or `/redo` reports a file it could not revert

Per-file failures are honest: the checkpoint's other files still apply, the failing file is left untouched, and the reason comes from a fixed vocabulary (the same one for all three commands — `/redo` re-applies through the identical verified, jailed restore path):

| Report | Meaning | Fix |
|---|---|---|
| `corrupt-blob: blob failed its integrity check — checkpoint data is corrupt` | The blob failed its sha256 verification against the manifest — the store itself is corrupt (disk damage, a partial write from a crash outside the atomic-write path) | Nothing was overwritten. Delete `.unown/checkpoints/` to reset the store — you lose snapshot history, not files |
| `missing-blob: blob missing — was the store pruned?` | The manifest survived but its blob did not (manual deletion, a prune race) | Same reset; the retention caps (40 manifests per session, 200 global, oldest pruned) make manual pruning unnecessary |
| `oversized: file was too large to checkpoint — cannot revert` | The file exceeded `UNOWN_CHECKPOINT_MAX_BLOB_BYTES` (default 64 MiB) at capture time and was never blobbed | There is no stored before-image — repair the file by hand; the ledger noted the exception when the turn was sealed |
| `outside: path escapes the project jail` | A checkpointed path now resolves outside the project (a symlink moved) | The refusal is the feature — restore never writes through a symlink out of the project; copy the intended content manually |

Two look-up failures complete the picture: `/restore <key>` answering `No checkpoint matches "<key>". /checkpoints lists them.` means the id/label (or its prefix) does not exist — `/checkpoints` lists them all. `/undo` answering `No turn checkpoints to undo (nothing sealed this session — try /restore <id> for named snapshots).` means no turn wrote files this session; the variant `No turn checkpoints from this session to undo (other sessions' turns exist — /undo --all opts in; …)` is the session-ownership rule — `/undo` consumes only this session's turns unless you pass `--all`. `/redo` answering `Nothing to redo — the redo stack is empty (/undo pushes entries; any new checkpoint clears them).` is normal after a fresh session, after everything undone was already redone, or after a new checkpoint was sealed (new edits invalidate redo — the classic editor rule); the variant `No undone changes from this session to redo (other sessions' redo entries exist — /redo --all opts in).` is the same ownership rule as `/undo`'s.

#### Goals — `/goal` won't complete

The completion gate runs when the agent ends a turn while a goal is active, and every rejection prints its exact reason after `Goal NOT complete — `:

| Rejection (exact text) | Fix |
|---|---|
| `no [GOAL:COMPLETE] tag as its own line in the final reply` | The agent must END its completion reply with the tag on a line of its own — a mid-text mention does not count |
| `N unfinished todo(s)` | Close or drop the open todos (`todo`); any unfinished todo blocks completion |
| `no todos tracked — track the goal's steps with the todo tool before claiming completion (an empty list is not verifiable)` | Have the agent track the goal's steps with the `todo` tool first — an empty list is rejected outright |
| `insufficient evidence cited (need distinct kinds: ≥1 changed-file path …)` (whichever kind is missing is named) | The final reply must cite BOTH kinds: a changed-file path AND a command line / exit code / test tally; quoted or echoed text does not count |

Remember the honest limit ([usage](usage.md)): the gate verifies that evidence was cited, not that the evidence is true.

#### Review — `/review` says N/M reviewers failed

`N/M reviewer(s) failed (timeout/crash)` means some reviewer subagents crashed, timed out, or returned nothing — the finding list may be incomplete, and the render says so. When every reviewer fails, the verdict is forced to `VERDICT: UNKNOWN (reviewers failed — re-run /review)` with `No findings recorded — every reviewer failed; this is NOT a clean review. Re-run /review.` Reviewers are subagents on the same chat path as your session, so a flaky model endpoint fails all of them together: re-run `/review`, and if it fails again, work [the chat path](#the-chat-path) table above (`unown doctor` covers it). Reviewer output truncated at the subagent cap is marked too — same remedy.

#### The trust gate — project `.unown/mcp.json` / `.unown/lsp.json` ignored

Project-scoped `.unown/mcp.json` and `.unown/lsp.json` configure command execution, and in a cloned repo they are attacker-controlled — so unown gates them refuse-first: an untrusted project file's entries are never loaded, never spawned; its servers simply do not exist for the session. The surfaces agree on the diagnosis: `/mcp` lists withheld servers as `not-configured` and prints the `UNTRUSTED` warning, `/lsp` renders the same guidance for withheld server overrides, and doctor's `MCP config` row warns with the action.

- `/mcp trust` (and `/lsp trust`) approves the file in a session; `UNOWN_TRUST_PROJECT_CONFIG=1` bypasses the gate for CI/headless runs.
- The approval pins a sha256 fingerprint of the file's resolved path AND bytes — editing the file later (or a different checkout of the same repo) re-arms the gate on purpose; approve again.
- `unown mcp add --scope project` auto-trusts the exact content it just wrote — a later hand-edit re-arms the gate.
- Files under `~/.unown/agent/` (user scope) are yours and always trusted.

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
| A GUI dialog `Windows cannot find '\C:\...\unown\versions\...\unown.exe\'` when running `unown` / `unown setup` | **v0.0.16 only:** the engine auto-start spawn double-quoted the executable for cmd.exe; `start` launched the backslash residue instead (fixed in v0.0.17) | `unown update` (the updater itself spawns by argv array — unaffected), or re-run the installer for ≥ v0.0.17 |
| `'bun' is not recognized` / `bun: command not found` | bun not installed (or installed after the shim was written — the shims embed bun's path at link time) | `powershell -c "irm bun.sh/install.ps1 | iex"`, open a new terminal, then re-run `bun run agent:link` so the shim points at the new bun |
| You want bwrap-grade sandbox isolation | Native Windows has no OS sandbox — engine runs use the in-process path jail there (the same degradation Claude Code ships on native Windows) | Use **WSL2**: install bun inside WSL2 (`curl -fsSL https://bun.sh/install | bash`), clone the repo there (keep it in the Linux filesystem, `~/…`, not `/mnt/c`) — on Linux the engine picks up the vendored bwrap automatically. Details: [windows guide § sandbox](windows.md#the-sandbox-story-on-windows) |

The same logs apply as everywhere (`.run\bridge.log`, `.run\engine.log` inside the repo); `unown doctor` prints platform-aware rows (`OS sandbox (Windows)` ⚠ is *expected*, not a defect).

## Where the logs are

| Location | What it holds |
|----------|---------------|
| `.run/bridge.log`, `.run/engine.log` | The two services as started by `scripts/start.ts` (pidfiles sit next to them in `.run/`; stop with `bun run agent:stop`) |
| `.zscripts/mini-service-<name>.log` | Services started via the dev supervisor (`.zscripts/dev.sh`) instead of `start.sh` |
| `~/.unown/notes/outbox/` | Terminal notes queued because the engine was unreachable — the queue draining is itself a health signal |
| `<project>/.unown/receipts/<session>.jsonl` | The session audit ledger — every prompt, tool call and result, in order; `/receipts` renders it with totals when you need to know what a session actually did |
| `curl -s localhost:3031/health` | Live bridge state: `upstream {ok, status}`, `upstreamKeyIsSet`, `authRequired`, served `models` |
| `curl -s localhost:3031/v1/log` | The bridge's request log ring buffer — per-request model, tokens, durations, errors |
| `curl -s localhost:3030/api/overview` | Engine health + KPIs (runs, dreams) |
| `~/.unown/crashes/*.json` | Local crash records — if the `unown` CLI itself dies, a sanitized record (error, version, platform; never your prompts or environment) lands here. Nothing is ever sent anywhere: attach the file yourself when you report, and delete freely. |

While reproducing a chat problem, a second terminal with `tail -f .run/bridge.log .run/engine.log` in the unown repo covers most of it: the bridge logs every upstream attempt and the engine logs router activity.

### Verifying a fix

One command per domain, fastest first:

- **Chat path**: `unown -p "reply with ok"` — a one-shot session that exercises the full chain (pre-flight, models.json, bridge, upstream) and exits non-zero with a hint when anything is broken.
- **Full doctor pass**: `unown doctor` — expect `✓ unown is ready in <dir>` or, with ⚠ items only, `✓ unown is ready to chat in <dir>`.
- **Learning path**: `unown note "diagnostic test note"` (delivers or queues, and tells you which), then watch the Dreams screen (`unown dashboard`) — the note should appear as pending and disappear into the next dream. There is no note deletion — the diagnostic note is real and will be consolidated like any other, so keep it boring ("diagnostic test note") or skip this check if your project memory is precious.
- **Session surface**: `unown doctor` covers it in one run (the `lsp-servers`, `mcp-config`, `unown-state` rows); in a live session, `/lsp` (running servers, cached diagnostics) and `/mcp` (server status, then reconnect) are the live probes.

## Resetting cleanly

Three independent state trees — delete the one that is actually misbehaving:

| Reset | Kills | Survives |
|-------|-------|----------|
| `rm -rf ~/.unown` | agent config (`models.json`, `auth.json`, `settings.json`, `trusted-configs.json` — trust approvals go with it, so project configs re-require `/mcp trust`; re-created on the next run; re-run `unown setup` for a direct provider), global memory (`policy.md`, `user.md` — `user.md` re-seeds), terminal sessions, note outbox + archive | every project's `.unown/`, the engine and its DB, your repo's `.env` |
| `rm -rf <project>/.unown` | that project's memory (re-scaffolded empty on the next session there), local overrides, minted skills, `.unown/agents/` definitions, receipts/checkpoints/reviews history, `.unown/lsp.json`/`.unown/mcp.json` config | `~/.unown`, other projects, the engine DB — the dream history (including that project's recorded versions) stays |
| delete `data/self-learning/` + `db/selflearning.db` (repo root) | runs, cycles, dreams, memory versions, skill records — the engine re-seeds default memory, the five benchmark tasks and the router jobs on next boot | all terminal-agent state, all projects' `.unown/`, `.env` — the factory reset for the engine only |

Before the first one, **check `~/.unown/notes/outbox`** — undelivered notes there are lost with it. See [Memory](memory.md) for what each of these files does before you delete anything.

## Getting help

- [README](../README.md) — quickstart, architecture, the learning loop, security model.
- The other docs pages: [usage](usage.md), [providers](providers.md), [skills](skills.md), [Memory](memory.md), [configuration](configuration.md).
- `unown --help` for the command surface; `unown doctor` for a live end-to-end check.
- For the underlying pi TUI itself (keybindings, sessions, themes, `models.json` format), see the vendored docs under `pi-repo/packages/coding-agent/docs/`.
- In the TUI dashboard (`unown dashboard`): Learning Lab holds full run transcripts, Hooks holds every guardrail decision, Router shows job health and next-fire times — all three are diagnostic surfaces, not just eye candy.

When you ask for help, attach the output of `unown doctor`, the relevant slice of `.run/*.log`, and (for chat problems) the JSON from `curl -s localhost:3031/health` — that triple covers nearly every failure mode above. Never paste your real API keys.
