# transfer-bench — the cross-task memory-transfer benchmark

The question every other suite leaves open: **does memory LEARNED on a complex
task A measurably help a related-but-different complex task B?** `selfimprove/`
measured same-repo continuity (task 1→6 in one repo); `recall-qa` measures
answering questions with memory present; nothing measured *induce on A →
consolidate → test on B* on real app-building work — the exact promise a
self-learning agent makes ("it remembers what worked, and carries it forward").

Research grounding: this implements the standard transfer protocol from the
agent-memory literature — induce-on-A/test-on-B (AWM's cross-task induction,
Agent-KB's experience reuse, Voyager's skill-library transfer, ExpeL) plus the
controls the RSI-evidence literature demands: an on/off ablation (cold arm), a
matched-context baseline (raw-notes arm — "does consolidation add value over
more context?"), and fine-grained scoring at n>1 per arm.

## The task pair (two real apps, deliberately asymmetric conventions)

| | Task A — `exprq` | Task B — `csvrow` |
|---|---|---|
| What | a `jq`-style JSON query language CLI | an `awk`-style CSV row-filter CLI |
| Hard parts | byte-exact errors (`parse error: line 1, col N: <detail>`), 1-based columns, negative indices, pipe pipelines, `?` optionals | byte-exact errors (`csvrow: error: <detail> at col N`), 1-based columns, keyword precedence (`not`/`and`/`or`), parens, CSV quoting, numeric-vs-string equality |
| Hidden tests | 54 independent cases | 44 independent cases |
| Error convention | **different on purpose** | **different on purpose** |

Both are multi-stage interpreter builds (tokenizer → parser → evaluator →
thin CLI) — the domain where session notes carry real workflow lessons
(byte-exactness discipline, run-tests-early, one-past-the-end columns,
read-only-test etiquette). The error conventions are DIFFERENT so that only
*workflow-level* learning transfers: an agent (or a dream) that memorized
"outputs look like `parse error: line 1, col N`" is worse than useless on B,
while "the tests print want-vs-got — run them first and copy formats
verbatim" transfers perfectly. That asymmetry is the experiment.

Both fixtures are **triple-validated**: `spec.md` + a reference implementation
(`tests/reference.mjs`, kept OUT of the agent's repo) + the committed test
suite — the reference passes every test case, so the suite is derivable from
the spec and internally consistent.

## Protocol

```
induce    3 COLD sessions on A (template memory, isolated UNOWN_HOMEs),
          each asked to file workflow notes via the real `note` tool.
dream     the production project dream (engine :3030, real AutoDream + guard)
          consolidates A's notes into A's project.md. Snapshot kept.
transfer  3 sessions per arm on B:
            cold  — template user tier, no A knowledge.
            warm  — A's dreamed memory hoisted verbatim into the arm's user
                    tier (~/.unown/memory/user.md). Simulates the user-tier
                    dream path the review records as the natural cross-project
                    vehicle (benchmarks/README.md, recall-qa + mpbench findings).
            notes — A's raw session notes as a context file in B's repo.
                    The matched-context control: separates "consolidation
                    adds value" from "more context adds value".
score     tests restored PRISTINE (anti-tamper) and re-run: fraction of
          individual cases passing + all-green flag + tokens + duration.
report    per-arm aggregates + deltas (warm−cold, warm−notes, notes−cold, hoist−cold, hoist−warm).
```

Anti-tamper discipline follows `polyglot`/`selfimprove` v3: tests are read-only
(0444) during the session, restored pristine before scoring, and the agent is
told they are restored for scoring. A live-pid lockfile refuses concurrent
benchmark instances (two once interleaved and clobbered repos).

## Honest limitations

- n=3 per arm; the binomial noise on all-green rates at n=3 is large — treat
  `casePassRateMean` as the primary signal and all-green as secondary.
- The warm arm's hoist is runner-performed (the user-tier dream path is the
  recorded fix direction, not yet a shipped feature) — the benchmark measures
  whether such carried memory WOULD help before the feature is built.
- One model (`agnes-3.0-flash` via the bridge), one dream instance, one
  dream model — variance across dream outputs is not sampled.
- The tasks share domain DNA (both mini-language CLIs with byte-exact errors).
  Transfer to unrelated domains (web UIs, data pipelines) is a further arm
  this suite does not yet have.

## Running

```bash
bun runner.mjs --phase setup     # repos + isolated UNOWN_HOMEs + provider config
bun runner.mjs --phase induce    # 3 cold sessions on A (~20 min)
bun runner.mjs --phase dream     # trigger the production dream, snapshot notes
bun runner.mjs --phase hoist     # the production abstraction pass -> rules for the hoist arm
bun runner.mjs --phase transfer  # 12 sessions on B (4 arms x 3, ~60 min)
bun runner.mjs --phase report    # summary.json + deltas
```

Requires the stack up (`bun run agent:start`), the bridge routed at the model
under test, and the engine token readable. Results append to
`results/<model>.jsonl` (resume-safe); `results/summary.json` is written by
the report phase.
