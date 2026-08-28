#!/usr/bin/env python3
"""PostToolUse hook — auto-format, lint, audit-log after Write/Edit/Bash.

PostToolUse cannot undo execution, so its job is hygiene, not safety:
1. Best-effort format of the file Claude just touched (ruff/black/prettier/
   gofmt depending on extension and availability). Never installs anything;
   skips silently when no formatter exists.
2. Appends a usage line to unown/logs/usage.jsonl for later mining by the
   self-improving harness (token/time signals come from transcripts instead).
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from hooklib import append_log, read_hook_input, redact  # noqa: E402


def formatters_for(path: Path) -> list[list[str]]:
    ext = path.suffix.lower()
    plan: list[list[str]] = []
    has = shutil.which
    if ext == ".py":
        if has("ruff"):
            plan.append(["ruff", "format", "--quiet", str(path)])
        elif has("black"):
            plan.append(["black", "--quiet", str(path)])
        if has("ruff"):
            plan.append(["ruff", "check", "--fix", "--quiet", str(path)])
    elif ext in (".js", ".jsx", ".ts", ".tsx", ".json", ".md", ".yml", ".yaml"):
        if has("prettier"):
            plan.append(["prettier", "--write", "--log-level", "error", str(path)])
    elif ext == ".go":
        if has("gofmt"):
            plan.append(["gofmt", "-w", str(path)])
    return plan


def run_format(path_str: str) -> str:
    try:
        path = Path(path_str)
    except Exception:
        return ""
    if not path.is_file():
        return ""
    cmds = formatters_for(path)
    notes = []
    for cmd in cmds:
        try:
            proc = subprocess.run(
                cmd,
                cwd=str(Path(__file__).resolve().parent.parent.parent),
                capture_output=True,
                text=True,
                timeout=25,
            )
            notes.append(f"{cmd[0]}:{'ok' if proc.returncode == 0 else 'skip'}")
        except Exception:
            notes.append(f"{cmd[0]}:err")
    return ",".join(notes)


def main() -> int:
    inp = read_hook_input()
    tool_name = str(inp.get("tool_name", ""))
    tool_input = inp.get("tool_input") or {}
    file_path = ""
    if tool_name in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
        file_path = str(tool_input.get("file_path", "") or "")
    fmt_note = run_format(file_path) if file_path else ""

    append_log("usage.jsonl", {
        "event": "PostToolUse",
        "tool": tool_name,
        "file": file_path,
        "format": fmt_note or "-",
    })

    # Optional gentle feedback to Claude: stdout shows in transcript mode only.
    if fmt_note and any(x.endswith("err") for x in fmt_note.split(",")):
        print(f"[Unown] formatter partially unavailable ({fmt_note}) — "
              "continuing without blocking.", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # fail open
        print(f"[Unown] post_tool_use hook warning: {exc}", file=sys.stderr)
        sys.exit(0)
