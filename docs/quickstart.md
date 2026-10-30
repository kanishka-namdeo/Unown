# Quickstart

From a fresh clone to a working coding agent in your terminal — five minutes.

- [1. Prerequisites](#1-prerequisites)
- [2. Install](#2-install)
- [3. Connect a model](#3-connect-a-model)
- [4. Start the stack (optional but recommended)](#4-start-the-stack-optional-but-recommended)
- [5. First session](#5-first-session)
- [Where to go next](#where-to-go-next)

Related pages: [usage](usage.md) · [providers](providers.md) · [memory](memory.md) · [troubleshooting](troubleshooting.md)

## 1. Prerequisites

- **The default binary install needs neither bun nor git.** The full-stack source install (`--source`) needs both:
- [bun](https://bun.sh) ≥ 1.4 — macOS/Linux: `curl -fsSL https://bun.sh/install | bash` (or `brew install bun`) · Windows: `powershell -c "irm bun.sh/install.ps1 | iex"` (then open a new terminal).
- [git](https://git-scm.com) (any build; on Windows the standard Git-for-Windows install is fine)
- An API key for any OpenAI-compatible provider — Dashscope, OpenAI, OpenRouter, Anthropic, DeepSeek, or a local server (vLLM, Ollama, llama.cpp)
- **Windows, macOS, or Linux** — the same commands and the full stack on all three. OS-level engine sandbox: Linux (bubblewrap) + macOS (seatbelt); native Windows uses the in-process path jail (WSL2 for kernel-grade isolation). Per-OS details: [Windows guide](windows.md) · [macOS guide](macos.md)

## 2. Install

The default one-liner installs the **newest stable release binary** — the terminal agent alone, verified by SHA-256, with no git and no bun:

```bash
# macOS / Linux / WSL (POSIX sh)
curl -fsSL https://unown-nine.vercel.app/install.sh | sh
```

```powershell
# Windows (PowerShell) — the irm|iex twin of the same installer
irm https://unown-nine.vercel.app/install.ps1 | iex
```

Want the **full stack** (terminal agent + engine + bridge, which is what makes Unown learn)? Add `--source` on POSIX or `-Source` on Windows. That lane clones the newest stable release tag and runs `bun run agent:install`:

```bash
curl -fsSL https://unown-nine.vercel.app/install.sh | sh -s -- --source
```

```powershell
irm https://unown-nine.vercel.app/install.ps1 -OutFile install.ps1
.\install.ps1 -Source
```

`--main` / `-Main` installs the edge branch instead; `--version vX.Y.Z` / `-Version vX.Y.Z` pins a stable release (the current one is on [Releases](https://github.com/kanishka-namdeo/Unown/releases)). PowerShell's `irm | iex` cannot pass flags — download `install.ps1` first to use them. The installer resolves the version itself; prereleases are never picked.

Or the three source commands by hand, pinned to that same tag:

```bash
git clone --branch vX.Y.Z https://github.com/kanishka-namdeo/Unown.git
cd Unown
bun run agent:install
```

(Plain `git clone` gives you `main` — the edge lane.)

Only want the CLI? That is the default one-liner — a verified release download installed under a versioned root with a PATH shim, no git or bun. It ships the CLI plus an on-demand engine (`unown engine start`), but no llm-bridge and no always-on OS service, so the unattended learning stack needs the `--source` install above ([details](install.md)).

The `--source` install runs `bun install --frozen-lockfile` at the repo root and in the vendored pi monorepo (`pi-repo/`), builds it — hydrating its provider model data on first run (that directory is gitignored upstream, so fresh clones fetch it once, ~1–2 min) — creates `.env` from `.env.example` if you don't have one, and puts the `unown` command on your PATH via a shim (`~/.local/bin/unown` → this checkout; on Windows: `%USERPROFILE%\.local\bin\unown.cmd` + `unown.ps1`). If your PATH misses it, the installer tells you exactly what to add — or re-run `bun run agent:link` anytime.

> **Windows notes**
> - If the installer just added `%USERPROFILE%\.local\bin` to your PATH, **restart your terminal** before `unown` resolves.
> - cmd.exe picks up `unown.cmd` automatically; PowerShell users get `unown.ps1` (if script execution is disabled on a locked-down machine, run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`).

Verify:

```bash
unown --help        # the command surface
unown doctor        # diagnostics — expect one ✗ (no upstream key yet)
```

Stay current with `unown update`; `unown update --check` reports without changing anything (exit `0` up to date or not published for this platform, `2` available, `1` error). The command is mode-aware — a source checkout moves tag to tag, a binary install validates the release manifest and verifies the platform asset's size and SHA-256 before activating it ([updating](updating.md)).

## 3. Connect a model

**The one required credential is an upstream key.** Two supported shapes:

### Option A — the bundled bridge (recommended for the full stack: model routing)

Put your provider key in `.env`:

```bash
# .env
BRIDGE_UPSTREAM_URL=https://dashscope.aliyuncs.com/compatible-mode/v1   # or any OpenAI-compatible base URL
BRIDGE_UPSTREAM_KEY=<your key>
BRIDGE_KNOWN_MODELS=kimi-k2.5,qwen3.7-plus,qwen3.6-plus                 # your provider's model ids
```

The bridge injects auth, routes model ids, translates thinking flags, and streams SSE — see [providers](providers.md). Then point the terminal agent at it:

```bash
unown setup --provider bridge        # writes ~/.unown/agent/ (models + defaults)
```

### Option B — any provider directly, no stack needed

```bash
unown setup --provider openai --api-key sk-... --model gpt-4o
# or: openrouter / anthropic / dashscope / deepseek / custom (any OpenAI-compatible base URL)
```

Interactive wizard (pick a provider, paste a key, choose a model): just run `unown setup`.

#### The interactive wizard, beat by beat

The wizard is a guided flow, not a form. In order:

1. **Welcome + current state** — the active provider/model, or `No provider connected yet — let's fix that.`
2. **Provider choice** — the eight presets plus `Keep the current configuration`. When the bundled stack is up with its upstream key set, the bridge line carries a `← recommended` marker (the zero-extra-keys path).
3. **API key** — typed input is **masked** (per-char `•`, backspace works, Ctrl+C cancels cleanly). A blank key continues keyless (fine for local servers). If a key is already stored, you get `sk-12345… ✓ already stored (auth.json)` and choose **Keep / Replace / Clear** — Keep preserves the storage form, Clear removes every local trace of it.
4. **Model, live** — the endpoint is probed with the key you just gave, and you pick from what it **actually serves** (the preset default is preselected). Unreachable or a non-OpenAI wire (Anthropic) falls back to typing the id, with the reason stated.
5. **Specs, verified** — the model's context window and max output tokens are detected from verifiable sources (the endpoint's own catalog, the curated table, models.dev, LiteLLM). Nothing verifiable? The wizard asks — validated numbers only, with the receipt of what was tried — because those two numbers drive compaction and the output cap ([providers: model specs](providers.md#model-specs)).
6. **The look** — pick a TUI theme (the current one first — blank keeps it; `dark`/`light` + any `~/.unown/agent/themes/*.json`). Switch any time in-session with `/settings`.
7. **Setup summary** — provider, model (+N discovered), where the key lives (`auth.json` mode 0600 / `$ENV` ref / keyless / bridge placeholder), theme, verify result, kept sibling providers, the files touched, and the specs row (`262,144 ctx / 16,384 out · models.dev`) — followed by `Next` commands and **First flights**, the four starter tasks (the first TUI session offers the same catalog interactively — below).

Every step has a default (blank = take it), Ctrl+C cancels with `nothing written`, and existing providers are never dropped (merge semantics; `--force` is the explicit reset).

## 4. Start the stack (optional but recommended)

These two services ship with the `--source` install. A standalone binary install ships no bridge to start; its engine can still be started on demand with `unown engine start`, but the jobs that call a model need a bridge to reach.

The bridge + self-learning engine are what make unown *learn* (session notes → AutoDream → project memory + skills). Chat works without them — notes just queue locally until the engine returns. Mission control is not a web service: `unown dashboard` (or `/dashboard` inside a session) is a fullscreen TUI client of the engine, so the launcher starts no third server.

```bash
bun run agent:start
```

| Service | Port | Health |
|---|---|---|
| llm-bridge | 3031 | `curl localhost:3031/health` |
| self-learning engine | 3030 | `curl localhost:3030/api/overview` |

Then open mission control in your terminal: `unown dashboard` (12 screens — Overview, Memory, Dreams, Notes, Skills, Learning Lab, Hooks, Router, Recovery, Gateway, Automations, Web Cache).

If the upstream key is missing or the upstream is unhealthy, the launcher prints a loud warning instead of letting chats fail with a bare 401 later.

## 5. First session

```bash
cd ~/code/my-project        # ANY project of yours
unown                        # full interactive TUI (the real pi TUI + learning layer)
unown "fix the failing tests"          # start with a prompt
unown -p "explain the build error"     # one-shot headless, like claude -p
unown --plan "add auth"                # read-only exploration → numbered plan → approve to execute
```

**First run**: on a fresh install, `unown` asks once — `Connect one now? (Agnes, OpenAI, OpenRouter, Anthropic, Dashscope, DeepSeek, local…)` — `Enter` opens the same guided wizard `unown setup` runs; `n` skips (on a source install the bundled bridge stays wired; on a standalone binary there is no provider yet). Re-run `unown setup` any time. After a completed wizard the first-run banner is skipped (the setup summary already said everything); after declining it tells you exactly what you are on. The offer never repeats — delete `~/.unown/agent/` to see it again.

**First flights**: the first TUI session opens with a one-time starter catalog in place of the empty editor — the same four tasks the setup summary lists (`1`–`4` or ↑↓+Enter pick, `Esc` closes for this session, `x` stops the auto-show for good). Picking one drops the prompt into the editor ready to send — press Enter, or edit it first. The catalog retires the moment you send your first real message (a flight's or your own; `Esc` alone brings it back next session), `/flights` reopens it any time, and `unown "a prompt"` never shows it — that prompt is the first task.

**After the first task**: when that first reply fully settles, one transcript line marks the moment (`You're flying — the first task is done. …`) with the pointers that matter next; each later session then opens with one quiet tip you haven't seen — `/undo`, the `ctrl+k` palette, `/plan`, project memory — until all four are spent, after which onboarding stays silent. Every tip shows exactly once, ever (the same `onboarding.json` latch).

Before the first message, unown pre-flights the model endpoint — if it can't reach it or the key is rejected you get the exact fix, not a stack trace. When you exit, the session leaves a note for AutoDream; come back tomorrow and the project's `.unown/memory/project.md` remembers what mattered.

Every session also ships **native web access** — no keys, no MCP setup required:

```bash
unown -p "web_search for the latest React version, then webfetch the release notes and summarize the breaking changes"
```

The `web_search` tool works keyless out of the box (DuckDuckGo → Tavily keyless → You.com → StackExchange → Wikipedia → HN, plus npm and GitHub repo search); dropping any of the ten API-key provider keys (Tavily, Brave, Serper, Exa, Perplexity, Jina, Zhipu, DashScope, Kagi, SerpApi) into `.env` prepends that provider to the chain. `webfetch` reads any http(s) page as text, SSRF-hardened and robots-aware. Details and the full provider table: [usage](usage.md) · [configuration](configuration.md).

Confirm everything end to end:

```bash
unown doctor        # all green = you can chat; ⚠ items only affect learning features
```

## Where to go next

- [usage](usage.md) — every command, slash command, and keybinding
- [providers](providers.md) — models.json, the bridge vs direct endpoints, custom providers
- [subagents](subagents.md) — fresh-context task agents you can define in markdown
- [skills](skills.md) — SKILL.md files, the four starters, and skills that grow themselves
- [memory](memory.md) — the 4-tier memory stack and how AutoDream consolidates it
- [configuration](configuration.md) — every environment variable and state file
- [troubleshooting](troubleshooting.md) — symptom → cause → fix
