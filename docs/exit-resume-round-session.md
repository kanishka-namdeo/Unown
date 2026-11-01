# The exit-resume round — session log

- **Round**: exit-resume (the Ctrl+C exit → resume-from-the-printed-hint lane)
- **Started**: 2026-11-02
- **Status**: COMPLETE — code, tests, real-user PTY receipt, docs; pushed as
  `ca1461e1` (the round) + `9402b7fa` (the indentation restore) on `main`
- **Baseline**: `a699838b` (main, post fresh-clone graduation)
- **Operator directive**: clone/setup/run; research online and implement the
  best workflow to resume an agent session after a keyboard exit (the exact
  report: on Windows, exiting with Ctrl+C printed `To resume this session: pi
  --session-dir 'C:\Users\kanis\.unown\agent\sessions' --session <uuid>` —
  was that even the right command to run?); handle the edge cases; push every
  milestone.

This is the resumable log: what was done, the receipts, what remains. A
resumed session reads this file first.

---

## The answer to the operator's question

No — that printed command was **not** the right thing to run, three ways:

1. **It named a launcher the user never typed.** `unown` boots pi's
   `InteractiveMode` in-process (branded `appName: "unown"` for the header),
   but the hint used the vendored global `APP_NAME` (`pi`). A bare `pi` may
   not be on PATH at all — and even when it is, `pi --session-dir …` opens a
   session WITHOUT unown's memory/hooks/addons stack: the user resumes a
   degraded agent. The correct command was `unown --resume <uuid>` (unown's
   own grammar: both stores, id/name/path resolution, no `--session-dir`
   needed because unown always owns its agent dir).
2. **The quoting was wrong for Windows.** POSIX single quotes are **literal
   characters** in cmd.exe (its parser's only quoting character is `"`), so
   pasting the printed line there passes `'C:\Users\kanis\.unown\agent\sessions'`
   *including the quotes* and the resume dies on a file-not-found. PowerShell
   and Git Bash parse single quotes fine — the bug only bites cmd.exe, the
   shell a Windows user is most likely to have open.
3. **The hint was the only affordance on some paths and missing on others.**
   It printed on the interactive quit path only; a SIGTERM'd or hung-up
   process exited silently.

And the round's probe work found a **fourth, worse problem hiding under the
first**: an exit DURING a running turn dropped the whole exchange. See M2.

## Research record

Condensed to [docs/exit-resume-round-research.md](exit-resume-round-research.md)
(Claude Code, Codex, Gemini CLI, aider, opencode; Windows quoting rules;
Ctrl+C signal mechanics; OSC 52). Key best practices adopted:

- **Claude Code**: first Ctrl+C clears input / second exits, with an explicit
  "Press Ctrl-C again to exit" hint; exit prints
  `Resume this session with: claude --resume <id>`; sessions persist
  continuously; interrupted turns survive resume and are not re-run.
- **Codex**: prints `To continue this session, run: codex resume <id>` after
  TUI teardown — including on disconnect/kill paths.
- **Windows quoting**: double quotes are the only spelling that parses in
  cmd.exe AND PowerShell 5.1/7 (and is acceptable in Git Bash); MSYSTEM
  detection keeps POSIX single quotes under MSYS2.
- pi/unown's key model (Esc = interrupt-first, Ctrl+C = clear/double-press
  quit, append-only JSONL) already matched Codex's current design; the round
  closed the gaps, not the model.

## M1 — the hint itself ✅

`pi-repo/packages/coding-agent/src/modes/interactive/interactive-mode.ts`:

- `formatResumeCommand(sessionManager, options?)` — takes `appName` (the
  launcher the user actually ran) and `buildResumeCommand` (a launcher-owned
  builder; returning undefined falls back to the default). Quoting is
  host-shell-correct: double quotes on win32 (cmd.exe/PowerShell), single
  quotes under `MSYSTEM` (Git Bash) and on POSIX.
- `InteractiveModeOptions.resumeCommand` — the wrapper seam; unown passes
  `(id) => "unown --resume " + id` (session ids are validated
  `[A-Za-z0-9._-]`, so plain interpolation is shell-safe).
- `printResumeHint()` — one helper on BOTH exit paths (interactive quit AND
  SIGTERM/SIGHUP), called after `stop()` so the line lands in the restored
  screen buffer. Non-TTY stdout still gets nothing (machine-readable pipes
  must not see chat affordances). A dead terminal surfaces as EIO on the
  write and takes the existing emergency exit — same outcome, no hang.
- First Ctrl+C on an **already-empty** editor now shows
  "Press Ctrl+C again to exit" (Claude Code parity; before, the first press
  was invisible and the user had no way to learn the double-press contract).
  When the editor held text, the clear itself is the feedback — no notice.

Pinned: 16 tests in `test/format-resume-command.test.ts` (launcher naming,
override + fallback, win32 double-quoting incl. embedded `"`, MSYSTEM single
quotes, id quoting, TTY/persisted/file-exists guards).

## M2 — the mid-stream exit data loss ✅ (the edge case under the edge case)

Reproduced with a live Agnes turn (probe lane, since deleted per the ad-hoc
convention): boot TUI → submit a 3000-word-story prompt → **10 seconds of
active streaming (381 KB of pane updates) → double Ctrl+C → the session file
was never created at all** — no hint, nothing on disk, the whole exchange
gone.

Root cause chain:

1. `SessionManager._persist` has a **no-assistant guard**: until the first
   assistant message is appended, everything buffers in memory only (by
   design — no junk files from aborted-at-prompt sessions).
2. `InteractiveMode.shutdown()` called `runtimeHost.dispose()` →
   `session.dispose()` → `agent.abort()` **fire-and-forget**, and
   `_disconnectFromAgent()` runs in the same tick — the abort's async
   `message_end` (which finalizes the partial with `stopReason: "aborted"`
   and creates the file) fires AFTER the persistence listeners are gone.
3. `process.exit(0)` then won the race.

Fix: `shutdown()` now runs the **same cooperative abort matrix as Esc /
`/abort` / `ctx.abort()`** (`session.abortActiveOperation()`) and awaits idle
— bounded by a 2 s grace (`ABORT_SETTLE_TIMEOUT_MS`) so a wedged extension
listener cannot turn an exit into a hang — BEFORE `dispose()`. An idle
session pays nothing (no abort armed). Pinned by the new ordering test in the
5080 harness (`["abort", "idle", "drainInput", "stop", "dispose"]`).

Also fixed in the same lane: an abort that surfaces through the ai layer as
`stopReason: "error"` + "The operation was aborted." (the retry wrapper can
raise the AbortError on an inner controller a tick before the outer run
signal reflects it) is normalized to `stopReason: "aborted"` at the
agent-loop boundary (`normalizeAbortedError`, `agent-loop.ts`; 2 tests).
**Known non-goal**: the partial TEXT carried by the aborted message is
retry-luck — a stalled upstream (the Agnes degenerate-stream class) makes the
provider retry replace the in-flight message with a fresh zero-content
attempt; `/abort` has the same property. The honest contract asserted by the
receipt: user turn persisted, aborted marker persisted, file exists, resume
works.

## M3 — real-user verification ✅

`scripts/tui-capture/verify_resume_hint.py` (PTY lane, isolated `HOME`,
live bridge → Agnes; the log + stills land under
`download/unown-addon-captures/stills/verify-resume-hint*`):

- **chunk A**: boot → one live turn (`PANAMA-7`) → first Ctrl+C asserts the
  again-to-exit notice → double-press exits (status 0) → the hint reads
  `unown --resume <uuid>` (asserts: starts with `unown --resume`, no `pi`,
  no `--session-dir`, no quotes at all) and the uuid equals the session
  file's.
- **chunk B**: the printed command run VERBATIM (the copy-paste test) → the
  prior conversation is on the resumed pane → `/quit` → the hint again.
- **chunk C**: a second session interrupted MID-STREAM by double Ctrl+C →
  exit 0 → hint correct → session file exists, user turn + `stopReason:
  "aborted"` entry persisted.
- **chunk D**: chunk C's printed command verbatim → the interrupted
  conversation visible on the resumed pane.

Final run: `ALL ASSERTIONS HELD` (with the mid-stream abort landing on a
clean stream, the partial story text — `# The Keeper of Varg Point…` —
persisted too, matching `/abort` exactly).

## M4 — docs & DOX ✅

- [docs/session-lifecycle.md](session-lifecycle.md) — the exit-hint contract
  (both paths, launcher grammar, Windows quoting, non-TTY) and the
  Ctrl+C-exit row in the abort matrix.
- [docs/usage.md](usage.md) — the Ctrl+C keybinding row and the resume-flags
  paragraph now state the exit hint.
- [README.md](../README.md) — the session-lifecycle row names the exit hint.
- [CHANGELOG.md](../CHANGELOG.md) — Unreleased entries.
- This log + the research record + the SESSION.md index entry.

## Retrospective

- **Outcome**: the exit hint now survives the copy-paste test on every
  platform, names the launcher the user ran, prints on every exit path, and
  the mid-stream exit stops losing the session (the file, the turn, the
  hint). The operator's original confusion ("is this the right command?")
  is answered and made un-askable.
- **Failure class (the one that bit)**: whitespace-anchored editing flipped
  tab-indented vendored files to spaces (1340 lines of churn hiding ~140
  real ones) — caught by post-push diff review, fixed by `9402b7fa`, and
  lesson recorded here: re-check `git show --stat` for whole-file churn
  before pushing edits into the vendored tree.
- **Learning candidates**: (a) the no-assistant guard's interaction with any
  future "persist continuously" lane (Claude Code persists the user message
  immediately; pi defers to first assistant message — a deliberate junk-file
  tradeoff worth revisiting if crash-mid-first-turn loss ever matters more);
  (b) the retry-layer partial discard affects BOTH `/abort` and the exit
  lane equally — if it ever matters, the fix belongs in the retry seam, not
  the surfaces.
