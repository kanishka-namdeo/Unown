# Project Memory

## Known pitfalls
- In Unown, the C4 ten-chunk receipt drift issue is being addressed by moving receipt appends inside the per-chunk task list in the next ticket template, and a Coda usage capture for the landing page is queued for the capture lane.
- In the Unown project, budgeted-chunk resume chains are the only dispatch lane that survives a host reaping agent processes between tool calls; this workflow enforces 8-turn caps, receipt-first incremental appends, and compile-before-stop, whereas the receipt-last pattern failed at the 9.5-minute wall.

## Task playbooks
- Verify domain code purity by grepping for runtime DOM/Node globals, ensuring matches are restricted to documentation recipes and test comments/regexes (accept `grep_rc=0`).

## Environment
- In Unown, dual-incarnation races on a shared main branch are operational reality; the protocol requires claiming every ticket in the round-log ledger before dispatch, fetching before every push, adopting-then-re-gating on collision, and never force-pushing.
- In Unown's apps/coda, tsc-green and bun-test-green do not guarantee browser-link-green; every type-only import requires the `type` keyword, and every UI surface requires a real browser boot check before commit to prevent 'Booting-forever' ship blockers.

## Facts
- Unown's SM-2 scheduler in scheduler.ts had an inverted Wozniak formula; the correct interval computation is EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02)) with q mapped as g-1
- Project 'Unown' is located at /home/z/my-project/Unown.
- In /home/z/my-project/Unown, a successful terminal operation is indicated by the output 'UNOWN_OK'.
- markdown.ts is confirmed to be outside the runtime import closure
- After DOM mutations or page changes, browser snapshot refs become stale; re-snapshot the page before acting on the new state.
- Unown Coda (`apps/coda/`) architecture: self-contained static vanilla-TS PWA, no workspaces, zero root deps, reuses `marked`/`fuse.js`/`@playwright/test`/`@axe-core/playwright` via upward resolution from root node_modules
- Export installPrintStallWatchdog from cli.ts and import createPrintExitTrace, printExitTraceEnabled, and resolvePrintTraceDir from print-exit-trace.ts in Unown's test suite.
- Wire answer_flushed through the answer-watch extension, and wire drain start/done events plus final exit events into cmdPrint in Unown's cli.ts.
- Unown project in /home/z/my-project/Unown has a known editor flaw where write mode body editing is not properly captured; this was identified and fixed during a session
- Fleet journal persists to .unown/fleet/journal.jsonl via appendFleetJournal/readFleetJournal (recordFleetChildSpawn, recordSyncSubagentSpawn, recordFleetChildFinish for finished; sweep outcomes for reaped/abandoned). FleetJournalEntry (pi-repo/packages/self-learning/src/fleet-reaper.ts:137) defines five ops: spawned (lane 'fleet' or 'sync'), worktree, finished, reaped, abandoned. Op discriminants recorded by recordFleetChildFinish (finished) and sweep outcomes (reaped/abandoned).
- The Unown syntax-checker hook cannot parse TypeScript; run an inline Node-style script via `bun` instead and keep the script as a test file for reproducibility (the hook excludes it from its own scan).
- The engine serves routines under /api/automations (REST) in pi-repo/packages/self-learning/src/server.ts handleApi; there is no /api/routines route; CLI alias `unown routines` maps to the automations endpoints.
- pi-repo/packages/self-learning/src/delegation.ts owns renderDelegationCard (line 170), renderDelegationChip, deriveWorthLine, and the delegation ledger; it is imported by tools.ts at lines 78 and 3736 to notify the TUI.
- Save screenshots to specific benchmark directories like benchmarks/browser-autonomy-round/screenshots/ for warm-start scenarios.
- Handle address forms within cross-frame iframes (e.g., stress-frame.html) by locating and filling fields in the correct frame context.
- Recorded S2-1 DELTA from receipts: probes went from 6/6 unreachable to 6/6 reachable and changed; settable coverage increased from 10/89 (11.2%) to 41/120 (34.2%); pi rows unreachable dropped from 32 to 0; BM-4 depth increased by +0.9 Downs, recorded as the honest cost of the Interface menu row.
- Pin the no-phantom-drift invariant with test/settings-defaults-drift.test.ts plus the BM-8 guard on a pristine home: run the test in a subprocess because some settings getters resolve through term.ts's module-scope UNOWN_HOME snapshot and an in-process run can read earlier tests' leftovers.
- Rule of thumb: a declared default is a contract against the real resolver; always pin it in a test or it will drift.
- M2-A print exit trace is wired in the Unown project via `pi-repo/packages/self-learning/src/print-exit-trace.ts` and integrated into `installPrintStallWatchdog`, `cmdPrint`, and `cli.ts`, with tests importing from both `cli.ts` and `print-exit-trace.ts`
- In BrowseBench stress fixtures (benchmarks/browser-autonomy-round/fixtures/stress.html), native confirm() dialogs auto-dismiss by default and cancel the flow with 'Order cancelled at the dialog'; arm 'browser dialog accept text=OK' before clicking the button that opens the confirm, using a one-shot policy that must be re-armed after each use.
- Locate design tokens in `src/app/globals.css` by distinguishing between the `@theme inline` shadcn bridge and the non-inline `@theme` landing-palette block (GBA 5-bit grid).
- Phantom settings drift (8 interface items) occurs when declared default fields are written from the pi selector's row states instead of the vendored settings-manager getters, causing /settings diff to show 8 phantom drift rows on every fresh install; the remedy is to align each declared default with the resolver's value and add provenance comments.
- The `find` tool backend is unavailable in the Unown project; use directory listings instead to enumerate the `src/` tree. Verified via subagent session.
- A probe that sets a setting to its current value produces no detectable drift; construct targets as current plus offset, and load-time validation flags any task whose diskCheck.expect equals the item's declared default as diff-inert (BM-2 hook-depth task is honest about this).
- Cadence domain layer lives at `src/lib/cadence/` mirroring bazaar/sigil sibling conventions: pure domain code, bun:test for tests, localStorage shim in tests, and happy-dom preload configured via bunfig.
- benchmarks/memory-eval/recall-qa: LongMemEval-adapted multi-session QA-recall benchmark [note 1].
- benchmarks/nonllm: Local ONNX models (bge-small/MiniLM, ms-marco) and symbolic lanes [note 1].
- The six landing-page benchmark suites are defined in the TRACKS array at scripts/landing_benchmarks.mjs:79, which writes to src/components/landing/benchmarks-data.ts; the authoritative contract is documented in benchmarks/AGENTS.md under "The landing-page feed".
- benchmarks/nonllm/lib: LexRank, MinHash-LSH, BM25+RRF, memory activation scoring [note 1].
- benchmarks/polyglot: Aider polyglot benchmark with 50-exercise Exercism subset [note 1].
- blueprint/dreams: Auto-dreaming driver consolidating session notes via headless Claude [note 1].
- benchmarks/local-llm/lib: Cross-platform llama-server lifecycle, OpenAI-compatible clients [note 1].
- blueprint/memory: Tiered memory stack observability mirroring CLAUDE.md hierarchy [note 1].
- Frame-hardening headers (Content-Security-Policy frame-ancestors 'self' and X-Frame-Options SAMEORIGIN) were added to the `/encore/:path*` route in `next.config.ts`, matching the pattern already established for sibling routes `/nocturne`, `/cadence`, `/aria`, and others.
- Unown project adds a habit/streak tracker at `/cadence` (Bazaar-mirrored layout: route + API under `src/app/cadence/`, UI in `src/components/cadence/`, pure domain in `src/lib/cadence/`, scoped stylesheet).
- clippad: Note-taking domain module with Notebook, UserDirectory, search, formatting [note 1].
- The Unown subdirectory in /home/z/my-project serves as the terminal outcome, returning 'UNOWN_OK' on successful validation.
- Per-project agent memory in Unown lives at .unown/memory/project.md, with a gitignored local.md for local overrides
- agent-service: Mini-service wrapper (port 3030) booting self-learning layer with REST+SSE API [note 1].
- benchmarks/mpbench: MPBench dataset adapter for poisoning defense measurement [note 1].
- benchmarks/longhorizon: Multi-file refactoring task benchmark using clippad fixture [note 1].
- Bun is at 1.4.3 (October 2026).
- Guard habit-sync effects with a `sessionHabitsRef` reference to prevent unnecessary re-renders or sync conflicts.
- In src/lib/review.ts, parseReviewOutput (lines 455-475) uses static regexes over model output so treated data cannot become code injection, and the git() helper (lines 114-121) calls spawnSync with array args and shell:false; a security review of the /cadence diff (since commit 94d7cb1d) confirmed no new injection surface.
- Unown project's CLI entrypoint is bin/unown, a Bun script that boots pi-repo/packages/self-learning/src/boot.ts to drive the TUI, headless mode (-p), --plan, and subcommands
- pi-repo/packages/agent/scripts: Telemetry schema documentation generator.
- In `src/components/encore/views/loop.tsx` (line 205) and `src/components/encore/views/finale.tsx` (line 89), the `encore-type-caption` class is combined with `text-dim` (and `mr-2` in loop) for styled captions
- blueprint/harness: Self-improving evaluation harness with golden tasks and weakness clustering [note 1].
- zai-upstream: Local HTTP shim exposing sandbox's z-ai-web-dev-sdk for bridge routing [note 1].
- benchmarks/local-llm: llama.cpp + GGUF experiments against production remote model [note 1].
- pi-repo/packages/pi-client: Transport-neutral client over framed CBOR bytes with lease modes.
- llm-bridge: OpenAI-compatible gateway proxying to Dashscope with model allow-list [note 1].
- blueprint/sandbox/scenarios: Integration tests for tiered memory, hooks, AutoDream, self-improvement loop [note 1].
- e2e: Playwright-based dashboard and landing page tests with axe-core accessibility [note 1].
- benchmarks/longhorizon/task/tests: clippad test suite for store, CLI, author, notebook [note 1].
- blueprint/sandbox: Disposable keyless test rig with synthetic HOME, offline operation [note 1].
- blueprint/router: GitHub event dispatcher with headless Claude sessions, tightly controlled tool allowlist [note 1].
- The `/btw <question>` command in the Unown project displays side-question answers in a dismissible overlay without entering the transcript, receipts ledger, or AutoDream note mining, using only the last 12 text-only turns for context; users dismiss the answer by pressing Esc, Enter, or q
- pi-repo/packages/agent/src: Agent loop functions (agentLoop, agentLoopContinue, runAgentLoop).
- In Unown, `Shell.tsx` gates the embed `message` listener on the `embed` flag and routes `onReset` to the new POST sync route
- In benchmarks/validation-round/probe.mjs, add a --summary <label> mode that reads all probes/, orders by capturedAt descending (newest first, do not rely on filesystem order), takes the two most recent, and prints a per-query table with id, previous hit, current hit, and delta (new, +1, or -1)
- pi-repo/packages/pi-protocol: Protocol types and encoding.
- v3-fixture/tests: membench benchmark fixture tests for calc, stats, format, persist, search [note 1].
- A separate, unrelated `dayKeyOf` function exists in `src/lib/sigil/stats.ts` which uses local-timezone ISO-input formatting.
- pi-repo: Pi agent harness monorepo with cross-platform shell entry points.
- pi-repo/packages/agent: Core Agent class with stateful wrapper, tool execution, event streaming.
- benchmarks/quality-axes: Deterministic suite measuring contradiction, staleness, forgetting, interference [note 1].
- Seed rows in the Nocturne domain use `nc_seed_*` constants, while live rows are generated via `mulberry32`-based `nc_<kind>` helper functions to ensure deterministic ID generation.
- The new `src/lib/nocturne/format.ts` module includes a local `CheckoffDate` alias, cadence-verbatim date helpers (`weekdayShort`, `monthShort`, `formatLongDate`, `todayKey`, `dayKeyOf`), and parley-shaped `formatCountdown`/`formatDurationMs` functions (ms <= 0 → "0m", "45m", "2h 14m"). The module is pure with no use of `Date.now()`, DOM, or random functions.
- The `src/lib/nocturne/types.ts` file in the worktree contains the full data model from `benchmarks/nocturne-round/plan.md` §1, defining 17 entity interfaces including NocturneTenant, NocturneUser, NocturneService, NocturneAlert, NocturneIncident, NocturneTimelineEvent, NocturneRunbook, and NocturneNote.
- pi-repo/packages/ai: Unified LLM API with automatic model discovery, provider abstraction.
- benchmarks/longhorizon/reference/tests: Reference implementation tests for clippad [note 1].
- benchmarks/poison-corpus: Adversarial memory poisoning defense evaluation [note 1].
- OB-5 lane: the observability round verified that the in-session learning feed records dreams live.
- In the OB-5 repaint lane, the feed chip must paint itself when a dream advances memory during an idle session; the listener contract repaints on push and is cleared at shutdown
- Nocturne's `escalation.ts` engine uses tiered escalation timers that fire ONLY while unacked/snoozed.
- Nocturne's `sla.ts` engine handles SLA ack/resolve breach detection with a 20% at-risk band that is frozen while snoozed.
- pi-repo/packages/agent/test: E2E integration tests with faux providers, proxy streaming tests.
- The OB-5 PTY capture lane runs the pane-is-truth contract at terminal dimensions 128x36
- pi-repo/packages/ai/scripts: Build-time model catalog fetchers (models.dev, OpenRouter, Vercel, NVIDIA NIM).
- Nocturne test suite has 360 tests that all passed green in the session, followed by a typecheck verification step
- For Unown's .coda-note-del CSS, remove the span role reset styling since the element is now a real button, and update the notes-row focus style to match.
- For label-content-mismatch, ensure aria-label includes the visible text content of the element.
- In Unown, the offline spec's pre-arm dialog pattern must use the one-shot page.on("dialog") handler rather than waitForEvent, matching the createTask fix applied in the offline spec
- The one-shot page.on("dialog") handler for confirm() dialogs is the required pre-arm pattern in BrowseBench fixtures; each use must be re-armed because the handler is one-shot
- benchmarks/selfimprove: Repeat-task efficiency experiments measuring memory impact [note 1].
- Offline spec for Unown includes an apostrophe assertion that must be updated as part of the note title class rename fix
- Intl.Segmenter constructor accepts granularity option: 'grapheme' (default), 'word', or 'sentence'. Use this to control text segmentation type. This is a reference fact extracted from MDN docs; always verify against current docs in new sessions as APIs may evolve.
- All three Nocturne domain layer files (`types.ts`, `ids.ts`, `clock.ts`) under `src/lib/nocturne/` follow parley conventions and satisfy the task specification in the plan document.
- In Unown, page.on("dialog") is preferred over waitForEvent for handling native confirm() dialogs because it is a one-shot handler that fires immediately upon dialog appearance
- In src/app/nocturne/api/_state.ts:loginSession, allocate the session ID using the nextId helper to ensure unique, deterministic session identifiers per the project's ID conventions.
- Existing test at pi-repo/packages/self-learning/test/memory.test.ts:131 asserts no .tmp leftovers after a single write (passes against old naming). Note: Does not cover back-to-back same-target writes; add that case if .tmp collision behavior changes in newer generations.
- In Unown's offline spec, update the apostrophe assertion and note title class selector to use `.coda-note-open` instead of `.coda-note-title`
- Unown's CSS class for the note title/heading element was renamed from `.coda-note-title` to `.coda-note-open`
- The Unown project's plan-mode V3 loop was closed on 2026-11-02 by merging the retrospective into benchmarks/plan-mode/results/run-2026-11-02-pt5/pt-5-plan.md and delivering it to the self-learning engine.
- In Unown, receipts must be mirrored outside the repository immediately when written because working clones and the unown home directory can be lost mid-round; the round log's checkpoint entries serve as the durable surface of record.
- The Unown project uses a landing honesty rule where PWA installability and offline-load metrics are recorded as explicit nulls ('not-measured') in benchmarks/validation-round/probe.mjs until a receipted run is successfully landed, preventing false positives.
- The Unown project added a blog post with slug '2026-11-03-the-coda-round' titled 'Coda: the round where unown shipped its first user product', tagged with 'pwa', 'local-first', 'agent-driven', and 'testing'; 'testing' was reused from existing tags, while the other three were invented as no prior PWA/local-first/agent-driven posts existed.
- Documentation updates should reflect accurate counts: e.g., 47 unown commands, 12 split commands, 20 session tools, and 15 screens (including the full 15-screen name list).
- In subagents.md, remove duplicate `browser` rows and ensure the project-agents count is consistent with the actual agent registrations.
- When updating documentation counts (e.g., in docs/usage.md), verify against actual source code (e.g., `registerCommand` calls, splitview.ts) rather than relying on stated totals, as discrepancies often exist between claimed and actual count
- The Unown project implemented a 'draft-and-operator-land' workflow for AGENTS.md surfaces because the instruction-set write gate is final; agent sessions are expected to propose instruction-surface edits as pull requests for operator review.
- In Unown, when a new band causes a metric (e.g., viewport count) to exceed a ceiling, the sanctioned move per landing AGENTS.md is to amend the ceiling, but only after first attempting to compress the band copy further.
- After implementing a new benchmark lane, register it in both `benchmarks/AGENTS.md` and the master index to maintain documentation consistency.
- When timing Playwright benchmark lanes, ensure offline-mode wall-clock measurements start at `page.reload()` and do not include the online boot phase, while online-mode measurements start at `page.goto()`.

## Manual notes

- bin: Cross-platform CLI launcher (Unix shebang, Windows cmd/ps1) [note 1]. (Restored by hand 2026-11-02 during the Coda app round — third occurrence of the dream-render-prunes-landing-quoted-lines class, issue #46: the 110-cap render pruned it while the C2 session ran. The landing's loop.tsx memory preview quotes this line; the claims gate reddens without it. Moved to this durable lane.)
- Failed cycles auto-recover — do NOT restart engine to fix them. (Restored by hand 2026-11-01 during the browser autonomy round after a dream render pruned it at the 110-memory cap; the landing page's loop.tsx memory preview quotes this line, so the claims gate reddens when it disappears. The Manual notes lane survives every re-render — this is its durable home.)
- Stealth verification suite on bot.sannysoft.com: all 10 checks (webdriver, userAgent, platform, userAgentData, timezone, locale, screen, viewport, plugins, window.chrome) pass; 0 FAIL rows in Intoli tests. (Restored by hand 2026-11-01 — second occurrence of the dream-render-prunes-landing-quoted-lines class, issue #46; moved here to the durable lane.)
- Parley password hashing: scrypt N=16384 r=8 p=1 (src/lib/parley/password.ts). Restored by hand 2026-10-29 after AutoDream reconciles twice erased the fact (upstream 79->66 render, then the F1/F2 bcrypt poison round). Never let a memory answer overwrite this without reading the source.

<!-- unown: rendered 110/113 memories via Mem0 (backend: lexical) · 3 oldest pruned at render (cap 110; hard-won rules immune) at 2026-11-04T08:06:51.746Z -->
