#!/usr/bin/env python3
"""omp-aggregate-n3.py — aggregate omp edit-benchmark n=3 runs into the
published A/B numbers. Inputs: one or more omp JSON reports for the same
(model, variant); later files override earlier ones PER TASK (surgical
re-run files replace the tasks they contain). Wedge-signature runs
(quota-storm artifacts: failed + zero tokens + 'Timeout exhausted' + zero
tool calls) are EXCLUDED and reported, not scored."""
import json, sys
from datetime import datetime

def wedge(r):
    return (not r.get("success")
            and (r.get("tokens") or {}).get("total", 0) == 0
            and "Timeout exhausted" in (r.get("error") or "")
            and (r.get("toolCalls") or {}).get("totalInputChars", 1) == 0
            and sum((r.get("toolCalls") or {}).get(k, 0) for k in ("read", "edit", "write")) == 0)

def load(path):
    return json.load(open(path))

def main(paths):
    tasks = {}
    for p in paths:  # later files win per task
        d = load(p)
        for t in d.get("tasks", []):
            tasks[t["id"]] = t
    best_pass = 0; any_pass = 0; all_ok = 0; all_total = 0
    wedged = []; failed = []; flaky = []
    edit_calls = 0; edit_successes = 0
    tok_in_best = []
    for tid, t in sorted(tasks.items()):
        runs = [r for r in (t.get("runs") or []) if not wedge(r)]
        w = [r for r in (t.get("runs") or []) if wedge(r)]
        if w: wedged.append(f"{tid}({len(w)})")
        if not runs: continue
        oks = [r for r in runs if r.get("success")]
        all_ok += len(oks); all_total += len(runs)
        if oks: any_pass += 1
        if oks: best_pass += 1
        else: failed.append(tid)
        if len(runs) > 1 and oks and len(oks) < len(runs): flaky.append(tid)
        for r in runs:
            tc = r.get("toolCalls") or {}
            edit_calls += tc.get("edit", 0)
            edit_successes += tc.get("editSuccesses", 0)
        # best run = success > fewer input tokens (mirror omp selection)
        br = sorted(runs, key=lambda r: (not r.get("success"), (r.get("tokens") or {}).get("input", 0)))[0]
        tok_in_best.append((br.get("tokens") or {}).get("input", 0))
    n = len(tasks)
    tok_in_best.sort()
    mean_in = sum(tok_in_best) / len(tok_in_best) if tok_in_best else 0
    print(json.dumps({
        "files": paths,
        "tasks": n,
        "best_of_3": best_pass,
        "any_of_3": any_pass,
        "all_runs": f"{all_ok}/{all_total}",
        "all_runs_rate": round(all_ok / all_total * 100, 1) if all_total else None,
        "edit_call_success": round(edit_successes / edit_calls * 100, 1) if edit_calls else None,
        "edit_calls": edit_calls,
        "mean_input_tokens_best_run": round(mean_in),
        "failed_tasks": failed,
        "flaky_tasks": flaky,
        "wedged_runs_excluded": wedged,
    }, indent=1))

if __name__ == "__main__":
    main(sys.argv[1:])
