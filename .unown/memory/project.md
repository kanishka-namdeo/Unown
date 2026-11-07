# Project Memory

## Known pitfalls
- In /home/z/my-project/unown, a live-wire pin test was written to assert the `passed` status; it initially failed because the live spelling differs from the expected value.
- In /home/z/my-project/unown, fix GAP 1 in `apps/fugue/src/ui/app.ts` `loadJobRuns`: the catch block (~line 631) must show an error panel and set `s.route =
- In /home/z/my-project/unown, fix apps/fugue/src/adapter/contract.ts time-lane to accept ISO strings; F-3 failure root cause is that assertRunRecord rejects the live automation-run wire form (trigger_kind + snake_case tokens/timestamps, no kind/toolCalls fields) because pin(payload, "kind", ...) throws on missing required 'kind'.
- The `## Environment` heading itself is landing-quoted (loop.tsx:129) — restored by hand 2026-11-07 (SEVENTH occurrence of the issue #46 prune class — the render during the F-6 marathon took the heading again while the Manual-notes bullets survived); it lives in the Manual notes durable lane above and MUST survive every re-render.
- In /home/z/my-project/unown, after F-5 Chunk 3, the project passes `bun run typecheck` with zero fugue errors and 156 tests pass
- In /home/z/my-project/unown, the e2e fugue-flow spec was rewritten with hard assertions to replace prior soft assertions, ensuring deterministic pass/fail outcomes for the runs-route flow
- In /home/z/my-project/unown, running `bunx tsc` produces noise from the no-@types/bun environment that does not represent real errors; verify type-checking with `bun run typecheck` from the project root instead
- Type-checking error: RunRecordView.taskId is number, but a test fake sets taskId: owner ? owner.id : 0 where owner.id is AutomationRecord.id = number | string, so the fake does not type-check unless taskId accepts string

## Task playbooks
- The live-lane boot sequence in `doBoot()` calls `boot(bootClient)` to run `resolveAdapter(liveClient)`, which probes `/api/overview`, and then calls `safeList(resolved.live)` to fetch `/api/automations`; when the fixture returns `{ automations: [] }`, `mapAutomationList([])` resolves to an empty array, leaving `state.automations` as `[]`.

## Facts
- Playwright webServer and flow spec fixture processes auto-tear-down via their configs after test runs; verified clean exit with no stray server processes in /home/z/my-project/unown.
- In /home/z/my-project/unown, V-15 pin permits modifying `runner/fixture-server.ts` to align canned JSON with both-forms contract despite it being outside ALLOWED_INPUTS
- In /home/z/my-project/unown, e2e smoke spec palette assertion count was updated from 11 to 13 in `e2e/fugue-smoke.spec.ts`
- In /home/z/my-project/unown, live fugue engine is reachable; automation list is empty because the probe cleaned up its routine; all acceptance checks passed.
- In /home/z/my-project/unown, verify contract.ts fix by confirming live engine reachability and green acceptance checks; expect empty automations after probe cleanup.
- Frame-hardening headers (Content-Security-Policy frame-ancestors 'self' and X-Frame-Options SAMEORIGIN) were added to the `/encore/:path*` route in `next.config.ts`, matching the pattern already established for sibling routes `/nocturne`, `/cadence`, `/aria`, and others.
- pi-repo/packages/pi-protocol: Protocol types and encoding.
- Cadence domain layer lives at `src/lib/cadence/` mirroring bazaar/sigil sibling conventions: pure domain code, bun:test for tests, localStorage shim in tests, and happy-dom preload configured via bunfig.
- pi-repo/packages/self-learning/src/delegation.ts owns renderDelegationCard (line 170), renderDelegationChip, deriveWorthLine, and the delegation ledger; it is imported by tools.ts at lines 78 and 3736 to notify the TUI.
- In src/lib/review.ts, parseReviewOutput (lines 455-475) uses static regexes over model output so treated data cannot become code injection, and the git() helper (lines 114-121) calls spawnSync with array args and shell:false; a security review of the /cadence diff (since commit 94d7cb1d) confirmed no new injection surface.
- Rule of thumb: a declared default is a contract against the real resolver; always pin it in a test or it will drift.
- Guard habit-sync effects with a `sessionHabitsRef` reference to prevent unnecessary re-renders or sync conflicts.
- The six landing-page benchmark suites are defined in the TRACKS array at scripts/landing_benchmarks.mjs:79, which writes to src/components/landing/benchmarks-data.ts; the authoritative contract is documented in benchmarks/AGENTS.md under "The landing-page feed".
- Unown project's CLI entrypoint is bin/unown, a Bun script that boots pi-repo/packages/self-learning/src/boot.ts to drive the TUI, headless mode (-p), --plan, and subcommands
- Pin the no-phantom-drift invariant with test/settings-defaults-drift.test.ts plus the BM-8 guard on a pristine home: run the test in a subprocess because some settings getters resolve through term.ts's module-scope UNOWN_HOME snapshot and an in-process run can read earlier tests' leftovers.
- A probe that sets a setting to its current value produces no detectable drift; construct targets as current plus offset, and load-time validation flags any task whose diskCheck.expect equals the item's declared default as diff-inert (BM-2 hook-depth task is honest about this).
- When editing `src/domain/*.ts` files, natural prose containing words like 'document.' is permitted because the DOM global verifier only bans actual global object member access, not incidental text matches.
- Recorded S2-1 DELTA from receipts: probes went from 6/6 unreachable to 6/6 reachable and changed; settable coverage increased from 10/89 (11.2%) to 41/120 (34.2%); pi rows unreachable dropped from 32 to 0; BM-4 depth increased by +0.9 Downs, recorded as the honest cost of the Interface menu row.
- M2-A print exit trace is wired in the Unown project via `pi-repo/packages/self-learning/src/print-exit-trace.ts` and integrated into `installPrintStallWatchdog`, `cmdPrint`, and `cli.ts`, with tests importing from both `cli.ts` and `print-exit-trace.ts`
- Phantom settings drift (8 interface items) occurs when declared default fields are written from the pi selector's row states instead of the vendored settings-manager getters, causing /settings diff to show 8 phantom drift rows on every fresh install; the remedy is to align each declared default with the resolver's value and add provenance comments.
- Export installPrintStallWatchdog from cli.ts and import createPrintExitTrace, printExitTraceEnabled, and resolvePrintTraceDir from print-exit-trace.ts in Unown's test suite.
- markdown.ts is confirmed to be outside the runtime import closure
- The `find` tool backend is unavailable in the Unown project; use directory listings instead to enumerate the `src/` tree. Verified via subagent session.
- After DOM mutations or page changes, browser snapshot refs become stale; re-snapshot the page before acting on the new state.
- The Unown syntax-checker hook cannot parse TypeScript; run an inline Node-style script via `bun` instead and keep the script as a test file for reproducibility (the hook excludes it from its own scan).
- blueprint/sandbox: Disposable keyless test rig with synthetic HOME, offline operation
- benchmarks/longhorizon/task/tests: clippad test suite for store, CLI, author, notebook
- The Unown interactive-mode-status.test.ts file contains an old coalescing test that was retargeted to verify refresh behavior following the showStatus fix in ticket A2H-1.
- Locate design tokens in `src/app/globals.css` by distinguishing between the `@theme inline` shadcn bridge and the non-inline `@theme` landing-palette block (GBA 5-bit grid).
- Save screenshots to specific benchmark directories like benchmarks/browser-autonomy-round/screenshots/ for warm-start scenarios.
- Unown's SM-2 scheduler in scheduler.ts had an inverted Wozniak formula; the correct interval computation is EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02)) with q mapped as g-1
- Unown project in /home/z/my-project/Unown has a known editor flaw where write mode body editing is not properly captured; this was identified and fixed during a session
- v3-fixture/tests: membench benchmark fixture tests for calc, stats, format, persist, search
- blueprint/harness: Self-improving evaluation harness with golden tasks and weakness clustering
- Unown Coda (`apps/coda/`) architecture: self-contained static vanilla-TS PWA, no workspaces, zero root deps, reuses `marked`/`fuse.js`/`@playwright/test`/`@axe-core/playwright` via upward resolution from root node_modules
- Fleet journal persists to .unown/fleet/journal.jsonl via appendFleetJournal/readFleetJournal (recordFleetChildSpawn, recordSyncSubagentSpawn, recordFleetChildFinish for finished; sweep outcomes for reaped/abandoned). FleetJournalEntry (pi-repo/packages/self-learning/src/fleet-reaper.ts:137) defines five ops: spawned (lane 'fleet' or 'sync'), worktree, finished, reaped, abandoned. Op discriminants recorded by recordFleetChildFinish (finished) and sweep outcomes (reaped/abandoned).
- The engine serves routines under /api/automations (REST) in pi-repo/packages/self-learning/src/server.ts handleApi; there is no /api/routines route; CLI alias `unown routines` maps to the automations endpoints.
- benchmarks/poison-corpus: Adversarial memory poisoning defense evaluation
- blueprint/dreams: Auto-dreaming driver consolidating session notes via headless Claude
- benchmarks/memory-eval/recall-qa: LongMemEval-adapted multi-session QA-recall benchmark
- clippad: Note-taking domain module with Notebook, UserDirectory, search, formatting
- llm-bridge: OpenAI-compatible gateway proxying to Dashscope with model allow-list
- blueprint/router: GitHub event dispatcher with headless Claude sessions, tightly controlled tool allowlist
- benchmarks/quality-axes: Deterministic suite measuring contradiction, staleness, forgetting, interference
- pi-repo/packages/agent/scripts: Telemetry schema documentation generator
- agent-service: Mini-service wrapper (port 3030) booting self-learning layer with REST+SSE API
- benchmarks/mpbench: MPBench dataset adapter for poisoning defense measurement
- Unown ticket O-4 chunk 2: `palette.ts` updated with a 17-row table plus dispatch and doc-comment updates, and a new `palette.test.ts` file containing 21 tests was added; operator gate re-runs verified Lane A 93/0, Lane B 93/0, and typecheck 0.
- benchmarks/longhorizon: Multi-file refactoring task benchmark using clippad fixture
- benchmarks/nonllm: Local ONNX models (bge-small/MiniLM, ms-marco) and symbolic lanes
- blueprint/memory: Tiered memory stack observability mirroring CLAUDE.md hierarchy
- Wire answer_flushed through the answer-watch extension, and wire drain start/done events plus final exit events into cmdPrint in Unown's cli.ts.
- benchmarks/selfimprove: Repeat-task efficiency experiments measuring memory impact
- e2e: Playwright-based dashboard and landing page tests with axe-core accessibility
- blueprint/sandbox/scenarios: Integration tests for tiered memory, hooks, AutoDream, self-improvement loop
- Place Playwright e2e test files (specs and configs) at the repository root, not in app-specific directories, following the 'Coda precedent' architecture.
- benchmarks/local-llm: llama.cpp + GGUF experiments against production remote model
- pi-repo/packages/agent/test: E2E integration tests with faux providers, proxy streaming tests
- pi-repo/packages/ai/scripts: Build-time model catalog fetchers (models.dev, OpenRouter, Vercel, NVIDIA NIM)
- zai-upstream: Local HTTP shim exposing sandbox's z-ai-web-dev-sdk for bridge routing
- In Unown's GitHub light color scheme, contrast ratios are verified as: foreground #1f2328 on #ffffff is ~14.5:1, and muted #57606a on #ffffff is ~6.5:1, both exceeding the 4.5:1 threshold for regular text.
- In /home/z/my-project/Unown, the O-4 receipt workflow uses incremental chunk appends (chunks 3 and 7 explicitly referenced) with a cap on heredoc length, landing each chunk at the end of the previous turn's output before the cap.
- Unown ticket O-4 chunk 1: `apps/ostinato/sw.js` updated to bump CACHE_NAME from v0 to v1, define a module-level PRECACHE_LIST with 15 entries, and rewrite the install handler to loop that list via Promise.all; activate/fetch handlers remain unchanged.
- benchmarks/nonllm/lib: LexRank, MinHash-LSH, BM25+RRF, memory activation scoring
- In Unown's ostinato app, Chunk 3 of the O-4 implementation landed app.ts changes including the CreateActions type, AppState fields, notice refactor, create actions, onKey branch, dispatch cases, renderBoot tail, advanceSession clear, and four form functions, along with `.ostin` CSS updates.
- benchmarks/local-llm/lib: Cross-platform llama-server lifecycle, OpenAI-compatible clients
- Unown palette commands movePaletteSelection and runSelectedPaletteCommand verified gap-free after D10 rerender fix
- In /home/z/my-project/Unown, `bun test apps/ostinato` runs the Lane B unit test suite from the project root and currently reports 93 passing tests across 7 files with 377 expectations.
- Ticket A2H-2 in Unown: V-9 hardening landed in `scripts/tui-capture/pty_common.py` — added private `_send_drained()` helper where a reader thread pumps `self.pump(0.05)` until a stop event, joined in `finally` so `pump()` never runs concurrently with itself; wired into `send()`, `key()`, and `type_prompt()` (char loop and Esc/Enter tail) with caller semantics unchanged (same delays).
- The e2e/chaconne-a11y.spec.ts file was extended to 7 test blocks / 10 tests, covering the dialog contract editor (role=dialog, aria-modal, attach-before-focus, Tab trap, Esc + focus restoration) at L243
- C-9 a11y completion brief is defined in docs/rondo-round-session.md:474 and the PRD hardening map in docs/chaconne-prd.md:124-135; no separate .unown/receipts brief file exists for C-9
- In /home/z/my-project/Unown, the CI workflow for ostinato is configured in `.github/workflows/ci.yml`; the ostinato job's action pins were byte-copied from the coda job to keep them in sync.
- In Unown's runner-core, the phase type for test verification accepts values 'front', 'revealed', and 'done'.
- Split-write cap in /home/z/my-project/Unown can truncate files mid-write, leaving unterminated strings that hook flags; complete cut-off files by extending them with follow-up edits
- When adding a new CI gate job to a GitHub Actions workflow, place it after existing dependent jobs to maintain logical build order.
- benchmarks/polyglot: Aider polyglot benchmark with 50-exercise Exercism subset
- C-7 changes in /home/z/my-project/unown involved `apps/chaconne/public/offline.html`, `apps/chaconne/scripts/{verify-precache.ts, verify-precache.test.ts, capture-usage.mjs}`, `e2e/chaconne-resilience.spec.ts`, and `apps/chaconne/runner/store.ts`.
- The C-7 handoff in /home/z/my-project/unown verified that the `corrupt-quarantine` label was applied in `apps/chaconne/runner/store.ts` and its test `store-c7.test.ts`.
- In /home/z/my-project/unown, F-5 Chunk 3 wires the three new modules into the shell using DOM-free dispatch and render helpers, adding run-row click wiring and selectedJobState to the palette context
- C-9 closing chunk continued from session 01a1b0f6, which was cut by the operator's 2400s dispatch timeout; files landed by the prior session were verified by the new chunk
- In /home/z/my-project/unown, F-5 Chunk 2 implements three DOM-free view modules and co-located tests in apps/fugue, built strictly per NOTES-F5.md sections 3 and 4
- In /home/z/my-project/unown, F-5 module run-history.ts contains a `groupRuns` function that groups data by `taskId` and sorts newest-first
- In /home/z/my-project/unown, F-5 work includes authoring NOTES-F5.md with exactly 6 sections: 1. THE CONSUMED SURFACE, 2. THE SHELL TODAY, 3. THE WIRING PLAN, 4. THE TEST PLAN, 5. THE EDGE PINS, and 6. OPEN QUESTIONS
- In /home/z/my-project/unown, F-5 verification confirms that authoring NOTES-F5.md is the only file change in apps/fugue/, verified via `git status --porcelain -- apps/fugue/`
- In /home/z/my-project/unown, F-5 Chunk 4 is scoped to only two files: creating the new `e2e/fugue-flow.spec.ts` test and appending to `apps/fugue/NOTES-F5.md`; no `src` files are modified in this chunk
- In /home/z/my-project/unown, `git status` confirms that source modifications in `app.ts`, `app.test.ts`, and `fugue.css` belong to the frozen chunks 2–3, while chunk 4's verified file changes are limited to the new e2e spec and the NOTES-F5.md append
- In /home/z/my-project/unown, Chunk 2 landed in `apps/fugue/src/ui/app.ts` by adding the seam read: the `FugueEngineConfig` interface, a `Window.__FUGUE_ENGINE__` declaration, and an `engineConfig()` helper, integrating with both client constructions including `appAdapter` at line ~552 and the `bootClient` path.
- In /home/z/my-project/unown, F-5 chunk 4 scope gap: the runs-route e2e flow was unreachable because main() exposed no tab control and no job-row selection hook; per layer ruling, route tab bar and selection hooks are F-5 shell completion, not F-6
- In /home/z/my-project/unown, F-5 chunk 5 completion: main() doBoot() modified to re-fetch and re-render so the run-now to synthetic-run e2e flow works; app.ts render() updated; all 156 tests pass
- In /home/z/my-project/unown, the V-18 ruling is explicitly limited to writes in app.ts, app.test.ts, the three adapter files, and NOTES-F6.md; the run-history taskId domain type is deeply wired to number, so widening it is out of scope and not the blocker
- In /home/z/my-project/unown, the live e2e spec for the run-history view awaits the presence of the .fugue-run-row element rather than the grouped title, so numeric taskId grouping does not block the spec
- In /home/z/my-project/unown, the real blockers for completing the run-history work are the adapter seam and app.ts, not the taskId type constraint
- In /home/z/my-project/unown, open .fugue-dialog.is-open overlay with fixed inset:0 must have overflow-y:auto in apps/fugue/src/ui/fugue.css or the 10-field form cannot scroll
- In /home/z/my-project/unown, cycle-4 fix verified that compose-create adds a LOCAL shadow job (id 1) and creates the engine automation (auto-xxx) but does not automatically refresh the engine row, so the UI must trigger a manual refresh to display the new automation.
- In /home/z/my-project/unown, the e2e spec `e2e/fugue-live.spec.ts` uses lane-pinned selectors for test stability.
- When fixing UI re-render defects triggered by user actions (like 'run-now'), ensure the fix addresses the specific re-render cause rather than just the symptom, validating that state updates do not trigger unintended full re-renders.
- In /home/z/my-project/unown, the id-model mismatch between the engine seam and selection surface is resolved by keeping `RunRecordView.taskId` as `number` per the operator's scope ruling, curing the mismatch without widening the domain type.
- Handle address forms within cross-frame iframes by locating and filling fields in the correct frame context; for stress fixtures, arm 'browser dialog accept text=OK' before clicking buttons that open native confirm() dialogs to prevent flow cancellation by default auto-dismiss behavior, re-arming the one-shot policy after each use. (Stale legacy clause regarding ConfirmBench removed.)
- In /home/z/my-project/unown, `e2e/fugue-live.spec.ts` `createRoutineViaUi` expects the final engine row with a 30,000ms timeout because the live engine's create plus full boot chain involves 4 sequential round-trips that exceed the default wait.
- In /home/z/my-project/unown, pinAutomation per-item list assert uses state-only pin which drifts against the engine-native lifecycle wire shape, requiring lane-pinned selectors for contract tests
- In /home/z/my-project/Unown, terminal operations use DISPATCH_OK for dispatch-related sessions and UNOWN_OK for general completion markers, both indicating successful execution status.

## Manual notes

- Failed cycles auto-recover — do NOT restart engine to fix them. (Restored by hand 2026-11-07 during the 28th/29th-lineage F-5 reconciliation — SIXTH occurrence of the dream-render-prunes-landing-quoted-lines class, issue #46: this render pruned the restored durable lane AGAIN. The landing's loop.tsx memory preview quotes this line; the claims gate reddens without it. This Manual notes lane is its durable home.)
- Stealth verification suite on bot.sannysoft.com: all 10 checks (webdriver, userAgent, platform, userAgentData, timezone, locale, screen, viewport, plugins, window.chrome) pass; 0 FAIL rows in Intoli tests. (Restored by hand 2026-11-07 — sixth occurrence, issue #46 class; durable home here.)
- bin: Cross-platform CLI launcher (Unix shebang, Windows cmd/ps1) [note 1]. (Restored by hand 2026-11-07 — sixth occurrence, issue #46 class; the landing's loop.tsx quotes this line; durable home here.)
- Remove unused variable declarations (e.g., `void seedStore;`) to keep builds clean. (Restored by hand 2026-11-07 — sixth occurrence, issue #46 class.)
- For high-reliability frontend or browser-based CI steps, use Chromium with headless flags to ensure consistent rendering and testing in containerized environments. (Restored by hand 2026-11-07 — sixth occurrence, issue #46 class; the pair bullet of the Environment heading below.)
- NINTH occurrence receipt (2026-11-07, the thirty-first lineage): the 30th's F-7-item-1 session renders took the ENTIRE durable lane again (the second whole-lane loss today — the fifth-occurrence class escalated) plus the Workflow and Environment headings; all restored from the af126efb known-good. The H-22 memory-guard (the pre-commit diff flag, operator toolchain) lands with this restore.
- TENTH occurrence receipt (2026-11-07, the thirty-first lineage): the F-7 chunk-3 A2 session VIOLATED the brief's FORBIDDEN_INPUTS — it booted the real serve.mjs on :4017 and PUT-tested against the REAL project.md (20k-char bodies), then 'restored' the section to a single placeholder bullet, destroying the durable lane. CAUGHT BY THE H-22 MEMORY-GUARD at the operator's commit boundary (11 protected lines flagged, its first live catch — the diff preserved in the ring buffer). V-28 filed; the FUGUE_NOTES_ROOT isolation cure rides chunk 3b. The bullets above are the af126efb-lineage known-good.

## Environment

- The `## Environment` heading is landing-quoted (loop.tsx:129) — restored by hand after the SIXTH/SEVENTH/EIGHTH/NINTH/TENTH occurrences of the issue #46 class; it lives in the Manual notes durable lane above and MUST survive every re-render.

<!-- unown: rendered 110/111 memories via Mem0 (backend: lexical) · 1 oldest pruned at render (cap 110; hard-won rules immune) at 2026-11-07T14:56:33.911Z -->
