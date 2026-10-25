# Using unown

How to run the `unown` terminal agent, what it does inside a session, and where its state lives.

- [Three ways to run](#three-ways-to-run)
- [Plan mode](#plan-mode)
- [Command reference](#command-reference)
- [Session tools](#session-tools)
- [Slash commands](#slash-commands)
- [Keybindings](#keybindings)
- [Sessions](#sessions)
- [Guardrails](#guardrails)
- [User-configurable hooks](#user-configurable-hooks)
- [Memory in sessions](#memory-in-sessions)
- [Environment variables](#environment-variables)

Related pages: [subagents](subagents.md) · [skills](skills.md) · [routines](routines.md) · [watch](watch.md) · [ralph](ralph.md) · [repomap](repomap.md) · [standing orders](standing-orders.md) · [m[memory](memory.md) · [providers](providers.md) · [configuration](configuration.md) · [addons](addons.md) · [updating](updating.md) · [resilience](resilience.md)

## Three ways to run

**1. Interactive TUI — `unown`**

```bash
cd ~/code/my-project
unown                          # full interactive session, like claude/pi
unown "fix the failing tests"  # same, starting with a prompt
```

You get the real pi TUI in your actual project directory: file tools (read / edit / write / grep / find / ls), bash, `@file` mentions, session management — plus unown's self-learning layer: tiered memory injected into every session, guardrail hooks, session tools, and note capture for AutoDream. See [m[memory](memory.md) for what gets injected and [guardrails](#guardrails) below for what gets blocked.

On first run, unown seeds `~/.unown/agent/` (models.json pointing at the bundled llm-bridge, settings.json, a sessions dir, and four starter [skills](skills.md)) and prints a banner — and on an interactive TTY it offers the guided provider wizard on the spot ("connect a model provider now?" → the `unown setup` presets with live verification; declining keeps the bundled bridge). Connect a different provider any time with `unown setup` — see [providers](providers.md).

The first interactive session after an install also reads `~/.unown/install.json` and prints one card naming the channel that install took: standalone binary or source checkout, the version, where the binary (or repo) and the PATH shim live, and when it was installed — with `from v…` after an update, and a closing line when this process is still running an older build than the record describes. It shows once per recorded version, so an update gets one line of acknowledgement and nothing repeats, and it stays quiet when the machine has no record (a bare run straight from a clone). `/status` carries the one-line form of the same fact (`install binary v0.0.16 (linux-x64)`), omitted when there is no record.

**2. One-shot print mode — `unown -p "prompt"`**

```bash
unown -p "explain the build error" | less
cat error.log | unown -p "fix this"     # piped stdin joins the prompt
```

Print mode runs one prompt headlessly and exits. Piped stdin is appended to the prompt (separated by a blank line), so you can feed logs, diffs, or source files without quoting wars. **The stdin reader is idle-safe**: it only reads while data is actively flowing — an open but idle stdin (an agent harness, an editor, a supervisor driving `unown -p` with its own protocol) is never consumed, late bytes are left for the caller, and an endless pipe is capped at 1 MiB (`PI_PRINT_STDIN_IDLE_MS` / `PI_PRINT_STDIN_MAX_BYTES` tune both; see [configuration](configuration.md)). If either stdin or stdout is not a TTY, print mode is forced automatically — the piping above works with or without `-p`. Add `--mode json` to stream JSON events instead of text (this is how the [subagent](subagents.md) machinery consumes runs). **`--output-format stream-json`** (2026-10-25) is the Claude Code / Gemini / Cursor spelling of that same NDJSON event stream — an alias for `--mode json`, so scripts written against those CLIs work verbatim (and it refuses `--output-schema` exactly like `--mode json` does: the event stream has no single answer to validate).

A lone unknown word (`unown badcommand`) is rejected with exit 2 and nearest-command suggestions instead of being sent to the model — a one-word prompt needs `-p` or more words. **Unrecognized flags** get the same refusal (2026-10-25): `unown --thinking high` used to send the literal words "--thinking high" to the model as prompt text — now it exits 2 naming the flag (the fleet's spawn surface is pinned green against the guard). A prompt that itself starts with a dash: quote it, or use the standard **`--` end-of-options marker** — everything after `--` joins the prompt verbatim. In the TUI, an unknown `/command` gets the same treatment inline (a "did you mean" error, no model turn).

For CI pipelines and editor integrations there is a third output contract: `--output-format json` (Claude Code port) prints **one final JSON object** — the result *and* the accounting — with exit codes unchanged:

```bash
unown -p "fix the flaky test" --output-format json | jq -r .result
# {"type":"result","subtype":"success","result":"…","session_id":"…",
#  "model":"kimi-k2.5","usage":{"input_tokens":…,"output_tokens":…,
#  "cache_read_input_tokens":…,"cache_creation_input_tokens":…},
#  "cost_usd":…,"duration_ms":…,"num_turns":…,"unown_version":"…"}
```

`subtype` is `success` or `error_during_execution`; exit codes stay 0/1 like text mode, so `set -o pipefail` composes with `jq`. `--no-session` reports `session_id: null` (nothing to resume); `cost_usd` is null when the model has no price configured. `--output-format json` cannot be combined with `--mode json` (the event stream) and requires print mode — both misuse shapes exit 2 with a clear error. Custom [slash commands](custom-commands.md) expand in print mode too: `unown -p "/pr-description" --output-format json`.

**Long answers ping you when they land.** A print run that takes two minutes or more finishes while you are in another window — so when the answer arrives after `UNOWN_NOTIFY_MS` (default 120 000), unown emits an OSC-9 desktop notification (`unown: <first 80 chars of the answer>`) plus a BEL fallback for terminals that ignore the escape: iTerm2, WezTerm, Ghostty and friends show the notification, everything else gets the one beep. The ping rides the session's own pty — no helper binary, no permissions dialog, no network — and is wired for the honest cases only: text mode on a TTY (piped/redirected stdout — CI, `| less`, editor integrations — never sees control bytes), a real printed answer (errors and aborts ping nothing), and never the JSON lanes. Opt out with `UNOWN_NOTIFY=0`; `DO_NOT_TRACK=1` (the ecosystem nonessential-traffic signal) silences it too. The interactive TUI deliberately pings nothing — you are present, and pi's own UI owns the moment an answer lands. See [configuration](configuration.md).

**3. Plan mode — `unown --plan`**

```bash
unown --plan "add auth"    # plan first, touch nothing until you approve
```

See the next section. Also reachable mid-session as `/plan` or Ctrl+Alt+P.

Before every session (TUI or print), unown probes the configured model endpoint so a dead bridge or bad API key fails with instructions instead of a raw connection error. In print mode a failed probe exits with status 1; in the TUI it warns and continues. `UNOWN_NO_PREFLIGHT=1` skips the check.

## The startup mark (2026-10-24)

An interactive boot opens with a Unown form in the header slot: the script's eye
draws itself, blinks once, and hands the header back to the normal one about a
second later. The first interactive session on a machine gets the longer
flourish — the five forms `unown` is spelled with, resolving into letters — and
records that in `~/.unown/onboarding.json`, so every later session gets the
short one.

It is decoration that stays out of the way, by construction:

- The `unown v…` wordmark is painted on **every** frame, so nothing that waits
  on it (including the TUI capture lane) ever waits on the animation.
- The editor already has focus, so you can type immediately; the timer is
  `unref()`'d, so the mark can never hold the process open.
- It plays once per process, and only on a real boot — `/new`, `/resume` and
  `/reload` are not boots.
- Below its own width the art is dropped rather than wrapped, so it cannot shear
  or shift the transcript.
- Colour comes from the active theme's tokens only; there are no background
  fills.

To turn it off: `UNOWN_NO_SPLASH=1`, or set `quietStartup` (which already
suppresses the whole header), or export `NO_COLOR`. See
[configuration](configuration.md#terminal-agent-unown-cli).

## Terminal status & the turn meter (2026-10-25)

Three always-on presence surfaces ship with the convergence round:

- **OSC 7501 program status** — the terminal-status protocol Claude Code
  (v2.1.295), Crush (v0.98.0) and Goose (v1.56.0) all shipped in October 2026
  (spec: mitchellh.com/writing/program-status-osc7501). The session reports
  itself to the terminal: `idle` on boot, `working` (with the prompt preview)
  while a turn runs, `blocked kind=question` while the ask_user_question
  dialog waits, `idle` (with the answer preview) at turn end, `clear` on
  shutdown — so terminals like Rex and Ghostty can show what the agent is
  doing in the tab title / status area instead of guessing from a spinner.
  Emission is TTY-only and opt-out: `PROGRAM_STATUS=0` (the spec-wide name) or
  `UNOWN_OSC7501=0`.
- **The turn meter** — after every turn the footer carries the live chip
  `turn 3.4s · ctx 62% · in 45.2k out 1.1k (cached 42k) · ~$0.0084`: the
  turn's duration, the context utilization, the session token rollup (the
  `/usage` attribution) and the price-model estimate
  (`UNOWN_PRICE_<MODEL>_IN/_OUT` overrides; unknown models drop the cost
  segment — a price is never invented). This is the per-turn visibility
  Goose (v1.42+), Gemini CLI (`/stats`) and Claude Code (the status line)
  all normalize; `UNOWN_TURN_METER=0` turns it off.
- **The model pill** — while the agent dir has no provider configured, the
  footer carries `no model connected · /setup`. The first-run gate asks the
  connect-a-provider question once and then deliberately never re-asks it; the
  pill is what replaced re-asking, because a declined answer used to surface
  only as a 401. It reads the agent dir from disk (no probe on the hot path),
  and it never claims an absent model while the bundled bridge is answering —
  that state reads `model: the bundled bridge · /setup for your own provider`,
  and a `models.json` that does not parse reads as unreadable rather than
  unconfigured. Once a provider exists the chip is gone.

## Plan mode

Plan mode is a read-only exploration phase with an explicit approval gate before anything changes. Start it three ways: `unown --plan` (print or TUI), `/plan` in the TUI, or Ctrl+Alt+P.

While planning:

- `edit`, `write`, and the `task` tool are disabled; `read`, `bash`, `grep`, `find`, `ls`, `todo`, `note`, `fetch_url`, `web_search`, `webfetch`, `lsp` (code intelligence is read-only; web tools are read-only), and `ask_user_question` (clarifying questions are read-only) stay available.
- `bash` is restricted to an allowlist of read-only commands — `cat`, `head`, `tail`, `grep`, `find`, `ls`, `diff`, `stat`, `git status/log/diff/show`, `npm list/view`, `curl`, `jq`, `awk`, and similar. Anything that writes, installs, kills, or mutates git state is blocked with a reason. (The full allow/deny pattern lists live in `tools.ts`.)

The flow:

1. The agent explores the codebase and asks clarifying questions in plain text where requirements are ambiguous.
2. It produces a numbered plan under a `Plan:` header.
3. You choose: **Execute the plan (track progress)**, **Stay in plan mode**, or **Refine the plan** (opens an editor; your refinement is fed back).
4. On execution, full tool access is restored. The agent marks each completed step with a `[DONE:n]` tag, and the status line shows `plan 3/7` style progress plus a checklist widget.

Plan state is persisted as session entries, so a plan survives `/resume`. In print mode (`unown -p --plan ...`) there is no approval dialog — the run stays read-only and the numbered plan is the output.

## Command reference

| Command | What it does |
|---|---|
| `unown` | Interactive session in the current directory |
| `unown "do something"` | Interactive session starting with a prompt |
| `unown -p "prompt"` | One-shot headless run (print mode) |
| `unown --plan [...]` | Start (print or TUI) in plan mode; also `/plan`, Ctrl+Alt+P |
| `unown setup` | Connect a model provider — interactive wizard. Presets: `bridge` (bundled), `openai`, `openrouter`, `anthropic`, `dashscope`, `deepseek`, `agnes`, `custom` (any OpenAI-compatible endpoint). Adding KEEPS existing providers; `--force` resets to one |
| `unown setup --provider openai --api-key sk-... --model gpt-4o` | Non-interactive (scripts/CI). `--key-env VAR` stores a `$VAR` reference instead of the secret; `--force` resets; `--list` prints the presets |
| `unown models` | List configured models, plus what a local bridge serves |
| `unown providers <sub>` | Manage the multi-provider registry — `list` \| `add` (preset or custom; `--key-env VAR` stores a `$VAR` reference) \| `remove` \| `key` (rotation with live verification) \| `default` (validated) \| `test` (live probe, actionable 401/404 classification) \| `refresh` (re-probe every provider). Adding KEEPS existing providers. In-session twin: `/providers`. See [providers](providers.md) |
| `unown dashboard` | The fullscreen [TUI dashboard](tui-dashboard-plan.md) (`unown dash` works) — the engine's live feed across 11 screens (Overview, Memory, Dreams, Notes, Skills, Learning Lab, Hooks, Router incl. sandboxes, Gateway, Automations, Web Cache), rendered on the same pi-tui stack as the agent and authenticated to :3030 with the M7 bearer token; needs an interactive terminal (non-TTY exits with guidance). In-session twin: `/dashboard` (`/dash`) |
| `unown init` | Scaffold `.unown/` project memory (`memory/project.md`, `memory/local.md`, `.gitignore`) |
| `unown init-agents` | Generate or update the root `AGENTS.md` from repo forensics — language / framework / test-runner / lint / build detection. `--overwrite` writes, `--print` prints, `--json` is machine-readable; the in-session `/init-agents` previews without writing |
| `unown memory` | Print the effective 4-tier memory stack |
| `unown doctor` | Run configuration diagnostics — `--json` emits a machine-readable report (`{ok, version, checks[{id,status,detail}], summary}`; non-zero exit on failure — scriptable, CI-able) |
| `unown doctor-instructions` | Run only the instruction-set audit — AGENTS.md freshness, skills, MCP, hooks, adversary mode, injection scanner, stale config, unicode integrity (the same eight sections `unown doctor` folds into its `instruction-set audit` row). `--json` |
| `unown mcp <sub>` | Manage MCP servers — `add` \| `add-http` \| `add-json` \| `list` \| `get` \| `remove` \| `test` \| `elicitation`. See [Managing MCP servers](#managing-mcp-servers-unown-mcp) |
| `unown info` | Print the support bundle — version, platform, git state, provider names, opt-outs — redaction-safe for bug reports; `--json` for the same fields |
| `unown note "text"` | Deliver a session note to the engine by hand |
| `unown sessions <sub>` | Session export / import / list / delete / rename — `export <id> [--format <md\|json\|html>] [--out <file>] [--raw]` writes one portable JSON (`{version, manifest, messages, todos, notes, skills, files}`), a shareable **markdown transcript** (metadata header, todos, notes, the conversation with tool-call bullets and fenced tool results — the Codex `/export` / goose `session export md` lane), or a **standalone themed HTML page** (pi's own `/export` renderer — a self-styled archive you can open in any browser; the secret redaction runs over the raw JSONL *before* rendering, so a secret split by syntax highlighting can never slip through); `import <file>` rehydrates under a fresh id (or converts a Claude Code / Codex session .jsonl via `--from <auto\|claude\|codex>`); `list [--all]` shows sessions with id / createdAt / messageCount / touchedFiles / **name**; `delete <id\|name> [--force]` removes the session file (refuses multi-match ambiguity and a just-written "live" file unless `--force`); `rename <id\|name> <new-name>` appends a `session_info` title the resume lane resolves immediately (the offline lane for what `/name` does live). **Both stores are scanned** — the project's `.unown/sessions` imports *and* `~/.unown/agent/sessions` (where every real TUI / print session is persisted, filtered to this project by the session header's cwd; `--all` drops the project filter). Exports are secrets-redacted by default (`[REDACTED:<type>]` markers; `--raw` opts out). In-session alias: `/sessions` (`export --md`, `list [--all]`, `import <file>`) |
| `unown import` | **One-command config migration from the other agents** (Claude Code `/import` parity, pointed this way): `unown import [--from <auto\|claude-code\|codex\|gemini\|cursor\|opencode>] [--dry-run] [--lane <instructions\|commands\|skills\|agents\|mcp>]... [--home <dir>]` — `--list` surveys what each source could contribute. Instructions (CLAUDE.md / GEMINI.md / codex AGENTS.md / cursor `.mdc` rules) append to `AGENTS.md` under a marked comment section; Claude Code commands are already unown's contract (copies), Gemini TOML commands convert to markdown (`{{args}}` → `$ARGUMENTS`), skills and agent files land in `.unown/skills/` + `.unown/agents/`; MCP servers (`.mcp.json`, `~/.claude.json`, codex `config.toml [mcp_servers.*]`, gemini `settings.json`) merge into `.unown/mcp.json`. **Never overwrites** — an existing target is skipped with the reason, existing unown MCP servers win, a re-run of the same source appends nothing. `--home <dir>` scans a different home (backup/migration support) |
| `unown worktrees <sub>` | **Manage the session worktrees** — `list` (live status of every managed tree under `.unown/worktrees/`: dirty files, commits ahead) · `remove <name> [--force]` (removes a kept tree; dirty trees need `--force` after review). The trees `unown --worktree` sessions leave behind |
| `unown blame [file]` | Receipts-backed blame — which sessions and tool calls touched `<file>` (write/edit/bash, grouped by session); no argument prints a whole-ledger summary (counts by tool, files written). Flags: `--session <id>`, `--since <ts>` (epoch-ms, ISO 8601 or relative seconds like `300s`), `--json`. The CLI twin of the `/blame` session command |
| `unown recipes <sub>` | Declarative agent instruction bundles (the goose Recipes port) — `list` \| `run <name> [--key value]` \| `create <name>` \| `validate <file>`; discovered from `.unown/recipes/*.md` + `$UNOWN_HOME/recipes/*.md`. In-session alias: `/recipe`. See [recipes](recipes.md) |
| `unown wiki <sub>` | Auto-generated repo documentation with `file:line` cross-links (the zcode Repo Wiki port) — `generate [--force]` \| `search <q>` \| `list` \| `show <page>`; written to `.unown/wiki/*.md`. In-session alias: `/wiki`. See [repo wiki](repo-wiki.md) |
| `unown acp` | Run the ACP editor server on stdio (JSON-RPC 2.0, newline-delimited) — point Zed or any ACP client at it: agent program `unown`, args `acp`. See [acp](acp.md) |
| `unown routines <sub>` | Scheduled recurring agent runs — `list` \| `create` \| `edit` \| `pause` \| `resume` \| `run` \| `skip` \| `snooze` \| `history` \| `delete` \| `trigger <event> [--payload '<json>']` (dispatch an event locally) \| `hook-url` (the curl-able inbound webhook URL). Schedules: cron, `every` intervals (`2d at 09:00`), `after` (completion-anchored), one-shot, and **event** (`--on-event <name> [--filter <expr>]` — fired by inbound webhooks, never the clock); per-routine timezone + misfire policy. Needs the engine running; default mode `read-only`. See [Routines](#routines-unown-routines) (`unown automations` is the alias) |
| `unown watch <sub>` | AI comments in code, resolved by the always-on engine (aider's `--watch-files` semantics) — `list` (scan now: kind badges + new/seen, never dispatches) \| `run` (force one scan+resolve pass NOW) \| `roots` (discovered watch roots). Markers `# AI:` / `# AI!` / `# AI?` (+ `//`, `--`, `;` families); projects opt in via `.unown/watch.json`; default mode `report` (read-only); hash-deduped — quiet scans cost zero LLM. See [watch](watch.md) |
| `unown ralph "<task>"` | The worker→reviewer loop (goose's Ralph pattern): fresh-context iterations, state handed off through files (`.unown/ralph/<run>/`), reviewer answers `VERDICT: SHIP` or `REVISE`; `--iterations` (default 5, max 20), `--model`, `--reviewer-model` (use a DIFFERENT model — cross-model review is the point), `--workspace`, `--json`. Exit 0 shipped, 1 budget exhausted, 2 usage. See [ralph](ralph.md) |
| `unown repomap [path]` | The graph-ranked repo map (aider's repomap on tree-sitter): symbols + reference ranking in a token budget; fresh subagents get a 512-token map appended automatically (never blocks the spawn). `--tokens N`, `--refresh`, `clear` (drop the tag cache), `--json`; in-session `/repomap`. Env: `UNOWN_REPOMAP=0` off, `UNOWN_REPOMAP_TOKENS`, `UNOWN_REPOMAP_MAX_FILES`, `UNOWN_REPOMAP_TIMEOUT_MS`. See [repomap](repomap.md) |
| `/promote` | Standing orders + promotion (OpenClaw's convention): a `## Program:` section (Authority / Trigger / Approval gate / Escalation / What NOT to do) in `.unown/standing-orders.md` (project) or `~/.unown/agent/standing-orders.md` (global; project overrides per program id) rides every routine run in its workspace as a budgeted digest with the Execute-Verify-Report loop. `/promote` distills the session into a Program draft; `save project|global` appends it; `schedule <spec>` creates the routine (prompt REFERENCES the order), test-runs it once and auto-removes it if the test fails. See [standing orders](standing-orders.md) |
| `unown engine <sub>` | The detached self-learning engine — `status` (pid, uptime, active job, which jobs FAILED their last run or never ran, budget/breaker, outbox, auto-start circuit, OS-service state) \| `start` (spawn detached if down, wait for health — resets the crash-loop circuit) \| `stop` (graceful drain: finish in-flight requests, checkpoint the WAL, release the lock; a foreign engine is refused unless `--force --pid <verified pid>`) \| `restart` (pick up the current build: busy-aware stop + fresh spawn — refuses to cut an active job without `--force`; a foreign engine is refused unless `--take-ownership`) \| `repair` (quarantine a corrupt DB — backs it up aside and boots fresh; memory files and queued notes survive by design) \| `serve` (run in the foreground — the systemd/launchd/Windows-service entry; loads the checkout `.env` itself) \| `install` (the ALWAYS-ON layer: install the per-user OS login service — systemd user unit / launchd LaunchAgent / Windows scheduled task, with a hidden HKCU-Run PowerShell watchdog when Windows denies task registration without admin — that runs `engine serve` at login and restarts it on crash, so memory + routines work after a reboot with no agent invoked; `agent:install` and `unown update` run it for you via `--auto`, which skips in CI, under `UNOWN_ENGINE_AUTOSTART=0` or `UNOWN_NO_ENGINE_SERVICE=1`, and after an uninstall; idempotent, re-run to repair drift) \| `uninstall` (stop + remove that service; the opt-out is remembered so the next install/update does not re-add it). Session-note delivery auto-starts the engine when it is down, the routines CLI and the dashboard boot spawn it too, so the terminal agent never needs it running to be useful. See [the detached engine](detached-engine-architecture.md), [engine resilience](resilience.md) and [routines · always-on](routines.md#always-on-the-engine-service) |
| `unown usage` | Token/latency/cost report over the bridge's persistent usage log — `--days N`, `--model M`, `--json`. See [Usage tracking](usage-tracking.md) |
| `unown webcache <sub>` | Inspect the [web results store](#web-search--webfetch) — `stats` (entries, size vs the byte cap, TTLs, hit rate, saved upstream requests, top providers; `--json` for the raw object; the default) \| `clear` (remove every entry) \| `sweep` (run the byte-capped LRU eviction pass on demand) |
| `unown update` | Check for a newer release and self-update — mode-aware: a source checkout fast-forwards to the newest ready tag and re-runs the installer; a binary install validates the `release.json` manifest, selects the asset for this OS/arch, checks its size/SHA-256 and swaps the versioned binary. Flags: `--check` (report only; exit `2` when an applicable update is available, `0` up-to-date or not published for this platform, `1` error), `--check --json`, `--allow-dirty` (checkout), `--rollback`, `--dry-run`, `--skip [version]`, `--unskip`, `--snooze <30m|12h|7d>`, or an explicit version (`unown update X.Y.Z` — also pins/rolls back). See [updating](updating.md) |
| `unown changelog [n]` | Print the latest `CHANGELOG.md` sections (default 1) |
| `unown completions <shell>` | Print a completion script — `bash` \| `zsh` \| `fish` \| `powershell` (stdout; installation one-liners in `unown completions --help` and below) |
| `unown uninstall` | Remove the CLI — mode-aware: checkout shims only, or a binary install's shims + versioned root + `install.json`; `--dry-run`, `--purge-data` (~/.unown), `--purge-checkout` (the repo; source mode, refuses uncommitted work). See [install → uninstalling](install.md#uninstalling) |
| `unown --help` / `-h` | Help text |
| `unown --version` / `-V` | Print the version (matches `package.json`; CI asserts the contract) |

An engine the CLI cannot use is reported as **BLOCKED**, never spawned over: a 401 from another install's token, a port held by a non-Unown process, an incompatible build, or a hung listener. Only a refused port authorises auto-start; a blocked probe records the cause without counting a failed start. See [resilience · R11](resilience.md#r11--engine-blocked-by-another-ownerport).

`-v` / `--verbose` works in session modes: hook decisions and tool activity are printed to stderr.

**Shell completions.** Install once per shell:

```bash
unown completions bash > ~/.local/share/bash-completion/completions/unown   # bash
unown completions zsh  > ~/.zfunc/_unown                                  # zsh (compinit on)
unown completions fish > ~/.config/fish/completions/unown.fish           # fish
unown completions powershell >> $PROFILE                                  # PowerShell
```

**Subagent plumbing flags.** `--mode json` (JSON event stream), `--no-session` (don't persist), `--tools a,b,c` (restrict the active toolset), `--append-system-prompt <file>` (append file contents to the system prompt) and `--session <path>` (continue that exact session file — TUI or print mode; the [fleet](subagents.md#the-interactive-fleet-async-subagents) runs its async children on it, which is what makes resume-by-name work) exist for the `task` tool, which spawns subagents with exactly these flags. You normally never type them yourself — see [subagents](subagents.md).

**Routing flags.** `--model <id>` (the model for this run — a bare id or the canonical `provider/model` form, e.g. `agnes/agnes-3.0-flash`; multi-provider routing over the registry), `--provider <id>` (pin the provider; its default model is used unless `--model` also names one), `--effort low|medium|high` (`low` → `BRIDGE_QWEN_THINKING=0`, `high` → `=1`, `medium`/unset → the bridge default), `--mcp-servers a,b` (MCP server whitelist — an **empty CSV loads none**), `--no-agents-md` (skip AGENTS.md / per-tier memory injection), and `--no-split` (start the TUI bare — no split-view panels, ignoring saved startup defaults; see [split view](split-view.md)) are accepted on any launch — TUI or print — and route that whole session. The `task` tool passes the same flags to per-agent children from `.unown/agents/*.md` frontmatter (`model` / `effort` / `mcpServers` / `injectAgentsMd`), and `UNOWN_SUBAGENT_MODEL` overrides the model for **every** subagent in one line. See [subagents → per-agent routing](subagents.md#per-agent-routing) and [providers → multiple providers](providers.md#multiple-providers).

**Trust flags (2026-10-24).** `--permission-mode <default|acceptEdits|bypassPermissions>` pins the session's permission mode from the first tool call onward — the launch twin of `/permissions mode` (the config files are never written; strict hooks still refuse `bypassPermissions`). `--add-dir <path>` (repeatable) grants additional working directories — write tools and bash redirects may target them for this session, the `/add-dir` twin at launch. See [permissions → modes](permissions.md#modes) and [permissions → additional working directories](permissions.md#additional-working-directories---add-dir--add-dir-2026-10-24).

**Resume flags (2026-10-24; the picker joined 2026-10-25).** `unown -c` / `--continue` reopens THIS directory's latest session (the header `cwd` decides; TUI, or print mode with `-p "…"` to resume-and-run); `unown --resume <id|name|path>` / `-r` resolves a session by id (full or prefix — the uuid in the filename), by **name** (case-insensitive substring over the latest session name — auto-titles and `/name` both land there), or by exact file path (the `--session` spelling). Ambiguous name matches list the newest five candidates instead of guessing; both stores are scanned (`~/.unown/agent/sessions` + the project's `.unown/sessions` imports); failure is exit 1 with the actionable message. The landing notice goes to stderr, so `--output-format json` stdout stays a clean contract. **Bare `unown --resume`** (no argument, interactive TTY) opens the launch-time session picker — pi's own selector over both stores, this project's sessions plus imports (Claude Code `claude --resume` / Codex `codex resume` / Gemini `/resume` parity); cancel exits 0, and in pipes it is refused with exit 2 pointing at `--resume <id|name>` and `-c`. The in-session `/resume` picker remains the fuzzy browser; `--session <path>` stays the fleet's exact-file lane.

**Session worktrees (2026-10-24).** `unown --worktree [name]` / `-w` (Claude Code `--worktree` / Codex `--worktree` / Gemini `-w` parity) runs THE session inside a managed git worktree at the repo's HEAD — parallel work without stashing. Works in TUI and print mode; the startup notice names the tree and the base commit. Fail-closed outside a git repo (exit 1 with the typed reason — never a silent shared-checkout run). On exit the remove_if_clean policy runs: an untouched tree is removed automatically, a tree with changes (or commits) is **kept for review — nothing is ever auto-merged**; `unown worktrees list` shows what's kept and `unown worktrees remove <name>` cleans up after your merge. The session's own `.unown/` runtime state (memory scaffold, receipts) does not count as changes — a session that produced no work still cleans up.

**Project settings (2026-10-24).** `.unown/settings.json` (trust-gated like every project config) pins per-project session defaults: `model`, `provider`, `effort`, `permissionMode`, `addDirs`. Precedence: **CLI flags > project settings > user defaults** — a flag the command line set is never overwritten. `/project-settings` shows the live state, `/project-settings trust` approves the file (effective from the next session in that project). See [configuration → project settings](configuration.md#project-settings-unownsettingsjson-2026-10-24).

**CI flags (2026-10-24).** `--max-turns <N>` bounds the headless run to N completed model turns — the (N+1)th model call is aborted (pi's own abort path, the Ctrl-C semantics), the answer produced so far stands, and the `--output-format json` envelope gains `capped: true` plus a `num_turns` that counts completed turns only. `--max-tool-repetitions <N>` is the **loop guard** (goose `--max-tool-repetitions` parity): when the SAME tool is called with the SAME arguments N times consecutively — the classic degenerate headless failure (a retry spiral against a wedged tool, a read-the-same-file-forever loop) — the agent loop is aborted, the tool is named on stderr, the `--output-format json` envelope gains `loop_guard: {tool, count, limit}`, and the run **exits 4**; a different tool or changed arguments in between resets the streak, so healthy retry-with-changes patterns never trip. `--output-schema <file.json>` validates the final answer against a JSON Schema (Codex `exec --output-schema` / Claude Code `--json-schema` parity): the answer is fence-stripped (` ```json ` wrappers the model pads with), parsed, and validated — a mismatch prints the JSON-path issues to stderr and **exits 3**; the JSON envelope gains `schema_valid` / `schema_issues`. All three compose with `--output-format json`; `--output-schema` is refused with `--mode json` (an event stream has no single final answer). Print-mode exit codes: **0** success (a `--max-turns` cap with an answer is still 0 — `capped: true` is the signal) · **1** run error / empty answer · **2** usage errors · **3** schema validation failed · **4** the `--max-tool-repetitions` loop guard tripped.

**`unown doctor`** checks, in order: the unown version and update-check state (from the notifier cache — no network), the user-state schema version, the agent dir and `models.json`, the memory stack, model-endpoint reachability (and credentials), bridge upstream key / upstream health / model routability when pointed at the bundled bridge, the OS sandbox (platform-aware: bubblewrap on Linux, seatbelt on macOS, the Windows path-jail story), the self-learning engine, and the SDLC surfaces: **lsp-servers** (which language servers are detected on PATH — a warning here just means the optional diagnostics loop is inactive), **mcp-config** (configured servers, config-validation problems, and the project-config trust state — an untrusted `.unown/mcp.json` warns with the `/mcp trust` action), **unown-state** (disk usage of the project's `.unown/` runtime state — checkpoints, receipts, reviews; warns past `UNOWN_STATE_WARN_BYTES`, default 512 MiB, with pruning guidance), **permissions-config** (files, mode, trust gate and learn state of the granular permissions layer), **web-results-store** (the persistent [web results store](#web-search--webfetch) behind `web_search`/`webfetch` — entry count, size, hit rate and saved upstream requests, or the disabled note when `UNOWN_WEB_CACHE=0`; also `unown webcache stats`), **path-shim** (a foreign `unown` earlier on PATH), and the **instruction-set-audit** — eight sections covering AGENTS.md freshness, skills coverage, MCP health, hooks config validity (`.unown/hooks.json` + `~/.unown/agent/hooks.json`), adversary-mode state, injection-scanner state, stale `.unown/` config, and unicode integrity (the invisible-Unicode backdoor scan over the instruction files, staged skills included — 2026-10-22 hardening); `unown doctor-instructions` runs just that audit. It exits 1 when chat is broken; warnings only affect learning features (notes queue in the outbox until the engine returns). If it fails, see [troubleshooting](troubleshooting.md).

## Session tools

Every unown session registers **seventeen** unown tools on top of pi's built-ins — `read`/`bash`/`edit`/`write` plus the **default-active search tools** `grep`/`find`/`ls` (enabled when their binaries answer on PATH; `ls` is pure JS and always on; a configured settings `defaultTools` or an explicit `--tools` list still wins; `powershell` on Windows); `todo` and `ask_user_question` ride the [addon framework](addons.md) and are user-configurable:

| Tool | What the agent does with it |
|---|---|
| `todo` | The [addon](addons.md)-era task graph: `create` / `update` / `list` / `get` / `delete` / `clear` over a 4-state machine (`pending` → `in_progress` → `completed`, plus deleted tombstones), with `blockedBy` dependencies (cycle-rejecting), `activeForm` progress labels and free-form `metadata`. A live panel above the editor tracks it (completed rows fade at the next turn; `/todos` prints the grouped view). State rides session entries, so branching (`/fork`, `/tree`) keeps the right list. |
| `ask_user_question` | Asks you up to 4 structured questions mid-run (2–4 options each, optional side-by-side previews, multi-select, per-question notes) in a tabbed dialog — the tool **blocks the agent until you answer**, so the turn continues with your decision. A "Type something." free-text row is always appended; Esc declines. Stripped from the toolset in headless sessions (print mode / subagents) where nobody could answer. |
| `task` | Spawns [subagents](subagents.md) with a fresh context window — `general` (full tools), `explore` (read-only), `scout` (compressed recon handoff on cheap routing), `worker` (completion-guarded implementation), `reviewer` (P0/P1/P2 + merge verdict), `planner` (writes `plan.md`, never executes), the cheap `background-explore` lane, or your own `.unown/agents/*.md` definitions (with per-agent `model`/`effort`/`mcpServers`/`injectAgentsMd` routing, `advertise`/`completionGuard`/`fallbackModels`/`context` catalog knobs). Up to 4 tasks per call, executed in parallel, each reported LIVE on its own row while it runs (`⟳ 2 turns, 4 tools in bash · 12s`) — the children's own turn/tool events, which the parent already parses for the final result; the roster is advertised to the model each turn via the [advertised catalog](subagents.md#the-advertised-catalog). `async: true` + `name` spawn into the [interactive fleet](subagents.md#the-interactive-fleet-async-subagents) instead: immediate ack, live status, results delivered as new turns — steerable, resumable. |
| `task_control` | The [fleet](subagents.md#steering-and-control-task_control) control surface for async subagents: `steer` (mid-run course correction; on a finished child it **resumes** it with full context), `stop`, `status`, `list` — and the answer channel for a subagent's `ask_question`. Registered in every session that is not itself a subagent. |
| `note` | Records a durable learning note mid-session — delivered to the engine immediately (or queued in the outbox if it is down). AutoDream consolidates notes into project memory. Also `/note <text>`. |
| `browser` | Drives a real Chromium over CDP — the full [browser reference](browser.md) covers the work loop (navigate → snapshot → act on `[eN]` refs), all 32 actions (forms, tabs, cookies, console, network, eval, PDF), screenshots that come back as image blocks vision models see directly, launch-or-attach, and the persistent profile. |
| `fetch_url` | Read-only HTTP GET. Now delegates to the hardened webfetch pipeline (below): private-address SSRF guard, robots-aware, extraction fallback chain; output is capped at 12,000 chars by default (`max_chars` clamps to 500–60,000). |
| `web_search` | Searches the live web — ranked results (title, URL, snippet) with provider auto-selection: any configured API key (Tavily/Brave/Serper/Exa/Perplexity/Jina/Zhipu/DashScope/Kagi/SerpApi/Firecrawl) is used first, then the keyless chain (SearXNG if configured → DuckDuckGo → Tavily keyless → You.com → StackExchange → Wikipedia → HN → npm registry → GitHub repos). `allowed_domains`/`blocked_domains` filter results (Claude Code parity). `UNOWN_WEB_SEARCH=0` disables. Answers flow through the shared [web results store](#web-search--webfetch). |
| `webfetch` | Fetches an http(s) URL as text — same hardening as `fetch_url` (SSRF guard, robots.txt, 4 MB body cap) plus an extraction fallback chain for sites that block plain HTTP clients: direct fetch → Tavily extract (keyless-capable) → Jina reader (keyed) → Firecrawl (keyed). Default cap 20,000 chars (`max_chars` clamps 500–200,000); `raw: true` skips HTML stripping. `UNOWN_WEBFETCH=0` disables. Answers flow through the shared [web results store](#web-search--webfetch). |
| `lsp` | Language-server code intelligence: `diagnostics` (per file or `all`), `hover`, `definition`, `references`, `symbols`, `status`. Auto-detects servers on PATH (typescript-language-server, pyright/pylsp, gopls, rust-analyzer, clangd, bash-language-server, ruby-lsp, intelephense); configure or override with `.unown/lsp.json` / `~/.unown/agent/lsp.json`. After every `write`/`edit`, fresh diagnostics for that file are appended to the tool result — type errors get fed back to the agent instead of compounding (cold start never blocks; `UNOWN_LSP=0` disables). Also `/lsp`. |
| `get_context_remaining` | Reports the live context budget — `{tokensUsed, maxTokens, remainingTokens, remainingPercent}` from pi's `getContextUsage()` seam, falling back to a chars/4 estimate of the message history; `maxTokens` resolves from `PI_MAX_TOKENS` → the session's context window → a 200,000 default. |
| `view_image` | Loads an image file (PNG / JPEG / GIF / WebP, ≤ 4 MB, magic-byte validated) from the project dir or the system tmp dir as a vision-format image block — jail-checked like `write`/`edit`; missing/non-image/too-big/jail-escape are typed errors. |
| `monitor` | Watches a long-running command for a **bounded window** (Claude Code Monitor tool parity): `command` (e.g. `tail -f app.log`, `npm run dev`), `duration_ms` (default 30000, cap 120000), `max_lines` (default 200, cap 2000), `stop_pattern` (a regex that ends the watch the moment it matches — the `listening on\|ready in` case). Captures each stdout/stderr line with a timestamp and returns them as one bounded result (tail-capped at 200 lines); ends on window expiry, the line cap, process exit, the stop pattern or session abort — call it again to keep following. The bash deny-list applies to watched commands exactly as to one-shot bash, and plan mode allows only the read-only allowlist. |
| `routine_list` | List this project's scheduled [routines](#routines-unown-routines) — id, schedule, next run, last outcome. Registered in every session. |
| `routine_create` \| `routine_update` \| `routine_run` \| `routine_delete` | Create / edit / trigger-now / delete [routines](#routines-unown-routines) (any schedule kind, per-routine timezone + misfire). Hidden inside routine runs and subagents — no recursion. |
| `automation_create` | Create a scheduled automation (cron in the local timezone, or a one-shot `--delay-minutes`) — default mode `read-only`. Registered only in interactive sessions: hidden inside subagents and inside automation runs themselves, so a scheduled run cannot schedule more runs. |
| `automation_update` | Edit an automation (title / prompt / cron / mode / max-runs) or pause/resume it — interactive sessions only. |
| `automation_delete` | Delete an automation and its non-running history — interactive sessions only. |

One more addon surface registers **no tool**: the [advisor](addons.md#advisor) — a second model that watches the session as compact per-turn deltas, verifies claims with read-only tools, and sends advice mid-run (nits queue as asides at the next turn boundary; concerns and blockers steer immediately). It ships **off by default**; `/advisor on` or the `/addons` configurator enable it, with its model, cadence and budgets tunable in `~/.unown/agent/addons.json`.

**Verify-first defaults** (2026-10): the base system prompt carries the quality doctrine — read a file before editing it, keep changes minimal, plan multi-step work, never weaken tests, run the project's checks before declaring work done — and after every `write`/`edit` of a non-doc file the session runs the project's own check command (`typecheck`, else `lint`, detected from package.json scripts / `Makefile` / `pyproject.toml`) and feeds failures back into the tool result as an error, alongside the LSP diagnostics above: a broken edit is a failed edit the model immediately fixes. Silent on pass, cooldown-throttled (20 s), fail-open on every path; `UNOWN_AUTO_VERIFY=0` disables the gate, `UNOWN_AUTO_TEST=1` opts the test suite into the same loop (own 300 s timeout, 60 s cooldown). The Tier-0 policy seed carries the same guardrails and is seeded on first use; `unown init` writes them into the project's `AGENTS.md` as a Verification section. Details: [BEHAVIOR: verify-first defaults](BEHAVIOR.md#verify-first-defaults-2026-10-22).

When you quit a session in which something happened, a session note (prompt count, tool calls, final outcome) is delivered to the engine — or written to `~/.unown/notes/outbox/` if the engine is down, and synced later. That note is the raw material AutoDream consolidates into `.unown/memory/project.md`.

## Web search + webfetch

Both tools ship **keyless-first**: with zero configuration the agent can search the web and read pages. The provider chain resolves at call time from the environment — [configuration](configuration.md#terminal-agent-unown-cli) has the full table.

- **Keyless chain** (no signup, out of the box): SearXNG (when `UNOWN_SEARXNG_URL` points at a self-hosted instance) → DuckDuckGo → Tavily in keyless mode → You.com free MCP (100 q/day) → StackExchange (300 q/day per IP) → Wikipedia → HN Algolia → npm registry (package research) → GitHub repos (10 req/min per IP, `GITHUB_TOKEN` lifts it). Cloud/datacenter IPs get challenged by DuckDuckGo and throttled by StackExchange — the chain detects both and cascades (the failure notes are surfaced in the tool result).
- **Paid providers** (any key that is set joins the chain ahead of the keyless fallbacks, in quality-then-cost order): Tavily, Serper, Exa, Brave, Perplexity, DashScope (Qwen `enable_search` grounding — **standard keys only**: coding-plan keys `sk-sp-…` are refused up front with an actionable note, because the coding endpoints silently ignore `enable_search` and the standard endpoints reject those keys; verified live 2026-10-19), Jina, Zhipu, Firecrawl, Kagi, SerpApi.
- **Explicit control**: `UNOWN_WEB_SEARCH_PROVIDER=tavily` (or a comma chain), or the tool's `provider` parameter per call.
- **Hardening**: `webfetch` refuses private/reserved hosts and non-standard ports (DNS-resolved, not just literal — the SSRF gap `fetch_url` had [was closed](testing-strategy.md)), honors robots.txt (cached 15 min per host; `UNOWN_WEBFETCH_ALLOW_PRIVATE=1` opts out for internal mirrors), caps bodies at 4 MB, and falls back to extraction services when a site blocks plain HTTP clients.

**The web results store.** Every `web_search` answer and fetched page comes through a persistent, user-scoped store at `~/.unown/cache/web/` (see [configuration](configuration.md#terminal-agent-unown-cli)) — one store shared across sessions, subagents, engine runs and automations, so an identical query or URL is answered once. Search results stay fresh for 60 min (`UNOWN_WEB_SEARCH_CACHE_TTL_MS`); fetched pages honor the origin's Cache-Control (heuristic default 30 min, capped at 24 h; `UNOWN_WEBFETCH_CACHE_TTL_MS`) and revalidate via ETag/Last-Modified with a conditional GET — a 304 means the page did not change and the stored body is re-served without a full fetch. Past TTL but inside the window, a stale answer serves *instantly* — marked `· stale — refreshing in background` — while a single background refresh restores freshness for the next identical call (stale-while-revalidate, RFC 5861; `UNOWN_WEB_CACHE_SWR=0` restores blocking semantics). When every upstream attempt fails (quota exhausted, network down), the last good answer still serves within a bounded stale-if-error window (24 h search / 7 d fetch) and is always flagged as stale. The provenance rides every answer — `· cached (12m old)`, `· revalidated (unchanged, 2h old)`, `· stale — refreshing in background (61m old)`, `· STALE — served after provider error (3h old)` — and the store is inspectable with `unown webcache stats | clear | sweep` (plus the `unown doctor` line); `UNOWN_WEB_CACHE=0` is the kill switch. Under the hood a small in-memory index keeps `stats`/eviction off the disk-scan path (counts are per-process approximations, labeled as such) and a bounded memo serves hot entries without touching the disk — measured receipts: [`benchmarks/webcache/`](../benchmarks/webcache/RESULTS.md).

The live provider matrix (which providers verified working from this network, with latencies and receipts) lives in `benchmarks/websearch-live/` — rerun it any time with `bun scripts/websearch-live.mjs`.

In engine **sandbox runs**, the web tools only register when the sandbox network namespace is shared (`UNOWN_SANDBOX_NET=1`) — the default bubblewrap isolation kills the network, so the tools would be dead weight there. Terminal sessions are unaffected.

## Checkpoints and receipts

Every session also keeps a **receipts audit ledger** and a **checkpoint store** under `.unown/` (both gitignored, per-machine):

- **Receipts** (`.unown/receipts/<session>.jsonl`, one file per session boot): the ordered audit — session starts, every prompt (first 200 chars), every tool call with its input (file paths, commands, URLs, tasks; inputs capped at 4 KB), every result (ok/fail, usage), every checkpoint and restore. `/receipts [n]` prints the last n entries plus totals (tool calls by tool, distinct files written, errors, checkpoints, restores). Subagent processes write their own ledger (marked `[subagent]`).
- **Checkpoints** (`.unown/checkpoints/`): content-addressed blob snapshots. A **turn checkpoint** is sealed automatically whenever a turn wrote files — it stores the *pre-turn* state of every file that changed (files that did not exist before are tombstoned). **Named checkpoints** snapshot the current state of every file the session touched. The same store also holds the **redo stack**: what `/undo` overwrites is captured before it is reverted, so undone work can be put back.

| Command | What it does |
|---|---|
| `/checkpoint [label]` | Snapshot the current state of every file this session touched (bash-caused changes are not tracked file-by-file) |
| `/undo [n\|--all]` | Revert the file changes of the last n turn(s) (default 1) — restores pre-turn states; new files created this turn are deleted. Only **this session's** turns by default; `--all` also consumes other sessions'/subagents' turns. The overwritten content lands on the redo stack |
| `/redo [n\|--all]` | Re-apply the last n undone change(s) (default 1) — the inverse of `/undo`, popping the redo stack newest-first. Only **this session's** undos by default; `--all` also re-applies other sessions' |
| `/restore <id\|label>` | Rewrite the files of a named (or turn) checkpoint; prefix matching works |
| `/checkpoints` | List checkpoints (turn + named) with the blob-store size and this session's redo depth |
| `/receipts [n]` | Show the audit ledger — last n entries (default 20) + totals |
| `/permissions` | Show the granular-permissions state — mode (and whether it is a session override), additional dirs, project-config trust, and the full rule table (tool / effect / pattern / source file). `/permissions mode <default\|acceptEdits\|bypassPermissions>` switches the session mode (config files are never written); `/permissions trust` approves a project `.unown/permissions.json`. See [Permissions](permissions.md) |
| `/add-dir <path>` | Grant the session an additional working directory (write access) for cross-repo work — session-scoped; bare `/add-dir` lists, `/add-dir clear` revokes. The `--add-dir` flag is the launch twin. See [permissions → additional working directories](permissions.md#additional-working-directories---add-dir--add-dir-2026-10-24) |

**Undo/redo semantics** (the opencode/Cursor model): `/undo` captures, per undone turn and *before* restoring its before-images, the content it is about to overwrite into a redo entry — same content-addressed blob store, same sha256 verification, same project-dir jail on re-apply. `/redo [n]` pops entries newest-first (the exact reverse of the undo walk), so `/undo 2` + `/redo 2` restores the byte-identical pre-undo state, and `/redo 1` re-applies the most recently undone state. New files that `/undo` deleted are re-created; a file that did not exist when the undo captured it is deleted again. Any **new checkpoint** — a turn that writes files, or `/checkpoint` — clears the redo stack: new edits invalidate redo, the classic editor rule (clearing is global across sessions sharing the store, and is journaled as a note in the receipts ledger). One limit worth knowing: redo is not itself undoable — after `/redo`, `/undo` reverts earlier turns, not the redo.

Limits, stated plainly: bash-caused file changes appear in the ledger as commands but are not itemized per-file (no workspace diffing); `/undo` walks only this session's turn checkpoints by default (`--all` for the rest — across machines/copies of the repo there is no store); restore is jailed to the project directory by both a lexical and a realpath check (a symlink pointing outside the project is refused), and every blob is hash-verified on restore — a corrupt checkpoint reports `corrupt-blob` and touches nothing. Files larger than `UNOWN_CHECKPOINT_MAX_BLOB_BYTES` (default 64 MiB) are not snapshot: the turn still reverts its other files and the ledger notes the exception. Per session at most 40 checkpoints are kept (200 across sessions; oldest pruned, blobs garbage-collected with a 10-minute grace window so concurrent sessions never delete each other's in-flight snapshots); the redo stack is capped at 20 entries per session (60 across sessions, oldest pruned first).

## Git-native commits (/commit)

The aider/Codex workflow: an agent that edits a git repository should let you seal that work into history without handing over a shell. `/commit` stages and commits — never more:

```text
/commit                      # message generated from the session's work
/commit fix: login redirect  # your message, used verbatim
```

- **Scope** — `git add -A .` from the session's project directory (the same jail `write`/`edit` enforce): when you start unown in a subdirectory, only that subtree is staged. Already-staged changes elsewhere ride along in the commit (the index is committed as-is after staging).
- **Messages** — with an argument, used verbatim (multi-line included). Without one, a deterministic conventional-commit message is generated — `unown(session): <first line of the session's latest substantive assistant reply>` (sanitized, subject capped at 72 chars), or `unown(session): work snapshot <date>` when no session text is reachable. No extra model round-trip: the template is local and predictable.
- **Provenance trailers** — every unown commit closes with a trailer block: `Generated-by: unown` plus `Unown-Session: <session-id>` when the id is reachable (the Amp thread-ID pattern). The id is the same one `/session` prints and `/blame --session` filters by, so `git log` now leads straight back to the producing conversation — `git log --grep='Unown-Session: <id>'` finds every commit a session made. Your own words are never touched: with `/commit <message>` the trailer rides as a separate final paragraph below your text, exactly how git interprets trailer blocks.
- **Never pushes** — only `add` + `commit`, ever. Inspect with `git log -1`, undo with `git reset --soft HEAD~1`.
- **Your hooks run** — `git commit` executes your pre-commit/commit-msg hooks (husky, lint-staged…). A failing hook fails the commit with its stderr surfaced; a hung one is killed at 30 s. Read-only probes (status, rev-parse) always run with repo hooks disabled — hostile repo config never executes when we merely look.
- **Identity** — a fresh clone with no `user.name`/`user.email` anywhere still commits: the missing values are supplied per-invocation as `user.name=unown` / `user.email=unown@local` (never written to any config; your configured identity always wins when present).
- **Clean no-ops** — not a git repo, git missing from PATH, or a clean tree each produce a friendly message, never an error and never git's raw stderr.
- **Where it doesn't run** — inside subagents (`UNOWN_SUBAGENT=1`) and automation runs (`UNOWN_AUTOMATION=1`) `/commit` is an explicit no-op: commits belong to the interactive session that owns the project.

**Opt-in auto-commit on session end** — set `UNOWN_AUTO_COMMIT=1` (**default OFF**) and every session teardown that actually ends the session (`quit`, `/new`, `/resume`, `/fork` — not `reload`, which keeps the same session) commits pending project-dir changes as `unown(auto): session end snapshot <date>` (with the same provenance trailer block, `Unown-Session` included). This is a snapshot, not a publish: nothing is ever pushed, hooks still run, and a clean tree stays silent. Be aware it commits *everything* in the project dir — including files you had lying around uncommitted — so treat it as what it is, an opt-in aider-style workflow.

## MCP servers

unown is an MCP **client**: tools from any Model Context Protocol server appear in every session as `mcp__<server>__<tool>`. Configure servers in `.unown/mcp.json` (project) or `~/.unown/agent/mcp.json` (user; project wins per server name) — the Claude-Code-compatible shape:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
      "env": { "SOME_TOKEN": "${SOME_TOKEN}" }
    },
    "remote": { "url": "https://mcp.example.com/sse", "headers": { "Authorization": "Bearer ..." } }
  }
}
```

- **stdio servers** spawn as subprocesses (newline-delimited JSON-RPC; a pretty-print-tolerant parser); `${VAR}` expands from your environment in `command`, `args`, `env` values, URLs, `headers` and `cwd`. On Windows, commands spawn through `cmd.exe` so `npx`/`.cmd` shims resolve (metacharacters are escaped; commands or args that cannot be made safe — line breaks, unescapable `%` through `cmd.exe` — are refused before spawning).
- **Project configs are trust-gated**: a `.unown/mcp.json` inside a cloned repo configures command execution, so unown refuses to load it until you approve it — its servers are withheld (never spawned), `/mcp` shows the approval state, and `/mcp trust` approves the file (the approval pins a fingerprint of the file's path AND contents, so a later change re-enters the gated state). Files in `~/.unown/agent/` are yours and always trusted. Set `UNOWN_TRUST_PROJECT_CONFIG=1` to bypass in CI/headless runs. The same gate covers `.unown/lsp.json` project overrides.
- **Config problems surface instead of silently swallowing**: malformed JSON, entries with a bad shape, non-http(s) or unparseable URLs, and headers containing line breaks each produce an actionable problem (file + key + fix) shown by `/mcp`; the offending entry is skipped or its dangerous header dropped, never spawned as-is.
- **streamable HTTP servers** POST JSON-RPC with `Mcp-Session-Id` capture/replay; `application/json` and `text/event-stream` responses are both handled.
- **Connections are lazy and never block the session**: servers connect in the background at session start; a failed server marks itself `error` (last stderr kept as the hint) and cools down before reconnect attempts (30 s; `/mcp` force-throughs) — `/mcp` retries every server and reports status. Tools register the moment their server answers. A server that crashes mid-session rejects pending requests and recovers the same way; an HTTP server that rotated its session id (404) is transparently re-initialized once and the call replayed; 429/503 responses back off honoring `Retry-After`.
- Tools are capped (100 per server), descriptions capped at 500 chars, tool results at 16 k chars; requests time out after `UNOWN_MCP_TIMEOUT_MS` (default 120 s), the initialize handshake after `UNOWN_MCP_CONNECT_TIMEOUT_MS` (default 20 s). `UNOWN_MCP=0` or `disabled: true` in the config disables the surface.

## Managing MCP servers (`unown mcp`)

Hand-editing JSON is optional. `unown mcp` manages server entries with the same validation the session applies (a bad entry is rejected with the exact same message the config loader would produce):

| Command | What it does |
|---|---|
| `unown mcp list` | Table of configured servers across both scopes (user/project), type, command or URL, trust state for project entries |
| `unown mcp get <name>` | Full entry JSON + which file it comes from |
| `unown mcp add <name> <command> [args...]` | Add a stdio server (`--env KEY=VAL` repeatable, `--cwd <dir>`, `--scope user\|project` — default user) |
| `unown mcp add-http <name> <url>` | Add a streamable-HTTP server (`--header 'Name: Value'` repeatable, `--scope`) |
| `unown mcp add-json <name> '<json>'` | Add a raw entry (validated through the config normalizer) |
| `unown mcp remove <name>` | Remove from whichever scope has it (`--scope` disambiguates) |
| `unown mcp test <name>` | Live-connect probe: initialize + tools/list with short timeouts, reports tool count or the failure |

Writes are atomic read-modify-write (existing entries and unknown keys are preserved). `add --scope project` writes `.unown/mcp.json` and immediately trusts the exact content it wrote (you just typed it interactively) — a later hand-edit re-arms the trust gate, which `/mcp trust` in a session clears again.

## Code review (/review)

`/review` (TUI) runs a parallel-subagent review of your working tree — the oh-my-pi `/review` + Codex `/review` presets port:

- **Targets**: `/review` = uncommitted work (diff vs HEAD + untracked files); `/review <base-branch>` = what changed on this branch since it diverged from base (merge-base range). The diff snapshot is frozen before reviewers start, so mid-review edits cannot skew results; diffs cap at 40 k chars.
- **Reviewers**: read-only unown subagents with a review system prompt and a strict output contract. Small diffs (< 6 k chars) get one reviewer; larger diffs get three in parallel with split focuses — correctness/edge cases, security, tests/maintainability.
- **Output**: findings tagged `[P0]`…`[P3]` with confidence and file:line citations, merged across reviewers (deduplicated by title, most-severe wins), plus one verdict — `VERDICT: SHIP` or `VERDICT: DO-NOT-SHIP` (the strictest reviewer wins). The rendered review lands on screen and in `.unown/reviews/<timestamp>.md` (gitignored).
- **Honest limits**: severity and confidence are the reviewing model's self-reported judgment, not verified facts; reviewers see the frozen diff and can read the repo — their toolset is `read`/`grep`/`find`/`ls` with no bash, so nothing executes during the review.

## Goals (/goal)

`/goal <objective>` (TUI) or `unown --goal "<objective>"` (print or TUI) starts a **durable, evidence-verified objective** — the zcode Goal Mode / muse goals port:

- While a goal is active, every turn carries the objective plus the completion contract: work incrementally with the `todo` tool; finish ONLY with a line containing the exact tag `[GOAL:COMPLETE]` (on its own line); the completion reply must cite real evidence of BOTH kinds — at least one changed-file path AND at least one command output or test result; unfinished todos block completion, and an empty todo list is rejected outright (track the goal's steps with the todo tool first).
- The completion gate runs when the agent ends a turn: the tag must be present on its own line, **every session todo must be done** (and at least one todo must exist), and the reply must carry evidence of both kinds — ≥1 file path (outside quoted/blockquoted text) AND ≥1 command-output marker (a `$ `-prefixed command line, an exit code, or a test tally). Passing marks the goal `complete` and records the evidence; failing prints exactly why (missing tag, N unfinished todos, no todos tracked, missing path evidence, missing output evidence).
- Goal state persists as a session entry — it survives `/new`, `/resume`, `/fork`. `/goal` shows status, `/goal pause` stops the per-turn injection, `/goal resume` restores it, `/goal clear` removes the goal.
- **Honest limit**: the gate is agent-honest, not cryptographic — it verifies that the model *cited* evidence, not that the evidence is true. Pair it with the LSP diagnostics loop and `/review` for actual verification.

## Routines (`unown routines`)

Routines — historically "Automations" (`unown automations` still works as the alias) — are **scheduled, unattended agent runs** in your project. The engine polls every 20 s while it runs; each due routine spawns a real headless unown session (`--mode json -p --no-session`) in the routine's workspace, and the run's output, exit status, turns and token counts are recorded for inspection.

```bash
unown routines create --title 'morning brief' --every '1d at 09:00' \
    --prompt "Summarize yesterday's commits and open TODOs; report risks."
unown routines list [--json]           # this project's routines (--all: every workspace)
unown routines history <id> [--json]   # recorded runs: status, output, turns, tokens
unown routines run <id>                # run now (manual runs never consume --max-runs)
unown routines skip <id>               # skip the next occurrence (recorded in history)
unown routines snooze <id> 30          # push the next occurrence out 30 minutes
unown routines pause <id> | resume <id>
unown routines edit <id> [--title|--prompt|--cron|--every|--after|--timezone|--misfire|--mode ...]
unown routines trigger <event> [--payload '<json>']   # dispatch an event locally (the webhook lane)
unown routines hook-url                # the curl-able inbound webhook URL (its secret IS the auth)
unown routines delete <id>
unown dashboard routines               # the full TUI manager (or /routines in a session)
```

Schedules — five kinds (the full semantics, DST policies and the decision record live in [routines.md](routines.md)):

- **cron** — a standard 5-field expression in the routine's timezone (`"0 9 * * 1-5"`; names, ranges, lists and steps supported)
- **every** — a schedule-anchored interval: `"30m"`, `"6h"`, `"2d"`, `"3w"`, or `"2d at 09:00"` (day/week intervals step by wall clock — a daily 09:00 routine stays at 09:00 across DST)
- **after** — completion-anchored: `"45m"`, `"3d"` — the next run arms N units after the previous run *completes*; regenerating, never overdue
- **one-shot** — `--delay-minutes N`, runs once and completes
- **event** — `--on-event issue.opened` (+ `--filter` payload expression): no clock at all — dispatched by inbound webhook events (`POST /api/hooks/<id>`, flood-guarded) or `routines trigger`; see [routines.md § Event routines](routines.md#event-routines)

Per-routine monitoring policies (M5): `--active-hours "09:00-18:00"` (dispatch window in the routine's tz; may wrap midnight), `--idle-only` (yield slots while a human is using an agent), `--deliver <url>` (POST a JSON result payload after each run; an output containing NO_REPLY suppresses it), `--jitter <sec>` (stagger top-of-hour crons). Per-routine controls: `--timezone America/New_York` (IANA; default: local), `--misfire skip|catch-up` (a slot missed while asleep/engine-down is recorded and skipped, or runs once on wake when under 24 h old — launchd semantics; default skip), `--until 2026-12-31` (inclusive end boundary — past it, the routine completes), `--max-runs N` (manual runs never count). `--model` pins a model for the run; `--workspace` defaults to the current directory.

**The trust story** (this is why the feature shipped *after* the config trust gates, not before):

- **Config lives in the engine's database, never in the repo.** A cloned repository carries no routine definitions, so the cloned-repo-RCE vector that gates `.unown/mcp.json` does not exist here. Routines are created only by you — via the CLI, the REST API, the TUI, or the session tools.
- **Permission is per-task.** The default `read-only` mode runs the unattended agent with a read/grep/find/ls/todo/note/fetch_url/web_search/webfetch/lsp toolset — no bash, no writes. The web tools are read-only network reads (the same classification plan mode gives them), so an unattended "morning brief" or "watch upstream for new releases" routine can search and read the web without gaining any mutation power. `standard` (the full session toolset) must be chosen explicitly with `--mode standard`; a standard run's file changes land in your working tree, reviewable through git before anything happens to them.
- **No recursion.** Runs carry `UNOWN_AUTOMATION=1`, which hides the routine mutation tools inside the run — a routine cannot create or schedule routines (subagents inherit the flag too).
- **Nothing auto-merges.** Every run — and every skipped occurrence, with its reason — is recorded; inspect failures and successes with `history` before acting on them.

Limits (zcode's, transliterated): 20 routines total, 2 concurrent runs (manual run-now respects the same cap), a 30-minute run timeout, and a dispatch retry ladder (30 s × 2ⁿ⁻¹, capped at 15 min, 5 attempts) for runs that fail to start. Routines need the engine up (`bun run agent:start`); while it is down, due slots simply wait for the next poll.

## Slash commands

unown adds thirty-three commands of its own — plus the split-view display mode's eleven (`/split*` and `/files`), listed last:

| Command | What it does |
|---|---|
| `/plan` | Toggle plan mode (read-only exploration → numbered plan → execute) |
| `/flights` | Reopen the **First flights** starter catalog — the one-time guided first task a fresh TUI session opens with (digits `1`–`4` or ↑↓+Enter pick, the prompt lands in the editor ready to send; `Esc` closes, `x` never auto-shows it again) |
| `/todos` | Show the session todo list, grouped by status with dependency chains ([todo addon](addons.md)) |
| `/addons` | Interactive configurator for the [addons](addons.md) — enable/disable `ask_user_question` / `todo` / `advisor` and edit their settings; every change persists to `~/.unown/agent/addons.json` immediately (`/addons status` prints the effective config) |
| `/advisor [status\|on\|off]` | [Advisor](addons.md#advisor) status and control — model, cadence, budgets, usage, watchdog state; `on`/`off` persist the flag (`/reload` applies). Registered only while the advisor addon is enabled |
| `/note <text>` | Deliver a learning note to the engine now |
| `/agents` | List available subagents (built-ins + `.unown/agents/*.md` + `~/.unown/agent/agents/*.md`) |
| `/tasks` | The [async subagent fleet](subagents.md#the-fleet-widget-and-tasks): running children with live state + the finished ones that are resumable by name (`task_control steer <name> <message>`) |
| `/learning` | Re-print the effective 4-tier memory stack, fresh from disk — with per-tier staleness ages when the engine is down ([resilience](resilience.md#learning-staleness-headers)) |
| `/context` | The context-window view (Claude Code `/context` / aider `/tokens` / Gemini `/stats` parity): the utilization bar and exact used/remaining from the host's own accounting (a chars/4 estimate, labeled as such, before the first response), then **where it goes** — the measured memory stack (per-tier tokens: guide/policy/project/user/local), the conversation estimate, and the system+tools residual — plus the session rollup (assistant messages, in/out/cached) and compaction advice banded at 50/70/85%. The agent sees the same numbers through its `get_context_remaining` tool |
| `/usage [days] [--model <id>] [--json]` | Token & cost report without leaving the session: this session's rollup (messages, in/out/cached tokens, models used — the `/session` attribution) followed by the bridge's windowed per-model table. A bare number is the days window (`/usage 7`); the same pure core as `unown usage`, so it works with the bridge up (live aggregate) or down (reads the usage log directly) |
| `/btw <question>` | Ask a side question about the session — one answer in a dismissible overlay, **never entering the transcript**, the receipts ledger or AutoDream's note mining (the Claude Code / Antigravity / OpenCode side-channel, ported). The context is the last 12 turns (text-only, capped); the answer dies with the overlay. Esc/Enter/q dismisses |
| `/output-style [name]` | Show or set the output style — the persona layer (Claude Code `/output-style` parity): built-ins `default` / `concise` / `explanatory` / `proactive` plus custom markdown styles in `.unown/styles/*.md` (frontmatter `name`+`description`, body = the directive). The active style's directive rides the system prompt from the next message; persists to `.unown/output-style.json` (project) — `UNOWN_OUTPUT_STYLE` env wins, `"default"` clears |
| `/insights [days]` | Cross-session analytics over your own history (Claude Code `/insights` parity): sessions and their date range, messages, top models/projects, most-touched files (from receipts), tool usage, notes, token totals + the bridge window's cost, and friction (failed tool results). Everything local; the days window bounds bridge costs only |
| `/engine` | Memory-engine status + degraded-mode diagnosis — up/down/paused, outbox backlog and drops, the auto-start crash-loop circuit, and the actions to take ([resilience](resilience.md#the-engine-command)) |
| `/lsp` | Show LSP status: detected language servers (running/available), open documents, cached diagnostics |
| `/checkpoint [label]` | Snapshot the current state of the files this session touched |
| `/undo [n\|--all]` | Revert the file changes of the last n turn(s) — this session's turns, or everyone's with `--all` |
| `/redo [n\|--all]` | Re-apply the last n undone change(s) — the inverse of `/undo` |
| `/restore <id\|label>` | Restore a checkpoint |
| `/checkpoints` | List checkpoints + blob-store size |
| `/receipts [n]` | Show the session receipts audit ledger |
| `/mcp` | Show MCP server status, (re)connect servers, `/mcp trust` approves a project config, `/mcp elicitation [server]` shows the elicitation policy |
| `/permissions` | Show the granular-permissions state — mode, project-config trust, rule table; `/permissions mode <m>` switches the session mode, `/permissions trust` approves a project `.unown/permissions.json`. See [permissions](permissions.md) |
| `/add-dir <path>` | Grant an additional working directory (write access) for this session; bare lists, `clear` revokes — see [permissions](permissions.md#additional-working-directories---add-dir--add-dir-2026-10-24) |
| `/project-settings` | Show the per-project session defaults (`.unown/settings.json`: model/provider/effort/permissionMode/addDirs, trust-gated); `/project-settings trust` approves the file |
| `/hooks` | Show user-configurable hooks status — per-event handler counts, config sources, trust state; `/hooks trust` approves a project `.unown/hooks.json`. See [User-configurable hooks](#user-configurable-hooks) |
| `/goal [objective]` | Set/show/pause/resume/clear a durable, evidence-verified goal |
| `/commit [message]`| Stage and commit all project-dir changes (`git add -A .` + commit — never pushes); without a message one is generated from the session's work. See [Git-native commits](#git-native-commits-commit) |
| `/review [base]` | Parallel-subagent code review: P0–P3 findings + SHIP verdict. Also accepts a PR URL/number or a commit range; `--comment` posts the verdict as a PR comment (needs `gh`). **Team checks** (Goose v1.40 parity): every `.unown/review/checks/*.md` (project) and `~/.unown/agent/review/checks/*.md` (personal) runs as one more parallel reviewer — frontmatter `title`/`severity` (P0–P3 floor, default P2)/`model` (per-check reviewer override), the body instructs the reviewer; `.unown/review/scope.md` + `~/.unown/agent/review/scope.md` are prepended to every reviewer as team context. Flags: `--severity P1` (display floor), `--checks a,b` (only these checks), `--dry-run` (print the reviewer plan), `--list-checks` |
| `/init-agents` | Preview the generated `AGENTS.md` from repo forensics (no write — `unown init-agents --print` for the full text) |
| `/doctor-instructions` | Run the instruction-set audit inline (AGENTS.md freshness, skills, MCP, hooks, adversary, injection scanner, unicode integrity) |
| `/blame <file>` | Show which receipts touched a file (write/edit/bash); no argument = summary; `--session <id>` `--since <ts>` `--json` filter |
| `/recap [turns]` | The session summary (Claude Code `/recap` parity): the deterministic digest of the session (turns, tool calls, files touched) plus a one-line model summary through the /btw side-question lane — never entering the transcript, the receipts ledger or AutoDream's mining; the digest stands alone when the model lane is down. After a real idle gap (default 3m, `UNOWN_RECAP_IDLE_MINUTES`; 0 kills) the digest also fires automatically as the welcome-home line on your next prompt |
| `/sessions <sub>` | `export` \| `import` \| `list` — the in-session alias for `unown sessions`; `/sessions export` writes `.unown/sessions/export-<id>.json` |
| `/status` | **The one-glance session card** (Codex `/status` parity): unown version + checkout sha, session id/name/message count, model + provider + thinking level, permission mode (config or session override) + add-dir count, the resolved memory tiers with injected chars, engine up/down, the session worktree when `--worktree` put you in one, and the git branch + dirty counts. Read-only, instant (no live probes) — the assembly of what `/session` (stats), `/model`, `/permissions`, `/engine` and `/context` each show a slice of |
| `/diff` | **The working-tree diff** — what `/commit` was missing its other half for (aider `/diff`, Codex `/diff`): the change count, untracked files, and the unified staged+unstaged diff against HEAD, capped at 200 lines in the notify pane with a pointer to the full command; `--stat` renders the compact `git diff --stat` view. Off-repo and clean-tree states say so plainly |
| `/recipe <name> [args]` | Run a declarative agent instruction bundle: `list`, `show <name>`, or `<name> --key value` with parameters interpolated into the body. See [recipes](recipes.md) |
| `/wiki <sub>` | Auto-generated repo docs with `file:line` cross-links: `generate [--force]` (parallel subagents per module) \| `search <q>` \| `list` \| `show <page>`. See [repo wiki](repo-wiki.md) |
| `/edit-resend <n> <msg>` | Edit the Nth user message: revert files to the pre-message checkpoint (all-or-nothing; aborts on out-of-band edits), then resend. `/edit-resend list` shows the numbered messages |
| `/providers` | The in-chat provider manager — the [`unown providers`](providers.md) CLI's TUI twin over the same registry: bare opens the interactive list/add/key/test/refresh/defaults flow (arrow keys + Enter, Esc backs out; RPC mode degrades to sequential prompts); `/providers list` prints the text summary; `/providers test \| refresh <id>` are headless one-shots; argument completions cover the subcommands + provider ids. See [providers](providers.md#in-the-tui) |
| `/dashboard [screen]` | The embedded [TUI dashboard](tui-dashboard-plan.md) (`/dash` is the short alias) — the engine's live feed across 11 screens (Overview, Memory, Dreams, Notes, Skills, Learning Lab, Hooks, Router, Gateway, Automations, Web Cache) rendered in the terminal, driven by keyboard; Esc-Esc returns to the editor. `unown dashboard` boots the same screens straight from the shell (an interactive terminal is required). `/dashboard <screen>` jumps straight to a named screen; `/memory` is the dedicated shortcut for the Memory screen (tiers, versions, version diff, rollback), `/learning` the quick stack view. |
| `/split` family | The split-view display mode (a built-in port of pi-split-view): `/split` toggles all panels (off = bare pi layout; on = saved startup defaults), `/split-thinking` + `/split-tools` the top band's panels, `/files` the files dock (`/split-diff` its edit-diff subpanel), `/split-tools-view` compact ↔ full tool detail, `/split-height` / `/split-tools-width` / `/split-divider` the geometry, `/split-trim-response` full-transcript ↔ response-only mode, and `/split-save` persists the current layout to `~/.unown/agent/ui-panels.json` as the startup default; `--no-split` starts bare |

The split-view display mode registers eleven more, in every session (the thinking/tool band, files dock and response-only transcript — full story in [split view](split-view.md)):

| Command | What it does |
|---|---|
| `/split` | Toggle all split-view panels: off = bare layout, on = saved startup defaults (thinking + tools when nothing is saved) — needs fullscreen mode |
| `/split-thinking` | Toggle the thinking panel in the top band |
| `/split-tools` | Toggle the tool-usage panel in the top band |
| `/split-tools-view` | Toggle the tools panel compact ↔ full detail (full adds an output preview) |
| `/split-tools-width <pct>` | Tools panel share of the band width, 20–60 (default 35) |
| `/files` | Toggle the files panel — docked right in fullscreen, overlay in regular mode |
| `/split-diff` | Toggle the files panel's edit-diff subpanel |
| `/split-trim-response` | Full transcript ↔ response-only (user + assistant text) — needs fullscreen mode |
| `/split-divider [rule\|space]` | Separator between successive assistant answers in response-only mode |
| `/split-height <n>` | Top band height in rows, 6–40 (default 20) |
| `/split-save` | Save the current panel layout as the startup defaults for new windows (`~/.unown/agent/ui-panels.json`) |

pi ships 23 built-in slash commands. The ones worth learning first:

| Command | What it does |
|---|---|
| `/model [provider/model]` | Select model (opens the selector UI) |
| `/new` | Start a new session |
| `/resume` | Resume a different session |
| `/compact` | Manually compact the session context |
| `/settings` | Open the settings menu |
| `/hotkeys` | Show all keyboard shortcuts |
| `/login <provider>` | Configure provider authentication |

The rest:

| Command | What it does |
|---|---|
| `/tree` | Navigate the session tree (switch branches) |
| `/fork` | Create a new fork from a previous user message |
| `/clone` | Duplicate the current session at the current position |
| `/thinking <level>` | Set thinking level |
| `/scoped-models` | Enable/disable models for Ctrl+P cycling |
| `/export` | Export session (HTML default, or a `.html`/`.jsonl` path) |
| `/import` | Import and resume a session from a JSONL file |
| `/share` | Share session as a secret GitHub gist (secret-redacted before upload) |
| `/copy` | Copy last agent message to clipboard |
| `/name` | Set session display name (manual names always win — auto-titles never overwrite one) |
| `/session` | Show session info and stats |
| `/changelog` | Show changelog entries |
| `/trust` | Save project trust decision for future sessions |
| `/logout` | Remove provider authentication |
| `/reload` | Reload keybindings, extensions, skills, prompts, themes, and context files |
| `/quit` | Quit the session |

Every discovered [skill](skills.md) also registers itself as `/skill:<name>`, which loads the full SKILL.md and runs it (on by default; toggle in `/settings`).

Slash commands are not a fixed set: drop a markdown file into `.unown/commands/` (project) or `~/.unown/agent/commands/` (global) and it becomes a command — `/pr-description`, `/release-notes 0.0.1`, anything you write — with `$ARGUMENTS` / `$1..$N` substitution and frontmatter autocomplete. See the [custom slash commands](custom-commands.md) page.

## Keybindings

The most useful defaults (Windows/WSL variants in parentheses):

**Editing**

| Key | Action |
|---|---|
| Esc | Abort the running agent turn / cancel a dialog |
| Ctrl+C | Clear the editor (it does not exit) |
| Ctrl+D | Exit when the editor is empty |
| Ctrl+G | Open your external editor for long prompts |
| Alt+Enter | Queue a follow-up message while the agent works (Ctrl+Q) |
| Ctrl+V | Paste an image from the clipboard (Alt+V) |

**Navigation**

| Key | Action |
|---|---|
| Ctrl+O | Toggle tool output expansion |
| Ctrl+Shift+F | Search the transcript (Ctrl+F) |
| Ctrl+Up / Ctrl+Down | Jump to the previous / next prompt |
| Ctrl+X | Copy the message under the cursor to the clipboard |

**Model**

| Key | Action |
|---|---|
| Shift+Tab | Cycle thinking level |
| Ctrl+P | Cycle to the next model |
| Ctrl+Shift+P | Cycle to the previous model (Alt+P) |
| Ctrl+L | Open the model selector |
| Ctrl+T | Toggle thinking-block display |

**Session**

| Key | Action |
|---|---|
| Ctrl+Alt+P | Toggle plan mode |

**Addons** (defaults — both rebindable in [addons](addons.md))

| Key | Action |
|---|---|
| Ctrl+Shift+T | Collapse/expand the todo panel above the editor |
| Ctrl+] | Collapse/expand an open ask_user_question dialog |

`/hotkeys` shows the full list; `~/.unown/agent/keybindings.json` overrides any default.

## Sessions

Sessions are append-only trees stored as JSONL files under `~/.unown/agent/sessions/`. Every entry has a parent; the current position is a leaf pointer, so branching never rewrites history.

- `/new` starts a fresh session; `/resume` opens a picker of past sessions.
- `/fork` branches from an earlier user message — the original branch stays intact.
- `/tree` visualizes the tree and switches branches; `/clone` duplicates the session at the current position.
- Todo lists and plan-mode state ride the branch: switching to a different branch reconstructs that branch's list.
- Memory is re-read from disk on every `/new`, `/resume`, and `/fork` — AutoDream can update project memory while you work, and the next session picks it up without restarting the CLI.

`/name`, `/session`, `/export`, `/import`, and `/share` manage and move sessions around.

Two more session tools ride the same machinery:

- **`/edit-resend <n> <new-message>`** rewrites history in place: it reverts every file to the checkpoint sealed just before the Nth user message (SHA-256-verified — any out-of-band edit aborts the whole operation), appends the edited message as the new leaf, and re-runs from there. The revert is all-or-nothing: a mid-way failure restores what it already rewrote. `/edit-resend list` prints the numbered user messages.
- **`unown sessions import <file> --from <auto\|claude\|codex>`** migrates sessions **from other coding agents**: a Claude Code history file (`~/.claude/projects/<slug>/*.jsonl`) or a Codex rollout file (`~/.codex/sessions/**/rollout-*.jsonl`) is auto-detected (or forced with `--from`), converted to a unown session (fresh ids, linear parent chain, tool calls/results preserved) and lands in `.unown/sessions/` — `/resume` and `sessions list` pick it up immediately. The migration moat: leaving Claude Code or Codex is one command.
- **`unown sessions export|import|list`** (in-session alias `/sessions`) moves a session between machines — the export is one self-describing JSON (`{version, manifest, messages, todos, notes, skills, files}`), and `import` rehydrates it under a fresh session id. Exports are **redacted by default**: known secret shapes (API keys, PATs, PEM blocks, bearer tokens) become `[REDACTED:<type>]` markers before the file is written — a transfer artifact routinely changes hands, and a transcript debugged with a real key must not carry that key into the file. The CLI reports how many were caught; `--raw` opts out for a lossless self-transfer between machines you own. `/share` applies the same secret table to the gist/Radius upload — every path that leaves the machine is redacted, local `/export` is not.

**Session auto-titles.** Every interactive session names itself: once a turn settles, a cheap background bridge call writes a 3-6 word title into the session tree, so the `/resume` picker is scannable (the every-coding-agent convention — Claude Code, Codex, Gemini CLI and OpenCode all auto-name). It never overwrites a name you set with `/name`, never runs in print/subagent/automation sessions, and fails silently (a title must never cost a turn). `UNOWN_AUTO_TITLES=0` turns it off.

**Turn-complete attention.** Long interactive turns ping you when they finish: after a turn that lasted at least `UNOWN_NOTIFY_MS` (default 120s — quick turns stay silent), a deferred OSC-9 desktop notification + BEL lands once the frame settles ("unown: done — <first 80 chars>"). The write is deferred so it never tears a frame, a fresh turn cancels a pending ping (they never stack), and the same gates as print mode apply (`UNOWN_NOTIFY=0`, `DO_NOT_TRACK=1`). `UNOWN_TUI_NOTIFY=0` is the TUI-specific kill switch.

**Context budget.** `/compact` (pi's own) compacts manually. Engine sandbox runs add an auto-compact guard on top — after every turn it checks the live context usage against a proportional curve: warn at 70% of the window, auto-compact at 85%, hard-block the next request at 95% (`UNOWN_AUTO_COMPACT_THRESHOLD` / `UNOWN_AUTO_COMPACT_HARD_LIMIT` tune the last two; see [configuration](configuration.md#terminal-agent-unown-cli)). The `get_context_remaining` tool reports the same numbers to the agent.

**Idle compaction** (2026-10-25, Claude Code v2.1.299 parity): a terminal session that sits **idle ≥ 45 minutes with ≥ 50% of its context used** is compacted automatically *before* your next prompt ships — the summary work happens while nobody waits, and a heavy session never returns to an overflowing window. A plain-language notice explains what happened and names the knobs (`UNOWN_IDLE_COMPACT_MINUTES`, `UNOWN_IDLE_COMPACT_MIN_USAGE`; `UNOWN_IDLE_COMPACT_MINUTES=0` is the kill switch). The idle gap is consumed by the first prompt that arrives, so queued follow-ups never double-fire it.

## Guardrails

Terminal sessions are guarded by PreToolUse / PostToolUse hooks tuned for real work — normal operations (network access, `git push`, package installs) are allowed. What is blocked, before execution:

| Blocked | Examples |
|---|---|
| Filesystem-root deletion | `rm -rf /` |
| Recursive deletes of home directories | `rm -rf ~` |
| Fork bombs | `:(){ :\|:& };:` |
| Filesystem formats | `mkfs ...` |
| Raw writes to disk devices | `dd ... of=/dev/sdX` |
| Writes into system paths | redirects into `/etc`, `/usr`, `/var`, `/bin`, `/root` |
| World-writable root | `chmod -R 777 /` |

Additionally:

- **Write-path jail** — `write`/`edit` are confined to your project directory and `/tmp`. Reads are unrestricted.
- **Syntax gate** — when broken JavaScript/TypeScript is written or edited, the transpiler error is appended to the tool result and flagged as an error, so the agent fixes it instead of compounding it.
- **`UNOWN_STRICT_HOOKS=1`** — restores sandbox-grade strictness: additionally blocks `sudo`, `curl`/`wget`/`nc`/`netcat` to external hosts, and `git push`, plus the engine's full sandbox deny-list. Set it in the environment before starting unown.
- **Visibility** — run `unown -v` to print every hook decision (`PreToolUse DENY bash: ...`) to stderr.

## User-configurable hooks

On top of the built-in guardrails, you can attach your own handlers to thirteen session events — `SessionStart`, `UserPromptSubmit`, `PreToolUse` (with a `matcher`; `deny`/`stop` blocks, `mutate` rewrites the tool input), `PostToolUse` (feedback/warning/error outputs surface to the model), `Stop`, `SubagentStop`, `PreModelRequest`, `PostModelRequest`, `PreCompact`, `PostCompact`, `SubagentStart`, `TaskCompleted`, `PermissionRequest` — from two files:

| File | Scope | Trust |
|---|---|---|
| `~/.unown/agent/hooks.json` | user | always trusted |
| `.unown/hooks.json` | project | **trust-gated, refuse-first** — an unapproved file contributes nothing until you run `/hooks trust` (or set `UNOWN_TRUST_PROJECT_CONFIG=1` for CI/headless) |

When both exist, the project config wins per event name. Handlers come in five types — `command` (shell command; exit-code protocol: 0 + stdout → allow/feedback, 2 + stderr → deny, other non-zero → warn), `http` (POST the event JSON to a URL), `mcp` (call a tool on a configured MCP server), `prompt` (LLM call with a templated prompt) and `agent` (same, fresh subagent context) — with `timeoutMs`, `async` and `failClosed` fields. They run in interactive sessions and engine runs alike, always **after** the built-in policies (hooks augment, never replace them) and fail-open (a hook error never breaks a turn). **`command` handlers run through the OS shell** — `cmd.exe` on Windows, `/bin/sh` on macOS/Linux — so write the command for the machine that runs it, or invoke an interpreter explicitly (`powershell -File …` / `bash -c …`). A timed-out hook process tree is killed with `taskkill /F /T` on Windows and a process-group SIGKILL elsewhere.

`/hooks` prints the status — per-event handler counts, the config sources, and the untrusted warning when a project file is withheld; `/hooks trust` approves it and reloads live. The full event table, handler contract and composition order live in [BEHAVIOR: user-configurable hooks](BEHAVIOR.md#user-configurable-hooks-milestone-1--2026-10-19); the trust-gate mechanics are shared with `.unown/mcp.json` (see [MCP servers](#mcp-servers) above and [configuration](configuration.md)).

## Memory in sessions

Every session is injected with the resolved 4-tier stack — most specific tier wins — alongside your own `AGENTS.md`/`CLAUDE.md` chain (supplemented, never replaced). Details and maintenance in [m[memory](memory.md).

| Tier | File | Who writes it |
|---|---|---|
| 0 — Policy | `~/.unown/memory/policy.md` | You / your org (optional enterprise guardrails) |
| 1 — Project | `<project>/.unown/memory/project.md` | AutoDream from session notes; your hand edits are preserved as new versions |
| 2 — User | `~/.unown/memory/user.md` | You (global preferences) |
| 3 — Local | `<project>/.unown/memory/local.md` | You (gitignored per-project overrides, highest precedence) |

`/learning` re-prints the whole stack fresh from disk (first 60 lines per tier); `unown memory` prints it from the shell; `unown init` scaffolds the project tiers.

## Environment variables

CLI-only variables. The engine and bridge have their own — see [configuration](configuration.md).

| Variable | Default | Meaning |
|---|---|---|
| `UNOWN_HOME` | `~/.unown` | State dir: agent config, global memory, note outbox |
| `UNOWN_ENGINE_URL` | `http://127.0.0.1:3030` | Where the CLI delivers session notes |
| `UNOWN_STRICT_HOOKS` | unset | `1` (also `true`/`yes`) = sandbox-grade hooks; see [guardrails](#guardrails) |
| `UNOWN_NO_PREFLIGHT` | unset | Set = skip the model-endpoint reachability check before sessions |
| `UNOWN_LSP` | `1` | `0` disables the `lsp` tool and the after-edit diagnostics loop |
| `UNOWN_LSP_WAIT_MS` | `10000` | Max wait for fresh language-server diagnostics after a `write`/`edit` |
| `UNOWN_LSP_TIMEOUT_MS` | `15000` | Per-request timeout for LSP JSON-RPC calls |
| `UNOWN_MCP` | `1` | `0` disables the MCP client surface (no `mcp__*` tools) |
| `UNOWN_MCP_TIMEOUT_MS` | `120000` | Per-request timeout for MCP JSON-RPC calls |
| `UNOWN_MCP_CONNECT_TIMEOUT_MS` | `20000` | Timeout for the MCP initialize handshake |
| `UNOWN_AUTO_COMMIT` | unset | **Opt-in, default OFF.** `1` (also `true`) = commit pending project-dir changes on session end as `unown(auto): session end snapshot <date>` (never pushes). See [Git-native commits](#git-native-commits-commit) |
| `UNOWN_SUBAGENT_MODEL` | unset | Override `PI_MODEL_ID` for **every** subagent the `task` tool spawns (a per-agent `model` still wins). See [subagents → per-agent routing](subagents.md#per-agent-routing) |
| `PI_BRIDGE_URL` | `http://127.0.0.1:3031` | LLM endpoint written into `~/.unown/agent/models.json` on first run |
| `PI_MODEL_ID` / `PI_PROVIDER` | `kimi-k2.5` / `zai-bridge` | Model and provider written on first run; see [providers](providers.md) |

`UNOWN_SUBAGENT=1` is set internally by the `task` tool inside spawned subagents — you never set it by hand ([subagents](subagents.md)).
