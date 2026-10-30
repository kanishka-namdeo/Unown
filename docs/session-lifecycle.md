# Session lifecycle — abort, resume, crash recovery

> The single source for how unown sessions live: the append-only JSONL
> format, the unified abort matrix (every surface, one word), every resume
> spelling (flags, subcommand, in-session picker), and what happens across
> a crash. Written by the sessions round (2026-10-31); the surfaces are
> pinned to the code that ships them.

- [What a session is](#what-a-session-is)
- [Abort — one matrix, every surface](#abort--one-matrix-every-surface)
- [Resume — every spelling](#resume--every-spelling)
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
  the editor (a second press exits); Ctrl+D exits. Double-Esc with an
  empty editor opens the tree/fork picker — that is navigation, not abort.
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
- `plm.md` — the engine's process lifecycle (the other state machine)
- `memory.md` — what persists across sessions beyond the JSONL
- `configuration.md` — the env reference
