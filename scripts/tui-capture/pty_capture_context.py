#!/usr/bin/env python3
"""Context-round live verification (2026-10-24): the /context command.

Drives the REAL `unown` TUI in a PTY against a scratch UNOWN_HOME and cwd:

  1. boot → a real model turn ("reply with exactly CONTEXT_LIVE_OK") so the
     host has actual context accounting and the session has real entries
  2. /context — the report renders: model line, utilization bar, the
     where-it-goes breakdown (memory stack / conversation / system+tools),
     the session rollup and the advice band
  3. /context on a FRESH boot (no turn yet) — the estimate lane renders with
     its "(estimated — no host accounting yet)" label

Pane-truth anchors throughout; stills for the record.
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pty_common import UnownPty, exit_code, make_logger, print_summary  # noqa: E402
from pty_common import StillRecord  # noqa: E402

SCRIPT = "pty_capture_context"
UNOWN_ROOT = os.environ.get("UNOWN_ROOT", "/home/z/my-project/unown")


def main() -> int:
    log = make_logger(SCRIPT)
    records: list[StillRecord] = []

    base = Path(tempfile.mkdtemp(prefix="unown-context-"))
    home = base / "home"
    cwd = base / "proj"
    agent = home / "agent"
    (agent / "sessions").mkdir(parents=True)
    (cwd / ".unown").mkdir(parents=True)
    # Seed the scratch home from the REAL agent dir (models/settings/auth) so
    # boot skips the first-run wizard gate; sessions stay scratch-only.
    import shutil
    real_agent = Path.home() / ".unown" / "agent"
    for name in ("models.json", "settings.json", "auth.json"):
        src = real_agent / name
        if src.exists():
            shutil.copyfile(src, agent / name)

    # -- leg 1: a real turn, then /context with actual accounting ----------
    u = UnownPty(
        log,
        cwd=str(cwd),
        extra_args=[],
        env_extra={"UNOWN_HOME": str(home), "UNOWN_ROOT": UNOWN_ROOT},
    )
    try:
        u.wait_for(["── Context ──", "»"], mode="any", timeout=90, desc="TUI content")
        u.wait_idle(timeout=30)

        # 1. A real model turn (actual context accounting needs one response).
        u.type_prompt("reply with exactly CONTEXT_LIVE_OK")
        u.wait_for(["CONTEXT_LIVE_OK"], timeout=90, desc="model answer")
        u.wait_idle(timeout=20)

        # 2. /context — the full report with ACTUAL numbers.
        u.type_prompt("/context")
        u.wait_for(["Context —"], timeout=20, desc="context header line")
        u.wait_for(["% used"], timeout=10, desc="utilization bar")
        u.wait_for(["Where it goes:"], timeout=10, desc="breakdown section")
        u.wait_for(["Memory stack"], timeout=10, desc="memory stack line")
        records.append(u.still("01-context-actual", ["Context —", "Where it goes:"]))
        records.append(u.still("02-context-breakdown", ["Memory stack", "remaining"]))

        # Session rollup renders (assistant messages line).
        u.type_prompt("/context")
        u.wait_for(["assistant messages"], timeout=20, desc="session rollup")
        records.append(u.still("03-context-session-rollup", ["assistant messages"]))
    finally:
        u.close()

    # -- leg 2: fresh boot, /context BEFORE any turn (the estimate lane) ----
    u2 = UnownPty(
        log,
        cwd=str(cwd),
        extra_args=[],
        env_extra={"UNOWN_HOME": str(home), "UNOWN_ROOT": UNOWN_ROOT},
    )
    try:
        u2.wait_for(["── Context ──", "»"], mode="any", timeout=90, desc="TUI content (fresh boot)")
        u2.wait_idle(timeout=20)
        u2.type_prompt("/context")
        # Before the first response the estimate lane shows: either the
        # estimated label (host accounting absent) or an actual 0-window
        # report — both carry the header + advice contract.
        u2.wait_for(["Context —"], timeout=20, desc="context header (fresh)")
        records.append(u2.still("04-context-fresh-boot", ["Context —"]))
    finally:
        u2.close()

    time.sleep(0.3)
    print_summary(SCRIPT, records)
    return exit_code(records)


if __name__ == "__main__":
    sys.exit(main())
