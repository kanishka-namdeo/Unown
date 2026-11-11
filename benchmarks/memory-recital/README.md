# memory-recital — the REAL-USER memory benchtest (the Recital round's permanent lane)

The question it answers: **driven like a real user on complex tasks, does the
whole memory loop — sessions → exit notes → AutoDream → injection →
fresh-session recall — actually work?** Until this suite, the memory
benchmarks tested the dream-side mechanics on synthetic notes
(`benchmarks/memory-eval/*`); this one drives **real `unown -p` sessions doing
real work** in a scratch project (a planted CSV-parser defect is actually
fixed, the knowledge updates are actually applied), lets the note pipeline
capture what it captures, dreams through the live engine, and scores recall
the way the user experiences it.

## What it measures

| Phase | What happens (all live, all real) |
|---|---|
| 1. sessions | Three REAL agent sessions in a scratch project: **S1** complex debugging (fix the planted quoted-CSV defect + 3 new edge-case tests), **S2** knowledge update (strict ISO date validation + render auto-sizing), **S3** reversal + stated style preference + dated switch. Each session is a real `unown -p` run through the live stack (bridge → upstream model); each is followed by a real dream via the engine API. |
| 2. QA battery | Five probes asked in FRESH memory-only sessions, two arms: **warm** (the dreamt project — memory injected) vs **cold** (a fresh clone of the fully-worked project with `.unown/` removed). The probes are LongMemEval's five abilities: T1 temporal reasoning, T2 multi-hop history, T3 knowledge update (the current contract + what it was before), T4 preference (the stated convention), T5 abstention (knowing what memory does not know). |
| 3. edge probes (`--edge`) | **E1** concurrency (two parallel sessions — both notes land, the session-salt lane); **E2** contamination (dreaming the QA sessions' own notes must add nothing false — the Recital BUG-3 contract); **E3** the outbox arc (engine killed alone → the session still works and its note lands in the outbox → engine restart → drained). |
| 4. scoring | Judge-free (no LLM judge — the LoCoMo audit's leniency lesson; recall-qa's matcher semantics, copied per convention): content-word overlap ≥ 0.6 or a 4-word phrase hit. T5 scores HONESTY (an abstention marker AND no fabrication). |

**Headline = lift** (warm pass − cold pass). The cold arm is the honest
control: it must NOT pass the knowledge probes (a high cold rate would mean a
broken benchmark) — and where the cold arm hallucinates (the live baseline's
T3/T4: confident invented "contracts"), that is the memory's value made
visible, not a scoring artifact.

## Run

```bash
bun runner.mjs --dry    # no-LLM smoke lane (fixture + scorer + plumbing), <2 s
bun runner.mjs          # the live suite: 3 sessions + 5 probes × 2 arms (~12-18 min)
bun runner.mjs --edge   # + the concurrency/contamination/outbox probes
bun runner.mjs --fresh  # ignore existing receipts
```

Requires the llm-bridge on `:3031` AND the engine on `:3030` live
(`bun run agent:start`), `unown` resolvable (defaults to the repo's `bin/`),
git, and a scratch tmpdir. The QA arms run against the real upstream model
(`PI_MODEL_ID`, default `agnes-3.0-flash`).

Scratch env: the project materializes into `$TMPDIR/memory-recital-live/`
(`RECITAL_TAG` to re-scope). Receipts: `results/<model>/per-probe/*.json`
(session transcripts + dream rows, both arms' raw responses + scores) +
`results/<model>/summary.json`. RESULTS.md is hand-written from summary.json
(the repo's convention for graded numbers). Resume-safe: existing receipts
skip.

## Honest limitations

- **n=5 probes, one scenario battery, one model, one run** — statistical
  direction, not a leaderboard row (the LoCoMo audit's sample-size lesson).
- **The expected-answer matcher is strict for open-ended QA** (both arms
  suffer the same strictness; receipts record raw scores + hit words).
- **The corpus is one domain** (a small TypeScript library) — the
  benchtest's shape, not breadth; `benchmarks/memory-eval/recall-qa` carries
  the 40-question LongMemEval corpus for breadth.
- **The cold arm is a clone of the fully-worked repo** (the code carries the
  outcome of the sessions) — probes are memory-only questions, but a cold
  model can occasionally reason from the AGENTS.md chain or invent a
  plausible answer; that is exactly the hallucination lane memory exists to
  close, and it is scored as a cold failure.
- **The runner drives `unown -p` print mode** (the TUI lane is covered by
  `scripts/tui-capture/verify_memory_matrix.py`).

## Findings this suite has already shipped (the round's receipts)

The suite was built DURING the Recital round, so its baseline run produced
the round's bug receipts (the same scenario battery, pre-fix):

- warm 3/5 → **BUG 1** (reconcile deleted fresh evidence → T3 "no
  information"), **BUG 2** (stated conventions dropped at extraction → T4
  failure), **BUG 3** (the QA sessions' abstention/hallucination answers
  consolidated into permanent memory — the negation of a real requirement
  became project convention), **BUG 4** (a merged temporal marker invented
  history).
- Post-fix (the same battery, fresh project): **warm 5/5** — see RESULTS.md.
