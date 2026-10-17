<p align="center">
  <img src=".github/assets/banner.png" alt="unown — the self-improving coding agent" width="880">
</p>

# unown

Unown takes the open-source **[pi coding agent](https://github.com/badlogic/pi-mono)** and turns it into a full-fledged **self-learning agent**, applying the five mechanisms Anthropic popularized by *using Claude Code to improve Claude Code*:

> Let the agent find its own weaknesses. Let it fix them. Let it remember what worked.

Use it two ways:

- **In your terminal** — `unown` gives you a full interactive coding-agent session (the real pi TUI) in your actual project directory, with tiered memory injected, guardrail hooks active, and session notes captured for learning.
- **As a learning backend** — the engine keeps running harness cycles, AutoDream consolidation and background jobs; your terminal sessions feed it notes, and it writes improved memory back into your project.

<p align="center">
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-1.4.3-black?logo=bun" alt="Bun"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-7.0.2-3178C6?logo=typescript&amp;logoColor=white" alt="TypeScript"></a>
  <a href="https://nextjs.org"><img src="https://img.shields.io/badge/Next.js-16.4-black?logo=nextdotjs" alt="Next.js"></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/React-19.3-61DAFB?logo=react&amp;logoColor=black" alt="React"></a>
  <a href="https://tailwindcss.com"><img src="https://img.shields.io/badge/Tailwind_CSS-4.3-06B6D4?logo=tailwindcss" alt="Tailwind CSS"></a>
  <a href="https://www.prisma.io"><img src="https://img.shields.io/badge/Prisma-7.10-2D3748?logo=prisma" alt="Prisma"></a>
  <a href="https://github.com/containers/bubblewrap"><img src="https://img.shields.io/badge/bubblewrap-OS%20sandbox-00557F" alt="bubblewrap"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/MIT-License-3DA639?logo=opensourceinitiative" alt="MIT License"></a>
</p>

**[Quickstart](#quickstart)** · **[Documentation](#documentation)** · **[Landing page](#landing-page)** · **[Dashboard tour](#mission-control)** · **[Architecture](#architecture)** · **[The learning loop](#the-learning-loop)** · **[Configuration](#configuration)** · **[Security](#security-model)** · **[What it learned](#what-a-learning-session-looks-like)**

![unown dashboard tour — Overview, Learning Lab and Memory tabs](.github/assets/tour.gif)

## The five mechanisms

| # | Mechanism | Where it lives | What it does |
|---|-----------|----------------|--------------|
| 1 | **Tiered Memory** | [`memory.ts`](pi-repo/packages/self-learning/src/memory.ts) · [`term.ts`](pi-repo/packages/self-learning/src/term.ts) | Four tiers — policy → project → user → local — merged most-specific-wins and injected into every agent session (engine sandboxes *and* terminal sessions). Every write is versioned, attributable (`seed` / `harness` / `autodream` / `rollback`) and rollback-able. |
| 2 | **Self-Improving Harness** | [`harness.ts`](pi-repo/packages/self-learning/src/harness.ts) · [`mint.ts`](pi-repo/packages/self-learning/src/mint.ts) | Runs a benchmark task → if it fails, mines the failure transcript → asks the LLM for memory rules that would have prevented it → re-runs a *candidate* with the patched memory → ships the patch only if it passes **twice** (candidate + confirmation — a noise gate) then sweeps for regressions. Shipped patches that later regress are automatically **un-shipped** (retention check). When the whole suite passes, **task minting** keeps the loop fed: it converts real failures — or LLM-authored harder curriculum variants — into new capability-eval tasks, which graduate into the regression suite once the agent masters them. |
| 3 | **Routing** | [`router.ts`](pi-repo/packages/self-learning/src/router.ts) | Seven jobs keep the agent learning in the background: interval jobs `harness-cycle`, `task-mint`, `auto-dream`, `note-sync`, `sandbox-gc`, plus event jobs on `improvement:shipped` and `run:finished` — with a busy-mutex so the sandbox is never double-driven. |
| 4 | **AutoDreaming + Skill Acquisition** | [`dream.ts`](pi-repo/packages/self-learning/src/dream.ts) · [`skills.ts`](pi-repo/packages/self-learning/src/skills.ts) | Session notes are consolidated: benchmark notes into the engine's project memory (gated by a canary run — a dream that breaks the last-passing task is rolled back), terminal notes into **your project's own** `.unown/memory/project.md`. When the notes reveal recurring multi-step procedures, AutoDream also mints them as **Agent Skills** — concrete `SKILL.md` procedures written into `.unown/skills/`, versioned and rollback-able — that the next session picks up through progressive disclosure. |
| 5 | **Hooks** | [`hooks.ts`](pi-repo/packages/self-learning/src/hooks.ts) · [`termhooks.ts`](pi-repo/packages/self-learning/src/termhooks.ts) | A pi inline extension enforcing guardrails at every layer: `SessionStart`, `UserPromptSubmit`, `PreToolUse` (bash deny-list + path jail), `PostToolUse` (syntax gate that feeds errors back to the agent), `Stop`, `SubagentStop`. Every decision is logged. |

Everything is observable from a **mission-control dashboard** (Next.js) with live SSE activity, run transcripts, memory version history, dream journals, hook decision logs, an interactive console, and the job router.

## Architecture

```mermaid
flowchart TB
    subgraph project["your project"]
        TUI["unown terminal agent<br>(pi TUI + guardrail hooks)"]
        PM("project memory<br>.unown/memory/project.md")
    end
    subgraph dash["dashboard · :3000"]
        UI["Next.js mission control<br>7 tabs · live SSE feed"]
    end
    subgraph engine["self-learning engine :3030"]
        ENG["memory · harness · dream<br>router · sandbox"]
        SB["bubblewrap sandbox<br>fresh per run"]
        DB[("SQLite<br>runs · cycles<br>dreams · memory")]
    end
    subgraph bridge["llm-bridge :3031"]
        BR["model routing + auth<br>SSE passthrough · backoff"]
    end
    LLM["OpenAI-compatible upstream<br>kimi-k2.5 · qwen3.7-plus · qwen3.6-plus"]

    TUI -- "session notes" --> ENG
    UI -- "REST + SSE" --> ENG
    ENG -- "agent runs" --> SB
    SB -- "chat" --> BR
    BR -- "routed" --> LLM
    ENG -- "records" --> DB
    ENG -.-> PM
```

The dotted edge is AutoDream writing consolidated memory back into your project. Each harness/task run deploys a **fresh sandbox** (isolated directory, jailed exec, OS-level [bubblewrap](https://github.com/containers/bubblewrap) isolation, tamper-proof sha256-verified tests), injects the resolved tiered memory into the agent's system prompt, attaches the hooks extension, streams the transcript back, verifies the result, and records a session note for the next dream.

## The learning loop

The harness is the heart of the system — a verify-gated loop that only ever ships memory changes a fresh sandbox has proven correct, and that keeps itself supplied with things it cannot yet do:

```mermaid
flowchart TB
    A(["harness cycle"]) --> B["run benchmark task<br>in a fresh sandbox"]
    B --> C{"pass?"}
    C -- "yes" --> G{"capability eval?"}
    G -- "yes" --> GR(["graduate into<br>the regression suite"])
    G -- "no" --> Z(["done · sweep regressions"])
    C -- "no" --> D["mine the failure transcript<br>for candidate memory rules"]
    D --> E["candidate run<br>same task · patched memory"]
    E --> F{"verified twice?"}
    F -- "no" --> D2(["discard patch · re-mine"])
    F -- "yes" --> G2["ship patch to memory"]
    G2 --> H["regression sweep +<br>retention auto-unship"]
    H --> Z
    S(["suite saturated?<br>task-mint job"]) -. "mint harder tasks<br>from failures / curriculum" .-> B
    Z -. "next cycle" .-> A
```

---

## Documentation

Full usage docs live in [`docs/`](docs/):

| Page | What it covers |
|---|---|
| [quickstart](docs/quickstart.md) | clone → install → connect a model → first session (5 minutes) |
| [providers](docs/providers.md) | `unown setup`, models.json / auth.json / settings.json, the bridge vs direct endpoints, custom providers |
| [usage](docs/usage.md) | every command, slash command, keybinding, session tool, plan mode |
| [subagents](docs/subagents.md) | the `task` tool, built-in `general`/`explore`, authoring `.unown/agents/*.md` |
| [skills](docs/skills.md) | the Agent Skills format, the four starters, skills AutoDream mints on its own |
| [memory](docs/memory.md) | the 4-tier memory stack, session notes, AutoDream consolidation |
| [memory-classifier-evaluation](docs/memory-classifier-evaluation.md) | objective evaluation of Jev/GLiNER-style classifiers in the memory system |
| [oh-my-pi-swap-assessment](docs/oh-my-pi-swap-assessment.md) | decision record: why the vendored pi harness stays, and what would reopen that call |
| [configuration](docs/configuration.md) | every environment variable, `.env` semantics, state files layout |
| [troubleshooting](docs/troubleshooting.md) | symptom → cause → fix (including `unown doctor` semantics) |

---

## Quickstart

### Prerequisites

- [bun](https://bun.sh) ≥ 1.2 — macOS/Linux: `curl -fsSL https://bun.sh/install | bash` · Windows: `powershell -c "irm bun.sh/install.ps1 | iex"` (then open a new terminal)
- [git](https://git-scm.com)
- An OpenAI-compatible LLM endpoint (see *Using a different model provider* below)
- Windows, macOS, or Linux — the same commands on all three (OS-sandboxing is Linux-only; everything else works everywhere)

### 1. Install

Identical on every OS:

```bash
git clone https://github.com/kanishka-namdeo/Unown.git
cd Unown
bun run agent:install
```

This installs dashboard dependencies, installs and builds the bundled pi monorepo (`pi-repo/` — hydrating its provider model data on first run, ~1–2 min), creates `.env` from `.env.example` if missing, and puts `unown` on your PATH (a shim into `~/.local/bin` on macOS/Linux, `%USERPROFILE%\.local\bin\unown.cmd` + `unown.ps1` on Windows — see below). Windows: if the installer just changed your PATH, restart your terminal; PowerShell may need `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once for the `.ps1` shim.

### 2. Connect a model

**One credential is required: an upstream API key.** Either wire the bundled bridge (recommended — full stack, model routing, nothing secret on client machines):

```bash
# .env
BRIDGE_UPSTREAM_URL=https://dashscope.aliyuncs.com/compatible-mode/v1   # any OpenAI-compatible base URL
BRIDGE_UPSTREAM_KEY=<your key>
BRIDGE_KNOWN_MODELS=kimi-k2.5,qwen3.7-plus,qwen3.6-plus

unown setup --provider bridge     # point the terminal agent at it
```

…or skip the stack entirely and use any provider directly:

```bash
unown setup --provider openai --api-key sk-... --model gpt-4o
# presets: openai · openrouter · anthropic · dashscope · deepseek · custom (any OpenAI-compatible endpoint)
unown setup                        # or the interactive wizard
```

`unown setup` verifies the endpoint and key before declaring success, and writes `~/.unown/agent/{models.json,auth.json,settings.json}`. See [docs/providers.md](docs/providers.md).

### 3. Start

```bash
bun run agent:start
```

Boots three services:

| Service | Default port | Health check |
|---------|--------------|--------------|
| llm-bridge | 3031 | `GET /health` |
| self-learning engine | 3030 | `GET /api/overview` |
| dashboard | 3000 | `http://localhost:3000/dashboard` |

Logs land in `.run/*.log`; stop with `bun run agent:stop`. The launcher reads the bridge's `/health` (upstream key set? upstream answering?) and warns loudly instead of letting chats fail with a bare 401 later.

### 4. Use it in your terminal

`unown` runs the agent in your **real project directory** — the full pi TUI (file tools, bash, session management, `@file` mentions), plus the self-learning layer:

```bash
cd ~/code/my-project
unown                      # interactive session (like claude/pi, but learning)
unown "fix the failing tests"   # …optionally starting with a prompt
unown -p "explain the build error" | less   # one-shot headless (like claude -p)
unown --plan "add auth"    # plan mode: read-only exploration → numbered plan
unown setup                # connect a provider (wizard or flags)
unown models               # list configured models (+ what the bridge serves)
unown doctor               # end-to-end diagnostics: endpoint, keys, upstream, memory
unown memory               # print the effective 4-tier memory stack
unown note "watch out: flaky test in auth.spec"   # hand AutoDream a note directly
```

Every session is pre-flighted: if the model endpoint is unreachable or rejects the credentials, you get the exact fix (start the stack / re-run setup) instead of a stack trace. Full command and keybinding reference: [docs/usage.md](docs/usage.md).

Every session ships with **Claude Code-grade session tools** on top of pi:

- **`todo`** — a visible task list the agent maintains as it works (and `/todos` to inspect it). State rides the session tree, so branching keeps the right list.
- **`task`** — subagents with a **fresh context window** (`general` full-tool, `explore` read-only, or your own `.unown/agents/*.md` definitions — run `/agents` to list). They are full unown agents: same memory, same guardrails — and their sessions write `[subagent]`-tagged notes, so **subagents learn too**. Up to 4 in parallel via `{tasks: [...]}` (authoring guide: [docs/subagents.md](docs/subagents.md)).
- **`note`** — record a durable learning note **mid-session**; it reaches the engine immediately and AutoDream consolidates it into your project's memory (also `/note <text>`).
- **`fetch_url`** — read-only HTTP GET with HTML stripping and size caps.
- **`/plan`** (or `--plan`, or Ctrl+Alt+P) — plan mode: write tools disabled, bash allowlisted to read-only commands; the agent explores, produces a numbered plan, and you approve execution with live `[DONE:n]` progress.
- **Skills** — four starter Agent Skills (`unown-self-learning`, `verification-first`, `methodical-debugging`, `repo-exploration`) are seeded into `~/.unown/agent/skills/`; drop per-project skills into `.unown/skills/<name>/SKILL.md` (pi implements the [Agent Skills](https://agentskills.io) standard, progressive disclosure included).
- **`/learning`** — re-print the effective 4-tier memory stack, fresh from disk.

What the terminal session does for you:

- **Memory** — the resolved stack (global policy → your project's `.unown/memory/project.md` → global user memory → `.unown/memory/local.md`) is injected into every session (re-read on each `/new` `/resume` `/fork`, so AutoDream's updates land without a restart), alongside your own `AGENTS.md`/`CLAUDE.md` chain if present.
- **Skills that grow themselves** — when your session notes keep describing the same multi-step procedure (how to run this test suite, how to deploy, how to debug the flaky part), AutoDream mints it as an Agent Skill into `.unown/skills/<name>/SKILL.md` — versioned in the engine, rollback-able and retire-able from the dashboard — and the very next session can use it (progressive disclosure: only the name + description ride the prompt until needed).
- **Guardrails** — catastrophic commands (`rm -rf /`, fork bombs, disk formats) and out-of-project writes are blocked before execution; broken JS/TS you (or the agent) write gets the transpiler error fed back instead of compounding. Normal work — network, `git push`, package installs — is allowed. Set `UNOWN_STRICT_HOOKS=1` for sandbox-grade strictness.
- **Learning** — when you exit, a session note is delivered to the engine; AutoDream consolidates your notes into an updated `.unown/memory/project.md`, so the next session starts where the last one ended. Notes queue in `~/.unown/notes/outbox/` when the engine is down and sync automatically later.

Install the command globally (optional):

```bash
bun run agent:link         # writes a `unown` shim into ~/.local/bin → this checkout
                         # (Windows: %USERPROFILE%\.local\bin\unown.cmd + unown.ps1,
                         #  and appends the dir to your user PATH)
```

A shim (not `bun install -g .`) is the supported global-install path: it keeps the vendored pi workspace resolution and subagent spawning intact. Re-run it after moving the repo. Full reference: [docs/usage.md](docs/usage.md).

### 5. Watch it learn

Open **http://localhost:3000/dashboard**:

- **Overview** — pass rate, shipped improvements, dream count, memory version, hook decisions, token usage.
- **Learning Lab** — every harness cycle: baseline run → failure diagnosis → proposed memory patch → candidate run → ship/reject, with full transcripts.
- **Memory** — the four tiers, their contents, full version history and one-click rollback — plus the Agent Skills AutoDream minted into your projects (with rollback and retire).
- **Dreams** — AutoDream sessions: merged / pruned / added notes and the consolidated memory they produced.
- **Hooks** — the decision log of every guardrail (allow / deny / augment).
- **Console** — drive the sandboxed agent interactively and watch the transcript stream.
- **Router** — background jobs: enable/disable, trigger manually, see run counts and next-fire times.

The engine seeds itself on first boot: default memory tiers, five benchmark tasks (`fizzbuzz`, `impl-debounce`, `map-limit`, `drop-right`, `fix-csv-parser`), and the router jobs. Leave it running and the `harness-cycle` job will keep mining failures and shipping memory improvements on its own.

---

## Landing page

`bun run agent:start` (or `bun run dev`) serves a **marketing landing page at `/`** and **mission control at `/dashboard`**.

The landing page is built around the name. Unown is the Symbol Pokémon — a flat black letter with one eye, alive since 1999, found on the walls of ruins reading what is written there — and `unown` is a pun you have to read twice. So the page carries a **28-form alphabet drawn from scratch for this project** (inline SVG, no font file, no sprite sheet): hover or focus any form in the wall to decode the lore it borrows and the real mechanism it stands for here. A typed session, the engine's literal note template and harness log strings, benchmark receipts, the six integrity gates and a working install command fill out the rest.

![unown landing page — the terminal coding agent that remembers](public/landing/landing-hero.png)

Every number and every quoted artifact on that page is checkable, nothing from a Pokémon release is bundled or reproduced, and the page says plainly that it is an independent project. The design rationale, the lore sourcing rules and the asset licences are in [`docs/landing-research.md`](docs/landing-research.md); the section contracts are in [`src/components/landing/AGENTS.md`](src/components/landing/AGENTS.md).

---

## Mission control

The dashboard is a live window onto the engine — every number below is real data from a running instance, streamed over SSE:

![unown dashboard — Overview tab with live KPIs](.github/assets/dashboard-overview.png)

| | |
|---|---|
| ![Learning Lab — harness cycles, runs and transcripts](.github/assets/dashboard-learning-lab.png) | ![Memory — the four tiers and version history](.github/assets/dashboard-memory.png) |
| ![Dreams — AutoDream sessions and pending notes](.github/assets/dashboard-dreams.png) | ![Hooks — the guardrail decision log](.github/assets/dashboard-hooks.png) |
| ![Console — drive the sandboxed agent live](.github/assets/dashboard-console.png) | ![Router — background jobs](.github/assets/dashboard-router.png) |

It is fully responsive — the same live KPIs, chart and activity feed on a phone:

<p align="center">
  <img src=".github/assets/dashboard-mobile.png" alt="unown dashboard on mobile" width="360">
</p>

## Configuration

All variables are optional; defaults in parentheses. Author `.env` from [`.env.example`](.env.example).

| Variable | Applies to | Meaning |
|----------|------------|---------|
| `PI_AGENT_PORT` | engine | REST+SSE API port (3030) |
| `PI_BRIDGE_URL` | engine + terminal | LLM endpoint the agent talks to (http://127.0.0.1:3031) |
| `PI_MODEL_ID` / `PI_PROVIDER` | engine + terminal | model / provider registered with pi (kimi-k2.5 / zai-bridge) |
| `PI_SELFLEARNING_DATA` / `PI_SELFLEARNING_DB` | engine | runtime data dir & SQLite path (`data/self-learning`, `db/selflearning.db`, resolved relative to the repo) |
| `PI_DREAM_GATE` | engine | `0` disables the dream canary gate (default on) |
| `BRIDGE_PORT` | bridge | listen port (3031) |
| `BRIDGE_UPSTREAM_URL` | bridge | upstream OpenAI-compatible base URL — any provider works |
| `BRIDGE_UPSTREAM_KEY` | bridge | upstream bearer key |
| `BRIDGE_MODEL` / `BRIDGE_ROUTE_DEFAULT` | bridge | advertised default model + fallback for unknown model ids (kimi-k2.5) |
| `BRIDGE_KNOWN_MODELS` | bridge | comma-separated passthrough allow-list (kimi-k2.5,qwen3.7-plus,qwen3.6-plus) |
| `BRIDGE_QWEN_THINKING` | bridge | `1` keeps qwen thinking models in thinking mode (default: off, for snappy agent turns) |
| `BRIDGE_MIN_SPACING_MS` | bridge | minimum spacing between upstream requests in ms (400) |
| `BRIDGE_UPSTREAM_TIMEOUT_MS` | bridge | cap on time-to-response-headers per upstream attempt in ms (180000) — a stalled upstream fails fast instead of wedging callers; streaming bodies stay uncapped |
| `BRIDGE_API_KEY` | bridge | when set, require `Authorization: Bearer <key>` on every request (unset = open, localhost-only use) |
| `NEXT_PUBLIC_AGENT_API_BASE` | dashboard | point the dashboard directly at the engine (`http://localhost:3030`) or an API-gateway prefix; unset keeps the sandbox gateway mode |
| `UNOWN_HOME` | terminal | state dir for the `unown` CLI: agent config, global memory, note outbox (`~/.unown`) |
| `UNOWN_ENGINE_URL` | terminal | where the CLI delivers session notes (`http://127.0.0.1:3030`) |
| `UNOWN_STRICT_HOOKS` | terminal | `1` = sandbox-grade hooks in terminal sessions (blocks network, git push, sudo); unset allows normal developer operations |
| `UNOWN_OS_SANDBOX` / `UNOWN_SANDBOX_NET` / `UNOWN_BWRAP` | engine | bubblewrap toggle (`1`) / keep network shared (`0`) / explicit bwrap binary path (vendored by default) |
| `UNOWN_MAX_MINTED_TASKS` | engine | cap on ACTIVE minted tasks before the `task-mint` job skips (8) |
| `UNOWN_NO_PREFLIGHT` | terminal | `1` skips the model-endpoint reachability check before sessions |

### Using a different model provider

The bundled `llm-bridge` turns **any OpenAI-compatible upstream** (Dashscope, OpenAI, OpenRouter, vLLM, llama.cpp server, …) into a local endpoint the pi agent can use: it injects upstream authentication, routes requested model ids onto its allow-list (unknown ids fall back to the default model), translates `thinking` flags for qwen models, passes tool calls and image content through natively, streams SSE back untouched, and serializes/throttles/retries requests. Or skip the bridge entirely — `unown setup` connects the terminal agent straight to any provider (see [docs/providers.md](docs/providers.md)).

```bash
PI_BRIDGE_URL=https://api.openai.com/v1 \
PI_MODEL_ID=gpt-4o \
PI_PROVIDER=openai \
bun run agent:engine
```

The engine writes the provider into `data/self-learning/pi-agent-dir/models.json` for pi automatically. For the **terminal agent**, `unown setup` handles the same wiring (or edit `~/.unown/agent/models.json` by hand — it accepts any pi-supported provider; see [docs/providers.md](docs/providers.md)).

### Production notes

- Run the engine **without** hot reload: `cd mini-services/agent-service && bun index.ts` (the dev scripts use `bun --hot`, which is convenient but can detach in-flight cycles from the router mutex when engine sources change mid-run).
- Put `BRIDGE_API_KEY` on the bridge and front the engine/dashboard with your TLS terminator / reverse proxy of choice.
- The engine is single-tenant by design (busy-mutex); horizontally scale by running more engine instances against separate data dirs (`PI_SELFLEARNING_DATA` / `PI_SELFLEARNING_DB`).

## Security model

- **Sandboxes (OS-level)**: every engine run — verify scripts *and* the agent's own bash commands — executes under [bubblewrap](https://github.com/containers/bubblewrap) (the same foundation Flatpak, Claude Code and Codex use for Linux sandboxing): read-only root filesystem, private `/home` `/tmp` `/run` (the repo, `.env` secrets and engine data are invisible), killed network namespace, dropped capabilities. On hosts without bubblewrap the engine falls back to the in-process path jail. Set `UNOWN_OS_SANDBOX=0` to disable, `UNOWN_SANDBOX_NET=1` to keep the network shared. A verified bwrap binary is vendored in `pi-repo/packages/self-learning/native/` with recorded sha256 provenance.
- **Sandboxes (process)**: executed commands are jailed to the workspace with timeouts and output caps; benchmark tests are sha256-pinned so the agent cannot tamper with verification.
- **Hooks (engine)**: `PreToolUse` denies destructive shell (`rm -rf /`, `sudo`, outbound `curl`/`wget` to external hosts…), the path jail blocks escapes, and the `PostToolUse` syntax gate feeds transpiler errors back to the agent instead of letting broken code compound.
- **Hooks (terminal)**: the same gate protects interactive sessions but scoped for real work — catastrophic commands (filesystem-root deletion, fork bombs, disk formats) and writes outside your project/`/tmp` are blocked; network, `git push` and installs stay available. `UNOWN_STRICT_HOOKS=1` restores the sandbox-grade policy.
- **LLM bridge**: optional bearer auth, request serialization and rate-limit backoff.
- **No secrets in the repo**: the engine reads credentials from its environment at runtime.

## Learning integrity (how the system polices itself)

Self-modification without gates degenerates fast, so every memory write is controlled:

- **Ship gate** — a mined patch only enters memory after its candidate run passes verification in a fresh sandbox — **and the pass replicates** in a second confirmation run (a built-in noise gate: a lucky pass does not ship).
- **Mint gate** — a minted task only becomes an active capability eval if the agent genuinely FAILS it in a fresh sandbox; tasks the agent already solves are discarded (honest outcome), and minted tasks graduate into the regression suite only by passing a later harness cycle.
- **Dream canary gate** — an AutoDream consolidation of the engine's project memory must re-pass the most recently passing task; a dream that breaks it is rolled back automatically (status `gated`).
- **Retention check** — if a task later fails after its improvement shipped, the improvement is marked `regressed` and the memory is rolled back to the pre-ship version (auto-unship).
- **Skill mint gate** — skills are minted only from recurring multi-step procedures in consolidated notes, max 2 per dream, validated against the Agent Skills contract, deduplicated against everything already on disk; every version is recorded and rollback-able, retirement is a deliberate dashboard action (the engine never deletes your files on its own).
- **Full version history** — every write to every engine tier is versioned and attributable; engine tiers and minted skills roll back from the dashboard. Project memory (`.unown/memory/project.md`) is a plain versioned Markdown file — the engine records every version it writes, and restoring means pasting a prior version back (skills additionally have one-click rollback/retire with file writeback).

## What a learning session looks like

From the original development session (a weaker model driving the engine): `impl-debounce` **failed its baseline** (placeholder implementation, `setTimeout` against a mocked clock) → the harness mined the transcript, proposed rules ("drive time manually via an injectable `now()`", "flush the boundary lazily") → the **candidate run passed** → the rules were **shipped to project memory** → AutoDream later consolidated them into a reusable *Task playbook* section. Router jobs self-healed across service restarts and kept retrying the honestly-still-failing CSV task; memory reached project-tier v6 with every version attributable and rollback-able.

In this checkout — running kimi-k2.5 through the bridge — the engine has autonomously accumulated 60+ verified runs, 30+ AutoDream sessions consolidating 60+ session notes, 500+ hook decisions and a 20-version project-memory history. kimi-k2.5 solves all five seeded benchmark tasks unaided, so the improvement machinery finds nothing to ship — the honest outcome: **the loop only earns its keep when the model struggles**. That is exactly what task minting addresses: when the suite saturates, the `task-mint` job keeps authoring harder curriculum variants (each one validated by a real agent run — variants the model already solves are discarded just as honestly). Point it at a weaker model (or harder tasks) and the mining, patching and shipping above starts firing on its own.

## Repository layout

```
bin/unown                     the `unown` terminal agent entry point
docs/                         usage docs: quickstart, providers, usage, subagents,
                              skills, memory, configuration, troubleshooting
.github/assets/               README brand + dashboard screenshot assets
pi-repo/                      the pi coding agent (badlogic/pi-mono)
  packages/self-learning/     ★ the transformation — the self-learning layer
    src/memory.ts             tiered memory (pattern 1, engine side)
    src/term.ts               terminal-agent config: ~/.unown state, per-project memory resolution, note outbox, starter-skill seeding
    src/termhooks.ts          terminal guardrails + session-note capture (+ [subagent] provenance)
    src/tools.ts              session tools: todo / note / task (subagents) / fetch_url + plan mode
    src/skill-seeds.ts        starter Agent Skills seeded into ~/.unown/agent/skills/
    src/cli.ts                the `unown` command (TUI + headless + doctor/memory/init/note)
    src/hooks.ts              6-layer hook guardrails (pattern 5, engine side)
    src/harness.ts            self-improving loop + statistical ship gate + retention auto-unship (pattern 2)
    src/mint.ts               task minting: real failures / curriculum variants → capability evals → graduation
    src/router.ts             background jobs + events (pattern 3)
    src/dream.ts              AutoDream consolidation + canary gate + per-project dreams (pattern 4)
    src/skills.ts             skill acquisition: dream-minted Agent Skills (.unown/skills/), versioned
    src/notes.ts              session-note capture (benchmark + terminal kinds)
    src/outbox.ts             offline note delivery (engine-side sync)
    src/sandbox.ts            sandbox library: jails, snapshots, verification
    src/bwrap.ts              bubblewrap profile builder + OS-sandbox wrapper
    src/runner.ts             headless pi deployment + transcripts
    src/store.ts              SQLite persistence (runs, versions, logs)
    src/server.ts             REST + SSE API for the dashboard
    src/tasks.ts              seeded benchmark tasks
    native/bin/bwrap          vendored bubblewrap binary (sha256-pinned)
mini-services/
  llm-bridge/                 OpenAI-compatible gateway: routing, auth, SSE passthrough
  agent-service/              boots the engine (memory/tasks/router/API)
src/                          dashboard (Next.js App Router + shadcn/ui)
scripts/                      install/start/stop/link + verification tooling
data/self-learning/           runtime state (sandboxes, sessions, memory) — created on first run
db/selflearning.db            runtime SQLite store — created on first run
~/.unown/                     terminal-agent state (agent config, global memory, note outbox)
<project>/.unown/             per-project memory (commit project.md, ignore local.md)
blueprint/                    Unown v1 — the Claude Code harness blueprint this project grew out of
```

## Unown v1 — the blueprint

The first iteration of this project was a lightweight **Claude Code harness blueprint** (Python hooks, GitHub workflows, docs). It is preserved under [`blueprint/`](blueprint/) as reference material; Unown v2 — the pi-based autonomous engine in this README — supersedes it.

## Credits

- [badlogic/pi-mono](https://github.com/badlogic/pi-mono) — Mario Zechner's pi coding agent, bundled and extended here.
- The five self-improvement patterns popularized by Anthropic's engineering blog on improving Claude Code with Claude Code.

## License

MIT — see [LICENSE](LICENSE).
