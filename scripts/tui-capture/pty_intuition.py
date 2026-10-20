#!/usr/bin/env python3
"""
pty_intuition.py — the round-5 intuition lane: the command palette (ctrl+k),
the ? keybinding reference, and the contextual footer hint line, driven end
to end over a real PTY against the live stack.

Surfaces (128x36 unless --cols):

  01-hint-idle        the footer hint line at idle (? help · ctrl+k palette …)
  02-palette          ctrl+k opens the palette (slash commands + actions)
  03-palette-filter   typing "model" filters the palette
  04-palette-model    Enter on "Select model…" opens the model selector
  05-help             ? opens the keybinding reference (live bindings)
  06-help-filter      typing filters the reference

Usage:
    python3 scripts/tui-capture/pty_intuition.py [--label run] [--cols 128]
"""

from __future__ import annotations

import argparse
import os
import sys
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

SCRIPT = "pty_intuition"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--label", default="run")
    ap.add_argument("--cols", type=int, default=128)
    ap.add_argument("--rows", type=int, default=36)
    args = ap.parse_args()

    out_root = os.environ.get(
        "OUT", f"/home/z/my-project/download/unown-intuition-captures/{args.label}"
    )
    pty_common.COLS = args.cols
    pty_common.ROWS = args.rows
    pty_common.OUT_DIR = out_root
    log = make_logger(SCRIPT)
    log(f"intuition lane {args.cols}x{args.rows} -> {out_root}")

    records = []
    s = UnownPty(log, cwd="/tmp/unown-intuition")
    try:
        s.wait_ready(timeout=120)
        s.wait_idle(timeout=45, stable_for=1.5)

        # 01 — idle hint line in the footer chrome.
        try:
            s.wait_for(["? help", "palette"], timeout=15, desc="footer hint line")
            records.append(s.still("01-hint-idle", ["? help", "palette"]))
        except pty_common.PaneTimeout:
            log("!! footer hint line missing")
            records.append(s.still("01-hint-idle", ["? help", "palette"]))

        # 02 — ctrl+k opens the palette.
        s.send("\x0b", delay=0.5)  # ctrl+k
        try:
            s.wait_for(["Command palette"], timeout=15, desc="palette title")
            records.append(s.still("02-palette", ["Command palette"]))
        except pty_common.PaneTimeout:
            log("!! palette did not open on ctrl+k")
            records.append(s.still("02-palette", ["Command palette"]))

        # 03 — filter by "model".
        for ch in "model":
            s.send(ch, delay=0.06)
        time.sleep(0.5)
        s.pump(0.6)
        records.append(s.still("03-palette-filter", ["Select model"]))

        # 04 — Enter on the first match opens the model selector.
        s.key("Enter", delay=0.8)
        try:
            s.wait_for(["agnes"], timeout=15, desc="model selector rows")
            records.append(s.still("04-palette-model", ["agnes"]))
        except pty_common.PaneTimeout:
            log("!! model selector did not open from palette")
            records.append(s.still("04-palette-model", ["agnes"]))
        s.key("Esc", delay=0.4)
        s.pump(0.4)

        # 05 — ? opens the keybinding reference (editor must be empty; the
        # palette run may have populated /model, so clear it first — one
        # ctrl+c clears the editor when it has content).
        s.send("\x03", delay=0.4)
        s.pump(0.3)
        s.send("?", delay=0.6)
        try:
            s.wait_for(["Keyboard shortcuts"], timeout=15, desc="help title")
            records.append(s.still("05-help", ["Keyboard shortcuts"]))
        except pty_common.PaneTimeout:
            log("!! help did not open on ?")
            records.append(s.still("05-help", ["Keyboard shortcuts"]))

        # 06 — filter the reference ("palette" must appear as a binding row).
        for ch in "palette":
            s.send(ch, delay=0.06)
        time.sleep(0.5)
        s.pump(0.6)
        records.append(s.still("06-help-filter", ["palette"]))
    finally:
        s.close()

    print_summary(SCRIPT, records)
    print(f"\nstills + pane ground truth: {out_root}")
    return exit_code(records)


if __name__ == "__main__":
    sys.exit(main())
