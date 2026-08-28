"""S2 — PreToolUse hook: the deterministic gatekeeper (mechanism 5)."""
import json

NAME = "hook-gate"
DESCRIPTION = "PreToolUse denies destructive ops/secret writes, flags tokens, redacts logs"

HOOK = ".claude/hooks/pre_tool_use.py"
FAKE_PAT = "github_" + "pat_SBX0" + "0EXAMPLE" + "TOKEN000111222333444"


def _gate(ctx, tool_name, tool_input):
    payload = json.dumps({"tool_name": tool_name, "tool_input": tool_input})
    proc = ctx.sh([ctx.py, HOOK], cwd=ctx.repo, input=payload)
    assert proc.returncode == 0, f"gate exited {proc.returncode} (fail-open only)"
    if not proc.stdout.strip():
        return "pass", None
    try:
        decision = json.loads(proc.stdout)["hookSpecificOutput"]["permissionDecision"]
        reason = json.loads(proc.stdout)["hookSpecificOutput"].get(
            "permissionDecisionReason", "")
        return decision, reason
    except Exception as exc:  # noqa: BLE001
        raise AssertionError(f"unparseable gate output: {proc.stdout!r}") from exc


def run(ctx):
    checks = [
        # (tool_name, tool_input, expected_decision, what)
        ("Bash", {"command": "rm -rf /"}, "deny", "destructive filesystem root"),
        ("Bash", {"command": "git push --force origin main"},
         "deny", "history rewriting force-push"),
        ("Bash", {"command": f"echo deploy token {FAKE_PAT}"},
         "ask", "token-shaped secret in shell command"),
        ("Write", {"file_path": "notes.md", "content": f"key={FAKE_PAT}"},
         "deny", "writing a secret into a file"),
        ("Bash", {"command": "ls -la harness"}, "pass", "benign read-only ls"),
        ("Read", {"file_path": "README.md"}, "pass", "reads pass untouched"),
    ]
    verdicts = []
    for tool, inp, expected, what in checks:
        decision, reason = _gate(ctx, tool, inp)
        assert decision == expected, (
            f"{what}: expected '{expected}', got '{decision}' ({reason})")
        verdicts.append((what, decision))

    # Audit log exists, recorded every decision, and NEVER contains the raw
    # token even though one case echoed it (hooklib.redact must have fired).
    audit = ctx.repo / "unown" / "logs" / "toolgate.jsonl"
    assert audit.is_file(), "gatekeeper wrote no audit trail to unown/logs/"
    blob = audit.read_text()
    rows = [json.loads(ln) for ln in blob.splitlines() if ln.strip()]
    assert len(rows) >= len(checks), (
        f"audit rows {len(rows)} < decisions {len(checks)}")
    assert FAKE_PAT not in blob, "RAW SECRET LEAKED into toolgate.jsonl!"
    assert "<redacted>" in blob, "redaction marker missing from audit log"

    n_deny = sum(1 for _, d in verdicts if d == "deny")
    return (f"{len(checks)}/6 decisions correct ({n_deny} deny); "
            f"audit trail {len(rows)} rows, secrets redacted")
