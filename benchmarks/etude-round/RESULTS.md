# The Etude round — results

One-line purpose: the Etude round's results table — honest nulls until
tickets land receipts; every figure names its receipt.

| Metric | Baseline (2026-11-05, `f3f0176e`) | Latest | Receipt |
|---|---|---|---|
| Fresh-home PTY lane pass rate (hint lane, wiped homes ×3 + operator rerun) | 0/1 lane (B-13) | **PASS — B-13 FIXED (A2H-5, 2026-11-05)** | [receipts/a2h5.md](receipts/a2h5.md) |
| Fresh-home PTY lane pass rate (picker lane, wiped homes ×3 + operator rerun) | 0/1 lane (B-14) | **PASS — B-14 FIXED (A2H-6, 2026-11-05)** | [receipts/a2h6.md](receipts/a2h6.md) |
| Warm-home PTY lane pass rate | 3/3 lanes | 3/3 (2026-11-05) | [README.md](README.md) |
| Unit / tsc / lint | 2235/0/160 · 0 · 0-143w | same (baseline) | [README.md](README.md) |
| e2e battery (ostinato) | 14/14 | 14/14 (2026-11-05) | [README.md](README.md) |
| Harness-defect burn-down | 2 open (B-13, B-14) | **0 open — both FIXED via A2H-5/A2H-6 (2026-11-05)** | [receipts/a2h5.md](receipts/a2h5.md) · [receipts/a2h6.md](receipts/a2h6.md) |
| A2 turns-to-close (the round's DRIVE tickets) | n/a | A2H-5: 13 turns / 2 chunks · A2H-6: 22 turns / 3 chunks · 0 operator unblocks | the round log's ticket queue |
| Learning-layer baseline (ops-accuracy, quality-axes, selfimprove, engine snapshot) | null — captures at Phase-1 opening | null | this file |

After A2H-5/A2H-6: the fresh-home row's verifier is the wiped-home ×3 run
pinned in the validation log; the burn-down row moves only on gate-passed
fixes.
