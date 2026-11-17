#!/usr/bin/env python3
"""pty_multitool.py — the Calando multi-tool baseline: one turn with several
tool calls (ls + read + bash), to audit aggregation, spacing and bulk.

Surfaces:
  01-multitool-<W>   the turn completed (reply anchor)
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pty_common  # noqa: E402
from pty_common import UnownPty, exit_code, make_logger, print_summary  # noqa: E402

SCRIPT = "pty_multitool"
PROMPT = (
    "List the files in the current directory with ls -la, then read hi.py, "
    "then run wc -c hi.py, then reply with exactly: MULTIOK"
)


def drive(log, width: int, rows: int, out_root: str, records: list):
    pty_common.COLS = width
    pty_common.ROWS = rows
    pty_common.OUT_DIR = out_root
    scratch = os.path.join(tempfile.gettempdir(), f"unown-multitool-{width}")
    shutil.rmtree(scratch, ignore_errors=True)
    os.makedirs(scratch, exist_ok=True)
    with open(os.path.join(scratch, "hi.py"), "w", encoding="utf-8") as f:
        f.write("print('hi from unown')\n")

    s = UnownPty(log, cwd=scratch)
    try:
        s.wait_ready()
        s.wait_idle(timeout=45, stable_for=1.5)
        s.log(f"[{width}] send multi-tool turn")
        s.type_prompt(PROMPT, cps=90)
        try:
            s.wait_for(["MULTIOK"], timeout=240, desc="reply anchor")
            s.wait_idle(timeout=90, stable_for=2.0)
        except pty_common.PaneTimeout:
            log(f"!! [{width}] reply anchor missing")
        records.append(s.still(f"01-multitool-{width:03d}", ["MULTIOK"]))
    finally:
        s.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--widths", default="128")
    ap.add_argument("--rows", type=int, default=36)
    ap.add_argument("--label", default="run")
    args = ap.parse_args()

    out_root = os.environ.get("OUT", f"/home/z/my-project/download/unown-density-captures/{args.label}")
    pty_common.OUT_DIR = out_root
    log = make_logger(SCRIPT)
    records = []
    for w in [int(x) for x in args.widths.split(",") if x.strip()]:
        drive(log, w, args.rows, out_root, records)

    print_summary(SCRIPT, records)
    print(f"\nstills + pane ground truth: {out_root}")
    return exit_code(records)


if __name__ == "__main__":
    sys.exit(main())
