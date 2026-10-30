#!/usr/bin/env python3
"""
pty_trust_test.py — Phase 7: the trust test (the mission's PRIMARY metric).

A REAL long-duration session in the repo with checkpoints taken at random
moments — measuring exactly what the mission demands: a developer away for
"30 minutes" (compressed where honest: the auto-brief threshold via env; the
idle window itself is real) who returns must understand what happened, why,
what was decided, what was learned and what remains — WITHIN 60 SECONDS.

The pane is truth: every checkpoint records the literal screen. The pass
condition is programmatic: the RETURN checkpoint's pane (the brief) contains
each of the five answers in one screenful.

Receipts: benchmarks/observability/receipts/trust-*.pane.txt
"""

import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import UnownPty  # noqa: E402

UNOWN_ROOT = os.environ.get("UNOWN_ROOT", "/home/z/my-project/unown")
OUT = os.path.join(UNOWN_ROOT, "benchmarks/observability/receipts")
# The real 30-minute away window, honestly compressed ONLY where marked:
# the auto-brief threshold rides UNOWN_RECAP_IDLE_MINUTES. The idle window
# below is the real clock the engine's own cadences run against (dreams at
# 10m, overview poll at 5m) — this is what makes the checkpoint readings real.
IDLE_SECONDS = int(os.environ.get("TRUST_IDLE_SECONDS", "720"))

log = lambda m: print(f"[trust] {m}", flush=True)


def receipt(name: str, pane: str, note: str) -> None:
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f"{name}.pane.txt"), "w", encoding="utf-8") as f:
        f.write(f"# {name} — {note}\n\n")
        f.write(pane + "\n")
    log(f"receipt: {name}")


def main() -> int:
    rng = random.Random()
    driver = UnownPty(
        log,
        cwd=UNOWN_ROOT,
        env_extra={"UNOWN_RECAP_IDLE_MINUTES": "0.05"},  # threshold compression only
    )
    failures = []
    try:
        driver.wait_for(["unown"], timeout=90, desc="boot")
        receipt("trust-0-boot", driver.pane_text(), "checkpoint 0: the session as a returning developer first sees it")

        # A real multi-step task with todos — the honest progress source.
        driver.type_prompt(
            "Create a file notes/ob-round-trust.md containing one line: 'trust test checkpoint'. "
            "Track it with the todo tool, then confirm the file exists."
        )
        driver.wait_for(
            ["Todos (1/1)", "trust test checkpoint"],
            mode="any",
            timeout=420,
            desc="the task settles (the todo completes or the file content echoes)",
        )
        driver.pump(2.0)
        receipt("trust-1-mission", driver.pane_text(),
                "checkpoint 1: mission + progress + the conf chip while a real task settles")

        # The away window: real clock. Checkpoints at random moments.
        log(f"idling {IDLE_SECONDS}s (the engine's own cadences run against this clock)...")
        checks = sorted(rng.sample(range(30, IDLE_SECONDS - 30), k=3))
        start = time.time()
        i = 2
        for c in checks:
            while time.time() - start < c:
                driver.pump(1.0)
            pane = driver.pane_text()
            receipt(f"trust-{i}-mididle", pane,
                    f"checkpoint {i}: a random moment away ({int(time.time() - start)}s) — what the screen says unattended")
            i += 1
        while time.time() - start < IDLE_SECONDS:
            driver.pump(1.0)

        # The return: the next prompt gets the brief. THE 60-SECOND MEASURE.
        driver.type_prompt("reply with the single word BACK")
        driver.wait_for(["── brief · back after"], timeout=120, desc="the auto-brief on return")
        driver.pump(1.5)
        pane = driver.pane_text()
        receipt("trust-return-brief", pane,
                "the RETURN checkpoint — the 60-second answer (compressed threshold; the idle window is real)")
        # The five questions, answered within one screen:
        for anchor, question in [
            ("mission:", "what we are doing"),
            ("happened:", "what happened"),
            ("learned:", "what was learned"),
            ("session:", "cost/time"),
            ("remains:", "what remains"),
        ]:
            if anchor not in pane:
                failures.append(f"the brief does not answer '{question}' (missing {anchor!r})")
        if "conf:" not in pane:
            failures.append("the brief is missing the confidence line")

        driver.wait_for(["BACK"], timeout=120, desc="the return turn settles")
        receipt("trust-final", driver.pane_text(), "the session after the return turn")

        log("trust test complete")
        if failures:
            for f in failures:
                log(f"FAIL: {f}")
            return 1
        log("all five questions answered within one screenful — the 60-second metric holds")
        return 0
    except Exception as exc:  # noqa: BLE001
        log(f"FAILED: {exc}")
        receipt("trust-failed", driver.pane_text(), "the trust test aborted — kept as the audit trail")
        return 1
    finally:
        try:
            driver.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
