#!/usr/bin/env python3
"""mine_failures.py — cluster failed evals into weakness categories.

Consumes harness/runs/<tag>/results.jsonl and produces weaknesses.json with
deterministic clusters keyed by (category, verifier-failure signature).
Optionally refines cluster descriptions headlessly via `claude -p` when the
CLI is available (--refine). No SDK dependency, no key required offline.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load(tag: str) -> list[dict]:
    path = HERE / "runs" / tag / "results.jsonl"
    if not path.is_file():
        print(f"No results for tag {tag!r} — run run_evals.py --tag {tag} first.")
        raise SystemExit(2)
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def refine(desc: str) -> str:
    exe = shutil.which("claude")
    if not exe:
        return desc
    prompt = (
        "One sentence, <=25 words, engineering tone. Cluster of agent-harness "
        f"eval failures: {desc} State the root cause as a fact."
    )
    try:
        proc = subprocess.run([exe, "-p", prompt], capture_output=True,
                              text=True, timeout=120)
        out = (proc.stdout or "").strip()
        return out or desc
    except Exception:
        return desc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="baseline")
    ap.add_argument("--refine", action="store_true",
                    help="ask headless claude to sharpen cluster descriptions")
    args = ap.parse_args()

    rows = [r for r in load(args.run) if not r["ok"]]
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        sig = "missing:" + r["reason"].split(":", 1)[-1].strip()[:80] \
            if r["reason"].startswith("missing") else r["reason"][:80]
        groups[(r["category"], sig)].append(r)

    clusters = []
    for i, ((cat, sig), items) in enumerate(sorted(groups.items()), 1):
        base = (f"{len(items)} failure(s) in category '{cat}': "
                f"{sig}. Evals: {[x['id'] for x in items]}.")
        clusters.append({
            "id": f"w{i:03d}",
            "category": cat,
            "signature": sig,
            "eval_ids": [x["id"] for x in items],
            "evidence": [f'{x["id"]}: {x["reason"]} | resp="{x["response"][:160]}"'
                         for x in items[:4]],
            "description": refine(base) if args.refine else base,
            "count": len(items),
        })

    out = {"tag": args.run, "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "failure_total": len(rows), "clusters": clusters}
    (HERE / "weaknesses.json").write_text(json.dumps(out, indent=2))
    for c in clusters:
        print(f'[{c["id"]}] ({c["count"]}) {c["description"]}')
    if not clusters:
        print("No failures to mine — harness looks healthy on this tag.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
