# Sessions Round — Session Log (the resumable checkpoint record)

> Round: **sessions consistency** — understand session abort/resume, make it
> consistent with the overall product and commands, ship as v0.0.49.
> Started 2026-10-30. This page is the round's checkpoint log: each milestone
> lands with its state recorded here so the round can be resumed from any
> checkpoint.

## The mission

"Understand session abort and resume functionality of Unown and make it
consistent with the overall product and commands."

## The understanding pass (what the codebase actually does today)

Three research passes fed this round: a full architecture map, an
abort/resume-specific code audit, and an online comparison of how Claude
Code, Codex CLI, Gemini CLI, aider and pi itself ship abort/resume
(recorded in `docs/session-lifecycle.md`'s comparison table and the round's
research file `docs/sessions-competitor-research.md`).

State before the round:

| Surface | Abort | Resume |
|---|---|---|
| TUI key | Esc (`app.interrupt`) — full matrix (turn, bash, compaction, retry) via chained temp handlers | `app.session.resume` action (no default key) |
| TUI slash | **none** — the only lifecycle op without a named command | `/resume` — **user lane only** (`~/.unown/agent/sessions`); the import lane (`<cwd>/.unown/sessions`) invisible in-session, though the launch picker, `--continue`, `--resume <query>`, `sessions list` and `/sessions list` all union both stores |
| CLI flags | — | `-c` / `--resume <id\|name\|path>` / bare picker (both stores) |
| CLI subcommands | — | `unown sessions list\|export\|import\|delete\|rename` — the family lacks its central verb, `resume` |
| Print mode | SIGINT/SIGTERM graceful dispose, exit 130/143 | `-p` composes with the resume flags |
| RPC mode | `abort`, `abort_retry`, `abort_bash` | `switch_session`, `new_session`, `fork`, `clone` |
| ACP | `session/cancel` | `session/load` |
| Fleet (subagents) | `task_control stop` (12 s grace, tree-kill backstop) | `task_control steer <name>` (finished-child resume by name) |
| Engine runs | fire-and-forget (context hard-block at 95% is the only abort-adjacent behavior) | rows in the engine SQLite, not user sessions |

Inconsistencies found (the round's work items):

1. **No `/abort` slash command.** Esc is the only in-TUI affordance; every
   other session lifecycle op (`/new`, `/resume`, `/fork`, `/tree`) has a
   named command. The extension API's `ctx.abort()` covers only the agent
   turn in the TUI — bash/compaction/retry waits are unreachable from
   extension commands.
2. **The in-session `/resume` picker misses the import lane.** The launch
   picker (`pickSessionInteractive`), `--continue`, `--resume <query>`,
   `unown sessions list` and `/sessions list` all union both stores; pi's
   in-session `/resume` lists only the primary session dir.
3. **No noun-verb resume.** Codex ships `codex resume`; Unown's sessions
   family (`unown sessions …`) lacks `resume`, so muscle memory from every
   noun-verb agent dead-ends.
4. **Vocabulary drift.** abort (pi core, RPC, persisted `stopReason`),
   interrupt (the keybinding action), cancel (ACP), stop (fleet/engine) —
   undocumented; the docs never say which word is canonical or how the
   others map.
5. **Docs scattered.** Abort semantics live in one keybinding table row;
   resume semantics in a Sessions section + a CLI usage block; crash/torn
   tail/exit-code semantics nowhere. No single lifecycle page.

## The design (what consistency means here)

- **Canonical word: abort.** It is what the session file persists
  (`stopReason: "aborted"`), what pi's RPC mode names, what the agent
  settles with. `/abort` joins the family; Esc stays the key; ACP's
  `session/cancel` and the fleet's `stop` are documented as their
  protocols' spellings of the same intent.
- **Abort is one matrix, not four.** A single
  `AgentSession.abortActiveOperation(): boolean` — turn, bash, compaction,
  retry — returns whether anything was running. The TUI's Esc, the
  extension `ctx.abort()`/`ctx.abortActiveOperation()`, and `/abort` all
  ride it, so no surface can drift again. Idle is reported honestly
  ("nothing to abort"), never guessed at.
- **Both stores, everywhere a session list is shown.** The in-session
  `/resume` picker unions the user lane and the import lane through a
  documented env seam (`PI_EXTRA_SESSION_DIRS`) instead of a unown-only
  patch — any pi wrapper can use it.
- **Resume has every spelling the product's grammar implies.** Flags
  (`-c`, `--resume`, `--session`) stay primary;
  `unown sessions resume <id|name|path>` joins the noun-verb family and
  composes with `-p` exactly like `--resume` does.
- **The lifecycle gets one docs page.** `docs/session-lifecycle.md` is the
  single source: persistence format, the abort matrix by surface, the
  resume matrix by surface, crash recovery, exit codes, and where fleet
  `stop` / engine runs deliberately differ.

## Milestones

Each milestone is a commit; this log updates in the same commit. Resume
the round from any checkpoint by reading the last completed entry.

### M1 — engine: the unified abort matrix + `/abort` (DONE, 2026-10-30)

Shipped:

- `AgentSession.abortActiveOperation(): boolean` (pi, `agent-session.ts`) —
  the one abort matrix: agent turn, bash, compaction/branch summary, retry
  wait; returns whether anything was aborted. `ExtensionBindings.abortHandler`
  now returns that boolean (the TUI owns queue-restore semantics).
- Extension API: `ctx.abortActiveOperation()` on `ExtensionContext` +
  actions, plumbed through `ExtensionRunner` (`types.ts`, `runner.ts`,
  `agent-session.ts`). `ctx.abort()` keeps its void semantics.
- TUI (`interactive-mode.ts`): one private `abortActiveOperation()` in the
  Esc precedence order; Esc, `abortHandler`, the shortcut context and
  `/abort` all ride it. Esc keeps its non-abort affordances (bash-mode
  clear, double-Esc tree picker); the compaction/retry temporary Esc
  handlers stay (double-abort is idempotent).
- `/abort` slash command (`tools.ts`): honest idle notice
  ("Nothing to abort…"), turn-abort notice (queue restore + `unown -c`
  hint), operation-abort notice (bash/compaction/retry).
- Rebuilt `pi-repo/packages/coding-agent/dist` (the runtime consumes the
  built package — the TUI ran stale code until the rebuild; caught live
  by the first PTY verification pass).

Tests (all green):

- pi: `test/suite/agent-session-abort-matrix.test.ts` — 4 tests: idle →
  false; extension command dispatched mid-run sees `true` and the turn
  settles `stopReason:"aborted"` persisted; raw method aborts a streaming
  run; second call after settling reports false.
- unown: `test/abort-command.test.ts` — 5 tests: registration + the three
  notice branches + no-throw on any state combination.
- Real-user PTY lane: `scripts/tui-capture/verify_abort_resume.py` — boots
  the real TUI, streams a long turn, `/abort`s mid-turn (notice observed
  on the pane), `/quit`s, asserts the session JSONL carries the aborted
  assistant message, then `unown -c` resumes the SAME file and answers a
  follow-up (entries 5 → 7). Full transcript in the capture log; stills
  `01-boot` / `02-after-abort` / `04-resumed-answer` captured for the
  landing usage lane.

Resume-from-here: M2 (the `/resume` picker both-stores fix) is next; all
M1 code is in the working tree, tests + PTY verification green.

### M2 — engine: `/resume` picker both stores (pending)

### M3 — engine: `unown sessions resume` (pending)

### M4 — docs + landing + changelog + blog (pending)

### M5 — release v0.0.49 (pending)

## Related pages

- `docs/session-lifecycle.md` (the round's usage page)
- `docs/sessions-competitor-research.md` (the round's research record)
- `docs/usage.md` · `docs/BEHAVIOR.md` · `README.md`
