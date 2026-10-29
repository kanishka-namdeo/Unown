# Project Memory

## Workflow
- Verify API method signatures and arguments match when calling cross-module handlers (e.g., `openIncident(id)` vs `openIncident(null)`).
- Use `boot()` in `pi-repo/packages/self-learning/src/boot.ts` as the single entry point for both the interactive TUI and compiled release binaries.
- Use a two-step confirmation flow before executing destructive actions like deletion in React forms.
- Verify engine health: GET /api/overview returns ok:true; check this after any engine restart or config change.
- Run: bunx biome check --write on changed files in pi-repo/.
- Running subagent browser test workflows against the Unown fixture at http://127.0.0.1:7788/ yields a "Subagent Fixture" page titled "Form page" that contains a name textbox, combobox, and Submit form button; test interactions like typing "Ada", selecting "Beta" (value "b"), and submitting produce confirmation text "submitted Ada/b"

## Known pitfalls
- The harness skill `.unown/skills/recover-failed-cycle/` states that restarting the engine breaks auto-recovery state for failed cycles; do not restart — instead rely on the harness skill and project memory 'Failed cycles auto-recover'
- next.config.ts applies frame-hardening headers (Content-Security-Policy: frame-ancestors 'self' + X-Frame-Options: SAMEORIGIN) at lines 29-47 only for /demo/:path* and /bazaar/:path*, but omits the identical block for /cadence and /cadence/api/* even though cadence layout.tsx claims the route is iframed; extend the header block to /cadence to avoid leaving the new route unhardened.
- To reliably spy on localStorage.setItem in component tests for this project, use Object.defineProperty on the instance prototype with the native bind; simple property assignment fails because happy-dom routes setItem calls through a different receiver
- Stealth verification suite on bot.sannysoft.com: all 10 checks (webdriver, userAgent, platform, userAgentData, timezone, locale, screen, viewport, plugins, window.chrome) pass; 0 FAIL rows in Intoli tests.
- Failed cycles auto-recover — do NOT restart engine to fix them.
- Nocturne is the 7th gallery app in the Unown suite, focused on incident-ops. Its build contract is grounded in sibling lanes: parley's fail-closed tenancy/RBAC matrix/scrypt+HMAC session/immutable audit/metering, fugue's file-backed JSON store + clock-injected EngineCtx determinism, aria's 8-section plan structure (401/403/404/402/400 ladder, PBT invariant lane, embed contract), and cadence's accessible-SVG chart/primitives conventions.
- Web search may fallback to alternative providers (You.com, DuckDuckGo, Tavily) due to connection/rate-limit issues [note 1].
- In Unown component tests, `window.origin` is `null` so a handler comparing `ev.origin !== window.origin` against a dispatched `MessageEvent` with `origin: null` passes the origin check unexpectedly; debug by logging both origins
- Nocturne seed data invariant: an incident's `lastEscalatedAt` must precede its `acknowledgedAt`; observed pitfall where incident 2 had `lastEscalatedAt` 18 minutes after `acknowledgedAt`, violating the 'escalation only while unacked' rule, fixed by reordering the seed so the escalation event fires before the ack

## Environment
- bin: Cross-platform CLI launcher (Unix shebang, Windows cmd/ps1) [note 1].
- Parley's domain layer hashes passwords with Node crypto scryptSync (N=16384, r=8, p=1, 32-byte key, salt hex-encoded), verifyPassword uses timingSafeEqual; no PARLEY_BCRYPT_COST env var exists in the repo (grep-verified)
- The `src/` directory contains a Next.js marketing web app; the landing page is at `/` with UI sections in `src/components/landing/` (hand-drawn Unown script SVG, generated changelog/benchmark/engine-data files, GBA 5-bit palette). Auto-deploy to Vercel via GitHub integration; 'deploy.completed' events carry an 'environment' field. Development server runs on port 3000 (src/app/page.tsx).
- The `NocturneState` object in `src/lib/nocturne/types.ts` aggregates all 18 entity arrays and includes `version: 1` and `seq: number` fields; a `NocturneService.slaOverride: Record<Severity, number> | null` field was deliberately added to the model.
- The `/cadence` habit tracker uses an `embed=1` reset contract called `cadence-reset` and persists state to localStorage with a `SEED_VERSION` marker.
- Current Bun version: 1.4.3 (released October 2026)
- Nocturne escalation engine is strictly single-step: each `tickEscalation` advances at most one tier; the wait window for the next advance is measured from `lastEscalatedAt` (or `triggeredAt` if null), and an N-tier policy requires N-1 fired ticks to reach the final tier, with each tick waiting the current tier's `waitMinutes`; test scenarios must use tier counts and waits consistent with this (a 2-tier policy reaches its last tier in one tick, not two)

## Facts
- Unown's Nocturne /nocturne page skips rendering when the `nocturne_ses` cookie is absent (standalone no-session skip semantics); the provider accepts a `hasSession?: boolean` prop and the page reads the cookie server-side to pass that flag
- In Unown's Nocturne domain, `nocturne.openIncident(null)` is not the correct way to view the incident list; use `nocturne.openIncident(id)` for incident detail only
- Ensure UI state-specific elements (e.g., 'Seat schedule') are validated to appear only in their intended context (detail vs. list mode).
- Confirm that unit tests exercise the actual data-parse code path, not just static rendering.
- Per-project agent memory in Unown lives at .unown/memory/project.md, with a gitignored local.md for local overrides
- Implement codepoint-safe slicing for glyph normalization to prevent multi-byte character truncation.
- `src/lib/cadence/` deliverables include `types.ts` (12 exports: Habit, CheckoffDate, HabitFrequency, HabitEntry, CadenceState, EntriesByHabit, WeeklyBar, CompletionRate, BestDayOfWeek, CadenceStats, 5 constants), `seed.ts` (`isSeededHabitId`, `seedCadence`), and `streaks.ts` (`currentStreak`, `bestStreak`, `isOnTrack` + more).
- In benchmarks/validation-round/probe.mjs, add a --summary <label> mode that reads all probes/, orders by capturedAt descending (newest first, do not rely on filesystem order), takes the two most recent, and prints a per-query table with id, previous hit, current hit, and delta (new, +1, or -1)
- clippad: Note-taking domain module with Notebook, UserDirectory, search, formatting [note 1].
- The CadenceProvider state object supports fire-and-forget POST sync for non-seeded habits and checkoffs, and an embed `message` listener that triggers a full state wipe and fresh seed when receiving `cadence-reset` from the `unown-landing` origin
- Cadence domain layer lives at `src/lib/cadence/` mirroring bazaar/sigil sibling conventions: pure domain code, bun:test for tests, localStorage shim in tests, and happy-dom preload configured via bunfig.
- Unown project adds a habit/streak tracker at `/cadence` (Bazaar-mirrored layout: route + API under `src/app/cadence/`, UI in `src/components/cadence/`, pure domain in `src/lib/cadence/`, scoped stylesheet).
- In src/lib/review.ts, parseReviewOutput (lines 455-475) uses static regexes over model output so treated data cannot become code injection, and the git() helper (lines 114-121) calls spawnSync with array args and shell:false; a security review of the /cadence diff (since commit 94d7cb1d) confirmed no new injection surface.
- Utilize `useDialogDismiss` to manage focus traps and Escape-key closing for modal components.
- Guard habit-sync effects with a `sessionHabitsRef` reference to prevent unnecessary re-renders or sync conflicts.
- The `/btw <question>` command in the Unown project displays side-question answers in a dismissible overlay without entering the transcript, receipts ledger, or AutoDream note mining, using only the last 12 text-only turns for context; users dismiss the answer by pressing Esc, Enter, or q
- In the Unown landing repo, `bun test src/lib/cadence` runs 62 tests across 5 files (seed, streaks, stats, validation, persistence) with 2343 expects; the full `bun test src` suite contains 304 tests across 32 files.
- The cadence module includes `src/components/cadence/format.ts` with pure date helpers (`weekdayShort`, `monthShort`, `todayKey`, `formatLongDate`, `dayKeyOf`) and `primitives.tsx` exporting `StreakChip`, `Kpi`, and `IntensityLegend`
- Unown project contains a Next.js marketing landing page at / (:3000) with src/app/page.tsx and src/components/landing/ featuring hand-drawn Unown script SVG, generated changelog/benchmark/engine-data files, and a GBA 5-bit palette
- benchmarks/nonllm/lib: LexRank, MinHash-LSH, BM25+RRF, memory activation scoring [note 1].
- blueprint/sandbox: Disposable keyless test rig with synthetic HOME, offline operation [note 1].
- Unown project's CLI entrypoint is bin/unown, a Bun script that boots pi-repo/packages/self-learning/src/boot.ts to drive the TUI, headless mode (-p), --plan, and subcommands
- benchmarks/nonllm: Local ONNX models (bge-small/MiniLM, ms-marco) and symbolic lanes [note 1].
- benchmarks/polyglot: Aider polyglot benchmark with 50-exercise Exercism subset [note 1].
- benchmarks/memory-eval/recall-qa: LongMemEval-adapted multi-session QA-recall benchmark [note 1].
- benchmarks/longhorizon: Multi-file refactoring task benchmark using clippad fixture [note 1].
- benchmarks/longhorizon/task/tests: clippad test suite for store, CLI, author, notebook [note 1].
- v3-fixture/tests: membench benchmark fixture tests for calc, stats, format, persist, search [note 1].
- blueprint/harness: Self-improving evaluation harness with golden tasks and weakness clustering [note 1].
- benchmarks/longhorizon/reference/tests: Reference implementation tests for clippad [note 1].
- benchmarks/poison-corpus: Adversarial memory poisoning defense evaluation [note 1].
- blueprint/memory: Tiered memory stack observability mirroring CLAUDE.md hierarchy [note 1].
- blueprint/dreams: Auto-dreaming driver consolidating session notes via headless Claude [note 1].
- benchmarks/local-llm/lib: Cross-platform llama-server lifecycle, OpenAI-compatible clients [note 1].
- blueprint/router: GitHub event dispatcher with headless Claude sessions, tightly controlled tool allowlist [note 1].
- pi-repo/packages/pi-protocol: Protocol types and encoding.
- pi-repo/packages/ai/scripts: Build-time model catalog fetchers (models.dev, OpenRouter, Vercel, NVIDIA NIM).
- blueprint/sandbox/scenarios: Integration tests for tiered memory, hooks, AutoDream, self-improvement loop [note 1].
- benchmarks/mpbench: MPBench dataset adapter for poisoning defense measurement [note 1].
- benchmarks/local-llm: llama.cpp + GGUF experiments against production remote model [note 1].
- zai-upstream: Local HTTP shim exposing sandbox's z-ai-web-dev-sdk for bridge routing [note 1].
- e2e: Playwright-based dashboard and landing page tests with axe-core accessibility [note 1].
- pi-repo/packages/ai/test: Provider-specific OAuth, streaming, tool calling tests.
- pi-repo/packages/agent/scripts: Telemetry schema documentation generator.
- benchmarks/quality-axes: Deterministic suite measuring contradiction, staleness, forgetting, interference [note 1].
- pi-repo: Pi agent harness monorepo with cross-platform shell entry points.
- pi-repo/packages/agent: Core Agent class with stateful wrapper, tool execution, event streaming.
- In Unown, `Shell.tsx` gates the embed `message` listener on the `embed` flag and routes `onReset` to the new POST sync route
- pi-repo/packages/pi-client: Transport-neutral client over framed CBOR bytes with lease modes.
- pi-repo/packages/ai: Unified LLM API with automatic model discovery, provider abstraction.
- agent-service: Mini-service wrapper (port 3030) booting self-learning layer with REST+SSE API [note 1].
- llm-bridge: OpenAI-compatible gateway proxying to Dashscope with model allow-list [note 1].
- pi-repo/packages/agent/test: E2E integration tests with faux providers, proxy streaming tests.
- The new `src/lib/nocturne/format.ts` module includes a local `CheckoffDate` alias, cadence-verbatim date helpers (`weekdayShort`, `monthShort`, `formatLongDate`, `todayKey`, `dayKeyOf`), and parley-shaped `formatCountdown`/`formatDurationMs` functions (ms <= 0 → "0m", "45m", "2h 14m"). The module is pure with no use of `Date.now()`, DOM, or random functions.
- benchmarks/selfimprove: Repeat-task efficiency experiments measuring memory impact [note 1].
- A separate, unrelated `dayKeyOf` function exists in `src/lib/sigil/stats.ts` which uses local-timezone ISO-input formatting.
- Nocturne's `rotation.ts` engine implements contiguous weekly rotation tiling with latest-wins override precedence.
- Nocturne's `sla.ts` engine handles SLA ack/resolve breach detection with a 20% at-risk band that is frozen while snoozed.
- Nocturne's `dedup.ts` engine implements a 60-second dedup window with an idempotent merge.
- Nocturne's `correlate.ts` engine performs a 5-minute correlation of standalone alerts into open same-service+severity incidents.
- Nocturne's `escalation.ts` engine uses tiered escalation timers that fire ONLY while unacked/snoozed.
- The complete Nocturne build contract is written to `benchmarks/nocturne-round/plan.md` (~52 KB, matching the aria contract's completeness) and is grounded in the explored sibling lanes.
- Seed rows in the Nocturne domain use `nc_seed_*` constants, while live rows are generated via `mulberry32`-based `nc_<kind>` helper functions to ensure deterministic ID generation.
- All three Nocturne domain layer files (`types.ts`, `ids.ts`, `clock.ts`) under `src/lib/nocturne/` follow parley conventions and satisfy the task specification in the plan document.
- Nocturne domain layer types use type-level refinements as single source of truth: `NocturneChecklistState.stepStates` is `Record<string, ChecklistStepState>` and `NocturneComponent.status` is `NocturneComponentStatus`, replacing inline union literals.
- Extract durable engineering knowledge from session outcomes as short imperative memories, not metadata

## Manual notes

- Parley password hashing: scrypt N=16384 r=8 p=1 (src/lib/parley/password.ts). Restored by hand 2026-10-29 after AutoDream reconciles twice erased the fact (upstream 79->66 render, then the F1/F2 bcrypt poison round). Never let a memory answer overwrite this without reading the source.

<!-- unown: rendered 88/88 memories via Mem0 (backend: lexical) at 2026-10-29T15:25:51.425Z -->
