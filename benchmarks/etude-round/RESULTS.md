# The Etude round — results

One-line purpose: the Etude round's results table — honest nulls until
tickets land receipts; every figure names its receipt.

| Metric | Baseline (2026-11-05, `f3f0176e`) | Latest | Receipt |
|---|---|---|---|
| Fresh-home PTY lane pass rate (hint + picker, wiped homes ×3) | 0/2 lanes (B-13, B-14) | null | [validation-log.md](validation-log.md) |
| Warm-home PTY lane pass rate | 3/3 lanes | 3/3 (2026-11-05) | [README.md](README.md) |
| Unit / tsc / lint | 2235/0/160 · 0 · 0-143w | same (baseline) | [README.md](README.md) |
| e2e battery (ostinato) | 14/14 | 14/14 (2026-11-05) | [README.md](README.md) |
| Harness-defect burn-down | 2 open (B-13, B-14) | 2 open | [validation-log.md](validation-log.md) |
| Learning-layer baseline (ops-accuracy, quality-axes, selfimprove, engine snapshot) | null — captures at Phase-1 opening | null | this file |

After A2H-5/A2H-6: the fresh-home row's verifier is the wiped-home ×3 run
pinned in the validation log; the burn-down row moves only on gate-passed
fixes.
