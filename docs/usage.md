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
- [Memory in sessions](#memory-in-sessions)
- [Environment variables](#environment-variables)

Related pages: [subagents](subagents.md) · [skills](skills.md) · [memory](memory.md) · [providers](providers.md) · [configuration](configuration.md) · [updating](updating.md)

## Three ways to run

**1. Interactive TUI — `unown`**

```bash
cd ~/code/my-project
unown                          # full interactive session, like claude/pi
unown "fix the failing tests"  # same, starting with a prompt
```

You get the real pi TUI in your actual project directory: file tools (read / edit / write / grep / find / ls), bash, `@file` mentions, session management — plus unown's self-learning layer: tiered memory injected into every session, guardrail hooks, session tools, and note capture for AutoDream. See [memory](memory.md) for what gets injected and [guardrails](#guardrails) below for what gets blocked.

On first run, unown seeds `~/.unown/agent/` (models.json pointing at the bundled llm-bridge, settings.json, a sessions dir, and four starter [skills](skills.md)) and prints a banner. Connect a different provider any time with `unown setup` — see [providers](providers.md).

**2. One-shot print mode — `unown -p "prompt"`**

```bash
unown -p "explain the build error" | less
cat error.log | unown -p "fix this"     # piped stdin joins the prompt
```

Print mode runs one prompt headlessly and exits. Piped stdin is appended to the prompt (separated by a blank line), so you can feed logs, diffs, or source files without quoting wars. If either stdin or stdout is not a TTY, print mode is forced automatically — the piping above works with or without `-p`. Add `--mode json` to stream JSON events instead of text (this is how the [subagent](subagents.md) machinery consumes runs).

**3. Plan mode — `unown --plan`**

```bash
unown --plan "add auth"    # plan first, touch nothing until you approve
```

See the next section. Also reachable mid-session as `/plan` or Ctrl+Alt+P.

Before every session (TUI or print), unown probes the configured model endpoint so a dead bridge or bad API key fails with instructions instead of a raw connection error. In print mode a failed probe exits with status 1; in the TUI it warns and continues. `UNOWN_NO_PREFLIGHT=1` skips the check.

## Plan mode

Plan mode is a read-only exploration phase with an explicit approval gate before anything changes. Start it three ways: `unown --plan` (print or TUI), `/plan` in the TUI, or Ctrl+Alt+P.

While planning:

- `edit`, `write`, and the `task` tool are disabled; `read`, `bash`, `grep`, `find`, `ls`, `todo`, `note`, `fetch_url`, and `lsp` (code intelligence is read-only) stay available.
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
| `unown setup` | Connect a model provider — interactive wizard. Presets: `bridge` (bundled), `openai`, `openrouter`, `anthropic`, `dashscope`, `deepseek`, `custom` (any OpenAI-compatible endpoint) |
| `unown setup --provider openai --api-key sk-... --model gpt-4o` | Non-interactive (scripts/CI). `--force` overwrites an existing config, `--list` prints the presets |
| `unown models` | List configured models, plus what a local bridge serves |
| `unown init` | Scaffold `.unown/` project memory (`memory/project.md`, `memory/local.md`, `.gitignore`) |
| `unown memory` | Print the effective 4-tier memory stack |
| `unown doctor` | Run configuration diagnostics — `--json` emits a machine-readable report (`{ok, version, checks[{id,status,detail}], summary}`; non-zero exit on failure — scriptable, CI-able) |
| `unown info` | Print the support bundle — version, platform, git state, provider names, opt-outs — redaction-safe for bug reports; `--json` for the same fields |
| `unown note "text"` | Deliver a session note to the engine by hand |
| `unown update` | Check for a newer release and self-update — fast-forward the checkout to the newest ready tag, then re-run the installer. Flags: `--check` (report only; exit `2` when an update is available), `--check --json`, `--allow-dirty`, `--rollback`, or an explicit version (`unown update 2.1.0` — also pins/rolls back). See [updating](updating.md) |
| `unown changelog [n]` | Print the latest `CHANGELOG.md` sections (default 1) |
| `unown completions <shell>` | Print a completion script — `bash` \| `zsh` \| `fish` \| `powershell` (stdout; installation one-liners in `unown completions --help` and below) |
| `unown uninstall` | Remove the CLI — shims by default; `--dry-run`, `--purge-data` (~/.unown), `--purge-checkout` (the repo; refuses uncommitted work). See [install → uninstalling](install.md#uninstalling) |
| `unown --help` / `-h` | Help text |
| `unown --version` / `-V` | Print the version (matches `package.json`; CI asserts the contract) |

`-v` / `--verbose` works in session modes: hook decisions and tool activity are printed to stderr.

**Shell completions.** Install once per shell:

```bash
unown completions bash > ~/.local/share/bash-completion/completions/unown   # bash
unown completions zsh  > ~/.zfunc/_unown                                  # zsh (compinit on)
unown completions fish > ~/.config/fish/completions/unown.fish           # fish
unown completions powershell >> $PROFILE                                  # PowerShell
```

**Subagent plumbing flags.** `--mode json` (JSON event stream), `--no-session` (don't persist), `--tools a,b,c` (restrict the active toolset), `--append-system-prompt <file>` (append file contents to the system prompt) exist for the `task` tool, which spawns subagents with exactly these flags. You normally never type them yourself — see [subagents](subagents.md).

**`unown doctor`** checks, in order: the unown version and update-check state (from the notifier cache — no network), the agent dir and `models.json`, the memory stack, model-endpoint reachability (and credentials), bridge upstream key / upstream health / model routability when pointed at the bundled bridge, the OS sandbox (bubblewrap), the self-learning engine, plus the SDLC surfaces: **lsp-servers** (which language servers are detected on PATH — a warning here just means the optional diagnostics loop is inactive), **mcp-config** (configured servers, config-validation problems, and the project-config trust state — an untrusted `.unown/mcp.json` warns with the `/mcp trust` action), and **unown-state** (disk usage of the project's `.unown/` runtime state — checkpoints, receipts, reviews; warns past `UNOWN_STATE_WARN_BYTES`, default 512 MiB, with pruning guidance). It exits 1 when chat is broken; warnings only affect learning features (notes queue in the outbox until the engine returns). If it fails, see [troubleshooting](troubleshooting.md).

## Session tools

Every unown session registers five tools on top of pi's built-ins:

| Tool | What the agent does with it |
|---|---|
| `todo` | Maintains a visible task list (`list` / `add` / `toggle` / `clear`) while working on multi-step tasks. State rides session entries, so branching (`/fork`, `/tree`) keeps the correct list. Inspect it with `/todos`. |
| `task` | Spawns [subagents](subagents.md) with a fresh context window — `general` (full tools), `explore` (read-only), or your own `.unown/agents/*.md` definitions. Up to 4 tasks per call, executed in parallel. |
| `note` | Records a durable learning note mid-session — delivered to the engine immediately (or queued in the outbox if it is down). AutoDream consolidates notes into project memory. Also `/note <text>`. |
| `fetch_url` | Read-only HTTP GET. HTML is stripped to text; bodies over 2 MB are refused; output is capped at 12,000 chars by default (`max_chars` clamps to 500–60,000); 20-second timeout; http(s) only. |
| `lsp` | Language-server code intelligence: `diagnostics` (per file or `all`), `hover`, `definition`, `references`, `symbols`, `status`. Auto-detects servers on PATH (typescript-language-server, pyright/pylsp, gopls, rust-analyzer, clangd, bash-language-server); configure or override with `.unown/lsp.json` / `~/.unown/agent/lsp.json`. After every `write`/`edit`, fresh diagnostics for that file are appended to the tool result — type errors get fed back to the agent instead of compounding (cold start never blocks; `UNOWN_LSP=0` disables). Also `/lsp`. |

When you quit a session in which something happened, a session note (prompt count, tool calls, final outcome) is delivered to the engine — or written to `~/.unown/notes/outbox/` if the engine is down, and synced later. That note is the raw material AutoDream consolidates into `.unown/memory/project.md`.

## Checkpoints and receipts

Every session also keeps a **receipts audit ledger** and a **checkpoint store** under `.unown/` (both gitignored, per-machine):

- **Receipts** (`.unown/receipts/<session>.jsonl`, one file per session boot): the ordered audit — session starts, every prompt (first 200 chars), every tool call with its input (file paths, commands, URLs, tasks; inputs capped at 4 KB), every result (ok/fail, usage), every checkpoint and restore. `/receipts [n]` prints the last n entries plus totals (tool calls by tool, distinct files written, errors, checkpoints, restores). Subagent processes write their own ledger (marked `[subagent]`).
- **Checkpoints** (`.unown/checkpoints/`): content-addressed blob snapshots. A **turn checkpoint** is sealed automatically whenever a turn wrote files — it stores the *pre-turn* state of every file that changed (files that did not exist before are tombstoned). **Named checkpoints** snapshot the current state of every file the session touched.

| Command | What it does |
|---|---|
| `/checkpoint [label]` | Snapshot the current state of every file this session touched (bash-caused changes are not tracked file-by-file) |
| `/undo [n\|--all]` | Revert the file changes of the last n turn(s) (default 1) — restores pre-turn states; new files created this turn are deleted. Only **this session's** turns by default; `--all` also consumes other sessions'/subagents' turns |
| `/restore <id\|label>` | Rewrite the files of a named (or turn) checkpoint; prefix matching works |
| `/checkpoints` | List checkpoints (turn + named) with the blob-store size |
| `/receipts [n]` | Show the audit ledger — last n entries (default 20) + totals |

Limits, stated plainly: bash-caused file changes appear in the ledger as commands but are not itemized per-file (no workspace diffing); `/undo` walks only this session's turn checkpoints by default (`--all` for the rest — across machines/copies of the repo there is no store); restore is jailed to the project directory by both a lexical and a realpath check (a symlink pointing outside the project is refused), and every blob is hash-verified on restore — a corrupt checkpoint reports `corrupt-blob` and touches nothing. Files larger than `UNOWN_CHECKPOINT_MAX_BLOB_BYTES` (default 64 MiB) are not snapshot: the turn still reverts its other files and the ledger notes the exception. Per session at most 40 checkpoints are kept (200 across sessions; oldest pruned, blobs garbage-collected with a 10-minute grace window so concurrent sessions never delete each other's in-flight snapshots).

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
- **Honest limits**: severity and confidence are the reviewing model's self-reported judgment, not verified facts; reviewers see the frozen diff and can read the repo, but they do not execute code.

## Goals (/goal)

`/goal <objective>` (TUI) or `unown --goal "<objective>"` (print or TUI) starts a **durable, evidence-verified objective** — the zcode Goal Mode / muse goals port:

- While a goal is active, every turn carries the objective plus the completion contract: work incrementally with the `todo` tool; finish ONLY with a line containing the exact tag `[GOAL:COMPLETE]` (on its own line); the completion reply must cite real evidence of BOTH kinds — at least one changed-file path AND at least one command output or test result; unfinished todos block completion, and an empty todo list is rejected outright (track the goal's steps with the todo tool first).
- The completion gate runs when the agent ends a turn: the tag must be present on its own line, **every session todo must be done** (and at least one todo must exist), and the reply must carry evidence of both kinds — ≥1 file path (outside quoted/blockquoted text) AND ≥1 command-output marker (a `$ `-prefixed command line, an exit code, or a test tally). Passing marks the goal `complete` and records the evidence; failing prints exactly why (missing tag, N unfinished todos, no todos tracked, missing path evidence, missing output evidence).
- Goal state persists as a session entry — it survives `/new`, `/resume`, `/fork`. `/goal` shows status, `/goal pause` stops the per-turn injection, `/goal resume` restores it, `/goal clear` removes the goal.
- **Honest limit**: the gate is agent-honest, not cryptographic — it verifies that the model *cited* evidence, not that the evidence is true. Pair it with the LSP diagnostics loop and `/review` for actual verification.

## Slash commands

unown adds fourteen commands of its own:

| Command | What it does |
|---|---|
| `/plan` | Toggle plan mode (read-only exploration → numbered plan → execute) |
| `/todos` | Show the session todo list |
| `/note <text>` | Deliver a learning note to the engine now |
| `/agents` | List available subagents (built-ins + `.unown/agents/*.md` + `~/.unown/agent/agents/*.md`) |
| `/learning` | Re-print the effective 4-tier memory stack, fresh from disk |
| `/lsp` | Show LSP status: detected language servers (running/available), open documents, cached diagnostics |
| `/checkpoint [label]` | Snapshot the current state of the files this session touched |
| `/undo [n\|--all]` | Revert the file changes of the last n turn(s) — this session's turns, or everyone's with `--all` |
| `/restore <id\|label>` | Restore a checkpoint |
| `/checkpoints` | List checkpoints + blob-store size |
| `/receipts [n]` | Show the session receipts audit ledger |
| `/mcp` | Show MCP server status and (re)connect configured servers |
| `/goal [objective]` | Set/show/pause/resume/clear a durable, evidence-verified goal |
| `/review [base]` | Parallel-subagent code review: P0–P3 findings + SHIP verdict |

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
| `/share` | Share session as a secret GitHub gist |
| `/copy` | Copy last agent message to clipboard |
| `/name` | Set session display name |
| `/session` | Show session info and stats |
| `/changelog` | Show changelog entries |
| `/trust` | Save project trust decision for future sessions |
| `/logout` | Remove provider authentication |
| `/reload` | Reload keybindings, extensions, skills, prompts, themes, and context files |
| `/quit` | Quit the session |

Every discovered [skill](skills.md) also registers itself as `/skill:<name>`, which loads the full SKILL.md and runs it (on by default; toggle in `/settings`).

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

`/hotkeys` shows the full list; `~/.unown/agent/keybindings.json` overrides any default.

## Sessions

Sessions are append-only trees stored as JSONL files under `~/.unown/agent/sessions/`. Every entry has a parent; the current position is a leaf pointer, so branching never rewrites history.

- `/new` starts a fresh session; `/resume` opens a picker of past sessions.
- `/fork` branches from an earlier user message — the original branch stays intact.
- `/tree` visualizes the tree and switches branches; `/clone` duplicates the session at the current position.
- Todo lists and plan-mode state ride the branch: switching to a different branch reconstructs that branch's list.
- Memory is re-read from disk on every `/new`, `/resume`, and `/fork` — AutoDream can update project memory while you work, and the next session picks it up without restarting the CLI.

`/name`, `/session`, `/export`, `/import`, and `/share` manage and move sessions around.

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

## Memory in sessions

Every session is injected with the resolved 4-tier stack — most specific tier wins — alongside your own `AGENTS.md`/`CLAUDE.md` chain (supplemented, never replaced). Details and maintenance in [memory](memory.md).

| Tier | File | Who writes it |
|---|---|---|
| 0 — Policy | `~/.unown/memory/policy.md` | You / your org (optional enterprise guardrails) |
| 1 — Project | `<project>/.unown/memory/project.md` | AutoDream from session notes; your hand edits are preserved as new versions |
| 2 — User | `~/.unown/memory/user.md` | You (global preferences) |
| 3 — Local | `<project>/.unown/memory/local.md` | You (gitignored per-project overrides, highest precedence) |

`/learning` re-prints the whole stack fresh from disk (first 60 lines per tier); `unown memory` prints it from the shell; `unown init` scaffolds the project tiers.

## Environment variables

CLI-only variables. The engine, bridge, and dashboard have their own — see [configuration](configuration.md).

| Variable | Default | Meaning |
|---|---|---|
| `UNOWN_HOME` | `~/.unown` | State dir: agent config, global memory, note outbox |
| `UNOWN_ENGINE_URL` | `http://127.0.0.1:3030` | Where the CLI delivers session notes |
| `UNOWN_STRICT_HOOKS` | unset | `1` (also `true`/`yes`) = sandbox-grade hooks; see [guardrails](#guardrails) |
| `UNOWN_NO_PREFLIGHT` | unset | Set = skip the model-endpoint reachability check before sessions |
| `PI_BRIDGE_URL` | `http://127.0.0.1:3031` | LLM endpoint written into `~/.unown/agent/models.json` on first run |
| `PI_MODEL_ID` / `PI_PROVIDER` | `kimi-k2.5` / `zai-bridge` | Model and provider written on first run; see [providers](providers.md) |

`UNOWN_SUBAGENT=1` is set internally by the `task` tool inside spawned subagents — you never set it by hand ([subagents](subagents.md)).
