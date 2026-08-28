#!/usr/bin/env python3
"""dream.py — Unown's auto-dreaming driver.

Collects session notes produced by the Stop/SubagentStop hooks, batches them
(bounded by DREAM_MAX_NOTES, default 40), and asks a headless Claude session
playing the auto-dreamer subagent role to consolidate them into ONE proposal:
duplicates merged, contradictions flagged for human review, stale bullets
pruned.

Zero API mode: without the claude CLI (or with --offline) dream.py writes a
mechanical merge instead — still deduplicated by exact bullet text — clearly
marked UNREFINED so humans know no model reviewed it.

State: dreams/state.json remembers which note files were already folded in,
so every run is incremental. Idempotent and cheap: one small-model call per
night at most.

Usage:
  python3 dreams/dream.py [--dry-run] [--offline] [--max-notes N]
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent          # dreams/
ROOT = HERE.parent
SESSIONS = HERE / "sessions"
CONSOLIDATED = HERE / "consolidated"
STATE = HERE / "state.json"
MAX_NOTES_DEFAULT = int(__import__("os").environ.get("DREAM_MAX_NOTES", 40))

BULLET = re.compile(r"^[-*]\s+(.+)$", re.M)


def load_state() -> dict:
    if STATE.is_file():
        try:
            return json.loads(STATE.read_text())
        except Exception:
            pass
    return {"consolidated": []}


def save_state(state: dict) -> None:
    STATE.write_text(json.dumps(state, indent=2))


def pending_notes() -> list[Path]:
    seen = set(load_state().get("consolidated", []))
    notes = sorted(p for p in SESSIONS.glob("*.md")
                   if p.name not in seen and not p.name.startswith("."))
    return notes


def collect(notes: list[Path], cap: int) -> tuple[list[Path], str]:
    """Cap input size defensively; returns batch + combined text."""
    batch = notes[:cap]
    parts = [f"### {p.name}\n{p.read_text(encoding='utf-8', errors='ignore')}"
             for p in batch]
    return batch, "\n\n".join(parts)[:60000]


def bullets_of(text: str) -> list[str]:
    return [m.strip()[:220] for m in BULLET.findall(text)]


def mechanical_merge(batch_text: str) -> str:
    """Keyless consolidation: exact-dup bullet merge + frequency ranking."""
    counter = Counter(bullets_of(batch_text))
    lines = ["(UNREFINED offline merge — no model reviewed this; "
             "human curation required)\n"]
    for i, (bullet, count) in enumerate(counter.most_common(30), 1):
        dup = f" (x{count})" if count > 1 else ""
        lines.append(f"{i}. {bullet}{dup}")
    return "\n".join(lines)


def ask_dreamer(cl_md: str, batch_text: str) -> str | None:
    exe = shutil.which("claude")
    if not exe:
        return None
    prompt = f"""You are acting as the auto-dreamer subagent (.claude/agents/auto-dreamer.md).

Follow its output contract EXACTLY and write ONLY the markdown report body
(no extra commentary). Current CLAUDE.md follows, then session notes.

===== CURRENT CLAUDE.md =====
{cl_md}

===== SESSION NOTES =====
{batch_text}
"""
    try:
        proc = subprocess.run(
            [exe, "-p", prompt, "--output-format", "text",
             "--allowedTools", "Read,Grep,Glob"],
            capture_output=True, text=True, timeout=900,
            cwd=str(ROOT),
        )
        out = (proc.stdout or "").strip()
        return out or None
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--max-notes", type=int, default=MAX_NOTES_DEFAULT)
    args = ap.parse_args()

    all_pending = pending_notes()
    batch, batch_text = collect(all_pending, args.max_notes)

    print(f"[dream] {len(all_pending)} pending note(s); "
          f"batch={len(batch)} (cap {args.max_notes})")
    if not batch:
        print("[dream] nothing to consolidate.")
        return 0

    cl_path = ROOT / "CLAUDE.md"
    cl_md = (cl_path.read_text(encoding="utf-8", errors="ignore")
             if cl_path.is_file() else "(no CLAUDE.md)")

    if args.dry_run:
        preview = batch_text[:1200]
        print(f"[dream] would send {len(batch_text)} chars to the dreamer; "
              f"preview:\n---\n{preview}\n---")
        return 0

    body = None
    if not args.offline:
        body = ask_dreamer(cl_md, batch_text)
    refined = bool(body)
    if not body:
        body = mechanical_merge(batch_text)
        if args.offline:
            print("[dream] --offline set: writing UNREFINED mechanical merge.")

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out_path = CONSOLIDATED / f"{stamp}.md"
    header = (
        f"# Dream consolidation {stamp}\n\n"
        f"- inputs: {', '.join(p.name for p in batch)}\n"
        f"- mode: {'model-refined' if refined else 'unrefined-mechanical'}\n\n"
        "## Report\n\n"
    )
    # strip accidental duplicate of our own title from model output
    body = re.sub(r"^#\s+Dream consolidation.*$", "", body, flags=re.M).strip()
    CONSOLIDATED.mkdir(parents=True, exist_ok=True)
    out_path.write_text(header + body + "\n", encoding="utf-8")

    state = load_state()
    state.setdefault("consolidated", []).extend(p.name for p in batch)
    save_state(state)

    print(f"[dream] wrote {out_path.relative_to(ROOT)} "
          f"({'refined' if refined else 'UNREFINED'}); "
          f"review, then merge approved bullets into CLAUDE.md and open a PR.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
