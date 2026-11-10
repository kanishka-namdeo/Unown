---
title: The combination round 2: the approval option that never asked
description: The second pass over every plan-mode × TUI combination found an approval option whose promise was silent vapor — and a boot lane still dropping its flags.
date: 2026-11-10
lastmod: 2026-11-10
tags: [planning, tui, release]
type: feature
media: [/landing/tui/plan-mode/stills/03-plan-approval-overlay.png, /landing/tui/plan-mode/stills/04-plan-executing.png]
---

The first combination round tested every plan-mode lane it could reach and
fixed what it found — a dead flagship flag, a gate that wouldn't stay
closed, five more. This round's directive was the same sentence again:
**test all possible combinations of plan mode functionality and TUI
experience, fix whatever is not up to the latest standards.** The second
pass went after the cells the first round never drove: the approval
options 2/3/4 individually, digit quick-select, Ctrl+C cancel, the V2 kill
switch in a real terminal, the live model split, the turn budget, narrow
terminals down to 60 columns.

What it found is a lesson in how a *label* can outlive its *behavior*.

## The option that never asked

The approval gate offers four options. One of them makes a promise:
**"Execute — approve each edit."** You pick it, the plan runs, and every
file change comes back to you for a yes.

Except it didn't. The option maps to permission mode `default` — and
`default` alone only triggers `ask` RULES. A default-config session has
none. The measurement is unambiguous: **a zero-dialog census while an
approved plan executed freely.** Two file mutations. Zero prompts. The
option's label promised per-edit approval and the session never asked
once.

The fix gives the manual lane its teeth: approving with "approve each
edit" now **seeds session-scoped ask rules for `edit` and `write`** —
every file mutation prompts for the rest of the session. The rules die
with the session (nothing is written to disk), a more-specific `allow`
rule in your own config still carves out its paths, and a `deny` still
beats everything, exactly as before. Pick "auto-accept edits" and nothing
is seeded — that option keeps meaning what it says too.

![The approval gate](/landing/tui/plan-mode/stills/03-plan-approval-overlay.png)

## The boot lane that still dropped the flag

Round 1 fixed `--plan-model` — the flag was dead on arrival because pi
only answers registered flags — and verified the fix live: the plan model
switched. But the verification rode the worktree and print lanes, and the
round never asked the simplest question: what does the **ordinary** boot
do?

`unown --plan --plan-model agnes-2.5-flash` — the main TUI lane —
silently dropped both flag values at the `cmdTui` call site. Measured
live: 0 of 11 planning turns on the sibling model, and no warning either,
because the value never reached the flag registry at all. The flag lane
worked; the default road into it didn't.

The main lane's call now carries the same fields as the worktree lane,
and a source-contract test pins every `cmdTui` call site in the file so
the three boots can never drift again. Live receipt: the footer rides the
sibling, 5 of 11 assistant turns on the sibling during planning, and the
session model returns for execution.

## The matrix that grew

The combination lane itself — `verify_plan_mode_matrix.py` — grew from 3
phases to 9: the unknown-flag guard, the V2 kill-switch matrix with its
own wordings, terminals at 80x24 and 60x20, the full approval-options
state machine (digit quick-select with digit-5 inertness beyond the
option count, the in-TUI editor's six-round cap notice, Ctrl+C cancel
honoring the binding-stay contract, feedback → revise → re-offer), the
live model split counted turn-by-turn in the transcript, and the turn
budget. Sixty-six steps, all green, every one through the real TUI in a
real PTY against the live model.

![Execution](/landing/tui/plan-mode/stills/04-plan-executing.png)

The round also has an honest scar worth recording: the first drive of
this matrix found and fixed both defects, verified everything green — and
then lost the working tree to a recycled sandbox before the push. The
round you are reading about is the *recovery*: re-clone, byte-exact
re-application of the fixes, twelve new unit pins, the matrix lane rebuilt
from its receipts, and the whole thing re-verified live. A fix is not done
until it is pushed. That is now written down where the next round will
read it.

Full suite: 5497 tests, 0 failures. Receipts, as always, in
[the round log](https://github.com/kanishka-namdeo/Unown/blob/main/docs/plan-mode-tui-combo-2-round-session.md),
with the grounding research in
[the standards brief](https://github.com/kanishka-namdeo/Unown/blob/main/docs/plan-mode-standards-2026-11.md).
