"""S1 — Tiered memory resolution (mechanism 1)."""
import json
import shutil
from pathlib import Path

NAME = "tiered-memory"
DESCRIPTION = "user -> project -> local tiers resolve & are observable via memory/digest.py"

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def _digest(ctx, home):
    proc = ctx.sh([ctx.py, "memory/digest.py", "--json", "--cwd", ctx.repo],
                  cwd=ctx.repo, env={"HOME": str(home)})
    assert proc.returncode == 0, f"digest.py exited {proc.returncode}"
    return json.loads(proc.stdout)


def run(ctx):
    # The repo ships the project tier (CLAUDE.md); add the gitignored local
    # override fixture, while the synthetic HOME already carries the user tier.
    shutil.copy(FIXTURES / "local" / "CLAUDE.local.md.example",
                ctx.repo / "CLAUDE.local.md")

    data = _digest(ctx, ctx.home)
    tiers = data["tiers"]
    labels = [t["label"] for t in tiers]
    for want in ("user-global", "project-root", "local-override"):
        assert want in labels, f"missing tier '{want}' in {labels}"
    i_user, i_proj, i_locl = (labels.index("user-global"),
                              labels.index("project-root"),
                              labels.index("local-override"))
    assert i_user < i_proj < i_locl, (
        f"tiers out of order: {labels} — precedence must be user->project->local")
    assert all(t["bytes"] > 0 for t in tiers), "empty tier file detected"
    total = sum(t["bytes"] for t in tiers)

    # Empty HOME: user tier disappears, project+local still resolve.
    labels2 = [t["label"] for t in _digest(ctx, ctx.empty_home)["tiers"]]
    assert "user-global" not in labels2, "empty HOME leaked a user tier"
    assert {"project-root", "local-override"} <= set(labels2), \
        f"project/local tiers lost with empty HOME: {labels2}"

    return (f"{len(labels)} tiers resolved (user@{i_user} < project@{i_proj} "
            f"< local@{i_locl}), ~{total} bytes of context")
