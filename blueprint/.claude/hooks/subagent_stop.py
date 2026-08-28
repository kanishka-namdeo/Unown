#!/usr/bin/env python3
"""SubagentStop hook — same scribe behaviour as Stop, tagged as subagent run.

Subagent transcripts flow into the same dreams/sessions/ directory so the
nightly auto-dreamer sees what delegated work discovered, not just what the
main loop did.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from hooklib import append_log, project_dir, read_hook_input, redact, safe_slug, utc_now_compact  # noqa: E402


def main() -> int:
    inp = read_hook_input()
    session_id = str(inp.get("session_id", "unknown"))[:16]
    transcript = str(inp.get("transcript_path", ""))
    agent = str(inp.get("agent_type") or inp.get("agent_id") or "subagent")

    stamp = utc_now_compact()
    root = project_dir()
    note_path = root / "dreams" / "sessions" / f"{stamp}-sub-{safe_slug(agent)}.md"

    last_output = ""
    try:
        raw = Path(transcript).read_text(encoding="utf-8", errors="ignore")
        lines = [ln for ln in raw.splitlines() if ln.strip()]
        if lines:
            rec = json.loads(lines[-1])
            msg = rec.get("message") or {}
            content = msg.get("content")
            if isinstance(content, list):
                last_output = " ".join(
                    c.get("text", "") for c in content if isinstance(c, dict)
                ).strip()[:500]
            elif isinstance(content, str):
                last_output = content.strip()[:500]
    except Exception:
        pass

    body = [
        f"# Subagent note {stamp} ({agent})",
        "",
        f"- session_id: `{session_id}`",
        "- origin: SubagentStop",
        "",
        "## Final output",
        redact(last_output) or "(none parsed)",
        "",
    ]
    try:
        note_path.parent.mkdir(parents=True, exist_ok=True)
        note_path.write_text("\n".join(body), encoding="utf-8")
        print(f"[Unown] subagent note written: {note_path.name}")
    except Exception as exc:
        print(f"[Unown] could not write subagent note: {exc}", file=sys.stderr)

    append_log("sessions.jsonl", {
        "event": "SubagentStop",
        "agent": agent,
        "note": str(note_path.name),
    })
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"[Unown] subagent_stop hook warning: {exc}", file=sys.stderr)
        sys.exit(0)
