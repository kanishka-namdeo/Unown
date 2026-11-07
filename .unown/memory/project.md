# Project Memory

## Workflow
- Run routes render a run group structure where job rows may carry `data-state` attributes for engine lane pause/active states, but these attributes are unreliable after refresh re-renders and should not be used as primary test observables
- The project is located at /home/z/my-project/Unown.
- Use DevTools 'Event Listeners' and 'Event Log' to trace duplicate or conflicting click events in complex DOM hierarchies
- Verify event target order in overlapping UI elements by logging `event.target` and `event.composedPath()` to distinguish between direct hits and bubbled events

## Known pitfalls
- In Unown e2e tests, the CSS selector `[data-field="prompt"]` incorrectly matches both the prompt textarea and the error `<p>` element because both carry the `data-field` attribute; scope the selector to the textarea (e.g., `textarea[data-field="prompt"]`) to target the field only. The same issue applies to validation selectors in the fugue app, so tests must scope the selector specifically to the textarea to target the correct element.
- In /home/z/my-project/Unown, the `overlayEl` bug occurred because it was not initialized to the palette element before `openAppPalette` ran, preventing the overlay wiring and causing the palette to fail to mount.
- In /home/z/my-project/Unown, the `onSubmit` callback in `openComposeSurface` and `openEditSurface` fires after `close()` has already executed `opts.onClose()`, so calling `onClose` again inside `onSubmit` must be avoided to prevent double-decrementing `dialogOpenCount` and triggering double-renders.

## Facts
- In /home/z/my-project/Unown, the e2e smoke test verification confirmed that the Playwright `webServer` handles port 4015 and global setup/teardown manages port 4130, with no stray listeners remaining after the test suite runs. This supersedes the legacy observation that port 4130 was occupied by a real service causing a collision during the F-3 session; current practice is that port 4130 is managed by global setup/teardown and does not collide. Ensure the proxy is set up to keep the engine up so that `renderList` runs with `engineUp: true` and the palette element is present; if the proxy is not set up, the engine is down and the app palette and related DOM elements will not render.
- In Unown e2e tests, the compose dialog click times out when the engine is down because `root()` contains neither `.fugue-header` nor `.fugue-list`, so `runPaletteCommandSurface` calls `openJobEditor(root(), ...)` in a plain 'engine: down' state; the compose dialog does not open and the `onClick` handler never fires. Ensure the proxy is set up to keep the engine up.
- In Unown e2e tests, the `[data-surface="palette"]` element may be missing from the DOM when Ctrl+K keydown fires before the app finishes booting; `openAppPalette()` is not triggered until boot completes. The keydown handler is attached to `document` via `onAppKey`; ensure the proxy is set up to keep the engine up so `renderList` runs with `engineUp: true` and the palette element is present. If the proxy is not set up, the engine is down and `renderList` executes with `engineUp: false`, causing the app palette and related DOM elements to not render.
- When verifying run route UI state, wait for the selected job's status to be displayed as the most deterministic observable, since `data-state` on job rows may not persist across refresh re-renders
- In /home/z/my-project/Unown, the e2e test for the app palette required manual `proxy` setup to keep the engine up; without it, `renderList` runs with `engineUp: false` and the `[data-surface="palette"]` element is missing from the DOM so `openAppPalette()` is never triggered.
- In /home/z/my-project/Unown, `serve.mjs` transpiles on the fly without a persistent server cache, so stale listeners are caused by client-side ordering where list-row clicks on `LI.fugue-row` fire before palette-row clicks resolve, not by a server-side transpile cache.
- Inspect server-side transpile caches separately from on-the-fly transpilation logic to rule out stale code execution
- In /home/z/my-project/Unown, terminal operations use DISPATCH_OK for dispatch-related sessions and UNOWN_OK for general completion markers, both indicating successful execution status.
- Split large file generation tasks (e.g., `app.ts`) into multiple parts to comply with output limits.
- Boundary tests that forbid `fetch`/network globals in specific directories will conflict with browser-side client implementations (e.g., `BrowserRestClient`); ensure test scoping or file organization aligns with architectural intent to avoi
- pi-repo/packages/pi-client: Transport-neutral client over framed CBOR bytes with lease modes.
- pi-repo/packages/agent/src: Agent loop functions (agentLoop, agentLoopContinue, runAgentLoop).
- Revert any code changes that fall outside the explicitly allowed guard region to prevent scope creep
- pi-repo/packages/ai: Unified LLM API with automatic model discovery, provider abstraction.
- The `src/lib/nocturne/types.ts` file in the worktree contains the full data model from `benchmarks/nocturne-round/plan.md` §1, defining 17 entity interfaces including NocturneTenant, NocturneUser, NocturneService, NocturneAlert, NocturneIncident, NocturneTimelineEvent, NocturneRunbook, and NocturneNote.
- In Unown, `Shell.tsx` gates the embed `message` listener on the `embed` flag and routes `onReset` to the new POST sync route
- OB-5 lane: the observability round verified that the in-session learning feed records dreams live.
- Per-project agent memory in Unown lives at .unown/memory/project.md, with a gitignored local.md for local overrides
- pi-repo/packages/agent: Core Agent class with stateful wrapper, tool execution, event streaming.
- The Unown verify-precache.ts proof check now reports 19 precache URLs, 0 missing + PASS (previously 18 URLs)
- In benchmarks/validation-round/probe.mjs, add a --summary <label> mode that reads all probes/, orders by capturedAt descending (newest first, do not rely on filesystem order), takes the two most recent, and prints a per-query table with id, previous hit, current hit, and delta (new, +1, or -1)
- In the OB-5 repaint lane, the feed chip must paint itself when a dream advances memory during an idle session; the listener contract repaints on push and is cleared at shutdown
- Bun is at 1.4.3 (October 2026).
- The new `src/lib/nocturne/format.ts` module includes a local `CheckoffDate` alias, cadence-verbatim date helpers (`weekdayShort`, `monthShort`, `formatLongDate`, `todayKey`, `dayKeyOf`), and parley-shaped `formatCountdown`/`formatDurationMs` functions (ms <= 0 → "0m", "45m", "2h 14m"). The module is pure with no use of `Date.now()`, DOM, or random functions.
- Seed rows in the Nocturne domain use `nc_seed_*` constants, while live rows are generated via `mulberry32`-based `nc_<kind>` helper functions to ensure deterministic ID generation.
- Guard habit-sync effects with a `sessionHabitsRef` reference to prevent unnecessary re-renders or sync conflicts.
- In `src/components/encore/views/loop.tsx` (line 205) and `src/components/encore/views/finale.tsx` (line 89), the `encore-type-caption` class is combined with `text-dim` (and `mr-2` in loop) for styled captions
- In BrowseBench stress fixtures (benchmarks/browser-autonomy-round/fixtures/stress.html), native confirm() dialogs auto-dismiss by default and cancel the flow with 'Order cancelled at the dialog'; arm 'browser dialog accept text=OK' before clicking the button that opens the confirm, using a one-shot policy that must be re-armed after each use.
- Frame-hardening headers (Content-Security-Policy frame-ancestors 'self' and X-Frame-Options SAMEORIGIN) were added to the `/encore/:path*` route in `next.config.ts`, matching the pattern already established for sibling routes `/nocturne`, `/cadence`, `/aria`, and others.
- Rule of thumb: a declared default is a contract against the real resolver; always pin it in a test or it will drift.
- pi-repo/packages/pi-protocol: Protocol types and encoding.
- Unown project adds a habit/streak tracker at `/cadence` (Bazaar-mirrored layout: route + API under `src/app/cadence/`, UI in `src/components/cadence/`, pure domain in `src/lib/cadence/`, scoped stylesheet).
- A probe that sets a setting to its current value produces no detectable drift; construct targets as current plus offset, and load-time validation flags any task whose diskCheck.expect equals the item's declared default as diff-inert (BM-2 hook-depth task is honest about this).
- Cadence domain layer lives at `src/lib/cadence/` mirroring bazaar/sigil sibling conventions: pure domain code, bun:test for tests, localStorage shim in tests, and happy-dom preload configured via bunfig.
- The `/btw <question>` command in the Unown project displays side-question answers in a dismissible overlay without entering the transcript, receipts ledger, or AutoDream note mining, using only the last 12 text-only turns for context; users dismiss the answer by pressing Esc, Enter, or q
- In src/lib/review.ts, parseReviewOutput (lines 455-475) uses static regexes over model output so treated data cannot become code injection, and the git() helper (lines 114-121) calls spawnSync with array args and shell:false; a security review of the /cadence diff (since commit 94d7cb1d) confirmed no new injection surface.
- Unown project's CLI entrypoint is bin/unown, a Bun script that boots pi-repo/packages/self-learning/src/boot.ts to drive the TUI, headless mode (-p), --plan, and subcommands
- Pin the no-phantom-drift invariant with test/settings-defaults-drift.test.ts plus the BM-8 guard on a pristine home: run the test in a subprocess because some settings getters resolve through term.ts's module-scope UNOWN_HOME snapshot and an in-process run can read earlier tests' leftovers.
- Recorded S2-1 DELTA from receipts: probes went from 6/6 unreachable to 6/6 reachable and changed; settable coverage increased from 10/89 (11.2%) to 41/120 (34.2%); pi rows unreachable dropped from 32 to 0; BM-4 depth increased by +0.9 Downs, recorded as the honest cost of the Interface menu row.
- M2-A print exit trace is wired in the Unown project via `pi-repo/packages/self-learning/src/print-exit-trace.ts` and integrated into `installPrintStallWatchdog`, `cmdPrint`, and `cli.ts`, with tests importing from both `cli.ts` and `print-exit-trace.ts`
- The six landing-page benchmark suites are defined in the TRACKS array at scripts/landing_benchmarks.mjs:79, which writes to src/components/landing/benchmarks-data.ts; the authoritative contract is documented in benchmarks/AGENTS.md under "The landing-page feed".
- Export installPrintStallWatchdog from cli.ts and import createPrintExitTrace, printExitTraceEnabled, and resolvePrintTraceDir from print-exit-trace.ts in Unown's test suite.
- When editing `src/domain/*.ts` files, natural prose containing words like 'document.' is permitted because the DOM global verifier only bans actual global object member access, not incidental text matches.
- The engine serves routines under /api/automations (REST) in pi-repo/packages/self-learning/src/server.ts handleApi; there is no /api/routines route; CLI alias `unown routines` maps to the automations endpoints.
- pi-repo/packages/self-learning/src/delegation.ts owns renderDelegationCard (line 170), renderDelegationChip, deriveWorthLine, and the delegation ledger; it is imported by tools.ts at lines 78 and 3736 to notify the TUI.
- Phantom settings drift (8 interface items) occurs when declared default fields are written from the pi selector's row states instead of the vendored settings-manager getters, causing /settings diff to show 8 phantom drift rows on every fresh install; the remedy is to align each declared default with the resolver's value and add provenance comments.
- The `find` tool backend is unavailable in the Unown project; use directory listings instead to enumerate the `src/` tree. Verified via subagent session.
- After DOM mutations or page changes, browser snapshot refs become stale; re-snapshot the page before acting on the new state.
- The Unown syntax-checker hook cannot parse TypeScript; run an inline Node-style script via `bun` instead and keep the script as a test file for reproducibility (the hook excludes it from its own scan).
- Unown's SM-2 scheduler in scheduler.ts had an inverted Wozniak formula; the correct interval computation is EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02)) with q mapped as g-1
- markdown.ts is confirmed to be outside the runtime import closure
- Locate design tokens in `src/app/globals.css` by distinguishing between the `@theme inline` shadcn bridge and the non-inline `@theme` landing-palette block (GBA 5-bit grid).
- Save screenshots to specific benchmark directories like benchmarks/browser-autonomy-round/screenshots/ for warm-start scenarios.
- Handle address forms within cross-frame iframes (e.g., stress-frame.html) by locating and filling fields in the correct frame context.
- benchmarks/longhorizon/task/tests: clippad test suite for store, CLI, author, notebook
- The Unown interactive-mode-status.test.ts file contains an old coalescing test that was retargeted to verify refresh behavior following the showStatus fix in ticket A2H-1.
- Fleet journal persists to .unown/fleet/journal.jsonl via appendFleetJournal/readFleetJournal (recordFleetChildSpawn, recordSyncSubagentSpawn, recordFleetChildFinish for finished; sweep outcomes for reaped/abandoned). FleetJournalEntry (pi-repo/packages/self-learning/src/fleet-reaper.ts:137) defines five ops: spawned (lane 'fleet' or 'sync'), worktree, finished, reaped, abandoned. Op discriminants recorded by recordFleetChildFinish (finished) and sweep outcomes (reaped/abandoned).
- benchmarks/poison-corpus: Adversarial memory poisoning defense evaluation
- blueprint/sandbox: Disposable keyless test rig with synthetic HOME, offline operation
- blueprint/harness: Self-improving evaluation harness with golden tasks and weakness clustering
- Unown Coda (`apps/coda/`) architecture: self-contained static vanilla-TS PWA, no workspaces, zero root deps, reuses `marked`/`fuse.js`/`@playwright/test`/`@axe-core/playwright` via upward resolution from root node_modules
- blueprint/router: GitHub event dispatcher with headless Claude sessions, tightly controlled tool allowlist
- benchmarks/quality-axes: Deterministic suite measuring contradiction, staleness, forgetting, interference
- v3-fixture/tests: membench benchmark fixture tests for calc, stats, format, persist, search
- benchmarks/memory-eval/recall-qa: LongMemEval-adapted multi-session QA-recall benchmark
- clippad: Note-taking domain module with Notebook, UserDirectory, search, formatting
- llm-bridge: OpenAI-compatible gateway proxying to Dashscope with model allow-list
- blueprint/memory: Tiered memory stack observability mirroring CLAUDE.md hierarchy
- Wire answer_flushed through the answer-watch extension, and wire drain start/done events plus final exit events into cmdPrint in Unown's cli.ts.
- blueprint/dreams: Auto-dreaming driver consolidating session notes via headless Claude
- benchmarks/longhorizon: Multi-file refactoring task benchmark using clippad fixture
- benchmarks/nonllm: Local ONNX models (bge-small/MiniLM, ms-marco) and symbolic lanes
- agent-service: Mini-service wrapper (port 3030) booting self-learning layer with REST+SSE API
- benchmarks/mpbench: MPBench dataset adapter for poisoning defense measurement
- pi-repo/packages/ai/scripts: Build-time model catalog fetchers (models.dev, OpenRouter, Vercel, NVIDIA NIM)
- pi-repo/packages/agent/scripts: Telemetry schema documentation generator
- zai-upstream: Local HTTP shim exposing sandbox's z-ai-web-dev-sdk for bridge routing
- pi-repo/packages/agent/test: E2E integration tests with faux providers, proxy streaming tests
- blueprint/sandbox/scenarios: Integration tests for tiered memory, hooks, AutoDream, self-improvement loop
- Place Playwright e2e test files (specs and configs) at the repository root, not in app-specific directories, following the 'Coda precedent' architecture.
- benchmarks/local-llm: llama.cpp + GGUF experiments against production remote model
- benchmarks/selfimprove: Repeat-task efficiency experiments measuring memory impact
- In /home/z/my-project/Unown, the O-4 receipt workflow uses incremental chunk appends (chunks 3 and 7 explicitly referenced) with a cap on heredoc length, landing each chunk at the end of the previous turn's output before the cap.
- Unown ticket O-4 chunk 1: `apps/ostinato/sw.js` updated to bump CACHE_NAME from v0 to v1, define a module-level PRECACHE_LIST with 15 entries, and rewrite the install handler to loop that list via Promise.all; activate/fetch handlers remain unchanged.
- In Unown's GitHub light color scheme, contrast ratios are verified as: foreground #1f2328 on #ffffff is ~14.5:1, and muted #57606a on #ffffff is ~6.5:1, both exceeding the 4.5:1 threshold for regular text.
- In Unown's ostinato app, Chunk 3 of the O-4 implementation landed app.ts changes including the CreateActions type, AppState fields, notice refactor, create actions, onKey branch, dispatch cases, renderBoot tail, advanceSession clear, and four form functions, along with `.ostin` CSS updates.
- In /home/z/my-project/Unown, the CI workflow for ostinato is configured in `.github/workflows/ci.yml`; the ostinato job's action pins were byte-copied from the coda job to keep them in sync.
- benchmarks/nonllm/lib: LexRank, MinHash-LSH, BM25+RRF, memory activation scoring
- The e2e/chaconne-a11y.spec.ts file was extended to 7 test blocks / 10 tests, covering the dialog contract editor (role=dialog, aria-modal, attach-before-focus, Tab trap, Esc + focus restoration) at L243
- C-9 a11y completion brief is defined in docs/rondo-round-session.md:474 and the PRD hardening map in docs/chaconne-prd.md:124-135; no separate .unown/receipts brief file exists for C-9
- In /home/z/my-project/Unown, `bun test apps/ostinato` runs the Lane B unit test suite from the project root and currently reports 93 passing tests across 7 files with 377 expectations.
- Ticket A2H-2 in Unown: V-9 hardening landed in `scripts/tui-capture/pty_common.py` — added private `_send_drained()` helper where a reader thread pumps `self.pump(0.05)` until a stop event, joined in `finally` so `pump()` never runs concurrently with itself; wired into `send()`, `key()`, and `type_prompt()` (char loop and Esc/Enter tail) with caller semantics unchanged (same delays).
- Unown palette commands movePaletteSelection and runSelectedPaletteCommand verified gap-free after D10 rerender fix
- benchmarks/local-llm/lib: Cross-platform llama-server lifecycle, OpenAI-compatible clients
- benchmarks/polyglot: Aider polyglot benchmark with 50-exercise Exercism subset
- In Unown's runner-core, the phase type for test verification accepts values 'front', 'revealed', and 'done'.
- C-7 changes in /home/z/my-project/unown involved `apps/chaconne/public/offline.html`, `apps/chaconne/scripts/{verify-precache.ts, verify-precache.test.ts, capture-usage.mjs}`, `e2e/chaconne-resilience.spec.ts`, and `apps/chaconne/runner/store.ts`.
- The C-7 handoff in /home/z/my-project/unown verified that the `corrupt-quarantine` label was applied in `apps/chaconne/runner/store.ts` and its test `store-c7.test.ts`.
- When adding a new CI gate job to a GitHub Actions workflow, place it after existing dependent jobs to maintain logical build order.
- In /home/z/my-project/Unown, the fugue.v1 storage grammar defines Job, RunRecordView, and EngineSt entities, and the plan at `.unown/plans/plan.md` scored 98/100.
- In /home/z/my-project/Unown, `apps/fugue/PLAN.md` is maintained with a header block (status APPROVED F-0, score 98/100 dated 2026-11-07, links to `docs/fugue-prd.md` and `.unown/plans/plan.md`) and a full module tree covering `src/domain/{types,invariants,ids,schedule,io,storage,model}.ts` and `src/adapter/{engine-adapter,fake-engine-adapter,...}`.
- In /home/z/my-project/Unown, the `apps/fugue` architecture mirrors Chaconne's PageAdapter ruling: house-pattern layout with `src/domain`, `src/ui`, and `src/adapter` seam (including FakeEngineAdapter), plus a `runner/` HTTP edge with a fixture server.
- Timezone wall-time calculation in Unown: to convert an instant to local wall time, use instant + offset (where negative offsets like EST are represented as -5h), not instant - offset

## Manual notes

- Failed cycles auto-recover — do NOT restart engine to fix them. (Restored by hand 2026-11-07 during the 28th/29th-lineage F-5 reconciliation — SIXTH occurrence of the dream-render-prunes-landing-quoted-lines class, issue #46: this render pruned the restored durable lane AGAIN. The landing's loop.tsx memory preview quotes this line; the claims gate reddens without it. This Manual notes lane is its durable home.)
- Stealth verification suite on bot.sannysoft.com: all 10 checks (webdriver, userAgent, platform, userAgentData, timezone, locale, screen, viewport, plugins, window.chrome) pass; 0 FAIL rows in Intoli tests. (Restored by hand 2026-11-07 — sixth occurrence, issue #46 class; durable home here.)
- bin: Cross-platform CLI launcher (Unix shebang, Windows cmd/ps1) [note 1]. (Restored by hand 2026-11-07 — sixth occurrence, issue #46 class; the landing's loop.tsx quotes this line; durable home here.)
- Remove unused variable declarations (e.g., `void seedStore;`) to keep builds clean. (Restored by hand 2026-11-07 — sixth occurrence, issue #46 class.)
- For high-reliability frontend or browser-based CI steps, use Chromium with headless flags to ensure consistent rendering and testing in containerized environments. (Restored by hand 2026-11-07 — sixth occurrence, issue #46 class; the pair bullet of the Environment heading below.)

## Environment

- The `## Environment` heading itself is landing-quoted (loop.tsx:129) — restored by hand 2026-11-07, sixth occurrence of the issue #46 prune class; it lives in the Manual notes durable lane above and MUST survive every re-render.

<!-- unown: rendered 110/115 memories via Mem0 (backend: lexical) · 5 oldest pruned at render (cap 110; hard-won rules immune) at 2026-11-07T09:15:53.374Z -->
