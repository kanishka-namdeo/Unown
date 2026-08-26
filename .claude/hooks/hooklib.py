#!/usr/bin/env python3
"""Shared helpers for Unown hook scripts.

Design rules (enforced by repo convention):
- Stdlib only.
- Fail open: helpers never raise out of a hook; callers exit 0 with warnings.
- Never log raw secrets: redact token-shaped strings before writing anywhere.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Token shapes worth redacting before anything touches disk:
# GitHub fine-grained/classic PATs, Anthropic keys, OpenAI keys, AWS-ish ids.
SECRET_PATTERNS = [
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"sk-ant-[A-Za-z0-9_\-]{20,}"),
    re.compile(r"sk-[A-Za-z0-9]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
]

REDACTED = "<redacted>"


def redact(text: str) -> str:
    """Replace token-shaped secrets with <redacted>."""
    out = text or ""
    for pat in SECRET_PATTERNS:
        out = pat.sub(REDACTED, out)
    return out


def read_hook_input() -> dict:
    """Read the JSON payload Claude Code pipes into a hook's stdin."""
    try:
        raw = sys.stdin.read() or "{}"
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def emit(payload: dict) -> None:
    """Print a JSON hook response (only honored on exit 0)."""
    json.dump(payload, sys.stdout)


def project_dir() -> Path:
    """Resolve the project root: $CLAUDE_PROJECT_DIR or cwd's git root fallback."""
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env and Path(env).is_dir():
        return Path(env)
    cwd = Path.cwd()
    walker = cwd
    while True:
        if (walker / ".git").exists():
            return walker
        if walker.parent == walker:
            return cwd  # no git root found; use cwd
        walker = walker.parent


def logs_dir() -> Path:
    d = project_dir() / "unown" / "logs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def append_log(name: str, record: dict) -> None:
    """Append a JSONL audit line under unown/logs/, secrets redacted."""
    try:
        path = logs_dir() / name
        record = {k: redact(str(v))[:2000] for k, v in record.items()}
        record["ts"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
    except Exception:
        pass  # logging must never break a hook


def utc_now_compact() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def safe_slug(text: str, max_len: int = 40) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", text or "").strip("-").lower()
    return (slug[:max_len] or "session")
