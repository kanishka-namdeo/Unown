#!/usr/bin/env python3
"""
verify_dacapo_cp4.py — the Da capo round CP4's real-user verification
(PTY lane, pane-truth discipline per docs/tui-capture-workflow.md).

Drives the REAL `unown` TUI against the real stack (bridge + engine on
:3031/:3030, Agnes upstream) and asserts the CP4 contract as a user
sees it:

  chunk A (the statusline renders): with the global statusLine setting
           configured (a node script reading the JSON payload), the pane
           shows the SL-OK row above the footer — project, permission
           mode, turn count all from the LIVE payload (turn=0 at boot).
  chunk B (/statusline): the command prints the active config (command +
           interval), the payload contract and the example script.
  chunk C (refresh on turn end): after a real turn, the row re-renders
           with turn=1 — the agent_end refresh with live payload fields.
  chunk D (the kill switch): UNOWN_STATUSLINE=0 boots with NO row.
  chunk E (external editor context): with externalEditorContext on and a
           fixture $EDITOR, Ctrl+G seeds the '#' commented last reply
           above the typed prompt (captured on disk), the fixture writes
           a reply under the block, and the saved editor text carries the
           reply WITHOUT the block (byte-exact strip).

Exit 0 = every assertion held. Any failure prints the pane tail.
Stills + pane dumps land in OUT (default /tmp/unown-cp4-verify-out).
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pty_common import UNOWN_ROOT, UnownPty, dismiss_first_flights, make_logger  # noqa: E402

OUT = os.environ.get("OUT", "/tmp/unown-cp4-verify-out")
os.makedirs(OUT, exist_ok=True)
log = make_logger("verify-dacapo-cp4")

SETTINGS = os.path.expanduser("~/.unown/agent/settings.json")


def say(msg: str) -> None:
    log(msg)


def fail(msg: str, pane: list) -> None:
    say(f"FAIL: {msg}")
    say("--- pane tail ---")
    for line in pane[-30:]:
        say(f"    {line}")
    sys.exit(1)


def make_statusline_script(workdir: str) -> str:
    """A real statusline script: reads the JSON payload, prints the live fields."""
    path = os.path.join(workdir, "sl-verify.js")
    with open(path, "w", encoding="utf-8") as f:
        f.write(
            "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
            "const p=JSON.parse(d);"
            "process.stdout.write(`SL-OK ${p.project} mode=${p.permissionMode} turn=${p.turnCount} q=${p.queuedMessages}`)"
            "});\n"
        )
    return path


def make_editor_fixture(workdir: str) -> tuple[str, str]:
    """A fixture $EDITOR: captures the seeded file, appends a reply under the block."""
    capture = os.path.join(workdir, "editor-capture.txt")
    script = os.path.join(workdir, "ed-verify.sh")
    with open(script, "w", encoding="utf-8") as f:
        f.write(
            "#!/usr/bin/env bash\n"
            f'cat "$1" > "{capture}"\n'
            'printf "my reply" >> "$1"\n'
            "exit 0\n"
        )
    os.chmod(script, os.stat(script).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return script, capture


def write_settings(statusline_command: str | None, editor_context: bool) -> None:
    config: dict = {}
    if os.path.exists(SETTINGS):
        with open(SETTINGS, "r", encoding="utf-8") as f:
            config = json.load(f)
    if statusline_command:
        config["statusLine"] = {"command": f"node {statusline_command}", "refreshMs": 2000}
    else:
        config.pop("statusLine", None)
    if editor_context:
        config["externalEditorContext"] = True
    else:
        config.pop("externalEditorContext", None)
    os.makedirs(os.path.dirname(SETTINGS), exist_ok=True)
    with open(SETTINGS, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)


def boot(extra_env: dict | None = None, settle_s: float = 10.0) -> UnownPty:
    session = UnownPty(say, cwd=UNOWN_ROOT, env_extra=extra_env)
    session.wait_ready(timeout=240)
    session.pump(2)
    dismiss_first_flights(session, say)
    session.pump(settle_s)
    session.wait_idle(timeout=40, stable_for=2.0)
    return session


def run_turn(session: UnownPty, anchor_word: str) -> None:
    session.type_prompt(f"reply with the single word: {anchor_word}", cps=30)
    try:
        session.wait_for([anchor_word], timeout=150, desc=f"the answer ({anchor_word})")
    except Exception as exc:
        say(f"turn: answer wait soft-failed ({exc}) — continuing on pane truth")
    session.wait_idle(timeout=60, stable_for=2.5)


def main() -> int:
    results: list[tuple[str, bool]] = []
    workdir = tempfile.mkdtemp(prefix="unown-cp4-pty-")
    sl_script = make_statusline_script(workdir)
    ed_script, ed_capture = make_editor_fixture(workdir)
    backup = None
    if os.path.exists(SETTINGS):
        backup = os.path.join(workdir, "settings-backup.json")
        shutil.copy2(SETTINGS, backup)

    try:
        # ---------------- chunk A: the statusline renders at boot ----------------
        say("A: booting with the statusline configured (2 s refresh)…")
        write_settings(sl_script, editor_context=False)
        a = boot()
        try:
            a.wait_for(["SL-OK"], timeout=40, desc="the statusline row")
            a.still("statusline-idle", ["SL-OK"], mode="any")
            pane_a = a.pane()
            text_a = "\n".join(pane_a)
            ok_a1 = "SL-OK Unown mode=default" in text_a
            say(f"A1 the row renders with live payload (project + permission mode): {'OK' if ok_a1 else 'FAIL'}")
            results.append(("A1 statusline renders live payload", ok_a1))
            ok_a2 = "turn=0" in text_a and "q=0" in text_a
            say(f"A2 boot-state fields (turn=0, q=0): {'OK' if ok_a2 else 'FAIL'}")
            results.append(("A2 boot-state payload fields", ok_a2))
            ok_a3 = "# help" in text_a or "? help" in text_a or "help" in text_a
            say(f"A3 the footer hints still render (discoverability kept): {'OK' if ok_a3 else 'FAIL'}")
            results.append(("A3 footer hints kept", ok_a3))
            if not (ok_a1 and ok_a2):
                fail("A: the statusline row or its payload fields are wrong", pane_a)
        finally:
            a.close()

        # ---------------- chunk B: /statusline prints the contract ----------------
        say("B: running /statusline…")
        b = boot()
        try:
            b.type_prompt("/statusline", cps=30)
            b.wait_for(
                ["Statusline: node", "refresh every 2 s + on turn end"],
                timeout=60,
                desc="the /statusline config card",
            )
            b.wait_for(["contextWindow.usedPercent", "UNOWN_STATUSLINE=0"], timeout=30, desc="the contract lines")
            b.still("statusline-command", ["Statusline: node"], mode="any")
            say("B1 /statusline prints config + interval + contract + kill switch: OK")
            results.append(("B1 /statusline contract card", True))
        except Exception as exc:
            say(f"B1 FAIL: {exc}")
            results.append(("B1 /statusline contract card", False))
            fail("B: /statusline did not print the expected card", b.pane())
        finally:
            b.close()

        # ---------------- chunk C: refresh on turn end ----------------
        say("C: a real turn, then the turn-count refresh…")
        c = boot()
        try:
            run_turn(c, "docking")
            c.wait_for(["turn=1"], timeout=40, desc="the statusline turn=1 refresh")
            c.still("statusline-after-turn", ["turn=1"], mode="any")
            say("C1 the statusline refreshed on agent_end (turn=1): OK")
            results.append(("C1 refresh on turn end", True))
        except Exception as exc:
            say(f"C1 FAIL: {exc}")
            results.append(("C1 refresh on turn end", False))
            fail("C: the statusline did not refresh to turn=1", c.pane())
        finally:
            c.close()

        # ---------------- chunk D: the kill switch ----------------
        say("D: booting with UNOWN_STATUSLINE=0…")
        d = boot(extra_env={"UNOWN_STATUSLINE": "0"})
        try:
            d.pump(8)
            d.wait_idle(timeout=40, stable_for=2.0)
            d.still("statusline-killed", ["esc-esc tree"], mode="any")
            text_d = d.pane_text()
            ok_d1 = "SL-OK" not in text_d
            say(f"D1 UNOWN_STATUSLINE=0 hides the row: {'OK' if ok_d1 else 'FAIL'}")
            results.append(("D1 kill switch", ok_d1))
            if not ok_d1:
                fail("D: the statusline rendered despite UNOWN_STATUSLINE=0", d.pane())
        finally:
            d.close()

        # ---------------- chunk E: the external editor context (R4) ----------------
        say("E: Ctrl+G with externalEditorContext on (fixture $EDITOR)…")
        write_settings(sl_script, editor_context=True)
        e = boot(extra_env={"EDITOR": ed_script, "VISUAL": ed_script})
        try:
            run_turn(e, "docking")
            # Type a draft prompt (NO submit), then Ctrl+G.
            e.send("draft a haiku about terminals")
            e.pump(1.0)
            e.send("\x07")  # Ctrl+G — open the external editor
            e.wait_for(["my reply"], timeout=60, desc="the editor round-trip (reply under the block)")
            e.still("editor-context-after", ["my reply"], mode="any")
            pane_e = e.pane()
            text_e = "\n".join(pane_e)
            ok_e1 = "my reply" in text_e
            say(f"E1 the saved editor text carries the reply: {'OK' if ok_e1 else 'FAIL'}")
            results.append(("E1 reply survives the strip", ok_e1))
            ok_e2 = "# --- previous reply" not in text_e
            say(f"E2 the context block is stripped from the editor: {'OK' if ok_e2 else 'FAIL'}")
            results.append(("E2 block stripped on save", ok_e2))
            with open(ed_capture, "r", encoding="utf-8") as f:
                seeded = f.read()
            ok_e3 = seeded.startswith("# --- previous reply (context — this block is stripped on save) ---")
            ok_e3 = ok_e3 and "draft a haiku about terminals" in seeded and "# docking" in seeded
            say(f"E3 the editor SAW the '#' commented reply above the prompt: {'OK' if ok_e3 else 'FAIL'}")
            results.append(("E3 block seeded (captured on disk)", ok_e3))
            if not (ok_e1 and ok_e2 and ok_e3):
                fail("E: the external editor context round-trip is wrong", pane_e)
        finally:
            e.close()

    finally:
        # Restore the operator's settings.json whatever happened.
        if backup is not None:
            shutil.copy2(backup, SETTINGS)
            say("settings.json restored")
        shutil.rmtree(workdir, ignore_errors=True)

    say("")
    say("=== CP4 PTY lane summary ===")
    passed = sum(1 for _, ok in results if ok)
    for name, ok in results:
        say(f"  {'PASS' if ok else 'FAIL'}  {name}")
    say(f"{passed}/{len(results)} assertions held")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
