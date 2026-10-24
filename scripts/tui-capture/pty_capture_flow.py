#!/usr/bin/env python3
"""Flow-round live verification (2026-10-24): --continue/--resume + project settings.

Drives the REAL `unown` TUI in a PTY against a scratch UNOWN_HOME and cwd:

  1. `--resume <name>` boots INTO the named session (continuation proven by
     /session stats: the resumed session's message count > 0 and its id)
  2. /project-settings on an UNTRUSTED .unown/settings.json — status shows
     UNTRUSTED + keys ignored
  3. /project-settings trust — approves (fingerprint recorded)
  4. /project-settings after trust — trusted + the pinned keys render

Pane-truth anchors throughout; stills for the record. No model turn needed
beyond the resumed session's existing history (the /session + /project-settings
commands are local renders).
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pty_common import UnownPty, exit_code, make_logger, print_summary  # noqa: E402
from pty_common import StillRecord  # noqa: E402

SCRIPT = "pty_capture_flow"
UNOWN_ROOT = os.environ.get("UNOWN_ROOT", "/home/z/my-project/Unown")


def main() -> int:
    log = make_logger(SCRIPT)
    records: list[StillRecord] = []

    base = Path(tempfile.mkdtemp(prefix="unown-flow-"))
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

    # A named session fixture in the scratch agent dir (the resume target).
    sid = "01234567-89ab-cdef-0123-456789abcdef"
    session_file = home / "agent" / "sessions" / f"2026-01-01T00-00-00-000Z_{sid}.jsonl"
    entries = [
        {"type": "session", "version": 3, "id": sid, "timestamp": "2026-01-01T00:00:00.000Z", "cwd": str(cwd)},
        {"type": "session_info", "id": "n1", "parentId": None, "timestamp": "2026-01-01T00:00:01.000Z", "name": "landing page copy session"},
        {"type": "message", "id": "m1", "parentId": "n1", "timestamp": "2026-01-01T00:00:02.000Z",
         "message": {"role": "user", "content": "remember the magic word UNICORN-42"}},
        {"type": "message", "id": "m2", "parentId": "m1", "timestamp": "2026-01-01T00:00:03.000Z",
         "message": {"role": "assistant", "content": [{"type": "text", "text": "Noted."}]}},
    ]
    session_file.write_text("\n".join(json.dumps(e) for e in entries) + "\n")

    # The untrusted project settings file.
    (cwd / ".unown" / "settings.json").write_text(json.dumps({"model": "agnes-2.5-flash", "addDirs": ["../shared"]}) + "\n")

    u = UnownPty(
        log,
        cwd=str(cwd),
        extra_args=["--resume", "landing"],
        env_extra={"UNOWN_HOME": str(home), "UNOWN_ROOT": UNOWN_ROOT},
    )
    try:
        # The resumed session boots with the memory-injection startup panel,
        # which scrolls the version header past the 36-row pane quickly —
        # anchor on the stable content instead (the Context box / editor).
        u.wait_for(["── Context ──", "»"], mode="any", timeout=90, desc="TUI content")
        u.wait_idle(timeout=30)

        # 1. Resumed INTO the named session — /session proves it (name + stats).
        u.type_prompt("/session")
        u.wait_for(["landing page copy session"], timeout=20, desc="resumed session name")
        records.append(u.still("01-flow-resumed-session", ["landing page copy session"]))

        # 2. Untrusted project settings.
        u.type_prompt("/project-settings")
        u.wait_for(["UNTRUSTED"], timeout=20, desc="untrusted status")
        u.wait_for(["/project-settings trust"], timeout=10, desc="approve hint")
        records.append(u.still("02-flow-settings-untrusted", ["UNTRUSTED"]))

        # 3. Approve.
        u.type_prompt("/project-settings trust")
        u.wait_for(["trusted"], timeout=20, desc="trust notify")
        records.append(u.still("03-flow-settings-trusted", ["trusted"]))

        # 4. Status now shows the pinned keys.
        u.type_prompt("/project-settings")
        u.wait_for(["model: agnes-2.5-flash"], timeout=20, desc="pinned model renders")
        u.wait_for(["addDirs: ../shared"], timeout=10, desc="addDirs render")
        records.append(u.still("04-flow-settings-keys", ["model: agnes-2.5-flash"]))
    finally:
        u.close()

    time.sleep(0.3)
    print_summary(SCRIPT, records)
    return exit_code(records)


if __name__ == "__main__":
    sys.exit(main())
