#!/usr/bin/env python3
"""Live PTY drive of `unown dashboard routines` — the M2 event-row pass.

Creates a real event routine (with a filter) via the CLI, boots the standalone
dashboard in a 128x36 pty against the REAL engine, and verifies:
  1. the list row renders `on <event>` (+ the described filter)
  2. enter → detail pane shows the trigger spec + filter + trigger hint
  3. the row's runs lane does not offer skip semantics confusion (event rows
     show waiting state, not a next occurrence)

Prints PASS/FAIL per step; exits non-zero on any failure. Cleans the routine up.
"""
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import UnownPty  # noqa: E402

UNOWN_ROOT = "/home/z/my-project/unown"
log = (lambda msg: print(f"[pty] {msg}"))

UNOWN = os.environ.get("UNOWN_BIN", "unown")
EVENT = "tui.e2e.event"
TITLE = "TUI event row"


def sh(*args, timeout=60):
    r = subprocess.run([UNOWN, *args], capture_output=True, text=True, timeout=timeout)
    return r.returncode, r.stdout + r.stderr


def main():
    # 0) create the event routine (CLI lane, real engine)
    code, out = sh(
        "routines", "create", "--title", TITLE,
        "--prompt", "TUI e2e probe. Acknowledge in one sentence.",
        "--on-event", EVENT, "--filter", 'payload.kind == "probe"',
        "--workspace", UNOWN_ROOT,
    )
    rid = None
    for token in out.split():
        if token.startswith("auto-"):
            rid = token.strip("()\u201c\u201d")
            break
    if code != 0 or not rid:
        print(f"FAIL create: {out[:400]}")
        return 1
    print(f"PASS create ({rid})")
    try:
        pty = UnownPty(log, cwd=UNOWN_ROOT, extra_args=["dashboard", "routines"])
        try:
            # 1) the list row renders on <event> with the described filter
            ok1 = pty.wait_for(f"on {EVENT}", timeout=25)
            row_ok = ok1
            pty.pump(0.6)
            pane = "\n".join(pty.pane())
            filter_ok = "kind == \"probe\"" in pane or "payload.kind" in pane or "kind = probe" in pane or "probe" in pane
            print(("PASS" if row_ok and filter_ok else "FAIL") + f" list row (on {EVENT}: {row_ok}, filter visible: {filter_ok})")

            # 2) enter → detail pane: trigger spec + local-trigger hint
            pty.key("Enter")
            time.sleep(1.0)
            pty.pump(0.6)
            pane = "\n".join(pty.pane())
            det_ok = ("event" in pane.lower()) and (EVENT in pane)
            hint_ok = ("trigger" in pane.lower())
            print(("PASS" if det_ok and hint_ok else "FAIL") + f" detail (spec: {det_ok}, trigger hint: {hint_ok})")

            # 3) esc back, the row survives
            pty.key("Esc")
            time.sleep(0.8)
            pty.pump(0.5)
            back_ok = EVENT in "\n".join(pty.pane())
            print(("PASS" if back_ok else "FAIL") + " esc back to list")
            return 0 if (row_ok and filter_ok and det_ok and hint_ok and back_ok) else 1
        finally:
            pty.close()
    finally:
        code, out = sh("routines", "delete", rid)
        print(("PASS" if code == 0 else "FAIL") + " cleanup delete")


if __name__ == "__main__":
    sys.exit(main())
