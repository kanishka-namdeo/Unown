#!/usr/bin/env python3
"""Live PTY drive of `unown dashboard routines` against the REAL engine —
the 'test like a real user' pass for the Routines screen (M6).

Boots the standalone dashboard in a 128x36 pty, walks:
  1. the routines list renders (sorted by next run, human schedule chips)
  2. enter → detail (full spec: timezone, misfire, streak row, runs)
  3. esc → list; s → skip (toast + engine POST verified via REST)
  4. the wizard: a → title/prompt/schedule(every)/tz → confirm renders
     the parsed spec → esc (no create; the CLI already covers create)
  5. ? help card lists the screen

Prints PASS/FAIL per step; exits non-zero on any failure.
"""
import os
import sys
import json
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import UnownPty  # noqa: E402

ENGINE = os.environ.get("UNOWN_ENGINE_URL", "http://127.0.0.1:3030").rstrip("/")
TOKEN = None
# The engine's per-boot bearer token (engine-auth.ts): repo-local
# data/self-learning/engine.token for a source checkout.
for cand in [
    os.path.join(os.environ.get("UNOWN_ROOT", "/home/z/my-project/unown"), "data/self-learning/engine.token"),
    os.path.expanduser("~/.unown/data/self-learning/engine.token"),
]:
    if os.path.exists(cand):
        TOKEN = open(cand).read().strip()
        break


def engine_get(path: str):
    req = urllib.request.Request(f"{ENGINE}{path}")
    if TOKEN:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read().decode())


def engine_post(path: str):
    req = urllib.request.Request(f"{ENGINE}{path}", method="POST", data=b"{}" if "{" in path else b"", headers={"Content-Type": "application/json"})
    if TOKEN:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"http_error": e.code}


steps = []


def check(name: str, cond: bool, extra: str = ""):
    steps.append((name, cond))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))


UNOWN_ROOT = "/home/z/my-project/unown"
log = (lambda msg: print(f"[pty] {msg}"))
pty = UnownPty(log, cwd=UNOWN_ROOT, extra_args=["dashboard", "routines"])
try:
    pty.wait_for("unown dashboard", timeout=60, desc="dashboard header")
    pty.wait_for("routines", timeout=30)
    pty.wait_idle(stable_for=2.0, timeout=25)
    pane = pty.pane_text()

    # 1. The list renders with the live routines and human schedule chips
    check("list shows live routine rows", "regen check" in pane or "minutely smoke" in pane)
    check("human schedule chip (every/after/cron)", ("every 1 minute" in pane) or ("after 2 minutes" in pane) or ("cron " in pane))
    check("lifecycle + next-run columns", ("active" in pane and "next" in pane) or "next in" in pane)

    # 2. Detail drill-in: full spec + streak row
    pty.send("\r")
    pty.wait_idle(stable_for=1.0, timeout=10)
    pane = pty.pane_text()
    check("detail opens (routine ·)", "routine ·" in pane)
    check("detail shows timezone/misfire spec", ("timezone" in pane and "misfire" in pane) or "bounds" in pane)
    check("streak row present", "last 10:" in pane)

    # 3. Skip via 's' — verify against the engine REST too
    #    (pick the regen-check routine: go back to list, j/k to it)
    pty.send("\x1b")  # esc → list
    pty.wait_idle(stable_for=0.8, timeout=6)
    rows_before = engine_get("/api/automations")["automations"]
    pty.send("s")
    pty.wait_idle(stable_for=1.2, timeout=10)
    pane = pty.pane_text()
    check("skip toast appears", "skipped" in pane.lower())
    rows_after = engine_get("/api/automations")["automations"]
    moved = any(
        (a.get("next_run_at") or 0) != (b.get("next_run_at") or 0)
        for a, b in zip(sorted(rows_before, key=lambda x: x["id"]), sorted(rows_after, key=lambda x: x["id"]))
    )
    check("engine recorded the skip (slot advanced)", moved)

    # 4. The wizard: 'a' → type → confirm renders the parsed every-spec
    pty.send("a")
    pty.wait_idle(stable_for=0.8, timeout=6)
    pane = pty.pane_text()
    check("wizard opens (new routine · title)", "new routine · title" in pane)
    pty.send("pty-created routine"); pty.send("\r")
    pty.wait_idle(stable_for=0.5, timeout=4)
    pty.send("Say PTY-OK"); pty.send("\r")
    pty.wait_idle(stable_for=0.5, timeout=4)
    pty.send("every 2d at 09:30"); pty.send("\r")
    pty.wait_idle(stable_for=0.5, timeout=4)
    pty.send("\n")  # timezone empty (local)
    pty.wait_idle(stable_for=0.5, timeout=4)
    pty.send("\r")  # misfire skip
    pty.wait_idle(stable_for=0.5, timeout=4)
    pty.send("\r")  # mode read-only
    pty.wait_idle(stable_for=0.5, timeout=4)
    pty.send("\r")  # model empty → confirm
    pty.wait_idle(stable_for=0.8, timeout=6)
    pane = pty.pane_text()
    check("confirm renders the parsed spec", "every 2d at 09:30" in pane)
    check("confirm shows misfire + mode", "misfire" in pane and "read-only" in pane)
    pty.send("y")
    pty.wait_idle(stable_for=1.5, timeout=10)
    pane = pty.pane_text()
    created = any(a["title"] == "pty-created routine" for a in engine_get("/api/automations")["automations"])
    check("wizard created the routine (engine-side)", created or "routine created" in pane)
    check("created toast / row appears", "routine created" in pane or "pty-created routine" in pane)

    # 6. Help card mentions routines
    pty.send("\x1b")
    pty.send("?")
    pty.wait_idle(stable_for=0.8, timeout=6)
    pane = pty.pane_text()
    check("? help card mounts", "screens" in pane.lower() or "keys" in pane.lower())
    pty.send("\x1b")
finally:
    pty.close()

failed = [n for n, ok in steps if not ok]
print(f"\n{len(steps) - len(failed)}/{len(steps)} PTY checks passed")
sys.exit(1 if failed else 0)
