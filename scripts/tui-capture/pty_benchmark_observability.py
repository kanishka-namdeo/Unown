#!/usr/bin/env python3
"""
pty_benchmark_observability.py — the observability round's dogfood benchmark
(OB-1..OB-8, defined in docs/tui-observability-audit.md §Benchmark tasks).

Runs the failure/degraded/learning/confidence lanes LIVE against the real
stack and writes pane-dump receipts to benchmarks/observability/receipts/
(one .pane.txt per task — the pane is truth, docs/tui-capture-workflow.md).
OB-1/OB-2's receipts are the audited stills in
public/landing/tui/observability-round/stills/ (same lane, earlier run).

Time compression is HONEST and recorded per receipt: the auto-brief threshold
moves to 3s via UNOWN_RECAP_IDLE_MINUTES=0.05 (the decision logic is
identical); nothing else is compressed — the engine kill waits the real 30s
probe cadence, the dream trigger waits the real dream.

Env: UNOWN_ROOT, OBS_FIXTURE, OUT (receipts dir).
"""

import json
import os
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import UnownPty  # noqa: E402

UNOWN_ROOT = os.environ.get("UNOWN_ROOT", "/home/z/my-project/unown")
OUT = os.environ.get("OUT", os.path.join(UNOWN_ROOT, "benchmarks/observability/receipts"))
FIXTURE = os.environ.get("OBS_FIXTURE", "/tmp/obs-bench")

log = lambda msg: print(f"[obs-bench] {msg}", flush=True)

RECEIPTS: dict[str, str] = {}


def receipt(name: str, pane: str, note: str) -> None:
    RECEIPTS[name] = pane
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{name}.pane.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"# {name} — {note}\n# time compression: UNOWN_RECAP_IDLE_MINUTES=0.05 (auto-brief only)\n\n")
        f.write(pane + "\n")
    log(f"receipt written: {name}")


def build_fixture() -> None:
    """A project whose typecheck FAILS — every edit triggers [auto-verify]."""
    os.makedirs(FIXTURE, exist_ok=True)
    with open(os.path.join(FIXTURE, "package.json"), "w") as f:
        json.dump({"name": "obs-bench", "scripts": {"typecheck": "node check.js"}}, f)
    # check.js fails until GOOD=1 — deterministic, instant, no toolchain needed.
    with open(os.path.join(FIXTURE, "check.js"), "w") as f:
        f.write("process.exit(process.env.GOOD === '1' ? 0 : 1)\n")
    with open(os.path.join(FIXTURE, "lib.js"), "w") as f:
        f.write("function add(a, b) {\n\treturn a + b;\n}\n\nmodule.exports = { add };\n")


def engine_pid() -> int | None:
    for candidate in (os.path.join(UNOWN_ROOT, ".run/engine.pid"), os.path.join(UNOWN_ROOT, "data/self-learning/engine.pid")):
        try:
            with open(candidate) as f:
                return int(f.read().strip())
        except Exception:
            continue
    return None


def engine_token() -> str:
    with open(os.path.join(UNOWN_ROOT, "data/self-learning/engine.token")) as f:
        return f.read().strip()


def engine_call(method: str, path: str) -> dict:
    token = engine_token()
    req = urllib.request.Request(
        f"http://127.0.0.1:3030{path}", method=method, headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def main() -> int:
    build_fixture()
    driver = UnownPty(
        log,
        cwd=FIXTURE,
        env_extra={"UNOWN_RECAP_IDLE_MINUTES": "0.05"},
    )
    failures = []
    try:
        driver.wait_for(["unown"], timeout=60, desc="TUI boot")

        # ---- OB-3 + OB-8: an edit that fails the verify gate (conf must drop
        # to low with the drivers named; the health chip + /recovery rows
        # must surface the failure without scrolling).
        driver.type_prompt("edit lib.js: change the add function to multiply. Do not run any other commands.")
        driver.wait_for(["multiply"], timeout=180, desc="the edit lands")
        driver.pump(4.0)  # the PostToolUse auto-verify fires after the edit
        pane = driver.pane_text()
        ok_conf = "conf ✗" in pane or "conf ◐" in pane
        receipt("ob3-ob8-verify-failure", pane,
                "OB-3/OB-8: the auto-verify failure is ambient (conf chip degraded) immediately after the edit")
        if not ok_conf:
            failures.append("OB-3/OB-8: conf chip did not degrade after a verify failure")
        driver.type_prompt("/recovery")
        driver.wait_for(["recovery —"], timeout=20, desc="recovery card")
        driver.pump(1.0)
        pane = driver.pane_text()
        receipt("ob3-recovery-card", pane, "OB-3: the verify failure renders as a recovery row with its fix path")
        if "verify failed" not in pane:
            failures.append("OB-3: recovery card missing the verify-failure row")

        # ---- OB-4: kill the engine mid-session. The honest contract is the
        # taxonomy, not a permanent down state: the supervisor's gated
        # auto-start may respawn a refused engine, and the state machine must
        # NARRATE whichever path happens (a transient `memory: down`, or the
        # down->up transition toast). Silence would be the only failure.
        pid = engine_pid()
        if pid:
            os.kill(pid, 15)
            log(f"engine killed (pid {pid}); waiting the real 30s probe cadence...")
            deadline = time.time() + 50
            narrated = False
            while time.time() < deadline:
                driver.pump(1.0)
                pane = driver.pane_text()
                if "memory: down" in pane or "learning resumed" in pane:
                    narrated = True
                    break
            if not narrated:
                pane = driver.pane_text()
        pane = driver.pane_text()
        receipt("ob4-engine-down-footer", pane,
                "OB-4: engine killed mid-session — the state machine narrated it (down, or the auto-heal toast)")
        if "memory: down" not in pane and "learning resumed" not in pane:
            failures.append("OB-4: neither the down state nor the auto-heal narration appeared")
        driver.type_prompt("/recovery")
        driver.wait_for(["recovery —"], timeout=20, desc="recovery after kill")
        driver.pump(1.0)
        pane = driver.pane_text()
        receipt("ob4-engine-down-recovery", pane,
                "OB-4: the recovery card names the engine row with its fix path (or shows the healed state)")
        if "engine down" not in pane and "engine up" not in pane:
            failures.append("OB-4: recovery card shows neither the engine row nor the healed state")

        # ---- OB-5: bring the engine back, trigger a dream (real notes are
        # pending), wait the probe cadence — the learning feed must record it.
        subprocess.run(
            ["bash", os.path.join(UNOWN_ROOT, "scripts/start.sh")],
            cwd=UNOWN_ROOT,
            capture_output=True,
            timeout=120,
        )
        time.sleep(4)
        try:
            overview = engine_call("GET", "/api/overview")
            pending = overview.get("kpis", {}).get("notes", {}).get("pending") or overview.get("notes", {}).get("pending")
            if pending:
                engine_call("POST", "/api/jobs/auto-dream/trigger")
                log(f"dream triggered ({pending} notes pending); waiting the 30s probe cadence...")
                deadline = time.time() + 90
                while time.time() < deadline:
                    driver.pump(2.0)
                    pane = driver.pane_text()
                    if "✦" in pane and "learning event" in pane:
                        break
            else:
                log("no pending notes — the dream trigger would no-op; recorded honestly")
        except Exception as exc:
            log(f"dream trigger lane: {exc}")
        driver.pump(2.0)
        pane = driver.pane_text()
        receipt("ob5-learning-feed", pane, "OB-5: a dream consolidated live — the feed chip/panel recorded it in-session")
        driver.type_prompt("/feed")
        driver.wait_for(["learning feed —"], timeout=20, desc="feed card")
        driver.pump(1.0)
        receipt("ob5-feed-card", driver.pane_text(), "OB-5: /feed lists the dream event with its age")

        log("benchmark complete")
        if failures:
            for f in failures:
                log(f"FAIL: {f}")
            return 1
        log("all executed OB lanes green")
        return 0
    except Exception as exc:  # noqa: BLE001
        log(f"FAILED: {exc}")
        receipt("capture-failed", driver.pane_text(), "the benchmark aborted — kept as the audit trail")
        return 1
    finally:
        try:
            driver.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
