#!/usr/bin/env python3
"""omp-missing-tasks.py — from a (partial) omp edit-benchmark n=3 JSON report,
print the comma-separated task ids that need a fresh surgical re-run:
tasks with no runs, fewer than 3 runs, or any run carrying the quota-wedge
signature (failed + zero tokens + 'Timeout exhausted')."""
import json, sys

path = sys.argv[1]
d = json.load(open(path))
need = []
for t in d.get("tasks", []):
    runs = t.get("runs") or []
    wedged = any(
        (not r.get("success"))
        and (r.get("tokens") or {}).get("total", 0) == 0
        and "Timeout exhausted" in (r.get("error") or "")
        for r in runs
    )
    if not runs or len(runs) < 3 or wedged:
        need.append(t["id"])
print(",".join(need))
