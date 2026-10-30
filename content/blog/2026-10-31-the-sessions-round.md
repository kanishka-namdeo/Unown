---
title: "The sessions round: abort and resume, made consistent"
description: "One abort matrix behind Esc, /abort and every protocol; both session stores behind every picker; resume in both grammars the field ships."
date: 2026-10-31
lastmod: 2026-10-31
tags: [sessions, cli]
type: feature
media: [/blog/2026-10-31-the-sessions-round/abort-command.png, /blog/2026-10-31-the-sessions-round/resume-picker-both-stores.png]
---

Every coding agent has the same two moments: the user wants the running
turn to *stop*, and the user wants yesterday's conversation *back*. The
agents that feel good at those moments are not the ones with the most
features — they are the ones where the same intent always meets the same
behavior, no matter which surface you used.

That is the whole of the sessions round: unown's session abort and resume
were correct in every piece but inconsistent as a product. This round
made them consistent, then verified the result like a user runs it.

## The audit: one behavior, five vocabularies

The code said abort; the keybinding table said interrupt; ACP said
cancel; the fleet said stop. The Esc key could stop a turn, a bash
command, compaction, and a retry wait — but only through four separate
code paths chained onto the escape handler. There was no `/abort`
command at all, although every *other* session lifecycle operation ships
one (`/new`, `/resume`, `/fork`, `/tree`). And the extension API's
`ctx.abort()` could only reach the agent turn, so a command surface could
never be complete.

Resume had its own drift. The launch picker, `--continue`, `--resume
<query>`, `sessions list`, and `/sessions list` all union the two session
stores (the user lane at `~/.unown/agent/sessions` and the project import
lane at `<cwd>/.unown/sessions`). The *in-session* `/resume` picker
listed only the primary store — so a session imported from Claude Code or
Codex was visible at launch and invisible a minute later, inside the
session. And if your muscle memory came from Codex, `codex resume` had
taught you a noun-verb grammar that `unown sessions …` did not answer.

## One abort matrix

The fix in the engine is one method: `abortActiveOperation()` — abort
whatever is running (turn, bash, compaction, retry) and tell the caller
truthfully whether anything was. Esc, the new `/abort` command, the
extension API, and every abort lane ride that one path. A surface can no
longer drift, because there is nothing to drift from.

![The /abort command stopping a live turn: the partial output is kept, queued messages return to the editor, and the notice names the resume command](/blog/2026-10-31-the-sessions-round/abort-command.png)

`/abort` when nothing is running says exactly that — "Nothing to abort" —
rather than pretending. When a turn is running, the partial answer is
kept in the session file with `stopReason: "aborted"`, queued messages
return to the editor, and the notice names the resume command. Aborts
stay cooperative: no process kills, no lost work, nothing re-executed on
resume.

## Both stores, everywhere

The in-session picker now unions the stores through a wrapper seam in the
vendored pi base (`PI_EXTRA_SESSION_DIRS`) instead of a unown-only patch
— any wrapper embedding pi can use it. The launch picker's private merge
copy was deleted: both pickers derive from the same mechanism.

![The in-session /resume picker listing two sessions — one from the user store, one from the project import lane](/blog/2026-10-31-the-sessions-round/resume-picker-both-stores.png)

## Resume in both grammars

Claude Code ships flags (`claude --resume`); Codex ships a subcommand
(`codex resume`). Unown now honors both: `unown --resume <query>` and
`unown sessions resume <query>` are the same resolution walking the same
ladder (path → id → name, both stores), and everything after the
subcommand flows exactly as it would after the flag — bare is the picker,
`-p "…"` resumes and runs. One grammar, two spellings, zero divergence.

## Verified like a user, not like a test suite

The round's verification booted the real TUI in a real PTY: a long prompt
streamed from the live model, `/abort` stopped it mid-turn, the session
file was checked for the persisted `stopReason: "aborted"`, `unown -c`
resumed the *same* file, and a follow-up question was answered on the
resumed session. A second pass created a session, exported and imported
it through the real CLI, and asserted the in-session picker lists both.
Ten unit tests pin the subcommand rewrite; fifteen pin the abort matrix
and the seam; the suites around them (116 unown + 49 pi tests) stayed
green.

The single page documenting all of it — the format, the matrix, every
spelling, crash recovery, exit codes — is
[docs/session-lifecycle.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/session-lifecycle.md).
