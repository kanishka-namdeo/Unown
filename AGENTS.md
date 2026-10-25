# Unown — DOX root

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Project Overview

Unown is a self-improving coding agent built on the pi coding agent (vendored at `pi-repo/`, upstream earendil-works/pi): tiered memory, hooks, AutoDreaming, a self-improving harness, sandbox testing, routing, and terminal-first mission control (`unown dashboard`).

Service map (`bun run agent:start` boots the two backend services; the landing page is a separate `bun run dev` on :3000):

| Service | Code | Port | Health |
|---|---|---|---|
| Marketing landing page + blog (Next.js 16) | `src/components/landing/` + `src/components/blog/` + `content/blog/` | 3000 | `GET /` and `GET /blog` (`bun run dev`) |
| Self-learning engine (bun) | `mini-services/agent-service` → `pi-repo/packages/self-learning` | 3030 | `GET /api/overview` (M7 bearer token, `data/self-learning/engine.token`) |
| llm-bridge (bun) | `mini-services/llm-bridge` | 3031 | `GET /health` |

Mission control is not a service — `unown dashboard` (fullscreen TUI) and `/dashboard` (embedded in a live session) consume the engine's REST+SSE API through `engineFetch`, exactly like the CLI clients. A third shim, `mini-services/zai-upstream` (:3032), starts only when `BRIDGE_UPSTREAM_URL` points at it.

The engine is also meant to outlive the terminal: a source install (`bun run agent:install`, and therefore every `unown update`) installs a per-user OS service (`unown engine install --auto` — systemd user unit / launchd LaunchAgent / Windows logon task, falling back to a hidden HKCU-Run PowerShell watchdog when Task Scheduler is admin-gated, all running `engine serve`) that boots it at login and restarts it on crash, so memory, AutoDream and routines return after a reboot with no agent invoked. The installer step is non-fatal and skips in CI, under `UNOWN_ENGINE_AUTOSTART=0`, under `UNOWN_NO_ENGINE_SERVICE=1`, and after a recorded `unown engine uninstall` (the opt-out marker lives in `UNOWN_HOME`). Agent-side auto-start is taxonomy-gated: only a refused port spawns; a 401 from another install, an occupied port, an incompatible build or a hung listener is reported as BLOCKED and never spawned over. Contract: `pi-repo/packages/self-learning/AGENTS.md`.

Data flow: TUI dashboard / CLI → engine REST+SSE → sandboxed pi agent runs → llm-bridge → upstream OpenAI-compatible endpoint (Agnes AI, `https://apihub.agnes-ai.com/v1`). The terminal agent `bin/unown` delivers session notes to the engine; AutoDream consolidates them into the project's `.unown/memory/project.md`.

Repo layout:

- `bin/` — the `unown` launcher (Unix shebang script + `.cmd`/`.ps1` Windows twins)
- `pi-repo/` — the vendored pi coding agent; `packages/self-learning` is Unown's core transformation layer (the only locally-owned package), siblings are upstream code
- `src/` — the marketing landing page and the blog routes (the web dashboard is retired — D7)
- `content/` — the blog's source posts (`content/blog/*.md`, one file per URL) + the authoring template; see its own AGENTS.md
- `mini-services/` — background service boot wrappers (agent-service, llm-bridge, zai-upstream)
- `docs/` — user-facing usage documentation and decision records
- `scripts/` — lifecycle scripts, CI gates, landing generators, the TUI capture lane
- `benchmarks/` — the benchmark suites and their committed receipts
- `blueprint/` — frozen Unown v1 (Claude Code harness) reference material
- `.unown/` — per-project agent surface (memory, skills, receipts, repomap cache)
- `e2e/` — Playwright specs (landing a11y, scroll budget, dex video, SEO)

## Root Contracts

- `bin/unown` — terminal agent entry (bun-shebang script); on Windows launched through the `bin/unown.cmd` / `bin/unown.ps1` twins. Its whole body is a call to `boot()` in `pi-repo/packages/self-learning/src/boot.ts`, which is ALSO the entry the release artifacts compile from (the extensionless shim is not a valid compile main — it produces a silent no-op executable). Interactive TUI, `-p "<prompt>"` headless (in non-TTY shells run with `< /dev/null`), `--continue`/`--resume <id|name|path>`, `--plan`, `--goal`, plus ~27 management commands (`setup`, `models`, `providers`, `mcp`, `doctor`, `doctor-instructions`, `info`, `note`, `memory`, `init`, `init-agents`, `update`, `changelog`, `completions`, `uninstall`, `engine`, `routines`, `watch`, `repomap`, `ralph`, `usage`, `webcache`, `sessions`, `import`, `blame`, `recipes`, `wiki`, `worktrees`, `acp`, `dashboard`) — the authoritative surface is the HELP in `pi-repo/packages/self-learning/src/cli.ts`. Launch flags by round: trust (2026-10-24) `--permission-mode <default|acceptEdits|bypassPermissions>` + `--add-dir <path>` (repeatable; extends the write jail — the instruction-set write gate stays final); flow (2026-10-24) `-c`/`--resume` over both session stores plus the trust-gated project settings layer (.unown/settings.json in projects that carry one — model/provider/effort/permissionMode/addDirs merge UNDER CLI flags; precedence CLI > project > user defaults); CI (2026-10-24) `--max-turns <N>` (a turn is ONE MODEL CALL — `message_start` per assistant message; the (N+1)th call aborts through pi's ctx.abort; the JSON envelope gains `capped` + completed-turn `num_turns`) and `--output-schema <file>` (fence-stripped parse validated by the task tool's own validator; exit 3 on mismatch; envelope gains `schema_valid`/`schema_issues`; refused with `--mode json`). Print-mode exit contract: 0 success (a --max-turns cap with an answer is still 0 — capped:true is the signal), 1 error/empty, 2 usage, 3 schema-invalid, 4 loop guard tripped. Parity round (2026-10-24): `--max-tool-repetitions <N>` (the loop guard — the SAME tool called with the SAME arguments N times consecutively aborts, key-order canonicalized; envelope gains loop_guard, exit 4), `--worktree [name]`/`-w` (the session runs inside a managed git worktree at the repo HEAD; exit removes an untouched tree, keeps a changed one for review — `unown worktrees list|remove [--force]`), `unown import --from <auto|claude-code|codex|gemini|cursor|opencode>` (config migration: instructions append to AGENTS.md under a marked section, commands/skills/agents copy or convert, MCP servers merge into .unown/mcp.json — never overwrites, idempotent, --dry-run/--list/--lane), and the session-workflow round (markdown export --format md with default-on secrets redaction; list/export scan BOTH session stores).
- `package.json` — command surface: `dev` / `build` / `start` (landing page), `typecheck`, `lint`, `test:unit` (`bun test src`), `test:coverage`, `check:docs`, `check:changelog`, `check:benchmarks`, `check:claims`, `audit:landing`, `review:vlm`, `agent:install` / `agent:start` / `agent:stop` / `agent:link` / `agent:bridge` / `agent:engine`, `unown`, `release:artifacts`, `test:artifacts`. Engine and bridge suites run from their package roots (`pi-repo/packages/self-learning`: `bun test test/`, integration via `PI_TEST_SCOPE=integration`; `mini-services/llm-bridge`: `bun test`).
- Cross-platform verification is agent-drivable on demand — `docs/xplat-testing.md` is the contract and the playbook. `node scripts/xplat.mjs local --scenario smoke|core|full|release-verify` is the fast inner loop on this machine; `dispatch --scenario <s> [--os <one>] --watch` buys a real cross-platform verdict (the `xplat.yml` dispatch workflow) without pushing a commit to get one. The exit code is the verdict (0 green / 1 red / 2 cancelled / 3 infra). Reach for it instead of push-and-pray: smoke after engine edits, core for anything crossing process boundaries, full before a release tag, release-verify before tagging. The driver's auth is the PAT in the git remote (or `XPLAT_GITHUB_TOKEN` / `GITHUB_TOKEN`), never a printed or committed secret.
- Bun >= 1.4 is required (pi-repo/bun.lock is lockfileVersion 3; older bun cannot parse it) — `scripts/install.ts` enforces the floor.
- Environment: `.env` is the single config source (gitignored; `.env.example` is the tracked reference — every env var the stack reads is documented there and must stay in sync). `scripts/install.ts` symlinks each mini-service's `.env` to the root one. Never commit keys; placeholder values only in tracked files. The GitHub PAT lives only in the git remote URL.
- Version contract: releases are `0.0.x`, `package.json` is the source of truth, the release tag must be `v` + that version (stable-only, no prerelease hyphens), and `bun bin/unown --version` must equal it (asserted by CI and the release workflow; the compile define `__UNOWN_VERSION__` carries it into binaries).
- Release artifacts: six per-OS standalone CLI archives (darwin/linux/windows × arm64/x64), built by ONE ubuntu runner via `bun build --compile --target=` (`scripts/build-artifacts.ts`), plus `version.txt`, `install.sh`/`install.ps1`, the unsigned `release.json` manifest, `sha256sums.txt`, SBOM and attestations. The six platform ids are asserted in four places on purpose (builder test, verify-job plan check, local payload check, publish-job asset check). Binaries are UNSIGNED by decision — `docs/install.md` and each archive's `INSTALL.txt` state the Gatekeeper/SmartScreen step. `install.sh`, `install.ps1` and the runtime share ONE `install.json` acceptance rule (schema 1; mode `checkout`|`binary`, the pre-release `source` spelling folded), and the two installers each answer a read-only `--inspect`/`-Inspect` so that agreement is testable rather than argued — `test/install-meta-readers.test.ts` drives the shipped installers against records the runtime wrote (contract owned by `pi-repo/packages/self-learning/AGENTS.md`).
- Landing page truth rules — the page is part of DOX, not a frozen surface:
  - `src/components/landing/changelog-data.ts`, `benchmarks-data.ts` and `engine-data.ts` are GENERATED by `scripts/landing_*.mjs` — never hand-edit; regenerate and let `bun run check:changelog` / `check:benchmarks` / `check:claims` (all CI jobs) go green. The blog's data module (`src/components/blog/blog-data.ts`) and feed (`public/feed.xml`) are generated the same way by `scripts/landing_blog.mjs` — `bun run check:blog` gates drift, and the posts' source of truth is `content/blog/`.
  - Every quoted engine literal on the page (hook deny reasons, log lines, CLI commands, job data) must resolve in the writing source (`hooks.ts`, `termhooks.ts`, `harness.ts`, `cli.ts` HELP, `router.ts` `JOB_DEFS`) — `check:claims` gates it one-directionally (page implies source, never the reverse).
  - Every benchmark figure comes from a committed receipt under `benchmarks/` — never invent a number; a figure with no receipt is `null` ("not measured").
  - A scroll-budget breach is never settled by deleting a generated number or a gated literal — compress elsewhere.
- Media assets: never delete existing images/videos/sprites. `public/landing/` stills and videos are captured by the `scripts/tui-capture/` lane (real TUI captures — never recreate them with a browser screenshot script); the tracked OG images regenerate via `scripts/landing_og_shots.mjs` (asserts the palette before shooting); README brand assets regenerate from `scripts/brand/*.html` via `scripts/brand_render.mjs` + `scripts/curate_assets.mjs` (tracked `.github/assets/` stay regenerable from a clean checkout).
- `.unown/` — per-project agent surface. `memory/project.md` is tracked and maintained by AutoDream (the `## Manual notes` lane survives every re-render; the `project.provenance.json` sidecar records authorship); `memory/local.md` is gitignored; `skills/<name>/SKILL.md` are user-authored Agent Skills; `receipts/` and `checkpoints/` are gitignored runtime state. In-session writes to instruction files (`AGENTS.md`/`CLAUDE.md` at any depth, `.unown/skills/**`, `.unown/memory/project.md`, hooks/permissions configs) are DENIED by the instruction-set guard — propose a PR instead.
- Deployment: the landing page auto-deploys to Vercel on push to `main`; `bun scripts/verify-deploy.mjs` asserts the live deployment (routes, SEO surface, signature content, the blog + feed, and every landing media URL the SSR DOM references — reels, posters, dashboard stills) after any push.
- Runtime state (gitignored): `data/self-learning/`, `db/`, `.run/` (pidfiles + logs + usage log).

## Git Preflight

Before any work in this checkout:

1. `git fetch origin --tags --prune`
2. Measure divergence; `git pull --ff-only` (never a bare `git pull`). If the branch has diverged or the tree is dirty, stop and reconcile before editing.
3. A pull can move the tree mid-task — re-read the AGENTS.md chain after it. DOX is code: a pull can rewrite the contract.
4. Stage explicit paths only (`git add <files>`), never `git add -A` / `git add .` — sessions leave untracked learning artifacts under `.unown/` and `data/` that must never be committed. Review `git status` before committing.
5. Commit style: lowercase prefix naming the surface (`engine:`, `landing:`, `docs:`, `scripts:`, `benchmarks:`, `ci:`, …) + specific summary; body explains why. Every user-visible change gets a `CHANGELOG.md` entry (behavior changes additionally get an Agent Behavior entry) — the landing rail regenerates from the changelog, so the gate stays green only if the entry exists.

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

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

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md

- All inference and VLM traffic uses the **Agnes AI endpoint** (`https://apihub.agnes-ai.com/v1`, key via `AGNES_API_KEY` / `BRIDGE_UPSTREAM_KEY` in `.env`; served: `agnes-3.0-flash`, `agnes-2.5-flash`). It is a metered free tier (~20 RPM) — the bridge already spaces and caps concurrency for it; do not remove those guards, and prefer batching over parallel calls when there is no interactive user waiting.
- Assign models by their strengths: `agnes-3.0-flash` default agent/coding + multimodal; `agnes-2.5-flash` the served alternative.
- GitHub authentication uses the PAT embedded in the git remote URL; do not ask for credentials again.
- Never delete existing media assets (images, videos, sprites) unless specifically requested; store them properly.

## Child DOX Index

- `src/AGENTS.md` — the marketing landing page + blog app (Next.js 16 routes, layout, stylesheets, test setup); children: the landing components, the blog components
- `src/components/landing/AGENTS.md` — the landing page's own contracts: bands, palette, generated data, media assets, honesty rules, verification
- `src/components/blog/AGENTS.md` — the blog UI components: the shared chrome pieces, the JSON-LD node, the derived meta row
- `content/AGENTS.md` — the blog's source posts: the markdown + frontmatter grammar, the media rules, the authoring template
- `mini-services/AGENTS.md` — background service boot conventions; child: llm-bridge
- `mini-services/llm-bridge/AGENTS.md` — the OpenAI-compatible gateway: routing, admission lanes, failover, usage log
- `pi-repo/AGENTS.md` — upstream pi-mono development rules, binding for edits inside `pi-repo/`
- `pi-repo/packages/self-learning/AGENTS.md` — the self-learning engine, Unown's core transformation layer (the only locally-owned package)
- `docs/AGENTS.md` — user-facing usage docs and the durable decision records
- `scripts/AGENTS.md` — lifecycle scripts, CI gate scripts, landing generators, the TUI capture lane, brand assets
- `benchmarks/AGENTS.md` — the benchmark suites, methodology, receipts and the landing-page feed rules
- `blueprint/AGENTS.md` — Unown v1 (Claude Code harness) frozen reference
