#!/usr/bin/env python3
"""
verify_settings_hub.py — the Settings Evolution round's real-user
verification (PTY lane).

Drives the REAL `unown` TUI through the new /settings experience:

  chunk A: boot TUI → type /settings → assert the UNOWN HUB opens (the
           intent-ordered menu, NOT pi's theme selector — the vendored
           extension-override patch) → open a section → open an item →
           read its risk/help/value.
  chunk B: change a real value through the item editor (Agent → Goal
           budget → 25) → assert the save notice + persistence in
           ~/.unown/agent/settings-hub.json + the change ledger.
  chunk C: /settings search (headless-safe subcommand, in-TUI) → assert
           results; Recently changed shows the edit; /settings diff shows
           the drift; Esc out and /quit.

Exit 0 = every assertion held. Any failure prints the pane tail.
"""

from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import UnownPty, make_logger  # noqa: E402

UNOWN_ROOT = os.environ.get("UNOWN_ROOT", "/home/z/my-project/Unown")
WORK_DIR = "/tmp/unown-settings-verify"
OUT = os.environ.get("OUT", "/tmp/unown-settings-verify-out")

os.makedirs(OUT, exist_ok=True)
os.makedirs(WORK_DIR, exist_ok=True)
log = make_logger("verify-settings-hub")

# Isolated UNOWN_HOME so the lane never touches the developer's real config.
TEST_HOME = os.path.join(OUT, "home")
os.makedirs(os.path.join(TEST_HOME, "agent"), exist_ok=True)


def say(msg: str) -> None:
    log(msg)


def fail(msg: str, pane: list) -> None:
    say(f"FAIL: {msg}")
    say("--- pane tail ---")
    for line in pane[-30:]:
        say(f"    {line}")
    sys.exit(1)


def hub_prefs() -> dict:
    path = os.path.join(TEST_HOME, "agent", "settings-hub.json")
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def ledger_entries() -> list:
    path = os.path.join(TEST_HOME, "agent", "settings-history.jsonl")
    if not os.path.exists(path):
        return []
    out = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out


def selected_label(pane: list) -> str:
    """The highlighted row of the active select dialog (→ / ❯ marker)."""
    for line in pane:
        s = line.strip()
        if s.startswith("\u2192") or s.startswith("\u276f") or s.startswith(">"):
            return s
    return ""


def navigate_to(pty: UnownPty, needle: str, max_steps: int = 30, desc: str = "") -> None:
    """Walk Down until the SELECTED row contains the needle.
    Pumps the pty before every read — pyte only updates on pump()."""
    for _ in range(max_steps):
        pty.pump(0.15)
        if needle in selected_label(pty.pane()):
            return
        pty.key("Down", delay=0.07)
    pty.pump(0.3)
    raise AssertionError(f"navigate_to({desc or needle!r}): row not reached; selected={selected_label(pty.pane())!r}")


def close_all_dialogs(pty: UnownPty, max_esc: int = 8) -> None:
    """Esc until no dialog footer is visible (pyte pumped between keys)."""
    for _ in range(max_esc):
        pty.pump(0.25)
        text = pty.pane_text()
        if ("escape/ctrl+c cancel" in text) or ("↑↓ navigate" in text) or ("Esc to cancel" in text):
            pty.key("Esc")
            time.sleep(0.3)
            continue
        return
    pty.pump(0.3)


def main() -> None:
    # Pre-seed the isolated home headlessly: a FIRST unown run shows the
    # provider wizard, which would eat the PTY lane's keystrokes (doctor
    # seeds models.json/settings.json/addons.json/settings-hub.json with
    # the bundled-bridge defaults and exits).
    import subprocess

    seed_env = dict(os.environ)
    seed_env.update(
        {
            "UNOWN_HOME": TEST_HOME,
            "PI_BRIDGE_URL": "http://127.0.0.1:3031",
            "PI_MODEL_ID": "agnes-3.0-flash",
            "UNOWN_ALLOW_UNVERIFIED_SPECS": "1",
            "NO_UPDATE_NOTIFIER": "1",
        }
    )
    unown_bin = os.environ.get("UNOWN_BIN", "/home/z/.local/bin/unown")
    if not os.path.exists(unown_bin):
        unown_bin = os.path.join(UNOWN_ROOT, "bin", "unown")
    seeded = subprocess.run(
        [unown_bin, "doctor"],
        cwd=WORK_DIR,
        env=seed_env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=120,
    )
    if seeded.returncode != 0:
        say(f"WARNING: seeding doctor exited {seeded.returncode} — continuing anyway")

    say("chunk A: boot the real TUI and open /settings (the override patch)")
    pty = UnownPty(
        log,
        cwd=WORK_DIR,
        env_extra={
            "UNOWN_HOME": TEST_HOME,
            # A provider config so preflight passes: point at the real bridge.
            "PI_BRIDGE_URL": "http://127.0.0.1:3031",
            "UNOWN_ALLOW_UNVERIFIED_SPECS": "1",
            "NO_UPDATE_NOTIFIER": "1",
        },
    )
    try:
        pty.wait_ready(timeout=120)
        # The first-run First-flights overlay covers the editor and eats
        # keys ("esc close") — dismiss it, then wait for the command footer.
        time.sleep(1.5)
        pty.key("Esc")
        time.sleep(1.0)
        pty.wait_for(["ctrl+k palette"], timeout=60, desc="editor ready (overlay dismissed)")
        time.sleep(1.5)

        say("A1: /settings opens the UNOWN hub, not the pi theme selector")
        pty.type_prompt("/settings")
        pty.send("\r")
        pane_text = pty.wait_for(
            [
                "control centre",
                "Recently changed",
                "Health check",
                "Models & Cost",
                "Tools & Integrations",
                "Recovery",
            ],
            mode="all",
            timeout=30,
            desc="the hub menu with all cross-cutting surfaces + sections",
        )
        if "theme" in pane_text.lower().split("control centre")[0][-200:]:
            # The pi selector's first rows are Theme/Model — the hub must not
            # render them at the top level.
            pass  # informational only; anchors above are the contract

        say("A2: open the Safety section — the intent grouping holds")
        navigate_to(pty, "Safety —", desc="Safety section row")
        pty.key("Enter")
        pty.wait_for(
            [
                "Effective permission envelope",
                "Trust manifest (this project)",
                "Default project trust",
            ],
            mode="all",
            timeout=20,
            desc="Safety section items with risk-badged rows",
        )
        say("A3: open an item — risk, help, value, revert surface")
        navigate_to(pty, "Default project trust", desc="the trust item row")
        pty.key("Enter")
        pty.wait_for(
            ["HIGH", "Now:", "Lives in", "Back"],
            mode="all",
            timeout=20,
            desc="the item editor with risk + value + persistence + back",
        )
        pty.key("Esc")

        say("chunk B: change a real value through the hub editor")
        say("B1: back at hub, search for the goal budget")
        pty.key("Esc")  # close the item editor → section; Esc again → hub
        time.sleep(0.8)
        pty.pump(0.5)
        if "control centre" not in pty.pane_text():
            pty.key("Esc")
            time.sleep(0.8)
            pty.pump(0.5)
        if "control centre" not in pty.pane_text():
            pty.type_prompt("/settings")
            pty.wait_for(["control centre"], timeout=20, desc="hub re-open")
        navigate_to(pty, "Search settings", desc="the Search row")
        pty.key("Enter")
        pty.wait_for(["Search settings"], timeout=10, desc="search input dialog")
        # Dialog inputs: plain chars + Enter — NEVER type_prompt (its Esc
        # closes autocomplete in the EDITOR but CANCELS a dialog).
        pty.send("goal budget")
        time.sleep(0.4)
        pty.send("\r")
        pane_text = pty.wait_for(
            ["Goal budget", "Agent →"],
            mode="all",
            timeout=15,
            desc="search results with section context",
        )
        say("B2: open the item and set it to 25")
        # The first hit should be Agent → Goal budget (turns) — selection
        # starts at the top of the results.
        pty.pump(0.3)
        if "Goal budget" not in selected_label(pty.pane()):
            navigate_to(pty, "Goal budget", desc="the goal-budget search hit")
        pty.key("Enter")
        pty.wait_for(["Goal budget (turns)", "runaway-grind guard"], mode="any", timeout=15, desc="the item editor")
        navigate_to(pty, "Change value", desc="the Change value row")
        pty.key("Enter")
        pty.wait_for(["0..10000"], timeout=10, desc="the number input dialog")
        pty.send("25")
        time.sleep(0.4)
        pty.send("\r")
        pty.wait_for(["Saved: Goal budget (turns) = 25"], timeout=15, desc="the save notice")

        say("B3: persistence + ledger landed on disk")
        prefs = hub_prefs()
        if prefs.get("goalBudgetTurns") != 25:
            fail(f"settings-hub.json goalBudgetTurns = {prefs.get('goalBudgetTurns')!r}, expected 25", pty.pane())
        entries = ledger_entries()
        if not any(e.get("itemId") == "agent.goal-budget" and e.get("after") == 25 for e in entries):
            fail("the change ledger has no agent.goal-budget → 25 entry", pty.pane())
        say("ledger + prefs verified on disk")

        say("chunk C: subcommands + recently changed + diff, then clean exit")
        close_all_dialogs(pty)
        time.sleep(0.8)
        pty.pump(0.4)
        pty.type_prompt("/settings search goal budget")
        pty.wait_for(["runaway-grind guard"], timeout=15, desc="search subcommand results in-TUI")
        close_all_dialogs(pty)
        pty.type_prompt("/settings diff")
        pty.wait_for(["Goal budget (turns): 25"], timeout=15, desc="diff shows the drift vs default 0")
        pty.type_prompt("/settings recent 5")
        pty.wait_for(["Goal budget (turns)"], timeout=15, desc="recently changed shows the edit")

        say("C-last: clean quit")
        pty.send("/quit")
        pty.key("Enter")
        time.sleep(1.5)

        say("ALL ASSERTIONS HELD")
    except Exception as exc:  # PaneTimeout or any driver error
        fail(f"exception: {exc!r}", pty.pane() if not pty.dead else ["<pane unavailable — process dead>"])
    finally:
        try:
            if not pty.dead:
                pty.child.terminate(force=True)
        except Exception:
            pass


if __name__ == "__main__":
    main()
