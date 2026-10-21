#!/usr/bin/env python3
"""
m6_pty_dashboard.py — PTY verification of the M6 TUI dashboard run detail:
the new `isolation` field (wave 5 / M4-c D2) rendered by lab-screen's
runDetailLines, live against the real engine.

Steps: boot `unown dashboard` -> accelerator 6 (Learning Lab) -> TAB to the
runs section -> enter on the first run -> assert the isolation line.

Usage: UNOWN_ROOT=<repo> python3 scripts/tui-capture/m6_pty_dashboard.py
"""
from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pty_common import UnownPty, make_logger  # noqa: E402

OUT = "/home/z/my-project/download/m6-tui-dashboard-verify"
os.makedirs(OUT, exist_ok=True)
log = make_logger(os.path.join(OUT, "run.log"))
results = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok))
    log(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def still(p: UnownPty, name: str) -> None:
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(p.pane_text())


log("=== M6 TUI dashboard isolation verification ===")
p = UnownPty(
    log,
    cwd=os.environ.get("UNOWN_ROOT", "/home/z/my-project/work/Unown"),
    extra_args=["dashboard"],
)

# boot
p.pump(3.5)
p.pump(1.0)
pane = p.pane_text()
still(p, "01-boot.pane.txt")
check("boot: dashboard renders", "overview" in pane.lower() or "unown" in pane.lower(), pane.splitlines()[1][:60] if len(pane.splitlines()) > 1 else "")

# accelerator 6 = Learning Lab
p.send("6")
p.pump(1.5)
pane = p.pane_text()
still(p, "02-lab.pane.txt")
check("lab: Learning Lab screen active", "learning lab" in pane.lower(), "")

# TAB cycles sections until the runs list is focused. Detect by the footer's
# "enter open" hint appearing next to a runs list, or simply iterate a few
# times and look for run rows (status glyphs + task ids).
found_runs = False
for i in range(6):
    pane = p.pane_text()
    if ("fix-" in pane or "impl-" in pane or "mint-" in pane) and ("passed" in pane or "failed" in pane or "running" in pane):
        found_runs = True
        break
    p.send("\t")
    p.pump(0.7)
still(p, "03-runs-list.pane.txt")
check("lab: runs list focused", found_runs, "run rows visible after TAB cycling")

# enter opens the run detail
p.send("\r")
p.pump(1.5)
p.pump(0.8)
pane = p.pane_text()
still(p, "04-run-detail.pane.txt")
check("detail: run detail opened", "run ·" in pane or "tokens" in pane.lower(), "")

iso_ok = "isolation" in pane.lower()
check("detail: isolation field renders", iso_ok, [l.strip() for l in pane.splitlines() if "isolation" in l.lower()][:1])
bwrap_ok = "bwrap" in pane.lower()
check("detail: isolation is bwrap (real OS jail)", bwrap_ok, "")

# quit cleanly (q or esc chain)
for key in ("q", "\x1b", "q"):
    try:
        p.child.send(key.encode())
        p.pump(0.6)
    except Exception:
        break
import pexpect  # noqa: E402

try:
    p.child.send(b"\x03")
    p.pump(0.8)
    p.child.send(b"\x03\x03")
    p.pump(1.2)
except (pexpect.exceptions.EOF, OSError):
    pass
exited = p.dead or p.child.eof()
if not exited:
    try:
        p.child.expect(pexpect.EOF, timeout=5)
        exited = True
    except pexpect.exceptions.TIMEOUT:
        exited = False
check("exit: dashboard exits cleanly", exited, f"dead={p.dead}")

ok = all(r[1] for r in results)
log(f"=== summary: {sum(1 for r in results if r[1])}/{len(results)} PASS ===")
for name, res in results:
    print(f"{'PASS' if res else 'FAIL'}  {name}")
sys.exit(0 if ok else 1)
