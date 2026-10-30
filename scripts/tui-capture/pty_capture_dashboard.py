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
    # "minted" only appears in the empty state ("no skills minted yet"); a
    # populated skills screen proves itself with per-row status badges.
    "skills": ["SKILLS", "shipped"],
    "lab": ["learning lab", "cycles", "improvements", "runs"],
    "hooks": ["HOOKS", "events", "filter"],
    "router": ["router jobs", "auto-dream", "sandboxes"],
    "gateway": ["requests", "latency"],
    "automations": ["routines", "cron", "active"],
    "webcache": ["entries", "saved"],
    # The delegation round (2026-10-30): the audit screen — why, cost,
    # outcome per spawn, by-agent tallies, why-coverage. The fixture's
    # delegations payload carries the F26 runaway row, the counter row with
    # its why, and the reviewer row (test/dashboard-mock-engine.ts).
    "delegation": ["delegation", "why recorded", "hit the wall-clock budget", "by agent"],
    # The PLM round (2026-10-30): the Process View (the registry census +
    # per-process rows — the live engine carries real processes by now) and
    # the Tool View (per-tool reliability rows; the vocabulary words render
    # with any data, the honest-absence states included).
    "processes": ["processes", "tracked"],
    "tools": ["tools", "invocation"],
}

# The sidebar's digit accelerators cover the first ten screens (1-9, then 0).
# The delegation round inserted Delegation after Recovery: recovery took 9
# and delegation takes 0; gateway/routines/web-cache ride the unnumbered rail.
# The PLM round (2026-10-30) inserted Processes + Tools after Recovery:
# processes takes the 0 accelerator; tools joins delegation on the
# unnumbered rail (captured via the deep-link restart flow).
ACCEL = {
    "overview": "1", "memory": "2", "dreams": "3", "notes": "4", "skills": "5",
    "lab": "6", "hooks": "7", "router": "8", "recovery": "9", "processes": "0",
}


def main(only: list[str] | None) -> int:
    os.makedirs(OUT, exist_ok=True)
    targets = only or list(SCREENS.keys())
    failures: list[str] = []
    log = C.make_logger("pty_capture_dashboard")
    pane_log = open(os.path.join(OUT, "dashboard.pane.log"), "w", encoding="utf-8")

    # The delegation round's navigation fix: accelerated screens keep the
    # original one-process flow (digit key), while every screen past the
    # tenth — unnumbered in the sidebar — is captured by RESTARTING the
    # dashboard deep-linked to it (`unown dashboard <screen>`, the boot's
    # own route). The historical `]`-stepping was wrong from the start —
    # `[`/`]` open the screens OVERLAY, they do not advance the active
    # screen (measured live 2026-10-30: the steps parked on Recovery while
    # the checker looked for Gateway's vocabulary).
    accel_targets = [n for n in targets if n in ACCEL and n in SCREENS]
    restart_targets = [n for n in targets if n not in ACCEL and n in SCREENS]
    pty = None
    try:
        for name in accel_targets + restart_targets:
            deep_link = name not in ACCEL
            if pty is None or deep_link:
                if pty is not None:
                    try:
                        pty.child.terminate(force=True)
                    except Exception:
                        pass
                    time.sleep(0.8)
                pty = C.UnownPty(log, cwd=C.UNOWN_ROOT, extra_args=["dashboard", name])
                pty.wait_for("dashboard", timeout=30)
                time.sleep(SCREEN_WAIT + (1.0 if deep_link else 0.0))
            vocab = SCREENS[name]
            if not deep_link:
                pty.send(ACCEL[name])
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
            if pty is not None:
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
