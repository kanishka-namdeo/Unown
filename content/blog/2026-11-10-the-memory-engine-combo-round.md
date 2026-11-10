---
title: "The memory-engine round: dream-now that dreamed nothing"
description: "Every write lane, dream, read lane and tier combination driven live against a real engine — a dream button that lied, a search lane that whispered empty."
date: 2026-11-10
lastmod: 2026-11-10
tags: [memory, engine, release]
type: feature
media: [/landing/tui/dashboard/stills/02-memory.png]
---

The last two combination rounds put plan mode and the TUI through every
combination they could reach. This round's directive turned the same
sentence on the system underneath: **test all possible combinations of
using the memory engine for tasks, fix whatever is not up to the latest
standards.** Write lanes (in-session `/note`, the agent's note tool, exit
notes, shell notes, hand-edited Manual notes) × consolidation (project
dreams, canary-gated benchmark dreams, quarantine) × read lanes
(session-start injection, `/learning`, `/memory search`, the HTTP search,
the dashboard) × tier setups × lifecycle — grounded in
[a late-2026 standards brief](https://github.com/kanishka-namdeo/Unown/blob/main/docs/memory-engine-standards-2026-11.md)
that reads mem0, Letta's git-backed MemFS, Zep's temporal graphs and the
2026 poisoning literature so the bar is the field's, not our own.

## The dream button that lied

The dashboard's **"dream now"** key answers `{started: true}` — and with
one or two benchmark notes pending, that answer was a lie. The manual
trigger had inherited the *automatic* lanes' cost policy: don't wake the
extraction LLM for fewer than three notes. Sensible for a scheduler.
Silent vapor for a button. Measured live: the trigger reported a start,
the fire-and-forget body consolidated **nothing** (below the threshold
the engine lane skipped; no terminal notes meant the project lane had
nothing either), and the Dreams screen showed no new row. The same defect
class this endpoint had already fixed for terminal notes — a note kind
reporting "started" and consolidating nothing — was still open on the
benchmark lane.

The fix honors what a manual trigger *is*: explicit user intent. **Any
benchmark note (≥1) runs the engine dream; the ≥3 threshold stays the
autonomous lanes' policy** — the router still won't spend tokens nobody
asked for. The zero-note junk row stays guarded. A pin now drives the
single-note state against a dead bridge and asserts the honest outcome: a
dream row that *ran*, not a skip.

A second, subtler finding rode the same lane: the live suite's
concurrency probe — "two simultaneous dream triggers must serialize
(200/409)" — could fail in *both directions*. Both 409 when the router's
own deferred dream-check held the mutex; both 200 when the no-op dream
acquired and released it in a millisecond. The mutex itself is sound
(synchronous check-acquire, no TOCTOU — the diagnostic probe proved it);
the *lane* was racing everything but the thing under test. It now waits
for full idle and asserts the winning trigger produced a real dream with
notes in it — a skipped trigger can no longer pass vacuously.

## The search lane that whispered empty

The platform scopes terminal projects as `project:<slug>` — "the tier key
IS the agent_id." The cross-scope search resolves through that helper and
works. The **scoped** HTTP lane took your `?agent_id=<slug>` at face
value, constructed a scope that does not exist, and answered a silent
empty set. Measured live: the alpha project listed **0 of 2 memories**
through its own slug and 2 of 2 through the prefixed form. Every surface
that prints the slug — the dashboard, the dream rows — told you a name the
search lane wouldn't accept.

The handler now resolves a raw slug that names a dreamed project scope
through the prefix; the explicit `project:<slug>` spelling and genuinely
foreign agent ids pass through untouched. Two pins hold both behaviors.

## The transparency line that scrolled away

`/learning` prints the effective four-tier stack — and ends with the two
lines that matter most: which engine state you're reading (the staleness
frame) and the **injection budget** (the never-silent-truncation
guarantee). They were emitted *first*. A notify renders its *tail* — so
on a stock 36-row terminal with a real dreamed stack, the budget line was
the first thing to scroll off the top, exactly when the stack got long
enough to need it. The pane dump is the receipt: the visible window began
mid-project-tier. The tiers now render first and the transparency block
rides the tail, visible in every geometry, overflow named (`pruned`,
`head-truncated`, `OVERFLOW`) — pinned by the new budget phase of the
matrix lane.

![The Memory screen](/landing/tui/dashboard/stills/02-memory.png)

## The lane that stays

`verify_memory_matrix.py` joins the permanent PTY fleet: eight phases —
boot, `/learning`, the hand-edited Manual-notes read lane, `/note` (the
answer *and* the row in `/api/notes`), `/memory search`, `/new`
re-resolution, the forced budget overflow, and the exit note — sixteen
steps through the real TUI in a real project against a live engine, all
green on the round's final run. The engine-side live gates re-ran green
too: the injection marker VERBATIM in the upstream request, a real dream
with a passing canary, both poisoning probes (poison never ships), and
the outbox arc — engine killed, note queued, engine rebooted, note
ingested and archived — end to end.

The round also recorded what it checked and *left alone*: the worktree
shares the repo's memory scope (the gitdir hop works); a clone made from
a local path gets its own scope — git never propagates the source's
remote, and the identity contract is remote-keyed, so the workaround is
`git remote set-url`. And the rollback lane answered forward-only, as
designed: restoring v4 minted v7, an audit row naming `rollback`.

Full suite: 5609 tests, 0 failures. The receipts — every measurement
quoted above — are in
[the round log](https://github.com/kanishka-namdeo/Unown/blob/main/docs/memory-engine-combo-round-session.md).
