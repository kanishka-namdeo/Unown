# Project Memory

## Workflow
- Verify subproject structural patterns by inspecting existing siblings (e.g., cadence) before adding new app directories like `src/app/encore/`, `src/lib/encore/`, and `src/components/encore/`.
- Use the `unown` project for hero type scale work (work order 3)

## Known pitfalls
- Environment fact: /etc/shadow is owned by root and access returns EACCES: permission denied for the current process; this is a plain OS permission error, not a policy refusal.
- To reliably spy on localStorage.setItem in component tests for this project, use Object.defineProperty on the instance prototype with the native bind; simple property assignment fails because happy-dom routes setItem calls through a different receiver
- Stealth verification suite on bot.sannysoft.com: all 10 checks (webdriver, userAgent, platform, userAgentData, timezone, locale, screen, viewport, plugins, window.chrome) pass; 0 FAIL rows in Intoli tests.
- Use `find <dir> -name '*.ts' | wc -l` or `find <dir> -name '*.ts' -type f` for exact machine-verified file counts; avoid manual directory listing estimates which miss files.
- Pitfall: atomic.ts:16 temp file name `${file}.tmp-${process.pid}-${Date.now()}` lacks a per-process monotonic counter; two same-process writes to the same target within one millisecond share the identical tmp path and cause a clobber race. Fix: add `let seq = 0` and append `seq++` to the temp filename.
- Reviewer-verified regression test for atomic.ts clobber race: stub Date.now to a constant, call atomicWriteFileSync 3 times on the same target, and assert the final content equals the third call's input; old pid-Date.now naming fails this deterministically.
- Unown encore component test suite (`bun test src/components/encore`) passes 55 tests with 0 failures in a single file.
- In the Unown encore component styles, avoid opacity-suffixed Tailwind text tokens (e.g. `text-dim/70`, `hover:text-amber/80`) because they do not match the design-token sweep; replace them with named token classes `text-faint` and `text-amber` respectively
- After fixing opacity-faded text tokens in `src/components/encore/` (primitives.tsx:214 `text-dim/70` → `text-faint`, failures.tsx:150 `hover:text-amber/80` → `hover:text-amber`), verification via `bun test src/components/encore` and `bun run typecheck` confirms 55 tests pass with 0 failures and clean typecheck
- In Unown component tests, `window.origin` is `null` so a handler comparing `ev.origin !== window.origin` against a dispatched `MessageEvent` with `origin: null` passes the origin check unexpectedly; debug by logging both origins
- Failed cycles auto-recover — do NOT restart engine to fix them.
- Nocturne seed data invariant: an incident's `lastEscalatedAt` must precede its `acknowledgedAt`; observed pitfall where incident 2 had `lastEscalatedAt` 18 minutes after `acknowledgedAt`, violating the 'escalation only while unacked' rule, fixed by reordering the seed so the escalation event fires before the ack
- Nocturne is the 7th gallery app in the Unown suite, focused on incident-ops. Its build contract is grounded in sibling lanes: parley's fail-closed tenancy/RBAC matrix/scrypt+HMAC session/immutable audit/metering, fugue's file-backed JSON store + clock-injected EngineCtx determinism, aria's 8-section plan structure (401/403/404/402/400 ladder, PBT invariant lane, embed contract), and cadence's accessible-SVG chart/primitives conventions.
- Web search may fallback to alternative providers (You.com, DuckDuckGo, Tavily) due to connection/rate-limit issues [note 1].
- In the Unown 390px covenant, the table.sr-only overflow pitfall was fixed by moving the table inside a div with className 'sr-only' because scoped global table rules override Tailwind v4's sr-only width:1px on table elements; divs carry no table width semantics so the 1px clip holds, and the table itself is class-free.

## Task playbooks
- atomic.ts same-millisecond clobber race is fixed with a module-level monotonic sequence counter appending `-${seq++}` to the temp filename pattern `${process.pid}-${Date.now()}` in atomicWriteFileSync.

## Environment
- bin: Cross-platform CLI launcher (Unix shebang, Windows cmd/ps1) [note 1].
- Parley's domain layer hashes passwords with Node crypto scryptSync (N=16384, r=8, p=1, 32-byte key, salt hex-encoded), verifyPassword uses timingSafeEqual; no PARLEY_BCRYPT_COST env var exists in the repo (grep-verified)
- Nocturne escalation engine is strictly single-step: each `tickEscalation` advances at most one tier; the wait window for the next advance is measured from `lastEscalatedAt` (or `triggeredAt` if null), and an N-tier policy requires N-1 fired ticks to reach the final tier, with each tick waiting the current tier's `waitMinutes`; test scenarios must use tier counts and waits consistent with this (a 2-tier policy reaches its last tier in one tick, not two)
- In OB-5 live-lane, when the learning feed records a memory version advance, the footer chip counts it as an unseen learning event until /feed marks it seen; the chip contract is count, not text
- The `/cadence` habit tracker uses an `embed=1` reset contract called `cadence-reset` and persists state to localStorage with a `SEED_VERSION` marker.
- The `PI_MODEL_ID` environment variable pins the model ID for pi's `models.json`; `.env.example` defaults it to `agnes-3.0-flash`, with code fallbacks of `agnes-3.0-flash` (term.ts/presets.ts/llm.ts) and legacy `kimi-k2.5` (runner.ts).
- The `src/` directory contains a Next.js marketing web app; the landing page is at `/` with UI sections in `src/components/landing/`. Auto-deploy to Vercel via GitHub integration; 'deploy.completed' events carry an 'environment' field. Development server runs on port 3000 (src/app/page.tsx). All 7 sibling routes (/demo, /bazaar, /cadence, /parley, /fugue, /aria, /nocturne) have frame-hardening headers (CSP frame-ancestors 'self' + X-Frame-Options SAMEORIGIN) in `next.config.ts` lines 28-88, superseding prior notes that /cadence was omitted from hardening. Hand-drawn Unown script SVG, generated changelog/benchmark/engine-data files, and GBA 5-bit palette are part of the landing UI structure.
- Identify API-less sibling patterns (such as cadence's localStorage shape) when determining if a new subproject requires an `api/` directory.

## Facts
- The Unown subdirectory in /home/z/my-project serves as the terminal outcome, returning 'UNOWN_OK' on successful validation.
- pi-repo/packages/self-learning/src/delegation.ts owns renderDelegationCard (line 170), renderDelegationChip, deriveWorthLine, and the delegation ledger; it is imported by tools.ts at lines 78 and 3736 to notify the TUI.
- The `src/` directory contains 367 TypeScript files with no empty files, all regular files (no symlinks or directories).
- pi-repo/packages/self-learning/test/ grew from 82,204 lines across 228 .ts files to 82,746 lines across 230 .ts/.tsx files (2 new files, +542 lines), verified via `xargs cat | wc -l` and `xargs wc -l | tail -1`.
- When counting lines of specific file types in a directory tree, use `find <dir> -name '*.ts' -type f -print0 | xargs -0 cat | wc -l` to safely handle filenames with spaces or special characters.
- Existing test at pi-repo/packages/self-learning/test/memory.test.ts:131 asserts no .tmp leftovers after a single write, which passes against the old naming and does not cover back-to-back same-target writes.
- Routines endpoints include GET/POST /api/automations, /api/automations/{id}, /run, /skip, /snooze, /runs, /event-dispatch — all in server.ts; CLI `unown routines` and agent routine tools map onto these.
- To verify exact line counts, cross-check `find . -name '*.ts' -print0 | xargs -0 wc -l` against `find . -name '*.ts' -print0 | xargs -0 cat | wc -l` to rule out trailing-newline discrepancies.
- The FleetJournalEntry union in fleet-reaper.ts defines five operations: spawned (optional lane 'fleet'), spawned (lane 'sync'), worktree, finished, and reaped/abandoned; journal methods recordFleetChildSpawn and recordSyncSubagentSpawn write to .unown/fleet/journal.jsonl.
- The `find` tool backend is unavailable in the Unown project; use directory listings instead to enumerate the `src/` tree. Verified via subagent session.
- Fleet journal operations are journaled via recordFleetChildFinish (`finished`) and sweep outcomes (`reaped`/`abandoned`); the journal is stored as JSONL at .unown/fleet/journal.jsonl.
- FleetJournalEntry op discriminants are `spawned`, `worktree`, `finished`, `reaped`, `abandoned` (5 ops); `spawned` can be either `fleet` or `sync` lane.
- The engine serves routines under /api/automations (REST) in pi-repo/packages/self-learning/src/server.ts handleApi; there is no /api/routines route; CLI alias `unown routines` maps to the automations endpoints.
- FleetJournalEntry is defined at pi-repo/packages/self-learning/src/fleet-reaper.ts:137; the fleet journal persists to .unown/fleet/journal.jsonl via appendFleetJournal/readFleetJournal.
- Frame-hardening headers (Content-Security-Policy frame-ancestors 'self' and X-Frame-Options SAMEORIGIN) were added to the `/encore/:path*` route in `next.config.ts`, matching the pattern already established for sibling routes `/nocturne`, `/cadence`, `/aria`, and others.
- Locate design tokens in `src/app/globals.css` by distinguishing between the `@theme inline` shadcn bridge and the non-inline `@theme` landing-palette block (GBA 5-bit grid).
- Implement codepoint-safe slicing for glyph normalization to prevent multi-byte character truncation.
- Per-project agent memory in Unown lives at .unown/memory/project.md, with a gitignored local.md for local overrides
- The six landing-page benchmark suites are defined in the TRACKS array at scripts/landing_benchmarks.mjs:79, which writes to src/components/landing/benchmarks-data.ts; the authoritative contract is documented in benchmarks/AGENTS.md under "The landing-page feed".
- benchmarks/nonllm: Local ONNX models (bge-small/MiniLM, ms-marco) and symbolic lanes [note 1].
- Utilize `useDialogDismiss` to manage focus traps and Escape-key closing for modal components.
- Guard habit-sync effects with a `sessionHabitsRef` reference to prevent unnecessary re-renders or sync conflicts.
- clippad: Note-taking domain module with Notebook, UserDirectory, search, formatting [note 1].
- Cadence domain layer lives at `src/lib/cadence/` mirroring bazaar/sigil sibling conventions: pure domain code, bun:test for tests, localStorage shim in tests, and happy-dom preload configured via bunfig.
- Bun is at 1.4.3 (October 2026).
- In src/lib/review.ts, parseReviewOutput (lines 455-475) uses static regexes over model output so treated data cannot become code injection, and the git() helper (lines 114-121) calls spawnSync with array args and shell:false; a security review of the /cadence diff (since commit 94d7cb1d) confirmed no new injection surface.
- In `src/components/encore/views/loop.tsx` (line 205) and `src/components/encore/views/finale.tsx` (line 89), the `encore-type-caption` class is combined with `text-dim` (and `mr-2` in loop) for styled captions
- benchmarks/nonllm/lib: LexRank, MinHash-LSH, BM25+RRF, memory activation scoring [note 1].
- benchmarks/polyglot: Aider polyglot benchmark with 50-exercise Exercism subset [note 1].
- benchmarks/memory-eval/recall-qa: LongMemEval-adapted multi-session QA-recall benchmark [note 1].
- Unown project adds a habit/streak tracker at `/cadence` (Bazaar-mirrored layout: route + API under `src/app/cadence/`, UI in `src/components/cadence/`, pure domain in `src/lib/cadence/`, scoped stylesheet).
- blueprint/harness: Self-improving evaluation harness with golden tasks and weakness clustering [note 1].
- In benchmarks/validation-round/probe.mjs, add a --summary <label> mode that reads all probes/, orders by capturedAt descending (newest first, do not rely on filesystem order), takes the two most recent, and prints a per-query table with id, previous hit, current hit, and delta (new, +1, or -1)
- Unown project's CLI entrypoint is bin/unown, a Bun script that boots pi-repo/packages/self-learning/src/boot.ts to drive the TUI, headless mode (-p), --plan, and subcommands
- blueprint/dreams: Auto-dreaming driver consolidating session notes via headless Claude [note 1].
- benchmarks/local-llm/lib: Cross-platform llama-server lifecycle, OpenAI-compatible clients [note 1].
- blueprint/memory: Tiered memory stack observability mirroring CLAUDE.md hierarchy [note 1].
- blueprint/sandbox: Disposable keyless test rig with synthetic HOME, offline operation [note 1].
- benchmarks/longhorizon/reference/tests: Reference implementation tests for clippad [note 1].
- benchmarks/poison-corpus: Adversarial memory poisoning defense evaluation [note 1].
- The `/btw <question>` command in the Unown project displays side-question answers in a dismissible overlay without entering the transcript, receipts ledger, or AutoDream note mining, using only the last 12 text-only turns for context; users dismiss the answer by pressing Esc, Enter, or q
- blueprint/sandbox/scenarios: Integration tests for tiered memory, hooks, AutoDream, self-improvement loop [note 1].
- benchmarks/mpbench: MPBench dataset adapter for poisoning defense measurement [note 1].
- benchmarks/longhorizon: Multi-file refactoring task benchmark using clippad fixture [note 1].
- benchmarks/longhorizon/task/tests: clippad test suite for store, CLI, author, notebook [note 1].
- v3-fixture/tests: membench benchmark fixture tests for calc, stats, format, persist, search [note 1].
- blueprint/router: GitHub event dispatcher with headless Claude sessions, tightly controlled tool allowlist [note 1].
- zai-upstream: Local HTTP shim exposing sandbox's z-ai-web-dev-sdk for bridge routing [note 1].
- benchmarks/local-llm: llama.cpp + GGUF experiments against production remote model [note 1].
- pi-repo/packages/agent/scripts: Telemetry schema documentation generator.
- benchmarks/quality-axes: Deterministic suite measuring contradiction, staleness, forgetting, interference [note 1].
- pi-repo/packages/pi-protocol: Protocol types and encoding.
- pi-repo/packages/agent/src: Agent loop functions (agentLoop, agentLoopContinue, runAgentLoop).
- In Unown, `Shell.tsx` gates the embed `message` listener on the `embed` flag and routes `onReset` to the new POST sync route
- pi-repo/packages/pi-client: Transport-neutral client over framed CBOR bytes with lease modes.
- e2e: Playwright-based dashboard and landing page tests with axe-core accessibility [note 1].
- agent-service: Mini-service wrapper (port 3030) booting self-learning layer with REST+SSE API [note 1].
- llm-bridge: OpenAI-compatible gateway proxying to Dashscope with model allow-list [note 1].
- pi-repo: Pi agent harness monorepo with cross-platform shell entry points.
- pi-repo/packages/agent: Core Agent class with stateful wrapper, tool execution, event streaming.
- Nocturne's `escalation.ts` engine uses tiered escalation timers that fire ONLY while unacked/snoozed.
- Nocturne's `sla.ts` engine handles SLA ack/resolve breach detection with a 20% at-risk band that is frozen while snoozed.
- pi-repo/packages/ai: Unified LLM API with automatic model discovery, provider abstraction.
- benchmarks/selfimprove: Repeat-task efficiency experiments measuring memory impact [note 1].
- pi-repo/packages/agent/test: E2E integration tests with faux providers, proxy streaming tests.
- pi-repo/packages/ai/scripts: Build-time model catalog fetchers (models.dev, OpenRouter, Vercel, NVIDIA NIM).
- In `src/app/nocturne/api/_state.ts:loginSession`, allocate the session ID via `nextId(
- Seed rows in the Nocturne domain use `nc_seed_*` constants, while live rows are generated via `mulberry32`-based `nc_<kind>` helper functions to ensure deterministic ID generation.
- A separate, unrelated `dayKeyOf` function exists in `src/lib/sigil/stats.ts` which uses local-timezone ISO-input formatting.
- The new `src/lib/nocturne/format.ts` module includes a local `CheckoffDate` alias, cadence-verbatim date helpers (`weekdayShort`, `monthShort`, `formatLongDate`, `todayKey`, `dayKeyOf`), and parley-shaped `formatCountdown`/`formatDurationMs` functions (ms <= 0 → "0m", "45m", "2h 14m"). The module is pure with no use of `Date.now()`, DOM, or random functions.
- Nocturne test suite has 360 tests that all passed green in the session, followed by a typecheck verification step
- All three Nocturne domain layer files (`types.ts`, `ids.ts`, `clock.ts`) under `src/lib/nocturne/` follow parley conventions and satisfy the task specification in the plan document.
- The `src/lib/nocturne/types.ts` file in the worktree contains the full data model from `benchmarks/nocturne-round/plan.md` §1, defining 17 entity interfaces including NocturneTenant, NocturneUser, NocturneService, NocturneAlert, NocturneIncident, NocturneTimelineEvent, NocturneRunbook, and NocturneNote.
- Nocturne domain layer types use type-level refinements as single source of truth: `NocturneChecklistState.stepStates` is `Record<string, ChecklistStepState>` and `NocturneComponent.status` is `NocturneComponentStatus`, replacing inline union literals.
- The complete Nocturne build contract is written to `benchmarks/nocturne-round/plan.md` (~52 KB, matching the aria contract's completeness) and is grounded in the explored sibling lanes.
- OB-5 lane: the observability round verified that the in-session learning feed records dreams live.
- The OB-5 PTY capture lane runs the pane-is-truth contract at terminal dimensions 128x36
- In the OB-5 repaint lane, the feed chip must paint itself when a dream advances memory during an idle session; the listener contract repaints on push and is cleared at shutdown

## Manual notes

- Parley password hashing: scrypt N=16384 r=8 p=1 (src/lib/parley/password.ts). Restored by hand 2026-10-29 after AutoDream reconciles twice erased the fact (upstream 79->66 render, then the F1/F2 bcrypt poison round). Never let a memory answer overwrite this without reading the source.

<!-- unown: rendered 104/104 memories via Mem0 (backend: lexical) at 2026-10-31T10:02:16.894Z -->
