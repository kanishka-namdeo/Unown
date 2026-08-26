#!/usr/bin/env python3
"""run_evals.py — headless eval runner for the self-improving loop.

Real mode:  each task is sent through `claude -p "<prompt>" --output-format
            text` (Claude Code headless mode) and scored against verifiers.
Offline:    --offline runs the suite WITHOUT any API: each task's simulated
            answer is derived (reposeek) from the editable knowledge surfaces
            docs/RUNBOOK.md and CLAUDE.md, falling back to canned fixtures.
            This makes the loop mechanically real: patch a surface, the next
            validation run reflects it, and the gate can promote v2.

Outputs:
  runs/<tag>/results.jsonl   per-task rows {id, ok, response, reason}
  runs/<tag>/summary.json    {tag, pass_rate, passed, failed, ts}
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
TASKS = HERE / "evals" / "tasks.jsonl"
FIXTURES = HERE / "evals" / "fixtures"

# Offline-mode knowledge surfaces — deliberately identical to the files an
# improvement proposal may edit. That keeps the demo loop REAL: patch the
# surface, the simulated agent's answer changes, the gate can promote it.
KNOWLEDGE_FILES = ["docs/RUNBOOK.md", "CLAUDE.md"]


def load_tasks(limit: int | None = None) -> list[dict]:
    tasks = []
    for line in TASKS.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        tasks.append(json.loads(line))
    return tasks[: limit] if limit else tasks


def ask_claude(prompt: str, timeout_s: int) -> str:
    exe = shutil.which("claude")
    if not exe:
        raise FileNotFoundError("claude CLI not on PATH")
    proc = subprocess.run(
        [exe, "-p", prompt, "--output-format", "text"],
        capture_output=True,
        text=True,
        timeout=timeout_s,
        cwd=str(HERE.parent),
    )
    return (proc.stdout or "").strip()


def fixture_for(task_id: str) -> str:
    f = FIXTURES / f"{task_id}.txt"
    return f.read_text(encoding="utf-8").strip() if f.is_file() else ""


def reposeek(task: dict) -> str:
    """Offline simulated answer derived from editable knowledge surfaces.

    Mimics a memory-grounded agent: answers with the first sentence in a
    knowledge surface containing any required phrase; otherwise falls back
    to that file's closing line (garbage in, garbage out), then to the
    canned fixture.
    """
    root = HERE.parent
    alternatives = task.get("must_contain_any", [])
    for rel in KNOWLEDGE_FILES:
        path = root / rel
        if not path.is_file():
            continue
        lines = [ln for ln in path.read_text(encoding="utf-8",
                                             errors="ignore").splitlines()]
        for ln in lines:
            low = ln.lower()
            if any(a.lower() in low for a in alternatives):
                return f"Per {rel}: {ln.strip()}"
        tail = next((ln.strip() for ln in reversed(lines) if ln.strip()), "")
        if tail and not tail.startswith("#"):
            return f"Per {rel}: {tail}"
        break
    return fixture_for(task["id"])


def score(task: dict, response: str) -> tuple[bool, str]:
    low = response.lower()
    for bad in task.get("forbidden", []):
        if bad.lower() in low:
            return False, f"forbidden term present: {bad}"
    for need in task.get("must_contain_all", []):
        if need.lower() not in low:
            return False, f"missing required phrase: {need}"
    anys = task.get("must_contain_any", [])
    if anys and not any(a.lower() in low for a in anys):
        return False, f"none of required alternatives present: {anys}"
    if not response.strip():
        return False, "empty response"
    return True, "ok"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="run")
    ap.add_argument("--offline", action="store_true",
                    help="replay fixtures instead of calling claude")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    out_dir = HERE / "runs" / args.tag
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    passed = 0
    for task in load_tasks(args.limit):
        try:
            if args.offline:
                resp = reposeek(task)
                note = "offline-reposeek"
            else:
                resp = ask_claude(task["prompt"], int(task.get("timeout_s", 90)))
                note = "claude-headless"
        except Exception as exc:
            resp = ""
            note = f"error:{exc}"
        ok, reason = score(task, resp)
        passed += int(ok)
        rows.append({"id": task["id"], "category": task["category"],
                     "ok": ok, "reason": reason, "via": note,
                     "response": resp[:1200]})
        mark = "PASS" if ok else "FAIL"
        print(f"[{mark}] {task['id']} ({reason})")

    pass_rate = round(passed / max(len(rows), 1), 4)
    summary = {"tag": args.tag, "pass_rate": pass_rate, "passed": passed,
               "failed": len(rows) - passed, "total": len(rows),
               "ts": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    with (out_dir / "results.jsonl").open("w") as fh:
        fh.writelines(json.dumps(r) + "\n" for r in rows)
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    print(f"\ntag={args.tag}  pass_rate={pass_rate}  ({passed}/{len(rows)})")
    print(f"wrote {out_dir}/{{results.jsonl,summary.json}}")
    # Non-zero exit on failures is intentional: CI can gate on it.
    return 0 if not rows else (0 if passed == len(rows) else 1)


if __name__ == "__main__":
    sys.exit(main())
