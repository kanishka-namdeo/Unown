# unown, product overview (verified)

Everything below was re-checked against the repository at `v0.0.64` + the Memory Divertimento round in flight (`main`; the plan-mode V3 round re-verified the subagent-roster and plan-mode rows on 2026-11-01; the end-user combination round re-verified the management-command and blog/landing rows on 2026-11-10; the Memory Encore round re-verified the tiered-memory rows on 2026-11-12 — the freshness lane, the recall line, `/memory show` and the health card all counted and re-stamped at the round's close; the Memory Divertimento round re-verified them again on 2026-11-14 — the review queue, the recall-integrity seal and the per-type render budget all counted) with the code as the authority wherever the README or the docs disagreed with it. Appendix A lists every claim the earlier draft got wrong, each with its file and line; Appendix B lists what it missed. Where a number could not be backed by a committed receipt or a source file, it was cut.

This file's maintenance contract lives in the root `AGENTS.md` under Root Contracts: it is refreshed in the same change that moves anything it counts, and re-stamped with the version, commit, and date it was verified against. No counted surface has moved since the stamp above.

**Unown** is an MIT-licensed, self-improving coding agent by Kanishka Namdeo, built on the open-source [pi coding agent](https://github.com/earendil-works/pi). The README states it applies "the five mechanisms Anthropic popularized by *using Claude Code to improve Claude Code*: Let the agent find its own weaknesses. Let it fix them. Let it remember what worked." It runs two ways: an interactive terminal session, and a background learning-engine daemon that keeps working while you are away.

## Ways to run it

- **Interactive terminal agent** (`unown`): the real pi TUI in your project directory, with tiered memory injected, guardrail hooks active, and session notes captured for learning.
- **Learning engine daemon** (`unown engine start`, or `bun run agent:start` for the full stack): harness cycles, AutoDream consolidation, and background jobs continue unattended inside an hourly and daily call/token budget, under a per-job watchdog.
- **The two halves share nothing but files and HTTP.** The terminal agent never opens the engine's database (measured: 0 file descriptors).
- **Mission control** (`unown dashboard`, or `/dashboard` inside a live session): a **15-screen** TUI console with a live SSE activity feed, run transcripts, memory version history, dream journals, hook decision logs, and the job router. `/dashboard` is a TUI command, not a web page: the Next.js web dashboard was retired by decision (D7).
- **ACP server** (`unown acp`): drive the agent from Zed and other Agent Client Protocol editors over JSON-RPC 2.0 on stdio.
- **A Next.js landing page and blog** (`bun run dev`, port 3000), auto-deployed to Vercel on push to `main`, with a generated RSS feed.
- **Always-on service**: a source install registers a per-user OS service (systemd user unit, launchd LaunchAgent, or a Windows logon task) that boots the engine at login and restarts it on crash, so memory, AutoDream, and routines survive a reboot with no agent invoked.

## The five self-learning mechanisms

### 1. Tiered memory

- Four tiers, `policy`, `project`, `user`, `local`, merged most-specific-wins and injected into every session, including engine sandbox runs. Caps: 48,000 chars per tier, 80,000 total, with oldest-rules-first degradation at injection.
- Every write commits a versioned `memory_versions` row in the same transaction as the SQLite write, then materializes the markdown atomically (tmp, fsync, rename). Any version can be rolled back; reads self-heal file drift from the database.
- Writes are attributed to their source. The literals actually written are `seed`, `harness`, `mem0`, `autodream`, `autodream-hoist`, `manual`, and `rollback`. Labels render verbatim in the dashboard; note the typed label union there names only five of the seven, so it understates the real set.
- The engine's project tier runs on Mem0 (the in-process `mem0ai` OSS TypeScript SDK, vector store and history in SQLite); the committed `.unown/memory/project.md` is a deterministic render of it, and a `## Manual notes` section is re-attached verbatim on every re-render. A `project.provenance.json` sidecar records authorship. The render is capped at `PI_MEM0_MAX_RENDERED` (default 110) **total, split per memory type by share** (fact 40% / procedure 25% / preference 20% / episode 15%, a waterfall returns unused share to the types that can use it — a single-type store keeps the flat-cap behavior at the same total; hard-won harness/seed rules keep their own cap, immune), renders `## Preferences` and `## Episodes` sections for typed memories (Episodes last), and its footer carries the per-type kept/pruned tally, never silently (the Memory Divertimento round, 2026-11-14). Since the Memory Encore round every rendered rule ends with the date it was last confirmed (the platform `updatedAt`; a re-asserting dream refreshes it) and a `stale` marker past 28 unconfirmed days (`PI_MEM0_STALE_DAYS`); seeds and rows without a parseable timestamp render bare. `src/memzero.ts` `memoryFreshnessStamp`; pinned by `test/memzero-freshness.test.ts` and `test/memory-recall-integrity.test.ts`.
- Memory scope is keyed to repository identity (the normalized git remote), not the path, so one repo shares one memory across clones, renames, worktrees, and machines. A non-git directory falls back to its absolute path.
- `/memory search <query>` recalls learning from any project in any session; an unreachable engine is reported honestly rather than answered empty. **Superseded memories never answer a recall as if current** (the recall-integrity seal, 2026-11-14): every search lane excludes them by default; `--all` (or `latest_only=0` on the API) opts into a badged audit view. `/memory show [full]` (2026-11-12) prints the exact budget-pruned stack the model receives — tier contents with provenance lines, per-tier char counts, the injection-budget tail. A session-start line (`◈ memory recalled: N rules · vN · dreamed <age> — /memory show`, once per process, silent for fresh projects, disk-derived) affirms the injection (`src/engine-status.ts` `memoryRecallLine` + the termhooks session_start emission). The dashboard Memory screen renders the memory health card (last reconcile, duplicates, conflicts, warnings) under the injection-budget meter (`src/dashboard/screens/memory-screen.ts`; the `memoryHealth` resource), plus the **memory review-queue card** (pending candidates with evidence, refetching on every park/approve/discard). **The memory review queue** (2026-11-14): every model-inferred user-tier rule (cross-project hoist promotion) parks in a user-level queue at `~/.unown/memory/review-queue/` instead of auto-shipping; the human approves or discards via `/memory review`, `unown memory review`, the dashboard card, or `POST /api/memory/review/[approve|discard]` — approve ships to both user tiers re-deduped and re-guarded at decision time (provenance names the observing projects and the review decision), discard keeps the candidate for audit. The health card carries the pending depth (`reviewQueueDepth`) with an amber `review-pending` warning while any decision waits.

### 2. Self-improving harness

- Each cycle runs benchmark tasks in a fresh sandbox. On failure it mines the transcript for the memory rules that would have prevented that failure.
- It re-runs the task with the candidate patch and ships only if the patch passes twice (the noise gate), then runs a regression sweep. An adversarial-content guard can also veto a patch that passed twice.
- Shipped patches that later regress are automatically un-shipped by a retention check.
- When the suite saturates, task minting converts real failures, or LLM-authored harder variants, into new capability-eval tasks. Minted tasks must first prove solvable against a reference solution, executed against the untouched test file before the task enters the suite.
- Evals that never pass are quarantined by a circuit breaker; mastered ones graduate into the regression suite. Mint caps: 8 tasks, 6 files, 12k chars per task, 40k total.

### 3. Background job routing

- **Nine** jobs: **seven on intervals** (`note-sync` 5m, `harness-cycle` 10m, `auto-dream` 10m, `sandbox-gc` 15m, `task-mint` 30m, `db-retention` 24h, `watch-scan` 2m) and **two event-driven** (`regression-on-ship` on `improvement:shipped`, `dream-check` on `run:finished`).
- One scheduler tick serializes through a busy mutex, so the sandbox is never driven by two jobs at once; a busy conflict answers HTTP 409.
- Every learning job consults the governor, and each job runs under a watchdog (default 20 minutes).

### 4. AutoDreaming and skill acquisition

- Consolidates session notes through Mem0's extraction pipeline. Terminal notes are consolidated into each real project's own `.unown/memory/project.md`.
- Benchmark-derived memory changes are canary-tested: a dream that breaks a previously passing task rolls back both the memory version and the platform event stream.
- Notes that the structural guard quarantines never reach the extraction LLM.
- Recurring multi-step procedures are minted as Agent Skills (`SKILL.md`) into `.unown/skills-staged/`, versioned and rollback-able.
- Staged skills are never auto-loaded. The only discovery root is `.unown/skills/`, and promotion is a deliberate human `mv`. There is no auto-promote path.

### 5. Hooks and guardrails

- Always-on gates: `SessionStart`, `UserPromptSubmit`, `PreToolUse` (bash deny-list, path jail, prompt-injection scanner, and a file-gated LLM adversary reviewer), `PostToolUse` (a syntax gate plus verify-first feedback), `Stop`, `SubagentStop`.
- Hook-mutated tool inputs are re-checked through the full built-in gate stack before execution (a TOCTOU guard).
- A user-configurable layer honors **13** lifecycle events, including pre/post model request, pre/post compaction, subagent start, task completed, and permission request. (The internal event union is 15; `MemoryBudget` and `AutoCompact` are engine-only synthetic telemetry events that the config layer deliberately refuses as keys.)
- Five handler types: `command`, `http`, `mcp`, `prompt`, `agent`.
- Config lives in `.unown/hooks.json` (project-level, refuse-first trust-gated, approval pinned to a sha256 fingerprint) and `~/.unown/agent/hooks.json` (always trusted).
- Every decision is logged to a `hook_log` table and pushed on the live bus, surfaced in the API and the dashboard's Hooks screen.

## Execution, isolation, and safety

- Each harness or task run gets a fresh sandbox: a boundary-aware path jail, a hardened bash deny-list, an output cap and timeout, `HOME` pinned to the sandbox root, and sha256-verified test files whose mismatch fails the run, so the agent cannot tamper with its own grading.
- OS-level isolation is real but platform-specific: **bubblewrap** on Linux (a vendored binary), **seatbelt** (`sandbox-exec`) on macOS, and a transparent TypeScript path-jail fallback on native Windows, where kernel-grade isolation is not available and WSL2 is the recommended path. `UNOWN_SANDBOX_REQUIRED=1` makes that degradation a hard failure instead of a silent downgrade; `UNOWN_OS_SANDBOX=0` is the kill switch. Engine sandboxes are offline by default.
- The governor enforces a rolling ledger of **calls per hour (60), tokens per hour (200k), and tokens per day (2M)**, plus an upstream circuit breaker. (These are call and token budgets, not dollar-spend limits.)
- Granular allow/deny/ask permission rules with glob matching and project-config trust gating; the declarative layer can only add restrictions.
- A hard-coded instruction guard denies in-session writes (tools and bash redirects alike) to the instruction set: `AGENTS.md` and `CLAUDE.md` at any depth, `.unown/skills/**`, `.unown/agents/*.md`, `.unown/hooks.json`, `.unown/permissions.json`, `.unown/memory/policy*`, `.unown/memory/project.md` plus its provenance sidecar, and `.claude/settings.json` / `.vscode/tasks.json` / `.vscode/settings.json` at any depth (the first two are named in the guard as the persistence targets of a real October 2026 dropper). Its verdict is final, above the permissions layer.
- Engine supervision (`unown engine`, subcommands `status | start | stop | restart | repair | serve | install | uninstall`) includes a crash-loop circuit breaker (5 attempts with backoff, shared cross-process state), a `/api/health` probe reporting lifecycle phases `warming | ready | draining`, and `unown engine repair`.
- Graceful drain: shutdown flips the phase first, refuses new jobs, and awaits the in-flight job bounded by `UNOWN_ENGINE_DRAIN_BUDGET_MS` (10s) before closing the store.
- Engine auth: Host-header allowlist (anti DNS-rebinding), Origin enforcement, a per-boot 0600 bearer token plus a cross-install discovery mirror that heals the binary-versus-source 401 split. A non-loopback bind with auth disabled refuses to boot.
- Boot integrity: a `PRAGMA quick_check` fail-fast gate, with `engine repair` quarantining and renaming a corrupt database.
- Note delivery retries a network failure once, then falls back to an outbox that dead-letters a note after 5 failed ingests into `$UNOWN_HOME/notes/dead/` with a `.reason.txt` sidecar (never deleted). Auto-start is taxonomy-gated: only a refused port spawns a new engine; a 401, an occupied port, an incompatible build, or a hung listener is reported as blocked and never spawned over.
- Documented recovery playbooks cover **eleven** failure modes (R1-R11): engine down, boot-crash loop, corrupt SQLite, engine wedged beyond HTTP, unreachable at quit, outbox overflow or a poisoned note, oversized note, read-only state, deliberate engine-off, engine stale after an update, and engine blocked by another owner's port or token. (R10 has its own section but is missing from the page's index table.)
- Repo tooling: gitleaks secret scanning (CI, full history, plus a local pre-commit config), GitHub Actions CI, CodeQL, an OpenSSF Scorecard workflow and badge, and a security policy. Nine workflows total.

## Interactive agent capabilities

- Full TUI with slash commands, configurable keybindings (`keybindings.json`), and custom commands from `.unown/commands/*.md` (project) or `~/.unown/agent/commands/*.md` (global), with `$ARGUMENTS`, `$1..$N`, and `${N:-default}` substitution.
- Plan Mode (V3 since 2026-11-01, the capability orchestrator — default on, `UNOWN_PLAN_MODE_V3=0` restores V2): a scored plan document (10 dimensions in V3: the V2 seven re-weighted + capability audit + specialist review + learning plan, 0-100) written to `.unown/plans/<slug>.md` behind an approval gate, through the `plan_write` and `exit_plan_mode` tools, `/plan` (bare = toggle, plus `<description> | open | show | off`), Shift+Tab cycling, `Ctrl+Alt+P`, `--plan-model`, and a mechanical turn budget with escalating convergence nudges. The 2026-10-31 todo-unification round made the seeded todo overlay the single progress checklist, so plan steps and the `todo` tool are one list with two input paths. V3 adds the pre-design capability audit (11 capabilities in priority order, USED/SKIPPED with reasons), the read-only specialist bench consulted through `task` while planning (writing agents refused pre-spawn), the synthesis block, and the mandatory `plan_retrospective` close-out (outcome, failure classification, learning candidates) that feeds AutoDream.
- Sessions stored as JSONL in **two** stores (user `~/.unown/agent/sessions` and project `.unown/sessions`), with abort via Esc or `/abort`, resume via `-c`, `--resume`, a bare `--resume` picker over both stores, or `unown sessions resume`, plus `list`, `delete`, `rename`, markdown/JSON/HTML export with default-on secret redaction, and crash recovery through atomic writes.
- Subagents through the `task` tool: **20 built-in agents** (`general`, `explore`, `background-explore`, `browser`, `scout`, `worker`, `reviewer`, `planner`, `debug`, `test`, `security-reviewer`, `documenter`, plus the eight Plan Mode V3 planning specialists: `product-strategist`, `solution-architect`, `delivery-manager`, `qa-architect`, `devils-advocate`, `learning-analyst`, `memory-auditor`, `skill-architect` — all read-only, all unadvertised) plus custom agents in `.unown/agents/*.md`. Read-only built-ins carry turn caps against token runaways.
- An async fleet lane: `async: true` fire-and-forget spawns that wake you instead of being polled, `task_control` to steer, stop, or inspect, batch fan-out, `output_schema`, per-spawn worktree isolation, a durable journal at `.unown/fleet/journal.jsonl`, and an orphan reaper at boot.
- A delegation audit trail: every spawn carries an optional `why`, journaled with the spawn, reported to the engine, and readable in-session (`/delegation`), from the CLI (`unown delegations`), and on the dashboard's Delegation screen.
- Browser tool driving real Chromium over CDP, with vision screenshots, launch or attach modes, persistent profiles and logins, a stealth tier, and a CAPTCHA pipeline (detect, classify, solve, verify; 2Captcha, CapSolver, or vision OCR).
- Web search and web fetch (a keyless provider chain plus keyed providers, SSRF-hardened and robots-aware) backed by a persistent results cache with TTL, RFC 9111 ETag revalidation, stale-if-error, and serve-stale-revalidate. Managed by `unown webcache` and its own dashboard screen.
- Repomap: a graph-ranked (personalized PageRank) symbol map built on vendored tree-sitter grammars, fed into subagent context.
- Repo wiki (`unown wiki` / `/wiki`): generated docs with file:line cross-links, a DOT architecture graph, and search, written to `.unown/wiki/`.
- Recipes (`unown recipes` / `/recipe`): reusable instruction bundles with JSON-Schema typed parameters, structured output schemas, file templates, and sub-recipes.
- Addons (`ask_user_question`, `todo`, `advisor`) configured through `~/.unown/agent/addons.json` and the `/addons` picker. Use-time fields hot-reload; registration-time fields need `/reload`.
- Split view display mode: a thinking/tools band, a files dock, and a response-only transcript (`/split`, `/split-thinking`, `/split-tools`, `/split-diff`, `--no-split`).
- A quiet footer: one merged status row plus a priority-ordered attention row that paints chips only when they need attention, with `UNOWN_FOOTER_CLASSIC=1` as a kill switch per call.
- A mission panel (`/mission`) showing objective, derived plan, receipts-only confidence, and risks; plus `/brief` on return, `/recovery`, `/feed`, `/btw`, `/recap`, `/status`, `/diff`, `/context`.
- Checkpoints and receipts: `/checkpoint`, `/undo`, `/redo`, `/receipts`, `/review`.
- Verify-first defaults: after every write or edit of a non-doc file, the project's own check command runs in PostToolUse and failures are fed back to the agent (`UNOWN_AUTO_VERIFY=0` disables). Post-edit formatters run after the syntax gate, fail-open.
- Usage tracking (`unown usage`) with cost estimates and env-pinned prices, plus `unown doctor` and `doctor-instructions` diagnostics against a symptom-first troubleshooting guide.
- Launch surface for CI and automation: `--permission-mode`, repeatable `--add-dir`, `--max-turns` (a turn is one model call; a capped run with an answer still exits 0 and reports `capped: true`), `--output-schema` (exit 3 on mismatch), `--max-tool-repetitions` (loop guard, exit 4), `--worktree`/`-w`, and `--goal`. Print-mode exits: 0 success, 1 error or empty, 2 usage, 3 schema-invalid, 4 loop guard.
- Config migration: `unown import --from auto|claude-code|codex|gemini|cursor|opencode` (`--dry-run`, `--list`, `--lane`), which never overwrites.

## Automation and unattended work

- Routines (`unown routines`): five schedule kinds (`cron`, `every`, `after`, `once`, `event`) with misfire policies, retries with exponential backoff, chained routines, active-hours, idle-only gating, result webhooks, and jitter. DST-aware: a fold fires once at the earlier instant, a gap shifts forward. Event payloads reach dispatched runs framed as data, never instructions, and the `routine.*` webhook namespace is reserved so external senders cannot forge chain triggers.
- Standing orders: `## Program:` sections in `.unown/standing-orders.md` (project) or `~/.unown/agent/standing-orders.md` (global), with character budgets, that compose a rider onto unattended-run prompts. `/promote` distills a session into a Program; `/promote schedule <spec>` creates the routine with an auto-removed trial run.
- Ralph loop (`unown ralph "<task>"`): a fresh-context worker and a fresh-context reviewer (ideally a different model) iterate with a file-only handoff and a VERDICT: SHIP or REVISE, default 5 iterations, cap 20. Reviewer failure defaults to REVISE; it never silently ships.
- Watch (`unown watch`): `AI:`, `AI!`, and `AI?` comment markers trigger batched headless runs, with per-comment identity hashed from normalized file, line, kind, and text, so a run re-triggers only on a real change.
- Process lifecycle management: a **12-state** machine (CREATED, PLANNED, QUEUED, RUNNING, WAITING, BLOCKED, RETRYING, VALIDATING, SUCCEEDED, FAILED, ABANDONED, ARCHIVED) that nothing bypasses, a process registry with an append-only event journal, governed tool invocations, state-aware orphan healing at boot, a nine-category failure taxonomy with a deterministic recovery plan and validation ledger, checkpoints with replay, and a learning-attribution proof chain (failure, improvement, benchmark, before/after, retained, regression) that is never pruned. Kill switch `UNOWN_PLM=0`.

## Models and providers

- `unown setup` configures providers and writes `models.json`, `auth.json` (keys at 0600), and `settings.json` under `~/.unown/agent/`. Providers can also be managed with `unown providers` (add, test, remove).
- Key resolution is one path with a documented precedence (`auth.json` over a `models.json` literal over the environment at call time). Endpoint probes are wire-aware: an OpenAI-compatible endpoint is probed with `GET {base}/models` and Bearer auth, Anthropic with `GET {root}/v1/models` and `x-api-key`, because the wrong scheme false-401s a valid key. Failure classes are `unreachable`, `auth`, and `rate-limit`, with latency recorded; recent failures surface as marks in `unown doctor` and `unown models` rather than silence.
- Works with OpenAI-compatible upstreams and custom providers, through either the LLM bridge or a direct endpoint.
- The LLM bridge (port 3031) handles model-id allow-list routing, key injection, admission lanes and concurrency caps, failover, SSE passthrough, 429 backoff, and a usage log. Its served models are `agnes-3.0-flash` and `agnes-2.5-flash`.
- Default upstream is Agnes AI (`https://apihub.agnes-ai.com/v1`), a metered free tier of roughly 20 requests per minute. The bridge does not enforce a literal RPM number; it spaces requests (400ms minimum) and caps concurrency at 3, with backoff, sized for that tier.
- Model spec detection resolves context window, max output, pricing, and modalities from verifiable sources, never guesses, records provenance per model in `~/.unown/agent/model-specs.json`, and gates any unverifiable model behind an explicit answer. `unown models verify [--provider P] [--model M] [--json]` re-runs detection, heals records, and can record a bridge's learned limits from its upstream 400s. Escape hatch: `UNOWN_ALLOW_UNVERIFIED_SPECS=1`.

## Installation, updates, and platforms

- One-line installer (`install.sh` for POSIX, `install.ps1` for Windows), checkout and binary install modes, manual clone and standalone per-OS archives, offline and air-gapped lanes, and `unown uninstall` (`--dry-run`, `--purge-data`, `--purge-checkout`).
- `unown update` is mode-aware for both checkouts and binaries, selects the release asset from a manifest, honors per-OS availability, notifies on startup (TTY only, CI-suppressed, 24h-cached) with `--skip`, `--unskip`, and `--snooze`, and supports pinned installs (`unown update <version>`) and `--rollback`.
- A binary install reconciles stale service residue from a superseded source install, so a leftover unit cannot silently boot a second engine against the wrong database.
- Release artifacts: six per-OS standalone archives (darwin, linux, windows x arm64, x64) cross-compiled by one ubuntu runner with `bun build --compile --target=`, plus `version.txt`, `install.sh`/`install.ps1`, an unsigned `release.json` manifest, `sha256sums.txt`, an SBOM, and attestations. Binaries are unsigned by decision; the install docs and each archive's `INSTALL.txt` state the Gatekeeper and SmartScreen step. Windows arm64 ships untested.
- Platforms: Linux (bubblewrap sandbox), macOS (seatbelt, with deprecation notes, and darwin prebuilds), native Windows (`bin/unown.cmd` and `bin/unown.ps1` shims, Git Bash awareness, a PowerShell tool; no OS sandbox), and WSL2.
- Configuration: every knob is an environment variable documented in `.env` / `.env.example` and `docs/configuration.md`, alongside the state-file layout and a `/settings` control center with 11 intent-ordered sections, search, recently-changed, health, and recovery lanes (`/settings status | search | health | diff | recent | export | import | reset`). Project-scoped settings (`.unown/settings.json`, trust-gated) merge under CLI flags.

## Evaluation and research

- A harness benchmark suite with per-task integrity checking (each test file is hashed and a mismatch fails the run). The seed suite is 6 tasks; task minting grows it by up to 8. 32 committed benchmark suite directories under `benchmarks/`.
- A memory evaluation suite covering operation accuracy, retrieval ranking, judge calibration, and exactly 12 documented failure modes pinned as regressions (fm-01 through fm-12, currently 12/12 passing), plus four further lanes: `mpbench`, `poison-corpus`, `quality-axes`, and `recall-qa`.
- Receipt-backed results: operation-accuracy macro `opsF1` 0.992; judge calibration 0/8 false-positive rate with perfect agreement and no positional bias; cold-start retrieval recovery from 0/6 to 6/6 at hit@5, and a repeated-task cost drop from 30 capped turns to 9.
- Research testbenches for small local LLMs (a llama.cpp lane), zero-LLM techniques (ONNX encoders, MinHash, LexRank, BM25 with RRF fusion, ETIN), and complementary mechanisms (speculative decoding, semantic caching). Honest status: these are testbenches, mostly not shipped. The exception that lives on in the engine is the ONNX embedder lane (bge-small embeddings with a deterministic lexical fallback and loss-free backend-switch re-embedding); the zero-LLM dream lanes were retired by the 2026-10-22 Mem0 swap.
- Verification scale at v0.0.54: the release matrix reports 5,326 engine tests passing with 0 failing, across 224 test files at the suite root plus an integration lane; 15/15 on the end-to-end lane (5 Playwright spec files: a11y, blog, dex-video, landing scroll budget, SEO); and 14/14 plus 9/9 on the live PTY lanes, which drive the real terminal and assert pane truth rather than mocking the UI.

## Stack and project

- TypeScript on Bun (floor 1.4, badge 1.4.3; `scripts/install.ts` enforces it), Next.js 16.4.3, React 19.3.1, Tailwind 4.3.3 for the landing page and blog.
- Engine state in SQLite via better-sqlite3 (runs, cycles, dreams, memory versions, hook log, processes, delegations, webcache), Mem0 (`mem0ai` 3.3.1) as the in-process memory platform, web-tree-sitter for the repomap, and TypeBox for schemas. Both the engine and the bridge serve over bare `Bun.serve`, with no HTTP framework in the dependency tree.
- Service map: engine `:3030` (bearer-token gated), llm-bridge `:3031`, an optional `zai-upstream` shim `:3032`, landing page `:3000`.
- Public repo, MIT license, Code of Conduct, contributing guide, security policy, support doc, and nine CI workflows.
- Snapshot as of 2026-11-10: 1,206 commits on `main`, v0.0.57 latest release (0.0.58–0.0.61 shipped from `main` without a release tag — the site's install lane serves 0.0.57 until the next tag is cut), repo created 2026-08-26, 7 open issues (all self-filed dogfooding bugs: #29 engine-starved print sessions, #30 print-mode exit hang, #43 iframe form-fill loss, #44 JPEG/PNG mismatch, #45 proactive dialog hints, #46 AutoDream pruning quoted lines, #48 doctor crash on a malformed spec sidecar — the end-user round re-verified each against current `main`) (a headless-exit hang and engine-versus-interactive bridge contention) and 0 open dependabot PRs (the security round cleared the advisory queue and closed the last seven PRs — five applied, one superseded by the five-surface regen, one declined on its peer contract).

## Appendix A: corrections against the earlier draft

Path convention: bare `src/...` means `pi-repo/packages/self-learning/src/...`, the engine package. Everything else is written in full.

| Draft claim | Verified reality | Evidence |
|---|---|---|
| Dashboard has 12 screens | 15 screens | `pi-repo/packages/self-learning/src/dashboard/dashboard-app.ts:55-76` |
| `/dashboard` is a page alongside the landing site | An in-session TUI command (`/dash` alias); the web dashboard is retired | `src/tools.ts:4230,4237`; `docs/tui-dashboard-plan.md:1,8` |
| Eight jobs: six interval, two event | Nine jobs: seven interval (`watch-scan` 2m was missing), two event | `src/router.ts:36-104` |
| Event jobs named `improvement:shipped`, `run:finished` | Those are the trigger events; the jobs are `regression-on-ship` and `dream-check` | `src/router.ts:62-70` |
| Budget governor enforces hourly and daily LLM spend limits | Calls per hour (60), tokens per hour (200k), tokens per day (2M), plus an upstream circuit breaker. No dollar cap | `src/governor.ts:13-15,67-73` |
| Subagents: four built-ins (general, explore, background-explore, browser) | Twelve built-ins; `scout`, `worker`, `reviewer`, `planner`, `debug`, `test`, `security-reviewer`, `documenter` were omitted | `src/tools.ts:367,382`; `src/subagent-routing.ts:518`; `src/subagent-builtins.ts:52-346` |
| Subagents: twelve built-ins (the pre-V3 count) | Twenty built-ins since the 2026-11-01 plan-mode V3 round: the twelve plus the eight read-only planning specialists (`PLANNING_BUILTIN_AGENTS`) | `src/tools.ts` BUILTIN_AGENTS spread; `src/subagent-builtins.ts` PLANNING_BUILTIN_AGENTS |
| OS-level bubblewrap isolation (unqualified) | bubblewrap on Linux, seatbelt on macOS, TS path-jail on native Windows | `src/sandbox.ts:60-63,102-108`; `src/bwrap.ts:10,88-99,161-167` |
| Writes attributed to seed, harness, mem0, or rollback | Seven literals in use: `seed`, `harness`, `mem0`, `autodream`, `autodream-hoist`, `manual`, `rollback`. The dashboard's typed union lists only five of them | `src/dream.ts:328,1177`; `src/memory.ts:287`; `src/hoist.ts:337-338`; `src/dashboard/dashboard-types.ts:29` |
| Supports 13 lifecycle events | Correct for the configurable layer; the internal union is 15, with `MemoryBudget` and `AutoCompact` engine-only and deliberately not config keys | `src/hooks-config.ts:92-111`; `src/doctor-instructions.ts:572-586` |
| Addons configured through `addons.json` | Global only: `~/.unown/agent/addons.json` | `src/addons/config.ts:226` |
| Addons hot reload | Partial: use-time fields reload live, registration-time fields need `/reload` | `src/addons/config.ts:18-20`; `src/addons/index.ts:18` |
| `/plan <description>\|open\|show\|off` | Bare `/plan` toggles; the listed arguments also exist | `src/tools.ts:4066-4068` |
| Sessions stored as JSONL | Correct, but there are two stores (user `~/.unown/agent/sessions` and project `<cwd>/.unown/sessions`) and every picker, list, and export path unions them | `src/unown-home.ts:33`; `src/sessions.ts:709,777`; `src/sessions-cli.ts:56-57` |
| Commands substitute `$ARGUMENTS` and `$1..$N` | Also `${N:-default}` | `src/cli.ts:1271-1281` |
| The engine auto-starts when a note is delivered | Delivery kicks a spawn only when the probe says the port is refused; a 401, occupied, incompatible, or hung engine is reported blocked and never spawned over. The note lands in the outbox either way | `src/term.ts:1077-1084`; `src/engine-supervisor.ts:587-592` |
| Playbooks cover five failure modes | Eleven, R1 through R11 (R10 has a section but is absent from the index table) | `docs/resilience.md:128-137,214-227` |
| Model spec detection "uses a cascade" | Correct, and the order is now stated: endpoint `/models`, curated catalog, models.dev, LiteLLM, then the user through the gate, first hit per field. Detection never throws. Drift found: the module's own header comment still lists curated first and endpoint fourth, contradicting the runtime code below it | `src/model-spec-detect.ts:735-786` (comment at `:8-19`) |
| Bridge caps ~20 RPM for Agnes | No RPM cap exists in code. Actual guards: 400ms minimum spacing, concurrency cap 3, 429 backoff with a 45s ceiling plus jitter | `mini-services/llm-bridge/index.ts:43,235`; `mini-services/llm-bridge/pure.ts:148,206-207` |
| SQLite for engine state | Correct; note there is no Express or similar framework, both services use bare `Bun.serve` | `src/server.ts:1564`; `mini-services/llm-bridge/index.ts:657` |
| Baseline implied ~5296 passing tests | 5,326 passing / 0 failing at v0.0.53; 224 test files at the suite root | `README.md:136`; `docs/release-recovery-session.md` |
| "12 documented failure modes" | Confirmed exactly, fm-01 to fm-12, 12/12 passing | `benchmarks/memory-eval/failure-modes/cases.json:7-146`; `.../RESULTS.md:10` |
| "by Kanishka Namdeo" | Corroborated by the repo owner and blog author metadata; `LICENSE` reads "Copyright (c) 2026 Unown contributors" and root `package.json` has no `author` field | `LICENSE:3` |
| Ideas "Anthropic has described" | README wording is "the five mechanisms Anthropic popularized by *using Claude Code to improve Claude Code*". It carries no URL, so it is an uncited attribution | `README.md:7-9` |
| A Next.js landing page and blog on Vercel | Confirmed, plus the note that the repo's own deployment rule is that Vercel deploys in parallel with CI, so a red commit can reach production | `vercel.json`; root `AGENTS.md` |

## Appendix B: significant things the earlier draft omitted

- **PLM learning attribution**: an un-pruned proof chain from failure to improvement to benchmark to before/after to retained to regression (`src/plm/learning-attribution.ts`, `GET /api/learning/attribution`).
- **The async fleet and its audit surface**: fire-and-forget subagents, `task_control`, a durable journal, an orphan reaper, and per-delegation `why` with worth lines (`unown delegations`, `/delegation`, the Delegation screen).
- **In-session observability**: the mission panel, the auto-brief on return, `/recovery`, `/feed`, `/status`, `/diff`, `/context`, and the checkpoint/receipt ledger.
- **Security layers beyond the deny-list**: a prompt-injection scanner, a file-gated LLM adversary reviewer, a TOCTOU re-check on hook-mutated inputs, and instruction quarantining that keeps poisoned notes away from the extraction LLM.
- **`/settings`**: an 11-section intent-grouped control center with headless lanes, built on a roughly 410-entry configuration inventory.
- **Provider and model health machinery**: wire-aware endpoint probes, rate-limit distinguished from auth failure, latency chips, and 30-minute health marks surfaced in doctor.
- **The first-run experience**: an install-receipt card read back from `~/.unown/install.json`, a masked secret entry path, and the animated splash mark with its no-wrap, no-background-fill invariants.
- **Cross-platform verification is agent-drivable**: `node scripts/xplat.mjs local|dispatch --scenario smoke|core|full|release-verify`, with the exit code as the verdict.
- **Known open work, stated plainly**: 2 open issues (a headless-mode hang and engine traffic starving interactive sessions) and no public star/fork traction claim worth citing.
