# Project Memory

## Known pitfalls
- In /home/z/my-project/work/unown, a service worker pitfall was fixed: `"public/offline.html"` was removed from `PRECACHE_LIST` in `sw.js` because `cache.add` rejects 404s and fails install; the entry was left as a comment to be restored in C-7.
- Chaconne C-4 dedup-heal rule: when an interval schedule's persisted state is stale (`nextDueIso <= lastFiredIso` due to a crash that recorded `lastFiredIso` but not the `nextDue` advance), `decideSchedule`'s dedup branch must heal by setting `nextDueIso = lastFiredIso + periods * everyMs`
- In Unown's runner-core, the `cappedWait` timeout test fails because the manual clock's `schedule` timer only fires when `clock.advance()` is called, but the test calls `clock.advance(1500)` after `executeRecipe` has already started awaiting; `check()` runs synchronously on the first call, sees `rem > 0`, arms the timer, and `await new Promise` never resolves until the timer fires.

## Task playbooks
- In /home/z/my-project/work/unown, C-6 lane requires composing a recipe via keyboard only, running it against a local fixture, and verifying run history and artifact viewer; seeds must include `schema: "chaconne.v1"` and non-empty selectors to pass the schema gate.
- In /home/z/my-project/work/unown, the `scheduleHook` function must be declared as `async` for proper re-entrancy guard semantics; it is invoked fire-and-forget (without `await`) in `executeRecipe`, so the caller does not block on completion
- In /home/z/my-project/work/unown, `scheduleHook` in `apps/chaconne/runner/schedule.ts` must use a re-entrancy guard where `inTick` is set synchronously BEFORE calling `executeRecipe` to prevent concurrent ticks during fire-and-forget execution
- In /home/z/my-project/work/unown, the Chaconne runner includes a recipe editor implemented as a dialog-contract modal.

## Environment
- In /home/z/my-project/work/unown, C-5 Chaconne hardening requires extraction-report payloads to be written through the content-addressed store lane using `store.artifactRef` and `store.saveArtifact` with extension "extract-report.json".
- In Unown, the 'timed DOM' test OOMs due to unbounded check() recursion and real setTimeout calls accumulating on the event loop because the real-clock path polls for an absent element
- In Unown's runner-core, `wallCursor += cap` trips the wall cap before the step-count cap; fix by advancing `wallCursor` by a small constant (or 0) so the step-count cap fires first in tests; `nowMs` injection exists for tests that need a controlled start.

## Facts
- C-6 Chaconne e2e battery lane 1 is complete with all 5 acceptance gates verified, adding new files `playwright.chaconne.config.ts` (79 lines), `e2e/chaconne-flow.spec.ts` (215 lines), and `e2e/chaconne-a11y.spec.ts` (221 lines)
- In /home/z/my-project/work/unown, the `page-adapter.ts` file was updated in C-5 with +58 lines to add assert-text `=~` contains-support and an `extract` `expected` param with `recordExtract` hook and `extractionReport` getter.
- In /home/z/my-project/work/unown, `app.ts` is included in FORBIDDEN_INPUTS and cannot be directly edited; when a new function signature conflicts with a call site in `app.ts` (e.g., C-3 `scheduleHook` signature change), the fix must be made in the test files or other allowed source files instead of modifying `app.ts`
- In /home/z/my-project/work/unown, the C-4 Chaconne recurring-loop handoff is complete with all checks green; the primary new domain file is `apps/chaconne/src/domain/scheduler.ts` (199 lines)
- In /home/z/my-project/work/unown, the extract step in `runStep` and the CLI artifact-writing logic required fixes as part of the C-4 recurring-loop implementation
- In /home/z/my-project/work/unown, Lane A test battery currently reports 111 passing tests (original 109 + 2 new pins); Lane B, root battery, and lint are the next verification gates
- In /home/z/my-project/work/unown, `apps/chaconne/src/ui/app.ts` is in FORBIDDEN_INPUTS and cannot be edited directly; C-3 call sites pass a string, requiring adaptation in allowed test files like `empty-status-runs.test.ts` to handle signature changes
- Chaconne C-4 dedup-heal law: when an interval schedule's persisted state is stale (nextDueIso <= lastFiredIso), `decideSchedule` must HEAL the state by advancing `nextDueIso` to `lastFiredIso + periods*everyMs` to prevent the schedule from permanently bricking
- In /home/z/my-project/work/unown, C-4 Chaconne Recurring Loop is complete with new files `apps/chaconne/src/domain/scheduler.ts` (199 lines), `apps/chaconne/runner/schedule.ts` (298 lines), and their respective test files all passing green
- Align test expectations with implemented anchor-based semantics before considering the task complete.
- In /home/z/my-project/work/unown, the C-3 Chaconne UI Shell handoff is complete and all gates are verified.
- In /home/z/my-project/work/unown, the PWA shell at `apps/chaconne/index.html` (24 lines) loads `src/ui/app.ts` as a module.
- In /home/z/my-project/work/unown, the service worker skeleton at `apps/chaconne/sw.js` (72 lines) defines `CACHE_NAME "chaconne-v0"` and an empty `PRECACHE_LIST`.
- In /home/z/my-project/work/unown, `apps/chaconne/serve.mjs` (75 lines) is a Bun.Transpiler dev/test server used to serve the Chaconne UI.
- In /home/z/my-project/work/unown, the Chaconne runner v1 (C-2) is complete and green, with the runner core module located at `apps/chaconne/runner/`
- The `apps/chaconne/runner/page-adapter.ts` file contains a `PageAdapter` seam with 9 operations and a `FakePageAdapter` implementation that is 328 lines long, providing stable per-URL element tables, bounded real-clock capped waits, post-fill verification, and specific `fillCorrupt`/`fillNoop` test classes.
- In /home/z/my-project/work/unown, all 36 runner tests passed, and the next step is to add a real-browser smoke test.
- In /home/z/my-project/work/unown, typecheck and lint must be verified on the runner files.
- Treat the string 'UNOWN_OK' as the successful completion marker for terminal executions in /home/z/my-project/Unown.
- In /home/z/my-project/Unown, O-5 chunk 1 landed: new `apps/ostinato/scripts/verify-precache.ts` and `apps/ostinato/scripts/capture-usage.mjs`; receipt `.unown/receipts/o5.md` created with STATUS: PARTIAL; `bun apps/ostinato/scripts/verify-precache.ts` exits 0.
- Enforce zero-dependency policy in domain core packages by using 7-line package.json manifests that mirror existing conventions (e.g., Ostinato).
- benchmarks/longhorizon/reference/tests: Reference implementation tests for clippad
- The `src/lib/nocturne/types.ts` file in the worktree contains the full data model from `benchmarks/nocturne-round/plan.md` §1, defining 17 entity interfaces including NocturneTenant, NocturneUser, NocturneService, NocturneAlert, NocturneIncident, NocturneTimelineEvent, NocturneRunbook, and NocturneNote.
- pi-repo/packages/agent: Core Agent class with stateful wrapper, tool execution, event streaming.
- The Unown verify-precache.ts proof check now reports 19 precache URLs, 0 missing + PASS (previously 18 URLs)
- A separate, unrelated `dayKeyOf` function exists in `src/lib/sigil/stats.ts` which uses local-timezone ISO-input formatting.
- pi-repo: Pi agent harness monorepo with cross-platform shell entry points.
- pi-repo/packages/agent/src: Agent loop functions (agentLoop, agentLoopContinue, runAgentLoop).
- In Unown, `Shell.tsx` gates the embed `message` listener on the `embed` flag and routes `onReset` to the new POST sync route
- pi-repo/packages/ai: Unified LLM API with automatic model discovery, provider abstraction.
- Seed rows in the Nocturne domain use `nc_seed_*` constants, while live rows are generated via `mulberry32`-based `nc_<kind>` helper functions to ensure deterministic ID generation.
- pi-repo/packages/pi-client: Transport-neutral client over framed CBOR bytes with lease modes.
- OB-5 lane: the observability round verified that the in-session learning feed records dreams live.
- In the OB-5 repaint lane, the feed chip must paint itself when a dream advances memory during an idle session; the listener contract repaints on push and is cleared at shutdown
- Bun is at 1.4.3 (October 2026).
- The new `src/lib/nocturne/format.ts` module includes a local `CheckoffDate` alias, cadence-verbatim date helpers (`weekdayShort`, `monthShort`, `formatLongDate`, `todayKey`, `dayKeyOf`), and parley-shaped `formatCountdown`/`formatDurationMs` functions (ms <= 0 → "0m", "45m", "2h 14m"). The module is pure with no use of `Date.now()`, DOM, or random functions.
- The `/btw <question>` command in the Unown project displays side-question answers in a dismissible overlay without entering the transcript, receipts ledger, or AutoDream note mining, using only the last 12 text-only turns for context; users dismiss the answer by pressing Esc, Enter, or q
- pi-repo/packages/pi-protocol: Protocol types and encoding.
- Unown project adds a habit/streak tracker at `/cadence` (Bazaar-mirrored layout: route + API under `src/app/cadence/`, UI in `src/components/cadence/`, pure domain in `src/lib/cadence/`, scoped stylesheet).
- Per-project agent memory in Unown lives at .unown/memory/project.md, with a gitignored local.md for local overrides
- Rule of thumb: a declared default is a contract against the real resolver; always pin it in a test or it will drift.
- Guard habit-sync effects with a `sessionHabitsRef` reference to prevent unnecessary re-renders or sync conflicts.
- In src/lib/review.ts, parseReviewOutput (lines 455-475) uses static regexes over model output so treated data cannot become code injection, and the git() helper (lines 114-121) calls spawnSync with array args and shell:false; a security review of the /cadence diff (since commit 94d7cb1d) confirmed no new injection surface.
- Unown project's CLI entrypoint is bin/unown, a Bun script that boots pi-repo/packages/self-learning/src/boot.ts to drive the TUI, headless mode (-p), --plan, and subcommands
- In `src/components/encore/views/loop.tsx` (line 205) and `src/components/encore/views/finale.tsx` (line 89), the `encore-type-caption` class is combined with `text-dim` (and `mr-2` in loop) for styled captions
- In benchmarks/validation-round/probe.mjs, add a --summary <label> mode that reads all probes/, orders by capturedAt descending (newest first, do not rely on filesystem order), takes the two most recent, and prints a per-query table with id, previous hit, current hit, and delta (new, +1, or -1)
- A probe that sets a setting to its current value produces no detectable drift; construct targets as current plus offset, and load-time validation flags any task whose diskCheck.expect equals the item's declared default as diff-inert (BM-2 hook-depth task is honest about this).
- Cadence domain layer lives at `src/lib/cadence/` mirroring bazaar/sigil sibling conventions: pure domain code, bun:test for tests, localStorage shim in tests, and happy-dom preload configured via bunfig.
- In BrowseBench stress fixtures (benchmarks/browser-autonomy-round/fixtures/stress.html), native confirm() dialogs auto-dismiss by default and cancel the flow with 'Order cancelled at the dialog'; arm 'browser dialog accept text=OK' before clicking the button that opens the confirm, using a one-shot policy that must be re-armed after each use.
- Locate design tokens in `src/app/globals.css` by distinguishing between the `@theme inline` shadcn bridge and the non-inline `@theme` landing-palette block (GBA 5-bit grid).
- Frame-hardening headers (Content-Security-Policy frame-ancestors 'self' and X-Frame-Options SAMEORIGIN) were added to the `/encore/:path*` route in `next.config.ts`, matching the pattern already established for sibling routes `/nocturne`, `/cadence`, `/aria`, and others.
- Recorded S2-1 DELTA from receipts: probes went from 6/6 unreachable to 6/6 reachable and changed; settable coverage increased from 10/89 (11.2%) to 41/120 (34.2%); pi rows unreachable dropped from 32 to 0; BM-4 depth increased by +0.9 Downs, recorded as the honest cost of the Interface menu row.
- M2-A print exit trace is wired in the Unown project via `pi-repo/packages/self-learning/src/print-exit-trace.ts` and integrated into `installPrintStallWatchdog`, `cmdPrint`, and `cli.ts`, with tests importing from both `cli.ts` and `print-exit-trace.ts`
- The six landing-page benchmark suites are defined in the TRACKS array at scripts/landing_benchmarks.mjs:79, which writes to src/components/landing/benchmarks-data.ts; the authoritative contract is documented in benchmarks/AGENTS.md under "The landing-page feed".
- markdown.ts is confirmed to be outside the runtime import closure
- The Unown syntax-checker hook cannot parse TypeScript; run an inline Node-style script via `bun` instead and keep the script as a test file for reproducibility (the hook excludes it from its own scan).
- The engine serves routines under /api/automations (REST) in pi-repo/packages/self-learning/src/server.ts handleApi; there is no /api/routines route; CLI alias `unown routines` maps to the automations endpoints.
- pi-repo/packages/self-learning/src/delegation.ts owns renderDelegationCard (line 170), renderDelegationChip, deriveWorthLine, and the delegation ledger; it is imported by tools.ts at lines 78 and 3736 to notify the TUI.
- Phantom settings drift (8 interface items) occurs when declared default fields are written from the pi selector's row states instead of the vendored settings-manager getters, causing /settings diff to show 8 phantom drift rows on every fresh install; the remedy is to align each declared default with the resolver's value and add provenance comments.
- Fleet journal persists to .unown/fleet/journal.jsonl via appendFleetJournal/readFleetJournal (recordFleetChildSpawn, recordSyncSubagentSpawn, recordFleetChildFinish for finished; sweep outcomes for reaped/abandoned). FleetJournalEntry (pi-repo/packages/self-learning/src/fleet-reaper.ts:137) defines five ops: spawned (lane 'fleet' or 'sync'), worktree, finished, reaped, abandoned. Op discriminants recorded by recordFleetChildFinish (finished) and sweep outcomes (reaped/abandoned).
- benchmarks/poison-corpus: Adversarial memory poisoning defense evaluation
- Save screenshots to specific benchmark directories like benchmarks/browser-autonomy-round/screenshots/ for warm-start scenarios.
- Handle address forms within cross-frame iframes (e.g., stress-frame.html) by locating and filling fields in the correct frame context.
- Unown's SM-2 scheduler in scheduler.ts had an inverted Wozniak formula; the correct interval computation is EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02)) with q mapped as g-1
- Pin the no-phantom-drift invariant with test/settings-defaults-drift.test.ts plus the BM-8 guard on a pristine home: run the test in a subprocess because some settings getters resolve through term.ts's module-scope UNOWN_HOME snapshot and an in-process run can read earlier tests' leftovers.
- After DOM mutations or page changes, browser snapshot refs become stale; re-snapshot the page before acting on the new state.
- Unown Coda (`apps/coda/`) architecture: self-contained static vanilla-TS PWA, no workspaces, zero root deps, reuses `marked`/`fuse.js`/`@playwright/test`/`@axe-core/playwright` via upward resolution from root node_modules
- Export installPrintStallWatchdog from cli.ts and import createPrintExitTrace, printExitTraceEnabled, and resolvePrintTraceDir from print-exit-trace.ts in Unown's test suite.
- When editing `src/domain/*.ts` files, natural prose containing words like 'document.' is permitted because the DOM global verifier only bans actual global object member access, not incidental text matches.
- benchmarks/longhorizon/task/tests: clippad test suite for store, CLI, author, notebook
- The Unown interactive-mode-status.test.ts file contains an old coalescing test that was retargeted to verify refresh behavior following the showStatus fix in ticket A2H-1.
- Wire answer_flushed through the answer-watch extension, and wire drain start/done events plus final exit events into cmdPrint in Unown's cli.ts.
- Unown project in /home/z/my-project/Unown has a known editor flaw where write mode body editing is not properly captured; this was identified and fixed during a session
- benchmarks/mpbench: MPBench dataset adapter for poisoning defense measurement
- clippad: Note-taking domain module with Notebook, UserDirectory, search, formatting
- llm-bridge: OpenAI-compatible gateway proxying to Dashscope with model allow-list
- blueprint/router: GitHub event dispatcher with headless Claude sessions, tightly controlled tool allowlist
- benchmarks/quality-axes: Deterministic suite measuring contradiction, staleness, forgetting, interference
- v3-fixture/tests: membench benchmark fixture tests for calc, stats, format, persist, search
- blueprint/sandbox: Disposable keyless test rig with synthetic HOME, offline operation
- e2e: Playwright-based dashboard and landing page tests with axe-core accessibility
- blueprint/sandbox/scenarios: Integration tests for tiered memory, hooks, AutoDream, self-improvement loop
- blueprint/harness: Self-improving evaluation harness with golden tasks and weakness clustering
- pi-repo/packages/agent/scripts: Telemetry schema documentation generator
- blueprint/dreams: Auto-dreaming driver consolidating session notes via headless Claude
- benchmarks/memory-eval/recall-qa: LongMemEval-adapted multi-session QA-recall benchmark
- benchmarks/local-llm: llama.cpp + GGUF experiments against production remote model
- zai-upstream: Local HTTP shim exposing sandbox's z-ai-web-dev-sdk for bridge routing
- blueprint/memory: Tiered memory stack observability mirroring CLAUDE.md hierarchy
- benchmarks/selfimprove: Repeat-task efficiency experiments measuring memory impact
- Unown ticket O-4 chunk 2: `palette.ts` updated with a 17-row table plus dispatch and doc-comment updates, and a new `palette.test.ts` file containing 21 tests was added; operator gate re-runs verified Lane A 93/0, Lane B 93/0, and typecheck 0.
- benchmarks/longhorizon: Multi-file refactoring task benchmark using clippad fixture
- agent-service: Mini-service wrapper (port 3030) booting self-learning layer with REST+SSE API
- pi-repo/packages/ai/scripts: Build-time model catalog fetchers (models.dev, OpenRouter, Vercel, NVIDIA NIM)
- benchmarks/nonllm: Local ONNX models (bge-small/MiniLM, ms-marco) and symbolic lanes
- Unown ticket O-4 chunk 1: `apps/ostinato/sw.js` updated to bump CACHE_NAME from v0 to v1, define a module-level PRECACHE_LIST with 15 entries, and rewrite the install handler to loop that list via Promise.all; activate/fetch handlers remain unchanged.
- Place Playwright e2e test files (specs and configs) at the repository root, not in app-specific directories, following the 'Coda precedent' architecture.
- Ticket A2H-2 in Unown: V-9 hardening landed in `scripts/tui-capture/pty_common.py` — added private `_send_drained()` helper where a reader thread pumps `self.pump(0.05)` until a stop event, joined in `finally` so `pump()` never runs concurrently with itself; wired into `send()`, `key()`, and `type_prompt()` (char loop and Esc/Enter tail) with caller semantics unchanged (same delays).
- benchmarks/polyglot: Aider polyglot benchmark with 50-exercise Exercism subset
- pi-repo/packages/agent/test: E2E integration tests with faux providers, proxy streaming tests

## Manual notes

- bin: Cross-platform CLI launcher (Unix shebang, Windows cmd/ps1) [note 1]. (Restored by hand 2026-11-02 during the Coda app round — third occurrence of the dream-render-prunes-landing-quoted-lines class, issue #46: the 110-cap render pruned it while the C2 session ran. The landing's loop.tsx memory preview quotes this line; the claims gate reddens without it. Moved to this durable lane.)
- Failed cycles auto-recover — do NOT restart engine to fix them. (Restored by hand 2026-11-01 during the browser autonomy round after a dream render pruned it at the 110-memory cap; the landing page's loop.tsx memory preview quotes this line, so the claims gate reddens when it disappears. The Manual notes lane survives every re-render — this is its durable home.)
- Stealth verification suite on bot.sannysoft.com: all 10 checks (webdriver, userAgent, platform, userAgentData, timezone, locale, screen, viewport, plugins, window.chrome) pass; 0 FAIL rows in Intoli tests. (Restored by hand 2026-11-01 — second occurrence of the dream-render-prunes-landing-quoted-lines class, issue #46; moved here to the durable lane.)
- Parley password hashing: scrypt N=16384 r=8 p=1 (src/lib/parley/password.ts). Restored by hand 2026-10-29 after AutoDream reconciles twice erased the fact (upstream 79->66 render, then the F1/F2 bcrypt poison round). Never let a memory answer overwrite this without reading the source.

<!-- unown: rendered 110/131 memories via Mem0 (backend: lexical) · 21 oldest pruned at render (cap 110; hard-won rules immune) at 2026-11-06T09:36:31.672Z -->
