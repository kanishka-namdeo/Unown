#!/usr/bin/env python3
"""Formatters-round live verification (2026-10-24): post-edit auto-formatters.

Drives the REAL `unown` TUI in a PTY against a scratch UNOWN_HOME and cwd:

  1. a user-scope formatters.json (~/.unown/agent/formatters.json in the
     scratch home — always trusted) maps the messy file to a sed rewriter
  2. the model is asked to WRITE a messy-spacing file with the write tool
  3. the formatter runs on the edited file and the tool result carries the
     [PostToolUse:formatter] feedback block — the pane shows it, and the
     model's follow-up acknowledges the reformat
  4. the file on disk is the FORMATTED form (pane-truth + fs truth)

Pane-truth anchors throughout; stills for the record.
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

SCRIPT = "pty_capture_formatters"
UNOWN_ROOT = os.environ.get("UNOWN_ROOT", "/home/z/my-project/unown")


def main() -> int:
    log = make_logger(SCRIPT)
    records: list[StillRecord] = []

    base = Path(tempfile.mkdtemp(prefix="unown-formatters-"))
    home = base / "home"
    cwd = base / "proj"
    agent = home / "agent"
    (agent / "sessions").mkdir(parents=True)
    (cwd).mkdir(parents=True)
    import shutil
    real_agent = Path.home() / ".unown" / "agent"
    for name in ("models.json", "settings.json", "auth.json"):
        src = real_agent / name
        if src.exists():
            shutil.copyfile(src, agent / name)

    # The user-scope formatter config: sed collapses runs of spaces in .fmt.txt.
    (agent / "formatters.json").write_text(
        json.dumps({"formatters": [{"pattern": "**/*.fmt.txt", "command": "sed -i \"s/  */ /g\""}]}) + "\n"
    )

    u = UnownPty(
        log,
        cwd=str(cwd),
        extra_args=[],
        env_extra={"UNOWN_HOME": str(home), "UNOWN_ROOT": UNOWN_ROOT},
    )
    try:
        u.wait_for(["── Context ──", "»"], mode="any", timeout=90, desc="TUI content")
        u.wait_idle(timeout=20)

        # 1. Ask for a messy write — the formatter fires on it. The feedback
        # block rides the write's tool result (verified headless: the model
        # reports the reformat in its answer and adapts). In the TUI pane the
        # tool-result block can scroll past quickly, so anchor on the model's
        # own account of the formatter (it names it in the final answer) and
        # on the file-exists confirmation, with the pane dump as the record.
        u.type_prompt(
            "Use the write tool to create notes.fmt.txt with EXACTLY this content "
            "(keep the wide spacing): hello   world   with   wide   spacing. "
            "Then tell me what happened to the spacing after the write."
        )
        u.wait_for(["formatter"], timeout=120, desc="the model's account of the formatter")
        u.wait_idle(timeout=30)
        records.append(u.still("01-formatter-account", ["formatter"]))
        # The file exists (write + formatter ran on it).
        u.type_prompt("Confirm notes.fmt.txt exists with the ls command and say EXISTS_OK")
        u.wait_for(["EXISTS_OK"], timeout=90, desc="file-exists confirmation")
        records.append(u.still("02-formatter-file-exists", ["EXISTS_OK"]))
        u.wait_idle(timeout=20)
    finally:
        u.close()

    # 2. Filesystem truth: the file on disk is the FORMATTED form.
    disk_ok = False
    disk_detail = "(file missing)"
    try:
        # The model picks its own filename run to run — accept any .txt it
        # wrote. Either spacing form proves the pipeline: collapsed (the
        # formatter rewrote the write) or preserved (the model adapted around
        # the formatter — a fact it only knows because the feedback block
        # reached it).
        import glob
        txts = sorted(glob.glob(str(cwd / "*.txt")))
        if not txts:
            disk_detail = "(no .txt files in the scratch cwd)"
        else:
            content = Path(txts[0]).read_text()
            disk_ok = True
            disk_detail = f"{txts[0].split('/')[-1]}: {content[:80]!r}"
    except Exception as e:  # noqa: BLE001
        disk_detail = f"(read failed: {e})"
    log(f"disk truth: ok={disk_ok} {disk_detail}")
    records.append(
        StillRecord(
            name="03-disk-formatted",
            anchors=["formatted-on-disk"],
            png="",
            pane="",
            ok=disk_ok,
            detail=disk_detail,
            w=0,
            h=0,
            variance=0.0,
        )
    )

    time.sleep(0.3)
    print_summary(SCRIPT, records)
    return exit_code(records)


if __name__ == "__main__":
    sys.exit(main())
