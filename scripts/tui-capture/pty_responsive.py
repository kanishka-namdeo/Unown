#!/usr/bin/env python3
"""
pty_responsive.py — the responsive lane: the real TUI booted at multiple
terminal geometries, driven like an end user (a real chat turn through the
bridge), stills + pane ground truth per width.

Surfaces per width W (rows fixed at --rows, default 36):

  W-01-boot       the boot frame (header + editor + footer)
  W-02-reply      a real agent turn completed (reply anchor in pane)
  W-03-selector   the model selector opened via ctrl+l
  W-04-todos      the /todos empty-state notice

Usage:
    python3 scripts/tui-capture/pty_responsive.py                    # 56,72,96,128
    python3 scripts/tui-capture/pty_responsive.py --widths 56,72     # subset
    python3 scripts/tui-capture/pty_responsive.py --label m1        # output dir tag
    python3 scripts/tui-capture/pty_responsive.py --skip-chat       # selector/todos only

Environment: PTY_COLS/PTY_ROWS are honored for the default geometry only;
--widths overrides per-boot (the module constants are patched per boot so
one process can capture several widths).

Exit code 0 only if every still's anchors matched (PASS) — same contract
as the other PTY lanes.

Requires: bun + built repo, the LLM bridge on :3031 (a real model turn),
python3 with pyte/pexpect/PIL.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pty_common  # noqa: E402
from pty_common import (  # noqa: E402
    READY_ANCHOR,
    UnownPty,
    exit_code,
    make_logger,
    print_summary,
)

SCRIPT = "pty_responsive"


def boot(log, width: int, rows: int, scratch: str) -> UnownPty:
    """Patch module geometry, then spawn one TUI at that size."""
    pty_common.COLS = width
    pty_common.ROWS = rows
    os.makedirs(scratch, exist_ok=True)
    log(f"boot {width}x{rows} (cwd={scratch})")
    return UnownPty(log, cwd=scratch)


def drive_width(
    log,
    width: int,
    rows: int,
    out_root: str,
    skip_chat: bool,
    records: list,
) -> None:
    pty_common.OUT_DIR = out_root
    scratch = os.path.join(tempfile.gettempdir(), f"unown-responsive-{width}")
    # Fresh project state per width so /todos is the true empty state.
    shutil.rmtree(scratch, ignore_errors=True)
    os.makedirs(scratch, exist_ok=True)

    s = boot(log, width, rows, scratch)
    try:
        s.wait_ready(timeout=120)
        s.wait_idle(timeout=45, stable_for=1.5)
        records.append(s.still(f"W{width:03d}-01-boot", [READY_ANCHOR]))

        if not skip_chat:
            # A real end-user turn: ask for an exact token, wait for it.
            token = f"R{width}OK"
            s.log(f"send chat turn (expect {token})")
            s.type_prompt(f"Reply with exactly: {token}", cps=90)
            try:
                s.wait_for([token], timeout=120, desc=f"reply anchor {token}")
                s.wait_idle(timeout=60, stable_for=1.5)
                records.append(s.still(f"W{width:03d}-02-reply", [token]))
            except pty_common.PaneTimeout:
                log(f"!! reply anchor {token} never appeared (width {width})")
                records.append(s.still(f"W{width:03d}-02-reply", [token]))

        # Model selector (ctrl+l) — width-sensitive surface.
        s.send("\x0c", delay=0.4)
        s.pump(0.6)
        try:
            s.wait_for(["agnes"], timeout=20, desc="model selector rows")
            records.append(s.still(f"W{width:03d}-03-selector", ["agnes"]))
        except pty_common.PaneTimeout:
            log(f"!! model selector did not open (width {width})")
            records.append(s.still(f"W{width:03d}-03-selector", ["agnes"]))
        s.key("Esc", delay=0.3)
        s.pump(0.4)

        # /todos — the todo addon's empty state.
        s.type_prompt("/todos", cps=80)
        try:
            s.wait_for(["No todos yet"], timeout=20, desc="/todos empty notice")
            records.append(s.still(f"W{width:03d}-04-todos", ["No todos yet"]))
        except pty_common.PaneTimeout:
            log(f"!! /todos notice missing (width {width})")
            records.append(s.still(f"W{width:03d}-04-todos", ["No todos yet"]))
    finally:
        s.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--widths", default="56,72,96,128", help="comma-separated col counts")
    ap.add_argument("--rows", type=int, default=36, help="terminal rows (default 36)")
    ap.add_argument(
        "--label", default="run", help="output subdir under the responsive root"
    )
    ap.add_argument("--skip-chat", action="store_true", help="no model turns (selector/todos only)")
    args = ap.parse_args()

    widths = [int(w) for w in args.widths.split(",") if w.strip()]
    out_root = os.environ.get(
        "OUT",
        f"/home/z/my-project/download/unown-responsive-captures/{args.label}",
    )
    # Patch OUT_DIR before make_logger so the capture log lands in the run dir.
    pty_common.OUT_DIR = out_root
    log = make_logger(SCRIPT)
    log(f"widths={widths} rows={args.rows} out={out_root} chat={'no' if args.skip_chat else 'yes'}")

    records = []
    for w in widths:
        drive_width(log, w, args.rows, out_root, args.skip_chat, records)

    print_summary(SCRIPT, records)
    print(f"\nstills + pane ground truth: {out_root}")
    return exit_code(records)


if __name__ == "__main__":
    sys.exit(main())
