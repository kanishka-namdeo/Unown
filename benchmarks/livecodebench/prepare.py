#!/usr/bin/env python3
"""Pin the LiveCodeBench v6 subset for the Unown track (deterministic).

Source: HuggingFace dataset `livecodebench/code_generation_lite`, file
`test6.jsonl` — the release_v6 increment (the `v6` version tag in LCB's own
loader selects exactly this file). 175 problems with contest dates
2025-01-04 .. 2025-04-06: the newest LiveCodeBench window, which is the whole
point of this track (contamination-aware; see benchmarks/README.md rule 5 and
docs/testing-strategy.md §7K).

The primary `LiveCodeBench/LiveCodeBench` repo is gated on HuggingFace; the
official `code_generation_lite` dataset (pruned tests, the format LCB itself
evaluates on going forward, per its README) is open and carries the same
problems. We pin the exact URL + sha256 below.

Selection rule (stratified, deterministic, no seed, no cherry-picking):
  1. proportional allocation of 50 slots across the 6 (platform, difficulty)
     cells with largest-remainder rounding — mirrors the polyglot track's
     proportional per-language mix;
  2. within each cell, sort by (contest_date, question_id) and take
     evenly-spaced indices floor(i * n / k) — mirrors the polyglot track's
     evenly-spaced alphabetical selection.

Outputs:
  <repo>/benchmarks/livecodebench/dataset/subset.json — rule, counts, ids,
        source url + sha256, date window (committed)
  $LCB_PREPARED/problems.json — the 50 selected problems with merged
        public+private test cases (decoded), ready for runner.mjs. NOT
        committed: a handful of v6 problems ship multi-MB stress tests
        (~114 MB total), so like the polyglot track the pin is the rule +
        source sha256, and the working file is rebuilt deterministically
        from the pinned source by this script.

Usage:
  curl -L -o /home/z/my-project/bench-data/livecodebench/test6.jsonl \
       https://huggingface.co/datasets/livecodebench/code_generation_lite/resolve/main/test6.jsonl
  python3 prepare.py [--source /path/to/test6.jsonl] [--n 50]
"""

import argparse
import base64
import collections
import hashlib
import io
import json
import pickle
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_SOURCE = "/home/z/my-project/bench-data/livecodebench/test6.jsonl"
DEFAULT_PREPARED = "/home/z/my-project/bench-data/livecodebench/problems.json"
SOURCE_URL = "https://huggingface.co/datasets/livecodebench/code_generation_lite/resolve/main/test6.jsonl"
SOURCE_DATASET = "livecodebench/code_generation_lite"
SOURCE_TAG = "release_v6 increment (loader version_tag `v6` = test6.jsonl; cumulative release_v6 = 1055 problems, May 2023 - Apr 2025)"


class _SafeUnpickler(pickle.Unpickler):
    """Only allow built-in types when unpickling the LCB private-test blobs."""

    def find_class(self, module, name):
        raise pickle.UnpicklingError(f"forbidden: {module}.{name}")


def decode_private(field: str) -> list:
    """LCB lite `private_test_cases` = base64(zlib(pickle(json-string)))"""
    if not field:
        return []
    raw = zlib.decompress(base64.b64decode(field))
    obj = _SafeUnpickler(io.BytesIO(raw)).load()
    if isinstance(obj, (bytes, bytearray)):
        obj = obj.decode()
    if isinstance(obj, str):
        obj = json.loads(obj)
    return obj


def largest_remainder(total: int, weights: dict) -> dict:
    """Proportional allocation of `total` across `weights` (int counts)."""
    grand = sum(weights.values())
    out = {k: (total * w) // grand for k, w in weights.items()}
    assigned = sum(out.values())
    remainders = sorted(
        weights, key=lambda k: (-(total * weights[k] / grand - out[k]), k)
    )
    for k in remainders[: total - assigned]:
        out[k] += 1
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--source",
        default=DEFAULT_SOURCE,
        help="path to the downloaded test6.jsonl",
    )
    ap.add_argument("--n", type=int, default=50)
    ap.add_argument(
        "--prepared-out",
        default=DEFAULT_PREPARED,
        help="where to write the decoded problems.json (not committed)",
    )
    ap.add_argument(
        "--subset-out",
        default=str(HERE / "dataset" / "subset.json"),
        help="where to write the committed subset.json pin",
    )
    args = ap.parse_args()

    src = Path(args.source)
    if not src.exists():
        print(f"source not found: {src}", file=sys.stderr)
        print(f"download it first:  curl -L -o {src} {SOURCE_URL}", file=sys.stderr)
        return 2

    sha = hashlib.sha256(src.read_bytes()).hexdigest()
    rows = [json.loads(line) for line in src.read_text().splitlines() if line.strip()]
    dates = sorted(r["contest_date"] for r in rows)
    print(f"loaded {len(rows)} problems, contest dates {dates[0]} .. {dates[-1]}")

    # --- cells -----------------------------------------------------------
    cell_of = lambda r: (r["platform"], r["difficulty"])  # noqa: E731
    cells = collections.Counter(cell_of(r) for r in rows)
    alloc = largest_remainder(args.n, dict(cells))
    print("allocation:", {f"{k[0]}/{k[1]}": v for k, v in sorted(alloc.items())})
    assert sum(alloc.values()) == args.n

    # --- selection -------------------------------------------------------
    by_cell = collections.defaultdict(list)
    for r in rows:
        by_cell[cell_of(r)].append(r)

    selected = []
    for cell in sorted(by_cell):
        members = sorted(
            by_cell[cell], key=lambda r: (r["contest_date"], r["question_id"])
        )
        k = alloc[cell]
        n_avail = len(members)
        idxs = sorted({(i * n_avail) // k for i in range(k)})
        # evenly spaced; if the set collapses (k > distinct slots), fill from
        # the front deterministically
        if len(idxs) < k:
            idxs = idxs + [i for i in range(n_avail) if i not in idxs]
        picked = [members[i] for i in sorted(idxs)[:k]]
        print(
            f"  {cell[0]}/{cell[1]}: {n_avail} available -> {k} selected "
            f"({','.join(p['question_id'] for p in picked)})"
        )
        selected.extend(picked)

    # --- emit problems.json ---------------------------------------------
    problems = []
    for r in selected:
        public = json.loads(r["public_test_cases"])
        private = decode_private(r["private_test_cases"])
        meta = json.loads(r["metadata"]) if r.get("metadata") else {}
        problems.append(
            {
                "question_id": r["question_id"],
                "question_title": r["question_title"],
                "question_content": r["question_content"],
                "platform": r["platform"],
                "contest_id": r["contest_id"],
                "contest_date": r["contest_date"],
                "difficulty": r["difficulty"],
                "starter_code": r.get("starter_code") or "",
                "fn_name": meta.get("func_name"),
                "tests": [
                    {"input": t["input"], "output": t["output"], "testtype": t["testtype"]}
                    for t in (public + private)
                ],
            }
        )

    out = Path(args.prepared_out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(problems, indent=1) + "\n")

    # --- emit subset.json ------------------------------------------------
    counts = collections.Counter((p["platform"], p["difficulty"]) for p in problems)
    subset = {
        "benchmark": "LiveCodeBench (code generation, lite)",
        "source": {
            "dataset": SOURCE_DATASET,
            "file": "test6.jsonl",
            "url": SOURCE_URL,
            "sha256": sha,
            "version": SOURCE_TAG,
            "dateWindow": {"from": dates[0], "to": dates[-1]},
            "problemsAvailable": len(rows),
        },
        "selection": (
            "stratified proportional allocation across the 6 (platform x difficulty) "
            "cells with largest-remainder rounding; within each cell sorted by "
            "(contest_date, question_id) and evenly spaced indices floor(i*n/k); "
            "deterministic, no seed, no cherry-picking"
        ),
        "stratification": "proportional to the v6-window mix per platform and difficulty",
        "cellCounts": {f"{k[0]}/{k[1]}": v for k, v in sorted(counts.items())},
        "total": len(problems),
        "problemIds": [p["question_id"] for p in problems],
        "codeforcesNote": (
            "the v6 increment contains 0 Codeforces problems (LCB's newest window "
            "added only AtCoder + LeetCode); reaching back for Codeforces would "
            "mean older-window problems, i.e. the opposite of contamination-aware"
        ),
        "testsPerProblem": {
            "min": min(len(p["tests"]) for p in problems),
            "max": max(len(p["tests"]) for p in problems),
            "total": sum(len(p["tests"]) for p in problems),
        },
        "generatedAt": "2026-10-17",
        "generatedBy": "benchmarks/livecodebench/prepare.py",
    }
    (Path(args.subset_out)).parent.mkdir(parents=True, exist_ok=True)
    (Path(args.subset_out)).write_text(json.dumps(subset, indent=1) + "\n")
    print(
        f"wrote {out} ({out.stat().st_size / 1e6:.2f} MB, not committed) and "
        f"{args.subset_out} ({len(problems)} problems)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
