#!/usr/bin/env python3
"""
pty_fleet_lane.py — the delegation round's pane-truth lane.

Boots the real unown TUI in this repo, delegates async work (a real fleet
child through the live bridge), and captures the literal pane text at the
moments that matter for the round's progress-visibility axis:

  1. the fleet widget while the child runs (╭─ Subagents box, live rows),
  2. the delivered result (the fleet header with turns/tools/tokens),
  3. the /tasks picture (the lifecycle metadata view).

Every capture is a pane dump: the literal screen text is the receipt (the
observability round's method). Stills render alongside via pty_common.

Usage:
  python3 pty_fleet_lane.py --run ../../benchmarks/delegation-round/receipts/<dir>
  python3 pty_fleet_lane.py            # standalone: writes receipts/pty-fleet-only-<ts>/
"""

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scripts", "tui-capture"))
from pty_common import UnownPty  # noqa: E402

UNOWN_ROOT = os.environ.get("UNOWN_ROOT", "/home/z/my-project/unown")

log = lambda msg: print(f"[fleet-lane] {msg}", flush=True)


def main() -> int:
    argv = sys.argv[1:]
    run_dir = None
    if "--run" in argv:
        run_dir = argv[argv.index("--run") + 1]
    if not run_dir:
        ts = time.strftime("%Y-%m-%dT%H-%M-%S")
        run_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "receipts", f"pty-fleet-only-{ts}")
    out = os.path.join(run_dir, "pty-fleet")
    os.makedirs(out, exist_ok=True)

    driver = UnownPty(log, cwd=UNOWN_ROOT)
    try:
        driver.wait_for(["unown"], timeout=90, desc="TUI boot")
        driver.pump(1.0)

        driver.type_prompt(
            "Spawn a background subagent named 'counter' that counts the total "
            "lines of TypeScript under pi-repo/packages/self-learning/test/ and "
            "reports just the number. While it runs, tell me in one sentence "
            "what the fleet is doing. Then report the final count."
        )
        # the fleet widget appears while the async child runs
        saw_widget = False
        deadline = time.time() + 240
        while time.time() < deadline:
            driver.pump(0.5)
            pane = driver.pane_text()
            if "╭─ Subagents" in pane:
                saw_widget = True
                break
        pane = driver.pane_text()
        with open(os.path.join(out, "fleet-widget.pane.txt"), "w", encoding="utf-8") as f:
            f.write(
                "# fleet-widget — the delegation round's pane truth: the fleet widget while\n"
                "# a real async child runs (live rows, current tool, token count).\n"
                f"# widget visible: {saw_widget}\n\n"
            )
            f.write(pane + "\n")
        if saw_widget:
            try:
                driver.still("fleet-widget", ["Subagents"], mode="any")
            except Exception as exc:  # noqa: BLE001
                log(f"still render failed (non-fatal): {exc}")
        log(f"widget captured (visible={saw_widget}) — waiting for the result delivery")

        # the delivered result: the fleet header line (name (agent) finished/…)
        got_result = False
        deadline = time.time() + 360
        while time.time() < deadline:
            driver.pump(1.0)
            pane = driver.pane_text()
            if "counter" in pane and ("finished" in pane or "FAILED" in pane or "BLOCKED" in pane):
                got_result = True
                break
        pane = driver.pane_text()
        with open(os.path.join(out, "fleet-result.pane.txt"), "w", encoding="utf-8") as f:
            f.write(
                "# fleet-result — the delegation round's pane truth: the async child's\n"
                "# delivered result with its vitals header (turns, tools, tokens).\n"
                f"# result observed: {got_result}\n\n"
            )
            f.write(pane + "\n")

        # /tasks is best-effort: a fresh boot reads the persistent resume
        # registry, but the command can race the model's closing turn — a miss
        # is a missing receipt, never a failed lane (the widget + result panes
        # carry the visibility evidence).
        try:
            driver.type_prompt("/tasks")
            driver.wait_for(["Running", "resumable", "No subagents", "Subagents"], timeout=30, desc="/tasks")
            driver.pump(1.0)
            with open(os.path.join(out, "tasks-command.pane.txt"), "w", encoding="utf-8") as f:
                f.write("# tasks-command — the delegation round's pane truth: the /tasks picture\n\n")
                f.write(driver.pane_text() + "\n")
        except Exception as exc:  # noqa: BLE001
            log(f"/tasks capture missed (non-fatal): {exc}")

        log(f"done: widget={saw_widget} result={got_result}")
        return 0 if (saw_widget and got_result) else 1
    except Exception as exc:  # noqa: BLE001
        log(f"FAILED: {exc}")
        try:
            with open(os.path.join(out, "lane-failed.pane.txt"), "w", encoding="utf-8") as f:
                f.write("# lane-failed — the capture aborted — kept as the audit trail\n\n")
                f.write(driver.pane_text() + "\n")
        except Exception:
            pass
        return 1
    finally:
        try:
            driver.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
