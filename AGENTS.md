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

Landing page: `src/components/landing/` owns the marketing page at `/`. It is built around a hand-drawn 28-form Unown script (inline SVG, no font file) that the repo also exposes as a lexicon mapping each form to a real mechanism. Its contract — no vendored Pokémon assets, verified lore only, every number a checkable artifact, motion additive only — lives in that folder's AGENTS.md. Rebuild it with `bun run build` and check it visually; a screenshot against the production build is part of done.

Repo presentation: `README.md` is the public face — hero banner + badge row, GitHub-native Mermaid architecture/loop diagrams (byte-identical sources live in `scripts/mermaid_check.mjs`), the dashboard screenshot gallery, and honest live-state numbers. Keep claims in sync with the engine's actual `/api/overview` data when editing the "What a learning session looks like" section.

## Root Contracts

Surfaces owned by this root doc (no child AGENTS.md):

- `bin/unown` — terminal agent entry: interactive TUI, `-p "<prompt>"` headless, `--plan` (read-only plan mode; also `/plan` or Ctrl+Alt+P in the TUI), `setup` (provider connection wizard — interactive or `--provider <id> --api-key <k> --model <m> [--base-url <u>] [--force]`, presets: bridge/openai/openrouter/anthropic/dashscope/deepseek/custom; writes `~/.unown/agent/{models.json,auth.json,settings.json}`), `models` (configured models + live bridge list), `doctor` (chat-path diagnostics: endpoint reachability, bridge upstream key/health, model routability; engine/bubblewrap are warnings — chat works without them), `memory`, `init`, `note "<text>"`. Every session runs a pre-flight probe of the configured model endpoint (unreachable/auth failures get actionable messages; escape with `UNOWN_NO_PREFLIGHT=1`; skipped for subagents). Every session registers the bundled session tools — `todo` (visible task tracking), `note` (mid-session learning notes), `task` (subagents with a fresh context; agents defined in `.unown/agents/*.md`), `fetch_url` (HTTP reads) — plus `/todos` `/note` `/agents` `/learning` commands and starter Agent Skills in `~/.unown/agent/skills/`. Subagent plumbing flags (used by the `task` tool): `--mode json`, `--no-session`, `--tools a,b`, `--append-system-prompt <path>`. In non-TTY shells run headless as `bin/unown -p "…" < /dev/null`.
- `package.json` — command surface: `dev` (dashboard :3000, logs to `dev.log`), `typecheck` (`tsc --noEmit`), `agent:install` / `agent:start` / `agent:stop` (wrap `scripts/`), `agent:link` (puts `unown` on PATH via `scripts/link.sh` — the supported global-install path; `bun install -g .` does NOT work with the vendored workspace layout), `agent:bridge` / `agent:engine` (bun --hot single services), `unown` (CLI), `db:generate` / `db:push` / `db:migrate` / `db:reset` (Prisma).
- `.env` (gitignored) — single source of runtime config: ports, model ids, upstream credentials. Author from `.env.example`; it is symlinked into both mini-services cwds so bun loads it there. Never commit keys.
- `prisma/` + `db/` — dashboard Prisma (v7) schema + SQLite: generator `prisma-client` with output to gitignored `src/generated/prisma`, CLI config in root `prisma.config.ts`, driver-adapter client in `src/lib/db.ts` (`db:*` scripts unchanged). Legacy scaffold (User/Post models, unused by UI) — see `src/lib/AGENTS.md`; live data comes from the engine API (`src/lib/agent-api.ts`). The engine's own store is `db/selflearning.db` (separate, engine-owned, created on first run).
- `.unown/` — per-project agent surface. `memory/project.md` is tracked and maintained by AutoDream (edits are versioned, not clobbered); `memory/local.md` / `*.local.md` are gitignored; `skills/<name>/SKILL.md` (optional, committed) are per-project Agent Skills discovered by terminal sessions; `agents/*.md` (optional) define project subagents. `local.md`, `skills/` and `agents/` are user-authored — `unown init` scaffolds only the memory files.
- `.github/workflows/ci.yml` — lints + typechecks + unit-tests the dashboard on push and PR (plus `bash -n scripts/*.sh` and the theme-contract check; build is deferred to Phase 2).
- `.github/assets/` — README visual identity: `banner.png`, `logo.svg`, `social-preview.png` (GitHub social card, 1280x640 <1 MB — upload it manually in repo Settings → General → Social preview), `tour.gif`, and `dashboard-*.png` screenshots. Regenerate via the scripts/ pipeline contract (see scripts/AGENTS.md); `logo.svg` is mirrored to `public/logo.svg` as the dashboard favicon.
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

Git: PAT-authenticated remote (pull/push need no re-auth). Meaningful work is committed with explicit-path staging (`git add <paths>`, never `git add -A` / `git add .`); the engine itself auto-commits learning artifacts, so verify `git status` before staging.

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md on the path from root to target (parents first).
5. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules.
6. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX.

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

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
- `docs/AGENTS.md` — user-facing usage docs (quickstart/providers/usage/subagents/skills/memory/configuration/troubleshooting)
- `blueprint/AGENTS.md` — Unown v1 (Claude Code harness) frozen reference
- `scripts/AGENTS.md` — bootstrap scripts and session verification artifacts
