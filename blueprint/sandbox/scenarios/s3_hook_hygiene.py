"""S3 — PostToolUse hygiene + Stop-hook session scribe (mechanism 5)."""
import json
import time
from pathlib import Path

NAME = "hook-hygiene"
DESCRIPTION = "PostToolUse logs/formats edits; Stop hook writes redacted session notes"

POST = ".claude/hooks/post_tool_use.py"
STOP = ".claude/hooks/stop.py"
FAKE_PAT = "github_" + "pat_SBX0" + "0EXAMPLE" + "TOKEN000111222333444"

UGLY_PY = '''import sys,os
def  add( a,b ):
        return a+b
x=add(1,  2 )
print( x )
'''


def run(ctx):
    # -- Part A: an Edit event flows through PostToolUse -------------------
    demo_py = ctx.repo / "ugly_demo.py"
    demo_py.write_text(UGLY_PY)
    payload = json.dumps({"tool_name": "Edit",
                          "tool_input": {"file_path": str(demo_py),
                                         "old_string": "import sys,os",
                                         "new_string": "import os, sys"}})
    proc = ctx.sh([ctx.py, POST], cwd=ctx.repo, input=payload)
    assert proc.returncode == 0, f"post_tool_use exited {proc.returncode}"

    usage_log = ctx.repo / "unown" / "logs" / "usage.jsonl"
    assert usage_log.is_file(), "PostToolUse wrote no usage log"
    rows = [json.loads(ln) for ln in usage_log.read_text().splitlines() if ln.strip()]
    last = rows[-1]
    assert last["event"] == "PostToolUse" and last["tool"] == "Edit"
    assert last["file"].endswith("ugly_demo.py"), \
        f"usage log lost the edited path: {last['file']}"
    # format column records what happened ('-' when no formatter installed);
    # either way the hook must NOT have blocked or crashed.
    assert last.get("format") in ("-", "") or ":" in str(last.get("format")), \
        f"odd format marker: {last.get('format')}"

    # -- Part B: Stop hook transcribes a session into dreams/sessions/ -----
    sess_dir = ctx.repo / "dreams" / "sessions"
    before = set(p.name for p in sess_dir.glob("*.md"))
    tx = ctx.rt / "transcript-sample.jsonl"
    goal = f"Ship the billing refactor but never echo {FAKE_PAT} anywhere."
    lines = [
        json.dumps({"type": "user",
                    "message": {"role": "user", "content": goal}}),
        json.dumps({"type": "assistant",
                    "message": {"role": "assistant", "content": [
                        {"type": "tool_use", "name": "Read"},
                        {"type": "tool_use", "name": "Edit"},
                        {"type": "text",
                         "text": "Refactor staged; tests green."}]}}),
    ]
    tx.write_text("\n".join(lines))
    payload = json.dumps({"session_id": "sbx-demo-42",
                          "transcript_path": str(tx)})
    proc = ctx.sh([ctx.py, STOP], cwd=ctx.repo, input=payload)
    assert proc.returncode == 0, f"stop hook exited {proc.returncode}"

    time.sleep(0.02)  # mtime granularity guard
    new_notes = [p for p in sess_dir.glob("*.md") if p.name not in before]
    assert new_notes, "Stop hook produced no session note"
    note = max(new_notes, key=lambda p: p.stat().st_mtime)
    body = note.read_text()
    assert "billing refactor" in body, "session note lost the session goal"
    assert FAKE_PAT not in body, "RAW SECRET leaked into the session note!"
    assert "<redacted>" in body, "goal text missing redaction marker"
    assert "- Read:" in body and "- Edit:" in body, "tool stats not recorded"

    return ("edit logged+formatter-plan executed; scribe note "
            f"{note.name[:32]}… redacts secrets")
