---
title: "The Calando round: quieting the middle of the session"
description: Semplice quieted the first minute. Calando takes the same teardown to minute fifteen — the noise a working session accrues, and the knobs you could not reach.
date: 2026-11-17
lastmod: 2026-11-17
tags: [tui, ux, research]
type: feature
media: [/blog/2026-11-17-the-calando-round/calando-baseline-density-128.png, /blog/2026-11-17-the-calando-round/calando-density-128.png, /blog/2026-11-17-the-calando-round/calando-multitool-128.png, /blog/2026-11-17-the-calando-round/calando-q4-hub-menu.png, /blog/2026-11-17-the-calando-round/calando-q4-interface-section.png, /blog/2026-11-17-the-calando-round/calando-q4-toggle-on.png]
---

*Calando* — the musical instruction to grow calmer, dying away. The
[Semplice round](/blog/2026-11-17-the-semplice-round) asked what a
first-time user should never see. This round asked the harder question:
**what does a user fifteen minutes into real work see that they
shouldn't?** First impressions get designed; the middle of the session
just accretes.

We ran the same method: capture our own TUI through a real PTY doing real
tool work, count what every pane carries, and hold each line against the
HCI literature before touching code. The mid-session brief covered eight
findings — interruption cost and attention residue (Mark et al. 2008;
Leroy 2009), the redundancy effect taxing working memory (Sweller &
Chandler 1994), split attention between footer and transcript (Chandler &
Sweller 1992), the transient-information effect (Wong et al. 2012),
expertise reversal (Kalyuga et al. 2003), occupied waits (Maister 1985;
Harrison et al. 2007), calm peripheral display (Weiser & Brown 1996), and
pre-attentive scanning (Treisman & Gelade 1980). The competitor teardown
re-read Claude Code, Codex CLI, Gemini CLI, aider, Crush and Amp with
mid-session eyes. Four findings survived the triage with their seams
named — the Q-list.

## The noise a working session accrues

Here is our own baseline — one turn, one file written, one command run,
128 columns — before this round:

![The baseline pane: Took 0.0s under a fast command, and a mission panel narrating nothing](/blog/2026-11-17-the-calando-round/calando-baseline-density-128.png)

Two lines are noise. `Took 0.0s` under a command that finished in
milliseconds — the most common case printed a number nobody asked for;
the rationed-line principle says a line must earn its row, and a
sub-second duration never earns one. And the mission panel's
`○ no tracked steps · on track ✓ · 0m in session` — three facts about
nothing that survived the Semplice round's own null-state fix by exactly
one condition: the fix gated on "zero turns have run", so after the
first completed turn an idle session narrated its idleness forever. The
turn chip already carries per-turn time and cost; `/usage` owns the
session totals; "on track" is vacuous with nothing to be on track FOR.

The same turn after Calando — both lines gone, nothing else moved:

![The same turn after Calando: the noise rows are gone, the healthy pane is unchanged](/blog/2026-11-17-the-calando-round/calando-density-128.png)

The multi-tool lane (list, read, count — three calls in one turn) had it
worse: two `Took 0.0s` lines plus the null row. All gone:

![The multitool lane: three tool calls, zero duration noise](/blog/2026-11-17-the-calando-round/calando-multitool-128.png)

One rule cuts all three: **telemetry alone is not a row**. The panel
renders when something is happening — a mission, tracked progress, a
live turn, risks, fresh learning, degraded confidence — and session
facts join the status row only when that row already earns its place. A
completed command's duration renders only at one second or more; the
live `Elapsed` line always renders, because the occupied-wait research
is non-negotiable — a running command must never look frozen.

## The notice that cried wolf

The third finding came from our own sandbox: a user behind a proxy (or
a rate-limited GitHub) saw the full two-line actionable
"Failed to download fd" notice at **every session start**. An error
guideline's crying-wolf failure mode, in slow motion: recurring
identical notices train scan-past, and the day the notice matters is the
day nobody reads it. The fix is a latch — the first failure keeps its
full notice with the recovery path; repeats render one dim line naming
the tool, the attempt count and the manual way out; success clears the
counter. `UNOWN_MANAGED_TOOLS_VERBOSE=1` restores the full error for
debugging.

## The knobs you could not reach

The last finding was ours alone: the three quiet knobs —
`UNOWN_FOOTER_CLASSIC`, `UNOWN_TURN_METER`, `UNOWN_MISSION_PANEL` —
were env-only, documented in `.env.example`, shown as READONLY rows in
the settings hub. A user who wanted the classic footer back had to
leave the TUI and edit shell config. Semplice's own closing inventory
called it: a knob that cannot be turned off is not shipped, and a knob
you can only flip by editing `.bashrc` is barely better.

They are hub-owned toggles now — `/settings` → Interface for the
classic footer, Observability for the turn meter and the mission panel:

![The settings hub: the control centre, Interface highlighted](/blog/2026-11-17-the-calando-round/calando-q4-hub-menu.png)

![The Interface section: Classic footer (legacy 4-row) as a live toggle row](/blog/2026-11-17-the-calando-round/calando-q4-interface-section.png)

The precedence is explicit: **an env var set before boot wins** — kill
switches stay king — and when that happens the hub's write fails
honestly with "unset it in your shell to toggle here" instead of
printing Saved over a write that never landed. That honesty clause was
earned the hard way: the live receipt caught our first cut reporting a
successful toggle while the preference silently refused to persist (the
boot seam's second pass had mistaken its own seeding for an explicit env
var and locked every knob). The receipt-driven fix shipped in the same
round.

![The toggle lands: Saved, Now on, and the option flips to Turn OFF](/blog/2026-11-17-the-calando-round/calando-q4-toggle-on.png)

## What we did not do

The deferred list is on the record: token-info consolidation (~8 homes
— needs an owning-surface decision per fact, an architecture round),
the fleet panic button (needs the chord layer a prior round deferred),
the consolidated trust surface, split-view command sprawl and plan-mode
entry-lane compression (menus, not narration — the next density round).
Depth was never the enemy; noise was. The deep surfaces — the
transcript viewer, the dashboard, `/usage`, `/brief` — keep their jobs;
the ambient layer points at them, it does not absorb them.

The full record — every claim with its source, every pane with its
receipt — lives in
[docs/calando-round-session.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/calando-round-session.md)
and the [UX principles card](https://github.com/kanishka-namdeo/Unown/blob/main/docs/unown-ux-principles.md),
which now carries the mid-session amendments as binding contract.
