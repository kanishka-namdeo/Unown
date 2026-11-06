# Project Memory

## Workflow
- Test fixtures are co-located with the chaconne UI codebase.
- Run `bun test` for `apps/chaconne` from both the subdirectory and the project root to verify count parity between execution contexts

## Known pitfalls
- In Unown, `ensureAutomationsSchema` must be called as the first statement in `beforeAll` in `pi-repo/packages/self-learning/test/automation-spend.test.ts` before any `DELETE FROM` statements to prevent automation spend test failures.
- `chaconne-flow-cli.spec.ts` pins the B-20 CLI regression, and `chaconne-flow.spec.ts` covers the K-1 flow lane.

## Task playbooks
- The chaconne UI module contains specific sub-components: palette, recipe-editor, run-history, and artifact-viewer.

## Environment
- C-10 chunk 1 capture lane in `apps/chaconne/scripts/capture-usage.mjs` boots `serve.mjs` on scratch port 4016 (overridable via `--port` or `CHACONNE_PORT` env) using a fresh 1280x800 @2x Chromium context and executes a keyboard-only flow: empty-state still 01, Ctrl+K still 02, then composes "fixture-flow".
- Remove unused variable declarations (e.g., `void seedStore;`) to keep builds clean.

## Facts
- K-1 gate verification in /home/z/my-project/unown confirmed all 3 matches for the old convention are isolated to comments and provenance text, with zero executable code affected.
- In apps/chaconne/runner, the artifact extension string was changed from "extract-report" to "json" in both store.artifactRef and store.saveArtifact calls to align with V-41 / A2H-13 ruling (a).
- Update tests in apps/chaconne/runner/store.test.ts to replace all occurrences of "extract-report" with "json" to match the new artifact extension convention.
- A development server is typically already running on port 4014 in /home/z/my-project/unown with fixtures reachable; reuse it instead of attempting to start a new instance.
- `chaconne-a11y.spec.ts` validates 4 accessibility checks: axe audit in light mode, axe audit in dark mode, tab order, and Esc-key focus-return.
- pi-repo/packages/agent: Core Agent class with stateful wrapper, tool execution, event streaming.
- pi-repo/packages/ai: Unified LLM API with automatic model discovery, provider abstraction.
- pi-repo: Pi agent harness monorepo with cross-platform shell entry points.
- pi-repo/packages/pi-client: Transport-neutral client over framed CBOR bytes with lease modes.
- pi-repo/packages/agent/src: Agent loop functions (agentLoop, agentLoopContinue, runAgentLoop).
- Unown project adds a habit/streak tracker at `/cadence` (Bazaar-mirrored layout: route + API under `src/app/cadence/`, UI in `src/components/cadence/`, pure domain in `src/lib/cadence/`, scoped stylesheet).
- OB-5 lane: the observability round verified that the in-session learning feed records dreams live.
- Per-project agent memory in Unown lives at .unown/memory/project.md, with a gitignored local.md for local overrides
- Unown project's CLI entrypoint is bin/unown, a Bun script that boots pi-repo/packages/self-learning/src/boot.ts to drive the TUI, headless mode (-p), --plan, and subcommands
- The `/btw <question>` command in the Unown project displays side-question answers in a dismissible overlay without entering the transcript, receipts ledger, or AutoDream note mining, using only the last 12 text-only turns for context; users dismiss the answer by pressing Esc, Enter, or q
- pi-repo/packages/pi-protocol: Protocol types and encoding.
- M2-A print exit trace is wired in the Unown project via `pi-repo/packages/self-learning/src/print-exit-trace.ts` and integrated into `installPrintStallWatchdog`, `cmdPrint`, and `cli.ts`, with tests importing from both `cli.ts` and `print-exit-trace.ts`
- Unown Coda (`apps/coda/`) architecture: self-contained static vanilla-TS PWA, no workspaces, zero root deps, reuses `marked`/`fuse.js`/`@playwright/test`/`@axe-core/playwright` via upward resolution from root node_modules
- blueprint/sandbox: Disposable keyless test rig with synthetic HOME, offline operation
- clippad: Note-taking domain module with Notebook, UserDirectory, search, formatting
- llm-bridge: OpenAI-compatible gateway proxying to Dashscope with model allow-list
- blueprint/router: GitHub event dispatcher with headless Claude sessions, tightly controlled tool allowlist
- benchmarks/quality-axes: Deterministic suite measuring contradiction, staleness, forgetting, interference
- v3-fixture/tests: membench benchmark fixture tests for calc, stats, format, persist, search
- Fleet journal persists to .unown/fleet/journal.jsonl via appendFleetJournal/readFleetJournal (recordFleetChildSpawn, recordSyncSubagentSpawn, recordFleetChildFinish for finished; sweep outcomes for reaped/abandoned). FleetJournalEntry (pi-repo/packages/self-learning/src/fleet-reaper.ts:137) defines five ops: spawned (lane 'fleet' or 'sync'), worktree, finished, reaped, abandoned. Op discriminants recorded by recordFleetChildFinish (finished) and sweep outcomes (reaped/abandoned).
- blueprint/harness: Self-improving evaluation harness with golden tasks and weakness clustering
- pi-repo/packages/agent/scripts: Telemetry schema documentation generator
- agent-service: Mini-service wrapper (port 3030) booting self-learning layer with REST+SSE API
- benchmarks/mpbench: MPBench dataset adapter for poisoning defense measurement
- blueprint/dreams: Auto-dreaming driver consolidating session notes via headless Claude
- benchmarks/memory-eval/recall-qa: LongMemEval-adapted multi-session QA-recall benchmark
- benchmarks/nonllm: Local ONNX models (bge-small/MiniLM, ms-marco) and symbolic lanes
- blueprint/memory: Tiered memory stack observability mirroring CLAUDE.md hierarchy
- benchmarks/selfimprove: Repeat-task efficiency experiments measuring memory impact
- e2e: Playwright-based dashboard and landing page tests with axe-core accessibility
- blueprint/sandbox/scenarios: Integration tests for tiered memory, hooks, AutoDream, self-improvement loop
- zai-upstream: Local HTTP shim exposing sandbox's z-ai-web-dev-sdk for bridge routing
- benchmarks/longhorizon: Multi-file refactoring task benchmark using clippad fixture
- pi-repo/packages/agent/test: E2E integration tests with faux providers, proxy streaming tests
- pi-repo/packages/ai/scripts: Build-time model catalog fetchers (models.dev, OpenRouter, Vercel, NVIDIA NIM)
- benchmarks/nonllm/lib: LexRank, MinHash-LSH, BM25+RRF, memory activation scoring
- benchmarks/local-llm: llama.cpp + GGUF experiments against production remote model
- In /home/z/my-project/Unown, the CI workflow for ostinato is configured in `.github/workflows/ci.yml`; the ostinato job's action pins were byte-copied from the coda job to keep them in sync.
- In Unown's GitHub light color scheme, contrast ratios are verified as: foreground #1f2328 on #ffffff is ~14.5:1, and muted #57606a on #ffffff is ~6.5:1, both exceeding the 4.5:1 threshold for regular text.
- benchmarks/polyglot: Aider polyglot benchmark with 50-exercise Exercism subset
- Unown palette commands movePaletteSelection and runSelectedPaletteCommand verified gap-free after D10 rerender fix
- benchmarks/local-llm/lib: Cross-platform llama-server lifecycle, OpenAI-compatible clients
- Ticket A2H-2 in Unown: V-9 hardening landed in `scripts/tui-capture/pty_common.py` — added private `_send_drained()` helper where a reader thread pumps `self.pump(0.05)` until a stop event, joined in `finally` so `pump()` never runs concurrently with itself; wired into `send()`, `key()`, and `type_prompt()` (char loop and Esc/Enter tail) with caller semantics unchanged (same delays).
- In Unown's ostinato app, Chunk 3 of the O-4 implementation landed app.ts changes including the CreateActions type, AppState fields, notice refactor, create actions, onKey branch, dispatch cases, renderBoot tail, advanceSession clear, and four form functions, along with `.ostin` CSS updates.
- C-7 changes in /home/z/my-project/unown involved `apps/chaconne/public/offline.html`, `apps/chaconne/scripts/{verify-precache.ts, verify-precache.test.ts, capture-usage.mjs}`, `e2e/chaconne-resilience.spec.ts`, and `apps/chaconne/runner/store.ts`.
- The C-7 handoff in /home/z/my-project/unown verified that the `corrupt-quarantine` label was applied in `apps/chaconne/runner/store.ts` and its test `store-c7.test.ts`.
- In Unown's runner-core, the phase type for test verification accepts values 'front', 'revealed', and 'done'.
- C-9 a11y completion brief is defined in docs/rondo-round-session.md:474 and the PRD hardening map in docs/chaconne-prd.md:124-135; no separate .unown/receipts brief file exists for C-9

## Manual notes

- bin: Cross-platform CLI launcher (Unix shebang, Windows cmd/ps1) [note 1]. (Restored by hand 2026-11-02 during the Coda app round — third occurrence of the dream-render-prunes-landing-quoted-lines class, issue #46: the 110-cap render pruned it while the C2 session ran. The landing's loop.tsx memory preview quotes this line; the claims gate reddens without it. Moved to this durable lane.)
- Failed cycles auto-recover — do NOT restart engine to fix them. (Restored by hand 2026-11-01 during the browser autonomy round after a dream render pruned it at the 110-memory cap; the landing page's loop.tsx memory preview quotes this line, so the claims gate reddens when it disappears. The Manual notes lane survives every re-render — this is its durable home.)
- Stealth verification suite on bot.sannysoft.com: all 10 checks (webdriver, userAgent, platform, userAgentData, timezone, locale, screen, viewport, plugins, window.chrome) pass; 0 FAIL rows in Intoli tests. (Restored by hand 2026-11-01 — second occurrence of the dream-render-prunes-landing-quoted-lines class, issue #46; moved here to the durable lane.)
- Parley password hashing: scrypt N=16384 r=8 p=1 (src/lib/parley/password.ts). Restored by hand 2026-10-29 after AutoDream reconciles twice erased the fact (upstream 79->66 render, then the F1/F2 bcrypt poison round). Never let a memory answer overwrite this without reading the source.

<!-- unown: rendered 60/60 memories via Mem0 (backend: lexical) at 2026-11-06T15:45:15.883Z -->
