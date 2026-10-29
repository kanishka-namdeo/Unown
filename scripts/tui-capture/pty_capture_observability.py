#!/usr/bin/env python3
"""
pty_capture_observability.py — the observability round's capture scenario.

Drives the real `unown` TUI (live stack: bridge + engine + Agnes upstream) and
captures the round's new surfaces as audited stills + pane dumps (the pane is
truth for content — docs/tui-capture-workflow.md):

  01-mission-panel — /mission pins the objective; the panel line renders
  02-turn-settled — a real turn completes; the footer conf chip paints
  03-auto-brief   — an idle gap (threshold compressed to 3s) then a prompt:
                    the returning-user brief fires on the next prompt
  04-recovery     — /recovery renders the triage card
  05-feed         — /feed renders the learning feed card
  06-brief        — /brief (on-demand, with the decision miner)

Env: UNOWN_ROOT (repo), OUT (stills dir), OBS_FIXTURE (scratch project).
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import UnownPty  # noqa: E402

UNOWN_ROOT = os.environ.get("UNOWN_ROOT", "/home/z/my-project/unown")
OUT = os.environ.get("OUT", os.path.join(UNOWN_ROOT, "public/landing/tui/observability-round/stills"))
FIXTURE = os.environ.get("OBS_FIXTURE", "/tmp/obs-fixture")

log = lambda msg: print(f"[obs-capture] {msg}", flush=True)


def build_fixture() -> None:
    """A tiny real project: one README, one JS module."""
    os.makedirs(FIXTURE, exist_ok=True)
    with open(os.path.join(FIXTURE, "README.md"), "w") as f:
        f.write("# fixture-app\n\nA small app the observability capture drives.\n")
    with open(os.path.join(FIXTURE, "app.js"), "w") as f:
        f.write("function add(a, b) {\n\treturn a + b;\n}\n\nmodule.exports = { add };\n")


def main() -> int:
    build_fixture()
    os.makedirs(OUT, exist_ok=True)
    driver = UnownPty(
        log,
        cwd=FIXTURE,
        env_extra={
            # Compress the return threshold so the auto-brief fires inside the
            # capture budget (3 seconds instead of 3 minutes — the decision
            # logic is identical; only the threshold moves).
            "UNOWN_RECAP_IDLE_MINUTES": "0.05",
        },
    )
    failures = 0
    try:
        driver.wait_for(["unown"], timeout=60, desc="TUI boot")
        log("booted")

        # ---- 01: pin a mission, capture the panel
        driver.type_prompt("/mission make the fixture app build green")
        driver.wait_for(["mission pinned"], timeout=20, desc="mission pin notify")
        driver.pump(1.0)
        rec = driver.still("01-mission-panel", ["mission — make the fixture app build green"])
        failures += 0 if rec.ok else 1

        # ---- 02: one cheap real turn
        driver.type_prompt("read README.md and reply with the single word DONE")
        driver.wait_for(["DONE"], timeout=120, desc="first turn settles")
        driver.pump(1.0)
        rec = driver.still("02-turn-settled", ["conf ✓", "conf ◐", "conf ✗"], mode="any")
        failures += 0 if rec.ok else 1

        # ---- 03: idle past the compressed threshold, then a prompt -> the brief
        log("idling 5s past the compressed recap threshold...")
        time.sleep(5)
        driver.type_prompt("reply with the single word OK")
        driver.wait_for(["── brief · back after"], timeout=120, desc="the auto-brief")
        driver.wait_for(["OK"], timeout=90, desc="second turn settles")
        driver.pump(0.8)
        rec = driver.still("03-auto-brief", ["mission: make the fixture app build green", "remains:"])
        failures += 0 if rec.ok else 1

        # ---- 04: /recovery
        driver.type_prompt("/recovery")
        driver.wait_for(["recovery —"], timeout=20, desc="recovery card")
        driver.pump(0.8)
        rec = driver.still("04-recovery", ["recovery —"])
        failures += 0 if rec.ok else 1

        # ---- 05: /feed
        driver.type_prompt("/feed")
        driver.wait_for(["learning feed —"], timeout=20, desc="feed card")
        driver.pump(0.8)
        rec = driver.still("05-feed", ["learning feed —"])
        failures += 0 if rec.ok else 1

        # ---- 06: /brief (the decision miner rides the btw lane — allow time)
        driver.type_prompt("/brief")
        driver.wait_for(["brief — the session at a glance"], timeout=120, desc="brief overlay")
        driver.pump(0.8)
        rec = driver.still("06-brief", ["brief — the session at a glance"])
        failures += 0 if rec.ok else 1

        log("all six surfaces captured")
        return 1 if failures else 0
    except Exception as exc:  # noqa: BLE001 — the lane reports, never crashes silently
        log(f"FAILED: {exc}")
        with open(os.path.join(OUT, "capture-failed.pane.txt"), "w") as f:
            f.write(driver.pane_text())
        return 1
    finally:
        try:
            driver.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
