# SDLC feature roadmap — 2026-10-19 forward

> Purpose: synthesis of the 2026-10-19 reverse-engineering sweep across nine
> coding agents (opencode, claude code, codex CLI, cline, goose, cursor, zcode,
> qoder — plus the prior oh-my-pi / muse / codewhale sweep already in
> `sdlc-feature-parity.md`). Each milestone ships tests + receipts + docs +
> a landing-page update + a git push.

Research sources:
- 2-a: opencode + claude code + codex CLI + cline — `/home/z/my-project/research/2-a-report.md`
- 2-b1: goose — `/home/z/my-project/research/2-b1-report.md`
- 2-b2: cursor + zcode — `/home/z/my-project/research/2-b2-report.md`

The standing invariant from `sdlc-feature-parity.md` governs every port:
**features land on pi's documented seams (extension factories, `pi.registerTool`,
`pi.registerCommand`, session entries, hooks) or in Unown's own packages — never
as forks of the vendored core.**

---

## Synthesis — the converged themes

Three load-bearing patterns emerged across all nine agents:

1. **Hooks have a richer contract than Unown ships today.** Claude Code, codex,
   cursor and goose all converged on multi-type hook handlers (command / HTTP /
   MCP-tool / Prompt / Agent) with semantic output entries (Warning / Stop /
   Feedback / Context / Error) and async execution. Unown's hooks are bash-only
   and return `allow / deny / mutate`. This is the foundation for several
   other features (adversary reviewer, pattern scanner, prompt audit).

2. **The "init / doctor / blame" trio is table stakes.** Every IDE-grade agent
   ships `/init` (generate AGENTS.md from repo forensics), `/doctor`
   (self-audit installation, skills, MCP, hooks against the actual codebase)
   and a blame view over the agent's own receipts. Unown ships `/doctor` for
   the engine surfaces but not for instruction sets; `/init` and `/blame`
   are absent.

3. **Declarative instruction bundles (recipes) + structured subagent routing
   are the new baseline for repeatable workflows.** goose Recipes (YAML/JSON
   with parameters, sub-recipes, response schemas, templates) and zcode's
   per-subagent MCP allowlist + `injectAgentsMd` toggle both encode what
   Unown currently leaves to ad-hoc prompts. The `task` tool's
   `output_schema` is half the story; recipes close the other half.

---

## Milestones (each ships tests + docs + landing + push)

### Milestone 0 — planning doc (this file)

- [x] Synthesize 2-a, 2-b1, 2-b2 reports
- [x] Commit + push as `docs/sdlc-feature-roadmap.md`
- [x] Verify CI scripts (`check:docs`, `check:changelog`, `check:benchmarks`,
      `check:claims`) still green

### Milestone 1 — Hook surface upgrade + slash-command UX (foundation)

The hook contract is the foundation for adversary reviewer, pattern scanner,
prompt audit and several recipe-driven flows. Land it first.

| # | Feature | Source | Seam | Complexity |
|---|---|---|---|---|
| 1.1 | Multi-type hook handlers (command / HTTP / MCP-tool / Prompt / Agent) + async | codex `protocol.rs:1693-1812`, claude code hooks docs | `pi-repo/packages/self-learning/src/hooks.ts` `HookResult` + `decideBash` | M |
| 1.2 | Semantic output entries (Warning / Stop / Feedback / Context / Error) | codex `protocol.rs:1771-1777` | same | S |
| 1.3 | New hook events: `PreModelRequest`, `PostModelRequest`, `PreCompact`, `PostCompact`, `SubagentStart`, `TaskCompleted`, `PermissionRequest` | codex `protocol.rs:1693-1708` | `hooks.ts` `HookName` + emit sites in `runner.ts` | M |
| 1.4 | **Adversary Mode** — `~/.config/unown/adversary.md` file-gated PreToolUse LLM reviewer (revisits the codex Guardian deferred entry, with a simpler implementation) | goose `adversary_inspector.rs` | new `adversary.ts` calling the Prompt hook handler from 1.1 | S |
| 1.5 | **Prompt-injection pattern scanner** — 80+ regex threat patterns with risk levels/categories, optional ML classifier + confidence threshold | goose `patterns.rs` + `scanner.rs` + `classification_client.rs` | new `injection-scanner.ts` invoked from PreToolUse hook | M |

**Tests**: `test/hooks-multitype.test.ts`, `test/adversary.test.ts`,
`test/injection-scanner.test.ts` (golden patterns + classifier mock).
**Docs**: `docs/BEHAVIOR.md` (new hook events + handler types),
`docs/configuration.md` (adversary.md format, scanner config).
**Landing**: hook event count + multi-type handler card.

### Milestone 2 — Subagent + context upgrades

The `task` tool's `output_schema` is half the story; per-subagent routing and
mid-turn elicitation close the rest.

| # | Feature | Source | Seam | Complexity |
|---|---|---|---|---|
| 2.1 | Per-subagent `model` + `effort: low\|medium\|high` routing (`UNOWN_SUBAGENT_MODEL` env) | claude code `sub-agents.txt` | `tools.ts:89` `SubagentConfig` + `runSubagent` model selection | S |
| 2.2 | Per-subagent `mcpServers` whitelist + `injectAgentsMd` toggle + `background-Explore` read-only mode | zcode (per 2-b2 report) | `tools.ts:89` `SubagentConfig` + MCP filter in `mcp.ts` | S |
| 2.3 | **Elicitation** — MCP mid-turn structured input via JSON schema (one missing capability advertisement on Unown's MCP client) | goose `elicitation.rs`, MCP standard | `pi-repo/packages/self-learning/src/mcp.ts` | M |
| 2.4 | `get_context_remaining` + `view_image` tools | codex `tools/handlers/get_context_remaining.rs` + `view_image.rs` | new `pi.registerTool` registrations | S |

**Tests**: `test/subagent-routing.test.ts`, `test/elicitation.test.ts`,
`test/context-remaining.test.ts`, `test/view-image.test.ts`.
**Docs**: `docs/subagents.md` (model + effort + mcpServers + injectAgentsMd),
`docs/configuration.md` (`UNOWN_SUBAGENT_MODEL`).
**Landing**: subagent routing card + elicitation mention.

### Milestone 3 — Slash commands + session UX

The `/init` / `/doctor` / `/blame` / `/review PR` / sessions-export / edit-resend
cluster. All land on `pi.registerCommand`.

| # | Feature | Source | Seam | Complexity |
|---|---|---|---|---|
| 3.1 | `/init` — generate `AGENTS.md` from repo forensics (language detection, framework, test runner, lint config, build commands, dependency graph summary) | opencode `plugin/command/initialize.txt`, claude code `/init` | new `init.ts` slash command | S |
| 3.2 | `/doctor` extension — instruction-set audit (AGENTS.md freshness, skill coverage, MCP server health, hook syntax, stale `.unown/` config) | claude code `/doctor` skill | extends `info.ts` doctor path | S |
| 3.3 | `/review` with PR URL/number support (`gh pr view` / `gh pr diff`) | opencode `plugin/command/review.txt:18-27` | extends `review.ts` `captureReviewTarget()` | S |
| 3.4 | `/blame` — reader over `.unown/receipts/<session>.jsonl` with file/turn attribution | cursor blame view (per 2-b2) | new `blame.ts` slash command | S |
| 3.5 | **Session export/import** — JSON serialization of session + messages + skills, `unown sessions export|import` CLI | opencode `session/transfer.ts:1-60` | new `sessions.ts` + `sessions-cli.ts` | S |
| 3.6 | Edit-and-resend user message with all-or-nothing file reset (uses existing checkpoint blob store; SHA-256-based post-turn-edit detection) | zcode (per 2-b2 report) | extends `checkpoints.ts` + new `edit-resend.ts` | S-M |
| 3.7 | Auto-compact on token limit (proportional threshold curve) | goose auto-compact | `runner.ts` compaction trigger | S |

**Tests**: `test/init.test.ts`, `test/doctor-instructions.test.ts`,
`test/review-pr.test.ts`, `test/blame.test.ts`, `test/sessions-export.test.ts`,
`test/edit-resend.test.ts`, `test/auto-compact.test.ts`.
**Docs**: `docs/usage.md` (new slash commands), `docs/configuration.md`,
`docs/install.md` (sessions CLI).
**Landing**: slash command catalog update + new feature cards.

### Milestone 4 — Recipes + Repo Wiki (the big-impact features)

The two highest-value structural features. Both encode repeatable workflows
declaratively — the field's clear direction.

| # | Feature | Source | Seam | Complexity |
|---|---|---|---|---|
| 4.1 | **Recipes** — declarative YAML/JSON agent instruction bundles with parameters, sub-recipes, response-schema, templates. CLI `unown recipes list|run|create`. Stored in `.unown/recipes/` + `~/.config/unown/recipes/`. | goose Recipes (the signature feature, per 2-b1) | new `recipes.ts` + `recipes-cli.ts` + `pi.registerCommand('/recipe')` | M |
| 4.2 | **Repo Wiki** — automatic repo documentation with `file:line` cross-links. Parallel read-only `task` subagents generate JSON-of-Markdown pages; an index page links them. Scheduled via the existing automations substrate (Round 3) or on-demand. | zcode Repo Wiki (deferred per SDLC doc, unblocked by Round 3 automations) | new `repo-wiki.ts` + `wiki-cli.ts` + dashboard surface | M-L |

**Tests**: `test/recipes.test.ts`, `test/repo-wiki.test.ts` (with a fixture
repo), `test/cli/recipes-structured.test.ts`, `test/cli/repo-wiki-run.test.ts`.
**Docs**: new `docs/recipes.md` + `docs/repo-wiki.md`.
**Landing**: recipes hero card + repo-wiki demo.

### Milestone 5 — landing-page polish + final parity doc update

After all four milestones ship:
- Update `docs/sdlc-feature-parity.md` with the new "Round 5 (2026-10-19 —
  hooks upgrade + recipes + repo wiki + slash commands)" section.
- Update `docs/landing-research.md` if needed.
- Update the landing page hero, feature grid, benchmarks, and quickstart.
- Re-run `bun run check:docs`, `check:changelog`, `check:benchmarks`,
  `check:claims` — all must stay green.
- Push the final commit.

---

### Milestone 6 — granular permissions + usage/cost tracking (implemented in parallel, 2026-10-19)

While milestones 1–5 were being drafted, a second effort shipped two features
this roadmap had not scoped (plus the Wave-1 trio: `/redo`, `/commit` +
`UNOWN_AUTO_COMMIT`, and the deterministic injection shield over live tool
results — the no-second-model half of 1.5):

- **Granular permissions** — Claude Code/Cline-style declarative
  allow/deny/ask rules (`.unown/permissions.json` trust-gated +
  `~/.unown/agent/permissions.json`), permission modes, opt-in rule
  learning, `/permissions`, doctor coverage. `docs/permissions.md`.
- **Usage & cost tracking** — persistent bridge usage log, `GET /v1/usage`,
  `unown usage` CLI with cost estimates + pricing overrides.
  `docs/usage-tracking.md`.

Milestone 1.5's ML-classifier half and 1.4's adversary mode remain open; the
shipped shield covers the deterministic base.

## Out-of-scope this cycle (with reason)

- **Hashline edit format** — Rust parser in pi core; revisit only with measured
  string-not-found failure rates from our own transcripts.
- **ast-grep / ast_edit** — tree-sitter runtime dependency the sandbox cannot
  assume.
- **TTSR stream rules** — fork-level change to pi-ai; violates invariant.
- **Advisor/watchdog second model** — superseded by Adversary Mode (1.4),
  which is per-action and opt-in.
- **Event-sourced session replay** — pi's session tree + receipts cover audit;
  full event sourcing is a substrate rewrite.
- **Plugin bundles + marketplace** — ecosystem work, not a feature gap.
- **Computer-use / browser automation** — out of scope for a terminal-first
  agent this cycle.
- **Collab relay / bot channels / remote control** — hosted infrastructure.

---

## Verification standards (per milestone)

Each milestone must ship:
1. **Tests**: `bun test src` green; new tests pin every new behavior.
2. **Live receipts**: a real run against the Dashscope bridge + a verifiable
   artifact (a recipe ran, a wiki was generated, an adversary review landed).
3. **Docs**: `docs/BEHAVIOR.md` for behavior changes; relevant feature docs
   updated; `CHANGELOG.md` Agent Behavior entry.
4. **Landing page**: feature card / hero updated; `bun run check:docs`,
   `check:changelog`, `check:benchmarks`, `check:claims` all green.
5. **Git push**: a tagged commit (`milestone-N-hooks-upgrade` etc.) on the
   `main` branch (or a feature branch + merge if PRs are preferred).
