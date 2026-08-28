#!/usr/bin/env python3
"""UserPromptSubmit hook — inject orientation context into every prompt.

Stdout on exit 0 is added to Claude's context for this turn. We keep it tiny:
current UTC time, repo state hint, and a reminder when the prompt looks like
it embeds token-shaped secrets (defence-in-depth hygiene).
"""
from __future__ import annotations

import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from hooklib import append_log, project_dir, read_hook_input, redact  # noqa: E402

SECRET_HINT = re.compile(r"(github_pat_|gh[pousr]_|sk-ant-|AKIA)")


def git_dirty(root: Path) -> bool:
    try:
        out = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=5,
        )
        return bool(out.stdout.strip())
    except Exception:
        return False


def main() -> int:
    inp = read_hook_input()
    prompt = redact(str(inp.get("prompt", "")))
    root = project_dir()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    notes = sorted((root / "dreams" / "sessions").glob("*.md"))
    ctx = [
        f"[Unown] turn started {now}; working tree dirty={git_dirty(root)}; "
        f"dream-notes pending consolidation={len(notes)}",
    ]
    if SECRET_HINT.search(inp.get("prompt", "") or ""):
        ctx.append(
            "[Unown] WARNING: pasted text contains a token-shaped secret. "
            "Never echo, store, or commit it; advise rotating immediately."
        )
    print("\n".join(ctx))
    append_log("prompts.jsonl", {"event": "UserPromptSubmit",
                                 "prompt": prompt[:400], "secret_hint":
                                 bool(SECRET_HINT.search(inp.get("prompt", "") or ""))})
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"[Unown] user_prompt_submit hook warning: {exc}", file=sys.stderr)
        sys.exit(0)
