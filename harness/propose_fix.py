#!/usr/bin/env python3
"""propose_fix.py — turn one weakness cluster into a bounded fix proposal.

Real mode: packs evidence + current content of every EDITABLE_SURFACE into a
prompt and asks `claude -p` for a unified diff constrained to ≤40 changed
lines against ONE whitelisted file.
Offline mode: writes an annotated template so a human (or later session) can
fill it in — the pipeline never blocks.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MAX_DIFF_LINES = 40


def editable_surfaces() -> list[str]:
    raw = (HERE / "EDITABLE_SURFACES").read_text()
    return [ln.strip() for ln in raw.splitlines()
            if ln.strip() and not ln.startswith("#")]


def surfaces_snapshot(paths: list[str]) -> str:
    chunks = []
    for rel in paths:
        p = ROOT / rel
        body = p.read_text(encoding="utf-8") if p.is_file() else "(missing)"
        chunks.append(f"===== FILE: {rel} =====\n{body}\n")
    return "\n".join(chunks)


def ask_claude(prompt: str) -> str:
    exe = shutil.which("claude")
    if not exe:
        return ""
    try:
        proc = subprocess.run([exe, "-p", prompt, "--output-format", "text"],
                              capture_output=True, text=True, timeout=300,
                              cwd=str(ROOT))
        return (proc.stdout or "").strip()
    except Exception:
        return ""


PROMPT_TMPL = """You are Unown's harness analyst producing a BOUNDED self-improvement patch.

Weakness cluster to fix:
{description}

Evidence (verbatim):
{evidence}

Rules — violating any makes your answer invalid:
1. Output ONE unified diff targeting EXACTLY ONE file from: {surfaces}.
2. Diff must be <= {max_lines} changed lines total.
3. Fix the root cause stated above; do NOT touch gate logic, workflows,
   hooks decisions, or eval fixtures.
4. Wrap ONLY the diff in a ```diff fence. No other prose outside fences.

Editable-surface current contents:
{snapshot}
"""


def extract_diff(text: str) -> str | None:
    m = re.search(r"```diff\s*\n(.*?)```", text, re.S)
    if not m:
        return None
    diff = m.group(1)
    changed = sum(1 for ln in diff.splitlines()
                  if ln.startswith(("+", "-")) and not ln.startswith(("+++", "---")))
    return diff if changed <= MAX_DIFF_LINES else None


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:32] or "fix"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cluster", required=True, help="e.g. w001")
    ap.add_argument("--weaknesses", default=str(HERE / "weaknesses.json"))
    args = ap.parse_args()

    data = json.loads(Path(args.weaknesses).read_text())
    match = next((c for c in data.get("clusters", []) if c["id"] == args.cluster),
                 None)
    if not match:
        print(f"cluster {args.cluster} not found"); return 2

    surfaces = editable_surfaces()
    prompt = PROMPT_TMPL.format(
        description=json.dumps(match["description"]),
        evidence="\n".join(f"- {e}" for e in match["evidence"]),
        surfaces=", ".join(surfaces),
        max_lines=MAX_DIFF_LINES,
        snapshot=surfaces_snapshot(surfaces)[:24000],
    )

    ai = ask_claude(prompt) if "--no-ai" not in sys.argv else ""
    diff = extract_diff(ai) if ai else None

    stamp = date.today().isoformat()
    target_file = f"{stamp}-{slugify(match['description'][:40])}.md"
    out_path = HERE / "proposals" / target_file

    sections = [
        f"# Proposal: fix {match['id']} — {match['category']}",
        "",
        f"- generated: {stamp}  | source tag: {data.get('tag')}",
        f"- cluster: {match['description']}",
        "",
        "## Evidence",
        *[f"- {e}" for e in match["evidence"]],
        "",
        "## Expected effect",
        f"- flips: {', '.join(match['eval_ids'])} from fail to pass.",
        "",
    ]
    if diff:
        sections += ["## Diff", "", "```diff", *diff.splitlines(), "```", ""]
    else:
        sections += [
            "## Diff",
            "",
            "> TEMPLATE — no AI writer available this run (or diff over bound).",
            "> Fill manually; keep <= 40 changed lines, exactly one file:",
            "> " + ", ".join(surfaces),
            "",
            "```diff",
            "*** UNIFIED DIFF GOES HERE ***",
            "```",
            "",
        ]
    sections += ["## Regression risk", "- guarded by unaffected evals; "
                                        "validate_fix.py re-checks full suite.", ""]
    out_path.write_text("\n".join(sections), encoding="utf-8")
    print(f"proposal written: {out_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
