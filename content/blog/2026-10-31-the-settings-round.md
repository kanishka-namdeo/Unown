---
title: The settings round: when your diff view lies to every fresh install
description: Minting the round's authoring failures into guards found three real defects — including a diff view that lied on every fresh install. Measured and pinned.
date: 2026-10-31
lastmod: 2026-10-31
tags: [settings, benchmarks, learning, release]
type: feature
---

The Settings Evolution round set out to mint its own failures into guards.
The plan was modest: take the three mistakes the benchmark suite caught in
its own authoring — a toggle-marker that never matched, a no-op probe that
proved nothing, a missing paren that every parser mis-pointed — and turn
each into a pinned task so the class can't come back. The round shipped
that, plus three real product defects the minting work found on the way.
This is the story of the one that lied to every fresh install.

## The diff view that cried drift

`/settings diff` shows which settings differ from their defaults — the
honest answer to "what did I change?". The round's AFTER-run receipts
showed **eight drifted rows on a home nobody had touched**: TUI mode,
Mermaid, image width, editor padding, clear-on-shrink, terminal progress,
copy-on-select, fullscreen exit output. Eight settings, no writes, drift.

The root cause: the registry's declared `default` fields were written from
the pi settings selector's row states — what the picker *displays* — while
the values a fresh install actually resolves come from the vendored
settings manager's getters. `copy-on-select` defaults to **on** in the
manager (`?? true`) but the registry declared **off**. Onboarding
deliberately seeds `tuiMode: fullscreen` (the split-view layout engine);
the registry declared `regular`. Eight items, eight lies, on every fresh
install, forever — and the reset-to-default lane would have "fixed" them
by turning off your actual defaults.

All eight are corrected with vendored-provenance comments, and the
invariant is pinned twice: a unit test that iterates every defaulted item
on an out-of-the-box home (`get() === declared default`), and a benchmark
guard that boots a pristine home and demands the diff say **"No settings
differ from their defaults."**

The unit test has a story of its own. It passed standalone and failed in
the full suite — `agent.addon-todo-lines` read 33 instead of 12. Some
settings getters resolve through `term.ts`'s module-scope `UNOWN_HOME`
snapshot, frozen at the first import in the shared bun process: an
in-process pin was reading an *earlier test file's leftovers*, not the
fresh install it existed to measure. The pin now runs in a subprocess.
That failure — the pin catching its own author — is the round in one
sentence.

## Nine action lanes that did nothing

The promotion drive (see below) pressed Enter on "opens the staged-skills
list" and the TUI silently ignored it. The hub's item editor dispatches on
`choice.startsWith("Run")` — but the code pushed action labels verbatim,
so nine action items whose labels start with "opens" or "reads" or
"renders" matched no branch at all. Select them, press Enter, nothing.
Every action label is now normalised into the `Run: …` shape, and a test
holds the contract for all action items forever.

## Two dialogs that didn't fit the screen

The staged-skills inbox showed you a 2,500-character skill preview as the
dialog title — and the option rows (Promote / Discard / Skip) rendered
*off-screen*. Unusable by eye, unusable by script. The pending-dreams
inbox had the same disease with a 3,000-char diff. Both previews are
clamped to 600 chars with a pointer to the full text; the promotion drive
then completed end to end.

## The promotion — the round's learning loop, closed

The engine's dream consolidated the round's notes into project memory v4
— and minted a skill: `pin-settings-defaults`, a real procedure distilled
from this round's failure ("align every declared default with the real
resolver; pin it in a subprocess test"). It staged inert by design. The
operator verified its claims against the round's receipts, then promoted
it through the hub's own inbox — the ledger recorded
`"via": "/settings staged-skills inbox"`. The honest split is recorded
too: the engine's own harness stayed quiet this round (15/15 cycles
already-passing, zero improvement patches — it doesn't manufacture
improvements from a passing suite), and the round's real fixes came from
the operator lane: building the guards is what caught the bugs.

## The guards, for the record

- **toggle-marker**: the selected row's `→` marker is asserted as
  pane-truth *before* matching — a product change that drops the marker
  fails the task consciously instead of the matcher silently missing.
- **noop-drift**: the target is `current + offset`, never equal by
  construction; the diff must then name the drifted key. A load-time
  validation flags any task whose expected value equals the declared
  default — and flagged the suite's own hook-depth task, honestly kept as
  a warning.
- **registry-parse**: the audit imports the real module (the parse net),
  and `bisect-registry.mjs` automates the missing-paren diagnosis —
  paren-insensitive span scanning, binary search over candidate temp
  files, a selftest that drills a synthetic catch every run (8 probes,
  ~1 second).

Every number above is read from committed receipts:
[the suite's RESULTS](https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/settings-ux/RESULTS.md),
the session log, and the learning report. Failures leave receipts, not
silence.
