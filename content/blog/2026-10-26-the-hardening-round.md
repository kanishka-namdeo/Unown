---
title: "The hardening round: the verdict on the detached engine"
description: "We re-litigated the core USP's architecture against ten competitor repos and 54 sources. The detached engine stays; six honest-failure lanes ship in v0.0.28."
date: 2026-10-26
lastmod: 2026-10-26
tags: [engine, release]
type: release
media: [/landing/tui/dashboard/stills/01-overview.png, /landing/tui/dashboard/stills/03-dreams.png]
---

The memory system is Unown's core promise, and it lives in a detached daemon:
the self-learning engine on `:3030`, running harness cycles, AutoDream
consolidation and the job router while your terminal sessions come and go.
This round put that architecture itself on trial — is the detached process
approach stable, viable and scalable, or should the memory system move into
the agent process? The trial had teeth: a ~54-source landscape survey, a
source-level reverse engineering of ten competitor repos at pinned SHAs, and
a full codebase walk of the live supervision stack. The verdict and the six
lanes it shipped are [v0.0.28](https://github.com/kanishka-namdeo/Unown/releases/tag/v0.0.28).

## The verdict: retain — and the evidence that decided it

The question was not "is our engine good" but "is the *shape* right". So the
research read the shape everywhere it exists in the wild
([the survey](https://github.com/kanishka-namdeo/Unown/blob/main/docs/detached-vs-embedded-research.md),
[the source deep-dive](https://github.com/kanishka-namdeo/Unown/blob/main/docs/memory-competitor-source-deep-dive.md)):

- **Interactive coding agents** (Claude Code, Gemini CLI, Cursor, opencode,
  Aider) run files + in-process memory, zero daemons — but none of them
  consolidate memory in the background. Their memory is static between
  sessions.
- **Every system with continuous consolidation runs a detached process.**
  Letta's sleep-time compute is a second agent on the server. Cognee anchors
  pipeline tasks in a registry and drains it at shutdown. MemOS's local
  plugin is a per-agent TypeScript daemon over better-sqlite3 with a
  KeepAlive supervisor — the closest thing in the industry to our engine.
- **The killer precedent: OpenAI ships `codex-app-server-daemon`.** A
  detached, pidfile + file-lock managed local daemon with a lifecycle CLI,
  `shutdownGraceSeconds`, and an embedded fallback. OpenAI converged on the
  hybrid we already run, almost feature-for-feature.
- **The embedded alternative is worse on the axes that matter.** Bun issue
  [#40659](https://github.com/oven-sh/bun/issues/40659) — `BEGIN IMMEDIATE`
  does not exclude across processes on Windows, closed as *not planned* —
  makes the single-writer daemon the only durable SQLite shape. And embedding
  puts twenty-minute watchdog'd jobs inside the interactive process: a wedged
  dream would wedge your terminal.

The full decision record, with every claim tiered `[V]`/`[C]`/`[U]`, is
[docs/detached-engine-hardening.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/detached-engine-hardening.md).

![The mission control overview — the engine's KPIs, live activity and benchmark table](/landing/tui/dashboard/stills/01-overview.png)

## The six lanes that shipped

The sweep confirmed the architecture was sound; what it exposed were
honest-failure lanes — places where the engine failed silently instead of
leaving a record. Six landed, each mapped to a published precedent:

**H1 — the outbox dead-letter lane.** A note queued while the engine was down
used to be retried every drain pass *forever, silently* if its ingest kept
failing. Now it gets five attempts (tracked per-file with the last error),
then moves to `notes/dead/` with a `.reason.txt` sidecar — never deleted,
`mv` it back to retry. The dead count surfaces in `/engine`, `unown doctor`
and `engine status`. The precedents: MemOS's dead-letter quarantine and
Graphiti's acknowledged-then-dropped queue loss.

**H2 — delivery retry-before-outbox.** A note whose POST fails on the network
gets one bounded ~600 ms retry before the durable fallback — a note landing
inside the engine-restart window delivers directly instead of waiting for the
five-minute sync drain. HTTP error statuses never retry: an answering engine
is a deliberate response.

**H3 — `/api/health` with lifecycle phases.** A cheap probe answering
`{phase: warming | ready | draining, pid, drainBudgetMs, version}` — no
500-run scan. The phase flips to `draining` the moment shutdown begins, so a
stopper can wait out the drain instead of racing it. The codex daemon
contract.

**H4 — the in-flight job drain registry.** A SIGTERM under a live dream used
to close the store under it — the dream row stayed `running` until the next
boot's orphan recovery healed it, and the half-finished work was lost.
Shutdown now refuses new jobs (a 409-class conflict) and *waits* for the
in-flight job, bounded by `UNOWN_ENGINE_DRAIN_BUDGET_MS` (10 s default), then
closes honestly under anything that overruns. Cognee's background-task
registry is the precedent.

**H5 — Windows pidfile recovery.** The `cmd /c start /b` escape hatch
(bun#31603) never learned the engine's pid — cmd.exe exits right after
`start` — so the pidfile was never written on that lane and `engine
status`/`engine stop` were Windows-blind. The supervisor now polls the engine
post-spawn (bounded, foreign-port-aware) and writes the pidfile from the
health probe's own pid.

**H6 — cross-install token discovery.** A binary install probing a
source-repo engine used to get 401 *forever* — each install shape reads its
own data dir's token. The engine now mirrors its per-boot token to
`$UNOWN_HOME/engine.token` — the one tree every install shape resolves
identically — and clients resolve own-first/shared-second, re-presenting the
other side on a 401. The split heals on the first request.

![The dreams screen — the consolidation journal the drain now protects mid-flight](/landing/tui/dashboard/stills/03-dreams.png)

## What was deliberately not done

The record also names what we chose *not* to ship, and why: an embedded
fallback mode (our gated spawn + outbox already cover it, and it would fight
the single-writer rule); an embedder child-process worker (the ONNX lane
already degrades to the lexical embedder at load time, and dream idempotence
makes a mid-extraction crash lossless); and always-on OS services for
compiled binaries — genuinely the biggest remaining reach gap, and
deliberately out of this round's scope with the design work named.

## Receipts

- The verdict record:
  [docs/detached-engine-hardening.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/detached-engine-hardening.md)
- The survey and the deep-dive:
  [detached-vs-embedded](https://github.com/kanishka-namdeo/Unown/blob/main/docs/detached-vs-embedded-research.md)
  ·
  [competitor source deep-dive](https://github.com/kanishka-namdeo/Unown/blob/main/docs/memory-competitor-source-deep-dive.md)
- The changelog stop: [0.0.28](https://github.com/kanishka-namdeo/Unown/blob/main/CHANGELOG.md)
- The knobs: `UNOWN_OUTBOX_MAX_ATTEMPTS`, `UNOWN_ENGINE_DRAIN_BUDGET_MS` —
  [docs/configuration.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/configuration.md)
- The suite at the cut: 4,924 pass / 0 fail across 208 files (44 new tests in
  five new files), plus live receipts — a SIGTERM under a live `auto-dream`
  logging the bounded drain wait, both token files removed at drain, a clean
  re-boot to `ready`.

What ships next is named in the record's not-done list — the binary install's
always-on engine is the standing candidate, with the design work it needs
already written down where the next round will find it.
