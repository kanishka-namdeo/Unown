#!/usr/bin/env python3
"""
pty_capture_dashboard.py — PTY smoke + still capture for `unown dashboard`
(the TUI mission control; docs/tui-dashboard-plan.md §7 lane 3).

Boots the real standalone dashboard against the live engine (:3030) inside a
pty, drives every screen via keyboard, and writes pane-truth + PNG stills:

  OUT/
    dashboard-<screen>.png        full-frame still (PIL render)
    dashboard-<screen>.pane.txt   literal screen text (the audit ground truth)
    dashboard.pane.log            every pane dump in sequence

Usage:
  /usr/bin/python3 pty_capture_dashboard.py [--screens ov,mem,...]
  Env: OUT (default download/dashboard-captures), UNOWN_ROOT, PTY_COLS/ROWS,
       SCREEN_WAIT (default 2.5s), UNOWN_DASH_ARGS (initial screen arg)

Exit code 0 = every screen rendered its expected vocabulary; 1 = a screen
failed its pane-truth check (the harness gate, not a human judgement).
"""

from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pty_common as C  # noqa: E402

OUT = os.environ.get("OUT", "/home/z/my-project/download/dashboard-captures")
SCREEN_WAIT = float(os.environ.get("SCREEN_WAIT", "2.5"))

# screen key -> (pane-truth vocabulary every render must contain)
SCREENS: dict[str, list[str]] = {
    "overview": ["unown", "dashboard", "engine", "LEARNING", "benchmark tasks"],
    "memory": ["engine tiers", "injection budget", "project memories"],
    "dreams": ["pending notes", "autodream"],
    "notes": ["NOTES", "filter"],
    "skills": ["SKILLS", "minted"],
    "lab": ["learning lab", "cycles", "improvements", "runs"],
    "hooks": ["HOOKS", "events", "filter"],
    "router": ["router jobs", "auto-dream", "sandboxes"],
    "providers": ["engine model", "key"],
    "gateway": ["requests", "latency"],
    "automations": ["AUTOMATIONS", "cron"],
    "webcache": ["entries", "saved"],
}

ACCEL = {
    "overview": "1", "memory": "2", "dreams": "3", "notes": "4", "skills": "5",
    "lab": "6", "hooks": "7", "router": "8", "providers": "9", "gateway": "0",
}


def main(only: list[str] | None) -> int:
    os.makedirs(OUT, exist_ok=True)
    targets = only or list(SCREENS.keys())
    failures: list[str] = []
    log = C.make_logger("pty_capture_dashboard")
    pane_log = open(os.path.join(OUT, "dashboard.pane.log"), "w", encoding="utf-8")

    dash_args = ["dashboard", os.environ.get("UNOWN_DASH_ARGS", "overview")]
    pty = C.UnownPty(log, cwd=C.UNOWN_ROOT, extra_args=dash_args)
    try:
        pty.wait_for("dashboard", timeout=30)
        time.sleep(SCREEN_WAIT)

        for name in targets:
            if name not in SCREENS:
                print(f"! unknown screen {name}", file=sys.stderr)
                continue
            vocab = SCREENS[name]
            key = ACCEL.get(name)
            if key:
                pty.send(key)
            else:
                # The last two screens have no digit accelerator: step `]`
                # until the sidebar marks the target active.
                for _ in range(12):
                    pty.send("]")
                    time.sleep(0.35)
                    if name.replace("webcache", "Web Cache").lower() in pty.pane_text().lower():
                        break
            time.sleep(SCREEN_WAIT)
            pty.pump(0.6)
            pane = pty.pane_text()
            pane_log.write(f"===== {name} =====\n{pane}\n\n")
            pane_log.flush()
            C.render_png(pty.screen, os.path.join(OUT, f"dashboard-{name}.png"), f"unown dashboard — {name}")
            open(os.path.join(OUT, f"dashboard-{name}.pane.txt"), "w", encoding="utf-8").write(pane)
            missing = [v for v in vocab if v.lower() not in pane.lower()]
            if missing:
                failures.append(f"{name}: missing {missing}")
                print(f"  ✗ {name}: missing vocabulary {missing}")
            else:
                print(f"  ✓ {name}: pane truth OK")

        # Interactions worth proving: palette (`:`) and help (`?`) overlays.
        pty.send(":")
        time.sleep(1.2)
        pty.pump(0.5)
        pane = pty.pane_text()
        if "palette" not in pane.lower() and "learning loop" not in pane.lower():
            failures.append("palette: overlay did not render")
        pty.send("\x1b")
        time.sleep(0.6)
        pty.send("?")
        time.sleep(1.2)
        pty.pump(0.5)
        pane = pty.pane_text()
        if "keys" not in pane.lower():
            failures.append("help: overlay did not render")
            open(os.path.join(OUT, "help-fail.pane.txt"), "w", encoding="utf-8").write(pane)
        pty.send("\x1b")
        time.sleep(0.6)
        pty.pump(0.5)
        pane_log.write("===== final =====\n" + pty.pane_text() + "\n")
    finally:
        pane_log.close()
        try:
            pty.child.terminate(force=True)
        except Exception:
            pass

    if failures:
        print(f"\nFAIL: {len(failures)} check(s) failed:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"\nPASS: {len(targets)} screen(s) captured with pane truth intact")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    only = None
    if args and args[0] == "--screens":
        only = [a.strip() for a in args[1].split(",") if a.strip()]
    sys.exit(main(only))
