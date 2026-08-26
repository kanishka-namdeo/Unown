"""S4 — Auto dreaming consolidation, offline mode (mechanism 4)."""
import json
import re

NAME = "auto-dream"
DESCRIPTION = "dream.py merges session notes offline: dedupe(x2), incremental state, idempotent"

DUP_BULLET = "- Prefer ruff over flake8 for Python linting."

NOTES = {
    "sbx-note-alpha.md": f"""# Session note alpha
## Facts observed
{DUP_BULLET}
- Router tests live under router/payload_samples/.
""",
    "sbx-note-beta.md": f"""# Session note beta
## Repeat observation
{DUP_BULLET}
- The gatekeeper blocks force-push to main.
- (2026-01-02) Legacy: memory archive lives in memory/dream-archive/.
""",
    "sbx-note-gamma.md": """# Session note gamma
- Evals use offline reposeek fixtures when no API key is set.
""",
}


def run(ctx):
    sess = ctx.repo / "dreams" / "sessions"
    sess.mkdir(parents=True, exist_ok=True)
    for fname, body in NOTES.items():
        (sess / fname).write_text(body)

    proc = ctx.sh([ctx.py, "dream.py", "--offline"], cwd=ctx.repo / "dreams")
    assert proc.returncode == 0, f"dream.py exited {proc.returncode}"

    consolidated = sorted((ctx.repo / "dreams" / "consolidated").glob("*.md"))
    assert consolidated, "no consolidated dream written"
    report = consolidated[-1].read_text()

    assert "mode: unrefined-mechanical" in report, \
        "offline run must be clearly marked UNREFINED"
    # The duplicate bullet is merged into ONE entry carrying its frequency.
    merged = re.search(re.escape(DUP_BULLET[2:]) + r" \(x2\)", report)
    assert merged, f"dedupe failed — expected '{DUP_BULLET} (x2)' in report"
    # All planted notes were folded in.
    state = json.loads((ctx.repo / "dreams" / "state.json").read_text())
    consumed = set(state["consolidated"])
    assert set(NOTES) <= consumed, f"state lost notes: {consumed}"

    # Incremental/idempotent: everything already digested => nothing new.
    proc2 = ctx.sh([ctx.py, "dream.py", "--offline"], cwd=ctx.repo / "dreams")
    assert proc2.returncode == 0
    assert "nothing to consolidate" in proc2.stdout, (
        f"second run should be a no-op, said: {proc2.stdout[:200]!r}")

    return ("3 notes folded; duplicate merged (x2); "
            "re-run reports nothing left to do")
