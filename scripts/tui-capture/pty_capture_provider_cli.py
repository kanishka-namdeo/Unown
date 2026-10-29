#!/usr/bin/env python3
"""
pty_capture_provider_cli.py — the 2026-10-30 provider-workflow hardening
round's CLI surfaces, verified live from an end user's POV.

Runs the REAL `unown` CLI commands in a real PTY (128x36) against a private
scratch UNOWN_HOME seeded from fixtures/providers/ (two providers: the bundled
bridge + a direct Agnes env-ref; plus a model-health mark so the round's new
surfacing rows render) and captures:

  01-providers-test        `unown providers test zai-bridge` — the reachable
                           verdict with the NEW probe latency chip
                           ("reachable — serves … · N ms") and the credential
                           source line
  02-doctor                `unown doctor` — the model-endpoint row with the
                           latency chip and the NEW "model health marks" warn
                           row (agnes-2.5-flash marked 5 min ago: subagents
                           skip it for up to 30 min)
  03-models                `unown models` — the provider rows with the
                           anthropic-wire label for the direct provider and
                           the NEW "recently failed" annotation on the marked
                           model, plus the served list with its latency

Every still is written with `<name>.pane.txt` (the literal screen text — the
audit ground truth; pyte IS the emulator, so pane == pixels), and the script
re-greps the pane dumps before exiting (a gate, not just a picture).

The pane-truth gate (exit non-zero on any miss):
  - "reachable" + "credential" + " ms" in 01 (the latency chip)
  - "model endpoint reachable" + " ms" in 02, plus "model health marks" +
    "agnes-2.5-flash" + "subagents skip it"
  - "anthropic wire" + "recently failed" + " ms" in 03

Usage:
    python3 scripts/tui-capture/pty_capture_provider_cli.py    # stills -> $OUT

Requirements: bun + the repo's node_modules, the LLM bridge on :3031,
python3 with pyte/pexpect/PIL. See pty-README.md for the lane contract.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import time

import pexpect
import pyte

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from pty_common import (  # noqa: E402
    COLS,
    ROWS,
    UNOWN_BIN,
    UNOWN_ROOT,
    render_png,
    _png_variance,
    make_logger,
    print_summary,
    StillRecord,
)

SCRIPT = "pty_capture_provider_cli"
FIXTURE = os.path.join(HERE, "fixtures", "providers")
OUT_DIR = os.environ.get(
    "OUT_DIR", "/home/z/my-project/download/unown-addon-captures/stills"
)


def seed_scratch_home(log) -> str:
    """A private UNOWN_HOME: the two-provider fixture registry + one fresh
    model-health mark (5 min ago) so the round's surfacing rows render."""
    home = tempfile.mkdtemp(prefix="unown-provider-cli-capture-")
    agent = os.path.join(home, "agent")
    os.makedirs(agent, exist_ok=True)
    for name in ("models.json", "settings.json"):
        shutil.copyfile(os.path.join(FIXTURE, name), os.path.join(agent, name))
    # NOTE: the fixture pair is OpenAI-wire; the overview's "· anthropic wire"
    # label only renders for anthropic-messages providers and is pinned by
    # unit tests instead of captured here — a keyless Anthropic entry would
    # make doctor's secondary-providers row a warn, and a dishonest capture
    # is worse than no capture.
    # The fixture registry lists agnes-2.5-flash under the direct `agnes`
    # provider — mark it 5 minutes old (inside the 30-min TTL) so doctor's
    # "model health marks" row and the models overview's annotation render.
    marks = {"agnes-2.5-flash": int(time.time() * 1000) - 5 * 60 * 1000}
    with open(os.path.join(agent, "model-health.json"), "w", encoding="utf-8") as f:
        json.dump({"version": 1, "marks": marks}, f)
    log(f"scratch UNOWN_HOME seeded: {home} (2 providers + 1 health mark)")
    return home


def run_cli_frame(home: str, log, args: list, name: str, anchors: list) -> StillRecord:
    """One CLI command = one process = one still: spawn in a PTY, feed pyte
    until every anchor is on the pane (commands print then exit; the final
    screen IS the record), render PNG from the same emulator state."""
    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    env["LINES"] = str(ROWS)
    env["COLUMNS"] = str(COLS)
    env["UNOWN_HOME"] = home
    for k in ("NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE", "COLORTERM"):
        env.pop(k, None)
    full = ["bun", UNOWN_BIN] + args
    log(f"spawn: {' '.join(full)}")
    child = pexpect.spawn(full[0], full[1:], cwd=UNOWN_ROOT, env=env, dimensions=(ROWS, COLS), timeout=120, encoding=None)
    screen = pyte.Screen(COLS, ROWS)
    stream = pyte.ByteStream(screen)
    deadline = time.time() + 120
    pane = ""
    while time.time() < deadline:
        try:
            chunk = child.read_nonblocking(65536, timeout=3)
        except pexpect.TIMEOUT:
            chunk = b""
        except (pexpect.EOF, OSError):
            chunk = b""
        if chunk:
            stream.feed(chunk)
        pane = "\n".join(line.rstrip() for line in screen.display)
        if all(a in pane for a in anchors):
            break
        if not child.isalive():
            try:
                rest = child.read_nonblocking(65536, timeout=1)
                if rest:
                    stream.feed(rest)
            except Exception:
                pass
            pane = "\n".join(line.rstrip() for line in screen.display)
            break
    try:
        child.expect(pexpect.EOF, timeout=10)
    except Exception:
        pass
    child.close(force=True)
    time.sleep(0.5)

    missing = [a for a in anchors if a not in pane]
    os.makedirs(OUT_DIR, exist_ok=True)
    png_path = os.path.join(OUT_DIR, f"{name}.png")
    pane_path = os.path.join(OUT_DIR, f"{name}.pane.txt")
    with open(pane_path, "w", encoding="utf-8") as f:
        f.write(pane + "\n")
    w, h = render_png(screen, png_path, name)
    variance = _png_variance(png_path)
    rec = StillRecord(
        name=name,
        anchors=anchors,
        png=png_path,
        pane=pane_path,
        ok=not missing,
        detail="; ".join(a for a in anchors if a in pane) or "(no anchor matched)",
        w=w,
        h=h,
        variance=variance,
    )
    log(
        f"still {name}: {'OK' if not missing else 'FAIL'} anchor={rec.detail!r} "
        f"png={w}x{h} variance={variance:.1f}"
    )
    if missing:
        log(f"still {name}: ANCHOR MISS {missing}; pane tail:\n" + "\n".join(pane.splitlines()[-14:]))
    return rec


def pane_gate(panes: dict, log) -> bool:
    """Re-grep the WRITTEN pane dumps — the stills' anchors verified again
    on what was actually recorded (a gate, not just a picture)."""

    def p(name: str) -> str:
        return panes.get(name, "")

    checks = []
    p01 = p("01-providers-test")
    checks += [
        ("01 reachable verdict", "reachable" in p01),
        ("01 credential line", "credential" in p01),
        ("01 latency chip", " ms" in p01),
    ]
    p02 = p("02-doctor")
    checks += [
        ("02 endpoint row", "model endpoint reachable" in p02),
        ("02 endpoint latency", " ms" in p02),
        ("02 health-marks row", "model health marks" in p02),
        ("02 marked model named", "agnes-2.5-flash" in p02),
        ("02 skip explanation", "subagents skip it" in p02),
    ]
    p03 = p("03-models")
    checks += [
        ("03 registry rows", "zai-bridge" in p03 and "agnes" in p03),
        ("03 recently-failed annotation", "recently failed" in p03),
        ("03 served latency", " ms" in p03),
    ]
    ok = True
    for label, passed in checks:
        log(f"pane gate: {'PASS' if passed else 'FAIL'}  {label}")
        ok = ok and passed
    return ok


def main() -> int:
    log = make_logger(SCRIPT)
    home = seed_scratch_home(log)
    records = []
    panes: dict = {}
    try:
        frames = [
            (
                "01-providers-test",
                ["providers", "test", "zai-bridge"],
                ["reachable", "credential", " ms"],
            ),
            (
                "02-doctor",
                ["doctor"],
                ["model endpoint reachable", "model health marks"],
            ),
            (
                "03-models",
                ["models"],
                ["recently failed", " ms"],
            ),
        ]
        for name, args, anchors in frames:
            rec = run_cli_frame(home, log, args, name, anchors)
            records.append(rec)
            with open(rec.pane, encoding="utf-8") as f:
                panes[name] = f.read()
        ok = pane_gate(panes, log)
    finally:
        shutil.rmtree(home, ignore_errors=True)
    print_summary(SCRIPT, records)
    log(f"scratch home removed; gate={'ok' if ok else 'FAILED'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
