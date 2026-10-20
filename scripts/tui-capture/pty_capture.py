#!/usr/bin/env python3
"""
pty_capture.py — pure-TUI addon surfaces through a plain PTY (no model turns).

Captures, in one boot with the seeded default config and a second boot with
the advisor enabled (flipped through the /addons configurator itself):

  01-todos-empty        /todos on a fresh session — the empty-state notice
  02-addons-status      /addons status — the effective-config summary
  03-addons-configurator /addons — the select-driven configurator, first row
  04-addons-nav-down    arrow-down navigation (advisor row highlighted)
  05-addons-nav-up      arrow-up navigation (todo row highlighted)
  06-addons-advisor-menu the advisor submenu (enable / model / cadence / …)
  07-addons-toggle      the toggle interaction applied + persisted ([on])
  08-addons-exited      back at the editor after Esc-Esc, notify still visible
  09-advisor-status     /advisor status with the advisor registered (boot 2)

~/.unown/agent/addons.json is snapshotted before the run and restored
byte-for-byte after it (AddonsJsonGuard), so the toggle interaction leaves
the machine exactly as it found it.

Usage:
    python3 scripts/tui-capture/pty_capture.py         # stills -> $OUT

Requirements: bun + the repo's node_modules, the LLM bridge on :3031 (boot
only — no chat turns are sent), python3 with pyte/pexpect/PIL. See
pty-README.md for the full lane contract.
"""

from __future__ import annotations

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pty_common import (  # noqa: E402
    AddonsJsonGuard,
    OUT_DIR,
    UnownPty,
    exit_code,
    make_logger,
    print_summary,
)

SCRIPT = "pty_capture"

# Anchors copied from the addon sources (audit ground truth):
#   todo.ts        — "No todos yet. Ask the agent to track its work with the todo tool."
#   index.ts       — "unown addons — pick an addon to configure (Esc to exit)"
#                    rows: ask_user_question [on] / todo [on] / advisor [off] / status —
#                    status text: "unown addons (~/.unown/agent/addons.json):"
#   advisor.ts     — "advisor: enabled" / "advisor: idle (no reviews yet)"


def command(s: UnownPty, cmd: str):
    """Type a slash command and submit it (editor focus assumed)."""
    s.log(f"send: {cmd}")
    s.type_prompt(cmd, cps=80)


def main() -> int:
    log = make_logger(SCRIPT)
    records = []
    with AddonsJsonGuard(log):
        # -- boot 1: seeded defaults (advisor off, todo + ask on) -------------
        s = UnownPty(log)
        try:
            s.wait_ready()
            s.wait_idle(timeout=30)

            # 01 — /todos empty state
            command(s, "/todos")
            s.wait_for(
                ["No todos yet. Ask the agent to track its work with the todo tool."],
                timeout=20,
                desc="/todos empty notice",
            )
            time.sleep(0.4)
            s.pump(0.6)
            records.append(
                s.still(
                    "01-todos-empty",
                    ["No todos yet. Ask the agent to track its work with the todo tool."],
                )
            )

            # 02 — /addons status (default config, advisor off)
            command(s, "/addons status")
            s.wait_for(
                ["unown addons (~/.unown/agent/addons.json):"],
                timeout=20,
                desc="/addons status summary",
            )
            time.sleep(0.4)
            s.pump(0.6)
            records.append(
                s.still(
                    "02-addons-status",
                    [
                        "unown addons (~/.unown/agent/addons.json):",
                        "ask_user_question  on",
                        "todo               on",
                        "advisor            off",
                    ],
                )
            )

            # 03 — /addons configurator (main menu select)
            command(s, "/addons")
            s.wait_for(
                ["unown addons — pick an addon to configure (Esc to exit)"],
                timeout=20,
                desc="/addons main menu",
            )
            time.sleep(0.4)
            s.pump(0.6)
            records.append(
                s.still(
                    "03-addons-configurator",
                    [
                        "unown addons — pick an addon to configure (Esc to exit)",
                        "ask_user_question  [on]",
                        "todo               [on]",
                        "advisor            [off]",
                        "status — show the effective configuration",
                    ],
                )
            )

            # 04 — keyboard navigation: Down, Down lands on the advisor row
            s.key("Down")
            s.pump(0.5)
            s.key("Down")
            s.pump(0.8)
            records.append(s.still("04-addons-nav-down", ["→ advisor"], mode="all"))

            # 05 — arrow-up moves back onto the todo row
            s.key("Up")
            s.pump(0.8)
            records.append(s.still("05-addons-nav-up", ["→ todo"], mode="all"))

            # 06 — open the advisor submenu (one more Down, then Enter)
            s.key("Down")
            s.pump(0.5)
            s.key("Enter")
            s.wait_for(
                ["advisor addon", "Enable (takes effect after /reload)"],
                timeout=20,
                desc="advisor submenu",
            )
            time.sleep(0.3)
            s.pump(0.6)
            records.append(
                s.still(
                    "06-addons-advisor-menu",
                    [
                        "advisor addon",
                        "Enable (takes effect after /reload)",
                        "Model: (session model)",
                        "Review cadence: turn (every 1)",
                    ],
                )
            )

            # 07 — the toggle interaction: Enter on "Enable …" persists + notifies
            s.key("Enter")
            s.wait_for(
                ["advisor enabled — /reload applies it"],
                timeout=20,
                desc="toggle notify",
            )
            time.sleep(0.3)
            s.pump(0.8)
            records.append(
                s.still(
                    "07-addons-toggle-applied",
                    ["advisor enabled — /reload applies it", "advisor            [on]"],
                )
            )

            # 08 — Esc out of the select (modal-select gotcha), back at the editor
            s.key("Esc")
            time.sleep(0.3)
            s.pump(0.8)
            records.append(
                s.still(
                    "08-addons-back-to-editor",
                    ["advisor enabled — /reload applies it", "unown v"],
                )
            )
        finally:
            s.close()

        # -- boot 2: the toggle persisted advisor=true → /advisor registers ----
        s2 = UnownPty(log)
        try:
            s2.wait_ready()
            s2.wait_idle(timeout=30)
            command(s2, "/advisor status")
            s2.wait_for(
                ["advisor: enabled", "advisor: idle (no reviews yet)"],
                timeout=25,
                desc="/advisor status",
            )
            time.sleep(0.4)
            s2.pump(0.6)
            records.append(
                s2.still(
                    "09-advisor-status",
                    [
                        "advisor: enabled",
                        "advisor: idle (no reviews yet)",
                        "cadence: turn / every 1",
                    ],
                )
            )
        finally:
            s2.close()
        # AddonsJsonGuard restores the seeded bytes on exit.

    passed, total = print_summary(SCRIPT, records)
    return exit_code(records)


if __name__ == "__main__":
    sys.exit(main())
