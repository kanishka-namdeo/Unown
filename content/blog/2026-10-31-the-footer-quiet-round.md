---
title: "The footer quiet round: what a terminal owes you at rest"
description: "The area below the input showed four rows of chrome before you typed a word. This round made it two — and made every chip earn its row."
date: 2026-10-31
lastmod: 2026-10-31
tags: [tui, ux, verification]
type: feature
media: [/blog/2026-10-31-the-footer-quiet-round/01-before-four-rows-at-rest.png, /blog/2026-10-31-the-footer-quiet-round/02-before-the-chip-dump.png, /blog/2026-10-31-the-footer-quiet-round/03-after-two-rows-at-rest.png, /blog/2026-10-31-the-footer-quiet-round/04-after-attention-paints.png, /blog/2026-10-31-the-footer-quiet-round/05-the-classic-kill-switch.png]
---

The bug report was one sentence: *"The area below the user keyboard input
in the TUI has too many elements showing."* We measured before touching
anything. At rest — before you type a word — the footer rendered **four
stacked rows**: a location line, a stats line, a line for every extension
chip, and the hints. With the mission panel above the editor, that was
eight rows of chrome on a 36-row terminal: 22% of the screen spent before
any work happened.

## What was actually wrong

The baseline capture (a real session over the live bridge, 128×36) made it
concrete. After **one** trivial turn, the chip row read:

```
conf ✓ memory: up · stale (v0.0.51) turn 2.7s · ttft 2.7s · ctx 5% · in 26.8k out 2
```

Four defects, all visible in that one line:

1. **Every chip painted, always** — sixteen `setStatus` keys existed, and
   the row admitted each one alphabetically, ambient or not. A memory
   version, a rules count and a dream recency meter answered questions
   nobody had asked yet.
2. **It truncated mid-chip** — `out 2` was the *cut* tail of
   `out 2.1k (cached 26k)`. At width, the dump ate its own facts.
3. **The same facts rendered twice** — the context % lived on the stats
   meter *and* the turn chip; in/out tokens on the stats chips *and* the
   turn chip; `conf ✓` on the mission panel *and* the footer; the active
   goal on the panel *and* its chip.
4. **Nothing could turn it off** — the footer's density had no kill switch,
   which our own UX card says means a feature isn't shipped.

## What the field does

We reverse-engineered the below-the-input design of six terminal coding
agents from their docs, source and changelogs
([every claim sourced](/docs/bottom-area-competitor-research.md)). The
convergence is striking:

- **Claude Code** treats the status line as a *trade* — configuring a
  custom statusline makes it stop showing most keyboard hints — and budgets
  hints ("three showings" per session, 10-second auto-hides).
- **Codex CLI** hides its status row *while streaming* with the comment
  "to avoid duplicate [status indicators]" — duplicates are a named defect,
  not a style choice — and reserves a hint row for messages that *expire*.
- **Gemini CLI** made the footer a declarative, ordered item list: items
  drop whole with `…` at width, the error count is high-priority, and
  healthy items are simply "not shown when unavailable".
- **Crush** ships the healthiest rule of all: the permission-mode badge is
  "an empty string in the default coding mode" — **healthy states are
  silent**. Transient messages get a 5-second TTL.
- **OpenCode** renders cost only when `cost > 0`, subagent chips only when
  nonzero, hints only at ≥44 columns — conditional everything.
- **aider** has no status bar at all: state prints when it changes and
  scrolls away.

NN/g's progressive-disclosure rule frames it: *"the very fact that
something appears on the initial display tells users that it's important."*
Painting ambient state by default tells users the wrong thing.

## The contract we shipped

Four user journeys
([first-time, daily, power, ops](/docs/bottom-area-user-journeys.md)) turned
that research into a manifest that dispositions **every element** below the
input — persistent, situational, or demoted to a drill-in:

- **Two rows at rest.** One merged status line — `~/repo (main) · ctx
  ▕████░░░░░░▏ 42% (auto) · +3 -1 · ↑45k … agnes-3.0-flash` — plus the
  contextual hint line. Location folded into the status row; the meter and
  the model are the survivors at every width; segments drop whole.
- **The chip row became an attention row.** Failures and blockers paint
  first (`✗ 2 to fix · /recovery`, `memory: down`, `mcp: 1 ✗`, `lsp:
  restarting`), then active work (`plan 2/5`, `fleet: 3 running`, the turn
  meter, unseen `✦` learning events). Priority-ordered, whole chips drop
  with a dim `+N` counter — never a mid-chip cut again. A healthy engine,
  an all-connected MCP set, a ready language server: **silent**.
  `/engine`, `/mcp`, `/lsp`, `/status` and the dashboard answer on demand.
- **One fact, one home.** The turn chip is `turn 3.4s · ttft 0.8s ·
  ~$0.0084` — the per-turn dynamics plus the session cost (which used to
  be the stats chip that degraded *first* at narrow widths). Context % and
  tokens stay on the status row. Confidence and the active goal live in
  the mission panel; kill the panel and their chips return.
- **A real kill switch.** `UNOWN_FOOTER_CLASSIC=1` restores the exact
  pre-round four-row footer, the ambient chip lines and the turn meter's
  full legacy format — one variable, both layers, read live.

## Verified like a user, not like a test

The round's [verification lane](/docs/footer-quiet-round-session.md) boots
the real TUI against the live stack and asserts on the pane itself — 9/9:
the merged row, the two-row rest, ambient silence with a healthy engine,
the busy hint swap, the turn-chip dedup, the engine-down attention row
(measured live: `memory: starting…` at ~1s, `memory: down` at ~8s — the
spawn-kick re-probe cadence), and the classic restore. The unit suites pin
both layouts: the vendored footer 43/43, the self-learning layer 5426/0.

The stills in this post are PTY-lane captures (the repo's
`scripts/tui-capture/` pyte lane — real process, real keystrokes, the pane
text shipped beside every image); the tmux/ttyd lane that produces the
landing page's truecolor stills needs host binaries this machine lacks.
Nothing was retouched — re-run, not repaired, is the lane's rule.

The bottom area now answers the only three questions a status bar owes you
at rest — *where am I, what model, is context fine* — in two rows, and
spends a third only when something actually needs you.
