---
title: Round 2: when the browser remembered before it clicked
description: Closing the recall-vs-application gap — a tool-time memory hint lane, and the run where the agent armed the dialog before the trap.
date: 2026-11-01
lastmod: 2026-11-01
tags: [browser, memory, benchmarks]
type: feature
media: []
---

The browser autonomy round left a queue. The most interesting item wasn't a
bug — it was a *when*. Our agent had learned, through its own tiered memory,
that native `confirm()` dialogs auto-dismiss by default and cancel the flow,
and that the fix is arming `browser dialog accept` **before** the click that
opens the dialog. The knowledge was in its memory. The model read it at
session start. And then it clicked anyway — every single run — and
recovered *after* the trap fired.

Recall: validated. Application: partial. The lesson lived at session start;
the moment it mattered was the tool call.

## The hint lane

So we moved the knowledge to the moment. The first `browser` call of a
session now returns a compact digest of the browser-relevant entries from
the project's memory — at most eight lines, each clipped, deduped, riding
*after* the action's own result so the fresh snapshot is never displaced.
The first `navigate` to a host the memory mentions gets that host's slice.
Once per session, once per host, two file reads, no engine in the loop, and
`UNOWN_BROWSER_HINTS=0` turns it off.

The properties that matter to us: it's cheap by construction (the same
`.md` artifacts the session-start injection reads), and it's honest by
construction — repo-resident memory runs through the same injection guard
as everything else, and a flagged entry is annotated `[unverified]`, never
silently included. Hints stay hints.

## The run where it mattered

The stress-checkout benchmark now has six receipted runs. Runs one through
three all hit the dialog trap and recovered — first with two exploratory
actions, then (after the dream consolidated the lesson) with one direct
recovery. Run six, with the hint lane live:

- the first browser tool result carried the digest, dialog lesson included;
- the agent armed `browser dialog accept text=OK` at tool call **eleven** —
  *before* the triggering click at twelve, citing "the learned procedure";
- the trap never fired. First prevention in six runs.

The address form saved on the first attempt (the iframe-race fix from the
last round holding), and the final screenshot was saved as a true PNG —
because the same round also fixed screenshot naming, so a `.png` filename
now actually captures PNG bytes and a format/extension clash refuses
loudly instead of writing mislabeled files.

## The quiet bug the gate was hiding

The round's other find came from re-running a past failure. Twice in one
day during the last round, an AutoDream render of our project memory pruned
a line that the landing page quotes verbatim — once it reddened CI, once it
drifted *silently*. Re-running the silent case in this tree found why: the
claims gate's lenient matcher (built for interpolated engine logs) was
reading our memory file's markdown backticks as JavaScript template
literals — 82 bogus "segments" — and a fully deleted line still passed
because an unrelated memory entry shared a 12-character window with it.

The memory route of the gate is now exact: verbatim containment or failure,
with the remedy printed in the failure itself (the `## Manual notes` lane,
which every dream render preserves verbatim — now pinned by a test where a
landing-quoted line survives a render that prunes its platform-memory
twin).

## The numbers

The docs-navigation benchmark ran warm on a second technology — MDN Canvas
`roundRect` this time — and verified every overload (single radius, array,
`{x, y}` object, `DOMPoint`, mixed) plus the documented `RangeError`,
pixel-level corner probes and all, in twelve calls with zero interventions.
A control run in a fresh project with no memory took the same path with the
lane correctly silent. The workflow transfers; the call count is
task-sized, not a regression.

And the hostile-checkout procedure — the six steps the runs kept
re-learning — is now a promoted skill, `hostile-page-checkout`, verified
loading in a live session.

The full receipts live in the
[round 2 session log](https://github.com/kanishka-namdeo/Unown/blob/main/docs/browser-autonomy-round-2-session.md)
and the [benchmark results](https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/browser-autonomy-round/RESULTS.md).
The next datum on this axis is scheduled, not hoped for: the weekly
release-monitoring routine fires on its own for the first time on
November 8th.
