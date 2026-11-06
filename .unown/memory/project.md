# Project Memory

## Workflow
- Test fixtures are co-located with the chaconne UI codebase.

## Known pitfalls
- Check the current state of scheduler.ts when debugging scheduling logic to ensure recent changes have been properly applied.
- Always verify that test file imports are correctly applied after editing failures, as missed edits can cause downstream test failures.
- In Unown, `ensureAutomationsSchema` must be called as the first statement in `beforeAll` in `pi-repo/packages/self-learning/test/automation-spend.test.ts` before any `DELETE FROM` statements to prevent automation spend test failures.
- In /home/z/my-project/Unown, the `apps/chaconne` test suite has 9 pre-existing failures from other test files that are unrelated to automation-spend.test.ts changes
- `chaconne-flow-cli.spec.ts` pins the B-20 CLI regression, and `chaconne-flow.spec.ts` covers the K-1 flow lane.
- When run-row selectors in the chaconne e2e specs fail to match, verify the exact DOM structure of the run-row elements before adjusting locators; the fix applied in this session targeted run-row selectors in both specs.

## Task playbooks
- The chaconne UI module contains specific sub-components: palette, recipe-editor, run-history, and artifact-viewer.

## Environment
- Remove unused variable declarations (e.g., `void seedStore;`) to keep builds clean.

## Facts
- The e2e/chaconne-a11y.spec.ts file was extended to 7 test blocks / 10 tests, covering the dialog contract editor (role=dialog, aria-modal, attach-before-focus, Tab trap, Esc + focus restoration) at L243
- C-9 a11y completion brief is defined in docs/rondo-round-session.md:474 and the PRD hardening map in docs/chaconne-prd.md:124-135; no separate .unown/receipts brief file exists for C-9
- C-9 closing chunk continued from session 01a1b0f6, which was cut by the operator's 2400s dispatch timeout; files landed by the prior session were verified by the new chunk
- C-7 changes in /home/z/my-project/unown involved `apps/chaconne/public/offline.html`, `apps/chaconne/scripts/{verify-precache.ts, verify-precache.test.ts, capture-usage.mjs}`, `e2e/chaconne-resilience.spec.ts`, and `apps/chaconne/runner/store.ts`.
- The C-7 handoff in /home/z/my-project/unown verified that the `corrupt-quarantine` label was applied in `apps/chaconne/runner/store.ts` and its test `store-c7.test.ts`.
- In Unown's runner-core, the phase type for test verification accepts values 'front', 'revealed', and 'done'.
- Unown palette commands movePaletteSelection and runSelectedPaletteCommand verified gap-free after D10 rerender fix
- benchmarks/local-llm/lib: Cross-platform llama-server lifecycle, OpenAI-compatible clients
- In /home/z/my-project/Unown, `bun test apps/ostinato` runs the Lane B unit test suite from the project root and currently reports 93 passing tests across 7 files with 377 expectations.
- Ticket A2H-2 in Unown: V-9 hardening landed in `scripts/tui-capture/pty_common.py` — added private `_send_drained()` helper where a reader thread pumps `self.pump(0.05)` until a stop event, joined in `finally` so `pump()` never runs concurrently with itself; wired into `send()`, `key()`, and `type_prompt()` (char loop and Esc/Enter tail) with caller semantics unchanged (same delays).
- In Unown's ostinato app, Chunk 3 of the O-4 implementation landed app.ts changes including the CreateActions type, AppState fields, notice refactor, create actions, onKey branch, dispatch cases, renderBoot tail, advanceSession clear, and four form functions, along with `.ostin` CSS updates.
- In /home/z/my-project/Unown, the CI workflow for ostinato is configured in `.github/workflows/ci.yml`; the ostinato job's action pins were byte-copied from the coda job to keep them in sync.
- In Unown's GitHub light color scheme, contrast ratios are verified as: foreground #1f2328 on #ffffff is ~14.5:1, and muted #57606a on #ffffff is ~6.5:1, both exceeding the 4.5:1 threshold for regular text.
- In /home/z/my-project/Unown, the O-4 receipt workflow uses incremental chunk appends (chunks 3 and 7 explicitly referenced) with a cap on heredoc length, landing each chunk at the end of the previous turn's output before the cap.
- Unown ticket O-4 chunk 1: `apps/ostinato/sw.js` updated to bump CACHE_NAME from v0 to v1, define a module-level PRECACHE_LIST with 15 entries, and rewrite the install handler to loop that list via Promise.all; activate/fetch handlers remain unchanged.
- benchmarks/polyglot: Aider polyglot benchmark with 50-exercise Exercism subset
- pi-repo/packages/agent/test: E2E integration tests with faux providers, proxy streaming tests
- pi-repo/packages/ai/scripts: Build-time model catalog fetchers (models.dev, OpenRouter, Vercel, NVIDIA NIM)
- benchmarks/nonllm/lib: LexRank, MinHash-LSH, BM25+RRF, memory activation scoring
- Place Playwright e2e test files (specs and configs) at the repository root, not in app-specific directories, following the 'Coda precedent' architecture.
- benchmarks/local-llm: llama.cpp + GGUF experiments against production remote model
- zai-upstream: Local HTTP shim exposing sandbox's z-ai-web-dev-sdk for bridge routing
- Unown ticket O-4 chunk 2: `palette.ts` updated with a 17-row table plus dispatch and doc-comment updates, and a new `palette.test.ts` file containing 21 tests was added; operator gate re-runs verified Lane A 93/0, Lane B 93/0, and typecheck 0.
- benchmarks/longhorizon: Multi-file refactoring task benchmark using clippad fixture
- benchmarks/nonllm: Local ONNX models (bge-small/MiniLM, ms-marco) and symbolic lanes
- blueprint/memory: Tiered memory stack observability mirroring CLAUDE.md hierarchy
- benchmarks/selfimprove: Repeat-task efficiency experiments measuring memory impact
- e2e: Playwright-based dashboard and landing page tests with axe-core accessibility
- blueprint/sandbox/scenarios: Integration tests for tiered memory, hooks, AutoDream, self-improvement loop
- blueprint/harness: Self-improving evaluation harness with golden tasks and weakness clustering
- pi-repo/packages/agent/scripts: Telemetry schema documentation generator
- agent-service: Mini-service wrapper (port 3030) booting self-learning layer with REST+SSE API
- benchmarks/mpbench: MPBench dataset adapter for poisoning defense measurement
- blueprint/dreams: Auto-dreaming driver consolidating session notes via headless Claude
- benchmarks/memory-eval/recall-qa: LongMemEval-adapted multi-session QA-recall benchmark
- clippad: Note-taking domain module with Notebook, UserDirectory, search, formatting
- llm-bridge: OpenAI-compatible gateway proxying to Dashscope with model allow-list
- blueprint/router: GitHub event dispatcher with headless Claude sessions, tightly controlled tool allowlist
- benchmarks/quality-axes: Deterministic suite measuring contradiction, staleness, forgetting, interference
- v3-fixture/tests: membench benchmark fixture tests for calc, stats, format, persist, search
- Fleet journal persists to .unown/fleet/journal.jsonl via appendFleetJournal/readFleetJournal (recordFleetChildSpawn, recordSyncSubagentSpawn, recordFleetChildFinish for finished; sweep outcomes for reaped/abandoned). FleetJournalEntry (pi-repo/packages/self-learning/src/fleet-reaper.ts:137) defines five ops: spawned (lane 'fleet' or 'sync'), worktree, finished, reaped, abandoned. Op discriminants recorded by recordFleetChildFinish (finished) and sweep outcomes (reaped/abandoned).
- benchmarks/poison-corpus: Adversarial memory poisoning defense evaluation
- blueprint/sandbox: Disposable keyless test rig with synthetic HOME, offline operation
- benchmarks/longhorizon/task/tests: clippad test suite for store, CLI, author, notebook
- The Unown interactive-mode-status.test.ts file contains an old coalescing test that was retargeted to verify refresh behavior following the showStatus fix in ticket A2H-1.
- Wire answer_flushed through the answer-watch extension, and wire drain start/done events plus final exit events into cmdPrint in Unown's cli.ts.
- Unown project in /home/z/my-project/Unown has a known editor flaw where write mode body editing is not properly captured; this was identified and fixed during a session
- markdown.ts is confirmed to be outside the runtime import closure
- The `find` tool backend is unavailable in the Unown project; use directory listings instead to enumerate the `src/` tree. Verified via subagent session.
- After DOM mutations or page changes, browser snapshot refs become stale; re-snapshot the page before acting on the new state.
- Unown Coda (`apps/coda/`) architecture: self-contained static vanilla-TS PWA, no workspaces, zero root deps, reuses `marked`/`fuse.js`/`@playwright/test`/`@axe-core/playwright` via upward resolution from root node_modules
- Export installPrintStallWatchdog from cli.ts and import createPrintExitTrace, printExitTraceEnabled, and resolvePrintTraceDir from print-exit-trace.ts in Unown's test suite.
- When editing `src/domain/*.ts` files, natural prose containing words like 'document.' is permitted because the DOM global verifier only bans actual global object member access, not incidental text matches.
- Locate design tokens in `src/app/globals.css` by distinguishing between the `@theme inline` shadcn bridge and the non-inline `@theme` landing-palette block (GBA 5-bit grid).
- Save screenshots to specific benchmark directories like benchmarks/browser-autonomy-round/screenshots/ for warm-start scenarios.
- Handle address forms within cross-frame iframes (e.g., stress-frame.html) by locating and filling fields in the correct frame context.
- Unown's SM-2 scheduler in scheduler.ts had an inverted Wozniak formula; the correct interval computation is EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02)) with q mapped as g-1
- Pin the no-phantom-drift invariant with test/settings-defaults-drift.test.ts plus the BM-8 guard on a pristine home: run the test in a subprocess because some settings getters resolve through term.ts's module-scope UNOWN_HOME snapshot and an in-process run can read earlier tests' leftovers.
- The Unown syntax-checker hook cannot parse TypeScript; run an inline Node-style script via `bun` instead and keep the script as a test file for reproducibility (the hook excludes it from its own scan).
- The engine serves routines under /api/automations (REST) in pi-repo/packages/self-learning/src/server.ts handleApi; there is no /api/routines route; CLI alias `unown routines` maps to the automations endpoints.
- pi-repo/packages/self-learning/src/delegation.ts owns renderDelegationCard (line 170), renderDelegationChip, deriveWorthLine, and the delegation ledger; it is imported by tools.ts at lines 78 and 3736 to notify the TUI.
- Phantom settings drift (8 interface items) occurs when declared default fields are written from the pi selector's row states instead of the vendored settings-manager getters, causing /settings diff to show 8 phantom drift rows on every fresh install; the remedy is to align each declared default with the resolver's value and add provenance comments.
- In BrowseBench stress fixtures (benchmarks/browser-autonomy-round/fixtures/stress.html), native confirm() dialogs auto-dismiss by default and cancel the flow with 'Order cancelled at the dialog'; arm 'browser dialog accept text=OK' before clicking the button that opens the confirm, using a one-shot policy that must be re-armed after each use.
- Frame-hardening headers (Content-Security-Policy frame-ancestors 'self' and X-Frame-Options SAMEORIGIN) were added to the `/encore/:path*` route in `next.config.ts`, matching the pattern already established for sibling routes `/nocturne`, `/cadence`, `/aria`, and others.
- Recorded S2-1 DELTA from receipts: probes went from 6/6 unreachable to 6/6 reachable and changed; settable coverage increased from 10/89 (11.2%) to 41/120 (34.2%); pi rows unreachable dropped from 32 to 0; BM-4 depth increased by +0.9 Downs, recorded as the honest cost of the Interface menu row.
- M2-A print exit trace is wired in the Unown project via `pi-repo/packages/self-learning/src/print-exit-trace.ts` and integrated into `installPrintStallWatchdog`, `cmdPrint`, and `cli.ts`, with tests importing from both `cli.ts` and `print-exit-trace.ts`
- The six landing-page benchmark suites are defined in the TRACKS array at scripts/landing_benchmarks.mjs:79, which writes to src/components/landing/benchmarks-data.ts; the authoritative contract is documented in benchmarks/AGENTS.md under "The landing-page feed".
- In src/lib/review.ts, parseReviewOutput (lines 455-475) uses static regexes over model output so treated data cannot become code injection, and the git() helper (lines 114-121) calls spawnSync with array args and shell:false; a security review of the /cadence diff (since commit 94d7cb1d) confirmed no new injection surface.
- Unown project's CLI entrypoint is bin/unown, a Bun script that boots pi-repo/packages/self-learning/src/boot.ts to drive the TUI, headless mode (-p), --plan, and subcommands
- In benchmarks/validation-round/probe.mjs, add a --summary <label> mode that reads all probes/, orders by capturedAt descending (newest first, do not rely on filesystem order), takes the two most recent, and prints a per-query table with id, previous hit, current hit, and delta (new, +1, or -1)
- A probe that sets a setting to its current value produces no detectable drift; construct targets as current plus offset, and load-time validation flags any task whose diskCheck.expect equals the item's declared default as diff-inert (BM-2 hook-depth task is honest about this).
- Cadence domain layer lives at `src/lib/cadence/` mirroring bazaar/sigil sibling conventions: pure domain code, bun:test for tests, localStorage shim in tests, and happy-dom preload configured via bunfig.
- The `/btw <question>` command in the Unown project displays side-question answers in a dismissible overlay without entering the transcript, receipts ledger, or AutoDream note mining, using only the last 12 text-only turns for context; users dismiss the answer by pressing Esc, Enter, or q
- pi-repo/packages/pi-protocol: Protocol types and encoding.
- Unown project adds a habit/streak tracker at `/cadence` (Bazaar-mirrored layout: route + API under `src/app/cadence/`, UI in `src/components/cadence/`, pure domain in `src/lib/cadence/`, scoped stylesheet).
- OB-5 lane: the observability round verified that the in-session learning feed records dreams live.
- Per-project agent memory in Unown lives at .unown/memory/project.md, with a gitignored local.md for local overrides
- Rule of thumb: a declared default is a contract against the real resolver; always pin it in a test or it will drift.
- Guard habit-sync effects with a `sessionHabitsRef` reference to prevent unnecessary re-renders or sync conflicts.
- In `src/components/encore/views/loop.tsx` (line 205) and `src/components/encore/views/finale.tsx` (line 89), the `encore-type-caption` class is combined with `text-dim` (and `mr-2` in loop) for styled captions
- The new `src/lib/nocturne/format.ts` module includes a local `CheckoffDate` alias, cadence-verbatim date helpers (`weekdayShort`, `monthShort`, `formatLongDate`, `todayKey`, `dayKeyOf`), and parley-shaped `formatCountdown`/`formatDurationMs` functions (ms <= 0 → "0m", "45m", "2h 14m"). The module is pure with no use of `Date.now()`, DOM, or random functions.
- Seed rows in the Nocturne domain use `nc_seed_*` constants, while live rows are generated via `mulberry32`-based `nc_<kind>` helper functions to ensure deterministic ID generation.
- pi-repo/packages/pi-client: Transport-neutral client over framed CBOR bytes with lease modes.
- pi-repo/packages/agent/src: Agent loop functions (agentLoop, agentLoopContinue, runAgentLoop).
- In the OB-5 repaint lane, the feed chip must paint itself when a dream advances memory during an idle session; the listener contract repaints on push and is cleared at shutdown
- Bun is at 1.4.3 (October 2026).
- pi-repo/packages/agent: Core Agent class with stateful wrapper, tool execution, event streaming.
- The Unown verify-precache.ts proof check now reports 19 precache URLs, 0 missing + PASS (previously 18 URLs)
- In Unown, `Shell.tsx` gates the embed `message` listener on the `embed` flag and routes `onReset` to the new POST sync route
- pi-repo/packages/ai: Unified LLM API with automatic model discovery, provider abstraction.
- A separate, unrelated `dayKeyOf` function exists in `src/lib/sigil/stats.ts` which uses local-timezone ISO-input formatting.
- pi-repo: Pi agent harness monorepo with cross-platform shell entry points.
- In /home/z/my-project/Unown, the `pi-repo/packages/self-learning/test/automation-spend.test.ts` file was fixed by adding `ensureAutomationsSchema` to its `../src/automations.ts` import and calling it as the first statement in the `before` hook
- In /home/z/my-project/Unown, terminal operations use DISPATCH_OK for dispatch-related sessions and UNOWN_OK for general completion markers, both indicating successful execution status.", "reason": "Merged and clarified redundant and superseded completion marker definitions into a single current, unambiguous rule.
- The `src/lib/nocturne/types.ts` file in the worktree contains the full data model from `benchmarks/nocturne-round/plan.md` §1, defining 17 entity interfaces including NocturneTenant, NocturneUser, NocturneService, NocturneAlert, NocturneIncident, NocturneTimelineEvent, NocturneRunbook, and NocturneNote.
- `chaconne-a11y.spec.ts` validates 4 accessibility checks: axe audit in light mode, axe audit in dark mode, tab order, and Esc-key focus-return.
- In Unown's screenshot panel (`dl`), `dd` locators use `nth(0)` for the artifact name and `nth(1)` for the SHA-256, following the order dt("artifact"), dd(name), dt("sha256"), dd(sha).
- Revert any code changes that fall outside the explicitly allowed guard region to prevent scope creep

## Manual notes

- bin: Cross-platform CLI launcher (Unix shebang, Windows cmd/ps1) [note 1]. (Restored by hand 2026-11-02 during the Coda app round — third occurrence of the dream-render-prunes-landing-quoted-lines class, issue #46: the 110-cap render pruned it while the C2 session ran. The landing's loop.tsx memory preview quotes this line; the claims gate reddens without it. Moved to this durable lane.)
- Failed cycles auto-recover — do NOT restart engine to fix them. (Restored by hand 2026-11-01 during the browser autonomy round after a dream render pruned it at the 110-memory cap; the landing page's loop.tsx memory preview quotes this line, so the claims gate reddens when it disappears. The Manual notes lane survives every re-render — this is its durable home.)
- Stealth verification suite on bot.sannysoft.com: all 10 checks (webdriver, userAgent, platform, userAgentData, timezone, locale, screen, viewport, plugins, window.chrome) pass; 0 FAIL rows in Intoli tests. (Restored by hand 2026-11-01 — second occurrence of the dream-render-prunes-landing-quoted-lines class, issue #46; moved here to the durable lane.)
- Parley password hashing: scrypt N=16384 r=8 p=1 (src/lib/parley/password.ts). Restored by hand 2026-10-29 after AutoDream reconciles twice erased the fact (upstream 79->66 render, then the F1/F2 bcrypt poison round). Never let a memory answer overwrite this without reading the source.

<!-- unown: rendered 110/115 memories via Mem0 (backend: lexical) · 5 oldest pruned at render (cap 110; hard-won rules immune) at 2026-11-06T15:19:04.830Z -->

