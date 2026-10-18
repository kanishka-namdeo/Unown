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

- `edit`, `write`, and the `task` tool are disabled; `read`, `bash`, `grep`, `find`, `ls`, `todo`, `note`, and `fetch_url` stay available.
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

**`unown doctor`** checks, in order: the unown version and update-check state (from the notifier cache — no network), the agent dir and `models.json`, the memory stack, model-endpoint reachability (and credentials), bridge upstream key / upstream health / model routability when pointed at the bundled bridge, the OS sandbox (bubblewrap), and the self-learning engine. It exits 1 when chat is broken; warnings only affect learning features (notes queue in the outbox until the engine returns). If it fails, see [troubleshooting](troubleshooting.md).

## Session tools

Every unown session registers four tools on top of pi's built-ins:

| Tool | What the agent does with it |
|---|---|
| `todo` | Maintains a visible task list (`list` / `add` / `toggle` / `clear`) while working on multi-step tasks. State rides session entries, so branching (`/fork`, `/tree`) keeps the correct list. Inspect it with `/todos`. |
| `task` | Spawns [subagents](subagents.md) with a fresh context window — `general` (full tools), `explore` (read-only), or your own `.unown/agents/*.md` definitions. Up to 4 tasks per call, executed in parallel. |
| `note` | Records a durable learning note mid-session — delivered to the engine immediately (or queued in the outbox if it is down). AutoDream consolidates notes into project memory. Also `/note <text>`. |
| `fetch_url` | Read-only HTTP GET. HTML is stripped to text; bodies over 2 MB are refused; output is capped at 12,000 chars by default (`max_chars` clamps to 500–60,000); 20-second timeout; http(s) only. |

When you quit a session in which something happened, a session note (prompt count, tool calls, final outcome) is delivered to the engine — or written to `~/.unown/notes/outbox/` if the engine is down, and synced later. That note is the raw material AutoDream consolidates into `.unown/memory/project.md`.

## Slash commands

unown adds five commands of its own:

| Command | What it does |
|---|---|
| `/plan` | Toggle plan mode (read-only exploration → numbered plan → execute) |
| `/todos` | Show the session todo list |
| `/note <text>` | Deliver a learning note to the engine now |
| `/agents` | List available subagents (built-ins + `.unown/agents/*.md` + `~/.unown/agent/agents/*.md`) |
| `/learning` | Re-print the effective 4-tier memory stack, fresh from disk |

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
