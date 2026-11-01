# A2_GROUND_TRUTH — Unown capability snapshot (A1 operator recon)

- **Produced**: 2026-11-02 (operator-local) · 2026-11-01T21:22Z (UTC), by A1 during the fresh-clone round resume session.
- **Snapshot of**: `main` @ `5fe50ca8` (post `v0.0.55`), 53 tags since 2026-08-26 — velocity is extreme (307 commits / 7 days; 905 / 30 days), so assume every literal here goes stale; the refresh rule below is load-bearing.
- **Trust order** (the anti-rot law): live CLI output > repo docs on `main` > this file > the A1 directive. On conflict, live wins and the drift is logged in §10.
- **Refresh rule**: re-verify before any ticket; full refresh at every teardown cycle. Every claim below carries its source and the date it was observed.
- **Sandbox lineage**: `/home/z/my-project/Unown` (recycled lineage; fresh re-clone), bun 1.4.3 (CI pin — 1.4.4 has the frozen-lockfile regression, bun #46510), `UNOWN_HOME=/home/z/my-project/unown-home` (persistent across recycles), Agnes upstream wired, PAT in the git remote URL per root AGENTS.md convention.

## 1. Version + velocity

| Datum | Value | Source |
|---|---|---|
| Version | `0.0.55` (package.json; `unown --version` agrees; CI asserts tag≡package≡binary) | live `unown doctor` 2026-11-01T21:1xZ |
| HEAD | `5fe50ca8` = "docs: the fresh-clone round opens…" (the round's own M1 commit) | `git log -1` |
| Tags | 53 (`v0.0.6`…`v0.0.55`), stable-only, no prereleases | `git tag` |
| Velocity | 307 commits/7d, 905/30d, first commit 2026-08-26 | `git log --since` |
| Release cadence | v0.0.49→v0.0.55 all landed within 2026-11-01 (settings→security rounds) | docs/SESSION.md |

## 2. Live command surface (captured live 2026-11-01)

- **Entry modes**: `unown` TUI · `unown "prompt"` · `unown -p` headless print · `-c`/`--resume <id|name|path>` + picker · `--plan` (plan mode; **V3 capability orchestrator is the DEFAULT plan mode** since 2026-11-01, kill switch `UNOWN_PLAN_MODE_V3=0`) · `--plan-model <id>` · `--goal "objective"`.
- **Management commands** (~40 help rows observed; docs claim ~27): setup/providers/models (+verify)/init/init-agents/memory/note/doctor/doctor-instructions/mcp/dashboard/info/sessions/import/export/blame/recipes/wiki/worktrees/acp/routines(=automations)/watch/repomap/ralph/engine/usage/webcache/delegations/update/changelog/completions/uninstall.
- **Launch flags**: `--permission-mode <default|acceptEdits|bypassPermissions>`, `--add-dir`, `--max-turns`, `--output-schema`, `--max-tool-repetitions`, `--worktree/-w`, `--mode json`, `--no-session`.
- **Print-mode exit contract**: 0 success (capped-with-answer is 0 + `capped:true`), 1 error/empty, 2 usage, 3 schema-invalid, 4 loop guard.
- Non-TTY note: run `-p` with `< /dev/null` (root AGENTS.md; honored in today's receipts).

## 3. Trust + config

- **Config**: `.env` is the single source (gitignored; `.env.example` tracked reference); installer symlinks mini-service `.env`s. Key present today: `BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`, `BRIDGE_UPSTREAM_KEY` set, `BRIDGE_MODEL=agnes-3.0-flash`, `UNOWN_HOME=/home/z/my-project/unown-home`.
- **Auth**: engine API = per-boot bearer token (M7), mirrored to `$UNOWN_HOME/engine.token`; bridge keyless on loopback; GitHub PAT lives only in the git remote URL (root AGENTS.md User Preferences).
- **Permissions**: default/acceptEdits/bypassPermissions modes; write-path jail (project + /tmp + `--add-dir`); headless `ask` = fail-closed.
- **Sandbox**: bubblewrap fs+net isolation ACTIVE in this container (vendored binary; doctor receipt). macOS seatbelt; Windows path-jail/WSL2.
- **Instruction-set guard**: in-session writes to AGENTS.md/CLAUDE.md, `.unown/skills|agents|hooks|permissions|memory/policy|project.md` are DENIED — propose a PR instead (relevant to every A2 ticket that wants to touch DOX).
- **Engine autostart taxonomy**: only a refused port spawns an engine; 401/occupied/incompatible/hung = BLOCKED, never spawned over.

## 4. Memory + guardrails

- **4-tier memory** (most-specific-wins, injected every session): policy → project (`.unown/memory/project.md`, tracked, AutoDream-rendered, `## Manual notes` lane durable) → user → local (gitignored). Render footer today: 110/114 memories, 4 pruned at cap (file footer, 2026-11-01T16:05Z).
- **AutoDream**: `auto-dream` job every 10 min over pending notes (4 entry points incl. subagent notes); Mem0 lexical backend; project dreams ungated; also mints staged skills (`.unown/skills-staged/`, never auto-loaded — human `mv` promotes).
- **Guardrails**: terminal hook deny-list (rm -rf /, fork bombs, mkfs, dd→disk, /etc redirects, chmod -R 777 /); syntax gate on edits; `UNOWN_STRICT_HOOKS=1` adds sudo/curl/wget/nc external + git push deny; injection scanner + adversary mode (doctor's instruction-set audit ran **clean** today).
- **User hooks**: 13 events × 5 handler types (command/http/mcp/prompt/agent), trust-gated project config, fail-open after built-ins.

## 5. Health (receipted this lineage, 2026-11-01T21:xxZ)

- `bun run agent:install` 7/7 green (UNOWN_NO_ENGINE_SERVICE=1).
- Bridge `:3031` — `ok:true`, upstream **200**, key set, 6 agnes models discovered, default `agnes-3.0-flash` (live /health).
- Engine `:3030` — `phase:"ready"`, v0.0.55 @ 5fe50ca8, uptime >10 min (live /api/health, bearer).
- `unown setup --provider bridge` → configured; `unown doctor` → **"unown is ready to chat"**, 18 ✓ / 1 ⚠ (LSP none in container — optional, documented).
- Model specs verified: `zai-bridge/agnes-3.0-flash: 524,288 ctx / 65,536 out (curated catalog)`.
- Headless chat: `unown -p "Reply with exactly: UNOWN_OK"` → `UNOWN_OK`, exit 0, 6/6 consecutive runs 1.4–3.4 s each (usage log: 6× `status:"ok"`; session JSONLs under `$UNOWN_HOME/agent/sessions/`).

## 6. Verification signals

- **In-envelope**: `--max-turns` (cap signal), `--output-schema` (exit 3 + `schema_valid`), loop guard (exit 4 + `loop_guard`), `--mode json` envelope.
- **CLI**: `unown doctor` (exit 1 only when chat is broken; `--json` CI-able), `unown models verify` (exit 1 listing unverified), `doctor-instructions`.
- **Gates**: `check:docs|changelog|blog|benchmarks|claims`, `audit:landing`, `review:vlm`, `critic:design`, `test:unit` (baseline 2067/0 on this tree family per prior checkpoint — not re-run today), `typecheck`, `lint`, e2e Playwright.
- **CI**: ubuntu leg every push/PR; macOS+Windows legs on version-bump commits or dispatch (spend-gated); landing auto-deploys to Vercel on `main` **in parallel with CI** — deploy-verify detects, does not prevent.
- **Cross-platform on demand**: `node scripts/xplat.mjs local --scenario smoke|core|full|release-verify`; `dispatch` buys a real per-OS verdict without a push; exit codes 0/1/2/3.
- **PTY lanes**: 25 scenario specs + ~30 dedicated capture scripts under `scripts/tui-capture/` (pane-is-truth contract).

## 7. Weak spots (dated, sourced)

1. **Issue #30 — `unown -p` exit hang (OPEN)**: intermittent (3/18 runs historically; 12+ clean between); correlates with first-run/boot window and active engine-harness runs; survives SIGTERM. NOT note-delivery, NOT engine-down, NOT bridge. Issue asks for: (a) /proc-level capture with an armed watcher, (b) an instrumented build logging which exit path (agent_end / stall / hard-exit / drain) is pending when the answer flushes. **Today: 6/6 non-repro on an idle engine** — the repro lane must combine `unown -p` loops with live engine churn (dream/harness runs).
2. **Metered upstream**: Agnes free tier ~20 RPM; bridge spaces/caps concurrency (max 3, 400 ms spacing); prefer batching over parallel (root AGENTS.md).
3. **Container limits**: no LSP servers (doctor ⚠); engine + bridge are mortal across sandbox recycles (re-run `bun run agent:start`).
4. **Doc-count drift (Explore audit 2026-11-02 — 8 flags)**: usage.md slash-commands "thirty-four" vs 48 observed; session tools "seventeen" vs 21+3 plan tools; dashboard screens 12 vs 15 in `dashboard-app.ts`; skills.md documents 7 project skills vs **13 observed** in `.unown/skills/`; subagents.md built-ins table 12 rows (with a duplicate `browser` row) vs 20 in `subagent-builtins.ts`; project agents "four" vs 6 observed. All Level-1 (discovery) augmentation candidates.
5. **Landing honesty exposure**: Vercel deploys in parallel with CI (AGENTS.md §Deployment) — a red commit can reach production.
6. **Unsigned binaries** (docs/install.md) — Gatekeeper/SmartScreen friction, documented.

## 8. Capability Surface Inventory (observed 2026-11-02; classes + discovery paths, counts as observed)

| Class | Purpose | Activation | Trust | Constraints / outputs | Discovery path |
|---|---|---|---|---|---|
| CLI mgmt commands (~40 rows) | lifecycle, config, diagnostics | shell | varies; several read-only | see §2 | `unown --help`; docs/usage.md |
| Slash commands (~82: 48 unown + 11 split + 23 pi + per-skill + custom) | in-session control | `/cmd` | `/permissions`, `/hooks`, `/mcp` trust-gated | `/plan /review /tasks /agents /delegation /goal /undo /checkpoint /btw …` | command registry + dir scan + `/reload` |
| Skills (13 project + 4 starters) | progressive-disclosure playbooks | auto: `description` match → body loads on `read` | instruction-set guard protects `.unown/skills/**` | ≤2 minted/dream, 24 ceiling; staged never auto-load | `<available_skills>` at session start; `/skill:<name>` |
| Subagents (20 built-ins + 6 project agents) | fresh-context task workers | `task` tool, by name | planning admits read-only only; completion guard on write lanes | ≤4 parallel sync; fleet: 8 live, 900 s; report cap 16k | `<advertised_subagents>` every turn; `/agents`; bench is `advertise:false` (by name) |
| Plan-mode V3 orchestrator | audit→draft→specialist review→synthesis→learning plan→scored gate→execute→retrospective | DEFAULT plan mode; `--plan`, `/plan`, Shift+Tab, Ctrl+Alt+P | kill switch `UNOWN_PLAN_MODE_V3=0` | 11-item capability audit; 5 reviewers + 3 retrospective specialists; score /100 | phase prompts; docs/plan-mode-v3.md |
| Recipes | typed, parameterized instruction bundles | `unown recipes run` / `/recipe` | declared `allowed_tools` | response_schema with 2 corrective retries | dir scan `.unown/recipes/` |
| Standing orders | durable authority programs | injected into routine dispatches | `/promote` distill→save→schedule | digest ≤2k/order, 10k total | standing-orders.md |
| Routines (engine DB; never repo) | scheduled unattended runs | `unown routines`, REST, webhook events | default mode read-only; `UNOWN_AUTOMATION=1` recursion block | 20 max, 2 concurrent, 30-min timeout, retry ladder | engine API; `/routines`; dashboard |
| Hooks (13 events × 5 handlers) | guardrail + automation seams | event bus | user hooks trust-gated, fail-open after built-ins | built-in deny-list always on | hooks.json scan |
| Memory tiers (4) | persistent context | auto-injected; `/learning` | project tier tracked; local gitignored | render cap 110 bullets | injection at session start |
| MCP servers | external tool adapters | `unown mcp add` | `.unown/mcp.json` trust-gated | none configured today (doctor) | doctor; `/mcp` |
| Engine services (:3030 REST+SSE, :3031 bridge) | learning backend | `bun run agent:start` / auto-start on note | M7 bearer + loopback bind | graceful drain 10 s; outbox dead-letters after 5 | health endpoints; `unown engine status` |
| Browser (32 actions, CDP Chromium) | web automation + vision screenshots | `browser` tool / `browser` subagent | stealth + captcha lanes; DOM is context poison | 600 s budget; hints lane from memory | tool description; browser subagent |
| Web retrieval | keyless search + fetch | `web_search`/`webfetch`/`fetch_url` | SSRF-hardened, robots-aware | shared cache 60 min TTL; `UNOWN_WEB_SEARCH=0` off | tool descriptions |
| Reporting | dashboard (15 screens), blame, wiki, usage, delegations | `unown dashboard`/`blame`/`wiki` | M7 token | receipts-backed | CLI help |
| Orchestration | task parallelism, fleet, ralph loop, delegation audit | `task` (+`async:true`), `unown ralph` | fleet journal append-only | `UNOWN_DELEGATION_LEVEL` tunes catalog | advertised catalog; `/delegation` |

## 9. Capability Utilization Audit (the 8-question frame, applied today)

**Observed failure — issue #30 (exit hang):**
1. Missing capability? **Partially**: no built-in exit-path telemetry and no armed /proc capture harness — exactly what the issue requests. That is augmentation lane "exit-path instrumentation" (see proposal below).
2–3. Existing capability not discovered/triggered? No — stall watchdog + hard-exit timer exist and are documented.
6. Triggered but unverified? **Yes — this is the classification**: the watchdog/hard-exit fire blind in the failure window; nothing records which path was pending. → Level 4 (verification) first: instrument, then fix.
7. Composition order? Possible contributor (answer flush vs exit-path race) — root cause still open pending instrumentation.

**Observed success — this lineage's bring-up (7/7 install, doctor green, 6/6 smoke):**
- Capability attribution: the repo's own quickstart workflow + standing orders (PAT-in-remote, Agnes endpoint, metered-tier guard) + `unown doctor` + the `UNOWN_OK` smoke convention carried the whole bring-up — zero custom setup authored. Cheaper alternative existed? No: every step used the documented lane.

**Doc-drift findings (8 flags, §7.4):** existing capability (docs) discovered but **stale** — Level 1 discovery lane: regenerate or correct the counts (the landing already has a generated-data pattern to copy).

**Augmentation backlog seeded (priority order per the A1 directive):**
- L4: #30 exit-path instrumentation + armed /proc watcher (ticket through A2, evidence pack attached).
- L1: doc-count drift sweep (usage/skills/subagents/dashboard screens).
- L2/L3: recorded for the Coda round — `/review` + specialist bench on every app milestone; `delegation-auditor` after delegation-heavy sessions.

## 10. Drift log

- 2026-11-02: A1 directive placeholders `[APP_NAME + VISION + REPO PATH]` resolved by operator decision → **Coda (local-first markdown notes + task-board PWA)** at **`apps/coda/`** in this monorepo; push lane **direct to `main`**; first lane **finish the fresh-clone round** (this file, then #30, then PT-5, then closeout).
- 2026-11-02: the directive's STABLE-INTERFACE shapes all verified live today (TUI, `-p` headless, plan mode, JSON envelope, home/project separation, memory hierarchy, verify-before-done culture, fresh-context task workers, engine loopback-first).
- 2026-11-02: docs/usage.md slash/session-tool counts stale vs observed (§7.4) — logged, queued as L1 lane.
- 2026-11-02 (round close): the fresh-clone round is COMPLETE — M2 shipped `UNOWN_PRINT_EXIT_TRACE=1` (issue #30 request (b)) + `scripts/issue30_watcher.mjs` (request (a)); M3 receipted PT-5 (7 live specialist spawns, 87/100; the Coda design doc); M4 graduated the round (`docs/fresh-clone-round-session.md`) and opened the Coda app round (`docs/coda-app-round-session.md`, ticket queue C1–C6). CI receipts: the substantive code commits `749d94e5` and `18f80a68` fully green (CI + CodeQL + Scorecard + deploy-verify) on GitHub Actions; the trailing docs commits covered by the same content in green runs. **Next refresh due: at the Coda round's first teardown.**

---
*No tickets before this file exists — it does now. The fresh-clone round is closed; the next tickets are the Coda round's C1–C6 (`docs/coda-app-round-session.md`).*
