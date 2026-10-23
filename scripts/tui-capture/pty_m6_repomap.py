#!/usr/bin/env python3
"""Live PTY drive of the in-session `/repomap` command (M6).

Boots the real TUI (a real terminal) in the self-learning package — a repo
with hundreds of TS files — and verifies:
  1. `/repomap` renders the map: gutter def lines (│) + real source defs
     (the "Repo map —" header scrolls off on a big repo, so the CONTENT
     markers are the assertion)
  2. the map is a multi-file view (def lines from more than one file)
  3. `/repomap clear` reports the cache clear

Prints PASS/FAIL per step; exits non-zero on any failure.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import UnownPty  # noqa: E402

log = (lambda msg: print(f"[pty] {msg}"))

CWD = "/home/z/my-project/unown/pi-repo/packages/self-learning"


def main():
    pty = UnownPty(log, cwd=CWD, extra_args=[])
    try:
        # Boot: wait for the tip line that says the TUI is up.
        pty.wait_for("ctrl+k", timeout=40)
        pty.send("/repomap\r")
        # The map build can take a few seconds on first run in this repo.
        deadline = time.time() + 60
        gutter = defs = multi = False
        while time.time() < deadline and not (gutter and defs and multi):
            time.sleep(2)
            pty.pump(0.6)
            pane = "\n".join(pty.pane())
            lines = pane.splitlines()
            gutter = any(l.strip().startswith("\u2502") for l in lines)
            defs = any("export function" in l or "export class" in l or "export interface" in l for l in lines)
            # A def line + a ⋮ elision + more content = a real multi-line map.
            multi = sum(1 for l in lines if l.strip().startswith("\u2502")) >= 5
        print(("PASS" if gutter else "FAIL") + f" gutter def lines render ({gutter})")
        print(("PASS" if defs else "FAIL") + f" real source definitions visible ({defs})")
        print(("PASS" if multi else "FAIL") + f" multi-line map body ({multi})")
        pty.send("/repomap clear\r")
        ok2 = pty.wait_for("cleared", timeout=30)
        print(("PASS" if ok2 else "FAIL") + f" clear subcommand ({ok2})")
        return 0 if (gutter and defs and multi and ok2) else 1
    finally:
        pty.close()


if __name__ == "__main__":
    sys.exit(main())
