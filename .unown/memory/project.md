# Project Memory

## Workflow
- Verify file existence and content after creation to confirm task completion
- Verify engine health: GET /api/overview returns ok:true; check this after any engine restart or config change.
- Run: bunx biome check --write on changed files in pi-repo/.
- Use `boot()` in `pi-repo/packages/self-learning/src/boot.ts` as the single entry point for both the interactive TUI and compiled release binaries.
- Use a two-step confirmation flow before executing destructive actions like deletion in React forms.
- Running subagent browser test workflows against the Unown fixture at http://127.0.0.1:7788/ yields a "Subagent Fixture" page titled "Form page" that contains a name textbox, combobox, and Submit form button; test interactions like typing "Ada", selecting "Beta" (value "b"), and submitting produce confirmation text "submitted Ada/b"
- Use the `unown` project for hero type scale work (work order 3)
- Verify subproject structural patterns by inspecting existing siblings (e.g., cadence) before adding new app directories like `src/app/encore/`, `src/lib/encore/`, and `src/components/encore/`.

## Known pitfalls
- Nocturne is the 7th gallery app in the Unown suite, focused on incident-ops. Its build contract is grounded in sibling lanes: parley's fail-closed tenancy/RBAC matrix/scrypt+HMAC session/immutable audit/metering, fugue's file-backed JSON store + clock-injected EngineCtx determinism, aria's 8-section plan structure (401/403/404/402/400 ladder, PBT invariant lane, embed contract), and cadence's accessible-SVG chart/primitives conventions.
- Web search may fallback to alternative providers (You.com, DuckDuckGo, Tavily) due to connection/rate-limit issues [note 1].
- In Unown component tests, `window.origin` is `null` so a handler comparing `ev.origin !== window.origin` against a dispatched `MessageEvent` with `origin: null` passes the origin check unexpectedly; debug by logging both origins
- Failed cycles auto-recover — do NOT restart engine to fix them.
- Nocturne seed data invariant: an incident's `lastEscalatedAt` must precede its `acknowledgedAt`; observed pitfall where incident 2 had `lastEscalatedAt` 18 minutes after `acknowledgedAt`, violating the 'escalation only while unacked' rule, fixed by reordering the seed so the escalation event fires before the ack
- Unown encore component test suite (`bun test src/components/encore`) passes 55 tests with 0 failures in a single file.
- In the Unown 390px covenant, the table.sr-only overflow pitfall was fixed by moving the table inside a div with className 'sr-only' because scoped global table rules override Tailwind v4's sr-only width:1px on table elements; divs carry no table width semantics so the 1px clip holds, and the table itself is class-free.
- To reliably spy on localStorage.setItem in component tests for this project, use Object.defineProperty on the instance prototype with the native bind; simple property assignment fails because happy-dom routes setItem calls through a different receiver
- Stealth verification suite on bot.sannysoft.com: all 10 checks (webdriver, userAgent, platform, userAgentData, timezone, locale, screen, viewport, plugins, window.chrome) pass; 0 FAIL rows in Intoli tests.
- In the Unown encore component styles, avoid opacity-suffixed Tailwind text tokens (e.g. `text-dim/70`, `hover:text-amber/80`) because they do not match the design-token sweep; replace them with named token classes `text-faint` and `text-amber` respectively
- After fixing opacity-faded text tokens in `src/components/encore/` (primitives.tsx:214 `text-dim/70` → `text-faint`, failures.tsx:150 `hover:text-amber/80` → `hover:text-amber`), verification via `bun test src/components/encore` and `bun run typecheck` confirms 55 tests pass with 0 failures and clean typecheck
- Unown encore library test suite (`bun test src/lib/encore`) passes 70 tests with 0 failures across 4 files, exercising the drift gate that asserts all five receipts (baseline plus ITER0-ITER3) field-by-field, pins the iter3 objective-gate behavior, and verifies append-clean invariants.

## Environment
- In OB-5 live-lane, when the learning feed records a memory version advance, the footer chip counts it as an unseen learning event until /feed marks it seen; the chip contract is count, not text
- OB-5 live-lane: when the learning feed records a memory version advance, the footer chip counts it as an unseen learning event until /feed marks it seen.
- The `/cadence` habit tracker uses an `embed=1` reset contract called `cadence-reset` and persists state to localStorage with a `SEED_VERSION` marker.
- The `src/` directory contains a Next.js marketing web app; the landing page is at `/` with UI sections in `src/components/landing/`. Auto-deploy to Vercel via GitHub integration; 'deploy.completed' events carry an 'environment' field. Development server runs on port 3000 (src/app/page.tsx). All 7 sibling routes (/demo, /bazaar, /cadence, /parley, /fugue, /aria, /nocturne) have frame-hardening headers (CSP frame-ancestors 'self' + X-Frame-Options SAMEORIGIN) in `next.config.ts` lines 28-88, superseding prior notes that /cadence was omitted from hardening. Hand-drawn Unown script SVG, generated changelog/benchmark/engine-data files, and GBA 5-bit palette are part of the landing UI structure.
- Identify API-less sibling patterns (such as cadence's localStorage shape) when determining if a new subproject requires an `api/` directory.
- bin: Cross-platform CLI launcher (Unix shebang, Windows cmd/ps1) [note 1].
- Parley's domain layer hashes passwords with Node crypto scryptSync (N=16384, r=8, p=1, 32-byte key, salt hex-encoded), verifyPassword uses timingSafeEqual; no PARLEY_BCRYPT_COST env var exists in the repo (grep-verified)
- Nocturne escalation engine is strictly single-step: each `tickEscalation` advances at most one tier; the wait window for the next advance is measured from `lastEscalatedAt` (or `triggeredAt` if null), and an N-tier policy requires N-1 fired ticks to reach the final tier, with each tick waiting the current tier's `waitMinutes`; test scenarios must use tier counts and waits consistent with this (a 2-tier policy reaches its last tier in one tick, not two)

## Facts
- Track and complete file creation tasks using the todo tool to ensure workflow accountability
- Trust test checkpoint at `notes/ob-round-trust.md` in `/home/z/my-project/unown` contains the single line `trust test checkpoint` (22 bytes)
- In the unown project, the OB-5 observability round verified that the in-session learning feed records dreams live
- The OB-5 PTY capture lane runs the pane-is-truth contract at terminal dimensions 128x36
- In the OB-5 repaint lane, the feed chip must paint itself when a dream advances memory during an idle session; the listener contract repaints on push and is cleared at shutdown
- OB-5 repaint lane: the feed chip must repaint itself when a dream advances memory during an idle session. The listener contract repaints on push events and is cleared at shutdown.
- OB-5 lane: the observability round verified that the in-session learning feed records dreams live.
- OB-5 lane: the PTY capture lane enforces the pane-is-truth contract at a 128x36 terminal size.
- OB-5 lane: the footer chip contract reports a count of unseen learning events, not a text label.
- The `src/lib/nocturne/types.ts` file in the worktree contains the full data model from `benchmarks/nocturne-round/plan.md` §1, defining 17 entity interfaces including NocturneTenant, NocturneUser, NocturneService, NocturneAlert, NocturneIncident, NocturneTimelineEvent, NocturneRunbook, and NocturneNote.
- Nocturne domain layer types use type-level refinements as single source of truth: `NocturneChecklistState.stepStates` is `Record<string, ChecklistStepState>` and `NocturneComponent.status` is `NocturneComponentStatus`, replacing inline union literals.
- The complete Nocturne build contract is written to `benchmarks/nocturne-round/plan.md` (~52 KB, matching the aria contract's completeness) and is grounded in the explored sibling lanes.
- In `src/app/nocturne/api/_state.ts:loginSession`, allocate the session ID via `nextId(
- Nocturne test suite has 360 tests that all passed green in the session, followed by a typecheck verification step
- Seed rows in the Nocturne domain use `nc_seed_*` constants, while live rows are generated via `mulberry32`-based `nc_<kind>` helper functions to ensure deterministic ID generation.
- A separate, unrelated `dayKeyOf` function exists in `src/lib/sigil/stats.ts` which uses local-timezone ISO-input formatting.
- The new `src/lib/nocturne/format.ts` module includes a local `CheckoffDate` alias, cadence-verbatim date helpers (`weekdayShort`, `monthShort`, `formatLongDate`, `todayKey`, `dayKeyOf`), and parley-shaped `formatCountdown`/`formatDurationMs` functions (ms <= 0 → "0m", "45m", "2h 14m"). The module is pure with no use of `Date.now()`, DOM, or random functions.
- benchmarks/selfimprove: Repeat-task efficiency experiments measuring memory impact [note 1].
- pi-repo/packages/agent/test: E2E integration tests with faux providers, proxy streaming tests.
- Nocturne's `escalation.ts` engine uses tiered escalation timers that fire ONLY while unacked/snoozed.
- Nocturne's `sla.ts` engine handles SLA ack/resolve breach detection with a 20% at-risk band that is frozen while snoozed.
- All three Nocturne domain layer files (`types.ts`, `ids.ts`, `clock.ts`) under `src/lib/nocturne/` follow parley conventions and satisfy the task specification in the plan document.
- pi-repo/packages/ai/scripts: Build-time model catalog fetchers (models.dev, OpenRouter, Vercel, NVIDIA NIM).
- In Unown, `Shell.tsx` gates the embed `message` listener on the `embed` flag and routes `onReset` to the new POST sync route
- pi-repo/packages/pi-client: Transport-neutral client over framed CBOR bytes with lease modes.
- pi-repo/packages/ai: Unified LLM API with automatic model discovery, provider abstraction.
- agent-service: Mini-service wrapper (port 3030) booting self-learning layer with REST+SSE API [note 1].
- llm-bridge: OpenAI-compatible gateway proxying to Dashscope with model allow-list [note 1].
- pi-repo/packages/ai/test: Provider-specific OAuth, streaming, tool calling tests.
- pi-repo/packages/agent/scripts: Telemetry schema documentation generator.
- benchmarks/quality-axes: Deterministic suite measuring contradiction, staleness, forgetting, interference [note 1].
- pi-repo: Pi agent harness monorepo with cross-platform shell entry points.
- pi-repo/packages/agent: Core Agent class with stateful wrapper, tool execution, event streaming.
- e2e: Playwright-based dashboard and landing page tests with axe-core accessibility [note 1].
- blueprint/router: GitHub event dispatcher with headless Claude sessions, tightly controlled tool allowlist [note 1].
- pi-repo/packages/pi-protocol: Protocol types and encoding.
- pi-repo/packages/agent/src: Agent loop functions (agentLoop, agentLoopContinue, runAgentLoop).
- blueprint/sandbox/scenarios: Integration tests for tiered memory, hooks, AutoDream, self-improvement loop [note 1].
- benchmarks/mpbench: MPBench dataset adapter for poisoning defense measurement [note 1].
- benchmarks/local-llm: llama.cpp + GGUF experiments against production remote model [note 1].
- zai-upstream: Local HTTP shim exposing sandbox's z-ai-web-dev-sdk for bridge routing [note 1].
- blueprint/dreams: Auto-dreaming driver consolidating session notes via headless Claude [note 1].
- benchmarks/local-llm/lib: Cross-platform llama-server lifecycle, OpenAI-compatible clients [note 1].
- blueprint/memory: Tiered memory stack observability mirroring CLAUDE.md hierarchy [note 1].
- benchmarks/longhorizon: Multi-file refactoring task benchmark using clippad fixture [note 1].
- benchmarks/longhorizon/task/tests: clippad test suite for store, CLI, author, notebook [note 1].
- v3-fixture/tests: membench benchmark fixture tests for calc, stats, format, persist, search [note 1].
- blueprint/harness: Self-improving evaluation harness with golden tasks and weakness clustering [note 1].
- benchmarks/longhorizon/reference/tests: Reference implementation tests for clippad [note 1].
- benchmarks/poison-corpus: Adversarial memory poisoning defense evaluation [note 1].
- The `/btw <question>` command in the Unown project displays side-question answers in a dismissible overlay without entering the transcript, receipts ledger, or AutoDream note mining, using only the last 12 text-only turns for context; users dismiss the answer by pressing Esc, Enter, or q
- benchmarks/nonllm/lib: LexRank, MinHash-LSH, BM25+RRF, memory activation scoring [note 1].
- blueprint/sandbox: Disposable keyless test rig with synthetic HOME, offline operation [note 1].
- Unown project's CLI entrypoint is bin/unown, a Bun script that boots pi-repo/packages/self-learning/src/boot.ts to drive the TUI, headless mode (-p), --plan, and subcommands
- benchmarks/nonllm: Local ONNX models (bge-small/MiniLM, ms-marco) and symbolic lanes [note 1].
- benchmarks/polyglot: Aider polyglot benchmark with 50-exercise Exercism subset [note 1].
- benchmarks/memory-eval/recall-qa: LongMemEval-adapted multi-session QA-recall benchmark [note 1].
- Unown project adds a habit/streak tracker at `/cadence` (Bazaar-mirrored layout: route + API under `src/app/cadence/`, UI in `src/components/cadence/`, pure domain in `src/lib/cadence/`, scoped stylesheet).
- In src/lib/review.ts, parseReviewOutput (lines 455-475) uses static regexes over model output so treated data cannot become code injection, and the git() helper (lines 114-121) calls spawnSync with array args and shell:false; a security review of the /cadence diff (since commit 94d7cb1d) confirmed no new injection surface.
- Utilize `useDialogDismiss` to manage focus traps and Escape-key closing for modal components.
- Guard habit-sync effects with a `sessionHabitsRef` reference to prevent unnecessary re-renders or sync conflicts.
- clippad: Note-taking domain module with Notebook, UserDirectory, search, formatting [note 1].
- Cadence domain layer lives at `src/lib/cadence/` mirroring bazaar/sigil sibling conventions: pure domain code, bun:test for tests, localStorage shim in tests, and happy-dom preload configured via bunfig.
- In benchmarks/validation-round/probe.mjs, add a --summary <label> mode that reads all probes/, orders by capturedAt descending (newest first, do not rely on filesystem order), takes the two most recent, and prints a per-query table with id, previous hit, current hit, and delta (new, +1, or -1)
- Per-project agent memory in Unown lives at .unown/memory/project.md, with a gitignored local.md for local overrides
- Implement codepoint-safe slicing for glyph normalization to prevent multi-byte character truncation.
- In `src/components/encore/views/loop.tsx` (line 205) and `src/components/encore/views/finale.tsx` (line 89), the `encore-type-caption` class is combined with `text-dim` (and `mr-2` in loop) for styled captions
- Frame-hardening headers (Content-Security-Policy frame-ancestors 'self' and X-Frame-Options SAMEORIGIN) were added to the `/encore/:path*` route in `next.config.ts`, matching the pattern already established for sibling routes `/nocturne`, `/cadence`, `/aria`, and others.
- Locate design tokens in `src/app/globals.css` by distinguishing between the `@theme inline` shadcn bridge and the non-inline `@theme` landing-palette block (GBA 5-bit grid).
- Bun is at 1.4.3 (October 2026).

## Manual notes

- Parley password hashing: scrypt N=16384 r=8 p=1 (src/lib/parley/password.ts). Restored by hand 2026-10-29 after AutoDream reconciles twice erased the fact (upstream 79->66 render, then the F1/F2 bcrypt poison round). Never let a memory answer overwrite this without reading the source.

<!-- unown: rendered 98/98 memories via Mem0 (backend: lexical) at 2026-10-30T00:59:58.002Z -->
