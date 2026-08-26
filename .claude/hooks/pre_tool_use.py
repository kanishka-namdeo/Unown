#!/usr/bin/env python3
"""PreToolUse hook — the deterministic gatekeeper.

Reads the standard PreToolUse JSON from stdin (tool_name, tool_input, ...).
Two response channels exist:

1. Exit 0 + JSON with `hookSpecificOutput.permissionDecision`
   ("allow" | "deny" | "ask") — the structured decision path.
2. Exit 2 + stderr — hard block; stderr is fed back to Claude as the reason.

Gate policy (edit freely; keep it boring and auditable):
- Deny destructive filesystem ops that escape the project root
  (rm -rf /, rm -rf ~, targeting system dirs).
- Deny history rewriting and unreviewed remote pushes to protected branches.
- Deny piping curl/wget straight into shell interpreters.
- Flag but do not block anything containing a token-shaped secret.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from hooklib import append_log, redact  # noqa: E402

PROTECTED_REF = re.compile(r"\b(main|master|release[\w\-/]*)\b")

DESTRUCTIVE_FS = [
    re.compile(r"rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b[^|;&]*\s+(\/|~|\$HOME|\.\.)(\s|$)"),
    re.compile(r"rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+\/(etc|usr|var|bin|sbin|lib|boot|dev|proc|sys)\b"),
    re.compile(r">\s*\/dev\/sd[a-z]"),
    re.compile(r"mkfs(\.[a-z0-9]+)?\s"),
    re.compile(r":\(\)\{\s*:\|:\s*&\s*\}\s*;\s*:"),  # fork bomb
]

REMOTE_MUTATION = [
    re.compile(r"\bgit\s+push\s+(-[a-zA-Z]+\s+)*--force\b.*"),
    re.compile(r"\bgit\s+reset\s+--hard\b[^;]*&&.*git\s+push\b"),
]

INTERPRETER_PIPE = [
    re.compile(r"(curl|wget)[^|;]*\|\s*(sudo\s+)?(ba)?sh\b"),
    re.compile(r"(curl|wget)[^|;]*\|\s*python[23]?\b"),
]

SECRET_SHAPE = re.compile(r"(github_pat_|gh[pousr]_|sk-ant-)")


def decide(tool_name: str, tool_input: dict) -> tuple[str, str] | None:
    """Return (decision, reason) if this tool call must be gated, else None."""
    if tool_name == "Bash":
        cmd = str(tool_input.get("command", ""))[:4000]

        for pat in DESTRUCTIVE_FS:
            if pat.search(cmd):
                return ("deny", f"Unown gate: destructive filesystem pattern "
                                f"blocked ({pat.pattern}). Scope deletions inside "
                                f"the workspace and avoid glob-roots.")

        for pat in REMOTE_MUTATION:
            if pat.search(cmd):
                return ("deny", "Unown gate: force-push / hard-reset-to-remote "
                                "detected. Open a branch and let review handle it.")

        for pat in INTERPRETER_PIPE:
            if pat.search(cmd):
                return ("deny", "Unown gate: downloading straight into an "
                                "interpreter is blocked. Inspect scripts before "
                                "executing them.")

        if SECRET_SHAPE.search(cmd):
            return ("ask",
                    "Command embeds a token-shaped secret. Confirm it is not "
                    "being committed or echoed before allowing.")

        return None

    if tool_name in ("Write", "Edit", "MultiEdit"):
        blob = json.dumps(tool_input)[:4000]
        envish = str(tool_input.get("file_path", ""))
        # Inspect raw (pre-redaction) content on purpose: that is the point.
        if SECRET_SHAPE.search(blob):
            return ("deny",
                    "Unown gate: refusing to write token-shaped secrets into "
                    "files. Use environment variables or a secret manager.")
        for banned in ("/etc/claude-code", "~/.claude/settings.json"):
            if banned in envish:
                return ("deny", f"Unown gate: writes to {banned} are restricted "
                                "(tier-1 managed memory / user settings).")
        return None

    return None


def main() -> int:
    inp = {}
    try:
        inp = json.loads(sys.stdin.read() or "{}")
    except Exception:
        pass
    tool_name = str(inp.get("tool_name", ""))
    tool_input = inp.get("tool_input") or {}

    verdict = decide(tool_name, tool_input)
    append_log("toolgate.jsonl", {
        "event": "PreToolUse",
        "tool": tool_name,
        "preview": redact(str(tool_input))[:300],
        "decision": verdict[0] if verdict else "pass",
        "reason": verdict[1][:200] if verdict else "",
    })

    if not verdict:
        sys.exit(0)

    decision, reason = verdict
    if decision == "deny":
        # Structured deny (exit 0), per hooks reference:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }))
        sys.exit(0)

    if decision == "ask":
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "ask",
                "permissionDecisionReason": reason,
            }
        }))
        sys.exit(0)

    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # fail open
        print(f"[Unown] pre_tool_use hook warning: {exc}", file=sys.stderr)
        sys.exit(0)
