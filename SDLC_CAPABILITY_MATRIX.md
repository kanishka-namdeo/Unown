# SDLC Capability Matrix — Unown (A1 operator recon)

- **Produced**: 2026-11-03, by A1 during the Coda-round resume (full sandbox recycle; every live datum below re-verified same day — bring-up receipts in `A2_GROUND_TRUTH.md` §10 drift log).
- **Snapshot of**: `main` @ `f9872c4e` (v0.0.55).
- **Companion to**: `A2_GROUND_TRUTH.md` — same trust order (live executable output > runtime introspection > repo main docs > ground truth > directive) and the same refresh rule: re-verify before any ticket; full refresh at every teardown cycle.
- **Purpose**: the A1 directive's SDLC Capability Inventory. Every capability carries the directive's required fields — activation, trust requirements, limitations, evidence source, verification method — and the coverage matrix tracks which lifecycle lanes have **receipted** evidence from the DRIVE track (the Coda app round).

## Native-first rule (binding)

For every lifecycle activity: discover existing capability → use it → measure the outcome → identify the gap → augment only if a **genuine platform limitation** remains. Failure classification: capability *missing* / *undiscovered* / *poorly invoked* / *improperly verified* / *genuine platform limitation* — only the last justifies augmentation or an upstream request.

## 1. Planning

| Capability | Activation | Trust | Limitations | Evidence | Verification |
|---|---|---|---|---|---|
| Plan-mode V3 capability orchestrator (audit → draft → specialist review → synthesis → learning plan → scored gate → execute → retrospective) | DEFAULT plan mode: `--plan`, `/plan`, Shift+Tab, Ctrl+Alt+P; kill switch `UNOWN_PLAN_MODE_V3=0` restores V2 | `task` tool stays live but admits read-only agents only (task-tool guard) | Score is advisory, not a correctness proof; specialist reviews are read-only | `docs/plan-mode-v3.md`, `pi-repo/packages/self-learning/AGENTS.md` | `.unown/plans/` artifacts + score; PT-5 receipt: 17 turns, 7 live specialist spawns, **87/100** (`benchmarks/plan-mode/results/run-2026-11-02-pt5/`) |
| Split planning model (opusplan lane) | `--plan-model <id>` / `PI_PLAN_MODEL_ID` | plan model ≠ session model | doubles metered-model traffic | ground truth §2 | `unown --help` |
| Plan artifacts + todo unification | `/plan <description>\|open\|show\|off`, `/tasks`; `.unown/plans/` | plans land in-project | — | docs/plan-mode round records | plan file + envelope `plan` block |
| Standing orders (durable authority programs) | `/promote` distill → save → schedule; injected into routine dispatches | digest-capped | digest ≤2k/order, 10k total | `docs/standing-orders.md` | dispatch receipts |
| PLM process lifecycle | engine-side; `UNOWN_PLM`, checkpoints (`UNOWN_PLM_MAX_CHECKPOINTS`) | engine DB-backed | resets with engine DB loss (see §10) | `pi-repo/.../plm/states.ts` PROCESS_STATES | engine status |

## 2. Architecture

| Capability | Activation | Trust | Limitations | Evidence | Verification |
|---|---|---|---|---|---|
| 8 read-only planning specialists (bench, unadvertised) | spawned by plan-mode phases; by name via `task` | read-only enforcement | fresh-context only — no session state | `subagent-builtins.ts` (`advertise:false`) | PT-5: DRIFT cuts + GAPS mitigations + P0 fixes applied live |
| Subagent fleet (fresh-context task workers) | `task` tool (`async:true`), `/agents`, `/delegation` | planning admits read-only only; completion guard on write lanes | ≤4 parallel sync; fleet 8 live / 900 s; report cap 16k | `<advertised_subagents>` per turn | fleet journal (append-only); delegation-auditor agent |
| Repository analysis | `unown repomap`, `unown wiki`, `unown blame` | read-only | repomap cache 8.5 MB | `.unown/repomap-cache.json` | CLI receipts |
| Design review bench | `.unown/agents/` project agents (design-reviewer, ux-critic, a11y-auditor, performance-engineer) | spawn at UI checkpoints | consumes metered budget | `.unown/agents/` (6 observed 2026-11-03) | C2 checkpoint: design-reviewer OK-WITH-NOTES, 13 turns |

## 3. Engineering

| Capability | Activation | Trust | Limitations | Evidence | Verification |
|---|---|---|---|---|---|
| Interactive TUI session | `unown` (real pi TUI) | permission modes `default\|acceptEdits\|bypassPermissions`; write-path jail | needs TTY | README; bin/unown | PTY capture lane (25 scenario specs) |
| Headless one-shot + resume chains | `unown -p "<prompt>"` (non-TTY: `< /dev/null`), `-c`/`--resume <id\|name\|path>` | exit contract 0/1/2/3/4 | issue #30 exit-hang class (open, instrumented; 6/6 clean on idle engine 2026-11-01, `UNOWN_PRINT_EXIT_TRACE=1` armed) | ground truth §2; C1 captures | `UNOWN_OK` smoke (3 s, exit 0 — today) |
| Budgeted chunks | `--max-turns N` (cap signal `capped:true`), `--max-tool-repetitions N` (loop guard exit 4) | in-envelope signals | a turn = ONE model call | CI round receipts | envelope fields |
| Agent skills | auto-load on `description` match; `/skill:<name>`; staged skills promote via human `mv` | instruction-set guard protects `.unown/skills/**` | 13 project + 4 starters observed; ≤2 minted/dream, 24 ceiling | `.unown/skills/` (13 verified 2026-11-03) | `<available_skills>` at session start |
| Slash commands (~82 observed) + custom commands | `/cmd` in session; `docs/custom-commands.md` | `/permissions`, `/hooks`, `/mcp` trust-gated | usage.md counts drift (logged L1 lane) | command registry + dir scan | ground truth §8 |
| Recipes (typed, parameterized) | `unown recipes run` / `/recipe` | declared `allowed_tools`; response_schema with 2 corrective retries | — | `docs/recipes.md` | recipe receipts |
| Orchestration (ralph loop, delegation, fleet) | `unown ralph`; `task` `async:true`; `UNOWN_DELEGATION_LEVEL` | fleet journal append-only | fleet caps (above) | `docs/ralph.md`, delegation round | delegation-auditor after heavy sessions |
| Browser automation (32 actions, CDP Chromium) | `browser` tool / `browser` subagent | stealth + captcha lanes; DOM-as-context poison rule | 600 s budget; hints lane from memory | browser autonomy rounds | C3 offline proof (screenshot receipted) |
| Web retrieval | `web_search` / `webfetch` / `fetch_url` | SSRF-hardened, robots-aware | shared cache 60 min TTL; `UNOWN_WEB_SEARCH=0` off | tool descriptions; web-results-store | `docs/web-results-store.md` |
| Migration from other agents | `unown import --from auto\|claude-code\|codex\|gemini\|cursor\|opencode` | never overwrites; idempotent | append/merge semantics | parity round | `--dry-run/--list` |
| Worktrees | `--worktree` / `-w`; `unown worktrees list\|remove` | managed at repo HEAD | untouched tree auto-removed | flow round | worktree receipts |

## 4. Quality

| Capability | Activation | Trust | Limitations | Evidence | Verification |
|---|---|---|---|---|---|
| Unit lanes | `bun test` (per-package), `bun test apps/coda` (root/CI lane) | Lane pairing law: purity lane must run WITHOUT the happy-dom preload | preload masks DOM purity — pair with boundary test | C1 protocol learnings | **coda 51/51 BOTH lanes; landing 2120/0 (2026-11-03)** |
| E2E (Playwright 1.64) | `bunx playwright test` (landing, 15 specs); coda lane = `playwright.coda.config.ts` (C4) | landing lane must stay untouched by coda | SW inspection APIs Chromium-only; WebKit offline+SW broken ≤1.64.1 | `e2e/`, `playwright.config.ts` | CI `E2E + a11y (landing)` job |
| A11y | `@axe-core/playwright` 4.14; tags `wcag2a/2aa/21a/21aa` | zero-violation policy — findings are defects, not rules to disable | scans live DOM (render first) | `e2e/a11y.spec.ts` pattern | same |
| Gates | `check:docs\|changelog\|blog\|benchmarks\|claims`, `audit:landing`, `review:vlm`, `critic:design`, `typecheck`, `lint`, `test:coverage` | every figure receipt-backed; page implies source | lint baseline 142 warnings (vendored files, 0 errors) | `scripts/landing_*.mjs` | **all ok 2026-11-03** (claims 62/62 literals) |
| PTY capture lane | 25 scenario specs + ~30 scripts (`scripts/tui-capture/`) | pane-is-truth contract | capture cost | tui-capture docs | capture receipts |
| Cross-platform verdicts | `node scripts/xplat.mjs local --scenario smoke\|core\|full\|release-verify`; `dispatch --os …` buys real per-OS CI without a push | PAT-driven (never printed) | dispatch spends CI minutes | `docs/xplat-testing.md` | exit 0/1/2/3 |
| In-session verification | `--output-schema` (exit 3), `--mode json` envelope, `unown doctor --json`, `unown models verify`, `unown doctor-instructions` | fail-closed on schema mismatch | — | CI round receipts | doctor: **ready to chat, 18✓/1⚠ (LSP optional) today** |

## 5. Security

| Capability | Activation | Trust | Limitations | Evidence | Verification |
|---|---|---|---|---|---|
| Permission modes + write-path jail | `--permission-mode`; jail = project + /tmp + `--add-dir`; headless `ask` = fail-closed | final say even under bypass | — | trust round | doctor |
| OS sandbox | vendored bubblewrap (fs+net) on Linux; seatbelt macOS; path-jail/WSL2 Windows; `UNOWN_OS_SANDBOX=1` | active in this container (doctor receipt today) | not a VM boundary | `docs/` sandboxing | doctor sandbox line |
| Guardrail hooks | built-in deny-list always on (rm -rf /, fork bombs, mkfs, dd→disk, /etc redirects, chmod -R 777 /); `UNOWN_STRICT_HOOKS=1` adds sudo/curl/wget/nc + git push deny | terminal hook gate | fail-open after built-ins (user hooks) | hooks round | hook receipts |
| Instruction-set guard | automatic: in-session writes to AGENTS.md/CLAUDE.md, `.unown/skills\|agents\|hooks\|permissions\|memory/policy\|project.md` DENIED | propose-a-PR instead | — | security round | `unown doctor-instructions` — **audit clean today** |
| Injection scanner + adversary mode | automatic | — | — | security round | doctor instruction audit |
| Engine auth (M7) | per-boot bearer (`$UNOWN_HOME/engine.token`), loopback bind refused otherwise; host-header + origin validation always on | tokenless network bind cannot exist | — | hardening round | `unown engine status` |
| Secrets discipline | `.env` single source (gitignored, `.env.example` tracked reference); PAT only in the git remote URL | never committed; placeholder-only in tracked files | — | root AGENTS.md | git log (no key blobs) |

## 6. Operations

| Capability | Activation | Trust | Limitations | Evidence | Verification |
|---|---|---|---|---|---|
| Lifecycle scripts | `bun run agent:install\|start\|stop\|link\|bridge\|engine` | installer enforces bun ≥1.4 | engine+bridge mortal across sandbox recycles | scripts/install.ts | **install 7/7 today** (UNOWN_NO_ENGINE_SERVICE=1) |
| Engine daemon + OS service | `unown engine start/install` (systemd user / launchd / Win logon task), auto-start taxonomy: only a refused port spawns | watchdog + graceful drain 10 s | service skipped in CI/container | AGENTS.md service map | engine **UP** v0.0.55 @ f9872c4e today; 9 jobs (7 interval, 2 event) |
| LLM bridge | `:3031` OpenAI-compatible gateway to Agnes upstream | admission lanes: max 3 concurrency, 400 ms spacing, 45 s background yield (metered-tier guards — do not remove) | upstream ~20 RPM free tier | `mini-services/llm-bridge` | **/health ok, upstream 200, 6 models, default agnes-3.0-flash — today** |
| Budget governor + breaker | engine limits (60 calls/h, 200 k tok/h observed today); outbox dead-letter after 5 attempts into `$UNOWN_HOME/notes/dead/` | calls/tokens, not dollars | resets with engine DB | governor.ts | engine status |
| Diagnostics | `unown doctor` (exit 1 only when chat broken; `--json` CI-able), `unown info`, logs under `.run/` | — | — | doctor output | 18✓/1⚠ today |
| Release engineering | 6 per-OS standalone archives + SBOM + attestations via ONE ubuntu runner; version contract tag≡package≡binary | unsigned by decision (documented Gatekeeper/SmartScreen step) | unsigned friction | `scripts/build-artifacts.ts` | `test:artifacts` |
| CI | ubuntu leg every push/PR; macOS+Windows on version-bump or dispatch (spend-gated); CodeQL + Scorecard | — | per-OS spend gating | `.github/workflows/ci.yml` | green runs receipted (fresh-clone round M2 commits) |
| Deployment | landing auto-deploys to Vercel on `main` **in parallel with CI** (honesty exposure — deploy-verify detects, does not prevent); `bun scripts/verify-deploy.mjs` | prevention would be a Vercel project setting | red commit can reach prod | deploy-verify workflow | daily + post-CI verification |
| Routines (scheduled unattended runs) | `unown routines`, REST, webhook events; `UNOWN_AUTOMATION=1` recursion block | default mode read-only | 20 max, 2 concurrent, 30-min timeout, retry ladder | `docs/routines.md` | engine DB |

## 7. Monitoring

| Capability | Activation | Trust | Limitations | Evidence | Verification |
|---|---|---|---|---|---|
| Engine health/lifecycle | `GET /api/health` `{phase: warming\|ready\|draining, pid, version}`; SSE stream | cheap lifecycle probe | — | hardening round | curl receipts (today: ready) |
| TUI dashboard (15 screens) | `unown dashboard` / `/dashboard` in session | consumes engine REST+SSE via engineFetch like CLI clients | — | `dashboard-app.ts` SCREEN_SPECS | dashboard round |
| Usage accounting | `unown usage`; bridge usage log | receipts-backed | — | `docs/usage-tracking.md` | usage log |
| KPIs | engine status: runs/dreams/improvements shipped; breaker state; dead-letter count | — | resets with engine DB | engine status (today: 0/0/0 — fresh DB) | `unown engine status` |
| Fleet/delegation audit | `delegation-auditor` agent; `/api/delegations` | reads fleet journal | — | delegation round | post-session spawn |
| Benchmark curation | `benchmark-curator` agent; landing figures receipt-gated (`check:benchmarks`) | verifies receipts vs RESULTS.md claims | — | benchmarks/ | pre-release spawn |

## 8. Collaboration

| Capability | Activation | Trust | Limitations | Evidence | Verification |
|---|---|---|---|---|---|
| Git preflight law | fetch → ff-only pull → re-read DOX chain; explicit-path staging only; lowercase-prefix commit style | binding (root AGENTS.md) | — | root AGENTS.md | clean history |
| Sessions | dual stores; resume `id\|name\|path`; markdown export with default-on secrets redaction | — | — | sessions round | `unown sessions` |
| Receipts-first protocol | `.unown/receipts/<ticket>.md` written FIRST, appended incrementally (C1 law) | gitignored by convention | local-only (round log carries the durable summary) | C1 learnings | receipt file per ticket |
| DOX hierarchy | AGENTS.md binding contracts; read-before-edit walk; update-after-edit pass; child indexes | no child weakens DOX | — | root AGENTS.md | DOX pass per change |
| Session notes → engine | notes delivered on session events; down engine auto-starts on note delivery | outbox retry + dead-letter | — | AGENTS.md data flow | engine note KPIs |

## 9. Documentation

| Capability | Activation | Trust | Limitations | Evidence | Verification |
|---|---|---|---|---|---|
| User docs tree | `docs/*.md` | `check:docs` gate | counts drift logged (L1 lane) | docs/ | check:docs ok today |
| Generated landing surfaces | changelog/benchmarks/engine/blog data modules generated by `scripts/landing_*.mjs` — never hand-edit | gates one-directional (page implies source) | — | landing truth rules | check:changelog/blog/benchmarks/claims ok today |
| Hand-verified overview | `unown-overview.md` (root) — every count resolves at cited `file:line`; corrections ledger Appendix A | accuracy owed at edit time; version-stamped header | not gate-enforced | its own contract | refresh in same change that moves counts |
| Blog | `content/blog/*.md` one file per URL; authoring template | `check:blog` | — | content/AGENTS.md | 41 posts, 99 tags ok today |
| Media assets | never delete existing images/videos/sprites; TUI captures via `scripts/tui-capture` lane only | regenerable-from-clean-checkout rule | — | landing AGENTS | curate_assets receipts |

## 10. Learning

| Capability | Activation | Trust | Limitations | Evidence | Verification |
|---|---|---|---|---|---|
| 4-tier memory (policy → project → user → local; most-specific-wins; injected every session) | automatic injection; `/learning` | project tier tracked; `## Manual notes` lane durable across re-renders | 110-bullet render cap (footer shows prunes); **engine DB + user tier lost on full sandbox recycle — continuity rides the tracked project tier** | `.unown/memory/project.md` (129 lines, AutoDream-maintained) | render footer; memory-eval receipts |
| AutoDream consolidation | `auto-dream` engine job every 10 min over pending notes (4 entry points incl. subagent notes); Mem0 lexical backend | project dreams ungated | prune class can cut landing-quoted lines (issue #46 family — run `landing_claims.mjs --check` before every memory-churn push) | engine jobs; docs/memory.md | dream KPIs; claims gate green today |
| Skill minting | dreams mint staged skills (`.unown/skills-staged/`); human `mv` promotes | never auto-loaded | ≤2/dream, 24 ceiling | skills docs | promotion receipts (e.g. hostile-page-checkout) |
| Self-improving harness | `blueprint/harness/` (evals tasks.jsonl; mine_failures → propose_fix → validate_fix) + engine `harness-cycle` job | receipts-gated | budgeted | blueprint/harness/README.md | harness runs |
| Regression protection | `regression-on-ship` engine job; PTY regression specs; unit regression suites | — | — | engine jobs | CI green |
| Benchmark programme | `benchmarks/` suites + committed receipts; landing figures receipt-gated | never invent a number | — | benchmarks/AGENTS.md | check:benchmarks |
| Learning validation reports | `docs/learning-system-validation-report.md`, `benchmark-improvement-report.md`, `memory-effectiveness-report.md` | evidence-based | — | docs/ | cited in reports |

## Coverage matrix — the DRIVE track (Coda round), receipted lanes

| SDLC lane | Status | Receipts (2026-11-03) |
|---|---|---|
| Discovery | ✅ | PT-5 specialist-reviewed design doc (87/100, 7 live spawns); round session logs |
| Planning | ✅ | plan-mode V3 default; PT-5 run `benchmarks/plan-mode/results/run-2026-11-02-pt5/` |
| Architecture | ✅ | PT-5 design doc = Coda architecture source of truth (pure-TS domain, IDB adapter, SW at app root) |
| Engineering | ✅ | C1–C3 delivered through A2 (`e55b17e5`, `7dbabde3`, `8bd616b8`): domain 51/51, UI+IDB, PWA offline-proven |
| Quality | ◐ | unit + landing e2e + gates green; **Coda e2e + a11y = C4 (in flight this session)** |
| Security | ✅ | doctor instruction audit clean; hooks/sandbox/jail receipts; security round (2026-11-01) |
| Operations | ✅ | bring-up 7/7 on two cold machines + today's recycle; engine/bridge health; Vercel + deploy-verify |
| Monitoring | ✅ | engine status/KPIs/health phases; usage log; dashboard 15 screens |
| Documentation | ◐ | DOX current through C3; **Coda docs/README/CHANGELOG/landing = C5 (queued)** |
| Collaboration | ✅ | git preflight law; receipts-first protocol; session resume chains |
| Learning | ✅ | AutoDream consolidation live (project.md 129 lines); skills promoted; memory-eval receipts; retention accumulates across rounds |

## Utilization + benchmark hooks

- **Turns-to-done trend** (budgeted chunks per ticket, from the round log): C1 = 10 chunks (+1 operator one-line unblock), C2 = 7 chunks (+operator browser boot check), C3 = 8 chunks (+2 operator interventions). Directionally improving with operator gates front-loaded — keep recording per ticket.
- **Manual intervention rate**: every intervention logged with cause in the round checkpoint (C1: 1; C2: browser-link check; C3: icon script + browser catches).
- **Augmentation backlog** (priority order per the directive — existing mechanism first): L1 doc-count drift sweep (usage/skills/subagents/dashboard screens); L4 issue #30 exit-path instrumentation (shipped `UNOWN_PRINT_EXIT_TRACE=1` + `scripts/issue30_watcher.mjs`); L2/L3 review benches on every app milestone (design-reviewer at C2 OK-WITH-NOTES; delegate `delegation-auditor` after C4's chunk-heavy session).
- **Known lineage limit**: full sandbox recycles reset the engine DB (dreams, sessions, PLM) — learning continuity rides the git-tracked project memory tier + committed receipts + this matrix. Teardown refreshes must re-baseline KPIs honestly (today: 0 runs / 0 dreams on a fresh DB).
