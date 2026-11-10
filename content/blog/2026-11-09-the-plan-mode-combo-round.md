---
title: The combination round: the flag that never worked, and the gate that wouldn't stay closed
description: A full pass over every plan-mode combination found a flagship flag that silently did nothing, an approval gate that re-opened while you typed, and more.
date: 2026-11-09
lastmod: 2026-11-09
tags: [planning, tui, release]
type: feature
media: [/landing/tui/plan-mode/stills/02-plan-mode-on.png]
---

The plan-mode rounds each shipped a surface: the planning round the scored
plan file, the keyboard round the shortcuts, V3 the capability orchestrator.
This round's directive was different: **test every combination of plan-mode
functionality and the TUI experience like a real user, and fix whatever is
not up to standard.** No new surface — a full pass over the existing ones,
live model, real terminal, every entry lane and every exit.

What that pass found is a lesson in how features die quietly.

## The flagship flag that never worked

`unown --plan-model <id>` ships in the help, in the docs, in the changelog
of the planning round: plan with one model, execute with another — the
opusplan lane. The parser accepts it. The flag travels all the way into the
session runtime.

And then nothing. Every planning turn stayed on the session model. The
measurement is unambiguous — run with `--plan-model agnes-2.5-flash` and
every one of eight planning turns used `agnes-3.0-flash`.

The cause is a contract mismatch two layers down. The pi coding agent only
answers `getFlag()` for flags the calling extension **registered**, and
nothing had registered `plan-model`. Worse: the runtime dutifully collected
an "Unknown option: --plan-model" *error diagnostic* for the unregistered
name — and every boot path in unown destructured `{ runtime }` and threw
the diagnostics away. A dead flag, dying silently, for nine days.

Both halves are fixed: the flags are registered (`--plan-model` and
`--max-turns`, which had the same death), and the boot lanes now surface
runtime diagnostics — stderr lines in print mode, startup notices in the
TUI. A dead flag can never be silent again.

## The gate that wouldn't stay closed

Esc out of the approval gate and start typing your next command. On a fast
model, the gate re-opens **while you type** — the model's continuation turn
re-offers the plan seconds after you declined it, the dialog steals focus
from the editor, and your keystrokes vanish into the modal. Measured live,
twice in one session: a queued `/plan off` and a planning prompt, both
eaten.

Two paths caused it: the model's own immediate `exit_plan_mode`
re-invocation (ignoring the instruction to wait), and the turn-end fallback
gate re-arming after the model's next model-call reset the suppression.

The fix makes your decline **binding for the rest of the run**: while the
stayed latch is set, the in-tool gate answers the model with a soft "do NOT
re-offer now — end your turn and wait" result instead of opening a dialog,
and the fallback gate stays quiet. Your next message re-arms everything.
Rejection-with-feedback deliberately keeps re-arming per turn — the
fallback still rescues a model that revises the plan but forgets to
re-offer it.

## The setup that forgot your other models

`unown setup --provider agnes --model agnes-3.0-flash` probes your
endpoint, prints *"serves 6 models"* — and then writes a models.json with
exactly one. The catalog registration was gated on the interactive wizard;
the flag lane skipped it. `/model` switching, `--model`, subagent
fallbacks, and the newly-alive `--plan-model` could never resolve a
sibling without a hand edit.

The flag lane now registers the discovered catalog: chosen model first
with your explicit specs, every served sibling after it with best-effort
specs — one probe round-trip, reused by the spec gate, the extras pass and
the verification print.

## And the rest of the ledger

- **The todo-flip instruction was too subtle.** Live, a flash model created
  three duplicate todos instead of flipping the three seeded ones — so no
  plan step ever completed and "Plan complete" never fired. The instruction
  now names the discipline: flip the seeded tasks by id, never create
  duplicates.
- **The `--plan` boot was a silent cousin of `/plan`.** No entry notice, no
  todo-overlay suspension. One entry contract now, on every lane.
- **`UNOWN_PLAN_TURN_BUDGET=0` was unreachable dead code** — the env value
  fell back to 15 before the zero-guard could ever see it. An explicit zero
  now really disables the planning pressure. (The first version of this
  fix had its own bug — an unset variable tripping the zero-check — and the
  round's own new test caught it before it shipped. Tests earn their keep.)
- **Label and lane drift**: the help still said plan mode was "(V2)", the
  `/plan` description promised `$EDITOR` (it opens the in-TUI editor), the
  landing-page capture scenario anchored on strings that stopped rendering
  months ago, and the settings hub listed `plan` as a permission mode it
  isn't.

## Verified like a user

Every fix was verified through the real TUI in a real PTY against the live
model: the keyboard matrix (Shift+Tab's full cycle, Ctrl+Alt+P, every
`/plan` spelling), the approval gate's full navigation set (arrows, j/k,
Home/End, PageUp/PageDown, numbered quick-select), the edit round, the
feedback round, the stay-loop's 45-second quiet window, the re-arm on the
next message, and the full approve → execute → "Plan complete" loop with
the seeded todos flipped and zero duplicates.

The combination matrix itself is now a permanent lane —
`scripts/tui-capture/verify_plan_mode_matrix.py` — so the next round
inherits the checklist instead of the archaeology. Full suite: 5485 tests,
0 failures. Receipts, as always, in
[the round log](https://github.com/kanishka-namdeo/Unown/blob/main/docs/plan-mode-tui-combo-round-session.md).
