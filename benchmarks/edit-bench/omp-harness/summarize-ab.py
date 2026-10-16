#!/usr/bin/env python3
"""Summarize the omp A/B runs (6 JSON reports) vs the committed Unown receipts."""
import json, sys
from pathlib import Path

PROBE = Path("/home/z/my-project/probes/omp-edit-bench/omp-results")
UNOWN = Path("/home/z/my-project/Unown/benchmarks/edit-bench/results")
MODELS = ["kimi-k2.5", "qwen3.7-plus", "qwen3.6-plus"]

def unown_stats(model):
    s = json.load(open(UNOWN / f"{model}.summary.json"))
    return s

def omp_stats(model, variant):
    d = json.load(open(PROBE / f"{model}_{variant}.json"))
    s = d["summary"]
    fails = []
    for t in d["tasks"]:
        br = t.get("bestRun") or {}
        if not br.get("success", t.get("success", True)):
            fails.append(t["id"])
    return d, s, fails

rows = []
print("=" * 100)
print("TASK SUCCESS (of 106)")
hdr = f"{'agent':28s}" + "".join(f"{m:>16s}" for m in MODELS)
print(hdr)
u = [unown_stats(m) for m in MODELS]
print(f"{'Unown (pi replace)':28s}" + "".join(f"{s['passed']:>7d}/{s['totalTasks']:>3d} ({s['passRate']*100:.1f}%)" for s in u))
for v in ["replace", "hashline"]:
    cells = []
    for m in MODELS:
        d, s, fails = omp_stats(m, v)
        cells.append(f"{s['successfulTasks']:>7d}/{s['totalTasks']:>3d} ({s['taskSuccessRate']*100:.1f}%)")
    print(f"{f'omp ({v})':28s}" + "".join(f"{c:>16s}" for c in cells))

print()
print("=" * 100)
print("DETAIL PER RUN")
for v in ["replace", "hashline"]:
    for m in MODELS:
        d, s, fails = omp_stats(m, v)
        tc = s["avgToolCallsPerTask"]
        wall = ""
        try:
            from datetime import datetime
            t0 = datetime.fromisoformat(d["startTime"].replace("Z", "+00:00"))
            t1 = datetime.fromisoformat(d["endTime"].replace("Z", "+00:00"))
            wall = f"{(t1 - t0).total_seconds()/60:.1f}min wall"
        except Exception:
            pass
        print(f"omp {m} {v}: success {s['successfulTasks']}/106, edit-call {s['editSuccessRate']*100:.1f}% "
              f"(fails/task {tc['editFailures']:.2f}, warnings/task {tc.get('editWarnings', 0):.2f}), "
              f"in/task avg {s['avgTokensPerTask']['input']:.0f} median {s['medianTokensPerTask']['total']:.0f} p99 {s['p99TokensPerTask']['input']:.0f}, "
              f"avg dur {s['avgDurationPerTask']/1000:.1f}s, {wall}")
        if fails:
            print(f"   failed: {fails}")

print()
print("UNOWN (committed) for reference")
for m in MODELS:
    s = unown_stats(m)
    print(f"unown {m}: {json.dumps({k: s[k] for k in s if not isinstance(s[k], (dict, list))})[:300]}")
