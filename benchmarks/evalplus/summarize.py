#!/usr/bin/env python
"""Summarize evalplus HumanEval+ results -> results/summary.json + table.

Usage: python summarize.py  (run from benchmarks/evalplus/ after run-eval.sh)

Reads, per model in results/<model>/:
  - samples.jsonl                    (generation receipts from gen-samples.mjs)
  - samples-sanitized_eval_results.json (headline, official sanitize protocol)
  - samples_eval_results.json        (raw-extraction robustness check)
Writes:
  - results/summary.json  {model: {pass1, base_pass1, raw_pass1, raw_base_pass1,
                            n_problems, generation_failures, evaluated_at}}
  - results/table.md      (markdown fragment for RESULTS.md)
"""
import json
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.environ.get("RESULTS_ROOT", os.path.join(HERE, "results"))
# RESULTS_ROOT: point at a rerun dir (e.g. results/rerun-2026-10-17) to
# summarize fresh receipts without touching the committed ones.
MODELS = sorted(
    d for d in os.listdir(RESULTS)
    if os.path.isdir(os.path.join(RESULTS, d)) and not d.startswith(".")
)


def _find_eval_json(d, stem):
    """Accept both naming conventions (evalplus 0.3.1 legacy and master)."""
    for name in (f"{stem}.eval_results.json", f"{stem}_eval_results.json"):
        p = os.path.join(d, name)
        if os.path.exists(p):
            return p
    return None


def pass_rates(eval_results_path):
    """-> (plus_pass@1, base_pass@1, n_tasks) from an evalplus *_eval_results.json."""
    with open(eval_results_path) as f:
        r = json.load(f)
    ev = r["eval"]
    n = len(ev)
    base_ok = sum(1 for v in ev.values() if v[0]["base_status"] == "pass")
    plus_ok = sum(
        1 for v in ev.values() if v[0]["base_status"] == "pass" and v[0]["plus_status"] == "pass"
    )
    return plus_ok / n, base_ok / n, n, plus_ok, base_ok


def gen_stats(samples_path):
    """Generation receipts: failures, truncations, retries, latency."""
    stats = {
        "n_samples": 0, "n_gen_failures": 0, "n_truncated": 0,
        "n_retried": 0, "total_latency_s": 0.0, "n_attempts_total": 0,
        "failed_task_ids": [],
    }
    with open(samples_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            stats["n_samples"] += 1
            stats["n_attempts_total"] += d.get("attempts", 1)
            stats["total_latency_s"] += d.get("latency_s") or 0
            if d.get("error"):
                stats["n_gen_failures"] += 1
                stats["failed_task_ids"].append(d["task_id"])
            if d.get("finish_reason") == "length":
                stats["n_truncated"] += 1
            if d.get("attempts", 1) > 1 and not d.get("error"):
                stats["n_retried"] += 1
    return stats


def fmt(x):  # 3 decimals, evalplus convention
    return f"{x:.3f}"


def main():
    summary = {}
    rows = []
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    for m in MODELS:
        d = os.path.join(RESULTS, m)
        san_eval = _find_eval_json(d, "samples-sanitized")
        raw_eval = _find_eval_json(d, "samples")
        samples = os.path.join(d, "samples.jsonl")
        entry = {"evaluated_at": now}
        if san_eval:
            p, b, n, p_ok, b_ok = pass_rates(san_eval)
            entry.update(
                pass1=round(p, 4), base_pass1=round(b, 4),
                n_problems=n, pass1_count=p_ok, base_pass1_count=b_ok,
            )
        if raw_eval:
            p, b, n, p_ok, b_ok = pass_rates(raw_eval)
            entry.update(raw_pass1=round(p, 4), raw_base_pass1=round(b, 4))
        if os.path.exists(samples):
            entry["generation"] = gen_stats(samples)
        summary[m] = entry
        rows.append((m, entry))

    out = {"models": MODELS, "generated_at": now, "results": summary}
    with open(os.path.join(RESULTS, "summary.json"), "w") as f:
        json.dump(out, f, indent=2)

    lines = [
        "| model | HumanEval+ pass@1 | HumanEval (base) pass@1 | raw-extraction pass@1 | gen failures | truncated |",
        "|---|---|---|---|---|---|",
    ]
    for m, e in rows:
        g = e.get("generation", {})
        lines.append(
            "| {m} | {p} ({pc}/{n}) | {b} ({bc}/{n}) | {rp} | {gf} | {tr} |".format(
                m=m,
                p=fmt(e.get("pass1", 0)), pc=e.get("pass1_count", "-"),
                b=fmt(e.get("base_pass1", 0)), bc=e.get("base_pass1_count", "-"),
                n=e.get("n_problems", 164),
                rp=fmt(e.get("raw_pass1", 0)),
                gf=g.get("n_gen_failures", "-"), tr=g.get("n_truncated", "-"),
            )
        )
    with open(os.path.join(RESULTS, "table.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    print("\nsummary ->", os.path.join(RESULTS, "summary.json"))
    bad = [m for m, e in summary.items() if "pass1" not in e]
    if bad:
        print("MISSING evaluation for:", bad, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
