# Engine resilience — failure modes & recovery

What happens when the self-learning engine is down, wedged, crash-looping, or corrupt: what unown does automatically, what you see in the TUI and the CLI, and how to recover by hand. The contract up front — **the terminal agent always works with the engine down.** Chat, edits and every interactive feature are untouched; memory reads serve the last engine write from disk, and session notes queue in a local outbox the engine drains at its next boot. The engine is an enhancement, not a dependency.

Related pages: [detached engine architecture](detached-engine-architecture.md) · [configuration](configuration.md) · [troubleshooting](troubleshooting.md) · [windows guide](windows.md) · [Memory](memory.md)

- [The contract](#the-contract)
- [The degraded-mode surfaces](#the-degraded-mode-surfaces)
- [Failure-mode catalog](#failure-mode-catalog)
- [Bounded loss: what survives, what doesn't](#bounded-loss-what-survives-what-doesnt)
- [Design references](#design-references)

## The contract

The engine is one of four processes ([architecture](detached-engine-architecture.md)), and since the detachment milestone the terminal agent never opens its SQLite database: memory injection is a plain file read and note delivery is HTTP with a filesystem fallback. An engine that is down therefore degrades exactly two things — no new memory versions get written, and note consolidation pauses. Everything else does not know the engine exists:

| Capability | With the engine down |
|---|---|
| Chat, edits, subagents, web tools, LSP, MCP, checkpoints | unaffected — separate processes, separate paths |
| Memory injection (the 4-tier stack) | works — serves the last engine write from disk; `/learning` shows how old each tier is |
| Mid-session notes (`note` tool, `/note`) | queued in `$UNOWN_HOME/notes/outbox/`, drained when the engine returns |
| The session-end note | same — and quitting never waits on the engine longer than the delivery budget (2.5 s default; see [R5](#r5--engine-unreachable-at-quit-time)) |
| Dreams, memory versions, skill minting | paused until the engine is back |
| The TUI dashboard (`unown dashboard`), automations | down with the engine — the dashboard is a client, not a service; `unown automations` says so with the fix in the same line |

Liveness is not your job either: the touchpoints that care — note delivery and the session's status loop — ping the engine's HTTP health, and on connection-refused spawn a detached engine child (the Ollama pattern, [architecture design rule 5](detached-engine-architecture.md)). What M6 added on top is the awareness layer — the terminal agent now *knows* the engine's state and shows it, the crash-loop circuit bounds a child that keeps dying, and the repair path makes a corrupt database a bounded loss instead of a bricked install.

## The degraded-mode surfaces

### The footer

One persistent status row in the TUI. It is a fact, not an event: it changes only when the state changes, and it never churns.

| Footer line | State | Meaning |
|---|---|---|
| `memory: up` | up | engine answering HTTP, router idle |
| `memory: up · mem ▕█░░▏ v17 · 4 rules · dreamed 12m ago` | up | the M3 memory bar — what the engine learned in THIS project, read from the project's own files (`.unown/memory/project.md` + the provenance sidecar) at probe cadence: version, `- ` rule count under `##` sections, and dream age on the activity suffix's whole-minute ladder; the 4-cell meter (the pi context meter's own `▕█░▏` chrome) fills `min(rules, 16)/16`. Rides ONLY the clean `memory: up` line — a warning or standing-condition line stays undiluted; a project with no memory file keeps the plain footer, and any read error degrades to exactly the pre-bar text |
| `memory: up · auto-dream 4m` | up | engine answering HTTP **and** the named router job holds the mutex — the suffix is the job id plus whole-minute elapsed, absent (`memory: up`) the moment the router goes idle |
| `memory: starting…` | starting | a spawn was kicked, health not confirmed yet (seconds) |
| `memory: down` / `memory: down · 3 queued` | down | unreachable — the suffix is the outbox backlog, hidden when 0 |
| `memory: paused · /engine` | paused | the crash-loop circuit gave up on auto-start — run `/engine` |
| `memory: blocked · token` / `· port` / `· version` / `· no answer` | blocked | the port is owned by another install (401), a non-Unown process, an incompatible build, or a hung listener. No spawn is attempted; `/engine` or `unown engine status` names the owner |
| `memory: --` | unknown | first probe still in flight (clears within seconds of session start) |

Two rules keep the activity suffix honest. The elapsed is bucketed to **whole minutes**, because a 30 s probe cadence plus a seconds-granularity counter would rewrite the line twice a minute for a number nobody acts on; a job under a minute old shows its name with no number, since the job starting is already the news. And the version-skew suffix **wins** over it (`memory: up · stale (v2.1.0)`): a stale engine is a standing condition the user must act on and the footer is its only notice, while job activity is transient and is spelled out by `/engine`, `unown engine status` and the dashboard's Router screen.

The loop behind it starts with the session, probes `/api/overview` every 30 s (`PI_ENGINE_PROBE_INTERVAL_MS`, floor 5 s) with a 700 ms timeout (`PI_ENGINE_PROBE_TIMEOUT_MS`, floor 100 ms — loopback refusal is instant, so the timeout only bites a hanging port, in the background), and after a spawn kick schedules fast re-probes at 2/5/9/16 s so the footer flips as soon as the engine actually boots. Only a **refused** connection is spawnable: a 401/occupied/incompatible/hung probe publishes `blocked`, kicks nothing, and schedules no fast re-probes ([R11](#r11--engine-blocked-by-another-ownerport)). It survives `/new`, `/resume` and `/fork` (the engine cares about the process, not the session branch) and stops at quit.

### Toasts

One toast per state **transition** — never at session start. The first state a session observes is a fact on the footer, not an event; a deliberate engine-off user is not greeted by a warning on every boot (see [R9](#r9--deliberate-engine-off)).

| Transition | Toast |
|---|---|
| → down | `memory engine unreachable — chat unaffected, notes queue locally` (warning) |
| → paused | `memory engine won't start (repeated failures) — run \`unown engine status\`; chat unaffected, notes keep queuing locally` (warning) |
| → blocked | `memory engine blocked — another install's engine owns the port (pid N); run \`unown engine status\`; chat unaffected` (warning) |
| → up | `memory engine online — learning resumed` (info) — with ` — draining 3 queued note(s)` appended when the engine returns from a real outage with a backlog |

One toast is an EVENT, not a transition: the M3 **dream-news** toast `✦ AutoDream learned 3 new rules for this project (v17 → v18)` fires when a probe sees the engine's `dreamNews` block (a project dream that *added* memories within the last hour, for the session's own project). Unlike the state toasts it deliberately fires at session start too — learning that happened while you were away is exactly the confirmation moment — but still at most ONCE per new dream per session (an in-memory last-seen latch; a second session re-announces the same still-fresh learning once, as its own welcome-back line). Another project's dreams, honest no-change dreams (`added: 0`) and stale news (> 1 h) never interrupt anyone.

### The `/engine` command

The in-session diagnosis surface — state, backlog, and the auto-start circuit in one panel:

```text
memory engine — http://127.0.0.1:3030
  status: DOWN — chat unaffected; notes queue locally and sync when it returns
  outbox: 3 queued · 1 dropped while offline (oldest-first, cap UNOWN_OUTBOX_MAX)
  auto-start: backing off — attempt 2, next auto-start in 4s (auto-start works, just spaced out)
  memory files on disk keep serving the agent (last engine write is the fallback)
  actions: unown engine start · unown engine status · /learning (memory stack)
```

The other status lines, verbatim: `status: UP (pid 4242) · busy on 'auto-dream' 40s · observed 12m ago in this session`, `status: STARTING — a start was kicked, first probes pending (~seconds)`, and `status: PAUSED — chat works, memory reads use the last engine write, notes keep queuing locally`. When the engine is up, the actions line points at `/learning`, `unown engine stop` and the TUI dashboard instead.

### `/learning` staleness headers

With the engine down the memory stack still serves the last-written files — so `/learning` says how old each tier is instead of letting a weeks-stale `project.md` read as fresh. The header names the engine state (`memory engine: down — files below are the last engine writes; new notes queue locally and sync when it returns`; a `paused (won't start)` variant when the circuit gave up), and every tier gets an age: `── PROJECT · ~/code/app/.unown/memory/project.md (updated 5m ago) ──`, with `<1m`, minutes, hours and days as the scales grow.

### `unown doctor`

Every engine row is ⚠-class — warnings affect learning features only, chat never fails on them ([troubleshooting](troubleshooting.md#start-here-unown-doctor)):

| Doctor row | When | Detail line |
|---|---|---|
| `self-learning engine` | engine unreachable | `unreachable — learning paused, chat unaffected; notes queue in ~/.unown/notes/outbox (3 pending; start it: unown engine start)` |
| `self-learning engine` | engine up, rejects this CLI's token (a binary install talking to a source-repo engine — the CLI reads its OWN data dir's `engine.token`) | `up but rejected this CLI's token — pid N; learning paused, chat unaffected; use the owning install's CLI or set UNOWN_ENGINE_TOKEN to the engine's token (no engine was started)` |
| `self-learning engine` | port owned by a non-Unown process, an incompatible build, or a hung listener | the probe's cause + owner (pid/install/version) + the fix; `no engine was started` |
| `engine auto-start` | circuit gave up | `gave up after 5 failed start(s) — inspect .run/engine.log; then: unown engine repair (corrupt DB?) or unown engine start (resets the circuit)` |
| `engine auto-start` | a blocked probe was recorded (foreign engine/port) | `auto-start blocked — last probe: unauthorized|occupied|incompatible|unreachable; no spawn attempted` — a pass, not a warning |
| `engine auto-start` | backing off between tries | `2 recent attempt(s) — backing off between tries (normal after failures)` — a pass, not a warning |
| `engine router` | wedged but alive | `busy mutex held 2400s on 'auto-dream' — past 2x the job timeout; restart the engine` |

### `unown engine status`

The shell-side diagnosis command (exit 1 when down — scriptable). Down, it reports the pidfile verdict, the outbox, and the circuit:

```text
engine: DOWN (http://127.0.0.1:3030)
  pidfile /path/to/.run/engine.pid: pid 4242 (alive — wedged beyond HTTP?)
  outbox: 3 note(s) queued locally · 1 dropped while offline
  auto-start: gave up after 5 failed start(s) — run `unown engine start` (resets the circuit), and check .run/engine.log; if the DB is corrupt: `unown engine repair`
  start it with: unown engine start
```

Blocked by an engine it does not own, it names the owner and never starts a second one:

```text
engine: BLOCKED — unauthorized (http://127.0.0.1:3030)
  owner: pid 4242
  cause: an engine answered but rejected this CLI's token (HTTP 401)
  fix: use the owning install's CLI, or set UNOWN_ENGINE_TOKEN to the engine's token; no engine was started
  this CLI's token: /path/to/.unown/data/self-learning/engine.token
  pidfile /path/to/.run/engine.pid: absent
  outbox: 0 note(s) queued locally
  auto-start: auto-start blocked — the engine rejected this CLI's token; no spawn attempted
  service: ...
  no engine was started — resolve the owner/port above, then re-run.
```

Up, it prints pid and uptime, the router (busy job or idle, watchdog), the governor budget and breaker, KPIs, and the outbox pending count. `start` spawns a detached engine and polls health for 20 s — a foreign/occupied/incompatible/hung port is reported, never spawned over; `stop` drains gracefully (see [R4](#r4--engine-wedged-beyond-http)) and refuses a foreign engine unless `--force --pid <pid>`; `restart` refuses a foreign engine unless `--take-ownership`; `repair` is the corrupt-DB path ([R3](#r3--corrupt-sqlite-database)) and refuses while this data dir's lock/pid is alive; `serve` runs the engine in the foreground — the entry a systemd user unit, launchd agent or Windows service should own, and a clean loser on an occupied port (exit 0, so the supervisor does not restart-storm).

## Failure-mode catalog

| # | Failure mode | What you see | What happens automatically | Manual recovery |
|---|---|---|---|---|
| [R1](#r1--engine-down-stopped-or-crashed) | Engine down (stopped or crashed) | footer `memory: down · N queued`, one toast | gated auto-start + fast re-probes; notes queue in the outbox | nothing required; `unown engine start` to force it now |
| [R2](#r2--engine-boot-crash-loop) | Engine boot-crash loop | footer `memory: paused · /engine`, one toast | crash-loop circuit: backoff 2 s→32 s, gives up after 5 | `unown engine start` (resets); read `.run/engine.log` |
| [R3](#r3--corrupt-sqlite-database) | Corrupt SQLite database | boot fails `quick_check` with the repair hint | fail-fast boot gate; the circuit bounds the doomed restarts | `unown engine repair` |
| [R4](#r4--engine-wedged-beyond-http) | Wedged beyond HTTP (pid alive, port hanging) | status: `pid N (alive — wedged beyond HTTP?)` | short timeouts everywhere; the job watchdog | `unown engine stop` (hard-kill fallback), then start |
| [R5](#r5--engine-unreachable-at-quit-time) | Engine unreachable at quit time | the footer already said down | 2.5 s delivery budget; one bounded network retry before the outbox; `assumeDown` skips the network entirely | none — watch the `· N queued` suffix drain |
| [R6](#r6--outbox-overflow) | Outbox overflow / poisoned note | `N dropped while offline` / `N dead-lettered` in `/engine` + `engine status` | oldest-first drop past 200 files, every drop counted; failed ingests dead-letter to `notes/dead/` after 5 attempts with a reason | start the engine; raise `UNOWN_OUTBOX_MAX`; fix + `mv` dead notes back |
| [R7](#r7--oversized-note) | Oversized note | nothing (it is truncated, not rejected) | 20 000-char cap on both lanes | keep notes short if you want them verbatim |
| [R8](#r8--read-only-state) | Read-only state (`.run/`, `$UNOWN_HOME`) | counters read 0, circuit loses its memory | best-effort writes that fail open, never crash | fix the permissions |
| [R9](#r9--deliberate-engine-off) | Deliberate engine-off | footer `memory: down`, silent session start | none — that is the point | `UNOWN_ENGINE_AUTOSTART=0`; `unown engine start` still works |
| [R11](#r11--engine-blocked-by-another-ownerport) | Engine blocked by another owner/port | footer `memory: blocked · token/port/version/no answer` | no spawn; the probe records `lastCause` without counting an attempt | use the owning install's CLI; `--take-ownership` only if intended |

### R1 — Engine down (stopped or crashed)

The engine process is gone — crashed, killed, or never started. Agent sessions never needed it mid-turn, so nothing breaks; the session note and any mid-session notes fall back to the outbox, and the spawning touchpoints (note delivery, the session's status loop) ping health and kick a gated auto-start on connection-refused (detached child, single-flight; the engine's boot-time lockfile makes racing spawners converge on one winner). After the kick, the footer shows `memory: starting…` and fast re-probes flip it to `up` as soon as the engine serves HTTP (~7 s observed). The engine drains the outbox at boot, so the queued notes land the moment it is healthy. If you would rather not wait: `unown engine start`. `unown note "test"` tells you which way a note goes right now ([troubleshooting](troubleshooting.md#verifying-a-fix)).

### R2 — Engine boot-crash loop

The spawned child dies at boot — corrupt database, occupied port, missing runtime. Before M6 this was the invisible failure: one fresh doomed child per CLI session, forever. The crash-loop circuit fixes that. A tiny state file (`.run/engine-spawn-state.json` under the state root — the repo checkout, or `$UNOWN_HOME` on a standalone install) counts consecutive spawn attempts that never reached a healthy engine, **shared across every CLI process on the machine**:

- **Backoff between auto-starts**: 2 s after the first failure, doubling (4 s, 8 s, 16 s, 32 s), capped at 60 s.
- **Gives up after 5** consecutive failed starts — supervisord's `FATAL`: auto-spawn stops trying and the footer flips to `memory: paused · /engine` with one actionable message instead of an infinite silent loop.
- **Any observed-healthy probe resets the circuit** (a down engine that comes back clears the slate, like a Kubernetes backoff reset after a healthy run).
- **A blocked probe is not a failed start**: when the port is owned by another engine/process or the probe is unauthorized/incompatible/unreachable, the state file records `lastCause` and the attempt count is unchanged. Auto-start is refused outright, not backed off ([R11](#r11--engine-blocked-by-another-ownerport)).
- **A quiet window resets the count**: 10 minutes without a failed start (systemd `StartLimitIntervalSec` semantics) — you returning hours later get a clean circuit.
- **Manual always wins**: `unown engine start` bypasses the gate *and* resets it — the user-facing equivalent of `systemctl reset-failed` before `start`.

Recovery: run `/engine` or `unown engine status` for the circuit's own account (`gave up after 5 failed start(s) — run \`unown engine start\` (resets the circuit), and check .run/engine.log; if the DB is corrupt: \`unown engine repair\``), read `.run/engine.log` for the actual boot error, then either `unown engine start` or, if the log says the database is damaged, [R3](#r3--corrupt-sqlite-database).

### R3 — Corrupt SQLite database

The engine crash-loops because `db/selflearning.db` is damaged. The boot-time integrity gate catches it before any damage compounds: `startServer` runs `PRAGMA quick_check` — SQLite's fast O(N) pass, recommended by sqlite.org for routine boot validation over the full `integrity_check` — and a damaged DB fails **there**, with the lock released and a two-line hint, instead of corrupting writes mid-dream:

```text
[agent-service] database integrity check failed: <first failure line>
  quarantine it and boot fresh with: unown engine repair
```

Per [sqlite.org's howtocorrupt](https://www.sqlite.org/howtocorrupt.html), corruption is almost always environmental — power loss mid-sync, drives or filesystems that lie about fsync — not a bug you can patch around, so the honest recovery is backup → quarantine → fresh database. `unown engine repair` does exactly that:

1. Refuses to run against a live engine (`stop it first`) — never pulls the DB out from under a writer.
2. Triage with `PRAGMA quick_check`: a **healthy** DB gets `no repair needed` and a pointer at `.run/engine.log` (the failed starts had another cause — port conflict, missing bun, env), so repair never nukes good data on a wrong guess.
3. Quarantine: renames the DB and its `-wal`/`-shm` sidecars to `<db>.corrupt-<timestamp>` — every byte kept for forensics (a rename, not a copy: no doubled disk use). `sqlite3 <file> '.recover'` can still salvage rows from the quarantined file.
4. Resets the crash-loop circuit (the circuit that gave up on the old DB must not block the fresh boot) and tells you to `unown engine start`.

At the fresh boot the engine re-seeds its defaults and drains the outbox. What the incident costs is bounded by design — see [bounded loss](#bounded-loss-what-survives-what-doesnt): project memory files and queued notes survive untouched; only the engine-internal history stays behind in the quarantined file.

### R4 — Engine wedged beyond HTTP

The pid is alive but the port hangs — deeper than a crash, shallower than a reboot. Nothing agent-side can wedge on it: the status-loop probe carries a 700 ms timeout, note delivery races a 2.5 s budget, and a wedged *router job* (as opposed to a wedged process) is cut off by the job watchdog past `PI_JOB_TIMEOUT_MS`, with doctor warning when the busy mutex is held past 2× the timeout. Diagnosis is built into `unown engine status`: the pidfile line distinguishes `pid 4242 (alive — wedged beyond HTTP?)` from `dead` and `absent`. Recovery is `unown engine stop`, which escalates honestly: HTTP drain first (`POST /api/shutdown` — the same drain path as the signal handlers, and the only one that works on Windows), then SIGTERM to the verified pid, then after 10 s `did not drain in 10s — SIGKILLed (WAL recovery covers it at next boot)`. Then `unown engine start`. On Windows the pidfile is recovered after the spawn-escape path comes up (a bounded HTTP poll writes it from `/api/overview`'s pid — the 2026-10-26 hardening round; a boot slower than the 15 s bound simply leaves no pidfile, as before, and probing stays authoritative) — see [windows guide](windows.md#known-limitations).

The drain itself is now phased and budgeted (the 2026-10-26 round): the phase flips to `draining` the moment shutdown begins, `GET /api/health` reports it (`{phase, drainBudgetMs}` — the cheap lifecycle probe), new router jobs are refused with the 409-class draining conflict, and the in-flight job (an auto-dream or harness cycle holding the busy mutex) gets `UNOWN_ENGINE_DRAIN_BUDGET_MS` (default 10 s) to FINISH before the store closes under it — a deliberate stop no longer orphans a mid-flight dream for the next boot's `recoverOrphans` to heal. Anything past the budget closes under it honestly (the boot log says so), and the next boot heals it — the pre-round behavior, now the fallback instead of the only path.

### R5 — Engine unreachable at quit time

Quitting a session delivers its note, and `session_shutdown` awaits that delivery — so a hanging engine must not hold the TUI exit hostage. Two mechanisms:

- **The delivery budget**: the whole attempt (probe 1.2 s + POST 4 s, worst-case additive against a hanging port) races `UNOWN_NOTE_BUDGET_MS` (default 2.5 s, floor 500 ms). On expiry the note lands in the outbox — the durable path — and the quit proceeds. A wedged fetch that settles after the budget fired can at worst add a duplicate copy; it can never lose the note.
- **The fast path**: when a recent probe (within 2× the probe interval, 60 s floor) already established the engine is down — or the circuit gave up — delivery skips the probe *and* the POST entirely and writes the outbox directly: zero network, an instant quit even against a hanging port.

### R6 — Outbox overflow

A long offline stretch grows `$UNOWN_HOME/notes/outbox/`. The outbox is bounded like any offline queue: at most 200 queued files (`UNOWN_OUTBOX_MAX`, default 200; `0` = unlimited), and past the cap the **oldest** notes are dropped first — filenames start with a millisecond timestamp, so ordering is the directory listing. Every drop bumps a lifetime counter kept next to the outbox (`notes/outbox-state.json`) and surfaces wherever the backlog does: `/engine` (`3 queued · 1 dropped while offline (oldest-first, cap UNOWN_OUTBOX_MAX)`), `unown engine status` (`· 1 dropped while offline`), and the footer's `· N queued` count. Drops are permanent — that is what a cap is for; an offline agent must not grow without limit. If you genuinely expect months offline, raise the cap in [configuration](configuration.md#terminal-agent-unown-cli).

The **dead-letter lane** (the 2026-10-26 hardening round) is the ingest-side counterpart: a queued note whose ingest keeps failing — a throwing DB lane, a poisoned content path — is retried `UNOWN_OUTBOX_MAX_ATTEMPTS` (default 5; at the 5-minute note-sync cadence, ~25 minutes of honest retries) and then moved to `$UNOWN_HOME/notes/dead/` with a `.reason.txt` sidecar recording the last error. An *unparseable* file (broken frontmatter) dead-letters on first sight — it can never succeed on retry. Dead files are never deleted: read the reason, fix whatever poisoned it, and `mv` the file back into `outbox/` to retry. The dead count surfaces in `/engine`, `unown doctor` (`outbox dead-letter` row) and `unown engine status` (`· N dead-lettered`). Before this lane, a poisoned note was retried every drain pass forever, silently — the MemOS dead-letter-quarantine and Graphiti 202-then-drop precedents are the reason it now leaves a queryable record instead.

### R7 — Oversized note

Notes are capped at 20 000 characters on **both** lanes, with the same number on each so neither becomes the bypass for the other. The engine's HTTP lane answers 413 `note too large` — the client then queues the note in the outbox, where it is **truncated** at the same cap with a `(truncated)` marker rather than rejected: a note's value is mostly in its head. The engine applies the cap again at outbox-drain time, so legacy oversized files written before the agent-side cap existed cannot slip through either. Size never costs a note its place in the queue — the worst case is a truncated copy.

### R8 — Read-only state

All resilience bookkeeping is written best-effort and fails open — a read-only disk never crashes the agent:

- Read-only `.run/` (the state root): the spawn-circuit file can't be written, so reads fail open to a fresh circuit. The in-process gates (single-flight, kill switch) still apply, but the cross-process crash-loop memory is gone — auto-start reverts to one attempt per touchpoint, the pre-M6 behavior, silently.
- Read-only `$UNOWN_HOME/notes/`: the dropped counter stays at 0 (cosmetic — the queue itself is what matters).
- The hard limit, stated plainly: with a **fully** read-only `$UNOWN_HOME` *and* the engine down, notes cannot queue — the outbox write itself fails, and the failure is logged (visible with `-v`), not swallowed. With the engine up, the note path never writes to `$UNOWN_HOME`, so delivery is unaffected.

### R9 — Deliberate engine-off

Some users want the engine to stay off — privacy, a shared box, or just not wanting a daemon. `UNOWN_ENGINE_AUTOSTART=0` (also `false`/`off`/`no`) is the kill switch: no agent-side touchpoint — note delivery, the session status loop — ever spawns the engine again, and `bun run agent:install` / `unown update` do not install the always-on OS service (the surfaces that merely *report*, like doctor and `unown automations`, never spawned it in the first place). To keep the installer lane out while agent-side auto-start stays allowed, use `UNOWN_NO_ENGINE_SERVICE=1`; to remove an already-installed service, `unown engine uninstall` — which is remembered across installs and updates. The rest of the UX is shaped for this user:

- The probe loop still runs and the footer still tells the truth (`memory: down · 3 queued`) — a persistent status row, not an alarm.
- **No toast at session start.** The initial state is a fact, not an event; nobody is nagged on boot. Toasts fire only on mid-session *transitions*.
- Notes keep queuing in the outbox, so nothing is lost if the engine is ever started later.
- `unown engine start` still works — an explicit user action always beats the kill switch.

### R10 — Engine stale (an old build running after an update)

The engine is long-lived; `unown update` fast-forwards the checkout and rebuilds the CLI — but the already-running engine keeps executing the OLD code until restarted. Before M8 this was invisible. Now the engine reports its build (`/api/version` + the `version` block in `/api/overview`: version, boot sha, `bootedAt`, `api`), and every surface compares it against the agent's own build (`compareEngineBuild` — fresh / old-build (same version, different sha) / stale (older version, or booted-before-this-build — the needrestart rule) / ancient (a major behind, or >7 days) / ahead / unknown for pre-M8 engines):

- **Footer**: `memory: up · old build` / `memory: up · stale (v2.1.0)` — the suffix rides the up state only; down/paused keep their exact M6 shapes. It also **wins over** the `· <job> <elapsed>` activity suffix from [The footer](#the-footer): one line cannot carry both, and the stale build is the one that needs an action.
- **Toast**: one info toast per fresh→stale *transition* (never at session start — the initial state is a fact, not an event): "memory engine is an older build … run `unown engine restart`; chat unaffected".
- **`/engine`**: a `build:` line with both sides (engine v + sha · agent v + sha) and the restart hint when stale.
- **Doctor**: an `engine version` row — pass when fresh, warn on old-build/stale/ancient, info-pass `engine predates version reporting` for pre-M8 engines.
- **`unown engine status`**: version + sha on the UP line, a `— STALE` marker with the restart command.
- **`unown update`** prints `engine: still running the OLD build until restarted — unown engine restart` only when real skew remains after the rebuild — an OS-service-owned engine was already restarted by the installer; a supervisor-spawned one (no service installed) survives the update by design.

The fix is always `unown engine restart` — busy-aware (refuses to cut an active job without `--force`; `--wait <ms>` polls for idle), HTTP-drain-first (Windows-safe), and it reports the fresh build when done. Nothing ever hard-refuses on skew: chat works engine-down by contract (R1), so an old engine is a degradation, not an outage — dreams may miss recent improvements, but the agent never blocks.

### R11 — Engine blocked by another owner/port

A Unown engine (or another process) owns `UNOWN_ENGINE_URL`, but this CLI cannot use it: a 401 from a *foreign* install (a genuinely different user's or a deliberately separate data-dir install), a non-Unown listener, an incompatible API, or a hung port. The probe taxonomy distinguishes these from a refused connection, and **a spawn is only legal on refused** — a 401 is not a crash, and spawning a second engine into an occupied port is exactly how the old five-attempt loop fed itself. The footer shows `memory: blocked · token|port|version|no answer`; `unown engine status` prints the owner (identity headers, descriptor, or the OS port table), this CLI's token path, and the fix; `unown doctor` reports the same and skips the version handshake (an error payload has none). A blocked probe records `lastCause` in `.run/engine-spawn-state.json` without counting an attempt, so the crash-loop circuit does not "give up" on a foreign engine.

The **same-user binary↔source token split no longer blocks** (the 2026-10-26 hardening round, H6): the engine mirrors its per-boot token to `$UNOWN_HOME/engine.token` — the one tree every install shape resolves identically — and every engine client resolves a pair (its own data dir's token first, the shared mirror second), re-presenting the other side's token on a 401. A binary CLI probing a source-repo engine (or the reverse) now heals on the first request instead of reporting `blocked · token` forever. A 401 that survives the pair retry is a genuinely foreign engine — the R11 contract above still applies to it.

Do not use `unown engine restart` from a CLI that does not own the engine: use the owning install's CLI, or `--take-ownership` explicitly. `unown engine stop` refuses a foreign engine unless `--force --pid <pid>` names the verified port owner.

## Bounded loss: what survives, what doesn't

The design goal of the detachment work: an engine death — even a corrupt database — must cost at most the engine's *own internal history*. Everything the agent reads at session start, and every note not yet consolidated, lives outside the DB by construction:

| Asset | Where it lives | Crash / `kill -9` | Corrupt DB → `unown engine repair` |
|---|---|---|---|
| Project memory (tiers 1 + 3) | `<project>/.unown/memory/*.md` | survives — plain files, read every session | survives — repair never touches the project |
| User + policy memory (tiers 0 + 2) | `~/.unown/memory/*.md` | survives | survives |
| Queued notes | `$UNOWN_HOME/notes/outbox/*.md` | survives — replayed at next boot | survives — replayed at the fresh boot |
| Ingested-note archive | `$UNOWN_HOME/notes/done/` | survives | survives |
| Memory version history (rollback) | engine DB (`memory_versions`) | survives — SQLite WAL makes `kill -9` survivable | left in the quarantined file — `sqlite3 <file> '.recover'` can salvage rows |
| Run / dream / skill / task history | engine DB | survives (WAL) | same — quarantined, salvageable, not restored |
| Job, ledger and lock state | engine DB + `.run/` | healed at boot (`recoverOrphans` marks orphans `errored`) | re-seeded defaults at the fresh boot |

The one real loss after a repair is the engine's memory of *how it learned* — the run/dream history and the version timeline. The memory your agent reads every session is untouched, because it was never in the DB: the DB is the engine's ledger, the files are the product. Details of the four tiers: [Memory](memory.md); the WAL/crash story: [architecture F3](detached-engine-architecture.md#failure-modes--mitigations).

## Design references

None of these mechanisms is novel — that is the point. Each is the smallest well-known pattern that fits the failure:

| Reference | What unown took from it |
|---|---|
| Kubernetes [liveness vs readiness probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) | the footer answers liveness (`up`/`down`) and readiness (`starting…`) as separate states, not one boolean — a spawned engine that isn't serving yet is not "down" |
| Kubernetes [CrashLoopBackOff](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/) | restarts with increasing delay, and the backoff resets after a healthy run |
| systemd [`StartLimitIntervalSec`/`StartLimitBurst`](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) + [`systemctl reset-failed`](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html) | the 10-minute quiet window, the burst cap, and `unown engine start` as the manual reset that always wins |
| supervisord [`startretries` → FATAL](http://supervisord.org/configuration.html) | after N consecutive failures, stop trying and say so once — a human must act |
| Circuit breaker [half-open](https://martinfowler.com/circuit-breaker/) | a gave-up circuit does not stay closed forever: the quiet window re-arms auto-start |
| sqlite.org [howtocorrupt](https://www.sqlite.org/howtocorrupt.html) + [`PRAGMA quick_check`](https://www.sqlite.org/pragma.html#pragma_quick_check) | corruption is environmental, the fast O(N) boot check, and backup-aside quarantine as the honest recovery |
| [k9s](https://k9s.io/) + [vim-airline](https://github.com/vim-airline/vim-airline) | the persistent status row: state always visible, changing only on change; k9s' "cached as of" pattern behind `/learning`'s staleness ages |
| Sentry's `maxCacheItems` | the bounded offline queue: a cap, oldest-first drop, and a dropped counter that says what was lost |
| MemOS `AutoDroppingQueue` dead-letter quarantine + Graphiti's 202-then-drop loss (#1707) | the outbox dead-letter lane: every dropped/failed note leaves a queryable record with a reason, never a silent vanish |
| OpenAI `codex-app-server-daemon` lifecycle | `/api/health`'s warming/ready/draining phases + the drain budget — a stopper waits out the drain instead of racing it |
| Cognee's background-task drain registry | shutdown awaits the in-flight router job (bounded) before the store closes — no orphaned mid-flight dreams on deliberate stops |
