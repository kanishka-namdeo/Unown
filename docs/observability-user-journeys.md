# Observability round — the user journeys

> The verdict up front: **all five personas buy the same thing — narrative
> continuity.** They differ in which question hurts when it goes unanswered:
> the solo developer needs "what happened while I was away", the senior
> engineer needs "why did it do that", the founder needs "is this worth the
> tokens", the PM needs "is progress real", and the DevOps engineer needs
> "will this fail safely when I am asleep." Every persona's requirements
> reduce to the round's information hierarchy — mission, progress, current
> task, decisions, evidence, risks, learning, metrics, logs — differing only
> in emphasis. No persona asked for more logs.

- [Method](#method)
- [The solo developer](#the-solo-developer)
- [The senior engineer](#the-senior-engineer)
- [The startup founder](#the-startup-founder)
- [The product manager](#the-product-manager)
- [The devops engineer](#the-devops-engineer)
- [The cross-persona synthesis](#the-cross-persona-synthesis)
- [Related pages](#related-pages)

Related pages: [the observability round session record](observability-round-session.md) · [the competitor research](observability-competitor-research.md) · [the TUI observability audit](tui-observability-audit.md)

## Method

Personas are modeled from three inputs, in this order of weight: (1) the
live competitor research — where a documented behavior exists because users
demanded it (Claude Code shipping a returning-user recap, OpenCode shipping
blur-gated attention, OpenHands shipping a budget stop), that demand is
evidence about real users `[V]`; (2) the repo's own recorded user-facing
findings — the end-user experience report's five real sessions (the drift
moment, the silent reconcile erosion, the capped-but-usable turn state), the
troubleshooting symptom table, the standing-orders and ralph doc for
unattended operation; (3) the standard dispositions of each role in code
review, incident response and budget ownership. Each persona carries: the
information they need, the frustrations that recur, the uncertainty points
where trust leaks, and the trust requirements that close them. Personas are
analytical instruments, not demographics — a real user moves between several
in one afternoon.

## The solo developer

The primary user. Runs unown in their own project, one terminal, attention
split between the agent and everything else. Comes back from lunch, from a
meeting, from a school run — and the session has been running.

**Information needed.** First: what happened while I was away — not the token
stream, the story (did it finish? did it break? did it change anything I did
not expect?). Then: what it cost, what it learned about my project, and what
it thinks is left. The recap line must answer "do I need to read anything, or
can I keep going."

**Frustrations.** Scrolling. Anything that requires reconstructing state from
scrollback — counting tool calls to guess whether the task is done, diffing
mentally what changed, re-reading an error from four screens up. The
auto-compaction moment ("Summarized conversation") without a hint of what was
summarized away. Discovering a guardrail blocked something two turns ago and
the agent quietly worked around it.

**Uncertainty points.** "Is it stuck or thinking?" — a generic spinner on a
long tool run is indistinguishable from a hang. "Did my message actually do
anything?" after steering mid-run. "Is memory helping or making things up?"
— the drift moment in the end-user report was exactly this: a confident
wrong recall, trusted because nothing marked it unverified.

**Trust requirements.** A returning state line that is true without being
read (turns, files touched, failures if any, cost). Checkpoints that make
"try it" cheap — /undo must be one keystroke away and advertised at the
moment something looks wrong. Evidence over assertion: when the agent claims
done, the claim should carry its receipt (tests run, files written).

## The senior engineer

Reviews more than types. Suspects the agent of the same sins they suspect
junior engineers of: unexplained decisions, scope creep, silently broken
contracts, confident nonsense.

**Information needed.** Why — the decision trail, not just the action trail.
Which files changed and the diff summary; whether the verify gate and the
syntax gate actually ran; which memory rules the agent was operating under
(did a learned rule cause this?); what the advisor said, if anything; what
the review verdict was. They read the harness receipts the way they read CI
logs — looking for the thing that was skipped.

**Frustrations.** Vagueness in failure ("something went wrong" instead of the
stderr). An agent that retries without saying so, then reports success —
retry count is material. A summary that says "done" when the tests do not
pass. Having to open the dashboard to answer a question the session itself
should have answered.

**Uncertainty points.** "Is a learned rule the reason it did that?" — the
memory tier version is in /status but the causal link is invisible. "How much
of this session is cached vs computed?" when estimating whether a weird
answer came from a stale cache. "Was that hook decision correct?" — the
decision log exists in the dashboard, but mid-session there is no ambient
signal.

**Trust requirements.** Deterministic guardrails with visible receipts, not
best-effort. Cost data with the estimate marked (`~$`). The right to veto
before risk, and a permission mode that is labeled at all times. Rollback for
anything the agent learned (memory versions, shipped patches) — not just for
code.

## The startup founder

Time-poor, outcome-focused, cost-conscious. Wants the agent to work while
they do something else, and to be able to tell — in one glance — whether it
is making progress toward the thing they asked for.

**Information needed.** A mission statement pinned to the screen ("what are
we doing" in their own words), progress toward it (real, derived — not a
spinner), the spend rate, and the moment "it needs me" fires. The 60-second
brief on return: what got done, what remains, what it cost, what it learned
about the product.

**Frustrations.** Agent silence. Any state where the screen shows nothing
usable while the meter runs. A recap that says "14 tool calls" instead of
"auth is fixed, tests pass, 2 TODOs remain." Discovering a rate limit was hit
20 minutes ago and everything since then queued.

**Uncertainty points.** "Is this worth continuing?" — without progress
signal, the only exit is to interrupt and ask. "Is it about to hit the
limit?" — the governor has ceilings but the session does not show them
approaching.

**Trust requirements.** Bounded spend that is visible before it is breached.
A completion signal that cannot fire while work remains (the evidence-gated
goal contract is exactly this — surface it). No silent degradation: if the
engine is down and learning is paused, say so (the footer memory states do
this; keep them honest).

## The product manager

Not the one typing, but often the one asking. Joins to check trajectory: is
the backlog item real, is the demo going to work tomorrow, did yesterday's
session actually fix the bug or just touch files.

**Information needed.** Session list with honest titles (auto-title exists —
make the titles carry outcome). Cross-session analytics: what was worked on,
for how long, at what cost (insights exist — make it ambient). The "what
remains" line above all: open todos, failing checks, paused goals. Export
that a non-terminal colleague can read (markdown export exists).

**Frustrations.** Terminal-native surfaces that assume context they do not
have. A completed task that does not say what was delivered. Files-touched
counts masquerading as progress.

**Uncertainty points.** "Does green mean done?" — a passing suite is not the
mission. "What did the agent decide not to do?" — omissions are invisible in
activity-shaped recaps.

**Trust requirements.** Progress claims tied to artifacts (a file, a test
result) — the goal system's dual-evidence gate. Time spent vs work delivered,
visible enough to answer "are we getting faster" (the repeat-task lift
receipts are the model: 30 turns → 9 is a PM-ready number).

## The devops engineer

Runs unown unattended or semi-attended: routines, watch, ralph loops, long
migrations overnight. Thinks in failure modes, budgets and blast radius.

**Information needed.** The unattended contract everywhere: exit codes,
envelopes, receipts, dead-letters with reasons — shipped, keep it. What they
lack in-session: the recovery surface — a single view of everything that
failed, retried, was denied, dead-lettered or rolled back, with the fix path
per row. The governor's remaining budget as a visible number. Job verdicts
(✓/✗ + error) ambient, not behind the dashboard door.

**Frustrations.** A crashed reviewer defaulting silently to REVISE is the
correct behavior; discovering it happened is currently a dashboard trip.
Dead-lettered notes that require reading a sidecar file to understand. A
crash-loop pause that heals without recording why.

**Uncertainty points.** "Is the engine wedged or draining?" — the lifecycle
phases exist in /api/health; the TUI shows states but the drain-vs-wedge
distinction matters most to this persona. "Did the routine skip, and why?"
— skips are recorded; surface the reason in the session.

**Trust requirements.** Bounded loss with receipts (outbox attempts,
drain budget, forced-exit envelope). Idempotence signals — "this routine
already ran against this state" (hash-stable watch markers do this for
comments; extend the visibility). Nothing that silently masks failure as
success; the failure taxonomy stays first-class.

## The cross-persona synthesis

| Persona | Dominant question | Dominant fear | The surface that answers it |
|---|---|---|---|
| Solo developer | What happened while I was away? | It broke something silently | the mission brief recap + receipts |
| Senior engineer | Why did it do that? | Confident nonsense, unreviewable | decision trail + advisor/verify/review evidence |
| Startup founder | Is it worth the tokens? | Unbounded spend for no progress | mission panel + progress + cost rollup |
| Product manager | Is progress real? | Green-but-not-done | evidence-gated goals + outcome-titled sessions |
| DevOps engineer | Did it fail safely? | Silent failure overnight | recovery surface + job verdicts + dead-letters |

Three structural conclusions fall out:

1. **The mission panel serves all five** — it is the pinned objective
   (founder, PM), the progress-derived narrative (solo), and the anchor the
   decision trail references (senior, DevOps). It is the round's first build.
2. **The recap must become a brief** — activity shape serves no persona
   fully; state shape (objective/decisions/changed/remaining/cost) serves all
   five. It is the round's flagship.
3. **Recovery deserves one surface** — every persona's fear is some flavor
   of silent failure; the data already exists in five places (retries,
   verify, hooks, outbox, engine states) and needs composing, not inventing.
