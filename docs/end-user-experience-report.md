# The end-user experience report — the human axis of the learning loop

> The mission's fourth deliverable: what does Unown's learning actually
> feel like to the person operating it? Measured across the round's five
> real headless sessions and the engine's autonomous operation — the
> interventions required, the guidance repeated, the quality of
> context-aware decisions, and the visible improvement over time.

Related: [the UX ledger](../benchmarks/validation-round/ux-ledger.md) ·
[the learning progress report](learning-progress-report.md) ·
[the session envelopes](../benchmarks/validation-round/sessions/)

## User intervention frequency

**Zero across all five sessions.** Every headless session ran to its
boundary (completion or the turn cap) without requiring rescue. The
round's only operator interventions were *deliberate acts of the
validation programme itself*, not agent failures:

1. the F2 recovery surgery (the ground-truth restoration — an operator
   repairing memory the loop had eroded; recorded as the failure it was,
   not as routine supervision);
2. the two REST dream triggers and the mint triggers (measurement acts —
   the router would have run them on schedule anyway, as the opening
   autonomous burst proved).

The mission's metric — "reduction in repeated user guidance" — has a
round-shaped answer: the guidance that would have been repeated (the
engine-restart caution, the project's conventions) was carried by memory
instead. V1's two-turn verbatim recall is exactly the interaction that
would otherwise have been a human typing "don't restart the engine, it
self-recovers" for the Nth time.

## Clarification requests

**Zero.** Bounded prompts with real contexts produced zero `ask`-tool
questions — the sessions had what they needed (memory + repo). The
honest caveat: headless probes with tight prompts are the easy case; the
V3 turn-cap boundary is where a real interactive session would have
asked its human one question ("the DOX pass next, or stop?") — recorded
as the honest cost of the cold start, and exactly what the warm repeat
(V4) no longer needed.

## Task completion efficiency

The cold→warm pair is the headline:

| | V3 (cold, first exposure) | V4 (warm, same area after one dream) |
|---|---|---|
| Turns | 30 — hit the cap, task incomplete | 9 — complete |
| Wall time | 89 s | 27 s |
| Output tokens | 5,995 | 2,020 |
| Outcome | core lane built; the DOX pass unfinished | extension + docs + verification, all done |

A 70% reduction in turns and wall time, and the difference between
"needs another session" and "done" — the mission's "task completion
efficiency" and "time-to-solution" metrics with the memory dream as the
only intervening variable.

## Recovery from mistakes

- **The agent's own mistake** (V2's wrong answer) was converted into the
  round's central fix — and the post-fix re-probe (V2b) self-corrected
  with a citation and an explicit negation of the old wrong claim. The
  user-visible behavior: the agent stopped asserting unverified recalls
  as checked.
- **The system's mistake** (the poisoned memory) was recovered through
  the system's own lanes: git (the tracked file), the corrective note,
  the dream pipeline, and the Manual-notes pin — no bespoke tooling, all
  user-reachable surfaces.
- **The engine's autonomous recovery:** the canary rollback (dream
  `bc0af2fc` gated and reverted without any operator involvement) is the
  strongest single UX receipt of the round — the loop caught its own bad
  memory before it could cost the user a broken task.

## Consistency across sessions

The same factual probe asked twice (V2, V2b) around the fix: pre-fix,
one half right (the memory-location fact) and one half confabulated
(the hashing fact); post-fix, both halves correct with citations. The
engine-restart guidance held identical across every surface that
carried it (V1's answer, the skill, the re-rendered memory) — the
"consistency across sessions" metric is green where memory was
verified, and the round's fixes exist precisely to keep it green.

## Quality of autonomous decisions

- The engine's opening burst (3 cycles, 2 dreams, all green, before any
  operator action) is the autonomy baseline: the loop runs because it is
  scheduled, and its decisions (already-passing → no junk mining;
  canary mismatch → rollback) were all correct.
- The mint's three-layer validation (caps → shape → self-check), each
  discard honest and receipted — the expansion lane refuses to
  pollute the suite with broken tasks, which is the decision quality
  the mission asks of it.

## The honest negatives

- **The V3 turn cap** — a cold session on unfamiliar ground can exhaust
  a 30-turn budget before finishing its housekeeping; the user sees a
  usable-but-unfinished state and must run a follow-up. Memory is the
  mitigation (V4), not a fix for the cold-start budget itself.
- **The drift moment** — the user who trusted V2's confident wrong
  answer got burned; the fix changes the agent's contract (verify,
  cite, mark unverified), but the lesson for the operator is the
  report's own thesis: memory is evidence, and the system now says so
  out loud.
- **The silent reconcile erosion** — two independent instances (upstream
  + this round) of correct facts pruned without any operator-visible
  signal. The Manual-notes lane and the corrective-note recovery are
  the defenses this round shipped; a reconcile-time visibility surface
  (the research's recall-citation gap) is the recorded next step.

## The verdict

The end-user experience measurably improved *within a single session
pair* (V3→V4) and *across the fix boundary* (V2→V2b), and the round's
strongest UX evidence is what did NOT happen: no session needed rescue,
no broken task reached the user (the canary caught it), and the one
poisoned memory was caught, fixed, and pinned within the round that
found it. The learning loop's user-facing promise — fewer reminders,
fewer repeats, better decisions, visible improvement — held wherever it
was measured, and the failures that did occur became permanent,
pinned regressions rather than recurring surprises.
