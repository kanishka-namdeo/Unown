#!/usr/bin/env python3
"""
pty_ob5_in_repo.py — OB-5's rigorous lane: a live session in the UNOWN REPO
itself (the engine's active learning project — notes pending, dreams land in
its memory), a real dream triggered through the engine API, and the in-session
learning feed recording it. The first OB-5 run sat in a throwaway fixture
project that had no dream news of its own — the feed stayed honestly empty;
this lane exercises the project that IS being learned.
"""

import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import UnownPty  # noqa: E402

UNOWN_ROOT = os.environ.get("UNOWN_ROOT", "/home/z/my-project/unown")
OUT = os.path.join(UNOWN_ROOT, "benchmarks/observability/receipts")

log = lambda msg: print(f"[ob5-repo] {msg}", flush=True)


def engine_call(method: str, path: str) -> dict:
    with open(os.path.join(UNOWN_ROOT, "data/self-learning/engine.token")) as f:
        token = f.read().strip()
    req = urllib.request.Request(
        f"http://127.0.0.1:3030{path}", method=method, headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def main() -> int:
    overview = engine_call("GET", "/api/overview")
    pending = overview.get("kpis", {}).get("notes", {}).get("pending", 0)
    if pending < 1:
        log(f"no pending notes ({pending}) — trigger a terminal note first")
        return 1
    driver = UnownPty(log, cwd=UNOWN_ROOT, env_extra={"UNOWN_RECAP_IDLE_MINUTES": "0.05"})
    try:
        driver.wait_for(["unown"], timeout=90, desc="TUI boot in the repo")
        engine_call("POST", "/api/jobs/auto-dream/trigger")
        log(f"dream triggered ({pending} notes pending) — waiting the 30s probe cadence...")
        deadline = time.time() + 150
        narrated = False
        while time.time() < deadline:
            driver.pump(2.0)
            pane = driver.pane_text()
            if "AutoDream learned" in pane or "learning event" in pane or "memory advanced" in pane:
                narrated = True
                break
        pane = driver.pane_text()
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, "ob5-in-repo-learning.pane.txt"), "w", encoding="utf-8") as f:
            f.write(
                "# ob5-in-repo-learning — OB-5 (rigorous): a live session in the repo, a real\n"
                "# dream triggered through the engine API, the in-session feed recording it.\n"
                f"# notes pending at trigger: {pending}. narrated in-session: {narrated}\n\n"
            )
            f.write(pane + "\n")
        driver.type_prompt("/feed")
        driver.wait_for(["learning feed —"], timeout=20, desc="feed card")
        driver.pump(1.0)
        with open(os.path.join(OUT, "ob5-in-repo-feed-card.pane.txt"), "w", encoding="utf-8") as f:
            f.write("# ob5-in-repo-feed-card — OB-5: /feed after a real dream\n\n")
            f.write(driver.pane_text() + "\n")
        log(f"narrated={narrated}")
        return 0 if narrated else 1
    except Exception as exc:  # noqa: BLE001
        log(f"FAILED: {exc}")
        return 1
    finally:
        try:
            driver.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
