---
title: "The Da capo round: Claude Code's touch study, played again"
description: Round 2 of the Claude Code TUI teardown — sixteen fresh gaps audited against the v2.1.300→2.1.325 delta, and the second wave shipped.
date: 2026-11-16
lastmod: 2026-11-16
tags: [tui, mouse, verification]
type: feature
media: [/blog/2026-11-16-the-da-capo-round/dacapo-cp5-send-now-strip.png, /blog/2026-11-16-the-da-capo-round/dacapo-cp5-refocus-recap.png]
---

*Da capo* — from the head, the theme played again. The Toccata round
closed the first five gap clusters in Claude Code's terminal
experience. This round re-swept from zero: the official docs re-fetched
at their current shape, the **complete v2.1.300 → v2.1.325 changelog
delta** read line by line, the community catalog (ccstatusline,
claude-powerline, tweakcc, the spinner-verb and keybinding threads)
cross-checked, and the late-2026 sibling landscape re-audited. The
result was an 18-row gap table (R1–R18), sixteen adoptable, two
assessed deferrals with design notes.

The teardown lives in
[docs/tui-claude-code-parity-research-2.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/tui-claude-code-parity-research-2.md)
— every claim carries a fetched source, and the round-1 record itself
was corrected where the new evidence demanded it (two long-standing
"parity" claims turned out unverifiable in any current source; both are
now labeled).

## What landed, lane by lane

**The input lane (R6/R7/R15).** `Ctrl+R` now matches text *inside
collapsed paste pills* — search the expansion, display the marker,
insert the safe form. Invisible characters (zero-width, bidi overrides,
tag characters — the trojan-source class) are stripped on paste and on
submit, with a notice naming the count. And a misspelled modifier in
`keybindings.json` (`ctl+k`) is rejected and named instead of silently
binding the bare `k` — Claude Code fixed the same footgun in v2.1.323.

**The status lane (R1/R5/R13).** The terminal title now carries state:
` — working` while a turn runs, ` — needs input` while a permission ask
waits. The elapsed chip warms to amber at ten seconds. Notifications
gained channels (OSC 777 toasts on Ghostty/iTerm2/WezTerm) and a
distinct *needs your input* ping the moment an ask opens.

**The command lane (R3/R9–R12/R14).** `/color` re-tints the session's
editor border through the theme's own degradation, `/keybindings` opens
the file in `$EDITOR`, `/tui` switches renderer live, `/copy [N]` copies
the Nth-latest response, `Ctrl+Alt+L` forces a full redraw, and
`/terminal-setup` prints the tailored terminal lane (read-only — the
fork never mutates a config).

**The script lane (R2/R4).** Claude Code's largest community ecosystem —
statusline scripts — on Unown's form: a global `statusLine` command
whose stdout docks above the footer, a full JSON payload on stdin
(model, context window, live permission mode, turn count), refresh on
turn end or a timer. Plus the external-editor context: `Ctrl+G` carries
the last reply into `$EDITOR` as a commented block, stripped
byte-exactly on save.

**The mouse lane (R8/R16).** The round's finale. Claude Code v2.1.312
shipped *"click to send: clicking the 'to send now' hint under a queued
message sends it right away, as its key does."* Unown's fullscreen now
does exactly that: the queued-messages strip grew its own hint line —
and clicking it fires the same handler the keyboard does. The click
registry is release-commit (v2.1.311's lesson: move off the target
before letting go and the click cancels), tracks the layout on every
render, and yields to any focused dialog.

![The pending strip mid-turn: the steering message, and the send-now hint with its click affordance](/blog/2026-11-16-the-da-capo-round/dacapo-cp5-send-now-strip.png)

And the refocus recap: come back to a fullscreen session after three or
more minutes with three or more turns behind you, and a dim line greets
you — `back after 5 min · 4 turns this session · last: …`. Claude Code
generates its one-liner with a model call; Unown's fork renders the
deterministic form, because a welcome-home must never spend tokens or
add latency on a metered upstream. The threshold is one knob shared
with the prompt-path brief (`UNOWN_RECAP_IDLE_MINUTES`, `0` kills
both).

![The dim refocus line under the last answer: away span, turn count, and where the conversation stopped](/blog/2026-11-16-the-da-capo-round/dacapo-cp5-refocus-recap.png)

**The repair nobody planned.** Chasing the focus lane surfaced a real
bug: switching renderers at runtime (`/tui fullscreen`) rebuilt the
renderer *without* the transcript-mode hooks — tool-output expansion
and the `v` external editor silently died on the first switch. The
construction sites now pass every hook in lockstep, pinned by a
regression test that reads the switched-to renderer.

## What we refused, on record

The round-1 refusals were re-affirmed against the new evidence (the
Enter-steers model stays a deliberate divergence, now labeled as such),
and two new deferrals carry design notes: `/diff`'s per-turn source
cycling (waiting on the checkpoint store's branch surface) and the
`Ctrl+X` chord prefix (a layer, not a feature — it wants its own round).
R17 and R18 sit in the decision doc with their seams mapped, so the
next round starts from a map, not a mystery.

## The receipts

Eleven new unit batteries across the three packages; the full suites
green over their documented baselines (tui 1101/0, self-learning
5852/105/0, coding-agent byte-identical to its env-artifact baseline);
two PTY lanes driving the real TUI against the live stack —
`verify_dacapo_cp4.py` 9/9 for the statusline contract and
`verify_dacapo_cp5.py` 10/10 for the mouse lane, the latter asserting
the real DECSET byte stream (alt screen, SGR mouse, focus reporting), a
live SGR click draining a live queue, and the fractional-threshold
refocus line. The full ledger is
[docs/dacapo-round-session.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/dacapo-round-session.md).

One process note for the record: the round was nearly named "Rondo"
before a name collision with a historical session log surfaced — the
collision was repaired byte-identical in the next commit, and the round
took its real name. The DOX tree keeps everyone honest, including us.
