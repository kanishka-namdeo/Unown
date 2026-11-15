---
title: "The Toccata round: reverse-engineering Claude Code's touch, key by key"
description: A 47-point teardown of Claude Code's terminal UX, the sixteen patterns Unown adopted, and the six we deliberately refused — with the receipts.
date: 2026-11-16
lastmod: 2026-11-16
tags: [tui, keyboard, verification]
type: feature
media: [/blog/2026-11-16-the-toccata-round/verb-thinking.png, /blog/2026-11-16-the-toccata-round/agents-md-offer.png]
---

A toccata is a "touch" piece — written to show off how a player *touches*
the keys. This round was the keyboard round: reverse-engineer Claude
Code's terminal experience like a UI/UX researcher (every claim cited,
from the official interactive-mode reference to the spinner-verb
community catalogs), audit Unown's own TUI against it point by point,
then ship the proven gaps end to end.

The teardown lives in
[docs/tui-claude-code-parity-research.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/tui-claude-code-parity-research.md)
— the official interactive-mode and commands references fetched in full,
the sibling landscape cross-checked (Amp's command palette and prompt
history, Codex's community-filed Shift+Tab request, Gemini's `/theme`,
opencode's fork, Aider's git ceremony), and a **47-point audit** of
Unown at the round's base commit, every row carrying the seam.

The verdict up front: Unown's chassis was already frontier-grade —
queueing with take-back, permission-mode cycling, scored plan approval,
split view, a quiet two-row footer, differential rendering with Kitty
progressive enhancement. The gaps concentrated in five places: the
input-history lane, the draft lifecycle, the transcript viewer, the
permission-comment lane, and the personality layer. Sixteen adoption
decisions (A1–A16) and six deliberate refusals later, all five lanes
have shipped.

## What landed

**The editor lane (A1–A6).** Input history now persists per working
directory — Claude Code's own contract — with a 500-entry cap and
cross-session Up-recall. `Ctrl+R` opens the reverse-search dialog with
fuzzy filtering, previews, and a scope cycle through *this session /
this project / all projects*. `Ctrl+S` stashes the whole draft (text,
cursor, paste markers, even the bash-mode badge); a cleared draft lands
in history for `Up` to restore, exactly the bring-back-a-cleared-draft
behavior Claude Code documents. `Ctrl+D` gained the two-press exit
confirm with its 800 ms window.

**The queue and image lanes (A7–A8).** `Ctrl+Enter` (where the terminal
reports it) or `Alt+S` everywhere flushes the queued messages now — the
draft joins the queue first, then the running turn drains it through the
abort matrix. Pasting an image inserts an atomic `[Image #N]` chip you
can reference positionally, so a pasted screenshot reads as *part of the
sentence*, not a raw `/tmp` path.

**The transcript lane (A9–A10).** Fullscreen `Ctrl+O` now toggles a
modal transcript viewer: `{`/`}` jump between prompts like vim paragraph
motion, `/` searches with `n`/`N`, `[` writes the conversation to the
terminal's native scrollback so `Cmd+F` and tmux copy mode can search
it, `v` opens it in `$EDITOR`, `?` shows the keys. Consecutive calls to
the same tool collapse to `⋯ called bash ×3 · ctrl+o` — the aggregation
Claude Code ships, verified against its own changelog example.

**The dialog and command lanes (A11–A14).** Permission asks take a
comment (`Tab to amend`): an allow-with-comment reaches the model after
the tool result, a deny-with-comment rides the reason. Typing `/` after
a space anywhere completes commands mid-prompt. `/cost` and `/theme`
join as aliases — the theme picker live-previews and never persists
until Enter. `/rewind` opens the checkpoint menu Claude Code made
famous: restore code and conversation, conversation only, or code only.

**The personality lane (A15–A16).** While the model thinks, the working
line now carries a rotating **spinner verb** — `Pondering...`,
`Percolating...`, `Vibing...` — one verb per three-second window, never
repeating itself, rotating on the elapsed chip's existing timer (no new
timers; that discipline is test-pinned). The moment a tool runs, the
honest label wins: `Editing math.ts...`, `Reading README.md...`.
Personality never shadows truth.

![The working line mid-turn: the spinner verb on the left, the mm:ss elapsed chip beside it](/blog/2026-11-16-the-toccata-round/verb-thinking.png)

And the onboarding card got repo-aware: open a repo that has no
`AGENTS.md` and the first flights catalog leads with the one task the
repo state actually asks for — *Initialize an AGENTS.md* — Claude
Code's `/init` moment, translated. A returning user still gets that
offer once per repo, recorded in a capped latch so it never nags.

![The first-flights card in a bare repo: the Initialize an AGENTS.md offer leads the list](/blog/2026-11-16-the-toccata-round/agents-md-offer.png)

## What we refused, on record

The research's most useful output might be the refusals. A **full vim
editor** is a multi-thousand-line surface; shipping a partial one that
traps power users is worse than none. **Voice input** needs microphone
access a headless-capable coding agent shouldn't demand. **Spell check**
is a dictionary dependency for prose that is mostly identifiers and
paths. **Enter-queues** — Claude Code's classic model — was rejected
because Unown's Enter-steers default is a deliberate differentiator
(Amp validated the same call). **Ghost-text autocomplete** lost to the
list-with-argument-hints form: richer for command discovery. Every
refusal carries its reason in the decision record, so "why don't we
have X" has an answer that isn't "we forgot".

## The receipts

Every adoption is pinned by tests — the round's final count: 16 new
unit batteries across the tui, coding-agent and self-learning packages,
the full suites green over their documented baselines, and a new PTY
lane (`scripts/tui-capture/verify_toccata_cp5.py`, 10/10) that drives
the real TUI against the live stack: a real Agnes turn showing the verb
then the tool-label takeover, and the offer card verified across four
boot shapes (fresh, returning, re-boot, repo-with-file). The lane even
re-proved an old law on the way: its first footer regression run failed
on an honest `old build` chip because the engine was still booted from
the previous commit — a stale engine is a stale verdict.

The full ledger is the round's session log,
[docs/toccata-round-session.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/toccata-round-session.md),
and every keybinding is in the
[usage reference](https://github.com/kanishka-namdeo/Unown/blob/main/docs/usage.md#keybindings)
with its Windows/WSL variants in parentheses.

## What ships next

The audit's deferred items are on record in the decision doc — the vim
editor as its own round if demand appears, and the focus-view lane —
so the next keyboard round starts from a map, not a mystery.
