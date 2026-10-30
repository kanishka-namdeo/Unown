# The Unown UX principles

> The codified contract behind every TUI surface: what the terminal shows,
> in what order, with which honesty rules — and what it refuses to show.
> Written by the observability round (2026-10-30) from the audit's
> evidence, the competitor field's convergent lessons and the trust test's
> measurements; binding for future TUI work the way BEHAVIOR.md binds
> agent behavior. A surface that violates a principle here is a bug, not
> a style choice.

- [The one law](#the-one-law)
- [The information hierarchy](#the-information-hierarchy)
- [The honesty rules](#the-honesty-rules)
- [The composition rules](#the-composition-rules)
- [The restraint rules](#the-restraint-rules)
- [The verification rules](#the-verification-rules)
- [How each shipped surface maps](#how-each-shipped-surface-maps)

Related pages: [the TUI observability audit](tui-observability-audit.md) · [the trust & transparency report](unown-trust-transparency-report.md) · [the competitor research](observability-competitor-research.md) · [BEHAVIOR.md](BEHAVIOR.md) (the agent-behavior twin of this card)

## The one law

**Every surface must help a developer answer: what is happening, why is it happening, what changed, what risks remain, and is progress being made.** If a change to the TUI does not sharpen one of those five answers, it is chrome, and chrome competes with signal for the same 36 rows. The 60-second return is the acceptance test: a developer back after half an hour must be able to read the session's state from one screenful — measured, not assumed ([the trust test's receipts](../benchmarks/observability/RESULTS.md)).

## The information hierarchy

Priority top-down; a higher level may never be displaced by a lower one:

1. **Mission** — the objective, pinned and always visible (an active `/goal` > the `/mission` pin > the session's own title). Never invented; absent means absent.
2. **Progress** — derived from what the agent actually tracks (plan steps, todos), else honestly absent. Never a fabricated percentage, never a spinner dressed as progress.
3. **Current task** — what the agent is on right now (the verb spinner's subject, the todo in progress, the fleet's live tool).
4. **Active decisions** — the why: confidence drivers, the decision miner on demand, plan/goal verdicts.
5. **Evidence** — receipts, checkpoints, verify results: surfaced by pointer (counts + the command that shows more), never by flooding.
6. **Risks** — composed worst-first, each with its fix (engine state, context pressure, failing gates, dead letters).
7. **Learning events** — dreams, memory versions, improvements, consolidations: ambient, compact, drill-in-able.
8. **Metrics** — cost/time/context, in the panel and the brief, reusing the /usage attribution exactly.
9. **Logs** — raw output stays on its existing surfaces (ctrl+o, transcripts, receipts); it never gets promoted into ambient chrome.

The placement law: 1–3 live in the mission panel; 4–7 in the panel's compact rows and the brief; 8 in footer chips and the brief; 9 stays where it is. New surfaces compose existing facts — they do not fork the data.

## The honesty rules

- **Receipts over self-report.** Confidence comes from the session's own ledger (tool errors, verify failures, denials) — the model never grades itself in chrome. A quiet session's `conf ✓` means "no failures this session", and says exactly that.
- **Numbers carry their epistemics.** Costs keep the `~` estimate marker; unknown prices stay unknown (null, never zero); progress is a fraction of real tracked work; cache-hit and tokens match the /usage attribution.
- **Absence is stated, never papered over.** "No tracked steps", "nothing needs attention", "learned: nothing new while you were away", "no serve list" — the empty state is a fact with a name, not a blank.
- **Silence is a claim.** A surface that shows nothing while something happened is lying. Learning must paint (`✦`), failures must count (`✗ N to fix`), and transitions must toast — including the recovery transitions (down → up is narrated, not just the down).
- **Spam is the other lie.** One toast per transition, never at session start; events dedupe at probe cadence; a no-add dream is not news; the chip counts unseen and clears when seen. Zero-spam is a contract with tests.
- **Fix paths ride the failure.** A complaint without a repair is not a tool: every recovery row names its command (`/undo n`, `/engine`, the dead-letter directory), and the footer chip carries its drill-in.

## The composition rules

- **One idempotent refresh pass.** All ambient surfaces repaint through one guarded pass; a quiet session is byte-identical to pre-change; every seam is TUI-only, never in a subagent.
- **Compose, don't compete.** The panel restates what the widgets know (progress, activity) in one place; it never steals budget from the todo/fleet/plan widgets — it composes them and yields rows gracefully at narrow widths.
- **Deterministic before LLM.** The auto surfaces (brief, panel, recovery) never touch the model on the prompt path — the user's next keystroke is never taxed. LLM depth (the decision miner) is explicit and optional (`/brief`), through the side channel that never enters the transcript.
- **Kill switches stay first-class.** Every ambient surface has one: `UNOWN_MISSION_PANEL=0`, `/mission off`, `UNOWN_TURN_METER=0`, `UNOWN_RECAP_IDLE_MINUTES=0`. A feature that cannot be turned off is not shipped.
- **Survive everything.** Restore-on-restart for the pin; counter resets per session; a throwing listener can never break a push; malformed entries load as null with a warning, never a crash.

## The restraint rules

Rejected with reasons (the full ledger in [the competitor research](observability-competitor-research.md)): sound packs (the OSC 7501 lane already covers program-status consumers); USD budget stop-with-continue (duplicates the governor's verified ceilings); queued-message implicit approval (weakens permissions); doom-loop ask-gates (re-interactive-izes unattended runs); public session-share pages (unchanged, secrets/moderation/cost liability). Raw logs never get promoted; walls of tokens never displace summaries; the deep surfaces (dashboard, transcripts, receipts) keep their jobs — the ambient layer points at them, it does not absorb them.

## The verification rules

- A new TUI surface ships with: pure-core pinning tests; a live PTY capture with pane-truth assertions (the pane is truth, `docs/tui-capture-workflow.md`); the docs sync (usage.md, configuration.md + .env.example in the same change); the CHANGELOG entry; and its kill switch.
- A measured claim cites its receipt; unmeasured prints null. The trust metric itself is re-runnable: `scripts/tui-capture/pty_trust_test.py`.
- A weakness found in use becomes the benchmark that caught it — the round's own three dogfood defects (the `unknown` digest tools, the silent idle feed, the flat overview keys) each closed with a root cause and a pin in the same round.

## How each shipped surface maps

| Surface | Levels it serves | Kill switch |
|---|---|---|
| Mission panel | 1, 2, 3, 4, 6, 7, 8 | `UNOWN_MISSION_PANEL=0`, `/mission off` |
| The brief (auto + `/brief`) | 1–8 in one screenful | `UNOWN_RECAP_IDLE_MINUTES=0` (auto); `/brief` always answers |
| `/recovery` + the health chip | 4, 6 (+ the standing fixes) | informational; chip appears only when true |
| `/feed` + the feed chip | 7 (+ sources named on the card) | `/feed` marks seen; chip only while unseen |
| The turn meter | 8 | `UNOWN_TURN_METER=0` |
| The todo/plan/fleet widgets | 2, 3 | their own addon/config switches |
| The dashboard (12 screens) | the deep surfaces for every level | n/a (the ambient layer points here) |
