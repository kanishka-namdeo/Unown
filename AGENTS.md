# Unown — DOX root

- DOX is a highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Project Overview

Unown is a self-improving coding agent built on the pi coding agent (vendored at `pi-repo/`, upstream: badlogic/pi-mono): tiered memory, hooks, AutoDreaming, a self-improving harness, sandbox testing, routing, and a mission-control dashboard.

Service map (all three boot together via `bun run agent:start`):

| Service | Code | Port | Health |
|---|---|---|---|
| Marketing landing page (Next.js 16) | `src/components/landing/` | 3000 | `GET /` |
| Dashboard (Next.js 16) | `src/components/dashboard/` | 3000 | `GET /dashboard` |
| Self-learning engine (bun) | `mini-services/agent-service` → `pi-repo/packages/self-learning` | 3030 | `GET /api/overview` |
| llm-bridge (bun) | `mini-services/llm-bridge` | 3031 | `GET /health` |

Data flow: dashboard → engine REST+SSE → sandboxed pi agent runs → llm-bridge → upstream OpenAI-compatible endpoint (Dashscope coding plan). The terminal agent `bin/unown` delivers session notes to the engine; AutoDream consolidates them into this project's `.unown/memory/project.md`.

Landing page: `src/components/landing/` owns the marketing page at `/`. It is built around a hand-drawn 28-form Unown script (inline SVG, no font file) that the repo also exposes as a lexicon mapping each form to a real mechanism. Its palette is Game Boy Advance / Pokémon Generation III, in two schemes (dark = Hoenn, light = Kanto in daylight), and every colour on it is a legal 5-bit GBA value, enforced by the browser-free `scripts/gba_palette_check.mjs`. Its contract — no vendored Pokémon assets, verified lore only, every number a checkable artifact, motion additive only — lives in that folder's AGENTS.md. Rebuild it with `bun run build` and check it visually; a screenshot against the production build is part of done.

Repo presentation: `README.md` is the public face — hero banner + badge row, GitHub-native Mermaid architecture/loop diagrams (byte-identical sources live in `scripts/mermaid_check.mjs`), the dashboard screenshot gallery, and honest live-state numbers. Keep claims in sync with the engine's actual `/api/overview` data when editing the "What a learning session looks like" section.

## Root Contracts

Surfaces owned by this root doc (no child AGENTS.md):

- `bin/unown` — terminal agent entry (bun-shebang script); on Windows it is launched through the `bin/unown.cmd` / `bin/unown.ps1` twins (they resolve bun and run the same file). Interactive TUI, `-p "<prompt>"` headless, `--plan` (read-only plan mode; also `/plan` or Ctrl+Alt+P in the TUI), `setup` (provider connection wizard — interactive or `--provider <id> --api-key <k> --model <m> [--base-url <u>] [--force]`, presets: bridge/openai/openrouter/anthropic/dashscope/deepseek/custom; writes `~/.unown/agent/{models.json,auth.json,settings.json}`), `models` (configured models + live bridge list), `doctor` (chat-path diagnostics: endpoint reachability, bridge upstream key/health, model routability; engine/bubblewrap are warnings — chat works without them; also reports version + cached update-check state + user-state schema; `doctor --json` emits the machine-readable report `{ok, version, checks[{id,status,detail}], summary}` with the same exit codes), `memory`, `init`, `note "<text>"`, `info` (support bundle: version, platform, git state, provider names, opt-outs — redaction-first: provider baseUrls pass redactUrl, auth.json is never read, only the known-safe UNOWN_/PI_ booleans surface; `info --json`), `update` (self-update — `--check`/`--check --json` read-only via `git ls-remote` exit 0/2/1, foreground `git fetch --tags` + `--ff-only` merge to the newest ready tag + re-run `scripts/install.ts` with auto-rollback; `--allow-dirty` autostash; `--rollback` restores the recorded pre-update SHA; explicit-version form pins/rolls back; kill switches `UNOWN_DISABLE_UPDATES` all paths, `NO_UPDATE_NOTIFIER`/`UNOWN_DISABLE_AUTOUPDATE`/`DO_NOT_TRACK` background only — see `src/update.ts`), `changelog [n]` (prints CHANGELOG.md sections; the startup update notice is TTY-gated, CI-suppressed, 24h-cached in `~/.unown/update-check.json`, refreshed by a detached `bin/unown update --check --background` child; remote URLs are credential-redacted before any output or state write), `completions bash|zsh|fish|powershell` (static scripts from `src/completions.ts`), `uninstall` (removes only shims pointing into THIS checkout; `--dry-run`/`--purge-data`/`--purge-checkout` — refuses uncommitted work; see `src/uninstall.ts`), and the forward-only `~/.unown` user-state migration runner (`src/migrations.ts`, state `~/.unown/migrations.json`, zero migrations at schema v1 — runs after `unown update` applies, non-fatal on failure, reported by doctor). Every session runs a pre-flight probe of the configured model endpoint (unreachable/auth failures get actionable messages; escape with `UNOWN_NO_PREFLIGHT=1`; skipped for subagents). Every session registers the bundled session tools — `todo` (visible task tracking), `note` (mid-session learning notes), `task` (subagents with a fresh context; agents defined in `.unown/agents/*.md`), `fetch_url` (HTTP reads), `lsp` (language-server code intelligence — see `pi-repo/packages/self-learning/AGENTS.md`) — plus `/todos` `/note` `/agents` `/learning` `/lsp` `/checkpoint` `/undo` `/restore` `/checkpoints` `/receipts` `/mcp` commands (checkpoints/receipts + the MCP client surface — see the self-learning child doc) and starter Agent Skills in `~/.unown/agent/skills/`. Subagent plumbing flags (used by the `task` tool): `--mode json`, `--no-session`, `--tools a,b`, `--append-system-prompt <path>`. In non-TTY shells run headless as `bin/unown -p "…" < /dev/null`.
- `package.json` — command surface: `dev` (dashboard :3000, `next dev`; when spawned by `agent:start` its output lands in `.run/dashboard.log`), `start` (production dashboard via `scripts/serve-dashboard.ts`: NODE_ENV=production + `bun .next/standalone/server.js`, output teed to `server.log`), `typecheck` (`tsc --noEmit`), `test:unit` (`bun test src`), `test:coverage` (runs the suite with coverage and enforces the changed-line gate via `scripts/check_coverage.mjs --run`; writes `coverage.txt`, gitignored), `check:docs` (docs link/anchor gate, `scripts/check_docs.mjs docs/*.md`), `agent:install` / `agent:start` / `agent:stop` / `agent:link` (wrap `scripts/*.ts` — cross-platform bun TypeScript; identical on Windows/macOS/Linux, the `.sh` twins are thin POSIX wrappers), `agent:link` puts `unown` on PATH via `scripts/link.ts` — the supported global-install path; `bun install -g .` does NOT work with the vendored workspace layout), `agent:bridge` / `agent:engine` (bun --hot single services), `unown` (CLI), `db:generate` / `db:push` / `db:migrate` / `db:reset` (Prisma).
- `.env` (gitignored) — single source of runtime config: ports, model ids, upstream credentials. Author from `.env.example`; `scripts/start.ts` parses it and exports every variable into the spawned services' environment (bun does NOT read the repo-root `.env` from a mini-services cwd, so the launcher is the delivery path). Never commit keys.
- `prisma/` + `db/` — dashboard Prisma (v7) schema + SQLite: generator `prisma-client` with output to gitignored `src/generated/prisma`, CLI config in root `prisma.config.ts`, driver-adapter client in `src/lib/db.ts` (`db:*` scripts unchanged). Legacy scaffold (User/Post models, unused by UI) — see `src/lib/AGENTS.md`; live data comes from the engine API (`src/lib/agent-api.ts`). The engine's own store is `db/selflearning.db` (separate, engine-owned, created on first run).
- `.unown/` — per-project agent surface. `memory/project.md` is tracked and maintained by AutoDream (edits are versioned, not clobbered); `memory/local.md` / `*.local.md` are gitignored; `skills/<name>/SKILL.md` (optional, committed) are per-project Agent Skills discovered by terminal sessions; `agents/*.md` (optional) define project subagents; `lsp.json` (optional) overrides language-server commands for the `lsp` tool and `mcp.json` (optional) configures MCP servers (see the self-learning child doc); `receipts/` and `checkpoints/` (gitignored runtime state) hold the per-session audit ledgers and checkpoint blob stores. `local.md`, `skills/`, `agents/` and `lsp.json` are user-authored — `unown init` scaffolds only the memory files.
- `.github/workflows/ci.yml` — lints + typechecks + unit-tests the dashboard on push and PR, plus `bash -n scripts/*.sh`, the theme-contract check, the landing GBA palette gate, a changed-line coverage gate for `src/` (`scripts/check_coverage.mjs --run`, threshold 80% of touched lines, exemptions in `scripts/coverage-exempt.txt`), a docs link/anchor gate (`scripts/check_docs.mjs docs/*.md`), gitleaks full-history secret scan, `bun audit --prod`, the bridge unit suite (95 hermetic tests, `mini-services/llm-bridge`), and a production `build` job (`bun run build` + standalone-server smoke on / and /dashboard, scratch port 3210), the `mermaid` gate (byte-identity of the README diagrams under the vendored mermaid 11.16.1), and the `e2e` gate (`e2e/mock-engine.mjs` + the standalone build in DIRECT api mode + `bunx playwright test`: dashboard flows + axe-core a11y on landing + all seven tabs). The cross-platform `build-test` matrix (ubuntu/macOS/Windows, real `scripts/install.ts` path) runs the engine suite, the integration suite (`PI_TEST_SCOPE=integration`, real server + mock bridge), the version-consistency check (`unown --version` === package.json.version), and CLI smokes; `sandbox-smoke` covers the OS-sandbox surface, plus a CLI-surface smoke (info/doctor `--json` parse, `completions bash -n`, changelog footer, `update --check` exit 0|2). Supply-chain hardening (2026-10, OpenSSF quick wins): every `uses:` in all workflows is pinned by full commit SHA (version in a trailing comment; SHAs resolved via `git ls-remote refs/tags/vN^{}` — peeled commit, not the annotated tag object), ci.yml carries a least-privilege top-level `permissions: contents: read`, `bash -n` covers `public/*.sh`, and three new files: `.github/dependabot.yml` (weekly: github-actions + bun at root; monthly: pi-repo as an upstream-sync candidate — bun.lock is natively supported, lockfileVersion 3), `.github/workflows/codeql.yml` (weekly + push/PR SAST, javascript-typescript `build-mode: none`, paths trimmed by `.github/codeql-config.yml`), `.github/workflows/scorecard.yml` (weekly OpenSSF Scorecard with `publish_results: true`; harden-runner in audit mode; README carries the scorecard badge). `.github/workflows/release.yml` runs the release assertion on `v*.*.*` tags: tag-version match, the full 3-OS verification, build + SBOM (SPDX) + build-provenance attestation, and a GitHub Release with generated notes + the verification checklist. Measured state, corrected: the claim "all 15 green at dc982e7 (run 39083707789)" was FALSE — the run id was a digit-swap typo (the real run is 39083708789) and that run was RED: the windows leg failed at the version-consistency step, whose POSIX `$(...)` / `if [ ... ]` syntax is a ParserError under the runner default pwsh — the same bug class the integration step fix addressed one commit earlier, missed here (also red in 39084539734 at 8163db3). Fixed by `shell: bash` on that step. Observed state: **CI run 39110288288 (bd0132e) — ALL 17 jobs green; v2.0.0 tagged there and RELEASED (GitHub Release with release-checklist.md + sbom-spdx.json assets and build-provenance attestation; three release-path defects fixed to get there: the windows version-consistency twin step, a nonexistent sbom-action version, and the attestation subject digest)** (what the Release workflow asserts: 3-OS matrix, engine + integration suites, bridge, version contract, production build + standalone smoke, sandbox-smoke, mermaid byte-identity (gate 15: README-extracted sources, vendored sha-pinned mermaid 11.16.1, dual-render sha256 identity, found + pinned mermaid's Math.random shape wobble), the e2e gate (gate 16: mock engine + DIRECT-mode standalone build + 11 Playwright tests — 3 flows + axe-core WCAG A/AA scans of the landing page and all seven tabs; its first run found 80+ real AA contrast defects + 1 aria violation in the dashboard, all fixed), the brand-HTML overflow gate, changed-line coverage (now with real tests for page/header/activity-feed), docs, theme, palette, lint, typecheck, units, security). Measured release state: v2.0.0 has a tag and no published GitHub Release (`gh release view v2.0.0` → release not found) and no green run — three attempts, three distinct defects: 39106607335 at the windows version-consistency step (the pwsh bug's twin inside `release.yml`, fixed at `b30996a`); 39107176659 at `Set up job`, where `anchore/sbom-action@v17` did not resolve (upstream publishes only `v0.x`; re-pinned to `v0.24.3` at `e0b7520`); and 39107793393 at `Build provenance attestation`, where `subject-digest: sha256:${{ github.sha }}` fed a 40-char SHA-1 commit id to a field that requires a 64-hex sha256 digest (fixed at `1b6fc53`; its re-tag runs were still in flight as of this writing, so treat "green release" as unconfirmed until one lands). The engine suite's 3-OS import-order residue is closed (round three: `test/_env.ts` preload via the package `bunfig.toml` + up-front redirect-root materialization + gated env claims in the live suites — deterministic 736/0/37 across 5 clean-tmp local runs; receipts in `docs/testing-strategy.md` §7.2). Windows path-semantics residue fixed by `838a642` (RAW_DEVICE_WIN backslash bug). Receipts and residue in `docs/testing-strategy.md` §3.2, §7.2, §7.5, §11.- `.github/assets/` — README visual identity: `banner.png`, `diagram-memory.png` (four-tier memory infographic), `logo.svg`, `social-preview.png` (GitHub social card, 1280x640 <1 MB — upload it manually in repo Settings → General → Social preview), `tour.gif`, and `dashboard-*.png` screenshots. Regenerate via the scripts/ pipeline contract (see scripts/AGENTS.md); `logo.svg` is mirrored to `public/logo.svg` as the dashboard favicon.
- Community-health surface — `SECURITY.md` (coordinated disclosure via GitHub Private Vulnerability Reporting + the agent threat model), `CHANGELOG.md` (Keep a Changelog; behavior changes additionally require an "Agent Behavior" entry), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1, enforcement via GitHub issues), `SUPPORT.md`, `.github/ISSUE_TEMPLATE/` (bug + feature forms) and `.github/PULL_REQUEST_TEMPLATE.md`. Root-owned, no child AGENTS.md. The behavior-change policy itself lives in `docs/BEHAVIOR.md` (the agent behavior card — see docs/AGENTS.md), not here.
- Runtime state (gitignored): `data/self-learning/` (sandboxes, sessions, memory versions, generated pi agent dir), `db/`, `.run/` (pidfiles + logs), `dev.log`, `server.log`.
- `.zscripts/dev.sh` (gitignored, sandbox-only) — persistent supervisor that keeps all three services alive across sessions; scans `mini-services/*/package.json` for a `dev` script and launches each with `bun --hot`.

Secrets policy: the upstream LLM key lives only in `.env` (`BRIDGE_UPSTREAM_KEY`); the GitHub PAT lives only in the git remote URL. Never write either into tracked files, docs, or commit messages.

Model routing: enforced by llm-bridge (binding rules + env in `mini-services/llm-bridge/AGENTS.md`; defaults tuned in `.env`). Unown defaults: `kimi-k2.5` (default coder), `qwen3.7-plus` (fast multimodal, thinking auto-disabled), `qwen3.6-plus` (1M context); unknown ids route to `kimi-k2.5`.

Stack lifecycle:

- Start all: `bun run agent:start` (pidfiles in `.run/`, logs in `.run/*.log`).
- Sandbox-persistent start (background processes are killed between tool calls here): `cd /home/z/my-project && (nohup bash .zscripts/dev.sh >> .zscripts/dev.log 2>&1 < /dev/null & echo $! > .zscripts/dev.pid)` — idempotent-ish: re-runs bun install + db:push, reuses healthy services.
- Stop: `bun run agent:stop`.
- End-to-end sanity: `unown doctor` all green; `curl -s localhost:3030/api/overview` reports provider `zai-bridge/kimi-k2.5`; `curl -s localhost:3031/health` reports upstream healthy.
- Vercel (landing page): the marketing site at `/` auto-deploys on every push to `main` via Vercel's GitHub integration — project `unown` under `kane111s-projects`, production alias `https://unown-nine.vercel.app`. Tunable in root `vercel.json` (framework `nextjs`, build `bun run build`, install `bun install`); re-deploy manually with `vercel deploy --prod`. The dashboard and engine stay local — only the landing route (+ `/dashboard` shell) is hosted.
- Toolchain: host bun is 1.4.3 at `~/.bun/bin` (PATH-first). `/usr/local/bin/bun` (1.3.14) remains the binary visible INSIDE the bwrap sandbox (the `/home` tmpfs hides `~/.bun`), so host bun upgrades do not change the sandboxed agent runtime.

Git: PAT-authenticated remote (pull/push need no re-auth). Every task opens with the Git Preflight below and re-runs it before committing. Meaningful work is committed with explicit-path staging (`git add <paths>`, never `git add -A` / `git add .`); the engine itself auto-commits learning artifacts, so verify `git status` before staging.

## Git Preflight

Run before the first edit of every task, and again before the Closeout commit. The checkout IS the agent's context: a stale one is a wrong one, and every claim this doc makes — run ids, thresholds, ports, the CI job list — is only as current as the commit it was read from.

- Fetch, then measure, then act: `git fetch origin` → `git status` + `git rev-list --left-right --count HEAD...@{u}` → `git pull --ff-only`. Never a bare `git pull`: it is fetch + merge, and it can merge into your tree without your knowledge.
- Any git state reported to the user — up to date, clean, safe to push — must come from a post-fetch count. A remote-tracking ref is only as current as the last fetch: an un-fetched comparison once turned a promised "clean fast-forward" into a 243-commit divergence against an independent workstream on `origin/main`.
- Clean tree and behind → fast-forward, then report what moved (`git log --oneline HEAD@{1}..HEAD`) and flag any pulled file the task is about to touch.
- Dirty tree → the pull only proceeds if the incoming paths cannot collide with the uncommitted work; otherwise stop and report. Never `git stash` (the stash is shared across worktrees — another session can pop or clobber it), `git checkout --`, `git restore`, `git clean`, or `git reset --hard` to clear the way. Uncommitted work is not yours to discard.
- Diverged, `--ff-only` refused, or a merge/rebase already in progress → stop. Report the ahead/behind counts and the commits on each side, offer rebase / merge / leave-as-is, and wait for the choice. Do not merge, rebase, force-push, or rewrite commits that may be shared.
- After the tree moves, refresh what the move changed: `bun install` when `bun.lock` or `package.json` moved, `bun run db:push` when `prisma/` moved, `bun run agent:stop && bun run agent:start` when engine or bridge code moved, and re-read the AGENTS.md chain — DOX is code, so a pull can rewrite the contract mid-task.
- Subagents and parallel sessions run the same preflight, then re-check `git status`: their pulls land in this same working tree, so staging stays explicit-path.

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

Start with the Git Preflight above — the chain walked below is only worth reading if it is current.

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md on the path from root to target (parents first).
5. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules.
6. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX.

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing, and re-read it again whenever a pull has moved the tree.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Proactive Stale-Doc Duty

Update After Editing is reactive: it covers staleness your own change creates. Staleness must also be caught proactively while working, because every task walks past docs its change can make wrong.

- Before starting a task, forecast the doc blast radius: the AGENTS.md chain along every path to be touched (Read Before Editing) plus every sync-map hit below. Keep the forecast through the task; Closeout re-checks it against what actually changed.
- The Read Before Editing walk is an audit, not a formality. A doc statement that contradicts what you find in the code — moved files, renamed commands, changed ports or env vars, stale thresholds, counts, links, headings — is stale. A few-line fix happens in the same change even though your task did not cause it, and the report says so.
- Same-change sync map (each owning doc's rule stays binding; this indexes the triggers → docs that go stale together):
  - Engine REST/SSE API (`pi-repo/packages/self-learning/src/server.ts`) → `src/lib/AGENTS.md` endpoint list + `src/lib/agent-types.ts` types.
  - Terminal-agent CLI surface (command, flag, tool) → `docs/usage.md` + `docs/configuration.md` + `cli.ts` HELP.
  - Engine or bridge env vars / model defaults → the owning doc's env list + `.env.example` + `docs/configuration.md`.
  - Bridge routing/thinking behavior → `mini-services/llm-bridge/AGENTS.md` routing rules; new default models also move root "Model routing".
  - Landing page claims — anything a section asserts (quickstart commands and CLI flags, the memory tiers, the provider/model allow-list, benchmark figures, hook and gate rules, the sandbox layers, FAQ answers) — moving means the page goes stale too. Edit the section that owns the claim (the canonical-homes list in `src/components/landing/AGENTS.md` names every owner; do not restate it in a neighbouring section). The page is part of DOX, not a frozen surface: a claim that contradicts the code is the same defect as a stale doc line, and "every number a checkable artifact" means the artifact must keep existing — if it does not, cut the claim, never invent a replacement figure.
  - Landing-page edits (sections, palette, claims) → `docs/landing-research.md` in the same change; palette moves regenerate the tracked `public/landing/*.png` via `scripts/landing_og_shots.mjs`; ship with that folder's verification set (palette gate, both-scheme screenshots, contrast audit, theme toggle against a production build); `verify-deploy.mjs` gates every push to main.
  - Dashboard tab set / KPI shape → the `.github/assets/` gallery + `tour.gif` age immediately; refresh via the `scripts/AGENTS.md` asset pipeline when visuals change materially.
  - README live-state claims → they assert engine `/api/overview` data; when that data's shape or numbers move, re-check the claim in the same change.
  - `package.json` command surface, CI jobs, script contracts → root "Root Contracts" + `scripts/AGENTS.md`.
  - Git Preflight rules (root "Git Preflight") → the `CONTRIBUTING.md` DOX-contract pointer; the root section stays canonical and the pointer stays one line.
- Staleness that is too large or out of the task's scope is never left silent: name the file and the staleness in the final report and record a `note`, so the finding outlives the session. Do not widen the task to rewrite a section it did not come to touch.
- This map is itself a doc: the Update After Editing pass applies to it. A wrong entry here is the most expensive kind of staleness — it hands every future agent a wrong blast radius.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:

- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## User Preferences

- All inference and VLM traffic uses the Dashscope coding-plan endpoint (a paid plan — do not ration or worry about call limits).
- Assign models by their strengths (details: Model routing above and `mini-services/llm-bridge/AGENTS.md`): `kimi-k2.5` default agent/coding; `qwen3.7-plus` fast multimodal (thinking disabled); `qwen3.6-plus` long-context.
- GitHub authentication uses the PAT embedded in the git remote URL; do not ask for credentials again.
- Record any future durable behavior change here or in the relevant child AGENTS.md.

## Child DOX Index

- `src/AGENTS.md` — Next.js app: the mission-control dashboard (7 tabs, live SSE feed) and the marketing page; children: landing page sections, dashboard components, engine client lib
- `mini-services/AGENTS.md` — background service boot conventions for both bun services; child: llm-bridge
- `pi-repo/AGENTS.md` — upstream pi-mono development rules; binding for edits inside `pi-repo/`
- `pi-repo/packages/self-learning/AGENTS.md` — the self-learning engine, Unown's core transformation layer
- `docs/AGENTS.md` — user-facing usage docs (quickstart/providers/usage/subagents/skills/memory/configuration/troubleshooting) plus the durable decision records (benchmark/landing research, testing strategy, memory-classifier evaluation, and the two harness-swap records — `oh-my-pi-swap-assessment.md` and `opencode-swap-assessment.md`, each candidate-specific, sharing the chokepoint invariant and the standing verdict that the vendored pi harness stays)
- `blueprint/AGENTS.md` — Unown v1 (Claude Code harness) frozen reference
- `scripts/AGENTS.md` — the cross-platform lifecycle scripts (`install/link/start/stop.ts` + runtime `serve-dashboard.ts`, `.sh` POSIX wrappers), session verification artifacts, the CI gate scripts (coverage, docs), the README asset pipeline, the sandbox verification suites, and the landing-page verification gates (static palette check, screenshot, contrast audit, theme toggle)
