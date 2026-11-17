#!/usr/bin/env python3
"""probe_slash_escape.py — close the baseline-06 '//help' open question.

Question (semplice round, baseline 06): the pane showed '» //help' — is that
an input-integrity bug in the Esc-closes-popup protocol, or expected
leftover-slash behavior?

Expected (Claude Code parity):
  P1 clean:        fresh editor, type '/help' + Enter  → command card.
  P2 leftover:     type '/' (popup opens), Esc (popup closes, '/' stays),
                   type 'help' + Enter                   → '/help' → command card.
  P3 double-slash: '//' + 'help' + Enter (escape hatch) → CHAT turn, not a
                   command — the literal text goes to the model.

Exit 0 iff P1 and P2 render the help card and P3 does NOT error.
"""
from __future__ import annotations

import os
import sys
import tempfile

HERE = "/home/z/my-project/Unown/scripts/tui-capture"
sys.path.insert(0, HERE)

from pty_common import UnownPty, dismiss_first_flights, make_logger, print_summary  # noqa: E402
from pty_common import StillRecord  # noqa: E402

SCRIPT = "probe_slash_escape"
OUT = os.environ.get(
    "SEMPlice_OUT".upper(),
    "/home/z/my-project/download/unown-semplice/slash-escape-probe",
)
os.makedirs(OUT, exist_ok=True)
log = make_logger(os.path.join(OUT, f"{SCRIPT}.capture.log"))
records: list[StillRecord] = []


def fresh_env():
    home = tempfile.mkdtemp(prefix="slash-escape-home-")
    unown_home = os.path.join(home, ".unown")
    os.makedirs(unown_home, exist_ok=True)
    cwd = tempfile.mkdtemp(prefix="slash-escape-cwd-")
    env = {
        "HOME": home,
        "UNOWN_HOME": unown_home,
        "UNOWN_NO_ENGINE_SERVICE": "1",
        "UNOWN_ENGINE_AUTOSTART": "0",
        "UNOWN_NO_SPLASH": "1",
        "AGNES_API_KEY": os.environ.get("AGNES_API_KEY", ""),
        "BRIDGE_UPSTREAM_KEY": os.environ.get("BRIDGE_UPSTREAM_KEY", ""),
    }
    return home, cwd, env


def main() -> int:
    home, cwd, env = fresh_env()
    u = UnownPty(log, cwd=cwd, env_extra=env)
    try:
        u.wait_for(["First run"], mode="any", timeout=240, desc="gate")
        u.send("\r", delay=0.5)
        u.wait_ready(timeout=240)
        u.wait_idle(timeout=40)
        try:
            dismiss_first_flights(u, log)
        except Exception as exc:  # noqa: BLE001
            log(f"flights dismiss: {exc}")
        u.wait_idle(timeout=30)

        # ---- P1: clean /help ----
        u.type_prompt("/help")
        try:
            u.wait_for(["Commands"], timeout=25, desc="P1 help card")
        except Exception:
            u.wait_idle(timeout=25)
        records.append(u.still("P1-clean-help", ["help"], mode="any"))
        u.key("Esc", delay=0.3)
        u.pump(0.5)
        u.wait_idle(timeout=30)

        # ---- P2: popup-Esc leftover then 'help' ----
        u.send("/", delay=0.6)          # popup opens, editor holds '/'
        u.pump(0.8)
        u.key("Esc", delay=0.3)         # popup closes; '/' must SURVIVE
        u.pump(0.5)
        records.append(u.still("P2-leftover-slash", ["/"], mode="any"))
        u.type_prompt("help")           # editor: '/help'
        try:
            u.wait_for(["Commands"], timeout=25, desc="P2 help card")
        except Exception:
            u.wait_idle(timeout=25)
        records.append(u.still("P2-leftover-help-card", ["help"], mode="any"))
        u.key("Esc", delay=0.3)
        u.pump(0.5)
        u.wait_idle(timeout=30)

        # ---- P3: '//help' escape hatch ----
        u.type_prompt("//help")
        try:
            u.wait_for(["» //help"], timeout=30, desc="P3 echo")
        except Exception:
            u.wait_idle(timeout=30)
        u.wait_idle(timeout=45)
        records.append(u.still("P3-double-slash-escape", ["help"], mode="any"))
    finally:
        u.close()

    print_summary(SCRIPT, records)
    return 0 if all(r.ok for r in records) else 1


if __name__ == "__main__":
    sys.exit(main())
