#!/usr/bin/env python3
"""Trust-round live verification (2026-10-24): --permission-mode + --add-dir.

Drives the REAL `unown` TUI in a PTY and functionally verifies the two
Milestone-1 features the way a user would hit them:

  1. `--permission-mode acceptEdits --add-dir <dir>` at launch
  2. `/permissions` status shows the session override + the additional dir
  3. `/permissions mode` (bare) reports current mode + usage
  4. `/permissions mode bypassPermissions` switches live (notify lands)
  5. `/add-dir` (bare) lists the granted root
  6. `/add-dir clear` revokes, `/permissions` shows "additional dirs: none"
  7. `/permissions mode reset` drops the override back to the config mode

Every step anchors on literal pane text (pane-truth discipline); stills are
captured for the record. No model turn is needed — pure surface checks.
"""
from __future__ import annotations

import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pty_common import UnownPty, exit_code, make_logger, print_summary  # noqa: E402
from pty_common import StillRecord  # noqa: E402

SCRIPT = "pty_capture_trust"

UNOWN_ROOT = os.environ.get("UNOWN_ROOT", "/home/z/my-project/Unown")


def main() -> int:
    log = make_logger(SCRIPT)
    records: list[StillRecord] = []

    # The added working directory lives beside the smoke project.
    extra = tempfile.mkdtemp(prefix="unown-add-dir-")
    # A scratch cwd so the session does not boot inside the repo itself.
    cwd = tempfile.mkdtemp(prefix="unown-trust-cwd-")

    u = UnownPty(
        log,
        cwd=cwd,
        extra_args=["--permission-mode", "acceptEdits", "--add-dir", extra],
        env_extra={"UNOWN_ROOT": UNOWN_ROOT},
    )
    try:
        u.wait_ready()
        u.wait_idle(timeout=30)

        # 2. /permissions shows the session override + the granted dir.
        u.type_prompt("/permissions")
        u.wait_for(["session override"], timeout=20, desc="session override marker")
        u.wait_for([os.path.basename(extra)], timeout=10, desc="added dir listing")
        records.append(u.still("01-trust-permissions-status", ["mode: acceptEdits", "additional dirs (1)"]))

        # 3. Bare mode query.
        u.type_prompt("/permissions mode")
        u.wait_for(["current mode: acceptEdits"], timeout=20, desc="bare mode query")
        u.wait_for(["usage: /permissions mode"], timeout=10, desc="mode usage line")
        records.append(u.still("02-trust-mode-query", ["current mode: acceptEdits"]))

        # 4. Live switch to bypassPermissions.
        u.type_prompt("/permissions mode bypassPermissions")
        u.wait_for(["mode → bypassPermissions"], timeout=20, desc="bypass switch notify")
        records.append(u.still("03-trust-mode-bypass", ["bypassPermissions"]))

        # 5. /add-dir bare list.
        u.type_prompt("/add-dir")
        u.wait_for([f"additional working directories (1)"], timeout=20, desc="add-dir listing")
        u.wait_for([extra], timeout=10, desc="add-dir path")
        records.append(u.still("04-trust-add-dir-list", ["(1)"]))

        # 6. Clear + verify none.
        u.type_prompt("/add-dir clear")
        u.wait_for(["cleared"], timeout=20, desc="add-dir clear notify")
        u.type_prompt("/permissions")
        u.wait_for(["additional dirs: none"], timeout=20, desc="additional dirs none")
        records.append(u.still("05-trust-add-dir-cleared", ["additional dirs: none"]))

        # 7. Reset back to the config files' mode.
        u.type_prompt("/permissions mode reset")
        u.wait_for(["config files' mode"], timeout=20, desc="mode reset notify")
        records.append(u.still("06-trust-mode-reset", ["reset"]))
    finally:
        u.close()

    time.sleep(0.3)
    print_summary(SCRIPT, records)
    return exit_code(records)


if __name__ == "__main__":
    sys.exit(main())
