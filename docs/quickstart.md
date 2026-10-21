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

- [bun](https://bun.sh) ≥ 1.2 — macOS/Linux: `curl -fsSL https://bun.sh/install | bash` (or `brew install bun`) · Windows: `powershell -c "irm bun.sh/install.ps1 | iex"` (then open a new terminal). The `--binary` lane below needs neither bun nor git.
- [git](https://git-scm.com) (any build; on Windows the standard Git-for-Windows install is fine)
- An API key for any OpenAI-compatible provider — Dashscope, OpenAI, OpenRouter, Anthropic, DeepSeek, or a local server (vLLM, Ollama, llama.cpp)
- **Windows, macOS, or Linux** — the same commands and the full stack on all three. OS-level engine sandbox: Linux (bubblewrap) + macOS (seatbelt); native Windows uses the in-process path jail (WSL2 for kernel-grade isolation). Per-OS details: [Windows guide](windows.md) · [macOS guide](macos.md)

## 2. Install

The default one-liner installs the **newest stable release tag** and the full stack (terminal agent + engine + bridge):

```bash
# macOS / Linux / WSL (POSIX sh)
curl -fsSL https://unown-nine.vercel.app/install.sh | sh
```

```powershell
# Windows (PowerShell) — the irm|iex twin of the same installer
irm https://unown-nine.vercel.app/install.ps1 | iex
```

`--main` / `-Main` installs the edge branch instead; `--version vX.Y.Z` / `-Version vX.Y.Z` pins a stable tag (the current tag is on [Releases](https://github.com/kanishka-namdeo/Unown/releases)). PowerShell's `irm | iex` cannot pass flags — download `install.ps1` first to use them. The installer resolves the newest stable tag itself; prereleases are never picked.

Or the three commands by hand, pinned to that same tag:

```bash
git clone --branch vX.Y.Z https://github.com/kanishka-namdeo/Unown.git
cd Unown
bun run agent:install
```

(Plain `git clone` gives you `main` — the edge lane.)

Only want the CLI on this machine, with no git and no bun? Add `--binary` on POSIX or use `install.ps1 -Binary` on Windows: a verified release download installed under a versioned root with a PATH shim. The binary has no engine, bridge or dashboard data source — for those, use the source install ([details](install.md)).

The source install runs `bun install --frozen-lockfile` at the repo root and in the vendored pi monorepo (`pi-repo/`), builds it — hydrating its provider model data on first run (that directory is gitignored upstream, so fresh clones fetch it once, ~1–2 min) — creates `.env` from `.env.example` if you don't have one, and puts the `unown` command on your PATH via a shim (`~/.local/bin/unown` → this checkout; on Windows: `%USERPROFILE%\.local\bin\unown.cmd` + `unown.ps1`). If your PATH misses it, the installer tells you exactly what to add — or re-run `bun run agent:link` anytime.

> **Windows notes**
> - If the installer just added `%USERPROFILE%\.local\bin` to your PATH, **restart your terminal** before `unown` resolves.
> - cmd.exe picks up `unown.cmd` automatically; PowerShell users get `unown.ps1` (if script execution is disabled on a locked-down machine, run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`).

Verify:

```bash
unown --help        # the command surface
unown doctor        # diagnostics — expect one ✗ (no upstream key yet)
```

Stay current with `unown update`; `unown update --check` reports without changing anything (exit `0` up to date, `2` available, `1` error). The command is mode-aware — a source checkout moves tag to tag, a binary install downloads and verifies the next release ([updating](updating.md)).

## 3. Connect a model

**The one required credential is an upstream key.** Two supported shapes:

### Option A — the bundled bridge (recommended: full stack + model routing)

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

## 4. Start the stack (optional but recommended)

The bridge + self-learning engine are what make unown *learn* (session notes → AutoDream → project memory + skills). Chat works without them — notes just queue locally until the engine returns. Mission control is not a web service: `unown dashboard` (or `/dashboard` inside a session) is a fullscreen TUI client of the engine, so the launcher starts no third server.

```bash
bun run agent:start
```

| Service | Port | Health |
|---|---|---|
| llm-bridge | 3031 | `curl localhost:3031/health` |
| self-learning engine | 3030 | `curl localhost:3030/api/overview` |

Then open mission control in your terminal: `unown dashboard` (11 screens — Overview, Memory, Dreams, Notes, Skills, Learning Lab, Hooks, Router, Gateway, Automations, Web Cache).

If the upstream key is missing or the upstream is unhealthy, the launcher prints a loud warning instead of letting chats fail with a bare 401 later.

## 5. First session

```bash
cd ~/code/my-project        # ANY project of yours
unown                        # full interactive TUI (the real pi TUI + learning layer)
unown "fix the failing tests"          # start with a prompt
unown -p "explain the build error"     # one-shot headless, like claude -p
unown --plan "add auth"                # read-only exploration → numbered plan → approve to execute
```

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
