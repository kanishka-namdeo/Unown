# Contributing to Unown

Bugs, guard-bypass findings, benchmark ideas, docs fixes and code are all welcome. This page is the practical path from clone to merged PR. The working contract for the repo itself is [AGENTS.md](AGENTS.md) (the DOX system); what the agent does by default is pinned in [docs/BEHAVIOR.md](docs/BEHAVIOR.md).

## Setup

1. Install [bun](https://bun.sh) ≥ 1.2 (currently developed and CI-tested against 1.4.3): `curl -fsSL https://bun.sh/install | bash` on macOS/Linux, `powershell -c "irm bun.sh/install.ps1 | iex"` on Windows.
2. Fork, then clone your fork and install — identical on every OS:

   ```bash
   git clone https://github.com/<you>/Unown.git
   cd Unown
   bun run agent:install
   ```

   This installs dependencies, builds the vendored pi monorepo (`pi-repo/`, hydrating model data on first run), creates `.env` from `.env.example`, and puts `unown` on your PATH.
3. Connect a model. Either point `.env` at an OpenAI-compatible endpoint (`BRIDGE_UPSTREAM_URL`, `BRIDGE_UPSTREAM_KEY`) and run `unown setup --provider bridge`, or skip the stack and use any provider directly: `unown setup --provider openai --api-key ... --model ...`. See [docs/providers.md](docs/providers.md).
4. `bun run agent:start` boots the stack. `unown doctor` should come back green before you work on engine or bridge paths.

Terminal-agent-only contributions (docs, CLI) need nothing beyond step 3's direct-provider option; engine and bridge changes should be verified against the full stack.

## Command Surface

| Command | What it does |
|---|---|
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | `eslint .` |
| `bun run test:unit` | dashboard + landing suite (`bun test src`) |
| `bun run test:coverage` | suite plus the changed-line coverage gate (80% of touched lines) |
| `bun run check:docs` | link/anchor gate over `docs/*.md` |
| `bun run agent:install` / `agent:start` / `agent:stop` / `agent:link` | lifecycle (cross-platform bun TS; `agent:link` is the supported global-install path) |
| `bun run agent:bridge` / `bun run agent:engine` | single-service hot reload |
| `bun run unown` | the terminal agent CLI (`unown` once linked) |
| `cd pi-repo/packages/self-learning && bun test test/` | the engine suite |
| `cd mini-services/llm-bridge && bun test pure.test.ts` | the bridge suite (hermetic, offline) |

## The AGENTS.md DOX Contract

`AGENTS.md` files are binding work contracts for their subtrees — this is not optional etiquette:

- **Before any of it**: sync the checkout — fetch, measure divergence, `git pull --ff-only` (never a bare `git pull`). The gate itself, including what to do when the branch has diverged or the tree is dirty, is the root doc's [Git Preflight](AGENTS.md#git-preflight).
- **Before editing**: walk from the repository root to your target and read every `AGENTS.md` on the path (parents first; the nearest doc is the local contract, and no child doc may weaken DOX).
- **After editing**: update the closest owning `AGENTS.md` when your change affects purpose, scope, structure, contracts, workflows, env vars, commands, or claims. The root doc's sync map lists the docs that go stale together with your change.
- Docs claims must match the code. A PR that leaves a doc contradicting the code is incomplete.

## Test Expectations

- All suites green before you ask for review: dashboard (`bun run test:unit`), engine (`pi-repo/packages/self-learning`), bridge (`mini-services/llm-bridge`). CI runs all three plus the 3-OS matrix.
- New behavior needs pinning tests. Changes to prompts, default models, routing, guard rules, hooks or memory injection additionally need a **CHANGELOG "Agent Behavior" entry** — the worked example (the `security-bypass` rule and its tests) is in [docs/BEHAVIOR.md](docs/BEHAVIOR.md).
- A user-visible feature or fix does not stop at `CHANGELOG.md`: the landing page's shipping rail is generated from that file. Run `bun scripts/landing_changelog.mjs` to regenerate `src/components/landing/changelog-data.ts`, and never hand-edit the generated file. `bun run check:changelog` proves the two agree, and CI's landing job runs it next to `node --test scripts/landing_changelog.test.mjs` — so an entry that never reached the page is a red build, not a stale marketing site.
- Two more landing surfaces are generated, and one more is gated — the same obligation applies at the moment your change lands, not at review: a benchmark run under `benchmarks/` moves `bun scripts/landing_benchmarks.mjs` → `benchmarks-data.ts` (`bun run check:benchmarks`), and a job in `router.ts` `JOB_DEFS`, a hook/harness log string, a CLI command name or an AutoDream-written line in `.unown/memory/project.md` moves `bun scripts/landing_claims.mjs` → `engine-data.ts` and the page's quoted copy (`bun run check:claims`). All three `--check`s run in CI's landing job beside their extractor suites, and a generated data file is never the thing you edit to make one pass.
- Measured claims cite receipts. `docs/testing-strategy.md` and `benchmarks/memory-eval/*/RESULTS.md` are the established formats.

## Commit Messages

Look at `git log` and match it: a lowercase prefix naming the surface, a specific summary line, and a body that explains what and why.

```
engine: chatJson/extractJson robustness — balanced-brace scan, reasoning fallback, single corrective retry

benchmarks+engine: MPBench-adapted corpus + memory-quality axes; security-bypass guard rule (found live, fixed, pinned)
```

Prefixes in use: `engine:`, `docs:`, `benchmarks:`, `landing:`, `scripts:`, `ci:`, `memory:`, `canary:`, `budget:`, `repo:`, `bin:`, `merge:`. The summary says what; the body says why — the history is its own best example.

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
e2e/                          Playwright E2E + axe-core suite against a mock engine
scripts/                      install/start/stop/link + verification tooling
data/self-learning/           runtime state (sandboxes, sessions, memory) — created on first run
db/selflearning.db            runtime SQLite store — created on first run
~/.unown/                     terminal-agent state (agent config, global memory, note outbox)
<project>/.unown/             per-project memory (commit project.md, ignore local.md)
blueprint/                    Unown v1 — the Claude Code harness blueprint this project grew out of
```

## PR Checklist

Before opening the PR:

- [ ] `git status` reviewed, then **explicit-path staging only**: `git add <paths>` — never `git add -A` or `git add .` (the engine auto-commits learning artifacts into the tree; blanket staging ships them by accident).
- [ ] All suites green locally; receipts attached for measured claims.
- [ ] DOX pass done: nearest `AGENTS.md` updated (parents too, if structure changed); stale text removed.
- [ ] `CHANGELOG.md` updated for user-visible changes; **Agent Behavior** entry plus pinning tests for behavior changes. Then `bun scripts/landing_changelog.mjs`, so the landing rail carries the new entry (`bun run check:changelog` is the same check CI runs).
- [ ] Secrets clean: keys only in `.env` (gitignored), PAT only in the git remote URL — never in tracked files, docs, logs, or commit messages.
- [ ] `bun run check:docs` passes.
