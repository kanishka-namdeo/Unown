# The fresh-clone round — session log

- **Round**: fresh-clone (operator-directed bring-up: clone → setup → run, then the blockers it surfaces)
- **Started**: 2026-11-01
- **Status**: in flight
- **Baseline**: `d8f87131` (main, post v0.0.55)
- **Operator directive**: clone, setup and run the repo on a fresh machine; remember and use the PAT + the Agnes AI endpoint (`https://apihub.agnes-ai.com/v1`, `agnes-3.0-flash`); operate under the Plan Mode V3 orchestrator methodology (capability audit before generation, specialist delegation, synthesis, validation, retrospective, learning extraction); document every checkpoint; push every milestone; production-quality edge-case work; extensive online research to stay grounded.

This is the resumable log: every milestone records what was done, the receipts, and what remains. A resumed session reads this file first.

---

## Capability audit (the Plan Mode V3 contract, applied to this round)

| Capability | Verdict | Reason |
|---|---|---|
| Tiered memory | USED | the project tier (`.unown/memory/project.md`) carries the browser-autonomy rounds' rules; read before editing |
| Existing skills | SKIPPED | `.unown/skills/` starters are session-facing, not bring-up-facing; nothing applies to install verification |
| Existing workflows | USED | the repo's own quickstart (README §Quickstart + docs/install.md) is the canonical bring-up workflow |
| Standing orders | USED | root AGENTS.md User Preferences (Agnes endpoint, metered tier, PAT-in-remote) bound this round from the start |
| Existing routines | SKIPPED | no scheduled runs apply to a one-shot bring-up |
| RepoMap context | USED | subagent-mapped the repo (setup mechanics, provider lanes, plan-mode V3 surfaces, DOX tree) before any command ran |
| Project context | USED | `docs/SESSION.md` + the prior rounds' logs (plan-mode V3 M1–M8, security, dependency) read first — this round resumes their open items |
| Prior learnings | USED | the plan-mode V3 retrospective names the open lanes this round picks up (PT-5 live specialist receipt; golden-pin cost) |
| Prior benchmarks | USED | `benchmarks/plan-mode/` receipts are the baseline PT-4 numbers |
| Agent patterns | USED | the two-subagent research split (repo explorer + online researcher) from the V3 round's retrospective, reused with a scope cap |
| Subagent delegation | USED | 2 subagents (repo mechanics mapper; online grounding researcher) — bring-up itself stayed with the orchestrator (credential handling) |

## M1 — bring-up (2026-11-01) ✅

**Goal**: fresh clone fully running: toolchain, install, services, live chat through the Agnes upstream.

Environment:

- Debian 13 (trixie) x86_64, Node 24, 3.9 GiB RAM; clone at `/home/z/my-project/Unown` @ `d8f83131` (main)
- **bun pinned to 1.4.3** (not 1.4.4): upstream has an open frozen-lockfile regression with optional deps on 1.4.4 (bun #46510); 1.4.3 is the repo's own `packageManager` pin and reads pi-repo's `lockfileVersion: 3`
- PAT configured per the repo's own convention (root AGENTS.md: "The GitHub PAT lives only in the git remote URL")
- `.env` created from `.env.example` by the installer; `BRIDGE_UPSTREAM_KEY` set to the Agnes AI key (`BRIDGE_UPSTREAM_URL=https://apihub.agnes-ai.com/v1`, `BRIDGE_MODEL=agnes-3.0-flash` — the tracked defaults)
- `UNOWN_NO_ENGINE_SERVICE=1` for the sandbox install (no OS service; engine runs via `bun run agent:start`)

Receipts:

- `bun run agent:install` — 7/7 steps: root + pi-repo deps, provider model data hydrated, all pi packages built (coding-agent bundle 52 files / 8.5 MiB), `.env` + mini-service links, `~/.local/bin/unown` shim, engine service skipped (env flag)
- `bun run agent:start` → bridge pid 3274 + engine pid 3275 up
- `curl :3031/health` → `{"ok":true,"upstream":{"ok":true,"status":200},"upstreamKeyIsSet":true,"models":["agnes-3.0-flash","agnes-2.5-flash","agnes-video-2.5-flash","agnes-image-2.1-flash","agnes-image-2.0-flash","agnes-image-2.5-flash"],"defaultModel":"agnes-3.0-flash"}` — the Agnes upstream answers live, all six catalog models discovered
- `curl :3030/api/overview` (bearer) → `{"ok":true,"phase":"ready","agent":{"provider":"zai-bridge/agnes-3.0-flash",…}}`
- `unown setup --provider bridge` → "✓ configured the bundled bridge (agnes-3.0-flash)"
- `unown doctor` → **"unown is ready to chat"** — 16 ✓, 1 ⚠ (LSP servers none detected — optional, documented); model specs verified `zai-bridge/agnes-3.0-flash: 524,288 ctx / 65,536 out (curated catalog)`; bubblewrap sandbox `fs+net isolation active` (vendored `pi-repo/packages/self-learning/native/bin/bwrap`)
- End-to-end live chat: `unown -p "Say hello and state which model and provider you are running through…"` → the answer arrived and is receipted in the session JSONL (`~/.unown/agent/sessions/2026-11-01T17-30-02-029Z_…jsonl`, final assistant message: "Hello! I'm Agnes-3.0-flash, developed by Sapiens AI, running through the Agnes AI endpoint.") and the bridge usage log (3× `status:"ok"` on `agnes-3.0-flash`) — **but the CLI process did not exit afterwards**: killed at the 150 s timeout guard. This is **issue #30** (the documented cli.ts F10 hang class), reproduced on the very first headless run — see M2.

No tracked-file changes in M1 itself (`.env` and runtime state are gitignored by design); this session log + the SESSION.md index update are the M1 commit.

---

## M1-resume — bring-up on the recycled lineage (2026-11-02)

**Context**: the sandbox was recycled after M1; this session re-cloned `main` @ `5fe50ca8` into `/home/z/my-project/Unown` (the round's own M1 commit included) and repeated the full bring-up to prove the fresh-clone contract holds on a second cold machine, then opened the A1 ground truth.

Receipts (all 2026-11-01T21:xxZ):

- bun re-pinned to **1.4.3** (npm i -g bun@1.4.3); `UNOWN_NO_ENGINE_SERVICE=1 bun run agent:install` — **7/7 green** again.
- `.env` from `.env.example`: Agnes upstream key set, `BRIDGE_MODEL=agnes-3.0-flash`, and `UNOWN_HOME=/home/z/my-project/unown-home` (persistent across recycles — the recovery-session convention).
- Stack: bridge `:3031` (upstream ok **200**, 6 agnes models), engine `:3030` (phase `ready`, v0.0.55 @ 5fe50ca8).
- `unown setup --provider bridge` ✓; `unown doctor` — **ready to chat**, 18 ✓ / 1 ⚠ (no LSP in container).
- **Issue #30 probe: 6/6 clean headless runs** (`unown -p "Reply with exactly: UNOWN_OK"` → `UNOWN_OK`, exit 0, 1.4–3.4 s each; 6× `status:"ok"` in the bridge usage log; session JSONLs under `$UNOWN_HOME/agent/sessions/`). Sharper datum for M2: the issue's own text correlates hangs with **active engine-harness windows** — all 6 of today's runs were against an idle engine, so the repro lane below now combines `unown -p` loops with live engine churn.
- `A2_GROUND_TRUTH.md` authored at the repo root (dated capability snapshot; 8 doc-drift flags found; the utilization audit classifies #30 as *triggered-but-unverified* — Level 4 instrumentation lane).

---

## M2 — issue #30: the `unown -p` exit hang (COMPLETE, 2026-11-02)

**Observation (first run, prior sandbox)**: the answer flushed to the session receipt at 17:30:09.8; the process was still alive at kill time (150 s later), matching the issue's symptom exactly (answer arrives → process never exits → survives SIGTERM; bridge clean: 0 errors, 0 in-flight during the hang).

**Issue #30's own requests (fetched live 2026-11-02)**: (a) a /proc-level stack capture the next time it happens live, with a watcher armed; (b) an instrumented build that logs which exit path (agent_end / stall watchdog / hard-exit / drain) is pending when the answer flushes.

**Plan (refined after the 6/6 idle-engine non-repro)**:

1. **Watcher lane (operator-authored harness, repo scripts/)**: a bounded loop of `unown -p` runs with an armed monitor — if a run outlives its answer by >N seconds, capture `/proc/<pid>` evidence (status, wchan, syscall, fds, net/tcp, timers) before SIGKILL. Run it twice: once against an idle engine, once with live engine churn (forced dream run / harness cycle via the engine API) — the issue's correlation window.
2. **Ticket through A2** (headless session in this repo, evidence pack attached): read the print-mode exit paths in `pi-repo/packages/coding-agent` print mode + the `boot()` seam in self-learning; classify root cause; fix in locally-owned code only (pi-repo vendored files only with precedent-level justification); pin with a test; receipt everything.
3. If no repro within the bounded budget: the honest receipt is the non-repro evidence + the instrumentation ticket (the issue's request (b)) shipped as the deliverable — a permanent exit-path telemetry lane, not a blind fix.

**Watcher probe result (2026-11-02)**: `scripts/issue30_watcher.mjs` (the armed watcher the issue requests, committed) ran the bounded budget — idle lane 8/8 clean (1.4–3.3 s each) and dream-churn lane 8/8 clean (1.4–2.4 s each; `POST /api/dreams/run` → `{"started":true,"pendingNotes":9}`, mid-loop trigger → 409 engine-busy, i.e. the loop genuinely overlapped active harness/dream LLM work). Including the six M1-resume runs: **22/22 clean headless runs on this lineage, zero hangs**. Classification stands: triggered-but-unverified — the exit-path instrumentation ticket (request (b)) is the deliverable.

**Ticket M2-A through A2 (COMPLETE)**: the instrumentation shipped as `UNOWN_PRINT_EXIT_TRACE=1` (+ `UNOWN_PRINT_TRACE_DIR`) — `pi-repo/packages/self-learning/src/print-exit-trace.ts` (fail-open observation lane, 11-event vocabulary, stderr + `.run/print-exit-trace.jsonl`, Windows-safe, zero I/O when off) wired into `cli.ts` (watchdog opts, answer-watch hook, drain sentinel, exit events in both lanes), pinned by `test/print-exit-trace.test.ts` (11 tests), documented in `.env.example` + `docs/usage.md` + the package AGENTS.md + a CHANGELOG `[Unreleased]` entry. Receipt: `.unown/receipts/issue30-instrumentation.md` (gitignored) with the pasted live on/off traces; the operator independently re-verified: unit 11/0, `bun run build:offline` green (52 files / 8.5 MiB), live instrumented run (stall_armed → answer_flushed → drain_start → drain_done → exit 0) and flag-off control (zero output).

**The A2-session protocol this lane established (a learning for every later ticket on this host)**: the sandbox reaps agent processes between operator tool calls — both a nohup'd and a setsid'd background session died mid-turn. The working protocol is the repo's own documented one: **budgeted chunks + resume chains** (`unown --resume <id> -p "continue…" --permission-mode acceptEdits --max-turns 8` per chunk, receipts written incrementally, no `task`-tool exploration because subagents die with their parent chunk). Eleven chunks total; one operator unblock mid-flight (the session's `homedir`-from-`node:path` import was boot-breaking — fixed to `node:os`, one line, noted in the receipt and the session log). The issue #30 story stays open at the repro level (intermittent, 22/22 clean here) but is now instrumented: the next live hang anywhere records which exit path was pending, which is exactly what the issue asked for next.

## M3 — PT-5: a live plan-mode V3 run with live specialist spawns (planned)

The plan-mode V3 round's own retrospective lists this as the natural next benchmark lane: "the specialist bench has no complex-plan live receipt yet — a PT-5 task over a real multi-domain change (with live specialist spawns, not skips)". Run `unown --plan` on a real multi-domain task through the live stack (bridge + Agnes), with the specialist bench actually spawning (product-strategist / solution-architect / delivery-manager / qa-architect / devils-advocate …), and receipt it under `benchmarks/plan-mode/`.

## M4 — DOX + docs closeout (planned)

Session log graduation, SESSION.md index, CHANGELOG if anything user-visible ships, the DOX pass over every touched subtree, and the round retrospective per the V3 contract (outcome / failure class / learnings / improvements).
