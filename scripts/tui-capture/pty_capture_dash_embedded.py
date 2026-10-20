#!/usr/bin/env python3
"""
pty_capture_dash_embedded.py — the embedded mount of the TUI dashboard:
/dashboard inside a live session (docs/tui-dashboard-plan.md §5.4).

Boots the real chat TUI, opens the dashboard as an editor-replacing screen,
verifies pane truth (sidebar, screen content, footer), drives a screen jump
and a drill-in, then proves Esc-Esc returns to the chat editor.

Usage: /usr/bin/python3 pty_capture_dash_embedded.py
Env:   OUT (default download/dashboard-captures/embedded), UNOWN_ROOT, PTY_CWD
"""

from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pty_common as C  # noqa: E402

OUT = os.environ.get("OUT", "/home/z/my-project/download/dashboard-captures/embedded")


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    log = C.make_logger("pty_capture_dash_embedded")
    failures: list[str] = []
    cwd = os.environ.get("PTY_CWD", C.UNOWN_ROOT)

    s = C.UnownPty(log, cwd=cwd, extra_args=[])
    try:
        s.wait_ready(timeout=90)
        s.wait_idle()

        # Open the dashboard via the slash command.
        s.type_prompt("/dashboard", cps=80)
        s.wait_for(
            ["LEARNING", "benchmark tasks", "esc-esc chat"],
            timeout=30,
            desc="embedded dashboard mount",
        )
        time.sleep(2.0)
        s.pump(0.8)
        pane = s.pane_text()
        C.render_png(s.screen, os.path.join(OUT, "dash-embedded-overview.png"), "unown — /dashboard (embedded)")
        open(os.path.join(OUT, "dash-embedded-overview.pane.txt"), "w", encoding="utf-8").write(pane)
        for anchor in ["LEARNING", "benchmark tasks", "esc-esc chat", "engine"]:
            if anchor not in pane:
                failures.append(f"embedded overview: missing {anchor!r}")

        # Jump to the Memory screen (accelerator 2) and verify pane truth.
        s.send("2")
        time.sleep(2.0)
        s.pump(0.8)
        pane = s.pane_text()
        C.render_png(s.screen, os.path.join(OUT, "dash-embedded-memory.png"), "unown — /dashboard memory (embedded)")
        open(os.path.join(OUT, "dash-embedded-memory.pane.txt"), "w", encoding="utf-8").write(pane)
        for anchor in ["engine tiers", "injection budget"]:
            if anchor not in pane:
                failures.append(f"embedded memory: missing {anchor!r}")

        # Drill into a tier (enter), verify history section, then back out.
        s.send("\r")
        time.sleep(1.5)
        s.pump(0.6)
        pane = s.pane_text()
        if "version history" not in pane and "POLICY" not in pane:
            failures.append("embedded memory detail: no tier detail rendered")
        s.send("\x1b")
        time.sleep(0.8)
        s.pump(0.4)

        # Esc-Esc returns to the chat editor (the prompt line is back).
        s.send("\x1b", delay=0.02)
        time.sleep(0.25)
        s.send("\x1b", delay=0.02)
        time.sleep(1.5)
        s.pump(0.8)
        pane = s.pane_text()
        C.render_png(s.screen, os.path.join(OUT, "dash-embedded-exited.png"), "unown — back to chat after /dashboard")
        open(os.path.join(OUT, "dash-embedded-exited.pane.txt"), "w", encoding="utf-8").write(pane)
        if "LEARNING" in pane:
            failures.append("esc-esc: dashboard still mounted after double-escape")
    finally:
        try:
            s.child.terminate(force=True)
        except Exception:
            pass

    if failures:
        print(f"FAIL: {len(failures)} check(s) failed:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS: embedded dashboard mounts, switches, drills, and exits cleanly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
