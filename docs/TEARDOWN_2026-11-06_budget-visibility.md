# TEARDOWN 2026-11-06 — the mid-run budget-control convergence vs A2's advisory budgets

> The Rondo round's second §7 competition-cycle teardown (due at the
> >5-ticket mark since [the Letta teardown](TEARDOWN_2026-11-06_letta-filesystem-memory.md);
> filed at the round closeout by the twenty-fifth lineage). Sweep: 6
> source-reads (1 full SDK page, 1 primary hooks reference, 4
> snippet-level reads — depths marked honestly per the source-citation
> law). Pick: **the budget-visibility class** — the industry's answer to
> the exact finding C-11 receipted (165 turns, the 8-turn EFFORT_BUDGET
> advisory, the cap gate firing post-hoc).

## The sweep table (6 reads, 2026-11-06)

| # | Source | Depth | What moved | Unown-relevant? |
|---|---|---|---|---|
| 1 | Strands Agents SDK — the Agent Loop doc | **full page** | Invocation limits cap turns AND tokens per call; **stop reasons report why the loop ended**; hooks intercept any step; retry strategies separate from limits | High — the loop-contract shape A2's harness lane orbits |
| 2 | Claude Code — hooks reference + best practices (primary docs + a community mirror) | primary snippets + mirror | **Stop hooks**: exit code 2 sends the agent back to work; max-turns interacts with hook limits; PreToolUse/PostToolUse event surface; hook types incl. `prompt` (LLM) and `agent` (subagent) | High — A2's hook surface is the direct neighbor |
| 3 | OpenHands — MAX_ITERATIONS + issue #2121 (GLOBAL_MAX_ITERATIONS) | snippets | Per-conversation max iterations exists; the GLOBAL ask (a fleet-wide ceiling) is an open feature request — the per-run vs fleet-budget split | High — A2's governor/breaker live exactly this split |
| 4 | OpenHands — the Stuck Detector + issue #5480 | snippets | The detector identifies "repeating the same actions, encountering repeated errors" from conversation history; the recovery gap (a stuck conversation cannot receive further messages) is a shipped-bug receipt | **Highest — A2's V-14 spiral watch is the manual lane of exactly this** |
| 5 | Codex CLI 0.142.0 (the /usage + budgets release, via the community changelog) | secondhand snippet | **Rollout token budgets track usage across agent threads; remaining-budget reminders are SHOWN; turns ABORT when the configured budget is hit** — plus a standing feature request for deterministic `--max-steps` on `codex exec` | **Highest — the closest shipped answer to the C-11 finding** |
| 6 | Claude platform — extended thinking `budget_tokens` + MAX_THINKING_TOKENS + effort levels | snippets | Per-turn thinking budgets as first-class configuration; thinking tokens count toward max_tokens; effort levels map to budget presets | Medium — A2's --effort flag is the same lane at coarser grain |

## The pick, torn down: what the budget-visibility class actually shows

1. **The claim (three systems, one direction)**: budgets moved from
   REQUEST-SCOPED configuration (max_tokens per call — table stakes) to
   RUN-SCOPED state: Codex tracks a budget across a rollout, surfaces
   the REMAINING amount to the operator mid-run, and aborts turns at
   the limit; Strands caps turns+tokens per invocation and reports a
   stop REASON; OpenHands bounds iterations per conversation. The
   convergent shape: **enforce mid-run, report why, show the
   remainder**.
2. **The mechanism they share**: the budget is not prose in the prompt
   — it is harness state the harness itself enforces, with the model's
   pacing informed by visible remainders (the OpenHands proposal to
   make the iteration limit visible TO THE LLM is the sharpest form:
   a model that can see its remaining budget can pace itself; one that
   cannot will discover the wall by hitting it).
3. **The caveats**: the recovery gap is real even in the shipped
   systems (OpenHands #5480: a stuck-flagged conversation cannot
   receive further messages — the abort path ate the resume path);
   per-run ceilings do not compose into fleet budgets (OpenHands
   #2121 still open); and secondhand changelog readings (Codex via the
   community post) carry the usual fidelity risk — the teardown marks
   its depths and does not over-read them.

## Against A2's architecture (the honest reckoning)

A2's budget surfaces today: `--max-turns` (a POST-HOC cap — the C-11
165-turn dispatch ran to completion and only then reported
`capped: true`), the spend governor (engine-side tokens/hour — it
throttles the DREAM lane, not the operator's dispatch), the breaker
(provider-health class), the `--effort` flag (a provider hint), and
the brief's EFFORT_BUDGET (prose — agnes-3.0-flash ignored it twenty
times over). The V-14 spiral watch (the operator reading chunks for
self-chosen mechanisms burning >2 chunks) is MANUAL detection of what
OpenHands automates.

- **The enforcement gap is A2's own receipt**: C-11 is the
  round's cleanest evidence — every gate green, the budget blown 20×,
  the operator blind until the end. The filed turn-budget-hook
  candidate is exactly the Codex-shaped abort lane.
- **The visibility gap is the sharper finding**: A2's dispatch
  envelopes already carry turns/cost — the OPERATOR sees them
  post-hoc. No surface shows the MODEL its remaining budget, and no
  surface shows the OPERATOR mid-run. The industry direction says
  both want it.
- **The stuck-detection lane**: A2's engine already watches dispatch
  traffic (the harness-cycle job, the A2H-7 watcher) — the
  conversation-history pattern analysis (repeated actions, repeated
  errors) is buildable engine-side without new surface.

## What this teardown changes (the picks that matter)

1. **The turn-budget hook candidate (already filed from C-11) gets its
   design sharpened** — not stop-at-N but the three-part Codex shape:
   (a) the harness enforces the turn budget MID-RUN (the abort at the
   limit, not after), (b) the remaining budget is injected into the
   session at intervals (the model paces itself — the OpenHands
   proposal's form), (c) the envelope's stop-reason taxonomy gains the
   budget class (the Strands form). Registry: the PROPOSE row stays;
   the design inputs are this teardown's receipt.
2. **A stuck-detection candidate enters the registry at PROPOSE** (the
   OpenHands detector's shape on A2's engine: repeated-action and
   repeated-error patterns over the session log, surfaced on the
   dashboard + the dispatch envelope) — the V-14 manual watch
   automated. NOT dispatched this round (the closeout files it).
3. **No adoption**: the fleet-budget ask (OpenHands #2121's class) —
   A2's governor already answers it engine-side; the recovery-gap bug
   is a caution receipt for the hook's design (the abort path must
   preserve the resume path — the V-12 continuation economics stay
   supreme).

## Verdict

The C-11 finding is not an A2 idiosyncrasy — it is the round's local
instance of an industry-wide gap the leading harnesses are closing
RIGHT NOW (Codex shipped it; OpenHands is proposing it; Strands ships
the reporting half). The teardown's value: the filed candidate's
design is now sourced from three shipped systems rather than one
local receipt, and the closeout's registry carries the second
candidate (stuck detection) with the OpenHands shape as its receipt.
The honest depth note: one full-page read, the rest snippets — the
next round's PROPOSE-gate research should open the Codex changelog
primary before building.

Sources: [Strands Agent Loop](https://strandsagents.com/docs/user-guide/sdk/agents/agent-loop)
· [Claude Code hooks](https://code.claude.com/docs/en/hooks)
· [OpenHands #2121](https://github.com/OpenHands/OpenHands/issues/2121)
· [OpenHands #5480](https://github.com/OpenHands/OpenHands/issues/5480)
· [Codex 0.142.0 community changelog](https://www.reddit.com/r/CodexAutomation/comments/1ugbc26/codex_cli_update_01420_usage_credit_redemption)
· [Claude extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
