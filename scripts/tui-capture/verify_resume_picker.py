#!/usr/bin/env python3
"""
verify_resume_picker.py — the sessions round's /resume picker verification
(PTY lane): the in-session /resume picker must show BOTH stores — the user
lane (~/.unown/agent/sessions) AND this project's import lane
(<cwd>/.unown/sessions) — exactly like the launch picker, `--continue`,
`--resume <query>` and `sessions list` already do.

Flow:
  1. PTY boot in a fresh cwd, one short turn, /quit  → user-lane session A
  2. `unown sessions export A` + `unown sessions import` → import-lane session B
  3. PTY boot again, /resume → the picker must list BOTH A and B
  4. Esc out of the picker, /quit

Exit 0 = both sessions visible in the in-session picker.
"""

from __future__ import annotations

import glob
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import UnownPty, make_logger  # noqa: E402

UNOWN_BIN = os.environ.get("UNOWN_BIN", "/home/z/my-project/Unown/bin/unown")
WORK_DIR = "/tmp/unown-picker-verify"

log = make_logger("verify-resume-picker")


def say(msg: str) -> None:
    log(msg)


def fail(msg: str, pane: list[str]) -> None:
    say(f"FAIL: {msg}")
    say("--- pane tail ---")
    for line in pane[-24:]:
        say(f"    {line}")
    sys.exit(1)


def sessions_for_cwd(cwd: str, store: str) -> list[dict]:
    out = []
    if store == "user":
        d = os.path.expanduser("~/.unown/agent/sessions")
    else:
        d = os.path.join(cwd, ".unown", "sessions")
    for f in sorted(glob.glob(os.path.join(d, "*.jsonl")), key=os.path.getmtime):
        try:
            with open(f, "r", encoding="utf-8", errors="replace") as fh:
                header = json.loads(fh.readline())
            if header.get("cwd") == cwd:
                out.append({"file": f, "id": header.get("id", "")})
        except Exception:
            continue
    return out


def main() -> None:
    os.makedirs(WORK_DIR, exist_ok=True)
    # clean slate for THIS cwd in both stores
    for store in ("user", "import"):
        for s in sessions_for_cwd(WORK_DIR, store):
            try:
                os.remove(s["file"])
            except Exception:
                pass

    # 1 — make a real user-lane session
    say("step 1: create a user-lane session (short turn + /quit)")
    s = UnownPty(log, cwd=WORK_DIR, extra_args=[])
    s.wait_ready(timeout=90)
    s.type_prompt("Say the word pineapple and nothing else.")
    s.send("\r")
    try:
        s.wait_for(["pineapple"], timeout=60, mode="any")
    except Exception:
        fail("the first turn did not answer", s.pane())
    time.sleep(1.5)
    s.send("/quit")
    s.send("\r")
    s.close()
    user_sessions = sessions_for_cwd(WORK_DIR, "user")
    if not user_sessions:
        fail("no user-lane session created", [])
    say(f"  user-lane session: {os.path.basename(user_sessions[-1]['file'])}")

    # 2 — export it and import it back (the import lane)
    say("step 2: export + import -> the import lane")
    sid = user_sessions[-1]["id"]
    export_path = os.path.join(WORK_DIR, "session-export.json")
    r = subprocess.run(
        ["bun", UNOWN_BIN, "sessions", "export", sid, "--out", export_path],
        cwd=WORK_DIR, capture_output=True, text=True, timeout=120,
        env={**os.environ, "PATH": os.environ.get("PATH", "")},
    )
    say(f"  export rc={r.returncode} {' '.join(r.stdout.split()[:14])}")
    if r.returncode != 0 or not os.path.exists(export_path):
        fail(f"export failed: {r.stdout} {r.stderr}", [])
    r = subprocess.run(
        ["bun", UNOWN_BIN, "sessions", "import", export_path],
        cwd=WORK_DIR, capture_output=True, text=True, timeout=120,
        env={**os.environ, "PATH": os.environ.get("PATH", "")},
    )
    say(f"  import rc={r.returncode} {' '.join(r.stdout.split()[:14])}")
    import_sessions = sessions_for_cwd(WORK_DIR, "import")
    if not import_sessions:
        fail(f"import failed or landed outside the import lane: {r.stdout} {r.stderr}", [])
    say(f"  import-lane session: {os.path.basename(import_sessions[-1]['file'])}")

    # 3 — boot the TUI again and open /resume: BOTH must be listed
    say("step 3: boot TUI, open /resume, assert BOTH stores are listed")
    s2 = UnownPty(log, cwd=WORK_DIR, extra_args=[])
    s2.wait_ready(timeout=90)
    time.sleep(1)
    s2.send("/resume")
    time.sleep(0.4)
    s2.send("\r")
    # the picker shows entries with first-message previews / names
    try:
        s2.wait_for(["pineapple"], timeout=25, mode="any")
    except Exception:
        fail("the /resume picker did not open or shows nothing", s2.pane())
    pane_text = "\n".join(s2.pane())
    # The picker lists one row per session with the first-message preview.
    # Both stores hold one session for this cwd with the SAME first message
    # ("Say the word pineapple...") → exactly TWO rows carrying the preview
    # proves the union (user lane + import lane) is listed in-session.
    rows = [ln for ln in s2.pane() if "pineapple" in ln.lower() and "say" in ln.lower()]
    sees_import = len(rows) >= 2
    say(f"  picker rows carrying the preview: {len(rows)} (>=2 proves both stores)")
    if len(rows) < 2:
        say("  --- pane ---")
        for line in s2.pane():
            say(f"      {line}")
    try:
        s2.still("05-resume-picker", ["pineapple"], mode="any")
    except Exception as e:
        say(f"still soft-fail: {e}")
    # Esc out of the picker (select modality: editor detaches while open)
    s2.send("\x1b")
    time.sleep(0.6)
    s2.send("\x1b")
    time.sleep(0.6)
    s2.send("/quit")
    time.sleep(0.4)
    s2.send("\r")
    s2.close()
    say("step 3 closed")

    if not sees_import:
        fail("the in-session /resume picker did NOT list the import-lane session", [])
    say("PASS: the /resume picker lists BOTH stores")
    sys.exit(0)


if __name__ == "__main__":
    main()
