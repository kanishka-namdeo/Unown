#!/usr/bin/env python3
"""digest.py — print the effective tiered-memory stack for a directory.

Stdlib only. Mirrors Claude Code's launch-time loading rules closely enough
for observability:

  managed (/etc/claude-code/CLAUDE.md or macOS equivalent)
  user    (~/.claude/CLAUDE.md)
  project (./CLAUDE.md or ./.claude/CLAUDE.md)
  local   (./CLAUDE.local.md, gitignored)

Usage:
  python3 memory/digest.py [--json] [--cwd PATH]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def candidate_files(cwd: Path) -> list[dict]:
    cands = [
        {"tier": "managed", "label": "managed-policy-linux", "path": Path("/etc/claude-code/CLAUDE.md")},
        {"tier": "managed", "label": "managed-policy-macos",
         "path": Path("/Library/Application Support/ClaudeCode/CLAUDE.md")},
        {"tier": "user", "label": "user-global", "path": Path.home() / ".claude" / "CLAUDE.md"},
        {"tier": "project", "label": "project-root", "path": cwd / "CLAUDE.md"},
        {"tier": "project", "label": "project-dotclaude", "path": cwd / ".claude" / "CLAUDE.md"},
        {"tier": "local", "label": "local-override", "path": cwd / "CLAUDE.local.md"},
    ]
    found = []
    seen = set()
    for c in cands:
        p = c["path"]
        if str(p) in seen:
            continue
        seen.add(str(p))
        try:
            if p.is_file():
                text = p.read_text(encoding="utf-8", errors="ignore")
                imports = [ln.strip()[1:].split()[0]
                           for ln in text.splitlines()
                           if ln.strip().startswith("@") and not ln.strip().startswith("`@")]
                found.append({**c,
                              "resolved_path": str(p),
                              "bytes": len(text.encode("utf-8")),
                              "lines": len(text.splitlines()),
                              "imports": imports[:10]})
        except OSError:
            continue
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", dest="as_json")
    ap.add_argument("--cwd", default=os.getcwd())
    args = ap.parse_args()

    cwd = Path(args.cwd).resolve()
    tiers = candidate_files(cwd)

    if args.as_json:
        print(json.dumps({"cwd": str(cwd), "tiers": tiers}, indent=2))
        return 0

    print(f"Effective memory stack for {cwd}")
    print("order: managed -> user -> project -> local (concatenated at launch)\n")
    if not tiers:
        print("  (no CLAUDE.md tiers found)")
    total = 0
    for i, t in enumerate(tiers, 1):
        total += t["bytes"]
        marker = {"managed": "[T1 policy]", "user": "[T2 user]",
                  "project": "[T3 project]", "local": "[T4 local]"}[t["tier"]]
        imp = f"  imports: {', '.join(t['imports'])}" if t["imports"] else ""
        print(f"{i}. {marker} {t['label']:<18} {t['resolved_path']}  "
              f"({t['bytes']} B, {t['lines']} lines){imp}")
    print(f"\ntotal in-context memory: ~{total // 1024} KiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
