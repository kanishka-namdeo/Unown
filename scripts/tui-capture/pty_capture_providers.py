#!/usr/bin/env python3
"""
pty_capture_providers.py — the `/providers` slash command (R2, the TUI
native), verified live from an end user's POV.

Boots the real `unown` TUI against a PRIVATE scratch UNOWN_HOME seeded from
fixtures/providers/ (two providers: the bundled bridge + a direct Agnes env-
ref — the developer's real ~/.unown is never touched) and walks the command:

  01-providers-select      `/providers` opens the interactive manager: the
                           provider rows (id — name · key status · model
                           count), "+ Add provider…", "Done"
  02-providers-action-menu Enter on the first provider (zai-bridge) opens the
                           action menu: Make default… / Set API key / Test
                           connection / Refresh models / Remove provider… /
                           Back
  03-providers-test        "Test connection" against the LIVE local bridge
                           (:3031): the ✓ verdict with the credential source
                           and the served models
  04-providers-list        `/providers list` — the headless text summary:
                           both providers, key labels, the canonical
                           `zai-bridge/agnes-3.0-flash` default-model line,
                           the CLI-twin footer hint

Every still is written with `<name>.pane.txt` (the literal screen text — the
audit ground truth; pyte IS the emulator, so pane == pixels). Every surface
is anchor-verified against the pane text, and the script re-greps the pane
dumps before exiting (a gate, not just a picture): provider ids, the six
action labels, the verdict vocabulary and the footer hint must all be present
in the recorded panes.

The pane-truth gate (exit non-zero on any miss):
  - "zai-bridge" and "agnes" provider ids + "key:" labels in 01/04
  - "+ Add provider…" / "Done" in 01
  - all six action labels in 02
  - "reachable" + "credential" in 03
  - "default model: zai-bridge/agnes-3.0-flash" + "unown providers --help"
    in 04

Usage:
    python3 scripts/tui-capture/pty_capture_providers.py     # stills -> $OUT

Requirements: bun + the repo's node_modules, the LLM bridge on :3031 (for
still 03; without it the verdict frame degrades and the gate fails),
python3 with pyte/pexpect/PIL. See pty-README.md for the lane contract.
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from pty_common import (  # noqa: E402
    PaneTimeout,
    UnownPty,
    make_logger,
    print_summary,
)

SCRIPT = "pty_capture_providers"
FIXTURE = os.path.join(HERE, "fixtures", "providers")

# Anchors copied from the sources (audit ground truth):
#   providers-command.ts — entry rows `✓ <id> — <name> (default) · key: … · N models`,
#                          "+ Add provider…" / "Done", the six actions,
#                          "✓ <id> reachable at <url> — credential: <source>",
#                          "default model: <provider>/<model>",
#                          "unown providers --help for the CLI twin"
ACTION_ANCHORS = [
    "Make default…",
    "Set API key",
    "Test connection",
    "Refresh models",
    "Remove provider…",
    "Back",
]


def seed_scratch_home(log) -> str:
    """A private UNOWN_HOME carrying the two-provider fixture registry."""
    home = tempfile.mkdtemp(prefix="unown-providers-capture-")
    agent = os.path.join(home, "agent")
    os.makedirs(agent, exist_ok=True)
    for name in ("models.json", "settings.json"):
        shutil.copyfile(os.path.join(FIXTURE, name), os.path.join(agent, name))
    log(f"scratch UNOWN_HOME seeded: {home} (2 providers: zai-bridge, agnes)")
    return home


def pane_gate(records, log) -> bool:
    """Re-grep the WRITTEN pane dumps — the stills' anchors verified again
    against the files on disk, so the run is a gate, not just a picture."""
    def pane(name: str) -> str:
        for r in records:
            if r.name == name:
                try:
                    with open(r.pane, encoding="utf-8") as f:
                        return f.read()
                except OSError:
                    return ""
        return ""

    checks = []
    p01 = pane("01-providers-select")
    checks += [
        ("01 provider ids", "zai-bridge" in p01 and "agnes" in p01),
        ("01 key labels", "key:" in p01),
        ("01 add+done rows", "+ Add provider…" in p01 and "Done" in p01),
    ]
    p02 = pane("02-providers-action-menu")
    checks += [
        ("02 action labels", all(a in p02 for a in ACTION_ANCHORS)),
        ("02 provider title", "zai-bridge" in p02),
    ]
    p03 = pane("03-providers-test")
    checks += [
        ("03 reachable verdict", "reachable" in p03),
        ("03 credential source", "credential" in p03),
    ]
    p04 = pane("04-providers-list")
    checks += [
        ("04 canonical default line", "default model: zai-bridge/agnes-3.0-flash" in p04),
        ("04 env-ref key label", "key: $AGNES_API_KEY" in p04),
        ("04 CLI twin hint", "unown providers --help" in p04),
    ]
    ok = True
    for label, passed in checks:
        log(f"pane gate: {'PASS' if passed else 'FAIL'}  {label}")
        ok = ok and passed
    return ok


def main() -> int:
    log = make_logger(SCRIPT)
    records: list = []
    home = seed_scratch_home(log)
    s = UnownPty(log, env_extra={"UNOWN_HOME": home})
    try:
        s.wait_ready()
        s.wait_idle(timeout=30)

        # -- 01: the interactive manager (select list frame) -----------------
        s.log("send: /providers")
        s.type_prompt("/providers", cps=80)
        try:
            s.wait_for(
                ["+ Add provider…", "Done"],
                timeout=20,
                desc="/providers manager select",
            )
        except PaneTimeout:
            tail = "\n".join(s.pane()[-14:])
            log(f"the manager select did not open; pane tail:\n{tail}")
            raise
        time.sleep(0.4)
        s.pump(0.6)
        records.append(
            s.still(
                "01-providers-select",
                ["Providers", "zai-bridge", "agnes", "+ Add provider…", "Done"],
            )
        )

        # -- 02: the action menu (Enter selects the highlighted first row) ---
        s.key("Enter")
        s.wait_for(
            ACTION_ANCHORS,
            timeout=15,
            desc="provider action menu",
        )
        time.sleep(0.3)
        s.pump(0.6)
        records.append(
            s.still(
                "02-providers-action-menu",
                ["zai-bridge"] + ACTION_ANCHORS,
            )
        )

        # -- 03: Test connection against the LIVE local bridge ---------------
        # options: Make default… / Set API key / Test connection / … → Down x2
        s.key("Down")
        s.key("Down")
        s.key("Enter")
        try:
            s.wait_for(
                ["reachable", "credential"],
                timeout=30,
                desc="test-connection verdict",
            )
        except PaneTimeout:
            tail = "\n".join(s.pane()[-14:])
            log(f"the test verdict did not land; pane tail:\n{tail}")
        time.sleep(0.5)
        s.pump(0.8)
        records.append(
            s.still(
                "03-providers-test",
                ["reachable", "credential"],
            )
        )

        # -- 04: the headless text summary -------------------------------------
        # (select closed by the Enter above; Esc is belt-and-braces per the
        # pty-README modal-select gotcha before typing the next command)
        s.key("Esc")
        time.sleep(0.3)
        s.log("send: /providers list")
        s.type_prompt("/providers list", cps=80)
        s.wait_for(
            ["default model: zai-bridge/agnes-3.0-flash", "unown providers --help"],
            timeout=20,
            desc="/providers list summary",
        )
        time.sleep(0.4)
        s.pump(0.6)
        records.append(
            s.still(
                "04-providers-list",
                [
                    "Providers (",
                    "default model: zai-bridge/agnes-3.0-flash",
                    "key: $AGNES_API_KEY",
                    "unown providers --help",
                ],
            )
        )
    finally:
        s.close()

    passed, total = print_summary(SCRIPT, records)
    gate = pane_gate(records, log)
    shutil.rmtree(home, ignore_errors=True)
    log(f"scratch home removed; gate={'ok' if gate else 'FAILED'}")
    return 0 if all(r.ok for r in records) and gate else 1


if __name__ == "__main__":
    sys.exit(main())
