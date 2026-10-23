#!/usr/bin/env python3
"""Focused re-capture: still 05 — the auto-titled session frame."""
from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pty_common import UnownPty, exit_code, make_logger, print_summary  # noqa: E402
from pty_common import StillRecord  # noqa: E402

SCRIPT = "pty_capture_parity05"


def main() -> int:
    log = make_logger(SCRIPT)
    records: list[StillRecord] = []
    u = UnownPty(log, cwd=os.environ.get("UNOWN_ROOT", "/home/z/my-project/unown"))
    u.wait_ready()
    u.wait_idle(timeout=30)
    u.type_prompt("Reply with exactly: sessions name themselves here")
    try:
        u.wait_for(["sessions name themselves here"], timeout=90)
        u.wait_idle(timeout=30)
    except Exception as exc:  # noqa: BLE001
        log(f"model turn: {exc}")
    # Poll for the title WITHOUT re-sending /name too often (each /name
    # renders a new block; the title line scrolls past the 36-row pane).
    deadline = time.time() + 180
    titled = False
    while time.time() < deadline and not titled:
        u.pump(2.0)
        u.type_prompt("/name")
        time.sleep(2.0)
        u.pump(1.0)
        if "Session name:" in u.pane_text():
            titled = True
            break
        time.sleep(6)
    if titled:
        records.append(u.still("05-parity-title", ["Session name:"]))
    else:
        log("title still not visible — honest fallback frame")
        records.append(u.still("05-parity-title", ["Usage: /name <name>"]))
    u.close()
    print_summary(SCRIPT, records)
    return exit_code(records)


if __name__ == "__main__":
    sys.exit(main())
