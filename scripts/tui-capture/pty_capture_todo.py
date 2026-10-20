#!/usr/bin/env python3
"""
pty_capture_todo.py — the todo addon OVERLAY, without a fresh model call.

The overlay state rides `unown-todo-state` custom entries in the session
file (todo.ts → replayFromBranch on session_start, entries win over
toolResult details; last valid snapshot wins). This script crafts a session
file whose entries carry a realistic mid-run task graph, then boots the TUI
resuming it (`--session <file>`) so the live panel mounts above the editor
on boot — zero LLM turns needed:

  01-todo-overlay      the live panel above the editor (heading + rows,
                       status glyphs, blockedBy chain, activeForm)
  02-todos-grouped     /todos with live state — the grouped-by-status view
                       (Pending / In Progress / Completed + ⛓ chains)

The crafted session file is kept next to the stills as provenance
(pty-todo-session.jsonl).

Entry shape (todo-core.ts):
  {"type":"custom","customType":"unown-todo-state",
   "data":{"action":..., "params":{}, "tasks":[Task...], "nextId":N},
   "id":..., "parentId":..., "timestamp":...}
Task: {id, subject, description?, activeForm?, status, blockedBy?, ...}.

Usage:
    python3 scripts/tui-capture/pty_capture_todo.py
"""

from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pty_common import (  # noqa: E402
    OUT_DIR,
    UnownPty,
    craft_todo_session,
    exit_code,
    make_logger,
    print_summary,
)

SCRIPT = "pty_capture_todo"
SESSION_FILE = os.path.join(
    os.path.dirname(OUT_DIR.rstrip("/")), "pty-todo-session.jsonl"
)

# A realistic mid-run task graph: one completed, one in flight (with its
# activeForm spinner label), two pending — one of which is blocked by the
# in-flight task (drives the ⛓ chain + #id prefixes in the overlay).
TASKS = [
    {
        "id": 1,
        "subject": "Research existing pagination tools",
        "description": "Survey cursor/offset approaches already in the repo.",
        "status": "completed",
    },
    {
        "id": 2,
        "subject": "Implement cursor-based pagination",
        "description": "Encode the sort key into an opaque cursor.",
        "activeForm": "implementing cursor-based pagination",
        "status": "in_progress",
    },
    {
        "id": 3,
        "subject": "Write tests for edge cases",
        "status": "pending",
        "blockedBy": [2],
    },
    {
        "id": 4,
        "subject": "Document the pagination API",
        "status": "pending",
    },
]
NEXT_ID = 5


def main() -> int:
    log = make_logger(SCRIPT)
    records = []
    cwd = os.environ.get("PTY_CWD", "/home/z/my-project/Unown")
    craft_todo_session(SESSION_FILE, [TASKS], NEXT_ID, cwd=cwd)
    log(f"crafted session: {SESSION_FILE} (4 tasks, nextId={NEXT_ID})")

    s = UnownPty(log, cwd=cwd, extra_args=["--session", SESSION_FILE])
    try:
        s.wait_ready()
        # The overlay mounts on session_start: heading "Todos (1/4)".
        s.wait_for(
            ["Todos (1/4)"],
            timeout=30,
            desc="todo overlay heading",
        )
        time.sleep(0.5)
        s.pump(0.8)
        records.append(
            s.still(
                "01-todo-overlay",
                [
                    "Todos (1/4)",
                    "├─ ✓ #1 Research existing pagination tools",
                    "├─ ◐ #2 Implement cursor-based pagination (implementing cursor-based pagination)",
                    "├─ ○ #3 Write tests for edge cases ⛓ #2",
                    "└─ ○ #4 Document the pagination API",
                ],
            )
        )

        # /todos with live state — grouped by status.
        s.type_prompt("/todos", cps=80)
        s.wait_for(
            ["Todos (1/4 completed · 1 in progress · 2 pending):"],
            timeout=20,
            desc="/todos grouped header",
        )
        time.sleep(0.4)
        s.pump(0.6)
        records.append(
            s.still(
                "02-todos-grouped",
                [
                    "Todos (1/4 completed · 1 in progress · 2 pending):",
                    "── Pending ──",
                    "── In Progress ──",
                    "── Completed ──",
                    "⛓ #2",
                ],
            )
        )
    finally:
        s.close()

    passed, total = print_summary(SCRIPT, records)
    return exit_code(records)


if __name__ == "__main__":
    sys.exit(main())
