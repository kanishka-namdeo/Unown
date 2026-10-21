#!/usr/bin/env python3
"""
m6_pty_cherrypick.py — PTY verification of the two cherry-picked upstream
pi-tui fixes (M6-5):

  1. TUI boots and the editor input path is intact (stdin-buffer rework risk)
  2. A fragmented terminal color reply (OSC 4 tail without terminator, then
     BEL) does NOT leak into the editor as text and does NOT open the
     external editor via Ctrl+G (the edb2eb9 fix behavior)
  3. A clean /exit still works and leaves the pane sane (the 9df819d
     exit-restore handler must not break the normal exit path)

Usage: python3 scripts/tui-capture/m6_pty_cherrypick.py
Stills -> download/m6-cherrypick-verify/
"""
from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pty_common import UnownPty, make_logger  # noqa: E402

import pexpect  # noqa: E402

OUT = "/home/z/my-project/download/m6-cherrypick-verify"
os.makedirs(OUT, exist_ok=True)

log = make_logger(os.path.join(OUT, "run.log"))
results = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    log(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def still(p: UnownPty, name: str) -> str:
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(p.pane_text())
    return path


log("=== M6 cherry-pick PTY verification ===")
p = UnownPty(log, cwd="/home/z/my-project/work/Unown")

# -- 1. boot ---------------------------------------------------------------
p.pump(3.0)
p.pump(1.0)
pane = p.pane_text()
still(p, "01-boot.pane.txt")
boot_ok = "module not found" not in pane.lower() and (("unown" in pane.lower()) or ("model" in pane.lower()))
check("boot: TUI renders header/status bar", boot_ok, f"first lines: {pane.splitlines()[:2]}")

# -- 2. editor input intact -------------------------------------------------
p.send("hello M6 cherrypick lane")
p.pump(0.8)
pane = p.pane_text()
still(p, "02-typed.pane.txt")
typed_ok = "cherrypick" in pane
check("input: typed text reaches the editor", typed_ok)

# -- 3. fragmented OSC color reply does not leak (edb2eb9) ------------------
# Simulate a delayed terminal reply arriving in two chunks with the BEL
# terminator in the second chunk — pre-fix, the flushed tail could land as
# text and the BEL as Ctrl+G (external editor). Post-fix the buffer holds the
# reply until its terminator; nothing reaches the editor.
p.child.send(b"\x1b]4;1;rgb:eaea/6c")
p.pump(0.3)          # let the sequence-timeout path consider flushing
time.sleep(0.15)
p.child.send(b"6c/6d6d\x07")
p.pump(0.8)
pane = p.pane_text()
still(p, "03-after-reply.pane.txt")
leak_markers = [m for m in ("rgb:eaea", "6c/6d6d", "6c6d") if m in pane]
check("reply-leak: fragmented OSC 4 reply leaves no text in the pane", not leak_markers, f"markers found: {leak_markers}")

# external editor would show a different pane (huge overlay) — detect via
# 'EDITOR' hint or a cleared pane; simplest truth: our typed text still there
still_ok = "cherrypick" in pane
check("reply-leak: BEL terminator did not open the external editor", still_ok)

# -- 4. a real Ctrl+G-ish control char path is not needed here; verify a
#       normal Enter does not send the buffered junk ------------------------
p.send("\r")
p.pump(0.6)
pane = p.pane_text()
still(p, "04-after-enter.pane.txt")
# The agent turn will start (bridge is up) — the pane should not contain the
# reply fragments as part of the echoed prompt.
check("post-reply: pane free of reply fragments after Enter", not any(m in pane for m in ("rgb:eaea", "6c/6d6d")))

# -- 5. clean exit -----------------------------------------------------------
# Ctrl+C twice (or /exit) — the exit-restore handler must not interfere.
try:
    p.child.send(b"\x03")   # Ctrl+C — cancels the editor line
    p.pump(0.5)
    p.child.send(b"\x1b")   # Esc — dismiss any overlay
    p.pump(0.5)
    p.child.send(b"\x03\x03")  # double Ctrl+C — exit confirm path
    p.pump(1.0)
    p.child.send(b"\x03\x03")
    p.pump(1.5)
except (pexpect.exceptions.EOF, OSError):
    pass
# if still alive, send /exit line
if not p.dead:
    try:
        p.child.send(b"\r/exit\r")
        p.pump(2.0)
    except (pexpect.exceptions.EOF, OSError):
        pass
exited = p.dead or p.child.eof()
if not exited:
    try:
        p.child.expect(pexpect.EOF, timeout=5)
        exited = True
    except pexpect.exceptions.TIMEOUT:
        exited = False
still(p, "05-final.pane.txt")
check("exit: TUI exits cleanly (EOF reached)", exited, f"dead={p.dead}")

ok = all(r[1] for r in results)
log(f"=== summary: {sum(1 for r in results if r[1])}/{len(results)} PASS ===")
for name, res, detail in results:
    print(f"{'PASS' if res else 'FAIL'}  {name}  {detail}")
sys.exit(0 if ok else 1)
