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

- **Before editing**: walk from the repository root to your target and read every `AGENTS.md` on the path (parents first; the nearest doc is the local contract, and no child doc may weaken DOX).
- **After editing**: update the closest owning `AGENTS.md` when your change affects purpose, scope, structure, contracts, workflows, env vars, commands, or claims. The root doc's sync map lists the docs that go stale together with your change.
- Docs claims must match the code. A PR that leaves a doc contradicting the code is incomplete.

## Test Expectations

- All suites green before you ask for review: dashboard (`bun run test:unit`), engine (`pi-repo/packages/self-learning`), bridge (`mini-services/llm-bridge`). CI runs all three plus the 3-OS matrix.
- New behavior needs pinning tests. Changes to prompts, default models, routing, guard rules, hooks or memory injection additionally need a **CHANGELOG "Agent Behavior" entry** — the worked example (the `security-bypass` rule and its tests) is in [docs/BEHAVIOR.md](docs/BEHAVIOR.md).
- Measured claims cite receipts. `docs/testing-strategy.md` and `benchmarks/memory-eval/*/RESULTS.md` are the established formats.

## Commit Messages

Look at `git log` and match it: a lowercase prefix naming the surface, a specific summary line, and a body that explains what and why.

```
engine: chatJson/extractJson robustness — balanced-brace scan, reasoning fallback, single corrective retry

benchmarks+engine: MPBench-adapted corpus + memory-quality axes; security-bypass guard rule (found live, fixed, pinned)
```

Prefixes in use: `engine:`, `docs:`, `benchmarks:`, `landing:`, `scripts:`, `ci:`, `memory:`, `canary:`, `budget:`, `repo:`, `bin:`, `merge:`. The summary says what; the body says why — the history is its own best example.

## PR Checklist

Before opening the PR:

- [ ] `git status` reviewed, then **explicit-path staging only**: `git add <paths>` — never `git add -A` or `git add .` (the engine auto-commits learning artifacts into the tree; blanket staging ships them by accident).
- [ ] All suites green locally; receipts attached for measured claims.
- [ ] DOX pass done: nearest `AGENTS.md` updated (parents too, if structure changed); stale text removed.
- [ ] `CHANGELOG.md` updated for user-visible changes; **Agent Behavior** entry plus pinning tests for behavior changes.
- [ ] Secrets clean: keys only in `.env` (gitignored), PAT only in the git remote URL — never in tracked files, docs, logs, or commit messages.
- [ ] `bun run check:docs` passes.
