#!/usr/bin/env python3
"""Live smoke: /providers against the REAL ~/.unown registry (no scratch home).

Boots `unown` in a PTY with the real home, sends `/providers list`, asserts
the pane shows the real providers (agnes + zai-bridge), then `/providers test
agnes` for a live verdict, and quits. Prints PASS/FAIL lines; exit code 0 on
success. Usage: python3 scripts/tui-capture/pty_providers_live.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import UnownPty, make_logger  # noqa: E402

LOG = make_logger("pty_providers_live")
FAILS: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(f"{'PASS' if cond else 'FAIL'}  {name}  {detail}")
    if not cond:
        FAILS.append(name)


def main() -> int:
    pty = UnownPty(LOG)  # real environment, real home
    try:
        pty.wait_ready(timeout=120)
        pty.wait_idle(timeout=90)

        pty.type_prompt("/providers list")
        pty.wait_idle(timeout=30)
        pane = pty.pane_text()
        with open("/tmp/providers-list-pane.txt", "w") as f:
            f.write(pane)
        check("live-registry lists zai-bridge", "zai-bridge" in pane)
        check("live-registry lists agnes", "agnes" in pane)
        check("canonical default line", "default model:" in pane)
        check("CLI twin hint", "unown providers" in pane)

        pty.type_prompt("/providers test agnes")
        pty.wait_idle(timeout=40)
        low = pty.pane_text().lower()
        with open("/tmp/providers-test-pane.txt", "w") as f:
            f.write(low)
        check(
            "agnes live verdict (reachable or actionable)",
            ("reachable" in low) or ("key" in low) or ("401" in low) or ("problem" in low),
        )
    finally:
        try:
            pty.send("\x1b")  # esc any dialog
            pty.wait_idle(timeout=10)
            pty.send("\x03")  # ctrl-c quits the TUI
        except Exception:
            pass
        pty.close()
    print(f"live providers smoke: {'PASS' if not FAILS else 'FAIL'} ({len(FAILS)} fails)")
    return 0 if not FAILS else 1


if __name__ == "__main__":
    sys.exit(main())
