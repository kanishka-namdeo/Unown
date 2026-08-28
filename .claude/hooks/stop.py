#!/usr/bin/env python3
"""Stop hook — the scribe. Writes a session note for the dreaming pipeline.

Reads the Stop-event JSON from stdin (session_id, transcript_path, ...),
extracts a light-weight summary from the transcript (first user goal,
tool stats, last assistant line), redacts secrets, and appends one note per
session to dreams/sessions/<UTC>-<slug>.md.

Notes are the raw input to `dreams/dream.py`, which consolidates them.
This hook never blocks: always exit 0 (an exit 2 here would force Claude
to keep working — deliberately not what we want at session end).
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from hooklib import append_log, project_dir, read_hook_input, redact, safe_slug, utc_now_compact  # noqa: E402


def parse_transcript(path_str: str) -> dict:
    """Transcripts are JSONL of message records; pull out cheap signals."""
    goals: list[str] = []
    tools: Counter[str] = Counter()
    last_line = ""
    try:
        raw = Path(path_str).read_text(encoding="utf-8", errors="ignore")
        for line in raw.splitlines():
            try:
                rec = json.loads(line)
            except Exception:
                continue
            msg = rec.get("message") or {}
            role = rec.get("type") or msg.get("role")
            content = msg.get("content")
            if role in ("user", "human"):
                text = ""
                if isinstance(content, str):
                    text = content
                elif isinstance(content, list):
                    text = " ".join(
                        c.get("text", "") for c in content if isinstance(c, dict)
                    )
                text = text.strip()
                if text and not text.startswith(("<", "[", "Caveat")):
                    goals.append(redact(text[:220]))
            elif role in ("assistant",) and isinstance(content, list):
                for c in content:
                    if isinstance(c, dict):
                        name = c.get("name")
                        if c.get("type") == "tool_use" and name:
                            tools[str(name)] += 1
                        if c.get("type") == "text" and c.get("text", "").strip():
                            last_line = redact(c["text"].strip()[:300])
    except Exception:
        pass
    return {"goals": goals[:5], "tools": dict(tools), "last_line": last_line}


def main() -> int:
    inp = read_hook_input()
    session_id = str(inp.get("session_id", "unknown"))[:16]
    transcript = str(inp.get("transcript_path", ""))
    root = project_dir()

    signals = parse_transcript(transcript) if transcript else {}
    stamp = utc_now_compact()
    slug = safe_slug(signals["goals"][0] if signals.get("goals") else session_id)
    note_path = root / "dreams" / "sessions" / f"{stamp}-{slug}.md"

    body = [
        f"# Session note {stamp}",
        "",
        f"- session_id: `{session_id}`",
        f"- transcript: `{transcript or 'n/a'}`",
        "",
        "## Goals observed",
    ]
    body += [f"- {g}" for g in signals.get("goals", [])] or ["- (none parsed)"]
    body += ["", "## Tool usage"]
    tool_counts = signals.get("tools") or {}
    body += [f"- {k}: {v}" for k, v in sorted(tool_counts.items())] or ["- (none)"]
    body += ["", "## Last assistant output"]
    body += [signals.get("last_line") or "(none)", ""]

    try:
        note_path.parent.mkdir(parents=True, exist_ok=True)
        note_path.write_text("\n".join(body), encoding="utf-8")
        print(f"[Unown] session note written: {note_path.name}")
    except Exception as exc:
        print(f"[Unown] could not write session note: {exc}", file=sys.stderr)

    append_log("sessions.jsonl", {
        "event": "Stop",
        "session_id": session_id,
        "note": str(note_path.name),
        "tools": json.dumps(tool_counts)[:300],
    })
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"[Unown] stop hook warning: {exc}", file=sys.stderr)
        sys.exit(0)
