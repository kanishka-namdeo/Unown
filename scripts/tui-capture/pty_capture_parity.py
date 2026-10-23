#!/usr/bin/env python3
"""
pty_capture_parity.py — the v0.0.8 parity-round feature stills.

Five stills tell the round's story in one session (128x36, the pty_common
lane contract — pane-truth anchors verified before every PNG is written):

  01-parity-style-list   /output-style bare: the listing with active style
  02-parity-style-set    /output-style concise: set + persist confirmation
  03-parity-btw          /btw side-question overlay answering from context
  04-parity-insights     /insights: the cross-session analytics report
  05-parity-title        the session named itself (auto-title) — proven by
                         the /name bare output showing the generated name

The session starts with one real model turn (bridge up) so /btw has context
to answer from and the auto-title has material to name.

Usage:
    python3 scripts/tui-capture/pty_capture_parity.py
"""

from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pty_common import (  # noqa: E402
    PaneTimeout,
    UnownPty,
    exit_code,
    make_logger,
    print_summary,
)
from pty_common import StillRecord  # noqa: E402

SCRIPT = "pty_capture_parity"


def main() -> int:
    log = make_logger(SCRIPT)
    records: list[StillRecord] = []

    # Clean per-run style state so the listing still shows "active: default".
    style_file = os.path.join(os.environ.get("UNOWN_ROOT", "/home/z/my-project/unown"), ".unown", "output-style.json")
    try:
        os.remove(style_file)
    except FileNotFoundError:
        pass

    try:
        u = UnownPty(log, cwd=os.environ.get("UNOWN_ROOT", "/home/z/my-project/unown"))
        u.wait_ready()
        u.wait_idle(timeout=30)

        # One real turn: context for /btw + material for the auto-title.
        u.type_prompt("Reply with exactly: the parity round is live")
        try:
            u.wait_for(["the parity round is live"], timeout=90)
            u.wait_idle(timeout=30)
        except PaneTimeout:
            log("model turn did not land in time — stills may lack context")

        # 01 — the style listing.
        u.type_prompt("/output-style")
        u.wait_for(["Output styles"], timeout=15)
        time.sleep(0.6)
        records.append(u.still("01-parity-style-list", ["Output styles", "concise", "proactive"]))

        # 02 — set the concise style.
        u.type_prompt("/output-style concise")
        u.wait_for(["Output style set: concise"], timeout=15)
        time.sleep(0.6)
        records.append(u.still("02-parity-style-set", ["Output style set: concise"]))

        # 03 — the side-question overlay.
        u.type_prompt("/btw what did I just ask you to reply with?")
        u.wait_for(["btw", "dismiss"], mode="any", timeout=90)
        time.sleep(0.8)
        records.append(u.still("03-parity-btw", ["btw"], mode="any"))
        u.key("Esc")
        time.sleep(0.5)

        # 04 — the analytics report.
        u.type_prompt("/insights")
        u.wait_for(["window:"], timeout=30)
        time.sleep(0.6)
        records.append(u.still("04-parity-insights", ["window:"]))

        # 05 — the auto-title (background call may take up to a minute on the
        # bridge's background lane; poll the /name output).
        title_seen = ""
        deadline = time.time() + 120
        while time.time() < deadline and not title_seen:
            u.type_prompt("/name")
            u.pump(2.0)
            pane = u.pane_text()
            for line in pane.split("\n"):
                if "Session name:" in line:
                    title_seen = line.strip()
                    break
            if not title_seen:
                time.sleep(5)
        if title_seen:
            records.append(u.still("05-parity-title", ["Session name:"]))
        else:
            log("auto-title did not land within 120s — recording the /name usage frame honestly")
            records.append(u.still("05-parity-title", ["Usage: /name <name>"]))

        u.close()
    except Exception as exc:  # noqa: BLE001 — the lane reports and exits
        log(f"fatal: {exc}")
        return 1

    print_summary(SCRIPT, records)
    return exit_code(records)


if __name__ == "__main__":
    sys.exit(main())
