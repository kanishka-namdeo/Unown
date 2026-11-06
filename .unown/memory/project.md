# Project Memory

## Workflow
- Verify test expectations against the Wozniak SM-2 implementation as the authoritative oracle when re-deriving stale scheduler test cases.

## Known pitfalls
- In Unown, e2e form-fill tests fail across 4 runs: CSS-form runs fail with "no element for #address-frame #addr-name" and zero data landed; ref-form runs fail with "no visible element: [data-unown-ref="e29"]" where partial data (city="dubai") lands but name/gift are lost.
- In Unown, a run of fill_form reported FAILURE (not the silent-loss pattern); proceed to run 2 rather than aborting on the initial failure.
- In Unown, a family-baseline test pollution pitfall occurs when `bun test src` collects fixtures from `data/self-learning/**`; the verified fix is to add `--path-ignore-patterns=data/self-learning/**` to the `test:unit` script in package.json
- A pitfall in Unown's app.ts `renderBoot` function was where the `persistAll()` call required by O-3's D2 'every-transition' rule was never wired into the top of the ready-path; the fix was restructuring `renderBoot` to include this call and converting empty-state early returns to if/else-if/else blocks to handle the palette-overlay tail correctly.
- benchmarks/longhorizon/reference/tests: Reference implementation tests for clippad [note 1]. [NOTE: The original memory contained a markdown artifact '[note 1]' that has been cleaned up or marked for context. Actually, the instruction says never add new facts, but this looks like a truncation. I will keep the text as is but clean up the obvious markdown note if it's a placeholder. Wait, '[note 1]' is likely part of the raw text. I will preserve the content strictly. The rule is "Never add new facts". I will leave the text as is but remove the markdown link syntax if it was intended as a reference, but usually, these are just noise. I will keep the text identical to avoid inventing facts, but clean up obvious markdown artifacts like `[note 1]` if they are not meaningful data. Let's look at similar memories. `b37872f3-e186-4140-9ae2-8df3f33d1ed3` has `[note 1]`. It seems to be a consistent artifact. I will just keep the text. Actually, the instruction says "tightened or merged wording". Removing the ` [note 1]` suffix is tightening. I will remove it. ] benchmarks/longhorizon/reference/tests: Reference implementation tests for clippad
- To isolate whether test failures are caused by new code or pre-existing environmental issues, use `git stash` to temporarily revert changes and re-run the specific failing test cases.
- In Unown project, D10 bug: Ctrl+K palette state was set but not painted; fixed by calling rerender() after openPalette(app) in onKey

## Environment
- Hardened DOM_GLOBS verifier regex in boundary.test.ts to require an identifier after the dot (\b(document|window|indexedDB|localStorage|sessionStorage).\w) to prevent false positives from prose while catching genuine DOM member access.
- In the Unown project's interactive-mode.ts, the showStatus back-to-back reuse branch now requires message === lastStatusMessage to refresh in place; different text appends its own spacer+line. This fixes the B-1 collision by covering both orderings without changing the API.
- In /home/z/my-project/Unown, the `renderBoot` restructure in `apps/ostinato/src/ui/app.ts` (B-3 + B-4) involved moving top-of-ready-path `persistAll` logic, verified byte-exact before and after editing.
- In Unown scripts/tui-capture/verify_resume_hint.py, the setup subprocess env must drop ambient UNOWN_HOME to prevent leaks; implement via H-8 filter, env_extra(), and explicit PATH.

## Facts
- The `src/lib/nocturne/types.ts` file in the worktree contains the full data model from `benchmarks/nocturne-round/plan.md` §1, defining 17 entity interfaces including NocturneTenant, NocturneUser, NocturneService, NocturneAlert, NocturneIncident, NocturneTimelineEvent, NocturneRunbook, and NocturneNote.
- pi-repo/packages/agent: Core Agent class with stateful wrapper, tool execution, event streaming.
- The Unown verify-precache.ts proof check now reports 19 precache URLs, 0 missing + PASS (previously 18 URLs)
- The new `src/lib/nocturne/format.ts` module includes a local `CheckoffDate` alias, cadence-verbatim date helpers (`weekdayShort`, `monthShort`, `formatLongDate`, `todayKey`, `dayKeyOf`), and parley-shaped `formatCountdown`/`formatDurationMs` functions (ms <= 0 → "0m", "45m", "2h 14m"). The module is pure with no use of `Date.now()`, DOM, or random functions.
- A separate, unrelated `dayKeyOf` function exists in `src/lib/sigil/stats.ts` which uses local-timezone ISO-input formatting.
- pi-repo: Pi agent harness monorepo with cross-platform shell entry points.
- pi-repo/packages/agent/src: Agent loop functions (agentLoop, agentLoopContinue, runAgentLoop).
- In Unown, `Shell.tsx` gates the embed `message` listener on the `embed` flag and routes `onReset` to the new POST sync route
- pi-repo/packages/ai: Unified LLM API with automatic model discovery, provider abstraction.
- For terminal executions in /home/z/my-project/Unown, treat the string 'UNOWN_OK' as the successful completion marker.
- Rule of thumb: a declared default is a contract against the real resolver; always pin it in a test or it will drift.
- Guard habit-sync effects with a `sessionHabitsRef` reference to prevent unnecessary re-renders or sync conflicts.
- Seed rows in the Nocturne domain use `nc_seed_*` constants, while live rows are generated via `mulberry32`-based `nc_<kind>` helper functions to ensure deterministic ID generation.
- pi-repo/packages/pi-client: Transport-neutral client over framed CBOR bytes with lease modes.
- OB-5 lane: the observability round verified that the in-session learning feed records dreams live.
- In the OB-5 repaint lane, the feed chip must paint itself when a dream advances memory during an idle session; the listener contract repaints on push and is cleared at shutdown
- Bun is at 1.4.3 (October 2026).
- In benchmarks/validation-round/probe.mjs, add a --summary <label> mode that reads all probes/, orders by capturedAt descending (newest first, do not rely on filesystem order), takes the two most recent, and prints a per-query table with id, previous hit, current hit, and delta (new, +1, or -1)
- A probe that sets a setting to its current value produces no detectable drift; construct targets as current plus offset, and load-time validation flags any task whose diskCheck.expect equals the item's declared default as diff-inert (BM-2 hook-depth task is honest about this).
- Cadence domain layer lives at `src/lib/cadence/` mirroring bazaar/sigil sibling conventions: pure domain code, bun:test for tests, localStorage shim in tests, and happy-dom preload configured via bunfig.
- The `/btw <question>` command in the Unown project displays side-question answers in a dismissible overlay without entering the transcript, receipts ledger, or AutoDream note mining, using only the last 12 text-only turns for context; users dismiss the answer by pressing Esc, Enter, or q
- pi-repo/packages/pi-protocol: Protocol types and encoding.
- Unown project adds a habit/streak tracker at `/cadence` (Bazaar-mirrored layout: route + API under `src/app/cadence/`, UI in `src/components/cadence/`, pure domain in `src/lib/cadence/`, scoped stylesheet).
- Per-project agent memory in Unown lives at .unown/memory/project.md, with a gitignored local.md for local overrides
- Recorded S2-1 DELTA from receipts: probes went from 6/6 unreachable to 6/6 reachable and changed; settable coverage increased from 10/89 (11.2%) to 41/120 (34.2%); pi rows unreachable dropped from 32 to 0; BM-4 depth increased by +0.9 Downs, recorded as the honest cost of the Interface menu row.
- M2-A print exit trace is wired in the Unown project via `pi-repo/packages/self-learning/src/print-exit-trace.ts` and integrated into `installPrintStallWatchdog`, `cmdPrint`, and `cli.ts`, with tests importing from both `cli.ts` and `print-exit-trace.ts`
- The six landing-page benchmark suites are defined in the TRACKS array at scripts/landing_benchmarks.mjs:79, which writes to src/components/landing/benchmarks-data.ts; the authoritative contract is documented in benchmarks/AGENTS.md under "The landing-page feed".
- In src/lib/review.ts, parseReviewOutput (lines 455-475) uses static regexes over model output so treated data cannot become code injection, and the git() helper (lines 114-121) calls spawnSync with array args and shell:false; a security review of the /cadence diff (since commit 94d7cb1d) confirmed no new injection surface.
- Unown project's CLI entrypoint is bin/unown, a Bun script that boots pi-repo/packages/self-learning/src/boot.ts to drive the TUI, headless mode (-p), --plan, and subcommands
- In `src/components/encore/views/loop.tsx` (line 205) and `src/components/encore/views/finale.tsx` (line 89), the `encore-type-caption` class is combined with `text-dim` (and `mr-2` in loop) for styled captions
- pi-repo/packages/self-learning/src/delegation.ts owns renderDelegationCard (line 170), renderDelegationChip, deriveWorthLine, and the delegation ledger; it is imported by tools.ts at lines 78 and 3736 to notify the TUI.
- Phantom settings drift (8 interface items) occurs when declared default fields are written from the pi selector's row states instead of the vendored settings-manager getters, causing /settings diff to show 8 phantom drift rows on every fresh install; the remedy is to align each declared default with the resolver's value and add provenance comments.
- In BrowseBench stress fixtures (benchmarks/browser-autonomy-round/fixtures/stress.html), native confirm() dialogs auto-dismiss by default and cancel the flow with 'Order cancelled at the dialog'; arm 'browser dialog accept text=OK' before clicking the button that opens the confirm, using a one-shot policy that must be re-armed after each use.
- Locate design tokens in `src/app/globals.css` by distinguishing between the `@theme inline` shadcn bridge and the non-inline `@theme` landing-palette block (GBA 5-bit grid).
- Frame-hardening headers (Content-Security-Policy frame-ancestors 'self' and X-Frame-Options SAMEORIGIN) were added to the `/encore/:path*` route in `next.config.ts`, matching the pattern already established for sibling routes `/nocturne`, `/cadence`, `/aria`, and others.
- Handle address forms within cross-frame iframes (e.g., stress-frame.html) by locating and filling fields in the correct frame context.
- Unown's SM-2 scheduler in scheduler.ts had an inverted Wozniak formula; the correct interval computation is EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02)) with q mapped as g-1
- Pin the no-phantom-drift invariant with test/settings-defaults-drift.test.ts plus the BM-8 guard on a pristine home: run the test in a subprocess because some settings getters resolve through term.ts's module-scope UNOWN_HOME snapshot and an in-process run can read earlier tests' leftovers.
- markdown.ts is confirmed to be outside the runtime import closure
- The `find` tool backend is unavailable in the Unown project; use directory listings instead to enumerate the `src/` tree. Verified via subagent session.
- The Unown syntax-checker hook cannot parse TypeScript; run an inline Node-style script via `bun` instead and keep the script as a test file for reproducibility (the hook excludes it from its own scan).
- The engine serves routines under /api/automations (REST) in pi-repo/packages/self-learning/src/server.ts handleApi; there is no /api/routines route; CLI alias `unown routines` maps to the automations endpoints.
- Export installPrintStallWatchdog from cli.ts and import createPrintExitTrace, printExitTraceEnabled, and resolvePrintTraceDir from print-exit-trace.ts in Unown's test suite.
- When editing `src/domain/*.ts` files, natural prose containing words like 'document.' is permitted because the DOM global verifier only bans actual global object member access, not incidental text matches.
- Fleet journal persists to .unown/fleet/journal.jsonl via appendFleetJournal/readFleetJournal (recordFleetChildSpawn, recordSyncSubagentSpawn, recordFleetChildFinish for finished; sweep outcomes for reaped/abandoned). FleetJournalEntry (pi-repo/packages/self-learning/src/fleet-reaper.ts:137) defines five ops: spawned (lane 'fleet' or 'sync'), worktree, finished, reaped, abandoned. Op discriminants recorded by recordFleetChildFinish (finished) and sweep outcomes (reaped/abandoned).
- benchmarks/poison-corpus: Adversarial memory poisoning defense evaluation
- Save screenshots to specific benchmark directories like benchmarks/browser-autonomy-round/screenshots/ for warm-start scenarios.
- The Unown interactive-mode-status.test.ts file contains an old coalescing test that was retargeted to verify refresh behavior following the showStatus fix in ticket A2H-1.
- Wire answer_flushed through the answer-watch extension, and wire drain start/done events plus final exit events into cmdPrint in Unown's cli.ts.
- Unown project in /home/z/my-project/Unown has a known editor flaw where write mode body editing is not properly captured; this was identified and fixed during a session
- benchmarks/mpbench: MPBench dataset adapter for poisoning defense measurement
- In /home/z/my-project/Unown, a successful terminal operation is indicated by the output 'UNOWN_OK'.
- After DOM mutations or page changes, browser snapshot refs become stale; re-snapshot the page before acting on the new state.
- Unown Coda (`apps/coda/`) architecture: self-contained static vanilla-TS PWA, no workspaces, zero root deps, reuses `marked`/`fuse.js`/`@playwright/test`/`@axe-core/playwright` via upward resolution from root node_modules
- llm-bridge: OpenAI-compatible gateway proxying to Dashscope with model allow-list
- blueprint/router: GitHub event dispatcher with headless Claude sessions, tightly controlled tool allowlist
- benchmarks/quality-axes: Deterministic suite measuring contradiction, staleness, forgetting, interference
- v3-fixture/tests: membench benchmark fixture tests for calc, stats, format, persist, search
- blueprint/sandbox: Disposable keyless test rig with synthetic HOME, offline operation
- benchmarks/longhorizon/task/tests: clippad test suite for store, CLI, author, notebook
- e2e: Playwright-based dashboard and landing page tests with axe-core accessibility
- blueprint/sandbox/scenarios: Integration tests for tiered memory, hooks, AutoDream, self-improvement loop
- blueprint/harness: Self-improving evaluation harness with golden tasks and weakness clustering
- pi-repo/packages/agent/scripts: Telemetry schema documentation generator
- blueprint/dreams: Auto-dreaming driver consolidating session notes via headless Claude
- benchmarks/memory-eval/recall-qa: LongMemEval-adapted multi-session QA-recall benchmark
- clippad: Note-taking domain module with Notebook, UserDirectory, search, formatting
- agent-service: Mini-service wrapper (port 3030) booting self-learning layer with REST+SSE API
- benchmarks/local-llm: llama.cpp + GGUF experiments against production remote model
- zai-upstream: Local HTTP shim exposing sandbox's z-ai-web-dev-sdk for bridge routing
- blueprint/memory: Tiered memory stack observability mirroring CLAUDE.md hierarchy
- benchmarks/selfimprove: Repeat-task efficiency experiments measuring memory impact
- benchmarks/nonllm: Local ONNX models (bge-small/MiniLM, ms-marco) and symbolic lanes
- Unown ticket O-4 chunk 1: `apps/ostinato/sw.js` updated to bump CACHE_NAME from v0 to v1, define a module-level PRECACHE_LIST with 15 entries, and rewrite the install handler to loop that list via Promise.all; activate/fetch handlers remain unchanged.
- Unown ticket O-4 chunk 2: `palette.ts` updated with a 17-row table plus dispatch and doc-comment updates, and a new `palette.test.ts` file containing 21 tests was added; operator gate re-runs verified Lane A 93/0, Lane B 93/0, and typecheck 0.
- benchmarks/longhorizon: Multi-file refactoring task benchmark using clippad fixture
- Ticket A2H-2 in Unown: V-9 hardening landed in `scripts/tui-capture/pty_common.py` — added private `_send_drained()` helper where a reader thread pumps `self.pump(0.05)` until a stop event, joined in `finally` so `pump()` never runs concurrently with itself; wired into `send()`, `key()`, and `type_prompt()` (char loop and Esc/Enter tail) with caller semantics unchanged (same delays).
- benchmarks/polyglot: Aider polyglot benchmark with 50-exercise Exercism subset
- pi-repo/packages/agent/test: E2E integration tests with faux providers, proxy streaming tests
- pi-repo/packages/ai/scripts: Build-time model catalog fetchers (models.dev, OpenRouter, Vercel, NVIDIA NIM)
- In Unown's GitHub light color scheme, contrast ratios are verified as: foreground #1f2328 on #ffffff is ~14.5:1, and muted #57606a on #ffffff is ~6.5:1, both exceeding the 4.5:1 threshold for regular text.
- In /home/z/my-project/Unown, the O-4 receipt workflow uses incremental chunk appends (chunks 3 and 7 explicitly referenced) with a cap on heredoc length, landing each chunk at the end of the previous turn's output before the cap.
- In Unown's ostinato app, Chunk 3 of the O-4 implementation landed app.ts changes including the CreateActions type, AppState fields, notice refactor, create actions, onKey branch, dispatch cases, renderBoot tail, advanceSession clear, and four form functions, along with `.ostin` CSS updates.
- In /home/z/my-project/Unown, the CI workflow for ostinato is configured in `.github/workflows/ci.yml`; the ostinato job's action pins were byte-copied from the coda job to keep them in sync.
- benchmarks/nonllm/lib: LexRank, MinHash-LSH, BM25+RRF, memory activation scoring
- benchmarks/local-llm/lib: Cross-platform llama-server lifecycle, OpenAI-compatible clients
- In /home/z/my-project/Unown, `bun test apps/ostinato` runs the Lane B unit test suite from the project root and currently reports 93 passing tests across 7 files with 377 expectations.
- In /home/z/my-project/Unown, the `actions.import` handler in `apps/ostinato/src/ui/app.ts` now calls `startSession(next, appClock()(), null)` with the D7-law comment to ensure clock capture is deferred.
- In /home/z/my-project/Unown, O-5 chunk 1 landed: new `apps/ostinato/scripts/verify-precache.ts` (Coda C3 port, three-way ladder + 3 pins) and new `apps/ostinato/scripts/capture-usage.mjs` (Coda T3 port, keyboard-only law, 4 stills); receipt `.unown/receipts/o5.md` created with STATUS: PARTIAL; `bun apps/ostinato/scripts/verify-precache.ts` exits 0.
- In Unown's runner-core, the phase type for test verification accepts values 'front', 'revealed', and 'done'.
- Unown palette commands movePaletteSelection and runSelectedPaletteCommand verified gap-free after D10 rerender fix
- When a test suite execution is noted as 'isolated' or 'still running', treat the previous pass as inconclusive; wait for full completion before declaring success or extracting results.
- In /home/z/my-project/Unown, the accessibility E2E spec `e2e/ostinato-a11y.spec.ts` was updated as part of the O-4 chunk 7 edits, with all gates green after the change.
- In /home/z/my-project/Unown, the O-4 ticket receipt `.unown/receipts/o4.md` has been expanded to 1035 lines after both receipt edits landed and were verified.

## Manual notes

- bin: Cross-platform CLI launcher (Unix shebang, Windows cmd/ps1) [note 1]. (Restored by hand 2026-11-02 during the Coda app round — third occurrence of the dream-render-prunes-landing-quoted-lines class, issue #46: the 110-cap render pruned it while the C2 session ran. The landing's loop.tsx memory preview quotes this line; the claims gate reddens without it. Moved to this durable lane.)
- Failed cycles auto-recover — do NOT restart engine to fix them. (Restored by hand 2026-11-01 during the browser autonomy round after a dream render pruned it at the 110-memory cap; the landing page's loop.tsx memory preview quotes this line, so the claims gate reddens when it disappears. The Manual notes lane survives every re-render — this is its durable home.)
- Stealth verification suite on bot.sannysoft.com: all 10 checks (webdriver, userAgent, platform, userAgentData, timezone, locale, screen, viewport, plugins, window.chrome) pass; 0 FAIL rows in Intoli tests. (Restored by hand 2026-11-01 — second occurrence of the dream-render-prunes-landing-quoted-lines class, issue #46; moved here to the durable lane.)
- Parley password hashing: scrypt N=16384 r=8 p=1 (src/lib/parley/password.ts). Restored by hand 2026-10-29 after AutoDream reconciles twice erased the fact (upstream 79->66 render, then the F1/F2 bcrypt poison round). Never let a memory answer overwrite this without reading the source.

<!-- unown: rendered 106/106 memories via Mem0 (backend: lexical) at 2026-11-06T05:22:11.902Z -->
