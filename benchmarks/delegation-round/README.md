# The delegation round — benchmark suite

The subagent-orchestration round's before/after measurement: a pinned,
delegation-inviting workload run against the LIVE agent (real bridge, real
upstream, real engine), scored on the mission's ten axes, with every receipt
committed. Baseline = unmodified v0.0.45; after = the round's build. The
delta is the round's claim.

- [Method](#method)
- [The workload](#the-workload)
- [The ten axes and their formulas](#the-ten-axes-and-their-formulas)
- [Receipt contract](#receipt-contract)
- [Reproduction](#reproduction)
- [Honest limitations](#honest-limitations)

Related: [RESULTS.md](RESULTS.md) · [the round's session record](../../docs/delegation-round-session.md) · [the competitor research](../../docs/delegation-competitor-research.md) · [the subagents reference](../../docs/subagents.md)

## Method

- **Live agent, real stack.** Every task is a real `unown -p` process against
  the running bridge (:3031 → Agnes upstream) and engine (:3030). No mocks on
  the model path; the engine's note path runs live so the learning metrics
  measure production behavior.
- **Pinned everything.** Prompts are byte-pinned in the runner
  (`run-delegation-bench.mjs`); model `agnes-3.0-flash` (the repo's default
  routing); `UNOWN_DELEGATION_LEVEL=standard` (the default policy) pinned in
  the spawn env; delegation is invited by the task shapes, never forced —
  except the two injected-failure lanes, which exercise lane mechanics, not
  model choice, and are excluded from autonomous-decision scoring.
- **Ground truths computed at run time** (file counts, line counts, digests)
  so tree drift between baseline and after cannot fake a delta.
- **End-state scoring, not text-similarity**: each task carries marker checks
  (regex over the final answer) plus file/digest verification where the task
  leaves an artifact.
- **n=1 per lane** (the metered free-tier upstream makes ≥5-repeat lanes a
  multi-hour spend); determinism of the DELTA is protected by identical
  prompts, identical env, and receipts that expose the raw trajectories for
  hand-audit. Every score names its raw inputs. See
  [Honest limitations](#honest-limitations).

## The workload

Ten lanes, run sequentially (journal-delta attribution per task):

| Lane | Shape | What it measures |
|---|---|---|
| `t1-map` | map where the fleet journal lives | investigation delegation (explore/scout), handoff quality |
| `t2-callers` | find the tests pinning the advertised catalog | evidence-first delegation, citation quality |
| `t3-triptych` | three independent questions, answered in parallel | batch parallelism (the ≤4 batch), spawn-and-continue |
| `t4-script` | write + run a self-hashing script in scratch | implementation delegation (worker/completion guard), artifact end-state |
| `t5-review` | second pair of eyes on a small file | reviewer role selection, verdict shape |
| `t6a-unknown-agent` | delegate to a non-existent agent name | injected failure: typed error + recovery |
| `t6b-blocked-task` | delegate a path-jail violation | injected failure: BLOCKED honesty + parent handling |
| `t7-duplicate` | find a fact, then have a FRESH subagent double-check it | duplicate-work handling, reuse vs re-spawn |
| `t8-async` | background count + report what the fleet is doing | async lane, task_control, headless visibility |
| `pty-fleet` | PTY capture of a live session delegating async work | TUI visibility: the fleet widget, live rows |

`t6a`/`t6b` are the failure-injection lanes (the mission's Phase 6 "every
failure detected, categorised, reproduced" — here measured, not assumed);
`pty-fleet` is the pane-truth lane (the observability round's method: the
literal screen text is the receipt).

## The ten axes and their formulas

Every axis reports the raw measurements AND a 0–100 score. Deterministic
where possible; rubric axes quote their evidence.

1. **Delegation quality** = `0.5 × handoff + 0.5 × outcome`.
   `handoff` = per-spawn 4-element check of the task string (objective /
   repo-context / boundary / done-definition — GitHub's and Anthropic's
   handoff elements, deterministic keyword heuristics applied identically to
   baseline and after). `outcome` = `ok` spawns ÷ total spawns (BLOCKED,
   guard-failed, timeout, non-zero exit count against it).
2. **Subagent reuse** = reuse events ÷ reuse opportunities. Opportunities:
   the t7 double-check (a duplicate spawn of the same fact is a miss; a
   tight follow-up or an informed reuse is a hit) and any resume-by-steer
   across the workload. Raw: duplicate-spawn count, steer/resume count.
3. **Context efficiency** = child token share `Σ child tokens ÷ (Σ child +
   Σ parent)` (offload: what fraction of the work's tokens left the parent's
   window) — paired with the raw parent tokens and parent token growth per
   lane. A high share with low outcome is waste, and the outcome axis
   catches it.
4. **User explainability** (rubric, receipt-quoted): is the REASON for each
   delegation recorded anywhere the user looks (40), is the agent + cost
   visible after the run (30), is anything visible DURING a headless or
   background run (30).
5. **Progress visibility** (rubric + pane receipt): live per-child state in
   the TUI (the fleet widget rows), the `/tasks` picture, and headless-mode
   visibility during a run.
6. **Memory utilisation** = `[subagent]`-tagged notes delivered to the
   engine ÷ spawns (children write session notes on exit; the engine's
   overview carries the note counters), plus the raw deltas.
7. **Learning retention** = post-workload dream outcome: the runner triggers
   `auto-dream` and records memory-version transitions + dreamed rules
   retained (the engine's own canary-gated consolidation — a dreamed rule
   that rolls back scores 0).
8. **Failure recovery** = recovered ÷ injected. Recovered = the typed error
   surfaced honestly (verbatim markers in the result) AND the parent
   completed the user's actual goal anyway (the count, the honest refusal
   report).
9. **Autonomous decision quality** = correct decision points ÷ total, over
   the natural lanes (t1–t5, t7, t8): role choice vs the task shape
   (investigation → explore/scout or inline; implementation → worker or
   inline; review → reviewer/general; parallel ask → batch or inline),
   lane choice for t8 (async), and no unnecessary spawns (a spawn that
   duplicated work already in hand is a miss). Injected lanes are excluded.
10. **Human intervention rate** = lanes completed without intervention ÷
    total lanes. Intervention-equivalents: unresolved BLOCKED, a stall
    (>120 s no activity), a failed end-state check, a wrong count/answer.

## Receipt contract

Per run directory `receipts/<label>-<ts>/`:

- `summary.json` — the run envelope: label, timestamps, per-lane
  duration/exit, ground truths, engine overview deltas, tally.
- `task-<id>.receipt.json` — per-lane receipt: the byte-pinned prompt, the
  parsed `--output-format json` envelope (result, model, usage, turns,
  duration), marker-check results, journal delta lines, engine overview
  before/after, artifact verification.
- `task-<id>.session.jsonl` — the parent session transcript (the primary
  evidence: every tool call, every result header, every usage record).
- `journal-<label>.jsonl` — the fleet journal state at run end (both lanes'
  lifecycle trace).
- `pty-fleet/` — the pane-truth lane: literal PTY screen text + stills.
- `scores-<label>.json` + `scores-<label>.md` — the scorer's output (raw
  measurements + the ten scores + the evidence quotes).

Scratch (work dirs, digests) is regenerable and never committed; receipts
are the transcripts and the numbers derived from them.

## Reproduction

```bash
# stack up (bridge :3031, engine :3030)
bun run agent:start
# baseline label runs the SAME code you have checked out — pin v0.0.45 for
# the baseline, the round's build for after
node benchmarks/delegation-round/run-delegation-bench.mjs --label baseline
node benchmarks/delegation-round/score-delegation.mjs --run receipts/<baseline-dir>
# the PTY lane (needs python3 + pyte + pillow)
python3 benchmarks/delegation-round/pty_fleet_lane.py
```

The runner is resumable: `--resume <dir>` skips lanes whose receipts are
already green. The scorer is read-only over receipts and never calls the
endpoint (zero model spend at score time).

## Honest limitations

- **n=1 per lane** — the upstream is a metered free tier (~20 RPM); the
  GitHub harness-eval prescription of ≥5 runs with σ ellipses is cited as
  the method this suite cannot yet afford. The receipts expose full
  trajectories so the delta can be hand-audited lane by lane.
- **Model nondeterminism** — delegation is model behavior under a policy;
  identical prompts can spawn differently between runs. The scorer records
  the raw spawn facts; a before/after claim that rests on a single spawn's
  coin-flip is called out in RESULTS.md, not buried in an average.
- **Heuristic handoff scoring** — the 4-element check is keyword-based; it
  is applied identically to both runs and its hits/misses are listed per
  spawn in the scores receipt for hand-correction.
- **Rubric axes are scored by the round's author with quoted evidence**
  (the observability round's pane-truth method), not by an LLM judge; the
  LLM-judge variant is future work (the research doc's §measurement
  landscape records the recipe).
