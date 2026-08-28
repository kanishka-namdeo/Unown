# Harness

Unown's self-improving loop keeps the model stable and makes the *scaffolding*
editable:

```
record runs ──▶ mine failures ──▶ propose bounded fix ──▶ validate on evals
     ▲                                                        │
     └────────────── FAIL: loop back ◀────────────────────────┤
                          PASS: promote v2 ◀──────────────────┘
```

## Components

| File | Role |
|------|------|
| `EDITABLE_SURFACES` | Whitelist of files a fix proposal may touch |
| `evals/tasks.jsonl` | Golden tasks with machine-checkable verifiers |
| `evals/fixtures/*.txt` | Last-resort canned answers for offline mode |
| `patches/demo-t003.diff` | Bundled known-good fix for the seeded stale fact |
| `run_evals.py` | Headless runner (`claude -p`) → `runs/<tag>/results.jsonl`, `summary.json`; `--offline` derives answers from the editable knowledge surfaces (reposeek), no key needed |
| `mine_failures.py` | Clusters failed evals into weakness categories → `weaknesses.json` |
| `propose_fix.py` | Generates a bounded diff proposal per weakness cluster (via `claude -p` when available; template otherwise) |
| `validate_fix.py` | Applies the diff, re-runs affected evals 3×, requires ⅔ majority, auto-rollbacks on FAIL |

## Full run

```bash
cd harness
./run_evals.py --tag baseline            # record
./run_evals.py --tag candidate-v2        # after any change you're testing
./mine_failures.py --run candidate-v2
./propose_fix.py --cluster w001
./validate_fix.py --proposal proposals/<file>.md
```

Or let the orchestrator drive:

```bash
./iterate.sh --max-iterations 3
```

Promotion rule: `PASS` leaves the validated patch applied in your working
tree — review it, commit it, tag `v2`. Nothing lands without the gate.

Cost note: each iteration spends at most a handful of headless calls; see
`docs/COST.md` for budgets and knobs.
