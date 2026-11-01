# Session lifecycle — abort, resume, crash recovery

> The single source for how unown sessions live: the append-only JSONL
> format, the unified abort matrix (every surface, one word), every resume
> spelling (flags, subcommand, in-session picker), and what happens across
> a crash. Written by the sessions round (2026-10-31); the surfaces are
> pinned to the code that ships them.

- [What a session is](#what-a-session-is)
- [Abort — one matrix, every surface](#abort--one-matrix-every-surface)
- [Resume — every spelling](#resume--every-spelling)
- [The exit hint — the line every exit prints](#the-exit-hint--the-line-every-exit-prints)
- [Crash recovery](#crash-recovery)
- [What abort never does](#what-abort-never-does)
- [Related pages](#related-pages)

## What a session is

A session is an append-only tree of entries in one JSONL file — version 3
of the pi format: a header line (`type: "session"`, id, timestamp, cwd,
optional `parentSession` for forks), then entries (`message`,
`model_change`, `compaction`, `branch_summary`, `label`, `session_info`,
…) each carrying `id`/`parentId`. The current position is a leaf pointer;
branching appends, never rewrites. Every finalized entry is appended
synchronously as it happens — nothing is buffered — so any crash leaves a
valid prefix on disk.

Two stores, unioned everywhere a session list is shown:

| Store | Path | What lands there |
|---|---|---|
| User lane | `~/.unown/agent/sessions/` | every real TUI / print session |
| Project import lane | `<cwd>/.unown/sessions/` | `unown sessions import`, `unown import --from claude\|codex\|…` |

## Abort — one matrix, every surface

Abort means one thing: cancel what is running — the agent turn, a bash
command, compaction, branch summarization, or a retry wait — cooperatively,
through the AbortController each concern owns. The partial assistant message
is persisted with `stopReason: "aborted"`; what finished so far is kept; the
session stays resumable. `AgentSession.abortActiveOperation(): boolean`
is the single matrix (`pi-repo/packages/coding-agent/src/core/agent-session.ts`)
— every surface rides it, so they cannot drift:

| Surface | How you abort | Covers |
|---|---|---|
| TUI key | `Esc` (`app.interrupt`, rebindable) | the full matrix, queued messages return to the editor |
| TUI command | `/abort` | the full matrix; honest "Nothing to abort" when idle |
| Extension API | `ctx.abort()` / `ctx.abortActiveOperation()` | turn (TUI adds queue restore) / the matrix with a boolean answer |
| RPC mode | `abort`, `abort_retry`, `abort_bash` commands | turn / retry / bash, granularly |
| ACP protocol | `session/cancel` | the turn (ACP's spelling; maps to stopReason "aborted") |
| Print mode | `Ctrl+C` / `SIGTERM` | graceful dispose (in-flight work aborted, notes delivered), exit 130/143 |
| Fleet (subagents) | `task_control {action:"stop"}` | a spawned task's own lifecycle — 12 s wrap-up grace, tree-kill backstop |

Notes that keep the matrix honest:

- **Esc vs Ctrl+C vs Ctrl+D**: Esc aborts the running work; Ctrl+C clears
  the editor (a second press within 500 ms exits — the first press on an
  ALREADY-empty editor shows the "Press Ctrl+C again to exit" notice);
  Ctrl+D exits. Double-Esc with an empty editor opens the tree/fork picker —
  that is navigation, not abort.
- **Exiting mid-turn rides the same matrix** (the exit-resume round): the
  Ctrl+C/Ctrl+D//quit/SIGTERM exit path runs `abortActiveOperation()` and
  awaits idle (bounded 2 s) BEFORE disposing, so an exit during a running
  turn finalizes the partial with `stopReason: "aborted"` exactly like
  Esc//abort — previously the fire-and-forget abort inside dispose() raced
  `process.exit()` and a first turn with no finalized assistant message yet
  was lost entirely (the no-assistant guard had buffered it in memory: no
  file, no hint). The partial TEXT length is retry-luck — a stalled upstream
  makes the provider retry replace the in-flight message with a fresh
  zero-content attempt; `/abort` has the same property.
- **Abort during compaction, a branch summary or a retry wait**: `/abort`
  and the unified matrix reach them (`Esc` also does, via the status
  indicator's own handler); aborts are idempotent, so a double abort is
  harmless. The compaction arm aborts both controllers it can find running
  — manual/auto compaction and branch summarization settle the same way
  (cancelled, nothing rewritten).
- **`--max-turns N` / `--max-tool-repetitions N`** abort through the same
  cooperative path when a guard trips — the envelope reports the cap, the
  exit code reflects the contract (`capped: true`, exit 4 for the loop
  guard).
- **The engine's sandbox runs** are a different lifecycle: rows in the
  engine SQLite with the PLM state machine (`docs/plm.md`); the
  context hard-block at 95% is their abort-adjacent behavior. The fleet's
  `stop` names the spawned-task lane; this page's abort names YOUR
  session.

## Resume — every spelling

| Spelling | Resolves | Notes |
|---|---|---|
| `unown -c` / `--continue` | newest session whose header cwd is this directory | both stores |
| `unown --resume <id\|name\|path>` | path → id (full/prefix) → name (newest; ambiguous lists 5) | both stores |
| `unown --resume` (bare) | the interactive picker | both stores; TTY only; cancel exits 0 |
| `unown sessions resume [query]` | identical to the flag lane (the noun-verb twin) | composes with `-p "…"` exactly |
| `/resume` (in-session) | the picker — both stores (the sessions round fixed this) | rename Ctrl+R, delete Ctrl+D, scope Tab |
| `unown --session <path>` / `--session-id <id>` | exact file / open-or-create | scripting lane |
| `--fork` / `/fork` / `/clone` | a new session file with lineage | originals never touched |
| `/new`, `/tree` | fresh / branch switch | memory re-read at each switch |

The in-session `/resume` picker unions the stores through pi's wrapper
seam: unown sets `PI_EXTRA_SESSION_DIRS` (path-delimiter-joined) whenever
`<cwd>/.unown/sessions` exists, and every pi-driven picker shows the
union, deduped by path, newest-first (`session-manager.ts`). The variable
is automatic — you never set it by hand; wrappers embedding pi can use
the same seam.

Exit codes: a cancelled picker is exit 0 ("No session selected" — Claude
Code parity); an unresolvable query is exit 1 with the honest miss
message. Piped (non-TTY) stdio refuses the bare picker with exit 2.

On resume, interrupted tool calls are **not** re-run: the aborted attempt
is already in history with `stopReason: "aborted"`, and the next prompt
reads it like any prior turn.

## The exit hint — the line every exit prints

Every TUI exit (double Ctrl+C, Ctrl+D, `/quit`, extension `shutdown()`, and
SIGTERM/SIGHUP) prints one line after the terminal is restored:

```
To resume this session: unown --resume <session-id>
```

The contract (the exit-resume round):

- **It names the launcher you actually ran.** unown passes its own resume
  grammar to pi's exit hint (`resumeCommand` on `InteractiveModeOptions`);
  a bare `pi --session-dir …` would name a command you never typed and boot
  a session without unown's memory/hooks/addons stack. Wrappers embedding
  pi use the same seam (`appName`/`resumeCommand`).
- **It pastes cleanly on Windows.** Values are quoted for the host shell —
  double quotes on win32 (cmd.exe has no single-quote syntax; PowerShell
  takes both), POSIX single quotes under MSYSTEM (Git Bash) and on
  macOS/Linux. A bare session id needs no quotes at all (validated
  `[A-Za-z0-9._-]`).
- **It prints after the TUI stops** — the line lands in the restored screen
  buffer, not the alt screen. Piped stdout (non-TTY) gets NO hint:
  machine-readable consumers never see chat affordances. A dead terminal
  surfaces as EIO on the write and takes the emergency exit — no hang.
- **It only prints for persisted sessions** — `--no-session` (ephemeral)
  exits silently, and a session whose first turn never produced a finalized
  assistant message (aborted at the prompt, nothing streamed) never created
  a file, so there is nothing honest to point at.

Receipt lane: `scripts/tui-capture/verify_resume_hint.py` boots the real
TUI, exits with the keyboard, parses the printed command and runs it
verbatim — both an idle-session exit and a mid-stream interrupt.

## Crash recovery

- **The file is the recovery.** Append-only + synchronous appends mean a
  killed process leaves a valid prefix; `unown -c` resumes it.
- **Torn tail**: a final line cut mid-write is detected and repaired on
  load (the loader appends the missing trailing newline so the next
  append cannot corrupt the entry after it).
- **Crash records**: every boot writes `~/.unown/crashes/<iso-ts>.json`
  when the previous run died unexpectedly.
- **Interrupted tool calls**: not rerun (above); mid-flight bash children
  are reaped by the child reaper, fleet orphans by the journal sweep.

## What abort never does

- Never kills the process (print mode's signal exits are the process lane,
  not the turn lane).
- Never discards the partial turn — that is the whole point of
  `stopReason: "aborted"`.
- Never re-executes interrupted work on resume.
- Never touches the fleet's spawned tasks (that is `task_control stop`) or
  the engine's job state machine (that is PLM).

## Related pages

- `usage.md` — the command reference and the keybindings table
- `sessions-competitor-research.md` — the round's research record (the
  cross-product comparison this page's contracts were checked against)
- `exit-resume-round-research.md` + `exit-resume-round-session.md` — the
  exit-hint lane's own research record and round log (Claude Code / Codex /
  Gemini / aider exit UX, Windows quoting, the mid-stream exit data-loss fix)
- `plm.md` — the engine's process lifecycle (the other state machine)
- `memory.md` — what persists across sessions beyond the JSONL
- `configuration.md` — the env reference
