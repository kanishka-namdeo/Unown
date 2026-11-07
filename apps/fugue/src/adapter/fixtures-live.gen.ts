/* eslint-disable */
/**
 * fixtures-live.gen.ts — the H-24 LIVE-WIRE RECORDING (GENERATED —
 * never hand-edit; regenerate with scripts/a1/fixture-refresh.mjs).
 *
 * Captured: 2026-11-07T20:00:32.774Z
 * Engine:   http://127.0.0.1:3030 (self-learning v0.0.57)
 * Tree:     feba5680
 * Marker:   FIXTURE_REFRESH_20261107200032
 *
 * Every body below is a VERBATIM response from the live engine on the
 * routes the fugue adapter consumes. apps/fugue/src/adapter/
 * fixtures-live.test.ts runs each body through assertContract —
 * pin-vs-live drift REDDENS at the dotted path (the V-24 fiction class
 * cannot fossilize: the recording's source IS the live wire).
 */
export const FIXTURES_LIVE = {
  "captured": true,
  "provenance": {
    "capturedAt": "2026-11-07T20:00:32.774Z",
    "engineUrl": "http://127.0.0.1:3030",
    "engineVersion": "self-learning v0.0.57",
    "tree": "feba5680",
    "markerTitle": "FIXTURE_REFRESH_20261107200032",
    "tool": "scripts/a1/fixture-refresh.mjs (H-24)",
    "law": "the V-15 refresh: fixtures are DERIVED from the live wire, never hand-canned (the V-24 cure)"
  },
  "endpoints": {
    "create-automation": {
      "route": "POST /api/automations",
      "status": 200,
      "body": {
        "automation": {
          "id": "auto-mw6tvrfk-7br7ac",
          "title": "FIXTURE_REFRESH_20261107200032",
          "prompt": "Reply with exactly: OK (fixture-refresh marker; safe to delete)",
          "cron_expr": null,
          "delay_ms": null,
          "schedule_kind": "every",
          "interval_n": 1,
          "interval_unit": "d",
          "interval_at": null,
          "timezone": null,
          "until_ms": null,
          "misfire": null,
          "event_kind": null,
          "event_filter": null,
          "active_hours": null,
          "idle_only": 0,
          "deliver_url": null,
          "jitter_secs": null,
          "retry_max": null,
          "retry_backoff_secs": null,
          "retry_next_at": null,
          "retry_attempt": null,
          "retry_of_run": null,
          "spend_cap": null,
          "workspace": "/home/z/my-project/unown/mini-services/agent-service",
          "mode": "read-only",
          "model": null,
          "max_runs": null,
          "run_count": 0,
          "scheduled_run_count": 0,
          "lifecycle": "active",
          "next_run_at": 1794168000000,
          "last_run_at": null,
          "running": 0,
          "claimed_at": null,
          "dispatch_status": "idle",
          "dispatch_attempts": 0,
          "retry_at": null,
          "last_error": null,
          "created_at": 1794081632671,
          "updated_at": 1794081632671,
          "schedule": "every 1 day"
        }
      }
    },
    "overview": {
      "route": "/api/overview",
      "status": 200,
      "body": {
        "ok": true,
        "pid": 2265,
        "bootedAt": 1794080131241,
        "uptimeMs": 1501499,
        "phase": "ready",
        "drainBudgetMs": 10000,
        "agent": {
          "name": "pi (badlogic/pi-mono)",
          "layer": "self-learning v0.0.57",
          "provider": "zai-bridge/agnes-3.0-flash",
          "bridge": {
            "ok": true,
            "port": 3031,
            "requests": 98,
            "errors": 0,
            "upstream": {
              "ok": true,
              "status": 200
            },
            "local": null,
            "fallback": null,
            "failovers": 0,
            "degenerate": 1,
            "lanes": {
              "maxConcurrency": 3,
              "backgroundSlotLimit": 2,
              "backgroundYieldMs": 45000,
              "backgroundYielded": false,
              "lastInteractiveAt": 1794081207626,
              "inFlight": 0,
              "queued": {
                "interactive": 0,
                "background": 0,
                "live": {
                  "interactive": 0,
                  "background": 0
                }
              },
              "admitted": {
                "interactive": 84,
                "background": 15
              }
            },
            "upstreamKeyIsSet": true,
            "authRequired": false,
            "upstreamUrl": "https://apihub.agnes-ai.com/v1",
            "defaultModel": "agnes-3.0-flash",
            "models": [
              "agnes-3.0-flash",
              "agnes-2.5-flash",
              "agnes-video-2.5-flash",
              "agnes-image-2.1-flash",
              "agnes-image-2.0-flash",
              "agnes-image-2.5-flash",
              "agnes-2.5-pro-alpha",
              "agnes-2.5-pro-beta",
              "agnes-video-2.5"
            ],
            "upstreamModels": [
              "agnes-video-2.5-flash",
              "agnes-3.0-flash",
              "agnes-image-2.1-flash",
              "agnes-image-2.0-flash",
              "agnes-2.5-flash",
              "agnes-image-2.5-flash"
            ],
            "staleKnownModels": [],
            "modelSpecs": {},
            "learnedSpecs": {},
            "usageLog": {
              "file": "/home/z/my-project/unown/.run/usage-log.jsonl",
              "entries": 98
            }
          }
        },
        "version": {
          "version": "0.0.57",
          "gitSha": "404b07ad",
          "bootedAt": 1794080131241,
          "pid": 2265,
          "uptimeMs": 1501499,
          "api": 1
        },
        "dreamNews": {
          "id": "project-746cbae1-9af4-4e31-a089-8a9f1276fb0a",
          "project": "unown-066db0",
          "added": 4,
          "version": 1,
          "at": 1794081255966
        },
        "retention": {
          "dbBytes": 590744
        },
        "kpis": {
          "totalRuns": 1,
          "passed": 1,
          "failed": 0,
          "errors": 0,
          "passRate": 100,
          "tasks": 6,
          "improvementsShipped": 0,
          "dreams": 4,
          "notes": {
            "total": 7,
            "pending": 1
          },
          "hooks": {
            "total": 12,
            "denies": 0
          },
          "suite": {
            "total": 6,
            "passing": 1,
            "capability": 0,
            "regression": 6,
            "minted": 0,
            "graduated": 0,
            "quarantined": 0,
            "saturated": false
          },
          "tokens": {
            "in": 2025,
            "out": 416
          }
        },
        "memoryVersions": {
          "policy": 1,
          "project": 1,
          "user": 1,
          "local": 1
        },
        "trend": [
          {
            "ts": 1794080695611,
            "cumulativePass": 1
          }
        ],
        "routerBusy": false,
        "auth": {
          "mode": "token",
          "bind": "loopback"
        },
        "router": {
          "busy": false,
          "busyMs": 0,
          "activeJob": "",
          "jobTimeoutMs": 1200000
        },
        "governor": {
          "budget": {
            "callsHour": 15,
            "callsDay": 15,
            "tokensHour": 25920,
            "tokensDay": 25920,
            "limits": {
              "callsHour": 60,
              "tokensHour": 200000,
              "tokensDay": 2000000
            },
            "overBudget": false,
            "reason": null
          },
          "breaker": {
            "open": false,
            "consecutiveFailures": 0,
            "threshold": 3,
            "retryInMs": 0
          }
        },
        "memoryPlatform": {
          "available": true,
          "backend": "lexical",
          "embedderRequested": "auto",
          "reconcile": true,
          "dir": "/home/z/my-project/unown/data/self-learning/mem0",
          "model": "agnes-3.0-flash",
          "collection": "unown",
          "maxRendered": 110
        }
      }
    },
    "automations": {
      "route": "/api/automations",
      "status": 200,
      "body": {
        "automations": [
          {
            "id": "auto-mw6tvrfk-7br7ac",
            "title": "FIXTURE_REFRESH_20261107200032",
            "prompt": "Reply with exactly: OK (fixture-refresh marker; safe to delete)",
            "cron_expr": null,
            "delay_ms": null,
            "schedule_kind": "every",
            "interval_n": 1,
            "interval_unit": "d",
            "interval_at": null,
            "timezone": null,
            "until_ms": null,
            "misfire": null,
            "event_kind": null,
            "event_filter": null,
            "active_hours": null,
            "idle_only": 0,
            "deliver_url": null,
            "jitter_secs": null,
            "retry_max": null,
            "retry_backoff_secs": null,
            "retry_next_at": null,
            "retry_attempt": null,
            "retry_of_run": null,
            "spend_cap": null,
            "workspace": "/home/z/my-project/unown/mini-services/agent-service",
            "mode": "read-only",
            "model": null,
            "max_runs": null,
            "run_count": 0,
            "scheduled_run_count": 0,
            "lifecycle": "active",
            "next_run_at": 1794168000000,
            "last_run_at": null,
            "running": 0,
            "claimed_at": null,
            "dispatch_status": "idle",
            "dispatch_attempts": 0,
            "retry_at": null,
            "last_error": null,
            "created_at": 1794081632671,
            "updated_at": 1794081632671,
            "schedule": "every 1 day",
            "lastRun": null
          }
        ]
      }
    },
    "runs": {
      "route": "/api/runs?limit=5",
      "status": 200,
      "body": {
        "runs": [
          {
            "id": "8bf8a96c-b321-45a1-ab72-3253ff72e671",
            "task_id": "fix-fizzbuzz",
            "kind": "baseline",
            "status": "passed",
            "started_at": 1794080695611,
            "ended_at": 1794081063875,
            "sandbox_id": "fix-fizzbuzz-baseline-mw6tboe3-9bdi",
            "cycle_id": "6cc865e1-6298-488a-9b12-a28182c3f1be",
            "improvement_id": null,
            "tokens_in": 2025,
            "tokens_out": 416,
            "tool_calls": 4,
            "turns": 5,
            "error": null,
            "sandbox_isolation": "bwrap"
          }
        ]
      }
    },
    "dreams": {
      "route": "/api/dreams?limit=5",
      "status": 200,
      "body": {
        "dreams": [
          {
            "id": "project-b056671d-6f05-4d1e-a755-f562b8e41f2b",
            "started_at": 1794081065710,
            "ended_at": 1794081111165,
            "status": "done",
            "notes_in": 1,
            "entries_merged": 0,
            "entries_pruned": 0,
            "entries_added": 1,
            "output": "# Project Memory\n\n## Facts\n- In /tmp/vivace-canaries/c1, a hello.py script was created containing print(2 + 2) and executed with python3, producing the output 4.\n\n## Manual notes\n- Your own durable rules. AutoDream preserves this section verbatim — one\n  bullet per rule; everything outside it is re-rendered.\n\n<!-- unown: rendered 1/1 memories via Mem0 (backend: lexical) at 2026-11-07T19:51:51.164Z -->\n",
            "note": "project dream: c1-c51732 memory -> v1 (/tmp/vivace-canaries/c1)"
          },
          {
            "id": "project-3f029c31-8f91-42a5-8a72-61a3c9dd057f",
            "started_at": 1794081065710,
            "ended_at": 1794081159814,
            "status": "done",
            "notes_in": 1,
            "entries_merged": 0,
            "entries_pruned": 0,
            "entries_added": 3,
            "output": "# Project Memory\n\n## Known pitfalls\n- In /tmp/vivace-canaries/c2, the sum.ts file contained a bug where the sum function subtracted (a - b) instead of adding (a + b), causing test failures.\n- Fixed the sum.ts bug in /tmp/vivace-canaries/c2 by changing the return statement to a + b without modifying the test file, which resolved the two test failures.\n\n## Environment\n- The project in /tmp/vivace-canaries/c2 uses Bun version 1.4.3 (commit c6da4a4d3) for running tests.\n\n## Manual notes\n- Your own durable rules. AutoDream preserves this section verbatim — one\n  bullet per rule; everything outside it is re-rendered.\n\n<!-- unown: rendered 3/3 memories via Mem0 (backend: lexical) at 2026-11-07T19:52:39.813Z -->\n",
            "note": "project dream: c2-4ba513 memory -> v1 (/tmp/vivace-canaries/c2)"
          },
          {
            "id": "project-28b1bfcd-b45e-4938-91b3-2aba10051106",
            "started_at": 1794081065710,
            "ended_at": 1794081207186,
            "status": "done",
            "notes_in": 2,
            "entries_merged": 0,
            "entries_pruned": 0,
            "entries_added": 2,
            "output": "# Project Memory\n\n## Workflow\n- Use `grep -rl` to list files containing a pattern and `grep -rc` to get total count per file when auditing codebases\n\n## Facts\n- When delegating simple search/count tasks to subagents, specify the exact grep flags and include patterns in the prompt to ensure consistent results\n\n## Manual notes\n- Your own durable rules. AutoDream preserves this section verbatim — one\n  bullet per rule; everything outside it is re-rendered.\n\n<!-- unown: rendered 2/2 memories via Mem0 (backend: lexical) at 2026-11-07T19:53:27.185Z -->\n",
            "note": "project dream: c3-47ae83 memory -> v1 (/tmp/vivace-canaries/c3)"
          },
          {
            "id": "project-746cbae1-9af4-4e31-a089-8a9f1276fb0a",
            "started_at": 1794081065710,
            "ended_at": 1794081255966,
            "status": "done",
            "notes_in": 2,
            "entries_merged": 0,
            "entries_pruned": 0,
            "entries_added": 4,
            "output": "# Project Memory\n\n## Known pitfalls\n- In /home/z/my-project/unown, a live-wire pin test was written to assert the `passed` status; it initially failed because the live spelling differs from the expected value.\n- In /home/z/my-project/unown, fix apps/fugue/src/adapter/contract.ts time-lane to accept ISO strings; F-3 failure root cause is that assertRunRecord rejects the live automation-run wire form (trigger_kind + snake_case tokens/timestamps, no kind/toolCalls fields) because pin(payload, \"kind\", ...) throws on missing required 'kind'.\n- The `## Environment` heading itself is landing-quoted (loop.tsx:129) — restored by hand 2026-11-07 (SEVENTH occurrence of the issue #46 prune class — the render during the F-6 marathon took the heading again while the Manual-notes bullets survived); it lives in the Manual notes durable lane above and MUST survive every re-render.\n\n## Environment\n- In /home/z/my-project/unown, the e2e config boots serve.mjs with default env (LIVE lane); default FUGUE_NOTES_ROOT is repo root, and the live lane must keep working unchanged. Verified: e2e specs do not touch /manual-notes or /skills-staged routes.\n\n## Facts\n- In /home/z/my-project/unown, add an `emptyDoc` export to `migration.ts` to complete the L-2 storage-core deliverable.\n- In /home/z/my-project/unown, L-2 storage-core ticket for session 01a1b788 is closed and verified green on the current tree.\n- In /home/z/my-project/unown, the 8 deliverable lines from the L-2 brief are present in the working tree but uncommitted, per the resume protocol, with the operator to commit them via the draft-and-operator-land lane.\n- In /home/z/my-project/unown, no operator action is required to land the L-2 storage-core artifacts; the artifacts are already staged in the working tree as prescribed.\n- When fixing UI re-render defects triggered by user actions (like 'run-now'), ensure the fix addresses the specific re-render cause rather than just the symptom, validating that state updates do not trigger unintended full re-renders.\n- In /home/z/my-project/unown, the id-model mismatch between the engine seam and selection surface is resolved by keeping `RunRecordView.taskId` as `number` per the operator's scope ruling, curing the mismatch without widening the domain type.\n- The C-7 handoff in /home/z/my-project/unown verified that the `corrupt-quarantine` label was applied in `apps/chaconne/runner/store.ts` and its test `store-c7.test.ts`.\n- In /home/z/my-project/unown, F-5 module run-history.ts contains a `groupRuns` function that groups data by `taskId` and sorts newest-first\n- In /home/z/my-project/unown, Chunk 2 landed in `apps/fugue/src/ui/app.ts` by adding the seam read: the `FugueEngineConfig` interface, a `Window.__FUGUE_ENGINE__` declaration, and an `engineConfig()` helper, integrating with both client constructions including `appAdapter` at line ~552 and the `bootClient` path.\n- In /home/z/my-project/unown, F-5 chunk 4 scope gap: the runs-route e2e flow was unreachable because main() exposed no tab control and no job-row selection hook; per layer ruling, route tab bar and selection hooks are F-5 shell completion, not F-6\n- In /home/z/my-project/unown, the live e2e spec for the run-history view awaits the presence of the .fugue-run-row element rather than the grouped title, so numeric taskId grouping does not block the spec\n- In /home/z/my-project/Unown, the CI workflow for ostinato is configured in `.github/workflows/ci.yml`; the ostinato job's action pins were byte-copied from the coda job to keep them in sync.\n- In Unown's runner-core, the phase type for test verification accepts values 'front', 'revealed', and 'done'.\n- Split-write cap in /home/z/my-project/Unown can truncate files mid-write, leaving unterminated strings that hook flags; complete cut-off files by extending them with follow-up edits\n- When adding a new CI gate job to a GitHub Actions workflow, place it after existing dependent jobs to maintain logical build order.\n- benchmarks/polyglot: Aider polyglot benchmark with 50-exercise Exercism subset\n- C-7 changes in /home/z/my-project/unown involved `apps/chaconne/public/offline.html`, `apps/chaconne/scripts/{verify-precache.ts, verify-precache.test.ts, capture-usage.mjs}`, `e2e/chaconne-resilience.spec.ts`, and `apps/chaconne/runner/store.ts`.\n- benchmarks/local-llm/lib: Cross-platform llama-server lifecycle, OpenAI-compatible clients\n- Unown palette commands movePaletteSelection and runSelectedPaletteCommand verified gap-free after D10 rerender fix\n- In /home/z/my-project/Unown, `bun test apps/ostinato` runs the Lane B unit test suite from the project root and currently reports 93 passing tests across 7 files with 377 expectations.\n- Ticket A2H-2 in Unown: V-9 hardening landed in `scripts/tui-capture/pty_common.py` — added private `_send_drained()` helper where a reader thread pumps `self.pump(0.05)` until a stop event, joined in `finally` so `pump()` never runs concurrently with itself; wired into `send()`, `key()`, and `type_prompt()` (char loop and Esc/Enter tail) with caller semantics unchanged (same delays).\n- The e2e/chaconne-a11y.spec.ts file was extended to 7 test blocks / 10 tests, covering the dialog contract editor (role=dialog, aria-modal, attach-before-focus, Tab trap, Esc + focus restoration) at L243\n- C-9 a11y completion brief is defined in docs/rondo-round-session.md:474 and the PRD hardening map in docs/chaconne-prd.md:124-135; no separate .unown/receipts brief file exists for C-9\n- zai-upstream: Local HTTP shim exposing sandbox's z-ai-web-dev-sdk for bridge routing\n- In Unown's GitHub light color scheme, contrast ratios are verified as: foreground #1f2328 on #ffffff is ~14.5:1, and muted #57606a on #ffffff is ~6.5:1, both exceeding the 4.5:1 threshold for regular text.\n- In /home/z/my-project/Unown, the O-4 receipt workflow uses incremental chunk appends (chunks 3 and 7 explicitly referenced) with a cap on heredoc length, landing each chunk at the end of the previous turn's output before the cap.\n- Unown ticket O-4 chunk 1: `apps/ostinato/sw.js` updated to bump CACHE_NAME from v0 to v1, define a module-level PRECACHE_LIST with 15 entries, and rewrite the install handler to loop that list via Promise.all; activate/fetch handlers remain unchanged.\n- benchmarks/nonllm/lib: LexRank, MinHash-LSH, BM25+RRF, memory activation scoring\n- In Unown's ostinato app, Chunk 3 of the O-4 implementation landed app.ts changes including the CreateActions type, AppState fields, notice refactor, create actions, onKey branch, dispatch cases, renderBoot tail, advanceSession clear, and four form functions, along with `.ostin` CSS updates.\n- Wire answer_flushed through the answer-watch extension, and wire drain start/done events plus final exit events into cmdPrint in Unown's cli.ts.\n- benchmarks/selfimprove: Repeat-task efficiency experiments measuring memory impact\n- e2e: Playwright-based dashboard and landing page tests with axe-core accessibility\n- blueprint/sandbox/scenarios: Integration tests for tiered memory, hooks, AutoDream, self-improvement loop\n- Place Playwright e2e test files (specs and configs) at the repository root, not in app-specific directories, following the 'Coda precedent' architecture.\n- benchmarks/local-llm: llama.cpp + GGUF experiments against production remote model\n- pi-repo/packages/agent/test: E2E integration tests with faux providers, proxy streaming tests\n- pi-repo/packages/ai/scripts: Build-time model catalog fetchers (models.dev, OpenRouter, Vercel, NVIDIA NIM)\n- pi-repo/packages/agent/scripts: Telemetry schema documentation generator\n- agent-service: Mini-service wrapper (port 3030) booting self-learning layer with REST+SSE API\n- benchmarks/mpbench: MPBench dataset adapter for poisoning defense measurement\n- benchmarks/longhorizon: Multi-file refactoring task benchmark using clippad fixture\n- benchmarks/nonllm: Local ONNX models (bge-small/MiniLM, ms-marco) and symbolic lanes\n- blueprint/memory: Tiered memory stack observability mirroring CLAUDE.md hierarchy\n- The engine serves routines under /api/automations (REST) in pi-repo/packages/self-learning/src/server.ts handleApi; there is no /api/routines route; CLI alias `unown routines` maps to the automations endpoints.\n- benchmarks/poison-corpus: Adversarial memory poisoning defense evaluation\n- blueprint/dreams: Auto-dreaming driver consolidating session notes via headless Claude\n- benchmarks/memory-eval/recall-qa: LongMemEval-adapted multi-session QA-recall benchmark\n- clippad: Note-taking domain module with Notebook, UserDirectory, search, formatting\n- llm-bridge: OpenAI-compatible gateway proxying to Dashscope with model allow-list\n- blueprint/router: GitHub event dispatcher with headless Claude sessions, tightly controlled tool allowlist\n- benchmarks/quality-axes: Deterministic suite measuring contradiction, staleness, forgetting, interference\n- Save screenshots to specific benchmark directories like benchmarks/browser-autonomy-round/screenshots/ for warm-start scenarios.\n- Unown's SM-2 scheduler in scheduler.ts had an inverted Wozniak formula; the correct interval computation is EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02)) with q mapped as g-1\n- Unown project in /home/z/my-project/Unown has a known editor flaw where write mode body editing is not properly captured; this was identified and fixed during a session\n- v3-fixture/tests: membench benchmark fixture tests for calc, stats, format, persist, search\n- blueprint/harness: Self-improving evaluation harness with golden tasks and weakness clustering\n- Unown Coda (`apps/coda/`) architecture: self-contained static vanilla-TS PWA, no workspaces, zero root deps, reuses `marked`/`fuse.js`/`@playwright/test`/`@axe-core/playwright` via upward resolution from root node_modules\n- Fleet journal persists to .unown/fleet/journal.jsonl via appendFleetJournal/readFleetJournal (recordFleetChildSpawn, recordSyncSubagentSpawn, recordFleetChildFinish for finished; sweep outcomes for reaped/abandoned). FleetJournalEntry (pi-repo/packages/self-learning/src/fleet-reaper.ts:137) defines five ops: spawned (lane 'fleet' or 'sync'), worktree, finished, reaped, abandoned. Op discriminants recorded by recordFleetChildFinish (finished) and sweep outcomes (reaped/abandoned).\n- After DOM mutations or page changes, browser snapshot refs become stale; re-snapshot the page before acting on the new state.\n- The Unown syntax-checker hook cannot parse TypeScript; run an inline Node-style script via `bun` instead and keep the script as a test file for reproducibility (the hook excludes it from its own scan).\n- blueprint/sandbox: Disposable keyless test rig with synthetic HOME, offline operation\n- benchmarks/longhorizon/task/tests: clippad test suite for store, CLI, author, notebook\n- The Unown interactive-mode-status.test.ts file contains an old coalescing test that was retargeted to verify refresh behavior following the showStatus fix in ticket A2H-1.\n- Locate design tokens in `src/app/globals.css` by distinguishing between the `@theme inline` shadcn bridge and the non-inline `@theme` landing-palette block (GBA 5-bit grid).\n- A probe that sets a setting to its current value produces no detectable drift; construct targets as current plus offset, and load-time validation flags any task whose diskCheck.expect equals the item's declared default as diff-inert (BM-2 hook-depth task is honest about this).\n- When editing `src/domain/*.ts` files, natural prose containing words like 'document.' is permitted because the DOM global verifier only bans actual global object member access, not incidental text matches.\n- Phantom settings drift (8 interface items) occurs when declared default fields are written from the pi selector's row states instead of the vendored settings-manager getters, causing /settings diff to show 8 phantom drift rows on every fresh install; the remedy is to align each declared default with the resolver's value and add provenance comments.\n- Export installPrintStallWatchdog from cli.ts and import createPrintExitTrace, printExitTraceEnabled, and resolvePrintTraceDir from print-exit-trace.ts in Unown's test suite.\n- markdown.ts is confirmed to be outside the runtime import closure\n- The `find` tool backend is unavailable in the Unown project; use directory listings instead to enumerate the `src/` tree. Verified via subagent session.\n- In src/lib/review.ts, parseReviewOutput (lines 455-475) uses static regexes over model output so treated data cannot become code injection, and the git() helper (lines 114-121) calls spawnSync with array args and shell:false; a security review of the /cadence diff (since commit 94d7cb1d) confirmed no new injection surface.\n- Rule of thumb: a declared default is a contract against the real resolver; always pin it in a test or it will drift.\n- Guard habit-sync effects with a `sessionHabitsRef` reference to prevent unnecessary re-renders or sync conflicts.\n- The six landing-page benchmark suites are defined in the TRACKS array at scripts/landing_benchmarks.mjs:79, which writes to src/components/landing/benchmarks-data.ts; the authoritative contract is documented in benchmarks/AGENTS.md under \"The landing-page feed\".\n- Pin the no-phantom-drift invariant with test/settings-defaults-drift.test.ts plus the BM-8 guard on a pristine home: run the test in a subprocess because some settings getters resolve through term.ts's module-scope UNOWN_HOME snapshot and an in-process run can read earlier tests' leftovers.\n- In /home/z/my-project/unown, e2e smoke spec palette assertion count was updated from 11 to 13 in `e2e/fugue-smoke.spec.ts`\n- In /home/z/my-project/unown, live fugue engine is reachable; automation list is empty because the probe cleaned up its routine; all acceptance checks passed.\n- Frame-hardening headers (Content-Security-Policy frame-ancestors 'self' and X-Frame-Options SAMEORIGIN) were added to the `/encore/:path*` route in `next.config.ts`, matching the pattern already established for sibling routes `/nocturne`, `/cadence`, `/aria`, and others.\n- pi-repo/packages/pi-protocol: Protocol types and encoding.\n- Cadence domain layer lives at `src/lib/cadence/` mirroring bazaar/sigil sibling conventions: pure domain code, bun:test for tests, localStorage shim in tests, and happy-dom preload configured via bunfig.\n- pi-repo/packages/self-learning/src/delegation.ts owns renderDelegationCard (line 170), renderDelegationChip, deriveWorthLine, and the delegation ledger; it is imported by tools.ts at lines 78 and 3736 to notify the TUI.\n- The changes to .unown/memory/project.md, project.provenance.json, and serve.mjs are pre-existing from landed F-7 chunk 3 or earlier sessions; verify they are not modified in new chunks\n- The only allowed file write for the new isolation-pin test is the creation or rewriting of apps/fugue/test/isolation-pin.test.ts, which is a verified ALLOWED_INPUTS path\n- In /home/z/my-project/unown, use Bun.spawn to run the e2e server process.\n- Resolve the `.unown/` directory root by going two levels up from the `apps/fugue` subdirectory.\n- In /home/z/my-project/unown, V-15 pin permits modifying `runner/fixture-server.ts` to align canned JSON with both-forms contract despite it being outside ALLOWED_INPUTS\n- In /home/z/my-project/unown, the e2e spec `e2e/fugue-live.spec.ts` uses lane-pinned selectors for test stability and expects the final engine row with a 30,000ms timeout because the live engine's create plus full boot chain involves 4 sequential round-trips that exceed the default wait (as implemented by `createRoutineViaUi`).\n- In /home/z/my-project/unown, the e2e io battery uses Playwright to intercept export downloads: the app downloads via Blob + object URL + anchor click, and imports via file input\n- In /home/z/my-project/unown, the Manual-notes over-cap [data-mn-overcap] block is only created by the input handler if it already exists (updating in place), so the e2e test pins edge 11 via the always-rendered meter over-cap line (`4097 / 4096 chars — over cap…`) with data-mn-over=\"1\" and uses a conditional assert on the block\n- In /home/z/my-project/unown, e2e test isolation must not write to the real .unown directory; verify by asserting byte-identical files before and after test runs\n- In /home/z/my-project/unown, the export flow builds canonical bytes via exportBytes(recomputeNextId(state.data)), wraps them in a Blob and URL.createObjectURL, triggers a hidden <a download=\"fugue-export.json\"> click, and an empty store still exports successfully\n- Unown project CLI entrypoint is bin/unown, a Bun script that boots pi-repo/packages/self-learning/src/boot.ts to drive the TUI, headless mode (-p), --plan, and subcommands; additionally, a print exit trace is wired via pi-repo/packages/self-learning/src/print-exit-trace.ts and integrated into installPrintStallWatchdog, cmdPrint, and cli.ts.\n- In /home/z/my-project/unown, add tabindex=\"0\" to .fugue-palette-list (role=listbox) to prevent axe flagging focusable-content violations\n- Ensure that focus management utilities handle edge cases where the trigger element is removed from the DOM before the dialog closes, falling back to body or a stable container.\n- Focus trap implementations should intercept the Escape key at the palette or modal level to prevent focus from escaping the contained element, and must release focus to a previously saved trigger element upon close.\n- When adding aria-labelledby to a dialog, verify the label ID exists in the DOM and that the dialog's role is explicitly set to 'dialog' or 'alertdialog' to ensure screen reader compatibility.\n- In /home/z/my-project/unown, the F-9 a11y lane is complete: all e2e gates pass with zero WCAG2AA violations across both light and dark schemes for the jobs, runs, dreams, memory, palette-open, and compose-open views, verified via axe-core scans (wcag2a + wcag2aa). The remaining dark-scheme verification was closed out in this lane; no outstanding contrast checks remain for these views. (Supersedes per-scheme status notes.) Reason: Merged the lane-complete status (80299131), the policy+views description (87f03ba2), the fixed-12-violations record (f92ff7bf), and the per-scheme status notes (75c4753e, 828826f7, 3c8facb6) into one coherent, forward-looking fact; preserved the durable policy and the verification method; kept the reference to f92ff7bf as a supporting fact. Deleted the transient/complete-state notes as they add no value to future sessions and were redundant with this consolidated statement.\n- In /home/z/my-project/unown, compose dialog's aria-labelledby must point at the h2's id (fugue-compose-dialog-title), not the title input's id\n- Fix F-9 a11y accent-ink trap in /home/z/my-project/unown by scheme-pairing badge text: light uses --fugue-accent/--fugue-ink, dark uses fixed #9fd4b5 (pale green, 7.2:1 contrast on accent-mix bg); do not use --fugue-accent-ink for dark-scheme badges\n- In /home/z/my-project/unown Fugue CI, the live lane is intentionally excluded from the workflow (noted as the operator's off-peak witness lane) and flagged via a comment.\n- F-9 accessibility lane in /home/z/my-project/unown enforces a zero-violation policy with scans per scheme (light and dark) covering wcag2a and wcag2aa across jobs, runs, dreams, memory, palette-open, and compose-open views; all gates are green on completion.\n- F-10 deliverables in /home/z/my-project/unown include `docs/fugue.md`, structured following the `docs/chaconne.md` pattern, with sections covering: What it is, Run it, Test it, architecture story, engine-adapter seam ruling, learning-views story, PWA story, dependency ruling, a11y lane, FUGUE_NOTES_ROOT law, landing band's stills, and Related pages.\n- In /home/z/my-project/unown, the landing page hue-walk test expects the 'gold' hue (associated with Fugue) at position 9, situated between the 'aqua' hue of Chaconne and the 'magma' hue of Proof, ensuring no color clashes.\n- Fugue CI job in /home/z/my-project/unown mirrors chaconne and ostinato: checkout, setup-bun, frozen-lockfile, zero-dep hash assert, Lane A via `cd apps/fugue && bun test` (283 tests), Chromium install, e2e battery (23+1 specs), and artifact upload.\n- In /home/z/my-project/unown, root package.json scripts are additive-only: `fugue:dev`, `fugue:test`, and `fugue:e2e` were added to mirror the existing chaconne and ostinato patterns.\n- In /home/z/my-project/unown, the landing page structure test (src/app/__tests__/landing-page.test.tsx) expects SECTION_COUNT of 15 and a specific band-order where 'fugue' is at index 9, positioned between Chaconne (index 8) and Proof (index 10).\n\n## Manual notes\n\n- Failed cycles auto-recover — do NOT restart engine to fix them. (Restored by hand 2026-11-07 during the 28th/29th-lineage F-5 reconciliation — SIXTH occurrence of the dream-render-prunes-landing-quoted-lines class, issue #46: this render pruned the restored durable lane AGAIN. The landing's loop.tsx memory preview quotes this line; the claims gate reddens without it. This Manual notes lane is its durable home.)\n- Stealth verification suite on bot.sannysoft.com: all 10 checks (webdriver, userAgent, platform, userAgentData, timezone, locale, screen, viewport, plugins, window.chrome) pass; 0 FAIL rows in Intoli tests. (Restored by hand 2026-11-07 — sixth occurrence, issue #46 class; durable home here.)\n- bin: Cross-platform CLI launcher (Unix shebang, Windows cmd/ps1) [note 1]. (Restored by hand 2026-11-07 — sixth occurrence, issue #46 class; the landing's loop.tsx quotes this line; durable home here.)\n- Remove unused variable declarations (e.g., `void seedStore;`) to keep builds clean. (Restored by hand 2026-11-07 — sixth occurrence, issue #46 class.)\n- For high-reliability frontend or browser-based CI steps, use Chromium with headless flags to ensure consistent rendering and testing in containerized environments. (Restored by hand 2026-11-07 — sixth occurrence, issue #46 class; the pair bullet of the Environment heading below.)\n- NINTH occurrence receipt (2026-11-07, the thirty-first lineage): the 30th's F-7-item-1 session renders took the ENTIRE durable lane again (the second whole-lane loss today — the fifth-occurrence class escalated) plus the Workflow and Environment headings; all restored from the af126efb known-good. The H-22 memory-guard (the pre-commit diff flag, operator toolchain) lands with this restore.\n- TENTH occurrence receipt (2026-11-07, the thirty-first lineage): the F-7 chunk-3 A2 session VIOLATED the brief's FORBIDDEN_INPUTS — it booted the real serve.mjs on :4017 and PUT-tested against the REAL project.md (20k-char bodies), then 'restored' the section to a single placeholder bullet, destroying the durable lane. CAUGHT BY THE H-22 MEMORY-GUARD at the operator's commit boundary (11 protected lines flagged, its first live catch — the diff preserved in the ring buffer). V-28 filed; the FUGUE_NOTES_ROOT isolation cure rides chunk 3b. The bullets above are the af126efb-lineage known-good.\n\n<!-- unown: rendered 110/112 memories via Mem0 (backend: lexical) · 2 oldest pruned at render (cap 110; hard-won rules immune) at 2026-11-07T19:54:15.964Z -->\n",
            "note": "project dream: unown-066db0 memory -> v1 (/home/z/my-project/unown)"
          }
        ]
      }
    },
    "notes": {
      "route": "/api/notes?limit=5",
      "status": 200,
      "body": {
        "notes": [
          {
            "id": "4a0fb195-356d-4408-b7c4-3fd4f53c7fbf",
            "run_id": "8bf8a96c-b321-45a1-ab72-3253ff72e671",
            "content": "Run 8bf8a96c (baseline) on task fix-fizzbuzz: PASSED\nVerification: all tests passed\nTools used: 4 calls (read, edit, bash)\nAgent's final words: Fixed. The bug was that multiples of 15 were caught by the `% 3 === 0` branch first, so \"FizzBuzz\" was never emitted.\n\n**Change in `fizzbuzz.js`:** check `% 15 === 0` first (before the `% 3` check), then `% 3`, then `% 5`, then fall back to the number itself.\n\n**Verification:** `bun fizzbuzz.test.mj",
            "created_at": 1794081063876,
            "dream_id": null,
            "kind": "benchmark",
            "project_path": null,
            "project_slug": null
          },
          {
            "id": "d9d0dd29-93f9-4b56-826f-ca372a3ca0dd",
            "run_id": null,
            "content": "Terminal session outcome in /home/z/my-project/unown:\nFinal outcome: L-2 is closed. **L-2 storage-core ticket for session 01a1b788 is complete and verified green on this tree** — the full verdict evidence and deviation ledger are quoted below; no operator action is required to land the artifacts (the brief's 8 deliverable lines are in the working tree, uncommitted, exactly as the resume protocol prescribes — the operator commits via the draft-and-operator-land lane\nSession metadata (counts, duration and session id only — data, not knowledge): 2 prompt(s), 31 tool call(s) (edit, read, write, bash), 3 min, session 284daf8a.",
            "created_at": 1794081028314,
            "dream_id": "project-746cbae1-9af4-4e31-a089-8a9f1276fb0a",
            "kind": "terminal",
            "project_path": "/home/z/my-project/unown",
            "project_slug": "unown-066db0"
          },
          {
            "id": "0ba9c0f7-968e-456d-a41b-ad20a1749db5",
            "run_id": null,
            "content": "Terminal session outcome in /home/z/my-project/unown:\nFinal outcome: Now add the `emptyDoc` export to migration.ts:\nSession metadata (counts, duration and session id only — data, not knowledge): 2 prompt(s), 37 tool call(s) (read, bash, edit, write), 4 min, session bb2305bd.",
            "created_at": 1794080810203,
            "dream_id": "project-746cbae1-9af4-4e31-a089-8a9f1276fb0a",
            "kind": "terminal",
            "project_path": "/home/z/my-project/unown",
            "project_slug": "unown-066db0"
          },
          {
            "id": "8a861e0e-d65b-465d-b9ab-6b89c1b6b464",
            "run_id": null,
            "content": "Terminal session outcome in /tmp/vivace-canaries/c3:\nFinal outcome: Delegated to a subagent (grep-based count). Results:\n\n- **total_todos:** 4\n- **files_with_todos:** alpha.ts, beta.ts, gamma.ts\n- **delegated:** true\n\nCommands the subagent used:\n```\ngrep -rc \"TODO\" --include=\"*.ts\" .\ngrep -rl \"TODO\" --include=\"*.ts\" .\n```\nSession metadata (counts, duration and session id only — data, not knowledge): 2 prompt(s), 1 tool call(s) (task), 1 min, session b0969fd3.",
            "created_at": 1794080194754,
            "dream_id": "project-28b1bfcd-b45e-4938-91b3-2aba10051106",
            "kind": "terminal",
            "project_path": "/tmp/vivace-canaries/c3",
            "project_slug": "c3-47ae83"
          },
          {
            "id": "7d11394b-c87c-4968-8e5c-596ca5a60198",
            "run_id": null,
            "content": "Terminal session [subagent] outcome in /tmp/vivace-canaries/c3:\nFinal outcome: Commands used:\n\n```\ncd /tmp/vivace-canaries/c3 && grep -rc \"TODO\" --include=\"*.ts\" .\ncd /tmp/vivace-canaries/c3 && grep -rl \"TODO\" --include=\"*.ts\" .\n```\n\ntotal_todos: 4\nfiles_with_todos: alpha.ts,gamma.ts,beta.ts\nSession metadata (counts, duration and session id only — data, not knowledge): 1 prompt(s), 2 tool call(s) (bash), 1 min, session 6d2d5226.",
            "created_at": 1794080193431,
            "dream_id": "project-28b1bfcd-b45e-4938-91b3-2aba10051106",
            "kind": "terminal",
            "project_path": "/tmp/vivace-canaries/c3",
            "project_slug": "c3-47ae83"
          }
        ]
      }
    },
    "memory": {
      "route": "/api/memory",
      "status": 200,
      "body": {
        "tiers": [
          {
            "tier": "policy",
            "version": 1,
            "content": "# Tier 0 — Policy (non-negotiable guardrails)\n\n- Never delete or overwrite files outside the current working directory.\n- Never install packages, start network listeners, or contact external hosts.\n- Always verify your work by running the provided tests before declaring success.\n- Keep changes minimal: fix exactly what the task asks for.\n- If a verification fails, inspect the failure output and fix the root cause — never edit tests to make them pass.\n- Read a file before editing it, and match the style and conventions already in it.\n- When a check fails, fix the root cause and re-run it — never report success with a failing check.\n",
            "chars": 639,
            "updatedAt": 1794080094957
          },
          {
            "tier": "project",
            "version": 1,
            "content": "# Project Memory\n\n## Workflow\n- Verification is automated: a verify script executes after your turn; its output is ground truth.\n- The workspace contains a small Node/Bun project with tests. Run tests with `bun <testfile>`.\n\n<!-- unown: rendered 2/2 memories via Mem0 (backend: lexical) at 2026-11-07T19:34:55.281Z -->\n",
            "chars": 319,
            "updatedAt": 1794080095281
          },
          {
            "tier": "user",
            "version": 1,
            "content": "# Tier 2 — User Memory\n\n- The user values minimal diffs and clear, idiomatic code.\n- Prefer standard library functions over hand-rolled logic.\n",
            "chars": 143,
            "updatedAt": 1794080094957
          },
          {
            "tier": "local",
            "version": 1,
            "content": "# Tier 3 — Local Overrides\n\n(empty — most specific tier; anything here overrides the tiers above)\n",
            "chars": 98,
            "updatedAt": 1794080094958
          }
        ],
        "resolvedChars": 2339
      }
    },
    "memory-health": {
      "route": "/api/memory/health",
      "status": 200,
      "body": {
        "health": {
          "scope": "unown-engine",
          "lastReconcile": 1794081255960,
          "duplicateCount": 0,
          "conflictCount": 0,
          "warnings": [],
          "memoryCount": 2
        },
        "platform": {
          "available": true,
          "backend": "lexical",
          "embedderRequested": "auto",
          "reconcile": true,
          "dir": "/home/z/my-project/unown/data/self-learning/mem0",
          "model": "agnes-3.0-flash",
          "collection": "unown",
          "maxRendered": 110
        }
      }
    },
    "spend": {
      "route": "/api/automations/spend",
      "status": 200,
      "body": {
        "now": 1794081632767,
        "routines": [
          {
            "id": "auto-mw6tvrfk-7br7ac",
            "title": "FIXTURE_REFRESH_20261107200032",
            "spend_cap": null,
            "day": {
              "tokens": 0,
              "runs": 0,
              "turns": 0
            },
            "week": {
              "tokens": 0,
              "runs": 0,
              "turns": 0
            },
            "effective_cap": null,
            "throttled": false,
            "drain_ms": null
          }
        ],
        "total": {
          "day": {
            "tokens": 0,
            "runs": 0,
            "turns": 0
          },
          "week": {
            "tokens": 0,
            "runs": 0,
            "turns": 0
          },
          "cap": 0,
          "throttledNow": false,
          "drainAt": null
        }
      }
    },
    "automation-runs": {
      "route": "/api/automations/auto-mw6tvrfk-7br7ac/runs",
      "status": 200,
      "body": {
        "runs": []
      }
    },
    "delete-automation": {
      "route": "DELETE /api/automations/:id",
      "status": 200,
      "body": {
        "ok": true
      }
    }
  }
} as const;
