"""S5 — Self-improving harness loop, end to end (mechanism 2)."""
from pathlib import Path

NAME = "self-improve"
DESCRIPTION = "seed_demo: evals -> mine failures -> propose fix -> validation gate -> v2 promoted"

RUNBOOK_REL = Path("docs") / "RUNBOOK.md"


def run(ctx):
    rb_repo = ctx.repo / RUNBOOK_REL
    pristine = rb_repo.read_text()

    # Upstream contract: the repo intentionally ships one stale fact
    # ("Dream consolidations are archived under memory/dream-archive/")
    # which makes eval t003 fail — fuel for the loop below.
    assert "memory/dream-archive" in pristine, (
        "expected seeded stale fact missing from RUNBOOK.md — if upstream "
        "fixed it, regenerate the stale line inside this scenario")

    demo = ctx.sh(["bash", "seed_demo.sh"],
                  cwd=ctx.repo / "harness", timeout=300)
    transcript = (demo.stdout or "") + (demo.stderr or "")
    assert "DEMO COMPLETE" in transcript, (
        f"seed_demo did not complete cleanly:\n{transcript[-1200:]}")
    assert "v2 promoted" in transcript, "gate verdict never reached promotion"

    fixed = rb_repo.read_text()
    assert "memory/dream-archive" not in fixed, "stale fact survived promotion!"
    assert "dreams/consolidated" in fixed, "corrected path absent after patch"

    proposal = ctx.repo / "harness" / "proposals" / "demo-t003-known-good.md"
    assert proposal.is_file(), "validation-gate proposal artifact missing"

    return ("t003 mined -> known-good patch gated -> RUNBOOK corrected "
            "(v2 promoted)")
