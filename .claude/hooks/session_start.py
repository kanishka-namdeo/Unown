#!/usr/bin/env python3
"""SessionStart hook — report the effective tiered-memory stack.

Per Claude Code docs, stdout on exit 0 for SessionStart is added to the
session context. We use that to make memory tiers visible to the agent and
the human, so "what does Unown remember" is never a mystery.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from hooklib import append_log, project_dir, read_hook_input  # noqa: E402


def find_tiers() -> list[tuple[str, Path]]:
    """Tier order: managed policy -> user -> project -> local."""
    import os

    candidates = [
        ("managed", Path("/etc/claude-code/CLAUDE.md")),
        (
            "managed",
            Path("/Library/Application Support/ClaudeCode/CLAUDE.md"),
        ),
        ("user", Path.home() / ".claude" / "CLAUDE.md"),
        ("project-root", project_dir() / "CLAUDE.md"),
        ("project-dotclaude", project_dir() / ".claude" / "CLAUDE.md"),
        ("local", project_dir() / "CLAUDE.local.md"),
    ]
    found = []
    seen = set()
    for label, path in candidates:
        try:
            if path.is_file() and str(path) not in seen:
                seen.add(str(path))
                size = len(path.read_text(encoding="utf-8", errors="ignore"))
                found.append((f"{label}:{path.name}", path, size))
        except Exception:
            continue
    return [(label, path) for (label, path, _size) in found]


def main() -> int:
    inp = read_hook_input()
    source = inp.get("source", "startup")
    tiers = find_tiers()
    lines = [f"[Unown] session start ({source}) — effective memory stack:"]
    for label, path in tiers:
        lines.append(f"[Unown]   - {label} <- {path}")
    if len(tiers) <= 1:
        lines.append(
            "[Unown]   (thin memory: add guidance to CLAUDE.md so it persists)"
        )
    lines.append(
        "[Unown] hooks active: PreToolUse gate | PostToolUse format+log | "
        "Stop/SubagentStop scribe"
    )
    print("\n".join(lines))
    append_log("sessions.jsonl", {"event": "SessionStart", "source": source,
                                 "tiers": [str(p) for _, p in tiers]})
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # fail open, always exit 0
        print(f"[Unown] session_start hook warning: {exc}", file=sys.stderr)
        sys.exit(0)
