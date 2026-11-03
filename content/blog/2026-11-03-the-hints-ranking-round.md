---
title: "The hints-ranking round: when six new facts shouldn't evict the one that matters"
description: The browser-memory hint digest becomes category-balanced — round-robin across idiom classes so a burst of new facts cannot evict the dialog lesson.
date: 2026-11-03
tags: [memory, browser, learning]
type: feature
media: []
---

The browser autonomy round shipped a small mechanism with an outsized
measured effect: the tool-time browser-memory hint lane. The first
`browser` call of a session carries a digest of browser-relevant memory
(arm `dialog accept` before the confirm-guarded click, the cookie-banner
path, the screenshots convention), and the stress-checkout benchmark's
run 6 — the first run with the lane live — pre-armed the dialog accept
BEFORE the triggering click, skipping the trap for the first time in six
runs. Recall became application.

This round is about the lane's quiet failure mode, found by the round
that shipped it: **the digest could silently drop its most valuable
entry to recency.**

## The failure mode

The project-memory render is newest-first — the renderer sorts entries
by update time, descending. The hint digest's selection was top-down
keep-first-8. Put those two facts together and the failure writes
itself: when AutoDream consolidates a session and mints a burst of
same-class facts — say six new cookie-banner variants — they render at
the top of the file, and the digest's eight slots fill with banner
entries before the walk ever reaches the bottom, where the OLDEST
entry lives: the dialog lesson. The exact fact whose surfacing made run
6 pre-arm the accept policy. A dream doing its job — consolidating new
knowledge — silently evicted the load-bearing old knowledge from the
digest.

The cap wasn't the bug. The cap (eight entries, each clipped) is the
design — a digest is a pointer, not a re-injection. The bug was that
recency was the ONLY ranking signal, and recency has no idea which
facts are load-bearing.

## What the research says

The grounding question: how do agent-memory systems rank recall
candidates when recency isn't the only signal? Three findings shaped
the design:

- **Composite scoring over pure recency is the emerging default.**
  Hermes-agent's semantic recall blends `0.5·similarity + 0.3·recency
  + 0.2·importance` with a 30-day recency half-life — motivated by
  exactly our drift: "a critical architecture decision from 6 months
  ago outranks a trivial note from yesterday that happens to mention
  similar keywords."
- **Diversity-aware selection is the classic cure for one-cluster
  dominance.** MMR — Carbonell & Goldstein, 1998 — re-ranks by relevance
  AND novelty so one cluster cannot eat the result set; 2026 feature
  requests against Cloudflare Vectorize and openclaw carry the same
  framing, noting it is "tiny to implement, no external API."
- **Retrieval precision is load-bearing on its own.** PrecisionMemBench
  showed systems with retrieval precision of 0.05–0.08 look fine only
  because the downstream model compensates — a bounded digest that
  silently drops its most action-critical entry is the same failure
  class wearing a smaller hat.

## The adaptation, honestly priced

The hint digest is pure text over two markdown files — no timestamps on
bullets, no embeddings, no database. The lane's CHEAP constraint (two
file reads, no engine) is load-bearing and stays. So neither Hermes'
decay curve nor vector MMR is available as-is.

What IS available lexically is their shared shape: a relevance signal
per entry, plus a diversity constraint across the selection. The
shipped design:

- **An ordered classifier** — every browser-relevant entry lands in
  exactly one of eight idiom classes: `dialog`, `banner`, `auth`,
  `frames`, `capture`, `stealth`, `host`, `general`. The vocabulary
  aligns with the lane's existing pre-filter regex, so no entry that
  used to match falls out of classification.
- **Round-robin selection** — classes cycle in first-appearance order,
  newest-first within a class; a class that runs out drops out of the
  cycle. A burst of six banner entries takes its fair share of the
  eight slots and no more, and the dialog lesson — whatever its age —
  keeps a slot because it is the only entry of its class.

It is the lexical cousin of MMR's diversity constraint: newest still
wins WITHIN a class, but one class cannot eat the digest. And it
degenerates gracefully — a single-class digest behaves exactly like
yesterday's file-order walk, which is pinned by test.

## The pins

Six new tests in the browser suite (53 → 59, all green): the
dream-burst regression (six banner entries + the oldest dialog lesson —
the lesson survives, banner takes four slots by the documented
exhaustion trace), the degenerate single-class file order, determinism,
the fair-share bound (three classes, eight slots, none exceeds three
while another still has entries), the classifier coverage (one
representative per class, every representative admitted by the
pre-filter), and the host-slice round-robin (the per-host digest rides
the same selection path).

Plus two doc syncs the recon surfaced: `UNOWN_BROWSER_HINTS` — the
lane's kill-switch — was read by the code but undocumented in
`.env.example`, violating the every-env-var-documented contract; and
`docs/browser.md`'s tool-time hints section gained the
**Category-balanced** property bullet, so the contract page says what
the code now does.

## The round's other story

This round also receipted the programme's fifth fresh-lineage bring-up:
a full sandbox recycle ate the working tree mid-ticket — the clone, the
A2 session with three chunks of in-flight work, the operator-side
scratch, everything except what was already pushed. Nothing on `main`
was lost, because the round-opening commit (claim, design, research
receipt) landed BEFORE the first dispatch. The re-dispatch baked in
every learning the lost attempt had paid for — don't run the root suite
mid-ticket, the typecheck-parity verdict, receipts from chunk one —
and completed in four chunks what the first attempt had spread across
three plus a recycle. The checkpoint-before-dispatch discipline isn't
ceremony; it is what turns a host loss into a re-run.

The full record — research receipt, the A2 ticket protocol, the
chunk-by-chunk ledger — is in
[docs/hints-ranking-round-session.md](https://github.com/kanishka-namdeo/Unown/blob/main/docs/hints-ranking-round-session.md).
