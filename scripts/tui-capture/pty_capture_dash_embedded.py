#!/usr/bin/env python3
"""
pty_capture_dash_embedded.py — the embedded mount of the TUI dashboard:
/dashboard inside a live session (docs/tui-dashboard-plan.md §5.4).

Boots the real chat TUI, opens the dashboard as an editor-replacing screen,
verifies pane truth (sidebar, screen content, footer), drives a screen jump
and a drill-in, then proves Esc-Esc returns to the chat editor.

Usage: /usr/bin/python3 pty_capture_dash_embedded.py
Env:   OUT (default download/dashboard-captures/embedded), UNOWN_ROOT, PTY_CWD,
       EMBED_CHAT=0 to skip the warm-up chat turn, EMBED_CHAT_PROMPT to
       override it. The warm-up turn (a real model answer via the bridge)
       replaces the fresh-boot info block with a real transcript above the
       mounted dashboard — the lived-in-session look the landing still wants.
       It runs against a scratch UNOWN_HOME (providers fixture registry +
       brand theme, seeded per run) whose default model the bridge actually
       serves; the real ~/.unown is untouched. Time-boxed: if the model
       stalls, the dashboard mounts anyway.
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pty_common as C  # noqa: E402

OUT = os.environ.get("OUT", "/home/z/my-project/download/dashboard-captures/embedded")
CHAT_TURN = os.environ.get("EMBED_CHAT", "1") != "0"
CHAT_PROMPT = os.environ.get(
    "EMBED_CHAT_PROMPT",
    "In one sentence: what happens to my session notes while I work?",
)


def seed_chat_home(log) -> str:
    """A private UNOWN_HOME whose default model the bridge actually serves.

    The real ~/.unown pins kimi-k2.5, which the current upstream 404s on; the
    chat turn needs a resolvable, working model. Mirrors the providers lane's
    scratch-home pattern (pty_capture_providers.py): models.json + settings
    from the capture fixtures, plus the unown brand theme so the palette is
    unchanged. The real ~/.unown is never touched.
    """
    fixture = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "providers")
    home = tempfile.mkdtemp(prefix="unown-dash-embed-")
    agent = os.path.join(home, "agent")
    os.makedirs(os.path.join(agent, "themes"), exist_ok=True)
    shutil.copyfile(os.path.join(fixture, "models.json"), os.path.join(agent, "models.json"))
    settings = {
        "defaultProvider": "zai-bridge",
        "defaultModel": "agnes-3.0-flash",
        "theme": "unown",
    }
    with open(os.path.join(agent, "settings.json"), "w", encoding="utf-8") as f:
        import json

        json.dump(settings, f, indent=2)
    real_theme = os.path.expanduser("~/.unown/agent/themes/unown.json")
    if os.path.exists(real_theme):
        shutil.copyfile(real_theme, os.path.join(agent, "themes", "unown.json"))
    log(f"scratch UNOWN_HOME seeded: {home} (default model agnes-3.0-flash via bridge)")
    return home


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    log = C.make_logger("pty_capture_dash_embedded")
    failures: list[str] = []
    cwd = os.environ.get("PTY_CWD", C.UNOWN_ROOT)

    env_extra = None
    if CHAT_TURN:
        env_extra = {"UNOWN_HOME": seed_chat_home(log)}
    s = C.UnownPty(log, cwd=cwd, extra_args=[], env_extra=env_extra)
    try:
        s.wait_ready(timeout=90)
        s.wait_idle()

        if CHAT_TURN:
            # One real model turn (bridge on :3031): a transcript above the
            # mount reads as a live session; the fresh-boot Skills/Themes
            # info block scrolls away. Soft-fails on timeout — the mount is
            # the story, not the chat.
            log(f"warm-up chat turn: {CHAT_PROMPT!r}")
            s.type_prompt(CHAT_PROMPT, cps=80)
            try:
                s.wait_idle(timeout=120, stable_for=2.5)
            except Exception as exc:  # noqa: BLE001 — soft wait
                log(f"warm-up turn did not settle ({exc!r}); mounting anyway")

        # Open the dashboard via the slash command.
        s.type_prompt("/dashboard", cps=80)
        s.wait_for(
            ["LEARNING", "benchmark tasks", "esc-esc chat"],
            timeout=30,
            desc="embedded dashboard mount",
        )
        time.sleep(2.0)
        s.pump(0.8)
        pane = s.pane_text()
        C.render_png(s.screen, os.path.join(OUT, "dash-embedded-overview.png"), "unown — /dashboard (embedded)")
        open(os.path.join(OUT, "dash-embedded-overview.pane.txt"), "w", encoding="utf-8").write(pane)
        for anchor in ["LEARNING", "benchmark tasks", "esc-esc chat", "engine"]:
            if anchor not in pane:
                failures.append(f"embedded overview: missing {anchor!r}")

        # Jump to the Memory screen (accelerator 2) and verify pane truth.
        s.send("2")
        time.sleep(2.0)
        s.pump(0.8)
        pane = s.pane_text()
        C.render_png(s.screen, os.path.join(OUT, "dash-embedded-memory.png"), "unown — /dashboard memory (embedded)")
        open(os.path.join(OUT, "dash-embedded-memory.pane.txt"), "w", encoding="utf-8").write(pane)
        for anchor in ["engine tiers", "injection budget"]:
            if anchor not in pane:
                failures.append(f"embedded memory: missing {anchor!r}")

        # Drill into a tier (enter), verify history section, then back out.
        s.send("\r")
        time.sleep(1.5)
        s.pump(0.6)
        pane = s.pane_text()
        if "version history" not in pane and "POLICY" not in pane:
            failures.append("embedded memory detail: no tier detail rendered")
        s.send("\x1b")
        time.sleep(0.8)
        s.pump(0.4)

        # Esc-Esc returns to the chat editor (the prompt line is back).
        s.send("\x1b", delay=0.02)
        time.sleep(0.25)
        s.send("\x1b", delay=0.02)
        time.sleep(1.5)
        s.pump(0.8)
        pane = s.pane_text()
        C.render_png(s.screen, os.path.join(OUT, "dash-embedded-exited.png"), "unown — back to chat after /dashboard")
        open(os.path.join(OUT, "dash-embedded-exited.pane.txt"), "w", encoding="utf-8").write(pane)
        if "LEARNING" in pane:
            failures.append("esc-esc: dashboard still mounted after double-escape")
    finally:
        try:
            s.child.terminate(force=True)
        except Exception:
            pass

    if failures:
        print(f"FAIL: {len(failures)} check(s) failed:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS: embedded dashboard mounts, switches, drills, and exits cleanly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
